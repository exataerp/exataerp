// ============================================================
// EXATA ERP — lib/supabase/admin.ts
// Client Supabase com service role — uso exclusivo em API Routes.
// NUNCA importar em componentes client-side.
// ============================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | undefined

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Configuração Supabase server-side ausente')
  client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return client
}

// Backward-compatible lazy facade. Merely importing this module never reads secrets.
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const initialized = getSupabaseAdmin()
    return Reflect.get(initialized, property, initialized)
  },
})

// ------------------------------------------------------------
// Helper: valida token Bearer e retorna o user ou lança erro
// Uso: const user = await getUserFromToken(request)
// ------------------------------------------------------------
export async function getUserFromToken(request: Request) {
  if(process.env.AUTH_USERNAME_ROLLOUT_ENABLED!=='true')throw new AuthError('Operação indisponível.',503)
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
    throw new AuthError('Acesso negado. É necessário ser Administrador do Sistema.', 403)
  }
}

// ------------------------------------------------------------
// Helper: verifica se usuário é Super Admin GLOBAL (dono do SaaS)
// Distinto de system_manager, que é escopado por empresa.
// Usado apenas no painel Master (gestão de todas as fábricas/clientes).
// ------------------------------------------------------------
export async function assertSuperAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('super_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !data) {
    throw new AuthError('Acesso negado. Super Admin necessário.', 403)
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
