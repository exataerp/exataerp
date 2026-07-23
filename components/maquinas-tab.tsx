"use client"

import React, { useState, useEffect } from "react"
import { supabase } from "@/components/supabase"
import { useToast } from "@/hooks/use-toast"
import { Plus, Trash2, Settings, Power, Wrench, Ban, Activity, Factory, Pencil, ChevronDown } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

interface Maquina {
  id: string
  codigo: string
  nome: string
  setor: string
  capacidade_diaria: number
  tempo_setup_padrao: number
  status: "ativa" | "parada" | "manutencao" | "inativa"
  observacao: string
}

export function MaquinasTab({ user, empresaAtivaId }: { user: any, empresaAtivaId: string | null }) {
  const { toast } = useToast()
  const [maquinas, setMaquinas] = useState<Maquina[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [codigo, setCodigo] = useState("")
  const [nome, setNome] = useState("")
  const [setor, setSetor] = useState("")
  const [capacidade, setCapacidade] = useState("")
  const [setup, setSetup] = useState("")
  const [observacao, setObservacao] = useState("")

  useEffect(() => {
    if (empresaAtivaId) {
      loadMaquinas()
    }
  }, [empresaAtivaId])

  const loadMaquinas = async () => {
    if (!empresaAtivaId) return

    try {
      const { data, error } = await supabase
        .from("maquinas")
        .select("*")
        .eq("empresa_id", empresaAtivaId)
        .order("created_at", { ascending: false })

      if (error) throw error
      setMaquinas((data || []) as Maquina[])
    } catch (e: any) {
      toast({ title: "Erro de conexão", description: "Não foi possível carregar o parque fabril.", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSalvar = async () => {
    if (!codigo.trim() || !nome.trim()) {
      toast({ title: "Dados incompletos", description: "Código e Nome são obrigatórios.", variant: "destructive" })
      return
    }

    if (!empresaAtivaId) {
      toast({ title: "Erro", description: "Empresa ativa não identificada.", variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      const payload = {
        codigo: codigo.trim(),
        nome: nome.trim(),
        setor: setor.trim(),
        capacidade_diaria: parseFloat(capacidade) || 0,
        tempo_setup_padrao: parseFloat(setup) || 0,
        observacao: observacao.trim()
      }

      if (editingId) {
        const { error } = await supabase
          .from("maquinas")
          .update(payload)
          .eq("id", editingId)
          .eq("empresa_id", empresaAtivaId)

        if (error) throw error

        setMaquinas(maquinas.map(m => m.id === editingId ? { ...m, ...payload } : m))
        toast({ title: "✅ Máquina Atualizada", description: "Os dados foram alterados com sucesso." })
      } else {
        const newPayload = { ...payload, status: "ativa", empresa_id: empresaAtivaId }
        const { data, error } = await supabase
          .from("maquinas")
          .insert([newPayload])
          .select()
          .single()

        if (error) throw error

        setMaquinas([data as Maquina, ...maquinas])
        toast({ title: "✅ Máquina Cadastrada", description: "O recurso foi adicionado ao parque fabril." })
      }
      
      resetForm()
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const handleEditar = (maq: Maquina) => {
    setEditingId(maq.id)
    setCodigo(maq.codigo)
    setNome(maq.nome)
    setSetor(maq.setor)
    setCapacidade(maq.capacidade_diaria.toString())
    setSetup(maq.tempo_setup_padrao.toString())
    setObservacao(maq.observacao)
  }

  const resetForm = () => {
    setEditingId(null)
    setCodigo("")
    setNome("")
    setSetor("")
    setCapacidade("")
    setSetup("")
    setObservacao("")
  }

  const handleExcluir = async (id: string) => {
    if (!empresaAtivaId) return

    try {
      const { error } = await supabase.from("maquinas").delete().eq("id", id).eq("empresa_id", empresaAtivaId)
      if (error) throw error
      
      setMaquinas(maquinas.filter(m => m.id !== id))
      toast({ title: "Máquina removida", description: "O recurso foi excluído do sistema." })
    } catch (e: any) {
      toast({ title: "Erro ao excluir", description: "Não foi possível remover a máquina.", variant: "destructive" })
    }
  }

  const handleStatusChange = async (id: string, newStatus: Maquina["status"]) => {
    if (!empresaAtivaId) return

    try {
      setMaquinas(maquinas.map(m => m.id === id ? { ...m, status: newStatus } : m))
      
      const { error } = await supabase
        .from("maquinas")
        .update({ status: newStatus })
        .eq("id", id)
        .eq("empresa_id", empresaAtivaId)

      if (error) throw error
      toast({ title: "Status alterado", description: "O status operacional foi atualizado." })
    } catch (e: any) {
      loadMaquinas() 
      toast({ title: "Erro", description: "Não foi possível alterar o status.", variant: "destructive" })
    }
  }

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "ativa": return { icon: Power, color: "text-green-500", bg: "bg-green-500/10", label: "Ativa" }
      case "manutencao": return { icon: Wrench, color: "text-amber-500", bg: "bg-amber-500/10", label: "Manutenção" }
      case "parada": return { icon: Ban, color: "text-destructive", bg: "bg-destructive/10", label: "Parada" }
      case "inativa": return { icon: Settings, color: "text-muted-foreground", bg: "bg-muted", label: "Inativa" }
      default: return { icon: Power, color: "text-primary", bg: "bg-primary/10", label: "Desconhecido" }
    }
  }

  return (
    <div className="flex flex-col xl:flex-row gap-8 pb-12">
      <div className="xl:w-[35%] flex flex-col gap-6">
        <div className="bg-card p-6 rounded-2xl shadow-sm border border-border space-y-5">
          <div className="border-b border-border pb-3">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <Factory className="h-4 w-4 text-primary" />
              {editingId ? "Editar Posto de Trabalho" : "Novo Posto de Trabalho"}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-1">Cadastre recursos produtivos para o PCP</p>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Código</label>
                <input type="text" placeholder="Ex: MAQ-01" value={codigo} onChange={(e) => setCodigo(e.target.value)} className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Nome/Modelo</label>
                <input type="text" placeholder="Ex: Torno CNC" value={nome} onChange={(e) => setNome(e.target.value)} className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Setor / Área</label>
              <input type="text" placeholder="Ex: Usinagem Pesada" value={setor} onChange={(e) => setSetor(e.target.value)} className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Capacidade (Horas/Dia)</label>
                <input type="number" min="0" step="0.5" placeholder="Ex: 8.5" value={capacidade} onChange={(e) => setCapacidade(e.target.value)} className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Setup Padrão (Min)</label>
                <input type="number" min="0" placeholder="Ex: 45" value={setup} onChange={(e) => setSetup(e.target.value)} className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Observações Técnicas</label>
              <input type="text" placeholder="Restrições ou detalhes da máquina" value={observacao} onChange={(e) => setObservacao(e.target.value)} className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all" />
            </div>

            <div className="flex gap-2 mt-2">
              <button 
                onClick={handleSalvar} 
                disabled={isSaving}
                className="flex-1 h-12 flex items-center justify-center bg-primary text-primary-foreground font-bold uppercase tracking-widest text-xs rounded-xl shadow-md hover:opacity-90 transition-all disabled:opacity-50"
              >
                <Plus className="h-4 w-4 mr-2" /> {isSaving ? "Processando..." : editingId ? "Atualizar" : "Cadastrar"}
              </button>
              {editingId && (
                <button 
                  onClick={resetForm}
                  className="px-4 h-12 flex items-center justify-center bg-muted text-muted-foreground font-bold uppercase tracking-widest text-xs rounded-xl hover:bg-border transition-all"
                >
                  Cancelar
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="xl:w-[65%] flex flex-col">
        <div className="bg-card rounded-3xl shadow-sm border border-border p-6 min-h-[500px]">
          <div className="flex items-center justify-between border-b border-border pb-4 mb-4">
            <div>
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" /> Parque Fabril
              </h3>
              <p className="text-sm text-muted-foreground mt-1">Visão geral dos recursos produtivos cadastrados</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black text-foreground">{maquinas.length}</p>
              <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Máquinas</p>
            </div>
          </div>

          {isLoading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground text-xs font-bold uppercase tracking-widest animate-pulse">
              Carregando parque fabril...
            </div>
          ) : maquinas.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-50 py-12">
              <Factory className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-sm font-bold text-foreground">Nenhuma máquina cadastrada</p>
              <p className="text-xs text-muted-foreground mt-1">Use o painel lateral para registrar seu primeiro recurso.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {maquinas.map((maq) => {
                const config = getStatusConfig(maq.status)
                const StatusIcon = config.icon
                return (
                  <div key={maq.id} className="border border-border rounded-2xl p-4 flex flex-col gap-3 hover:border-primary/50 transition-colors bg-background">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 pr-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-black text-foreground truncate">{maq.codigo}</span>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-muted text-muted-foreground rounded-md">{maq.nome}</span>
                      </div>
                      
                      <DropdownMenu>
                        <DropdownMenuTrigger className="outline-none">
                          <div className={`h-8 px-2.5 flex-shrink-0 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity ${config.bg} ${config.color}`}>
                            <StatusIcon className="h-3.5 w-3.5" />
                            <span className="text-[10px] uppercase font-bold tracking-wider">{config.label}</span>
                            <ChevronDown className="h-3 w-3 opacity-60 ml-0.5" />
                          </div>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40 bg-card border border-border p-1.5 rounded-xl shadow-xl z-50">
                          <DropdownMenuItem onClick={() => handleStatusChange(maq.id, "ativa")} className="text-xs font-bold flex items-center gap-2 cursor-pointer hover:bg-muted rounded-lg px-2 py-2 text-green-500">
                            <Power className="h-4 w-4" /> Ativa
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleStatusChange(maq.id, "manutencao")} className="text-xs font-bold flex items-center gap-2 cursor-pointer hover:bg-muted rounded-lg px-2 py-2 text-amber-500">
                            <Wrench className="h-4 w-4" /> Manutenção
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleStatusChange(maq.id, "parada")} className="text-xs font-bold flex items-center gap-2 cursor-pointer hover:bg-muted rounded-lg px-2 py-2 text-destructive">
                            <Ban className="h-4 w-4" /> Parada
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleStatusChange(maq.id, "inativa")} className="text-xs font-bold flex items-center gap-2 cursor-pointer hover:bg-muted rounded-lg px-2 py-2 text-muted-foreground">
                            <Settings className="h-4 w-4" /> Inativa
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-xs border-t border-border pt-3 mt-1">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-0.5">Capacidade</p>
                        <p className="font-medium text-foreground">{maq.capacidade_diaria} h/dia</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-0.5">Setup</p>
                        <p className="font-medium text-foreground">{maq.tempo_setup_padrao} min</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <span className="text-[11px] text-muted-foreground truncate">{maq.setor || "Sem setor definido"}</span>
                      <div className="flex gap-1">
                        <button 
                          onClick={() => handleEditar(maq)}
                          className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                          title="Editar máquina"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button 
                          onClick={() => handleExcluir(maq.id)}
                          className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          title="Remover máquina"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
