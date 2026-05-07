// Lightweight copy of the web app helper to detect flexible schema columns
import { supabase } from './supabase.js'

export async function getBookingSchema() {
  const tryCol = async (col) => {
    try { const { error } = await supabase.from('bookings').select(col).limit(1); return !error } catch { return false }
  }
  const dateCandidates = ['date','book_date','booking_date']
  const timeCandidates = ['time','book_time','booking_time']
  const statusBoolCandidates = ['is_completed','done']
  const statusTextCandidates = ['status','booking_status','state']
  const completedAtCandidates = ['completed_at']
  const servicesJsonCandidates = ['services_json','services_detail','services_list']
  const servicesColCandidates = ['services','servicos','services_ids','services_names','itens','items']

  let dateCol = null
  for (const c of dateCandidates) { if (await tryCol(c)) { dateCol = c; break } }
  let timeCol = null
  for (const c of timeCandidates) { if (await tryCol(c)) { timeCol = c; break } }
  if (!dateCol || !timeCol) throw new Error('Tabela bookings sem colunas de data/hora esperadas.')

  let statusKind = 'none'
  let statusCol; let isCompletedCol; let completedAtCol
  for (const c of statusBoolCandidates) { if (await tryCol(c)) { statusKind = 'boolean'; isCompletedCol = c; break } }
  if (statusKind === 'none') {
    for (const c of statusTextCandidates) { if (await tryCol(c)) { statusKind = 'text'; statusCol = c; break } }
  }
  for (const c of completedAtCandidates) { if (await tryCol(c)) { completedAtCol = c; break } }
  let servicesJsonCol; for (const c of servicesJsonCandidates) { if (await tryCol(c)) { servicesJsonCol = c; break } }
  let servicesCol; for (const c of servicesColCandidates) { if (await tryCol(c)) { servicesCol = c; break } }

  return { dateCol, timeCol, statusKind, statusCol, isCompletedCol, completedAtCol, servicesJsonCol, servicesCol }
}

export async function getBookingColumns() {
  const s = await getBookingSchema()
  return { dateCol: s.dateCol, timeCol: s.timeCol }
}
