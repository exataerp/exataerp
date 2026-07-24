import { NextResponse } from 'next/server'
import { supabaseAdmin, getUserFromToken, AuthError } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const user = await getUserFromToken(request)

    // Busca perfil
    const { data: perfil, error: perfilErr } = await supabaseAdmin
      .from('perfis')
      .select('id, nome, cargo, status, email, empresa_id, first_access_completed')
      .eq('user_id', user.id)
      .single()

    if (perfilErr || !perfil) {
      return NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 404 })
    }

    if (perfil.status !== 'ativo') {
      return NextResponse.json(
        { error: 'Usuário inativo. Entre em contato com o administrador.' },
        { status: 403 }
      )
    }

    // Busca empresa
    const { data: empresa } = await supabaseAdmin
      .from('empresas')
      .select('id, nome, status, onboarding_completed, plano')
      .eq('id', perfil.empresa_id)
      .single()

    if (!empresa) {
      return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 })
    }

    if (empresa.status !== 'ativo') {
      return NextResponse.json(
        { error: 'Sua empresa está temporariamente bloqueada.' },
        { status: 403 }
      )
    }

    // Busca roles via view
    const { data: rolesData } = await supabaseAdmin
      .from('v_user_roles')
      .select('role_name, role_display_name')
      .eq('user_id', user.id)
      .eq('empresa_id', perfil.empresa_id)

    const roles = (rolesData ?? []).map((r: any) => r.role_name)

    // Busca preferências
    const { data: prefs } = await supabaseAdmin
      .from('user_preferences')
      .select('theme, language, timezone')
      .eq('user_id', user.id)
      .maybeSingle()

    // Atualiza último login (fire and forget)
    supabaseAdmin
      .from('perfis')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', perfil.id)
      .then(() => {})

    return NextResponse.json({
      user: {
        id:                     user.id,
        email:                  user.email ?? perfil.email,
        nome:                   perfil.nome,
        cargo:                  perfil.cargo,
        status:                 perfil.status,
        first_access_completed: perfil.first_access_completed,
      },
      empresa: {
        id:                   empresa.id,
        nome:                 empresa.nome,
        status:               empresa.status,
        onboarding_completed: empresa.onboarding_completed,
        plano:                empresa.plano,
      },
      roles,
      preferencias: prefs ?? { theme: 'dark', language: 'pt-BR', timezone: 'America/Sao_Paulo' },
    })

  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
