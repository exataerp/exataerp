import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  decideOrderDeletion,
  ORDER_WITH_POINTINGS_MESSAGE,
  summarizeOrderPointings,
} from "./order-deletion.ts"

const migration = readFileSync(
  new URL("../supabase/migrations/20260804133527_bloqueio_exclusao_op_com_apontamentos.sql", import.meta.url),
  "utf8",
)
const eventMigration = readFileSync(
  new URL("../supabase/migrations/20260804140016_preservar_eventos_producao.sql", import.meta.url),
  "utf8",
)

describe("Exclusão segura de Ordem de Produção", () => {
  it("OP-01 — permite solicitar exclusão de rascunho sem histórico", () => {
    const summary = summarizeOrderPointings("op-1", [], 0)
    assert.deepEqual(decideOrderDeletion({ status: "rascunho", summary }), {
      blocked: false,
      code: null,
      message: null,
    })
    assert.match(migration, /'action', 'deleted_draft'/)
    assert.match(migration, /'order_deleted', 'pcp'/)
  })

  it("OP-02 — bloqueia OP com apontamento ativo", () => {
    const summary = summarizeOrderPointings("op-2", [
      { ordem_id: "op-2", status: "em_andamento", estado_operacao: "em_execucao" },
    ])
    const decision = decideOrderDeletion({ status: "em_andamento", summary })
    assert.equal(decision.code, "OP_HAS_POINTINGS")
    assert.equal(decision.message, ORDER_WITH_POINTINGS_MESSAGE)
    assert.equal(summary.active, 1)
  })

  it("OP-03 — bloqueia OP com apontamento pausado", () => {
    const summary = summarizeOrderPointings("op-3", [
      { ordem_id: "op-3", status: "pausado", estado_operacao: "pausada" },
    ])
    assert.equal(decideOrderDeletion({ status: "em_andamento", summary }).blocked, true)
    assert.equal(summary.paused, 1)
  })

  it("OP-04 — bloqueia OP com apontamento finalizado", () => {
    const summary = summarizeOrderPointings("op-4", [
      { ordem_id: "op-4", status: "finalizado", finalizado_em: "2026-08-04T00:00:00Z" },
    ])
    assert.equal(decideOrderDeletion({ status: "concluida", summary }).code, "OP_HAS_POINTINGS")
    assert.equal(summary.finalized, 1)
  })

  it("OP-05 — apontamento estornado continua preservado e bloqueia exclusão física", () => {
    const summary = summarizeOrderPointings("op-5", [
      { ordem_id: "op-5", status: "estornado", estornado_em: "2026-08-04T00:00:00Z" },
    ])
    assert.equal(decideOrderDeletion({ status: "cancelada", summary }).code, "OP_HAS_POINTINGS")
    assert.equal(summary.reversed, 1)
  })

  it("OP-06 — bloqueia histórico operacional mesmo sem apontamento atual", () => {
    const summary = summarizeOrderPointings("op-6", [], 1)
    assert.equal(decideOrderDeletion({ status: "rascunho", summary }).code, "OP_HAS_OPERATIONAL_HISTORY")
    assert.match(migration, /movimentos_estoque_ativos/)
  })

  it("OP-07 — serializa exclusão e início pela mesma chave da ordem", () => {
    assert.match(migration, /apontamentos_serializar_ordem/)
    assert.equal((migration.match(/'ordem-producao'/g) ?? []).length >= 2, true)
    assert.match(migration, /pg_advisory_xact_lock/)
  })

  it("OP-08 — valida tenant e permissão administrativa", () => {
    assert.match(migration, /op\.empresa_id = p_empresa_id/)
    assert.match(migration, /private\.tem_permissao_auditoria/)
    assert.match(migration, /Somente um administrador autorizado/)
  })

  it("OP-09 — banco usa RESTRICT e trigger, sem CASCADE destrutivo", () => {
    assert.match(migration, /create or replace function private\.proteger_exclusao_historica/)
    assert.equal((migration.match(/on delete restrict/g) ?? []).length, 3)
    assert.doesNotMatch(migration, /on delete cascade/i)
    assert.equal((eventMigration.match(/on delete restrict/g) ?? []).length, 2)
    assert.doesNotMatch(eventMigration, /on delete cascade/i)
    assert.match(migration, /Use a RPC excluir_ordem_producao_segura/)
  })
})
