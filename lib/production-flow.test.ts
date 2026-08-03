import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  calcularConsolidacaoOrdemProducao,
  consolidarOeeOrdens,
  type ApontamentoProducao,
  type OperacaoRoteiroProducao,
} from "./production-flow.ts"

const operacoes = (quantidade: number): OperacaoRoteiroProducao[] =>
  Array.from({ length: quantidade }, (_, indice) => ({ id: `op-${indice + 1}` }))

const apontamento = (
  id: string,
  operacaoId: string,
  quantidadeProcessada: number,
  quantidadeRefugo = 0,
  status = "fechado",
): ApontamentoProducao => ({
  id,
  operacaoId,
  quantidadeProcessada,
  quantidadeRefugo,
  status,
})

describe("consolidação do fluxo de produção", () => {
  it("conclui uma OP com uma única operação completa", () => {
    const resultado = calcularConsolidacaoOrdemProducao(
      100,
      operacoes(1),
      [apontamento("a1", "op-1", 100)],
    )

    assert.equal(resultado.operacoes[0].status, "concluida")
    assert.equal(resultado.concluida, true)
    assert.equal(resultado.quantidadeAprovada, 100)
  })

  it("não encerra a OP quando somente a primeira de cinco operações terminou", () => {
    const resultado = calcularConsolidacaoOrdemProducao(
      100,
      operacoes(5),
      [apontamento("a1", "op-1", 100)],
    )

    assert.equal(resultado.operacoes[0].status, "concluida")
    assert.equal(resultado.operacoesPendentes, 4)
    assert.equal(resultado.concluida, false)
    assert.equal(resultado.quantidadeAprovada, 0)
  })

  it("conta 100 produtos, e não 500, quando as cinco operações terminam", () => {
    const resultado = calcularConsolidacaoOrdemProducao(
      100,
      operacoes(5),
      operacoes(5).map((operacao, indice) =>
        apontamento(`a${indice + 1}`, operacao.id, 100),
      ),
    )
    const oee = consolidarOeeOrdens([resultado])

    assert.equal(resultado.concluida, true)
    assert.equal(resultado.quantidadeProcessada, 100)
    assert.equal(resultado.quantidadeAprovada, 100)
    assert.equal(oee.quantidadeProcessada, 100)
  })

  it("soma apontamentos parciais da mesma operação sem substituir nem duplicar", () => {
    const resultado = calcularConsolidacaoOrdemProducao(
      100,
      operacoes(2),
      [
        apontamento("a1", "op-1", 60, 0, "aberto"),
        apontamento("a2", "op-1", 40),
      ],
    )

    assert.equal(resultado.operacoes[0].quantidadeProcessada, 100)
    assert.equal(resultado.operacoes[0].status, "concluida")
    assert.equal(resultado.concluida, false)
  })

  it("é idempotente quando o mesmo apontamento aparece duas vezes", () => {
    const repetido = apontamento("mesmo-id", "op-1", 100)
    const resultado = calcularConsolidacaoOrdemProducao(
      100,
      operacoes(1),
      [repetido, repetido],
    )

    assert.equal(resultado.operacoes[0].quantidadeProcessada, 100)
    assert.equal(resultado.quantidadeAprovada, 100)
  })

  it("consolida quantidades de vários operadores na mesma operação", () => {
    const resultado = calcularConsolidacaoOrdemProducao(
      100,
      operacoes(2),
      [
        apontamento("operador-1", "op-1", 60, 0, "aberto"),
        apontamento("operador-2", "op-1", 40),
      ],
    )

    assert.equal(resultado.operacoes[0].quantidadeProcessada, 100)
    assert.equal(resultado.concluida, false)
  })

  it("separa processadas de aprovadas quando existe refugo", () => {
    const resultado = calcularConsolidacaoOrdemProducao(
      100,
      operacoes(1),
      [apontamento("a1", "op-1", 100, 5)],
    )
    const oee = consolidarOeeOrdens([resultado])

    assert.equal(resultado.quantidadeProcessada, 100)
    assert.equal(resultado.quantidadeAprovada, 95)
    assert.equal(resultado.concluida, true)
    assert.equal(oee.quantidadeRefugo, 5)
    assert.equal(oee.qualidade, 95)
  })

  it("impede conclusão quando uma operação obrigatória está pendente", () => {
    const apontamentos = operacoes(4).map((operacao, indice) =>
      apontamento(`a${indice + 1}`, operacao.id, 100),
    )
    const resultado = calcularConsolidacaoOrdemProducao(100, operacoes(5), apontamentos)

    assert.equal(resultado.operacoesPendentes, 1)
    assert.equal(resultado.concluida, false)
  })

  it("ignora operações opcionais, inativas e apontamentos cancelados", () => {
    const roteiro: OperacaoRoteiroProducao[] = [
      { id: "obrigatoria" },
      { id: "opcional", obrigatoria: false },
      { id: "inativa", ativa: false },
    ]
    const resultado = calcularConsolidacaoOrdemProducao(100, roteiro, [
      apontamento("valido", "obrigatoria", 100),
      apontamento("cancelado", "obrigatoria", 100, 0, "cancelado"),
    ])

    assert.equal(resultado.operacoes.length, 1)
    assert.equal(resultado.quantidadeProcessada, 100)
    assert.equal(resultado.concluida, true)
  })

  it("não conclui enquanto houver qualquer apontamento ativo na OP", () => {
    const resultado = calcularConsolidacaoOrdemProducao(100, operacoes(1), [
      apontamento("final", "op-1", 100),
      apontamento("ativo", "op-1", 0, 0, "em_andamento"),
    ])

    assert.equal(resultado.operacoesPendentes, 1)
    assert.equal(resultado.possuiApontamentoAtivo, true)
    assert.equal(resultado.concluida, false)
  })

  it("analisa operações paralelas como conjunto, sem depender da sequência", () => {
    const roteiro = operacoes(3)
    const parcial = calcularConsolidacaoOrdemProducao(100, roteiro, [
      apontamento("a3", "op-3", 100),
      apontamento("a1", "op-1", 100),
    ])
    const completo = calcularConsolidacaoOrdemProducao(100, roteiro, [
      apontamento("a3", "op-3", 100),
      apontamento("a1", "op-1", 100),
      apontamento("a2", "op-2", 100),
    ])

    assert.equal(parcial.concluida, false)
    assert.equal(parcial.operacoesPendentes, 1)
    assert.equal(completo.concluida, true)
  })
})
