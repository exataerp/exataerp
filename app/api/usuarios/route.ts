import { buildInternalAuthEmail, normalizeOptionalEmail, normalizeUsername, validateOptionalEmail, validatePassword, validateUsername } from '@/lib/auth-credentials'
import { assertAllowedOrigin, idempotencyDigest, jsonNoStore, readStrictJson, RequestValidationError, safeCorrelationId } from '@/lib/auth-http'
import { requireCurrentPrincipal, requireSystemManager } from '@/lib/auth-principal'
import { consumeSensitiveLimit, postgresRateLimitStore } from '@/lib/auth-rate-limit'
import { compensateCreatedIdentity } from '@/lib/identity-compensation'
import { finishIdentityFailure, identityOperationDecision, nonSensitiveFingerprint } from '@/lib/identity-operation'
import { AuthError, supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let operationId: string | null = null
  let createdUserId: string | null = null
  let empresaId: string | null = null
  let completionUncertain = false
  const correlationId = safeCorrelationId(request)

  try {
    assertAllowedOrigin(request)
    const principal = await requireCurrentPrincipal(request)
    empresaId = principal.empresaId
    requireSystemManager(principal)
    const limited = await consumeSensitiveLimit(request, {
      operation: 'create_user', empresaId: principal.empresaId, actorUserId: principal.userId,
    }, postgresRateLimitStore(supabaseAdmin))
    if (!limited.allowed) return jsonNoStore({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } })

    const body = await readStrictJson<{
      username?: unknown; password?: unknown; nome?: unknown; cargo?: unknown; email?: unknown; roles?: unknown
    }>(request, ['username', 'password', 'nome', 'cargo', 'email', 'roles'])
    const username = normalizeUsername(body.username)
    const password = String(body.password ?? '')
    const nome = String(body.nome ?? '').trim()
    const cargo = String(body.cargo ?? '').trim() || null
    const email = normalizeOptionalEmail(body.email)
    const roles = Array.isArray(body.roles) ? [...new Set(body.roles.map(String))] : []
    const validationError = validateUsername(username) ?? validatePassword(password)
      ?? validateOptionalEmail(email) ?? (!nome ? 'Nome é obrigatório.' : null)
      ?? (roles.length === 0 ? 'Selecione pelo menos um perfil de acesso.' : null)
    if (validationError) return jsonNoStore({ error: validationError }, { status: 400 })
    // A tenant manager cannot grant the global or tenant-manager role in this phase.
    if (roles.includes('super_admin') || roles.includes('system_manager')) return jsonNoStore({ error: 'Perfil de acesso não permitido.' }, { status: 403 })

    const { data: validRoles, error: rolesError } = await supabaseAdmin.from('roles').select('id, name').in('name', roles)
    if (rolesError || validRoles?.length !== roles.length) return jsonNoStore({ error: 'Um ou mais perfis de acesso são inválidos.' }, { status: 400 })

    const fingerprint = nonSensitiveFingerprint({ username, nome, cargo, roles: [...roles].sort() })
    const digest = idempotencyDigest(request, { operation: 'create_user', empresaId: principal.empresaId, actorUserId: principal.userId })
    const begun = await supabaseAdmin.rpc('begin_identity_operation', {
      p_operation_type: 'create_user', p_empresa_id: principal.empresaId, p_idempotency_digest: digest,
      p_request_fingerprint: fingerprint,
      p_actor_user_id: principal.userId, p_target_user_id: null, p_username: username,
    })
    if (begun.error || begun.data?.length !== 1) return jsonNoStore({ error: 'Não foi possível iniciar a operação.' }, { status: 409 })
    const operation = begun.data[0]
    operationId = operation.operation_id
    const decision = identityOperationDecision(operation)
    if (decision.kind === 'replay') return jsonNoStore(decision.result, { status: 200 })
    if (decision.kind === 'conflict') return jsonNoStore({ error: 'Operação já está em andamento ou requer reconciliação.' }, { status: 409 })

    const internalEmail = buildInternalAuthEmail(crypto.randomUUID())
    const auth = await supabaseAdmin.auth.admin.createUser({
      email: internalEmail, password, email_confirm: true,
      user_metadata: { nome },
      app_metadata: { empresa_id: principal.empresaId, login_identifier: 'username', credential_version: 1 },
    })
    createdUserId = auth.data.user?.id ?? null
    if (auth.error || !createdUserId) throw new Error('auth_create_failed')

    const profile = await supabaseAdmin.from('perfis').insert({
      id: createdUserId, user_id: createdUserId, empresa_id: principal.empresaId, username, email, nome, cargo,
      tipo_usuario: 'colaborador', status: 'ativo', first_access_completed: false, updated_at: new Date().toISOString(),
    })
    if (profile.error) throw new Error('profile_create_failed')
    const access = await supabaseAdmin.from('controle_acesso').insert({
      user_id: createdUserId, empresa_id: principal.empresaId, nivel: 'operador', status: 'ativo', activated_at: new Date().toISOString(),
    })
    if (access.error) throw new Error('access_create_failed')
    const roleWrite = await supabaseAdmin.from('user_roles').insert(validRoles.map((role) => ({
      user_id: createdUserId, empresa_id: principal.empresaId, role_id: role.id, granted_by: principal.userId,
    })))
    if (roleWrite.error) throw new Error('roles_create_failed')

    const completed = await supabaseAdmin.rpc('upsert_private_auth_state', {
      p_operation_id: operationId, p_user_id: createdUserId, p_username: username,
      p_must_change_password: true, p_expected_state_version: null, p_correlation_id: correlationId,
    })
    if (completed.error) {
      const recovered = await supabaseAdmin.rpc('get_private_auth_state', { p_user_id: createdUserId })
      if (!recovered.error && recovered.data?.[0]?.username === username) {
        return jsonNoStore({ success: true, user_id: createdUserId, username, requires_password_change: true }, { status: 201 })
      }
      completionUncertain = Boolean(recovered.error)
      throw new Error('private_state_completion_failed')
    }
    return jsonNoStore({ success: true, user_id: createdUserId, username, requires_password_change: true }, { status: 201 })
  } catch (error) {
    if (operationId && empresaId) {
      const failureStatus = await compensateCreatedIdentity(supabaseAdmin, {
        userId: createdUserId,
        empresaId,
        deleteEmpresa: false,
        skipCleanup: completionUncertain,
      })
      try {
        await finishIdentityFailure(supabaseAdmin, {
          operationId, status: failureStatus,
          failureCode: error instanceof Error ? error.message : 'unknown_failure', correlationId,
        })
      } catch { /* fail closed; reconciliation remains mandatory */ }
    }
    if (error instanceof RequestValidationError || error instanceof AuthError) return jsonNoStore({ error: error.message }, { status: error.status })
    return jsonNoStore({ error: 'Não foi possível criar o usuário.' }, { status: 500 })
  }
}
