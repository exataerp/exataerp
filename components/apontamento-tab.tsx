"use client"

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { createPortal, flushSync } from "react-dom"
import { supabase } from "@/components/supabase"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/contexts/AuthContext"
import { podeIniciarMultiplosApontamentos } from "@/lib/permissions"
import { isPausaProgramada } from "@/components/relatorios-tab"
import { temPermissaoOverrideIntervalo } from "@/lib/scheduled-break-policy"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Play, Pause, Square, ClipboardList, CheckCircle2, Clock,
  Package, Factory, X, Wrench, Search, MapPin, UserRound, CalendarDays,
  Gauge, Layers3, ChevronRight, History, ShieldCheck
} from "lucide-react"

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface OrdemProducao {
  id: string
  numero_op: string
  produto_codigo: string
  produto_descricao?: string
  quantidade: number
  data_programacao: string
  status?: string
  quantidade_produzida?: number
  quantidade_aprovada?: number
  concluida_em?: string | null
}

interface Operacao {
  id: string
  nome: string
  maquina_id?: string
  ordem: number
}

interface Apontamento {
  id: string
  user_id?: string
  ordem_id: string
  operacao_id?: string
  operacao_nome?: string
  maquina_id?: string
  cronometro_inicio?: string | null
  cronometro_total_segundos: number
  pecas_produzidas: number
  pecas_refugo: number
  pecas_retrabalho: number
  status: string
  estado_operacao?: "em_execucao" | "pausada_manual" | "pausada_intervalo_programado" | "aguardando_retomada" | "finalizada"
  intervalo_programado_evento_id?: string | null
  encerramento?: string
  created_at: string
}

interface Grupo {
  id: string
  nome: string
  subgrupos: { id: string; nome: string }[]
}

interface SessaoAtiva {
  apontamentoId: string
  ordemId: string
  operacaoId: string
  operacaoNome: string
  maquinaId?: string
  maquinaNome: string
  inicioTimestamp: number
  // Horário oficial que identifica o trecho atual no banco. O relógio exibido
  // usa uma base local equivalente para não recuar por latência ou clock skew.
  inicioBancoTimestamp?: number
  segundosAcumulados: number
  // Preserva a precisao entre pausas. O campo em segundos permanece para
  // restaurar sessoes salvas por versoes anteriores da aplicacao.
  milissegundosAcumulados?: number
  pausaInicioTimestamp?: number
  pausaId?: string
  cicloPlanejadoSeg?: number
  estadoOperacao?: "em_execucao" | "pausada_manual" | "pausada_intervalo_programado" | "aguardando_retomada"
  intervaloNome?: string
  intervaloInicioTimestamp?: number
  intervaloFimTimestamp?: number
}

interface EventoOrdem {
  id: string
  apontamento_id?: string
  event_type: string
  event_category: string
  source: string
  started_at: string
  scheduled_end_at?: string
  ended_at?: string
  resumed_at?: string
  resumed_by?: string
  metadata?: { break_name?: string; action?: string; justification?: string }
}

const SESSAO_KEY = "exata_apontamento_sessao_"
const MILISSEGUNDOS_POR_SEGUNDO = 1000

function obterMilissegundosAcumulados(sessao: SessaoAtiva): number {
  const milissegundos = sessao.milissegundosAcumulados
  if (typeof milissegundos === "number" && Number.isFinite(milissegundos) && milissegundos >= 0) {
    return milissegundos
  }

  // Compatibilidade com sessoes que ja estavam armazenadas no navegador.
  return Math.max(0, Number(sessao.segundosAcumulados) || 0) * MILISSEGUNDOS_POR_SEGUNDO
}

function calcularMilissegundosDecorridos(sessao: SessaoAtiva, agora = Date.now()): number {
  const acumulados = obterMilissegundosAcumulados(sessao)
  if (sessao.pausaInicioTimestamp != null) return acumulados

  return acumulados + Math.max(0, agora - sessao.inicioTimestamp)
}

function calcularSegundosDecorridos(sessao: SessaoAtiva, agora = Date.now()): number {
  return Math.floor(calcularMilissegundosDecorridos(sessao, agora) / MILISSEGUNDOS_POR_SEGUNDO)
}

