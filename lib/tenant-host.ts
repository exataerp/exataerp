export const TENANT_SLUG_HEADER = 'x-exata-tenant-slug'

export const RESERVED_TENANT_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'homologacao',
  'www',
])

const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function hostnameWithoutPort(value: string): string {
  const candidate = value.trim().toLowerCase().replace(/\.$/, '')
  if (!candidate) return ''

  try {
    return new URL(`http://${candidate}`).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return ''
  }
}

export function normalizeTenantSlug(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function validateTenantSlug(value: string): string | null {
  if (!TENANT_SLUG_PATTERN.test(value) || value.length < 2) {
    return 'O subdomínio deve ter de 2 a 63 caracteres, usando apenas letras minúsculas, números e hífen.'
  }
  if (RESERVED_TENANT_SLUGS.has(value)) return 'Este subdomínio é reservado.'
  return null
}

export function suggestTenantSlug(companyName: string): string {
  const normalized = companyName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return normalized.split(/\s+/, 1)[0]?.slice(0, 63) ?? ''
}

export function tenantSlugFromHostname(
  hostname: string,
  configuredRootDomain = process.env.APP_ROOT_DOMAIN,
): string | null {
  const host = hostnameWithoutPort(hostname)
  const rootDomain = hostnameWithoutPort(configuredRootDomain ?? '')
  if (!host || !rootDomain || host === rootDomain || host === `www.${rootDomain}`) return null

  const suffix = `.${rootDomain}`
  if (!host.endsWith(suffix)) return null

  const slug = host.slice(0, -suffix.length)
  return validateTenantSlug(slug) === null ? slug : null
}

export function withTrustedTenantHeader(headers: Headers, tenantSlug: string | null): Headers {
  const trusted = new Headers(headers)
  trusted.delete(TENANT_SLUG_HEADER)
  if (tenantSlug) trusted.set(TENANT_SLUG_HEADER, tenantSlug)
  return trusted
}

export function tenantSlugFromRequest(request: Request): string | null {
  const value = normalizeTenantSlug(request.headers.get(TENANT_SLUG_HEADER))
  return validateTenantSlug(value) === null ? value : null
}

export function requestMatchesCompanyTenant(request: Request, companySubdomain: unknown): boolean {
  const requestedTenant = tenantSlugFromRequest(request)
  if (!requestedTenant) return true
  return normalizeTenantSlug(companySubdomain) === requestedTenant
}
