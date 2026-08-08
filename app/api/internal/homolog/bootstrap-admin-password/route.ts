import { validatePassword } from '@/lib/auth-credentials'
import {
  idempotencyDigest,
  jsonNoStore,
  readStrictJson,
  RequestValidationError,
  safeCorrelationId,
} from '@/lib/auth-http'
import { consumeSensitiveLimit, postgresRateLimitStore } from '@/lib/auth-rate-limit'
import {
  HOMOLOG_ADMIN_UID,
  HOMOLOG_ADMIN_USERNAME,
  homologBootstrapAccessStatus,
  initialHomologAdminBootstrapVersions,
} from '@/lib/homolog-admin-bootstrap'
import {
  finishIdentityFailure,
  identityOperationDecision,
  nonSensitiveFingerprint,
} from '@/lib/identity-operation'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const accessStatus = homologBootstrapAccessStatus({
    vercel: process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    origin: request.headers.get('origin'),
  })
  if (accessStatus === 404) {
    return jsonNoStore({ error: 'Rota não encontrada.' }, { status: 404 })
  }
  if (accessStatus === 503) {
    return jsonNoStore({ error: 'Operação indisponível.' }, { status: 503 })
  }
  if (accessStatus === 403) {
    return jsonNoStore({ error: 'Origem não permitida.' }, { status: 403 })
  }

  let operationId: string | null = null
  let authChanged = false
  const correlationId = safeCorrelationId(request)

  try {
    const body = await readStrictJson<{ password?: unknown }>(request, ['password'])
    const bootstrapPassword = typeof body.password === 'string' ? body.password : ''
    const passwordError = validatePassword(bootstrapPassword)
    if (passwordError) return jsonNoStore({ error: passwordError }, { status: 400 })

    const [stateResult, profilesResult] = await Promise.all([
      supabaseAdmin.rpc('get_private_auth_state', { p_user_id: HOMOLOG_ADMIN_UID }),
      supabaseAdmin
        .from('perfis')
        .select('empresa_id, status')
        .eq('user_id', HOMOLOG_ADMIN_UID)
        .limit(2),
    ])
    if (stateResult.error || stateResult.data?.length !== 1) throw new Error('auth_state_lookup_failed')
    if (profilesResult.error || profilesResult.data?.length !== 1 || profilesResult.data[0].status !== 'ativo') {
      throw new Error('admin_profile_lookup_failed')
    }

    const state = stateResult.data[0]
    const versions = initialHomologAdminBootstrapVersions(state)
    if (!versions) throw new Error('admin_auth_state_mismatch')
    const { credentialVersion, stateVersion, nextCredentialVersion } = versions

    const empresaId = profilesResult.data[0].empresa_id
    const limited = await consumeSensitiveLimit(request, {
      operation: 'admin_reset_password',
      empresaId,
      actorUserId: HOMOLOG_ADMIN_UID,
      targetUserId: HOMOLOG_ADMIN_UID,
    }, postgresRateLimitStore(supabaseAdmin))
    if (!limited.allowed) {
      return jsonNoStore({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, {
        status: 429,
        headers: { 'Retry-After': String(limited.retryAfter) },
      })
    }

    const fingerprint = nonSensitiveFingerprint({
      target_user_id: HOMOLOG_ADMIN_UID,
      username: HOMOLOG_ADMIN_USERNAME,
    })
    const digest = idempotencyDigest(request, {
      operation: 'admin_reset_password',
      empresaId,
      actorUserId: HOMOLOG_ADMIN_UID,
      targetUserId: HOMOLOG_ADMIN_UID,
    })
    const begun = await supabaseAdmin.rpc('begin_identity_operation', {
      p_operation_type: 'admin_reset_password',
      p_empresa_id: empresaId,
      p_idempotency_digest: digest,
      p_request_fingerprint: fingerprint,
      p_actor_user_id: HOMOLOG_ADMIN_UID,
      p_target_user_id: HOMOLOG_ADMIN_UID,
      p_username: null,
    })
    if (begun.error || begun.data?.length !== 1) throw new Error('identity_operation_begin_failed')
    const operation = begun.data[0]
    operationId = operation.operation_id
    const decision = identityOperationDecision(operation)
    if (decision.kind === 'replay') {
      return jsonNoStore({ success: true, requires_password_change: true })
    }
    if (decision.kind === 'conflict') throw new Error('identity_operation_conflict')

    const authUser = await supabaseAdmin.auth.admin.getUserById(HOMOLOG_ADMIN_UID)
    if (authUser.error || authUser.data.user?.id !== HOMOLOG_ADMIN_UID) {
      throw new Error('auth_user_lookup_failed')
    }
    const rawAuthCredentialVersion = authUser.data.user.app_metadata?.credential_version
    if (
      rawAuthCredentialVersion !== undefined
      && (
        typeof rawAuthCredentialVersion !== 'number'
        || rawAuthCredentialVersion !== credentialVersion
      )
    ) throw new Error('auth_credential_version_mismatch')

    const changed = await supabaseAdmin.auth.admin.updateUserById(HOMOLOG_ADMIN_UID, {
      password: bootstrapPassword,
      app_metadata: {
        ...authUser.data.user.app_metadata,
        credential_version: nextCredentialVersion,
      },
    })
    if (changed.error) throw new Error('auth_password_update_failed')
    authChanged = true

    const completed = await supabaseAdmin.rpc('upsert_private_auth_state', {
      p_operation_id: operationId,
      p_user_id: HOMOLOG_ADMIN_UID,
      p_username: null,
      p_must_change_password: true,
      p_expected_state_version: stateVersion,
      p_correlation_id: correlationId,
    })
    if (
      completed.error
      || completed.data?.length !== 1
      || Number(completed.data[0].credential_version) !== nextCredentialVersion
    ) throw new Error('private_auth_state_update_failed')

    return jsonNoStore({ success: true, requires_password_change: true })
  } catch (error) {
    if (operationId) {
      try {
        await finishIdentityFailure(supabaseAdmin, {
          operationId,
          status: authChanged ? 'compensation_required' : 'failed',
          failureCode: error instanceof Error ? error.message : 'unknown_failure',
          correlationId,
        })
      } catch { /* fail closed */ }
    }
    if (error instanceof RequestValidationError) {
      return jsonNoStore({ error: error.message }, { status: error.status })
    }
    return jsonNoStore({ error: 'Não foi possível definir a senha.' }, { status: 500 })
  }
}
