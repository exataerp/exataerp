export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 40
export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 128
export const INVALID_CREDENTIALS_MESSAGE = 'Nome de usuário ou senha incorretos.'

export const PASSWORD_REQUIREMENTS = [
  { id: 'length', label: 'De 10 a 128 caracteres', test: (value: string) => value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH },
  { id: 'uppercase', label: 'Uma letra maiúscula', test: (value: string) => /[A-Z]/.test(value) },
  { id: 'lowercase', label: 'Uma letra minúscula', test: (value: string) => /[a-z]/.test(value) },
  { id: 'number', label: 'Um número', test: (value: string) => /\d/.test(value) },
  { id: 'special', label: 'Um caractere especial', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
] as const

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeUsername(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

export function validateUsername(value: unknown): string | null {
  const username = normalizeUsername(value)
  if (!username) return 'Nome de usuário é obrigatório.'
  if (!USERNAME_PATTERN.test(username)) {
    return 'Use de 3 a 40 caracteres: letras sem acento, números, ponto, hífen ou sublinhado.'
  }
  return null
}

export function validatePassword(value: unknown): string | null {
  const password = String(value ?? '')
  if (!password) return 'Senha é obrigatória.'
  if (!PASSWORD_REQUIREMENTS.every((requirement) => requirement.test(password))) {
    return 'A senha deve ter de 10 a 128 caracteres, com maiúscula, minúscula, número e caractere especial.'
  }
  return null
}

export type PasswordChangeErrors = {
  currentPassword?: string
  newPassword?: string
  confirmation?: string
}

export function validatePasswordChange(
  currentPassword: unknown,
  newPassword: unknown,
  confirmation: unknown,
): PasswordChangeErrors {
  const current = String(currentPassword ?? '')
  const next = String(newPassword ?? '')
  const repeated = String(confirmation ?? '')
  const errors: PasswordChangeErrors = {}

  if (!current) errors.currentPassword = 'Informe a senha atual.'

  const passwordError = validatePassword(next)
  if (passwordError) errors.newPassword = passwordError
  else if (current && current === next) errors.newPassword = 'A nova senha deve ser diferente da senha atual.'

  if (!repeated) errors.confirmation = 'Confirme a nova senha.'
  else if (next !== repeated) errors.confirmation = 'As senhas informadas não são iguais.'

  return errors
}

export function normalizeOptionalEmail(value: unknown): string | null {
  const email = String(value ?? '').trim().toLowerCase()
  return email || null
}

export function validateOptionalEmail(value: unknown): string | null {
  const email = normalizeOptionalEmail(value)
  if (email && !EMAIL_PATTERN.test(email)) return 'Informe um e-mail válido ou deixe o campo vazio.'
  return null
}

export function buildInternalAuthEmail(seed: string): string {
  const safeSeed = seed.trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(safeSeed)) throw new Error('Identificador técnico inválido.')
  return `${safeSeed}@auth.exata.invalid`
}
