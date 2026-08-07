import { validatePassword } from '@/lib/auth-credentials'
import { assertAllowedOrigin, idempotencyDigest, jsonNoStore, readStrictJson, RequestValidationError, safeCorrelationId } from '@/lib/auth-http'
import { requireCurrentPrincipal, requireSystemManager } from '@/lib/auth-principal'
import { consumeSensitiveLimit, postgresRateLimitStore } from '@/lib/auth-rate-limit'
import { finishIdentityFailure, identityOperationDecision, nonSensitiveFingerprint } from '@/lib/identity-operation'
import { AuthError, supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let operationId: string | null = null
  let authChanged = false
  const correlationId = safeCorrelationId(request)
  try {
    assertAllowedOrigin(request)
    const principal = await requireCurrentPrincipal(request)
    requireSystemManager(principal)
    const { id: targetUserId } = await params
    if (targetUserId === principal.userId) return jsonNoStore({ error: 'Use a alteração de senha da sua própria conta.' }, { status: 400 })

    const limited = await consumeSensitiveLimit(request, {
      operation: 'admin_reset_password', empresaId: principal.empresaId,
      actorUserId: principal.userId, targetUserId,
    }, postgresRateLimitStore(supabaseAdmin))
    if (!limited.allowed) return jsonNoStore({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } })

    const { password } = await readStrictJson<{ password?: unknown }>(request, ['password'])
    const temporaryPassword = String(password ?? '')
    const passwordError = validatePassword(temporaryPassword)
    if (passwordError) return jsonNoStore({ error: passwordError }, { status: 400 })

    const [targetResult, accessResult, rolesResult, superAdminResult, stateResult] = await Promise.all([
      supabaseAdmin.from('perfis').select('user_id, status').eq('user_id', targetUserId).eq('empresa_id', principal.empresaId).maybeSingle(),
      supabaseAdmin.from('controle_acesso').select('status').eq('user_id', targetUserId).eq('empresa_id', principal.empresaId).maybeSingle(),
      supabaseAdmin.from('v_user_roles').select('role_name').eq('user_id', targetUserId).eq('empresa_id', principal.empresaId),
      supabaseAdmin.from('super_admins').select('user_id').eq('user_id', targetUserId).maybeSingle(),
      supabaseAdmin.rpc('get_private_auth_state', { p_user_id: targetUserId }),
    ])
    if (targetResult.error || targetResult.data?.status !== 'ativo' || accessResult.error || accessResult.data?.status !== 'ativo'
      || rolesResult.error || superAdminResult.error || superAdminResult.data || stateResult.error || stateResult.data?.length !== 1) {
      return jsonNoStore({ error: 'Não foi possível redefinir a senha.' }, { status: 403 })
    }
    if (rolesResult.data.some(({ role_name }) => role_name === 'system_manager')) {
      return jsonNoStore({ error: 'Não foi possível redefinir a senha.' }, { status: 403 })
    }
    const state = stateResult.data[0]
    const fingerprint = nonSensitiveFingerprint({ target_user_id: targetUserId, credential_version: Number(state.credential_version) })
    const digest = idempotencyDigest(request, {
      operation: 'admin_reset_password', empresaId: principal.empresaId,
      actorUserId: principal.userId, targetUserId,
    })
    const begun = await supabaseAdmin.rpc('begin_identity_operation', {
      p_operation_type: 'admin_reset_password', p_empresa_id: principal.empresaId,
      p_idempotency_digest: digest, p_request_fingerprint: fingerprint, p_actor_user_id: principal.userId,
      p_target_user_id: targetUserId, p_username: null,
    })
    if (begun.error || begun.data?.length !== 1) return jsonNoStore({ error: 'Não foi possível iniciar a operação.' }, { status: 409 })
    const operation = begun.data[0]
    operationId = operation.operation_id
    const decision = identityOperationDecision(operation)
    if (decision.kind === 'replay') return jsonNoStore({ success: true, requires_password_change: true })
    if (decision.kind === 'conflict') return jsonNoStore({ error: 'Operação já está em andamento ou requer reconciliação.' }, { status: 409 })

    const authUser = await supabaseAdmin.auth.admin.getUserById(targetUserId)
    if (authUser.error || !authUser.data.user) throw new Error('auth_user_lookup_failed')
    const changed = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
      password: temporaryPassword,
      app_metadata: {
        ...authUser.data.user.app_metadata,
        credential_version: Number(state.credential_version) + 1,
      },
    })
    if (changed.error) throw new Error('auth_reset_failed')
    authChanged = true
    const completed = await supabaseAdmin.rpc('upsert_private_auth_state', {
      p_operation_id: operationId, p_user_id: targetUserId, p_username: null,
      p_must_change_password: true, p_expected_state_version: Number(state.state_version),
      p_correlation_id: correlationId,
    })
    if (completed.error) throw new Error('private_state_completion_failed')
    return jsonNoStore({ success: true, requires_password_change: true })
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
    return jsonNoStore({ error: 'Não foi possível redefinir a senha.' }, { status: 500 })
  }
}
