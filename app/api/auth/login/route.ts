import { createServerClient } from '@supabase/ssr'
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

    // 1. Tenta login direto via Supabase Auth
    let response = NextResponse.json({ success: true })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return []
          },
          setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: password,
    })

    if (authError) {
      console.error('API Login Auth error:', authError)

      // Fallback de verificação: verifica se o usuário existe em perfis
      const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )

      const { data: perfil } = await supabaseAdmin
        .from('perfis')
        .select('id, email')
        .eq('email', cleanEmail)
        .single()

      if (!perfil) {
        return NextResponse.json({
          error: `O e-mail "${cleanEmail}" não está cadastrado em nenhuma empresa no sistema.`,
        }, { status: 404 })
      }

      if (authError.message.includes('Invalid login credentials')) {
        return NextResponse.json({
          error: 'Senha incorreta. Verifique a senha digitada ou use a recuperação de senha.',
        }, { status: 400 })
      }

      if (authError.message.includes('Email not confirmed')) {
        return NextResponse.json({
          error: 'E-mail ainda não confirmado no Supabase. Marque "Auto Confirm User" no painel.',
        }, { status: 400 })
      }

      return NextResponse.json({ error: `Erro no Supabase Auth: ${authError.message}` }, { status: 400 })
    }

    return response
  } catch (err: any) {
    console.error('API Login Error:', err)
    return NextResponse.json({ error: err.message || 'Erro interno no servidor' }, { status: 500 })
  }
}
