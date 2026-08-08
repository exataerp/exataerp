import { INVALID_CREDENTIALS_MESSAGE, normalizeUsername, validateUsername } from '@/lib/auth-credentials'
import { assertAllowedOrigin, assertUsernameRolloutEnabled, jsonNoStore, readStrictJson, RequestValidationError, RolloutDisabledError } from '@/lib/auth-http'
import { consumeLoginLimits, postgresRateLimitStore } from '@/lib/auth-rate-limit'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const invalidCredentials = () => jsonNoStore({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 })

export async function POST(request: Request) {
  try {
    assertUsernameRolloutEnabled()
    assertAllowedOrigin(request)
    const body = await readStrictJson<{ username?: unknown; password?: unknown }>(request, ['username', 'password'])
    const username = normalizeUsername(body.username)
    const password = typeof body.password === 'string' ? body.password : ''
    if (validateUsername(username) || !password || password.length > 128) return invalidCredentials()

    const limit = await consumeLoginLimits(request, username, postgresRateLimitStore(supabaseAdmin))
    if (!limit.allowed) {
      return jsonNoStore({ error: INVALID_CREDENTIALS_MESSAGE }, {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfter) },
      })
    }

    const state = await supabaseAdmin.rpc('resolve_login_username', { p_username: username })
    if (state.error || state.data?.length !== 1) return invalidCredentials()
    const authState = state.data[0]
    const profiles = await supabaseAdmin.from('perfis').select('empresa_id, status').eq('user_id', authState.user_id).limit(2)
    if (profiles.error || profiles.data?.length !== 1 || profiles.data[0].status !== 'ativo') return invalidCredentials()
    const profile = profiles.data[0]
    const [company, access, auth] = await Promise.all([
      supabaseAdmin.from('empresas').select('status').eq('id', profile.empresa_id).maybeSingle(),
      supabaseAdmin.from('controle_acesso').select('status').eq('user_id', authState.user_id).eq('empresa_id', profile.empresa_id).maybeSingle(),
      supabaseAdmin.auth.admin.getUserById(authState.user_id),
    ])
    if (company.error || company.data?.status !== 'ativo' || access.error || access.data?.status !== 'ativo'
      || auth.error || !auth.data.user?.email) return invalidCredentials()

    const credentialVersion = Number(authState.credential_version)
    const rawAuthCredentialVersion = auth.data.user.app_metadata?.credential_version
    const authCredentialVersion = typeof rawAuthCredentialVersion === 'number'
      ? rawAuthCredentialVersion
      : Number.NaN
    if (!Number.isSafeInteger(credentialVersion) || credentialVersion <= 0) return invalidCredentials()
    if (!Number.isSafeInteger(authCredentialVersion) || authCredentialVersion <= 0) {
      const initialized = await supabaseAdmin.auth.admin.updateUserById(authState.user_id, {
        app_metadata: { ...auth.data.user.app_metadata, credential_version: credentialVersion },
      })
      if (initialized.error) return invalidCredentials()
    } else if (authCredentialVersion !== credentialVersion) {
      return invalidCredentials()
    }

    const sessionClient = await createClient()
    const signedIn = await sessionClient.auth.signInWithPassword({ email: auth.data.user.email, password })
    if (signedIn.error || !signedIn.data.session || signedIn.data.user.id !== authState.user_id) {
      await sessionClient.auth.signOut({ scope: 'local' })
      return invalidCredentials()
    }
    // Re-check membership after GoTrue creates the session; no partially valid wrong-tenant session survives.
    const recheck = await supabaseAdmin.from('controle_acesso').select('status').eq('user_id', signedIn.data.user.id)
      .eq('empresa_id', profile.empresa_id).maybeSingle()
    if (recheck.error || recheck.data?.status !== 'ativo') {
      await sessionClient.auth.signOut({ scope: 'local' })
      return invalidCredentials()
    }
    return jsonNoStore({ success: true, requires_password_change: Boolean(authState.must_change_password) })
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonNoStore({ error: 'Requisição inválida.' }, { status: error.status })
    if (error instanceof RolloutDisabledError) return jsonNoStore({ error: 'Autenticação indisponível.' }, { status: 503 })
    return jsonNoStore({ error: 'Não foi possível entrar agora.' }, { status: 500 })
  }
}
