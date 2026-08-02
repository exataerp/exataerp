export type EstadoOperacao =
  | "em_execucao"
  | "pausada_manual"
  | "pausada_intervalo_programado"
  | "aguardando_retomada"
  | "finalizada"

export function temPermissaoOverrideIntervalo(roles: readonly string[]): boolean {
  return roles.includes("system_manager") || roles.includes("production_manager")
}

export function devePausarNoIntervalo(input: {
  statusApontamento: string
  estadoOperacao: EstadoOperacao
  turnoAutomatico: boolean
  intervaloAutomatico: boolean
  intervaloAtivo: boolean
  mesmaEmpresa: boolean
  overrideRegistrado?: boolean
}): boolean {
  return input.mesmaEmpresa
    && input.statusApontamento === "em_andamento"
    && input.estadoOperacao === "em_execucao"
    && input.turnoAutomatico
    && input.intervaloAutomatico
    && input.intervaloAtivo
    && !input.overrideRegistrado
}

export function avaliarAcaoDuranteIntervalo(input: {
  intervaloAtivo: boolean
  possuiPermissao: boolean
  overrideSolicitado?: boolean
  justificativa?: string | null
}) {
  if (!input.intervaloAtivo) return { permitido: true, exigeJustificativa: false }
  if (!input.overrideSolicitado) return { permitido: false, exigeJustificativa: false }
  if (!input.possuiPermissao) return { permitido: false, exigeJustificativa: false }

  const justificativaValida = (input.justificativa || "").trim().length >= 5
  return { permitido: justificativaValida, exigeJustificativa: !justificativaValida }
}

export function excluirDeParadaMaquina(evento: {
  event_type?: string
  is_scheduled?: boolean
  exclude_from_machine_downtime?: boolean
}): boolean {
  return evento.exclude_from_machine_downtime === true
    || evento.is_scheduled === true
    || evento.event_type === "scheduled_break"
    || evento.event_type === "scheduled_break_override"
}

export function chaveOcorrenciaIntervalo(
  tenantId: string,
  apontamentoId: string,
  intervaloId: string,
  dataJornada: string,
) {
  return [tenantId, apontamentoId, intervaloId, dataJornada, "scheduled_break"].join(":")
}
