import dayjs from 'dayjs';

export type Slot = {
  time: string; // HH:mm
  available: boolean;
};

function isVictorSchedule(barberRef?: string | null): boolean {
  const ref = String(barberRef ?? '').trim().toLowerCase();
  if (!ref) return false;
  const env = import.meta.env as Record<string, string | undefined>;
  const victorId = String(env.VITE_VICTOR_BARBER_ID ?? '').trim().toLowerCase();
  return ref === victorId || ref.includes('victor');
}

function getBusinessIntervals(dateISO: string, barberRef?: string | null): Array<{ start: string; end: string; includeEnd?: boolean }> {
  const d = dayjs(dateISO);
  const dow = d.day(); // 0=Dom, 1=Seg ... 6=Sáb
  if (dow === 0) return [];

  if (isVictorSchedule(barberRef)) {
    if (dow >= 1 && dow <= 4) {
      return [{ start: '14:00', end: '18:30', includeEnd: false }];
    }
    if (dow === 5) {
      return [{ start: '14:00', end: '19:00', includeEnd: false }];
    }
    return [{ start: '08:00', end: '15:00', includeEnd: true }];
  }

  if (dow >= 1 && dow <= 4) {
    return [
      { start: '08:00', end: '12:00', includeEnd: false },
      { start: '14:00', end: '18:30', includeEnd: false },
    ];
  }

  if (dow === 5) {
    return [
      { start: '08:00', end: '12:00', includeEnd: false },
      { start: '14:00', end: '19:00', includeEnd: false },
    ];
  }

  return [{ start: '08:00', end: '15:00', includeEnd: true }];
}

export function generateDaySlots(dateISO: string, open = '09:00', close = '19:00', stepMinutes = 30): string[] {
  const date = dayjs(dateISO);
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  let t = date.hour(oh).minute(om).second(0).millisecond(0);
  const end = date.hour(ch).minute(cm).second(0).millisecond(0);
  const slots: string[] = [];
  while (t.isBefore(end)) {
    slots.push(t.format('HH:mm'));
    t = t.add(stepMinutes, 'minute');
  }
  return slots;
}

function generateRangeSlots(dateISO: string, start: string, end: string, stepMinutes: number, includeEnd = false): string[] {
  const date = dayjs(dateISO);
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let t = date.hour(sh).minute(sm).second(0).millisecond(0);
  const endT = date.hour(eh).minute(em).second(0).millisecond(0);
  const slots: string[] = [];
  while (t.isBefore(endT) || (includeEnd && t.isSame(endT))) {
    slots.push(t.format('HH:mm'));
    t = t.add(stepMinutes, 'minute');
  }
  return slots;
}

// Regras de funcionamento (BASE GRID):
// - Segunda a Quinta: manhã 08:00–12:00 (exclusivo 12:00), tarde 14:00–18:30 (fechamento 18:30) mas
//   o ÚLTIMO HORÁRIO BASE disponível deve ser 18:00. Isso permite criar micro-horários (ex: 18:15)
//   somente se o serviço iniciado às 18:00 terminar antes das 18:30.
// - Sexta-feira: manhã 08:00–12:00 (exclusivo 12:00), tarde 14:00–19:00 (fechamento 19:00) mas
//   o ÚLTIMO HORÁRIO BASE é 18:30. Micro-horários (ex: 18:45) podem surgir se o serviço das 18:30
//   terminar antes das 19:00.
// - Sábado: 08:00–15:00 (exclusivo 15:00).
// - Domingo: sem horários.
// Intervalo base padrão: 30 minutos.
// Micro-horários são gerados dinamicamente a partir do término de serviços mais curtos que o passo base.
export function generateBusinessSlots(dateISO: string, stepMinutes = 30, barberRef?: string | null): string[] {
  const intervals = getBusinessIntervals(dateISO, barberRef);
  return intervals.flatMap((iv) => generateRangeSlots(dateISO, iv.start, iv.end, stepMinutes, !!iv.includeEnd));
}

export function bookingDocId(dateISO: string, timeHHmm: string) {
  // Normalize to YYYY-MM-DD for id stability
  const d = dayjs(dateISO).format('YYYY-MM-DD');
  return `${d}_${timeHHmm}`;
}

export type BookingForSlots = { time: string; durationMinutes?: number | null };

function parseHHmmOn(dateISO: string, hhmm: string) {
  // handles HH:mm or HH:mm:ss or HHmm
  let h = 0, m = 0;
  if (/^\d{2}:\d{2}/.test(hhmm)) {
    const [hh, mm] = hhmm.split(':');
    h = Number(hh);
    m = Number(mm);
  } else if (/^\d{4}$/.test(hhmm)) {
    h = Number(hhmm.slice(0, 2));
    m = Number(hhmm.slice(2));
  } else if (/^\d{1,2}$/.test(hhmm)) {
    h = Number(hhmm);
    m = 0;
  }
  return dayjs(dateISO).hour(h).minute(m).second(0).millisecond(0);
}

export function generateAdaptiveBusinessSlots(dateISO: string, bookings: BookingForSlots[], stepMinutes = 30, barberRef?: string | null): string[] {
  // Objetivo: Manter a grade base (a cada 30 min) estável e apenas excluir
  // os horários que caem dentro de agendamentos. Micro-horários NÃO são
  // gerados aqui — isso fica a cargo da camada de UI que pode aplicar regras
  // adicionais (como almoço, duração mínima do serviço etc.).

  const d = dayjs(dateISO);
  const dow = d.day(); // 0=Dom
  if (dow === 0) return [];

  const intervals = getBusinessIntervals(dateISO, barberRef);

  // Gera a grade base completa do dia
  const baseGrid: string[] = intervals.flatMap((iv) =>
    generateRangeSlots(dateISO, iv.start, iv.end, stepMinutes, !!iv.includeEnd)
  );

  // Normaliza e ordena agendamentos
  const bList = bookings
    .map((b) => {
      const start = parseHHmmOn(dateISO, b.time);
      const duration = Math.max(0, Number(b.durationMinutes ?? stepMinutes));
      const end = start.add(duration, 'minute');
      return { start, end };
    })
    .sort((a, b) => a.start.valueOf() - b.start.valueOf());

  // Remove da grade base os horários que começam dentro de um agendamento
  const result: string[] = [];
  for (const hhmm of baseGrid) {
    const t = parseHHmmOn(dateISO, hhmm);
    let inside = false;
    for (const b of bList) {
      if ((t.isAfter(b.start) || t.isSame(b.start)) && t.isBefore(b.end)) { inside = true; break; }
    }
    if (!inside) result.push(hhmm);
  }

  // Ordena e deduplica por segurança
  return Array.from(new Set(result)).sort();
}
