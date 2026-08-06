import { NextResponse } from 'next/server'

import {
  buildInternalAuthEmail,
  normalizeOptionalEmail,
  normalizeUsername,
  validateOptionalEmail,
  validatePassword,
  validateUsername,
} from '@/lib/auth-credentials'
import {
  assertSystemManager,
  AuthError,
  getUserFromToken,
  supabaseAdmin,
} from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let createdUserId: string | null = null

  try {
    const caller = await getUserFromToken(request)
    const { data: callerPerfil } = await supabaseAdmin
      .from('perfis')
      .select('empresa_id, status')
      .eq('user_id', caller.id)
      .eq('status', 'ativo')
      .single()

    if (!callerPerfil?.empresa_id) {
      return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 })
    }

    const empresaId = callerPerfil.empresa_id
    await assertSystemManager(caller.id, empresaId)

    const body = await request.json()
    const username = normalizeUsername(body.username)
    const password = String(body.password ?? '')
    const nome = String(body.nome ?? '').trim()
    const cargo = String(body.cargo ?? '').trim() || null
    const email = normalizeOptionalEmail(body.email)
    const roles = Array.isArray(body.roles)
      ? Array.from(new Set(body.roles.map((role: unknown) => String(role))))
      : []

    const validationError =
      validateUsername(username)
      ?? validatePassword(password)
      ?? validateOptionalEmail(email)
      ?? (!nome ? 'Nome é obrigatório.' : null)
      ?? (roles.length === 0 ? 'Selecione pelo menos um perfil de acesso.' : null)

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const [{ data: existing }, { data: validRoles }] = await Promise.all([
      supabaseAdmin
        .from('perfis')
        .select('id')
        .eq('username', username)
        .maybeSingle(),
      supabaseAdmin
        .from('roles')
        .select('id, name')
        .in('name', roles),
    ])

    if (existing) {
      return NextResponse.json(
        { error: 'Este nome de usuário já está em uso.' },
        { status: 409 },
      )
    }

    if (!validRoles || validRoles.length !== roles.length) {
      return NextResponse.json({ error: 'Um ou mais perfis de acesso são inválidos.' }, { status: 400 })
    }

    const internalEmail = buildInternalAuthEmail(crypto.randomUUID())
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: { nome, username },
      app_metadata: {
        empresa_id: empresaId,
        login_identifier: 'username',
      },
    })

    if (authError || !authData.user) {
      throw new Error(authError?.message || 'Não foi possível criar a credencial do usuário.')
    }
    createdUserId = authData.user.id

    const nivel = roles.includes('system_manager') ? 'admin' : 'operador'
    const profileType = roles.includes('system_manager') ? 'admin' : 'colaborador'
    const writes = await Promise.all([
      supabaseAdmin.from('perfis').insert({
        id: createdUserId,
        user_id: createdUserId,
        empresa_id: empresaId,
        username,
        email,
        nome,
        cargo,
        tipo_usuario: profileType,
        status: 'ativo',
        first_access_completed: false,
        must_change_password: true,
        password_reset_required_at: new Date().toISOString(),
        password_reset_by: caller.id,
        updated_at: new Date().toISOString(),
      }),
      supabaseAdmin.from('controle_acesso').insert({
        user_id: createdUserId,
        empresa_id: empresaId,
        nivel,
        status: 'ativo',
        activated_at: new Date().toISOString(),
      }),
      supabaseAdmin.from('user_roles').insert(validRoles.map((role) => ({
        user_id: createdUserId,
        empresa_id: empresaId,
        role_id: role.id,
        granted_by: caller.id,
      }))),
    ])

    const writeError = writes.find((result) => result.error)?.error
    if (writeError) throw new Error(writeError.message)

    await supabaseAdmin.from('authentication_logs').insert({
      company_id: empresaId,
      user_id: caller.id,
      event_type: 'usuario_criado_manualmente',
      success: true,
    })

    return NextResponse.json(
      { success: true, user_id: createdUserId, username, requires_password_change: true },
      { status: 201 },
    )
  } catch (error: unknown) {
    if (createdUserId) {
      await supabaseAdmin.from('user_roles').delete().eq('user_id', createdUserId)
      await supabaseAdmin.from('controle_acesso').delete().eq('user_id', createdUserId)
      await supabaseAdmin.from('perfis').delete().eq('user_id', createdUserId)
      await supabaseAdmin.auth.admin.deleteUser(createdUserId)
    }

    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    const message = error instanceof Error ? error.message : 'Erro interno no servidor.'
    const status = /duplicate key|unique constraint/i.test(message) ? 409 : 500
    return NextResponse.json(
      { error: status === 409 ? 'Este nome de usuário já está em uso.' : message },
      { status },
    )
  }
}
