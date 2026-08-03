import { NextResponse } from "next/server"

import {
  resolverIntervaloProgramadoAtivo,
  type IntervaloProgramadoRuntime,
  type TurnoProgramadoRuntime,
} from "@/lib/scheduled-break-policy"
import { AuthError, getUserFromToken, supabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

type ApontamentoAtivo = {
  id: string
  empresa_id: string
  user_id: string
  ordem_id: string
  operacao_id: string | null
  maquina_id: string
  status: string
  estado_operacao: string
  cronometro_inicio: string | null
  cronometro_total_segundos: number | null
  intervalo_programado_evento_id: string | null
}

type EventoProgramado = {
  id: string
  started_at: string
  scheduled_end_at: string | null
  ended_at: string | null
}

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

function erroBanco(contexto: string, erro: { message: string; code?: string } | null) {
  if (erro) throw new Error(`${contexto}: ${erro.message}`)
}

async function obterMotivoIntervaloProgramado(empresaId: string): Promise<string> {
  let { data: grupo, error: erroGrupo } = await supabaseAdmin
    .from("excecao_grupos")
    .select("id")
    .eq("empresa_id", empresaId)
    .ilike("nome", "Paradas Programadas")
    .order("created_at")
    .limit(1)
    .maybeSingle()

  erroBanco("Falha ao consultar o grupo de parada programada", erroGrupo)

  if (!grupo) {
    const resultado = await supabaseAdmin
      .from("excecao_grupos")
      .insert({ empresa_id: empresaId, nome: "Paradas Programadas" })
      .select("id")
      .single()
    erroBanco("Falha ao criar o grupo de parada programada", resultado.error)
    grupo = resultado.data
  }

  const grupoId = grupo?.id
  if (!grupoId) throw new Error("Grupo de parada programada não encontrado.")

  let { data: subgrupo, error: erroSubgrupo } = await supabaseAdmin
    .from("excecao_subgrupos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("grupo_id", grupoId)
    .ilike("nome", "Intervalo Programado")
    .order("created_at")
    .limit(1)
    .maybeSingle()

  erroBanco("Falha ao consultar o motivo do intervalo", erroSubgrupo)

  if (!subgrupo) {
    const resultado = await supabaseAdmin
      .from("excecao_subgrupos")
      .insert({ empresa_id: empresaId, grupo_id: grupoId, nome: "Intervalo Programado" })
      .select("id")
      .single()
    erroBanco("Falha ao criar o motivo do intervalo", resultado.error)
    subgrupo = resultado.data
  }

  const subgrupoId = subgrupo?.id
  if (!subgrupoId) throw new Error("Motivo de intervalo programado não encontrado.")
  return subgrupoId
}

async function encerrarIntervaloSeNecessario(
  apontamento: ApontamentoAtivo,
  agora: Date,
) {
  if (
    apontamento.estado_operacao !== "pausada_intervalo_programado"
    || !apontamento.intervalo_programado_evento_id
  ) {
    return null
  }

  const { data, error } = await supabaseAdmin
    .from("production_order_events")
    .select("id, started_at, scheduled_end_at, ended_at")
    .eq("id", apontamento.intervalo_programado_evento_id)
    .eq("tenant_id", apontamento.empresa_id)
    .eq("apontamento_id", apontamento.id)
    .eq("event_type", "scheduled_break")
    .maybeSingle()

  erroBanco("Falha ao consultar o intervalo em andamento", error)
  const evento = data as EventoProgramado | null
  if (!evento?.scheduled_end_at || new Date(evento.scheduled_end_at) > agora) {
    return {
      alterado: false,
      estado: apontamento.estado_operacao,
      total_segundos: apontamento.cronometro_total_segundos ?? 0,
    }
  }

  const fim = evento.scheduled_end_at
  const duracao = Math.max(
    0,
    Math.floor((new Date(fim).getTime() - new Date(evento.started_at).getTime()) / 1000),
  )
  const resultadoEvento = await supabaseAdmin
    .from("production_order_events")
    .update({ ended_at: evento.ended_at ?? fim, duration_seconds: duracao })
    .eq("id", evento.id)
  erroBanco("Falha ao encerrar o evento do intervalo", resultadoEvento.error)

  const resultadoPausa = await supabaseAdmin
    .from("apontamento_pausas")
    .update({ fim })
    .eq("scheduled_event_id", evento.id)
    .is("fim", null)
  erroBanco("Falha ao encerrar a pausa programada", resultadoPausa.error)

  const resultadoApontamento = await supabaseAdmin
    .from("apontamentos")
    .update({ estado_operacao: "aguardando_retomada" })
    .eq("id", apontamento.id)
    .eq("estado_operacao", "pausada_intervalo_programado")
    .eq("intervalo_programado_evento_id", evento.id)
  erroBanco("Falha ao liberar a retomada da operação", resultadoApontamento.error)

  return {
    alterado: true,
    estado: "aguardando_retomada",
    total_segundos: apontamento.cronometro_total_segundos ?? 0,
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUserFromToken(request)
    const body: unknown = await request.json().catch(() => null)
    const empresaId = body && typeof body === "object" && "empresaId" in body
      ? String(body.empresaId)
      : ""
    const apontamentoId = body && typeof body === "object" && "apontamentoId" in body
      ? String(body.apontamentoId)
      : ""

    if (!empresaId || !apontamentoId) {
      return json({ error: "Empresa e apontamento são obrigatórios." }, 400)
    }

    const { data, error } = await supabaseAdmin
      .from("apontamentos")
      .select("id, empresa_id, user_id, ordem_id, operacao_id, maquina_id, status, estado_operacao, cronometro_inicio, cronometro_total_segundos, intervalo_programado_evento_id")
      .eq("id", apontamentoId)
      .eq("empresa_id", empresaId)
      .eq("user_id", user.id)
      .maybeSingle()

    erroBanco("Falha ao consultar o apontamento", error)
    const apontamento = data as ApontamentoAtivo | null
    if (!apontamento) return json({ error: "Apontamento não encontrado." }, 404)

    if (apontamento.status !== "em_andamento") {
      return json({ alterado: false, estado: apontamento.estado_operacao })
    }

    const agora = new Date()
    const encerramento = await encerrarIntervaloSeNecessario(apontamento, agora)
    if (encerramento) return json(encerramento)

    if (apontamento.estado_operacao !== "em_execucao" || !apontamento.cronometro_inicio) {
      return json({ alterado: false, estado: apontamento.estado_operacao })
    }

    const [empresaResultado, maquinaResultado, turnosResultado] = await Promise.all([
      supabaseAdmin.from("empresas").select("timezone").eq("id", empresaId).single(),
      supabaseAdmin.from("maquinas").select("turno_id").eq("id", apontamento.maquina_id).maybeSingle(),
      supabaseAdmin
        .from("turnos")
        .select("id, hora_inicio, hora_fim, pausar_ops_intervalos")
        .eq("empresa_id", empresaId)
        .eq("ativo", true),
    ])

    erroBanco("Falha ao consultar o fuso da empresa", empresaResultado.error)
    erroBanco("Falha ao consultar o posto de trabalho", maquinaResultado.error)
    erroBanco("Falha ao consultar os turnos", turnosResultado.error)

    const turnosBase = (turnosResultado.data ?? []) as Omit<TurnoProgramadoRuntime, "intervalos">[]
    if (turnosBase.length === 0) return json({ alterado: false, estado: "em_execucao" })

    const { data: intervalosData, error: intervalosErro } = await supabaseAdmin
      .from("work_schedule_breaks")
      .select("id, schedule_id, name, start_time, end_time, days_of_week, pause_operations_automatically, is_active, execution_order")
      .eq("tenant_id", empresaId)
      .in("schedule_id", turnosBase.map(turno => turno.id))
      .eq("is_active", true)
      .eq("pause_operations_automatically", true)

    erroBanco("Falha ao consultar os intervalos", intervalosErro)
    const intervalos = (intervalosData ?? []) as IntervaloProgramadoRuntime[]
    const turnos: TurnoProgramadoRuntime[] = turnosBase.map(turno => ({
      ...turno,
      intervalos: intervalos.filter(intervalo => intervalo.schedule_id === turno.id),
    }))
    const timezone = empresaResultado.data?.timezone || "America/Sao_Paulo"
    const ocorrencia = resolverIntervaloProgramadoAtivo({
      agora,
      timezone,
      turnos,
      turnoPreferencialId: maquinaResultado.data?.turno_id,
    })

    if (!ocorrencia) return json({ alterado: false, estado: "em_execucao" })

    const { data: override, error: overrideErro } = await supabaseAdmin
      .from("production_order_events")
      .select("id")
      .eq("tenant_id", empresaId)
      .eq("apontamento_id", apontamentoId)
      .eq("schedule_break_id", ocorrencia.intervaloId)
      .eq("schedule_date", ocorrencia.dataJornada)
      .eq("event_type", "scheduled_break_override")
      .contains("metadata", { action: "start" })
      .limit(1)
      .maybeSingle()

    erroBanco("Falha ao consultar a autorização do intervalo", overrideErro)
    if (override) return json({ alterado: false, estado: "em_execucao" })

    const subgrupoId = await obterMotivoIntervaloProgramado(empresaId)
    const inicioIso = ocorrencia.inicio.toISOString()
    const fimIso = ocorrencia.fim.toISOString()
    const eventoNovo = await supabaseAdmin
      .from("production_order_events")
      .insert({
        tenant_id: empresaId,
        production_order_id: apontamento.ordem_id,
        operation_id: apontamento.operacao_id,
        workstation_id: apontamento.maquina_id,
        machine_id: apontamento.maquina_id,
        operator_id: apontamento.user_id,
        apontamento_id: apontamento.id,
        schedule_break_id: ocorrencia.intervaloId,
        schedule_date: ocorrencia.dataJornada,
        event_type: "scheduled_break",
        event_category: "planned_stop",
        source: "system",
        started_at: inicioIso,
        scheduled_end_at: fimIso,
        is_scheduled: true,
        exclude_from_machine_downtime: true,
        metadata: {
          break_name: ocorrencia.nome,
          schedule_id: ocorrencia.turnoId,
          timezone,
          processed_at: agora.toISOString(),
          trigger: "operator_screen_api",
          scheduled_duration_seconds: Math.max(
            0,
            Math.floor((ocorrencia.fim.getTime() - ocorrencia.inicio.getTime()) / 1000),
          ),
        },
      })
      .select("id")
      .single()

    let eventoId = eventoNovo.data?.id as string | undefined
    if (eventoNovo.error?.code === "23505") {
      const existente = await supabaseAdmin
        .from("production_order_events")
        .select("id")
        .eq("tenant_id", empresaId)
        .eq("apontamento_id", apontamentoId)
        .eq("schedule_break_id", ocorrencia.intervaloId)
        .eq("schedule_date", ocorrencia.dataJornada)
        .eq("event_type", "scheduled_break")
        .single()
      erroBanco("Falha ao recuperar o evento do intervalo", existente.error)
      eventoId = existente.data?.id
    } else {
      erroBanco("Falha ao registrar o evento do intervalo", eventoNovo.error)
    }

    if (!eventoId) return json({ alterado: false, estado: "em_execucao" })

    const inicioCronometro = new Date(apontamento.cronometro_inicio).getTime()
    const decorrido = Number.isFinite(inicioCronometro)
      ? Math.max(0, Math.floor((ocorrencia.inicio.getTime() - inicioCronometro) / 1000))
      : 0
    const totalSegundos = (apontamento.cronometro_total_segundos ?? 0) + decorrido
    const atualizacao = await supabaseAdmin
      .from("apontamentos")
      .update({
        cronometro_total_segundos: totalSegundos,
        cronometro_inicio: null,
        estado_operacao: "pausada_intervalo_programado",
        intervalo_programado_evento_id: eventoId,
      })
      .eq("id", apontamentoId)
      .eq("empresa_id", empresaId)
      .eq("user_id", user.id)
      .eq("estado_operacao", "em_execucao")
      .eq("cronometro_inicio", apontamento.cronometro_inicio)
      .select("id")

    erroBanco("Falha ao pausar o apontamento", atualizacao.error)
    if (!atualizacao.data?.length) {
      return json({ alterado: false, estado: apontamento.estado_operacao })
    }

    const pausa = await supabaseAdmin
      .from("apontamento_pausas")
      .insert({
        empresa_id: empresaId,
        apontamento_id: apontamentoId,
        subgrupo_id: subgrupoId,
        inicio: inicioIso,
        event_type: "scheduled_break",
        event_category: "planned_stop",
        source: "system",
        is_scheduled: true,
        exclude_from_machine_downtime: true,
        scheduled_event_id: eventoId,
        metadata: {
          break_name: ocorrencia.nome,
          scheduled_end_at: fimIso,
          trigger: "operator_screen_api",
        },
      })

    if (pausa.error && pausa.error.code !== "23505") {
      console.error("Falha ao registrar o histórico da pausa programada:", pausa.error)
    }

    return json({
      alterado: true,
      estado: "pausada_intervalo_programado",
      total_segundos: totalSegundos,
      intervalo_inicio: inicioIso,
      intervalo_fim: fimIso,
      intervalo_nome: ocorrencia.nome,
    })
  } catch (erro: unknown) {
    if (erro instanceof AuthError) return json({ error: erro.message }, erro.status)
    const mensagem = erro instanceof Error ? erro.message : "Erro inesperado"
    console.error("Falha ao sincronizar intervalo programado:", erro)
    return json({ error: mensagem }, 500)
  }
}
