"use client"

import React, { useState, useEffect } from "react"
import { Users } from "lucide-react"
import { supabase } from "@/components/supabase"

interface UserProfile {
  id: string
  email: string
  nome?: string
  empresa_id: string
}

interface Permissao {
  id: string
  user_id: string
  aba_id: string
  empresa_id: string
}

interface EquipeTabProps {
  user: { id: string; email?: string }
  empresaAtivaId: string | null
}

export function EquipeTab({ user, empresaAtivaId }: EquipeTabProps) {
  const [equipe, setEquipe] = useState<UserProfile[]>([])
  const [permissoes, setPermissoes] = useState<Permissao[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const abasDisponiveis = ["gbo", "pcp", "apontamento", "maquinas", "manutencao"]

  const carregarEquipe = async () => {
    if (!empresaAtivaId) return
    setIsLoading(true)

    // Consulta direta ao banco, o RLS (se ativo) filtra automaticamente
    const { data: mem } = await supabase.from("perfis").select("*").eq("empresa_id", empresaAtivaId)
    const { data: perm } = await supabase.from("permissoes").select("*").eq("empresa_id", empresaAtivaId)

    setEquipe((mem as UserProfile[]) || [])
    setPermissoes((perm as Permissao[]) || [])
    setIsLoading(false)
  }

  useEffect(() => { 
    console.log("Empresa Ativa ID:", empresaAtivaId)
    carregarEquipe() 
  }, [empresaAtivaId])

  const togglePermissao = async (userId: string, aba: string) => {
    const existing = permissoes.find(p => p.user_id === userId && p.aba_id === aba)
    
    if (existing) {
      await supabase.from("permissoes").delete().eq("id", existing.id)
    } else {
      await supabase.from("permissoes").insert({ user_id: userId, aba_id: aba, empresa_id: empresaAtivaId })
    }
    carregarEquipe()
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-black uppercase flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" /> Equipe
        </h2>
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-[10px] uppercase font-bold text-muted-foreground">
            <tr>
              <th className="px-6 py-4 text-left">Usuário</th>
              <th className="px-6 py-4 text-left">Permissões</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {equipe.map((membro) => (
              <tr key={membro.id} className="hover:bg-muted/10 transition-colors">
                <td className="px-6 py-4 font-bold text-foreground">{membro.email}</td>
                <td className="px-6 py-4 flex gap-2 flex-wrap">
                  {abasDisponiveis.map(aba => {
                    const temPermissao = permissoes.some(p => p.user_id === membro.id && p.aba_id === aba)
                    return (
                      <button 
                        key={aba} 
                        onClick={() => togglePermissao(membro.id, aba)} 
                        className={`px-3 py-1 rounded-md text-[10px] font-bold transition-colors ${
                          temPermissao 
                            ? "bg-primary text-primary-foreground shadow-sm" 
                            : "bg-muted text-muted-foreground hover:bg-muted/80 border border-border"
                        }`}
                      >
                        {aba}
                      </button>
                    )
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {equipe.length === 0 && !isLoading && (
          <div className="p-8 text-center text-muted-foreground text-xs uppercase tracking-widest">
            Nenhum membro registado nesta empresa.
          </div>
        )}
        
        {isLoading && (
          <div className="p-8 text-center text-muted-foreground text-xs uppercase tracking-widest animate-pulse">
            A carregar equipa...
          </div>
        )}
      </div>
    </div>
  )
}
