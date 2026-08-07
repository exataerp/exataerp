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
