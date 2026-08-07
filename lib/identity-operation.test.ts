import assert from 'node:assert/strict'
import test from 'node:test'

import { identityOperationDecision, nonSensitiveFingerprint } from './identity-operation.ts'

const row = (overrides: Partial<Parameters<typeof identityOperationDecision>[0]>) => ({
  operation_id: 'operation',
  operation_status: 'pending' as const,
  operation_created: false,
  operation_result: {},
  ...overrides,
})

test('completed operations replay only the allowlisted persisted result', () => {
  assert.deepEqual(identityOperationDecision(row({
    operation_status: 'completed',
    operation_result: { user_id: 'user' },
  })), { kind: 'replay', result: { user_id: 'user' } })
})

test('only a newly created pending operation may proceed', () => {
  assert.equal(identityOperationDecision(row({ operation_created: true })).kind, 'proceed')
  assert.equal(identityOperationDecision(row({ operation_created: false })).kind, 'conflict')
  assert.equal(identityOperationDecision(row({ operation_status: 'failed' })).kind, 'conflict')
  assert.equal(identityOperationDecision(row({ operation_status: 'compensation_required' })).kind, 'conflict')
})

test('payload fingerprint is deterministic and rejects sensitive keys', () => {
  assert.equal(
    nonSensitiveFingerprint({ username: 'ana', roles: ['operator'] }),
    nonSensitiveFingerprint({ roles: ['operator'], username: 'ana' }),
  )
  assert.throws(() => nonSensitiveFingerprint({ password: 'never-persist-this' }))
  assert.throws(() => nonSensitiveFingerprint({ technical_email: 'opaque' }))
})
