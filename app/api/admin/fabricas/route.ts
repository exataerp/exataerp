import { NextResponse } from 'next/server'
import {
  supabaseAdmin,
  getUserFromToken,
  assertSuperAdmin,
  AuthError,
} from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// GET /api/admin/fabricas
// Lista todas as empresas (clientes) do SaaS.
// Requer: Super Admin global.
export async function GET(request: Request) {
  try {
    const caller = await getUserFromToken(request)
    await assertSuperAdmin(caller.id)

    const { data, error } = await supabaseAdmin
      .from('empresas')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)

    return NextResponse.json({ empresas: data ?? [] })
  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/admin/fabricas
// Body: { id: string, status: 'ativo' | 'inativo' }
// Ativa ou suspende o acesso de uma empresa.
// Requer: Super Admin global.
export async function PATCH(request: Request) {
  try {
    const caller = await getUserFromToken(request)
    await assertSuperAdmin(caller.id)

    const body = await request.json()
    const { id, status } = body

    if (!id || !['ativo', 'inativo'].includes(status)) {
      return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('empresas')
      .update({ status })
      .eq('id', id)

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
