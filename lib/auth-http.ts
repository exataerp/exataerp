import { createHash, createHmac, randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server.js'

export const AUTH_RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
} as const

export const CONSERVATIVE_IP_BUCKET = 'untrusted-network'

export class RequestValidationError extends Error {
  readonly status: number

  constructor(
    status = 400,
    message = 'Requisição inválida.',
  ) {
    super(message)
    this.status = status
  }
}

export class RolloutDisabledError extends Error {}

export function jsonNoStore(
  body: unknown,
  init: { status?: number; headers?: HeadersInit } = {},
) {
  const headers = new Headers(init.headers)
  Object.entries(AUTH_RESPONSE_HEADERS).forEach(([name, value]) => headers.set(name, value))
  return NextResponse.json(body, { ...init, headers })
}

export function assertUsernameRolloutEnabled() {
  if (process.env.AUTH_USERNAME_ROLLOUT_ENABLED !== 'true') {
    // Deliberately contains no request-controlled or credential data.
    console.error('[auth] rollout de username não habilitado')
    throw new RolloutDisabledError()
  }
}

export function parseAllowedOrigins(configured = process.env.APP_ALLOWED_ORIGINS): Set<string> {
  if (!configured) throw new Error('APP_ALLOWED_ORIGINS ausente')

  const origins = new Set<string>()
  for (const entry of configured.split(',')) {
    const candidate = entry.trim()
    if (!candidate || candidate.includes('*')) throw new Error('APP_ALLOWED_ORIGINS inválido')

    let url: URL
    try {
      url = new URL(candidate)
    } catch {
      throw new Error('APP_ALLOWED_ORIGINS inválido')
    }
    if (
      !['http:', 'https:'].includes(url.protocol)
      || url.origin !== candidate
      || url.pathname !== '/'
      || url.search
      || url.hash
      || url.username
      || url.password
    ) throw new Error('APP_ALLOWED_ORIGINS inválido')
    origins.add(url.origin)
  }
  if (origins.size === 0) throw new Error('APP_ALLOWED_ORIGINS ausente')
  return origins
}

export function assertAllowedOrigin(request: Request) {
  const raw = request.headers.get('origin')
  if (!raw) throw new RequestValidationError(403)

  let origin: string
  try {
    const parsed = new URL(raw)
    origin = parsed.origin
    if (origin !== raw || parsed.pathname !== '/') throw new Error('origin não canônico')
  } catch {
    throw new RequestValidationError(403)
  }

  let allowed: Set<string>
  try {
    allowed = parseAllowedOrigins()
  } catch {
    throw new RequestValidationError(503, 'Operação indisponível.')
  }
  if (!allowed.has(origin)) throw new RequestValidationError(403)
}

export async function readStrictJson<T extends Record<string, unknown>>(
  request: Request,
  keys: readonly string[],
  maximumBytes = 2_048,
): Promise<T> {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
    throw new RequestValidationError(415)
  }
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RequestValidationError(413)
  }
  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > maximumBytes) throw new RequestValidationError(413)

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new RequestValidationError()
  }
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))
  ) throw new RequestValidationError()
  return value as T
}

function isIpAddress(value: string): boolean {
  // Avoid accepting arbitrary forwarding strings. PostgreSQL only receives a digest.
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)
    ? value.split('.').every((part) => Number(part) <= 255)
    : /^[0-9a-f:]{2,45}$/i.test(value) && value.includes(':')
}

export function trustedClientIp(request: Request): string {
  if (process.env.VERCEL !== '1') return CONSERVATIVE_IP_BUCKET
  const first = request.headers.get('x-vercel-forwarded-for')?.split(',', 1)[0]?.trim()
  return first && isIpAddress(first) ? first : CONSERVATIVE_IP_BUCKET
}

export function keyedDigest(scope: string, value: string, secret = process.env.AUTH_RATE_LIMIT_SECRET) {
  if (!secret || secret.length < 32) throw new Error('Segredo de rate limit ausente ou inválido')
  return createHmac('sha256', secret).update(`${scope}\0${value}`).digest('hex')
}

export function idempotencyDigest(
  request: Request,
  scope: {
    operation: string
    empresaId: string
    actorUserId: string
    targetUserId?: string | null
  },
  fingerprint: string,
) {
  const key = request.headers.get('idempotency-key')?.trim()
  if (!key || key.length > 200) {
    throw new RequestValidationError(400, 'Idempotency-Key é obrigatório.')
  }
  return createHash('sha256')
    .update([
      scope.operation,
      scope.empresaId,
      scope.actorUserId,
      scope.targetUserId ?? '-',
      key,
      fingerprint,
    ].join('\0'))
    .digest('hex')
}

export function safeCorrelationId(request: Request) {
  const supplied = request.headers.get('x-request-id')
  return supplied && /^[A-Za-z0-9._:-]{1,200}$/.test(supplied) ? supplied : randomUUID()
}
