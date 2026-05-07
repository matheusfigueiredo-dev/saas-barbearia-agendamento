import 'dotenv/config'
import dayjs from 'dayjs'
import { supabase } from './supabase.js'
import { getBookingSchema } from './bookingsSchema.js'

function toHHmm(v) {
  const t = String(v||'').trim()
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) { const [h,m] = t.split(':'); return `${String(h).padStart(2,'0')}:${m}` }
  if (/^\d{4}$/.test(t)) return `${t.slice(0,2)}:${t.slice(2)}`
  if (/^\d{1,2}$/.test(t)) return `${String(Number(t)).padStart(2,'0')}:00`
  return t || '00:00'
}

async function main() {
  const { dateCol, timeCol } = await getBookingSchema()
  const now = dayjs()
  const dateISO = now.format('YYYY-MM-DD')
  const time = now.add(10, 'minute').format('HH:mm')

  const payload = { name: 'Teste Notifier', service: 'Corte (teste)', price: 0, duration_minutes: 30 }
  payload[dateCol] = dateISO
  payload[timeCol] = toHHmm(time)

  const { error } = await supabase.from('bookings').insert([payload])
  if (error) {
    console.error('[test-insert] Falha ao inserir:', error.message || error)
    process.exit(1)
  }
  console.log(`[test-insert] Inserido! ${payload.name} em ${dateISO} às ${payload[timeCol]}`)
}

main().catch(err => { console.error('[test-insert] erro fatal:', err); process.exit(1) })
