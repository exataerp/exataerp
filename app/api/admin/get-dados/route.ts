import { AuthError, supabaseAdmin } from '@/lib/supabase/admin'
import { assertAllowedOrigin, jsonNoStore, readStrictJson, RequestValidationError } from '@/lib/auth-http'
import { requireCurrentPrincipal, requireSystemManager } from '@/lib/auth-principal'

const ALLOWED_TABLES = new Set(['controle_acesso', 'permissoes', 'user_roles'])

export async function POST(request: Request) {
  try {
    assertAllowedOrigin(request)
    const principal = await requireCurrentPrincipal(request)
    requireSystemManager(principal)
    const { table } = await readStrictJson<{ table?: unknown }>(request, ['table'])
    if (typeof table !== 'string' || !ALLOWED_TABLES.has(table)) {
      throw new RequestValidationError(400)
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .select('*')
      .eq('empresa_id', principal.empresaId)
    if (error) throw error
    return jsonNoStore({ data })
  } catch (error) {
    if (error instanceof RequestValidationError || error instanceof AuthError) {
      return jsonNoStore({ error: error.message }, { status: error.status })
    }
    return jsonNoStore({ error: 'Não foi possível carregar os dados.' }, { status: 500 })
  }
}
