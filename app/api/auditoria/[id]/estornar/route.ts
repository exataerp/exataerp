import { NextRequest, NextResponse } from "next/server"
import { AUDIT_PERMISSIONS, validateReversalReason } from "@/lib/audit"
import {
  auditErrorResponse,
  createUserScopedSupabase,
  requireAuditPermission,
} from "@/lib/audit-auth"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const body = await request.json()
    const empresaId = typeof body.empresaId === "string" ? body.empresaId.trim() : ""
    const motivoCodigo = typeof body.motivoCodigo === "string" ? body.motivoCodigo.trim() : ""
    const motivoDescricao = typeof body.motivoDescricao === "string" ? body.motivoDescricao.trim() : ""
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : ""

    if (!empresaId || !idempotencyKey || body.confirmacao !== true) {
      return NextResponse.json(
        { error: "Tenant, confirmação final e chave de idempotência são obrigatórios." },
        { status: 400 },
      )
    }

    const reasonError = validateReversalReason(motivoCodigo, motivoDescricao)
    if (reasonError) {
      return NextResponse.json({ error: reasonError }, { status: 400 })
    }

    const auditContext = await requireAuditPermission(request, AUDIT_PERMISSIONS.REVERSE, empresaId)
    const supabase = createUserScopedSupabase(request)
    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null
    const { data, error } = await supabase.rpc("estornar_apontamento_auditoria", {
      p_empresa_id: empresaId,
      p_apontamento_id: id,
      p_motivo_codigo: motivoCodigo,
      p_motivo_descricao: motivoDescricao || null,
      p_idempotency_key: idempotencyKey,
      p_ip_address: forwardedFor,
      p_session_id: request.headers.get("x-vercel-id") || null,
    })

    if (error) {
      await supabaseAdmin.from("audit_logs").insert({
        tenant_id: empresaId,
        entity_type: "apontamento_producao",
        entity_id: id,
        action: "reversal_failed",
        module: "producao",
        original_record_id: id,
        performed_by: auditContext.authUserId,
        reason_code: motivoCodigo,
        reason_description: motivoDescricao || null,
        metadata: {
          error: error.message,
          idempotency_key: idempotencyKey,
          source: "api_auditoria",
        },
        ip_address: forwardedFor,
        session_id: request.headers.get("x-vercel-id") || null,
      })
      throw new Error(error.message)
    }
    const status = data?.success ? 200 : data?.code === "already_reversed" ? 409 : 422
    return NextResponse.json(data, { status })
  } catch (error) {
    const response = auditErrorResponse(error)
    return NextResponse.json(response.body, { status: response.status })
  }
}
