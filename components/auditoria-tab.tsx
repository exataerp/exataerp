"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  FileSearch,
  Filter,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { AUDIT_PERMISSIONS, REVERSAL_REASONS, validateReversalReason } from "@/lib/audit"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"

interface AuditItem {
  id: string
  tenant_id: string
  tenant_nome: string
  lancamento_em: string
  updated_at: string
  tipo_lancamento: string
  modulo: string
  descricao: string
  usuario_nome: string
  operador_nome: string
  numero_op?: string | null
  produto_codigo?: string | null
  produto_descricao?: string | null
  operacao_nome?: string | null
  maquina_codigo?: string | null
  maquina_nome?: string | null
  quantidade_lancada: number
  quantidade_aprovada: number
  quantidade_refugada: number
  quantidade_retrabalho: number
  unidade_medida: string
  status_operacional: string
  status_atual: "ativo" | "estornado" | "corrigido" | "cancelado"
  origem: string
  estornado_em?: string | null
  estornado_por_nome?: string | null
  motivo_estorno_codigo?: string | null
  motivo_estorno_descricao?: string | null
  dados_legados: boolean
}

interface AuditDetails {
  geral: Record<string, any>
  valores: Record<string, any>
  relacionamentos: {
    ordem_producao?: Record<string, any> | null
    operacao?: Record<string, any> | null
    produto?: Record<string, any> | null
    maquina?: Record<string, any> | null
    movimentacoes_estoque: Record<string, any>[]
  }
  historico: Record<string, any>[]
  dependencias: {
    dados_legados: boolean
    vinculos_ausentes: string[]
    bloqueios_estoque: Record<string, any>[]
  }
}

interface Filters {
  inicio: string
  fim: string
  usuario: string
  operador: string
  modulo: string
  tipo: string
  status: string
  op: string
  produtoCodigo: string
  produtoDescricao: string
  operacao: string
  maquina: string
  posto: string
  search: string
}

const today = () => new Date().toISOString().slice(0, 10)

function thirtyDaysAgo() {
  const date = new Date()
  date.setDate(date.getDate() - 30)
  return date.toISOString().slice(0, 10)
}

const INITIAL_FILTERS: Filters = {
  inicio: thirtyDaysAgo(),
  fim: today(),
  usuario: "",
  operador: "",
  modulo: "producao",
  tipo: "apontamento_producao",
  status: "",
  op: "",
  produtoCodigo: "",
  produtoDescricao: "",
  operacao: "",
  maquina: "",
  posto: "",
  search: "",
}

const STATUS_STYLES: Record<string, string> = {
  ativo: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  estornado: "border-destructive/25 bg-destructive/10 text-destructive",
  corrigido: "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  cancelado: "border-muted-foreground/25 bg-muted text-muted-foreground",
}

const STATUS_LABELS: Record<string, string> = {
  ativo: "Ativo",
  estornado: "Estornado",
  corrigido: "Corrigido",
  cancelado: "Cancelado",
}

function formatDateTime(value?: string | null) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value))
}

function formatQuantity(value: unknown) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(Number(value || 0))
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function DetailValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-muted/20 px-3 py-2.5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 break-words text-xs font-semibold text-foreground">{value ?? "—"}</div>
    </div>
  )
}

