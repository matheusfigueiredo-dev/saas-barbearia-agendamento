import 'dotenv/config'
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import { supabase, SUPABASE_URL, SUPABASE_KEY } from './supabase.js'
import { getBookingSchema, getBookingColumns } from './bookingsSchema.js'
import { generateAdaptiveBusinessSlots } from './slots.js'

const SESSIONS = new Map() // phone -> { state, data }
const HANDLED_MSG_IDS = new Set() // evita processar a mesma mensagem múltiplas vezes

const HELP = `Menu:\n- agendar: iniciar um agendamento\n- ajuda: exibe este menu\n- cancelar: cancela o fluxo atual`

// Habilita parsing estrito de datas no formato DD/MM/YYYY
dayjs.extend(customParseFormat)

function reply(sock, jid, text) { return sock.sendMessage(jid, { text }) }
function jidFromMessage(m) { return m.key.remoteJid }
function phoneFromJid(jid) { return jid.split('@')[0] }

function normalizePtDateToISO(text) {
  const t = String(text||'').trim().toLowerCase()
  const now = dayjs()
  if (t === 'hoje') return now.format('YYYY-MM-DD')
  if (t === 'amanha' || t === 'amanhã') return now.add(1,'day').format('YYYY-MM-DD')
  const m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (m) {
    const dd = m[1].padStart(2,'0')
    const MM = m[2].padStart(2,'0')
    const yyyy = (m[3]?.length===2 ? ('20'+m[3]) : (m[3] || String(now.year())))
    // Usa parsing estrito (evita 56/10 virar data no mês seguinte)
    const dStrict = dayjs(`${dd}/${MM}/${yyyy}`, 'DD/MM/YYYY', true)
    if (!dStrict.isValid()) return null
    return dStrict.format('YYYY-MM-DD')
  }
  return null
}

