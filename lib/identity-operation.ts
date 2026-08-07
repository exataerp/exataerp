import { createHash } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

export type IdentityOperationStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'compensation_required'

export type IdentityOperationRow = {
  operation_id: string
  operation_status: IdentityOperationStatus
  operation_created: boolean
  operation_result: Record<string, unknown>
}

export function identityOperationDecision(row: IdentityOperationRow) {
  if (row.operation_status === 'completed') {
    return { kind: 'replay' as const, result: row.operation_result }
  }
  if (row.operation_status === 'pending' && row.operation_created) {
    return { kind: 'proceed' as const }
  }
  return { kind: 'conflict' as const }
}

export function nonSensitiveFingerprint(value: Record<string, unknown>) {
  const forbidden = /password|senha|token|email/i
  if (Object.keys(value).some((key) => forbidden.test(key))) {
    throw new Error('Fingerprint contém campo sensível')
  }
  const canonical = JSON.stringify(Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  ))
  return createHash('sha256').update(canonical).digest('hex')
}

export function idempotentResourceId(digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Digest idempotente inválido')

  const bytes = Buffer.from(digest.slice(0, 32), 'hex')
  // UUID v5-shaped identifier. The digest already namespaces the operation,
  // tenant, actor, target and Idempotency-Key.
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function finishIdentityFailure(
  client: SupabaseClient,
  input: {
    operationId: string
    status: 'failed' | 'compensation_required'
    failureCode: string
    correlationId: string
  },
) {
  const { error } = await client.rpc('finish_identity_operation', {
    p_operation_id: input.operationId,
    p_status: input.status,
    p_failure_code: input.failureCode.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 100),
    p_correlation_id: input.correlationId,
  })
  if (error) throw new Error('Não foi possível registrar a falha da operação')
}
