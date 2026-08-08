import type { SupabaseClient } from '@supabase/supabase-js'

export type IdentityFailureStatus = 'failed' | 'compensation_required'

type AsyncAction = () => Promise<void>
type ResidualProbe = () => Promise<boolean>

export async function compensateAndClassify(
  cleanupActions: readonly AsyncAction[],
  residualProbes: readonly ResidualProbe[],
): Promise<IdentityFailureStatus> {
  for (const cleanup of cleanupActions) {
    try {
      await cleanup()
    } catch {
      // The probes below, rather than the attempted action, determine status.
    }
  }

  const probes = await Promise.allSettled(residualProbes.map((probe) => probe()))
  const hasResidualOrUnknownState = probes.some(
    (probe) => probe.status === 'rejected' || probe.value,
  )
  return hasResidualOrUnknownState ? 'compensation_required' : 'failed'
}

function throwOnError(error: unknown) {
  if (error) throw error
}

async function tableHasUserRows(
  client: SupabaseClient,
  table: 'user_roles' | 'controle_acesso' | 'perfis',
  userId: string,
  empresaId: string,
) {
  const { data, error } = await client
    .from(table)
    .select('user_id')
    .eq('user_id', userId)
    .eq('empresa_id', empresaId)
    .limit(1)
  throwOnError(error)
  return Boolean(data?.length)
}

async function authUserExists(client: SupabaseClient, userId: string) {
  const { data, error } = await client.auth.admin.getUserById(userId)
  if (!error) return Boolean(data.user)
  if (error.status === 404) return false
  throw error
}

export async function compensateCreatedIdentity(
  client: SupabaseClient,
  input: {
    userId: string | null
    empresaId: string
    deleteEmpresa: boolean
    skipCleanup?: boolean
  },
) {
  const cleanupActions: AsyncAction[] = []
  const residualProbes: ResidualProbe[] = []

  if (input.userId) {
    const userId = input.userId
    for (const table of ['user_roles', 'controle_acesso', 'perfis'] as const) {
      cleanupActions.push(async () => {
        const { error } = await client
          .from(table)
          .delete()
          .eq('user_id', userId)
          .eq('empresa_id', input.empresaId)
        throwOnError(error)
      })
      residualProbes.push(() => tableHasUserRows(client, table, userId, input.empresaId))
    }
    cleanupActions.push(async () => {
      const { error } = await client.auth.admin.deleteUser(userId)
      throwOnError(error)
    })
    residualProbes.push(() => authUserExists(client, userId))
    residualProbes.push(async () => {
      const { data, error } = await client.rpc('get_private_auth_state', { p_user_id: userId })
      throwOnError(error)
      return Boolean(data?.length)
    })
  }

  if (input.deleteEmpresa) {
    cleanupActions.push(async () => {
      const { error } = await client.from('empresas').delete().eq('id', input.empresaId)
      throwOnError(error)
    })
    residualProbes.push(async () => {
      const { data, error } = await client.from('empresas').select('id').eq('id', input.empresaId).limit(1)
      throwOnError(error)
      return Boolean(data?.length)
    })
  }

  return compensateAndClassify(input.skipCleanup ? [] : cleanupActions, residualProbes)
}
