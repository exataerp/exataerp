"use client"

import React, { useState, useEffect } from "react"
import { supabase } from "@/components/supabase"
import { useToast } from "@/hooks/use-toast"
import { Plus, Trash2, ChevronDown, ChevronRight, Tag, Layers } from "lucide-react"

interface Grupo {
  id: string
  nome: string
  subgrupos: Subgrupo[]
}

interface Subgrupo {
  id: string
  grupo_id: string
  nome: string
}

export function ExcecoesTab({ empresaAtivaId }: { empresaAtivaId?: string | null }) {
  const { toast } = useToast()
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [loading, setLoading] = useState(true)
  const [expandido, setExpandido] = useState<string | null>(null)

  const [novoGrupo, setNovoGrupo] = useState("")
  const [salvandoGrupo, setSalvandoGrupo] = useState(false)

  const [novoSubgrupo, setNovoSubgrupo] = useState<Record<string, string>>({})
  const [salvandoSub, setSalvandoSub] = useState<string | null>(null)

  const loadGrupos = async () => {
    setLoading(true)
    const { data: gData } = await supabase
      .from("excecao_grupos")
      .select("id, nome")
      .eq("empresa_id", empresaAtivaId!)
      .order("nome")

    const { data: sData } = await supabase
      .from("excecao_subgrupos")
      .select("id, grupo_id, nome")
      .eq("empresa_id", empresaAtivaId!)
      .order("nome")

    const formatted: Grupo[] = (gData || []).map((g: any) => ({
      id: g.id,
      nome: g.nome,
      subgrupos: (sData || []).filter((s: any) => s.grupo_id === g.id),
    }))

    setGrupos(formatted)
    setLoading(false)
  }

  useEffect(() => {
    if (empresaAtivaId) loadGrupos()
  }, [empresaAtivaId])

  const handleAddGrupo = async () => {
    if (!novoGrupo.trim()) return
    setSalvandoGrupo(true)
    const { data, error } = await supabase
      .from("excecao_grupos")
      .insert({ nome: novoGrupo.trim(), empresa_id: empresaAtivaId })
      .select()
      .single()

    if (error) {
      toast({ title: "Erro ao criar grupo", description: error.message, variant: "destructive" })
    } else {
      setGrupos(prev => [...prev, { id: data.id, nome: data.nome, subgrupos: [] }])
      setExpandido(data.id)
      setNovoGrupo("")
      toast({ title: "✅ Grupo criado", description: data.nome })
    }
    setSalvandoGrupo(false)
  }

  const handleDeleteGrupo = async (id: string, nome: string) => {
    const { error } = await supabase.from("excecao_grupos").delete().eq("id", id)
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" })
    } else {
      setGrupos(prev => prev.filter(g => g.id !== id))
      toast({ title: "Grupo removido", description: nome })
    }
  }

  const handleAddSubgrupo = async (grupoId: string) => {
    const nome = novoSubgrupo[grupoId]?.trim()
    if (!nome) return
    setSalvandoSub(grupoId)
    const { data, error } = await supabase
      .from("excecao_subgrupos")
      .insert({ nome, grupo_id: grupoId, empresa_id: empresaAtivaId })
      .select()
      .single()

    if (error) {
      toast({ title: "Erro ao criar subgrupo", description: error.message, variant: "destructive" })
    } else {
      setGrupos(prev => prev.map(g =>
        g.id === grupoId
          ? { ...g, subgrupos: [...g.subgrupos, { id: data.id, grupo_id: grupoId, nome: data.nome }] }
          : g
      ))
      setNovoSubgrupo(prev => ({ ...prev, [grupoId]: "" }))
      toast({ title: "✅ Motivo adicionado", description: data.nome })
    }
    setSalvandoSub(null)
  }

  const handleDeleteSubgrupo = async (grupoId: string, subId: string, nome: string) => {
    const { error } = await supabase.from("excecao_subgrupos").delete().eq("id", subId)
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" })
    } else {
      setGrupos(prev => prev.map(g =>
        g.id === grupoId
          ? { ...g, subgrupos: g.subgrupos.filter(s => s.id !== subId) }
          : g
      ))
      toast({ title: "Motivo removido", description: nome })
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground text-xs font-bold uppercase tracking-widest animate-pulse">
        Carregando exceções...
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h2 className="text-lg font-bold text-foreground">Cadastro de Exceções</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Crie grupos e motivos de parada para usar nos apontamentos</p>
      </div>

      {/* Novo grupo */}
      <div className="bg-card border border-border rounded-2xl shadow-sm p-6">
        <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" /> Novo Grupo
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={novoGrupo}
            onChange={e => setNovoGrupo(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAddGrupo()}
            placeholder="Ex: Manutenção, RH, Segurança..."
            className="flex-1 h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
          />
          <button
            onClick={handleAddGrupo}
            disabled={salvandoGrupo || !novoGrupo.trim()}
            className="h-11 px-5 flex items-center gap-2 bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest rounded-xl hover:opacity-90 transition-all disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {salvandoGrupo ? "Criando..." : "Criar Grupo"}
          </button>
        </div>
      </div>

      {/* Lista de grupos */}
      {grupos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-card border border-border rounded-2xl">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <Tag className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-bold text-foreground">Nenhum grupo cadastrado</p>
          <p className="text-xs text-muted-foreground mt-1">Crie um grupo acima para começar</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grupos.map(grupo => (
            <div key={grupo.id} className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">

              {/* Header do grupo */}
              <div className="flex items-center justify-between px-5 py-4">
                <button
                  onClick={() => setExpandido(expandido === grupo.id ? null : grupo.id)}
                  className="flex items-center gap-3 flex-1 text-left"
                >
                  {expandido === grupo.id
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  }
                  <div>
                    <p className="text-sm font-bold text-foreground">{grupo.nome}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {grupo.subgrupos.length} {grupo.subgrupos.length === 1 ? "motivo" : "motivos"} cadastrados
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => handleDeleteGrupo(grupo.id, grupo.nome)}
                  className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* Subgrupos expandidos */}
              {expandido === grupo.id && (
                <div className="border-t border-border">

                  {/* Subgrupos existentes */}
                  {grupo.subgrupos.length > 0 && (
                    <div className="divide-y divide-border">
                      {grupo.subgrupos.map(sub => (
                        <div key={sub.id} className="flex items-center justify-between px-6 py-3">
                          <div className="flex items-center gap-3">
                            <div className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                            <span className="text-sm text-foreground">{sub.nome}</span>
                          </div>
                          <button
                            onClick={() => handleDeleteSubgrupo(grupo.id, sub.id, sub.nome)}
                            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Input novo subgrupo */}
                  <div className="px-5 py-4 bg-muted/20 flex gap-2">
                    <input
                      type="text"
                      value={novoSubgrupo[grupo.id] || ""}
                      onChange={e => setNovoSubgrupo(prev => ({ ...prev, [grupo.id]: e.target.value }))}
                      onKeyDown={e => e.key === "Enter" && handleAddSubgrupo(grupo.id)}
                      placeholder={`Novo motivo em ${grupo.nome}...`}
                      className="flex-1 h-10 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all"
                    />
                    <button
                      onClick={() => handleAddSubgrupo(grupo.id)}
                      disabled={salvandoSub === grupo.id || !novoSubgrupo[grupo.id]?.trim()}
                      className="h-10 px-4 flex items-center gap-1.5 bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest rounded-xl hover:opacity-90 transition-all disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {salvandoSub === grupo.id ? "..." : "Adicionar"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
