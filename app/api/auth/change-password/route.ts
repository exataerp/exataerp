import { createClient as createIsolatedClient } from '@supabase/supabase-js'

import { validatePasswordChange } from '@/lib/auth-credentials'
import { assertAllowedOrigin, idempotencyDigest, jsonNoStore, readStrictJson, RequestValidationError, safeCorrelationId } from '@/lib/auth-http'
import { requireCurrentPrincipal } from '@/lib/auth-principal'
import { consumeSensitiveLimit, postgresRateLimitStore } from '@/lib/auth-rate-limit'
import { finishIdentityFailure, identityOperationDecision, nonSensitiveFingerprint } from '@/lib/identity-operation'
import { AuthError, supabaseAdmin } from '@/lib/supabase/admin'
import { createClient as createSessionClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let operationId: string | null = null
  let authChanged = false
  const correlationId = safeCorrelationId(request)
  try {
    assertAllowedOrigin(request)
    const principal = await requireCurrentPrincipal(request, { allowPasswordChange: true })
    const limited = await consumeSensitiveLimit(request, {
      operation: 'change_password', empresaId: principal.empresaId,
      actorUserId: principal.userId, targetUserId: principal.userId,
    }, postgresRateLimitStore(supabaseAdmin))
    if (!limited.allowed) return jsonNoStore({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } })

    const body = await readStrictJson<{ currentPassword?: unknown; newPassword?: unknown; confirmation?: unknown }>(
      request, ['currentPassword', 'newPassword', 'confirmation'],
    )
    const currentPassword = String(body.currentPassword ?? '')
    const newPassword = String(body.newPassword ?? '')
    const errors = validatePasswordChange(currentPassword, newPassword, body.confirmation)
    if (Object.keys(errors).length) return jsonNoStore({ error: Object.values(errors)[0] }, { status: 400 })

    const fingerprint = nonSensitiveFingerprint({ credential_version: principal.credentialVersion })
    const digest = idempotencyDigest(request, {
      operation: 'change_password', empresaId: principal.empresaId,
      actorUserId: principal.userId, targetUserId: principal.userId,
    })
    const begun = await supabaseAdmin.rpc('begin_identity_operation', {
      p_operation_type: 'change_password', p_empresa_id: principal.empresaId,
      p_idempotency_digest: digest, p_request_fingerprint: fingerprint, p_actor_user_id: principal.userId,
      p_target_user_id: principal.userId, p_username: null,
    })
    if (begun.error || begun.data?.length !== 1) return jsonNoStore({ error: 'Não foi possível iniciar a operação.' }, { status: 409 })
    const operation = begun.data[0]
    operationId = operation.operation_id
    const decision = identityOperationDecision(operation)
    if (decision.kind === 'replay') return jsonNoStore({ success: true, requires_login: true })
    if (decision.kind === 'conflict') return jsonNoStore({ error: 'Operação já está em andamento ou requer reconciliação.' }, { status: 409 })

    const authUser = await supabaseAdmin.auth.admin.getUserById(principal.userId)
    const technicalEmail = authUser.data.user?.email
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (authUser.error || !technicalEmail || !url || !anonKey) throw new Error('reauth_configuration_failed')
    const isolated = createIsolatedClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    const reauthenticated = await isolated.auth.signInWithPassword({ email: technicalEmail, password: currentPassword })
    await isolated.auth.signOut({ scope: 'local' })
    if (reauthenticated.error) {
      await finishIdentityFailure(supabaseAdmin, { operationId: operation.operation_id, status: 'failed', failureCode: 'current_password_invalid', correlationId })
      operationId = null
      return jsonNoStore({ error: 'A senha atual está incorreta.' }, { status: 400 })
    }

    const changed = await supabaseAdmin.auth.admin.updateUserById(principal.userId, { password: newPassword })
    if (changed.error) throw new Error('auth_password_update_failed')
    authChanged = true
    const completed = await supabaseAdmin.rpc('upsert_private_auth_state', {
      p_operation_id: operationId, p_user_id: principal.userId, p_username: null,
      p_must_change_password: false, p_expected_state_version: principal.stateVersion,
      p_correlation_id: correlationId,
    })
    if (completed.error) throw new Error('private_state_completion_failed')

    const session = await createSessionClient()
    await session.auth.signOut({ scope: 'global' })
    return jsonNoStore({ success: true, requires_login: true })
  } catch (error) {
    if (operationId) {
      try {
        await finishIdentityFailure(supabaseAdmin, {
          operationId, status: authChanged ? 'compensation_required' : 'failed',
          failureCode: error instanceof Error ? error.message : 'unknown_failure', correlationId,
        })
      } catch { /* fail closed */ }
    }
    if (error instanceof RequestValidationError || error instanceof AuthError) return jsonNoStore({ error: error.message }, { status: error.status })
    return jsonNoStore({ error: 'Não foi possível alterar a senha agora.' }, { status: 500 })
  }
}
