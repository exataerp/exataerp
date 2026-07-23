"use client"

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { supabase } from "@/components/supabase"
import { useToast } from "@/hooks/use-toast"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Play, Pause, Square, Plus, Trash2, ClipboardList, TrendingUp,
  AlertTriangle, CheckCircle2, Clock, Package, Factory, ChevronDown, X, Wrench
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
  maquina_nome?: string
  maquina_codigo?: string
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

interface Pausa {
  id: string
  inicio: string
  fim?: string
  subgrupo_nome?: string
  grupo_nome?: string
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

function badgeStatus(pct: number) {
  if (pct >= 100) return { label: "Concluída", classes: "bg-green-500/10 text-green-600 border border-green-500/20" }
  if (pct >= 50) return { label: "Em andamento", classes: "bg-primary/10 text-primary border border-primary/20" }
  return { label: "Iniciada", classes: "bg-amber-500/10 text-amber-600 border border-amber-500/20" }
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

function ModalFinalizar({ onConfirm, onCancel, loading }: {
  onConfirm: (dados: { produzidas: number; refugo: number; retrabalho: number; encerramento: "continuar" | "encerrar" | "encerrar_parcial" }) => void
  onCancel: () => void
  loading?: boolean
}) {
  const [produzidas, setProduzidas] = useState("")
  const [refugo, setRefugo] = useState("")
  const [retrabalho, setRetrabalho] = useState("")
  const [encerramento, setEncerramento] = useState<"continuar" | "encerrar" | "encerrar_parcial">("continuar")

  const handleConfirm = () => {
    if (!produzidas || parseInt(produzidas) <= 0) return
    onConfirm({
      produzidas: parseInt(produzidas),
      refugo: parseInt(refugo) || 0,
      retrabalho: parseInt(retrabalho) || 0,
      encerramento,
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
              type="number" min="1" placeholder="Ex: 120"
              value={produzidas} onChange={e => setProduzidas(e.target.value)}
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
            </div>
          </div>

          <div className="space-y-1.5 pt-1">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">O que fazer com a OP?</label>
            <div className="space-y-2">
              {[
                { value: "continuar", label: "Continuar produzindo", desc: "Salva este apontamento e segue a OP aberta" },
                { value: "encerrar", label: "Encerrar OP", desc: "Marca a OP como concluída" },
                { value: "encerrar_parcial", label: "Encerrar parcialmente", desc: "Encerra com quantidade menor que o planejado" },
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
            disabled={!produzidas || parseInt(produzidas) <= 0 || loading}
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

  // Painel
  const [opExpandida, setOpExpandida] = useState<string | null>(null)

  // ─── Carga inicial ─────────────────────────────────────────────────────────

  const loadData = async () => {
    setLoading(true)
    try {
      const [opsRes, apRes, gRes, sRes, prodRes] = await Promise.all([
        supabase.from("ordens_producao")
          .select("id, numero_op, produto_codigo, quantidade, data_programacao")
          .eq("empresa_id", empresaAtivaId!)
          .order("data_programacao", { ascending: true }),
        supabase.from("apontamentos")
          .select("id, ordem_id, operacao_id, operacao_nome, cronometro_total_segundos, pecas_produzidas, pecas_refugo, pecas_retrabalho, status, encerramento, created_at")
          .eq("empresa_id", empresaAtivaId!)
          .order("created_at", { ascending: false }),
        supabase.from("excecao_grupos").select("id, nome").eq("empresa_id", empresaAtivaId!).order("nome"),
        supabase.from("excecao_subgrupos").select("id, grupo_id, nome").eq("empresa_id", empresaAtivaId!).order("nome"),
        supabase.from("produtos").select("codigo, operacoes(id, ordem)").eq("empresa_id", empresaAtivaId!),
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
      for (const p of (prodRes.data || []) as any[]) {
        const opsRoteiro = (p.operacoes || []) as { id: string; ordem: number }[]
        if (opsRoteiro.length === 0) continue
        const ultima = opsRoteiro.reduce((a, b) => (b.ordem > a.ordem ? b : a))
        mapaUltimaOp[p.codigo] = ultima.id
      }
      setUltimaOperacaoPorProduto(mapaUltimaOp)

      const gruposFormatados: Grupo[] = (gRes.data || []).map((g: any) => ({
        id: g.id,
        nome: g.nome,
        subgrupos: (sRes.data || []).filter((s: any) => s.grupo_id === g.id),
      }))
      setGrupos(gruposFormatados)
    } catch (err) {
      console.error("Erro critico na carga:", err)
    } finally {
      setLoading(false)
    }
  }

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
  }, [empresaAtivaId])

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

  // ─── Carrega operações ao selecionar OP ────────────────────────────────────

  useEffect(() => {
    if (!ordemSelecionadaId) { setOperacoes([]); setOperacaoSelecionadaId(""); return }
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
          .from("operacoes")
          .select("id, nome, maquina_id, ordem, maquinas(nome, codigo)")
          .eq("produto_id", prod.id)
          .order("ordem")
          .then(({ data: ops }) => {
            const formatted: Operacao[] = (ops || []).map((o: any) => ({
              id: o.id,
              nome: o.nome,
              maquina_id: o.maquina_id,
              maquina_nome: o.maquinas?.nome,
              maquina_codigo: o.maquinas?.codigo,
              ordem: o.ordem,
            }))
            setOperacoes(formatted)
            setLoadingOps(false)
          })
      })
  }, [ordemSelecionadaId])

  // ─── Iniciar ───────────────────────────────────────────────────────────────

  const handleIniciar = async () => {
    if (!ordemSelecionadaId || !operacaoSelecionadaId) {
      toast({ title: "Selecione a OP e a operação", variant: "destructive" })
      return
    }
    const op = operacoes.find(o => o.id === operacaoSelecionadaId)
    if (!op) return

    if (sessoes.some(s => s.operacaoId === operacaoSelecionadaId)) {
      toast({ title: "Essa operação já está em andamento", description: "Finalize ou pause antes de iniciar de novo.", variant: "destructive" })
      return
    }

    // Busca tempo planejado da operação no banco para ter unidade correta
    const { data: opDb } = await supabase
      .from("operacoes")
      .select("tempo, unidade")
      .eq("id", operacaoSelecionadaId)
      .single()

    const cicloPlanejadoSeg = opDb
      ? (opDb.unidade === "minutes" ? opDb.tempo * 60 : opDb.tempo)
      : undefined

    const { data, error } = await supabase
      .from("apontamentos")
      .insert({
        empresa_id: empresaAtivaId,
        ordem_id: ordemSelecionadaId,
        operacao_id: operacaoSelecionadaId,
        operacao_nome: op.nome,
        maquina_id: op.maquina_id || null,
        cronometro_inicio: new Date().toISOString(),
        cronometro_total_segundos: 0,
        pecas_produzidas: 0,
        pecas_refugo: 0,
        pecas_retrabalho: 0,
        status: "em_andamento",
        data_apontamento: new Date().toISOString().split("T")[0],
        hora_inicio: new Date().toTimeString().slice(0, 5),
        hora_fim: new Date().toTimeString().slice(0, 5),
      })
      .select()
      .single()

    if (error) { toast({ title: "Erro ao iniciar", description: error.message, variant: "destructive" }); return }

    const novaSessao: SessaoAtiva = {
      apontamentoId: data.id,
      ordemId: ordemSelecionadaId,
      operacaoId: operacaoSelecionadaId,
      operacaoNome: op.nome,
      maquinaId: op.maquina_id,
      maquinaNome: op.maquina_nome ? `${op.maquina_codigo} - ${op.maquina_nome}` : "Manual",
      inicioTimestamp: Date.now(),
      segundosAcumulados: 0,
      cicloPlanejadoSeg,
    }
    salvarSessoes([...sessoes, novaSessao])
    setOrdemSelecionadaId("")
    setOperacaoSelecionadaId("")
    toast({ title: "▶ Apontamento iniciado", description: op.nome })
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

    // Se não vai encerrar, não precisa verificar
    if (dados.encerramento === "continuar") {
      setShowModalFinalizar(false)
      handleConfirmarFinalizar(dados)
      return
    }

    const sessao = sessoes.find(s => s.apontamentoId === sessaoEmAcaoId)
    const ordem = ordens.find(o => o.id === sessao?.ordemId)
    if (!ordem) { setShowModalFinalizar(false); handleConfirmarFinalizar(dados); return }

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
    if (dados.encerramento !== "continuar") {
      const ordem = ordens.find(o => o.id === sessao.ordemId)
      if (ordem) {
        const pecasBoas = dados.produzidas - dados.refugo

        const { data: resultado, error: erroEstoque } = await supabase.rpc("finalizar_apontamento_estoque", {
          p_empresa_id: empresaAtivaId,
          p_ordem_id: sessao.ordemId,
          p_produto_codigo: ordem.produto_codigo,
          p_pecas_boas: pecasBoas,
          p_refugo: dados.refugo,
          p_observacao: `OP ${ordem.numero_op} — ${pecasBoas} peças boas`,
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

        // Encerra a OP — só no encerramento total. Parcial deixa a OP aberta pra continuar depois.
        if (dados.encerramento === "encerrar") {
          await supabase.from("ordens_producao").update({ status: "encerrada" }).eq("id", sessao.ordemId)
        }
      }
    }

    salvarSessoes(sessoes.filter(s => s.apontamentoId !== sessao.apontamentoId))
    setSessaoEmAcaoId(null)
    await loadData()

    const labels = { continuar: "Apontamento salvo", encerrar: "OP encerrada e estoque atualizado", encerrar_parcial: "OP encerrada parcialmente e estoque atualizado" }
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
      const totalProduzidas = apsUltimaEtapa.reduce((s, a) => s + (a.pecas_produzidas || 0), 0)
      const totalRefugo = aps.reduce((s, a) => s + (a.pecas_refugo || 0), 0)
      const totalRetrabalho = aps.reduce((s, a) => s + (a.pecas_retrabalho || 0), 0)
      const totalSegundos = aps.reduce((s, a) => s + (a.cronometro_total_segundos || 0), 0)
      const pct = op.quantidade > 0 ? Math.min(100, (totalProduzidas / op.quantidade) * 100) : 0
      
      // Só o encerramento total tranca a OP. Parcial é um "salvamento de progresso":
      // registra o que já foi produzido, mas deixa a OP disponível pra continuar depois.
      const foiEncerradaManualmente = aps.some(a => a.encerramento === "encerrar")
      const fechada = foiEncerradaManualmente || totalProduzidas >= op.quantidade
      
      return { op, aps, totalProduzidas, totalRefugo, totalRetrabalho, totalSegundos, pct, fechada }
    })
  }, [ordens, apontamentos, ultimaOperacaoPorProduto])

  const kpis = useMemo(() => {
    const totalOPs = ordens.length
    const opsFechadas = resumos.filter(r => r.fechada).length
    const totalProduzidas = apontamentos.reduce((s, a) => s + (a.pecas_produzidas || 0), 0)
    const totalRefugo = apontamentos.reduce((s, a) => s + (a.pecas_refugo || 0), 0)
    const pctRefugo = totalProduzidas + totalRefugo > 0
      ? ((totalRefugo / (totalProduzidas + totalRefugo)) * 100).toFixed(1) : "0.0"
    return { totalOPs, opsFechadas, totalProduzidas, totalRefugo, pctRefugo }
  }, [resumos, apontamentos, ordens])

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
      {showModalFinalizar && (
        <ModalFinalizar
          onConfirm={verificarEstoqueEFinalizar}
          onCancel={() => setShowModalFinalizar(false)}
          loading={finalizando}
        />
      )}

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

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "OPs na carteira", value: kpis.totalOPs, icon: ClipboardList, color: "text-primary" },
          { label: "OPs concluídas", value: kpis.opsFechadas, icon: CheckCircle2, color: "text-green-600" },
          { label: "Peças produzidas", value: kpis.totalProduzidas.toLocaleString("pt-BR"), icon: Package, color: "text-primary" },
          { label: "Taxa de refugo", value: `${kpis.pctRefugo}%`, icon: AlertTriangle, color: Number(kpis.pctRefugo) > 5 ? "text-destructive" : "text-amber-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-card border border-border rounded-2xl px-5 py-4 flex items-center gap-4 shadow-sm">
            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-muted flex-shrink-0">
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">{label}</p>
              <p className="text-xl font-bold text-foreground">{value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-3">

        {/* Painel de controle */}
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h3 className="text-sm font-bold text-foreground">Apontamento</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {sessoes.length > 0 ? `${sessoes.length} operação${sessoes.length > 1 ? "ões" : ""} em andamento` : "Selecione a OP e a operação para iniciar"}
            </p>
          </div>

          <div className="p-6 space-y-4">
            {/* Formulário de início — sempre visível, pode iniciar outra sessão mesmo com sessões já rodando */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Ordem de Produção</label>
              <Select value={ordemSelecionadaId} onValueChange={(v) => { setOrdemSelecionadaId(v); setOperacaoSelecionadaId("") }}>
                <SelectTrigger className="w-full h-10 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all">
                  <SelectValue placeholder="Selecione a OP" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {resumos.filter(r => !r.fechada).map(r => (
                    <SelectItem key={r.op.id} value={r.op.id}>{r.op.numero_op} — {r.op.produto_codigo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {ordemAtual && (
              <div className="bg-muted/40 rounded-xl p-4 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Produto</span>
                  <span className="font-bold text-foreground">{ordemAtual.produto_codigo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Quantidade</span>
                  <span className="font-bold text-foreground">{ordemAtual.quantidade} peças</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Programada</span>
                  <span className="font-bold text-foreground">{ordemAtual.data_programacao?.split("-").reverse().join("/")}</span>
                </div>
              </div>
            )}

            {ordemSelecionadaId && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Operação</label>
                {loadingOps ? (
                  <div className="h-11 rounded-xl border border-border bg-muted animate-pulse" />
                ) : operacoes.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-1">Nenhuma operação no roteiro deste produto.</p>
                ) : (
                  <Select value={operacaoSelecionadaId} onValueChange={setOperacaoSelecionadaId}>
                    <SelectTrigger className="w-full h-10 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all">
                      <SelectValue placeholder="Selecione a operação" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {operacoes.map(op => {
                        const jaRodando = sessoes.some(s => s.operacaoId === op.id)
                        return (
                          <SelectItem key={op.id} value={op.id} disabled={jaRodando}>
                            {op.ordem}. {op.nome}{op.maquina_codigo ? ` — ${op.maquina_codigo}` : ""}{jaRodando ? " (já em andamento)" : ""}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            <button
              onClick={handleIniciar}
              disabled={!ordemSelecionadaId || !operacaoSelecionadaId}
              className="w-full h-12 flex items-center justify-center gap-2 bg-primary text-primary-foreground font-bold uppercase tracking-widest text-xs rounded-xl shadow-md hover:opacity-90 transition-all disabled:opacity-50"
            >
              <Play className="h-4 w-4" /> Iniciar
            </button>

            {/* Lista de sessões ativas, uma por operação/máquina */}
            {sessoes.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-border">
                {sessoes.map(s => {
                  const segundosDisplay = segundosMap[s.apontamentoId] ?? s.segundosAcumulados
                  const emPausaEsta = !!s.pausaInicioTimestamp
                  const ciclo = s.cicloPlanejadoSeg
                  // O tempo decorrido é da sessão inteira (pode ter várias peças, não só uma).
                  // Por isso o ritmo é avaliado dentro do ciclo atual (tempo decorrido % ciclo),
                  // não pelo tempo total acumulado contra o ciclo de 1 peça só.
                  const pecasNoTempo = ciclo && ciclo > 0 ? Math.floor(segundosDisplay / ciclo) : 0
                  const tempoNoCicloAtual = ciclo && ciclo > 0 ? segundosDisplay - pecasNoTempo * ciclo : segundosDisplay
                  const pct = ciclo && ciclo > 0 && segundosDisplay > 0 ? (tempoNoCicloAtual / ciclo) * 100 : null
                  const semaforo = emPausaEsta
                    ? { cor: "text-amber-500", bg: "bg-amber-500/10", borda: "border-amber-500/30", label: "Em pausa", barra: "bg-amber-500" }
                    : pct === null
                    ? { cor: "text-foreground", bg: "bg-muted/40", borda: "border-transparent", label: "Sem ciclo padrão", barra: "bg-primary" }
                    : pct <= 90
                    ? { cor: "text-green-600", bg: "bg-green-500/10", borda: "border-green-500/30", label: "Dentro do tempo", barra: "bg-green-500" }
                    : pct <= 110
                    ? { cor: "text-amber-500", bg: "bg-amber-500/10", borda: "border-amber-500/30", label: "No limite", barra: "bg-amber-500" }
                    : { cor: "text-destructive", bg: "bg-destructive/10", borda: "border-destructive/30", label: "Tempo estourado", barra: "bg-destructive" }

                  return (
                    <div key={s.apontamentoId} className="rounded-xl border border-border p-3 space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-foreground">{ordens.find(o => o.id === s.ordemId)?.numero_op}</span>
                        <span className="text-muted-foreground">{s.maquinaNome}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground -mt-2">{s.operacaoNome}</p>

                      <div className={`rounded-xl p-3 text-center space-y-1 border ${semaforo.bg} ${semaforo.borda} transition-all`}>
                        <p className={`text-3xl font-black tabular-nums tracking-tight ${semaforo.cor}`}>
                          {formatarTempo(segundosDisplay)}
                        </p>
                        <p className={`text-[10px] font-bold uppercase tracking-wider ${semaforo.cor}`}>
                          {semaforo.label}
                        </p>
                        {ciclo && ciclo > 0 && (
                          <div className="space-y-1 pt-1">
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${semaforo.barra}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              Ciclo padrão: {formatarTempo(ciclo)} · Peça ~{pecasNoTempo + 1} do lote{pct !== null && ` — ${pct.toFixed(0)}%`}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {emPausaEsta ? (
                          <button
                            onClick={() => handleRetomar(s.apontamentoId)}
                            className="col-span-2 h-10 flex items-center justify-center gap-2 bg-green-600 text-white font-bold text-xs uppercase tracking-widest rounded-xl hover:opacity-90 transition-all"
                          >
                            <Play className="h-4 w-4" /> Retomar
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setSessaoEmAcaoId(s.apontamentoId)
                              grupos.length > 0 ? setShowModalPausa(true) : toast({ title: "Cadastre exceções primeiro", description: "Vá em Exceções e crie grupos de parada.", variant: "destructive" })
                            }}
                            className="h-10 flex items-center justify-center gap-2 bg-amber-500 text-white font-bold text-xs uppercase tracking-widest rounded-xl hover:opacity-90 transition-all"
                          >
                            <Pause className="h-4 w-4" /> Pausar
                          </button>
                        )}
                        <button
                          onClick={() => { setSessaoEmAcaoId(s.apontamentoId); setShowModalFinalizar(true) }}
                          className={`h-10 flex items-center justify-center gap-2 bg-card border border-border text-foreground font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-muted transition-all ${emPausaEsta ? "col-span-2" : ""}`}
                        >
                          <Square className="h-4 w-4" /> Finalizar
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Painel de OPs */}
        <div className="md:col-span-2 space-y-4">
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> Acompanhamento de OPs
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Planejado x realizado por ordem de produção</p>
            </div>

            <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
              {resumos.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                  <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                    <ClipboardList className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-bold text-foreground">Nenhuma OP na carteira</p>
                  <p className="text-xs text-muted-foreground mt-1">Crie ordens de produção no módulo PCP para começar.</p>
                </div>
              )}

              {resumos.map(resumo => {
                const badge = badgeStatus(resumo.pct)
                const expandida = opExpandida === resumo.op.id

                return (
                  <div key={resumo.op.id} className="p-5">
                    <div className="flex items-start justify-between cursor-pointer" onClick={() => setOpExpandida(expandida ? null : resumo.op.id)}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-foreground">{resumo.op.numero_op}</span>
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-primary/10 text-primary rounded-full uppercase">{resumo.op.produto_codigo}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.classes}`}>{badge.label}</span>
                          {resumo.fechada && <span className="text-[10px] font-bold px-2 py-0.5 bg-green-500/10 text-green-600 rounded-full border border-green-500/20">Encerrada</span>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Meta: <strong className="text-foreground">{resumo.op.quantidade} peças</strong>
                          {" · "}Programada: <strong className="text-foreground">{resumo.op.data_programacao?.split("-").reverse().join("/")}</strong>
                        </p>
                      </div>
                      <div className="text-right ml-4 flex-shrink-0">
                        <p className="text-xl font-bold text-foreground">{resumo.pct.toFixed(0)}%</p>
                        <p className="text-[10px] text-muted-foreground">{resumo.totalProduzidas}/{resumo.op.quantidade} pç</p>
                      </div>
                    </div>

                    <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden relative">
                      <div
                        className={`h-full rounded-full transition-all relative overflow-hidden ${resumo.fechada ? "bg-green-500" : "bg-primary"}`}
                        style={{ width: `${resumo.pct}%` }}
                      >
                        {!resumo.fechada && resumo.pct > 0 && <div className="progress-shimmer" />}
                      </div>
                    </div>

                    <div className="mt-3 flex gap-4 text-[11px]">
                      {resumo.totalSegundos > 0 && (
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {formatarTempo(resumo.totalSegundos)}
                        </span>
                      )}
                      {resumo.totalRefugo > 0 && (
                        <span className="text-destructive flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> {resumo.totalRefugo} refugo
                        </span>
                      )}
                      {resumo.totalRetrabalho > 0 && (
                        <span className="text-amber-500 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> {resumo.totalRetrabalho} retrabalho
                        </span>
                      )}
                      {resumo.aps.length > 0 && (
                        <span className="text-muted-foreground">{resumo.aps.length} apontamento{resumo.aps.length > 1 ? "s" : ""}</span>
                      )}
                    </div>

                    {expandida && resumo.aps.length > 0 && (
                      <div className="mt-4 space-y-2">
                        <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Histórico</p>
                        {resumo.aps.map(ap => (
                          <div key={ap.id} className="flex items-start justify-between p-3 bg-muted/30 border border-border rounded-xl text-xs gap-3">
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="font-bold text-foreground">{ap.operacao_nome || "Operação"}</span>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <span className="text-muted-foreground flex items-center gap-1">
                                  <Clock className="h-3 w-3" /> {formatarTempo(ap.cronometro_total_segundos || 0)}
                                </span>
                                <span className="text-foreground font-bold">{ap.pecas_produzidas} pç</span>
                                {ap.pecas_refugo > 0 && <span className="text-destructive">{ap.pecas_refugo} refugo</span>}
                                {ap.pecas_retrabalho > 0 && <span className="text-amber-500">{ap.pecas_retrabalho} retrabalho</span>}
                              </div>
                              {ap.encerramento && ap.encerramento !== "continuar" && (
                                <span className="text-[10px] text-muted-foreground italic mt-0.5">
                                  {ap.encerramento === "encerrar" ? "OP encerrada" : "Encerramento parcial"}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {expandida && resumo.aps.length === 0 && (
                      <div className="mt-4 px-3 py-4 bg-muted/20 border border-dashed border-border rounded-xl text-center">
                        <p className="text-xs text-muted-foreground">Nenhum apontamento para esta OP ainda.</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
