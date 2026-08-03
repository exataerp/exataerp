import { NextRequest, NextResponse } from "next/server"
import {
  AUDIT_PERMISSIONS,
  auditModuleLabel,
  auditReasonLabel,
  auditStatusLabel,
  auditTypeLabel,
} from "@/lib/audit"
import {
  auditErrorResponse,
  createUserScopedSupabase,
  requireAuditPermission,
} from "@/lib/audit-auth"

export const dynamic = "force-dynamic"

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function nullable(params: URLSearchParams, name: string) {
  return params.get(name)?.trim() || null
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const empresaId = nullable(params, "empresaId")
    if (!empresaId) {
      return NextResponse.json({ error: "Tenant obrigatório." }, { status: 400 })
    }

    await requireAuditPermission(request, AUDIT_PERMISSIONS.EXPORT, empresaId)
    const supabase = createUserScopedSupabase(request)
    const rpcFilters = {
      p_empresa_id: empresaId,
      p_page_size: 500,
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
    }

    const items: Record<string, unknown>[] = []
    const exportLimit = 10_000
    let currentPage = 1
    let totalPages = 1
    do {
      const { data, error } = await supabase.rpc("listar_auditoria_sistema", {
        ...rpcFilters,
        p_page: currentPage,
      })
      if (error) throw new Error(error.message)
      items.push(...((data?.items ?? []) as Record<string, unknown>[]))
      totalPages = Number(data?.pagination?.total_pages || 1)
      currentPage += 1
    } while (currentPage <= totalPages && items.length < exportLimit)

    const headers = [
      "Identificador", "Data e hora", "Tipo", "Módulo", "Usuário",
      "Operador", "OP", "Produto", "Descrição do produto", "Operação",
      "Máquina", "Quantidade", "Aprovadas", "Refugadas", "Status",
      "Administrador do estorno", "Motivo", "Descrição do motivo", "Data do estorno",
    ]
    const rows = items.map(item => [
      item.id, item.lancamento_em, auditTypeLabel(item.tipo_lancamento), auditModuleLabel(item.modulo),
      item.usuario_nome, item.operador_nome, item.numero_op, item.produto_codigo,
      item.produto_descricao, item.operacao_nome,
      [item.maquina_codigo, item.maquina_nome].filter(Boolean).join(" - "),
      item.quantidade_lancada, item.quantidade_aprovada, item.quantidade_refugada,
      auditStatusLabel(item.status_atual), item.estornado_por_nome, auditReasonLabel(item.motivo_estorno_codigo),
      item.motivo_estorno_descricao, item.estornado_em,
    ])

    const csv = `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(";")).join("\r\n")}`
    const filename = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "x-exported-records": String(items.length),
        "x-export-limit": String(exportLimit),
      },
    })
  } catch (error) {
    const response = auditErrorResponse(error)
    return NextResponse.json(response.body, { status: response.status })
  }
}
