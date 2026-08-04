"use client"

import React, { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  Plus, Trash2, Calendar, ShieldAlert, TrendingUp,
  Columns3, CalendarDays, ListOrdered, GripVertical,
  ChevronLeft, ChevronRight, ChevronDown, AlertTriangle, Factory, Check
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { supabase } from "@/components/supabase"
import { DatePicker } from "@/components/date-picker"
import { Skeleton } from "@/components/ui/skeleton"
import { calculatePlannedOrderSeconds } from "@/lib/production-metrics"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  decideOrderDeletion,
  ORDER_WITH_POINTINGS_MESSAGE,
  summarizeOrderPointings,
  type OrderDeletionDecision,
  type OrderDeletionSummary,
  type OrderPointingForDeletion,
} from "@/lib/order-deletion"

const DEFAULT_SHIFT_CAPACITY_SECONDS = 29880

function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}
const DIAS_SEMANA = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"]

interface SupabaseMaquina {
  id: string
  nome: string
  capacidade_diaria: number
  status: string
}

interface SupabaseOperacao {
  nome: string
  tempo: number
  unidade: "minutes" | "seconds"
  setup_time?: number
  maquina_id?: string
  ativo?: boolean
}

interface SupabaseProduto {
  codigo: string
  descricao: string
  operacoes?: SupabaseOperacao[]
}

interface SupabaseOrdem {
  id: string
  numero_op: string
  data_programacao: string
  produto_codigo: string
  quantidade: number
  regra_calculo: "soma" | "media" | "gargalo"
  agrupar_setup: boolean
  status: string
  quantidade_produzida: number
  quantidade_aprovada: number
  quantidade_aprovada_estoque: number
}

interface SupabaseCapacidade {
  id: string
  data_excecao: string
  capacidade_global: number
  tempo_parada: number
}

interface Machine {
  id: string
  nome: string
  capacidade_diaria: number
  status: string
}

interface RoutingStep {
  name: string
  cycleTime: number
  setupTime: number
  maquina_id?: string
}

interface Product {
  code: string
  description: string
  steps: RoutingStep[]
}

interface ProductionOrder {
  id: string
  opNumber: string
  date: string
  productCode: string
  quantity: number
  calculationRule: "soma" | "media" | "gargalo"
  groupSetup: boolean
  status: string
  quantityProduced: number
  quantityApproved: number
  quantityStocked: number
  deletionSummary: OrderDeletionSummary
}

interface BlockedOrder {
  order: ProductionOrder
  decision: OrderDeletionDecision
}

interface DeleteOrderRpcResult {
  success?: boolean
  code?: string
  message?: string
  audit_log_id?: string
  dependencies?: {
    total_apontamentos?: number
    apontamentos_ativos?: number
    apontamentos_pausados?: number
    apontamentos_finalizados?: number
    apontamentos_estornados?: number
    usuarios?: Array<{ id?: string; nome?: string }>
    primeiro_apontamento?: string | null
    ultimo_apontamento?: string | null
    pausas?: number
    refugos?: number
    movimentos_estoque?: number
    eventos_produtivos?: number
    utilizado_no_oee?: boolean
  }
}

interface DailyCapacity {
  id?: string
  date: string
  globalCapacity: number
  downtime: number
}

interface OPSlice {
  op: ProductionOrder
  sliceDate: string
  sliceSeconds: number
  machineLoads: Record<string, number>
  totalSeconds: number
  isFirst: boolean
  isLast: boolean
  partIndex: number
  totalParts: number
}

interface HeijunkaMachine {
  name: string
  load: number
  capacity: number
  occupation: number
  overflow: number
}

interface HeijunkaDay {
  date: string
  machines: HeijunkaMachine[]
  maxOccupation: number
  totalLoad: number
  totalOverflow: number
}

function toDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function toStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function addDays(dateStr: string, n: number): string {
  const d = toDate(dateStr)
  d.setDate(d.getDate() + n)
  return toStr(d)
}

function getMondayOfWeek(dateStr: string): string {
  const d = toDate(dateStr)
  const dow = d.getDay()
  const diff = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + diff)
  return toStr(d)
}

function getWeekDays(monday: string): string[] {
  return Array.from({ length: 5 }, (_, i) => addDays(monday, i))
}

function formatDateLabel(dateStr: string): string {
  const [, m, d] = dateStr.split("-")
  return `${d}/${m}`
}

