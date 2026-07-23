import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
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

    const body = await request.json()
    const { nome, tema } = body

    if (!nome?.trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
    }

    // Atualiza perfil — transacional via try/catch completo
    const { error: perfilErr } = await supabaseAdmin
      .from('perfis')
      .update({
        nome: nome.trim(),
        first_access_completed: true,
        terms_accepted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (perfilErr) throw new Error(`Erro ao salvar perfil: ${perfilErr.message}`)

    // Atualiza controle de acesso (marca como ativado)
    await supabaseAdmin
      .from('controle_acesso')
      .update({ activated_at: new Date().toISOString() })
      .eq('user_id', user.id)

    // Upsert preferências
    const { error: prefsErr } = await supabaseAdmin
      .from('user_preferences')
      .upsert(
        {
          user_id: user.id,
          theme: tema ?? 'dark',
          language: 'pt-BR',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )

    if (prefsErr) throw new Error(`Erro ao salvar preferências: ${prefsErr.message}`)

    // Busca dados para redirecionar corretamente
    const { data: perfil } = await supabaseAdmin
      .from('perfis')
      .select('empresa_id')
      .eq('id', user.id)
      .single()

    const { data: controle } = await supabaseAdmin
      .from('controle_acesso')
      .select('nivel, empresa_id')
      .eq('user_id', user.id)
      .single()

    const empresaId = perfil?.empresa_id || controle?.empresa_id

    const { data: empresa } = await supabaseAdmin
      .from('empresas')
      .select('onboarding_completed')
      .eq('id', empresaId)
      .single()

    // Registra evento de auditoria (fire and forget)
    supabaseAdmin
      .from('authentication_logs')
      .insert({
        company_id: empresaId,
        user_id: user.id,
        event_type: 'primeiro_acesso_concluido',
        success: true,
      })
      .then(() => {})

    return NextResponse.json({
      success: true,
      nivel: controle?.nivel,
      onboarding_completed: empresa?.onboarding_completed ?? false,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
