import 'dotenv/config'
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import { supabase } from './supabase.js'
import { getBookingSchema } from './bookingsSchema.js'

// Ajuste de parsing/format de datas
dayjs.extend(customParseFormat)

// Helpers WhatsApp
function toJidFromPhone(phone) {
  let d = String(phone||'').trim()
  if (d.startsWith('+')) d = d.slice(1)
  d = d.replace(/\D/g, '')
  if (!/^\d{8,15}$/.test(d)) throw new Error(`BARBER_PHONE inválido: ${phone}`)
  return d + '@s.whatsapp.net'
}

function toHHmm(v) {
  const t = String(v||'').trim()
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) { const [h,m] = t.split(':'); return `${String(h).padStart(2,'0')}:${m}` }
  if (/^\d{4}$/.test(t)) return `${t.slice(0,2)}:${t.slice(2)}`
  if (/^\d{1,2}$/.test(t)) return `${String(Number(t)).padStart(2,'0')}:00`
  return t || '00:00'
}

function pickNameCol(row) {
  const aliases = ['name','nome','customer_name','client_name','full_name']
  for (const c of aliases) { if (Object.prototype.hasOwnProperty.call(row, c)) return c }
  // fallback: tenta "phone" apenas para log
  return aliases[0]
}

async function startNotifier() {
  const BARBER_PHONE = process.env.BARBER_PHONE || process.env.WHATSAPP_DEST || ''
  if (!BARBER_PHONE) {
    console.error('[notifier] Defina BARBER_PHONE no arquivo .env (ex.: 55DDDNUMERO)')
    process.exit(1)
  }
  const barberJid = toJidFromPhone(BARBER_PHONE)

  // Conecta o WhatsApp (Baileys)
  const { version } = await fetchLatestBaileysVersion()
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  const sock = makeWASocket({ version, auth: state, generateHighQualityLinkPreview: true })

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u
    if (qr) {
      console.clear()
      console.log('[notifier] Aponte a câmera do WhatsApp para este QR (conta do barbeiro):')
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut)
      if (shouldReconnect) startNotifier().catch(console.error)
    }
  })
  sock.ev.on('creds.update', saveCreds)

  // Descobre colunas dinâmicas (data/hora)
  const schema = await getBookingSchema()
  const dateCol = schema.dateCol
  const timeCol = schema.timeCol

  // Inscreve no Realtime
  const table = process.env.NOTIFIER_TABLE || 'bookings'
  const schemaName = process.env.NOTIFIER_SCHEMA || 'public'
  console.log(`[notifier] Aguardando novos agendamentos em ${schemaName}.${table} …`)

  const channel = supabase.channel('bookings-insert')
    .on('postgres_changes', { event: 'INSERT', schema: schemaName, table }, async (payload) => {
      try {
        const row = payload.new || {}
        const nameCol = pickNameCol(row)
        const name = String(row[nameCol] || 'Cliente').trim()
        const dateISO = String(row[dateCol]||'')
        const time = toHHmm(row[timeCol])
        const dateBr = dayjs(dateISO, ['YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss.SSSZ', 'DD/MM/YYYY'], true).isValid()
          ? dayjs(dateISO).format('DD/MM/YYYY')
          : String(dateISO)
        const text = `Novo agendamento:\n${name}\n${dateBr} às ${time}`
        console.log('[notifier] Enviando para o barbeiro:', text)
        await sock.sendMessage(barberJid, { text })
      } catch (e) {
        console.error('[notifier] Falha ao enviar aviso:', e?.message||e)
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') console.log('[notifier] Inscrito no canal Realtime (INSERT bookings).')
    })

  // Mantém processo vivo
  process.on('SIGINT', async () => { try { await channel.unsubscribe(); } catch {} process.exit(0) })
}

startNotifier().catch(err => { console.error('[notifier] erro fatal:', err); process.exit(1) })