export function AuditoriaTab({ empresaAtivaId }: { empresaAtivaId: string }) {
  const { session, hasPermission } = useAuth()
  const { toast } = useToast()
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [showFilters, setShowFilters] = useState(false)
  const [items, setItems] = useState<AuditItem[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [pagination, setPagination] = useState({ total: 0, total_pages: 0 })
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [details, setDetails] = useState<AuditDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [reverseOpen, setReverseOpen] = useState(false)
  const [reasonCode, setReasonCode] = useState("")
  const [reasonDescription, setReasonDescription] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [reversing, setReversing] = useState(false)
  const [exporting, setExporting] = useState(false)

  const canReverse = hasPermission(AUDIT_PERMISSIONS.REVERSE)
  const canExport = hasPermission(AUDIT_PERMISSIONS.EXPORT)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(filters.search.trim()), 350)
    return () => window.clearTimeout(timeout)
  }, [filters.search])

  const getAccessToken = useCallback(async () => {
    const { createClient } = await import("@/lib/supabase/client")
    const supabase = createClient()
    const { data } = await supabase.auth.getSession()
    if (!data.session?.access_token) throw new Error("Sessão expirada. Entre novamente.")
    return data.session.access_token
  }, [])

  const buildParams = useCallback((includePagination = true) => {
    const params = new URLSearchParams({ empresaId: empresaAtivaId })
    if (includePagination) {
      params.set("page", String(page))
      params.set("pageSize", String(pageSize))
    }
    const values: Record<string, string> = { ...filters, search: debouncedSearch }
    for (const [key, value] of Object.entries(values)) {
      if (!value) continue
      if (key === "inicio") params.set(key, new Date(`${value}T00:00:00`).toISOString())
      else if (key === "fim") params.set(key, new Date(`${value}T23:59:59.999`).toISOString())
      else params.set(key, value)
    }
    return params
  }, [debouncedSearch, empresaAtivaId, filters, page, pageSize])

  const loadEntries = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const token = await getAccessToken()
      const response = await fetch(`/api/auditoria?${buildParams().toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Falha ao carregar a auditoria.")
      setItems(body.items ?? [])
      setPagination(body.pagination ?? { total: 0, total_pages: 0 })
    } catch (error) {
      toast({
        title: "Falha ao carregar a auditoria",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [buildParams, getAccessToken, toast])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  const setFilter = (name: keyof Filters, value: string) => {
    setPage(1)
    setFilters(current => ({ ...current, [name]: value }))
  }

  const openDetails = async (id: string) => {
    setSelectedId(id)
    setDetails(null)
    setLoadingDetails(true)
    try {
      const token = await getAccessToken()
      const response = await fetch(`/api/auditoria/${id}?empresaId=${encodeURIComponent(empresaAtivaId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Falha ao carregar os detalhes.")
      setDetails(body)
    } catch (error) {
      toast({
        title: "Falha ao abrir o lançamento",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      })
      setSelectedId(null)
    } finally {
      setLoadingDetails(false)
    }
  }

  const exportEntries = async () => {
    setExporting(true)
    try {
      const token = await getAccessToken()
      const response = await fetch(`/api/auditoria/exportar?${buildParams(false).toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const body = await response.json()
        throw new Error(body.error || "Falha ao exportar.")
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `auditoria-${today()}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      const limit = Number(response.headers.get("x-export-limit") || 0)
      const exported = Number(response.headers.get("x-exported-records") || 0)
      toast({
        title: "Auditoria exportada",
        description: exported === limit
          ? `Foram exportados os ${limit} primeiros registros filtrados.`
          : `${exported} registro(s) exportado(s) em CSV.`,
      })
    } catch (error) {
      toast({
        title: "Falha na exportação",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      })
    } finally {
      setExporting(false)
    }
  }

  const submitReversal = async () => {
    if (!selectedId) return
    const reasonError = validateReversalReason(reasonCode, reasonDescription)
    if (reasonError || !confirmed) {
      toast({
        title: "Confirmação incompleta",
        description: reasonError || "Marque a confirmação final para continuar.",
        variant: "destructive",
      })
      return
    }

    setReversing(true)
    try {
      const token = await getAccessToken()
      const response = await fetch(`/api/auditoria/${selectedId}/estornar`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          empresaId: empresaAtivaId,
          motivoCodigo: reasonCode,
          motivoDescricao: reasonDescription,
          confirmacao: true,
          idempotencyKey: crypto.randomUUID(),
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.message || body.error || "Não foi possível estornar o lançamento.")

      toast({
        title: "Lançamento estornado com sucesso",
        description: body.message,
      })
      setReverseOpen(false)
      setReasonCode("")
      setReasonDescription("")
      setConfirmed(false)
      await Promise.all([loadEntries(true), openDetails(selectedId)])
    } catch (error) {
      toast({
        title: "Estorno não realizado",
        description: error instanceof Error ? error.message : "Consulte os bloqueios do lançamento.",
        variant: "destructive",
      })
    } finally {
      setReversing(false)
    }
  }

  const currentItem = useMemo(
    () => items.find(item => item.id === selectedId) ?? null,
    [items, selectedId],
  )
  const stockBlocks = details?.dependencias?.bloqueios_estoque ?? []
  const missingLinks = details?.dependencias?.vinculos_ausentes ?? []
  const reversalBlocked = Boolean(
    details?.dependencias?.dados_legados
    || stockBlocks.length > 0
    || missingLinks.length > 0
    || details?.geral?.status_atual === "estornado"
    || details?.geral?.status_operacional === "em_andamento",
  )

  if (!session || !hasPermission(AUDIT_PERMISSIONS.VIEW)) {
    return (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center">
        <ShieldCheck className="mx-auto h-8 w-8 text-destructive" />
        <h2 className="mt-3 text-base font-bold">Acesso negado</h2>
        <p className="mt-1 text-sm text-muted-foreground">A permissão auditoria.visualizar é necessária.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileSearch className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">Auditoria do Sistema</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Consulte lançamentos e execute estornos rastreáveis, transacionais e isolados por tenant.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadEntries()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
          {canExport && (
            <button
              type="button"
              onClick={exportEntries}
              disabled={exporting}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Exportar CSV
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Registros filtrados</p>
          <p className="mt-1 text-2xl font-black text-foreground">{formatQuantity(pagination.total)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Ativos nesta página</p>
          <p className="mt-1 text-2xl font-black text-emerald-600">{items.filter(item => item.status_atual === "ativo").length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Estornados nesta página</p>
          <p className="mt-1 text-2xl font-black text-destructive">{items.filter(item => item.status_atual === "estornado").length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tenant</p>
          <p className="mt-2 truncate text-sm font-bold text-foreground">{session.empresa.nome}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={filters.search}
              onChange={event => setFilter("search", event.target.value)}
              placeholder="Buscar por OP, produto, usuário, operador, ID ou motivo..."
              className="h-10 w-full rounded-xl border border-border bg-input pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex">
            <input
              type="date"
              value={filters.inicio}
              onChange={event => setFilter("inicio", event.target.value)}
              aria-label="Período inicial"
              className="h-10 rounded-xl border border-border bg-input px-3 text-xs outline-none focus:ring-2 focus:ring-primary"
            />
            <input
              type="date"
              value={filters.fim}
              onChange={event => setFilter("fim", event.target.value)}
              aria-label="Período final"
              className="h-10 rounded-xl border border-border bg-input px-3 text-xs outline-none focus:ring-2 focus:ring-primary"
            />
            <select
              value={filters.status}
              onChange={event => setFilter("status", event.target.value)}
              aria-label="Status"
              className="h-10 rounded-xl border border-border bg-input px-3 text-xs outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Todos os status</option>
              <option value="ativo">Ativos</option>
              <option value="estornado">Estornados</option>
              <option value="corrigido">Corrigidos</option>
              <option value="cancelado">Cancelados</option>
            </select>
            <button
              type="button"
              onClick={() => setShowFilters(value => !value)}
              className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-bold transition-colors ${showFilters ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
            >
              <Filter className="h-3.5 w-3.5" />
              Mais filtros
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <FilterField label="Usuário">
              <input value={filters.usuario} onChange={event => setFilter("usuario", event.target.value)} className="h-9 w-full rounded-lg border border-border bg-input px-3 text-xs" placeholder="Nome ou e-mail" />
            </FilterField>
            <FilterField label="Operador">
              <input value={filters.operador} onChange={event => setFilter("operador", event.target.value)} className="h-9 w-full rounded-lg border border-border bg-input px-3 text-xs" placeholder="Nome do operador" />
            </FilterField>
            <FilterField label="Módulo">
              <select value={filters.modulo} onChange={event => setFilter("modulo", event.target.value)} className="h-9 w-full rounded-lg border border-border bg-input px-3 text-xs">
                <option value="">Todos</option>
                <option value="producao">Produção</option>
              </select>
            </FilterField>
            <FilterField label="Tipo de lançamento">
              <select value={filters.tipo} onChange={event => setFilter("tipo", event.target.value)} className="h-9 w-full rounded-lg border border-border bg-input px-3 text-xs">
                <option value="">Todos</option>
                <option value="apontamento_producao">Apontamento de produção</option>
              </select>
            </FilterField>
            <FilterField label="Ordem de Produção">
              <input value={filters.op} onChange={event => setFilter("op", event.target.value)} className="h-9 w-full rounded-lg border border-border bg-input px-3 text-xs" placeholder="Código da OP" />
            </FilterField>
            <FilterField label="Código do produto">
              <input value={filters.produtoCodigo} onChange={event => setFilter("produtoCodigo", event.target.value)} className="h-9 w-full rounded-lg border border-border bg-input px-3 text-xs" placeholder="Código" />
            </FilterField>
            <FilterField label="Descrição do produto">
              <input value={filters.produtoDescricao} onChange={event => setFilter("produtoDescricao", event.target.value)} className="h-9 w-full rounded-lg border border-border bg-input px-3 text-xs" placeholder="Descrição" />
            </FilterField>
            <FilterField label="Operação">
              <input value={filters.operacao} onChange={event => setFilter("operacao", event.target.value)} className="h-9 w-full rounded-lg border border-border bg-input px-3 text-xs" placeholder="Nome da operação" />
            </FilterField>
            <FilterField label="Máquina">
              <input value={filters.maquina} onChange={event => setFilter("maquina", event.target.value)} className="h-9 w-full rounded-lg border border-border bg-input px-3 text-xs" placeholder="Código ou nome" />
            </FilterField>
            <FilterField label="Posto de trabalho">
              <input value={filters.posto} onChange={event => setFilter("posto", event.target.value)} className="h-9 w-full rounded-lg border border-border bg-input px-3 text-xs" placeholder="Código ou nome" />
            </FilterField>
            <div className="flex items-end sm:col-span-2">
              <button
                type="button"
                onClick={() => { setFilters(INITIAL_FILTERS); setPage(1) }}
                className="h-9 rounded-lg border border-border px-4 text-xs font-bold text-muted-foreground hover:bg-muted"
              >
                Limpar filtros
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left">
            <thead className="border-b border-border bg-muted/30">
              <tr className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Data e hora</th>
                <th className="px-4 py-3">Lançamento</th>
                <th className="px-4 py-3">Usuário / Operador</th>
                <th className="px-4 py-3">OP / Produto</th>
                <th className="px-4 py-3">Operação / Máquina</th>
                <th className="px-4 py-3 text-right">Quantidades</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && Array.from({ length: 6 }).map((_, index) => (
                <tr key={index}>
                  {Array.from({ length: 8 }).map((__, cell) => <td key={cell} className="px-4 py-4"><Skeleton className="h-5 w-full" /></td>)}
                </tr>
              ))}
              {!loading && items.map(item => (
                <tr key={item.id} className="text-xs transition-colors hover:bg-muted/20">
                  <td className="whitespace-nowrap px-4 py-3.5">
                    <p className="font-semibold text-foreground">{formatDateTime(item.lancamento_em)}</p>
                    <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{item.id.slice(0, 8)}…</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="font-semibold text-foreground">Apontamento de produção</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Módulo Produção · {item.origem}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="font-semibold text-foreground">{item.usuario_nome}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Operador: {item.operador_nome}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="font-semibold text-foreground">{item.numero_op || "Sem OP"}</p>
                    <p className="mt-0.5 max-w-48 truncate text-[10px] text-muted-foreground">{item.produto_codigo || "—"} · {item.produto_descricao || "Sem descrição"}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="max-w-44 truncate font-semibold text-foreground">{item.operacao_nome || "Não identificada"}</p>
                    <p className="mt-0.5 max-w-44 truncate text-[10px] text-muted-foreground">{[item.maquina_codigo, item.maquina_nome].filter(Boolean).join(" - ") || "Sem posto"}</p>
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums">
                    <p className="font-bold text-foreground">{formatQuantity(item.quantidade_lancada)} {item.unidade_medida}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{formatQuantity(item.quantidade_aprovada)} aprov. · {formatQuantity(item.quantidade_refugada)} ref.</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${STATUS_STYLES[item.status_atual] || STATUS_STYLES.cancelado}`}>
                      {STATUS_LABELS[item.status_atual] || item.status_atual}
                    </span>
                    {item.dados_legados && <p className="mt-1 text-[9px] font-bold text-amber-600">Dados legados</p>}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => openDetails(item.id)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[10px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Eye className="h-3.5 w-3.5" /> Detalhes
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center">
                    <FileSearch className="mx-auto h-8 w-8 text-muted-foreground/50" />
                    <p className="mt-3 text-sm font-bold text-foreground">Nenhum lançamento encontrado</p>
                    <p className="mt-1 text-xs text-muted-foreground">Ajuste o período ou os filtros de pesquisa.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{formatQuantity(pagination.total)} registro(s)</span>
            <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-8 rounded-lg border border-border bg-input px-2 text-xs">
              <option value={25}>25 por página</option>
              <option value={50}>50 por página</option>
              <option value={100}>100 por página</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page <= 1 || loading} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-24 text-center text-[11px] font-bold text-muted-foreground">Página {page} de {Math.max(pagination.total_pages, 1)}</span>
            <button type="button" onClick={() => setPage(value => value + 1)} disabled={page >= pagination.total_pages || loading} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(selectedId)} onOpenChange={open => { if (!open) { setSelectedId(null); setDetails(null) } }}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto p-0">
          <div className="sticky top-0 z-10 border-b border-border bg-card/95 px-6 py-5 backdrop-blur">
            <DialogHeader>
              <DialogTitle>Detalhes do lançamento</DialogTitle>
              <DialogDescription className="font-mono text-[10px]">{selectedId}</DialogDescription>
            </DialogHeader>
          </div>
          {loadingDetails && <div className="space-y-4 p-6">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-20 w-full rounded-xl" />)}</div>}
          {!loadingDetails && details && (
            <div className="space-y-6 p-6 pt-2">
              {(details.dependencias.dados_legados || missingLinks.length > 0 || stockBlocks.length > 0) && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200">
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <div>
                      <p className="font-bold">O estorno está bloqueado até que as dependências sejam resolvidas.</p>
                      {details.dependencias.dados_legados && <p className="mt-1">O lançamento é legado e não possui vínculos de estoque confiáveis.</p>}
                      {missingLinks.length > 0 && <p className="mt-1">Vínculos ausentes: {missingLinks.join(", ")}.</p>}
                      {stockBlocks.map(block => <p key={block.movimentacao_id} className="mt-1">Item {block.insumo_codigo}: saldo {formatQuantity(block.saldo_disponivel)}, necessário {formatQuantity(block.quantidade_necessaria)}.</p>)}
                    </div>
                  </div>
                </div>
              )}

              <section>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-foreground"><UserRound className="h-4 w-4 text-primary" /> Informações gerais</h3>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <DetailValue label="Módulo / Tipo" value={`${details.geral.modulo} · ${details.geral.tipo}`} />
                  <DetailValue label="Usuário / Operador" value={details.geral.usuario_nome} />
                  <DetailValue label="Data e hora" value={formatDateTime(details.geral.data_hora)} />
                  <DetailValue label="Status" value={STATUS_LABELS[details.geral.status_atual] || details.geral.status_atual} />
                  <DetailValue label="Empresa / Tenant" value={details.geral.tenant_nome} />
                  <DetailValue label="Origem" value={details.geral.origem} />
                  <DetailValue label="Última alteração" value={formatDateTime(details.geral.ultima_alteracao)} />
                  <DetailValue label="Estornado por" value={details.geral.estornado_por || "—"} />
                </div>
              </section>

              <section>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-foreground"><Boxes className="h-4 w-4 text-primary" /> Valores e relacionamentos</h3>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <DetailValue label="Quantidade lançada" value={formatQuantity(details.valores.quantidade_lancada)} />
                  <DetailValue label="Quantidade aprovada" value={formatQuantity(details.valores.quantidade_aprovada)} />
                  <DetailValue label="Quantidade refugadas" value={formatQuantity(details.valores.quantidade_refugada)} />
                  <DetailValue label="Tempo produtivo" value={`${formatQuantity(details.valores.tempo_produtivo_segundos)} s`} />
                  <DetailValue label="Ordem de Produção" value={details.relacionamentos.ordem_producao?.numero} />
                  <DetailValue label="Produto" value={details.relacionamentos.produto ? `${details.relacionamentos.produto.codigo} · ${details.relacionamentos.produto.descricao}` : "—"} />
                  <DetailValue label="Operação" value={details.relacionamentos.operacao?.nome} />
                  <DetailValue label="Máquina / Posto" value={details.relacionamentos.maquina ? `${details.relacionamentos.maquina.codigo} · ${details.relacionamentos.maquina.nome}` : "—"} />
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-foreground">Movimentações de estoque relacionadas</h3>
                <div className="overflow-hidden rounded-xl border border-border">
                  {details.relacionamentos.movimentacoes_estoque.length === 0 ? (
                    <p className="p-4 text-xs text-muted-foreground">Nenhuma movimentação rastreável vinculada.</p>
                  ) : details.relacionamentos.movimentacoes_estoque.map(movement => (
                    <div key={movement.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-border px-4 py-3 text-xs last:border-0">
                      <div>
                        <p className="font-bold text-foreground">{movement.insumo_codigo} · {movement.insumo_descricao}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{movement.tipo} · {movement.origem} · {formatDateTime(movement.created_at)}</p>
                      </div>
                      <p className="font-bold tabular-nums text-foreground">{formatQuantity(movement.quantidade)}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-foreground"><Clock3 className="h-4 w-4 text-primary" /> Histórico</h3>
                <div className="relative space-y-0 pl-4 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-border">
                  {details.historico.map((event, index) => (
                    <div key={`${event.action}-${event.occurred_at}-${index}`} className="relative pb-4 pl-4 last:pb-0">
                      <span className="absolute left-[-15px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
                      <p className="text-xs font-bold text-foreground">{event.action}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{formatDateTime(event.occurred_at)} · {event.performed_by || "Sistema"}</p>
                      {event.reason && <p className="mt-1 text-[11px] text-foreground">Motivo: {event.reason}</p>}
                    </div>
                  ))}
                </div>
              </section>

              <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                {canReverse && details.geral.status_atual !== "estornado" && (
                  <button
                    type="button"
                    onClick={() => setReverseOpen(true)}
                    disabled={reversalBlocked}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-destructive px-4 text-xs font-bold text-destructive-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <RotateCcw className="h-4 w-4" /> Excluir lançamento
                  </button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={reverseOpen} onOpenChange={open => { if (!reversing) setReverseOpen(open) }}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Excluir lançamento por estorno</DialogTitle>
            <DialogDescription>
              O registro original será preservado. Todos os efeitos rastreáveis serão revertidos na mesma transação.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/20 p-3 text-xs">
              <DetailValue label="Quantidade" value={`${formatQuantity(currentItem?.quantidade_lancada ?? details?.valores.quantidade_lancada)} un`} />
              <DetailValue label="Ordem de Produção" value={currentItem?.numero_op ?? details?.relacionamentos.ordem_producao?.numero} />
              <DetailValue label="Produto" value={currentItem?.produto_codigo ?? details?.relacionamentos.produto?.codigo} />
              <DetailValue label="Operação" value={currentItem?.operacao_nome ?? details?.relacionamentos.operacao?.nome} />
              <DetailValue label="Usuário" value={currentItem?.usuario_nome ?? details?.geral.usuario_nome} />
              <DetailValue label="Data e hora" value={formatDateTime(currentItem?.lancamento_em ?? details?.geral.data_hora)} />
            </div>

            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              <p className="flex items-start gap-2 font-bold"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> Estoque, OEE, produtividade, custos, relatórios, operação e OP poderão ser recalculados.</p>
              <p className="mt-1 pl-6">Movimentações de estoque serão compensadas por lançamentos inversos vinculados às originais.</p>
            </div>

            <FilterField label="Motivo da exclusão *">
              <select value={reasonCode} onChange={event => setReasonCode(event.target.value)} className="h-10 w-full rounded-xl border border-border bg-input px-3 text-sm">
                <option value="">Selecione um motivo</option>
                {REVERSAL_REASONS.map(reason => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
              </select>
            </FilterField>

            <FilterField label={reasonCode === "outro" ? "Descrição do motivo *" : "Observação complementar"}>
              <textarea value={reasonDescription} onChange={event => setReasonDescription(event.target.value)} rows={3} className="w-full resize-none rounded-xl border border-border bg-input p-3 text-sm outline-none focus:ring-2 focus:ring-primary" placeholder="Informe os detalhes necessários para a rastreabilidade..." />
            </FilterField>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 text-xs">
              <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
              <span className="font-semibold text-foreground">Confirmo que desejo estornar este lançamento e recalcular todos os dados relacionados.</span>
            </label>
          </div>

          <DialogFooter>
            <button type="button" onClick={() => setReverseOpen(false)} disabled={reversing} className="h-10 rounded-xl border border-border px-4 text-xs font-bold text-muted-foreground hover:bg-muted">Cancelar</button>
            <button type="button" onClick={submitReversal} disabled={reversing || !confirmed || !reasonCode} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-destructive px-4 text-xs font-bold text-destructive-foreground hover:opacity-90 disabled:opacity-40">
              {reversing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {reversing ? "Estornando..." : "Confirmar estorno"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
