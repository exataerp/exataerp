import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
let client:SupabaseClient|undefined

export function createClient() {
  if(client)return client
  // Remove qualquer barra (/) no final da URL para evitar o erro "Invalid path specified in request URL"
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if(!supabaseUrl||!supabaseAnonKey)return new Proxy({}as SupabaseClient,{get(){throw new Error('Configuração Supabase client-side ausente')}})

  return client=createBrowserClient(supabaseUrl, supabaseAnonKey)
}
