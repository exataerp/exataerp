import { NextResponse } from 'next/server'

import { normalizeUsername } from '@/lib/auth-credentials'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createClient as createSessionClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const INVALID_CREDENTIALS = 'Nome de usuário ou senha incorretos.'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const username = normalizeUsername(body.username)
    const password = String(body.password ?? '')

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Nome de usuário e senha são obrigatórios.' },
        { status: 400 },
      )
    }

    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from('perfis')
      .select('user_id, empresa_id, status, must_change_password')
      .eq('username', username)
      .maybeSingle()

    if (perfilError || !perfil?.user_id || perfil.status !== 'ativo') {
      return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 })
    }

    const { data: empresa } = await supabaseAdmin
      .from('empresas')
      .select('id, status')
      .eq('id', perfil.empresa_id)
      .maybeSingle()

    if (!empresa || empresa.status !== 'ativo') {
      return NextResponse.json(
        { error: 'Sua empresa está temporariamente bloqueada.' },
        { status: 403 },
      )
    }

    const { data: authUserData, error: authUserError } =
      await supabaseAdmin.auth.admin.getUserById(perfil.user_id)
    const authEmail = authUserData.user?.email

    if (authUserError || !authEmail) {
      return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 })
    }

    const supabase = await createSessionClient()
    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password,
    })

    if (error || !data.session) {
      await supabaseAdmin.from('authentication_logs').insert({
        company_id: perfil.empresa_id,
        user_id: perfil.user_id,
        event_type: 'login_usuario_senha',
        success: false,
      })
      return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 })
    }

    await Promise.all([
      supabaseAdmin
        .from('perfis')
        .update({ last_login_at: new Date().toISOString() })
        .eq('user_id', perfil.user_id),
      supabaseAdmin.from('authentication_logs').insert({
        company_id: perfil.empresa_id,
        user_id: perfil.user_id,
        event_type: 'login_usuario_senha',
        success: true,
      }),
    ])

    return NextResponse.json({
      success: true,
      requires_password_change: perfil.must_change_password,
    })
  } catch {
    return NextResponse.json(
      { error: 'Não foi possível entrar agora. Tente novamente.' },
      { status: 500 },
    )
  }
}
