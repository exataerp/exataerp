"use client"

import React, { useState, useEffect, useRef } from "react"
import { useTheme } from "next-themes"
import { supabase } from "@/components/supabase"
import { useAuth } from "@/contexts/AuthContext"
import { usePermissao } from "@/hooks/usePermissao"
import { useToast } from "@/hooks/use-toast"
import { GBOTab } from "@/components/gbo-tab"
import { PCPTab } from "@/components/pcp-tab"
import { ApontamentoTab } from "@/components/apontamento-tab"
import { ExcecoesTab } from "@/components/excecoes-tab"
import { EstoqueTab, ABAS_CONFIG as ESTOQUE_ABAS_CONFIG, type Aba as EstoqueAba } from "@/components/estoque-tab"
import { RelatoriosTab, RELATORIOS_CONFIG, type RelatoId } from "@/components/relatorios-tab"
import { DashboardTab } from "@/components/dashboard-tab"
import { MaquinasTab } from "@/components/maquinas-tab"
import { ManutencaoTab } from "@/components/manutencao-tab"
import { OnboardingChecklist } from "@/components/onboarding-checklist"
import { EquipeTab } from "@/components/equipe-tab"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TimePicker } from "@/components/time-picker"
import {
  Settings, Sun, Moon, Monitor, BookText, BarChart2, ClipboardCheck,
  CalendarClock, Menu, X, PanelLeftClose, PanelLeftOpen, Factory, Wrench,
  Check, Boxes, LineChart, Bell, LayoutDashboard, AlertTriangle, LogOut, Users
} from "lucide-react"

type TabId = "dashboard" | "gbo" | "pcp" | "apontamento" | "maquinas" | "manutencao" | "excecoes" | "estoque" | "relatorios" | "configuracoes" | "equipe"

const NAV_ITEMS: { id: TabId; label: string; sublabel: string; icon: React.ElementType }[] = [
  { id: "dashboard",   label: "Dashboard",       sublabel: "Visão em tempo real",      icon: LayoutDashboard },
  { id: "gbo",         label: "Produto/Roteiro", sublabel: "Gerenciamento Diário",     icon: BarChart2       },
  { id: "pcp",         label: "PCP",             sublabel: "Programação de Produção",  icon: CalendarClock   },
  { id: "maquinas",    label: "Máquinas",         sublabel: "Postos de Trabalho",      icon: Factory         },
  { id: "manutencao",  label: "Manutenção",       sublabel: "Gestão de Ativos",        icon: Wrench          },
  { id: "apontamento", label: "Apontamento",      sublabel: "Registro de Produção",    icon: ClipboardCheck  },
  { id: "estoque",     label: "Estoque",          sublabel: "Controle de Inventário",  icon: Boxes           },
  { id: "excecoes",    label: "Exceções",         sublabel: "Motivos de Parada",       icon: LayoutDashboard },
  { id: "relatorios",  label: "Relatórios",       sublabel: "Análise de Desempenho",   icon: LineChart       },
]

const STORAGE_TAB = "exata_aba_ativa"

