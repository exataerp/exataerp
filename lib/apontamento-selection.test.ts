import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { resolverOperacaoSelecionada } from "./apontamento-selection.ts"

describe("seleção de operação no apontamento", () => {
  it("preserva a operação ativa mesmo quando ela não aparece nas disponíveis do posto", () => {
    const resultado = resolverOperacaoSelecionada({
      operacaoAtualId: "operacao-ativa",
      ordemSelecionadaId: "op-608",
      operacoesDisponiveisIds: [],
      sessoesAtivas: [{ ordemId: "op-608", operacaoId: "operacao-ativa" }],
    })

    assert.equal(resultado, "operacao-ativa")
  })

  it("mantém uma operação normalmente disponível", () => {
    const resultado = resolverOperacaoSelecionada({
      operacaoAtualId: "operacao-2",
      ordemSelecionadaId: "op-608",
      operacoesDisponiveisIds: ["operacao-1", "operacao-2"],
      sessoesAtivas: [],
    })

    assert.equal(resultado, "operacao-2")
  })

  it("seleciona automaticamente a única operação disponível", () => {
    const resultado = resolverOperacaoSelecionada({
      operacaoAtualId: "",
      ordemSelecionadaId: "op-608",
      operacoesDisponiveisIds: ["operacao-unica"],
      sessoesAtivas: [],
    })

    assert.equal(resultado, "operacao-unica")
  })

  it("limpa uma seleção inválida quando há múltiplas opções", () => {
    const resultado = resolverOperacaoSelecionada({
      operacaoAtualId: "operacao-antiga",
      ordemSelecionadaId: "op-608",
      operacoesDisponiveisIds: ["operacao-1", "operacao-2"],
      sessoesAtivas: [],
    })

    assert.equal(resultado, "")
  })
})
