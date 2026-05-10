import { GoogleGenerativeAI } from '@google/generative-ai'
import { createClient } from '@supabase/supabase-js'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

type ToolCall = {
  name: string
  args: Record<string, unknown>
}

const SYSTEM_PROMPT =
  'You are the AI Assistant for Dantas Barber. Your goal is to help clients book appointments in a friendly, conversational way, handling natural language. You must use the provided tools to check services and availability. Before confirming a booking, you must summarize: Client Name, Service, Date/Time, Price, and Duration. You only book for the current year. Keep responses concise.'

const WORK_START = '09:00'
const WORK_END = '18:00'
const SLOT_MINUTES = 30

function toHHmm(value: string) {
  const date = new Date(value)
  if (!Number.isNaN(date.getTime())) {
    const hh = String(date.getHours()).padStart(2, '0')
    const mm = String(date.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  }
  const fallback = String(value || '').trim()
  if (/^\d{1,2}:\d{2}/.test(fallback)) {
    const [h, m] = fallback.split(':')
    return `${String(h).padStart(2, '0')}:${m}`
  }
  return fallback
}

function timeToMinutes(time: string) {
  const [hh, mm] = time.split(':').map(Number)
  return (hh || 0) * 60 + (mm || 0)
}

function buildSlots() {
  const start = timeToMinutes(WORK_START)
  const end = timeToMinutes(WORK_END)
  const slots: string[] = []
  for (let m = start; m < end; m += SLOT_MINUTES) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    slots.push(`${hh}:${mm}`)
  }
  return slots
}

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing Supabase credentials')
  return createClient(url, key, { auth: { persistSession: false } })
}

async function runTool(call: ToolCall) {
  const supabase = getSupabase()

  if (call.name === 'get_services') {
    const { data, error } = await supabase
      .from('test_services_catalog')
      .select('*')
      .order('title', { ascending: true })
    if (error) return { error: error.message }
    return { services: data || [] }
  }

  if (call.name === 'check_availability') {
    const date = String(call.args.date || '')
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
      return { error: 'Invalid date format. Use YYYY-MM-DD.' }
    }

    const dayStart = `${date}T00:00:00`
    const dayEnd = `${date}T23:59:59`
    const { data, error } = await supabase
      .from('test_bookings')
      .select('booking_date')
      .gte('booking_date', dayStart)
      .lte('booking_date', dayEnd)

    if (error) return { error: error.message }

    const booked = new Set((data || []).map((row: { booking_date: string }) => toHHmm(row.booking_date)))
    const free = buildSlots().filter((slot) => !booked.has(slot))

    return { date, free_slots: free }
  }

  if (call.name === 'create_appointment') {
    const clientName = String(call.args.client_name || '').trim()
    const clientPhone = String(call.args.client_phone || '').trim()
    const serviceId = String(call.args.service_id || '').trim()
    const bookingDate = String(call.args.booking_date || '').trim()

    if (!clientName || !serviceId || !bookingDate) {
      return { error: 'Missing required booking fields.' }
    }

    const bookingYear = new Date(bookingDate).getFullYear()
    const currentYear = new Date().getFullYear()
    if (Number.isNaN(bookingYear) || bookingYear !== currentYear) {
      return { error: 'Bookings must be in the current year.' }
    }

    const { data, error } = await supabase
      .from('test_bookings')
      .insert({
        client_name: clientName,
        client_phone: clientPhone || null,
        service_id: serviceId,
        booking_date: bookingDate
      })
      .select('*')
      .single()

    if (error) return { error: error.message }
    return { booking: data }
  }

  return { error: `Unknown tool: ${call.name}` }
}

function getFunctionCalls(parts: Array<{ functionCall?: { name: string; args: Record<string, unknown> } }> | undefined) {
  if (!parts) return []
  return parts
    .filter((part) => part.functionCall)
    .map((part) => ({
      name: part.functionCall?.name || '',
      args: part.functionCall?.args || {}
    }))
    .filter((call) => call.name)
}

function extractText(parts: Array<{ text?: string }> | undefined) {
  if (!parts) return ''
  return parts.map((part) => part.text || '').join('').trim()
}

export const config = { path: '/api/ai-agent' }

export default async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const apiKey = process.env.VITE_GEMINI_API_KEY
  if (!apiKey) {
    return new Response('Missing VITE_GEMINI_API_KEY', { status: 500 })
  }

  let payload: { messages?: ChatMessage[]; message?: string }
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const incomingMessages = Array.isArray(payload.messages) ? payload.messages : []
  const fallbackText = payload.message || ''
  const safeMessages = incomingMessages.length > 0 ? incomingMessages : [{ role: 'user', content: fallbackText }]
  const lastMessage = safeMessages[safeMessages.length - 1]

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    tools: [
      {
        functionDeclarations: [
          {
            name: 'get_services',
            description: 'List all services from the catalog.',
            parameters: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'check_availability',
            description: 'Check free slots for a given date (YYYY-MM-DD).',
            parameters: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'Date in YYYY-MM-DD format.' }
              },
              required: ['date']
            }
          },
          {
            name: 'create_appointment',
            description: 'Create a booking for a client using the selected service and datetime.',
            parameters: {
              type: 'object',
              properties: {
                client_name: { type: 'string' },
                client_phone: { type: 'string' },
                service_id: { type: 'string' },
                booking_date: { type: 'string', description: 'Timestamp or ISO datetime.' }
              },
              required: ['client_name', 'client_phone', 'service_id', 'booking_date']
            }
          }
        ]
      }
    ]
  })

  const history = safeMessages.slice(0, -1).map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }]
  }))

  const chat = model.startChat({ history })

  let response = await chat.sendMessage(lastMessage.content)
  let parts = response.response.candidates?.[0]?.content?.parts as Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> | undefined

  for (let i = 0; i < 6; i += 1) {
    const calls = getFunctionCalls(parts)
    if (calls.length === 0) break

    for (const call of calls) {
      const result = await runTool(call)
      response = await chat.sendMessage([
        {
          functionResponse: {
            name: call.name,
            response: result
          }
        }
      ])
      parts = response.response.candidates?.[0]?.content?.parts as Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> | undefined
    }
  }

  const reply = extractText(parts)

  return new Response(JSON.stringify({ reply }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  })
}