export default function ExataApp() {
  const { session, loading: authLoading, signOut } = useAuth()
  const { isSystemManager, canAccess } = usePermissao()
  const empresaAtivaId = session?.empresa?.id ?? null
  const empresaName    = session?.empresa?.nome ?? ""

  // configurações
  const [defaultTime,      setDefaultTime]      = useState("")
  const [defaultTimeUnit,  setDefaultTimeUnit]  = useState<"hours" | "minutes" | "seconds">("hours")
  const [isSavingConf,     setIsSavingConf]     = useState(false)

  // dados da fábrica
  const [confNome,         setConfNome]         = useState("")
  const [confCnpj,         setConfCnpj]         = useState("")
  const [confEndereco,     setConfEndereco]     = useState("")
  const [confSegmento,     setConfSegmento]     = useState("")
  const [confFuncionarios, setConfFuncionarios] = useState("")
  const [isSavingFabrica,  setIsSavingFabrica]  = useState(false)

  // metas
  const [metaOEE,           setMetaOEE]           = useState("85")
  const [metaRefugo,        setMetaRefugo]         = useState("2")
  const [metaProdutividade, setMetaProdutividade]  = useState("90")
  const [isSavingMetas,     setIsSavingMetas]      = useState(false)

  // turnos
  const [turnos,        setTurnos]        = useState<{ id?: string; nome: string; hora_inicio: string; hora_fim: string; dias_semana: string[]; ativo: boolean }[]>([])
  const [loadingTurnos, setLoadingTurnos] = useState(false)
  const [salvandoTurno, setSalvandoTurno] = useState(false)
  const [novoTurno,     setNovoTurno]     = useState({ nome: "", hora_inicio: "", hora_fim: "", dias_semana: ["1","2","3","4","5"] })

  const [activeTab,       setActiveTab]       = useState<TabId>("dashboard")
  const [relatorioAtivo,  setRelatorioAtivo]  = useState<RelatoId>("oee")
  const [estoqueAbaAtiva, setEstoqueAbaAtiva] = useState<EstoqueAba>("saldo")
  const [collapsed,       setCollapsed]       = useState(false)
  const [mobileOpen,      setMobileOpen]      = useState(false)
  const [mounted,         setMounted]         = useState(false)
  const [showAlertas,     setShowAlertas]     = useState(false)
  const [alertas,         setAlertas]         = useState<{ id: string; tipo: "critico" | "atencao"; titulo: string; descricao: string; tab?: TabId }[]>([])
  const { theme, setTheme } = useTheme()
  const { toast } = useToast()
  const faixaTelaRef = useRef<"celular" | "notebook" | "monitor" | null>(null)

  // Sidebar adapta ao tamanho da tela
  useEffect(() => {
    const ajustar = () => {
      const largura = window.innerWidth
      const faixa = largura < 1024 ? "celular" : largura < 1400 ? "notebook" : "monitor"
      if (faixaTelaRef.current === faixa) return
      faixaTelaRef.current = faixa
      if (faixa === "notebook") setCollapsed(true)
      if (faixa === "monitor")  setCollapsed(false)
      if (faixa !== "celular")  setMobileOpen(false)
    }
    ajustar()
    window.addEventListener("resize", ajustar)
    return () => window.removeEventListener("resize", ajustar)
  }, [])

  // Inicialização
  useEffect(() => {
    setMounted(true)
    const savedTab = localStorage.getItem(STORAGE_TAB) as TabId
    if (savedTab && [...NAV_ITEMS.map(n => n.id), "configuracoes", "equipe"].includes(savedTab)) {
      setActiveTab(savedTab)
    }
  }, [])

  // Carrega dados quando empresa estiver disponível
  useEffect(() => {
    if (!empresaAtivaId) return
    carregarAlertas(empresaAtivaId)
    carregarConfFabrica(empresaAtivaId)
    carregarTurnos(empresaAtivaId)
  }, [empresaAtivaId])

  // Alertas automáticos
  const carregarAlertas = async (empId: string) => {
    const novosAlertas: typeof alertas = []

    const { data: saldos } = await supabase
      .from("saldo_estoque")
      .select("saldo_atual, insumos(codigo, estoque_minimo)")
      .eq("empresa_id", empId)

    for (const s of saldos || []) {
      const ins = (s as any).insumos
      if (!ins) continue
      if (s.saldo_atual <= 0) {
        novosAlertas.push({ id: `estoque-zero-${(s as any).insumo_id}`, tipo: "critico", titulo: `Estoque zerado: ${ins.codigo}`, descricao: "Sem saldo disponível. Faça um recebimento.", tab: "estoque" })
      } else if (s.saldo_atual <= ins.estoque_minimo && ins.estoque_minimo > 0) {
        novosAlertas.push({ id: `estoque-min-${(s as any).insumo_id}`, tipo: "atencao", titulo: `Estoque baixo: ${ins.codigo}`, descricao: `Saldo ${s.saldo_atual.toFixed(2)} abaixo do mínimo de ${ins.estoque_minimo}.`, tab: "estoque" })
      }
    }

    const hoje = new Date().toISOString().split("T")[0]
    const { data: ops } = await supabase
      .from("ordens_producao")
      .select("numero_op, data_programacao")
      .eq("empresa_id", empId)
      .neq("status", "encerrada")
      .lt("data_programacao", hoje)

    for (const op of ops || []) {
      novosAlertas.push({ id: `op-atrasada-${(op as any).numero_op}`, tipo: "critico", titulo: `OP atrasada: ${(op as any).numero_op}`, descricao: `Programada para ${(op as any).data_programacao.split("-").reverse().join("/")} e ainda em aberto.`, tab: "pcp" })
    }

    const { data: mants } = await supabase
      .from("manutencao")
      .select("id")
      .eq("empresa_id", empId)
      .eq("status", "pendente")

    if ((mants?.length ?? 0) > 0) {
      novosAlertas.push({ id: "manutencao-pendente", tipo: "atencao", titulo: `${mants!.length} OS de manutenção pendente${mants!.length > 1 ? "s" : ""}`, descricao: "Ordens de serviço aguardando execução.", tab: "manutencao" })
    }

    setAlertas(novosAlertas)
  }

  const handleSair = async () => {
    await signOut()
    window.location.href = "/login"
  }

  const handleSaveConf = async () => {
    if (!empresaAtivaId) return
    setIsSavingConf(true)
    const { error } = await supabase
      .from("empresas")
      .update({ tempo_padrao: defaultTime ? parseFloat(defaultTime) : null, unidade_tempo: defaultTimeUnit })
      .eq("id", empresaAtivaId)
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" })
    } else {
      toast({ title: "✅ Configurações salvas" })
    }
    setIsSavingConf(false)
  }

  const carregarConfFabrica = async (empId: string) => {
    const { data } = await supabase
      .from("empresas")
      .select("nome, cnpj, endereco, segmento, num_funcionarios, meta_oee, meta_refugo, meta_produtividade, tempo_padrao, unidade_tempo")
      .eq("id", empId)
      .single()
    if (data) {
      setConfNome(data.nome ?? "")
      setConfCnpj(data.cnpj ?? "")
      setConfEndereco(data.endereco ?? "")
      setConfSegmento(data.segmento ?? "")
      setConfFuncionarios(data.num_funcionarios ?? "")
      setMetaOEE(data.meta_oee?.toString() ?? "85")
      setMetaRefugo(data.meta_refugo?.toString() ?? "2")
      setMetaProdutividade(data.meta_produtividade?.toString() ?? "90")
      setDefaultTime(data.tempo_padrao?.toString() ?? "")
      setDefaultTimeUnit(data.unidade_tempo ?? "hours")
    }
  }

  const handleSaveFabrica = async () => {
    if (!empresaAtivaId) return
    setIsSavingFabrica(true)
    const { error } = await supabase
      .from("empresas")
      .update({ nome: confNome, cnpj: confCnpj, endereco: confEndereco, segmento: confSegmento, num_funcionarios: confFuncionarios, tempo_padrao: defaultTime ? parseFloat(defaultTime) : null, unidade_tempo: defaultTimeUnit })
      .eq("id", empresaAtivaId)
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" })
    } else {
      toast({ title: "✅ Dados da fábrica salvos" })
    }
    setIsSavingFabrica(false)
  }

  const handleSaveMetas = async () => {
    if (!empresaAtivaId) return
    setIsSavingMetas(true)
    const { error } = await supabase
      .from("empresas")
      .update({ meta_oee: parseFloat(metaOEE) || 85, meta_refugo: parseFloat(metaRefugo) || 2, meta_produtividade: parseFloat(metaProdutividade) || 90 })
      .eq("id", empresaAtivaId)
    if (error) {
      toast({ title: "Erro ao salvar metas", description: error.message, variant: "destructive" })
    } else {
      toast({ title: "✅ Metas salvas" })
    }
    setIsSavingMetas(false)
  }

  const carregarTurnos = async (empId: string) => {
    setLoadingTurnos(true)
    const { data } = await supabase.from("turnos").select("*").eq("empresa_id", empId).order("hora_inicio")
    if (data) setTurnos(data)
    setLoadingTurnos(false)
  }

  const handleAddTurno = async () => {
    if (!novoTurno.nome || !novoTurno.hora_inicio || !novoTurno.hora_fim) return
    setSalvandoTurno(true)
    const { data, error } = await supabase
      .from("turnos")
      .insert({ empresa_id: empresaAtivaId, nome: novoTurno.nome, hora_inicio: novoTurno.hora_inicio, hora_fim: novoTurno.hora_fim, dias_semana: novoTurno.dias_semana, ativo: true })
      .select().single()
    if (error) {
      toast({ title: "Erro ao criar turno", description: error.message, variant: "destructive" })
    } else {
      setTurnos(prev => [...prev, data])
      setNovoTurno({ nome: "", hora_inicio: "", hora_fim: "", dias_semana: ["1","2","3","4","5"] })
      toast({ title: "✅ Turno criado" })
    }
    setSalvandoTurno(false)
  }

  const handleDeleteTurno = async (id: string) => {
    await supabase.from("turnos").delete().eq("id", id)
    setTurnos(prev => prev.filter(t => t.id !== id))
    toast({ title: "Turno removido" })
  }

  const toggleDiaTurno = (dia: string) => {
    setNovoTurno(prev => ({
      ...prev,
      dias_semana: prev.dias_semana.includes(dia)
        ? prev.dias_semana.filter(d => d !== dia)
        : [...prev.dias_semana, dia]
    }))
  }

  // Tela de carregamento
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground animate-pulse">Carregando Exata...</p>
      </div>
    )
  }

  // Sem sessão — redireciona para login
  if (!empresaAtivaId) {
    if (typeof window !== "undefined") window.location.href = "/login"
    return null
  }

  const NavButton = ({
    id, label, sublabel, icon: Icon, onClick, isActive, isCollapsed
  }: {
    id: string; label: string; sublabel: string; icon: React.ElementType;
    onClick: () => void; isActive: boolean; isCollapsed: boolean
  }) => (
    <button
      onClick={onClick}
      title={isCollapsed ? sublabel : undefined}
      className={`w-full flex items-center rounded-xl transition-all text-left
        ${isCollapsed ? "justify-center h-10 w-10 mx-auto" : "gap-3 px-3 py-3"}
        ${isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
    >
      <Icon className="h-[18px] w-[18px] flex-shrink-0" />
      {!isCollapsed && (
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-bold leading-tight">{label}</span>
          <span className={`text-[10px] leading-tight truncate ${isActive ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
            {sublabel}
          </span>
        </div>
      )}
    </button>
  )

  const goTab = (tab: TabId) => {
    setActiveTab(tab)
    localStorage.setItem(STORAGE_TAB, tab)
    setMobileOpen(false)
  }

  // Filtra NAV_ITEMS pelo canAccess de cada aba
  const navVisiveis = NAV_ITEMS.filter(item => canAccess(item.id as any))

  return (
    <React.Fragment>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: landscape; margin: 1cm; }
          body { background: white !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          [data-radix-toast-provider], [role="region"][aria-label="Notifications"], .toaster, [data-radix-popper-content-wrapper] {
            display: none !important; opacity: 0 !important; visibility: hidden !important; pointer-events: none !important;
          }
        }
        .sidebar-transition { transition: width 200ms cubic-bezier(0.4,0,0.2,1); }
        input[type="number"]::-webkit-outer-spin-button,
        input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type="number"] { -moz-appearance: textfield; }
      ` }} />

      <div className="h-screen overflow-hidden bg-background flex print:block">

        {/* SIDEBAR DESKTOP */}
        <aside className={`hidden lg:flex flex-col flex-shrink-0 bg-card border-r border-border sidebar-transition print:hidden ${collapsed ? "w-[68px]" : "w-60"}`}>
          <div className={`flex items-center border-b border-border h-[65px] px-3 ${collapsed ? "justify-center" : "justify-between px-4"}`}>
            {!collapsed && (
              <div className="min-w-0 pr-2">
                <p className="text-sm font-black text-foreground tracking-tight leading-tight whitespace-nowrap uppercase">EXATA</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  <span className="font-bold text-primary">{empresaName}</span>
                </p>
              </div>
            )}
            <div className="flex items-center gap-1 flex-shrink-0">
              {!collapsed && (
                <button
                  onClick={() => setShowAlertas(!showAlertas)}
                  className="relative h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  title="Alertas"
                >
                  <Bell className="h-4 w-4" />
                  {alertas.length > 0 && (
                    <span className={`absolute top-1 right-1 h-2 w-2 rounded-full ${alertas.some(a => a.tipo === "critico") ? "bg-destructive" : "bg-amber-500"}`} />
                  )}
                </button>
              )}
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex-shrink-0"
                title={collapsed ? "Expandir menu" : "Recolher menu"}
              >
                {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Painel de alertas */}
          {showAlertas && !collapsed && (
            <div className="border-b border-border bg-muted/20">
              {alertas.length === 0 ? (
                <div className="px-4 py-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Check className="h-3.5 w-3.5 text-green-500" />
                  Sem alertas ativos
                </div>
              ) : (
                <div className="divide-y divide-border max-h-64 overflow-y-auto">
                  {alertas.map(a => (
                    <button
                      key={a.id}
                      onClick={() => { if (a.tab) goTab(a.tab); setShowAlertas(false) }}
                      className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className={`h-3.5 w-3.5 flex-shrink-0 mt-0.5 ${a.tipo === "critico" ? "text-destructive" : "text-amber-500"}`} />
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-foreground leading-tight">{a.titulo}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{a.descricao}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <nav className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-2 py-3 space-y-1">
            {navVisiveis.map((item) => (
              <React.Fragment key={item.id}>
                <NavButton
                  {...item}
                  isActive={activeTab === item.id}
                  isCollapsed={collapsed}
                  onClick={() => goTab(item.id)}
                />
                {item.id === "relatorios" && activeTab === "relatorios" && !collapsed && (
                  <div className="ml-4 pl-3 border-l-2 border-border space-y-0.5 py-1">
                    {RELATORIOS_CONFIG.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setRelatorioAtivo(r.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-colors
                          ${relatorioAtivo === r.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}
                {item.id === "estoque" && activeTab === "estoque" && !collapsed && (
                  <div className="ml-4 pl-3 border-l-2 border-border space-y-0.5 py-1">
                    {ESTOQUE_ABAS_CONFIG.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => setEstoqueAbaAtiva(a.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-colors
                          ${estoqueAbaAtiva === a.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </React.Fragment>
            ))}
          </nav>

          <div className="px-2 py-3 border-t border-border space-y-1">
            {isSystemManager && (
              <>
                <NavButton
                  id="equipe"
                  label="Equipe"
                  sublabel="Gestão de usuários"
                  icon={Users}
                  isActive={activeTab === "equipe"}
                  isCollapsed={collapsed}
                  onClick={() => goTab("equipe")}
                />
                <NavButton
                  id="configuracoes"
                  label="Configurações"
                  sublabel="Preferências do sistema"
                  icon={Settings}
                  isActive={activeTab === "configuracoes"}
                  isCollapsed={collapsed}
                  onClick={() => goTab("configuracoes")}
                />
              </>
            )}
            <button
              onClick={handleSair}
              className={`w-full flex items-center rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all
                ${collapsed ? "justify-center h-10 w-10 mx-auto" : "gap-3 px-3 py-3"}`}
              title={collapsed ? "Sair" : undefined}
            >
              <LogOut className="h-[18px] w-[18px] flex-shrink-0" />
              {!collapsed && <span className="text-xs font-bold leading-tight">Sair</span>}
            </button>
            {!collapsed && (
              <p className="text-[9px] text-muted-foreground/50 font-medium text-center pt-2 pb-1">
                Construído para quem valoriza a precisão. Exata © 2026
              </p>
            )}
          </div>
        </aside>

        {/* OVERLAY MOBILE */}
        {mobileOpen && (
          <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />
        )}

        {/* SIDEBAR MOBILE */}
        <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-card border-r border-border flex flex-col transition-transform duration-200 ease-in-out lg:hidden print:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center justify-between px-5 h-[65px] border-b border-border">
            <div className="min-w-0 pr-2">
              <p className="text-sm font-black text-foreground tracking-tight uppercase">EXATA</p>
              <p className="text-[10px] text-muted-foreground truncate">
                <span className="font-bold text-primary">{empresaName}</span>
              </p>
            </div>
            <button onClick={() => setMobileOpen(false)} className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          <nav className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-3 space-y-1">
            {navVisiveis.map((item) => {
              const Icon = item.icon
              const isActive = activeTab === item.id
              return (
                <React.Fragment key={item.id}>
                  <button
                    onClick={() => goTab(item.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all
                      ${isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-bold leading-tight">{item.label}</span>
                      <span className={`text-[10px] leading-tight truncate ${isActive ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {item.sublabel}
                      </span>
                    </div>
                  </button>
                  {item.id === "relatorios" && isActive && (
                    <div className="ml-6 pl-3 border-l-2 border-border space-y-0.5 py-1">
                      {RELATORIOS_CONFIG.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => { setRelatorioAtivo(r.id); setMobileOpen(false) }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-colors
                            ${relatorioAtivo === r.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {item.id === "estoque" && isActive && (
                    <div className="ml-6 pl-3 border-l-2 border-border space-y-0.5 py-1">
                      {ESTOQUE_ABAS_CONFIG.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => { setEstoqueAbaAtiva(a.id); setMobileOpen(false) }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-colors
                            ${estoqueAbaAtiva === a.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}
                </React.Fragment>
              )
            })}
          </nav>

          <div className="px-3 py-3 border-t border-border space-y-1">
            {isSystemManager && (
              <>
                <button
                  onClick={() => goTab("equipe")}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all
                    ${activeTab === "equipe" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  <Users className="h-5 w-5 flex-shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-bold leading-tight">Equipe</span>
                    <span className={`text-[10px] leading-tight truncate ${activeTab === "equipe" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      Gestão de usuários
                    </span>
                  </div>
                </button>
                <button
                  onClick={() => goTab("configuracoes")}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all
                    ${activeTab === "configuracoes" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  <Settings className="h-5 w-5 flex-shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-bold leading-tight">Configurações</span>
                    <span className={`text-[10px] leading-tight truncate ${activeTab === "configuracoes" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      Preferências do sistema
                    </span>
                  </div>
                </button>
              </>
            )}
            <button
              onClick={handleSair}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all"
            >
              <LogOut className="h-5 w-5 flex-shrink-0" />
              <span className="text-sm font-bold">Sair</span>
            </button>
            <p className="text-[9px] text-muted-foreground/50 font-medium text-center pt-2">v4.0.0 Cloud</p>
          </div>
        </aside>

        {/* CONTEÚDO PRINCIPAL */}
        <div className="flex-1 flex flex-col min-w-0 print:w-full overflow-hidden">
          <div className="lg:hidden flex items-center px-4 pt-4 pb-0 print:hidden">
            <button onClick={() => setMobileOpen(true)} className="h-9 w-9 flex items-center justify-center rounded-xl text-muted-foreground hover:bg-muted transition-colors">
              <Menu className="h-5 w-5" />
            </button>
          </div>

          <main className="flex-1 overflow-auto px-4 lg:px-8 py-6 print:p-12">

            {empresaAtivaId && activeTab !== "configuracoes" && activeTab !== "equipe" && (
              <OnboardingChecklist
                empresaAtivaId={empresaAtivaId}
                onGoToTab={(tab) => goTab(tab as any)}
              />
            )}

            {activeTab === "dashboard" && <div className="animate-in fade-in duration-300"><DashboardTab empresaAtivaId={empresaAtivaId} /></div>}
            {activeTab === "gbo"       && <div className="animate-in fade-in duration-300"><GBOTab user={{ id: empresaAtivaId ?? "" }} empresaAtivaId={empresaAtivaId} /></div>}
            {activeTab === "pcp"       && <div className="animate-in fade-in duration-300"><PCPTab empresaAtivaId={empresaAtivaId} /></div>}
            {activeTab === "maquinas"  && <div className="animate-in fade-in duration-300"><MaquinasTab user={{ id: empresaAtivaId ?? "" }} empresaAtivaId={empresaAtivaId} /></div>}
            {activeTab === "manutencao"&& <div className="animate-in fade-in duration-300"><ManutencaoTab user={{ id: empresaAtivaId ?? "" }} empresaAtivaId={empresaAtivaId} /></div>}
            {activeTab === "apontamento"&&<div className="animate-in fade-in duration-300"><ApontamentoTab empresaAtivaId={empresaAtivaId} /></div>}
            {activeTab === "estoque"   && <div className="animate-in fade-in duration-300"><EstoqueTab empresaAtivaId={empresaAtivaId} abaSelecionada={estoqueAbaAtiva} onChangeAba={setEstoqueAbaAtiva} /></div>}
            {activeTab === "relatorios"&& <div className="animate-in fade-in duration-300"><RelatoriosTab empresaAtivaId={empresaAtivaId} relatorioSelecionado={relatorioAtivo} onChangeRelatorio={setRelatorioAtivo} /></div>}
            {activeTab === "excecoes"  && <div className="animate-in fade-in duration-300"><ExcecoesTab empresaAtivaId={empresaAtivaId} /></div>}
            {activeTab === "equipe"    && isSystemManager && <div className="animate-in fade-in duration-300"><EquipeTab /></div>}

            {activeTab === "configuracoes" && isSystemManager && (
              <div className="space-y-6 pb-12 animate-in fade-in duration-300">
                <div>
                  <h2 className="text-lg font-bold text-foreground">Configurações</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">Preferências e personalização do sistema</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                  {/* DADOS DA FÁBRICA */}
                  <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-border">
                      <h3 className="text-sm font-bold text-foreground">Dados da Fábrica</h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Informações gerais e operacionais</p>
                    </div>
                    <div className="p-6 space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5 col-span-2">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Nome da Fábrica</label>
                          <input type="text" value={confNome} onChange={e => setConfNome(e.target.value)}
                            className="w-full h-10 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">CNPJ</label>
                          <input type="text" value={confCnpj} onChange={e => setConfCnpj(e.target.value)} placeholder="00.000.000/0000-00"
                            className="w-full h-10 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Nº Funcionários</label>
                          <input type="text" value={confFuncionarios} onChange={e => setConfFuncionarios(e.target.value)} placeholder="Ex: 12"
                            className="w-full h-10 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Segmento</label>
                          <input type="text" value={confSegmento} onChange={e => setConfSegmento(e.target.value)} placeholder="Ex: Têxtil"
                            className="w-full h-10 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
                        </div>
                        <div className="space-y-1.5 col-span-2">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Endereço</label>
                          <input type="text" value={confEndereco} onChange={e => setConfEndereco(e.target.value)} placeholder="Rua, número, cidade"
                            className="w-full h-10 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
                        </div>
                        <div className="space-y-1.5 col-span-2">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Tempo Operacional Padrão</label>
                          <div className="flex gap-2">
                            <input type="number" placeholder="Ex: 8" value={defaultTime} onChange={e => setDefaultTime(e.target.value)}
                              className="flex-1 h-10 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
                            <Select value={defaultTimeUnit} onValueChange={(v: any) => setDefaultTimeUnit(v)}>
                              <SelectTrigger className="w-28 h-10 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-card border-border">
                                <SelectItem value="hours">Horas</SelectItem>
                                <SelectItem value="minutes">Minutos</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                      <button onClick={handleSaveFabrica} disabled={isSavingFabrica}
                        className="w-full h-11 flex items-center justify-center bg-primary text-primary-foreground font-bold uppercase tracking-widest text-[11px] rounded-xl hover:opacity-90 transition-all disabled:opacity-50">
                        {isSavingFabrica ? "Salvando..." : "Salvar Dados da Fábrica"}
                      </button>
                    </div>
                  </div>

                  {/* METAS DE PRODUÇÃO */}
                  <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-border">
                      <h3 className="text-sm font-bold text-foreground">Metas de Produção</h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Referências para os semáforos dos relatórios e dashboard</p>
                    </div>
                    <div className="p-6 space-y-4">
                      {[
                        { label: "OEE mínimo aceitável (%)", value: metaOEE, set: setMetaOEE, desc: "Abaixo deste valor o OEE aparece em vermelho" },
                        { label: "Taxa de refugo máxima (%)", value: metaRefugo, set: setMetaRefugo, desc: "Acima deste valor o refugo aparece em vermelho" },
                        { label: "Produtividade mínima (%)", value: metaProdutividade, set: setMetaProdutividade, desc: "Meta geral de produtividade da fábrica" },
                      ].map(({ label, value, set, desc }) => (
                        <div key={label} className="space-y-1.5">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{label}</label>
                          <input type="number" min="0" max="100" step="0.1" value={value} onChange={e => set(e.target.value)}
                            className="w-full h-10 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
                          <p className="text-[10px] text-muted-foreground pl-1">{desc}</p>
                        </div>
                      ))}
                      <button onClick={handleSaveMetas} disabled={isSavingMetas}
                        className="w-full h-11 flex items-center justify-center bg-primary text-primary-foreground font-bold uppercase tracking-widest text-[11px] rounded-xl hover:opacity-90 transition-all disabled:opacity-50 mt-2">
                        {isSavingMetas ? "Salvando..." : "Salvar Metas"}
                      </button>
                    </div>
                  </div>

                  {/* TURNOS */}
                  <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden lg:col-span-2">
                    <div className="px-6 py-4 border-b border-border">
                      <h3 className="text-sm font-bold text-foreground">Turnos de Produção</h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Defina os turnos para cálculos precisos de OEE e disponibilidade</p>
                    </div>
                    <div className="p-6 space-y-4">
                      {loadingTurnos ? (
                        <p className="text-xs text-muted-foreground animate-pulse">Carregando turnos...</p>
                      ) : turnos.length > 0 ? (
                        <div className="space-y-2">
                          {turnos.map(t => {
                            const diasLabel = ["D","S","T","Q","Q","S","S"]
                            return (
                              <div key={t.id} className="flex items-center justify-between p-4 bg-muted/30 border border-border rounded-xl">
                                <div className="flex items-center gap-4 min-w-0">
                                  <div>
                                    <p className="text-sm font-bold text-foreground">{t.nome}</p>
                                    <p className="text-[10px] text-muted-foreground">{t.hora_inicio} — {t.hora_fim}</p>
                                  </div>
                                  <div className="flex gap-1">
                                    {[0,1,2,3,4,5,6].map(d => (
                                      <span key={d} className={`text-[9px] font-bold h-5 w-5 rounded-full flex items-center justify-center
                                        ${t.dias_semana?.includes(String(d)) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                                        {diasLabel[d]}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                                <button onClick={() => t.id && handleDeleteTurno(t.id)}
                                  className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0 ml-3">
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Nenhum turno cadastrado.</p>
                      )}

                      <div className="border border-dashed border-border rounded-xl p-4 space-y-3">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Adicionar turno</p>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Nome</label>
                            <input type="text" value={novoTurno.nome} onChange={e => setNovoTurno(p => ({...p, nome: e.target.value}))} placeholder="Ex: Manhã"
                              className="w-full h-10 px-3 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Início</label>
                            <TimePicker value={novoTurno.hora_inicio} onChange={v => setNovoTurno(p => ({...p, hora_inicio: v}))} />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Fim</label>
                            <TimePicker value={novoTurno.hora_fim} onChange={v => setNovoTurno(p => ({...p, hora_fim: v}))} />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Dias da semana</label>
                          <div className="flex gap-2">
                            {[["0","Dom"],["1","Seg"],["2","Ter"],["3","Qua"],["4","Qui"],["5","Sex"],["6","Sáb"]].map(([val, label]) => (
                              <button key={val} onClick={() => toggleDiaTurno(val)}
                                className={`flex-1 h-9 rounded-lg text-[10px] font-bold transition-all
                                  ${novoTurno.dias_semana.includes(val) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <button onClick={handleAddTurno} disabled={salvandoTurno || !novoTurno.nome || !novoTurno.hora_inicio || !novoTurno.hora_fim}
                          className="w-full h-11 flex items-center justify-center gap-2 bg-primary text-primary-foreground font-bold uppercase tracking-widest text-[11px] rounded-xl hover:opacity-90 transition-all disabled:opacity-50">
                          {salvandoTurno ? "Criando..." : "Adicionar Turno"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* APARÊNCIA */}
                  <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-border">
                      <h3 className="text-sm font-bold text-foreground">Aparência</h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Escolha como o sistema é exibido na sua tela</p>
                    </div>
                    <div className="p-6 space-y-3">
                      {mounted && (
                        <React.Fragment>
                          {[
                            { value: "light",  label: "Claro",   description: "Fundo branco, ideal para ambientes iluminados",          icon: Sun     },
                            { value: "dark",   label: "Escuro",  description: "Fundo escuro, reduz fadiga visual à noite",              icon: Moon    },
                            { value: "system", label: "Sistema", description: "Segue automaticamente as configurações do dispositivo",  icon: Monitor },
                          ].map(({ value, label, description, icon: Icon }) => (
                            <button key={value} onClick={() => setTheme(value)}
                              className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl border transition-all text-left
                                ${theme === value ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:bg-muted/50"}`}>
                              <div className={`h-9 w-9 flex items-center justify-center rounded-lg flex-shrink-0
                                ${theme === value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                                <Icon className="h-4 w-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-bold ${theme === value ? "text-primary" : "text-foreground"}`}>{label}</p>
                                <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
                              </div>
                              <div className={`h-4 w-4 rounded-full border-2 flex-shrink-0 transition-all
                                ${theme === value ? "border-primary bg-primary" : "border-muted-foreground/30"}`}>
                                {theme === value && <div className="h-full w-full rounded-full bg-primary-foreground scale-50" />}
                              </div>
                            </button>
                          ))}
                        </React.Fragment>
                      )}
                    </div>
                  </div>

                  {/* MANUAL TÉCNICO */}
                  <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden lg:col-span-2">
                    <div className="px-6 py-4 border-b border-border">
                      <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                        <BookText className="h-4 w-4 text-primary" /> Manual Técnico
                      </h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Guia rápido de uso do sistema</p>
                    </div>
                    <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                      {[
                        { title: "Produto/Roteiro", desc: "Cadastre produtos com operações, tempos de ciclo e BOM (lista de materiais). A BOM é obrigatória para o controle automático de estoque." },
                        { title: "PCP", desc: "Programe ordens de produção com lógica Heijunka. Visualize no Kanban, calendário ou lista. Arraste OPs entre datas." },
                        { title: "Máquinas", desc: "Cadastre postos de trabalho com capacidade diária e tempo de setup. Vincule às operações do roteiro." },
                        { title: "Apontamento", desc: "Selecione a OP e a operação, inicie o cronômetro e monitore o semáforo de eficiência em tempo real. Pausas registram o motivo." },
                        { title: "Estoque", desc: "Receba material manualmente. O consumo de MP e a entrada de PA são automáticos ao encerrar OPs. Custo médio ponderado calculado automaticamente." },
                        { title: "Exceções", desc: "Crie grupos e motivos de parada. Ao pausar um apontamento com motivo de manutenção, o sistema sugere abrir uma OS automaticamente." },
                        { title: "Manutenção", desc: "Gerencie ordens de serviço corretivas e preventivas por ativo. Status atualizável diretamente na lista." },
                        { title: "Relatórios", desc: "OEE por máquina, refugo por produto, ciclo real vs planejado, consumo de materiais e ranking de paradas. Filtros por período." },
                        { title: "Dashboard", desc: "Visão em tempo real: status das máquinas, OPs em andamento com progresso, estoque crítico e produção por máquina. Auto-refresh a cada 2 minutos." },
                        { title: "Equipe", desc: "Convide colaboradores por e-mail e atribua roles que definem quais módulos cada usuário pode acessar. Gerencie permissões a qualquer momento." },
                      ].map(({ title, desc }) => (
                        <div key={title} className="space-y-1 border-l-2 border-primary/30 pl-3">
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{title}</p>
                          <p className="text-sm text-foreground/80 leading-relaxed">{desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </React.Fragment>
  )
}
