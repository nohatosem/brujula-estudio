// Brújula 4 · fechas locales (AAAA-MM-DD) y horas (HH:MM), formatos en español.

export const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
export const todayISO = (now = new Date()) => iso(now);

const utcDay = (s) => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); };
/** Días enteros de a hasta b (b - a). */
export const diffDays = (a, b) => Math.round((utcDay(b) - utcDay(a)) / 86400000);
export const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
/** Lunes de la semana de la fecha dada. */
export const weekStart = (s) => { const d = parseISO(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
export const weekDays = (s) => { const start = weekStart(s); return Array.from({ length: 7 }, (_, i) => addDays(start, i)); };
/** 0 = lunes … 6 = domingo */
export const weekdayIndex = (s) => (parseISO(s).getDay() + 6) % 7;

export const isValidDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISO(s);
  return !Number.isNaN(d.getTime()) && iso(d) === s;
};
export const isValidTime = (t) => typeof t === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t);

export const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
export const toHHMM = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const nowMin = (now = new Date()) => now.getHours() * 60 + now.getMinutes();
export const blockMinutes = (b) => Math.max(0, toMin(b.end) - toMin(b.start));
/** Instante (ms) del inicio o fin de un bloque en hora local. */
export const blockTime = (b, edge = 'start') => { const d = parseISO(b.date); const m = toMin(edge === 'start' ? b.start : b.end); d.setHours(Math.floor(m / 60), m % 60, 0, 0); return d.getTime(); };

export const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
export const WEEKDAYS_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

/** «sábado 17 de octubre» */
export const fmtLong = (s) => { const d = parseISO(s); return `${WEEKDAYS[weekdayIndex(s)]} ${d.getDate()} de ${MONTHS[d.getMonth()]}`; };
/** «17 oct» */
export const fmtShort = (s) => { const d = parseISO(s); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };
/** «sáb 17» */
export const fmtDayShort = (s) => `${WEEKDAYS_SHORT[weekdayIndex(s)]} ${parseISO(s).getDate()}`;
export const fmtWeekday = (s) => WEEKDAYS[weekdayIndex(s)];
export const fmtRange = (a, b) => `${a}–${b}`;

/** «hoy», «mañana», «ayer», «el martes», «en 9 días», «hace 3 días». */
export function fmtRelDay(s, today) {
  const n = diffDays(today, s);
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n === 2) return 'pasado mañana';
  if (n === -1) return 'ayer';
  if (n > 2 && n < 7) return `el ${fmtWeekday(s)}`;
  if (n >= 7) return `en ${n} días`;
  return `hace ${-n} días`;
}

/** «45 min», «1 h», «1 h 30 min» */
export function fmtDuration(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** «en 40 min», «en 2 h», «hace 10 min» */
export function fmtIn(minutes) {
  const m = Math.round(minutes);
  if (Math.abs(m) < 1) return 'ahora';
  if (m > 0) return m < 60 ? `en ${m} min` : `en ${fmtDuration(m)}`;
  return -m < 60 ? `hace ${-m} min` : `hace ${fmtDuration(-m)}`;
}

/** Hora actual redondeada hacia arriba a múltiplos de `step` minutos. */
export const ceilTo = (m, step) => Math.ceil(m / step) * step;
