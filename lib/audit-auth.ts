import { createClient } from "@supabase/supabase-js"
import { supabaseAdmin, getUserFromToken, AuthError } from "@/lib/supabase/admin"
import type { AuditPermission } from "@/lib/audit"

export interface AuditRequestContext {
  authUserId: string
  empresaId: string
  perfilId: string
  roles: string[]
  permissions: string[]
}

export async function requireAuditPermission(
  request: Request,
  permission: AuditPermission,
  requestedEmpresaId?: string | null,
): Promise<AuditRequestContext> {
  const user = await getUserFromToken(request)

  const { data: perfil, error: perfilError } = await supabaseAdmin
    .from("perfis")
    .select("id, empresa_id, status")
    .eq("user_id", user.id)
    .maybeSingle()

  if (perfilError || !perfil || perfil.status !== "ativo") {
    throw new AuthError("Perfil ativo não encontrado.", 403)
  }

  if (requestedEmpresaId && requestedEmpresaId !== perfil.empresa_id) {
    throw new AuthError("Acesso negado: o tenant solicitado não pertence à sessão.", 403)
  }

  const { data: roleLinks } = await supabaseAdmin
    .from("user_roles")
    .select("role_id")
    .eq("user_id", user.id)
    .eq("empresa_id", perfil.empresa_id)

  const roleIds = (roleLinks ?? []).map(link => link.role_id)
  const { data: rolesData } = roleIds.length > 0
    ? await supabaseAdmin.from("roles").select("id, name").in("id", roleIds)
    : { data: [] as { id: string; name: string }[] }

  const { data: rolePermissions } = roleIds.length > 0
    ? await supabaseAdmin
        .from("role_permissions")
        .select("permission_code")
        .in("role_id", roleIds)
    : { data: [] as { permission_code: string }[] }

  const { data: userPermissions } = await supabaseAdmin
    .from("user_permissions")
    .select("permission_code")
    .eq("tenant_id", perfil.empresa_id)
    .eq("user_id", user.id)

  const permissions = Array.from(new Set([
    ...(rolePermissions ?? []).map(item => item.permission_code),
    ...(userPermissions ?? []).map(item => item.permission_code),
  ]))

  if (!permissions.includes(permission)) {
    throw new AuthError("Acesso negado. Permissão de auditoria necessária.", 403)
  }

  return {
    authUserId: user.id,
    empresaId: perfil.empresa_id,
    perfilId: perfil.id,
    roles: (rolesData ?? []).map(role => role.name),
    permissions,
  }
}

export function createUserScopedSupabase(request: Request) {
  const authorization = request.headers.get("authorization")
  if (!authorization?.startsWith("Bearer ")) {
    throw new AuthError("Token não fornecido.", 401)
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authorization } },
    },
  )
}

export function auditErrorResponse(error: unknown) {
  const status = error instanceof AuthError ? error.status : 500
  const message = error instanceof Error ? error.message : "Erro interno na auditoria."
  return { status, body: { error: message } }
}
