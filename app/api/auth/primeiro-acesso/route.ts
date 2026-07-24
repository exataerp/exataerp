import { NextResponse } from 'next/server'
import { supabaseAdmin, getUserFromToken, AuthError } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const user = await getUserFromToken(request)
    const { nome, tema } = await request.json()

    if (!nome?.trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório.' }, { status: 400 })
    }

    // Busca perfil para obter empresa_id
    const { data: perfil, error: perfilErr } = await supabaseAdmin
      .from('perfis')
      .select('id, empresa_id, first_access_completed')
      .eq('user_id', user.id)
      .single()

    if (perfilErr || !perfil) {
      return NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 404 })
    }

    if (perfil.first_access_completed) {
      return NextResponse.json(
        { error: 'Primeiro acesso já foi concluído.' },
        { status: 409 }
      )
    }

    // Atualiza perfil
    const { error: updateErr } = await supabaseAdmin
      .from('perfis')
      .update({
        nome:                   nome.trim(),
        first_access_completed: true,
        terms_accepted_at:      new Date().toISOString(),
        updated_at:             new Date().toISOString(),
      })
      .eq('id', perfil.id)

    if (updateErr) throw new Error(`Erro ao salvar perfil: ${updateErr.message}`)

    // Upsert preferências
    const { error: prefsErr } = await supabaseAdmin
      .from('user_preferences')
      .upsert(
        {
          user_id:    user.id,
          theme:      tema ?? 'dark',
          language:   'pt-BR',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )

    if (prefsErr) throw new Error(`Erro ao salvar preferências: ${prefsErr.message}`)

    // Busca roles para redirecionar corretamente após o primeiro acesso
    const { data: rolesData } = await supabaseAdmin
      .from('v_user_roles')
      .select('role_name')
      .eq('user_id', user.id)
      .eq('empresa_id', perfil.empresa_id)

    const roles = (rolesData ?? []).map((r: any) => r.role_name)
    const isSystemManager = roles.includes('system_manager')

    // Busca empresa para saber se precisa do setup wizard
    const { data: empresa } = await supabaseAdmin
      .from('empresas')
      .select('onboarding_completed')
      .eq('id', perfil.empresa_id)
      .single()

    // Registra auditoria (fire and forget)
    supabaseAdmin
      .from('authentication_logs')
      .insert({
        company_id: perfil.empresa_id,
        user_id:    user.id,
        event_type: 'primeiro_acesso_concluido',
        success:    true,
      })
      .then(() => {})

    return NextResponse.json({
      success:              true,
      roles,
      is_system_manager:    isSystemManager,
      onboarding_completed: empresa?.onboarding_completed ?? false,
    })

  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
