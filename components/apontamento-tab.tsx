"use client"

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { supabase } from "@/components/supabase"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/contexts/AuthContext"
import { isPausaProgramada } from "@/components/relatorios-tab"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Play, Pause, Square, ClipboardList, AlertTriangle, CheckCircle2, Clock,
  Package, Factory, X, Wrench, Search, MapPin, UserRound, CalendarDays,
  Gauge, Layers3, ChevronRight
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
}

interface Operacao {
  id: string
  nome: string
  maquina_id?: string
  ordem: number
}

interface Apontamento {
  id: string
  ordem_id: string
  operacao_id?: string
  operacao_nome?: string
  cronometro_total_segundos: number
  pecas_produzidas: number
  pecas_refugo: number
  pecas_retrabalho: number
  status: string
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
  segundosAcumulados: number
  pausaInicioTimestamp?: number
  pausaId?: string
  cicloPlanejadoSeg?: number
}

const SESSAO_KEY = "exata_apontamento_sessao_"

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
  const [grupoId, setGrupoId] = useState("")
  const [subgrupoId, setSubgrupoId] = useState("")
  const grupo = grupos.find(g => g.id === grupoId)

  return (
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
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Grupo</label>
            <Select value={grupoId} onValueChange={(v) => { setGrupoId(v); setSubgrupoId("") }}>
              <SelectTrigger className="w-full h-10 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all">
                <SelectValue placeholder="Selecione o grupo" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {grupos.map(g => <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {grupo && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Motivo</label>
              <Select value={subgrupoId} onValueChange={setSubgrupoId}>
                <SelectTrigger className="w-full h-10 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all">
                  <SelectValue placeholder="Selecione o motivo" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {grupo.subgrupos.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {subgrupoId && (() => {
            const sub = grupo?.subgrupos.find(s => s.id === subgrupoId)
            const ehProgramada = isPausaProgramada(sub?.nome, grupo?.nome)
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
    </div>
  )
}

// ─── Modal de Finalizar ────────────────────────────────────────────────────────

function ModalFinalizar({ onConfirm, onCancel, loading, isUltimaEtapa, maxProduzidas }: {
  onConfirm: (dados: { produzidas: number; refugo: number; retrabalho: number; encerramento: "continuar" | "encerrar" | "encerrar_parcial" }) => void
  onCancel: () => void
  loading?: boolean
  isUltimaEtapa?: boolean
  maxProduzidas?: number
}) {
  const [produzidas, setProduzidas] = useState(maxProduzidas === 0 ? "0" : "")
  const [refugo, setRefugo] = useState("")
  const [retrabalho, setRetrabalho] = useState("")
  const [encerramento, setEncerramento] = useState<"continuar" | "encerrar" | "encerrar_parcial">("continuar")

  const quantidadeProduzida = parseInt(produzidas) || 0
  const quantidadeRefugo = parseInt(refugo) || 0
  const excedePlanejado = maxProduzidas !== undefined && quantidadeProduzida > maxProduzidas
  const refugoInvalido = quantidadeRefugo > quantidadeProduzida
  const podeConfirmarQuantidade = quantidadeProduzida > 0 || maxProduzidas === 0

  const handleConfirm = () => {
    if (!podeConfirmarQuantidade || excedePlanejado || refugoInvalido) return
    const atingiuMeta = isUltimaEtapa && maxProduzidas !== undefined && quantidadeProduzida === maxProduzidas
    onConfirm({
      produzidas: quantidadeProduzida,
      refugo: quantidadeRefugo,
      retrabalho: parseInt(retrabalho) || 0,
      encerramento: atingiuMeta ? "encerrar" : encerramento,
    })
  }

  return (
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
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Peças Produzidas *</label>
            <input
              type="number" min={maxProduzidas === 0 ? 0 : 1} max={maxProduzidas} placeholder="Ex: 120"
              value={produzidas} onChange={e => setProduzidas(e.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
            />
            {maxProduzidas !== undefined && (
              <p className={`text-[10px] ${excedePlanejado ? "font-bold text-destructive" : "text-muted-foreground"}`}>
                {excedePlanejado
                  ? `O máximo permitido neste apontamento é ${maxProduzidas} peça${maxProduzidas === 1 ? "" : "s"}.`
                  : `Quantidade restante nesta operação: ${maxProduzidas} peça${maxProduzidas === 1 ? "" : "s"}.`}
              </p>
            )}
            {isUltimaEtapa && maxProduzidas !== undefined && quantidadeProduzida === maxProduzidas && maxProduzidas > 0 && (
              <p className="text-[10px] font-bold text-emerald-600">
                Esta quantidade completa a meta e encerrará a OP automaticamente.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Refugo</label>
              <input
                type="number" min="0" placeholder="0"
                value={refugo} onChange={e => setRefugo(e.target.value)}
                className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
              />
              {refugoInvalido && <p className="text-[10px] font-bold text-destructive">Não pode superar a produção.</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Retrabalho</label>
              <input
                type="number" min="0" placeholder="0"
                value={retrabalho} onChange={e => setRetrabalho(e.target.value)}
                className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
              />
            </div>
          </div>

          <div className="space-y-1.5 pt-1">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Status desta Operação</label>
            <div className="space-y-2">
              {[
                { value: "continuar", label: "Salvar e Continuar Apontamento", desc: "Salva o tempo e peças produzidas, mantendo a operação aberta" },
                {
                  value: "encerrar",
                  label: isUltimaEtapa ? "Concluir Operação e Encerrar OP" : "Concluir esta Operação",
                  desc: isUltimaEtapa ? "Finaliza a última etapa do roteiro e encerra a OP no sistema" : "Finaliza esta etapa e libera a próxima operação do roteiro",
                },
                { value: "encerrar_parcial", label: "Concluir Operação Parcialmente", desc: "Encerra esta etapa com quantidade parcial sem encerrar a OP" },
              ].map(op => (
                <button
                  key={op.value}
                  onClick={() => setEncerramento(op.value as any)}
                  className={`w-full flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-all
                    ${encerramento === op.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                >
                  <div className={`h-4 w-4 rounded-full border-2 flex-shrink-0 mt-0.5 transition-all
                    ${encerramento === op.value ? "border-primary bg-primary" : "border-muted-foreground/30"}`} />
                  <div>
                    <p className={`text-sm font-bold ${encerramento === op.value ? "text-primary" : "text-foreground"}`}>{op.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{op.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} disabled={loading} className="flex-1 h-11 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!podeConfirmarQuantidade || excedePlanejado || refugoInvalido || loading}
            className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <span className="h-3.5 w-3.5 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />}
            {loading ? "Processando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function ApontamentoTab({ empresaAtivaId }: { empresaAtivaId?: string | null }) {
  const { toast } = useToast()
  const { session } = useAuth()

  const [ordens, setOrdens] = useState<OrdemProducao[]>([])
  const [apontamentos, setApontamentos] = useState<Apontamento[]>([])
  const [ultimaOperacaoPorProduto, setUltimaOperacaoPorProduto] = useState<Record<string, string>>({})
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
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // Modais (sessaoEmAcaoId identifica qual sessão da lista está sendo pausada/finalizada)
  const [sessaoEmAcaoId, setSessaoEmAcaoId] = useState<string | null>(null)
  const [showModalPausa, setShowModalPausa] = useState(false)
  const [showModalFinalizar, setShowModalFinalizar] = useState(false)
  const [finalizando, setFinalizando] = useState(false)
  const finalizandoRef = useRef(false)
  const [dadosFinalizar, setDadosFinalizar] = useState<{ produzidas: number; refugo: number; retrabalho: number; encerramento: "continuar" | "encerrar" | "encerrar_parcial" } | null>(null)
  const [showAvisoEstoque, setShowAvisoEstoque] = useState(false)
  const [avisoItens, setAvisoItens] = useState<{ codigo: string; descricao: string; disponivel: number; necessario: number; unidade: string }[]>([])

  // ─── Carga inicial ─────────────────────────────────────────────────────────

  const [mapaDescricaoProdutos, setMapaDescricaoProdutos] = useState<Record<string, string>>({})

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [opsRes, apRes, gRes, sRes, prodRes, postosRes] = await Promise.all([
        supabase.from("ordens_producao")
          .select("id, numero_op, produto_codigo, quantidade, data_programacao, status")
          .eq("empresa_id", empresaAtivaId!)
          .order("data_programacao", { ascending: true }),
        supabase.from("apontamentos")
          .select("id, ordem_id, operacao_id, operacao_nome, cronometro_total_segundos, pecas_produzidas, pecas_refugo, pecas_retrabalho, status, encerramento, created_at")
          .eq("empresa_id", empresaAtivaId!)
          .order("created_at", { ascending: false }),
        supabase.from("excecao_grupos").select("id, nome").eq("empresa_id", empresaAtivaId!).order("nome"),
        supabase.from("excecao_subgrupos").select("id, grupo_id, nome").eq("empresa_id", empresaAtivaId!).order("nome"),
        supabase.from("produtos").select("codigo, descricao, operacoes(id, ordem)").eq("empresa_id", empresaAtivaId!),
        supabase.rpc("meus_postos_trabalho"),
      ])

      if (opsRes.error) {
        console.error("Erro buscar OPs:", opsRes.error)
        toast({ title: "Falha ao buscar OPs", description: opsRes.error.message, variant: "destructive" })
      }
      
      if (apRes.error) {
        console.error("Erro buscar Apontamentos:", apRes.error)
        toast({ title: "Falha ao buscar Apontamentos", description: apRes.error.message, variant: "destructive" })
      }

      setOrdens((opsRes.data || []) as OrdemProducao[])
      setApontamentos((apRes.data || []) as Apontamento[])

      // Mapeia produto -> id da última operação do roteiro (a que entrega a peça pronta)
      const mapaUltimaOp: Record<string, string> = {}
      const mapaDesc: Record<string, string> = {}
      for (const p of (prodRes.data || []) as any[]) {
        if (p.descricao) mapaDesc[p.codigo] = p.descricao
        const opsRoteiro = (p.operacoes || []) as { id: string; ordem: number }[]
        if (opsRoteiro.length === 0) continue
        const ultima = opsRoteiro.reduce((a, b) => (b.ordem > a.ordem ? b : a))
        mapaUltimaOp[p.codigo] = ultima.id
      }
      setUltimaOperacaoPorProduto(mapaUltimaOp)
      setMapaDescricaoProdutos(mapaDesc)

      const gruposFormatados: Grupo[] = (gRes.data || []).map((g: any) => ({
        id: g.id,
        nome: g.nome,
        subgrupos: (sRes.data || []).filter((s: any) => s.grupo_id === g.id),
      }))
      setGrupos(gruposFormatados)
      const postosAtivos = (postosRes.data || []) as PostoTrabalho[]
      setPostos(postosAtivos)
      const salvo = localStorage.getItem(`exata_posto_trabalho_${empresaAtivaId}`)
      if (salvo && postosAtivos.some((posto: PostoTrabalho) => posto.id === salvo)) {
        setPostoSelecionadoId(salvo)
      } else if (postosAtivos.length === 1) {
        setPostoSelecionadoId(postosAtivos[0].id)
      }
    } catch (err) {
      console.error("Erro critico na carga:", err)
    } finally {
      setLoading(false)
    }
  }, [empresaAtivaId, toast])

  useEffect(() => {
    if (empresaAtivaId) {
      loadData()
      // Restaura sessões do localStorage (aceita formato antigo, um objeto único, por compatibilidade)
      const raw = localStorage.getItem(SESSAO_KEY + empresaAtivaId)
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          const lista: SessaoAtiva[] = Array.isArray(parsed) ? parsed : [parsed]
          setSessoes(lista)
        } catch { }
      }
    }
  }, [empresaAtivaId, loadData])

  // Cronômetro — atualiza o tempo decorrido de todas as sessões ativas a cada segundo
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (sessoes.length === 0) { setSegundosMap({}); return }

    const tick = () => {
      const agora = Date.now()
      const novo: Record<string, number> = {}
      for (const s of sessoes) {
        novo[s.apontamentoId] = s.pausaInicioTimestamp
          ? s.segundosAcumulados
          : s.segundosAcumulados + Math.floor((agora - s.inicioTimestamp) / 1000)
      }
      setSegundosMap(novo)
    }
    tick()
    intervalRef.current = setInterval(tick, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [sessoes])

  const salvarSessoes = useCallback((s: SessaoAtiva[]) => {
    if (!empresaAtivaId) return
    if (s.length > 0) localStorage.setItem(SESSAO_KEY + empresaAtivaId, JSON.stringify(s))
    else localStorage.removeItem(SESSAO_KEY + empresaAtivaId)
    setSessoes(s)
  }, [empresaAtivaId])

  // Mantém a seleção visual sincronizada ao restaurar uma sessão ativa.
  useEffect(() => {
    const sessao = sessoes[0]
    if (!sessao) return
    if (sessao.maquinaId) setPostoSelecionadoId(sessao.maquinaId)
    setOrdemSelecionadaId(sessao.ordemId)
    setOperacaoSelecionadaId(sessao.operacaoId)
  }, [sessoes])

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
      const { data: vinculos, error: erroVinculos } = await supabase
        .from("operacao_postos_trabalho")
        .select("operacoes!operacao_postos_trabalho_operacao_id_fkey!inner(produto_id)")
        .eq("empresa_id", empresaAtivaId)
        .eq("maquina_id", postoSelecionadoId)
        .eq("ativo", true)

      if (cancelado) return
      if (erroVinculos) {
        setCodigosDisponiveisNoPosto(new Set())
        setLoadingTrabalhos(false)
        toast({ title: "Falha ao carregar trabalhos do posto", description: erroVinculos.message, variant: "destructive" })
        return
      }

      const produtoIds = Array.from(new Set(
        (vinculos || [])
          .map((vinculo: any) => vinculo.operacoes?.produto_id)
          .filter(Boolean),
      )) as string[]

      if (produtoIds.length === 0) {
        setCodigosDisponiveisNoPosto(new Set())
        setLoadingTrabalhos(false)
        return
      }

      const { data: produtosDoPosto, error: erroProdutos } = await supabase
        .from("produtos")
        .select("codigo")
        .eq("empresa_id", empresaAtivaId)
        .in("id", produtoIds)

      if (cancelado) return
      if (erroProdutos) {
        setCodigosDisponiveisNoPosto(new Set())
        toast({ title: "Falha ao identificar produtos do posto", description: erroProdutos.message, variant: "destructive" })
      } else {
        setCodigosDisponiveisNoPosto(new Set((produtosDoPosto || []).map(produto => produto.codigo)))
      }
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

  const handleIniciar = async (operacaoId = operacaoSelecionadaId) => {
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

    if (sessoes.length > 0 || sessoes.some(s => s.operacaoId === operacaoId)) {
      toast({ title: "Já existe um apontamento ativo", description: "Finalize o apontamento atual antes de iniciar outra operação.", variant: "destructive" })
      return
    }

    // Busca tempo planejado e máquina da operação no banco
    const { data: opDb } = await supabase
      .from("operacoes")
      .select("tempo, unidade, maquina_id")
      .eq("id", operacaoId)
      .single()

    const cicloPlanejadoSeg = opDb
      ? (opDb.unidade === "minutes" ? opDb.tempo * 60 : opDb.tempo)
      : undefined

    const maquinaIdDefinitiva = postoSelecionadoId
    const { data, error } = await supabase.rpc("iniciar_apontamento_no_posto", {
      p_empresa_id: empresaAtivaId,
      p_ordem_id: ordemSelecionadaId,
      p_operacao_id: operacaoId,
      p_maquina_id: postoSelecionadoId,
    })

    if (error) { toast({ title: "Erro ao iniciar", description: error.message, variant: "destructive" }); return }

    const ordemAtualizada = { id: ordemSelecionadaId, status: "em_andamento" }

    const novaSessao: SessaoAtiva = {
      apontamentoId: data.id,
      ordemId: ordemSelecionadaId,
      operacaoId,
      operacaoNome: op.nome,
      maquinaId: maquinaIdDefinitiva ?? undefined,
      maquinaNome: postos.find(p => p.id === postoSelecionadoId)?.nome ?? "Posto de trabalho",
      inicioTimestamp: Date.now(),
      segundosAcumulados: 0,
      cicloPlanejadoSeg,
    }
    setApontamentos((atuais) => [data as Apontamento, ...atuais])
    if (ordemAtualizada) {
      setOrdens((atuais) => atuais.map((ordem) =>
        ordem.id === ordemSelecionadaId
          ? { ...ordem, status: ordemAtualizada.status }
          : ordem,
      ))
    }
    salvarSessoes([...sessoes, novaSessao])
    setOrdemSelecionadaId(novaSessao.ordemId)
    setOperacaoSelecionadaId(novaSessao.operacaoId)
    toast({
      title: "Apontamento iniciado",
      description: op.nome,
    })
  }

  // ─── Pausar ────────────────────────────────────────────────────────────────

  const [showSugestaoManutencao, setShowSugestaoManutencao] = useState(false)
  const [subgrupoParada, setSubgrupoParada] = useState<{ nome: string; grupo: string } | null>(null)

  const handleConfirmarPausa = async (subgrupoId: string) => {
    const sessao = sessoes.find(s => s.apontamentoId === sessaoEmAcaoId)
    if (!sessao) return
    setShowModalPausa(false)

    const agora = Date.now()
    const decorrido = Math.floor((agora - sessao.inicioTimestamp) / 1000)
    const totalAtual = sessao.segundosAcumulados + decorrido

    const { data: pausa, error } = await supabase
      .from("apontamento_pausas")
      .insert({
        empresa_id: empresaAtivaId,
        apontamento_id: sessao.apontamentoId,
        subgrupo_id: subgrupoId,
        inicio: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) { toast({ title: "Erro ao registrar pausa", variant: "destructive" }); return }

    const sessaoAtualizada: SessaoAtiva = {
      ...sessao,
      segundosAcumulados: totalAtual,
      inicioTimestamp: agora,
      pausaInicioTimestamp: agora,
      pausaId: pausa.id,
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

  const handleRetomar = async (apontamentoId: string) => {
    const sessao = sessoes.find(s => s.apontamentoId === apontamentoId)
    if (!sessao?.pausaId) return

    await supabase
      .from("apontamento_pausas")
      .update({ fim: new Date().toISOString() })
      .eq("id", sessao.pausaId)

    const sessaoAtualizada: SessaoAtiva = {
      ...sessao,
      inicioTimestamp: Date.now(),
      pausaInicioTimestamp: undefined,
      pausaId: undefined,
    }
    salvarSessoes(sessoes.map(s => s.apontamentoId === sessao.apontamentoId ? sessaoAtualizada : s))
    toast({ title: "▶ Produção retomada" })
  }

  // ─── Verificação de estoque antes de encerrar ──────────────────────────────

  const verificarEstoqueEFinalizar = async (dados: {
    produzidas: number; refugo: number; retrabalho: number
    encerramento: "continuar" | "encerrar" | "encerrar_parcial"
  }) => {
    if (finalizandoRef.current) return // já tem uma finalização em andamento, ignora clique duplicado
    finalizandoRef.current = true
    setFinalizando(true)

    const sessao = sessoes.find(s => s.apontamentoId === sessaoEmAcaoId)
    const ordem = ordens.find(o => o.id === sessao?.ordemId)
    if (!ordem) { setShowModalFinalizar(false); handleConfirmarFinalizar(dados); return }

    const ultimaOperacaoId = ultimaOperacaoPorProduto[ordem.produto_codigo]
    const isUltimaEtapa = !ultimaOperacaoId || sessao?.operacaoId === ultimaOperacaoId

    // Operações intermediárias não movimentam produto acabado nem consomem a BOM.
    if (!isUltimaEtapa) {
      setShowModalFinalizar(false)
      handleConfirmarFinalizar(dados)
      return
    }

    const pecasBoas = dados.produzidas - dados.refugo

    // Busca BOM
    const { data: bomData } = await supabase
      .from("bom_itens")
      .select("insumo_id, quantidade, unidade_medida, insumos(codigo, descricao)")
      .eq("empresa_id", empresaAtivaId!)
      .eq("produto_codigo", ordem.produto_codigo)

    if (!bomData || bomData.length === 0) {
      // Sem BOM, avisa e deixa encerrar
      toast({
        title: "⚠ BOM não cadastrada",
        description: `O produto ${ordem.produto_codigo} não tem lista de materiais. O estoque não será atualizado automaticamente.`,
        variant: "destructive",
      })
      setShowModalFinalizar(false)
      handleConfirmarFinalizar(dados)
      return
    }

    // Verifica saldo de cada insumo — uma única consulta em lote, não uma por item
    const insuficientes: typeof avisoItens = []
    const idsInsumos = (bomData as any[]).map(b => b.insumo_id)
    const { data: saldosAtuais } = await supabase
      .from("saldo_estoque")
      .select("insumo_id, saldo_atual")
      .eq("empresa_id", empresaAtivaId!)
      .in("insumo_id", idsInsumos)

    const saldoPorInsumo = new Map((saldosAtuais || []).map((s: any) => [s.insumo_id, s.saldo_atual]))

    for (const bom of bomData as any[]) {
      const necessario = bom.quantidade * pecasBoas
      const disponivel = saldoPorInsumo.get(bom.insumo_id) ?? 0
      if (disponivel < necessario) {
        insuficientes.push({
          codigo: bom.insumos?.codigo ?? "",
          descricao: bom.insumos?.descricao ?? "",
          disponivel,
          necessario,
          unidade: bom.unidade_medida,
        })
      }
    }

    if (insuficientes.length > 0) {
      setAvisoItens(insuficientes)
      setDadosFinalizar(dados)
      setShowModalFinalizar(false)
      setShowAvisoEstoque(true)
      finalizandoRef.current = false
      setFinalizando(false)
    } else {
      setShowModalFinalizar(false)
      handleConfirmarFinalizar(dados)
    }
  }

  const handleConfirmarFinalizar = async (dados: {
    produzidas: number; refugo: number; retrabalho: number
    encerramento: "continuar" | "encerrar" | "encerrar_parcial"
  }) => {
    const sessao = sessoes.find(s => s.apontamentoId === sessaoEmAcaoId)
    if (!sessao) { finalizandoRef.current = false; setFinalizando(false); return }
    setShowModalFinalizar(false)

    try {
      const emPausaAtual = !!sessao.pausaInicioTimestamp
    const agora = Date.now()
    const decorrido = emPausaAtual ? 0 : Math.floor((agora - sessao.inicioTimestamp) / 1000)
    const totalSegundos = sessao.segundosAcumulados + decorrido

    // Fecha pausa aberta se houver
    if (sessao.pausaId) {
      await supabase.from("apontamento_pausas").update({ fim: new Date().toISOString() }).eq("id", sessao.pausaId)
    }

    // Salva o apontamento
    const { error } = await supabase
      .from("apontamentos")
      .update({
        cronometro_total_segundos: totalSegundos,
        pecas_produzidas: dados.produzidas,
        pecas_refugo: dados.refugo,
        pecas_retrabalho: dados.retrabalho,
        status: dados.encerramento === "continuar" ? "aberto" : "fechado",
        encerramento: dados.encerramento,
        hora_fim: new Date().toTimeString().slice(0, 5),
      })
      .eq("id", sessao.apontamentoId)

    if (error) { toast({ title: "Erro ao finalizar", description: error.message, variant: "destructive" }); return }

    // ── Integração com estoque ao encerrar ──────────────────────────────────
    // Uma única chamada atômica no banco (função finalizar_apontamento_estoque),
    // em vez de várias idas e vindas sequenciais: mais rápido e sem risco de
    // corromper saldo quando várias sessões finalizam ao mesmo tempo.
    const ordem = ordens.find(o => o.id === sessao.ordemId)
    if (ordem) {
      const ultimaOperacaoId = ultimaOperacaoPorProduto[ordem.produto_codigo]
      const isUltimaEtapa = !ultimaOperacaoId || sessao.operacaoId === ultimaOperacaoId
      const pecasBoas = dados.produzidas - dados.refugo

      // Cada lote da última etapa movimenta seu próprio estoque, inclusive
      // quando o operador escolhe salvar para continuar em outro momento.
      if (isUltimaEtapa && pecasBoas > 0) {
        const { data: resultado, error: erroEstoque } = await supabase.rpc("finalizar_apontamento_estoque", {
          p_empresa_id: empresaAtivaId,
          p_apontamento_id: sessao.apontamentoId,
          p_ordem_id: sessao.ordemId,
          p_produto_codigo: ordem.produto_codigo,
          p_pecas_boas: pecasBoas,
          p_refugo: dados.refugo,
          p_observacao: `OP ${ordem.numero_op} — ${pecasBoas} peças boas (conclusão do roteiro)`,
        })

        if (erroEstoque) {
          toast({ title: "Erro ao baixar estoque", description: erroEstoque.message, variant: "destructive" })
          return
        }

        const avisos = (resultado as any)?.avisos as { insumo: string; consumo: number; disponivel: number }[] | undefined
        if (avisos && avisos.length > 0) {
          for (const a of avisos) {
            toast({
              title: `⚠ Estoque insuficiente: ${a.insumo}`,
              description: `Consumo: ${a.consumo} — Disponível: ${a.disponivel.toFixed(3)}. Saldo foi a negativo.`,
              variant: "destructive",
            })
          }
        }
      }
    }

    salvarSessoes(sessoes.filter(s => s.apontamentoId !== sessao.apontamentoId))
    setSessaoEmAcaoId(null)
    await loadData()

    const labels = { continuar: "Apontamento salvo", encerrar: "Operação finalizada", encerrar_parcial: "Operação finalizada parcialmente" }
      toast({ title: `✅ ${labels[dados.encerramento]}` })
    } finally {
      finalizandoRef.current = false
      setFinalizando(false)
    }
  }

  // ─── Resumos por OP ────────────────────────────────────────────────────────

  const resumos = useMemo(() => {
    return ordens.map(op => {
      const aps = apontamentos.filter(a => a.ordem_id === op.id)
      const ultimaOperacaoId = ultimaOperacaoPorProduto[op.produto_codigo]
      // Peças prontas da OP = as que passaram pela última etapa do roteiro,
      // não a soma de todas as etapas (senão a mesma peça conta 1x por operação)
      const apsUltimaEtapa = ultimaOperacaoId
        ? aps.filter(a => a.operacao_id === ultimaOperacaoId)
        : aps
      let totalProduzidas = apsUltimaEtapa.reduce((s, a) => s + (a.pecas_produzidas || 0), 0)
      
      // Fallback: se a filtragem por última etapa resultar em 0 peças mas existem apontamentos com peças produzidas na OP,
      // utiliza a soma geral dos apontamentos da OP para não zerar os indicadores de progresso.
      if (totalProduzidas === 0 && aps.length > 0) {
        const totalGeralAps = aps.reduce((s, a) => s + (a.pecas_produzidas || 0), 0)
        if (totalGeralAps > 0) {
          totalProduzidas = totalGeralAps
        }
      }

      const totalRefugo = aps.reduce((s, a) => s + (a.pecas_refugo || 0), 0)
      const totalRetrabalho = aps.reduce((s, a) => s + (a.pecas_retrabalho || 0), 0)
      const totalSegundos = aps.reduce((s, a) => s + (a.cronometro_total_segundos || 0), 0)
      let pct = op.quantidade > 0 ? Math.min(100, (totalProduzidas / op.quantidade) * 100) : 0
      const emAndamento = aps.some(a => a.status === "em_andamento")
      const temApontamento = aps.length > 0
      
      // A OP só é fechada se o encerramento tiver ocorrido na ÚLTIMA ETAPA do roteiro ou status estritamente encerrada
      const foiEncerradaNaUltimaEtapa = ultimaOperacaoId
        ? aps.some(a => a.operacao_id === ultimaOperacaoId && a.encerramento === "encerrar")
        : aps.some(a => a.encerramento === "encerrar")

      // A OP encerra por conclusão explícita ou quando a última operação atinge
      // exatamente a quantidade planejada. O banco impede qualquer excedente.
      const fechada = op.status === "encerrada" || foiEncerradaNaUltimaEtapa || (totalProduzidas >= op.quantidade && totalProduzidas > 0)

      // Garantia de que OPs encerradas com peças produzidas reflitam seu percentual real de entrega
      if (fechada && pct === 0 && op.quantidade > 0 && totalProduzidas > 0) {
        pct = Math.min(100, (totalProduzidas / op.quantidade) * 100)
      }
      
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
  }, [ordens, apontamentos, ultimaOperacaoPorProduto])

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

  const sessaoAtiva = sessoes[0] ?? null
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
        const ehSessaoAtiva = resumo.op.id === sessaoAtiva?.ordemId
        if (!ehSessaoAtiva && !codigosDisponiveisNoPosto.has(resumo.op.produto_codigo)) return false
        if (!termo) return true
        const descricao = mapaDescricaoProdutos[resumo.op.produto_codigo] || ""
        return [resumo.op.numero_op, resumo.op.produto_codigo, descricao]
          .some(valor => valor.toLowerCase().includes(termo))
      })
      .sort((a, b) => {
        if (a.op.id === sessaoAtiva?.ordemId) return -1
        if (b.op.id === sessaoAtiva?.ordemId) return 1
        return (a.op.data_programacao || "").localeCompare(b.op.data_programacao || "")
      })
  }, [resumos, buscaTrabalho, codigosDisponiveisNoPosto, mapaDescricaoProdutos, sessaoAtiva?.ordemId])

  const segundosAtivos = sessaoAtiva
    ? segundosMap[sessaoAtiva.apontamentoId] ?? sessaoAtiva.segundosAcumulados
    : 0
  const sessaoEmPausa = !!sessaoAtiva?.pausaInicioTimestamp
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
  const ritmo = sessaoEmPausa
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
      {/* Modal sugestão de OS de manutenção */}
      {showSugestaoManutencao && (
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
        </div>
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
        const ultimaOperacaoId = ordem ? ultimaOperacaoPorProduto[ordem.produto_codigo] : null
        const isUltimaEtapa = !sessao || !ultimaOperacaoId || sessao.operacaoId === ultimaOperacaoId
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
            isUltimaEtapa={isUltimaEtapa}
            maxProduzidas={maxProduzidas}
          />
        )
      })()}

      {/* Modal aviso estoque insuficiente */}
      {showAvisoEstoque && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Estoque insuficiente</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Os itens abaixo não têm saldo suficiente para cobrir o consumo desta OP. O encerramento vai deixar o estoque negativo.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {avisoItens.map((item, i) => (
                <div key={i} className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 space-y-1">
                  <p className="text-xs font-bold text-foreground">{item.codigo} — {item.descricao}</p>
                  <div className="flex gap-4 text-[11px]">
                    <span className="text-muted-foreground">Disponível: <strong className="text-foreground">{item.disponivel.toFixed(3)} {item.unidade}</strong></span>
                    <span className="text-muted-foreground">Necessário: <strong className="text-destructive">{item.necessario.toFixed(3)} {item.unidade}</strong></span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                    <div
                      className="h-full bg-amber-500 rounded-full"
                      style={{ width: `${Math.min(100, (item.disponivel / item.necessario) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-xl px-4 py-3">
              Você pode encerrar mesmo assim. O sistema vai registrar o consumo e o saldo ficará negativo até a próxima entrada de material.
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => { setShowAvisoEstoque(false); setDadosFinalizar(null); finalizandoRef.current = false; setFinalizando(false) }}
                disabled={finalizando}
                className="flex-1 h-11 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (finalizandoRef.current) return
                  finalizandoRef.current = true
                  setFinalizando(true)
                  setShowAvisoEstoque(false)
                  if (dadosFinalizar) handleConfirmarFinalizar(dadosFinalizar)
                }}
                disabled={finalizando}
                className="flex-1 h-11 rounded-xl bg-amber-500 text-white text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {finalizando && <span className="h-3.5 w-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                {finalizando ? "Processando..." : "Encerrar mesmo assim"}
              </button>
            </div>
          </div>
        </div>
      )}

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
          {sessaoAtiva && (
            <div className={"inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold " + (sessaoEmPausa ? "border-amber-500/25 bg-amber-500/10 text-amber-600" : "border-green-500/25 bg-green-500/10 text-green-600")}>
              <span className={"h-2 w-2 rounded-full " + (sessaoEmPausa ? "bg-amber-500" : "animate-pulse bg-green-500")} />
              {sessaoEmPausa ? "Operação pausada" : "Operação em andamento"}
            </div>
          )}
        </header>

        <div className="grid items-start gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
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
                    if (sessoes.length > 0) {
                      toast({ title: "Posto bloqueado", description: "Finalize o apontamento atual antes de trocar de posto.", variant: "destructive" })
                      return
                    }
                    setPostoSelecionadoId(valor)
                    setOrdemSelecionadaId("")
                    setOperacaoSelecionadaId("")
                    setBuscaTrabalho("")
                    localStorage.setItem("exata_posto_trabalho_" + empresaAtivaId, valor)
                  }}
                  disabled={sessoes.length > 0}
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
                    const emExecucao = sessaoAtiva?.ordemId === resumo.op.id
                    const descricao = mapaDescricaoProdutos[resumo.op.produto_codigo] || "Produto sem descrição"
                    const tituloOP = resumo.op.numero_op.toLowerCase().startsWith("op") ? resumo.op.numero_op : "OP " + resumo.op.numero_op

                    return (
                      <button
                        key={resumo.op.id}
                        type="button"
                        onClick={() => {
                          if (sessaoAtiva && sessaoAtiva.ordemId !== resumo.op.id) {
                            toast({ title: "Operação em andamento", description: "Finalize o apontamento atual antes de selecionar outro trabalho.", variant: "destructive" })
                            return
                          }
                          setOrdemSelecionadaId(resumo.op.id)
                          setOperacaoSelecionadaId("")
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
                          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"><Package className="h-3.5 w-3.5" /> Meta</p>
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
                            return (
                              <button
                                key={operacao.id}
                                type="button"
                                onClick={() => !sessaoAtiva && setOperacaoSelecionadaId(operacao.id)}
                                disabled={!!sessaoAtiva}
                                className={"flex min-h-24 items-center gap-3 rounded-2xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default " + (selecionada ? "border-primary bg-primary/5 shadow-sm shadow-primary/10" : "border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/45")}
                              >
                                <div className={"flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl " + (selecionada ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>
                                  <Layers3 className="h-5 w-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Etapa {operacao.ordem}</p>
                                  <p className="mt-1 text-sm font-black text-foreground">{operacao.nome}</p>
                                  <p className="mt-1 text-[10px] font-bold text-primary">{selecionada ? "Selecionada" : "Disponível"}</p>
                                </div>
                                {selecionada && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />}
                              </button>
                            )
                          })}
                      </div>
                    )}

                    {!sessaoAtiva && (
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
                          <span className="mt-1 block text-xs font-medium opacity-85">{operacaoSelecionadaId ? "Iniciar contagem do tempo neste posto" : "Escolha uma das etapas disponíveis acima"}</span>
                        </span>
                      </button>
                    )}

                    {sessaoAtiva && (
                      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-green-500/25 bg-green-500/10 px-4 py-3 text-green-700 dark:text-green-400">
                        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-green-500" />
                        <div>
                          <p className="text-sm font-black">{sessaoAtiva.operacaoNome}</p>
                          <p className="text-[11px] font-medium opacity-80">A operação está sendo registrada em {postoAtual.codigo}.</p>
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
                            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Produção da OP</p>
                            <p className="mt-1 text-lg font-black text-foreground">
                              {resumoEmExibicao?.totalProduzidas || 0} <span className="text-xs font-medium text-muted-foreground">de {ordemEmExibicao.quantidade} peças</span>
                            </p>
                          </div>
                          <div className="rounded-2xl border border-border bg-muted/25 p-4">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Orientação</p>
                            <p className="mt-1 text-sm font-black text-foreground">
                              {sessaoEmPausa ? "Retome quando estiver pronto" : cicloAtivo ? "Acompanhe o ciclo padrão" : "Registre qualquer interrupção"}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-border bg-muted/25 p-4">
                          <Clock className={"h-6 w-6 shrink-0 " + ritmo.texto} />
                          <div>
                            <p className="text-sm font-black text-foreground">{sessaoEmPausa ? "Cronômetro em pausa" : "Tempo sendo registrado automaticamente"}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {sessaoEmPausa ? "O período parado não será somado ao tempo produtivo." : "Use Pausar para registrar intervalos, falhas ou manutenção."}
                            </p>
                          </div>
                        </div>

                        <div className="mt-5 grid w-full gap-3 sm:grid-cols-2">
                          {sessaoEmPausa ? (
                            <button
                              type="button"
                              onClick={() => handleRetomar(sessaoAtiva.apontamentoId)}
                              className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-green-600 text-sm font-black text-white transition-colors hover:bg-green-500"
                            >
                              <Play className="h-5 w-5 fill-current" /> Retomar operação
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setSessaoEmAcaoId(sessaoAtiva.apontamentoId)
                                grupos.length > 0
                                  ? setShowModalPausa(true)
                                  : toast({ title: "Cadastre exceções primeiro", description: "Vá em Exceções e crie grupos de parada.", variant: "destructive" })
                              }}
                              className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-amber-500 text-sm font-black text-white transition-colors hover:bg-amber-400"
                            >
                              <Pause className="h-5 w-5" /> Pausar operação
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSessaoEmAcaoId(sessaoAtiva.apontamentoId)
                              setShowModalFinalizar(true)
                            }}
                            className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 text-sm font-black text-destructive transition-colors hover:bg-destructive/10"
                          >
                            <Square className="h-5 w-5" /> Finalizar e registrar
                          </button>
                        </div>
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
