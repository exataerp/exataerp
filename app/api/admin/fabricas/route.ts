import { assertAllowedOrigin, jsonNoStore, readStrictJson, RequestValidationError } from '@/lib/auth-http'
import { requireCurrentPrincipal, requireSuperAdmin } from '@/lib/auth-principal'
import { supabaseAdmin, AuthError } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// GET /api/admin/fabricas
// Lista todas as empresas (clientes) do SaaS.
// Requer: Super Admin global.
export async function GET(request: Request) {
  try {
    const principal = await requireCurrentPrincipal(request)
    requireSuperAdmin(principal)

    const { data, error } = await supabaseAdmin
      .from('empresas')
      .select('id, nome, subdomain, status, created_at')
      .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)

    return jsonNoStore({ empresas: data ?? [] })
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonNoStore({ error: error.message }, { status: error.status })
    }
    return jsonNoStore({ error: 'Não foi possível carregar as empresas.' }, { status: 500 })
  }
}

// PATCH /api/admin/fabricas
// Body: { id: string, status: 'ativo' | 'inativo' }
// Ativa ou suspende o acesso de uma empresa.
// Requer: Super Admin global.
export async function PATCH(request: Request) {
  try {
    assertAllowedOrigin(request)
    const principal = await requireCurrentPrincipal(request)
    requireSuperAdmin(principal)
    const { id, status } = await readStrictJson<{ id?: unknown; status?: unknown }>(request, ['id', 'status'])

    if (typeof id !== 'string' || !UUID_PATTERN.test(id) || (status !== 'ativo' && status !== 'inativo')) {
      throw new RequestValidationError(400)
    }

    const { data, error } = await supabaseAdmin
      .from('empresas')
      .update({ status })
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!data) return jsonNoStore({ error: 'Empresa não encontrada.' }, { status: 404 })

    return jsonNoStore({ success: true })
  } catch (error) {
    if (error instanceof RequestValidationError || error instanceof AuthError) {
      return jsonNoStore({ error: error.message }, { status: error.status })
    }
    return jsonNoStore({ error: 'Não foi possível alterar a empresa.' }, { status: 500 })
  }
}
