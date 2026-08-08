export const HOMOLOG_ORIGIN = 'https://homologacao.exataerp.com'
export const HOMOLOG_SUPABASE_URL = 'https://rtiqkivyqgkhinfpcusd.supabase.co'
export const HOMOLOG_ADMIN_UID = '7e22ded1-7712-4b3c-acc8-222aed508b57'
export const HOMOLOG_ADMIN_USERNAME = 'admin'

type BootstrapAccess = {
  vercel: string | undefined
  vercelEnv: string | undefined
  supabaseUrl: string | undefined
  origin: string | null
}

export function homologBootstrapAccessStatus(access: BootstrapAccess): 404 | 403 | 503 | null {
  if (access.vercel !== '1' || access.vercelEnv !== 'preview') return 404
  if (access.supabaseUrl !== HOMOLOG_SUPABASE_URL) return 503
  if (access.origin !== HOMOLOG_ORIGIN) return 403
  return null
}

type BootstrapState = {
  username?: unknown
  credential_version?: unknown
  state_version?: unknown
  must_change_password?: unknown
}

export function initialHomologAdminBootstrapVersions(state: BootstrapState): {
  credentialVersion: 1
  stateVersion: number
  nextCredentialVersion: 2
} | null {
  const credentialVersion = Number(state.credential_version)
  const stateVersion = Number(state.state_version)
  if (
    state.username !== HOMOLOG_ADMIN_USERNAME
    || credentialVersion !== 1
    || !Number.isSafeInteger(stateVersion)
    || stateVersion <= 0
  ) return null

  return { credentialVersion: 1, stateVersion, nextCredentialVersion: 2 }
}
