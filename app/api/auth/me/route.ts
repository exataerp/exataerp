import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }
    const token = authHeader.slice(7)

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Valida token
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 })
    }

    // Busca perfil
    const { data: perfil, error: perfilErr } = await supabaseAdmin
      .from('perfis')
      .select('*')
      .eq('id', user.id)
      .single()

    if (perfilErr || !perfil) {
      return NextResponse.json({ error: 'Perfil não encontrado' }, { status: 404 })
    }
    if (perfil.status !== 'ativo') {
      return NextResponse.json({ error: 'Usuário inativo. Entre em contato com o administrador.' }, { status: 403 })
    }

    // Busca controle de acesso
    const { data: controle } = await supabaseAdmin
      .from('controle_acesso')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'ativo')
      .single()

    if (!controle) {
      return NextResponse.json({ error: 'Acesso não configurado para este usuário.' }, { status: 403 })
    }

    const empresaId = perfil.empresa_id || controle.empresa_id

    // Busca empresa
    const { data: empresa } = await supabaseAdmin
      .from('empresas')
      .select('id, nome, status, onboarding_completed, plano')
      .eq('id', empresaId)
      .single()

    if (!empresa) {
      return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 })
    }
    if (empresa.status !== 'ativo') {
      return NextResponse.json({ error: 'Sua empresa está temporariamente bloqueada.' }, { status: 403 })
    }

    // Busca permissões por aba
    const { data: permissoes } = await supabaseAdmin
      .from('permissoes')
      .select('aba_id')
      .eq('user_id', user.id)
      .eq('empresa_id', empresaId)

    // Busca preferências
    const { data: prefs } = await supabaseAdmin
      .from('user_preferences')
      .select('theme, language, timezone')
      .eq('user_id', user.id)
      .single()

    // Atualiza último login
    await supabaseAdmin
      .from('perfis')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id)

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email ?? perfil.email,
        nome: perfil.nome,
        cargo: perfil.cargo,
        tipo_usuario: perfil.tipo_usuario,
        status: perfil.status,
        first_access_completed: perfil.first_access_completed,
      },
      empresa: {
        id: empresa.id,
        nome: empresa.nome,
        status: empresa.status,
        onboarding_completed: empresa.onboarding_completed,
        plano: empresa.plano,
      },
      nivel: controle.nivel,
      permissoes_operador: controle.permissoes_operador ?? {},
      permissoes: permissoes?.map((p: any) => p.aba_id) ?? [],
      preferencias: prefs ?? { theme: 'dark', language: 'pt-BR' },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
