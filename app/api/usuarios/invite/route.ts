import { NextResponse } from 'next/server'
import {
  supabaseAdmin,
  getUserFromToken,
  assertSystemManager,
  AuthError,
} from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// POST /api/usuarios/invite
// Cria usuário, envia convite por e-mail e atribui roles iniciais.
// Requer: System Manager autenticado.
//
// Body: {
//   email:     string
//   nome?:     string       (pré-preenche o nome no primeiro acesso)
//   roles:     string[]     (ex: ['production_manager', 'stock_user'])
// }

export async function POST(request: Request) {
  try {
    const caller = await getUserFromToken(request)

    // Busca empresa do caller
    const { data: callerPerfil } = await supabaseAdmin
      .from('perfis')
      .select('empresa_id')
      .eq('user_id', caller.id)
      .single()

    if (!callerPerfil?.empresa_id) {
      return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 })
    }

    const empresaId = callerPerfil.empresa_id

    // Garante que o caller é System Manager
    await assertSystemManager(caller.id, empresaId)

    const body = await request.json()
    const { email, nome, roles } = body

    if (!email?.trim()) {
      return NextResponse.json({ error: 'E-mail é obrigatório.' }, { status: 400 })
    }
    if (!roles || !Array.isArray(roles) || roles.length === 0) {
      return NextResponse.json({ error: 'Pelo menos um role deve ser atribuído.' }, { status: 400 })
    }

    const emailLimpo = email.trim().toLowerCase()

    // Verifica se os roles informados existem
    const { data: rolesValidos } = await supabaseAdmin
      .from('roles')
      .select('id, name')
      .in('name', roles)

    if (!rolesValidos || rolesValidos.length !== roles.length) {
      const encontrados = (rolesValidos ?? []).map((r: any) => r.name)
      const invalidos   = roles.filter((r: string) => !encontrados.includes(r))
      return NextResponse.json(
        { error: `Roles inválidos: ${invalidos.join(', ')}` },
        { status: 400 }
      )
    }

    // Verifica se o e-mail já existe na empresa
    const { data: existing } = await supabaseAdmin
      .from('perfis')
      .select('id, status')
      .eq('email', emailLimpo)
      .eq('empresa_id', empresaId)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: 'Este e-mail já está cadastrado nesta empresa.' },
        { status: 409 }
      )
    }

    // Cria usuário no Supabase Auth e envia e-mail de convite
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://exataerp.vercel.app'
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      emailLimpo,
      {
        redirectTo: `${siteUrl}/primeiro-acesso`,
        data: {
          nome: nome?.trim() ?? '',
        },
      }
    )

    if (authError) {
      // Se o usuário já existe no Auth mas não tem perfil, trata como reenvio
      if (authError.message.includes('already been registered')) {
        return NextResponse.json(
          { error: 'Este e-mail já possui uma conta no sistema.' },
          { status: 409 }
        )
      }
      throw new Error(`Erro ao criar convite: ${authError.message}`)
    }

    const newUserId = authData.user.id

    // Cria perfil
    const { error: perfilErr } = await supabaseAdmin
      .from('perfis')
      .insert({
        id:                     newUserId,
        user_id:                newUserId,
        email:                  emailLimpo,
        nome:                   nome?.trim() ?? '',
        status:                 'ativo',
        empresa_id:             empresaId,
        first_access_completed: false,
        created_at:             new Date().toISOString(),
        updated_at:             new Date().toISOString(),
      })

    if (perfilErr) throw new Error(`Erro ao criar perfil: ${perfilErr.message}`)

    // Atribui roles
    const userRolesInsert = rolesValidos.map((role: any) => ({
      user_id:    newUserId,
      empresa_id: empresaId,
      role_id:    role.id,
      granted_by: caller.id,
    }))

    const { error: rolesErr } = await supabaseAdmin
      .from('user_roles')
      .insert(userRolesInsert)

    if (rolesErr) throw new Error(`Erro ao atribuir roles: ${rolesErr.message}`)

    // Registra auditoria
    supabaseAdmin
      .from('authentication_logs')
      .insert({
        company_id: empresaId,
        user_id:    caller.id,
        event_type: 'convite_enviado',
        success:    true,
      })
      .then(() => {})

    return NextResponse.json({
      success: true,
      message: `Convite enviado para ${emailLimpo}.`,
      user_id: newUserId,
    })

  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
