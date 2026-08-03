import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

import {
  AUDIT_PERMISSIONS,
  auditActionLabel,
  auditModuleLabel,
  auditOriginLabel,
  auditReasonLabel,
  auditStatusLabel,
  auditTypeLabel,
  isValidOperationalEntry,
  planStockReversal,
  stockMovementLabel,
  validateReversalReason,
} from "./audit.ts"
import { ABAS, ROLES, podeAcessarAba } from "./permissions.ts"
import {
  calcularConsolidacaoOrdemProducao,
  consolidarOeeOrdens,
  type ApontamentoProducao,
} from "./production-flow.ts"

const migration = readFileSync(
  new URL("../supabase/migrations/20260803180000_auditoria_sistema_estorno_apontamentos.sql", import.meta.url),
  "utf8",
)

const legacyCompatibilityMigration = readFileSync(
  new URL("../supabase/migrations/20260803190000_libera_estorno_apontamentos_legados.sql", import.meta.url),
  "utf8",
)

const auditComponent = readFileSync(
  new URL("../components/auditoria-tab.tsx", import.meta.url),
  "utf8",
)

const reversalRoute = readFileSync(
  new URL("../app/api/auditoria/[id]/estornar/route.ts", import.meta.url),
  "utf8",
)

const apontamento = (
  id: string,
  quantidadeProcessada: number,
  quantidadeRefugo = 0,
  status = "fechado",
  operacaoId = "operacao-1",
): ApontamentoProducao => ({ id, operacaoId, quantidadeProcessada, quantidadeRefugo, status })

