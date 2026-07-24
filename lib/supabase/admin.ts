// ============================================================
// EXATA ERP — lib/supabase/admin.ts
// Client Supabase com service role — uso exclusivo em API Routes.
// NUNCA importar em componentes client-side.
// ============================================================
import { createClient } from '@supabase/supabase-js'

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL não definida')
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY não definida')
}

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

// ------------------------------------------------------------
// Helper: valida token Bearer e retorna o user ou lança erro
// Uso: const user = await getUserFromToken(request)
// ------------------------------------------------------------
export async function getUserFromToken(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('Token não fornecido', 401)
  }

  const token = authHeader.slice(7)
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)

  if (error || !user) {
    throw new AuthError('Token inválido ou expirado', 401)
  }

  return user
}

// ------------------------------------------------------------
// Helper: busca roles do usuário em uma empresa
// ------------------------------------------------------------
export async function getUserRoles(userId: string, empresaId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('v_user_roles')
    .select('role_name')
    .eq('user_id', userId)
    .eq('empresa_id', empresaId)

  if (error || !data) return []
  return data.map((r: any) => r.role_name)
}

// ------------------------------------------------------------
// Helper: verifica se usuário é System Manager na empresa
// ------------------------------------------------------------
export async function assertSystemManager(userId: string, empresaId: string) {
  const roles = await getUserRoles(userId, empresaId)
  if (!roles.includes('system_manager')) {
    throw new AuthError('Acesso negado. System Manager necessário.', 403)
  }
}

// ------------------------------------------------------------
// Erro tipado para respostas HTTP
// ------------------------------------------------------------
export class AuthError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'AuthError'
  }
}
