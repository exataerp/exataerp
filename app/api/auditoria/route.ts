import { NextRequest, NextResponse } from "next/server"
import { AUDIT_PERMISSIONS } from "@/lib/audit"
import {
  auditErrorResponse,
  createUserScopedSupabase,
  requireAuditPermission,
} from "@/lib/audit-auth"

export const dynamic = "force-dynamic"

function nullable(searchParams: URLSearchParams, name: string) {
  return searchParams.get(name)?.trim() || null
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const empresaId = nullable(params, "empresaId")
    if (!empresaId) {
      return NextResponse.json({ error: "Tenant obrigatório." }, { status: 400 })
    }

    await requireAuditPermission(request, AUDIT_PERMISSIONS.VIEW, empresaId)
    const supabase = createUserScopedSupabase(request)

    const page = Math.max(Number(params.get("page") || 1), 1)
    const pageSize = Math.min(Math.max(Number(params.get("pageSize") || 25), 1), 100)
    const { data, error } = await supabase.rpc("listar_auditoria_sistema", {
      p_empresa_id: empresaId,
      p_page: page,
      p_page_size: pageSize,
      p_periodo_inicio: nullable(params, "inicio"),
      p_periodo_fim: nullable(params, "fim"),
      p_usuario: nullable(params, "usuario"),
      p_operador: nullable(params, "operador"),
      p_modulo: nullable(params, "modulo"),
      p_tipo: nullable(params, "tipo"),
      p_status: nullable(params, "status"),
      p_ordem_producao: nullable(params, "op"),
      p_produto_codigo: nullable(params, "produtoCodigo"),
      p_produto_descricao: nullable(params, "produtoDescricao"),
      p_operacao: nullable(params, "operacao"),
      p_maquina: nullable(params, "maquina"),
      p_posto_trabalho: nullable(params, "posto"),
      p_search: nullable(params, "search"),
    })

    if (error) throw new Error(error.message)
    return NextResponse.json(data)
  } catch (error) {
    const response = auditErrorResponse(error)
    return NextResponse.json(response.body, { status: response.status })
  }
}
