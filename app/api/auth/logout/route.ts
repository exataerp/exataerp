import { assertAllowedOrigin, jsonNoStore, RequestValidationError } from '@/lib/auth-http'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    assertAllowedOrigin(request)
    const client = await createClient()
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) throw error
    return jsonNoStore({ success: true })
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return jsonNoStore({ error: 'Requisição inválida.' }, { status: error.status })
    }
    return jsonNoStore({ error: 'Não foi possível sair.' }, { status: 500 })
  }
}
