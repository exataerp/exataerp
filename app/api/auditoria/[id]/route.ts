import { NextRequest, NextResponse } from "next/server"
import { AUDIT_PERMISSIONS } from "@/lib/audit"
import {
  auditErrorResponse,
  createUserScopedSupabase,
  requireAuditPermission,
} from "@/lib/audit-auth"

export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const empresaId = request.nextUrl.searchParams.get("empresaId")?.trim()
    if (!empresaId) {
      return NextResponse.json({ error: "Tenant obrigatório." }, { status: 400 })
    }

    await requireAuditPermission(request, AUDIT_PERMISSIONS.VIEW_DETAILS, empresaId)
    const supabase = createUserScopedSupabase(request)
    const { data, error } = await supabase.rpc("obter_detalhes_auditoria", {
      p_empresa_id: empresaId,
      p_lancamento_id: id,
    })

    if (error) throw new Error(error.message)
    return NextResponse.json(data)
  } catch (error) {
    const response = auditErrorResponse(error)
    return NextResponse.json(response.body, { status: response.status })
  }
}
