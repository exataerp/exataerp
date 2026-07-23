"use client"

import React, { useState, useEffect, useMemo } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend, Cell
} from "recharts"
import { supabase } from "@/components/supabase"
import { CountUp } from "@/components/count-up"
import { StatusDot } from "@/components/status-dot"
import { Skeleton } from "@/components/ui/skeleton"
import { ChartTooltip } from "@/components/chart-tooltip"
import { EmptyState } from "@/components/empty-state"
import { Sparkline } from "@/components/sparkline"
import {
  TrendingUp, TrendingDown, Package, AlertTriangle, CheckCircle2,
  Clock, RefreshCw, Factory, Boxes, Wrench,
  BarChart3, Activity
} from "lucide-react"

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface OrdemProducao {
  id: string
  numero_op: string
  produto_codigo: string
  quantidade: number
  data_programacao: string
  status?: string
}

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

interface Maquina {
  id: string
  nome: string
  codigo: string
  status: string
}

interface SaldoEstoque {
  insumo_id: string
  saldo_atual: number
  insumo: { codigo: string; descricao: string; estoque_minimo: number; unidade_medida: string }
}

interface Pausa {
  apontamento_id: string
  inicio: string
  fim?: string
}

function formatNum(n: number, dec = 1) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// (tooltip dos gráficos agora vem de @/components/chart-tooltip)

// ─── Componente principal ─────────────────────────────────────────────────────

