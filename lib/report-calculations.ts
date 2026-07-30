export interface CycleAppointment {
  id: string
  ordem_id: string
  operacao_id?: string
  operacao_nome?: string
  cronometro_total_segundos: number
  pecas_produzidas: number
  status: string
}

export interface CycleOperation {
  id: string
  nome: string
  tempo: number
  unidade: string
  maquina_id?: string
  produto_id?: string
  ordem?: number
}

export interface CycleOrder {
  id: string
  numero_op: string
  produto_codigo: string
}

export interface CycleProduct {
  id: string
  codigo: string
  descricao?: string
}

export interface CycleOperationDatum {
  id: string
  nome: string
  ordem: number
  totalCronometroSeg: number
  totalPecas: number
  totalApontamentos: number
  realSeg: number
  planejadoSeg: number
  real: number
  planejado: number
  temMedicao: boolean
  semPadrao: boolean
  comparavel: boolean
  desvio: number
  atencaoMedicao: boolean
}

export interface CycleProductDatum {
  id: string
  produtoId?: string
  codigo: string
  descricao: string
  produto: string
  ordens: string
  operacoes: CycleOperationDatum[]
  operacoesTotal: number
  operacoesMedidas: number
  operacoesComPadrao: number
  totalPecasMedidas: number
  totalApontamentos: number
  realSeg: number
  planejadoSeg: number
  real: number
  planejado: number
  comparavel: boolean
  semPadrao: boolean
  medicaoParcial: boolean
  desvio: number
  atencaoMedicao: boolean
}

export interface CycleResult {
  produtos: CycleProductDatum[]
  apontamentosInconsistentes: number
  apontamentosSemOperacao: number
  apontamentosOperacaoDivergente: number
}

interface OperationAccumulator {
  operacao: CycleOperation
  totalCronometroSeg: number
  totalPecas: number
  totalApontamentos: number
}

interface ProductAccumulator {
  id: string
  produtoId?: string
  codigo: string
  descricao: string
  ordens: Set<string>
  operacoes: Map<string, OperationAccumulator>
}

