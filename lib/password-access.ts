export const REQUIRED_PASSWORD_CHANGE_PATH = '/primeiro-acesso'
export const REQUIRED_PASSWORD_CHANGE_API_PATH = '/api/auth/change-password'

export function isRequiredPasswordChangePath(pathname: string) {
  return pathname === REQUIRED_PASSWORD_CHANGE_PATH
    || pathname === REQUIRED_PASSWORD_CHANGE_API_PATH
}
