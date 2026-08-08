import { AuthError, supabaseAdmin } from '@/lib/supabase/admin'
import { assertAllowedOrigin, jsonNoStore, RequestValidationError } from '@/lib/auth-http'
import { requireCurrentPrincipal, requireSystemManager } from '@/lib/auth-principal'

export async function POST(request: Request) {
  try {
    assertAllowedOrigin(request)
    const principal = await requireCurrentPrincipal(request)
    requireSystemManager(principal)

    const { data: team, error } = await supabaseAdmin
      .from('controle_acesso')
      .select('*, perfis:user_id(email, nome)')
      .eq('empresa_id', principal.empresaId)
    if (error) throw error

    const userIds = (team ?? []).map(({ user_id }) => user_id)
    const authStates = new Map<string, { username: string; mustChangePassword: boolean }>()
    for (const userId of userIds) {
      const state = await supabaseAdmin.rpc('get_private_auth_state', { p_user_id: userId })
      if (state.error) throw state.error
      if (state.data?.length === 1 && typeof state.data[0].username === 'string') {
        authStates.set(userId, {
          username: state.data[0].username,
          mustChangePassword: Boolean(state.data[0].must_change_password),
        })
      }
    }
    const projectedTeam = (team ?? []).map((member) => ({
      ...member,
      perfis: member.perfis
        ? {
            ...member.perfis,
            username: authStates.get(member.user_id)?.username ?? null,
            must_change_password: authStates.get(member.user_id)?.mustChangePassword ?? false,
          }
        : null,
    }))
    const permissionsResult = userIds.length === 0
      ? { data: [], error: null }
      : await supabaseAdmin
          .from('permissoes')
          .select('*')
          .eq('empresa_id', principal.empresaId)
          .in('user_id', userIds)
    if (permissionsResult.error) throw permissionsResult.error

    return jsonNoStore({ equipe: projectedTeam, permissoes: permissionsResult.data ?? [] })
  } catch (error) {
    if (error instanceof RequestValidationError || error instanceof AuthError) {
      return jsonNoStore({ error: error.message }, { status: error.status })
    }
    return jsonNoStore({ error: 'Não foi possível carregar a equipe.' }, { status: 500 })
  }
}
