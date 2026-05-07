import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null
let rememberPref: boolean | null = null

function createConfiguredClient(remember: boolean): SupabaseClient {
  const env = import.meta.env as any
  const supabaseUrl: string | undefined = env.VITE_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey: string | undefined = env.VITE_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase não configurado. Defina VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY (ou NEXT_PUBLIC_*).')
  }
  const storage = remember ? window.localStorage : window.sessionStorage
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      storage,
    },
  })
}

export function setAuthPersistence(remember: boolean) {
  try {
    window.localStorage.setItem('rememberAdmin', remember ? '1' : '0')
  } catch {}
  rememberPref = remember
  client = createConfiguredClient(remember)
}

export function getSupabase(): SupabaseClient {
  if (client) return client
  // Lê preferência persistida; por padrão, lembrar (localStorage)
  if (rememberPref === null) {
    try {
      const v = window.localStorage.getItem('rememberAdmin')
      rememberPref = v === null ? true : v === '1'
    } catch { rememberPref = true }
  }
  client = createConfiguredClient(rememberPref || false)
  return client
}
