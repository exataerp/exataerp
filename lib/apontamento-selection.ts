export interface SessaoOperacaoAtiva {
  ordemId: string
  operacaoId: string
}

interface ResolverOperacaoSelecionadaParams {
  operacaoAtualId: string
  ordemSelecionadaId: string
  operacoesDisponiveisIds: string[]
  sessoesAtivas: SessaoOperacaoAtiva[]
}

export function resolverOperacaoSelecionada({
  operacaoAtualId,
  ordemSelecionadaId,
  operacoesDisponiveisIds,
  sessoesAtivas,
}: ResolverOperacaoSelecionadaParams): string {
  const operacaoAtualEstaAtiva = operacaoAtualId !== "" && sessoesAtivas.some(sessao =>
    sessao.ordemId === ordemSelecionadaId
    && sessao.operacaoId === operacaoAtualId,
  )

  if (operacaoAtualEstaAtiva || operacoesDisponiveisIds.includes(operacaoAtualId)) {
    return operacaoAtualId
  }

  return operacoesDisponiveisIds.length === 1 ? operacoesDisponiveisIds[0] : ""
}
