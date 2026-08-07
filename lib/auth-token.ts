export function credentialVersionFromAccessToken(token: string): number | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      app_metadata?: { credential_version?: unknown }
    }
    const rawVersion = payload.app_metadata?.credential_version
    if (typeof rawVersion !== 'number') return null
    const version = rawVersion
    return Number.isSafeInteger(version) && version > 0 ? version : null
  } catch {
    return null
  }
}
