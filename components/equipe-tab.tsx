'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Users, UserPlus, X, Loader2, Check, AlertCircle, Mail, ChevronDown, ChevronUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { ROLE_LABELS, type RoleName } from '@/lib/permissions'

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------
interface Membro {
  id: string
  user_id: string
  email: string
  nome: string
  status: string
  first_access_completed: boolean
  roles: { role_name: RoleName; role_display_name: string }[]
}

interface RoleDisponivel {
  id: string
  name: RoleName
  display_name: string
  description: string
}

// ------------------------------------------------------------
// Componente principal
// ------------------------------------------------------------
export function EquipeTab() {
  const { session, supabaseUser } = useAuth()
  const supabase = createClient()

  const [membros, setMembros]               = useState<Membro[]>([])
  const [rolesDisponiveis, setRolesDisponiveis] = useState<RoleDisponivel[]>([])
  const [carregando, setCarregando]         = useState(true)
  const [expandido, setExpandido]           = useState<string | null>(null)

  // Formulário de convite
  const [showConvite, setShowConvite]       = useState(false)
  const [emailConvite, setEmailConvite]     = useState('')
  const [nomeConvite, setNomeConvite]       = useState('')
  const [rolesSelecionados, setRolesSelecionados] = useState<RoleName[]>([])
  const [enviando, setEnviando]             = useState(false)
  const [erroConvite, setErroConvite]       = useState('')
  const [sucessoConvite, setSucessoConvite] = useState('')

  const empresaId = session?.empresa?.id

  // ------------------------------------------------------------
  // Carrega membros e roles disponíveis
  // ------------------------------------------------------------
  const carregar = useCallback(async () => {
    if (!empresaId) return
    setCarregando(true)

    // Membros da empresa com seus roles
    const { data: perfis } = await supabase
      .from('perfis')
      .select('id, user_id, email, nome, status, first_access_completed')
      .eq('empresa_id', empresaId)
      .order('nome')

    if (perfis) {
      // Busca roles de todos os membros de uma vez
      const userIds = perfis.map((p: any) => p.user_id).filter(Boolean)
      const { data: rolesData } = await supabase
        .from('v_user_roles')
        .select('user_id, role_name, role_display_name')
        .in('user_id', userIds)
        .eq('empresa_id', empresaId)

      const rolesPorUser: Record<string, any[]> = {}
      for (const r of rolesData ?? []) {
        if (!rolesPorUser[r.user_id]) rolesPorUser[r.user_id] = []
        rolesPorUser[r.user_id].push(r)
      }

      setMembros(perfis.map((p: any) => ({
        ...p,
        roles: rolesPorUser[p.user_id] ?? [],
      })))
    }

    // Roles disponíveis para atribuição
    const { data: rolesResp } = await supabase
      .from('roles')
      .select('id, name, display_name, description')
      .order('display_name')

    if (rolesResp) setRolesDisponiveis(rolesResp)

    setCarregando(false)
  }, [empresaId, supabase])

  useEffect(() => { carregar() }, [carregar])

  // ------------------------------------------------------------
  // Convidar usuário
  // ------------------------------------------------------------
  const handleConvidar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErroConvite('')
    setSucessoConvite('')

    if (!emailConvite.trim()) {
      setErroConvite('Informe o e-mail.')
      return
    }
    if (rolesSelecionados.length === 0) {
      setErroConvite('Selecione pelo menos um role.')
      return
    }

    setEnviando(true)

    try {
      const { data: { session: s } } = await supabase.auth.getSession()
      const token = s?.access_token ?? ''

      const res = await fetch('/api/usuarios/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: emailConvite.trim(),
          nome:  nomeConvite.trim(),
          roles: rolesSelecionados,
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        setErroConvite(json.error ?? 'Erro ao enviar convite.')
      } else {
        setSucessoConvite(`Convite enviado para ${emailConvite.trim()}.`)
        setEmailConvite('')
        setNomeConvite('')
        setRolesSelecionados([])
        carregar()
      }
    } catch {
      setErroConvite('Erro de conexão. Tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  // ------------------------------------------------------------
  // Adicionar / remover role de um membro
  // ------------------------------------------------------------
  const toggleRole = async (membro: Membro, roleName: RoleName) => {
    const temRole = membro.roles.some(r => r.role_name === roleName)
    const { data: { session: s } } = await supabase.auth.getSession()
    const token = s?.access_token ?? ''

    const method = temRole ? 'DELETE' : 'POST'
    await fetch(`/api/usuarios/${membro.user_id}/roles`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ role_name: roleName }),
    })

    carregar()
  }

  const toggleRoleSelecionado = (role: RoleName) => {
    setRolesSelecionados(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    )
  }

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  if (carregando) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 text-primary animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">

      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Equipe</h2>
            <p className="text-[11px] text-muted-foreground">{membros.length} {membros.length === 1 ? 'membro' : 'membros'}</p>
          </div>
        </div>
        <button
          onClick={() => { setShowConvite(!showConvite); setErroConvite(''); setSucessoConvite('') }}
          className="flex items-center gap-2 h-9 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-all shadow-sm"
        >
          <UserPlus className="h-3.5 w-3.5" />
          Convidar
        </button>
      </div>

      {/* Formulário de convite */}
      {showConvite && (
        <div className="bg-card border border-border rounded-2xl p-6 space-y-5 shadow-sm animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">Novo convite</h3>
            <button onClick={() => setShowConvite(false)} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          {erroConvite && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {erroConvite}
            </div>
          )}

          {sucessoConvite && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-500 text-xs font-medium">
              <Check className="h-3.5 w-3.5 flex-shrink-0" />
              {sucessoConvite}
            </div>
          )}

          <form onSubmit={handleConvidar} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  E-mail
                </label>
                <div className="relative">
                  <input
                    type="email"
                    value={emailConvite}
                    onChange={e => setEmailConvite(e.target.value)}
                    placeholder="colaborador@empresa.com"
                    disabled={enviando}
                    className="w-full h-10 pl-9 pr-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all disabled:opacity-50"
                  />
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Nome (opcional)
                </label>
                <input
                  type="text"
                  value={nomeConvite}
                  onChange={e => setNomeConvite(e.target.value)}
                  placeholder="Nome do colaborador"
                  disabled={enviando}
                  className="w-full h-10 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all disabled:opacity-50"
                />
              </div>
            </div>

            {/* Seleção de roles */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Roles
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {rolesDisponiveis.map(role => {
                  const selecionado = rolesSelecionados.includes(role.name)
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => toggleRoleSelecionado(role.name)}
                      className={[
                        'flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all',
                        selecionado
                          ? 'bg-primary/10 border-primary/30 text-primary'
                          : 'border-border bg-muted/30 text-muted-foreground hover:border-border/80 hover:text-foreground',
                      ].join(' ')}
                    >
                      <div className={[
                        'h-3.5 w-3.5 rounded-full border flex-shrink-0 flex items-center justify-center transition-all',
                        selecionado ? 'bg-primary border-primary' : 'border-muted-foreground/30',
                      ].join(' ')}>
                        {selecionado && <Check className="h-2 w-2 text-white" />}
                      </div>
                      <span className="text-[11px] font-semibold leading-tight">{role.display_name}</span>
                    </button>
                  )
                })}
              </div>
              {rolesSelecionados.length > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {rolesSelecionados.length} role{rolesSelecionados.length > 1 ? 's' : ''} selecionado{rolesSelecionados.length > 1 ? 's' : ''}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={enviando}
              className="w-full h-10 flex items-center justify-center gap-2 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider rounded-xl hover:opacity-90 transition-all disabled:opacity-50"
            >
              {enviando
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Enviando...</>
                : <><Mail className="h-3.5 w-3.5" /> Enviar Convite</>
              }
            </button>
          </form>
        </div>
      )}

      {/* Lista de membros */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        {membros.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">Nenhum membro ainda.</p>
            <p className="text-xs mt-1">Convide colaboradores usando o botão acima.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {membros.map(membro => (
              <div key={membro.id} className="p-4">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandido(expandido === membro.id ? null : membro.id)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-primary text-xs font-black">
                        {(membro.nome || membro.email).slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">
                        {membro.nome || membro.email}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">{membro.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    {/* Badge de status */}
                    {!membro.first_access_completed && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-500 border border-amber-500/20">
                        Pendente
                      </span>
                    )}
                    {/* Roles resumidos */}
                    <div className="hidden sm:flex gap-1 flex-wrap justify-end">
                      {membro.roles.slice(0, 2).map(r => (
                        <span key={r.role_name} className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/15">
                          {r.role_display_name}
                        </span>
                      ))}
                      {membro.roles.length > 2 && (
                        <span className="text-[10px] text-muted-foreground px-1">
                          +{membro.roles.length - 2}
                        </span>
                      )}
                    </div>
                    {expandido === membro.id
                      ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    }
                  </div>
                </div>

                {/* Painel expandido de roles */}
                {expandido === membro.id && (
                  <div className="mt-4 pt-4 border-t border-border space-y-3 animate-in slide-in-from-top-1 duration-150">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      Roles — clique para adicionar ou remover
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {rolesDisponiveis.map(role => {
                        const ativo = membro.roles.some(r => r.role_name === role.name)
                        // Impede que o System Manager remova a si mesmo
                        const bloqueado =
                          membro.user_id === supabaseUser?.id &&
                          role.name === 'system_manager'

                        return (
                          <button
                            key={role.id}
                            onClick={() => !bloqueado && toggleRole(membro, role.name)}
                            disabled={bloqueado}
                            title={bloqueado ? 'Você não pode remover seu próprio System Manager' : role.description}
                            className={[
                              'flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all',
                              ativo
                                ? 'bg-primary/10 border-primary/30 text-primary'
                                : 'border-border bg-muted/20 text-muted-foreground hover:border-border/80 hover:text-foreground',
                              bloqueado ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
                            ].join(' ')}
                          >
                            <div className={[
                              'h-3.5 w-3.5 rounded-full border flex-shrink-0 flex items-center justify-center transition-all',
                              ativo ? 'bg-primary border-primary' : 'border-muted-foreground/30',
                            ].join(' ')}>
                              {ativo && <Check className="h-2 w-2 text-white" />}
                            </div>
                            <div className="min-w-0">
                              <span className="text-[11px] font-semibold leading-tight block truncate">
                                {role.display_name}
                              </span>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
