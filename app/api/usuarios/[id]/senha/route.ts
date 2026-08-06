import { NextResponse } from 'next/server'

import { validatePassword } from '@/lib/auth-credentials'
import {
  assertSystemManager,
  AuthError,
  getUserFromToken,
  supabaseAdmin,
} from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: targetUserId } = await params
    const caller = await getUserFromToken(request)
    if (targetUserId === caller.id) {
      return NextResponse.json(
        { error: 'Use a alteração de senha da sua própria conta.' },
        { status: 400 },
      )
    }

    const { data: callerPerfil } = await supabaseAdmin
      .from('perfis')
      .select('empresa_id')
      .eq('user_id', caller.id)
      .single()

    if (!callerPerfil?.empresa_id) throw new AuthError('Empresa não encontrada.', 404)
    await assertSystemManager(caller.id, callerPerfil.empresa_id)

    const body = await request.json()
    const password = String(body.password ?? '')
    const passwordError = validatePassword(password)
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 })
    }

    const { data: target, error: targetError } = await supabaseAdmin
      .from('perfis')
      .select('id, user_id, empresa_id, status, must_change_password, password_reset_required_at, password_reset_by')
      .eq('user_id', targetUserId)
      .eq('empresa_id', callerPerfil.empresa_id)
      .single()

    if (targetError || !target?.user_id) {
      return NextResponse.json({ error: 'Usuário não encontrado nesta empresa.' }, { status: 404 })
    }
    if (target.status !== 'ativo') {
      return NextResponse.json({ error: 'Não é possível redefinir a senha de um usuário inativo.' }, { status: 409 })
    }

    const requiredAt = new Date().toISOString()
    const { error: markError } = await supabaseAdmin
      .from('perfis')
      .update({
        must_change_password: true,
        password_reset_required_at: requiredAt,
        password_reset_by: caller.id,
        updated_at: requiredAt,
      })
      .eq('id', target.id)

    if (markError) throw new Error(markError.message)

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(target.user_id, {
      password,
    })

    if (authError) {
      await supabaseAdmin
        .from('perfis')
        .update({
          must_change_password: target.must_change_password,
          password_reset_required_at: target.password_reset_required_at,
          password_reset_by: target.password_reset_by,
        })
        .eq('id', target.id)

      await supabaseAdmin.from('authentication_logs').insert({
        company_id: target.empresa_id,
        user_id: target.user_id,
        event_type: 'redefinicao_senha_administrador',
        success: false,
        failure_reason: authError.code ?? 'auth_error',
      })
      return NextResponse.json({ error: 'Não foi possível redefinir a senha do usuário.' }, { status: 400 })
    }

    await supabaseAdmin.from('authentication_logs').insert({
      company_id: target.empresa_id,
      user_id: target.user_id,
      event_type: 'redefinicao_senha_administrador',
      success: true,
    })

    return NextResponse.json({
      success: true,
      requires_password_change: true,
    })
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Erro interno no servidor.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
