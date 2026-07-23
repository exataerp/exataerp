"use client"

import React, { useState, useEffect, useMemo } from "react"
import { supabase } from "@/components/supabase"
import { useToast } from "@/hooks/use-toast"
import { CountUp } from "@/components/count-up"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Package, TrendingUp, TrendingDown, ArrowLeftRight, Plus, X,
  AlertTriangle, CheckCircle2, Search, RefreshCw,
  Boxes, BarChart3
} from "lucide-react"

interface Insumo {
  id: string
  codigo: string
  descricao: string
  unidade_medida: string
  preco_unitario: number
  estoque_minimo: number
  tipo: "materia_prima" | "produto_acabado" | "semi_acabado"
}

interface SaldoComItem {
  insumo_id: string
  saldo_atual: number
  custo_medio: number
  valor_total: number
  insumo: Insumo
  abaixo_minimo: boolean
  local_nome: string
}

interface Movimentacao {
  id: string
  insumo_id: string
  tipo: string
  quantidade: number
  quantidade_anterior: number
  quantidade_posterior: number
  custo_unitario: number
  valor_total: number
  origem: string
  observacao?: string
  created_at: string
  insumo?: { codigo: string; descricao: string; unidade_medida: string }
}

interface LocalEstoque {
  id: string
  nome: string
}

export type Aba = "saldo" | "movimentacoes" | "itens"

export const ABAS_CONFIG: { id: Aba; label: string }[] = [
  { id: "saldo", label: "Saldo" },
  { id: "movimentacoes", label: "Movimentações" },
  { id: "itens", label: "Itens" },
]

const TIPO_LABELS: Record<string, string> = {
  materia_prima: "Matéria-Prima",
  produto_acabado: "Produto Acabado",
  semi_acabado: "Semi-Acabado",
}

const TIPO_MOV_LABELS: Record<string, { label: string; cor: string; icone: "in" | "out" | "adj" }> = {
  entrada: { label: "Recebimento", cor: "text-green-600", icone: "in" },
  saida: { label: "Consumo", cor: "text-destructive", icone: "out" },
  saida_producao: { label: "Consumo OP", cor: "text-destructive", icone: "out" },
  entrada_producao: { label: "Produção Acabada", cor: "text-green-600", icone: "in" },
  ajuste_positivo: { label: "Ajuste +", cor: "text-primary", icone: "adj" },
  ajuste_negativo: { label: "Ajuste -", cor: "text-amber-500", icone: "adj" },
  refugo: { label: "Refugo", cor: "text-destructive", icone: "out" },
}