export function normalizarNomeOperacao(nome?: string): string {
  return (nome || "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

export function tempoPlanejadoEmSegundos(
  operacao?: Pick<CycleOperation, "tempo" | "unidade"> | null,
): number {
  if (!operacao) return 0

  const tempo = Number(operacao.tempo)
  if (!Number.isFinite(tempo) || tempo <= 0) return 0

  const unidade = (operacao.unidade || "").trim().toLocaleLowerCase("pt-BR")
  if (["minute", "minutes", "minuto", "minutos", "min"].includes(unidade)) return tempo * 60
  if (["hour", "hours", "hora", "horas", "h"].includes(unidade)) return tempo * 3600
  if (["second", "seconds", "segundo", "segundos", "s", "sec"].includes(unidade)) return tempo

  return 0
}

function criarAcumuladorProduto(
  codigo: string,
  produto: CycleProduct | undefined,
  operacoes: CycleOperation[],
): ProductAccumulator {
  const acumuladoresOperacao = new Map<string, OperationAccumulator>()
  for (const operacao of operacoes) {
    acumuladoresOperacao.set(operacao.id, {
      operacao,
      totalCronometroSeg: 0,
      totalPecas: 0,
      totalApontamentos: 0,
    })
  }

  return {
    id: produto?.id || `codigo:${codigo}`,
    produtoId: produto?.id,
    codigo,
    descricao: produto?.descricao?.trim() || "",
    ordens: new Set<string>(),
    operacoes: acumuladoresOperacao,
  }
}

/**
 * Regra do relatório:
 * - Operação real = soma dos cronômetros da operação / soma das peças da operação.
 * - Produto previsto = soma dos ciclos previstos de todas as operações do roteiro.
 * - Produto realizado = soma dos ciclos reais médios de todas as operações do roteiro.
 * - O desvio do produto só é comparável quando todas as operações possuem padrão e medição.
 */
export function calcularCicloRealVsPlanejado(
  apontamentos: CycleAppointment[],
  operacoes: CycleOperation[],
  ordens: CycleOrder[],
  produtos: CycleProduct[],
): CycleResult {
  const ordensPorId = new Map(ordens.map(ordem => [ordem.id, ordem]))
  const produtosPorId = new Map(produtos.map(produto => [produto.id, produto]))
  const produtosPorCodigo = new Map(produtos.map(produto => [produto.codigo, produto]))
  const operacoesPorId = new Map(operacoes.map(operacao => [operacao.id, operacao]))
  const operacoesPorProdutoId = new Map<string, CycleOperation[]>()

  for (const operacao of operacoes) {
    if (!operacao.produto_id) continue
    const existentes = operacoesPorProdutoId.get(operacao.produto_id) || []
    existentes.push(operacao)
    operacoesPorProdutoId.set(operacao.produto_id, existentes)
  }
  for (const operacoesProduto of operacoesPorProdutoId.values()) {
    operacoesProduto.sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0))
  }

  const produtosComApontamento = new Set<string>()
  for (const apontamento of apontamentos) {
    if (apontamento.status === "em_andamento") continue
    const ordem = ordensPorId.get(apontamento.ordem_id)
    if (ordem?.produto_codigo) produtosComApontamento.add(ordem.produto_codigo)
  }

  const acumuladoresProduto = new Map<string, ProductAccumulator>()
  for (const codigo of produtosComApontamento) {
    const produto = produtosPorCodigo.get(codigo)
    const operacoesProduto = produto
      ? operacoesPorProdutoId.get(produto.id) || []
      : []
    acumuladoresProduto.set(
      codigo,
      criarAcumuladorProduto(codigo, produto, operacoesProduto),
    )
  }

  let apontamentosInconsistentes = 0
  let apontamentosSemOperacao = 0
  let apontamentosOperacaoDivergente = 0

  for (const apontamento of apontamentos) {
    if (apontamento.status === "em_andamento") continue

    const ordem = ordensPorId.get(apontamento.ordem_id)
    if (!ordem?.produto_codigo) {
      apontamentosSemOperacao += 1
      continue
    }

    const produto = produtosPorCodigo.get(ordem.produto_codigo)
    let acumuladorProduto = acumuladoresProduto.get(ordem.produto_codigo)
    if (!acumuladorProduto) {
      acumuladorProduto = criarAcumuladorProduto(
        ordem.produto_codigo,
        produto,
        produto ? operacoesPorProdutoId.get(produto.id) || [] : [],
      )
      acumuladoresProduto.set(ordem.produto_codigo, acumuladorProduto)
    }
    if (ordem.numero_op) acumuladorProduto.ordens.add(ordem.numero_op)

    let operacao = apontamento.operacao_id
      ? operacoesPorId.get(apontamento.operacao_id)
      : undefined

    if (operacao && produto?.id && operacao.produto_id && operacao.produto_id !== produto.id) {
      apontamentosOperacaoDivergente += 1
      continue
    }

    // Compatibilidade com apontamentos legados: o nome só é aceito quando
    // identifica exatamente uma operação dentro do roteiro deste produto.
    if (!operacao && apontamento.operacao_nome) {
      const nomeNormalizado = normalizarNomeOperacao(apontamento.operacao_nome)
      const candidatas = Array.from(acumuladorProduto.operacoes.values())
        .map(item => item.operacao)
        .filter(item => normalizarNomeOperacao(item.nome) === nomeNormalizado)
      if (candidatas.length === 1) operacao = candidatas[0]
    }

    if (!operacao) {
      apontamentosSemOperacao += 1
      continue
    }

    let acumuladorOperacao = acumuladorProduto.operacoes.get(operacao.id)
    if (!acumuladorOperacao) {
      // Produto sem cadastro completo de roteiro: preserva a medição, mas ela
      // ficará sem padrão e impedirá a comparação consolidada.
      acumuladorOperacao = {
        operacao,
        totalCronometroSeg: 0,
        totalPecas: 0,
        totalApontamentos: 0,
      }
      acumuladorProduto.operacoes.set(operacao.id, acumuladorOperacao)
    }

    const totalSegundos = Number(apontamento.cronometro_total_segundos) || 0
    const totalPecas = Number(apontamento.pecas_produzidas) || 0
    if (totalSegundos <= 0 || totalPecas <= 0) {
      if (totalSegundos > 0 || totalPecas > 0) apontamentosInconsistentes += 1
      continue
    }

    acumuladorOperacao.totalCronometroSeg += totalSegundos
    acumuladorOperacao.totalPecas += totalPecas
    acumuladorOperacao.totalApontamentos += 1
  }

  const dadosProdutos = Array.from(acumuladoresProduto.values())
    .map(acumuladorProduto => {
      const dadosOperacoes = Array.from(acumuladorProduto.operacoes.values())
        .map(acumulador => {
          const planejadoSeg = tempoPlanejadoEmSegundos(acumulador.operacao)
          const temMedicao = acumulador.totalPecas > 0 && acumulador.totalCronometroSeg > 0
          const realSeg = temMedicao
            ? acumulador.totalCronometroSeg / acumulador.totalPecas
            : 0
          const comparavel = planejadoSeg > 0 && temMedicao
          const desvio = comparavel
            ? ((realSeg - planejadoSeg) / planejadoSeg) * 100
            : 0
          const razaoRealPlanejado = comparavel ? realSeg / planejadoSeg : 0

          return {
            id: acumulador.operacao.id,
            nome: acumulador.operacao.nome,
            ordem: Number(acumulador.operacao.ordem) || 0,
            totalCronometroSeg: acumulador.totalCronometroSeg,
            totalPecas: acumulador.totalPecas,
            totalApontamentos: acumulador.totalApontamentos,
            realSeg: Number(realSeg.toFixed(2)),
            planejadoSeg: Number(planejadoSeg.toFixed(2)),
            real: Number((realSeg / 60).toFixed(2)),
            planejado: Number((planejadoSeg / 60).toFixed(2)),
            temMedicao,
            semPadrao: planejadoSeg <= 0,
            comparavel,
            desvio: Number(desvio.toFixed(1)),
            atencaoMedicao: comparavel && (razaoRealPlanejado < 0.2 || razaoRealPlanejado > 5),
          } satisfies CycleOperationDatum
        })
        .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"))

      const operacoesTotal = dadosOperacoes.length
      const operacoesMedidas = dadosOperacoes.filter(operacao => operacao.temMedicao).length
      const operacoesComPadrao = dadosOperacoes.filter(operacao => !operacao.semPadrao).length
      const planejadoSeg = dadosOperacoes.reduce((soma, operacao) => soma + operacao.planejadoSeg, 0)
      const realSeg = dadosOperacoes.reduce((soma, operacao) => soma + operacao.realSeg, 0)
      const comparavel =
        operacoesTotal > 0 &&
        operacoesMedidas === operacoesTotal &&
        operacoesComPadrao === operacoesTotal
      const desvio = comparavel && planejadoSeg > 0
        ? ((realSeg - planejadoSeg) / planejadoSeg) * 100
        : 0
      const descricao = acumuladorProduto.descricao
      const produto = descricao
        ? `${acumuladorProduto.codigo} - ${descricao}`
        : acumuladorProduto.codigo

      return {
        id: acumuladorProduto.id,
        produtoId: acumuladorProduto.produtoId,
        codigo: acumuladorProduto.codigo,
        descricao,
        produto,
        ordens: Array.from(acumuladorProduto.ordens).sort().join(", "),
        operacoes: dadosOperacoes,
        operacoesTotal,
        operacoesMedidas,
        operacoesComPadrao,
        totalPecasMedidas: dadosOperacoes.reduce((soma, operacao) => soma + operacao.totalPecas, 0),
        totalApontamentos: dadosOperacoes.reduce((soma, operacao) => soma + operacao.totalApontamentos, 0),
        realSeg: Number(realSeg.toFixed(2)),
        planejadoSeg: Number(planejadoSeg.toFixed(2)),
        real: Number((realSeg / 60).toFixed(2)),
        planejado: Number((planejadoSeg / 60).toFixed(2)),
        comparavel,
        semPadrao: operacoesComPadrao < operacoesTotal,
        medicaoParcial: operacoesMedidas > 0 && operacoesMedidas < operacoesTotal,
        desvio: Number(desvio.toFixed(1)),
        atencaoMedicao: dadosOperacoes.some(operacao => operacao.atencaoMedicao),
      } satisfies CycleProductDatum
    })
    .filter(produto => produto.operacoesTotal > 0 || produto.totalApontamentos > 0)
    .sort((a, b) => {
      if (a.comparavel !== b.comparavel) return a.comparavel ? -1 : 1
      if (a.comparavel && b.comparavel) return Math.abs(b.desvio) - Math.abs(a.desvio)
      return a.produto.localeCompare(b.produto, "pt-BR")
    })

  return {
    produtos: dadosProdutos,
    apontamentosInconsistentes,
    apontamentosSemOperacao,
    apontamentosOperacaoDivergente,
  }
}

