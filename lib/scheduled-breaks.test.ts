import assert from "node:assert/strict"
import test from "node:test"

import {
  calcularSegundosDisponiveisTurno,
  calcularTempoProgramado,
  type TurnoProgramado,
} from "./report-calculations.ts"
import {
  avaliarAcaoDuranteIntervalo,
  chaveOcorrenciaIntervalo,
  devePausarNoIntervalo,
  excluirDeParadaMaquina,
  resolverIntervaloProgramadoAtivo,
} from "./scheduled-break-policy.ts"

const turnoDia: TurnoProgramado = {
  id: "turno-dia",
  hora_inicio: "08:00",
  hora_fim: "17:00",
  dias_semana: ["1", "2", "3", "4", "5"],
  ativo: true,
  work_schedule_breaks: [{
    start_time: "12:00",
    end_time: "13:00",
    days_of_week: ["1", "2", "3", "4", "5"],
    is_active: true,
  }],
}

test("1. OP em execução é elegível no início do intervalo", () => {
  assert.equal(devePausarNoIntervalo({
    statusApontamento: "em_andamento",
    estadoOperacao: "em_execucao",
    turnoAutomatico: true,
    intervaloAutomatico: true,
    intervaloAtivo: true,
    mesmaEmpresa: true,
  }), true)
})

test("2. OP já pausada não recebe nova pausa", () => {
  assert.equal(devePausarNoIntervalo({
    statusApontamento: "em_andamento",
    estadoOperacao: "pausada_manual",
    turnoAutomatico: true,
    intervaloAutomatico: true,
    intervaloAtivo: true,
    mesmaEmpresa: true,
  }), false)
})

test("3. OP finalizada não é processada", () => {
  assert.equal(devePausarNoIntervalo({
    statusApontamento: "fechado",
    estadoOperacao: "finalizada",
    turnoAutomatico: true,
    intervaloAutomatico: true,
    intervaloAtivo: true,
    mesmaEmpresa: true,
  }), false)
})

test("4. mais de uma OP elegível é avaliada independentemente", () => {
  const entradas = ["op-1", "op-2"].map(() => devePausarNoIntervalo({
    statusApontamento: "em_andamento",
    estadoOperacao: "em_execucao",
    turnoAutomatico: true,
    intervaloAutomatico: true,
    intervaloAtivo: true,
    mesmaEmpresa: true,
  }))
  assert.deepEqual(entradas, [true, true])
})

test("5. jornadas com intervalos diferentes descontam seus próprios horários", () => {
  const turnoCurto = { ...turnoDia, work_schedule_breaks: [{ ...turnoDia.work_schedule_breaks![0], end_time: "12:15" }] }
  assert.equal(calcularSegundosDisponiveisTurno(turnoDia, "1"), 8 * 3600)
  assert.equal(calcularSegundosDisponiveisTurno(turnoCurto, "1"), 8.75 * 3600)
})

test("6. turno noturno desconta intervalo depois da meia-noite", () => {
  assert.equal(calcularSegundosDisponiveisTurno({
    hora_inicio: "22:00",
    hora_fim: "06:00",
    work_schedule_breaks: [{ start_time: "02:00", end_time: "02:20", days_of_week: ["1"], is_active: true }],
  }, "1"), 7 * 3600 + 40 * 60)
})

test("7. intervalo que atravessa a meia-noite é calculado integralmente", () => {
  assert.equal(calcularSegundosDisponiveisTurno({
    hora_inicio: "20:00",
    hora_fim: "04:00",
    work_schedule_breaks: [{ start_time: "23:50", end_time: "00:10", days_of_week: ["5"], is_active: true }],
  }, "5"), 7 * 3600 + 40 * 60)
})

test("8. início de OP durante intervalo é bloqueado sem override", () => {
  assert.deepEqual(avaliarAcaoDuranteIntervalo({ intervaloAtivo: true, possuiPermissao: false }), {
    permitido: false,
    exigeJustificativa: false,
  })
})

test("9. retomada antecipada exige permissão e justificativa", () => {
  assert.deepEqual(avaliarAcaoDuranteIntervalo({
    intervaloAtivo: true,
    possuiPermissao: true,
    overrideSolicitado: true,
    justificativa: "x",
  }), { permitido: false, exigeJustificativa: true })
})

test("10. retomada normal é liberada após o intervalo", () => {
  assert.deepEqual(avaliarAcaoDuranteIntervalo({ intervaloAtivo: false, possuiPermissao: false }), {
    permitido: true,
    exigeJustificativa: false,
  })
})