function formatNum(n: number, dec = 2) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function formatBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function ModalRecebimento({ insumos, localId, empresaAtivaId, onSuccess, onCancel }: {
  insumos: Insumo[]
  localId: string
  empresaAtivaId: string
  onSuccess: () => void
  onCancel: () => void
}) {
  const { toast } = useToast()
  const [insumoId, setInsumoId] = useState("")
  const [quantidade, setQuantidade] = useState("")
  const [custoUnitario, setCustoUnitario] = useState("")
  const [observacao, setObservacao] = useState("")
  const [salvando, setSalvando] = useState(false)

  const insumoSel = insumos.find(i => i.id === insumoId)

  useEffect(() => {
    if (insumoSel) setCustoUnitario(insumoSel.preco_unitario.toString())
  }, [insumoId, insumoSel])

  const handleSalvar = async () => {
    if (!insumoId || !quantidade || !custoUnitario) return
    setSalvando(true)

    const qtd = parseFloat(quantidade)
    const custo = parseFloat(custoUnitario)

    const { data: saldoAtual } = await supabase
      .from("saldo_estoque")
      .select("saldo_atual, custo_medio")
      .eq("insumo_id", insumoId)
      .eq("empresa_id", empresaAtivaId)
      .single()

    const saldoAnterior = saldoAtual?.saldo_atual ?? 0
    const custoMedioAnterior = saldoAtual?.custo_medio ?? 0
    const saldoPosterior = saldoAnterior + qtd

    const novosCustoMedio = saldoAnterior === 0
      ? custo
      : ((saldoAnterior * custoMedioAnterior) + (qtd * custo)) / saldoPosterior

    await supabase.from("saldo_estoque").upsert({
      empresa_id: empresaAtivaId,
      insumo_id: insumoId,
      saldo_atual: saldoPosterior,
      custo_medio: novosCustoMedio,
      updated_at: new Date().toISOString(),
    }, { onConflict: "empresa_id,insumo_id" })

    await supabase.from("movimentacoes_estoque").insert({
      empresa_id: empresaAtivaId,
      insumo_id: insumoId,
      tipo: "entrada",
      quantidade: qtd,
      quantidade_anterior: saldoAnterior,
      quantidade_posterior: saldoPosterior,
      custo_unitario: custo,
      valor_total: qtd * custo,
      origem: "manual",
      local_id: localId,
      observacao: observacao || null,
    })

    toast({ title: "✅ Recebimento registrado", description: `${formatNum(qtd)} ${insumoSel?.unidade_medida} de ${insumoSel?.descricao}` })
    setSalvando(false)
    onSuccess()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">Recebimento de Material</h3>
          <button onClick={onCancel} className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Item</label>
            <Select value={insumoId || undefined} onValueChange={setInsumoId}>
              <SelectTrigger className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all">
                <SelectValue placeholder="Selecione o item" />
              </SelectTrigger>
              <SelectContent position="popper" className="z-[9999] max-h-[40vh] overflow-y-auto">
                {insumos.map(i => (
                  <SelectItem key={i.id} value={i.id}>{i.codigo} - {i.descricao}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {insumoSel && (
            <div className="bg-muted/40 rounded-xl px-4 py-3 text-xs flex justify-between">
              <span className="text-muted-foreground">Unidade</span>
              <span className="font-bold text-foreground">{insumoSel.unidade_medida}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Quantidade</label>
              <input
                type="number" min="0.001" step="0.001" placeholder="0,000"
                value={quantidade} onChange={e => setQuantidade(e.target.value)}
                className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Custo Unitário (R$)</label>
              <input
                type="number" min="0" step="0.01" placeholder="0,00"
                value={custoUnitario} onChange={e => setCustoUnitario(e.target.value)}
                className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
              />
            </div>
          </div>

          {quantidade && custoUnitario && (
            <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 text-xs flex justify-between">
              <span className="text-muted-foreground">Valor total do recebimento</span>
              <span className="font-bold text-primary">{formatBRL(parseFloat(quantidade || "0") * parseFloat(custoUnitario || "0"))}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Observação (opcional)</label>
            <input
              type="text" placeholder="Ex: NF 1234, fornecedor XYZ..."
              value={observacao} onChange={e => setObservacao(e.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} className="flex-1 h-11 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:bg-muted transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={salvando || !insumoId || !quantidade || !custoUnitario}
            className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50"
          >
            {salvando ? "Registrando..." : "Confirmar Entrada"}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalAjuste({ insumos, localId, empresaAtivaId, saldos, onSuccess, onCancel }: {
  insumos: Insumo[]
  localId: string
  empresaAtivaId: string
  saldos: SaldoComItem[]
  onSuccess: () => void
  onCancel: () => void
}) {
  const { toast } = useToast()
  const [insumoId, setInsumoId] = useState("")
  const [quantidadeReal, setQuantidadeReal] = useState("")
  const [observacao, setObservacao] = useState("")
  const [salvando, setSalvando] = useState(false)

  const saldoAtual = saldos.find(s => s.insumo_id === insumoId)
  const insumoSel = insumos.find(i => i.id === insumoId)
  const qtdReal = parseFloat(quantidadeReal) || 0
  const diff = saldoAtual ? qtdReal - saldoAtual.saldo_atual : 0

  const handleSalvar = async () => {
    if (!insumoId || quantidadeReal === "") return
    setSalvando(true)

    const saldoAnterior = saldoAtual?.saldo_atual ?? 0
    const custoMedio = saldoAtual?.custo_medio ?? 0
    const tipo = diff >= 0 ? "ajuste_positivo" : "ajuste_negativo"

    await supabase.from("saldo_estoque").upsert({
      empresa_id: empresaAtivaId,
      insumo_id: insumoId,
      saldo_atual: qtdReal,
      custo_medio: custoMedio,
      updated_at: new Date().toISOString(),
    }, { onConflict: "empresa_id,insumo_id" })

    await supabase.from("movimentacoes_estoque").insert({
      empresa_id: empresaAtivaId,
      insumo_id: insumoId,
      tipo,
      quantidade: Math.abs(diff),
      quantidade_anterior: saldoAnterior,
      quantidade_posterior: qtdReal,
      custo_unitario: custoMedio,
      valor_total: Math.abs(diff) * custoMedio,
      origem: "ajuste_manual",
      local_id: localId,
      observacao: observacao || "Ajuste de inventário",
    })

    toast({ title: "✅ Ajuste registrado", description: `Saldo de ${insumoSel?.descricao} ajustado para ${formatNum(qtdReal)} ${insumoSel?.unidade_medida}` })
    setSalvando(false)
    onSuccess()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">Ajuste de Inventário</h3>
          <button onClick={onCancel} className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Item</label>
            <Select value={insumoId || undefined} onValueChange={val => { setInsumoId(val); setQuantidadeReal("") }}>
              <SelectTrigger className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all">
                <SelectValue placeholder="Selecione o item" />
              </SelectTrigger>
              <SelectContent position="popper" className="z-[9999] max-h-[40vh] overflow-y-auto">
                {insumos.map(i => (
                  <SelectItem key={i.id} value={i.id}>{i.codigo} - {i.descricao}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {saldoAtual && (
            <div className="bg-muted/40 rounded-xl px-4 py-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Saldo no sistema</span>
                <span className="font-bold text-foreground">{formatNum(saldoAtual.saldo_atual)} {insumoSel?.unidade_medida}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Custo médio</span>
                <span className="font-bold text-foreground">{formatBRL(saldoAtual.custo_medio)}</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Quantidade Real (contagem física)</label>
            <input
              type="number" min="0" step="0.001" placeholder="Quantidade contada"
              value={quantidadeReal} onChange={e => setQuantidadeReal(e.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
            />
          </div>

          {quantidadeReal !== "" && saldoAtual && (
            <div className={`rounded-xl px-4 py-3 text-xs flex justify-between ${diff === 0 ? "bg-muted/40" : diff > 0 ? "bg-green-500/10 border border-green-500/20" : "bg-destructive/10 border border-destructive/20"}`}>
              <span className="text-muted-foreground">Diferença</span>
              <span className={`font-bold ${diff === 0 ? "text-foreground" : diff > 0 ? "text-green-600" : "text-destructive"}`}>
                {diff > 0 ? "+" : ""}{formatNum(diff)} {insumoSel?.unidade_medida}
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Motivo do ajuste</label>
            <input
              type="text" placeholder="Ex: Contagem física, perda por transporte..."
              value={observacao} onChange={e => setObservacao(e.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} className="flex-1 h-11 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:bg-muted transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={salvando || !insumoId || quantidadeReal === ""}
            className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50"
          >
            {salvando ? "Ajustando..." : "Confirmar Ajuste"}
          </button>
        </div>
      </div>
    </div>
  )
}

export function EstoqueTab({
  empresaAtivaId,
  abaSelecionada,
  onChangeAba,
}: {
  empresaAtivaId?: string | null
  abaSelecionada?: Aba
  onChangeAba?: (id: Aba) => void
}) {
  const { toast } = useToast()
  const [abaAtivaInterna, setAbaAtivaInterna] = useState<Aba>("saldo")
  const abaAtiva = abaSelecionada ?? abaAtivaInterna
  const setAbaAtiva = onChangeAba ?? setAbaAtivaInterna
  const [loading, setLoading] = useState(true)

  const [insumos, setInsumos] = useState<Insumo[]>([])
  const [saldos, setSaldos] = useState<SaldoComItem[]>([])
  const [movimentacoes, setMovimentacoes] = useState<Movimentacao[]>([])
  const [locais, setLocais] = useState<LocalEstoque[]>([])
  const [localPadrao, setLocalPadrao] = useState<string>("")

  const [showNovoItem, setShowNovoItem] = useState(false)
  const [novoItem, setNovoItem] = useState({ codigo: "", descricao: "", unidade_medida: "", preco_unitario: "", estoque_minimo: "", tipo: "materia_prima" })
  const [salvandoItem, setSalvandoItem] = useState(false)

  const [busca, setBusca] = useState("")
  const [filtroTipo, setFiltroTipo] = useState("todos")
  const [filtroMov, setFiltroMov] = useState("todos")
  const [buscaMov, setBuscaMov] = useState("")

  const [showRecebimento, setShowRecebimento] = useState(false)
  const [showAjuste, setShowAjuste] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [{ data: ins }, { data: sal }, { data: mov }, { data: loc }] = await Promise.all([
        supabase.from("insumos").select("*").eq("empresa_id", empresaAtivaId!).order("codigo"),
        supabase.from("saldo_estoque").select("*").eq("empresa_id", empresaAtivaId!),
        supabase.from("movimentacoes_estoque")
          .select("*, insumo:insumos(codigo, descricao, unidade_medida)")
          .eq("empresa_id", empresaAtivaId!)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase.from("locais_estoque").select("id, nome").eq("empresa_id", empresaAtivaId!),
      ])

      const insumosData = (ins || []) as Insumo[]
      const locaisData = (loc || []) as LocalEstoque[]
      setInsumos(insumosData)
      setLocais(locaisData)
      setMovimentacoes((mov || []) as Movimentacao[])
      if (locaisData.length > 0 && !localPadrao) setLocalPadrao(locaisData[0].id)

      const saldosFormatados: SaldoComItem[] = insumosData.map(ins => {
        const s = (sal || []).find((x: any) => x.insumo_id === ins.id)
        const local = locaisData[0]
        return {
          insumo_id: ins.id,
          saldo_atual: s?.saldo_atual ?? 0,
          custo_medio: s?.custo_medio ?? ins.preco_unitario,
          valor_total: (s?.saldo_atual ?? 0) * (s?.custo_medio ?? ins.preco_unitario),
          insumo: ins,
          abaixo_minimo: (s?.saldo_atual ?? 0) < ins.estoque_minimo,
          local_nome: local?.nome ?? "Almoxarifado Principal",
        }
      })
      setSaldos(saldosFormatados)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (empresaAtivaId) loadData()
  }, [empresaAtivaId])

  const kpis = useMemo(() => {
    const valorTotal = saldos.reduce((s, x) => s + x.valor_total, 0)
    const totalItens = insumos.length
    const abaixoMinimo = saldos.filter(s => s.abaixo_minimo && s.saldo_atual > 0).length
    const zerados = saldos.filter(s => s.saldo_atual <= 0).length
    const mp = saldos.filter(s => s.insumo.tipo === "materia_prima").reduce((s, x) => s + x.valor_total, 0)
    const pa = saldos.filter(s => s.insumo.tipo === "produto_acabado").reduce((s, x) => s + x.valor_total, 0)
    return { valorTotal, totalItens, abaixoMinimo, zerados, mp, pa }
  }, [saldos, insumos])

  const handleSalvarItem = async () => {
    if (!novoItem.codigo || !novoItem.descricao || !novoItem.unidade_medida) return
    setSalvandoItem(true)
    const { error } = await supabase.from("insumos").insert({
      empresa_id: empresaAtivaId,
      codigo: novoItem.codigo.trim().toUpperCase(),
      descricao: novoItem.descricao.trim(),
      unidade_medida: novoItem.unidade_medida.trim(),
      preco_unitario: parseFloat(novoItem.preco_unitario) || 0,
      estoque_minimo: parseFloat(novoItem.estoque_minimo) || 0,
      tipo: novoItem.tipo,
    })
    if (error) {
      toast({ title: "Erro ao cadastrar", description: error.message, variant: "destructive" })
    } else {
      toast({ title: "✅ Item cadastrado" })
      setNovoItem({ codigo: "", descricao: "", unidade_medida: "", preco_unitario: "", estoque_minimo: "", tipo: "materia_prima" })
      setShowNovoItem(false)
      loadData()
    }
    setSalvandoItem(false)
  }

  const saldosFiltrados = useMemo(() => {
    return saldos.filter(s => {
      const matchBusca = !busca || s.insumo.codigo.toLowerCase().includes(busca.toLowerCase()) || s.insumo.descricao.toLowerCase().includes(busca.toLowerCase())
      const matchTipo = filtroTipo === "todos" || s.insumo.tipo === filtroTipo
      return matchBusca && matchTipo
    })
  }, [saldos, busca, filtroTipo])

  const movFiltradas = useMemo(() => {
    return movimentacoes.filter(m => {
      const matchTipo = filtroMov === "todos" || m.tipo === filtroMov
      const matchBusca = !buscaMov ||
        (m.insumo?.codigo || "").toLowerCase().includes(buscaMov.toLowerCase()) ||
        (m.insumo?.descricao || "").toLowerCase().includes(buscaMov.toLowerCase())
      return matchTipo && matchBusca
    })
  }, [movimentacoes, filtroMov, buscaMov])

  if (loading) {
    return (
      <div className="space-y-6 pb-12">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="space-y-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-36" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-xl" />
            <Skeleton className="h-9 w-24 rounded-xl" />
            <Skeleton className="h-9 w-32 rounded-xl" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl px-5 py-4 flex items-center gap-3 shadow-sm">
              <Skeleton className="h-10 w-10 rounded-xl flex-shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-2.5 w-20" />
                <Skeleton className="h-5 w-16" />
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

      {showRecebimento && (
        <ModalRecebimento
          insumos={insumos}
          localId={localPadrao}
          empresaAtivaId={empresaAtivaId!}
          onSuccess={() => { setShowRecebimento(false); loadData() }}
          onCancel={() => setShowRecebimento(false)}
        />
      )}
      {showAjuste && (
        <ModalAjuste
          insumos={insumos}
          localId={localPadrao}
          empresaAtivaId={empresaAtivaId!}
          saldos={saldos}
          onSuccess={() => { setShowAjuste(false); loadData() }}
          onCancel={() => setShowAjuste(false)}
        />
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Estoque</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {locais[0]?.nome ?? "Almoxarifado Principal"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadData()}
            className="h-9 w-9 flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted transition-colors"
            title="Atualizar"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowAjuste(true)}
            className="h-9 px-4 flex items-center gap-2 rounded-xl border border-border text-foreground font-bold text-xs uppercase tracking-widest hover:bg-muted transition-colors"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" /> Ajuste
          </button>
          <button
            onClick={() => setShowRecebimento(true)}
            className="h-9 px-4 flex items-center gap-2 rounded-xl bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-all"
          >
            <Plus className="h-3.5 w-3.5" /> Recebimento
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Valor total em estoque", value: kpis.valorTotal, isCurrency: true, icon: BarChart3, color: "text-primary" },
          { label: "Matéria-prima", value: kpis.mp, isCurrency: true, icon: Package, color: "text-primary" },
          { label: "Produto acabado", value: kpis.pa, isCurrency: true, icon: TrendingUp, color: "text-green-600" },
          { label: "Itens abaixo do mínimo", value: kpis.abaixoMinimo, isCurrency: false, icon: AlertTriangle, color: kpis.abaixoMinimo > 0 ? "text-destructive" : "text-muted-foreground" },
        ].map(({ label, value, isCurrency, icon: Icon, color }) => (
          <div key={label} className="bg-card border border-border rounded-2xl px-5 py-4 flex items-center gap-3 shadow-sm">
            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-muted flex-shrink-0">
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground font-medium leading-tight">{label}</p>
              <p className="text-lg font-bold text-foreground mt-0.5 truncate">
                {isCurrency ? <CountUp value={value} decimals={2} prefix="R$ " /> : <CountUp value={value} decimals={0} />}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Seletor de aba: agora fica no submenu da barra lateral */}
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
        Visualizando: <span className="text-primary">{ABAS_CONFIG.find(a => a.id === abaAtiva)?.label}</span>
      </p>

      {abaAtiva === "saldo" && (
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text" placeholder="Buscar por código ou descrição..."
                value={busca} onChange={e => setBusca(e.target.value)}
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-input text-foreground text-xs outline-none focus:ring-2 focus:ring-primary transition-all"
              />
            </div>
            <Select value={filtroTipo} onValueChange={setFiltroTipo}>
              <SelectTrigger className="w-full h-9 text-xs rounded-lg border border-border bg-input text-foreground outline-none focus:ring-2 focus:ring-primary transition-all">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="todos">Todos os tipos</SelectItem>
                <SelectItem value="materia_prima">Matéria-Prima</SelectItem>
                <SelectItem value="semi_acabado">Semi-Acabado</SelectItem>
                <SelectItem value="produto_acabado">Produto Acabado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {saldosFiltrados.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <Boxes className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-bold text-foreground">Nenhum item encontrado</p>
              <p className="text-xs text-muted-foreground mt-1">Cadastre itens na aba "Itens" para começar</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Código", "Descrição", "Tipo", "Saldo", "Un", "Custo Médio", "Valor Total", ""].map(h => (
                      <th key={h} className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {saldosFiltrados.map(s => (
                    <tr key={s.insumo_id} className={`hover:bg-muted/20 transition-colors ${s.abaixo_minimo ? "bg-destructive/5" : ""}`}>
                      <td className="px-4 py-3 font-bold text-foreground text-xs">{s.insumo.codigo}</td>
                      <td className="px-4 py-3 text-foreground text-xs max-w-[200px] truncate">{s.insumo.descricao}</td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                          {TIPO_LABELS[s.insumo.tipo]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-bold text-xs ${s.saldo_atual <= 0 ? "text-destructive" : s.abaixo_minimo ? "text-amber-500" : "text-foreground"}`}>
                            {formatNum(s.saldo_atual)}
                          </span>
                          {s.abaixo_minimo && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                          {s.saldo_atual <= 0 && <AlertTriangle className="h-3 w-3 text-destructive" />}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">Mín: {formatNum(s.insumo.estoque_minimo)}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{s.insumo.unidade_medida}</td>
                      <td className="px-4 py-3 text-xs text-foreground">{formatBRL(s.custo_medio)}</td>
                      <td className="px-4 py-3 text-xs font-bold text-foreground">{formatBRL(s.valor_total)}</td>
                      <td className="px-4 py-3">
                        {s.saldo_atual <= 0 ? (
                          <span className="text-[10px] font-bold text-destructive">Zerado</span>
                        ) : s.abaixo_minimo ? (
                          <span className="text-[10px] font-bold text-amber-500">Baixo</span>
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30">
                    <td colSpan={5} className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Total</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-sm font-black text-foreground">
                      {formatBRL(saldosFiltrados.reduce((s, x) => s + x.valor_total, 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {abaAtiva === "movimentacoes" && (
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text" placeholder="Buscar por item..."
                value={buscaMov} onChange={e => setBuscaMov(e.target.value)}
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-input text-foreground text-xs outline-none focus:ring-2 focus:ring-primary transition-all"
              />
            </div>
            <Select value={filtroMov} onValueChange={setFiltroMov}>
              <SelectTrigger className="w-full h-9 text-xs rounded-lg border border-border bg-input text-foreground outline-none focus:ring-2 focus:ring-primary transition-all">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="todos">Todos os tipos</SelectItem>
                <SelectItem value="entrada">Recebimento</SelectItem>
                <SelectItem value="saida_producao">Consumo OP</SelectItem>
                <SelectItem value="entrada_producao">Produção Acabada</SelectItem>
                <SelectItem value="ajuste_positivo">Ajuste +</SelectItem>
                <SelectItem value="ajuste_negativo">Ajuste -</SelectItem>
                <SelectItem value="refugo">Refugo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {movFiltradas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ArrowLeftRight className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm font-bold text-foreground">Nenhuma movimentação</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Data", "Item", "Tipo", "Qtd", "Anterior", "Posterior", "Custo Unit.", "Valor", "Obs"].map(h => (
                      <th key={h} className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {movFiltradas.map(m => {
                    const config = TIPO_MOV_LABELS[m.tipo] ?? { label: m.tipo, cor: "text-foreground", icone: "adj" }
                    const isEntrada = config.icone === "in"
                    return (
                      <tr key={m.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(m.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-4 py-3 max-w-[160px]">
                          <p className="text-xs font-bold text-foreground truncate">{m.insumo?.codigo}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{m.insumo?.descricao}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {isEntrada
                              ? <TrendingUp className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                              : <TrendingDown className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                            }
                            <span className={`text-[10px] font-bold ${config.cor}`}>{config.label}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold ${isEntrada ? "text-green-600" : "text-destructive"}`}>
                            {isEntrada ? "+" : "-"}{formatNum(m.quantidade)} {m.insumo?.unidade_medida}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{formatNum(m.quantidade_anterior)}</td>
                        <td className="px-4 py-3 text-xs font-bold text-foreground">{formatNum(m.quantidade_posterior)}</td>
                        <td className="px-4 py-3 text-xs text-foreground">{formatBRL(m.custo_unitario)}</td>
                        <td className="px-4 py-3 text-xs font-bold text-foreground">{formatBRL(m.valor_total)}</td>
                        <td className="px-4 py-3 text-[10px] text-muted-foreground max-w-[120px] truncate">{m.observacao ?? "-"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {abaAtiva === "itens" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">Cadastro de Itens</h3>
              <button
                onClick={() => setShowNovoItem(!showNovoItem)}
                className="h-9 px-4 flex items-center gap-2 bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest rounded-xl hover:opacity-90 transition-all"
              >
                {showNovoItem ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                {showNovoItem ? "Cancelar" : "Novo Item"}
              </button>
            </div>

            {showNovoItem && (
              <div className="p-5 border-b border-border bg-muted/20 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Código *</label>
                    <input type="text" placeholder="Ex: MP-001" value={novoItem.codigo}
                      onChange={e => setNovoItem(p => ({ ...p, codigo: e.target.value }))}
                      className="w-full h-10 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Descrição *</label>
                    <input type="text" placeholder="Ex: Tecido Algodão 200g" value={novoItem.descricao}
                      onChange={e => setNovoItem(p => ({ ...p, descricao: e.target.value }))}
                      className="w-full h-10 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Tipo *</label>
                    <Select value={novoItem.tipo} onValueChange={(v: any) => setNovoItem(p => ({ ...p, tipo: v }))}>
                      <SelectTrigger className="w-full h-10 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        <SelectItem value="materia_prima">Matéria-Prima</SelectItem>
                        <SelectItem value="semi_acabado">Semi-Acabado</SelectItem>
                        <SelectItem value="produto_acabado">Produto Acabado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Unidade *</label>
                    <input type="text" placeholder="Ex: kg, m, un, L" value={novoItem.unidade_medida}
                      onChange={e => setNovoItem(p => ({ ...p, unidade_medida: e.target.value }))}
                      className="w-full h-10 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Custo Unitário (R$)</label>
                    <input type="number" min="0" step="0.01" placeholder="0,00" value={novoItem.preco_unitario}
                      onChange={e => setNovoItem(p => ({ ...p, preco_unitario: e.target.value }))}
                      className="w-full h-10 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Estoque Mínimo</label>
                    <input type="number" min="0" step="0.001" placeholder="0" value={novoItem.estoque_minimo}
                      onChange={e => setNovoItem(p => ({ ...p, estoque_minimo: e.target.value }))}
                      className="w-full h-10 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
                  </div>
                </div>
                <button
                  onClick={handleSalvarItem}
                  disabled={salvandoItem || !novoItem.codigo || !novoItem.descricao || !novoItem.unidade_medida}
                  className="w-full h-11 flex items-center justify-center bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest rounded-xl hover:opacity-90 transition-all disabled:opacity-50"
                >
                  {salvandoItem ? "Salvando..." : "Salvar Item"}
                </button>
              </div>
            )}

            <div className="overflow-x-auto">
              {insumos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Package className="h-8 w-8 text-muted-foreground mb-3" />
                  <p className="text-sm font-bold text-foreground">Nenhum item cadastrado</p>
                  <p className="text-xs text-muted-foreground mt-1">Clique em "Novo Item" para começar</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {["Código", "Descrição", "Tipo", "Unidade", "Custo Unit.", "Estoque Mín."].map(h => (
                        <th key={h} className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {insumos.map(i => (
                      <tr key={i.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-xs font-bold text-foreground">{i.codigo}</td>
                        <td className="px-4 py-3 text-xs text-foreground">{i.descricao}</td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                            {TIPO_LABELS[i.tipo]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{i.unidade_medida}</td>
                        <td className="px-4 py-3 text-xs text-foreground">{formatBRL(i.preco_unitario)}</td>
                        <td className="px-4 py-3 text-xs text-foreground">{formatNum(i.estoque_minimo)} {i.unidade_medida}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
