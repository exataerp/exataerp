import test from "node:test"
import assert from "node:assert/strict"
import { CADASTROS_GRUPOS, totalCadastros } from "./cadastros-catalog.ts"

test("catálogo central organiza os dez grupos de dados mestres", () => {
  assert.equal(CADASTROS_GRUPOS.length, 10)
  assert.equal(new Set(CADASTROS_GRUPOS.map((grupo) => grupo.id)).size, CADASTROS_GRUPOS.length)
  assert.ok(CADASTROS_GRUPOS.every((grupo) => grupo.itens.length > 0))
})

test("todo destino do catálogo corresponde a uma aba real", () => {
  const destinos = CADASTROS_GRUPOS.flatMap((grupo) => grupo.itens.flatMap((item) => item.destino ? [item.destino] : []))
  const esperados = new Set(["gbo", "maquinas", "estoque", "configuracoes", "excecoes", "equipe", "manutencao"])

  assert.ok(destinos.length > 0)
  assert.ok(destinos.every((destino) => esperados.has(destino)))
})

test("resumo por status permanece consistente com o catálogo", () => {
  const total = CADASTROS_GRUPOS.reduce((soma, grupo) => soma + grupo.itens.length, 0)
  assert.equal(
    totalCadastros("disponivel") + totalCadastros("base_existente") + totalCadastros("planejado"),
    total,
  )
})
