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
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend, Cell
} from "recharts"
import {
  TrendingUp, TrendingDown, AlertTriangle, Clock, Package,
  BarChart3, Filter, Download, RefreshCw, ChevronDown,
  type LucideIcon
} from "lucide-react"

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
  tempo_operacional_dia?: number
}

interface Operacao {
  id: string
  nome: string
  tempo: number
  unidade: string
  maquina_id?: string
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

const CORES = ["hsl(var(--primary))", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316"]

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

  // ─── Período ──────────────────────────────────────────────────────────────

  const { inicio, fim } = useMemo(() => {
    const hoje = new Date()
    const fim = hoje.toISOString()
    if (periodo === "7d") {
      const d = new Date(hoje); d.setDate(d.getDate() - 7)
      return { inicio: d.toISOString(), fim }
    }
    if (periodo === "30d") {
      const d = new Date(hoje); d.setDate(d.getDate() - 30)
      return { inicio: d.toISOString(), fim }
    }
    if (periodo === "90d") {
      const d = new Date(hoje); d.setDate(d.getDate() - 90)
      return { inicio: d.toISOString(), fim }
    }
    return {
      inicio: dataInicio ? new Date(dataInicio).toISOString() : new Date(hoje.setDate(hoje.getDate() - 30)).toISOString(),
      fim: dataFim ? new Date(dataFim + "T23:59:59").toISOString() : new Date().toISOString(),
    }
  }, [periodo, dataInicio, dataFim])

  // ─── Carga ────────────────────────────────────────────────────────────────

  const loadData = async () => {
    setLoading(true)
    try {
      const [{ data: ap }, { data: ps }, { data: op }, { data: mq }, { data: oc }, { data: mv }] = await Promise.all([
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
          .select("id, nome, codigo, tempo_operacional_dia")
          .eq("empresa_id", empresaAtivaId!),
        supabase.from("operacoes")
          .select("id, nome, tempo, unidade, maquina_id"),
        supabase.from("movimentacoes_estoque")
          .select("id, insumo_id, tipo, quantidade, custo_unitario, valor_total, created_at, insumos(codigo, descricao, unidade_medida)")
          .eq("empresa_id", empresaAtivaId!)
          .in("tipo", ["saida_producao", "entrada_producao", "refugo"])
          .gte("created_at", inicio)
          .lte("created_at", fim),
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
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (empresaAtivaId) loadData()
  }, [empresaAtivaId, inicio, fim])

  // ─── Cálculos OEE ─────────────────────────────────────────────────────────

  const dadosOEE = useMemo(() => {
    const diasPeriodo = Math.max(1, Math.round((new Date(fim).getTime() - new Date(inicio).getTime()) / (1000 * 60 * 60 * 24)))
    const horasDisponivelDia = 8
    const tempoDisponivelTotal = diasPeriodo * horasDisponivelDia * 3600

    return maquinas.map(maq => {
      const apsMAq = apontamentos.filter(a => a.maquina_id === maq.id)
      const pausasMaq = pausas.filter(p => apsMAq.find(a => a.id === p.apontamento_id))

      const tempoRodando = apsMAq.reduce((s, a) => s + (a.cronometro_total_segundos || 0), 0)
      const tempoPausa = pausasMaq.reduce((s, p) => {
        if (!p.fim) return s
        return s + (new Date(p.fim).getTime() - new Date(p.inicio).getTime()) / 1000
      }, 0)

      const tempoEfetivo = Math.max(0, tempoRodando - tempoPausa)
      const totalProduzidas = apsMAq.reduce((s, a) => s + (a.pecas_produzidas || 0), 0)
      const totalRefugo = apsMAq.reduce((s, a) => s + (a.pecas_refugo || 0), 0)
      const totalBoas = totalProduzidas - totalRefugo

      const disponibilidade = tempoDisponivelTotal > 0 ? Math.min(100, (tempoEfetivo / tempoDisponivelTotal) * 100) : 0

      const opsMaq = operacoes.filter(o => o.maquina_id === maq.id)
      const tempoTeorico = opsMaq.reduce((s, o) => {
        const fator = o.unidade === "minutes" ? 60 : 1
        return s + o.tempo * fator * totalProduzidas
      }, 0)

      const semCiclo = opsMaq.length === 0 || tempoTeorico === 0
      const performance = tempoEfetivo > 0 && tempoTeorico > 0
        ? Math.min(100, (tempoTeorico / tempoEfetivo) * 100)
        : tempoEfetivo > 0 ? 80 : 0

      const qualidade = totalProduzidas > 0 ? (totalBoas / totalProduzidas) * 100 : 0
      const oee = (disponibilidade / 100) * (performance / 100) * (qualidade / 100) * 100

      // Flags de dados insuficientes
      const avisos: string[] = []
      if (!maq.tempo_operacional_dia) avisos.push("Tempo operacional/dia não cadastrado — usando 8h como padrão")
      if (semCiclo) avisos.push("Sem roteiro vinculado à máquina — Performance estimada em 80%")
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
        dadosCompletos: avisos.length === 0,
      }
    }).filter(d => d.tempoRodando > 0)
  }, [maquinas, apontamentos, pausas, operacoes, inicio, fim])

  // ─── Taxa de refugo por produto ───────────────────────────────────────────

  const dadosRefugo = useMemo(() => {
    const mapa: Record<string, { produzidas: number; refugo: number; retrabalho: number }> = {}
    for (const ap of apontamentos) {
      const op = ordens.find(o => o.id === ap.ordem_id)
      const codigo = op?.produto_codigo ?? "Desconhecido"
      if (!mapa[codigo]) mapa[codigo] = { produzidas: 0, refugo: 0, retrabalho: 0 }
      mapa[codigo].produzidas += ap.pecas_produzidas || 0
      mapa[codigo].refugo += ap.pecas_refugo || 0
      mapa[codigo].retrabalho += ap.pecas_retrabalho || 0
    }
    return Object.entries(mapa)
      .map(([produto, d]) => ({
        produto,
        produzidas: d.produzidas,
        refugo: d.refugo,
        retrabalho: d.retrabalho,
        taxaRefugo: d.produzidas > 0 ? parseFloat(((d.refugo / d.produzidas) * 100).toFixed(1)) : 0,
        taxaRetrabalho: d.produzidas > 0 ? parseFloat(((d.retrabalho / d.produzidas) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.taxaRefugo - a.taxaRefugo)
  }, [apontamentos, ordens])

  // ─── Ciclo real vs planejado ──────────────────────────────────────────────

  const dadosCiclo = useMemo(() => {
    const mapa: Record<string, { nome: string; totalSeg: number; count: number; planejadoSeg: number }> = {}
    for (const ap of apontamentos) {
      if (!ap.operacao_nome || !ap.cronometro_total_segundos || !ap.pecas_produzidas) continue
      const key = ap.operacao_nome
      if (!mapa[key]) {
        const op = operacoes.find(o => o.nome === ap.operacao_nome)
        const planejado = op ? (op.unidade === "minutes" ? op.tempo * 60 : op.tempo) : 0
        mapa[key] = { nome: key, totalSeg: 0, count: 0, planejadoSeg: planejado }
      }
      const cicloReal = ap.pecas_produzidas > 0 ? ap.cronometro_total_segundos / ap.pecas_produzidas : 0
      mapa[key].totalSeg += cicloReal
      mapa[key].count += 1
    }
    return Object.values(mapa)
      .map(d => ({
        operacao: d.nome.length > 16 ? d.nome.slice(0, 16) + "…" : d.nome,
        nomeCompleto: d.nome,
        realSeg: d.count > 0 ? parseFloat((d.totalSeg / d.count).toFixed(1)) : 0,
        planejadoSeg: parseFloat(d.planejadoSeg.toFixed(1)),
        real: d.count > 0 ? parseFloat(((d.totalSeg / d.count) / 60).toFixed(2)) : 0,
        planejado: parseFloat((d.planejadoSeg / 60).toFixed(2)),
        semPadrao: d.planejadoSeg === 0,
        desvio: d.planejadoSeg > 0 && d.count > 0
          ? parseFloat((((d.totalSeg / d.count) - d.planejadoSeg) / d.planejadoSeg * 100).toFixed(1))
          : 0,
      }))
      .filter(d => d.real > 0)
      .sort((a, b) => Math.abs(b.desvio) - Math.abs(a.desvio))
      .slice(0, 10)
  }, [apontamentos, operacoes])

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

  // ─── KPIs gerais ─────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const totalProduzidas = apontamentos.reduce((s, a) => s + (a.pecas_produzidas || 0), 0)
    const totalRefugo = apontamentos.reduce((s, a) => s + (a.pecas_refugo || 0), 0)
    const totalRetrabalho = apontamentos.reduce((s, a) => s + (a.pecas_retrabalho || 0), 0)
    const totalSegundos = apontamentos.reduce((s, a) => s + (a.cronometro_total_segundos || 0), 0)
    const totalPausaSeg = pausas.reduce((s, p) => {
      if (!p.fim) return s
      return s + (new Date(p.fim).getTime() - new Date(p.inicio).getTime()) / 1000
    }, 0)
    const taxaRefugo = totalProduzidas > 0 ? (totalRefugo / totalProduzidas) * 100 : 0
    const oeeGeral = dadosOEE.length > 0 ? dadosOEE.reduce((s, d) => s + d.oee, 0) / dadosOEE.length : 0
    return { totalProduzidas, totalRefugo, totalRetrabalho, totalSegundos, totalPausaSeg, taxaRefugo, oeeGeral }
  }, [apontamentos, pausas, dadosOEE])

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
          <button onClick={loadData} className="h-9 w-9 flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted transition-colors">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* KPIs gerais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "OEE médio geral", value: kpis.oeeGeral, decimals: 1, suffix: "%", icon: BarChart3, color: kpis.oeeGeral >= 85 ? "text-green-600" : kpis.oeeGeral >= 60 ? "text-amber-500" : "text-destructive" },
          { label: "Peças produzidas", value: kpis.totalProduzidas, decimals: 0, suffix: "", icon: TrendingUp, color: "text-primary" },
          { label: "Taxa de refugo", value: kpis.taxaRefugo, decimals: 1, suffix: "%", icon: AlertTriangle, color: kpis.taxaRefugo > 5 ? "text-destructive" : "text-green-600" },
        ].map(({ label, value, decimals, suffix, icon: Icon, color }) => (
          <div key={label} className="bg-card border border-border rounded-2xl px-5 py-4 flex items-center gap-3 shadow-sm">
            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-muted flex-shrink-0">
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground font-medium leading-tight">{label}</p>
              <p className="text-lg font-bold text-foreground mt-0.5">
                <CountUp value={value} decimals={decimals} suffix={suffix} />
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
            <EmptyState icon={BarChart3} label="Nenhum apontamento com máquina vinculada no período" />
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
                    <Bar dataKey="disponibilidade" name="Disponibilidade" fill="#3b82f6" radius={[4, 4, 0, 0]} unit="%" />
                    <Bar dataKey="performance" name="Performance" fill="#8b5cf6" radius={[4, 4, 0, 0]} unit="%" />
                    <Bar dataKey="qualidade" name="Qualidade" fill="#22c55e" radius={[4, 4, 0, 0]} unit="%" />
                    <Bar dataKey="oee" name="OEE" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} unit="%" />
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
                        <td className="px-4 py-3 text-xs">{formatNum(d.performance)}%</td>
                        <td className="px-4 py-3 text-xs">{formatNum(d.qualidade)}%</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold ${d.oee >= 85 ? "text-green-600" : d.oee >= 60 ? "text-amber-500" : "text-destructive"}`}>
                            {formatNum(d.oee)}%
                          </span>
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
                        <Cell key={i} fill={d.taxaRefugo > 5 ? "#ef4444" : d.taxaRefugo > 2 ? "#f59e0b" : "#22c55e"} />
                      ))}
                    </Bar>
                    <Bar dataKey="taxaRetrabalho" name="Retrabalho" fill="#8b5cf6" radius={[4, 4, 0, 0]} unit="%" />
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
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── CICLO ───────────────────────────────────────────────────────────── */}
      {relatorioAtivo === "ciclo" && (
        <div className="space-y-4">
          {dadosCiclo.length === 0 ? (
            <EmptyState icon={Clock} label="Nenhum apontamento com operação registrada no período" />
          ) : (
            <>
              {dadosCiclo.some(d => d.semPadrao) && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl px-4 py-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-amber-500">Operações sem tempo padrão cadastrado</p>
                    <p className="text-[10px] text-amber-600 mt-0.5">
                      {dadosCiclo.filter(d => d.semPadrao).map(d => d.nomeCompleto).join(", ")} — o desvio não pode ser calculado. Cadastre o tempo de ciclo no roteiro do produto.
                    </p>
                  </div>
                </div>
              )}
              <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
                <h3 className="text-sm font-bold text-foreground mb-1">Tempo de Ciclo Real vs Planejado</h3>
                <p className="text-[11px] text-muted-foreground mb-5">Em minutos por peça — média do período</p>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={dadosCiclo} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="operacao" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} unit="min" />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="planejado" name="Planejado" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} unit="min" />
                    <Bar dataKey="real" name="Real" radius={[4, 4, 0, 0]} unit="min">
                      {dadosCiclo.map((d, i) => (
                        <Cell key={i} fill={d.desvio > 20 ? "#ef4444" : d.desvio > 0 ? "#f59e0b" : "#22c55e"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {["Operação", "Planejado", "Real (média)", "Desvio"].map(h => (
                        <th key={h} className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dadosCiclo.map(d => (
                      <tr key={d.operacao} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-xs font-bold text-foreground">{d.nomeCompleto}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{d.planejado > 0 ? `${formatNum(d.planejado, 2)} min` : "—"}</td>
                        <td className="px-4 py-3 text-xs text-foreground font-bold">{formatNum(d.real, 2)} min</td>
                        <td className="px-4 py-3">
                          {d.planejado > 0 ? (
                            <span className={`text-xs font-bold ${d.desvio > 20 ? "text-destructive" : d.desvio > 0 ? "text-amber-500" : "text-green-600"}`}>
                              {d.desvio > 0 ? "+" : ""}{formatNum(d.desvio)}%
                            </span>
                          ) : <span className="text-xs text-muted-foreground">Sem padrão</span>}
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
                    <Bar dataKey="valorTotal" name="Valor consumido" radius={[0, 4, 4, 0]}>
                      {dadosConsumo.slice(0, 8).map((_, i) => (
                        <Cell key={i} fill={CORES[i % CORES.length]} />
                      ))}
                    </Bar>
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
                    <Bar dataKey="horas" name="Horas paradas" radius={[0, 4, 4, 0]}>
                      {dadosParadas.map((_, i) => (
                        <Cell key={i} fill={CORES[i % CORES.length]} />
                      ))}
                    </Bar>
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
