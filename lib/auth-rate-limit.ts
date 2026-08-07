import type { SupabaseClient } from '@supabase/supabase-js'

import { keyedDigest, trustedClientIp } from './auth-http.ts'

export type RateLimitDecision = { allowed: boolean; retryAfter: number }
export type RateLimitStore = {
  consume(digest: string, windowSeconds: number, limit: number): Promise<RateLimitDecision>
}

export const SENSITIVE_RATE_LIMITS = {
  change_password: { windowSeconds: 300, limit: 5 },
  admin_reset_password: { windowSeconds: 300, limit: 10 },
  create_user: { windowSeconds: 600, limit: 20 },
  create_tenant_admin: { windowSeconds: 3_600, limit: 5 },
  logout_global: { windowSeconds: 60, limit: 10 },
} as const

export function postgresRateLimitStore(client: SupabaseClient): RateLimitStore {
  return {
    async consume(digest, windowSeconds, limit) {
      const { data, error } = await client.rpc('consume_auth_rate_limit', {
        p_key_digest: digest,
        p_window_seconds: windowSeconds,
        p_limit: limit,
      })
      if (error || data?.length !== 1) {
        // Storage uncertainty must deny the protected operation.
        return { allowed: false, retryAfter: windowSeconds }
      }
      return {
        allowed: Boolean(data[0].allowed),
        retryAfter: Math.max(0, Number(data[0].retry_after) || 0),
      }
    },
  }
}

async function consumeAll(store: RateLimitStore, digests: string[], windowSeconds: number, limit: number) {
  let retryAfter = 0
  for (const digest of digests) {
    const result = await store.consume(digest, windowSeconds, limit)
    if (!result.allowed) retryAfter = Math.max(retryAfter, result.retryAfter)
  }
  return { allowed: retryAfter === 0, retryAfter }
}

export async function consumeLoginLimits(request: Request, username: string, store: RateLimitStore) {
  const ip = trustedClientIp(request)
  return consumeAll(store, [
    keyedDigest('login:ip', ip),
    keyedDigest('login:username', username),
    keyedDigest('login:ip_username', `${ip}\0${username}`),
  ], 60, 8)
}

export async function consumeSensitiveLimit(
  request: Request,
  input: {
    operation: keyof typeof SENSITIVE_RATE_LIMITS
    empresaId: string
    actorUserId: string
    targetUserId?: string
  },
  store: RateLimitStore,
) {
  const policy = SENSITIVE_RATE_LIMITS[input.operation]
  const ip = trustedClientIp(request)
  const scope = [input.operation, input.empresaId, input.actorUserId, input.targetUserId ?? '-'].join('\0')
  return consumeAll(store, [
    keyedDigest('sensitive:actor', scope),
    keyedDigest('sensitive:ip', `${input.operation}\0${ip}`),
  ], policy.windowSeconds, policy.limit)
}
