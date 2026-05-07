import { createClient } from '@supabase/supabase-js'
import { setGlobalDispatcher, Agent } from 'undici'
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'

// Carrega .env locais e, se existir, também arquivos .env na pasta pai
dotenv.config()
for (const name of ['.env.local', '.env']) {
  const p = path.resolve(process.cwd(), '..', name)
  if (fs.existsSync(p)) { try { dotenv.config({ path: p }) } catch {} }
}

// Tenta ler de múltiplos nomes de variáveis para facilitar onboarding
const url = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || process.env.NEXT_PUBLIC_SUPABASE_URL

// Preferir Service Key; caso não exista, tenta anon (funciona se RLS permitir)
const key = process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE
  || process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url) {
  console.error('[whatsapp-bot] Missing SUPABASE_URL in environment (.env).')
  throw new Error('SUPABASE_URL is required')
}
if (!key) {
  console.warn('[whatsapp-bot] No service key provided. Falling back to anon key (requires RLS permissões de escrita).')
}
export const SUPABASE_URL = url
export const SUPABASE_KEY = key
export const supabase = createClient(url, key, { auth: { persistSession: false } })

// Log de diagnóstico não sensível (mostra host e tipo de chave)
try {
  const host = new URL(url).host
  const keyKind = key && key.length > 60 ? 'service_or_anon' : 'missing_or_short'
  console.log(`[whatsapp-bot] Supabase host: ${host} | key: ${keyKind}`)
} catch {}

// Alternativa de diagnóstico: permitir TLS inseguro (útil em ambientes com interceptação SSL/antivírus)
if (String(process.env.WHATSAPP_BOT_INSECURE_TLS||'').trim() === '1') {
  try {
    setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }))
    console.warn('[whatsapp-bot] INSECURE TLS ENABLED (diagnóstico). As conexões HTTPS não validarão certificados. Use apenas para testar.')
  } catch (e) {
    console.warn('[whatsapp-bot] Falha ao aplicar INSECURE TLS:', e?.message||e)
  }
}
