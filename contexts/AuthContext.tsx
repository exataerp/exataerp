'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

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

interface AuthContextType {
  supabaseUser: User | null
  session: SessionData | null
  loading: boolean
  signOut: () => Promise<void>
  reloadSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  supabaseUser: null,
  session: null,
  loading: true,
  signOut: async () => {},
  reloadSession: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null)
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const loadEnrichedSession = useCallback(async (accessToken: string) => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) {
        setSession(null)
        return
      }
      const data: SessionData = await res.json()
      setSession(data)

      // Aplica tema salvo nas preferências
      if (typeof window !== 'undefined' && data.preferencias?.theme) {
        const html = document.documentElement
        html.classList.remove('light', 'dark')
        if (data.preferencias.theme !== 'system') {
          html.classList.add(data.preferencias.theme)
        }
      }
    } catch {
      setSession(null)
    }
  }, [])

  const reloadSession = useCallback(async () => {
    const { data: { session: sbSession } } = await supabase.auth.getSession()
    if (sbSession?.access_token) {
      await loadEnrichedSession(sbSession.access_token)
    }
  }, [supabase, loadEnrichedSession])

  useEffect(() => {
    let mounted = true

    const init = async () => {
      const { data: { session: sbSession } } = await supabase.auth.getSession()
      if (!mounted) return

      if (sbSession?.user) {
        setSupabaseUser(sbSession.user)
        await loadEnrichedSession(sbSession.access_token)
      }
      setLoading(false)
    }

    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, sbSession) => {
        if (!mounted) return
        if (sbSession?.user) {
          setSupabaseUser(sbSession.user)
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            await loadEnrichedSession(sbSession.access_token)
          }
        } else {
          setSupabaseUser(null)
          setSession(null)
        }
        setLoading(false)
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase, loadEnrichedSession])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSupabaseUser(null)
    setSession(null)
    window.location.href = '/login'
  }, [supabase])

  return (
    <AuthContext.Provider value={{ supabaseUser, session, loading, signOut, reloadSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