export function DashboardTab({ empresaAtivaId }: { empresaAtivaId: string | null }) {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [periodo, setPeriodo] = useState<"hoje" | "semana" | "mes">("hoje")

  const [ordens, setOrdens] = useState<OrdemProducao[]>([])
  const [apontamentos, setApontamentos] = useState<Apontamento[]>([])
  const [maquinas, setMaquinas] = useState<Maquina[]>([])
  const [saldos, setSaldos] = useState<SaldoEstoque[]>([])
  const [pausas, setPausas] = useState<Pausa[]>([])
  const [apontamentosAtivos, setApontamentosAtivos] = useState<Apontamento[]>([])
  const [pausasAbertas, setPausasAbertas] = useState<Pausa[]>([])
  const [ultimaOperacaoPorProduto, setUltimaOperacaoPorProduto] = useState<Record<string, string>>({})
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<Date>(new Date())

  const { dataInicio, dataFim } = useMemo(() => {
    const hoje = new Date()
    const fim = toDateStr(hoje)
    if (periodo === "hoje") return { dataInicio: fim, dataFim: fim }
    if (periodo === "semana") {
      const inicio = new Date(hoje)
      inicio.setDate(hoje.getDate() - 6)
      return { dataInicio: toDateStr(inicio), dataFim: fim }
    }
    const inicio = new Date(hoje)
    inicio.setDate(hoje.getDate() - 29)
    return { dataInicio: toDateStr(inicio), dataFim: fim }
  }, [periodo])

  const loadData = async (silent = false) => {
    if (!empresaAtivaId) return
    if (!silent) setLoading(true)
    else setRefreshing(true)

    try {
      const inicioISO = new Date(dataInicio + "T00:00:00").toISOString()
      const fimISO = new Date(dataFim + "T23:59:59").toISOString()

      const [{ data: ops }, { data: aps }, { data: mqs }, { data: sal }, { data: pss }, { data: prods }, { data: apsAtivos }, { data: pssAbertas }] = await Promise.all([
        supabase.from("ordens_producao")
          .select("id, numero_op, produto_codigo, quantidade, data_programacao, status")
          .eq("empresa_id", empresaAtivaId)
          .order("data_programacao", { ascending: false }),
        supabase.from("apontamentos")
          .select("id, ordem_id, operacao_id, operacao_nome, maquina_id, cronometro_total_segundos, pecas_produzidas, pecas_refugo, pecas_retrabalho, status, created_at")
          .eq("empresa_id", empresaAtivaId)
          .gte("created_at", inicioISO)
          .lte("created_at", fimISO),
        supabase.from("maquinas")
          .select("id, nome, codigo, status")
          .eq("empresa_id", empresaAtivaId),
        supabase.from("saldo_estoque")
          .select("insumo_id, saldo_atual, insumos(codigo, descricao, estoque_minimo, unidade_medida)")
          .eq("empresa_id", empresaAtivaId),
        supabase.from("apontamento_pausas")
          .select("apontamento_id, inicio, fim")
          .eq("empresa_id", empresaAtivaId)
          .gte("inicio", inicioISO),
        supabase.from("produtos")
          .select("codigo, operacoes(id, ordem)")
          .eq("empresa_id", empresaAtivaId),
        // Status "ao vivo" das máquinas não pode depender do período de relatório selecionado —
        // uma OP iniciada antes do início do período e ainda em andamento continua sendo "em andamento".
        supabase.from("apontamentos")
          .select("id, maquina_id, status, created_at")
          .eq("empresa_id", empresaAtivaId)
          .eq("status", "em_andamento"),
        supabase.from("apontamento_pausas")
          .select("apontamento_id, inicio, fim")
          .eq("empresa_id", empresaAtivaId)
          .is("fim", null),
      ])

      setOrdens((ops || []) as OrdemProducao[])
      setApontamentos((aps || []) as Apontamento[])
      setMaquinas((mqs || []) as Maquina[])
      setSaldos((sal || []).map((s: any) => ({
        insumo_id: s.insumo_id,
        saldo_atual: s.saldo_atual,
        insumo: s.insumos,
      })) as SaldoEstoque[])
      setPausas((pss || []) as Pausa[])
      setApontamentosAtivos((apsAtivos || []) as Apontamento[])
      setPausasAbertas((pssAbertas || []) as Pausa[])

      // Mapeia produto -> id da última operação do roteiro (a que realmente entrega a peça pronta)
      const mapaUltimaOp: Record<string, string> = {}
      for (const p of (prods || []) as any[]) {
        const opsRoteiro = (p.operacoes || []) as { id: string; ordem: number }[]
        if (opsRoteiro.length === 0) continue
        const ultima = opsRoteiro.reduce((a, b) => (b.ordem > a.ordem ? b : a))
        mapaUltimaOp[p.codigo] = ultima.id
      }
      setUltimaOperacaoPorProduto(mapaUltimaOp)

      setUltimaAtualizacao(new Date())
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (empresaAtivaId) loadData()
  }, [empresaAtivaId, dataInicio, dataFim])

  // Auto-refresh a cada 2 minutos
  useEffect(() => {
    const interval = setInterval(() => {
      if (empresaAtivaId) loadData(true)
    }, 120000)
    return () => clearInterval(interval)
  }, [empresaAtivaId, dataInicio, dataFim])

  // ─── KPIs ──────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const totalProduzidas = apontamentos.reduce((s, a) => s + (a.pecas_produzidas || 0), 0)
    const totalRefugo = apontamentos.reduce((s, a) => s + (a.pecas_refugo || 0), 0)
    const taxaRefugo = totalProduzidas + totalRefugo > 0
      ? (totalRefugo / (totalProduzidas + totalRefugo)) * 100 : 0

    const opsAbertas = ordens.filter(o => o.status !== "encerrada").length
    const opsConcluidas = ordens.filter(o => o.status === "encerrada").length
    const opsAtrasadas = ordens.filter(o => {
      if (o.status === "encerrada") return false
      return o.data_programacao < toDateStr(new Date())
    }).length

    const maqAtivas = new Set(apontamentos.filter(a => a.status === "em_andamento").map(a => a.maquina_id)).size
    const estoquesCriticos = saldos.filter(s => s.saldo_atual <= s.insumo?.estoque_minimo && s.insumo?.estoque_minimo > 0).length
    const estoquesZerados = saldos.filter(s => s.saldo_atual <= 0).length

    const totalTempoPausa = pausas.reduce((s, p) => {
      if (!p.fim) return s
      return s + (new Date(p.fim).getTime() - new Date(p.inicio).getTime()) / 1000
    }, 0)

    return { totalProduzidas, totalRefugo, taxaRefugo, opsAbertas, opsConcluidas, opsAtrasadas, maqAtivas, estoquesCriticos, estoquesZerados, totalTempoPausa }
  }, [apontamentos, ordens, saldos, pausas])

  // ─── Tendência de produção nos últimos 7 dias (sparkline do KPI) ───────────
  const tendenciaProducao7d = useMemo(() => {
    const hoje = new Date()
    const dias: string[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(hoje)
      d.setDate(d.getDate() - i)
      dias.push(toDateStr(d))
    }
    const porDia: Record<string, number> = Object.fromEntries(dias.map(d => [d, 0]))
    for (const a of apontamentos) {
      const dia = toDateStr(new Date(a.created_at))
      if (dia in porDia) porDia[dia] += (a.pecas_produzidas || 0)
    }
    return dias.map(d => porDia[d])
  }, [apontamentos])

  // ─── Produção por máquina ──────────────────────────────────────────────────

  const producaoPorMaquina = useMemo(() => {
    const mapa: Record<string, { nome: string; produzidas: number; refugo: number }> = {}
    for (const ap of apontamentos) {
      const maq = maquinas.find(m => m.id === ap.maquina_id)
      const nome = maq ? `${maq.codigo}` : "Manual"
      if (!mapa[nome]) mapa[nome] = { nome, produzidas: 0, refugo: 0 }
      mapa[nome].produzidas += ap.pecas_produzidas || 0
      mapa[nome].refugo += ap.pecas_refugo || 0
    }
    return Object.values(mapa).sort((a, b) => b.produzidas - a.produzidas).slice(0, 8)
  }, [apontamentos, maquinas])

  // ─── OPs em andamento ─────────────────────────────────────────────────────

  const opsEmAndamento = useMemo(() => {
    return ordens
      .filter(o => o.status !== "encerrada")
      .map(op => {
        const aps = apontamentos.filter(a => a.ordem_id === op.id)
        const ultimaOperacaoId = ultimaOperacaoPorProduto[op.produto_codigo]
        // Progresso real da OP = peças que passaram pela última etapa do roteiro,
        // não a soma de todas as etapas (senão uma peça é contada 1x por operação)
        const apsUltimaEtapa = ultimaOperacaoId
          ? aps.filter(a => a.operacao_id === ultimaOperacaoId)
          : aps
        const produzidas = apsUltimaEtapa.reduce((s, a) => s + (a.pecas_produzidas || 0), 0)
        const pct = op.quantidade > 0 ? Math.min(100, (produzidas / op.quantidade) * 100) : 0
        const atrasada = op.data_programacao < toDateStr(new Date())
        const emAndamento = aps.some(a => a.status === "em_andamento")
        return { op, produzidas, pct, atrasada, emAndamento }
      })
      .sort((a, b) => {
        if (a.atrasada && !b.atrasada) return -1
        if (!a.atrasada && b.atrasada) return 1
        return 0
      })
      .slice(0, 6)
  }, [ordens, apontamentos, ultimaOperacaoPorProduto])

  // ─── Status das máquinas ──────────────────────────────────────────────────

  const statusMaquinas = useMemo(() => {
    return maquinas.map(maq => {
      const apAtivo = apontamentosAtivos.find(a => a.maquina_id === maq.id && a.status === "em_andamento")
      const pausaAberta = apAtivo ? pausasAbertas.find(p => p.apontamento_id === apAtivo.id && !p.fim) : null
      const ultimoAp = apontamentos
        .filter(a => a.maquina_id === maq.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]

      let statusLabel = "Parada"
      let statusColor = "text-muted-foreground"
      let statusBg = "bg-muted/40"

      if (maq.status === "inativa") {
        statusLabel = "Inativa"
        statusColor = "text-muted-foreground"
        statusBg = "bg-muted/20"
      } else if (apAtivo && pausaAberta) {
        statusLabel = "Em pausa"
        statusColor = "text-amber-500"
        statusBg = "bg-amber-500/10"
      } else if (apAtivo) {
        statusLabel = "Produzindo"
        statusColor = "text-green-600"
        statusBg = "bg-green-500/10"
      } else if (ultimoAp) {
        const horasSemAp = (Date.now() - new Date(ultimoAp.created_at).getTime()) / (1000 * 60 * 60)
        if (horasSemAp > 4) {
          statusLabel = "Sem atividade"
          statusColor = "text-amber-500"
          statusBg = "bg-amber-500/10"
        }
      }

      return { maq, statusLabel, statusColor, statusBg, apAtivo, pausaAberta }
    })
  }, [maquinas, apontamentos, pausas, apontamentosAtivos, pausasAbertas])

  if (loading) {
    return (
      <div className="space-y-6 pb-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="space-y-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-9 w-40 rounded-xl" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl px-5 py-4 shadow-sm space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-card border border-border rounded-2xl shadow-sm p-5 space-y-3">
            <Skeleton className="h-4 w-32" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-2.5 w-24" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            ))}
          </div>
          <div className="lg:col-span-2 bg-card border border-border rounded-2xl shadow-sm p-5">
            <Skeleton className="h-4 w-40 mb-4" />
            <Skeleton className="h-52 w-full" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-8">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Dashboard</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Atualizado às {ultimaAtualizacao.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-muted/50 p-1 rounded-xl">
            {(["hoje", "semana", "mes"] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriodo(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all
                  ${periodo === p ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {p === "hoje" ? "Hoje" : p === "semana" ? "7 dias" : "30 dias"}
              </button>
            ))}
          </div>
          <button
            onClick={() => loadData(true)}
            className={`h-9 w-9 flex items-center justify-center bg-card border border-border rounded-xl text-muted-foreground hover:text-primary transition-colors ${refreshing ? "animate-spin" : ""}`}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* KPIs principais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Peças produzidas",
            value: kpis.totalProduzidas,
            decimals: 0,
            suffix: "",
            icon: Package,
            color: "text-primary",
            sub: `${kpis.totalRefugo} refugo`,
            spark: tendenciaProducao7d,
          },
          {
            label: "Taxa de refugo",
            value: kpis.taxaRefugo,
            decimals: 1,
            suffix: "%",
            icon: TrendingDown,
            color: kpis.taxaRefugo > 5 ? "text-destructive" : kpis.taxaRefugo > 2 ? "text-amber-500" : "text-green-600",
            sub: kpis.taxaRefugo > 5 ? "Acima do limite" : "Dentro do limite"
          },
          {
            label: "OPs em aberto",
            value: kpis.opsAbertas,
            decimals: 0,
            suffix: "",
            icon: Activity,
            color: "text-primary",
            sub: kpis.opsAtrasadas > 0 ? `${kpis.opsAtrasadas} atrasada${kpis.opsAtrasadas > 1 ? "s" : ""}` : `${kpis.opsConcluidas} concluída${kpis.opsConcluidas !== 1 ? "s" : ""}`
          },
          {
            label: "Itens críticos no estoque",
            value: kpis.estoquesCriticos + kpis.estoquesZerados,
            decimals: 0,
            suffix: "",
            icon: Boxes,
            color: kpis.estoquesCriticos + kpis.estoquesZerados > 0 ? "text-destructive" : "text-green-600",
            sub: kpis.estoquesZerados > 0 ? `${kpis.estoquesZerados} zerado${kpis.estoquesZerados > 1 ? "s" : ""}` : "Estoque ok"
          },
        ].map(({ label, value, decimals, suffix, icon: Icon, color, sub, spark }: any) => (
          <div key={label} className="bg-card border border-border rounded-2xl px-5 py-4 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-9 w-9 flex items-center justify-center rounded-xl bg-muted flex-shrink-0">
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider leading-tight">{label}</p>
            </div>
            <p className="text-2xl font-black text-foreground">
              <CountUp value={value} decimals={decimals} suffix={suffix} />
            </p>
            <p className={`text-[10px] font-bold mt-1 ${color}`}>{sub}</p>
            {spark && <div className="mt-2 -mx-1"><Sparkline data={spark} color={color} /></div>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Status das máquinas em tempo real */}
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Factory className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Máquinas agora</h3>
            <span className="ml-auto flex items-center gap-1.5">
              <StatusDot color="green" />
              <span className="text-[10px] text-muted-foreground">Ao vivo</span>
            </span>
          </div>
          <div className="divide-y divide-border">
            {maquinas.length === 0 && (
              <EmptyState icon={Wrench} title="Nenhuma máquina cadastrada" className="py-8" />
            )}
            {statusMaquinas.map(({ maq, statusLabel, statusColor, statusBg, apAtivo, pausaAberta }) => (
              <div key={maq.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-foreground">{maq.codigo}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{maq.nome}</p>
                </div>
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${statusBg}`}>
                  {statusLabel === "Produzindo" && <StatusDot color="green" />}
                  {statusLabel === "Em pausa" && <StatusDot color="amber" pulse={false} />}
                  {(statusLabel === "Parada" || statusLabel === "Sem atividade" || statusLabel === "Inativa") && (
                    <StatusDot color={statusLabel === "Sem atividade" ? "amber" : "muted"} pulse={false} />
                  )}
                  <span className={`text-[10px] font-bold ${statusColor}`}>{statusLabel}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* OPs em andamento */}
        <div className="lg:col-span-2 bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Ordens em aberto</h3>
            <span className="text-[10px] bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full ml-1">{kpis.opsAbertas}</span>
          </div>
          <div className="divide-y divide-border">
            {opsEmAndamento.length === 0 && (
              <div className="px-5 py-8 text-center">
                <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
                <p className="text-sm font-bold text-foreground">Nenhuma OP em aberto</p>
                <p className="text-xs text-muted-foreground mt-1">Todas as ordens foram encerradas</p>
              </div>
            )}
            {opsEmAndamento.map(({ op, produzidas, pct, atrasada, emAndamento }) => (
              <div key={op.id} className={`px-5 py-3 ${atrasada ? "bg-destructive/5" : ""}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-foreground">{op.numero_op}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 bg-primary/10 text-primary rounded-full">{op.produto_codigo}</span>
                    {atrasada && <span className="text-[10px] font-bold px-1.5 py-0.5 bg-destructive/10 text-destructive rounded-full">Atrasada</span>}
                    {emAndamento && <span className="text-[10px] font-bold px-1.5 py-0.5 bg-green-500/10 text-green-600 rounded-full flex items-center gap-0.5"><span className="h-1 w-1 rounded-full bg-green-500 animate-pulse" />Rodando</span>}
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <span className="text-sm font-bold text-foreground">{pct.toFixed(0)}%</span>
                    <p className="text-[10px] text-muted-foreground">{produzidas}/{op.quantidade} pç</p>
                  </div>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${atrasada ? "bg-destructive" : pct >= 100 ? "bg-green-500" : "bg-primary"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Programada: {op.data_programacao.split("-").reverse().join("/")}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Produção por máquina + Estoque crítico */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
          <h3 className="text-sm font-bold text-foreground mb-1 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" /> Produção por máquina
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">Peças produzidas no período</p>
          {producaoPorMaquina.length === 0 ? (
            <EmptyState icon={Factory} title="Sem apontamentos no período" className="py-10" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={producaoPorMaquina} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis dataKey="nome" type="category" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={55} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="produzidas" name="Produzidas" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={18} />
                <Bar dataKey="refugo" name="Refugo" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-bold text-foreground">Estoque crítico</h3>
          </div>
          {saldos.filter(s => s.saldo_atual <= (s.insumo?.estoque_minimo ?? 0) || s.saldo_atual <= 0).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center px-5">
              <CheckCircle2 className="h-8 w-8 text-green-500 mb-2" />
              <p className="text-sm font-bold text-foreground">Estoque saudável</p>
              <p className="text-xs text-muted-foreground mt-1">Todos os itens acima do mínimo</p>
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[260px] overflow-y-auto">
              {saldos
                .filter(s => s.saldo_atual <= (s.insumo?.estoque_minimo ?? 0) || s.saldo_atual <= 0)
                .sort((a, b) => a.saldo_atual - b.saldo_atual)
                .map(s => (
                  <div key={s.insumo_id} className="flex items-center justify-between px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-foreground truncate">{s.insumo?.codigo}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{s.insumo?.descricao}</p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-3">
                      <p className={`text-xs font-bold ${s.saldo_atual <= 0 ? "text-destructive" : "text-amber-500"}`}>
                        {s.saldo_atual.toFixed(2)} {s.insumo?.unidade_medida}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Mín: {s.insumo?.estoque_minimo}</p>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
