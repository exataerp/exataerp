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
import {
  type RoleName,
  type AbaId,
  podeAcessarAba,
  abasVisiveis,
  hasRole,
  isSystemManager,
} from '@/lib/permissions'

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------
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
    status: string
    first_access_completed: boolean
  }
  empresa: EmpresaInfo
  roles: RoleName[]
  preferencias: { theme: string; language: string }
}

// ------------------------------------------------------------
// Tipo do contexto
// ------------------------------------------------------------
interface AuthContextType {
  supabaseUser:  User | null
  session:       SessionData | null
  loading:       boolean

  // Auth actions
  signIn:        (email: string, senha: string) => Promise<{ error: string | null }>
  signOut:       () => Promise<void>
  reloadSession: () => Promise<void>

  // Helpers de roles
  hasRole:          (role: RoleName) => boolean
  canAccess:        (aba: AbaId) => boolean
  visibleTabs:      AbaId[]
  isSystemManager:  boolean
}

// ------------------------------------------------------------
// Context
// ------------------------------------------------------------
const AuthContext = createContext<AuthContextType>({
  supabaseUser:   null,
  session:        null,
  loading:        true,
  signIn:         async () => ({ error: null }),
  signOut:        async () => {},
  reloadSession:  async () => {},
  hasRole:        () => false,
  canAccess:      () => false,
  visibleTabs:    [],
  isSystemManager: false,
})

// ------------------------------------------------------------
// Provider
// ------------------------------------------------------------
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null)
  const [session, setSession]           = useState<SessionData | null>(null)
  const [loading, setLoading]           = useState(true)

  const loadSession = useCallback(async (user: User) => {
    try {
      // Busca perfil
      const { data: perfil } = await supabase
        .from('perfis')
        .select('id, nome, cargo, status, email, empresa_id, first_access_completed')
        .eq('user_id', user.id)
        .single()

      if (!perfil) {
        setSession(null)
        setSupabaseUser(user)
        setLoading(false)
        return
      }

      // Busca empresa
      const { data: empresa } = await supabase
        .from('empresas')
        .select('id, nome, status, onboarding_completed, plano')
        .eq('id', perfil.empresa_id)
        .single()

      // Busca roles via view (RLS garante que só vê os próprios)
      const { data: rolesData } = await supabase
        .from('v_user_roles')
        .select('role_name')
        .eq('user_id', user.id)
        .eq('empresa_id', perfil.empresa_id)

      const roles = (rolesData ?? []).map((r: any) => r.role_name as RoleName)

      // Busca preferências
      const { data: prefs } = await supabase
        .from('user_preferences')
        .select('theme, language')
        .eq('user_id', user.id)
        .maybeSingle()

      const sessionData: SessionData = {
        user: {
          id:                     perfil.id,
          email:                  perfil.email ?? user.email ?? '',
          nome:                   perfil.nome ?? '',
          cargo:                  perfil.cargo ?? null,
          status:                 perfil.status,
          first_access_completed: perfil.first_access_completed ?? false,
        },
        empresa: empresa ?? {
          id:                   perfil.empresa_id,
          nome:                 '',
          status:               'ativo',
          onboarding_completed: false,
          plano:                'free',
        },
        roles,
        preferencias: {
          theme:    prefs?.theme    ?? 'dark',
          language: prefs?.language ?? 'pt-BR',
        },
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

  // ------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // Derivações de roles
  // ------------------------------------------------------------
  const userRoles = session?.roles ?? []

  const tabs = abasVisiveis(userRoles)

  return (
    <AuthContext.Provider value={{
      supabaseUser,
      session,
      loading,
      signIn,
      signOut,
      reloadSession,
      hasRole:         (role: RoleName)  => hasRole(userRoles, role),
      canAccess:       (aba: AbaId)      => podeAcessarAba(userRoles, aba),
      visibleTabs:     tabs,
      isSystemManager: isSystemManager(userRoles),
    }}>
      {children}
    </AuthContext.Provider>
  )
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}

// Re-exporta tipos úteis para não precisar importar de dois lugares
export type { RoleName, AbaId }
