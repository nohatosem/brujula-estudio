// Brújula 4 · avisos antes de cada actividad.
//  - Locales: mientras Brújula está abierta o recién minimizada. Se muestran a través del
//    service worker (en Android `new Notification()` no está permitido).
//  - Con la app cerrada: push.js (opcional; necesita desplegar el servidor de avisos).
// Ambos usan el mismo formato y la misma etiqueta (tag), así nunca se duplican en pantalla.

import { store, subscribe, commit } from '../core/store.js';
import { prefs, isUsableBlock, courseOf } from '../core/model.js';
import { blockTime } from '../core/dates.js';
import { cut } from '../core/util.js';

const timers = new Map();
const shown = new Set();
let pushCovers = () => false;

export const notificationsSupported = () => 'Notification' in window;
export const permission = () => (notificationsSupported() ? Notification.permission : 'unsupported');

/** Minutos de anticipación (0 = a la hora). */
export function leadMinutes(s) {
  const v = Number(prefs(s).reminderLead);
  return Number.isFinite(v) ? Math.max(0, Math.min(60, Math.round(v))) : 10;
}

/** Hash corto y estable (FNV-1a) para etiquetas sin datos legibles. */
export function shortHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export const reminderTag = (b, lead) => 'b-' + shortHash(`${b.id}|${b.date}|${b.start}|${lead}`);

/**
 * Avisos de las actividades que empiezan después de `now` y cuyo aviso cae antes de `until`.
 * `late`: incluye avisos cuya hora ya pasó si la actividad aún no empezó (al abrir la app).
 */
export function reminderItems(s, { now = Date.now(), until = now + 12 * 3600000, max = 60, late = false } = {}) {
  const lead = leadMinutes(s);
  const out = [];
  for (const b of s.blocks) {
    if (!isUsableBlock(b) || ['mastered', 'missed'].includes(b.status)) continue;
    const start = blockTime(b);
    const at = start - lead * 60000;
    if (start <= now || at > until || (!late && at < now - 60000)) continue;
    const left = Math.max(0, Math.round((start - Math.max(now, at)) / 60000));
    const course = b.courseId && b.courseId !== 'general' ? courseOf(s, b.courseId).name : '';
    const when = left ? `empieza en ${left} min.` : 'empieza ahora.';
    out.push({
      tag: reminderTag(b, lead), at: Math.max(at, now), expire: start + 5 * 60000, blockId: b.id,
      title: cut(`${b.start} · ${b.title}`, 110),
      body: cut(course ? `${course} · ${when}` : when[0].toUpperCase() + when.slice(1), 220),
      url: `./index.html#/${b.kind === 'study' ? 'sesion/' + encodeURIComponent(b.id) : 'hoy'}`,
    });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, max);
}

/** push.js indica qué avisos ya cubre el servidor (para no mostrar dos veces el mismo). */
export function setPushCoverage(fn) { pushCovers = typeof fn === 'function' ? fn : () => false; }

async function show(title, options) {
  if ('serviceWorker' in navigator) {
    try {
      // Espera a que el service worker esté activo (recién abierta la app puede tardar).
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 4000))]);
      if (reg?.showNotification) { await reg.showNotification(title, options); return true; }
    } catch (_) { /* sin service worker */ }
  }
  try { new Notification(title, options); return true; } catch (_) { return false; }
}

function clearAll() { for (const t of timers.values()) clearTimeout(t); timers.clear(); }

export function reschedule() {
  clearAll();
  const s = store.state;
  if (!store.userId || !prefs(s).reminders || permission() !== 'granted') return;
  const now = Date.now();
  for (const it of reminderItems(s, { now, until: now + 12 * 3600000, late: true })) {
    if (shown.has(it.tag) || pushCovers(it.tag)) continue;
    timers.set(it.tag, setTimeout(() => {
      timers.delete(it.tag);
      if (pushCovers(it.tag)) return;
      shown.add(it.tag);
      void show(it.title, { body: it.body, tag: it.tag, icon: './icons/icon-192.png', badge: './icons/badge-96.png', data: { url: it.url } });
    }, Math.max(0, it.at - now)));
  }
}

export async function enableReminders(on = true) {
  if (!notificationsSupported()) return { ok: false, message: 'Este navegador no admite notificaciones.' };
  if (on) {
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, message: 'No se dio permiso. Actívalo en la configuración del sitio del navegador.' };
  }
  store.state.preferences = { ...prefs(store.state), reminders: !!on };
  commit();
  if (on) await show('Avisos activados', { body: 'Te avisaré antes de cada actividad mientras Brújula esté abierta.', tag: 'brujula-test', icon: './icons/icon-192.png', badge: './icons/badge-96.png' });
  return { ok: true };
}

export function initReminders() {
  subscribe((reason) => { if (reason === 'account') shown.clear(); setTimeout(reschedule, 0); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reschedule(); });
  setInterval(reschedule, 15 * 60000);
}
