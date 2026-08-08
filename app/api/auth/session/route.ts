import { AuthError, supabaseAdmin } from '@/lib/supabase/admin'
import { jsonNoStore, RolloutDisabledError } from '@/lib/auth-http'
import { requireCurrentPrincipal } from '@/lib/auth-principal'
import { mergeAuditPermissions } from '@/lib/auth-permissions'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const principal = await requireCurrentPrincipal(request, { allowPasswordChange: true })
    const [profileResult, companyResult, preferencesResult, roleLinksResult, userPermissionsResult] = await Promise.all([
      supabaseAdmin
        .from('perfis')
        .select('nome, cargo, email, first_access_completed')
        .eq('id', principal.profileId)
        .single(),
      supabaseAdmin
        .from('empresas')
        .select('id, nome, status, onboarding_completed, plano, subdomain')
        .eq('id', principal.empresaId)
        .single(),
      supabaseAdmin
        .from('user_preferences')
        .select('theme, language, timezone')
        .eq('user_id', principal.userId)
        .maybeSingle(),
      supabaseAdmin
        .from('user_roles')
        .select('role_id')
        .eq('user_id', principal.userId)
        .eq('empresa_id', principal.empresaId),
      supabaseAdmin
        .from('user_permissions')
        .select('permission_code')
        .eq('user_id', principal.userId)
        .eq('tenant_id', principal.empresaId),
    ])
    if (
      profileResult.error
      || companyResult.error
      || preferencesResult.error
      || roleLinksResult.error
      || userPermissionsResult.error
    ) throw new AuthError('Sessão indisponível.', 500)

    const profile = profileResult.data
    const company = companyResult.data
    const preferences = preferencesResult.data
    if (!profile || !company) return jsonNoStore({ error: 'Acesso negado.' }, { status: 403 })

    const roleIds = (roleLinksResult.data ?? []).map(({ role_id }) => role_id)
    const rolePermissionsResult = roleIds.length === 0
      ? { data: [] as { permission_code: string }[], error: null }
      : await supabaseAdmin
          .from('role_permissions')
          .select('permission_code')
          .in('role_id', roleIds)
    if (rolePermissionsResult.error) throw new AuthError('Sessão indisponível.', 500)

    const permissions = mergeAuditPermissions(
      principal.roles,
      (rolePermissionsResult.data ?? []).map(({ permission_code }) => permission_code),
      (userPermissionsResult.data ?? []).map(({ permission_code }) => permission_code),
    )

    return jsonNoStore({
      user: {
        id: principal.userId,
        username: principal.username,
        email: profile.email ?? null,
        nome: profile.nome ?? '',
        cargo: profile.cargo ?? null,
        status: principal.profileStatus,
        first_access_completed: profile.first_access_completed ?? false,
        must_change_password: principal.mustChangePassword,
      },
      empresa: company,
      roles: principal.roles,
      permissions,
      preferencias: preferences ?? { theme: 'dark', language: 'pt-BR', timezone: 'America/Sao_Paulo' },
    })
  } catch (error) {
    if (error instanceof AuthError) return jsonNoStore({ error: error.message }, { status: error.status })
    if (error instanceof RolloutDisabledError) {
      return jsonNoStore({ error: 'Autenticação indisponível.' }, { status: 503 })
    }
    return jsonNoStore({ error: 'Sessão indisponível.' }, { status: 500 })
  }
}
