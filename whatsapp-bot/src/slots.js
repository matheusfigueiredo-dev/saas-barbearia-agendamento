import dayjs from 'dayjs'

function generateRangeSlots(dateISO, start, end, stepMinutes, includeEnd = false) {
  const date = dayjs(dateISO)
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let t = date.hour(sh).minute(sm).second(0).millisecond(0)
  const endT = date.hour(eh).minute(em).second(0).millisecond(0)
  const slots = []
  while (t.isBefore(endT) || (includeEnd && t.isSame(endT))) {
    slots.push(t.format('HH:mm'))
    t = t.add(stepMinutes, 'minute')
  }
  return slots
}

function parseHHmmOn(dateISO, hhmm) {
  let h = 0, m = 0
  if (/^\d{2}:\d{2}/.test(hhmm)) {
    const [hh, mm] = hhmm.split(':')
    h = Number(hh); m = Number(mm)
  } else if (/^\d{4}$/.test(hhmm)) {
    h = Number(hhmm.slice(0,2)); m = Number(hhmm.slice(2))
  } else if (/^\d{1,2}$/.test(hhmm)) {
    h = Number(hhmm); m = 0
  }
  return dayjs(dateISO).hour(h).minute(m).second(0).millisecond(0)
}

export function generateAdaptiveBusinessSlots(dateISO, bookings, stepMinutes = 30) {
  const d = dayjs(dateISO)
  const dow = d.day()
  if (dow === 0) return []

  const intervals = []
  if (dow >= 1 && dow <= 4) {
    intervals.push({ start: '08:00', end: '12:00', includeEnd: false })
    intervals.push({ start: '14:00', end: '18:30', includeEnd: false })
  } else if (dow === 5) {
    intervals.push({ start: '08:00', end: '12:00', includeEnd: false })
    intervals.push({ start: '14:00', end: '19:00', includeEnd: false })
  } else { // Sábado
    intervals.push({ start: '08:00', end: '15:00', includeEnd: true })
  }
  const baseGrid = intervals.flatMap(iv => generateRangeSlots(dateISO, iv.start, iv.end, stepMinutes, !!iv.includeEnd))

  const bList = bookings
    .map(b => { const start = parseHHmmOn(dateISO, b.time); const duration = Math.max(0, Number(b.durationMinutes ?? stepMinutes)); const end = start.add(duration, 'minute'); return { start, end } })
    .sort((a,b)=> a.start.valueOf()-b.start.valueOf())

  const result = []
  for (const hhmm of baseGrid) {
    const t = parseHHmmOn(dateISO, hhmm)
    let inside = false
    for (const b of bList) { if ((t.isAfter(b.start) || t.isSame(b.start)) && t.isBefore(b.end)) { inside = true; break } }
    if (!inside) result.push(hhmm)
  }
  return Array.from(new Set(result)).sort()
}
