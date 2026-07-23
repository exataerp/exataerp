import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    const token = authHeader.replace('Bearer ', '')

    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data: { user }, error: authErr } = await supabaseAuth.auth.getUser(token)
    if (authErr || !user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: acesso } = await supabaseAdmin
      .from('controle_acesso')
      .select('nivel')
      .eq('user_id', user.id)
      .single()

    if (!acesso || !['master', 'admin'].includes(acesso.nivel)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const body = await request.json()
    const email = body.email
    const nivel = body.nivel || 'operador'
    const empresa_id = body.empresa_id

    if (!email || !empresa_id) {
      return NextResponse.json({ error: 'E-mail e ID da empresa são obrigatórios.' }, { status: 400 })
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email)

    if (authError) throw authError

    const { error: acessoError } = await supabaseAdmin
      .from('controle_acesso')
      .insert([{
        user_id: authData.user.id,
        nivel: nivel,
        empresa_id: empresa_id
      }])

    if (acessoError) throw acessoError

    return NextResponse.json({ success: true, message: 'Operador convidado e vinculado à fábrica com sucesso.' })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