function lerSessoesLocais(empresaId: string): SessaoAtiva[] {
  if (typeof window === "undefined") return []

  const raw = localStorage.getItem(SESSAO_KEY + empresaId)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

function renderModalPortal(children: React.ReactNode) {
  if (typeof document === "undefined") return null

  return createPortal(children, document.body)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatarTempo(segundos: number): string {
  const h = Math.floor(segundos / 3600)
  const m = Math.floor((segundos % 3600) / 60)
  const s = segundos % 60
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

interface PostoTrabalho {
  id: string
  codigo: string
  nome: string
  setor?: string
  status: string
}

// ─── Modal de Pausa ───────────────────────────────────────────────────────────

function ModalPausa({ grupos, onConfirm, onCancel }: {
  grupos: Grupo[]
  onConfirm: (subgrupoId: string) => void
  onCancel: () => void
}) {
  const [subgrupoId, setSubgrupoId] = useState("")
  const grupoParadas = grupos.find(g =>
    g.nome
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim() === "paradas de maquina"
  )
  const motivos = grupoParadas?.subgrupos ?? []

  return renderModalPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">Motivo da Parada</h3>
          <button onClick={onCancel} className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Parada de máquina</label>
            <Select value={subgrupoId} onValueChange={setSubgrupoId}>
              <SelectTrigger className="w-full h-10 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all">
                <SelectValue placeholder="Selecione a parada" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {motivos.map(motivo => <SelectItem key={motivo.id} value={motivo.id}>{motivo.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {!grupoParadas && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs font-medium text-destructive">
              A lista de paradas de máquina não está disponível.
            </div>
          )}

          {subgrupoId && (() => {
            const sub = motivos.find(s => s.id === subgrupoId)
            const ehProgramada = isPausaProgramada(sub?.nome, grupoParadas?.nome)
            return (
              <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${ehProgramada ? "bg-blue-500/10 border-blue-500/20 text-blue-600 font-medium" : "bg-amber-500/10 border-amber-500/20 text-amber-600 font-medium"}`}>
                <Clock className="h-4 w-4 flex-shrink-0" />
                <span>
                  {ehProgramada
                    ? "Intervalo Programado (Almoço/Fim de Turno) — Não penaliza o OEE"
                    : "Parada Operacional Não Planejada — Registrada como tempo de máquina indisponível"}
                </span>
              </div>
            )
          })()}
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} className="flex-1 h-11 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:bg-muted transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => subgrupoId && onConfirm(subgrupoId)}
            disabled={!subgrupoId}
            className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50"
          >
            Pausar
          </button>
        </div>
      </div>
    </div>,
  )
}

// ─── Modal de Finalizar ────────────────────────────────────────────────────────

function ModalFinalizar({ onConfirm, onCancel, loading, maxProduzidas }: {
  onConfirm: (dados: { produzidas: number; refugo: number; retrabalho: number }) => void
  onCancel: () => void
  loading?: boolean
  maxProduzidas?: number
}) {
  const [boas, setBoas] = useState(maxProduzidas === 0 ? "0" : "")
  const [refugo, setRefugo] = useState("")
  const [retrabalho, setRetrabalho] = useState("")

  const quantidadeBoas = parseInt(boas) || 0
  const quantidadeRefugo = parseInt(refugo) || 0
  const quantidadeRetrabalho = parseInt(retrabalho) || 0
  const quantidadeProcessada = quantidadeBoas + quantidadeRefugo
  const excedePlanejado = maxProduzidas !== undefined && quantidadeProcessada > maxProduzidas
  const quantidadeInvalida = quantidadeBoas < 0 || quantidadeRefugo < 0 || quantidadeRetrabalho < 0
  const retrabalhoInvalido = quantidadeRetrabalho > quantidadeProcessada
  const podeConfirmarQuantidade = (quantidadeProcessada > 0 || maxProduzidas === 0)
    && !quantidadeInvalida
    && !retrabalhoInvalido
  const atingiuQuantidadePlanejada = maxProduzidas !== undefined && quantidadeProcessada === maxProduzidas
  const quantidadeRestante = maxProduzidas === undefined
    ? undefined
    : Math.max(0, maxProduzidas - quantidadeProcessada)

  const handleConfirm = () => {
    if (!podeConfirmarQuantidade || excedePlanejado) return
    onConfirm({
      // No banco, pecas_produzidas representa o total processado. A interface
      // separa as peças boas para evitar que o refugo fique fora do limite da OP.
      produzidas: quantidadeProcessada,
      refugo: quantidadeRefugo,
      retrabalho: quantidadeRetrabalho,
    })
  }

  return renderModalPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">Registrar Produção</h3>
          <button onClick={onCancel} className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Peças boas *</label>
            <input
              type="number" min="0" max={maxProduzidas} placeholder="Ex: 78"
              value={boas} onChange={e => setBoas(e.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Refugo</label>
              <input
                type="number" min="0" placeholder="0"
                value={refugo} onChange={e => setRefugo(e.target.value)}
                className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Retrabalho</label>
              <input
                type="number" min="0" placeholder="0"
                value={retrabalho} onChange={e => setRetrabalho(e.target.value)}
                className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
              />
              {retrabalhoInvalido && <p className="text-[10px] font-bold text-destructive">Não pode superar o total apontado.</p>}
            </div>
          </div>

          <div className={`rounded-xl border p-3 text-xs font-medium ${excedePlanejado || quantidadeInvalida
            ? "border-destructive/20 bg-destructive/5 text-destructive"
            : atingiuQuantidadePlanejada
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
              : "border-primary/20 bg-primary/5 text-foreground"
          }`}>
            {excedePlanejado
              ? `Boas + refugos não podem superar as ${maxProduzidas} peças restantes.`
              : quantidadeInvalida
                ? "As quantidades não podem ser negativas."
                : atingiuQuantidadePlanejada
                  ? `Total apontado: ${quantidadeProcessada}. O servidor validará todo o roteiro antes de encerrar a OP.`
                  : maxProduzidas !== undefined
                    ? `Total apontado: ${quantidadeProcessada}. Restarão ${quantidadeRestante} peças nesta operação.`
                    : `Total apontado: ${quantidadeProcessada} peças (boas + refugos).`}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} disabled={loading} className="flex-1 h-11 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!podeConfirmarQuantidade || excedePlanejado || loading}
            className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <span className="h-3.5 w-3.5 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />}
            {loading ? "Processando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>,
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function ApontamentoTab({ empresaAtivaId }: { empresaAtivaId?: string | null }) {
  const { toast } = useToast()
  const { session, supabaseUser } = useAuth()
  const podeIniciarMultiplos = podeIniciarMultiplosApontamentos(session?.roles || [])

  const [ordens, setOrdens] = useState<OrdemProducao[]>([])
  const [apontamentos, setApontamentos] = useState<Apontamento[]>([])
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [loading, setLoading] = useState(true)

  // Seleção de OP e operação
  const [ordemSelecionadaId, setOrdemSelecionadaId] = useState("")
  const [operacoes, setOperacoes] = useState<Operacao[]>([])
  const [operacaoSelecionadaId, setOperacaoSelecionadaId] = useState("")
  const [loadingOps, setLoadingOps] = useState(false)
  const [postos, setPostos] = useState<PostoTrabalho[]>([])
  const [postoSelecionadoId, setPostoSelecionadoId] = useState("")
  const [buscaOperacao, setBuscaOperacao] = useState("")
  const [buscaTrabalho, setBuscaTrabalho] = useState("")
  const [codigosDisponiveisNoPosto, setCodigosDisponiveisNoPosto] = useState<Set<string>>(new Set())
  const [loadingTrabalhos, setLoadingTrabalhos] = useState(false)

  // Sessões ativas (pode ter mais de uma rodando ao mesmo tempo, uma por operação/máquina)
  const [sessoes, setSessoes] = useState<SessaoAtiva[]>([])
  const [segundosMap, setSegundosMap] = useState<Record<string, number>>({})
  const [eventosOrdem, setEventosOrdem] = useState<EventoOrdem[]>([])
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // Modais (sessaoEmAcaoId identifica qual sessão da lista está sendo pausada/finalizada)
  const [sessaoEmAcaoId, setSessaoEmAcaoId] = useState<string | null>(null)
  const [showModalPausa, setShowModalPausa] = useState(false)
  const [showModalFinalizar, setShowModalFinalizar] = useState(false)
  const [finalizando, setFinalizando] = useState(false)
  const finalizandoRef = useRef(false)
  const [showOverrideIntervalo, setShowOverrideIntervalo] = useState(false)
  const [justificativaOverride, setJustificativaOverride] = useState("")
  const [acaoOverride, setAcaoOverride] = useState<"iniciar" | "retomar" | null>(null)
  const [processandoOverride, setProcessandoOverride] = useState(false)
  const [iniciandoApontamento, setIniciandoApontamento] = useState(false)
  const iniciandoApontamentoRef = useRef(false)
  const [retomandoApontamentoId, setRetomandoApontamentoId] = useState<string | null>(null)
  const transicaoCronometroRef = useRef(false)
  const versaoSessoesRef = useRef(0)
  const sincronizandoIntervaloRef = useRef(false)
  const erroSincronizacaoIntervaloRef = useRef(false)

  // ─── Carga inicial ─────────────────────────────────────────────────────────

  const [mapaDescricaoProdutos, setMapaDescricaoProdutos] = useState<Record<string, string>>({})

  const loadData = useCallback(async (silent = false) => {
    const versaoSessoesAoIniciar = versaoSessoesRef.current
    const sessoesLocais = lerSessoesLocais(empresaAtivaId!)
    if (!silent) setLoading(true)
    try {
      const [opsRes, apRes, gRes, postosRes] = await Promise.all([
        supabase.from("ordens_producao")
          .select("id, numero_op, produto_codigo, quantidade, data_programacao, status, quantidade_produzida, quantidade_aprovada, concluida_em")
          .eq("empresa_id", empresaAtivaId!)
          .order("data_programacao", { ascending: true }),
        supabase.from("apontamentos")
          .select("id, user_id, ordem_id, operacao_id, operacao_nome, maquina_id, cronometro_inicio, cronometro_total_segundos, pecas_produzidas, pecas_refugo, pecas_retrabalho, status, estado_operacao, intervalo_programado_evento_id, encerramento, created_at")
          .eq("empresa_id", empresaAtivaId!)
          .order("created_at", { ascending: false }),
        supabase.from("excecao_grupos")
          .select("id, nome")
          .eq("empresa_id", empresaAtivaId!)
          .eq("nome", "Paradas de Máquina")
          .order("nome"),
        supabase.rpc("meus_postos_trabalho"),
      ])

      const grupoParadasId = gRes.data?.[0]?.id
      const sRes = grupoParadasId
        ? await supabase.from("excecao_subgrupos")
            .select("id, grupo_id, nome")
            .eq("empresa_id", empresaAtivaId!)
            .eq("grupo_id", grupoParadasId)
            .order("nome")
        : { data: [], error: null }

      const codigosProdutos = Array.from(new Set(
        (opsRes.data || []).map((ordem: any) => ordem.produto_codigo).filter(Boolean)
      )) as string[]
      const prodRes = codigosProdutos.length > 0
        ? await supabase
            .from("produtos")
            .select("codigo, descricao")
            .eq("empresa_id", empresaAtivaId!)
            .in("codigo", codigosProdutos)
        : { data: [], error: null }

      if (opsRes.error) {
        console.error("Erro buscar OPs:", opsRes.error)
        toast({ title: "Falha ao buscar OPs", description: opsRes.error.message, variant: "destructive" })
      }
      
      if (apRes.error) {
        console.error("Erro buscar Apontamentos:", apRes.error)
        toast({ title: "Falha ao buscar Apontamentos", description: apRes.error.message, variant: "destructive" })
      }

      if (prodRes.error) {
        console.error("Erro buscar produtos das OPs:", prodRes.error)
        toast({ title: "Falha ao buscar produtos", description: prodRes.error.message, variant: "destructive" })
      }

      if (gRes.error || sRes.error) {
        const erroParadas = gRes.error || sRes.error
        console.error("Erro buscar paradas de máquina:", erroParadas)
        toast({ title: "Falha ao carregar paradas de máquina", description: erroParadas?.message, variant: "destructive" })
      }

      setOrdens((opsRes.data || []) as OrdemProducao[])
      setApontamentos((apRes.data || []) as Apontamento[])

      const mapaDesc: Record<string, string> = {}
      for (const p of (prodRes.data || []) as any[]) {
        if (p.descricao) mapaDesc[p.codigo] = p.descricao
      }
      setMapaDescricaoProdutos(mapaDesc)

      const gruposFormatados: Grupo[] = (gRes.data || []).map((g: any) => ({
        id: g.id,
        nome: g.nome,
        subgrupos: (sRes.data || []).filter((s: any) => s.grupo_id === g.id),
      }))
      setGrupos(gruposFormatados)
      const postosAtivos = (postosRes.data || []) as PostoTrabalho[]
      setPostos(postosAtivos)

      const apontamentosAtivos = ((apRes.data || []) as Apontamento[]).filter(apontamento =>
        apontamento.status === "em_andamento"
        && (!supabaseUser?.id || apontamento.user_id === supabaseUser.id),
      )
      const idsAtivos = apontamentosAtivos.map(apontamento => apontamento.id)
      const operacoesAtivasIds = apontamentosAtivos.map(apontamento => apontamento.operacao_id).filter(Boolean) as string[]

      if (idsAtivos.length > 0) {
        const [{ data: pausasAtivas }, { data: eventos }, { data: ciclos }] = await Promise.all([
          supabase
            .from("apontamento_pausas")
            .select("id, apontamento_id, inicio, fim, scheduled_event_id")
            .eq("empresa_id", empresaAtivaId!)
            .in("apontamento_id", idsAtivos)
            .order("inicio", { ascending: false }),
          supabase
            .from("production_order_events")
            .select("id, apontamento_id, event_type, event_category, source, started_at, scheduled_end_at, ended_at, resumed_at, resumed_by, metadata")
            .eq("tenant_id", empresaAtivaId!)
            .in("apontamento_id", idsAtivos)
            .order("started_at", { ascending: false }),
          operacoesAtivasIds.length > 0
            ? supabase.from("operacoes").select("id, tempo, unidade").in("id", operacoesAtivasIds)
            : Promise.resolve({ data: [] as any[] }),
        ])

        const eventosTipados = (eventos || []) as EventoOrdem[]
        setEventosOrdem(eventosTipados)
        const agora = Date.now()
        const sessoesBanco: SessaoAtiva[] = apontamentosAtivos.map(apontamento => {
          const estadoOperacao: SessaoAtiva["estadoOperacao"] = apontamento.estado_operacao === "finalizada"
            ? "em_execucao"
            : apontamento.estado_operacao || "em_execucao"
          const eventoIntervalo = eventosTipados.find(evento =>
            evento.id === apontamento.intervalo_programado_evento_id
          ) || eventosTipados.find(evento =>
            evento.apontamento_id === apontamento.id && evento.event_type === "scheduled_break"
          )
          const pausa = (pausasAtivas || []).find((item: any) =>
            item.apontamento_id === apontamento.id
            && (!item.fim || item.scheduled_event_id === apontamento.intervalo_programado_evento_id)
          ) as any
          const ciclo = (ciclos || []).find((item: any) => item.id === apontamento.operacao_id) as any
          const cicloPlanejadoSeg = ciclo
            ? Number(ciclo.tempo) * (ciclo.unidade === "minutes" ? 60 : ciclo.unidade === "hours" ? 3600 : 1)
            : undefined
          const estaRodando = estadoOperacao === "em_execucao" && !!apontamento.cronometro_inicio
          const inicioBancoTimestamp = estaRodando
            ? new Date(apontamento.cronometro_inicio!).getTime()
            : undefined
          const sessaoLocal = inicioBancoTimestamp == null
            ? undefined
            : sessoesLocais.find(sessao =>
                sessao.apontamentoId === apontamento.id
                && sessao.estadoOperacao === "em_execucao"
                && sessao.pausaInicioTimestamp == null
                && sessao.inicioBancoTimestamp === inicioBancoTimestamp,
              )
          const inicioTimestamp = sessaoLocal?.inicioTimestamp
            ?? (inicioBancoTimestamp != null ? Math.min(inicioBancoTimestamp, agora) : agora)
          const pausaInicio = estadoOperacao !== "em_execucao"
            ? new Date(eventoIntervalo?.started_at || pausa?.inicio || agora).getTime()
            : undefined
          const segundosAcumulados = sessaoLocal?.segundosAcumulados
            ?? apontamento.cronometro_total_segundos
            ?? 0
          const milissegundosAcumulados = sessaoLocal
            ? obterMilissegundosAcumulados(sessaoLocal)
            : segundosAcumulados * MILISSEGUNDOS_POR_SEGUNDO

          return {
            apontamentoId: apontamento.id,
            ordemId: apontamento.ordem_id,
            operacaoId: apontamento.operacao_id || "",
            operacaoNome: apontamento.operacao_nome || "Operação",
            maquinaId: apontamento.maquina_id,
            maquinaNome: postosAtivos.find(posto => posto.id === apontamento.maquina_id)?.nome || "Posto de trabalho",
            inicioTimestamp,
            inicioBancoTimestamp,
            segundosAcumulados,
            milissegundosAcumulados,
            pausaInicioTimestamp: pausaInicio,
            pausaId: pausa?.fim ? undefined : pausa?.id,
            cicloPlanejadoSeg,
            estadoOperacao,
            intervaloNome: eventoIntervalo?.metadata?.break_name,
            intervaloInicioTimestamp: eventoIntervalo ? new Date(eventoIntervalo.started_at).getTime() : undefined,
            intervaloFimTimestamp: eventoIntervalo?.scheduled_end_at ? new Date(eventoIntervalo.scheduled_end_at).getTime() : undefined,
          }
        })
        // Uma consulta iniciada antes do clique nao pode devolver a tela ao
        // estado antigo enquanto o inicio/retomada esta sendo confirmado.
        if (
          !transicaoCronometroRef.current
          && versaoSessoesAoIniciar === versaoSessoesRef.current
        ) {
          setSessoes(sessoesBanco)
        }
      } else {
        setEventosOrdem([])
        if (
          !transicaoCronometroRef.current
          && versaoSessoesAoIniciar === versaoSessoesRef.current
        ) {
          setSessoes([])
        }
      }

      const salvo = localStorage.getItem(`exata_posto_trabalho_${empresaAtivaId}`)
      if (salvo && postosAtivos.some((posto: PostoTrabalho) => posto.id === salvo)) {
        setPostoSelecionadoId(salvo)
      } else if (postosAtivos.length === 1) {
        setPostoSelecionadoId(postosAtivos[0].id)
      }
    } catch (err) {
      console.error("Erro critico na carga:", err)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [empresaAtivaId, toast, supabaseUser?.id])

  useEffect(() => {
    if (empresaAtivaId) {
      loadData()
      // Restaura sessões do localStorage (aceita formato antigo, um objeto único, por compatibilidade)
      const raw = localStorage.getItem(SESSAO_KEY + empresaAtivaId)
      if (raw) setSessoes(lerSessoesLocais(empresaAtivaId))
    }
  }, [empresaAtivaId, loadData])

  // O estado oficial fica no banco. A consulta periódica reflete a automação
  // mesmo quando outra tela ou o job do servidor alterou o apontamento.
  useEffect(() => {
    if (!empresaAtivaId) return
    const interval = window.setInterval(() => loadData(true), 10_000)
    const sincronizarAoVoltar = () => {
      if (document.visibilityState === "visible") loadData(true)
    }
    document.addEventListener("visibilitychange", sincronizarAoVoltar)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", sincronizarAoVoltar)
    }
  }, [empresaAtivaId, loadData])

  // O pg_cron continua sendo a garantia para telas fechadas. Enquanto o
  // operador está nesta tela, esta sincronização autenticada reduz a pausa
  // automática para poucos segundos e evita depender somente do job por minuto.
  const apontamentosAtivosKey = sessoes
    .map(sessao => sessao.apontamentoId)
    .filter(apontamentoId => !apontamentoId.startsWith("pendente-"))
    .join(",")
  useEffect(() => {
    if (!empresaAtivaId || !apontamentosAtivosKey) return

    const apontamentoIds = apontamentosAtivosKey.split(",")

    let cancelado = false
    const sincronizar = async () => {
      if (sincronizandoIntervaloRef.current || transicaoCronometroRef.current) return
      sincronizandoIntervaloRef.current = true

      try {
        const { data: sessaoAuth } = await supabase.auth.getSession()
        const accessToken = sessaoAuth.session?.access_token
        if (!accessToken) return

        const respostas = await Promise.all(apontamentoIds.map(async apontamentoId => {
          const resposta = await fetch("/api/apontamentos/sincronizar-intervalo", {
            method: "POST",
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              empresaId: empresaAtivaId,
              apontamentoId,
            }),
          })

          if (!resposta.ok) {
            return { apontamentoId, erro: await resposta.text(), resultado: null }
          }

          const resultado = await resposta.json() as {
            alterado?: boolean
            estado?: SessaoAtiva["estadoOperacao"]
            total_segundos?: number
            intervalo_inicio?: string
            intervalo_fim?: string
            intervalo_nome?: string
          } | null
          return { apontamentoId, erro: null, resultado }
        }))

        if (cancelado || transicaoCronometroRef.current) return

        const primeiraFalha = respostas.find(item => item.erro)
        if (primeiraFalha) {
          if (!erroSincronizacaoIntervaloRef.current) {
            console.error("Falha ao sincronizar intervalo programado:", primeiraFalha.erro)
            erroSincronizacaoIntervaloRef.current = true
          }
        } else {
          erroSincronizacaoIntervaloRef.current = false
        }

        const alteracoes = respostas.filter(item => item.resultado?.alterado)
        if (alteracoes.length === 0) return

        const alteracoesPorId = new Map(alteracoes.map(item => [item.apontamentoId, item.resultado!]))
        setSessoes(atuais => atuais.map(sessao => {
          const resultado = alteracoesPorId.get(sessao.apontamentoId)
          if (!resultado) return sessao
          const totalSegundos = Math.max(0, Number(resultado.total_segundos) || 0)
          const inicioIntervalo = resultado.intervalo_inicio
            ? new Date(resultado.intervalo_inicio).getTime()
            : sessao.pausaInicioTimestamp ?? Date.now()

          return {
            ...sessao,
            estadoOperacao: resultado.estado,
            segundosAcumulados: totalSegundos,
            milissegundosAcumulados: totalSegundos * MILISSEGUNDOS_POR_SEGUNDO,
            pausaInicioTimestamp: inicioIntervalo,
            intervaloNome: resultado.intervalo_nome ?? sessao.intervaloNome,
            intervaloInicioTimestamp: resultado.intervalo_inicio
              ? new Date(resultado.intervalo_inicio).getTime()
              : sessao.intervaloInicioTimestamp,
            intervaloFimTimestamp: resultado.intervalo_fim
              ? new Date(resultado.intervalo_fim).getTime()
              : sessao.intervaloFimTimestamp,
          }
        }))
        setSegundosMap(atual => {
          const atualizado = { ...atual }
          for (const item of alteracoes) {
            atualizado[item.apontamentoId] = Math.max(
              0,
              Number(item.resultado?.total_segundos) || 0,
            )
          }
          return atualizado
        })
        void loadData(true)
      } finally {
        sincronizandoIntervaloRef.current = false
      }
    }

    void sincronizar()
    const interval = window.setInterval(() => { void sincronizar() }, 5_000)
    const sincronizarAoVoltar = () => {
      if (document.visibilityState === "visible") void sincronizar()
    }
    window.addEventListener("focus", sincronizarAoVoltar)
    document.addEventListener("visibilitychange", sincronizarAoVoltar)

    return () => {
      cancelado = true
      window.clearInterval(interval)
      window.removeEventListener("focus", sincronizarAoVoltar)
      document.removeEventListener("visibilitychange", sincronizarAoVoltar)
    }
  }, [apontamentosAtivosKey, empresaAtivaId, loadData])

  // Cronômetro — atualiza o tempo decorrido de todas as sessões ativas a cada segundo
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (sessoes.length === 0) { setSegundosMap({}); return }

    const tick = () => {
      const agora = Date.now()
      const novo: Record<string, number> = {}
      for (const s of sessoes) {
        novo[s.apontamentoId] = calcularSegundosDecorridos(s, agora)
      }
      setSegundosMap(atual => {
        const ids = Object.keys(novo)
        const mudou = ids.length !== Object.keys(atual).length
          || ids.some(id => atual[id] !== novo[id])
        return mudou ? novo : atual
      })
    }

    const atualizarAoVoltarParaTela = () => {
      if (document.visibilityState === "visible") tick()
    }

    tick()
    // O intervalo so redesenha a tela. O tempo vem dos timestamps absolutos,
    // entao atrasos e throttling do navegador nao se acumulam no cronometro.
    intervalRef.current = setInterval(tick, 100)
    window.addEventListener("focus", tick)
    document.addEventListener("visibilitychange", atualizarAoVoltarParaTela)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      window.removeEventListener("focus", tick)
      document.removeEventListener("visibilitychange", atualizarAoVoltarParaTela)
    }
  }, [sessoes])

  const salvarSessoes = useCallback((s: SessaoAtiva[]) => {
    if (!empresaAtivaId) return
    if (s.length > 0) localStorage.setItem(SESSAO_KEY + empresaAtivaId, JSON.stringify(s))
    else localStorage.removeItem(SESSAO_KEY + empresaAtivaId)
    setSessoes(s)
  }, [empresaAtivaId])

  // Mantém a seleção visual sincronizada ao restaurar uma sessão ativa.
  useEffect(() => {
    // Administradores/PCP podem limpar a seleção para escolher outro trabalho;
    // as sessões abertas continuam disponíveis na lista lateral.
    if (podeIniciarMultiplos) return
    const sessao = sessoes[0]
    if (!sessao) return
    if (sessao.maquinaId) setPostoSelecionadoId(sessao.maquinaId)
    setOrdemSelecionadaId(sessao.ordemId)
    setOperacaoSelecionadaId(sessao.operacaoId)
  }, [podeIniciarMultiplos, sessoes])

  // Descobre quais produtos possuem ao menos uma operação liberada no posto.
  // A fila lateral passa a mostrar somente trabalhos que o operador pode iniciar.
  useEffect(() => {
    let cancelado = false

    const carregarTrabalhosDoPosto = async () => {
      if (!postoSelecionadoId || !empresaAtivaId) {
        setCodigosDisponiveisNoPosto(new Set())
        setLoadingTrabalhos(false)
        return
      }

      setLoadingTrabalhos(true)
      const codigos = new Set<string>()
      const tamanhoPagina = 1000

      for (let inicio = 0; ; inicio += tamanhoPagina) {
        const { data: vinculos, error: erroVinculos } = await supabase
          .from("operacao_postos_trabalho")
          .select("operacao:operacoes!operacao_postos_trabalho_operacao_id_fkey!inner(produto:produtos!operacoes_produto_id_fkey!inner(codigo))")
          .eq("empresa_id", empresaAtivaId)
          .eq("maquina_id", postoSelecionadoId)
          .eq("ativo", true)
          .order("operacao_id", { ascending: true })
          .range(inicio, inicio + tamanhoPagina - 1)

        if (cancelado) return
        if (erroVinculos) {
          setCodigosDisponiveisNoPosto(new Set())
          setLoadingTrabalhos(false)
          toast({ title: "Falha ao carregar trabalhos do posto", description: erroVinculos.message, variant: "destructive" })
          return
        }

        for (const vinculo of vinculos || []) {
          const codigo = (vinculo as any).operacao?.produto?.codigo
          if (codigo) codigos.add(codigo)
        }

        if ((vinculos || []).length < tamanhoPagina) break
      }

      setCodigosDisponiveisNoPosto(codigos)
      setLoadingTrabalhos(false)
    }

    carregarTrabalhosDoPosto()
    return () => { cancelado = true }
  }, [postoSelecionadoId, empresaAtivaId, toast])

  // ─── Carrega operações ao selecionar OP ────────────────────────────────────

  useEffect(() => {
    if (!ordemSelecionadaId || !postoSelecionadoId) { setOperacoes([]); setOperacaoSelecionadaId(""); return }
    const ordem = ordens.find(o => o.id === ordemSelecionadaId)
    if (!ordem) return
    setLoadingOps(true)

    supabase
      .from("produtos")
      .select("id")
      .eq("codigo", ordem.produto_codigo)
      .eq("empresa_id", empresaAtivaId!)
      .single()
      .then(({ data: prod }) => {
        if (!prod) { setOperacoes([]); setLoadingOps(false); return }
        supabase
          .from("operacao_postos_trabalho")
          .select("operacao_id, operacoes!operacao_postos_trabalho_operacao_id_fkey!inner(id, nome, maquina_id, ordem, produto_id)")
          .eq("empresa_id", empresaAtivaId!)
          .eq("maquina_id", postoSelecionadoId)
          .eq("ativo", true)
          .eq("operacoes.produto_id", prod.id)
          .order("ordem", { foreignTable: "operacoes" })
          .then(({ data: ops, error }) => {
            if (error) {
              toast({ title: "Falha ao carregar operações", description: error.message, variant: "destructive" })
              setOperacoes([])
              setLoadingOps(false)
              return
            }
            const formatted: Operacao[] = (ops || []).map((o: any) => ({
              id: o.operacoes.id,
              nome: o.operacoes.nome,
              maquina_id: o.operacoes.maquina_id,
              ordem: o.operacoes.ordem,
            }))
            setOperacoes(formatted)
            setOperacaoSelecionadaId((operacaoAtual) => {
              if (formatted.some(operacao => operacao.id === operacaoAtual)) return operacaoAtual
              return formatted.length === 1 ? formatted[0].id : ""
            })
            setLoadingOps(false)
          })
      })
  }, [ordemSelecionadaId, postoSelecionadoId, empresaAtivaId, ordens, toast])

  // ─── Iniciar ───────────────────────────────────────────────────────────────

  const podeSobrescreverIntervalo = temPermissaoOverrideIntervalo(session?.roles || [])

  const handleIniciar = async (
    operacaoId = operacaoSelecionadaId,
    overrideIntervalo = false,
    justificativa?: string,
  ) => {
    if (iniciandoApontamentoRef.current) return

    if (!ordemSelecionadaId || !operacaoId || !postoSelecionadoId) {
      toast({ title: "Selecione a OP e a operação", variant: "destructive" })
      return
    }

    const resumoSelecionado = resumos.find(r => r.op.id === ordemSelecionadaId)
    if (resumoSelecionado?.fechada || resumoSelecionado?.op.status === "encerrada") {
      toast({
        title: "OP Encerrada",
        description: "Não é possível iniciar apontamento em uma Ordem de Produção encerrada.",
        variant: "destructive",
      })
      return
    }

    const op = operacoes.find(o => o.id === operacaoId)
    if (!op) return

    const ordem = ordens.find(item => item.id === ordemSelecionadaId)
    const totalJaApontado = apontamentos
      .filter(apontamento => apontamento.ordem_id === ordemSelecionadaId && apontamento.operacao_id === operacaoId)
      .reduce((total, apontamento) => total + (apontamento.pecas_produzidas || 0), 0)
    if (ordem && totalJaApontado >= ordem.quantidade) {
      toast({
        title: "Quantidade planejada atingida",
        description: "Esta operação já teve todas as peças planejadas apontadas.",
        variant: "destructive",
      })
      return
    }

    if (sessoes.length > 0 && !podeIniciarMultiplos) {
      toast({ title: "Já existe um apontamento ativo", description: "Finalize o apontamento atual antes de iniciar outra operação.", variant: "destructive" })
      return
    }

    const inicioSolicitadoTimestamp = Date.now()
    const maquinaIdDefinitiva = postoSelecionadoId
    const sessaoPendente: SessaoAtiva = {
      apontamentoId: `pendente-${inicioSolicitadoTimestamp}`,
      ordemId: ordemSelecionadaId,
      operacaoId,
      operacaoNome: op.nome,
      maquinaId: maquinaIdDefinitiva ?? undefined,
      maquinaNome: postos.find(p => p.id === postoSelecionadoId)?.nome ?? "Posto de trabalho",
      inicioTimestamp: inicioSolicitadoTimestamp,
      inicioBancoTimestamp: undefined,
      segundosAcumulados: 0,
      milissegundosAcumulados: 0,
      estadoOperacao: "em_execucao",
    }
    const sessoesAntesDoInicio = sessoes

    const restaurarSessoesAnteriores = () => {
      setSessoes(sessoesAntesDoInicio)
      setSegundosMap(atual => {
        const atualizado = { ...atual }
        delete atualizado[sessaoPendente.apontamentoId]
        return atualizado
      })
    }

    iniciandoApontamentoRef.current = true
    transicaoCronometroRef.current = true
    versaoSessoesRef.current += 1
    // Confirma o primeiro render antes de iniciar as chamadas de rede. Assim o
    // painel e o 00:00 aparecem no mesmo clique, mesmo sob conexão lenta.
    flushSync(() => {
      setIniciandoApontamento(true)
      setSegundosMap(atual => ({ ...atual, [sessaoPendente.apontamentoId]: 0 }))
      setSessoes([...sessoesAntesDoInicio, sessaoPendente])
    })

    try {
      // A criação no banco e a busca do ciclo partem juntas. A sessão pendente
      // acima faz o cronômetro aparecer no mesmo clique, sem esperar a rede.
      const [opResult, inicioResult] = await Promise.all([
        supabase
          .from("operacoes")
          .select("tempo, unidade")
          .eq("id", operacaoId)
          .single(),
        supabase.rpc("iniciar_apontamento_no_posto", {
          p_empresa_id: empresaAtivaId,
          p_ordem_id: ordemSelecionadaId,
          p_operacao_id: operacaoId,
          p_maquina_id: postoSelecionadoId,
          p_override: overrideIntervalo,
          p_justificativa: justificativa || null,
        }),
      ])

      const { data, error } = inicioResult
      if (error) {
        restaurarSessoesAnteriores()
        const ehBloqueioIntervalo = error.message.includes("intervalo programado")
        if (ehBloqueioIntervalo && podeSobrescreverIntervalo && !overrideIntervalo) {
          setAcaoOverride("iniciar")
          setJustificativaOverride("")
          setShowOverrideIntervalo(true)
        }
        toast({
          title: ehBloqueioIntervalo ? "Intervalo programado em andamento" : "Erro ao iniciar",
          description: error.message,
          variant: "destructive",
        })
        return
      }

      const opDb = opResult.data
      const cicloPlanejadoSeg = opDb
        ? Number(opDb.tempo) * (opDb.unidade === "minutes" ? 60 : opDb.unidade === "hours" ? 3600 : 1)
        : undefined
      const confirmacaoTimestamp = Date.now()
      const milissegundosDesdeClique = Math.max(
        0,
        confirmacaoTimestamp - inicioSolicitadoTimestamp,
      )
      const inicioBancoTimestamp = data.cronometro_inicio
        ? new Date(data.cronometro_inicio).getTime()
        : undefined
      const novaSessao: SessaoAtiva = {
        ...sessaoPendente,
        apontamentoId: data.id,
        // Mantém a linha do tempo que começou no clique. Trocar diretamente
        // pelo horário do servidor fazia o relógio recuar ou congelar em zero.
        inicioTimestamp: confirmacaoTimestamp,
        inicioBancoTimestamp,
        segundosAcumulados: Math.floor(milissegundosDesdeClique / MILISSEGUNDOS_POR_SEGUNDO),
        milissegundosAcumulados: milissegundosDesdeClique,
        cicloPlanejadoSeg,
      }

      setApontamentos((atuais) => [data as Apontamento, ...atuais])
      setOrdens((atuais) => atuais.map((ordem) =>
        ordem.id === ordemSelecionadaId
          ? { ...ordem, status: "em_andamento" }
          : ordem,
      ))
      const sessoesAtualizadas = [...sessoesAntesDoInicio, novaSessao]
      setSegundosMap(atual => {
        const atualizado = { ...atual }
        delete atualizado[sessaoPendente.apontamentoId]
        atualizado[novaSessao.apontamentoId] = novaSessao.segundosAcumulados
        return atualizado
      })
      salvarSessoes(sessoesAtualizadas)
      setOrdemSelecionadaId(novaSessao.ordemId)
      setOperacaoSelecionadaId(novaSessao.operacaoId)
      toast({
        title: "Apontamento iniciado",
        description: op.nome,
      })
    } catch (error) {
      restaurarSessoesAnteriores()
      toast({
        title: "Erro ao iniciar",
        description: error instanceof Error ? error.message : "Não foi possível iniciar o apontamento.",
        variant: "destructive",
      })
    } finally {
      iniciandoApontamentoRef.current = false
      transicaoCronometroRef.current = false
      versaoSessoesRef.current += 1
      setIniciandoApontamento(false)
    }
  }

  // ─── Pausar ────────────────────────────────────────────────────────────────

  const [showSugestaoManutencao, setShowSugestaoManutencao] = useState(false)
  const [subgrupoParada, setSubgrupoParada] = useState<{ nome: string; grupo: string } | null>(null)

  const handleConfirmarPausa = async (subgrupoId: string) => {
    const sessao = sessoes.find(s => s.apontamentoId === sessaoEmAcaoId)
    if (!sessao) return
    setShowModalPausa(false)

    const { data: pausa, error } = await supabase.rpc("pausar_apontamento_manual", {
      p_empresa_id: empresaAtivaId,
      p_apontamento_id: sessao.apontamentoId,
      p_subgrupo_id: subgrupoId,
    })

    if (error) { toast({ title: "Erro ao registrar pausa", description: error.message, variant: "destructive" }); return }

    const agora = new Date((pausa as any).paused_at).getTime()
    const totalAtualSegundos = Number((pausa as any).total_seconds) || 0
    const totalAtualMs = totalAtualSegundos * MILISSEGUNDOS_POR_SEGUNDO

    const sessaoAtualizada: SessaoAtiva = {
      ...sessao,
      segundosAcumulados: totalAtualSegundos,
      milissegundosAcumulados: totalAtualMs,
      inicioTimestamp: agora,
      pausaInicioTimestamp: agora,
      pausaId: (pausa as any).pausa_id,
      estadoOperacao: "pausada_manual",
    }
    salvarSessoes(sessoes.map(s => s.apontamentoId === sessao.apontamentoId ? sessaoAtualizada : s))

    // Verifica se o motivo é de manutenção para sugerir OS
    const subgrupo = grupos.flatMap(g => g.subgrupos.map(s => ({ ...s, grupo: g.nome }))).find(s => s.id === subgrupoId)
    if (subgrupo) {
      const grupoLower = subgrupo.grupo.toLowerCase()
      const motivoLower = subgrupo.nome.toLowerCase()
      const ehManutencao = grupoLower.includes("manu") || motivoLower.includes("manu") ||
        motivoLower.includes("corretiva") || motivoLower.includes("preventiva") ||
        motivoLower.includes("quebra") || motivoLower.includes("falha")
      if (ehManutencao) {
        setSubgrupoParada({ nome: subgrupo.nome, grupo: subgrupo.grupo })
        setShowSugestaoManutencao(true)
        return
      }
    }

    toast({ title: "⏸ Em pausa" })
  }

  // ─── Retomar ───────────────────────────────────────────────────────────────

  const handleRetomar = async (
    apontamentoId: string,
    overrideIntervalo = false,
    justificativa?: string,
  ) => {
    if (transicaoCronometroRef.current) return false

    const sessao = sessoes.find(s => s.apontamentoId === apontamentoId)
    if (!sessao) return false

    const retomadaSolicitadaTimestamp = Date.now()
    const milissegundosAcumulados = obterMilissegundosAcumulados(sessao)
    const segundosAcumuladosOtimistas = Math.floor(
      milissegundosAcumulados / MILISSEGUNDOS_POR_SEGUNDO,
    )
    const sessaoOtimista: SessaoAtiva = {
      ...sessao,
      inicioTimestamp: retomadaSolicitadaTimestamp,
      segundosAcumulados: segundosAcumuladosOtimistas,
      milissegundosAcumulados,
      pausaInicioTimestamp: undefined,
      pausaId: undefined,
      estadoOperacao: "em_execucao",
      intervaloNome: undefined,
      intervaloInicioTimestamp: undefined,
      intervaloFimTimestamp: undefined,
    }

    transicaoCronometroRef.current = true
    versaoSessoesRef.current += 1
    // A retomada precisa ser visível no próprio clique. Sem o flush, o React
    // pode manter este lote pendente enquanto a RPC ainda está em andamento.
    flushSync(() => {
      setRetomandoApontamentoId(apontamentoId)
      setSessoes(atuais => atuais.map(item =>
        item.apontamentoId === apontamentoId ? sessaoOtimista : item,
      ))
      setSegundosMap(atual => ({
        ...atual,
        [apontamentoId]: segundosAcumuladosOtimistas,
      }))
    })

    const restaurarSessaoPausada = () => {
      setSessoes(atuais => atuais.map(item =>
        item.apontamentoId === apontamentoId ? sessao : item,
      ))
      setSegundosMap(atual => ({
        ...atual,
        [apontamentoId]: calcularSegundosDecorridos(sessao),
      }))
    }

    try {
      const { data, error } = await supabase.rpc("retomar_apontamento", {
        p_empresa_id: empresaAtivaId,
        p_apontamento_id: apontamentoId,
        p_override: overrideIntervalo,
        p_justificativa: justificativa || null,
      })

      if (error) {
        restaurarSessaoPausada()
        const ehBloqueioIntervalo = error.message.includes("intervalo programado")
        if (ehBloqueioIntervalo && podeSobrescreverIntervalo && !overrideIntervalo) {
          setSessaoEmAcaoId(apontamentoId)
          setAcaoOverride("retomar")
          setJustificativaOverride("")
          setShowOverrideIntervalo(true)
        }
        toast({
          title: ehBloqueioIntervalo ? "Retomada bloqueada durante o intervalo" : "Erro ao retomar a produção",
          description: error.message,
          variant: "destructive",
        })
        return false
      }

      const confirmacaoTimestamp = Date.now()
      const milissegundosDesdeClique = Math.max(
        0,
        confirmacaoTimestamp - retomadaSolicitadaTimestamp,
      )
      const retomadaBancoTimestamp = new Date((data as any).resumed_at).getTime()
      const inicioBancoTimestamp = Number.isFinite(retomadaBancoTimestamp)
        ? retomadaBancoTimestamp
        : undefined
      const totalRecebido = Number((data as any).total_seconds)
      const milissegundosAnteriores = Number.isFinite(totalRecebido)
        ? Math.max(milissegundosAcumulados, Math.max(0, totalRecebido) * MILISSEGUNDOS_POR_SEGUNDO)
        : milissegundosAcumulados
      const milissegundosConfirmados = milissegundosAnteriores + milissegundosDesdeClique
      const sessaoAtualizada: SessaoAtiva = {
        ...sessaoOtimista,
        // O servidor identifica oficialmente o trecho, mas o relógio visual
        // continua na base local iniciada no clique. Isso evita congelamento
        // quando há latência ou diferença entre os relógios cliente/servidor.
        inicioTimestamp: confirmacaoTimestamp,
        inicioBancoTimestamp,
        segundosAcumulados: Math.floor(milissegundosConfirmados / MILISSEGUNDOS_POR_SEGUNDO),
        milissegundosAcumulados: milissegundosConfirmados,
      }
      salvarSessoes(sessoes.map(s => s.apontamentoId === sessao.apontamentoId ? sessaoAtualizada : s))
      setShowOverrideIntervalo(false)
      setAcaoOverride(null)
      setJustificativaOverride("")
      toast({ title: "Produção retomada" })
      return true
    } catch (error) {
      restaurarSessaoPausada()
      toast({
        title: "Erro ao retomar a produção",
        description: error instanceof Error ? error.message : "Não foi possível retomar a operação.",
        variant: "destructive",
      })
      return false
    } finally {
      transicaoCronometroRef.current = false
      versaoSessoesRef.current += 1
      setRetomandoApontamentoId(null)
    }
  }

  const handleConfirmarOverride = async () => {
    if (justificativaOverride.trim().length < 5 || !acaoOverride) return
    const acao = acaoOverride
    const justificativa = justificativaOverride.trim()
    const apontamentoId = sessaoEmAcaoId
    setProcessandoOverride(true)
    // Fecha no clique; a tela principal ja mostra o cronometro otimista
    // enquanto o servidor registra a autorizacao.
    setShowOverrideIntervalo(false)
    setAcaoOverride(null)
    setJustificativaOverride("")
    try {
      if (acao === "iniciar") {
        await handleIniciar(operacaoSelecionadaId, true, justificativa)
      } else if (apontamentoId) {
        await handleRetomar(apontamentoId, true, justificativa)
      }
    } finally {
      setProcessandoOverride(false)
    }
  }

  // ─── Finalização transacional ──────────────────────────────────────────────

  const verificarEstoqueEFinalizar = async (dados: {
    produzidas: number; refugo: number; retrabalho: number
  }) => {
    const sessaoAtual = sessoes.find(s => s.apontamentoId === sessaoEmAcaoId)
    if (sessaoAtual?.estadoOperacao === "pausada_intervalo_programado" || sessaoAtual?.estadoOperacao === "aguardando_retomada") {
      toast({
        title: "Retome a operação antes de finalizar",
        description: "O intervalo programado fica preservado no histórico da OP.",
        variant: "destructive",
      })
      return
    }
    if (finalizandoRef.current) return // já tem uma finalização em andamento, ignora clique duplicado
    finalizandoRef.current = true
    setFinalizando(true)
    setShowModalFinalizar(false)
    await handleConfirmarFinalizar(dados)
  }

  const handleConfirmarFinalizar = async (dados: {
    produzidas: number; refugo: number; retrabalho: number
  }) => {
    const sessao = sessoes.find(s => s.apontamentoId === sessaoEmAcaoId)
    if (!sessao) { finalizandoRef.current = false; setFinalizando(false); return }
    setShowModalFinalizar(false)

    try {
      const totalSegundos = calcularSegundosDecorridos(sessao, Date.now())
      const ordem = ordens.find(o => o.id === sessao.ordemId)
      const { data, error } = await supabase.rpc("finalizar_apontamento_producao", {
        p_empresa_id: empresaAtivaId,
        p_apontamento_id: sessao.apontamentoId,
        p_quantidade_processada: dados.produzidas,
        p_quantidade_refugo: dados.refugo,
        p_quantidade_retrabalho: dados.retrabalho,
        p_cronometro_total_segundos: totalSegundos,
        p_observacao: ordem
          ? `OP ${ordem.numero_op} — finalização transacional do apontamento`
          : "Finalização transacional do apontamento",
      })

      if (error) {
        toast({ title: "Erro ao finalizar", description: error.message, variant: "destructive" })
        return
      }

      const resultado = (data || {}) as {
        operacao_status?: string
        op_status?: string
        quantidade_consolidada_op?: number
        operacoes_pendentes?: number
        apontamentos_ativos?: number
        avisos?: { insumo: string; consumo: number; disponivel: number }[]
      }

      salvarSessoes(sessoes.filter(s => s.apontamentoId !== sessao.apontamentoId))
      setSessaoEmAcaoId(null)
      await loadData()

      for (const aviso of resultado.avisos || []) {
        toast({
          title: `⚠ Estoque insuficiente: ${aviso.insumo}`,
          description: `Consumo: ${aviso.consumo} — Disponível: ${aviso.disponivel.toFixed(3)}. O saldo ficou negativo.`,
          variant: "destructive",
        })
      }

      if (resultado.op_status === "encerrada") {
        toast({
          title: "✅ OP concluída",
          description: `${resultado.quantidade_consolidada_op || 0} peça(s) aprovada(s) concluíram todo o roteiro.`,
        })
      } else if (resultado.operacao_status === "concluida") {
        const pendentes = resultado.operacoes_pendentes || 0
        toast({
          title: "✅ Operação concluída",
          description: `A OP continua em andamento. ${pendentes} operação(ões) ainda pendente(s).`,
        })
      } else {
        toast({
          title: "✅ Apontamento finalizado",
          description: "A operação permanece parcial e a OP continua em andamento.",
        })
      }
    } finally {
      finalizandoRef.current = false
      setFinalizando(false)
    }
  }

  // ─── Resumos por OP ────────────────────────────────────────────────────────

  const resumos = useMemo(() => {
    return ordens.map(op => {
      const aps = apontamentos.filter(a => a.ordem_id === op.id)
      // Quantidade aprovada consolidada pelo banco. Nunca somar as operações:
      // elas processam as mesmas unidades em etapas diferentes do roteiro.
      const totalProduzidas = Math.max(0, op.quantidade_aprovada || 0)

      const totalRefugo = aps.reduce((s, a) => s + (a.pecas_refugo || 0), 0)
      const totalRetrabalho = aps.reduce((s, a) => s + (a.pecas_retrabalho || 0), 0)
      const totalSegundos = aps.reduce((s, a) => s + (a.cronometro_total_segundos || 0), 0)
      const pct = op.quantidade > 0 ? Math.min(100, (totalProduzidas / op.quantidade) * 100) : 0
      const emAndamento = aps.some(a => a.status === "em_andamento")
      const temApontamento = aps.length > 0
      
      // Somente o status confirmado pelo backend/banco encerra a OP.
      const fechada = op.status === "encerrada"
      
      return {
        op,
        aps,
        totalProduzidas,
        totalRefugo,
        totalRetrabalho,
        totalSegundos,
        pct,
        fechada,
        emAndamento,
        temApontamento,
      }
    })
  }, [ordens, apontamentos])

  const ordemAtual = ordens.find(o => o.id === ordemSelecionadaId)

  const criarOSManutencao = async () => {
    const sessao = sessoes.find(s => s.apontamentoId === sessaoEmAcaoId)
    if (!sessao) return
    const maquinaId = sessao.maquinaId
    if (!maquinaId) {
      toast({ title: "⏸ Em pausa", description: "Máquina não identificada para abrir OS automaticamente." })
      setShowSugestaoManutencao(false)
      return
    }

    const { error } = await supabase.from("manutencao").insert({
      empresa_id: empresaAtivaId,
      maquina_id: maquinaId,
      tipo: "corretiva",
      status: "pendente",
      descricao: `Parada registrada no apontamento: ${subgrupoParada?.nome ?? "Manutenção"}`,
      data_abertura: new Date().toISOString().split("T")[0],
    })

    if (error) {
      toast({ title: "Erro ao criar OS", description: error.message, variant: "destructive" })
    } else {
      toast({ title: "⏸ Em pausa + OS aberta", description: "Ordem de manutenção criada automaticamente." })
    }
    setShowSugestaoManutencao(false)
    setSubgrupoParada(null)
  }

  const sessaoSelecionada = sessoes.find(sessao =>
    sessao.ordemId === ordemSelecionadaId
    && sessao.operacaoId === operacaoSelecionadaId,
  )
  const sessaoAtiva = podeIniciarMultiplos
    ? sessaoSelecionada ?? null
    : sessoes[0] ?? null
  const postoAtual = postos.find(posto => posto.id === postoSelecionadoId)
  const ordemEmExibicao = sessaoAtiva
    ? ordens.find(ordem => ordem.id === sessaoAtiva.ordemId)
    : ordemAtual
  const operacaoEmExibicao = sessaoAtiva
    ? operacoes.find(operacao => operacao.id === sessaoAtiva.operacaoId) ?? {
        id: sessaoAtiva.operacaoId,
        nome: sessaoAtiva.operacaoNome,
        ordem: 0,
      }
    : operacoes.find(operacao => operacao.id === operacaoSelecionadaId)
  const resumoEmExibicao = ordemEmExibicao
    ? resumos.find(resumo => resumo.op.id === ordemEmExibicao.id)
    : undefined

  const trabalhosDisponiveis = useMemo(() => {
    const termo = buscaTrabalho.trim().toLowerCase()
    return resumos
      .filter(resumo => {
        if (resumo.fechada) return false
        const temSessaoAtiva = sessoes.some(sessao => sessao.ordemId === resumo.op.id)
        if (!temSessaoAtiva && !codigosDisponiveisNoPosto.has(resumo.op.produto_codigo)) return false
        if (!termo) return true
        const descricao = mapaDescricaoProdutos[resumo.op.produto_codigo] || ""
        return [resumo.op.numero_op, resumo.op.produto_codigo, descricao]
          .some(valor => valor.toLowerCase().includes(termo))
      })
      .sort((a, b) => {
        const aTemSessao = sessoes.some(sessao => sessao.ordemId === a.op.id)
        const bTemSessao = sessoes.some(sessao => sessao.ordemId === b.op.id)
        if (aTemSessao !== bTemSessao) return aTemSessao ? -1 : 1
        return (a.op.data_programacao || "").localeCompare(b.op.data_programacao || "")
      })
  }, [resumos, buscaTrabalho, codigosDisponiveisNoPosto, mapaDescricaoProdutos, sessoes])

  const segundosAtivos = sessaoAtiva
    ? segundosMap[sessaoAtiva.apontamentoId] ?? sessaoAtiva.segundosAcumulados
    : 0
  const sessaoEmPausa = !!sessaoAtiva?.pausaInicioTimestamp
  const pausaIntervaloProgramado = sessaoAtiva?.estadoOperacao === "pausada_intervalo_programado"
  const aguardandoRetomada = sessaoAtiva?.estadoOperacao === "aguardando_retomada"
  const eventosSessaoAtiva = eventosOrdem.filter(evento => evento.apontamento_id === sessaoAtiva?.apontamentoId)
  const cicloAtivo = sessaoAtiva?.cicloPlanejadoSeg
  const ciclosCompletos = cicloAtivo && cicloAtivo > 0 ? Math.floor(segundosAtivos / cicloAtivo) : 0
  const tempoNoCicloAtual = cicloAtivo && cicloAtivo > 0
    ? segundosAtivos - ciclosCompletos * cicloAtivo
    : segundosAtivos
  const percentualCiclo = cicloAtivo && cicloAtivo > 0
    ? Math.min(100, (tempoNoCicloAtual / cicloAtivo) * 100)
    : 0
  const percentualRitmo = cicloAtivo && cicloAtivo > 0
    ? (tempoNoCicloAtual / cicloAtivo) * 100
    : null
  const ritmo = iniciandoApontamento
    ? { label: "Iniciando operação", detalhe: "Cronômetro iniciado", cor: "#22c55e", texto: "text-green-600" }
    : retomandoApontamentoId
      ? { label: "Retomando operação", detalhe: "Cronômetro retomado", cor: "#22c55e", texto: "text-green-600" }
    : pausaIntervaloProgramado
    ? { label: "Pausada — intervalo programado", detalhe: "Pausa automática do sistema", cor: "#f59e0b", texto: "text-amber-500" }
    : aguardandoRetomada
      ? { label: "Aguardando retomada", detalhe: "Confirmação do operador necessária", cor: "#3b82f6", texto: "text-blue-500" }
      : sessaoEmPausa
        ? { label: "Operação pausada", detalhe: "O cronômetro está interrompido", cor: "#f59e0b", texto: "text-amber-500" }
    : percentualRitmo === null
      ? { label: "Operação em andamento", detalhe: "Sem ciclo padrão cadastrado", cor: "hsl(var(--primary))", texto: "text-primary" }
      : percentualRitmo <= 90
        ? { label: "Dentro do ciclo", detalhe: `Ciclo estimado ${ciclosCompletos + 1}`, cor: "#22c55e", texto: "text-green-600" }
        : percentualRitmo <= 110
          ? { label: "No limite do ciclo", detalhe: `Ciclo estimado ${ciclosCompletos + 1}`, cor: "#f59e0b", texto: "text-amber-500" }
          : { label: "Tempo do ciclo excedido", detalhe: `Ciclo estimado ${ciclosCompletos + 1}`, cor: "#ef4444", texto: "text-destructive" }

  const hojeFormatado = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date())

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground text-xs font-bold uppercase tracking-widest animate-pulse">
        Carregando apontamentos...
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-12">

      {/* Modais */}
      {showOverrideIntervalo && renderModalPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-5 rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Exceção ao intervalo programado</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {acaoOverride === "iniciar"
                    ? "Você está autorizando o início de uma operação durante o intervalo."
                    : "Você está autorizando uma retomada antes do fim do intervalo."}
                  {" "}A ação ficará registrada no histórico da OP.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Justificativa obrigatória</label>
              <textarea
                value={justificativaOverride}
                onChange={event => setJustificativaOverride(event.target.value)}
                rows={3}
                autoFocus
                placeholder="Explique por que a exceção é necessária"
                className="w-full resize-none rounded-xl border border-border bg-input px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-[10px] text-muted-foreground">Mínimo de 5 caracteres.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setShowOverrideIntervalo(false); setAcaoOverride(null); setJustificativaOverride("") }}
                disabled={processandoOverride}
                className="h-11 flex-1 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarOverride}
                disabled={processandoOverride || justificativaOverride.trim().length < 5}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4" />
                {processandoOverride ? "Registrando..." : "Autorizar exceção"}
              </button>
            </div>
          </div>
        </div>,
      )}

      {/* Modal sugestão de OS de manutenção */}
      {showSugestaoManutencao && renderModalPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Wrench className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Abrir ordem de manutenção?</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  A parada foi registrada com o motivo <strong className="text-foreground">"{subgrupoParada?.nome}"</strong>. Deseja abrir uma OS corretiva automaticamente para esta máquina?
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowSugestaoManutencao(false); setSubgrupoParada(null); toast({ title: "⏸ Em pausa" }) }}
                className="flex-1 h-11 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:bg-muted transition-colors"
              >
                Não, só pausar
              </button>
              <button
                onClick={criarOSManutencao}
                className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-all"
              >
                Abrir OS
              </button>
            </div>
          </div>
        </div>,
      )}

      {showModalPausa && (
        <ModalPausa
          grupos={grupos}
          onConfirm={handleConfirmarPausa}
          onCancel={() => setShowModalPausa(false)}
        />
      )}
      {showModalFinalizar && (() => {
        const sessao = sessoes.find(s => s.apontamentoId === sessaoEmAcaoId)
        const ordem = sessao ? ordens.find(o => o.id === sessao.ordemId) : null
        const totalJaApontado = sessao
          ? apontamentos
              .filter(apontamento => apontamento.ordem_id === sessao.ordemId && apontamento.operacao_id === sessao.operacaoId && apontamento.id !== sessao.apontamentoId)
              .reduce((total, apontamento) => total + (apontamento.pecas_produzidas || 0), 0)
          : 0
        const maxProduzidas = ordem ? Math.max(0, ordem.quantidade - totalJaApontado) : undefined

        return (
          <ModalFinalizar
            onConfirm={verificarEstoqueEFinalizar}
            onCancel={() => setShowModalFinalizar(false)}
            loading={finalizando}
            maxProduzidas={maxProduzidas}
          />
        )
      })()}

      {/* Experiência operacional: posto -> trabalho -> operação -> execução */}
      <div className="mx-auto w-full max-w-[1480px] space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold capitalize text-muted-foreground">{hojeFormatado}</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-foreground sm:text-3xl">Apontamentos</h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserRound className="h-3.5 w-3.5" />
              {session?.user.nome || "Operador"}
            </p>
          </div>
          {sessoes.length > 0 && (
            <div className={"inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold " + (sessaoAtiva && sessaoEmPausa ? "border-amber-500/25 bg-amber-500/10 text-amber-600" : "border-green-500/25 bg-green-500/10 text-green-600")}>
              <span className={"h-2 w-2 rounded-full " + (sessaoAtiva && sessaoEmPausa ? "bg-amber-500" : "animate-pulse bg-green-500")} />
              {iniciandoApontamento
                ? "Confirmando início"
                : retomandoApontamentoId
                  ? "Confirmando retomada"
                  : podeIniciarMultiplos && sessoes.length > 1
                    ? `${sessoes.length} operações ativas`
                    : sessaoAtiva && sessaoEmPausa
                      ? "Operação pausada"
                      : "Operação em andamento"}
            </div>
          )}
        </header>

        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-0">
            <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Posto de trabalho</p>
                  <p className="mt-1 text-xs text-muted-foreground">Selecione onde a produção será registrada</p>
                </div>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                  <Factory className="h-5 w-5 text-primary" />
                </div>
              </div>

              {postos.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-4 text-xs text-muted-foreground">
                  Você ainda não possui um posto autorizado. Procure o administrador.
                </div>
              ) : (
                <Select
                  value={postoSelecionadoId}
                  onValueChange={(valor) => {
                    if (sessoes.length > 0 && !podeIniciarMultiplos) {
                      toast({ title: "Posto bloqueado", description: "Finalize o apontamento atual antes de trocar de posto.", variant: "destructive" })
                      return
                    }
                    setPostoSelecionadoId(valor)
                    setOrdemSelecionadaId("")
                    setOperacaoSelecionadaId("")
                    setBuscaTrabalho("")
                    localStorage.setItem("exata_posto_trabalho_" + empresaAtivaId, valor)
                  }}
                  disabled={sessoes.length > 0 && !podeIniciarMultiplos}
                >
                  <SelectTrigger className="h-14 w-full rounded-2xl border-border bg-muted/35 px-4 text-left text-sm font-bold text-foreground">
                    <SelectValue placeholder="Selecione seu posto" />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-card">
                    {postos.map(posto => (
                      <SelectItem key={posto.id} value={posto.id}>
                        {posto.codigo} — {posto.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {postoAtual && (
                <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-primary" />
                    {postoAtual.setor || "Posto selecionado"}
                  </span>
                  <span className="rounded-full bg-green-500/10 px-2 py-0.5 font-bold text-green-600">Ativo</span>
                </div>
              )}
            </section>

            {podeIniciarMultiplos && sessoes.length > 0 && (
              <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:p-5">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Operações ativas</p>
                    <p className="mt-1 text-xs text-muted-foreground">Selecione uma operação para acompanhar ou finalizar</p>
                  </div>
                  <span className="rounded-full bg-green-500/10 px-2.5 py-1 text-[10px] font-black text-green-600">
                    {sessoes.length}
                  </span>
                </div>
                <div className="space-y-2 p-3">
                  {sessoes.map(sessao => {
                    const selecionada = sessaoAtiva?.apontamentoId === sessao.apontamentoId
                    const ordemSessao = ordens.find(ordem => ordem.id === sessao.ordemId)
                    const postoSessao = postos.find(posto => posto.id === sessao.maquinaId)
                    const pausada = !!sessao.pausaInicioTimestamp

                    return (
                      <button
                        key={sessao.apontamentoId}
                        type="button"
                        onClick={() => {
                          if (sessao.maquinaId) setPostoSelecionadoId(sessao.maquinaId)
                          setOrdemSelecionadaId(sessao.ordemId)
                          setOperacaoSelecionadaId(sessao.operacaoId)
                          setBuscaOperacao("")
                        }}
                        className={"w-full rounded-2xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " + (selecionada ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/45")}
                      >
                        <div className="flex items-center gap-3">
                          <span className={"h-2.5 w-2.5 shrink-0 rounded-full " + (pausada ? "bg-amber-500" : "animate-pulse bg-green-500")} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-black text-foreground">{sessao.operacaoNome}</p>
                            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                              {ordemSessao?.numero_op || "OP"} · {postoSessao?.codigo || sessao.maquinaNome}
                            </p>
                          </div>
                          <span className="text-xs font-black tabular-nums text-foreground">
                            {formatarTempo(segundosMap[sessao.apontamentoId] ?? sessao.segundosAcumulados)}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}

            <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
              <div className="border-b border-border p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Trabalhos liberados</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {postoAtual ? "OPs com operações disponíveis neste posto" : "Selecione um posto para continuar"}
                    </p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black text-primary">
                    {trabalhosDisponiveis.length}
                  </span>
                </div>

                {postoAtual && (
                  <div className="relative mt-4">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={buscaTrabalho}
                      onChange={evento => setBuscaTrabalho(evento.target.value)}
                      placeholder="Buscar OP ou produto"
                      className="h-10 w-full rounded-xl border border-border bg-input pl-9 pr-3 text-xs text-foreground outline-none transition-all focus:ring-2 focus:ring-primary"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2.5 p-3 lg:max-h-[calc(100vh-20rem)] lg:min-h-[390px] lg:overflow-y-auto">
                {!postoAtual ? (
                  <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
                    <Factory className="h-8 w-8 text-muted-foreground/50" />
                    <p className="mt-3 text-sm font-bold text-foreground">Escolha seu posto</p>
                    <p className="mt-1 text-xs text-muted-foreground">A fila será filtrada pelas operações permitidas.</p>
                  </div>
                ) : loadingTrabalhos ? (
                  [0, 1, 2].map(item => <div key={item} className="h-28 animate-pulse rounded-2xl bg-muted" />)
                ) : trabalhosDisponiveis.length === 0 ? (
                  <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
                    <ClipboardList className="h-8 w-8 text-muted-foreground/50" />
                    <p className="mt-3 text-sm font-bold text-foreground">Nenhum trabalho liberado</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {buscaTrabalho ? "Tente buscar por outro código ou número de OP." : "Não há OP ativa compatível com este posto."}
                    </p>
                  </div>
                ) : (
                  trabalhosDisponiveis.map(resumo => {
                    const selecionado = ordemEmExibicao?.id === resumo.op.id
                    const emExecucao = sessoes.some(sessao => sessao.ordemId === resumo.op.id)
                    const descricao = mapaDescricaoProdutos[resumo.op.produto_codigo] || "Produto sem descrição"
                    const tituloOP = resumo.op.numero_op.toLowerCase().startsWith("op") ? resumo.op.numero_op : "OP " + resumo.op.numero_op

                    return (
                      <button
                        key={resumo.op.id}
                        type="button"
                        onClick={() => {
                          if (sessoes.length > 0 && !podeIniciarMultiplos && sessoes[0].ordemId !== resumo.op.id) {
                            toast({ title: "Operação em andamento", description: "Finalize o apontamento atual antes de selecionar outro trabalho.", variant: "destructive" })
                            return
                          }
                          const sessaoDoTrabalho = sessoes.find(sessao => sessao.ordemId === resumo.op.id)
                          if (sessaoDoTrabalho?.maquinaId) setPostoSelecionadoId(sessaoDoTrabalho.maquinaId)
                          setOrdemSelecionadaId(resumo.op.id)
                          setOperacaoSelecionadaId(sessaoDoTrabalho?.operacaoId || "")
                          setBuscaOperacao("")
                        }}
                        className={"group w-full rounded-2xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " + (selecionado ? "border-primary bg-primary/5 shadow-sm shadow-primary/10" : "border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/45")}
                      >
                        <div className="flex items-center gap-3">
                          <div className={"flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border " + (selecionado ? "border-primary/20 bg-primary/10" : "border-border bg-card")}>
                            <Package className={"h-7 w-7 " + (selecionado ? "text-primary" : "text-muted-foreground")} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-black uppercase text-primary">{tituloOP}</span>
                              {emExecucao && <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" title="Em execução" />}
                            </div>
                            <p className="mt-1.5 text-sm font-black text-primary">{resumo.op.produto_codigo}</p>
                            <p className="truncate text-xs font-semibold text-foreground" title={descricao}>{descricao}</p>
                            <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span>{resumo.op.quantidade} peças</span>
                              <span>·</span>
                              <span>{resumo.op.data_programacao?.split("-").reverse().join("/")}</span>
                            </div>
                          </div>
                          <ChevronRight className={"h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 " + (selecionado ? "text-primary" : "text-muted-foreground")} />
                        </div>
                        {resumo.pct > 0 && (
                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary transition-all" style={{ width: Math.min(100, resumo.pct) + "%" }} />
                          </div>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </section>
          </aside>

          <main className="min-w-0 space-y-5">
            {!postoAtual ? (
              <section className="flex min-h-[560px] flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/60 px-6 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10">
                  <Factory className="h-9 w-9 text-primary" />
                </div>
                <h3 className="mt-5 text-xl font-black text-foreground">Selecione um posto de trabalho</h3>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">A Exata exibirá apenas as OPs e operações autorizadas para o posto escolhido.</p>
              </section>
            ) : !ordemEmExibicao ? (
              <section className="flex min-h-[560px] flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/60 px-6 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10">
                  <ClipboardList className="h-9 w-9 text-primary" />
                </div>
                <h3 className="mt-5 text-xl font-black text-foreground">Escolha um trabalho da fila</h3>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">Selecione uma OP à esquerda para visualizar o produto e iniciar uma das operações disponíveis.</p>
              </section>
            ) : (
              <>
                <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
                  <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_220px]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Produto selecionado</p>
                        <span className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[10px] font-black text-foreground">
                          {ordemEmExibicao.numero_op.toLowerCase().startsWith("op") ? ordemEmExibicao.numero_op : "OP " + ordemEmExibicao.numero_op}
                        </span>
                      </div>
                      <p className="mt-5 text-2xl font-black tracking-tight text-primary sm:text-3xl">{ordemEmExibicao.produto_codigo}</p>
                      <h3 className="mt-1 text-2xl font-black leading-tight text-foreground sm:text-3xl">
                        {mapaDescricaoProdutos[ordemEmExibicao.produto_codigo] || "Produto sem descrição"}
                      </h3>

                      <div className="mt-6 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl bg-muted/40 p-3">
                          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"><Package className="h-3.5 w-3.5" /> Planejada</p>
                          <p className="mt-1 text-sm font-black text-foreground">{ordemEmExibicao.quantidade} peças</p>
                        </div>
                        <div className="rounded-2xl bg-muted/40 p-3">
                          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> Programada</p>
                          <p className="mt-1 text-sm font-black text-foreground">{ordemEmExibicao.data_programacao?.split("-").reverse().join("/")}</p>
                        </div>
                        <div className="rounded-2xl bg-muted/40 p-3">
                          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"><Gauge className="h-3.5 w-3.5" /> Progresso</p>
                          <p className="mt-1 text-sm font-black text-foreground">{(resumoEmExibicao?.pct || 0).toFixed(0)}%</p>
                        </div>
                      </div>
                    </div>

                    <div className="relative mx-auto flex aspect-square w-full max-w-[220px] items-center justify-center overflow-hidden rounded-[2rem] border border-border bg-gradient-to-br from-primary/15 via-muted/40 to-background">
                      <div className="absolute inset-5 rounded-[1.5rem] border border-primary/10 bg-card/50" />
                      <Package className="relative h-24 w-24 text-primary/65" strokeWidth={1.2} />
                      <span className="absolute bottom-5 rounded-full border border-border bg-card/90 px-3 py-1 text-[10px] font-black text-primary shadow-sm">
                        {ordemEmExibicao.produto_codigo}
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-border p-5 sm:p-7">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Operações disponíveis</p>
                        <p className="mt-1 text-xs text-muted-foreground">Escolha a etapa que será executada em {postoAtual.codigo}.</p>
                      </div>
                      {operacoes.length > 5 && (
                        <div className="relative w-full sm:w-56">
                          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <input
                            value={buscaOperacao}
                            onChange={evento => setBuscaOperacao(evento.target.value)}
                            placeholder="Buscar operação"
                            className="h-9 w-full rounded-xl border border-border bg-input pl-9 pr-3 text-xs text-foreground"
                          />
                        </div>
                      )}
                    </div>

                    {loadingOps ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="h-24 animate-pulse rounded-2xl bg-muted" />
                        <div className="h-24 animate-pulse rounded-2xl bg-muted" />
                      </div>
                    ) : operacoes.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
                        Nenhuma operação desta OP está liberada para o posto selecionado.
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {operacoes
                          .filter(operacao => operacao.nome.toLowerCase().includes(buscaOperacao.toLowerCase()))
                          .map(operacao => {
                            const selecionada = operacaoEmExibicao?.id === operacao.id
                            const sessaoDaOperacao = sessoes.find(sessao =>
                              sessao.ordemId === ordemEmExibicao.id
                              && sessao.operacaoId === operacao.id,
                            )
                            return (
                              <button
                                key={operacao.id}
                                type="button"
                                onClick={() => {
                                  if (sessaoAtiva && !podeIniciarMultiplos) return
                                  if (sessaoDaOperacao?.maquinaId) setPostoSelecionadoId(sessaoDaOperacao.maquinaId)
                                  setOperacaoSelecionadaId(operacao.id)
                                }}
                                disabled={!!sessaoAtiva && !podeIniciarMultiplos}
                                className={"flex min-h-24 items-center gap-3 rounded-2xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default " + (selecionada ? "border-primary bg-primary/5 shadow-sm shadow-primary/10" : "border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/45")}
                              >
                                <div className={"flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl " + (selecionada ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>
                                  <Layers3 className="h-5 w-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Etapa {operacao.ordem}</p>
                                  <p className="mt-1 text-sm font-black text-foreground">{operacao.nome}</p>
                                  <p className={"mt-1 text-[10px] font-bold " + (sessaoDaOperacao ? "text-green-600" : "text-primary")}>
                                    {sessaoDaOperacao ? "Em andamento" : selecionada ? "Selecionada" : "Disponível"}
                                  </p>
                                </div>
                                {sessaoDaOperacao
                                  ? <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-green-500" />
                                  : selecionada && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />}
                              </button>
                            )
                          })}
                      </div>
                    )}

                    {!sessaoAtiva && (sessoes.length === 0 || podeIniciarMultiplos) && (
                      <button
                        type="button"
                        onClick={() => operacaoSelecionadaId && handleIniciar(operacaoSelecionadaId)}
                        disabled={!operacaoSelecionadaId || loadingOps}
                        className="mt-5 flex min-h-24 w-full items-center justify-center gap-4 rounded-3xl bg-green-600 px-5 text-left text-white shadow-lg shadow-green-600/20 transition-all hover:bg-green-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
                      >
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-green-600 shadow-sm">
                          <Play className="h-6 w-6 fill-current" />
                        </span>
                        <span>
                          <span className="block text-xl font-black">{operacaoSelecionadaId ? "Iniciar operação" : "Selecione uma operação"}</span>
                          {!operacaoSelecionadaId && (
                            <span className="mt-1 block text-xs font-medium opacity-85">Escolha uma das etapas disponíveis acima</span>
                          )}
                        </span>
                      </button>
                    )}

                    {sessaoAtiva && (
                      <div className={`mt-5 flex items-center gap-3 rounded-2xl border px-4 py-3 ${sessaoEmPausa ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-400"}`}>
                        <span className={`h-2.5 w-2.5 rounded-full ${sessaoEmPausa ? "bg-amber-500" : "animate-pulse bg-green-500"}`} />
                        <div>
                          <p className="text-sm font-black">{sessaoAtiva.operacaoNome}</p>
                          <p className="text-[11px] font-medium opacity-80">
                            {sessaoEmPausa ? "A operação permanece aberta, com o tempo produtivo interrompido." : `A operação está sendo registrada em ${postoAtual.codigo}.`}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {sessaoAtiva && (
                  <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
                      <div>
                        <p className={"flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] " + ritmo.texto}>
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ritmo.cor }} />
                          {ritmo.label}
                        </p>
                        <h3 className="mt-2 text-2xl font-black text-foreground">{sessaoAtiva.operacaoNome}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {ordemEmExibicao.produto_codigo} · {mapaDescricaoProdutos[ordemEmExibicao.produto_codigo] || "Produto sem descrição"}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-muted/40 px-4 py-3 text-left sm:text-right">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Posto atual</p>
                        <p className="mt-1 text-sm font-black text-foreground">{postoAtual.codigo}</p>
                      </div>
                    </div>

                    <div className="p-5 sm:p-7">
                      <div className="mx-auto flex max-w-xl flex-col items-center">
                        <div
                          className="flex h-64 w-64 items-center justify-center rounded-full p-3 sm:h-72 sm:w-72"
                          style={{ background: "conic-gradient(" + ritmo.cor + " " + (cicloAtivo ? percentualCiclo : 100) + "%, hsl(var(--muted)) 0)" }}
                        >
                          <div className="flex h-full w-full flex-col items-center justify-center rounded-full border border-border bg-card text-center shadow-inner">
                            <Gauge className={"h-7 w-7 " + ritmo.texto} />
                            <p className={"mt-2 text-[10px] font-black uppercase tracking-[0.14em] " + ritmo.texto}>{ritmo.detalhe}</p>
                            <p className="mt-2 text-5xl font-black tabular-nums tracking-tight text-foreground sm:text-6xl">
                              {formatarTempo(segundosAtivos)}
                            </p>
                            <span className="mt-3 rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
                              {cicloAtivo ? "Ciclo padrão: " + formatarTempo(cicloAtivo) : "Tempo da operação"}
                            </span>
                          </div>
                        </div>

                        <div className="mt-6 grid w-full gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-border bg-muted/25 p-4">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Acabadas aprovadas na OP</p>
                            <p className="mt-1 text-lg font-black text-foreground">
                              {resumoEmExibicao?.totalProduzidas || 0} <span className="text-xs font-medium text-muted-foreground">de {ordemEmExibicao.quantidade} peças</span>
                            </p>
                          </div>
                          <div className="rounded-2xl border border-border bg-muted/25 p-4">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Orientação</p>
                            <p className="mt-1 text-sm font-black text-foreground">
                              {pausaIntervaloProgramado
                                ? "Aguarde o fim do intervalo"
                                : aguardandoRetomada
                                  ? "Confirme para voltar a produzir"
                                  : sessaoEmPausa
                                    ? "Retome quando estiver pronto"
                                    : cicloAtivo ? "Acompanhe o ciclo padrão" : "Registre qualquer interrupção"}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-border bg-muted/25 p-4">
                          <Clock className={"h-6 w-6 shrink-0 " + ritmo.texto} />
                          <div>
                            <p className="text-sm font-black text-foreground">
                              {pausaIntervaloProgramado
                                ? "Operação pausada automaticamente"
                                : aguardandoRetomada
                                  ? "Aguardando retomada"
                                  : sessaoEmPausa ? "Cronômetro em pausa" : "Tempo sendo registrado automaticamente"}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {pausaIntervaloProgramado && sessaoAtiva.intervaloInicioTimestamp && sessaoAtiva.intervaloFimTimestamp
                                ? `Operação pausada automaticamente devido ao intervalo programado das ${new Date(sessaoAtiva.intervaloInicioTimestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} às ${new Date(sessaoAtiva.intervaloFimTimestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`
                                : aguardandoRetomada
                                  ? "O intervalo terminou. O tempo só voltará a contar após sua confirmação."
                                  : sessaoEmPausa ? "O período parado não será somado ao tempo produtivo." : "Use Pausar para registrar falhas ou manutenção."}
                            </p>
                          </div>
                        </div>

                        <div className="mt-5 grid w-full gap-3 sm:grid-cols-2">
                          {sessaoEmPausa ? (
                            <button
                              type="button"
                              disabled={
                                retomandoApontamentoId === sessaoAtiva.apontamentoId
                                || (pausaIntervaloProgramado && !podeSobrescreverIntervalo)
                              }
                              onClick={() => {
                                setSessaoEmAcaoId(sessaoAtiva.apontamentoId)
                                if (pausaIntervaloProgramado && podeSobrescreverIntervalo) {
                                  setAcaoOverride("retomar")
                                  setJustificativaOverride("")
                                  setShowOverrideIntervalo(true)
                                  return
                                }
                                void handleRetomar(sessaoAtiva.apontamentoId)
                              }}
                              className={`flex h-14 items-center justify-center gap-2 rounded-2xl text-sm font-black text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${pausaIntervaloProgramado && !podeSobrescreverIntervalo ? "bg-muted text-muted-foreground" : "bg-green-600 hover:bg-green-500"}`}
                            >
                              <Play className="h-5 w-5 fill-current" />
                              {retomandoApontamentoId === sessaoAtiva.apontamentoId
                                ? "Retomando..."
                                : pausaIntervaloProgramado && podeSobrescreverIntervalo
                                  ? "Retomar com autorização"
                                  : "Retomar operação"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={iniciandoApontamento || !!retomandoApontamentoId}
                              onClick={() => {
                                if (iniciandoApontamento || retomandoApontamentoId) return
                                setSessaoEmAcaoId(sessaoAtiva.apontamentoId)
                                grupos.length > 0
                                  ? setShowModalPausa(true)
                                  : toast({ title: "Cadastre exceções primeiro", description: "Vá em Exceções e crie grupos de parada.", variant: "destructive" })
                              }}
                              className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-amber-500 text-sm font-black text-white transition-colors hover:bg-amber-400 disabled:cursor-wait disabled:opacity-40"
                            >
                              <Pause className="h-5 w-5" /> {iniciandoApontamento ? "Confirmando início..." : retomandoApontamentoId ? "Confirmando retomada..." : "Pausar operação"}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={iniciandoApontamento || !!retomandoApontamentoId || pausaIntervaloProgramado || aguardandoRetomada}
                            onClick={() => {
                              setSessaoEmAcaoId(sessaoAtiva.apontamentoId)
                              setShowModalFinalizar(true)
                            }}
                            className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 text-sm font-black text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Square className="h-5 w-5" /> Finalizar e registrar
                          </button>
                        </div>

                        {eventosSessaoAtiva.length > 0 && (
                          <div className="mt-5 w-full rounded-2xl border border-border bg-muted/20 p-4">
                            <div className="mb-3 flex items-center gap-2">
                              <History className="h-4 w-4 text-primary" />
                              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Histórico da OP</p>
                            </div>
                            <div className="space-y-2">
                              {eventosSessaoAtiva.slice(0, 6).map(evento => {
                                const ehIntervalo = evento.event_type === "scheduled_break"
                                const ehExcecao = evento.event_type === "scheduled_break_override"
                                return (
                                  <div key={evento.id} className={`flex items-start gap-3 rounded-xl border p-3 ${ehIntervalo ? "border-amber-500/20 bg-amber-500/5" : "border-primary/20 bg-primary/5"}`}>
                                    <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${ehIntervalo ? "bg-amber-500/10 text-amber-600" : "bg-primary/10 text-primary"}`}>
                                      {ehExcecao ? <ShieldCheck className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-xs font-bold text-foreground">
                                        {ehExcecao ? "Exceção autorizada" : evento.metadata?.break_name || "Intervalo programado"}
                                      </p>
                                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                                        {new Date(evento.started_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                        {evento.ended_at ? ` — ${new Date(evento.ended_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : " — em andamento"}
                                        {ehExcecao && evento.metadata?.justification ? ` · ${evento.metadata.justification}` : ""}
                                      </p>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                )}
              </>
            )}
          </main>
        </div>
      </div>

    </div>
  )
}