export function calcularResumoCiclo(produtos: CycleProductDatum[]) {
  const comparaveis = produtos.filter(produto => produto.comparavel && produto.planejadoSeg > 0)
  const planejadoSeg = comparaveis.reduce((soma, produto) => soma + produto.planejadoSeg, 0)
  const realSeg = comparaveis.reduce((soma, produto) => soma + produto.realSeg, 0)
  const desvio = planejadoSeg > 0
    ? ((realSeg - planejadoSeg) / planejadoSeg) * 100
    : 0

  return {
    produtosComparaveis: comparaveis.length,
    produtosTotal: produtos.length,
    planejadoSeg,
    realSeg,
    desvio,
  }
}

export interface TurnoProgramado {
  hora_inicio: string
  hora_fim: string
  dias_semana?: string[]
  ativo?: boolean
}

function segundosEntreHorarios(inicio: string, fim: string): number {
  const [horaInicio, minutoInicio] = inicio.split(":").map(Number)
  const [horaFim, minutoFim] = fim.split(":").map(Number)
  if (![horaInicio, minutoInicio, horaFim, minutoFim].every(Number.isFinite)) return 0

  const inicioMinutos = horaInicio * 60 + minutoInicio
  let fimMinutos = horaFim * 60 + minutoFim
  if (fimMinutos <= inicioMinutos) fimMinutos += 24 * 60
  return (fimMinutos - inicioMinutos) * 60
}

