export const config = { path: "/api/push-vapid-public" }

export default async () => {
  const key = process.env.VAPID_PUBLIC_KEY
  if (!key) return new Response(JSON.stringify({ error: 'Missing VAPID_PUBLIC_KEY' }), { status: 500, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } })
  return new Response(JSON.stringify({ key }), { status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } })
}
