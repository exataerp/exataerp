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

export type IntervaloProgramadoRuntime = {
  id: string
  schedule_id: string
  name: string
  start_time: string
  end_time: string
  days_of_week: string[]
  pause_operations_automatically: boolean
  is_active: boolean
  execution_order?: number | null
}

export type TurnoProgramadoRuntime = {
  id: string
  hora_inicio: string
  hora_fim: string
  pausar_ops_intervalos: boolean
  intervalos: IntervaloProgramadoRuntime[]
}

export type OcorrenciaIntervaloProgramado = {
  intervaloId: string
  turnoId: string
  nome: string
  dataJornada: string
  inicio: Date
  fim: Date
  timezone: string
}

function minutosDoHorario(horario: string): number {
  const [hora = "0", minuto = "0"] = horario.split(":")
  return Number(hora) * 60 + Number(minuto)
}

function partesNoFuso(momento: Date, timezone: string) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(momento)

  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find(parte => parte.type === tipo)?.value ?? 0)

  return {
    ano: valor("year"),
    mes: valor("month"),
    dia: valor("day"),
    hora: valor("hour"),
    minuto: valor("minute"),
    segundo: valor("second"),
  }
}

function dataIsoLocal(partes: { ano: number; mes: number; dia: number }) {
  return [
    String(partes.ano).padStart(4, "0"),
    String(partes.mes).padStart(2, "0"),
    String(partes.dia).padStart(2, "0"),
  ].join("-")
}

function adicionarDias(dataIso: string, dias: number): string {
  const [ano, mes, dia] = dataIso.split("-").map(Number)
  const data = new Date(Date.UTC(ano, mes - 1, dia + dias, 12))
  return data.toISOString().slice(0, 10)
}

function diaDaSemana(dataIso: string): string {
  return String(new Date(`${dataIso}T12:00:00.000Z`).getUTCDay())
}

// Converte uma data/hora civil no fuso da empresa para um instante UTC sem
// depender do fuso do servidor da Vercel. A segunda iteração cobre mudanças
// de offset (DST) próximas do horário informado.
function dataHoraLocalParaUtc(dataIso: string, horario: string, timezone: string): Date {
  const [ano, mes, dia] = dataIso.split("-").map(Number)
  const [hora = 0, minuto = 0, segundo = 0] = horario.split(":").map(Number)
  const civilComoUtc = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo)
  let candidato = civilComoUtc

  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    const local = partesNoFuso(new Date(candidato), timezone)
    const localComoUtc = Date.UTC(
      local.ano,
      local.mes - 1,
      local.dia,
      local.hora,
      local.minuto,
      local.segundo,
    )
    candidato += civilComoUtc - localComoUtc
  }

  return new Date(candidato)
}

export function resolverIntervaloProgramadoAtivo(input: {
  agora: Date
  timezone: string
  turnos: readonly TurnoProgramadoRuntime[]
  turnoPreferencialId?: string | null
}): OcorrenciaIntervaloProgramado | null {
  const local = partesNoFuso(input.agora, input.timezone)
  const dataLocal = dataIsoLocal(local)
  const minutoAtual = local.hora * 60 + local.minuto + local.segundo / 60

  const turnosOrdenados = [...input.turnos].sort((a, b) => {
    if (a.id === input.turnoPreferencialId) return -1
    if (b.id === input.turnoPreferencialId) return 1
    return minutosDoHorario(a.hora_inicio) - minutosDoHorario(b.hora_inicio)
  })

  for (const turno of turnosOrdenados) {
    if (!turno.pausar_ops_intervalos) continue

    const inicioTurno = minutosDoHorario(turno.hora_inicio)
    const fimTurno = minutosDoHorario(turno.hora_fim)
    const noturno = fimTurno <= inicioTurno
    const turnoAtivo = noturno
      ? minutoAtual >= inicioTurno || minutoAtual < fimTurno
      : minutoAtual >= inicioTurno && minutoAtual < fimTurno

    if (!turnoAtivo) continue

    const dataJornada = noturno && minutoAtual < fimTurno
      ? adicionarDias(dataLocal, -1)
      : dataLocal
    const diaJornada = diaDaSemana(dataJornada)
    const minutoAtualNaJornada = noturno && minutoAtual < fimTurno
      ? minutoAtual + 24 * 60
      : minutoAtual

    const intervalos = [...turno.intervalos].sort((a, b) => {
      const ordem = (a.execution_order ?? 0) - (b.execution_order ?? 0)
      return ordem || minutosDoHorario(a.start_time) - minutosDoHorario(b.start_time)
    })

    for (const intervalo of intervalos) {
      if (!intervalo.is_active || !intervalo.pause_operations_automatically) continue
      // Os dias escolhidos no próprio intervalo são a intenção explícita
      // do usuário, inclusive quando o turno-base não lista aquele dia.
      if (!intervalo.days_of_week.includes(diaJornada)) continue

      const inicioIntervalo = minutosDoHorario(intervalo.start_time)
      const fimIntervalo = minutosDoHorario(intervalo.end_time)
      const inicioNaJornada = noturno && inicioIntervalo < inicioTurno
        ? inicioIntervalo + 24 * 60
        : inicioIntervalo
      let fimNaJornada = inicioNaJornada + (fimIntervalo - inicioIntervalo)
      if (fimNaJornada <= inicioNaJornada) fimNaJornada += 24 * 60

      if (minutoAtualNaJornada < inicioNaJornada || minutoAtualNaJornada >= fimNaJornada) {
        continue
      }

      const dataInicio = noturno && inicioIntervalo < inicioTurno
        ? adicionarDias(dataJornada, 1)
        : dataJornada
      const dataFim = fimIntervalo <= inicioIntervalo
        ? adicionarDias(dataInicio, 1)
        : dataInicio

      return {
        intervaloId: intervalo.id,
        turnoId: turno.id,
        nome: intervalo.name,
        dataJornada,
        inicio: dataHoraLocalParaUtc(dataInicio, intervalo.start_time, input.timezone),
        fim: dataHoraLocalParaUtc(dataFim, intervalo.end_time, input.timezone),
        timezone: input.timezone,
      }
    }
  }

  return null
}
