import { NextResponse } from 'next/server'
import {
  supabaseAdmin,
  getUserFromToken,
  assertSuperAdmin,
  AuthError,
} from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// POST /api/admin/nova-fabrica
// Cria uma nova empresa (cliente do SaaS) e convida o administrador dela.
// Requer: Super Admin global autenticado (tabela super_admins).
//
// Body: { email: string, nomeFabrica: string }

export async function POST(request: Request) {
  let createdEmpresaId: string | null = null
  let invitedUserId: string | null = null

  try {
    const caller = await getUserFromToken(request)
    await assertSuperAdmin(caller.id)

    const body = await request.json()
    const email = String(body.email ?? '').trim().toLowerCase()
    const nomeFabrica = String(body.nomeFabrica ?? '').trim()

    if (!email) {
      return NextResponse.json({ error: 'E-mail é obrigatório.' }, { status: 400 })
    }
    if (!nomeFabrica) {
      return NextResponse.json({ error: 'Nome da fábrica é obrigatório.' }, { status: 400 })
    }

    // Cria a empresa
    const { data: empresa, error: empresaError } = await supabaseAdmin
      .from('empresas')
      .insert([{ nome: nomeFabrica, status: 'ativo' }])
      .select()
      .single()

    if (empresaError) throw new Error(`Erro ao criar empresa: ${empresaError.message}`)
    createdEmpresaId = empresa.id

    // Busca o id do role system_manager (quem administra a empresa)
    const { data: role, error: roleError } = await supabaseAdmin
      .from('roles')
      .select('id')
      .eq('name', 'system_manager')
      .single()

    if (roleError || !role) throw new Error('Role system_manager não encontrado.')

    // Convida o administrador da nova empresa via Supabase Auth
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://exataerp.vercel.app'
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      { redirectTo: `${siteUrl}/primeiro-acesso` }
    )

    if (authError) {
      // Rollback da empresa criada, pra não deixar lixo órfão
      await supabaseAdmin.from('empresas').delete().eq('id', empresa.id)
      throw new Error(`Erro ao convidar usuário: ${authError.message}`)
    }

    const newUserId = authData.user.id
    invitedUserId = newUserId

    // Cria o perfil (id e user_id precisam ser o mesmo valor: o id do auth.users)
    const { error: perfilError } = await supabaseAdmin
      .from('perfis')
      .insert({
        id: newUserId,
        user_id: newUserId,
        email,
        nome: '',
        status: 'ativo',
        empresa_id: empresa.id,
        first_access_completed: false,
        updated_at: new Date().toISOString(),
      })

    if (perfilError) throw new Error(`Erro ao criar perfil: ${perfilError.message}`)

    // Mantém compatibilidade com as políticas RLS operacionais, que validam
    // o vínculo de empresa pela tabela controle_acesso.
    const { error: acessoError } = await supabaseAdmin
      .from('controle_acesso')
      .insert({
        user_id: newUserId,
        empresa_id: empresa.id,
        nivel: 'admin',
        status: 'ativo',
      })

    if (acessoError) throw new Error(`Erro ao criar controle de acesso: ${acessoError.message}`)

    // Atribui o role system_manager ao administrador da nova empresa
    const { error: roleAssignError } = await supabaseAdmin
      .from('user_roles')
      .insert({
        user_id: newUserId,
        empresa_id: empresa.id,
        role_id: role.id,
        granted_by: caller.id,
      })

    if (roleAssignError) throw new Error(`Erro ao atribuir role: ${roleAssignError.message}`)

    return NextResponse.json({
      success: true,
      message: 'Fábrica criada e convite enviado.',
      empresa_id: empresa.id,
    })

  } catch (err: any) {
    // Convite, perfil, acesso e role formam uma única operação lógica.
    // Remove qualquer criação parcial para permitir uma nova tentativa limpa.
    if (invitedUserId) {
      await supabaseAdmin.from('user_roles').delete().eq('user_id', invitedUserId)
      await supabaseAdmin.from('controle_acesso').delete().eq('user_id', invitedUserId)
      await supabaseAdmin.from('perfis').delete().eq('user_id', invitedUserId)
      await supabaseAdmin.from('perfis').delete().eq('id', invitedUserId)
      await supabaseAdmin.auth.admin.deleteUser(invitedUserId)
    }

    if (createdEmpresaId) {
      await supabaseAdmin.from('empresas').delete().eq('id', createdEmpresaId)
    }

    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