describe("Auditoria do Sistema", () => {
  it("cenário 1 — planeja o estorno simples sem deixar saldo residual", () => {
    const plano = planStockReversal([
      { id: "entrada-pa", type: "entrada", quantity: 10, currentBalance: 10 },
      { id: "saida-mp", type: "saida", quantity: 20, currentBalance: 80 },
    ])

    assert.equal(plano.blocked, false)
    assert.deepEqual(plano.effects.map(effect => effect.resultingBalance), [0, 100])
    assert.deepEqual(plano.effects.map(effect => effect.reversalType), ["estorno_saida", "estorno_entrada"])
  })

  it("cenário 2 — operação concluída volta a parcialmente concluída com 90 peças", () => {
    const resultado = calcularConsolidacaoOrdemProducao(100, [{ id: "operacao-1" }], [
      apontamento("valido-50", 50),
      apontamento("estornado-10", 10, 0, "cancelado"),
      apontamento("valido-40", 40),
    ])

    assert.equal(resultado.quantidadeProcessada, 90)
    assert.equal(resultado.operacoes[0].status, "parcialmente_concluida")
    assert.equal(resultado.concluida, false)
  })

  it("cenário 3 — OP concluída é reavaliada quando uma operação fica incompleta", () => {
    const resultado = calcularConsolidacaoOrdemProducao(
      100,
      [{ id: "corte" }, { id: "montagem" }],
      [
        apontamento("corte-100", 100, 0, "fechado", "corte"),
        apontamento("montagem-90", 90, 0, "fechado", "montagem"),
        apontamento("montagem-estorno", 10, 0, "cancelado", "montagem"),
      ],
    )

    assert.equal(resultado.quantidadeProcessada, 90)
    assert.equal(resultado.operacoesPendentes, 1)
    assert.equal(resultado.concluida, false)
  })

  it("cenário 4 — OEE consolidado deixa de contabilizar as 10 peças estornadas", () => {
    const consolidacao = calcularConsolidacaoOrdemProducao(100, [{ id: "operacao-1" }], [
      apontamento("valido-90", 90),
      apontamento("estornado-10", 10, 0, "cancelado"),
    ])
    const oee = consolidarOeeOrdens([consolidacao])

    assert.equal(oee.quantidadeProcessada, 90)
    assert.equal(oee.quantidadeAprovada, 90)
    assert.equal(oee.qualidade, 100)
  })

  it("cenário 5 — estoque insuficiente bloqueia a movimentação inversa", () => {
    const plano = planStockReversal([
      { id: "entrada-10", type: "entrada", quantity: 10, currentBalance: 2 },
    ])

    assert.equal(plano.blocked, true)
    assert.equal(plano.effects.length, 0)
    assert.equal(plano.dependencies[0].id, "entrada-10")
  })

  it("cenário 6 — requisição duplicada não duplica a consolidação", () => {
    const repetido = apontamento("mesmo-id", 10)
    const resultado = calcularConsolidacaoOrdemProducao(100, [{ id: "operacao-1" }], [
      apontamento("base-90", 90),
      repetido,
      repetido,
    ])

    assert.equal(resultado.quantidadeProcessada, 100)
    assert.match(migration, /audit_logs_reversal_idempotency_idx/)
    assert.match(migration, /movimentacoes_estoque_reversal_unique_idx/)
  })

  it("cenário 7 — usuário comum não recebe a aba nem permissão administrativa", () => {
    assert.equal(podeAcessarAba([ROLES.PRODUCTION_USER], ABAS.AUDITORIA), false)
    assert.equal(podeAcessarAba([ROLES.SYSTEM_MANAGER], ABAS.AUDITORIA), true)
    assert.equal(AUDIT_PERMISSIONS.REVERSE, "auditoria.estornar")
    assert.match(migration, /tem_permissao_auditoria/)
  })

  it("cenário 8 — as RPCs validam o tenant da sessão", () => {
    assert.match(migration, /p\.empresa_id = p_empresa_id/)
    assert.match(migration, /a\.empresa_id = p_empresa_id/)
    assert.match(migration, /Acesso negado ao estorno ou tenant invalido/)
  })

  it("cenário 9 — o estorno usa transação, locks e histórico imutável", () => {
    assert.match(migration, /^begin;/m)
    assert.match(migration, /for update;/i)
    assert.match(migration, /before update or delete on public\.audit_logs/i)
    assert.match(migration, /O historico de auditoria e imutavel/)
    assert.match(migration, /^commit;/m)
  })

  it("cenário 10 — apontamento com refugo recalcula processadas, aprovadas e qualidade", () => {
    const resultado = calcularConsolidacaoOrdemProducao(100, [{ id: "operacao-1" }], [
      apontamento("valido", 90, 5),
      apontamento("estornado", 10, 2, "cancelado"),
    ])
    const oee = consolidarOeeOrdens([resultado])

    assert.equal(oee.quantidadeProcessada, 90)
    assert.equal(oee.quantidadeAprovada, 85)
    assert.equal(oee.quantidadeRefugo, 5)
    assert.equal(Number(oee.qualidade.toFixed(2)), 94.44)
  })

  it("cenário 11 — lançamento estornado permanece inválido para novos totais", () => {
    assert.equal(isValidOperationalEntry("cancelado"), false)
    assert.equal(isValidOperationalEntry("estornado"), false)
    assert.equal(isValidOperationalEntry("fechado"), true)
    assert.match(migration, /already_reversed/)
  })

  it("cenário 12 — listagem possui filtros combináveis e paginação no banco", () => {
    for (const filter of [
      "p_periodo_inicio", "p_periodo_fim", "p_usuario", "p_modulo",
      "p_status", "p_ordem_producao", "p_produto_codigo", "p_operacao",
      "p_maquina", "p_search",
    ]) {
      assert.match(migration, new RegExp(filter))
    }
    assert.match(migration, /offset \(v_page - 1\) \* v_page_size/)
    assert.match(migration, /limit v_page_size/)
  })

  it("exige descrição quando o motivo selecionado é Outro", () => {
    assert.equal(validateReversalReason("outro", ""), "Descreva o motivo quando a opção Outro for selecionada.")
    assert.equal(validateReversalReason("outro", "Falha identificada no lote"), null)
  })

  it("libera o estorno de apontamentos finalizados antes da coluna de rastreabilidade", () => {
    assert.match(legacyCompatibilityMigration, /a\.finalizado_em is null/)
    assert.match(legacyCompatibilityMigration, /a\.status not in \('em_andamento', 'cancelado', 'cancelada'\)/)
    assert.match(legacyCompatibilityMigration, /coalesce\(a\.updated_at, a\.created_at, now\(\)\)/)
    assert.match(legacyCompatibilityMigration, /reverter_somente_movimentacoes_explicitamente_vinculadas/)
    assert.doesNotMatch(legacyCompatibilityMigration, /update public\.saldo_estoque/i)
    assert.doesNotMatch(legacyCompatibilityMigration, /insert into public\.movimentacoes_estoque/i)
  })

  it("não desabilita o botão por metadado legado e saneia o registro antes do estorno", () => {
    const reversalBlockedExpression = auditComponent.match(/const reversalBlocked = Boolean\(([\s\S]*?)\n  \)/)?.[1] ?? ""

    assert.doesNotMatch(reversalBlockedExpression, /dados_legados/)
    assert.match(reversalRoute, /legacy_metadata_backfilled/)
    assert.match(reversalRoute, /\.is\("finalizado_em", null\)/)
    assert.match(reversalRoute, /reverter_somente_movimentacoes_explicitamente_vinculadas/)
  })

  it("traduz códigos internos da auditoria integralmente para Português BR", () => {
    assert.equal(auditActionLabel("created"), "Lançamento criado")
    assert.equal(auditActionLabel("production_report_finalized"), "Apontamento de produção finalizado")
    assert.equal(auditActionLabel("production_report_reversed"), "Apontamento de produção estornado")
    assert.equal(auditActionLabel("unknown_event"), "Evento registrado pelo sistema")
    assert.equal(auditModuleLabel("production"), "Produção")
    assert.equal(auditTypeLabel("apontamento_producao"), "Apontamento de produção")
    assert.equal(auditOriginLabel("administrator"), "Administrador")
    assert.equal(stockMovementLabel("entrada_producao"), "Entrada de produção")
    assert.equal(auditStatusLabel("em_andamento"), "Em andamento")
    assert.equal(auditReasonLabel("quantidade_incorreta"), "Quantidade lançada incorretamente")
  })
})
