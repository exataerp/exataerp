export const ORDER_WITH_POINTINGS_MESSAGE =
  "Esta Ordem de Produção não pode ser excluída porque possui apontamentos de produção relacionados. Para excluir a OP, primeiro estorne ou exclua de forma auditada todos os apontamentos vinculados."

export interface OrderPointingForDeletion {
  id?: string | null
  ordem_id: string | null
  user_id?: string | null
  status?: string | null
  estado_operacao?: string | null
  finalizado_em?: string | null
  estornado_em?: string | null
  cronometro_inicio?: string | null
  created_at?: string | null
  updated_at?: string | null
  cronometro_total_segundos?: number | null
  pecas_produzidas?: number | null
  pecas_refugo?: number | null
  pecas_retrabalho?: number | null
}

export interface OrderDeletionContext {
  userNames?: ReadonlyMap<string, string>
  pauses?: ReadonlyArray<{ apontamento_id: string | null }>
  movements?: ReadonlyArray<{
    referencia_id?: string | null
    reversal_apontamento_id?: string | null
  }>
}

export interface OrderDeletionSummary {
  total: number
  active: number
  paused: number
  finalized: number
  reversed: number
  events: number
  users: string[]
  firstPointing: string | null
  lastPointing: string | null
  pauses: number
  scraps: number
  movements: number
  usesOee: boolean
}

export interface OrderDeletionCandidate {
  status?: string | null
  quantityProduced?: number
  quantityApproved?: number
  quantityStocked?: number
  summary: OrderDeletionSummary
}

export interface OrderDeletionDecision {
  blocked: boolean
  code: "OP_HAS_POINTINGS" | "OP_NOT_DRAFT" | "OP_HAS_OPERATIONAL_HISTORY" | null
  message: string | null
}

const DRAFT_STATUSES = new Set(["planejada", "aberta", "rascunho"])

function normalized(value?: string | null): string {
  return value?.trim().toLowerCase() ?? ""
}

export function summarizeOrderPointings(
  orderId: string,
  pointings: OrderPointingForDeletion[],
  events = 0,
  context: OrderDeletionContext = {},
): OrderDeletionSummary {
  const related = pointings.filter((item) => item.ordem_id === orderId)
  const pointingIds = new Set(related.flatMap((item) => item.id ? [item.id] : []))
  const dates = related.flatMap((item) => {
    const first = item.cronometro_inicio ?? item.created_at ?? item.updated_at
    const last = item.finalizado_em ?? item.updated_at ?? item.created_at
    return [first, last].filter((value): value is string => Boolean(value))
  }).sort()
  const users = [...new Set(related.flatMap((item) => {
    if (!item.user_id) return []
    return [context.userNames?.get(item.user_id) ?? item.user_id]
  }))].sort((a, b) => a.localeCompare(b, "pt-BR"))
  const pauses = context.pauses?.filter((pause) =>
    Boolean(pause.apontamento_id && pointingIds.has(pause.apontamento_id)),
  ).length ?? 0
  const movements = context.movements?.filter((movement) =>
    movement.referencia_id === orderId ||
    Boolean(movement.referencia_id && pointingIds.has(movement.referencia_id)) ||
    Boolean(movement.reversal_apontamento_id && pointingIds.has(movement.reversal_apontamento_id)),
  ).length ?? 0

  const summary = related.reduce<OrderDeletionSummary>((summary, item) => {
    const status = normalized(item.status)
    const operationState = normalized(item.estado_operacao)
    const active = [status, operationState].some((value) =>
      ["ativo", "em_andamento", "em_execucao"].includes(value),
    )
    const paused = [status, operationState].some((value) => value.startsWith("paus"))
    const finalized = !item.estornado_em && (
      Boolean(item.finalizado_em) ||
      ["finalizado", "finalizada", "concluido", "concluida", "encerrado", "encerrada", "parcial"].includes(status)
    )

    return {
      ...summary,
      total: summary.total + 1,
      active: summary.active + Number(active),
      paused: summary.paused + Number(paused),
      finalized: summary.finalized + Number(finalized),
      reversed: summary.reversed + Number(Boolean(item.estornado_em)),
      scraps: summary.scraps + Number(item.pecas_refugo ?? 0),
      usesOee: summary.usesOee || (
        !item.estornado_em && (
          Number(item.cronometro_total_segundos ?? 0) > 0 ||
          Number(item.pecas_produzidas ?? 0) > 0 ||
          Number(item.pecas_refugo ?? 0) > 0 ||
          Number(item.pecas_retrabalho ?? 0) > 0
        )
      ),
    }
  }, {
    total: 0,
    active: 0,
    paused: 0,
    finalized: 0,
    reversed: 0,
    events,
    users,
    firstPointing: dates.at(0) ?? null,
    lastPointing: dates.at(-1) ?? null,
    pauses,
    scraps: 0,
    movements,
    usesOee: false,
  })

  return summary
}

export function decideOrderDeletion(candidate: OrderDeletionCandidate): OrderDeletionDecision {
  if (candidate.summary.total > 0) {
    return { blocked: true, code: "OP_HAS_POINTINGS", message: ORDER_WITH_POINTINGS_MESSAGE }
  }

  if (!DRAFT_STATUSES.has(normalized(candidate.status))) {
    return {
      blocked: true,
      code: "OP_NOT_DRAFT",
      message: "Somente uma OP em rascunho, nunca iniciada e sem histórico pode ser excluída.",
    }
  }

  if (
    candidate.summary.events > 0 ||
    (candidate.quantityProduced ?? 0) !== 0 ||
    (candidate.quantityApproved ?? 0) !== 0 ||
    (candidate.quantityStocked ?? 0) !== 0
  ) {
    return {
      blocked: true,
      code: "OP_HAS_OPERATIONAL_HISTORY",
      message: "A OP possui efeitos operacionais ou histórico e não pode ser excluída.",
    }
  }

  return { blocked: false, code: null, message: null }
}
