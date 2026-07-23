import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'E-mail e senha são obrigatórios.' }, { status: 400 })
    }

    const cleanEmail = email.trim().toLowerCase()

    // Usa o client anônimo para autenticar (igual ao browser, mas no servidor)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: password,
    })

    if (error) {
      // Retorna o erro REAL do Supabase para diagnóstico
      return NextResponse.json({
        error: `Supabase Auth: ${error.message}`,
        supabase_status: error.status,
      }, { status: 401 })
    }

    if (!data.session) {
      return NextResponse.json({ error: 'Sessão não criada pelo Supabase.' }, { status: 401 })
    }

    // Sucesso — retorna o access_token para o client salvar
    const response = NextResponse.json({
      success: true,
      access_token: data.session.access_token,
    })

    // Seta os cookies de sessão
    const { access_token, refresh_token, expires_at } = data.session
    const isProduction = process.env.NODE_ENV === 'production'

    response.cookies.set('sb-access-token', access_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 3600,
      path: '/',
    })
    response.cookies.set('sb-refresh-token', refresh_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    })

    return response

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
