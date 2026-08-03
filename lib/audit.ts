export const AUDIT_PERMISSIONS = {
  VIEW: "auditoria.visualizar",
  REVERSE: "auditoria.estornar",
  EXPORT: "auditoria.exportar",
  VIEW_DETAILS: "auditoria.visualizar_detalhes",
  VIEW_SENSITIVE_VALUES: "auditoria.visualizar_valores_sensiveis",
} as const

export type AuditPermission = typeof AUDIT_PERMISSIONS[keyof typeof AUDIT_PERMISSIONS]

export const ALL_AUDIT_PERMISSIONS: AuditPermission[] = Object.values(AUDIT_PERMISSIONS)

export const REVERSAL_REASONS = [
  { value: "quantidade_incorreta", label: "Quantidade lançada incorretamente" },
  { value: "op_incorreta", label: "OP selecionada incorretamente" },
  { value: "produto_incorreto", label: "Produto incorreto" },
  { value: "operacao_incorreta", label: "Operação incorreta" },
  { value: "lancamento_duplicado", label: "Lançamento duplicado" },
  { value: "operador_incorreto", label: "Operador incorreto" },
  { value: "maquina_incorreta", label: "Máquina incorreta" },
  { value: "refugo_incorreto", label: "Refugo lançado incorretamente" },
  { value: "erro_sistema", label: "Erro de sistema" },
  { value: "outro", label: "Outro" },
] as const

export const INVALID_OPERATIONAL_STATUSES = new Set([
  "cancelado",
  "cancelada",
  "estornado",
])

export function isValidOperationalEntry(status: string | null | undefined) {
  return !status || !INVALID_OPERATIONAL_STATUSES.has(status)
}

export function validateReversalReason(reasonCode: string, description?: string | null) {
  if (!reasonCode.trim()) return "Informe o motivo da exclusão."
  if (reasonCode === "outro" && !description?.trim()) {
    return "Descreva o motivo quando a opção Outro for selecionada."
  }
  return null
}

export interface StockEffect {
  id: string
  type: "entrada" | "entrada_producao" | "saida" | "saida_producao"
  quantity: number
  currentBalance: number
}

export interface ReversalStockEffect extends StockEffect {
  reversalType: "estorno_saida" | "estorno_entrada"
  resultingBalance: number
}

export function planStockReversal(effects: StockEffect[]): {
  blocked: boolean
  dependencies: StockEffect[]
  effects: ReversalStockEffect[]
} {
  const dependencies = effects.filter(effect =>
    (effect.type === "entrada" || effect.type === "entrada_producao")
    && effect.currentBalance < effect.quantity,
  )

  if (dependencies.length > 0) {
    return { blocked: true, dependencies, effects: [] }
  }

  return {
    blocked: false,
    dependencies: [],
    effects: effects.map(effect => {
      const isIncoming = effect.type === "entrada" || effect.type === "entrada_producao"
      return {
        ...effect,
        reversalType: isIncoming ? "estorno_saida" : "estorno_entrada",
        resultingBalance: isIncoming
          ? effect.currentBalance - effect.quantity
          : effect.currentBalance + effect.quantity,
      }
    }),
  }
}
