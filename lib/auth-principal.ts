import type { User } from '@supabase/supabase-js'

import { assertUsernameRolloutEnabled } from '@/lib/auth-http'
import { credentialVersionFromAccessToken } from '@/lib/auth-token'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { AuthError, supabaseAdmin } from '@/lib/supabase/admin'
import { requestMatchesCompanyTenant } from '@/lib/tenant-host'

export type CurrentPrincipal = {
  user: User
  userId: string
  profileId: string
  empresaId: string
  roles: string[]
  username: string
  profileStatus: 'ativo'
  companyStatus: 'ativo'
  accessStatus: 'ativo'
  mustChangePassword: boolean
  credentialVersion: number
  stateVersion: number
  isSuperAdmin: boolean
}

async function verifiedUser(request: Request): Promise<{ user: User; credentialVersion: number }> {
  const authorization = request.headers.get('authorization')
  if (authorization) {
    if (!authorization.startsWith('Bearer ') || authorization.length <= 7) {
      throw new AuthError('Sessão inválida.', 401)
    }
    const { data, error } = await supabaseAdmin.auth.getUser(authorization.slice(7))
    if (error || !data.user) throw new AuthError('Sessão inválida.', 401)
    const credentialVersion = credentialVersionFromAccessToken(authorization.slice(7))
    if (credentialVersion === null) throw new AuthError('Sessão inválida.', 401)
    return { user: data.user, credentialVersion }
  }

  const sessionClient = await createSessionClient()
  const { data, error } = await sessionClient.auth.getUser()
  if (error || !data.user) throw new AuthError('Sessão inválida.', 401)
  // getUser above verifies the session with Auth before getSession is used only
  // to read the signed access token and its credential-version claim.
  const session = await sessionClient.auth.getSession()
  const credentialVersion = session.data.session
    ? credentialVersionFromAccessToken(session.data.session.access_token)
    : null
  if (session.error || credentialVersion === null) throw new AuthError('Sessão inválida.', 401)
  return { user: data.user, credentialVersion }
}

export async function requireCurrentPrincipal(
  request: Request,
  options: { allowPasswordChange?: boolean } = {},
): Promise<CurrentPrincipal> {
  assertUsernameRolloutEnabled()
  const verified = await verifiedUser(request)
  const user = verified.user

  const { data: profiles, error: profileError } = await supabaseAdmin
    .from('perfis')
    .select('id, empresa_id, status')
    .eq('user_id', user.id)
    .limit(2)

  // Phase 1.1 has a global username and therefore requires exactly one tenant.
  if (profileError || profiles?.length !== 1) throw new AuthError('Acesso negado.', 403)
  const profile = profiles[0]
  if (profile.status !== 'ativo' || !profile.empresa_id) throw new AuthError('Acesso negado.', 403)

  const [companyResult, accessResult, rolesResult, stateResult, superAdminResult] = await Promise.all([
    supabaseAdmin.from('empresas').select('status, subdomain').eq('id', profile.empresa_id).maybeSingle(),
    supabaseAdmin
      .from('controle_acesso')
      .select('status')
      .eq('user_id', user.id)
      .eq('empresa_id', profile.empresa_id)
      .maybeSingle(),
    supabaseAdmin
      .from('v_user_roles')
      .select('role_name')
      .eq('user_id', user.id)
      .eq('empresa_id', profile.empresa_id),
    supabaseAdmin.rpc('get_private_auth_state', { p_user_id: user.id }),
    supabaseAdmin.from('super_admins').select('user_id').eq('user_id', user.id).maybeSingle(),
  ])

  const state = stateResult.data?.[0]
  if (
    companyResult.error
    || companyResult.data?.status !== 'ativo'
    || !requestMatchesCompanyTenant(request, companyResult.data.subdomain)
    || accessResult.error
    || accessResult.data?.status !== 'ativo'
    || rolesResult.error
    || stateResult.error
    || superAdminResult.error
    || stateResult.data?.length !== 1
    || !state
    || typeof state.username !== 'string'
  ) throw new AuthError('Acesso negado.', 403)

  const credentialVersion = Number(state.credential_version)
  if (
    credentialVersion !== verified.credentialVersion
    || Number(user.app_metadata?.credential_version) !== verified.credentialVersion
  ) throw new AuthError('Sessão inválida.', 401)

  if (state.must_change_password && !options.allowPasswordChange) {
    throw new AuthError('Troca de senha obrigatória.', 403)
  }

  return {
    user,
    userId: user.id,
    profileId: profile.id,
    empresaId: profile.empresa_id,
    roles: rolesResult.data.map(({ role_name }) => role_name),
    username: state.username,
    profileStatus: 'ativo',
    companyStatus: 'ativo',
    accessStatus: 'ativo',
    mustChangePassword: Boolean(state.must_change_password),
    credentialVersion,
    stateVersion: Number(state.state_version),
    isSuperAdmin: Boolean(superAdminResult.data),
  }
}

export function requireSystemManager(principal: CurrentPrincipal) {
  if (!principal.roles.includes('system_manager')) throw new AuthError('Acesso negado.', 403)
}

export function requireSuperAdmin(principal: CurrentPrincipal) {
  if (!principal.isSuperAdmin) throw new AuthError('Acesso negado.', 403)
}
