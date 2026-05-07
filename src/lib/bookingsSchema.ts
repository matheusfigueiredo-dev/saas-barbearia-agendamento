import type { SupabaseClient } from '@supabase/supabase-js'

export type BookingColumns = {
  dateCol: 'date' | 'book_date' | 'booking_date'
  timeCol: 'time' | 'book_time' | 'booking_time'
}

export type BookingSchema = BookingColumns & {
  // Preferimos status textual, senão booleano, senão nenhum
  statusKind: 'text' | 'boolean' | 'none'
  statusCol?: 'status' | 'booking_status' | 'state'
  isCompletedCol?: 'is_completed' | 'done'
  completedAtCol?: 'completed_at'
  // Coluna opcional para armazenar os serviços detalhados em formato JSON
  servicesJsonCol?: 'services_json' | 'services_detail' | 'services_list'
  // Coluna alternativa genérica (array JSON ou string JSON) com os serviços
  servicesCol?: 'services' | 'servicos' | 'services_ids' | 'services_names' | 'itens' | 'items'
}

let detected: BookingSchema | null = null
let detecting: Promise<BookingSchema> | null = null

export async function getBookingSchema(supabase: SupabaseClient): Promise<BookingSchema> {
  if (detected) return detected
  if (detecting) return detecting
  detecting = (async () => {
    const tryCol = async (col: string) => {
      try {
        const { error } = await supabase.from('bookings').select(col).limit(1)
        return !error
      } catch {
        return false
      }
    }
    const dateCandidates = ['date', 'book_date', 'booking_date'] as const
    const timeCandidates = ['time', 'book_time', 'booking_time'] as const
  // Prefira boolean primeiro para evitar 400 desnecessários quando existirem colunas booleanas
  const statusBoolCandidates = ['is_completed', 'done'] as const
  const statusTextCandidates = ['status', 'booking_status', 'state'] as const
    const completedAtCandidates = ['completed_at'] as const
  const servicesJsonCandidates = ['services_json', 'services_detail', 'services_list'] as const
  const servicesColCandidates = ['services', 'servicos', 'services_ids', 'services_names', 'itens', 'items'] as const

    let dateCol: BookingSchema['dateCol'] | null = null
    for (const c of dateCandidates) { if (await tryCol(c)) { dateCol = c; break } }

    let timeCol: BookingSchema['timeCol'] | null = null
    for (const c of timeCandidates) { if (await tryCol(c)) { timeCol = c; break } }

    if (!dateCol || !timeCol) {
      throw new Error('Tabela bookings não possui colunas de data/hora esperadas. Adicione (date/time) ou (book_date/book_time).')
    }

  let statusKind: BookingSchema['statusKind'] = 'none'
  let statusCol: BookingSchema['statusCol'] | undefined
  let isCompletedCol: BookingSchema['isCompletedCol'] | undefined
    let completedAtCol: BookingSchema['completedAtCol'] | undefined

    // Primeiro tenta booleano
    for (const c of statusBoolCandidates) { if (await tryCol(c)) { statusKind = 'boolean'; isCompletedCol = c; break } }
    // Depois, se não existir, tenta textual
    if (statusKind === 'none') {
      for (const c of statusTextCandidates) { if (await tryCol(c)) { statusKind = 'text'; statusCol = c; break } }
    }
    for (const c of completedAtCandidates) { if (await tryCol(c)) { completedAtCol = c; break } }
  let servicesJsonCol: BookingSchema['servicesJsonCol'] | undefined
  for (const c of servicesJsonCandidates) { if (await tryCol(c)) { servicesJsonCol = c; break } }

  let servicesCol: BookingSchema['servicesCol'] | undefined
  for (const c of servicesColCandidates) { if (await tryCol(c)) { servicesCol = c; break } }

  const res: BookingSchema = { dateCol, timeCol, statusKind, statusCol, isCompletedCol, completedAtCol, servicesJsonCol, servicesCol }
    detected = res
    return res
  })()
  return detecting
}

export async function getBookingColumns(supabase: SupabaseClient): Promise<BookingColumns> {
  const s = await getBookingSchema(supabase)
  return { dateCol: s.dateCol, timeCol: s.timeCol }
}
