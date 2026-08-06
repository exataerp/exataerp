import { NextResponse } from 'next/server'

import { validatePasswordChange } from '@/lib/auth-credentials'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createClient as createSessionClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function getUpdateErrorMessage(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() ?? ''
  if (error.code === 'same_password' || message.includes('same password')) {
    return 'A nova senha deve ser diferente da senha atual.'
  }
  if (error.code === 'weak_password' || message.includes('weak password')) {
    return 'A nova senha não atende aos requisitos de segurança.'
  }
  if (error.code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'A senha atual está incorreta.'
  }
  return 'Não foi possível alterar a senha. Confirme a senha atual e tente novamente.'
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const currentPassword = String(body.currentPassword ?? '')
    const newPassword = String(body.newPassword ?? '')
    const confirmation = String(body.confirmation ?? '')
    const errors = validatePasswordChange(currentPassword, newPassword, confirmation)

    if (Object.keys(errors).length > 0) {
      return NextResponse.json(
        { error: Object.values(errors)[0] },
        { status: 400 },
      )
    }

    const supabase = await createSessionClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Sessão inválida ou expirada.' }, { status: 401 })
    }

    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from('perfis')
      .select('id, empresa_id')
      .eq('user_id', user.id)
      .single()

    if (perfilError || !perfil) {
      return NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 404 })
    }

    const { error: passwordError } = await supabase.auth.updateUser({
      current_password: currentPassword,
      password: newPassword,
    })

    if (passwordError) {
      await supabaseAdmin.from('authentication_logs').insert({
        company_id: perfil.empresa_id,
        user_id: user.id,
        event_type: 'alteracao_senha_usuario',
        success: false,
        failure_reason: passwordError.code ?? 'auth_error',
      })
      return NextResponse.json({ error: getUpdateErrorMessage(passwordError) }, { status: 400 })
    }

    const changedAt = new Date().toISOString()
    const { error: profileUpdateError } = await supabaseAdmin
      .from('perfis')
      .update({
        first_access_completed: true,
        must_change_password: false,
        password_changed_at: changedAt,
        password_reset_required_at: null,
        password_reset_by: null,
        updated_at: changedAt,
      })
      .eq('user_id', user.id)

    if (profileUpdateError) {
      await supabaseAdmin.from('authentication_logs').insert({
        company_id: perfil.empresa_id,
        user_id: user.id,
        event_type: 'alteracao_senha_usuario',
        success: false,
        failure_reason: 'profile_sync_failed',
      })
      return NextResponse.json(
        { error: 'A senha foi alterada, mas o perfil não foi sincronizado. Contate o administrador.' },
        { status: 500 },
      )
    }

    await supabaseAdmin.from('authentication_logs').insert({
      company_id: perfil.empresa_id,
      user_id: user.id,
      event_type: 'alteracao_senha_usuario',
      success: true,
    })

    await supabase.auth.signOut({ scope: 'global' })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Não foi possível alterar a senha agora.' }, { status: 500 })
  }
}
