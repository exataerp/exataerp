import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization')
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

    const { empresa_id } = await req.json()

    const { data: equipe, error: equipeError } = await supabaseAdmin
      .from('controle_acesso')
      .select('*, perfis:user_id(email, nome)')
      .eq('empresa_id', empresa_id)

    if (equipeError) throw equipeError

    const equipeData = equipe || []
    let permissoesData = []

    if (equipeData.length > 0) {
      const userIds = equipeData.map((u: any) => u.user_id)
      const { data: permData, error: permError } = await supabaseAdmin
        .from('permissoes')
        .select('*')
        .in('user_id', userIds)
      
      if (permError) throw permError
      permissoesData = permData || []
    }

    return NextResponse.json({ equipe: equipeData, permissoes: permissoesData })
    
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
