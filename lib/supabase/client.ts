import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  // Remove qualquer barra (/) no final da URL para evitar o erro "Invalid path specified in request URL"
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}

