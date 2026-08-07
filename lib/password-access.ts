export const REQUIRED_PASSWORD_CHANGE_PATH = '/primeiro-acesso'
export const REQUIRED_PASSWORD_CHANGE_API_PATH = '/api/auth/change-password'
export const REQUIRED_PASSWORD_CHANGE_SESSION_PATH = '/api/auth/session'
export const REQUIRED_PASSWORD_CHANGE_LOGOUT_PATH = '/api/auth/logout'

export function isRequiredPasswordChangePath(pathname: string) {
  return pathname === REQUIRED_PASSWORD_CHANGE_PATH
    || pathname === REQUIRED_PASSWORD_CHANGE_API_PATH
    || pathname === REQUIRED_PASSWORD_CHANGE_SESSION_PATH
    || pathname === REQUIRED_PASSWORD_CHANGE_LOGOUT_PATH
}
