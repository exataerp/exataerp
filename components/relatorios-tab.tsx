"use client"

import React, { useState, useEffect, useMemo } from "react"
import { supabase } from "@/components/supabase"
import { CountUp } from "@/components/count-up"
import { Skeleton } from "@/components/ui/skeleton"
import { ChartTooltip } from "@/components/chart-tooltip"
import { EmptyState as EmptyStateBase } from "@/components/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/date-picker"
import {
  calcularCicloRealVsPlanejado,
  calcularResumoCiclo,
  calcularTempoProgramado,
  normalizarNomeOperacao,
  tempoPlanejadoEmSegundos,
  type TurnoProgramado,
} from "@/lib/report-calculations"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend, Cell
} from "recharts"
import {
  TrendingUp, TrendingDown, AlertTriangle, Clock, Package,
  BarChart3, Filter, Download, RefreshCw, ChevronDown,
  type LucideIcon
} from "lucide-react"

/**
 * Identifica se uma pausa cadastrada corresponde a um intervalo programado
 * (ex: Almoço, Refeição, Fim de Turno, Troca de Turno, Intervalo Previsto),
 * que NÃO deve ser contabilizado como indisponibilidade de máquina ou falha operacional.
 */
export function isPausaProgramada(subgrupoNome?: string, grupoNome?: string): boolean {
  if (!subgrupoNome && !grupoNome) return false
  const texto = `${subgrupoNome || ""} ${grupoNome || ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  const termosProgramados = [
    "almoco", "refeicao", "janta", "jantar", "fim de turno", "troca de turno", "troca turno",
    "intervalo", "pausa programada", "fora de turno", "tempo nao programado", "descanso", "lanche"
  ]
  return termosProgramados.some(termo => texto.includes(termo))
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Apontamento {
  id: string
  ordem_id: string
  operacao_id?: string
  operacao_nome?: string
  maquina_id?: string
  cronometro_total_segundos: number
  pecas_produzidas: number
  pecas_refugo: number
  pecas_retrabalho: number
  status: string
  created_at: string
}

interface Pausa {
  id: string
  apontamento_id: string
  subgrupo_id?: string
  inicio: string
  fim?: string
  subgrupo?: { nome: string; grupo?: { nome: string } }
}

interface OrdemProducao {
  id: string
  numero_op: string
  produto_codigo: string
  quantidade: number
  data_programacao: string
  status?: string
}

interface Maquina {
  id: string
  nome: string
  codigo: string
}

interface Operacao {
  id: string
  nome: string
  tempo: number
  unidade: string
  maquina_id?: string
  produto_id?: string
  ordem?: number
}

interface EmpresaConfigRelatorios {
  tempo_padrao?: number
  unidade_tempo?: string
}

interface ProdutoRelatorio {
  id: string
  codigo: string
  descricao?: string
}

type Periodo = "7d" | "30d" | "90d" | "custom"
export type RelatoId = "oee" | "refugo" | "ciclo" | "consumo" | "paradas"

export const RELATORIOS_CONFIG: { id: RelatoId; label: string }[] = [
  { id: "oee", label: "OEE por Máquina" },
  { id: "refugo", label: "Refugo por Produto" },
  { id: "ciclo", label: "Ciclo Real vs Planejado" },
  { id: "consumo", label: "Consumo de Materiais" },
  { id: "paradas", label: "Ranking de Paradas" },
]

function formatNum(n: number, dec = 1) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function formatBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}
function formatTempo(seg: number) {
  const h = Math.floor(seg / 3600)
  const m = Math.floor((seg % 3600) / 60)
  if (h > 0) return `${h}h ${m}min`
  return `${m}min`
}
function formatTempoCiclo(segundos: number) {
  if (!Number.isFinite(segundos) || segundos <= 0) return "0 s"
  if (segundos < 60) return `${formatNum(segundos, segundos < 10 ? 1 : 0)} s`
  return `${formatNum(segundos / 60, 2)} min`
}

const APPLE_CHART_COLORS = {
  blue: "rgb(var(--chart-system-blue))",
  indigo: "rgb(var(--chart-system-indigo))",
  green: "rgb(var(--chart-system-green))",
  teal: "rgb(var(--chart-system-teal))",
  orange: "rgb(var(--chart-system-orange))",
  red: "rgb(var(--chart-system-red))",
  purple: "rgb(var(--chart-system-purple))",
  gray: "rgb(var(--chart-system-gray))",
} as const

// ─── Tooltip customizado ──────────────────────────────────────────────────────

// (tooltip dos gráficos agora vem de @/components/chart-tooltip)

// ─── Componente principal ─────────────────────────────────────────────────────

export function RelatoriosTab({
  empresaAtivaId,
  relatorioSelecionado,
  onChangeRelatorio,
}: {
  empresaAtivaId?: string | null
  relatorioSelecionado?: RelatoId
  onChangeRelatorio?: (id: RelatoId) => void
}) {
  const [loading, setLoading] = useState(true)
  const [periodo, setPeriodo] = useState<Periodo>("30d")
  const [dataInicio, setDataInicio] = useState("")
  const [dataFim, setDataFim] = useState("")
  const [relatorioAtivoInterno, setRelatorioAtivoInterno] = useState<RelatoId>("oee")
  const relatorioAtivo = relatorioSelecionado ?? relatorioAtivoInterno
  const setRelatorioAtivo = onChangeRelatorio ?? setRelatorioAtivoInterno

  const [apontamentos, setApontamentos] = useState<Apontamento[]>([])
  const [pausas, setPausas] = useState<Pausa[]>([])
  const [ordens, setOrdens] = useState<OrdemProducao[]>([])
  const [maquinas, setMaquinas] = useState<Maquina[]>([])
  const [operacoes, setOperacoes] = useState<Operacao[]>([])
  const [movimentacoes, setMovimentacoes] = useState<any[]>([])
  const [turnos, setTurnos] = useState<TurnoProgramado[]>([])
  const [empresaConfig, setEmpresaConfig] = useState<EmpresaConfigRelatorios | null>(null)
  const [codigoProdutoPorId, setCodigoProdutoPorId] = useState<Record<string, string>>({})
  const [produtos, setProdutos] = useState<ProdutoRelatorio[]>([])
  const [produtoCicloExpandido, setProdutoCicloExpandido] = useState<string | null>(null)

  const [selectedMaquinaId, setSelectedMaquinaId] = useState<string>("all")
  const [selectedOpId, setSelectedOpId] = useState<string>("all")

  // ─── Período ──────────────────────────────────────────────────────────────

  const { inicio, fim } = useMemo(() => {
    const hoje = new Date()
    const fimObj = new Date(hoje)
    fimObj.setHours(23, 59, 59, 999)
    const fim = fimObj.toISOString()

    if (periodo === "7d") {
      const d = new Date(hoje); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0)
      return { inicio: d.toISOString(), fim }
    }
    if (periodo === "30d") {
      const d = new Date(hoje); d.setDate(d.getDate() - 30); d.setHours(0, 0, 0, 0)
      return { inicio: d.toISOString(), fim }
    }
    if (periodo === "90d") {
      const d = new Date(hoje); d.setDate(d.getDate() - 90); d.setHours(0, 0, 0, 0)
      return { inicio: d.toISOString(), fim }
    }
    return {
      inicio: dataInicio ? new Date(dataInicio + "T00:00:00").toISOString() : new Date(hoje.setDate(hoje.getDate() - 30)).toISOString(),
      fim: dataFim ? new Date(dataFim + "T23:59:59.999").toISOString() : fim,
    }
  }, [periodo, dataInicio, dataFim])

  const [mapaDescricaoProdutos, setMapaDescricaoProdutos] = useState<Record<string, string>>({})

  // ─── Carga ────────────────────────────────────────────────────────────────

  const loadData = async () => {
    setLoading(true)
    try {
      const [
        { data: ap },
        { data: ps },
        { data: op },
        { data: mq },
        { data: oc },
        { data: mv },
        { data: prods },
        { data: config },
        { data: turnosData },
      ] = await Promise.all([
        supabase.from("apontamentos")
          .select("id, ordem_id, operacao_id, operacao_nome, maquina_id, cronometro_total_segundos, pecas_produzidas, pecas_refugo, pecas_retrabalho, status, created_at")
          .eq("empresa_id", empresaAtivaId!)
          .gte("created_at", inicio)
          .lte("created_at", fim)
          .order("created_at"),
        supabase.from("apontamento_pausas")
          .select("id, apontamento_id, subgrupo_id, inicio, fim, excecao_subgrupos(nome, excecao_grupos(nome))")
          .eq("empresa_id", empresaAtivaId!)
          .gte("inicio", inicio)
          .lte("inicio", fim),
        supabase.from("ordens_producao")
          .select("id, numero_op, produto_codigo, quantidade, data_programacao, status")
          .eq("empresa_id", empresaAtivaId!),
        supabase.from("maquinas")
          .select("id, nome, codigo")
          .eq("empresa_id", empresaAtivaId!),
        supabase.from("operacoes")
          .select("id, nome, tempo, unidade, maquina_id, produto_id, ordem")
          .eq("empresa_id", empresaAtivaId!),
        supabase.from("movimentacoes_estoque")
          .select("id, insumo_id, tipo, quantidade, custo_unitario, valor_total, created_at, insumos(codigo, descricao, unidade_medida)")
          .eq("empresa_id", empresaAtivaId!)
          .in("tipo", ["saida_producao", "entrada_producao", "refugo"])
          .gte("created_at", inicio)
          .lte("created_at", fim),
        supabase.from("produtos")
          .select("id, codigo, descricao")
          .eq("empresa_id", empresaAtivaId!),
        supabase.from("empresas")
          .select("tempo_padrao, unidade_tempo")
          .eq("id", empresaAtivaId!)
          .maybeSingle(),
        supabase.from("turnos")
          .select("hora_inicio, hora_fim, dias_semana, ativo")
          .eq("empresa_id", empresaAtivaId!)
          .eq("ativo", true),
      ])

      setApontamentos((ap || []) as Apontamento[])
      setPausas((ps || []).map((p: any) => ({
        id: p.id,
        apontamento_id: p.apontamento_id,
        subgrupo_id: p.subgrupo_id,
        inicio: p.inicio,
        fim: p.fim,
        subgrupo: p.excecao_subgrupos ? {
          nome: p.excecao_subgrupos.nome,
          grupo: p.excecao_subgrupos.excecao_grupos,
        } : undefined,
      })))
      setOrdens((op || []) as OrdemProducao[])
      setMaquinas((mq || []) as Maquina[])
      setOperacoes((oc || []) as Operacao[])
      setMovimentacoes(mv || [])
      setEmpresaConfig((config || null) as EmpresaConfigRelatorios | null)
      setTurnos((turnosData || []) as TurnoProgramado[])
      setProdutos((prods || []) as ProdutoRelatorio[])

      const mapaDesc: Record<string, string> = {}
      const mapaCodigoPorId: Record<string, string> = {}
      for (const p of (prods || []) as any[]) {
        if (p.descricao) mapaDesc[p.codigo] = p.descricao
        if (p.id && p.codigo) mapaCodigoPorId[p.id] = p.codigo
      }
      setMapaDescricaoProdutos(mapaDesc)
      setCodigoProdutoPorId(mapaCodigoPorId)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (empresaAtivaId) loadData()
  }, [empresaAtivaId, inicio, fim])

  // ─── Apontamentos filtrados por Máquina e OP ──────────────────────────────

  const filteredApontamentos = useMemo(() => {
    const operacoesMap = new Map((operacoes || []).map(o => [o.id, o.maquina_id]))
    return apontamentos.filter(a => {
      if (selectedMaquinaId !== "all") {
        const effectiveMqId = a.maquina_id || (a.operacao_id ? operacoesMap.get(a.operacao_id) : null)
        if (effectiveMqId !== selectedMaquinaId) return false
      }
      if (selectedOpId !== "all") {
        if (a.ordem_id !== selectedOpId) return false
      }
      return true
    })
  }, [apontamentos, operacoes, selectedMaquinaId, selectedOpId])

  // ─── Cálculos OEE ─────────────────────────────────────────────────────────

  const dadosOEE = useMemo(() => {
    const operacoesMap = new Map((operacoes || []).map(o => [o.id, o.maquina_id]))
    const operacoesPorId = new Map((operacoes || []).map(o => [o.id, o]))
    const operacoesPorNome = new Map<string, Operacao[]>()
    for (const operacao of operacoes) {
      const chave = normalizarNomeOperacao(operacao.nome)
      const existentes = operacoesPorNome.get(chave) || []
      existentes.push(operacao)
      operacoesPorNome.set(chave, existentes)
    }
    const tempoProgramado = calcularTempoProgramado(
      inicio,
      fim,
      turnos,
      empresaConfig?.tempo_padrao,
      empresaConfig?.unidade_tempo,
    )

    const maquinasParaExibir = selectedMaquinaId === "all"
      ? maquinas
      : maquinas.filter(m => m.id === selectedMaquinaId)

    return maquinasParaExibir.map(maq => {
      const apsMAq = filteredApontamentos.filter(a => {
        if (a.status === "em_andamento") return false
        const effectiveMqId = a.maquina_id || (a.operacao_id ? operacoesMap.get(a.operacao_id) : null)
        return effectiveMqId === maq.id
      })
      const tempoDisponivelTotal = tempoProgramado.totalSegundos

      const tempoRodando = apsMAq.reduce((s, a) => s + (a.cronometro_total_segundos || 0), 0)
      const totalProduzidas = apsMAq.reduce((s, a) => s + (a.pecas_produzidas || 0), 0)
      const totalRefugo = apsMAq.reduce((s, a) => s + (a.pecas_refugo || 0), 0)
      const totalBoas = Math.max(0, totalProduzidas - totalRefugo)

      // O cronômetro já deixa de acumular enquanto o apontamento está pausado.
      // Subtrair as pausas novamente reduziria o tempo produtivo duas vezes.
      const disponibilidade = tempoDisponivelTotal > 0
        ? Math.min(100, (tempoRodando / tempoDisponivelTotal) * 100)
        : 0

      let apontamentosSemCiclo = 0
      let tempoTeorico = 0
      const apontamentosComProducao = apsMAq.filter(a => (a.pecas_produzidas || 0) > 0)
      for (const apontamento of apontamentosComProducao) {
        let operacao = apontamento.operacao_id
          ? operacoesPorId.get(apontamento.operacao_id)
          : undefined
        if (!operacao && apontamento.operacao_nome) {
          const candidatas = operacoesPorNome.get(normalizarNomeOperacao(apontamento.operacao_nome)) || []
          if (candidatas.length === 1) operacao = candidatas[0]
        }

        const cicloPlanejado = tempoPlanejadoEmSegundos(operacao)
        if (cicloPlanejado <= 0) {
          apontamentosSemCiclo += 1
          continue
        }
        tempoTeorico += cicloPlanejado * (apontamento.pecas_produzidas || 0)
      }

      const performanceCalculavel =
        apontamentosComProducao.length > 0 &&
        apontamentosSemCiclo === 0 &&
        tempoRodando > 0 &&
        tempoTeorico > 0
      const performance = performanceCalculavel
        ? Math.min(100, (tempoTeorico / tempoRodando) * 100)
        : 0

      const qualidade = totalProduzidas > 0 ? Math.max(0, (totalBoas / totalProduzidas) * 100) : 0
      const oeeCalculavel = tempoDisponivelTotal > 0 && performanceCalculavel && totalProduzidas > 0
      const oee = oeeCalculavel
        ? (disponibilidade / 100) * (performance / 100) * (qualidade / 100) * 100
        : 0

      // Flags de dados insuficientes
      const avisos: string[] = []
      if (tempoProgramado.origem === "padrao_empresa") {
        avisos.push("Sem turnos ativos — usando o tempo operacional padrão da empresa nos dias úteis")
      }
      if (tempoProgramado.origem === "indisponivel") {
        avisos.push("Sem turnos ou tempo operacional padrão — Disponibilidade e OEE não calculados")
      }
      if (apontamentosSemCiclo > 0) {
        avisos.push(`${apontamentosSemCiclo} apontamento(s) com produção sem ciclo padrão confiável — Performance e OEE não calculados`)
      }
      if (apontamentosComProducao.length === 0 && tempoRodando > 0) {
        avisos.push("Tempo registrado sem quantidade produzida — Performance e OEE não calculados")
      }
      if (apsMAq.length === 0) avisos.push("Sem apontamentos no período")

      return {
        maquina: `${maq.codigo}`,
        maquinaNome: maq.nome,
        disponibilidade: parseFloat(disponibilidade.toFixed(1)),
        performance: parseFloat(performance.toFixed(1)),
        qualidade: parseFloat(qualidade.toFixed(1)),
        oee: parseFloat(oee.toFixed(1)),
        totalProduzidas,
        totalBoas,
        totalRefugo,
        tempoRodando,
        avisos,
        performanceCalculavel,
        oeeCalculavel,
        dadosCompletos: avisos.length === 0,
      }
    }).filter(d => d.tempoRodando > 0 || d.totalProduzidas > 0)
  }, [maquinas, filteredApontamentos, operacoes, inicio, fim, selectedMaquinaId, turnos, empresaConfig])

  /**
   * ─── Taxa de refugo por produto ───────────────────────────────────────────
   * Regra de Negócio:
   * - Produção Bruta: soma de pecas_produzidas apontadas.
   * - Refugo: soma de pecas_refugo.
   * - Retrabalho: soma de pecas_retrabalho.
   * - Taxa de Refugo (%): (Refugo / Produção Bruta) * 100 se Produção Bruta > 0.
   */
  const dadosRefugo = useMemo(() => {
    const mapa: Record<string, { produtoRotulo: string; produzidas: number; refugo: number; retrabalho: number }> = {}
    for (const ap of filteredApontamentos) {
      const op = ordens.find(o => o.id === ap.ordem_id)
      const codigo = op?.produto_codigo ?? "Desconhecido"
      const desc = mapaDescricaoProdutos[codigo]
      const produtoRotulo = desc ? `${codigo} - ${desc}` : codigo

      if (!mapa[codigo]) mapa[codigo] = { produtoRotulo, produzidas: 0, refugo: 0, retrabalho: 0 }
      mapa[codigo].produzidas += ap.pecas_produzidas || 0
      mapa[codigo].refugo += ap.pecas_refugo || 0
      mapa[codigo].retrabalho += ap.pecas_retrabalho || 0
    }
    return Object.entries(mapa)
      .map(([codigo, d]) => ({
        produto: d.produtoRotulo,
        produzidas: d.produzidas,
        refugo: d.refugo,
        retrabalho: d.retrabalho,
        taxaRefugo: d.produzidas > 0 ? parseFloat(((d.refugo / d.produzidas) * 100).toFixed(1)) : 0,
        taxaRetrabalho: d.produzidas > 0 ? parseFloat(((d.retrabalho / d.produzidas) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.taxaRefugo - a.taxaRefugo)
  }, [filteredApontamentos, ordens, mapaDescricaoProdutos])

  /**
   * ─── Ciclo real vs planejado ──────────────────────────────────────────────
   * Regra de Negócio:
   * - Tempo Planejado: ciclo padrão definido no roteiro (operacoes.tempo) em minutos/segundos.
   * - Tempo Real: Média PONDERADA por peça = Soma(Cronômetro Total em Segundos) / Soma(Peças Produzidas).
   * - Desvio (%): ((Ciclo Real Ponderado em Segundos - Ciclo Planejado em Segundos) / Ciclo Planejado em Segundos) * 100.
   */
  const resultadoCiclo = useMemo(
    () => calcularCicloRealVsPlanejado(filteredApontamentos, operacoes, ordens, produtos),
    [filteredApontamentos, operacoes, ordens, produtos],
  )
  const produtosCiclo = resultadoCiclo.produtos
  const resumoCiclo = useMemo(() => calcularResumoCiclo(produtosCiclo), [produtosCiclo])
  const dadosGraficoCiclo = useMemo(() => produtosCiclo.slice(0, 10), [produtosCiclo])

  // ─── Consumo de matéria-prima ─────────────────────────────────────────────

  const dadosConsumo = useMemo(() => {
    const mapa: Record<string, { codigo: string; descricao: string; unidade: string; quantidade: number; valorTotal: number }> = {}
    for (const mv of movimentacoes) {
      if (mv.tipo !== "saida_producao") continue
      const key = mv.insumo_id
      if (!mapa[key]) mapa[key] = {
        codigo: mv.insumos?.codigo ?? "",
        descricao: mv.insumos?.descricao ?? "",
        unidade: mv.insumos?.unidade_medida ?? "",
        quantidade: 0,
        valorTotal: 0,
      }
      mapa[key].quantidade += mv.quantidade || 0
      mapa[key].valorTotal += mv.valor_total || 0
    }
    return Object.values(mapa)
      .sort((a, b) => b.valorTotal - a.valorTotal)
      .slice(0, 10)
  }, [movimentacoes])

  // ─── Ranking de paradas ───────────────────────────────────────────────────

  const dadosParadas = useMemo(() => {
    const mapa: Record<string, { grupo: string; motivo: string; totalSeg: number; count: number }> = {}
    for (const p of pausas) {
      if (!p.fim) continue
      const seg = (new Date(p.fim).getTime() - new Date(p.inicio).getTime()) / 1000
      const motivo = p.subgrupo?.nome ?? "Sem motivo"
      const grupo = p.subgrupo?.grupo?.nome ?? "Sem grupo"
      const key = `${grupo}__${motivo}`
      if (!mapa[key]) mapa[key] = { grupo, motivo, totalSeg: 0, count: 0 }
      mapa[key].totalSeg += seg
      mapa[key].count += 1
    }
    const total = Object.values(mapa).reduce((s, d) => s + d.totalSeg, 0)
    return Object.values(mapa)
      .map(d => ({
        ...d,
        horas: parseFloat((d.totalSeg / 3600).toFixed(2)),
        pct: total > 0 ? parseFloat(((d.totalSeg / total) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.totalSeg - a.totalSeg)
      .slice(0, 10)
  }, [pausas])

  const ultimaOperacaoPorProduto = useMemo(() => {
    const mapa: Record<string, { operacaoId: string; ordem: number }> = {}
    for (const operacao of operacoes) {
      if (!operacao.produto_id) continue
      const codigoProduto = codigoProdutoPorId[operacao.produto_id]
      if (!codigoProduto) continue

      const ordemOperacao = Number(operacao.ordem) || 0
      const atual = mapa[codigoProduto]
      if (!atual || ordemOperacao > atual.ordem) {
        mapa[codigoProduto] = { operacaoId: operacao.id, ordem: ordemOperacao }
      }
    }
    return Object.fromEntries(
      Object.entries(mapa).map(([produto, valor]) => [produto, valor.operacaoId]),
    ) as Record<string, string>
  }, [operacoes, codigoProdutoPorId])

  // ─── KPIs gerais ─────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const apontamentosConcluidos = filteredApontamentos.filter(a => a.status !== "em_andamento")
    const ordensPorId = new Map(ordens.map(ordem => [ordem.id, ordem]))
    const apontamentosUltimaEtapa = apontamentosConcluidos.filter(apontamento => {
      const ordem = ordensPorId.get(apontamento.ordem_id)
      const ultimaOperacaoId = ordem ? ultimaOperacaoPorProduto[ordem.produto_codigo] : undefined
      return !!ultimaOperacaoId && apontamento.operacao_id === ultimaOperacaoId
    })

    // Produção acabada: conta as peças somente na última etapa do roteiro.
    // A base operacional continua sendo usada para refugo, pois o refugo pode
    // ser registrado em qualquer etapa e deve usar as peças processadas.
    const totalProduzidas = apontamentosUltimaEtapa.reduce((s, a) => s + (a.pecas_produzidas || 0), 0)
    const totalProcessadas = apontamentosConcluidos.reduce((s, a) => s + (a.pecas_produzidas || 0), 0)
    const totalRefugo = apontamentosConcluidos.reduce((s, a) => s + (a.pecas_refugo || 0), 0)
    const totalRetrabalho = apontamentosConcluidos.reduce((s, a) => s + (a.pecas_retrabalho || 0), 0)
    const totalSegundos = apontamentosConcluidos.reduce((s, a) => s + (a.cronometro_total_segundos || 0), 0)
    const totalPausaSeg = pausas.reduce((s, p) => {
      if (!p.fim) return s
      return s + (new Date(p.fim).getTime() - new Date(p.inicio).getTime()) / 1000
    }, 0)
    const temBaseRefugo = totalProcessadas > 0
    const dadosOEECalculaveis = dadosOEE.filter(d => d.oeeCalculavel)
    const temBaseOEE = dadosOEECalculaveis.length > 0
    const taxaRefugo = temBaseRefugo ? (totalRefugo / totalProcessadas) * 100 : 0
    const oeeGeral = temBaseOEE
      ? dadosOEECalculaveis.reduce((s, d) => s + d.oee, 0) / dadosOEECalculaveis.length
      : 0
    return { totalProduzidas, totalRefugo, totalRetrabalho, totalSegundos, totalPausaSeg, temBaseRefugo, temBaseOEE, taxaRefugo, oeeGeral }
  }, [filteredApontamentos, pausas, dadosOEE, ordens, ultimaOperacaoPorProduto])

  if (loading) {
    return (
      <div className="space-y-6 pb-12">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-9 w-36 rounded-xl" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl px-5 py-4 flex items-center gap-3 shadow-sm">
              <Skeleton className="h-10 w-10 rounded-xl flex-shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="h-5 w-14" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-12">

      {/* Header + filtros */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-foreground">Relatórios</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Análise de desempenho operacional</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Filtro Período */}
          <Select value={periodo} onValueChange={(v: Periodo) => setPeriodo(v)}>
            <SelectTrigger className="w-36 h-9 text-xs rounded-xl border border-border bg-input text-foreground outline-none focus:ring-2 focus:ring-primary transition-all">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="90d">Últimos 90 dias</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
          {periodo === "custom" && (
            <>
              <DatePicker value={dataInicio} onChange={setDataInicio} className="w-36" />
              <DatePicker value={dataFim} onChange={setDataFim} className="w-36" />
            </>
          )}

          {/* Filtro Máquina */}
          <Select value={selectedMaquinaId} onValueChange={setSelectedMaquinaId}>
            <SelectTrigger className="w-44 h-9 text-xs rounded-xl border border-border bg-input text-foreground outline-none focus:ring-2 focus:ring-primary transition-all">
              <SelectValue placeholder="Todas as Máquinas" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border max-h-56">
              <SelectItem value="all">Todas as Máquinas</SelectItem>
              {maquinas.map(m => (
                <SelectItem key={m.id} value={m.id}>{m.codigo} - {m.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Filtro OP */}
          <Select value={selectedOpId} onValueChange={setSelectedOpId}>
            <SelectTrigger className="w-48 h-9 text-xs rounded-xl border border-border bg-input text-foreground outline-none focus:ring-2 focus:ring-primary transition-all">
              <SelectValue placeholder="Todas as OPs" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border max-h-56">
              <SelectItem value="all">Todas as OPs</SelectItem>
              {ordens.map(o => {
                const desc = mapaDescricaoProdutos[o.produto_codigo]
                const prodText = desc ? `${o.produto_codigo} - ${desc}` : o.produto_codigo
                const opTitle = o.numero_op.toLowerCase().startsWith("op") ? o.numero_op : `OP ${o.numero_op}`
                return (
                  <SelectItem key={o.id} value={o.id}>{opTitle} ({prodText})</SelectItem>
                )
              })}
            </SelectContent>
          </Select>

          <button onClick={loadData} className="h-9 w-9 flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted transition-colors" title="Atualizar dados">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Aviso Orientativo sobre Paradas Programadas e Histórico */}
      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3 text-xs">
        <Clock className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-foreground">Regra de Paradas Programadas (Almoço / Fim de Turno)</p>
          <p className="text-muted-foreground leading-relaxed">
            Pausas registradas como <strong>Almoço</strong>, <strong>Refeição</strong>, <strong>Fim de Turno</strong> ou <strong>Intervalo Programado</strong> são tratadas como tempo não programado e não penalizam a Disponibilidade nem o OEE da fábrica.
            Caso precise recategorizar paradas históricas afetadas por lançamentos incorretos em horários de intervalo, utilize o gerenciador na aba <strong>Exceções</strong>.
          </p>
        </div>
      </div>

      {/* KPIs gerais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "OEE médio geral", value: kpis.oeeGeral, hasBase: kpis.temBaseOEE, decimals: 1, suffix: "%", icon: BarChart3, color: !kpis.temBaseOEE ? "text-muted-foreground" : kpis.oeeGeral >= 85 ? "text-green-600" : kpis.oeeGeral >= 60 ? "text-amber-500" : "text-destructive" },
          { label: "Peças acabadas", value: kpis.totalProduzidas, hasBase: true, decimals: 0, suffix: "", icon: TrendingUp, color: "text-primary" },
          { label: "Taxa de refugo", value: kpis.taxaRefugo, hasBase: kpis.temBaseRefugo, decimals: 1, suffix: "%", icon: AlertTriangle, color: !kpis.temBaseRefugo ? "text-muted-foreground" : kpis.taxaRefugo > 5 ? "text-destructive" : "text-green-600" },
        ].map(({ label, value, hasBase, decimals, suffix, icon: Icon, color }) => (
          <div key={label} className="bg-card border border-border rounded-2xl px-5 py-4 flex items-center gap-3 shadow-sm">
            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-muted flex-shrink-0">
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground font-medium leading-tight">{label}</p>
              <p className="text-lg font-bold text-foreground mt-0.5">
                {hasBase ? <CountUp value={value} decimals={decimals} suffix={suffix} /> : "N/A"}
              </p>
            </div>
          </div>
        ))}
        <div className="bg-card border border-border rounded-2xl px-5 py-4 flex items-center gap-3 shadow-sm">
          <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-muted flex-shrink-0">
            <Clock className="h-5 w-5 text-amber-500" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground font-medium leading-tight">Tempo total em pausa</p>
            <p className="text-lg font-bold text-foreground mt-0.5">{formatTempo(kpis.totalPausaSeg)}</p>
          </div>
        </div>
      </div>

      {/* Seletor de relatório: agora fica no submenu da barra lateral */}
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
        Visualizando: <span className="text-primary">{RELATORIOS_CONFIG.find(r => r.id === relatorioAtivo)?.label}</span>
      </p>


      {/* ─── OEE ─────────────────────────────────────────────────────────────── */}
      {relatorioAtivo === "oee" && (
        <div className="space-y-4">
          {dadosOEE.length === 0 ? (
            <EmptyState icon={BarChart3} label="Nenhum apontamento encontrado com os filtros selecionados" />
          ) : (
            <>
              {/* Avisos de dados insuficientes */}
              {dadosOEE.some(d => d.avisos.length > 0) && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                    <p className="text-xs font-bold text-amber-500 uppercase tracking-wider">Dados incompletos — OEE pode ser impreciso</p>
                  </div>
                  {dadosOEE.filter(d => d.avisos.length > 0).map(d => (
                    <div key={d.maquina} className="space-y-1">
                      <p className="text-[10px] font-bold text-foreground">{d.maquina} — {d.maquinaNome}</p>
                      {d.avisos.map((av, i) => (
                        <p key={i} className="text-[10px] text-amber-600 pl-3">· {av}</p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
                <h3 className="text-sm font-bold text-foreground mb-1">OEE por Máquina</h3>
                <p className="text-[11px] text-muted-foreground mb-5">Meta de classe mundial: 85%</p>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={dadosOEE} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="maquina" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} unit="%" />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="disponibilidade" name="Disponibilidade" fill={APPLE_CHART_COLORS.blue} radius={[4, 4, 0, 0]} unit="%" />
                    <Bar dataKey="performance" name="Performance" fill={APPLE_CHART_COLORS.indigo} radius={[4, 4, 0, 0]} unit="%" />
                    <Bar dataKey="qualidade" name="Qualidade" fill={APPLE_CHART_COLORS.green} radius={[4, 4, 0, 0]} unit="%" />
                    <Bar dataKey="oee" name="OEE" fill={APPLE_CHART_COLORS.teal} radius={[4, 4, 0, 0]} unit="%" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {["Máquina", "Disponib.", "Perform.", "Qualidade", "OEE", "Peças boas", "Refugo"].map(h => (
                        <th key={h} className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dadosOEE.map(d => (
                      <tr key={d.maquina} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <p className="text-xs font-bold text-foreground">{d.maquina}</p>
                          <p className="text-[10px] text-muted-foreground">{d.maquinaNome}</p>
                        </td>
                        <td className="px-4 py-3 text-xs">{formatNum(d.disponibilidade)}%</td>
                        <td className="px-4 py-3 text-xs">{d.performanceCalculavel ? `${formatNum(d.performance)}%` : "N/A"}</td>
                        <td className="px-4 py-3 text-xs">{formatNum(d.qualidade)}%</td>
                        <td className="px-4 py-3">
                          {d.oeeCalculavel ? (
                            <span className={`text-xs font-bold ${d.oee >= 85 ? "text-green-600" : d.oee >= 60 ? "text-amber-500" : "text-destructive"}`}>
                              {formatNum(d.oee)}%
                            </span>
                          ) : <span className="text-xs text-muted-foreground">N/A</span>}
                        </td>
                        <td className="px-4 py-3 text-xs font-bold text-foreground">{d.totalBoas}</td>
                        <td className="px-4 py-3 text-xs text-destructive">{d.totalRefugo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── REFUGO ──────────────────────────────────────────────────────────── */}
      {relatorioAtivo === "refugo" && (
        <div className="space-y-4">
          {dadosRefugo.length === 0 ? (
            <EmptyState icon={AlertTriangle} label="Nenhum apontamento no período" />
          ) : (
            <>
              <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
                <h3 className="text-sm font-bold text-foreground mb-1">Taxa de Refugo por Produto</h3>
                <p className="text-[11px] text-muted-foreground mb-5">Meta recomendada: abaixo de 2%</p>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dadosRefugo.slice(0, 8)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="produto" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} unit="%" />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="taxaRefugo" name="Refugo" radius={[4, 4, 0, 0]} unit="%">
                      {dadosRefugo.slice(0, 8).map((d, i) => (
                        <Cell
                          key={i}
                          fill={
                            d.taxaRefugo > 5
                              ? APPLE_CHART_COLORS.red
                              : d.taxaRefugo > 2
                                ? APPLE_CHART_COLORS.orange
                                : APPLE_CHART_COLORS.green
                          }
                        />
                      ))}
                    </Bar>
                    <Bar dataKey="taxaRetrabalho" name="Retrabalho" fill={APPLE_CHART_COLORS.purple} radius={[4, 4, 0, 0]} unit="%" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {["Produto", "Produzidas", "Refugo", "Retrabalho", "Taxa Refugo", "Taxa Retrabalho"].map(h => (
                        <th key={h} className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dadosRefugo.map(d => (
                      <tr key={d.produto} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-xs font-bold text-foreground">{d.produto}</td>
                        <td className="px-4 py-3 text-xs text-foreground">{d.produzidas}</td>
                        <td className="px-4 py-3 text-xs text-destructive font-bold">{d.refugo}</td>
                        <td className="px-4 py-3 text-xs text-amber-500 font-bold">{d.retrabalho}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold ${d.taxaRefugo > 5 ? "text-destructive" : d.taxaRefugo > 2 ? "text-amber-500" : "text-green-600"}`}>
                            {formatNum(d.taxaRefugo)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-amber-500">{formatNum(d.taxaRetrabalho)}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30 font-bold text-xs">
                      <td className="px-4 py-3 text-muted-foreground uppercase tracking-wider">Total Consolidado</td>
                      <td className="px-4 py-3 text-foreground">{dadosRefugo.reduce((s, d) => s + d.produzidas, 0)}</td>
                      <td className="px-4 py-3 text-destructive">{dadosRefugo.reduce((s, d) => s + d.refugo, 0)}</td>
                      <td className="px-4 py-3 text-amber-500">{dadosRefugo.reduce((s, d) => s + d.retrabalho, 0)}</td>
                      <td className="px-4 py-3">
                        {(() => {
                          const totProd = dadosRefugo.reduce((s, d) => s + d.produzidas, 0)
                          const totRef = dadosRefugo.reduce((s, d) => s + d.refugo, 0)
                          const taxa = totProd > 0 ? (totRef / totProd) * 100 : 0
                          return (
                            <span className={taxa > 5 ? "text-destructive" : taxa > 2 ? "text-amber-500" : "text-green-600"}>
                              {formatNum(taxa)}%
                            </span>
                          )
                        })()}
                      </td>
                      <td className="px-4 py-3 text-amber-500">
                        {(() => {
                          const totProd = dadosRefugo.reduce((s, d) => s + d.produzidas, 0)
                          const totRet = dadosRefugo.reduce((s, d) => s + d.retrabalho, 0)
                          const taxa = totProd > 0 ? (totRet / totProd) * 100 : 0
                          return `${formatNum(taxa)}%`
                        })()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── CICLO ───────────────────────────────────────────────────────────── */}
      {relatorioAtivo === "ciclo" && (
        <div className="space-y-4">
          {produtosCiclo.length === 0 ? (
            <EmptyState icon={Clock} label="Nenhum produto com apontamento e roteiro no período" />
          ) : (
            <>
              {produtosCiclo.some(produto => produto.semPadrao) && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl px-4 py-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-amber-500">Produtos com roteiro sem tempo previsto</p>
                    <p className="text-[10px] text-amber-600 mt-0.5">
                      {produtosCiclo.filter(produto => produto.semPadrao).map(produto => produto.produto).join(", ")} — abra o produto para identificar as operações sem padrão. O desvio do produto fica indisponível até o roteiro estar completo.
                    </p>
                  </div>
                </div>
              )}
              {produtosCiclo.some(produto => !produto.comparavel) && (
                <div className="bg-primary/5 border border-primary/20 rounded-2xl px-4 py-3 flex items-start gap-2">
                  <Clock className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-foreground">Realizado parcial</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {produtosCiclo.filter(produto => !produto.comparavel).length} produto(s) ainda não possuem medição e padrão em todas as operações. O realizado parcial é exibido, mas o desvio só aparece quando o roteiro inteiro é comparável.
                    </p>
                  </div>
                </div>
              )}
              {(resultadoCiclo.apontamentosInconsistentes > 0 ||
                resultadoCiclo.apontamentosSemOperacao > 0 ||
                resultadoCiclo.apontamentosOperacaoDivergente > 0) && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl px-4 py-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-amber-500">Apontamentos excluídos do cálculo</p>
                    <p className="text-[10px] text-amber-600 mt-0.5">
                      {resultadoCiclo.apontamentosInconsistentes} sem tempo ou quantidade final, {resultadoCiclo.apontamentosSemOperacao} sem operação identificada e {resultadoCiclo.apontamentosOperacaoDivergente} vinculados a uma operação de outro produto. Esses registros não entram nas médias.
                    </p>
                  </div>
                </div>
              )}
              {produtosCiclo.some(produto => produto.atencaoMedicao) && (
                <div className="bg-primary/5 border border-primary/20 rounded-2xl px-4 py-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-foreground">Medições que merecem conferência</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Há {produtosCiclo.reduce((total, produto) => total + produto.operacoes.filter(operacao => operacao.atencaoMedicao).length, 0)} operação(ões) abaixo de 20% ou acima de 500% do previsto. Os valores permanecem no realizado, com indicação no detalhamento.
                    </p>
                  </div>
                </div>
              )}
              <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
                <h3 className="text-sm font-bold text-foreground mb-1">Ciclo Previsto vs Realizado por Produto</h3>
                <p className="text-[11px] text-muted-foreground mb-5">
                  Produto = soma dos ciclos por peça das operações do roteiro. O tempo bruto dos cronômetros nunca é somado diretamente.
                </p>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={dadosGraficoCiclo} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="codigo" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={valor => formatTempoCiclo(Number(valor) * 60)}
                    />
                    <Tooltip
                      cursor={{
                        fill: "rgb(var(--chart-hover-glass))",
                        fillOpacity: 0.32,
                        stroke: "rgb(var(--chart-hover-glass-border))",
                        strokeOpacity: 0.7,
                        strokeWidth: 1,
                        rx: 16,
                      }}
                      content={<ChartTooltip valueFormatter={(valor: number) => formatTempoCiclo(Number(valor) * 60)} />}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="planejado" name="Previsto do produto" fill={APPLE_CHART_COLORS.blue} radius={[4, 4, 0, 0]} />
                    <Bar
                      dataKey="real"
                      name="Realizado (verde ≤ previsto; vermelho >)"
                      fill={APPLE_CHART_COLORS.green}
                      radius={[4, 4, 0, 0]}
                    >
                      {dadosGraficoCiclo.map((produto, i) => (
                        <Cell
                          key={i}
                          fill={
                            produto.planejado > 0
                              ? produto.real <= produto.planejado
                                ? APPLE_CHART_COLORS.green
                                : APPLE_CHART_COLORS.red
                              : APPLE_CHART_COLORS.orange
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-muted/30 border border-border rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-xs font-bold text-foreground">Cobertura do relatório</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {resumoCiclo.produtosComparaveis} de {resumoCiclo.produtosTotal} produto(s) possuem previsto e realizado em todas as operações.
                  </p>
                </div>
                <p className="text-[10px] text-muted-foreground">Clique no produto para abrir o roteiro detalhado.</p>
              </div>

              <div className="bg-card border border-border rounded-2xl shadow-sm overflow-x-auto">
                <table className="w-full min-w-[880px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {["Produto", "Cobertura do roteiro", "Previsto", "Realizado", "Desvio", "Detalhes"].map(h => (
                        <th key={h} className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {produtosCiclo.map(produto => {
                      const expandido = produtoCicloExpandido === produto.id
                      return (
                        <React.Fragment key={produto.id}>
                          <tr className="hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => setProdutoCicloExpandido(expandido ? null : produto.id)}
                                className="w-full flex items-center gap-2 text-left"
                                aria-expanded={expandido}
                              >
                                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandido ? "rotate-180" : ""}`} />
                                <span>
                                  <span className="block text-xs font-bold text-foreground">{produto.codigo}</span>
                                  {produto.descricao && <span className="block text-[10px] text-muted-foreground mt-0.5">{produto.descricao}</span>}
                                  {produto.ordens && <span className="block text-[10px] text-muted-foreground mt-0.5">OP {produto.ordens}</span>}
                                </span>
                              </button>
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-xs font-bold text-foreground">{produto.operacoesMedidas}/{produto.operacoesTotal} operações medidas</p>
                              <span className={`inline-flex mt-1 text-[9px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${
                                produto.comparavel
                                  ? "text-green-600 bg-green-500/10"
                                  : produto.operacoesMedidas > 0
                                    ? "text-amber-600 bg-amber-500/10"
                                    : "text-muted-foreground bg-muted"
                              }`}>
                                {produto.comparavel ? "Completo" : produto.operacoesMedidas > 0 ? "Parcial" : "Sem medição"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {produto.planejadoSeg > 0 ? formatTempoCiclo(produto.planejadoSeg) : "Sem padrão"}
                            </td>
                            <td className="px-4 py-3">
                              {produto.operacoesMedidas > 0 ? (
                                <>
                                  <p className="text-xs font-bold text-foreground">{formatTempoCiclo(produto.realSeg)}</p>
                                  {!produto.comparavel && <p className="text-[10px] text-amber-600 mt-0.5">Somatório parcial</p>}
                                </>
                              ) : <span className="text-xs text-muted-foreground">Sem medição</span>}
                            </td>
                            <td className="px-4 py-3">
                              {produto.comparavel ? (
                                <span className={`text-xs font-bold ${produto.desvio > 20 ? "text-destructive" : produto.desvio > 0 ? "text-amber-500" : "text-green-600"}`}>
                                  {produto.desvio > 0 ? "+" : ""}{formatNum(produto.desvio)}%
                                </span>
                              ) : <span className="text-xs text-muted-foreground">Aguardando roteiro completo</span>}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => setProdutoCicloExpandido(expandido ? null : produto.id)}
                                className="text-xs font-bold text-primary hover:underline"
                              >
                                {expandido ? "Ocultar operações" : "Ver operações"}
                              </button>
                            </td>
                          </tr>

                          {expandido && (
                            <tr>
                              <td colSpan={6} className="p-0 bg-muted/15">
                                <div className="px-6 py-4">
                                  <div className="flex items-start justify-between gap-3 mb-3">
                                    <div>
                                      <p className="text-xs font-bold text-foreground">Operações do roteiro</p>
                                      <p className="text-[10px] text-muted-foreground mt-0.5">
                                        Realizado de cada operação = tempo registrado ÷ peças registradas.
                                      </p>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">{produto.totalApontamentos} apontamento(s) válidos</p>
                                  </div>
                                  <div className="overflow-x-auto rounded-xl border border-border bg-card">
                                    <table className="w-full min-w-[760px] text-sm">
                                      <thead>
                                        <tr className="border-b border-border bg-muted/30">
                                          {["Etapa", "Operação", "Base da medição", "Previsto", "Realizado", "Desvio"].map(h => (
                                            <th key={h} className="text-left text-[9px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-2">{h}</th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-border">
                                        {produto.operacoes.map(operacao => (
                                          <tr key={operacao.id}>
                                            <td className="px-3 py-2 text-xs text-muted-foreground">{operacao.ordem || "—"}</td>
                                            <td className="px-3 py-2">
                                              <p className="text-xs font-bold text-foreground">{operacao.nome}</p>
                                              {operacao.atencaoMedicao && (
                                                <span className="inline-flex mt-1 text-[9px] font-bold text-primary bg-primary/10 rounded-full px-2 py-0.5">
                                                  Conferir medição
                                                </span>
                                              )}
                                            </td>
                                            <td className="px-3 py-2">
                                              {operacao.temMedicao ? (
                                                <>
                                                  <p className="text-xs text-foreground">{operacao.totalPecas} peças</p>
                                                  <p className="text-[10px] text-muted-foreground">{operacao.totalApontamentos} apontamento(s)</p>
                                                </>
                                              ) : <span className="text-xs text-muted-foreground">Sem medição</span>}
                                            </td>
                                            <td className="px-3 py-2 text-xs text-muted-foreground">
                                              {operacao.planejadoSeg > 0 ? formatTempoCiclo(operacao.planejadoSeg) : "Sem padrão"}
                                            </td>
                                            <td className="px-3 py-2 text-xs font-bold text-foreground">
                                              {operacao.temMedicao ? formatTempoCiclo(operacao.realSeg) : "—"}
                                            </td>
                                            <td className="px-3 py-2">
                                              {operacao.comparavel ? (
                                                <span className={`text-xs font-bold ${operacao.desvio > 20 ? "text-destructive" : operacao.desvio > 0 ? "text-amber-500" : "text-green-600"}`}>
                                                  {operacao.desvio > 0 ? "+" : ""}{formatNum(operacao.desvio)}%
                                                </span>
                                              ) : <span className="text-xs text-muted-foreground">{operacao.semPadrao ? "Sem padrão" : "Sem medição"}</span>}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── CONSUMO ─────────────────────────────────────────────────────────── */}
      {relatorioAtivo === "consumo" && (
        <div className="space-y-4">
          {dadosConsumo.length === 0 ? (
            <EmptyState icon={Package} label="Nenhuma movimentação de consumo no período" />
          ) : (
            <>
              <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
                <h3 className="text-sm font-bold text-foreground mb-1">Consumo de Matéria-Prima</h3>
                <p className="text-[11px] text-muted-foreground mb-5">Por valor total consumido no período</p>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dadosConsumo.slice(0, 8)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={v => formatBRL(v)} />
                    <YAxis type="category" dataKey="codigo" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={60} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="valorTotal"
                      name="Valor consumido"
                      fill={APPLE_CHART_COLORS.teal}
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {["Código", "Descrição", "Quantidade", "Valor Total"].map(h => (
                        <th key={h} className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dadosConsumo.map(d => (
                      <tr key={d.codigo} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-xs font-bold text-foreground">{d.codigo}</td>
                        <td className="px-4 py-3 text-xs text-foreground">{d.descricao}</td>
                        <td className="px-4 py-3 text-xs text-foreground">{formatNum(d.quantidade, 3)} {d.unidade}</td>
                        <td className="px-4 py-3 text-xs font-bold text-foreground">{formatBRL(d.valorTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30">
                      <td colSpan={3} className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Total</td>
                      <td className="px-4 py-3 text-sm font-black text-foreground">
                        {formatBRL(dadosConsumo.reduce((s, d) => s + d.valorTotal, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── PARADAS ─────────────────────────────────────────────────────────── */}
      {relatorioAtivo === "paradas" && (
        <div className="space-y-4">
          {dadosParadas.length === 0 ? (
            <EmptyState icon={TrendingDown} label="Nenhuma parada registrada no período" />
          ) : (
            <>
              <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
                <h3 className="text-sm font-bold text-foreground mb-1">Ranking de Paradas</h3>
                <p className="text-[11px] text-muted-foreground mb-5">Pareto das perdas por motivo — em horas</p>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={dadosParadas} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} unit="h" />
                    <YAxis type="category" dataKey="motivo" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={100} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="horas"
                      name="Horas paradas"
                      fill={APPLE_CHART_COLORS.orange}
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {["Grupo", "Motivo", "Ocorrências", "Tempo total", "% do total"].map(h => (
                        <th key={h} className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dadosParadas.map((d, i) => (
                      <tr key={i} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">{d.grupo}</span>
                        </td>
                        <td className="px-4 py-3 text-xs font-bold text-foreground">{d.motivo}</td>
                        <td className="px-4 py-3 text-xs text-foreground">{d.count}x</td>
                        <td className="px-4 py-3 text-xs font-bold text-foreground">{formatTempo(d.totalSeg)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${d.pct}%` }} />
                            </div>
                            <span className="text-xs font-bold text-foreground w-10 text-right">{formatNum(d.pct)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function EmptyState({ label, icon }: { label: string; icon?: LucideIcon }) {
  return (
    <EmptyStateBase
      icon={icon ?? BarChart3}
      title="Sem dados suficientes"
      description={label}
      className="bg-card border border-border rounded-2xl shadow-sm"
    />
  )
}