// Lista serviços do banco de forma resiliente (tenta nomes de tabelas/colunas comuns)
let SERVICES_FETCHED_ONCE = false
let LAST_SERVICES_ERROR = ''
async function fetchServices() {
  const tableCandidates = ['services_catalog', 'services', 'servicos', 'catalogo_servicos']
  const colAliases = {
    title: ['title', 'name', 'nome', 'descricao', 'description'],
    price: ['price', 'preco', 'valor'],
    minutes: ['minutes', 'duration', 'duracao', 'duracao_minutos', 'tempo', 'tempo_minutos']
  }

  for (const table of tableCandidates) {
    // Primeiro tenta a consulta "ideal"
    let data, error
    try {
      const res = await supabase.from(table).select('*').order('title', { ascending: true })
      data = res.data; error = res.error
    } catch (e) {
      error = e
    }
    if (error) {
      // Se a tabela não existir, tenta a próxima
      if (/relation .* does not exist/i.test(String(error.message))) continue
      // Outros erros: tenta REST fallback antes de pular para a próxima
      try {
        const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}?select=*` + `&order=title.asc`
        const r = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } })
        if (r.ok) {
          const rows = await r.json()
          if (Array.isArray(rows) && rows.length > 0) {
            const sample = rows[0] || {}
            const pickCol = (aliases) => aliases.find(c => Object.prototype.hasOwnProperty.call(sample, c))
            const titleCol = pickCol(colAliases.title) || 'title'
            const priceCol = pickCol(colAliases.price) || 'price'
            const minutesCol = pickCol(colAliases.minutes) || 'minutes'
            return rows.map(r => ({
              id: String(r.id ?? r.uuid ?? r.slug ?? r.key ?? ''),
              title: String(r[titleCol] || '').trim(),
              price: Number(r[priceCol] ?? 0),
              minutes: Number(r[minutesCol] ?? 0)
            })).filter(s => s.title)
          }
        }
      } catch {}
      const cause = error?.cause
      const details = {
        message: String(error?.message || error || 'unknown'),
        code: cause?.code || error?.code || null,
        name: error?.name || null,
        errno: cause?.errno || null,
        syscall: cause?.syscall || null,
        hostname: cause?.hostname || null
      }
      LAST_SERVICES_ERROR = JSON.stringify(details)
      if (!SERVICES_FETCHED_ONCE) console.warn(`[whatsapp-bot] fetchServices error on ${table}:`, details)
      continue
    }

    const rows = Array.isArray(data) ? data : []
    // Se a tabela existe mas está vazia, devolve vazio (não adianta tentar outra)
    if (rows.length === 0) return []

    // Descobre mapeamento de colunas dinamicamente
    const sample = rows[0] || {}
    const pickCol = (aliases) => aliases.find(c => Object.prototype.hasOwnProperty.call(sample, c))
    const titleCol = pickCol(colAliases.title) || 'title'
    const priceCol = pickCol(colAliases.price) || 'price'
    const minutesCol = pickCol(colAliases.minutes) || 'minutes'

    SERVICES_FETCHED_ONCE = true
    LAST_SERVICES_ERROR = ''
    return rows.map(r => ({
      id: String(r.id ?? r.uuid ?? r.slug ?? r.key ?? ''),
      title: String(r[titleCol] || '').trim(),
      price: Number(r[priceCol] ?? 0),
      minutes: Number(r[minutesCol] ?? 0)
    })).filter(s => s.title)
  }

  // fallback final
  return []
}

async function fetchBusyForDate(dateISO) {
  const cols = await getBookingColumns()
  const sch = await getBookingSchema()
  const selectCols = [cols.timeCol, cols.dateCol, 'duration_minutes', 'service']
  if (sch.statusKind==='text' && sch.statusCol) selectCols.push(sch.statusCol)
  const { data } = await supabase
    .from('bookings')
    .select(selectCols.join(', '))
    .eq(cols.dateCol, dateISO)
  let arr = (data||[])
  // filtra pedidos 'agendar' (não bloqueiam)
  arr = arr.filter(r => {
    let isAgendar = false
    if (sch.statusKind==='text' && sch.statusCol) {
      const st = String(r[sch.statusCol]||'').toLowerCase().trim()
      if (st === 'agendar' || st === 'pendente') isAgendar = true
    }
    const svc = String(r.service||'')
    if (/^\s*AGENDAR\s*:/i.test(svc)) isAgendar = true
    return !isAgendar
  })
  return arr.map(r => ({ time: r[cols.timeCol], durationMinutes: r.duration_minutes }))
}

function toHHmm(s) {
  const t = String(s||'').trim()
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) { const [h,m] = t.split(':'); return `${String(h).padStart(2,'0')}:${m}` }
  if (/^\d{4}$/.test(t)) return `${t.slice(0,2)}:${t.slice(2)}`
  if (/^\d{1,2}$/.test(t)) return `${String(Number(t)).padStart(2,'0')}:00`
  return t
}

async function computeAvailableTimes(dateISO) {
  const busy = await fetchBusyForDate(dateISO)
  const grid = generateAdaptiveBusinessSlots(dateISO, busy, 30)
  return grid
}

async function tryCreateBooking({ name, dateISO, timeHHmm, serviceIds }) {
  const sch = await getBookingSchema()
  const cols = await getBookingColumns()
  const services = await fetchServices()
  const sel = services.filter(s => serviceIds.includes(s.id))
  const titles = sel.map(s=> s.title)
  const price = sel.reduce((a,s)=> a + (s.price||0), 0)
  const minutes = sel.reduce((a,s)=> a + (s.minutes||0), 0)
  const payload = { name: String(name||'Cliente').trim(), phone: null, service: titles.join(', '), price, duration_minutes: minutes }
  payload[cols.dateCol] = dateISO
  payload[cols.timeCol] = toHHmm(timeHHmm)
  if (sch.servicesJsonCol) payload[sch.servicesJsonCol] = sel.map(s=>({ id:s.id, title:s.title, price:s.price, minutes:s.minutes }))
  // Inserção direta; se conflitar, retornamos erro para o usuário escolher outro horário
  const { error } = await supabase.from('bookings').insert([payload])
  if (error) return { ok:false, message: error.message || 'Falha ao inserir' }
  return { ok:true, price, minutes, titles }
}

function startFlow(jid) { SESSIONS.set(jid, { state: 'ask_name', data: {} }) }

async function onMessage(sock, m) {
  // Ignora mensagens geradas pelo próprio bot/usuário (inclui conversa consigo mesmo)
  if (m.key?.fromMe) return
  // Evita processar o mesmo ID duas vezes (history sync / reemissão do Baileys)
  const mid = m.key?.id
  if (mid && HANDLED_MSG_IDS.has(mid)) return
  if (mid) HANDLED_MSG_IDS.add(mid)

  const jid = jidFromMessage(m) || ''
  // Aceita apenas 1:1 (contatos). Ignora grupos e broadcasts/status
  if (!jid.endsWith('@s.whatsapp.net')) return

  const text = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim()
  if (!text) return

  let s = SESSIONS.get(jid)
  if (!s) {
    if (/^(menu|ajuda|help)$/i.test(text)) { await reply(sock, jid, HELP); return }
    if (/^(agendar|oi|ol[aá])$/i.test(text)) { startFlow(jid); await reply(sock, jid, 'Legal! Vamos agendar. Qual seu nome?'); return }
    await reply(sock, jid, 'Olá! Digite "agendar" para iniciar ou "ajuda" para ver o menu.')
    return
  }

  // Cancelar
  if (/^cancelar$/i.test(text)) { SESSIONS.delete(jid); await reply(sock, jid, 'Fluxo cancelado. Digite "agendar" para iniciar novamente.'); return }

  // Máquina de estados simples
  if (s.state === 'ask_name') {
    s.data.name = text
    s.state = 'ask_date'
    await reply(sock, jid, 'Ótimo, informe a data (ex.: 25/10, "hoje" ou "amanhã").')
    return
  }
  if (s.state === 'ask_date') {
    const iso = normalizePtDateToISO(text)
    if (!iso) {
      // Sugere próximas datas válidas (sem domingos)
      const suggestions = []
      let d = dayjs()
      while (suggestions.length < 4) {
        if (d.day() !== 0) suggestions.push(d.format('DD/MM'))
        d = d.add(1,'day')
      }
      await reply(sock, jid, `Data inválida. Informe uma data válida a partir de hoje (ex.: ${suggestions.join(', ')}).`)
      return
    }
    // Não permitir datas no passado
    const todayISO = dayjs().format('YYYY-MM-DD')
    if (dayjs(iso).isBefore(dayjs(todayISO))) {
      await reply(sock, jid, `Data anterior a hoje. Informe uma data a partir de ${dayjs(todayISO).format('DD/MM')}.`)
      return
    }
    const dow = dayjs(iso).day()
    if (dow === 0) { await reply(sock, jid, 'Domingo está indisponível. Informe outra data.'); return }
    s.data.dateISO = iso
    s.state = 'ask_service'
    const svc = await fetchServices()
    if (svc.length === 0) {
      const msg = LAST_SERVICES_ERROR
        ? 'Estamos com instabilidade ao consultar os serviços. Tente novamente em alguns minutos.'
        : 'Não há serviços cadastrados no momento.'
      await reply(sock, jid, msg)
      SESSIONS.delete(jid)
      return
    }
    const list = svc.map((v, i) => `${i+1}. ${v.title} • ${v.minutes} min • R$ ${v.price.toFixed(2)} (id ${v.id})`).join('\n')
    s.data._services = svc
    await reply(sock, jid, `Escolha os serviços (ex.: 1,3):\n${list}`)
    return
  }
  if (s.state === 'ask_service') {
    const svc = s.data._services || []
    const nums = text.split(/[,\s]+/).map(t=>t.trim()).filter(Boolean)
    const indices = []
    for (const n of nums) { const i = Number(n)-1; if (!isNaN(i) && i>=0 && i<svc.length) indices.push(i) }
    const ids = Array.from(new Set(indices.map(i=> svc[i].id)))
    if (ids.length === 0) { await reply(sock, jid, 'Não entendi. Responda com os números dos serviços, ex.: 1,3'); return }
    s.data.serviceIds = ids
    s.state = 'ask_time'
    const slots = await computeAvailableTimes(s.data.dateISO)
    if (slots.length === 0) { await reply(sock, jid, 'Sem horários disponíveis nessa data. Informe outra data (ex.: 26/10).'); s.state='ask_date'; return }
    await reply(sock, jid, `Horários disponíveis:\n${slots.join('  ')}\n\nInforme um horário (ex.: 14:30).`)
    return
  }
  if (s.state === 'ask_time') {
    const hhmm = toHHmm(text)
    const slots = await computeAvailableTimes(s.data.dateISO)
    if (!slots.includes(hhmm)) { await reply(sock, jid, 'Horário indisponível. Escolha um dos horários listados.'); return }
    s.data.timeHHmm = hhmm
    s.state = 'confirm'
    const svc = (s.data._services||[]).filter(x=> s.data.serviceIds.includes(x.id))
    const titles = svc.map(x=> x.title).join(', ')
    await reply(sock, jid, `Confirmar agendamento?\nNome: ${s.data.name}\nData: ${dayjs(s.data.dateISO).format('DD/MM/YYYY')}\nHora: ${s.data.timeHHmm}\nServiços: ${titles}\n\nResponda com "sim" para confirmar ou "cancelar".`)
    return
  }
  if (s.state === 'confirm') {
    if (!/^sim$/i.test(text)) { await reply(sock, jid, 'Operação cancelada.'); SESSIONS.delete(jid); return }
    const { name, dateISO, timeHHmm, serviceIds } = s.data
    const res = await tryCreateBooking({ name, dateISO, timeHHmm, serviceIds })
    if (!res.ok) { await reply(sock, jid, `Não deu certo: ${res.message}. Tente outro horário.`); s.state='ask_time'; return }
    await reply(sock, jid, `Agendamento confirmado!\nData: ${dayjs(dateISO).format('DD/MM/YYYY')}\nHora: ${timeHHmm}\nTotal: ${res.minutes} min • R$ ${res.price.toFixed(2)}\n\nObrigado!`)
    SESSIONS.delete(jid)
    return
  }
}

async function start() {
  const { version } = await fetchLatestBaileysVersion()
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  const sock = makeWASocket({ version, auth: state, /* printQRInTerminal deprecated */ generateHighQualityLinkPreview: true })

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u
    if (qr) {
      console.clear()
      console.log('[whatsapp-bot] Aponte a câmera do WhatsApp para este QR:')
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut)
      if (shouldReconnect) start().catch(console.error)
    }
  })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) { try { await onMessage(sock, m) } catch (e) { console.error('onMessage error', e) } }
  })

  console.log('[whatsapp-bot] Ready. Scan the QR code above to connect.')
}

start().catch(err => { console.error(err); process.exit(1) })
