import assert from 'node:assert/strict'
import test from 'node:test'

import { consumeLoginLimits, consumeSensitiveLimit, type RateLimitStore } from './auth-rate-limit.ts'

const SYNTHETIC_SECRET = 'synthetic-test-secret-that-is-not-real'

test('login stores three opaque digests and fails closed if any bucket blocks', async () => {
  const previous = process.env.AUTH_RATE_LIMIT_SECRET
  process.env.AUTH_RATE_LIMIT_SECRET = SYNTHETIC_SECRET
  const seen: string[] = []
  const store: RateLimitStore = {
    async consume(digest) {
      seen.push(digest)
      return { allowed: seen.length !== 2, retryAfter: seen.length === 2 ? 17 : 0 }
    },
  }
  const decision = await consumeLoginLimits(new Request('https://app.test'), 'usuario', store)
  assert.deepEqual(decision, { allowed: false, retryAfter: 17 })
  assert.equal(seen.length, 3)
  assert.ok(seen.every((value) => /^[a-f0-9]{64}$/.test(value)))
  assert.ok(seen.every((value) => !value.includes('usuario')))
  if (previous === undefined) delete process.env.AUTH_RATE_LIMIT_SECRET
  else process.env.AUTH_RATE_LIMIT_SECRET = previous
})

test('sensitive buckets are isolated by operation, tenant, actor and target', async () => {
  const previous = process.env.AUTH_RATE_LIMIT_SECRET
  process.env.AUTH_RATE_LIMIT_SECRET = SYNTHETIC_SECRET
  const collected: string[][] = []
  const run = async (empresaId: string, targetUserId: string) => {
    const current: string[] = []
    const store: RateLimitStore = {
      async consume(digest) {
        current.push(digest)
        return { allowed: true, retryAfter: 0 }
      },
    }
    await consumeSensitiveLimit(new Request('https://app.test'), {
      operation: 'admin_reset_password',
      empresaId,
      actorUserId: 'actor',
      targetUserId,
    }, store)
    collected.push(current)
  }
  await run('tenant-a', 'target-a')
  await run('tenant-b', 'target-a')
  await run('tenant-a', 'target-b')
  assert.notDeepEqual(collected[0], collected[1])
  assert.notDeepEqual(collected[0], collected[2])
  if (previous === undefined) delete process.env.AUTH_RATE_LIMIT_SECRET
  else process.env.AUTH_RATE_LIMIT_SECRET = previous
})
