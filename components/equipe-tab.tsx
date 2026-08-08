'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Users, UserPlus, X, Loader2, Check, AlertCircle, AtSign, UserRound, LockKeyhole, ChevronDown, ChevronUp, MapPin, Plus, RotateCcw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { ROLE_LABELS, type RoleName } from '@/lib/permissions'

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------
interface Membro {
  id: string
  user_id: string
  username: string
  email: string | null
  nome: string
  status: string
  must_change_password: boolean
  roles: { role_name: RoleName; role_display_name: string }[]
  postos: string[]
}

interface PostoTrabalho { id: string; codigo: string; nome: string; status: string }
interface EquipeCadastro { id: string; nome: string; descricao?: string; turno_id?: string | null; membros: string[]; postos: string[] }
interface TurnoEquipe { id: string; nome: string; hora_inicio: string; hora_fim: string }

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
  const [postos, setPostos] = useState<PostoTrabalho[]>([])
  const [equipes, setEquipes] = useState<EquipeCadastro[]>([])
  const [turnos, setTurnos] = useState<TurnoEquipe[]>([])
  const [novaEquipe, setNovaEquipe] = useState('')
  const [carregando, setCarregando]         = useState(true)
  const [expandido, setExpandido]           = useState<string | null>(null)

  // Formulário de cadastro manual
  const [showConvite, setShowConvite]       = useState(false)
  const [usernameCadastro, setUsernameCadastro] = useState('')
  const [senhaCadastro, setSenhaCadastro] = useState('')
  const [emailConvite, setEmailConvite]     = useState('')
  const [nomeConvite, setNomeConvite]       = useState('')
  const [cargoCadastro, setCargoCadastro] = useState('')
  const [rolesSelecionados, setRolesSelecionados] = useState<RoleName[]>([])
  const [enviando, setEnviando]             = useState(false)
  const [erroConvite, setErroConvite]       = useState('')
  const [sucessoConvite, setSucessoConvite] = useState('')
  const [resetUserId, setResetUserId] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resettingPassword, setResettingPassword] = useState(false)
  const [resetPasswordError, setResetPasswordError] = useState('')
  const [resetPasswordSuccess, setResetPasswordSuccess] = useState('')

  const empresaId = session?.empresa?.id

  // ------------------------------------------------------------
  // Carrega membros e roles disponíveis
  // ------------------------------------------------------------
  const carregar = useCallback(async () => {
    if (!empresaId) return
    setCarregando(true)

    // Membros, roles e postos são carregados em lote para evitar N+1.
    const [{ data: perfis }, { data: postosData }, { data: vinculos }, { data: equipesData }, { data: equipeMembros }, { data: equipePostos }, { data: turnosData }] = await Promise.all([
      fetch('/api/admin/equipe', { method: 'POST' })
        .then(async (response) => {
          if (!response.ok) return { data: [] }
          const payload = await response.json()
          return {
            data: (payload.equipe ?? []).map((member: any) => ({
              id: member.user_id,
              user_id: member.user_id,
              status: member.status,
              ...member.perfis,
            })),
          }
        }),
      supabase.from('maquinas').select('id, codigo, nome, status').eq('empresa_id', empresaId).eq('status', 'ativa').order('nome'),
      supabase.from('usuario_postos_trabalho').select('user_id, maquina_id').eq('empresa_id', empresaId),
      supabase.from('equipes').select('id, nome, descricao, turno_id').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      supabase.from('equipe_membros').select('equipe_id, user_id').eq('empresa_id', empresaId),
      supabase.from('equipe_postos_trabalho').select('equipe_id, maquina_id').eq('empresa_id', empresaId),
      supabase.from('turnos').select('id, nome, hora_inicio, hora_fim').eq('empresa_id', empresaId).eq('ativo', true).order('hora_inicio'),
    ])
    setPostos((postosData ?? []) as PostoTrabalho[])
    setTurnos((turnosData ?? []) as TurnoEquipe[])
    setEquipes((equipesData ?? []).map((equipe: any) => ({
      ...equipe,
      membros: (equipeMembros ?? []).filter((v: any) => v.equipe_id === equipe.id).map((v: any) => v.user_id),
      postos: (equipePostos ?? []).filter((v: any) => v.equipe_id === equipe.id).map((v: any) => v.maquina_id),
    })))

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

      const postosPorUser: Record<string, string[]> = {}
      for (const vinculo of vinculos ?? []) {
        if (!postosPorUser[vinculo.user_id]) postosPorUser[vinculo.user_id] = []
        postosPorUser[vinculo.user_id].push(vinculo.maquina_id)
      }
      setMembros(perfis.map((p: any) => ({
        ...p,
        roles: rolesPorUser[p.user_id] ?? [],
        postos: postosPorUser[p.user_id] ?? [],
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
  // Cadastrar usuário com senha definida pelo administrador
  // ------------------------------------------------------------
  const handleCadastrar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErroConvite('')
    setSucessoConvite('')

    if (!usernameCadastro.trim() || !senhaCadastro || !nomeConvite.trim()) {
      setErroConvite('Informe nome de usuário, senha e nome do colaborador.')
      return
    }
    if (rolesSelecionados.length === 0) {
      setErroConvite('Selecione pelo menos um perfil de acesso.')
      return
    }

    setEnviando(true)

    try {
      const { data: { session: s } } = await supabase.auth.getSession()
      const token = s?.access_token ?? ''

      const res = await fetch('/api/usuarios', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          username: usernameCadastro.trim(),
          password: senhaCadastro,
          email: emailConvite.trim() || null,
          nome:  nomeConvite.trim(),
          cargo: cargoCadastro.trim() || null,
          roles: rolesSelecionados,
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        setErroConvite(json.error ?? 'Erro ao cadastrar usuário.')
      } else {
        setSucessoConvite(`Usuário ${json.username ?? usernameCadastro.trim().toLowerCase()} criado. A troca da senha temporária será obrigatória no primeiro acesso.`)
        setUsernameCadastro('')
        setSenhaCadastro('')
        setEmailConvite('')
        setNomeConvite('')
        setCargoCadastro('')
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

  const togglePosto = async (membro: Membro, maquinaId: string) => {
    if (!empresaId) return
    const vinculado = membro.postos.includes(maquinaId)
    const query = vinculado
      ? supabase.from('usuario_postos_trabalho').delete().eq('empresa_id', empresaId).eq('user_id', membro.user_id).eq('maquina_id', maquinaId)
      : supabase.from('usuario_postos_trabalho').insert({ empresa_id: empresaId, user_id: membro.user_id, maquina_id: maquinaId })
    const { error } = await query
    if (error) return
    carregar()
  }

  const criarEquipe = async () => {
    if (!empresaId || !novaEquipe.trim()) return
    const { error } = await supabase.from('equipes').insert({ empresa_id: empresaId, nome: novaEquipe.trim() })
    if (!error) { setNovaEquipe(''); carregar() }
  }

  const toggleMembroEquipe = async (equipe: EquipeCadastro, userId: string) => {
    if (!empresaId) return
    const ativo = equipe.membros.includes(userId)
    const query = ativo
      ? supabase.from('equipe_membros').delete().eq('empresa_id', empresaId).eq('equipe_id', equipe.id).eq('user_id', userId)
      : supabase.from('equipe_membros').insert({ empresa_id: empresaId, equipe_id: equipe.id, user_id: userId })
    const { error } = await query
    if (!error) carregar()
  }

  const togglePostoEquipe = async (equipe: EquipeCadastro, maquinaId: string) => {
    if (!empresaId) return
    const ativo = equipe.postos.includes(maquinaId)
    const query = ativo
      ? supabase.from('equipe_postos_trabalho').delete().eq('empresa_id', empresaId).eq('equipe_id', equipe.id).eq('maquina_id', maquinaId)
      : supabase.from('equipe_postos_trabalho').insert({ empresa_id: empresaId, equipe_id: equipe.id, maquina_id: maquinaId })
    const { error } = await query
    if (!error) carregar()
  }

  const handleResetPassword = async (membro: Membro) => {
    setResetPasswordError('')
    setResetPasswordSuccess('')
    if (!resetPassword) {
      setResetPasswordError('Informe a nova senha temporária.')
      return
    }

    setResettingPassword(true)
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession()
      const response = await fetch(`/api/usuarios/${membro.user_id}/senha`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentSession?.access_token ?? ''}`,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ password: resetPassword }),
      })
      const result = await response.json()

      if (!response.ok) {
        setResetPasswordError(result.error ?? 'Não foi possível redefinir a senha.')
        return
      }

      setResetPassword('')
      setResetPasswordSuccess('Senha temporária definida. O usuário deverá trocá-la no próximo acesso.')
      await carregar()
    } catch {
      setResetPasswordError('Erro de conexão. Tente novamente.')
    } finally {
      setResettingPassword(false)
    }
  }

  const atualizarTurnoEquipe = async (equipe: EquipeCadastro, turnoId: string) => {
    if (!empresaId) return
    const { error } = await supabase
      .from('equipes')
      .update({ turno_id: turnoId === 'sem_turno' ? null : turnoId })
      .eq('empresa_id', empresaId)
      .eq('id', equipe.id)
    if (!error) carregar()
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
          Cadastrar Usuário
        </button>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-foreground">Equipes e postos herdados</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Membros herdam automaticamente os postos liberados para a equipe.</p>
          </div>
          <div className="flex gap-2">
            <input value={novaEquipe} onChange={e => setNovaEquipe(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') criarEquipe() }} placeholder="Nome da equipe" className="h-9 min-w-0 px-3 rounded-xl border border-border bg-input text-xs" />
            <button type="button" onClick={criarEquipe} disabled={!novaEquipe.trim()} className="h-9 px-3 rounded-xl bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50 flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> Criar</button>
          </div>
        </div>
        {equipes.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">Nenhuma equipe cadastrada.</p>
        ) : (
          <div className="space-y-3">
            {equipes.map(equipe => (
              <div key={equipe.id} className="rounded-xl border border-border p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-foreground">{equipe.nome}</p>
                  <span className="text-[10px] text-muted-foreground">{equipe.membros.length} membro(s) · {equipe.postos.length} posto(s)</span>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Jornada da equipe</p>
                  <select
                    value={equipe.turno_id || 'sem_turno'}
                    onChange={event => atualizarTurnoEquipe(equipe, event.target.value)}
                    className="h-9 w-full rounded-xl border border-border bg-input px-3 text-xs text-foreground outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="sem_turno">Herdar do posto ou identificar pelo horário</option>
                    {turnos.map(turno => (
                      <option key={turno.id} value={turno.id}>
                        {turno.nome} · {turno.hora_inicio.slice(0, 5)}–{turno.hora_fim.slice(0, 5)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Membros</p>
                  <div className="flex flex-wrap gap-2">
                    {membros.map(membro => {
                      const ativo = equipe.membros.includes(membro.user_id)
                      return <button key={membro.user_id} type="button" onClick={() => toggleMembroEquipe(equipe, membro.user_id)} className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all ${ativo ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border text-muted-foreground'}`}>{membro.nome || membro.username}</button>
                    })}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Postos liberados</p>
                  <div className="flex flex-wrap gap-2">
                    {postos.map(posto => {
                      const ativo = equipe.postos.includes(posto.id)
                      return <button key={posto.id} type="button" onClick={() => togglePostoEquipe(equipe, posto.id)} className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all ${ativo ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border text-muted-foreground'}`}>{posto.codigo} — {posto.nome}</button>
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Formulário de cadastro manual */}
      {showConvite && (
        <div className="bg-card border border-border rounded-2xl p-6 space-y-5 shadow-sm animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">Novo usuário</h3>
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

          <form onSubmit={handleCadastrar} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Nome de Usuário
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={usernameCadastro}
                    onChange={e => setUsernameCadastro(e.target.value)}
                    placeholder="operador.corte"
                    autoComplete="off"
                    disabled={enviando}
                    className="w-full h-10 pl-9 pr-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all disabled:opacity-50"
                  />
                  <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <p className="text-[10px] text-muted-foreground">3 a 40 caracteres, sem espaços ou acentos.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Senha Temporária
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={senhaCadastro}
                    onChange={e => setSenhaCadastro(e.target.value)}
                    placeholder="Mínimo de 8 caracteres"
                    autoComplete="new-password"
                    disabled={enviando}
                    className="w-full h-10 pl-9 pr-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all disabled:opacity-50"
                  />
                  <LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Nome</label>
                <input
                  type="text"
                  value={nomeConvite}
                  onChange={e => setNomeConvite(e.target.value)}
                  placeholder="Nome do colaborador"
                  autoComplete="off"
                  disabled={enviando}
                  className="w-full h-10 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all disabled:opacity-50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Cargo (opcional)</label>
                <input
                  type="text"
                  value={cargoCadastro}
                  onChange={e => setCargoCadastro(e.target.value)}
                  placeholder="Operador"
                  autoComplete="off"
                  disabled={enviando}
                  className="w-full h-10 px-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all disabled:opacity-50"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">E-mail de Contato (opcional)</label>
                <div className="relative">
                  <input
                    type="email"
                    value={emailConvite}
                    onChange={e => setEmailConvite(e.target.value)}
                    placeholder="contato@empresa.com"
                    autoComplete="off"
                    disabled={enviando}
                    className="w-full h-10 pl-9 pr-4 rounded-xl border border-border bg-input text-foreground text-sm outline-none focus:ring-2 focus:ring-primary transition-all disabled:opacity-50"
                  />
                  <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <p className="text-[10px] text-muted-foreground">Não é usado para entrar e pode ser repetido em outros usuários.</p>
              </div>
            </div>

            {/* Seleção de roles */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Perfis de acesso
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
                  {rolesSelecionados.length} {rolesSelecionados.length === 1 ? 'perfil selecionado' : 'perfis selecionados'}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={enviando}
              className="w-full h-10 flex items-center justify-center gap-2 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider rounded-xl hover:opacity-90 transition-all disabled:opacity-50"
            >
              {enviando
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cadastrando...</>
                : <><UserPlus className="h-3.5 w-3.5" /> Criar Usuário</>
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
            <p className="text-xs mt-1">Cadastre colaboradores usando o botão acima.</p>
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
                        {(membro.nome || membro.username).slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">
                        {membro.nome || membro.username}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        @{membro.username}{membro.email ? ` · ${membro.email}` : ''}
                      </p>
                      {membro.must_change_password && (
                        <span className="mt-1 inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          Troca de senha pendente
                        </span>
                      )}
                      {!membro.user_id && (
                        <span className="mt-1 inline-flex rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                          Perfil sem vínculo de autenticação
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
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
                      Perfis de acesso — clique para adicionar ou remover
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {rolesDisponiveis.map(role => {
                        const ativo = membro.roles.some(r => r.role_name === role.name)
                        // Impede que o Administrador do Sistema remova a si mesmo
                        const bloqueado =
                          membro.user_id === supabaseUser?.id &&
                          role.name === 'system_manager'

                        return (
                          <button
                            key={role.id}
                            onClick={() => !bloqueado && toggleRole(membro, role.name)}
                            disabled={bloqueado}
                            title={bloqueado ? 'Você não pode remover seu próprio perfil de Administrador do Sistema' : role.description}
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
                    <div className="pt-2">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1 mb-2">
                        <MapPin className="h-3 w-3" /> Postos de trabalho liberados
                      </p>
                      {postos.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Cadastre postos na aba Máquinas para liberá-los aos usuários.</p>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {postos.map(posto => {
                            const ativo = membro.postos.includes(posto.id)
                            return (
                              <button key={posto.id} type="button" onClick={() => togglePosto(membro, posto.id)} className={[
                                'flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all',
                                ativo ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border bg-muted/20 text-muted-foreground hover:border-border/80 hover:text-foreground',
                              ].join(' ')}>
                                <div className={`h-3.5 w-3.5 rounded-full border flex-shrink-0 ${ativo ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`} />
                                <span className="text-[11px] font-semibold leading-tight truncate">{posto.codigo} — {posto.nome}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    {membro.user_id && membro.user_id !== supabaseUser?.id && (
                      <div className="border-t border-border pt-4">
                        <button
                          type="button"
                          onClick={() => {
                            setResetUserId(resetUserId === membro.user_id ? null : membro.user_id)
                            setResetPassword('')
                            setResetPasswordError('')
                            setResetPasswordSuccess('')
                          }}
                          className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-primary hover:opacity-80"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Redefinir senha
                        </button>

                        {resetUserId === membro.user_id && (
                          <div className="mt-3 space-y-3 rounded-xl border border-border bg-muted/20 p-4">
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              Defina uma senha temporária. O acesso ao restante do ERP ficará bloqueado até o usuário criar uma senha pessoal.
                            </p>
                            {resetPasswordError && <p className="text-xs font-medium text-red-600">{resetPasswordError}</p>}
                            {resetPasswordSuccess && <p className="text-xs font-medium text-green-700">{resetPasswordSuccess}</p>}
                            <input
                              type="password"
                              value={resetPassword}
                              disabled={resettingPassword}
                              autoComplete="new-password"
                              onChange={(event) => setResetPassword(event.target.value)}
                              placeholder="Nova senha temporária"
                              className="h-10 w-full rounded-xl border border-border bg-input px-3.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                            />
                            <button
                              type="button"
                              disabled={resettingPassword}
                              onClick={() => void handleResetPassword(membro)}
                              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-bold uppercase tracking-wider text-primary-foreground hover:opacity-90 disabled:opacity-60"
                            >
                              {resettingPassword ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Redefinindo...</> : 'Confirmar redefinição'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
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
