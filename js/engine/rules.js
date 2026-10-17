// Brújula 4 · reglas de rutina: sueño, comida, descansos y límite diario de estudio.
// Todo lo crítico se valida aquí de forma determinista (nunca depende de la IA).

import { isValidTime, toMin } from '../core/dates.js';
import { DEFAULT_PREFS } from '../core/model.js';
import { clamp } from '../core/util.js';

const DAY_END = 24 * 60 - 1; // los bloques no cruzan la medianoche

/** Minutos de dormir; si es de madrugada (00:00–04:00) cuenta como fin del día. */
export function sleepMinutes(value, wake) {
  if (!isValidTime(value)) return null;
  const m = toMin(value);
  if (m <= wake && m <= 4 * 60) return DAY_END; // p. ej., duerme a las 00:30 → el día termina 23:59
  return m;
}

export function rulesFrom(preferences = {}) {
  const p = { ...DEFAULT_PREFS, ...(preferences || {}) };
  const issues = [];
  let wake = isValidTime(p.wake) ? toMin(p.wake) : (issues.push('wake'), toMin(DEFAULT_PREFS.wake));
  let sleep = sleepMinutes(p.sleep, wake);
  if (sleep == null) { issues.push('sleep'); sleep = toMin(DEFAULT_PREFS.sleep); }
  if (wake >= sleep) { issues.push('order'); wake = toMin(DEFAULT_PREFS.wake); sleep = toMin(DEFAULT_PREFS.sleep); }
  let ls = isValidTime(p.lunchStart) ? toMin(p.lunchStart) : toMin(DEFAULT_PREFS.lunchStart);
  let le = isValidTime(p.lunchEnd) ? toMin(p.lunchEnd) : toMin(DEFAULT_PREFS.lunchEnd);
  if (ls >= le) { issues.push('lunch'); ls = toMin(DEFAULT_PREFS.lunchStart); le = toMin(DEFAULT_PREFS.lunchEnd); }
  return {
    wake, sleep, lunch: [ls, le],
    gap: clamp(Number(p.breakMins) || 0, 0, 90),
    maxStudy: clamp(Number(p.maxStudyMin) || DEFAULT_PREFS.maxStudyMin, 30, 960),
    sessionMin: clamp(Number(p.sessionMin) || 45, 15, 240),
    reviewMin: clamp(Number(p.reviewMin) || 25, 10, 120),
    issues,
  };
}

/** Texto breve de la rutina para mostrar o enviar a la IA. */
export function describeRules(r) {
  const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return { wake: hh(r.wake), sleep: r.sleep >= DAY_END ? '00:00' : hh(r.sleep), lunchStart: hh(r.lunch[0]), lunchEnd: hh(r.lunch[1]), breakMins: r.gap, maxStudyMin: r.maxStudy };
}
