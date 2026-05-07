import webpush from 'web-push'

export const config = { path: "/api/push-register" }

const allowOrigin = '*' // ajuste para o seu domínio se quiser restringir

function corsHeaders() {
  return { 'access-control-allow-origin': allowOrigin, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders() })

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) return new Response('Missing Supabase env', { status: 500, headers: corsHeaders() })

  let body
  try { body = await req.json() } catch { return new Response('Invalid JSON', { status: 400, headers: corsHeaders() }) }
  const { subscription, label } = body || {}
  if (!subscription || !subscription.endpoint) return new Response('Missing subscription', { status: 400, headers: corsHeaders() })

  // Salva/atualiza inscrição na tabela push_subscriptions
  const insert = { endpoint: subscription.endpoint, subscription, label: label || null, enabled: true }
  try {
    const res = await fetch(`${url}/rest/v1/push_subscriptions`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify([insert]) })
    if (!res.ok) {
      const t = await res.text().catch(()=> '')
      return new Response(`Supabase insert error: ${res.status} ${t}`, { status: 502, headers: corsHeaders() })
    }
  } catch (e) {
    return new Response(`Fetch error: ${e?.message||e}`, { status: 502, headers: corsHeaders() })
  }

  return new Response('ok', { status: 200, headers: corsHeaders() })
}
