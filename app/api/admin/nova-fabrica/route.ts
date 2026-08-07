import { buildInternalAuthEmail, normalizeOptionalEmail, normalizeUsername, validateOptionalEmail, validatePassword, validateUsername } from '@/lib/auth-credentials'
import { assertAllowedOrigin, idempotencyDigest, jsonNoStore, readStrictJson, RequestValidationError, safeCorrelationId } from '@/lib/auth-http'
import { requireCurrentPrincipal, requireSuperAdmin } from '@/lib/auth-principal'
import { consumeSensitiveLimit, postgresRateLimitStore } from '@/lib/auth-rate-limit'
import { finishIdentityFailure, identityOperationDecision, nonSensitiveFingerprint } from '@/lib/identity-operation'
import { AuthError, supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let empresaId: string | null = null
  let userId: string | null = null
  let operationId: string | null = null
  let partialDatabaseState = false
  const correlationId = safeCorrelationId(request)
  try {
    assertAllowedOrigin(request)
    const principal = await requireCurrentPrincipal(request)
    requireSuperAdmin(principal)
    const limited = await consumeSensitiveLimit(request, {
      operation: 'create_tenant_admin', empresaId: principal.empresaId, actorUserId: principal.userId,
    }, postgresRateLimitStore(supabaseAdmin))
    if (!limited.allowed) return jsonNoStore({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } })

    const body = await readStrictJson<{ nomeFabrica?: unknown; nome?: unknown; username?: unknown; password?: unknown; email?: unknown }>(
      request, ['nomeFabrica', 'nome', 'username', 'password', 'email'],
    )
    const companyName = String(body.nomeFabrica ?? '').trim()
    const name = String(body.nome ?? '').trim() || 'Administrador'
    const username = normalizeUsername(body.username)
    const password = String(body.password ?? '')
    const contactEmail = normalizeOptionalEmail(body.email)
    const validationError = (!companyName ? 'Nome da empresa é obrigatório.' : null)
      ?? validateUsername(username) ?? validatePassword(password) ?? validateOptionalEmail(contactEmail)
    if (validationError) return jsonNoStore({ error: validationError }, { status: 400 })

    const company = await supabaseAdmin.from('empresas').insert({ nome: companyName, status: 'ativo' }).select('id').single()
    if (company.error || !company.data) throw new Error('company_create_failed')
    const createdEmpresaId = company.data.id
    empresaId = createdEmpresaId

    const fingerprint = nonSensitiveFingerprint({ company_name: companyName, username, administrator_name: name })
    const digest = idempotencyDigest(request, {
      operation: 'create_tenant_admin', empresaId: createdEmpresaId, actorUserId: principal.userId,
    }, fingerprint)
    const begun = await supabaseAdmin.rpc('begin_identity_operation', {
      p_operation_type: 'create_tenant_admin', p_empresa_id: createdEmpresaId, p_idempotency_digest: digest,
      p_actor_user_id: principal.userId, p_target_user_id: null, p_username: username,
    })
    if (begun.error || begun.data?.length !== 1) throw new Error('operation_begin_failed')
    const operation = begun.data[0]
    operationId = operation.operation_id
    const decision = identityOperationDecision(operation)
    if (decision.kind !== 'proceed') throw new Error('operation_conflict')

    const role = await supabaseAdmin.from('roles').select('id').eq('name', 'system_manager').single()
    if (role.error || !role.data) throw new Error('administrator_role_missing')
    const auth = await supabaseAdmin.auth.admin.createUser({
      email: buildInternalAuthEmail(crypto.randomUUID()), password, email_confirm: true,
      user_metadata: { nome: name }, app_metadata: { empresa_id: createdEmpresaId, login_identifier: 'username' },
    })
    if (auth.error || !auth.data.user) throw new Error('auth_create_failed')
    userId = auth.data.user.id

    partialDatabaseState = true
    const profile = await supabaseAdmin.from('perfis').insert({
      id: userId, user_id: userId, email: contactEmail, nome: name, status: 'ativo', empresa_id: createdEmpresaId,
      tipo_usuario: 'admin', first_access_completed: false, updated_at: new Date().toISOString(),
    })
    if (profile.error) throw new Error('profile_create_failed')
    const access = await supabaseAdmin.from('controle_acesso').insert({
      user_id: userId, empresa_id: createdEmpresaId, nivel: 'admin', status: 'ativo', activated_at: new Date().toISOString(),
    })
    if (access.error) throw new Error('access_create_failed')
    const roleWrite = await supabaseAdmin.from('user_roles').insert({
      user_id: userId, empresa_id: createdEmpresaId, role_id: role.data.id, granted_by: principal.userId,
    })
    if (roleWrite.error) throw new Error('role_create_failed')

    const completed = await supabaseAdmin.rpc('upsert_private_auth_state', {
      p_operation_id: operationId, p_user_id: userId, p_username: username,
      p_must_change_password: true, p_expected_state_version: null, p_correlation_id: correlationId,
    })
    if (completed.error) throw new Error('private_state_completion_failed')
    return jsonNoStore({ success: true, empresa_id: createdEmpresaId, user_id: userId, username, status: 'completed' }, { status: 201 })
  } catch (error) {
    if (operationId) {
      let fullyCompensated = false
      if (!partialDatabaseState && userId) {
        const authDeleted = !(await supabaseAdmin.auth.admin.deleteUser(userId)).error
        const companyDeleted = empresaId ? !(await supabaseAdmin.from('empresas').delete().eq('id', empresaId)).error : true
        fullyCompensated = authDeleted && companyDeleted
      }
      try {
        await finishIdentityFailure(supabaseAdmin, {
          operationId, status: fullyCompensated ? 'failed' : 'compensation_required',
          failureCode: error instanceof Error ? error.message : 'unknown_failure', correlationId,
        })
      } catch { /* fail closed */ }
    } else if (empresaId) {
      await supabaseAdmin.from('empresas').delete().eq('id', empresaId)
    }
    if (error instanceof RequestValidationError || error instanceof AuthError) return jsonNoStore({ error: error.message }, { status: error.status })
    return jsonNoStore({ error: 'Não foi possível criar a empresa e o administrador.' }, { status: 500 })
  }
}
