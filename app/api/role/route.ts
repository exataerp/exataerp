import { NextResponse } from 'next/server'
import {
  supabaseAdmin,
  getUserFromToken,
  assertSystemManager,
  AuthError,
} from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// GET /api/roles
// Lista todos os roles disponíveis no sistema.
// Requer: autenticado.
export async function GET(request: Request) {
  try {
    await getUserFromToken(request)

    const { data, error } = await supabaseAdmin
      .from('roles')
      .select('id, name, display_name, description, is_system')
      .order('display_name')

    if (error) throw error

    return NextResponse.json({ roles: data ?? [] })

  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
