import { NextResponse } from 'next/server'
import {
  supabaseAdmin,
  getUserFromToken,
  assertSystemManager,
  AuthError,
} from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Helpers para obter empresa do caller
async function getCallerEmpresa(callerId: string): Promise<string> {
  const { data: perfil } = await supabaseAdmin
    .from('perfis')
    .select('empresa_id')
    .eq('user_id', callerId)
    .single()

  if (!perfil?.empresa_id) throw new AuthError('Empresa não encontrada.', 404)
  return perfil.empresa_id
}

// GET /api/usuarios/[id]/roles
// Lista os roles de um usuário na empresa do caller.
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const caller = await getUserFromToken(request)
    const empresaId = await getCallerEmpresa(caller.id)
    await assertSystemManager(caller.id, empresaId)

    const { data, error } = await supabaseAdmin
      .from('v_user_roles')
      .select('role_name, role_display_name, role_description, granted_by, created_at')
      .eq('user_id', params.id)
      .eq('empresa_id', empresaId)

    if (error) throw error

    return NextResponse.json({ roles: data ?? [] })

  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/usuarios/[id]/roles
// Adiciona um role a um usuário.
// Body: { role_name: string }
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const caller = await getUserFromToken(request)
    const empresaId = await getCallerEmpresa(caller.id)
    await assertSystemManager(caller.id, empresaId)

    const { role_name } = await request.json()

    if (!role_name) {
      return NextResponse.json({ error: 'role_name é obrigatório.' }, { status: 400 })
    }

    // Busca o role pelo name
    const { data: role, error: roleErr } = await supabaseAdmin
      .from('roles')
      .select('id')
      .eq('name', role_name)
      .single()

    if (roleErr || !role) {
      return NextResponse.json({ error: `Role '${role_name}' não encontrado.` }, { status: 404 })
    }

    // Garante que o usuário alvo pertence à mesma empresa
    const { data: targetPerfil } = await supabaseAdmin
      .from('perfis')
      .select('id')
      .eq('user_id', params.id)
      .eq('empresa_id', empresaId)
      .single()

    if (!targetPerfil) {
      return NextResponse.json(
        { error: 'Usuário não encontrado nesta empresa.' },
        { status: 404 }
      )
    }

    const { error: insertErr } = await supabaseAdmin
      .from('user_roles')
      .insert({
        user_id:    params.id,
        empresa_id: empresaId,
        role_id:    role.id,
        granted_by: caller.id,
      })

    if (insertErr) {
      if (insertErr.code === '23505') {
        return NextResponse.json(
          { error: 'Este usuário já possui este role.' },
          { status: 409 }
        )
      }
      throw new Error(insertErr.message)
    }

    return NextResponse.json({ success: true })

  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/usuarios/[id]/roles
// Remove um role de um usuário.
// Body: { role_name: string }
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const caller = await getUserFromToken(request)
    const empresaId = await getCallerEmpresa(caller.id)
    await assertSystemManager(caller.id, empresaId)

    const { role_name } = await request.json()

    if (!role_name) {
      return NextResponse.json({ error: 'role_name é obrigatório.' }, { status: 400 })
    }

    // Impede remover o próprio system_manager (ficaria sem acesso)
    if (params.id === caller.id && role_name === 'system_manager') {
      return NextResponse.json(
        { error: 'Você não pode remover seu próprio role de System Manager.' },
        { status: 400 }
      )
    }

    const { data: role } = await supabaseAdmin
      .from('roles')
      .select('id')
      .eq('name', role_name)
      .single()

    if (!role) {
      return NextResponse.json({ error: `Role '${role_name}' não encontrado.` }, { status: 404 })
    }

    const { error: deleteErr } = await supabaseAdmin
      .from('user_roles')
      .delete()
      .eq('user_id', params.id)
      .eq('empresa_id', empresaId)
      .eq('role_id', role.id)

    if (deleteErr) throw new Error(deleteErr.message)

    return NextResponse.json({ success: true })

  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