test("11. chave idempotente é estável para a mesma ocorrência", () => {
  const chave = chaveOcorrenciaIntervalo("empresa", "apontamento", "intervalo", "2026-08-03")
  assert.equal(chave, chaveOcorrenciaIntervalo("empresa", "apontamento", "intervalo", "2026-08-03"))
})

test("12. intervalo programado é excluído dos relatórios de parada", () => {
  assert.equal(excluirDeParadaMaquina({ event_type: "scheduled_break", is_scheduled: true }), true)
})

test("13. tempo planejado subtrai intervalos ativos", () => {
  const resultado = calcularTempoProgramado(
    "2026-08-03T03:00:00.000Z",
    "2026-08-03T23:59:59.999Z",
    [turnoDia],
    undefined,
    undefined,
    "America/Sao_Paulo",
  )
  assert.equal(resultado.totalSegundos, 8 * 3600)
})

test("14. empresas diferentes não compartilham elegibilidade", () => {
  assert.equal(devePausarNoIntervalo({
    statusApontamento: "em_andamento",
    estadoOperacao: "em_execucao",
    turnoAutomatico: true,
    intervaloAutomatico: true,
    intervaloAtivo: true,
    mesmaEmpresa: false,
  }), false)
})

test("15. turno com automação desativada não pausa a OP", () => {
  assert.equal(devePausarNoIntervalo({
    statusApontamento: "em_andamento",
    estadoOperacao: "em_execucao",
    turnoAutomatico: false,
    intervaloAutomatico: true,
    intervaloAtivo: true,
    mesmaEmpresa: true,
  }), false)
})

test("intervalos inativos e sobrepostos não distorcem o tempo planejado", () => {
  assert.equal(calcularSegundosDisponiveisTurno({
    hora_inicio: "08:00",
    hora_fim: "17:00",
    work_schedule_breaks: [
      { start_time: "12:00", end_time: "13:00", days_of_week: ["2"], is_active: true },
      { start_time: "12:30", end_time: "13:30", days_of_week: ["2"], is_active: true },
      { start_time: "15:00", end_time: "16:00", days_of_week: ["2"], is_active: false },
    ],
  }, "2"), 7.5 * 3600)
})

test("17. intervalo no domingo respeita os dias escolhidos no intervalo", () => {
  const ocorrencia = resolverIntervaloProgramadoAtivo({
    agora: new Date("2026-08-02T23:46:00.000Z"), // domingo, 20:46 em Sao Paulo
    timezone: "America/Sao_Paulo",
    turnos: [{
      id: "turno-2",
      hora_inicio: "16:48",
      hora_fim: "02:24",
      pausar_ops_intervalos: true,
      intervalos: [{
        id: "intervalo-domingo",
        schedule_id: "turno-2",
        name: "Intervalo",
        start_time: "20:45",
        end_time: "20:50",
        days_of_week: ["0"],
        pause_operations_automatically: true,
        is_active: true,
      }],
    }],
  })

  assert.equal(ocorrencia?.dataJornada, "2026-08-02")
  assert.equal(ocorrencia?.inicio.toISOString(), "2026-08-02T23:45:00.000Z")
  assert.equal(ocorrencia?.fim.toISOString(), "2026-08-02T23:50:00.000Z")
})

test("18. intervalo apos meia-noite pertence ao dia inicial da jornada noturna", () => {
  const ocorrencia = resolverIntervaloProgramadoAtivo({
    agora: new Date("2026-08-04T05:05:00.000Z"), // terca 02:05, jornada iniciada na segunda
    timezone: "America/Sao_Paulo",
    turnos: [{
      id: "turno-noite",
      hora_inicio: "22:00",
      hora_fim: "06:00",
      pausar_ops_intervalos: true,
      intervalos: [{
        id: "intervalo-noite",
        schedule_id: "turno-noite",
        name: "Ceia",
        start_time: "02:00",
        end_time: "02:10",
        days_of_week: ["1"],
        pause_operations_automatically: true,
        is_active: true,
      }],
    }],
  })

  assert.equal(ocorrencia?.dataJornada, "2026-08-03")
  assert.equal(ocorrencia?.inicio.toISOString(), "2026-08-04T05:00:00.000Z")
  assert.equal(ocorrencia?.fim.toISOString(), "2026-08-04T05:10:00.000Z")
})
