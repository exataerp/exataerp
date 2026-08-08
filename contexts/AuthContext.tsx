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
import { ALL_AUDIT_PERMISSIONS, AUDIT_PERMISSIONS, type AuditPermission } from '@/lib/audit'

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------
export interface EmpresaInfo {
  id: string
  nome: string
  status: string
  onboarding_completed: boolean
  plano: string
  subdomain: string
}

export interface SessionData {
  user: {
    id: string
    username: string
    email: string | null
    nome: string
    cargo: string | null
    status: string
    first_access_completed: boolean
    must_change_password: boolean
  }
  empresa: EmpresaInfo
  roles: RoleName[]
  permissions: string[]
  preferencias: { theme: string; language: string; timezone: string }
}

// ------------------------------------------------------------
// Tipo do contexto
// ------------------------------------------------------------
interface AuthContextType {
  supabaseUser:  User | null
  session:       SessionData | null
  loading:       boolean

  // Auth actions
  signIn:        (username: string, senha: string) => Promise<{ error: string | null; requiresPasswordChange?: boolean }>
  signOut:       () => Promise<{ error: string | null }>
  reloadSession: () => Promise<void>

  // Helpers de roles
  hasRole:          (role: RoleName) => boolean
  hasPermission:    (permission: AuditPermission) => boolean
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
  signOut:        async () => ({ error: null }),
  reloadSession:  async () => {},
  hasRole:        () => false,
  hasPermission:  () => false,
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
      const response = await fetch('/api/auth/session', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('Sessão indisponível')
      const sessionData = await response.json() as SessionData
      setSession(sessionData)
      setSupabaseUser(user)
    } catch {
      setSession(null)
      setSupabaseUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

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
  const signIn = async (username: string, senha: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: senha }),
    })
    const result = await response.json()
    return {
      error: response.ok ? null : (result.error ?? 'Não foi possível entrar.'),
      requiresPasswordChange: response.ok ? Boolean(result.requires_password_change) : undefined,
    }
  }

  const signOut = async () => {
    const response = await fetch('/api/auth/logout', { method: 'POST' })
    if (!response.ok) return { error: 'Não foi possível sair.' }

    setSession(null)
    setSupabaseUser(null)
    return { error: null }
  }

  const reloadSession = async () => {
    if (supabaseUser) await loadSession(supabaseUser)
  }

  // ------------------------------------------------------------
  // Derivações de roles
  // ------------------------------------------------------------
  const userRoles = session?.roles ?? []
  const userPermissions = session?.permissions ?? []

  const tabs = abasVisiveis(userRoles)
  if (
    userPermissions.includes(AUDIT_PERMISSIONS.VIEW)
    && !tabs.includes('auditoria')
  ) {
    tabs.push('auditoria')
  }

  return (
    <AuthContext.Provider value={{
      supabaseUser,
      session,
      loading,
      signIn,
      signOut,
      reloadSession,
      hasRole:         (role: RoleName)  => hasRole(userRoles, role),
      hasPermission:   (permission: AuditPermission) => userPermissions.includes(permission),
      canAccess:       (aba: AbaId)      => aba === 'auditoria'
        ? userPermissions.includes(AUDIT_PERMISSIONS.VIEW)
        : podeAcessarAba(userRoles, aba),
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
