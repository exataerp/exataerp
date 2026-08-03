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

const AUDIT_ACTION_LABELS: Record<string, string> = {
  created: "Lançamento criado",
  start: "Apontamento iniciado",
  production_report_finalized: "Apontamento de produção finalizado",
  production_report_reversed: "Apontamento de produção estornado",
  production_order_reopened: "Ordem de produção reaberta",
  reversed: "Lançamento estornado",
  deleted_logically: "Exclusão lógica do lançamento",
  reversal_blocked: "Estorno bloqueado",
  reversal_failed: "Falha ao estornar lançamento",
  legacy_metadata_backfilled: "Metadados históricos recuperados",
  scheduled_break: "Intervalo programado",
  scheduled_break_override: "Retomada antecipada do intervalo",
  override_scheduled_break: "Intervalo programado ignorado",
  manual_stop: "Parada manual",
  early_resume: "Retomada antecipada",
}

const AUDIT_MODULE_LABELS: Record<string, string> = {
  producao: "Produção",
  production: "Produção",
  estoque: "Estoque",
  inventory: "Estoque",
  auditoria: "Auditoria",
  audit: "Auditoria",
  sistema: "Sistema",
  system: "Sistema",
}

const AUDIT_TYPE_LABELS: Record<string, string> = {
  apontamento: "Apontamento",
  apontamento_producao: "Apontamento de produção",
  ordem_producao: "Ordem de produção",
  movimentacao_estoque: "Movimentação de estoque",
}

const AUDIT_ORIGIN_LABELS: Record<string, string> = {
  operador: "Operador",
  operator: "Operador",
  operator_screen: "Tela do operador",
  administrador: "Administrador",
  administrator: "Administrador",
  sistema: "Sistema",
  system: "Sistema",
  pg_cron: "Automação do sistema",
  database_rule: "Regra do sistema",
  producao: "Produção",
  production: "Produção",
  auditoria: "Auditoria",
  audit: "Auditoria",
  user_override: "Ação do usuário",
}

const STOCK_MOVEMENT_LABELS: Record<string, string> = {
  entrada: "Entrada",
  entrada_producao: "Entrada de produção",
  saida: "Saída",
  saida_producao: "Saída de produção",
  estorno_entrada: "Estorno (entrada)",
  estorno_saida: "Estorno (saída)",
}

const AUDIT_STATUS_LABELS: Record<string, string> = {
  ativo: "Ativo",
  estornado: "Estornado",
  corrigido: "Corrigido",
  cancelado: "Cancelado",
  cancelada: "Cancelado",
  em_andamento: "Em andamento",
  aberto: "Aberto",
  fechado: "Fechado",
  finalizado: "Finalizado",
  finalizada: "Finalizada",
}

function normalizedCode(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

export function auditActionLabel(value: unknown) {
  return AUDIT_ACTION_LABELS[normalizedCode(value)] ?? "Evento registrado pelo sistema"
}

export function auditModuleLabel(value: unknown) {
  return AUDIT_MODULE_LABELS[normalizedCode(value)] ?? "Sistema"
}

export function auditTypeLabel(value: unknown) {
  return AUDIT_TYPE_LABELS[normalizedCode(value)] ?? "Registro do sistema"
}

export function auditOriginLabel(value: unknown) {
  return AUDIT_ORIGIN_LABELS[normalizedCode(value)] ?? "Sistema"
}

export function stockMovementLabel(value: unknown) {
  return STOCK_MOVEMENT_LABELS[normalizedCode(value)] ?? "Movimentação de estoque"
}

export function auditStatusLabel(value: unknown) {
  return AUDIT_STATUS_LABELS[normalizedCode(value)] ?? "Não informado"
}

export function auditReasonLabel(value: unknown) {
  const text = String(value ?? "").trim()
  if (!text) return "Não informado"

  const configuredReason = REVERSAL_REASONS.find(reason => reason.value === text)
  if (configuredReason) return configuredReason.label

  return text.includes("_") ? "Motivo registrado no sistema" : text
}

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
