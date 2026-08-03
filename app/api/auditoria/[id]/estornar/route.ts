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

    // Registros concluídos antes da coluna finalizado_em existir eram exibidos
    // como legados e o botão ficava bloqueado. Completar somente esses
    // metadados é seguro: o estorno abaixo continuará compensando apenas as
    // movimentações de estoque explicitamente vinculadas ao apontamento.
    const { data: legacyEntry, error: legacyLookupError } = await supabaseAdmin
      .from("apontamentos")
      .select("id, user_id, status, created_at, updated_at, finalizado_em, estornado_em, ordem_id, operacao_id, pecas_produzidas")
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .maybeSingle()

    if (legacyLookupError) throw new Error(legacyLookupError.message)

    if (
      legacyEntry
      && !legacyEntry.finalizado_em
      && !legacyEntry.estornado_em
      && !["em_andamento", "cancelado", "cancelada"].includes(legacyEntry.status)
      && legacyEntry.ordem_id
      && legacyEntry.operacao_id
      && Number(legacyEntry.pecas_produzidas || 0) > 0
    ) {
      const finalizadoEmEstimado = legacyEntry.updated_at || legacyEntry.created_at
      const { data: backfilledEntry, error: backfillError } = await supabaseAdmin
        .from("apontamentos")
        .update({
          finalizado_em: finalizadoEmEstimado,
          finalizado_por: legacyEntry.user_id,
        })
        .eq("id", id)
        .eq("empresa_id", empresaId)
        .is("finalizado_em", null)
        .select("id, finalizado_em, finalizado_por")
        .maybeSingle()

      if (backfillError) throw new Error(backfillError.message)

      if (backfilledEntry) {
        const { error: backfillAuditError } = await supabaseAdmin.from("audit_logs").insert({
          tenant_id: empresaId,
          entity_type: "apontamento_producao",
          entity_id: id,
          action: "legacy_metadata_backfilled",
          module: "producao",
          original_record_id: id,
          performed_by: auditContext.authUserId,
          old_values: { finalizado_em: null, finalizado_por: null },
          new_values: {
            finalizado_em: backfilledEntry.finalizado_em,
            finalizado_por: backfilledEntry.finalizado_por,
          },
          metadata: {
            source: "api_auditoria",
            stock_policy: "reverter_somente_movimentacoes_explicitamente_vinculadas",
          },
          ip_address: forwardedFor,
          session_id: request.headers.get("x-vercel-id") || null,
        })

        if (backfillAuditError) throw new Error(backfillAuditError.message)
      }
    }

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
