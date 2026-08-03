export type StatusOperacaoProducao =
  | "pendente"
  | "em_andamento"
  | "parcialmente_concluida"
  | "concluida"

export interface OperacaoRoteiroProducao {
  id: string
  ativa?: boolean
  obrigatoria?: boolean
}

export interface ApontamentoProducao {
  id: string
  operacaoId: string
  quantidadeProcessada: number
  quantidadeRefugo?: number
  status: string
}

export interface ResumoOperacaoProducao {
  operacaoId: string
  quantidadeProcessada: number
  quantidadeAprovada: number
  status: StatusOperacaoProducao
}

export interface ConsolidacaoOrdemProducao {
  operacoes: ResumoOperacaoProducao[]
  quantidadeProcessada: number
  quantidadeAprovada: number
  operacoesPendentes: number
  possuiApontamentoAtivo: boolean
  concluida: boolean
}

const STATUS_CANCELADOS = new Set(["cancelado", "cancelada", "estornado"])

function quantidadeValida(valor: number | undefined): number {
  return Number.isFinite(valor) ? Math.max(0, Number(valor)) : 0
}

/**
 * Consolida o fluxo sem somar a mesma unidade física em operações diferentes.
 *
 * A quantidade da OP é o menor avanço entre as operações obrigatórias ativas.
 * Isso representa quantas unidades atravessaram o roteiro completo e continua
 * correto quando operações são paralelas ou terminam fora da ordem visual.
 * Operações opcionais e inativas não bloqueiam a OP. Apontamentos cancelados
 * também não participam dos totais.
 */
export function calcularConsolidacaoOrdemProducao(
  quantidadePlanejada: number,
  operacoes: OperacaoRoteiroProducao[],
  apontamentos: ApontamentoProducao[],
): ConsolidacaoOrdemProducao {
  const planejada = quantidadeValida(quantidadePlanejada)
  const operacoesObrigatorias = operacoes.filter(
    operacao => operacao.ativa !== false && operacao.obrigatoria !== false,
  )

  // Uma repetição da mesma resposta/requisição representa o mesmo registro e
  // não pode ser contabilizada novamente.
  const apontamentosUnicos = new Map<string, ApontamentoProducao>()
  for (const apontamento of apontamentos) apontamentosUnicos.set(apontamento.id, apontamento)

  const resumos = operacoesObrigatorias.map<ResumoOperacaoProducao>(operacao => {
    const daOperacao = [...apontamentosUnicos.values()].filter(
      apontamento =>
        apontamento.operacaoId === operacao.id &&
        !STATUS_CANCELADOS.has(apontamento.status),
    )
    const quantidadeProcessada = daOperacao.reduce(
      (total, apontamento) => total + quantidadeValida(apontamento.quantidadeProcessada),
      0,
    )
    const quantidadeAprovada = daOperacao.reduce(
      (total, apontamento) =>
        total + Math.max(
          0,
          quantidadeValida(apontamento.quantidadeProcessada) -
            quantidadeValida(apontamento.quantidadeRefugo),
        ),
      0,
    )
    const possuiApontamentoAtivo = daOperacao.some(
      apontamento => apontamento.status === "em_andamento",
    )
    const concluida = planejada > 0 && quantidadeProcessada >= planejada
    const status: StatusOperacaoProducao = possuiApontamentoAtivo
      ? "em_andamento"
      : concluida
        ? "concluida"
        : quantidadeProcessada > 0
          ? "parcialmente_concluida"
          : "pendente"

    return {
      operacaoId: operacao.id,
      quantidadeProcessada,
      quantidadeAprovada,
      status,
    }
  })

  const possuiApontamentoAtivo = [...apontamentosUnicos.values()].some(
    apontamento =>
      apontamento.status === "em_andamento" &&
      !STATUS_CANCELADOS.has(apontamento.status),
  )
  const operacoesPendentes = resumos.filter(
    resumo => resumo.status !== "concluida",
  ).length
  const possuiRoteiroObrigatorio = resumos.length > 0
  const quantidadeProcessada = possuiRoteiroObrigatorio
    ? Math.min(...resumos.map(resumo => Math.min(planejada, resumo.quantidadeProcessada)))
    : 0
  const quantidadeAprovada = possuiRoteiroObrigatorio
    ? Math.min(...resumos.map(resumo => Math.min(planejada, resumo.quantidadeAprovada)))
    : 0

  return {
    operacoes: resumos,
    quantidadeProcessada,
    quantidadeAprovada,
    operacoesPendentes,
    possuiApontamentoAtivo,
    concluida:
      possuiRoteiroObrigatorio &&
      operacoesPendentes === 0 &&
      !possuiApontamentoAtivo,
  }
}

export function consolidarOeeOrdens(ordens: ConsolidacaoOrdemProducao[]) {
  const quantidadeProcessada = ordens.reduce(
    (total, ordem) => total + ordem.quantidadeProcessada,
    0,
  )
  const quantidadeAprovada = ordens.reduce(
    (total, ordem) => total + ordem.quantidadeAprovada,
    0,
  )

  return {
    quantidadeProcessada,
    quantidadeAprovada,
    quantidadeRefugo: Math.max(0, quantidadeProcessada - quantidadeAprovada),
    qualidade:
      quantidadeProcessada > 0
        ? (quantidadeAprovada / quantidadeProcessada) * 100
        : 0,
  }
}
