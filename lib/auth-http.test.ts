import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertAllowedOrigin,
  assertUsernameRolloutEnabled,
  CONSERVATIVE_IP_BUCKET,
  idempotencyDigest,
  parseAllowedOrigins,
  readStrictJson,
  RolloutDisabledError,
  trustedClientIp,
} from './auth-http.ts'

test('rollout is enabled only by the literal true', () => {
  const previous = process.env.AUTH_USERNAME_ROLLOUT_ENABLED
  for (const value of ['', 'TRUE', '1', 'false']) {
    process.env.AUTH_USERNAME_ROLLOUT_ENABLED = value
    assert.throws(assertUsernameRolloutEnabled, RolloutDisabledError)
  }
  process.env.AUTH_USERNAME_ROLLOUT_ENABLED = 'true'
  assert.doesNotThrow(assertUsernameRolloutEnabled)
  if (previous === undefined) delete process.env.AUTH_USERNAME_ROLLOUT_ENABLED
  else process.env.AUTH_USERNAME_ROLLOUT_ENABLED = previous
})

test('allowed origins are canonical, exact URLs without wildcards', () => {
  assert.deepEqual([...parseAllowedOrigins('https://app.test,http://localhost:3000')], [
    'https://app.test',
    'http://localhost:3000',
  ])
  for (const invalid of [
    '',
    '*.test',
    'https://*.test',
    'ftp://app.test',
    'https://app.test/path',
    'https://app.test?query=1',
  ]) assert.throws(() => parseAllowedOrigins(invalid))
})

test('origin authorization rejects lookalike and missing origins', () => {
  const previous = process.env.APP_ALLOWED_ORIGINS
  const previousRootDomain = process.env.APP_ROOT_DOMAIN
  process.env.APP_ALLOWED_ORIGINS = 'https://app.test,https://hml.test'
  process.env.APP_ROOT_DOMAIN = 'exataerp.com'
  assert.doesNotThrow(() => assertAllowedOrigin(new Request('https://app.test', {
    headers: { origin: 'https://app.test' },
  })))
  assert.throws(() => assertAllowedOrigin(new Request('https://app.test', {
    headers: { origin: 'https://app.test.evil' },
  })))
  assert.throws(() => assertAllowedOrigin(new Request('https://app.test')))
  assert.doesNotThrow(() => assertAllowedOrigin(new Request('https://mairo.exataerp.com', {
    headers: { origin: 'https://mairo.exataerp.com' },
  })))
  for (const disallowedOrigin of [
    'http://mairo.exataerp.com',
    'https://nested.mairo.exataerp.com',
    'https://mairo.exataerp.com.evil',
  ]) {
    assert.throws(() => assertAllowedOrigin(new Request('https://app.test', {
      headers: { origin: disallowedOrigin },
    })))
  }
  if (previous === undefined) delete process.env.APP_ALLOWED_ORIGINS
  else process.env.APP_ALLOWED_ORIGINS = previous
  if (previousRootDomain === undefined) delete process.env.APP_ROOT_DOMAIN
  else process.env.APP_ROOT_DOMAIN = previousRootDomain
})

test('strict JSON rejects unexpected fields, media types and oversized payloads', async () => {
  const valid = new Request('https://app.test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'ana' }),
  })
  assert.deepEqual(await readStrictJson(valid, ['username']), { username: 'ana' })

  await assert.rejects(readStrictJson(new Request('https://app.test', {
    method: 'POST',
    body: '{}',
  }), []))
  await assert.rejects(readStrictJson(new Request('https://app.test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ unexpected: true }),
  }), []))
})

test('forwarded IP is trusted only on Vercel and invalid values use one conservative bucket', () => {
  const request = new Request('https://app.test', {
    headers: { 'x-vercel-forwarded-for': '192.0.2.1, 198.51.100.2' },
  })
  const previous = process.env.VERCEL
  delete process.env.VERCEL
  assert.equal(trustedClientIp(request), CONSERVATIVE_IP_BUCKET)
  process.env.VERCEL = '1'
  assert.equal(trustedClientIp(request), '192.0.2.1')
  assert.equal(trustedClientIp(new Request('https://app.test', {
    headers: { 'x-vercel-forwarded-for': 'attacker-controlled' },
  })), CONSERVATIVE_IP_BUCKET)
  if (previous === undefined) delete process.env.VERCEL
  else process.env.VERCEL = previous
})

test('idempotency digest is scoped by key, tenant, actor and target', () => {
  const request = (key = 'same-key') => new Request('https://app.test', {
    headers: { 'idempotency-key': key },
  })
  const base = { operation: 'create_user', empresaId: 'tenant-a', actorUserId: 'actor-a' }
  const digest = idempotencyDigest(request(), base)
  assert.equal(digest, idempotencyDigest(request(), base))
  assert.notEqual(digest, idempotencyDigest(request(), { ...base, empresaId: 'tenant-b' }))
  assert.notEqual(digest, idempotencyDigest(request(), { ...base, actorUserId: 'actor-b' }))
  assert.notEqual(digest, idempotencyDigest(request(), { ...base, targetUserId: 'target' }))
  assert.notEqual(digest, idempotencyDigest(request('another-key'), base))
})
