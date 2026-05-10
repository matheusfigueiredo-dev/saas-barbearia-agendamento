/// <reference types="node" />
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
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
  'You are the AI Assistant for Dantas Barber. Your goal is to help clients book appointments in a friendly, conversational way, handling natural language. You must use the provided tools to check services and availability. You must handle multiple service selections and sum total prices and durations before confirming. Before confirming a booking, you must summarize: Client Name, Services, Date/Time, Total Price, and Total Duration. If a user asks to cancel an appointment, use the request_cancellation tool and explain the cancellation is pending admin approval. If a user asks for a time not listed (Outro Horario), use the request_custom_time tool and explain it is pending admin approval. You must strictly respect max_duration_minutes from availability and never book services that exceed it. You only book for the current year. Keep responses concise.'

const WORK_START = '08:00'
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

function buildAvailabilitySlots(bookings: Array<{ booking_date: string; duration_minutes?: number | null }>) {
  const workStart = timeToMinutes(WORK_START)
  const workEnd = timeToMinutes(WORK_END)
  const rawBlocks = bookings
    .map((booking) => {
      const startTime = toHHmm(booking.booking_date)
      const start = timeToMinutes(startTime)
      const duration = typeof booking.duration_minutes === 'number' && booking.duration_minutes > 0 ? booking.duration_minutes : SLOT_MINUTES
      const end = Math.min(start + duration, workEnd)
      return { start, end }
    })
    .filter((block) => block.start < workEnd && block.end > workStart)

  rawBlocks.sort((a, b) => a.start - b.start)
  const blocks: Array<{ start: number; end: number }> = []
  for (const block of rawBlocks) {
    const last = blocks[blocks.length - 1]
    if (!last || block.start > last.end) {
      blocks.push({ start: Math.max(block.start, workStart), end: Math.min(block.end, workEnd) })
    } else {
      last.end = Math.max(last.end, block.end)
    }
  }

  const slots: Array<{ time: string; max_duration_minutes: number }> = []
  for (let m = workStart; m < workEnd; m += SLOT_MINUTES) {
    const isBooked = blocks.some((block) => m >= block.start && m < block.end)
    if (isBooked) continue

    const nextBlock = blocks.find((block) => block.start > m)
    const maxDuration = (nextBlock ? nextBlock.start : workEnd) - m
    if (maxDuration <= 0) continue

    const hh = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    slots.push({ time: `${hh}:${mm}`, max_duration_minutes: maxDuration })
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
      .select('booking_date, duration_minutes')
      .eq('status', 'confirmado')
      .gte('booking_date', dayStart)
      .lte('booking_date', dayEnd)

    if (error) return { error: error.message }

    const slots = buildAvailabilitySlots((data || []) as Array<{ booking_date: string; duration_minutes?: number | null }>)
    return { date, slots }
  }

  if (call.name === 'create_appointment') {
    const clientName = String(call.args.client_name || '').trim()
    const clientPhone = String(call.args.client_phone || '').trim()
    const rawServiceIds = Array.isArray(call.args.service_ids) ? call.args.service_ids : []
    const serviceIds = rawServiceIds.map((value) => String(value)).filter(Boolean)
    const bookingDate = String(call.args.booking_date || '').trim()

    if (!clientName || serviceIds.length === 0 || !bookingDate) {
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
        service_ids: serviceIds,
        booking_date: bookingDate,
        status: 'confirmado'
      })
      .select('*')
      .single()

    if (error) return { error: error.message }
    return { booking: data }
  }

  if (call.name === 'request_cancellation') {
    const date = String(call.args.date || '').trim()
    const time = String(call.args.time || '').trim()
    const clientPhone = String(call.args.client_phone || '').trim()

    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !/^[0-9]{2}:[0-9]{2}$/.test(time) || !clientPhone) {
      return { error: 'Missing or invalid cancellation fields.' }
    }

    const bookingDate = `${date}T${time}:00`
    const { data, error } = await supabase
      .from('test_bookings')
      .select('id')
      .eq('booking_date', bookingDate)
      .eq('client_phone', clientPhone)
      .maybeSingle()

    if (error) return { error: error.message }
    if (!data?.id) return { error: 'Booking not found.' }

    const { error: updateError } = await supabase
      .from('test_bookings')
      .update({ status: 'pendente_cancelamento' })
      .eq('id', data.id)

    if (updateError) return { error: updateError.message }
    return { message: 'Cancellation requested and pending admin approval.' }
  }

  if (call.name === 'request_custom_time') {
    const clientName = String(call.args.client_name || '').trim()
    const clientPhone = String(call.args.client_phone || '').trim()
    const rawServiceIds = Array.isArray(call.args.service_ids) ? call.args.service_ids : []
    const serviceIds = rawServiceIds.map((value) => String(value)).filter(Boolean)
    const bookingDate = String(call.args.booking_date || '').trim()

    if (!clientName || !bookingDate || serviceIds.length === 0) {
      return { error: 'Missing required custom time fields.' }
    }

    const { error } = await supabase
      .from('test_bookings')
      .insert({
        client_name: clientName,
        client_phone: clientPhone || null,
        service_ids: serviceIds,
        booking_date: bookingDate,
        status: 'pendente_aprovacao',
        is_custom_time: true
      })

    if (error) return { error: error.message }
    return { message: 'Custom time requested and pending admin approval.' }
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

const defaultHeaders = {
  'content-type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

export const handler = async (event: { httpMethod: string; body?: string | null }) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: defaultHeaders,
      body: JSON.stringify({ ok: true })
    }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 200,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    }
  }

  const apiKey = process.env.VITE_GEMINI_API_KEY
  if (!apiKey) {
    return {
      statusCode: 200,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Missing VITE_GEMINI_API_KEY' })
    }
  }

  let payload: { messages?: ChatMessage[]; message?: string }
  try {
    payload = event.body ? JSON.parse(event.body) : {}
  } catch {
    return {
      statusCode: 200,
      headers: defaultHeaders,
      body: JSON.stringify({ error: 'Invalid JSON' })
    }
  }

  const incomingMessages = Array.isArray(payload.messages) ? payload.messages : []
  const fallbackText = payload.message || ''
  const safeMessages = incomingMessages.length > 0 ? incomingMessages : [{ role: 'user', content: fallbackText }]
  const trimmedMessages = [...safeMessages]
  while (trimmedMessages[0]?.role === 'assistant') {
    trimmedMessages.shift()
  }
  const normalizedMessages = trimmedMessages.length > 0 ? trimmedMessages : [{ role: 'user', content: fallbackText }]
  const lastMessage = normalizedMessages[normalizedMessages.length - 1]

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    tools: [
      {
        functionDeclarations: [
          {
            name: 'get_services',
            description: 'List all services from the catalog.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {},
              required: []
            }
          },
          {
            name: 'check_availability',
            description: 'Check free slots for a given date (YYYY-MM-DD).',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                date: { type: SchemaType.STRING, description: 'Date in YYYY-MM-DD format.' }
              },
              required: ['date']
            }
          },
          {
            name: 'create_appointment',
            description: 'Create a booking for a client using the selected services and datetime.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                client_name: { type: SchemaType.STRING },
                client_phone: { type: SchemaType.STRING },
                service_ids: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                booking_date: { type: SchemaType.STRING, description: 'Timestamp or ISO datetime.' }
              },
              required: ['client_name', 'client_phone', 'service_ids', 'booking_date']
            }
          },
          {
            name: 'request_cancellation',
            description: 'Request cancellation for an existing booking.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                date: { type: SchemaType.STRING, description: 'Date in YYYY-MM-DD format.' },
                time: { type: SchemaType.STRING, description: 'Time in HH:MM format.' },
                client_phone: { type: SchemaType.STRING }
              },
              required: ['date', 'time', 'client_phone']
            }
          },
          {
            name: 'request_custom_time',
            description: 'Request a custom time outside standard availability.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                client_name: { type: SchemaType.STRING },
                client_phone: { type: SchemaType.STRING },
                service_ids: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                booking_date: { type: SchemaType.STRING, description: 'Timestamp or ISO datetime.' }
              },
              required: ['client_name', 'client_phone', 'service_ids', 'booking_date']
            }
          }
        ]
      }
    ]
  })

  const history = normalizedMessages.slice(0, -1).map((message) => ({
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

  return {
    statusCode: 200,
    headers: defaultHeaders,
    body: JSON.stringify({ reply })
  }
}