export function calcularTempoProgramado(
  inicioIso: string,
  fimIso: string,
  turnos: TurnoProgramado[],
  tempoPadrao?: number,
  unidadeTempoPadrao?: string,
) {
  const inicio = new Date(inicioIso)
  const fim = new Date(fimIso)
  inicio.setHours(0, 0, 0, 0)
  fim.setHours(0, 0, 0, 0)

  const turnosValidos = turnos.filter(turno =>
    turno.ativo !== false &&
    Array.isArray(turno.dias_semana) &&
    turno.dias_semana.length > 0 &&
    segundosEntreHorarios(turno.hora_inicio, turno.hora_fim) > 0,
  )

  let totalSegundos = 0
  let diasUteis = 0
  for (const data = new Date(inicio); data <= fim; data.setDate(data.getDate() + 1)) {
    const diaSemana = String(data.getDay())
    if (diaSemana !== "0" && diaSemana !== "6") diasUteis += 1

    for (const turno of turnosValidos) {
      if (turno.dias_semana?.includes(diaSemana)) {
        totalSegundos += segundosEntreHorarios(turno.hora_inicio, turno.hora_fim)
      }
    }
  }

  if (turnosValidos.length > 0) {
    return { totalSegundos, origem: "turnos" as const }
  }

  const segundosPadraoDia = tempoPlanejadoEmSegundos({
    tempo: Number(tempoPadrao) || 0,
    unidade: unidadeTempoPadrao || "",
  })
  return {
    totalSegundos: segundosPadraoDia * diasUteis,
    origem: segundosPadraoDia > 0 ? "padrao_empresa" as const : "indisponivel" as const,
  }
}
