"use client"

import React, { useState, useEffect } from "react"
import { supabase } from "@/components/supabase"
import { CheckCircle2, Circle, ChevronDown, ChevronUp, X } from "lucide-react"

interface Props {
  empresaAtivaId: string
  onGoToTab: (tab: string) => void
}

interface Step {
  id: string
  label: string
  description: string
  tab: string
  done: boolean
}

const DISMISSED_KEY = "exata_onboarding_dismissed"

export function OnboardingChecklist({ empresaAtivaId, onGoToTab }: Props) {
  const [steps, setSteps] = useState<Step[]>([
    { id: "maquina",    label: "Cadastrar uma máquina",         description: "Registre pelo menos um posto de trabalho.",         tab: "maquinas",    done: false },
    { id: "produto",    label: "Cadastrar um produto",          description: "Crie um produto com seu roteiro de operações.",      tab: "gbo",         done: false },
    { id: "excecao",    label: "Cadastrar grupos de exceção",   description: "Crie os motivos de parada para usar nos apontamentos.", tab: "excecoes",  done: false },
    { id: "estoque",    label: "Cadastrar itens no estoque",    description: "Registre matérias-primas e produtos acabados.",      tab: "estoque",     done: false },
    { id: "ordem",      label: "Criar uma ordem de produção",   description: "Programe sua primeira OP no PCP.",                  tab: "pcp",         done: false },
    { id: "apontamento",label: "Registrar um apontamento",      description: "Aponte a execução de uma ordem de produção.",       tab: "apontamento", done: false },
  ])
  const [collapsed, setCollapsed] = useState(false)
  const [dismissed,  setDismissed]  = useState(false)
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    const key = `${DISMISSED_KEY}_${empresaAtivaId}`
    if (localStorage.getItem(key) === "true") {
      setDismissed(true)
      return
    }
    checkProgress()
  }, [empresaAtivaId])

  const checkProgress = async () => {
    setLoading(true)
    const [maq, prod, excecao, estoque, ordem, apon] = await Promise.all([
      supabase.from("maquinas").select("id", { count: "exact", head: true }).eq("empresa_id", empresaAtivaId),
      supabase.from("produtos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaAtivaId),
      supabase.from("excecao_grupos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaAtivaId),
      supabase.from("insumos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaAtivaId),
      supabase.from("ordens_producao").select("id", { count: "exact", head: true }).eq("empresa_id", empresaAtivaId),
      supabase.from("apontamentos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaAtivaId),
    ])

    const updated = [
      { id: "maquina",     done: (maq.count     ?? 0) > 0 },
      { id: "produto",     done: (prod.count     ?? 0) > 0 },
      { id: "excecao",     done: (excecao.count  ?? 0) > 0 },
      { id: "estoque",     done: (estoque.count  ?? 0) > 0 },
      { id: "ordem",       done: (ordem.count    ?? 0) > 0 },
      { id: "apontamento", done: (apon.count     ?? 0) > 0 },
    ]

    setSteps(prev => prev.map(s => ({
      ...s,
      done: updated.find(u => u.id === s.id)?.done ?? s.done
    })))

    if (updated.every(u => u.done)) {
      dismiss()
    }

    setLoading(false)
  }

  const dismiss = () => {
    localStorage.setItem(`${DISMISSED_KEY}_${empresaAtivaId}`, "true")
    setDismissed(true)
  }

  if (dismissed || loading) return null

  const done  = steps.filter(s => s.done).length
  const total = steps.length
  const pct   = Math.round((done / total) * 100)

  return (
    <div className="mb-6 bg-card border border-border rounded-2xl shadow-sm overflow-hidden animate-in fade-in duration-300">
      <div className="px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0">
            <div className="relative h-9 w-9">
              <svg className="h-9 w-9 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15" fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="15" fill="none"
                  stroke="hsl(var(--primary))" strokeWidth="3"
                  strokeDasharray={`${pct * 0.942} 100`}
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black text-foreground">
                {done}/{total}
              </span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">Configure sua fábrica</p>
            <p className="text-[11px] text-muted-foreground">{pct === 0 ? "Siga os passos abaixo para começar" : `${pct}% concluído`}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          <button
            onClick={dismiss}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Dispensar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="border-t border-border divide-y divide-border">
          {steps.map((step) => (
            <div
              key={step.id}
              className={`flex items-center gap-4 px-5 py-3.5 transition-colors
                ${step.done ? "opacity-50" : "hover:bg-muted/40 cursor-pointer"}`}
              onClick={step.done ? undefined : () => onGoToTab(step.tab)}
            >
              {step.done
                ? <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                : <Circle className="h-5 w-5 text-muted-foreground/40 flex-shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-bold leading-tight ${step.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                  {step.label}
                </p>
                {!step.done && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{step.description}</p>
                )}
              </div>
              {!step.done && (
                <span className="text-[10px] font-bold text-primary uppercase tracking-wider flex-shrink-0">
                  Ir →
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
