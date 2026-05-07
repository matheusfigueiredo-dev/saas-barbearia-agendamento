import webpush from 'web-push'

export const config = { path: "/api/booking-notify-push" }

const NAME_ALIASES = ["name","nome","customer_name","client_name","full_name"]
const DATE_ALIASES = ["date","book_date","booking_date"]
const TIME_ALIASES = ["time","book_time","booking_time"]

function pick(row, candidates, fallback) {
  for (const c of candidates) { if (Object.prototype.hasOwnProperty.call(row, c)) return row[c] }
  return row[fallback]
}

function toHHmm(v) {
  const t = String(v||'').trim()
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) { const [h,m] = t.split(':'); return `${String(h).padStart(2,'0')}:${m}` }
  if (/^\d{4}$/.test(t)) return `${t.slice(0,2)}:${t.slice(2)}`
  if (/^\d{1,2}$/.test(t)) return `${String(Number(t)).padStart(2,'0')}:00`
  return t || '00:00'
}

function toDateBr(value) {
  const s = String(value||'')
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s
  return s
}

function extractRecord(payload) {
  if (payload?.record) return payload.record
  if (payload?.new) return payload.new
  if (payload?.data?.new) return payload.data.new
  if (payload?.event?.record) return payload.event.record
  return null
}

async function fetchSubscriptions() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
  const r = await fetch(`${url}/rest/v1/push_subscriptions?enabled=eq.true&select=endpoint,subscription`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!r.ok) throw new Error(`Supabase list error: ${r.status}`)
  return r.json()
}

async function deleteSubscription(endpoint) {
  // limpeza de inscrições inválidas
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
  await fetch(`${url}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}` } })
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const secret = process.env.SHARED_WEBHOOK_SECRET || ''
  if (secret) {
    const got = req.headers.get('x-webhook-secret') || req.headers.get('X-Webhook-Secret')
    if (got !== secret) return new Response('Unauthorized', { status: 401 })
  }

  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'
  if (!pub || !priv) return new Response('Missing VAPID keys', { status: 500 })
  webpush.setVapidDetails(subject, pub, priv)

  let body
  try { body = await req.json() } catch { return new Response('Invalid JSON', { status: 400 }) }
  const row = extractRecord(body)
  if (!row) return new Response('No record', { status: 400 })

  const name = String(pick(row, NAME_ALIASES, NAME_ALIASES[0]) || 'Cliente').trim()
  const date = toDateBr(pick(row, DATE_ALIASES, DATE_ALIASES[0]))
  const time = toHHmm(pick(row, TIME_ALIASES, TIME_ALIASES[0]))

  const payload = JSON.stringify({
  title: 'Novo agendamento',
  body: `${name}\n${date} às ${time}`,
  tag: 'booking',
  icon: '/notify/logo-192.png',  // <-- ADICIONE ESTA LINHA
  badge: '/notify/badge-72.png'  // <-- ADICIONE ESTA LINHA
})

  let subs
  try { subs = await fetchSubscriptions() } catch (e) { return new Response(String(e?.message||e), { status: 502 }) }

  let ok = 0, fail = 0
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription, payload)
      ok++
    } catch (e) {
      fail++
      if (e?.statusCode === 404 || e?.statusCode === 410) { try { await deleteSubscription(s.endpoint) } catch {} }
    }
  }))

  return new Response(JSON.stringify({ sent: ok, failed: fail }), { status: 200, headers: { 'content-type': 'application/json' } })
}
