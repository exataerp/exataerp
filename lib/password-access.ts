export const REQUIRED_PASSWORD_CHANGE_PATH = '/primeiro-acesso'
export const REQUIRED_PASSWORD_CHANGE_API_PATH = '/api/auth/change-password'
export const REQUIRED_PASSWORD_CHANGE_SESSION_PATH = '/api/auth/session'
export const REQUIRED_PASSWORD_CHANGE_LOGOUT_PATH = '/api/auth/logout'

const PUBLIC_AUTH_API_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/me',
  REQUIRED_PASSWORD_CHANGE_API_PATH,
  REQUIRED_PASSWORD_CHANGE_SESSION_PATH,
  REQUIRED_PASSWORD_CHANGE_LOGOUT_PATH,
])

export function isPublicAuthApiPath(pathname: string) {
  return PUBLIC_AUTH_API_PATHS.has(pathname)
}

export function isRequiredPasswordChangePath(pathname: string) {
  return pathname === REQUIRED_PASSWORD_CHANGE_PATH
    || pathname === REQUIRED_PASSWORD_CHANGE_API_PATH
    || pathname === REQUIRED_PASSWORD_CHANGE_SESSION_PATH
    || pathname === REQUIRED_PASSWORD_CHANGE_LOGOUT_PATH
}
