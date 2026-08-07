import { AuthError, supabaseAdmin } from '@/lib/supabase/admin'
import { jsonNoStore, RolloutDisabledError } from '@/lib/auth-http'
import { requireCurrentPrincipal } from '@/lib/auth-principal'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const principal = await requireCurrentPrincipal(request, { allowPasswordChange: true })
    const [{ data: profile }, { data: company }, { data: preferences }] = await Promise.all([
      supabaseAdmin
        .from('perfis')
        .select('nome, cargo, email, first_access_completed')
        .eq('id', principal.profileId)
        .single(),
      supabaseAdmin
        .from('empresas')
        .select('id, nome, status, onboarding_completed, plano')
        .eq('id', principal.empresaId)
        .single(),
      supabaseAdmin
        .from('user_preferences')
        .select('theme, language, timezone')
        .eq('user_id', principal.userId)
        .maybeSingle(),
    ])
    if (!profile || !company) return jsonNoStore({ error: 'Acesso negado.' }, { status: 403 })

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
      preferencias: preferences ?? { theme: 'dark', language: 'pt-BR', timezone: 'America/Sao_Paulo' },
    })
  } catch (error) {
    if (error instanceof AuthError) return jsonNoStore({ error: error.message }, { status: error.status })
    if (error instanceof RolloutDisabledError) {
      return jsonNoStore({ error: 'Autenticação indisponível.' }, { status: 503 })
    }
    return jsonNoStore({ error: 'Acesso negado.' }, { status: 403 })
  }
}
