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
  assertSuperAdmin,
  AuthError,
  getUserFromToken,
  supabaseAdmin,
} from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let createdEmpresaId: string | null = null
  let createdUserId: string | null = null

  try {
    const caller = await getUserFromToken(request)
    await assertSuperAdmin(caller.id)

    const body = await request.json()
    const nomeFabrica = String(body.nomeFabrica ?? '').trim()
    const nome = String(body.nome ?? '').trim() || 'Administrador'
    const username = normalizeUsername(body.username)
    const password = String(body.password ?? '')
    const email = normalizeOptionalEmail(body.email)

    const validationError =
      (!nomeFabrica ? 'Nome da fábrica é obrigatório.' : null)
      ?? validateUsername(username)
      ?? validatePassword(password)
      ?? validateOptionalEmail(email)

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const { data: existing } = await supabaseAdmin
      .from('perfis')
      .select('id')
      .eq('username', username)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: 'Este nome de usuário já está em uso.' },
        { status: 409 },
      )
    }

    const { data: empresa, error: empresaError } = await supabaseAdmin
      .from('empresas')
      .insert([{ nome: nomeFabrica, status: 'ativo' }])
      .select('id')
      .single()

    if (empresaError || !empresa) {
      throw new Error(empresaError?.message || 'Não foi possível criar a empresa.')
    }
    createdEmpresaId = empresa.id

    const { data: role, error: roleError } = await supabaseAdmin
      .from('roles')
      .select('id')
      .eq('name', 'system_manager')
      .single()

    if (roleError || !role) throw new Error('Perfil de Administrador do Sistema não encontrado.')

    const internalEmail = buildInternalAuthEmail(crypto.randomUUID())
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: { nome, username },
      app_metadata: {
        empresa_id: empresa.id,
        login_identifier: 'username',
      },
    })

    if (authError || !authData.user) {
      throw new Error(authError?.message || 'Não foi possível criar o administrador.')
    }
    createdUserId = authData.user.id

    const writes = await Promise.all([
      supabaseAdmin.from('perfis').insert({
        id: createdUserId,
        user_id: createdUserId,
        username,
        email,
        nome,
        status: 'ativo',
        empresa_id: empresa.id,
        tipo_usuario: 'admin',
        first_access_completed: false,
        must_change_password: true,
        password_reset_required_at: new Date().toISOString(),
        password_reset_by: caller.id,
        updated_at: new Date().toISOString(),
      }),
      supabaseAdmin.from('controle_acesso').insert({
        user_id: createdUserId,
        empresa_id: empresa.id,
        nivel: 'admin',
        status: 'ativo',
        activated_at: new Date().toISOString(),
      }),
      supabaseAdmin.from('user_roles').insert({
        user_id: createdUserId,
        empresa_id: empresa.id,
        role_id: role.id,
        granted_by: caller.id,
      }),
    ])

    const writeError = writes.find((result) => result.error)?.error
    if (writeError) throw new Error(writeError.message)

    return NextResponse.json(
      {
        success: true,
        message: 'Fábrica e administrador criados com senha definida.',
        empresa_id: empresa.id,
        user_id: createdUserId,
        username,
      },
      { status: 201 },
    )
  } catch (error: unknown) {
    if (createdUserId) {
      await supabaseAdmin.from('user_roles').delete().eq('user_id', createdUserId)
      await supabaseAdmin.from('controle_acesso').delete().eq('user_id', createdUserId)
      await supabaseAdmin.from('perfis').delete().eq('user_id', createdUserId)
      await supabaseAdmin.auth.admin.deleteUser(createdUserId)
    }
    if (createdEmpresaId) {
      await supabaseAdmin.from('empresas').delete().eq('id', createdEmpresaId)
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
