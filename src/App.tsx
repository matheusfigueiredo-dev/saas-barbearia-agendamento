import React, { useEffect, useMemo, useRef, useState } from 'react'
// Import do jsPDF é feito dinamicamente dentro de generatePdfReceipt para evitar peso inicial e problemas de cache.
import dayjs from 'dayjs'
import clsx from 'clsx'
import { getSupabase } from './lib/supabase'
import { getBookingColumns, getBookingSchema } from './lib/bookingsSchema'
import { generateAdaptiveBusinessSlots } from './lib/slots'
import { BarberSelectionStep } from './components/BarberSelectionStep'
import { useBarberSelection } from './context/BarberContext'
import AIChatModal from './components/AIChatModal'

export default function App() {
  const { selectedBarberId, setSelectedBarberId, selectedBarber, barbers } = useBarberSelection()
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [now, setNow] = useState(dayjs())
  type Service = { id: string; title: string; price: number; minutes: number; image?: string | null }
  const [services, setServices] = useState<Service[]>([])
  const [servicesError, setServicesError] = useState<string | null>(null)
  // Permitir múltiplos serviços
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [busyTimes, setBusyTimes] = useState<string[]>([])
  const [busyBookings, setBusyBookings] = useState<{ time: string; durationMinutes?: number | null }[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [slotsReady, setSlotsReady] = useState(false)
  const [servicesReady, setServicesReady] = useState(false)
  const [splashVisible, setSplashVisible] = useState(true)
  const [splashFadeOut, setSplashFadeOut] = useState(false)
  const [secretClicks, setSecretClicks] = useState(0)
  const [showAdminLink, setShowAdminLink] = useState(false)
  const [toast, setToast] = useState<{ text: string; type?: 'info' | 'success' | 'warning' | 'error' | 'cancelled'; details?: {
    date?: string;
    time?: string;
    services?: { title: string; minutes: number; price: number }[];
    totalMinutes?: number;
    totalPrice?: number;
  } } | null>(null)
  // Solicitação de horário específico (Outro Horário)
  const [customTimeOpen, setCustomTimeOpen] = useState(false)
  const [customTime, setCustomTime] = useState<string>('')
  const [isCustomTime, setIsCustomTime] = useState(false)
  // Cancelamento de agendamento
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelDate, setCancelDate] = useState<string>('')
  const [cancelTime, setCancelTime] = useState<string>('')
  const [cancelLoading, setCancelLoading] = useState(false)
  const [cancelMessage, setCancelMessage] = useState<string | null>(null)
  const dateFieldRef = useRef<HTMLDivElement | null>(null)
  const dateInputRef = useRef<HTMLInputElement | null>(null)
  const shouldJumpToDateRef = useRef(false)

  // Atualiza o relógio a cada 30s para recalcular disponibilidade de horários do "dia de hoje"
  useEffect(() => {
    const id = setInterval(() => setNow(dayjs()), 30000)
    return () => clearInterval(id)
  }, [])

  // Restaura data após reload causado por cancelamento
  useEffect(() => {
    try {
      const kd = localStorage.getItem('keepDate')
      if (kd) {
        localStorage.removeItem('keepDate')
        if (dayjs(kd).isValid()) setDate(dayjs(kd).format('YYYY-MM-DD'))
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (slotsReady && servicesReady) {
      setSplashFadeOut(true)
      const timeout = setTimeout(() => setSplashVisible(false), 600)
      return () => clearTimeout(timeout)
    }
    return undefined
  }, [slotsReady, servicesReady])

  useEffect(() => {
    let active = true
    const d = dayjs(date).format('YYYY-MM-DD')
    async function load() {
      const supa = getSupabase()
      const cols = await getBookingColumns(supa)
      // Schema completo (para detectar status/services_json)
      const sch = await getBookingSchema(supa)

      // Monta colunas a selecionar de forma segura
      const selectCols: string[] = [cols.timeCol, cols.dateCol, 'duration_minutes']
      // always tentar pegar service (usamos para detectar pedidos especiais)
      selectCols.push('service')
      if (sch.statusKind === 'text' && sch.statusCol) selectCols.push(sch.statusCol)
      if (sch.servicesJsonCol) selectCols.push(sch.servicesJsonCol)

      const { data, error } = await supa
        .from('bookings')
        .select(selectCols.join(', '))
        .eq(cols.dateCol, d)
        .eq('barber_id', selectedBarberId)
      if (!active) return
      if (error) {
        setBusyTimes([])
        setBusyBookings([])
        setSlotsReady(true)
      } else {
        let arr = ((data as any[]) || [])
        // Filtra pedidos de "Outro Horário" pendentes para não impactarem a grade até aprovação.
        arr = arr.filter(r => {
          let isCustomPending = false
          if (sch.statusKind === 'text' && sch.statusCol) {
            const st = String(r[sch.statusCol] || '').toLowerCase().trim()
            if (st === 'agendar' || st === 'pendente') isCustomPending = true
          }
          const svc = String(r.service || '')
          if (/^AGENDAR:/i.test(svc)) isCustomPending = true
          return !isCustomPending
        })
        setBusyTimes(arr.map((r) => r[cols.timeCol]))
        setBusyBookings(arr.map((r) => ({ time: r[cols.timeCol], durationMinutes: r.duration_minutes })))
        setSlotsReady(true)
      }
    }
    load()
    const supa = getSupabase()
    let colsPromise = getBookingColumns(supa)
    const channel = supa
      .channel(`bookings-day-${d}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `barber_id=eq.${selectedBarberId}` }, async (payload) => {
        const cols = await colsPromise
        const newD = d
        // Recarrega somente se for o mesmo dia
        const row: any = payload.new || payload.old || {}
        if (row[cols.dateCol] === newD) void load()
      })
      .subscribe()
    return () => { active = false; getSupabase().removeChannel(channel) }
  }, [date, selectedBarberId])

  useEffect(() => {
    if (!shouldJumpToDateRef.current) return
    shouldJumpToDateRef.current = false
    const frame = window.requestAnimationFrame(() => {
      dateFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      window.setTimeout(() => {
        dateInputRef.current?.focus({ preventScroll: true })
      }, 180)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selectedBarberId])

  useEffect(() => {
    let active = true
    async function loadServices() {
      const { data, error } = await getSupabase().from('services_catalog').select('id, title, price, minutes, image, barber_id').eq('barber_id', selectedBarberId).order('title', { ascending: true })
      if (!active) return
      if (error) setServicesError(error.message || 'Falha ao carregar serviços')
      else {
        type SvcRow = { id: string | number; title: string; price: number; minutes: number; image: string | null; barber_id?: string | null }
        const arr: Service[] = ((data as SvcRow[]) || []).map((d) => ({ id: String(d.id), title: d.title, price: Number(d.price ?? 0), minutes: Number(d.minutes ?? 0), image: d.image ?? null }))
  setServices(arr)
  if (servicesError) setServicesError(null)
        setServicesReady(true)
        return
      }
      setServicesReady(true)
    }
    loadServices()
    const channel = getSupabase().channel('services_catalog').on('postgres_changes', { event: '*', schema: 'public', table: 'services_catalog', filter: `barber_id=eq.${selectedBarberId}` }, () => void loadServices()).subscribe()
    return () => { active = false; getSupabase().removeChannel(channel) }
  }, [servicesError, selectedBarberId])

  useEffect(() => {
    setSelectedServiceIds([])
    setSelectedTime(null)
    setIsCustomTime(false)
    setMessage(null)
  }, [selectedBarberId])

  // Auto-esconde notificações após 3s (exceto erro e sucesso, que usam diálogo central)
  useEffect(() => {
    if (!toast) return
    // Não auto-esconder erros, sucessos, avisos (warning) e modal de cancelamento.
    if (toast.type === 'error' || toast.type === 'success' || toast.type === 'warning' || toast.type === 'cancelled') return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  function notify(text: string, type: 'info' | 'success' | 'warning' | 'error' | 'cancelled' = 'warning', details?: {
    date?: string;
    time?: string;
    services?: { title: string; minutes: number; price: number }[];
    totalMinutes?: number;
    totalPrice?: number;
  }) {
    setToast({ text, type, details })
  }

  // Local lookup para minutos/preço reais a partir do catálogo carregado (services state)
  function servicesStateLookup(titleOrId: string, svcListOverride?: { title: string; minutes: number; price: number }[]) {
    const norm = (s:string) => s.toLowerCase()
    const catalog = services
    const t = String(titleOrId||'').trim()
    if (!t) return null
    // Match exato por título
    let found = catalog.find(c => norm(c.title) === norm(t))
    // Se não achou e for ID numérico
    if (!found && /^\d+$/.test(t)) found = catalog.find(c => c.id === t)
    return found ? { title: found.title, minutes: found.minutes, price: found.price } : null
  }

  async function generatePdfReceipt() {
    if (!toast || toast.type !== 'success' || !toast.details) return
    const d = toast.details
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'pt', format: 'A4' })
    const marginX = 56
    let cursorY = 72

    // Header brand
    doc.setFillColor(22, 30, 25)
    doc.roundedRect(marginX - 16, cursorY - 52, 500, 90, 12, 12, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(255, 255, 255)
    doc.text('Dantas Barber Shop', marginX, cursorY)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(200, 230, 215)
    doc.text('Comprovante de Agendamento', marginX, cursorY + 16)
    cursorY += 70

    // Box main info
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(34, 34, 34)
    doc.text('Resumo', marginX, cursorY)
    cursorY += 14
    doc.setDrawColor(30, 150, 110)
    doc.setLineWidth(1)
    doc.line(marginX, cursorY, marginX + 80, cursorY)
    cursorY += 20
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(40, 40, 40)
  const formattedDate = (()=>{ const ds=d.date||''; const m=/^\d{4}-\d{2}-\d{2}$/.test(ds)? ds.split('-'): null; if(m) return `${m[2]}-${m[1]}-${m[0]}`; return d.date||'-' })()
  doc.text(`Data: ${formattedDate}`, marginX, cursorY)
    doc.text(`Horário: ${d.time || '-'}`, marginX + 220, cursorY)
    cursorY += 28

    // Services list (tabela multi-linha corrigida)
  let services = Array.isArray(d.services) ? [...d.services] : []
    // Caso tenha vindo um único item com vários serviços concatenados por vírgula
    if (services.length === 1) {
      const only = services[0]
      if (only && typeof only.title === 'string' && only.title.includes(',')) {
        const parts = only.title.split(',').map(p=>p.trim()).filter(Boolean)
        if (parts.length > 1) {
          // Distribui minutos/preço proporcionalmente
          const totalMinutes = (d.totalMinutes && d.totalMinutes > 0) ? d.totalMinutes : (only.minutes || 0)
          const totalPrice = (d.totalPrice && d.totalPrice > 0) ? d.totalPrice : (only.price || 0)
          const baseMin = totalMinutes > 0 ? Math.floor(totalMinutes / parts.length) : 0
          let remMin = totalMinutes - baseMin * parts.length
          const basePrice = totalPrice > 0 ? (totalPrice / parts.length) : 0
          services = parts.map((p, idx) => ({
            title: p,
            minutes: totalMinutes > 0 ? (baseMin + (remMin>0 ? (remMin--,1):0)) : 0,
            price: basePrice
          }))
        }
      }
    }
    // Mapear minutos e preço reais a partir do catálogo carregado em memória (state services)
    const norm = (t:string) => t.toLowerCase()
    services = services.map(s => {
      const baseTitle = (s.title || '').trim()
      const found = servicesStateLookup(baseTitle, services)
      return found ? { ...s, minutes: found.minutes || s.minutes, price: found.price || s.price, title: found.title || s.title } : s
    })
    // Fallback distribuição de minutos se todos zero
    if (services.length>0 && services.every(s=>!s.minutes) && (d.totalMinutes||0) > 0) {
      const totalM = d.totalMinutes || 0
      const base = Math.floor(totalM / services.length)
      let rem = totalM - base*services.length
      services = services.map(s=> ({ ...s, minutes: base + (rem>0 ? (rem--,1):0) }))
    }
    // Fallback distribuição de preço se todos zero
    if (services.length>0 && services.every(s=>!s.price) && (d.totalPrice||0) > 0) {
      const per = (d.totalPrice || 0) / services.length
      services = services.map(s=> ({ ...s, price: per }))
    }
    if (services.length > 0) {
      // Definição de colunas (layout mais equilibrado)
      const tableWidth = 470
      const colService = 270
      const colMinutes = 70
      const colPrice = tableWidth - colService - colMinutes // ajusta automaticamente

      // Cabeçalho
      doc.setFillColor(236, 240, 238)
      doc.setDrawColor(210, 220, 215)
      doc.setLineWidth(0.6)
      doc.roundedRect(marginX - 6, cursorY - 14, tableWidth, 26, 4, 4, 'F')
      doc.setFontSize(10.5)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(30, 30, 30)
      const headY = cursorY + 2
      doc.text('Serviço', marginX, headY)
      doc.text('Min', marginX + colService, headY, { align: 'right' })
      doc.text('Preço (R$)', marginX + colService + colMinutes + colPrice, headY, { align: 'right' })
      cursorY += 16

      // Conteúdo
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      const rowHeight = 18
      services.forEach((s, idx) => {
        if (cursorY > 740) { doc.addPage(); cursorY = 72 }
        const yMid = cursorY + 12
        // Zebra
        if (idx % 2 === 0) {
          doc.setFillColor(249, 251, 250)
          doc.rect(marginX - 6, cursorY - 4, tableWidth, rowHeight, 'F')
        }
        doc.setTextColor(45, 55, 52)
        // Serviço (quebra simples se título muito grande)
        const maxServiceChars = 46
        let serviceName = s.title
        if (serviceName.length > maxServiceChars) serviceName = serviceName.slice(0, maxServiceChars - 1) + '…'
        doc.text(serviceName, marginX, yMid)
        doc.text(String(s.minutes || 0), marginX + colService, yMid, { align: 'right' })
        doc.text((s.price || 0).toFixed(2), marginX + colService + colMinutes + colPrice, yMid, { align: 'right' })
        cursorY += rowHeight - 2
      })

      // Linha separadora leve
      doc.setDrawColor(225, 230, 228)
      doc.setLineWidth(0.5)
      doc.line(marginX - 6, cursorY - 2, marginX - 6 + tableWidth, cursorY - 2)
      cursorY += 16 // espaço extra antes do total
    }

    // Totals box (reposicionado abaixo da tabela sem sobrepor)
  const computedMinutes = (d.totalMinutes && d.totalMinutes>0) ? d.totalMinutes : services.reduce((a,s)=>a + (s.minutes||0),0)
  const computedPrice = (d.totalPrice && d.totalPrice>0) ? d.totalPrice : services.reduce((a,s)=>a + (s.price||0),0)
  const totalPriceStr = computedPrice ? computedPrice.toFixed(2) : '-'
    const totalBoxTop = cursorY
    doc.setFont('helvetica','bold')
    doc.setFontSize(12)
    doc.setFillColor(230,250,243)
    doc.roundedRect(marginX - 10, totalBoxTop, 280, 40, 8,8,'F')
    doc.setTextColor(20,90,70)
  doc.text(`Total: ${computedMinutes || '-'} min • R$ ${totalPriceStr}`, marginX, totalBoxTop + 24)
    cursorY = totalBoxTop + 60

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(120, 120, 120)
    doc.text('Obrigado por escolher a Dantas Barber Shop. Chegue alguns minutos antes do horário marcado.', marginX, cursorY)

    const fileName = `comprovante_${(d.date || 'data').replace(/\//g,'-')}_${d.time || 'hora'}.pdf`
    doc.save(fileName)
  }

  function toHHmm(t: string): string {
    if (!t) return t
    // HH:mm or HH:mm:ss
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) {
      const [hh, mm] = t.split(':')
      return `${String(hh).padStart(2, '0')}:${mm}`
    }
    // HHmm
    if (/^\d{4}$/.test(t)) return `${t.slice(0, 2)}:${t.slice(2)}`
    // H or HH
    if (/^\d{1,2}$/.test(t)) return `${String(Number(t)).padStart(2, '0')}:00`
    return t
  }

  function minutesOf(t: string): number {
    const s = toHHmm(t)
    const [hh, mm] = s.split(':').map(Number)
    return (hh || 0) * 60 + (mm || 0)
  }

  // Bloqueio de horário de almoço: 12:00 <= t < 14:00
  function isLunchBreak(t: string | null | undefined): boolean {
    if (!t) return false
    const m = minutesOf(t)
    return m >= 12 * 60 && m < 14 * 60
  }

  const { slots, restrictedMicroSlots } = useMemo(() => {
    // Usa as durações reais quando disponíveis
    const occupied = busyBookings.length > 0 ? busyBookings : busyTimes.map((t) => ({ time: t, durationMinutes: 30 }))
    const base = generateAdaptiveBusinessSlots(date, occupied, 30)
    const set = new Set<string>([...base, ...busyTimes].map(toHHmm))
    const microLimited = new Set<string>()

    // Descobre menor duração de serviço cadastrada (fallback 5 min)
    const minService = (() => {
      const mins = services.map(s => s.minutes || 0).filter(m => m > 0)
      if (mins.length === 0) return 5
      return Math.min(...mins)
    })()
    const effectiveMin = Math.max(5, minService) // nunca menor que 5

    // Adiciona micro-slot APENAS no término de um agendamento quando há
    // pelo menos um serviço mínimo até o próximo LIMITE (próximo booking,
    // início do almoço ou fechamento do expediente). Não criamos cadeias
    // de "+30" após o término – apenas o horário final do serviço.
    const dayPrefix = dayjs(date).format('YYYY-MM-DD')
    const parsed = occupied
      .map(b => {
        const start = dayjs(`${dayPrefix}T${toHHmm(b.time)}`)
        const dur = Math.max(0, Number(b.durationMinutes ?? 30))
        return { start, end: start.add(dur, 'minute') }
      })
      .sort((a, b) => a.start.valueOf() - b.start.valueOf())

    // Determina fechamentos por dia (limites físicos do expediente)
    const dayDow = dayjs(date).day() // 0=Dom
    // Sábado encerra às 15:30 (último base às 15:00). Sex às 19:00. Seg-qui às 18:30.
    const closingStr = dayDow === 6 ? '15:30' : (dayDow === 5 ? '19:00' : (dayDow === 0 ? '00:00' : '18:30'))
    const closingTime = dayjs(`${dayPrefix}T${closingStr}`)
    const lunchStart = dayjs(`${dayPrefix}T12:00`)
    const lunchEnd = dayjs(`${dayPrefix}T14:00`)

    function nextBoundary(after: dayjs.Dayjs): dayjs.Dayjs {
      // Próximo booking após "after"
      const nextBk = parsed.find(p => p.start.isAfter(after))?.start
      // Almoço só conta se ainda não começou e estamos antes dele
      const lunchBoundary = after.isBefore(lunchStart) ? lunchStart : null
      // Fechamento diário
      const closeBoundary = closingTime
      // Menor entre existentes e depois de "after"
      const candidates = [nextBk, lunchBoundary, closeBoundary].filter((d): d is dayjs.Dayjs => !!d && d.isAfter(after))
      return candidates.sort((a, b) => a.valueOf() - b.valueOf())[0] || closeBoundary
    }

    // Além dos slots livres, vamos também exibir, em vermelho, todos os pontos de 30 em 30 min dentro de qualquer intervalo ocupado (inclui bloqueios).
    const stepMin = 30
    const occupiedDisplaySet = new Set<string>()
    for (const iv of parsed) {
      let cur = iv.start
      while (cur.isBefore(iv.end)) {
        const hhmm = cur.format('HH:mm')
        occupiedDisplaySet.add(hhmm)
        cur = cur.add(stepMin, 'minute')
      }
    }
    // Slots adicionais ao término de serviços, com regra especial de fim de expediente
    // - Em geral: criar micro-slot no término do serviço quando houver pelo menos effectiveMin até o próximo limite
    // - Regra especial (fim de expediente):
    //   Seg-qui: último base 18:00 -> se duração <= 20min, liberar micro 18:25 (término + 5)
    //   Sex:     último base 18:30 -> se duração <= 20min, liberar micro 18:55 (término + 5)
    //   Sáb:     último base 15:00 -> se duração <= 20min, liberar micro 15:25 (término + 5)
    const lastBaseStartStr = ((): string | null => {
      if (dayDow >= 1 && dayDow <= 4) return '18:00'
      if (dayDow === 5) return '18:30'
      if (dayDow === 6) return '15:00'
      return null
    })()
    for (let i = 0; i < parsed.length; i++) {
      const current = parsed[i]
      const boundary = nextBoundary(current.end)
      const duration = current.end.diff(current.start, 'minute')
      const isLastBaseBooking = lastBaseStartStr ? current.start.format('HH:mm') === lastBaseStartStr : false

      if (isLastBaseBooking) {
        if (duration <= 20) {
          // micro-slot 5 minutos após o término, respeitando o limite do dia
          const microAt = current.end.add(5, 'minute')
          const gapFromMicro = boundary.diff(microAt, 'minute')
          const hhmmMicro = microAt.format('HH:mm')
          if (gapFromMicro >= 5 && !isLunchBreak(hhmmMicro) && minutesOf(hhmmMicro) < minutesOf(closingStr)) {
            if (!set.has(hhmmMicro)) {
              set.add(hhmmMicro)
              microLimited.add(hhmmMicro)
            }
          }
        }
        // Qualquer agendamento iniciado no último horário base já consome o expediente; não devemos criar slots adicionais.
        continue
      }

      // Regra geral (mantida)
      const gap = boundary.diff(current.end, 'minute')
      if (gap >= effectiveMin) {
        const hhmm = current.end.format('HH:mm')
        if (!isLunchBreak(hhmm) && minutesOf(hhmm) < minutesOf(closingStr)) {
          if (!set.has(hhmm)) set.add(hhmm)
        }
      }
    }
    // Garante que todos os pontos dentro de intervalos ocupados também apareçam como cartões (desabilitados, em vermelho)
    for (const t of occupiedDisplaySet) set.add(t)

    // Mantém horários de almoço apenas se já estiverem ocupados (busy), removendo os livres.
    const busySetLocal = new Set(busyTimes.map(t => toHHmm(t)))
    // Para não esconder horários de almoço que estejam BLOQUEADOS, tratamos o conjunto ocupado ampliado
    const occupiedOrBusyForFilter = new Set<string>([...busySetLocal, ...occupiedDisplaySet])
    // Já temos closingStr acima; apenas calculamos minutos para filtragem final
    const closingMinutes = minutesOf(closingStr)

    const union = Array.from(set)
      .filter(t => !(isLunchBreak(t) && !occupiedOrBusyForFilter.has(toHHmm(t))))
      .filter(t => minutesOf(t) < closingMinutes) // não exibir slots após fechamento efetivo (exclui 18:30/19:00/15:30)

    const ordered = union.sort((a, b) => minutesOf(a) - minutesOf(b))
    const filteredMicro = new Set(Array.from(microLimited).filter(t => ordered.includes(t)))
    return { slots: ordered, restrictedMicroSlots: filteredMicro }
  }, [date, busyTimes, busyBookings, services])

  const busySet = useMemo(() => new Set(busyTimes.map((t) => toHHmm(t))), [busyTimes])
  // Pré-calcula intervalos ocupados (considerando duração) para bloquear qualquer slot dentro deles
  const occupiedIntervals = useMemo(() => {
    const dayPrefix = dayjs(date).format('YYYY-MM-DD')
    return busyBookings.map(b => {
      const start = dayjs(`${dayPrefix}T${toHHmm(b.time)}`)
      const dur = Math.max(0, Number(b.durationMinutes ?? 30))
      return { start, end: start.add(dur, 'minute') }
    })
  }, [busyBookings, date])

  const available = (t: string) => {
    if (isLunchBreak(t)) return false
    const hhmm = toHHmm(t)
    if (busySet.has(hhmm)) return false
    // Bloqueia se o início do slot cai dentro de um intervalo ocupado
    const slotStart = dayjs(`${dayjs(date).format('YYYY-MM-DD')}T${hhmm}`)
    for (const iv of occupiedIntervals) {
      if (slotStart.isSame(iv.start) || (slotStart.isAfter(iv.start) && slotStart.isBefore(iv.end))) {
        return false
      }
    }
    // Bloqueia horários passados no dia atual
    const selectedDay = dayjs(date)
    if (selectedDay.isSame(now, 'day')) {
      if (slotStart.isBefore(now)) return false
    }
    return true
  }
  const selectedServices = useMemo(() => services.filter(s => selectedServiceIds.includes(s.id)), [services, selectedServiceIds])
  const totalMinutes = useMemo(() => selectedServices.reduce((acc, s) => acc + (s.minutes || 0), 0), [selectedServices])
  const totalPrice = useMemo(() => selectedServices.reduce((acc, s) => acc + (s.price || 0), 0), [selectedServices])

  // Limite especial: Slot 11:30 de Segunda a Sexta (almoço às 12:00) permite no máximo 30 minutos de serviços.
  const SLOT_1130_LIMIT_MINUTES = 30
  const isWeekday1130 = useMemo(() => {
    if (!selectedTime) return false
    if (toHHmm(selectedTime) !== '11:30') return false
    const dow = dayjs(date).day() // 0=Dom, 1=Seg ... 6=Sab
    return dow >= 1 && dow <= 5
  }, [selectedTime, date])
  const remainingMinutes1130 = useMemo(() => {
    if (!isWeekday1130) return null
    return SLOT_1130_LIMIT_MINUTES - totalMinutes
  }, [isWeekday1130, totalMinutes])

  // Exceção: últimos horários do dia não possuem limite de serviços/tempo.
  // Seg-qui: 18:00 | Sex: 18:30 | Sáb: 15:00
  const isUnlimitedLastSlot = useMemo(() => {
    if (!selectedTime) return false
    const t = toHHmm(selectedTime)
    const dow = dayjs(date).day() // 0=Dom, 1=Seg ... 6=Sab
    if (dow >= 1 && dow <= 4) return t === '18:00'
    if (dow === 5) return t === '18:30'
    if (dow === 6) return t === '15:00'
    return false
  }, [selectedTime, date])

  // Calcula janela disponível (gap) entre o horário selecionado e o próximo agendamento já existente
  const MICRO_SLOT_LIMIT_MINUTES = 5
  const gapMinutes = useMemo(() => {
    if (!selectedTime) return null
    const startMin = minutesOf(selectedTime)
    const selectedHHmm = toHHmm(selectedTime)

    // Próximo horário ocupado após o selecionado
    const nextBusyMin = busyTimes
      .map(t => minutesOf(toHHmm(t)))
      .filter(m => m > startMin)
      .sort((a, b) => a - b)[0]

    // Limites fixos: almoço e fechamento
    const dow = dayjs(date).day()
    // Ajusta fechamento de sábado para 15:30 (último base 15:00)
    const closingStr = dow === 6 ? '15:30' : (dow === 5 ? '19:00' : (dow === 0 ? '00:00' : '18:30'))
    const closingMin = minutesOf(closingStr)
    const lunchStartMin = 12 * 60

    // Se o slot é antes do almoço, 12:00 também é um limite
    const lunchBoundary = startMin < lunchStartMin ? lunchStartMin : undefined

    const candidates = [nextBusyMin, lunchBoundary, closingMin].filter((m): m is number => typeof m === 'number' && m > startMin)
    if (candidates.length === 0) return null
    const boundary = Math.min(...candidates)
    const baseGap = boundary - startMin
    if (restrictedMicroSlots.has(selectedHHmm)) {
      return Math.min(baseGap, MICRO_SLOT_LIMIT_MINUTES)
    }
    return baseGap
  }, [selectedTime, busyTimes, date, restrictedMicroSlots])

  const exceedsGap = useMemo(() => {
    // Nos últimos horários, não há limite por janela.
    if (isUnlimitedLastSlot) return false
    if (gapMinutes == null) return false
    return totalMinutes > gapMinutes
  }, [gapMinutes, totalMinutes, isUnlimitedLastSlot])

  function toggleService(id: string) {
    // Bloqueio proativo: se estamos no slot 11:30 (seg-sex) e adicionar este serviço excede 30min, impedir.
    if (isWeekday1130) {
      const svc = services.find(s => s.id === id)
      if (svc && !selectedServiceIds.includes(id)) {
        const prospective = totalMinutes + (svc.minutes || 0)
        if (prospective > SLOT_1130_LIMIT_MINUTES) {
          // Apenas ignora o click (UI já mostra tag Excede). Poderíamos mostrar mensagem se desejado.
          return
        }
      }
    }
    setSelectedServiceIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    setMessage(null)
  }

  function openConfirm() {
    setMessage(null)
    if (!selectedTime) return setMessage('Selecione um horário.')
    if (!name.trim()) return setMessage('Digite seu nome.')
    if (selectedServices.length === 0) return setMessage('Selecione pelo menos um serviço.')
    if (isWeekday1130 && totalMinutes > SLOT_1130_LIMIT_MINUTES) {
      return setMessage(`No horário de 11:30 (almoço às 12:00) o limite é de ${SLOT_1130_LIMIT_MINUTES} min. Sua seleção tem ${totalMinutes} min.`)
    }
    if (!isUnlimitedLastSlot && exceedsGap && gapMinutes != null) {
      return setMessage(`Os serviços selecionados somam ${totalMinutes} min e excedem o intervalo disponível de ${gapMinutes} min até o próximo agendamento.`)
    }
    setConfirmOpen(true)
  }

  async function book() {
    setMessage(null)
  if (!selectedTime) return setMessage('Selecione um horário.')
  // Horários de almoço só são bloqueados para slots normais; pedidos "Outro Horário" (isCustomTime) ignoram essa restrição.
  if (!isCustomTime && isLunchBreak(selectedTime)) return setMessage('Horário de almoço indisponível (12:00–14:00).')
    if (!name.trim()) return setMessage('Digite seu nome.')
    if (selectedServices.length === 0) return setMessage('Selecione pelo menos um serviço.')
  if (isWeekday1130 && totalMinutes > SLOT_1130_LIMIT_MINUTES) return setMessage(`No horário de 11:30 (almoço às 12:00) o limite é de ${SLOT_1130_LIMIT_MINUTES} min. Sua seleção tem ${totalMinutes} min.`)
    setLoading(true)
    try {
      const d = dayjs(date).format('YYYY-MM-DD')
      const supa = getSupabase()
  const cols = await getBookingColumns(supa)
  const sch = await getBookingSchema(supa)
  const serviceTitles = selectedServices.map(s => s.title)
  // Armazena os nomes dos serviços diretamente (separados por vírgula) para exibição fiel no Admin
  let summary = serviceTitles.join(', ')
  const payload: any = { name: name.trim(), phone: phone.trim() || null, service: summary, price: totalPrice, duration_minutes: totalMinutes, barber_id: selectedBarberId }
      payload[cols.dateCol] = d
      payload[cols.timeCol] = selectedTime
      if (isCustomTime) {
        // Se houver status textual, usar 'agendar'. Caso contrário, prefixa no serviço.
        if (sch && sch.statusKind === 'text' && sch.statusCol) {
          payload[sch.statusCol] = 'agendar'
        } else {
          payload.service = `AGENDAR: ${summary}`
        }
      }
      if (sch && sch.servicesJsonCol) {
        payload[sch.servicesJsonCol] = selectedServices.map(s => ({ id: s.id, title: s.title, price: s.price, minutes: s.minutes }))
      }
  const { error } = await supa.from('bookings').insert([ payload ])
      if (error) {
        const err = error as { code?: string; message: string }
        if (err.code === '23505') throw new Error('Esse horário acabou de ser reservado. Escolha outro.')
        throw new Error(err.message || 'Erro ao agendar. Tente novamente.')
      }
      if (isCustomTime) {
        setToast({ type: 'warning', text: 'Recebemos sua solicitação com horário específico. A barbearia entrará em contato para confirmar a disponibilidade.' })
      } else {
        notify('Segue abaixo as informações do agendamento:', 'success', {
          date: dayjs(date).format('DD/MM/YYYY'),
          time: selectedTime,
          services: selectedServices.map(s => ({ title: s.title, minutes: s.minutes, price: s.price })),
          totalMinutes,
          totalPrice
        })
      }
      setSelectedTime(null)
      setName('')
      setPhone('')
      setSelectedServiceIds([])
      setIsCustomTime(false)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao agendar. Tente novamente.'
      setMessage(msg)
    } finally { setLoading(false) }
  }

  async function attemptCancelBooking() {
    setCancelMessage(null)
    if (!cancelDate || !cancelTime) {
      setCancelMessage('Informe data e horário do agendamento que deseja cancelar.')
      return
    }
    const dateNorm = dayjs(cancelDate).format('YYYY-MM-DD')
    const timeNorm = toHHmm(cancelTime)
    setCancelLoading(true)
    try {
      const supa = getSupabase()
      const sch = await getBookingSchema(supa)
      const cols = await getBookingColumns(supa)
      const selectCols = ['id', 'service']
      if (sch.statusKind === 'text' && sch.statusCol) selectCols.push(sch.statusCol)
      if (sch.servicesJsonCol) selectCols.push(sch.servicesJsonCol)
      const response = await supa.from('bookings').select(selectCols.join(', ')).eq(cols.dateCol, dateNorm).eq(cols.timeCol, timeNorm).eq('barber_id', selectedBarberId).limit(1)
      if (response.error) throw new Error('Erro ao consultar o agendamento. Tente novamente.')
      const booking = (response.data && response.data[0]) ? (response.data[0] as any) : null
      if (!booking) {
        setCancelMessage('Não encontramos agendamento para a data e horário informados.')
        return
      }
      const alreadyRequested = (() => {
        if (sch.statusKind === 'text' && sch.statusCol) {
          const v = String(booking[sch.statusCol] || '').toLowerCase()
          if (v === 'cancelar') return true
        }
        const svc = String(booking.service || '')
        return /^\s*cancelar\s*:/i.test(svc)
      })()
      if (alreadyRequested) {
        setCancelMessage('Esse horário já possui uma solicitação de cancelamento pendente.')
        return
      }
      const serviceFromJson = (() => {
        if (sch.servicesJsonCol && Array.isArray(booking[sch.servicesJsonCol])) {
          return booking[sch.servicesJsonCol]
            .map((s: any) => String(s?.title || '').trim())
            .filter(Boolean)
        }
        return [] as string[]
      })()
      const cleanedOriginal = String(booking.service || '').replace(/^\s*CANCELAR\s*:\s*/i, '').trim()
      const serviceSummary = serviceFromJson.length > 0 ? serviceFromJson.join(', ') : (cleanedOriginal || 'Serviço')
      const update: Record<string, any> = { service: `CANCELAR: ${serviceSummary}` }
      if (sch.statusKind === 'text' && sch.statusCol) {
        update[sch.statusCol] = 'cancelar'
      }
      const { error: updateErr } = await supa.from('bookings').update(update).eq('id', booking.id).eq('barber_id', selectedBarberId)
      if (updateErr) throw new Error('Não foi possível registrar a solicitação. Tente novamente em instantes.')
      setCancelOpen(false)
      setCancelDate('')
      setCancelTime('')
      notify('Solicitação enviada. O barbeiro confirmará o cancelamento e liberará o horário em instantes.', 'warning')
    } catch(e:unknown) {
      setCancelMessage(e instanceof Error ? e.message : 'Erro inesperado ao solicitar cancelamento.')
    } finally { setCancelLoading(false) }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white relative overflow-hidden">
      {splashVisible && (
        <div
          className={clsx(
            'fixed inset-0 z-[60] flex flex-col items-center justify-center bg-neutral-950 transition-opacity duration-700',
            splashFadeOut && 'opacity-0 pointer-events-none'
          )}
        >
          <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.25),transparent_55%)]" />
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_bottom,_rgba(14,165,233,0.25),transparent_60%)]" />
          <div className="relative flex flex-col items-center gap-6 text-center">
            <div className="w-32 h-32 rounded-full bg-gradient-to-br from-emerald-400 via-cyan-400 to-purple-500 p-[3px] animate-[spin_2.8s_linear_infinite] shadow-[0_0_60px_rgba(16,185,129,0.25)]">
              <div className="w-full h-full rounded-full bg-neutral-950 flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 blur-[1px] animate-pulse shadow-[0_0_30px_rgba(6,182,212,0.7)]" />
              </div>
            </div>
            <div className="relative">
              <p className="text-sm uppercase tracking-[0.5em] text-white/70">Carregando</p>
              <p className="mt-2 text-white/60 text-xs tracking-[0.35em]">Dantas Barber Shop</p>
            </div>
          </div>
        </div>
      )}
      {toast && (
        toast.type === 'error' ? (
          // Em caso de erro (ex.: Domingo bloqueado), mostrar um alerta centralizado com destaque vermelho
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="alertdialog" aria-live="assertive" aria-modal="true">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setToast(null)} />
            <div className="relative max-w-md w-full rounded-2xl shadow-2xl border border-red-500/40 bg-gradient-to-b from-red-600/25 to-red-800/20 text-red-50">
              <div className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-red-600 text-black shrink-0 shadow">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M1 21h22L12 2 1 21zm12-3h-2v2h2v-2zm0-8h-2v6h2V10z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-base font-semibold">Domingo bloqueado</p>
                    <p className="text-sm/6 opacity-90 mt-1">{toast.text}</p>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <button onClick={() => setToast(null)} className="px-4 py-2 rounded-md bg-red-600 text-black font-semibold shadow hover:brightness-95">Entendi</button>
                </div>
              </div>
            </div>
          </div>
        ) : toast.type === 'success' ? (
          // Em caso de sucesso (ex.: Agendamento confirmado), mostrar alerta centralizado verde
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="alertdialog" aria-live="polite" aria-modal="true">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setToast(null)} />
            <div className="relative max-w-md w-full rounded-2xl shadow-2xl border border-emerald-500/40 bg-gradient-to-b from-emerald-600/20 to-emerald-800/10 text-emerald-50">
              <div className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-emerald-500 text-black shrink-0 shadow">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M9 16.2l-3.5-3.5L4 14.2 9 19l11-11-1.5-1.5L9 16.2z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-base font-semibold">Agendamento confirmado</p>
                    <p className="text-sm/6 opacity-90 mt-1">{toast.text}</p>
                    {toast.details && (
                      <div className="mt-3 space-y-2 text-sm">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-emerald-100/90">
                          {toast.details.date && <span><strong>Data:</strong> {toast.details.date}</span>}
                          {toast.details.time && <span><strong>Horário:</strong> {toast.details.time}</span>}
                        </div>
                        {toast.details.services && toast.details.services.length > 0 && (
                          <div>
                            <p className="font-medium text-emerald-200 mb-1">Serviços:</p>
                            <ul className="list-disc list-inside space-y-0.5 text-emerald-100/90 max-h-40 overflow-auto pr-1">
                              {toast.details.services.map((s, i) => (
                                <li key={i}>{s.title} • {s.minutes} min • R$ {s.price.toFixed(2)}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {(toast.details.totalMinutes != null || toast.details.totalPrice != null) && (
                          <p className="text-emerald-100/90"><strong>Total:</strong> {toast.details.totalMinutes} min • R$ {toast.details.totalPrice?.toFixed(2)}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2 flex-wrap">
                  {toast.details && (
                    <button
                      onClick={generatePdfReceipt}
                      className="px-4 py-2 rounded-md bg-emerald-900/50 border border-emerald-500/40 text-emerald-200 font-semibold shadow hover:bg-emerald-800/70 hover:text-white transition"
                    >Comprovante PDF</button>
                  )}
                  <button onClick={() => { try { if (toast?.details?.date) { const parts = toast.details.date.split('/'); if (parts.length===3) { const d = `${parts[2]}-${parts[1]}-${parts[0]}`; localStorage.setItem('keepDate', d) } } } catch {}; setToast(null); window.location.reload() }} className="px-4 py-2 rounded-md bg-emerald-500 text-black font-semibold shadow hover:brightness-95">Ok</button>
                </div>
              </div>
            </div>
          </div>
        ) : toast.type === 'warning' ? (
          // Solicitação: alerta centralizado amarelo
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="alertdialog" aria-live="polite" aria-modal="true">
            <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setToast(null)} />
            <div className="relative max-w-md w-full rounded-2xl shadow-2xl border border-yellow-500/40 bg-gradient-to-b from-yellow-600/20 to-yellow-800/10 text-yellow-50">
              <div className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-yellow-400 text-black shrink-0 shadow">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M1 21h22L12 2 1 21zm12-3h-2v2h2v-2zm0-8h-2v6h2V10z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-base font-semibold">Cancelamento solicitado</p>
                    <p className="text-sm/6 opacity-90 mt-1">{toast.text}</p>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <button onClick={() => setToast(null)} className="px-4 py-2 rounded-md bg-yellow-400 text-black font-semibold shadow hover:brightness-95">Ok</button>
                </div>
              </div>
            </div>
          </div>
        ) : toast.type === 'cancelled' ? (
          // Modal central estilizado para cancelamento
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="alertdialog" aria-live="assertive" aria-modal="true">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setToast(null)} />
            <div className="relative w-full max-w-sm rounded-2xl shadow-2xl border border-red-400/40 bg-gradient-to-b from-red-900/50 via-neutral-900 to-neutral-950 text-red-50 overflow-hidden">
              <div className="absolute -top-20 -right-28 w-64 h-64 bg-red-600/20 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-red-400/10 rounded-full blur-3xl pointer-events-none" />
              <div className="relative p-6">
                <div className="flex items-start gap-4">
                  <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-gradient-to-br from-red-500 to-red-400 text-black shadow-lg ring-1 ring-white/10">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 12l2 2 4-4" />
                      <circle cx="12" cy="12" r="10" className="opacity-30" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold tracking-wide">Agendamento cancelado</h2>
                    <p className="mt-1 text-sm/5 text-red-100/90">{toast.text}</p>
                    <p className="mt-3 text-[11px] uppercase tracking-wider text-red-300/70 font-medium">O horário voltou para a lista de disponíveis.</p>
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => { try { localStorage.setItem('keepDate', date) } catch {} setToast(null); window.location.reload() }}
                    className="px-5 py-2 rounded-md font-semibold bg-gradient-to-r from-red-500 to-red-400 text-black shadow hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-400 text-sm"
                  >Ok</button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          // Para outros tipos, manter o toast no topo
          <div className="fixed top-4 inset-x-0 z-50 flex justify-center px-4" role="alert" aria-live="polite">
            <div
              onClick={() => setToast(null)}
              className={clsx(
                'max-w-md w-full rounded-lg shadow-lg border px-4 py-3 cursor-pointer transition',
                (toast.type && toast.type === 'info') && 'bg-blue-500/15 border-blue-500/30 text-blue-200'
              )}
              title="Clique para fechar"
            >
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 mt-0.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M1 21h22L12 2 1 21zm12-3h-2v2h2v-2zm0-8h-2v6h2V10z" />
                </svg>
                <div className="flex-1 text-sm font-medium">{toast.text}</div>
              </div>
            </div>
          </div>
        )
      )}
      {customTimeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-xl">
            <h3 className="text-xl font-semibold mb-2">Outro horário</h3>
            <p className="text-neutral-300 mb-4">Caso não encontre horário disponível, selecione aqui um horário que desejar e a Barbearia entrará em contato para confirmar a disponibilidade do agendamento.</p>
            <label className="block text-sm text-neutral-300 mb-1">Escolher horário</label>
            <input type="time" value={customTime} onChange={(e) => setCustomTime(e.target.value)} className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-white" />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setCustomTimeOpen(false)} className="px-4 py-2 rounded border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-white">Cancelar</button>
              <button onClick={() => { if (!customTime) return; const hhmm = toHHmm(customTime); /* Não bloqueia almoço para Outro Horário */ setSelectedTime(hhmm); setIsCustomTime(true); setCustomTimeOpen(false) }} className="px-4 py-2 rounded bg-yellow-400 hover:bg-yellow-500 text-black font-semibold disabled:opacity-50" disabled={!customTime}>Selecionar</button>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-3xl mx-auto px-4 py-10">
        <header className="mb-8 flex flex-col items-center gap-3">
          <img src="https://i.imgur.com/rwsw9r0.png" alt="Logotipo da Barbearia" width={152} height={152} style={{ height: 'auto', width: 'auto', marginTop: '-45px' }} />
          <p className="text-neutral-400 -mt-22 text-center">Escolha o profissional, selecione a data, confirme um horário disponível e finalize seu agendamento.</p>
          <button onClick={() => { const n = secretClicks + 1; setSecretClicks(n); if (n >= 5) setShowAdminLink(true); }} className="text-[10px] text-neutral-600 hover:text-neutral-400" aria-label="hidden-admin">·</button>
          {showAdminLink && (<a href="/admin" className="text-xs text-emerald-400 hover:underline">Entrar como barbeiro</a>)}
        </header>

        <div className="mb-6">
          <BarberSelectionStep
            barbers={barbers}
            selectedBarberId={selectedBarberId}
            onSelect={(barber) => {
              shouldJumpToDateRef.current = true
              setSelectedBarberId(barber.id)
            }}
          />
        </div>

        <section className="grid gap-6 md:grid-cols-2">
          <div ref={dateFieldRef} className="space-y-4 scroll-mt-6">
            <label className="block text-sm text-neutral-300">Data</label>
            <input
              ref={dateInputRef}
              type="date"
              className="bg-neutral-900 border border-neutral-800 rounded px-3 py-2 w-full"
              value={date}
              onChange={(e) => {
                const next = e.target.value
                // Impede selecionar domingos
                if (dayjs(next).day() === 0) {
                  notify('Domingo não está disponível para agendamentos.', 'error')
                  return
                }
                setDate(next)
              }}
              min={dayjs().format('YYYY-MM-DD')}
            />
            <div className="mt-4">
              <h2 className="font-semibold mb-2">Horários</h2>
              <div className="grid grid-cols-3 gap-2">
                {slots.map((t) => {
                  const isAvailable = available(t)
                  const isSelected = selectedTime === t
                  return (
                    <button
                      key={t}
                      disabled={!isAvailable}
                      onClick={() => { setSelectedTime(toHHmm(t)); setIsCustomTime(false) }}
                      className={clsx('px-3 py-2 rounded text-sm border transition font-medium', isAvailable ? 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800 text-white' : 'bg-red-600 border-red-500 text-white cursor-not-allowed opacity-90', isSelected && isAvailable && 'ring-2 ring-emerald-300')}
                    >{toHHmm(t)}</button>
                  )
                })}
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => { setCustomTime(isCustomTime && selectedTime ? toHHmm(selectedTime) : ''); setCustomTimeOpen(true) }}
                  className="w-full sm:w-auto px-4 py-2 rounded-md border border-neutral-800 bg-neutral-900 text-white hover:bg-neutral-800 transition font-medium"
                  title={isCustomTime && selectedTime ? `Horário solicitado: ${toHHmm(selectedTime)}` : 'Selecionar outro horário'}
                >
                  Outro Horário
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCancelOpen(true)
                    setCancelMessage(null)
                    setCancelDate(dayjs(date).format('YYYY-MM-DD'))
                    setCancelTime(selectedTime ? toHHmm(selectedTime) : '')
                  }}
                  className="mt-2 w-full sm:w-auto px-4 py-2 rounded-md border border-neutral-800 bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white transition font-medium"
                >Cancelar Horário</button>
              </div>
              {isCustomTime && selectedTime && (
                <div className="mt-3 text-xs text-white flex justify-center">
                  <span className="inline-flex items-center gap-2 rounded-full border border-yellow-500/30 bg-yellow-500/15 px-3 py-1 mx-auto">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 8V12l3 3 .9-1.1-2.4-2.4V8z"/></svg>
                    Outro Horário solicitado: <strong className="tracking-wide">{toHHmm(selectedTime)}</strong>
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <label className="block text-sm text-neutral-300">Nome</label>
            <input type="text" className="bg-neutral-900 border border-neutral-800 rounded px-3 py-2 w-full" placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} />
            <label className="block text-sm text-neutral-300">Whatsapp</label>
            <input type="tel" className="bg-neutral-900 border border-neutral-800 rounded px-3 py-2 w-full" placeholder="(xx) xxxxx-xxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <div className="mt-2">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm text-neutral-300">Serviços</label>
                <span className="text-xs text-neutral-400">Escolha um ou mais serviços para continuar</span>
              </div>
              {/* Indicador em tempo real */}
              <div className={clsx('mb-2 flex flex-wrap gap-2 items-center justify-between text-xs', selectedServices.length>0 ? 'text-emerald-300' : 'text-neutral-400')}>
                <span className="min-w-[150px]">
                  {selectedServices.length>0 ? `${selectedServices.length} serviço${selectedServices.length>1?'s':''} selecionado${selectedServices.length>1?'s':''}` : 'Nenhum serviço selecionado'}
                </span>
                <span className="flex items-center gap-2 flex-wrap justify-end">
                  {isWeekday1130 && (
                    <span className={clsx('rounded-full px-2 py-0.5 border', remainingMinutes1130!==null && remainingMinutes1130<=0 ? 'bg-red-600/20 text-red-300 border-red-500/40' : 'bg-amber-500/15 text-amber-300 border-amber-400/30')}>
                      {remainingMinutes1130!==null && remainingMinutes1130<=0 ? 'Limite atingido' : `${remainingMinutes1130} min restantes`}
                    </span>
                  )}
                  {selectedServices.length>0 && (
                    <>
                      <span className="rounded-full bg-emerald-500/15 text-emerald-300 px-2 py-0.5">Total: R$ {totalPrice.toFixed(2)}</span>
                      <span className="rounded-full bg-emerald-500/15 text-emerald-300 px-2 py-0.5">{totalMinutes} min</span>
                    </>
                  )}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {services.map((s) => {
                  const active = selectedServiceIds.includes(s.id)
                  const currentTotal = totalMinutes
                  const prospective = active ? currentTotal - s.minutes : currentTotal + s.minutes
                  const disabledByGap = !isUnlimitedLastSlot && !active && gapMinutes != null && (s.minutes > gapMinutes || prospective > gapMinutes)
                  const disabledBy1130 = !active && isWeekday1130 && (prospective > SLOT_1130_LIMIT_MINUTES)
                  const disabled = disabledByGap || disabledBy1130
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => { if (disabled) return; toggleService(s.id) }}
                      disabled={disabled}
                      title={disabledByGap ? `Indisponível: excede janela de ${gapMinutes} min` : (disabledBy1130 ? `Limite de ${SLOT_1130_LIMIT_MINUTES} min às 11:30` : undefined)}
                      className={clsx(
                        'group text-left rounded-lg overflow-hidden border transition focus:outline-none',
                        active ? 'border-emerald-400 ring-2 ring-emerald-300' : 'border-neutral-800 hover:border-neutral-700',
                        disabled && 'opacity-40 cursor-not-allowed hover:border-neutral-800'
                      )}
                    >
                      <div className="relative aspect-[4/3]">
                        {s.image ? (
                          <img src={s.image} alt={s.title} className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center bg-neutral-800 text-neutral-400">Sem imagem</div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                        <div className="absolute bottom-0 left-0 right-0 p-3 flex items-end justify-between gap-2">
                          <div>
                            <p className="font-semibold leading-tight">{s.title}</p>
                            <p className="text-xs text-neutral-300">{s.minutes} min</p>
                          </div>
                          <span className="text-sm font-semibold bg-black/60 px-2 py-1 rounded">R$ {s.price.toFixed(2)}</span>
                        </div>
                        {active && (
                          <div className="absolute top-2 right-2 rounded-full bg-emerald-500 text-black text-[10px] font-bold px-2 py-1 shadow">Selecionado</div>
                        )}
                        {disabled && !active && (
                          <div className="absolute top-2 left-2 text-[10px] px-2 py-1 rounded-full bg-red-600/80 text-black font-semibold">Excede</div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
              {!isUnlimitedLastSlot && gapMinutes != null && (
                <p className={clsx('mt-2 text-xs', exceedsGap ? 'text-red-400' : 'text-neutral-400')}>Janela disponível até o próximo agendamento: {gapMinutes} min. {exceedsGap ? `Seleção atual: ${totalMinutes} min (reduza para prosseguir).` : `Seleção atual: ${totalMinutes} min.`}</p>
              )}
              {servicesError && (<p className="text-sm text-red-400">{servicesError}</p>)}
              {!servicesError && services.length === 0 && (<p className="text-sm text-neutral-400">Nenhum serviço cadastrado ainda. Cadastre pelo aplicativo para aparecer aqui.</p>)}
            </div>
            <button onClick={openConfirm} disabled={loading || exceedsGap} className="mt-2 w-full bg-emerald-500 hover:bg-emerald-600 text-black font-semibold py-3 rounded disabled:opacity-50">{loading ? 'Agendando...' : 'Confirmar Agendamento'}</button>
            {message && (<p className="text-sm text-neutral-300 mt-2">{message}</p>)}
          </div>
        </section>

        <footer className="mt-10 text-center text-neutral-500 text-sm">Ao confirmar, você autoriza a barbearia a entrar em contato pelo WhatsApp.</footer>
      </div>
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl shadow-black/40">
            <div className="h-1 bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-500" />
            <div className="p-6">
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <h3 className="text-xl font-semibold text-white">Confirmar agendamento</h3>
                  <p className="mt-1 text-sm text-neutral-400">Revise os detalhes antes de finalizar.</p>
                </div>
              </div>

              <div className="grid gap-4">
                {selectedServices.length > 0 && (
                  <section className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs uppercase tracking-[0.28em] text-emerald-300/80">Serviços</span>
                      <span className="rounded-full border border-neutral-700 bg-neutral-950/70 px-2.5 py-1 text-[11px] uppercase tracking-[0.22em] text-neutral-400">
                        {selectedServices.length} selecionado{selectedServices.length > 1 ? 's' : ''}
                      </span>
                    </div>
                    <ul className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1 text-sm text-neutral-200">
                      {selectedServices.map((s) => (
                        <li key={s.id} className="rounded-lg border border-neutral-800 bg-neutral-950/80 px-3 py-2.5 shadow-sm shadow-black/10">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <span className="block truncate font-medium leading-tight text-white">{s.title}</span>
                              <span className="mt-0.5 block text-[11px] uppercase tracking-[0.24em] text-neutral-400">Serviço selecionado</span>
                            </div>
                            <div className="flex shrink-0 flex-col items-end text-right">
                              <span className="text-[11px] uppercase tracking-[0.24em] text-neutral-400">{s.minutes} min</span>
                              <span className="mt-1 text-sm font-semibold text-emerald-300">R$ {s.price.toFixed(2)}</span>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-center text-sm">
                      <div className="rounded-md border border-emerald-400/15 bg-black/10 px-2 py-2">
                        <span className="block text-[11px] uppercase tracking-[0.24em] text-emerald-200/90">Tempo total</span>
                        <span className="mt-1 block text-base font-semibold text-white">{totalMinutes} min</span>
                      </div>
                      <div className="rounded-md border border-emerald-400/15 bg-black/10 px-2 py-2">
                        <span className="block text-[11px] uppercase tracking-[0.24em] text-emerald-200/90">Valor total</span>
                        <span className="mt-1 block text-base font-semibold text-white">R$ {totalPrice.toFixed(2)}</span>
                      </div>
                    </div>
                  </section>
                )}

                <section className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-4">
                  <span className="block text-xs uppercase tracking-[0.28em] text-neutral-400">Barbeiro selecionado</span>
                  <strong className="mt-1 block text-base text-white">{selectedBarber?.displayName || 'Profissional selecionado'}</strong>
                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-neutral-800 bg-neutral-950/80 px-3 py-3 text-sm text-neutral-200">
                    <div>
                      <span className="block text-[11px] uppercase tracking-[0.24em] text-neutral-500">Data</span>
                      <span className="mt-1 block font-medium text-white">{dayjs(date).format('DD/MM/YYYY')}</span>
                    </div>
                    <div className="text-right">
                      <span className="block text-[11px] uppercase tracking-[0.24em] text-neutral-500">Horário</span>
                      <span className="mt-1 block font-medium text-white">{selectedTime}</span>
                    </div>
                    <p className="col-span-2 pt-1 text-center text-xs text-neutral-400">
                      Deseja confirmar este agendamento?
                    </p>
                  </div>
                </section>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button onClick={() => setConfirmOpen(false)} className="px-4 py-2 rounded-lg border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-white transition">Não</button>
                <button onClick={async () => { await book(); setConfirmOpen(false) }} disabled={loading} className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-black font-semibold disabled:opacity-50 transition">Sim</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {cancelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-xl relative">
            <h3 className="text-xl font-semibold mb-3">Cancelar agendamento</h3>
            <p className="text-sm text-neutral-300 mb-4">
              Informe apenas a data e o horário já reservados. Enviaremos uma solicitação para o barbeiro confirmar e liberar o horário.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">Data</label>
                <input type="date" value={cancelDate} onChange={e=>setCancelDate(e.target.value)} className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-white" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">Horário</label>
                <input type="time" value={cancelTime} onChange={e=>setCancelTime(e.target.value)} className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-white" />
              </div>
            </div>
            {cancelMessage && <p className="mt-3 text-sm text-red-400">{cancelMessage}</p>}
            <div className="mt-5 flex justify-end gap-2 flex-wrap">
              <button onClick={()=> setCancelOpen(false)} disabled={cancelLoading} className="px-4 py-2 rounded border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-white text-sm disabled:opacity-50">Fechar</button>
              <button onClick={attemptCancelBooking} disabled={cancelLoading} className="px-4 py-2 rounded bg-red-600 hover:bg-red-500 text-white font-semibold text-sm disabled:opacity-50 flex items-center gap-2">{cancelLoading && <span className="animate-spin inline-block h-3 w-3 border-2 border-black/40 border-t-black rounded-full"/>} Solicitar Cancelamento</button>
            </div>
          </div>
        </div>
      )}
      {showAdminLink && <AIChatModal />}
    </div>
  )
}
