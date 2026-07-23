'use client'

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

// ─── Tipos existentes (mantidos) ──────────────────────────────────────────────
export interface EmpresaInfo {
  id: string
  nome: string
  status: string
  onboarding_completed: boolean
  plano: string
}

export interface SessionData {
  user: {
    id: string
    email: string
    nome: string
    cargo: string | null
    tipo_usuario: string
    status: string
    first_access_completed: boolean
  }
  empresa: EmpresaInfo
  nivel: string
  permissoes_operador: Record<string, boolean>
  permissoes: string[]
  preferencias: { theme: string; language: string }
}

// ─── Hierarquia de roles ───────────────────────────────────────────────────────
export type TipoUsuario = 'admin' | 'gerente' | 'colaborador' | 'visualizador'

const HIERARQUIA: Record<string, number> = {
  admin:        4,
  gerente:      3,
  colaborador:  2,
  visualizador: 1,
}

// ─── Tipo do contexto ──────────────────────────────────────────────────────────
interface AuthContextType {
  supabaseUser:  User | null
  session:       SessionData | null
  loading:       boolean
  signIn:        (email: string, senha: string) => Promise<{ error: string | null }>
  signOut:       () => Promise<void>
  reloadSession: () => Promise<void>
  // Helpers de permissão
  podeAcessar:   (nivelMinimo: TipoUsuario) => boolean
  isAdmin:       boolean
  isGerente:     boolean
}

// ─── Context ───────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextType>({
  supabaseUser:  null,
  session:       null,
  loading:       true,
  signIn:        async () => ({ error: null }),
  signOut:       async () => {},
  reloadSession: async () => {},
  podeAcessar:   () => false,
  isAdmin:       false,
  isGerente:     false,
})

// ─── Provider ─────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null)
  const [session, setSession]           = useState<SessionData | null>(null)
  const [loading, setLoading]           = useState(true)

  // Carrega dados completos do usuário + empresa + perfil
  const loadSession = useCallback(async (user: User) => {
    try {
      // Busca o perfil na tabela perfis (usando user_id agora vinculado)
      const { data: perfil } = await supabase
        .from('perfis')
        .select('id, nome, cargo, tipo_usuario, status, email, empresa_id, first_access_completed')
        .eq('user_id', user.id)
        .eq('status', 'ativo')
        .single()

      if (!perfil) {
        setSession(null)
        setSupabaseUser(user)
        setLoading(false)
        return
      }

      // Busca dados da empresa
      const { data: empresa } = await supabase
        .from('empresas')
        .select('id, nome, status, onboarding_completed, plano')
        .eq('id', perfil.empresa_id)
        .single()

      const sessionData: SessionData = {
        user: {
          id:                    perfil.id,
          email:                 perfil.email ?? user.email ?? '',
          nome:                  perfil.nome ?? '',
          cargo:                 perfil.cargo ?? null,
          tipo_usuario:          perfil.tipo_usuario ?? 'colaborador',
          status:                perfil.status,
          first_access_completed: perfil.first_access_completed ?? false,
        },
        empresa: empresa ?? {
          id:                   perfil.empresa_id,
          nome:                 '',
          status:               'ativo',
          onboarding_completed: false,
          plano:                'free',
        },
        nivel:               perfil.tipo_usuario ?? 'colaborador',
        permissoes_operador: {},
        permissoes:          [],
        preferencias:        { theme: 'dark', language: 'pt-BR' },
      }

      setSession(sessionData)
      setSupabaseUser(user)
    } catch {
      setSession(null)
      setSupabaseUser(user)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  // Escuta mudanças de autenticação
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (s?.user) loadSession(s.user)
      else         setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        if (s?.user) loadSession(s.user)
        else {
          setSupabaseUser(null)
          setSession(null)
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [supabase, loadSession])

  // ─── Actions ───────────────────────────────────────────────────────────────
  const signIn = async (email: string, senha: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    })
    return { error: error?.message ?? null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setSession(null)
    setSupabaseUser(null)
  }

  const reloadSession = async () => {
    if (supabaseUser) await loadSession(supabaseUser)
  }

  // ─── Helpers de permissão ──────────────────────────────────────────────────
  const tipoAtual = session?.user?.tipo_usuario ?? ''

  const podeAcessar = (nivelMinimo: TipoUsuario): boolean => {
    if (!tipoAtual) return false
    return (HIERARQUIA[tipoAtual] ?? 0) >= (HIERARQUIA[nivelMinimo] ?? 99)
  }

  return (
    <AuthContext.Provider value={{
      supabaseUser,
      session,
      loading,
      signIn,
      signOut,
      reloadSession,
      podeAcessar,
      isAdmin:   tipoAtual === 'admin',
      isGerente: tipoAtual === 'admin' || tipoAtual === 'gerente',
    }}>
      {children}
    </AuthContext.Provider>
  )
}

// ─── Hook ──────────────────────────────────────────────────────────────────────
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}