function formatMinutes(sec: number): string {
  const m = Math.round(sec / 60)
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h}h` : `${h}h ${r}min`
}

function formatDateTime(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR")
}

function summaryFromRpc(
  dependencies: DeleteOrderRpcResult["dependencies"],
  fallback: OrderDeletionSummary,
): OrderDeletionSummary {
  if (!dependencies) return fallback
  return {
    total: Number(dependencies.total_apontamentos ?? fallback.total),
    active: Number(dependencies.apontamentos_ativos ?? fallback.active),
    paused: Number(dependencies.apontamentos_pausados ?? fallback.paused),
    finalized: Number(dependencies.apontamentos_finalizados ?? fallback.finalized),
    reversed: Number(dependencies.apontamentos_estornados ?? fallback.reversed),
    events: Number(dependencies.eventos_produtivos ?? fallback.events),
    users: (dependencies.usuarios ?? []).map((user) => user.nome ?? user.id ?? "Usuário não identificado"),
    firstPointing: dependencies.primeiro_apontamento ?? fallback.firstPointing,
    lastPointing: dependencies.ultimo_apontamento ?? fallback.lastPointing,
    pauses: Number(dependencies.pausas ?? fallback.pauses),
    scraps: Number(dependencies.refugos ?? fallback.scraps),
    movements: Number(dependencies.movimentos_estoque ?? fallback.movements),
    usesOee: Boolean(dependencies.utilizado_no_oee ?? fallback.usesOee),
  }
}

export function PCPTab({
  empresaAtivaId,
  onOpenAudit,
}: {
  empresaAtivaId?: string | null
  onOpenAudit?: () => void
}) {
  const { toast } = useToast()

  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<ProductionOrder[]>([])
  const [capacities, setCapacities] = useState<DailyCapacity[]>([])
  const [machines, setMachines] = useState<Machine[]>([])
  const [loading, setLoading] = useState(true)
  const [blockedOrder, setBlockedOrder] = useState<BlockedOrder | null>(null)
  const [orderToDelete, setOrderToDelete] = useState<ProductionOrder | null>(null)
  const [deleteReason, setDeleteReason] = useState("")
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null)

  const [viewMode, setViewMode] = useState<"kanban" | "calendario" | "lista">("kanban")
  const [excecoesAbertas, setExcecoesAbertas] = useState(false)
  const [demandaAberta, setDemandaAberta] = useState(false)

  const [currentMonday, setCurrentMonday] = useState<string>(() => getMondayOfWeek(toStr(new Date())))
  const weekDays = useMemo(() => getWeekDays(currentMonday), [currentMonday])

  const [opNumber, setOpNumber] = useState("")
  const [showOpSuggestions, setShowOpSuggestions] = useState(false)

  // Busca por número da OP ou nome/código do produto — só entre OPs já existentes
  const opSuggestions = useMemo(() => {
    const q = opNumber.trim().toLowerCase()
    if (!q) return []
    return orders
      .filter(o => {
        const prod = products.find(p => p.code === o.productCode)
        return (
          o.opNumber.toLowerCase().includes(q) ||
          o.productCode.toLowerCase().includes(q) ||
          (prod?.description || "").toLowerCase().includes(q)
        )
      })
      .slice(0, 8)
  }, [opNumber, orders, products])
  const [opDate, setOpDate] = useState("")
  const [opProductCode, setOpProductCode] = useState("")
  const [productSearchTerm, setProductSearchTerm] = useState("")
  const [showProductDropdown, setShowProductDropdown] = useState(false)

  const filteredProducts = useMemo(() => {
    const q = normalizeText(productSearchTerm)
    if (!q) return products
    return products.filter(p => {
      const codeNorm = normalizeText(p.code)
      const descNorm = normalizeText(p.description || "")
      const combinedNorm = normalizeText(`${p.code} - ${p.description || ""}`)
      return codeNorm.includes(q) || descNorm.includes(q) || combinedNorm.includes(q)
    })
  }, [products, productSearchTerm])

  const selectedProduct = useMemo(() => {
    return products.find(p => p.code === opProductCode)
  }, [products, opProductCode])

  const [opQuantity, setOpQuantity] = useState("")
  const [opRule, setOpRule] = useState<"soma" | "media" | "gargalo">("soma")
  const [opGroupSetup, setOpGroupSetup] = useState(false)

  const [selectedDate, setSelectedDate] = useState("")
  const [capacityValue, setCapacityValue] = useState("")
  const [capacityUnit, setCapacityUnit] = useState<"hours" | "minutes">("hours")
  const [downtimeValue, setDowntimeValue] = useState("")

  const [draggingId, setDraggingId] = useState<string | null>(null)

  const loadData = async () => {
    if (!empresaAtivaId) { setLoading(false); return }
    setLoading(true)
    try {
      const qMaquinas = supabase.from("maquinas").select("*").eq("empresa_id", empresaAtivaId)
      const qProdutos = supabase.from("produtos").select("*, operacoes(*)").eq("empresa_id", empresaAtivaId).eq("ativo", true)
      const qOrdens = supabase.from("ordens_producao").select("*").eq("empresa_id", empresaAtivaId)
      const qCapacidade = supabase.from("capacidade_diaria").select("*").eq("empresa_id", empresaAtivaId)
      const qApontamentos = supabase.from("apontamentos")
        .select("id,ordem_id,user_id,status,estado_operacao,finalizado_em,estornado_em,cronometro_inicio,created_at,updated_at,cronometro_total_segundos,pecas_produzidas,pecas_refugo,pecas_retrabalho")
        .eq("empresa_id", empresaAtivaId)
      const qEventos = supabase.from("production_order_events")
        .select("production_order_id")
        .eq("tenant_id", empresaAtivaId)
      const qPausas = supabase.from("apontamento_pausas")
        .select("apontamento_id")
        .eq("empresa_id", empresaAtivaId)
      const qMovimentos = supabase.from("movimentacoes_estoque")
        .select("referencia_id,reversal_apontamento_id")
        .eq("empresa_id", empresaAtivaId)
      const qPerfis = supabase.from("perfis")
        .select("user_id,nome,email")
        .eq("empresa_id", empresaAtivaId)

      const [
        { data: maqData }, { data: prodsData }, { data: opsData }, { data: capData },
        { data: apontamentosData }, { data: eventosData }, { data: pausasData },
        { data: movimentosData }, { data: perfisData },
      ] = await Promise.all([
        qMaquinas, qProdutos, qOrdens, qCapacidade, qApontamentos, qEventos,
        qPausas, qMovimentos, qPerfis,
      ])

      setMachines((maqData as SupabaseMaquina[]) || [])

      setProducts(((prodsData as SupabaseProduto[]) || []).map((p) => ({
        code: p.codigo,
        description: p.descricao,
        steps: (p.operacoes || []).filter(op => op.ativo !== false).map((op) => ({
          name: op.nome,
          cycleTime: op.unidade === "minutes" ? Number(op.tempo) * 60 : Number(op.tempo),
          setupTime: op.unidade === "minutes" ? Number(op.setup_time || 0) * 60 : Number(op.setup_time || 0),
          maquina_id: op.maquina_id
        }))
      })))

      const pointings = (apontamentosData ?? []) as OrderPointingForDeletion[]
      const eventsByOrder = new Map<string, number>()
      for (const event of eventosData ?? []) {
        const orderId = event.production_order_id as string | null
        if (orderId) eventsByOrder.set(orderId, (eventsByOrder.get(orderId) ?? 0) + 1)
      }
      const userNames = new Map<string, string>()
      for (const profile of perfisData ?? []) {
        if (profile.user_id) userNames.set(profile.user_id, profile.nome ?? profile.email ?? profile.user_id)
      }

      setOrders(((opsData as SupabaseOrdem[]) || []).map((op) => ({
        id: op.id,
        opNumber: op.numero_op,
        date: op.data_programacao,
        productCode: op.produto_codigo,
        quantity: op.quantidade,
        calculationRule: op.regra_calculo,
        groupSetup: op.agrupar_setup,
        status: op.status,
        quantityProduced: Number(op.quantidade_produzida ?? 0),
        quantityApproved: Number(op.quantidade_aprovada ?? 0),
        quantityStocked: Number(op.quantidade_aprovada_estoque ?? 0),
        deletionSummary: summarizeOrderPointings(
          op.id,
          pointings,
          eventsByOrder.get(op.id) ?? 0,
          {
            userNames,
            pauses: pausasData ?? [],
            movements: movimentosData ?? [],
          },
        ),
      })))

      setCapacities(((capData as SupabaseCapacidade[]) || []).map((c) => ({
        id: c.id,
        date: c.data_excecao,
        globalCapacity: Number(c.capacidade_global),
        downtime: Number(c.tempo_parada)
      })))
    } catch (e) {
      // Falha na rede tratada silenciosamente
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [empresaAtivaId])

  const calculateOPTime = (op: ProductionOrder): number => {
    const product = products.find((p) => p.code === op.productCode)
    if (!product || product.steps.length === 0) return 0
    return calculatePlannedOrderSeconds(
      product.steps.map(step => ({
        name: step.name,
        time: step.cycleTime,
        setupTime: step.setupTime,
        unit: "seconds" as const,
      })),
      op.quantity,
      op.groupSetup,
    )
  }

  const getMachineCap = (mId: string, dateStr: string): number => {
    const m = machines.find(x => x.id === mId)
    const base = m && m.capacidade_diaria > 0 ? m.capacidade_diaria * 3600 : DEFAULT_SHIFT_CAPACITY_SECONDS
    const globalCap = capacities.find(c => c.date === dateStr)
    const down = globalCap?.downtime ?? 0
    return Math.max(0, base - down)
  }

  const computeSlices = useMemo((): OPSlice[] => {
    const slices: OPSlice[] = []
    const allocated: Record<string, Record<string, number>> = {}

    const getNextWorkday = (dateStr: string): string => {
      const d = toDate(dateStr)
      do { d.setDate(d.getDate() + 1) } while (d.getDay() === 0 || d.getDay() === 6)
      return toStr(d)
    }

    for (const op of orders) {
      const prod = products.find(p => p.code === op.productCode)
      if (!prod) continue

      const loads: Record<string, number> = {}
      prod.steps.forEach(s => {
        const mId = s.maquina_id || 'global'
        const time = (op.quantity * s.cycleTime) + (op.groupSetup ? 0 : s.setupTime)
        loads[mId] = (loads[mId] || 0) + time
      })

      const opSlicesByDate: Record<string, { [mId: string]: number }> = {}

      for (const mId of Object.keys(loads)) {
        let rem = loads[mId]
        let curDate = op.date
        let safety = 0
        while (rem > 0 && safety < 60) {
          safety++
          if (!allocated[mId]) allocated[mId] = {}
          const cap = getMachineCap(mId, curDate)
          const used = allocated[mId][curDate] || 0
          const free = Math.max(0, cap - used)

          if (free > 0) {
            const alloc = Math.min(rem, free)
            allocated[mId][curDate] = used + alloc
            if (!opSlicesByDate[curDate]) opSlicesByDate[curDate] = {}
            opSlicesByDate[curDate][mId] = (opSlicesByDate[curDate][mId] || 0) + alloc
            rem -= alloc
          }

          if (rem > 0) curDate = getNextWorkday(curDate)
        }
      }

      const dates = Object.keys(opSlicesByDate).sort()
      dates.forEach((d, idx) => {
        const mLoads = opSlicesByDate[d]
        const totalSecsInDay = Object.values(mLoads).reduce((a, b) => a + b, 0)
        slices.push({
          op,
          sliceDate: d,
          sliceSeconds: totalSecsInDay,
          machineLoads: mLoads,
          totalSeconds: calculateOPTime(op),
          isFirst: idx === 0,
          isLast: idx === dates.length - 1,
          partIndex: idx + 1,
          totalParts: dates.length
        })
      })
    }

    return slices
  }, [orders, capacities, products, machines])

  const allDates = useMemo(() => {
    const dates = new Set([
      ...orders.map((o) => o.date),
      ...capacities.map((c) => c.date),
      ...computeSlices.map((s) => s.sliceDate),
    ])
    return Array.from(dates).sort()
  }, [orders, capacities, computeSlices])

  const heijunkaDashboard = useMemo(() => {
    const map: Record<string, HeijunkaDay> = {}
    allDates.forEach((date) => {
      const daySlices = computeSlices.filter((s) => s.sliceDate === date)
      const mLoads: Record<string, HeijunkaMachine> = {}

      machines.filter(m => m.status !== 'inativa').forEach(m => {
        const base = m.capacidade_diaria > 0 ? m.capacidade_diaria * 3600 : DEFAULT_SHIFT_CAPACITY_SECONDS
        const globalCap = capacities.find(c => c.date === date)
        const down = globalCap?.downtime ?? 0
        const cap = Math.max(0, base - down)
        mLoads[m.id] = { load: 0, capacity: cap, overflow: 0, occupation: 0, name: m.nome }
      })

      if (!mLoads['global']) {
        const globalCap = capacities.find(c => c.date === date)
        const down = globalCap?.downtime ?? 0
        mLoads['global'] = { load: 0, capacity: Math.max(0, DEFAULT_SHIFT_CAPACITY_SECONDS - down), overflow: 0, occupation: 0, name: "Geral (Sem Máquina)" }
      }

      daySlices.forEach(sl => {
        if (sl.machineLoads) {
          Object.entries(sl.machineLoads).forEach(([mId, secs]) => {
            if (mLoads[mId]) {
              mLoads[mId].load += secs
            }
          })
        }
      })

      let maxOcc = 0
      let totLoad = 0
      let totOverflow = 0

      Object.values(mLoads).forEach(ml => {
        ml.occupation = ml.capacity > 0 ? (ml.load / ml.capacity) * 100 : 0
        ml.overflow = Math.max(0, ml.load - ml.capacity)
        if (ml.occupation > maxOcc) maxOcc = ml.occupation
        totLoad += ml.load
        totOverflow += ml.overflow
      })

      map[date] = { 
        date, 
        machines: Object.values(mLoads).filter(m => m.load > 0 || m.capacity > 0), 
        maxOccupation: maxOcc, 
        totalLoad: totLoad, 
        totalOverflow: totOverflow 
      }
    })
    return map
  }, [allDates, computeSlices, capacities, machines])

  const dashboardArray = Object.values(heijunkaDashboard)

  const handleAddOP = async () => {
    if (!opNumber || !opDate || !opProductCode || !opQuantity) {
      toast({ title: "Erro", description: "Preencha todos os campos da OP.", variant: "destructive" })
      return
    }

    const newOP = {
      numero_op: opNumber.trim(),
      data_programacao: opDate,
      produto_codigo: opProductCode,
      quantidade: parseInt(opQuantity),
      regra_calculo: opRule,
      agrupar_setup: opGroupSetup,
      empresa_id: empresaAtivaId || null,
    }

    const { data, error } = await supabase.from("ordens_producao").insert([newOP]).select()
    if (error) { toast({ title: "Erro", description: "Falha ao salvar OP no banco.", variant: "destructive" }); return }

    if (data && data[0]) {
      setOrders(prev => [...prev, {
        id: data[0].id, opNumber: data[0].numero_op, date: data[0].data_programacao,
        productCode: data[0].produto_codigo, quantity: data[0].quantidade,
        calculationRule: data[0].regra_calculo, groupSetup: data[0].agrupar_setup,
        status: data[0].status,
        quantityProduced: Number(data[0].quantidade_produzida ?? 0),
        quantityApproved: Number(data[0].quantidade_aprovada ?? 0),
        quantityStocked: Number(data[0].quantidade_aprovada_estoque ?? 0),
        deletionSummary: summarizeOrderPointings(data[0].id, []),
      }])
      setOpNumber("")
      setOpQuantity("")
      toast({ title: "✅ OP Adicionada", description: "Carga nivelada por máquina." })
    }
  }

  const requestRemoveOP = (order: ProductionOrder) => {
    const decision = decideOrderDeletion({
      status: order.status,
      quantityProduced: order.quantityProduced,
      quantityApproved: order.quantityApproved,
      quantityStocked: order.quantityStocked,
      summary: order.deletionSummary,
    })
    if (decision.blocked) {
      setBlockedOrder({ order, decision })
      return
    }
    setDeleteReason("")
    setOrderToDelete(order)
  }

  const handleRemoveOP = async () => {
    if (!empresaAtivaId || !orderToDelete || deletingOrderId) return
    const order = orderToDelete
    setDeletingOrderId(order.id)
    const { data, error } = await supabase.rpc("excluir_ordem_producao_segura", {
      p_empresa_id: empresaAtivaId,
      p_ordem_id: order.id,
      p_motivo: deleteReason.trim(),
      p_confirmar: true,
      p_idempotency_key: crypto.randomUUID(),
    })
    setDeletingOrderId(null)
    if (error) {
      toast({ title: "Não foi possível excluir a OP", description: error.message, variant: "destructive" })
      return
    }
    const result = data as DeleteOrderRpcResult | null
    if (!result?.success) {
      const updatedOrder = {
        ...order,
        deletionSummary: summaryFromRpc(result?.dependencies, order.deletionSummary),
      }
      setOrders((current) => current.map((item) => item.id === order.id ? updatedOrder : item))
      setOrderToDelete(null)
      setBlockedOrder({
        order: updatedOrder,
        decision: {
          blocked: true,
          code: result?.code === "OP_HAS_POINTINGS" ? "OP_HAS_POINTINGS" : "OP_HAS_OPERATIONAL_HISTORY",
          message: result?.message ?? "A OP possui histórico e não pode ser excluída.",
        },
      })
      return
    }
    setOrders((current) => current.filter((item) => item.id !== order.id))
    setOrderToDelete(null)
    toast({ title: "Rascunho excluído", description: "A exclusão foi registrada na auditoria." })
  }

  const handleSaveDowntime = async () => {
    if (!selectedDate) { toast({ title: "Erro", description: "Selecione uma data.", variant: "destructive" }); return }

    const existing = capacities.find((c) => c.date === selectedDate)
    let capInSeconds = existing?.globalCapacity ?? DEFAULT_SHIFT_CAPACITY_SECONDS
    if (capacityValue) {
      const val = parseFloat(capacityValue)
      capInSeconds = capacityUnit === "hours" ? val * 3600 : val * 60
    }
    const downtimeInSeconds = downtimeValue ? parseFloat(downtimeValue) * 60 : (existing?.downtime ?? 0)

    const payload = { 
      data_excecao: selectedDate, 
      capacidade_global: capInSeconds, 
      tempo_parada: downtimeInSeconds,
      ...(empresaAtivaId && { empresa_id: empresaAtivaId })
    }

    if (existing?.id) {
      await supabase.from("capacidade_diaria").update(payload).eq("id", existing.id)
      setCapacities(capacities.map((c) => c.date === selectedDate ? { ...c, globalCapacity: capInSeconds, downtime: downtimeInSeconds } : c))
    } else {
      const { data } = await supabase.from("capacidade_diaria").insert([payload]).select()
      if (data && data[0]) setCapacities([...capacities, { id: data[0].id, date: selectedDate, globalCapacity: capInSeconds, downtime: downtimeInSeconds }])
    }
    setCapacityValue("")
    setDowntimeValue("")
    toast({ title: "✅ Exceção Salva" })
  }

  const handleRemoveCapacity = async (date: string) => {
    const { error } = await supabase.from("capacidade_diaria").delete().eq("data_excecao", date)
    if (!error) { setCapacities(capacities.filter((c) => c.date !== date)); toast({ title: "Exceção Removida" }) }
  }

  const handleDragStart = (e: React.DragEvent, opId: string) => {
    e.dataTransfer.setData("text/plain", opId)
    setDraggingId(opId)
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = "0.4"
  }

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = "1"
    setDraggingId(null)
  }

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault() }

  const handleDrop = async (e: React.DragEvent, targetDate: string) => {
    e.preventDefault()
    const opId = e.dataTransfer.getData("text/plain")
    setDraggingId(null)
    if (!opId) return

    const op = orders.find((o) => o.id === opId)
    if (!op || op.date === targetDate) return

    const { error } = await supabase.from("ordens_producao").update({ data_programacao: targetDate }).eq("id", opId)
    if (!error) {
      setOrders(orders.map(o => o.id === opId ? { ...o, date: targetDate } : o))
      toast({ title: "🔄 OP Realocada", description: `Início movido para ${formatDateLabel(targetDate)}. Transbordo recalculado.` })
    }
  }

  const prevWeek = () => setCurrentMonday(prev => addDays(prev, -7))
  const nextWeek = () => setCurrentMonday(prev => addDays(prev, 7))
  const goToday = () => setCurrentMonday(getMondayOfWeek(toStr(new Date())))

  const weekLabel = useMemo(() => {
    const friday = addDays(currentMonday, 4)
    return `${formatDateLabel(currentMonday)} - ${formatDateLabel(friday)}`
  }, [currentMonday])

  const isCurrentWeek = useMemo(() => currentMonday === getMondayOfWeek(toStr(new Date())), [currentMonday])
  const todayStr = toStr(new Date())

  if (loading) return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-14 w-full rounded-2xl" />
        <Skeleton className="h-14 w-full rounded-2xl" />
      </div>
      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <Skeleton className="h-4 w-56" />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  )

  return (
    <div className="space-y-6">

      <div className="grid gap-4 md:grid-cols-2 items-start">

        <Card className="bg-card border-border shadow-sm">
          <CardHeader
            className="cursor-pointer select-none"
            onClick={() => setDemandaAberta(v => !v)}
          >
            <CardTitle className="text-lg flex items-center justify-between">
              <span>Programar Demanda Diária</span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${demandaAberta ? "rotate-180" : ""}`} />
            </CardTitle>
            <CardDescription>Insira ordens de produção na fila de nivelamento</CardDescription>
          </CardHeader>
          {demandaAberta && (
          <CardContent className="space-y-4">
            <div className="space-y-1.5 relative">
              <Label className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Número da OP</Label>
              <Input
                placeholder="Número da OP ou nome do produto..."
                value={opNumber}
                onChange={(e) => { setOpNumber(e.target.value); setShowOpSuggestions(true) }}
                onFocus={() => setShowOpSuggestions(true)}
                onBlur={() => setTimeout(() => setShowOpSuggestions(false), 150)}
                className="bg-input border-border h-10"
              />
              {showOpSuggestions && opSuggestions.length > 0 && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg max-h-56 overflow-y-auto">
                  {opSuggestions.map(o => {
                    const prod = products.find(p => p.code === o.productCode)
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setOpNumber(o.opNumber)
                          setOpProductCode(o.productCode)
                          setShowOpSuggestions(false)
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors flex items-center justify-between gap-2"
                      >
                        <span className="text-xs font-bold text-foreground">{o.opNumber}</span>
                        <span className="text-[10px] text-muted-foreground truncate">{o.productCode}{prod ? ` — ${prod.description}` : ""}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Data de Início</Label>
              <DatePicker value={opDate} onChange={setOpDate} />
            </div>
            <div className="space-y-1.5 relative">
              <Label className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Produto / Roteiro</Label>
              <div className="relative">
                <Input
                  placeholder="Selecione ou busque por código ou nome..."
                  value={showProductDropdown ? productSearchTerm : (selectedProduct ? `${selectedProduct.code} - ${selectedProduct.description}` : "")}
                  onChange={(e) => {
                    setProductSearchTerm(e.target.value)
                    if (!showProductDropdown) setShowProductDropdown(true)
                  }}
                  onFocus={() => {
                    setProductSearchTerm("")
                    setShowProductDropdown(true)
                  }}
                  onBlur={() => setTimeout(() => setShowProductDropdown(false), 200)}
                  className="bg-input border-border h-10 pr-8 text-xs font-medium"
                />
                <ChevronDown className="h-4 w-4 text-muted-foreground absolute right-2.5 top-3 pointer-events-none" />
              </div>
              {showProductDropdown && (
                <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg max-h-56 overflow-y-auto">
                  {filteredProducts.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-muted-foreground text-center font-medium">
                      {products.length === 0 ? "Nenhum roteiro salvo" : `Nenhum roteiro encontrado para "${productSearchTerm}"`}
                    </div>
                  ) : (
                    filteredProducts.map((p) => (
                      <button
                        key={p.code}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setOpProductCode(p.code)
                          setProductSearchTerm("")
                          setShowProductDropdown(false)
                        }}
                        className={`w-full text-left px-3 py-2.5 hover:bg-muted/60 transition-colors flex items-center justify-between text-xs gap-2 ${opProductCode === p.code ? "bg-primary/10 font-bold text-primary" : "text-foreground"}`}
                      >
                        <span className="font-semibold">{p.code} - {p.description}</span>
                        {opProductCode === p.code && <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Quantidade Solicitada</Label>
              <Input type="number" placeholder="Ex: 150" value={opQuantity} onChange={(e) => setOpQuantity(e.target.value)} className="bg-input border-border h-10" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Regra de Tempo Base</Label>
              <Select value={opRule} onValueChange={(v: "soma" | "media" | "gargalo") => setOpRule(v)}>
                <SelectTrigger className="bg-input border-border h-10"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="soma">Soma dos Tempos do Roteiro</SelectItem>
                  <SelectItem value="media">Média dos Tempos</SelectItem>
                  <SelectItem value="gargalo">Tempo da Operação Gargalo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted/30 border border-border rounded-lg">
              <div className="flex flex-col gap-0.5">
                <Label className="text-xs font-bold">Agrupar Setup?</Label>
                <span className="text-[10px] text-muted-foreground">Zera setup desta OP</span>
              </div>
              <Switch checked={opGroupSetup} onCheckedChange={setOpGroupSetup} />
            </div>
            <Button className="w-full h-10 font-bold uppercase tracking-wider bg-primary hover:opacity-90 text-primary-foreground" onClick={handleAddOP}>
              <Plus className="h-4 w-4 mr-2" /> Inserir Ordem
            </Button>
          </CardContent>
          )}
        </Card>

        <Card className="bg-card border-border shadow-sm">
          <CardHeader
            className="pb-2 cursor-pointer select-none"
            onClick={() => setExcecoesAbertas(v => !v)}
          >
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <span className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-primary" />
                Gerenciamento de Exceções
              </span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${excecoesAbertas ? "rotate-180" : ""}`} />
            </CardTitle>
          </CardHeader>
          {excecoesAbertas && (
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">Data da Exceção</Label>
              <DatePicker value={selectedDate} onChange={setSelectedDate} className="h-9 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">Tempo Disponível</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" placeholder="Ex: 8.0" value={capacityValue} onChange={(e) => setCapacityValue(e.target.value)} className="h-9 text-xs bg-input border-border" />
                <Select value={capacityUnit} onValueChange={(v: "hours" | "minutes") => setCapacityUnit(v)}>
                  <SelectTrigger className="h-9 text-xs border-border bg-input"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="hours">Horas</SelectItem>
                    <SelectItem value="minutes">Minutos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">Paradas Planejadas (min)</Label>
              <Input type="number" placeholder="Ex: 45" value={downtimeValue} onChange={(e) => setDowntimeValue(e.target.value)} className="h-9 text-xs bg-input border-border" />
            </div>
            <Button size="sm" className="w-full h-9 text-xs font-bold uppercase tracking-wider bg-primary hover:opacity-90 text-primary-foreground" onClick={handleSaveDowntime} disabled={!selectedDate}>
              Aplicar Restrição Global
            </Button>
            {capacities.length > 0 && (
              <div className="pt-2 space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Exceções Cadastradas</Label>
                <div className="space-y-1 max-h-[180px] overflow-y-auto">
                  {capacities.sort((a, b) => a.date.localeCompare(b.date)).map((cap) => (
                    <div key={cap.date} className="flex items-center justify-between p-2 bg-muted/30 border border-border rounded-lg">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-bold text-foreground">{cap.date.split("-").reverse().join("/")}</span>
                        <span className="text-[10px] text-muted-foreground">{(cap.globalCapacity / 3600).toFixed(1)}h disp. · {(cap.downtime / 60).toFixed(0)}min parada</span>
                      </div>
                      <button onClick={() => handleRemoveCapacity(cap.date)} className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
          )}
        </Card>
      </div>

        <Card className="bg-card border-border shadow-sm flex flex-col">
          <CardHeader className="pb-4 border-b border-border flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" /> Visão de Carga Nivelada (Por Máquina)
            </CardTitle>
            <div className="flex bg-input border border-border p-1 rounded-lg">
              <button onClick={() => setViewMode("kanban")} className={`p-1.5 rounded-md transition-colors ${viewMode === "kanban" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                <Columns3 className="w-4 h-4" />
              </button>
              <button onClick={() => setViewMode("calendario")} className={`p-1.5 rounded-md transition-colors ${viewMode === "calendario" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                <CalendarDays className="w-4 h-4" />
              </button>
              <button onClick={() => setViewMode("lista")} className={`p-1.5 rounded-md transition-colors ${viewMode === "lista" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                <ListOrdered className="w-4 h-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 p-4 overflow-auto">
            {dashboardArray.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center py-10 gap-4 text-center">
                <div className="p-4 rounded-full bg-muted/40 border border-border">
                  <Calendar className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-foreground">Nenhuma programação ainda</p>
                  <p className="text-xs text-muted-foreground max-w-[260px]">Cadastre um produto no GBO e insira uma Ordem de Produção.</p>
                </div>
              </div>
            ) : (
              <React.Fragment>
                {(() => {
                  const totalDays = dashboardArray.length
                  const overloadedDays = dashboardArray.filter((d) => d.totalOverflow > 0).length
                  const totalLoad = dashboardArray.reduce((s, d) => s + d.totalLoad, 0)
                  const totalCap = dashboardArray.reduce((s, d) => s + d.machines.reduce((acc, m) => acc + m.capacity, 0), 0)
                  const globalOcc = totalCap > 0 ? (totalLoad / totalCap) * 100 : 0
                  
                  return (
                    <div className="mb-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
                      {[
                        { label: "Pico de Máquina", value: `${Math.max(...dashboardArray.map((d) => d.maxOccupation)).toFixed(0)}%`, warn: Math.max(...dashboardArray.map((d) => d.maxOccupation)) > 85, danger: Math.max(...dashboardArray.map((d) => d.maxOccupation)) > 100 },
                        { label: "Ocupação Global", value: `${globalOcc.toFixed(0)}%`, warn: false, danger: globalOcc > 100 },
                        { label: "Dias com Gargalo", value: `${overloadedDays}/${totalDays}`, warn: overloadedDays > 0, danger: false },
                        { label: "Carga Total", value: `${(totalLoad / 3600).toFixed(1)}h`, warn: false, danger: false },
                      ].map(({ label, value, warn, danger }) => (
                        <div key={label} className={`p-4 rounded-xl border flex flex-col gap-1 ${danger ? "bg-destructive/5 border-destructive/30" : warn ? "bg-yellow-500/5 border-yellow-500/30" : "bg-card border-border"}`}>
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{label}</span>
                          <span className={`text-2xl font-bold ${danger ? "text-destructive" : warn ? "text-yellow-500" : "text-primary"}`}>{value}</span>
                        </div>
                      ))}
                    </div>
                  )
                })()}

                {viewMode === "kanban" && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <button onClick={prevWeek} className="p-1.5 rounded-lg hover:bg-muted border border-border transition-colors">
                        <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                      </button>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-foreground">{weekLabel}</span>
                        {!isCurrentWeek && (
                          <button onClick={goToday} className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                            Hoje
                          </button>
                        )}
                      </div>
                      <button onClick={nextWeek} className="p-1.5 rounded-lg hover:bg-muted border border-border transition-colors">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </div>

                    <div className="overflow-x-auto custom-scrollbar pb-2 -mx-1 px-1">
                      <div className="flex gap-2 min-h-[300px]">
                        {weekDays.map((date, idx) => {
                          const dayData = heijunkaDashboard[date]
                          const maxOccupation = dayData?.maxOccupation ?? 0
                          const daySlices = computeSlices.filter((s) => s.sliceDate === date)
                          const isToday = date === todayStr

                          return (
                            <div
                              key={date}
                              className={`flex flex-col min-h-0 flex-1 min-w-[210px] rounded-xl border transition-colors ${draggingId ? "border-primary/30 bg-primary/5" : isToday ? "border-primary/50 bg-primary/5" : "border-border bg-muted/10"}`}
                              onDragOver={handleDragOver}
                              onDrop={(e) => handleDrop(e, date)}
                            >
                            <div className={`p-2.5 border-b rounded-t-xl ${isToday ? "border-primary/30 bg-primary/10" : "border-border bg-muted/30"}`}>
                              <div className="flex items-center justify-between mb-1">
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                                  {DIAS_SEMANA[idx]}
                                </span>
                                {isToday && <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 bg-primary text-primary-foreground rounded-full">Hoje</span>}
                              </div>
                              <span className="text-xs font-bold text-foreground">{formatDateLabel(date)}</span>
                              <div className="mt-2 h-1.5 bg-input rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${maxOccupation > 100 ? "bg-destructive" : maxOccupation > 85 ? "bg-yellow-500" : "bg-primary"}`}
                                  style={{ width: `${Math.min(100, maxOccupation)}%` }}
                                />
                              </div>
                              <div className="mt-2 flex flex-col gap-1">
                                {dayData?.machines.filter(m => m.load > 0).map(m => (
                                  <div key={m.name} className="flex justify-between items-center text-[9px]">
                                    <span className="text-muted-foreground truncate max-w-[80px]" title={m.name}>{m.name}</span>
                                    <span className={m.overflow > 0 ? "text-destructive font-bold" : "text-foreground"}>
                                      {m.occupation.toFixed(0)}%
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="p-1.5 flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto max-h-[320px]">
                              {daySlices.length === 0 && (
                                <div className="flex-1 flex items-center justify-center py-6">
                                  <span className="text-[10px] text-muted-foreground/50">Livre</span>
                                </div>
                              )}
                              {daySlices.map((slice) => {
                                const pct = slice.totalSeconds > 0 ? (slice.sliceSeconds / slice.totalSeconds) * 100 : 100
                                const prod = products.find(p => p.code === slice.op.productCode)
                                const prodText = prod ? `${prod.code} - ${prod.description}` : slice.op.productCode
                                const opTitle = slice.op.opNumber.toLowerCase().startsWith("op") ? slice.op.opNumber : `OP ${slice.op.opNumber}`

                                return (
                                  <div
                                    key={`${slice.op.id}-${slice.sliceDate}`}
                                    draggable={slice.isFirst}
                                    onDragStart={slice.isFirst ? (e) => handleDragStart(e, slice.op.id) : undefined}
                                    onDragEnd={slice.isFirst ? handleDragEnd : undefined}
                                    title={`${opTitle} — ${prodText}`}
                                    className={`p-2 rounded-lg border shadow-sm flex flex-col gap-1 transition-all duration-150 relative
                                      ${slice.isFirst ? "cursor-grab active:cursor-grabbing" : "cursor-default opacity-80"}
                                      ${draggingId === slice.op.id ? "border-primary bg-primary/10 scale-[1.04] shadow-xl shadow-primary/20 z-10" : "bg-card border-border hover:border-primary/50"}
                                    `}
                                  >
                                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/30 rounded-l-lg" />
                                    <div className="flex items-center justify-between gap-1 pl-1.5 min-w-0">
                                      <div className="flex items-center gap-1 min-w-0 flex-1">
                                        {slice.isFirst && <GripVertical className="h-2.5 w-2.5 text-muted-foreground/40 flex-shrink-0" />}
                                        <span className="text-[11px] font-bold text-foreground truncate">{opTitle}</span>
                                      </div>
                                      {slice.totalParts > 1 && (
                                        <span className="text-[8px] font-bold px-1 py-0.5 bg-amber-500/15 text-amber-600 rounded flex-shrink-0">
                                          {slice.partIndex}/{slice.totalParts}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex justify-between items-center mt-0.5 pl-1.5 min-w-0">
                                      <span className="text-[10px] font-semibold text-primary truncate" title={prodText}>
                                        {prodText}
                                      </span>
                                    </div>
                                    <div className="flex flex-col gap-0.5 mt-1">
                                      {Object.entries(slice.machineLoads || {}).map(([mId, secs]) => {
                                        const mName = machines.find(m => m.id === mId)?.nome || "Geral"
                                        return (
                                          <div key={mId} className="flex justify-between items-center text-[9px] bg-muted/40 px-1 rounded">
                                            <span className="text-muted-foreground truncate max-w-[65px]" title={mName}>{mName}</span>
                                            <span className="font-mono text-foreground">{formatMinutes(secs as number)}</span>
                                          </div>
                                        )
                                      })}
                                    </div>
                                    {slice.totalParts > 1 && (
                                      <div className="h-1 bg-input rounded-full overflow-hidden mt-1">
                                        <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} />
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    </div>
                  </div>
                )}

                {viewMode === "calendario" && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {dashboardArray.map((day) => (
                      <div key={day.date} className={`p-3 border rounded-xl flex flex-col gap-1 ${day.totalOverflow > 0 ? "bg-destructive/5 border-destructive/30" : "bg-card border-border"}`}>
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-xs font-bold">{day.date.split("-")[2]}</span>
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{day.date.split("-")[1]}/{day.date.split("-")[0].slice(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-muted-foreground">Pico (Máquina)</span>
                          <span className={`font-bold ${day.maxOccupation > 100 ? "text-destructive" : "text-primary"}`}>{day.maxOccupation.toFixed(0)}%</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-muted-foreground">Carga Total</span>
                          <span className="font-bold text-foreground">{(day.totalLoad / 3600).toFixed(1)}h</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {viewMode === "lista" && (
                  <div className="w-full border border-border rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted text-muted-foreground uppercase tracking-wider">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Data</th>
                          <th className="px-4 py-3 font-semibold">Máquina em Gargalo</th>
                          <th className="px-4 py-3 font-semibold">Carga Total</th>
                          <th className="px-4 py-3 font-semibold">Pico Ocupação</th>
                          <th className="px-4 py-3 font-semibold text-right">Transbordo Dia</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {dashboardArray.map((day) => {
                          const bottleneck = day.machines.reduce((prev, curr) => (prev.occupation > curr.occupation) ? prev : curr)
                          return (
                            <tr key={day.date} className="hover:bg-muted/30 transition-colors">
                              <td className="px-4 py-3 font-medium text-foreground">{day.date.split("-").reverse().join("/")}</td>
                              <td className="px-4 py-3 text-muted-foreground">{bottleneck.name} ({bottleneck.occupation.toFixed(0)}%)</td>
                              <td className="px-4 py-3 text-foreground">{(day.totalLoad / 3600).toFixed(1)}h</td>
                              <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full font-bold ${day.maxOccupation > 100 ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>{day.maxOccupation.toFixed(0)}%</span></td>
                              <td className={`px-4 py-3 text-right font-bold ${day.totalOverflow > 0 ? "text-destructive" : "text-muted-foreground"}`}>{day.totalOverflow > 0 ? `+${(day.totalOverflow / 3600).toFixed(1)}h` : "-"}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </React.Fragment>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Fila de Ordens de Produção Ativas</CardTitle>
            <CardDescription>Gerencie e visualize todas as OPs programadas</CardDescription>
          </CardHeader>
          <CardContent className="overflow-y-auto max-h-[500px] pr-2 space-y-2">
            {orders.map((op) => {
              const opTime = calculateOPTime(op)
              const slices = computeSlices.filter((s) => s.op.id === op.id)
              const multiDay = slices.length > 1
              const prod = products.find(p => p.code === op.productCode)
              const prodDesc = prod ? `${prod.code} - ${prod.description}` : op.productCode
              const opTitle = op.opNumber.toLowerCase().startsWith("op") ? op.opNumber : `OP ${op.opNumber}`

              return (
                <div key={op.id} className="p-3 bg-muted/10 border border-border hover:border-primary/50 rounded-xl flex items-center justify-between transition-all">
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-foreground">{opTitle}</span>
                      <span className="text-[10px] font-bold px-2.5 py-0.5 bg-primary/10 text-primary rounded-full truncate max-w-[280px]" title={prodDesc}>
                        {prodDesc}
                      </span>
                      {multiDay && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-500/15 text-amber-600 rounded-full">
                          {slices.length} dias
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Início: <strong className="text-foreground">{op.date.split("-").reverse().join("/")}</strong>
                      {multiDay && ` -> Fim: ${slices[slices.length - 1].sliceDate.split("-").reverse().join("/")}`}
                      {" | "}Qtd: <strong className="text-foreground">{op.quantity}</strong>
                    </span>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      <span className="text-[9px] uppercase tracking-wider font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">Regra: {op.calculationRule}</span>
                      {op.groupSetup && <span className="text-[9px] uppercase tracking-wider font-bold text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">Setup Reaproveitado</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono font-bold text-foreground">{formatMinutes(opTime)}</span>
                    <button
                      type="button"
                      onClick={() => requestRemoveOP(op)}
                      disabled={deletingOrderId === op.id}
                      title={op.deletionSummary.total > 0 ? "Exclusão bloqueada: a OP possui apontamentos" : "Solicitar exclusão do rascunho"}
                      className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                    >
                      {op.deletionSummary.total > 0 ? <ShieldAlert className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )
            })}
            {orders.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-12">Nenhuma OP inserida na carteira de produção.</div>
            )}
          </CardContent>
        </Card>

        <Dialog open={blockedOrder !== null} onOpenChange={(open) => { if (!open) setBlockedOrder(null) }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <ShieldAlert className="h-5 w-5" /> Exclusão física bloqueada
              </DialogTitle>
              <DialogDescription className="text-left leading-relaxed">
                {blockedOrder?.decision.code === "OP_HAS_POINTINGS"
                  ? ORDER_WITH_POINTINGS_MESSAGE
                  : blockedOrder?.decision.message}
              </DialogDescription>
            </DialogHeader>
            {blockedOrder && (
              <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-4">
                <div><span className="text-muted-foreground">Apontamentos</span><strong className="block text-lg">{blockedOrder.order.deletionSummary.total}</strong></div>
                <div><span className="text-muted-foreground">Ativos</span><strong className="block text-lg">{blockedOrder.order.deletionSummary.active}</strong></div>
                <div><span className="text-muted-foreground">Pausados</span><strong className="block text-lg">{blockedOrder.order.deletionSummary.paused}</strong></div>
                <div><span className="text-muted-foreground">Finalizados</span><strong className="block text-lg">{blockedOrder.order.deletionSummary.finalized}</strong></div>
                <div><span className="text-muted-foreground">Estornados</span><strong className="block text-lg">{blockedOrder.order.deletionSummary.reversed}</strong></div>
                <div><span className="text-muted-foreground">Pausas</span><strong className="block text-lg">{blockedOrder.order.deletionSummary.pauses}</strong></div>
                <div><span className="text-muted-foreground">Refugo</span><strong className="block text-lg">{blockedOrder.order.deletionSummary.scraps}</strong></div>
                <div><span className="text-muted-foreground">Movimentos</span><strong className="block text-lg">{blockedOrder.order.deletionSummary.movements}</strong></div>
                <div className="col-span-2"><span className="text-muted-foreground">Primeiro apontamento</span><strong className="block">{formatDateTime(blockedOrder.order.deletionSummary.firstPointing)}</strong></div>
                <div className="col-span-2"><span className="text-muted-foreground">Último apontamento</span><strong className="block">{formatDateTime(blockedOrder.order.deletionSummary.lastPointing)}</strong></div>
                <div className="col-span-2"><span className="text-muted-foreground">Usuários</span><strong className="block break-words">{blockedOrder.order.deletionSummary.users.join(", ") || "—"}</strong></div>
                <div><span className="text-muted-foreground">Eventos</span><strong className="block">{blockedOrder.order.deletionSummary.events}</strong></div>
                <div><span className="text-muted-foreground">Usado no OEE</span><strong className="block">{blockedOrder.order.deletionSummary.usesOee ? "Sim" : "Não"}</strong></div>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBlockedOrder(null)}>Fechar</Button>
              {onOpenAudit && (
                <Button type="button" onClick={() => { setBlockedOrder(null); onOpenAudit() }}>
                  <ShieldAlert className="mr-2 h-4 w-4" /> Abrir auditoria
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={orderToDelete !== null} onOpenChange={(open) => { if (!open && !deletingOrderId) setOrderToDelete(null) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Excluir rascunho da OP {orderToDelete?.opNumber}?</DialogTitle>
              <DialogDescription className="text-left leading-relaxed">
                Esta ação só é permitida para rascunho nunca iniciado e sem apontamentos, pausas, movimentos, eventos ou quantidades produzidas. O banco fará uma nova validação transacional e registrará a auditoria.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="delete-op-reason">Motivo da exclusão</Label>
              <Input
                id="delete-op-reason"
                value={deleteReason}
                onChange={(event) => setDeleteReason(event.target.value)}
                placeholder="Informe ao menos 5 caracteres"
                disabled={Boolean(deletingOrderId)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={Boolean(deletingOrderId)} onClick={() => setOrderToDelete(null)}>Cancelar</Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deleteReason.trim().length < 5 || Boolean(deletingOrderId)}
                onClick={handleRemoveOP}
              >
                {deletingOrderId ? "Validando…" : "Confirmar exclusão do rascunho"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

    </div>
  )
}
