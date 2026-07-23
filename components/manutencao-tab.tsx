"use client"

import React, { useState, useEffect } from "react"
import { supabase } from "@/components/supabase"
import { useToast } from "@/hooks/use-toast"
import { Plus, Wrench, CheckCircle2, Clock, AlertTriangle, Trash2, Calendar } from "lucide-react"
import { DatePicker } from "@/components/date-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface Manutencao {
  id: string
  maquina_id: string
  maquina_nome: string
  maquina_codigo?: string
  tipo: "preventiva" | "corretiva"
  status: "pendente" | "em_execucao" | "concluida"
  data_programada: string
  descricao: string
}

export function ManutencaoTab({ user, empresaAtivaId }: { user: any, empresaAtivaId: string | null }) {
  const { toast } = useToast()
  const [registros, setRegistros] = useState<Manutencao[]>([])
  const [maquinas, setMaquinas] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [maquinaId, setMaquinaId] = useState("")
  const [tipo, setTipo] = useState<"preventiva" | "corretiva">("preventiva")
  const [data, setData] = useState("")
  const [descricao, setDescricao] = useState("")

  useEffect(() => {
    if (empresaAtivaId) {
      loadData()
    }
  }, [empresaAtivaId])

  const loadData = async () => {
    if (!empresaAtivaId) return

    try {
      const [{ data: maqData, error: maqError }, { data: manDataRaw, error: manError }] = await Promise.all([
        supabase.from("maquinas").select("*").eq("empresa_id", empresaAtivaId),
        supabase.from("manutencao").select("*, maquinas(nome, codigo)").eq("empresa_id", empresaAtivaId).order("data_programada")
      ])

      if (maqError) throw maqError
      if (manError) throw manError

      const manData = (manDataRaw || []).map((m: any) => ({
        ...m,
        maquina_nome: m.maquinas?.nome,
        maquina_codigo: m.maquinas?.codigo,
      }))

      setMaquinas(maqData || [])
      setRegistros(manData)
    } catch (e) {
      toast({ title: "Erro", description: "Falha ao carregar dados.", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const handleSalvar = async () => {
    if (!maquinaId || !data || !descricao) {
      toast({ title: "Dados incompletos", description: "Preencha máquina, data e descrição.", variant: "destructive" })
      return
    }

    if (!empresaAtivaId) {
      toast({ title: "Erro", description: "Empresa ativa não identificada.", variant: "destructive" })
      return
    }

    const { error } = await supabase.from("manutencao").insert([{
      empresa_id: empresaAtivaId,
      maquina_id: maquinaId,
      tipo,
      data_programada: data,
      descricao,
      status: "pendente"
    }])

    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" })
      return
    }

    toast({ title: "✅ Agendado", description: "Manutenção registrada com sucesso." })
    loadData()
    setDescricao("")
  }

  const handleStatusChange = async (id: string, novoStatus: string) => {
    if (!empresaAtivaId) return

    const { error } = await supabase.from("manutencao").update({ status: novoStatus }).eq("id", id).eq("empresa_id", empresaAtivaId)
    if (!error) loadData()
  }

  const handleExcluir = async (id: string) => {
    if (!empresaAtivaId) return

    const { error } = await supabase.from("manutencao").delete().eq("id", id).eq("empresa_id", empresaAtivaId)
    if (!error) loadData()
  }

  return (
    <div className="flex flex-col xl:flex-row gap-8 pb-12">
      <div className="xl:w-[35%] bg-card p-6 rounded-2xl border border-border shadow-sm space-y-5 h-fit">
        <h3 className="font-bold text-foreground flex items-center gap-2 border-b border-border pb-3">
          <Wrench className="h-4 w-4 text-primary" /> Nova Manutenção
        </h3>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Máquina</label>
            <Select value={maquinaId} onValueChange={setMaquinaId}>
              <SelectTrigger className="w-full h-11 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary">
                <SelectValue placeholder="Selecione o equipamento" />
              </SelectTrigger>
              <SelectContent>
                {maquinas.map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.codigo} - {m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Tipo</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setTipo("preventiva")} className={`h-10 rounded-xl text-xs font-bold border ${tipo === "preventiva" ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>Preventiva</button>
              <button onClick={() => setTipo("corretiva")} className={`h-10 rounded-xl text-xs font-bold border ${tipo === "corretiva" ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>Corretiva</button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Data Programada</label>
            <DatePicker value={data} onChange={setData} />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">Descrição</label>
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className="w-full h-11 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none" placeholder="Motivo da manutenção" />
          </div>
          <button onClick={handleSalvar} className="w-full h-12 bg-primary text-primary-foreground rounded-xl font-bold text-xs uppercase shadow-md">Agendar</button>
        </div>
      </div>

      <div className="xl:w-[65%] bg-card rounded-3xl border border-border p-6 shadow-sm">
        <h3 className="text-lg font-bold text-foreground mb-6">Agenda de Manutenção</h3>
        <div className="space-y-3">
          {registros.map(m => (
            <div key={m.id} className="p-4 border border-border rounded-2xl flex items-center justify-between gap-4">
              <div className="flex gap-4 items-center">
                <div className={`h-10 w-10 rounded-full flex items-center justify-center ${m.status === "concluida" ? "bg-green-500/10 text-green-500" : "bg-amber-500/10 text-amber-500"}`}>
                  {m.tipo === "preventiva" ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                </div>
                <div>
                  <p className="font-bold text-sm text-foreground">{m.maquina_codigo}</p>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">{m.maquina_nome} · {m.descricao} · {m.data_programada.split("-").reverse().join("/")}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Select value={m.status} onValueChange={(val) => handleStatusChange(m.id, val)}>
                  <SelectTrigger className="h-9 w-36 rounded-lg border border-border bg-input text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pendente">Pendente</SelectItem>
                    <SelectItem value="em_execucao">Em execução</SelectItem>
                    <SelectItem value="concluida">Concluída</SelectItem>
                  </SelectContent>
                </Select>
                <button onClick={() => handleExcluir(m.id)} className="h-9 w-9 flex items-center justify-center rounded-lg border border-border hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
