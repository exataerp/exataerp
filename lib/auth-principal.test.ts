import assert from 'node:assert/strict'
import test from 'node:test'

import { credentialVersionFromAccessToken } from './auth-token.ts'

function unsignedToken(payload: Record<string, unknown>) {
  const encode = (value: Record<string, unknown>) => Buffer
    .from(JSON.stringify(value))
    .toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`
}

test('credential version is read only from a valid positive integer claim', () => {
  assert.equal(credentialVersionFromAccessToken(unsignedToken({
    app_metadata: { credential_version: 3 },
  })), 3)
  assert.equal(credentialVersionFromAccessToken(unsignedToken({
    app_metadata: { credential_version: 0 },
  })), null)
  assert.equal(credentialVersionFromAccessToken(unsignedToken({
    app_metadata: { credential_version: 'not-a-number' },
  })), null)
  assert.equal(credentialVersionFromAccessToken(unsignedToken({
    app_metadata: { credential_version: '3' },
  })), null)
  assert.equal(credentialVersionFromAccessToken('not-a-jwt'), null)
})
