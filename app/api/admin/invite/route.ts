import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

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
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: acessoInviter } = await supabaseAdmin
      .from('controle_acesso')
      .select('nivel')
      .eq('user_id', user.id)
      .single()

    if (!acessoInviter || !['master', 'admin'].includes(acessoInviter.nivel)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { email, password, nivel, gerenteId, empresaNome } = await request.json()
    const isMaster = acessoInviter.nivel === 'master'

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: password || 'Exata@123',
      email_confirm: true,
    })
    if (authError) throw authError

    let empresaIdFinal = null

    if (isMaster && nivel === 'admin') {
      const { data: novaEmpresa, error: empError } = await supabaseAdmin
        .from('empresas')
        .insert({ nome: empresaNome, status: 'ativo' })
        .select('id')
        .single()
      
      if (empError) throw empError
      empresaIdFinal = novaEmpresa.id
    } else {
      const { data: adminPerfil } = await supabaseAdmin
        .from('perfis')
        .select('empresa_id')
        .eq('id', gerenteId)
        .single()
        
      empresaIdFinal = adminPerfil?.empresa_id
    }

    const { error: perfilError } = await supabaseAdmin
      .from('perfis')
      .insert({
        id: authData.user.id,
        email,
        status: 'ativo',
        empresa_id: empresaIdFinal,
      })
    if (perfilError) throw perfilError

    const { error: acessoError } = await supabaseAdmin
      .from('controle_acesso')
      .insert({
        user_id: authData.user.id,
        nivel: nivel || 'operador',
      })
    if (acessoError) throw acessoError

    return NextResponse.json({ success: true, user: authData.user })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}
