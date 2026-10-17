// Brújula 4 · avisos con la app cerrada (Web Push) — OPCIONAL y EXPERIMENTAL.
// Funciona solo después de desplegar la función «brujula-push», sus secretos y el envío
// programado (docs/AVISOS_PUSH.md). Sin servidor, Ajustes lo explica y Brújula sigue con
// los avisos locales.
// Privacidad: este dispositivo calcula los avisos de los próximos 7 días (máx. 60: hora,
// título y curso) y solo eso se guarda en tu Supabase. Nunca notas, diario ni el horario.

import { store, subscribe, commit, notify } from '../core/store.js';
import { prefs } from '../core/model.js';
import { storage, debounce } from '../core/util.js';
import { cloud, getClient, signOutHooks } from '../cloud/cloud.js';
import { reminderItems, setPushCoverage, reschedule, shortHash } from './reminders.js';

export const push = {
  checked: false, checking: false, enabled: false, publicKey: null, lastRunAt: null, error: '',
  subscribed: false, endpoint: null, devices: null, lastSyncAt: null,
};
let syncedTags = new Set();

const ua = () => navigator.userAgent || '';
const isIOS = () => /iPad|iPhone|iPod/.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const needsInstallFirst = () => isIOS() && !standalone();
/** El envío programado (cron) corrió hace poco: los avisos del servidor van a llegar. */
export const pushHealthy = () => !!push.lastRunAt && Date.now() - Date.parse(push.lastRunAt) < 5 * 60000;

const syncKey = () => 'brujula_push_sync_v4_' + (store.userId || '');
const endpointKey = () => 'brujula_push_endpoint_v4_' + (store.userId || '');

function deviceLabel() {
  const u = ua();
  const os = /Android/i.test(u) ? 'Android' : isIOS() ? 'iPhone/iPad' : /Windows/i.test(u) ? 'Windows' : /Mac OS X/i.test(u) ? 'Mac' : /Linux/i.test(u) ? 'Linux' : 'Otro';
  const br = /Edg\//.test(u) ? 'Edge' : /SamsungBrowser/.test(u) ? 'Samsung Internet' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Navegador';
  return `${os} · ${br}`;
}
const fromB64u = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function invoke(body) {
  if (!cloud.user) throw Error('Inicia sesión para usar los avisos.');
  if (!navigator.onLine) throw Error('Sin conexión.');
  const client = await getClient();
  const account = cloud.user.id;
  const { data, error } = await client.functions.invoke('brujula-push', { body });
  if (error) {
    let detail = '';
    try { detail = (await error.context?.json?.())?.error || ''; } catch (_) { /* sin cuerpo */ }
    const status = error.context?.status;
    if (status === 404) throw Error('El servidor de avisos no está desplegado todavía.');
    throw Error(detail || 'No se pudo contactar con el servidor de avisos.');
  }
  if (!cloud.user || cloud.user.id !== account) throw Error('La sesión cambió.');
  return data || {};
}

async function currentSubscription() {
  try { const reg = await navigator.serviceWorker.getRegistration(); return (await reg?.pushManager?.getSubscription()) || null; } catch (_) { return null; }
}
const sameKey = (sub, key) => { try { const k = sub?.options?.applicationServerKey; return !k || !key || toB64u(k) === key; } catch (_) { return true; } };

/** Consulta al servidor si los avisos están configurados (y vuelve a registrar el dispositivo si el navegador renovó su suscripción). */
export async function checkPush({ force = false } = {}) {
  if (!pushSupported() || !cloud.user) return push;
  const sub = await currentSubscription();
  push.subscribed = !!sub;
  push.endpoint = sub?.endpoint || null;
  if (push.checking || (push.checked && !force)) return push;
  push.checking = true;
  try {
    const c = await invoke({ action: 'config' });
    push.enabled = !!c.enabled;
    push.publicKey = c.publicKey || null;
    push.lastRunAt = c.lastRunAt || null;
    push.error = '';
    if (sub && push.enabled && prefs(store.state).pushEnabled) {
      if (!sameKey(sub, push.publicKey)) { push.subscribed = false; push.error = 'Las claves del servidor cambiaron: vuelve a activar los avisos aquí.'; }
      else if (storage.get(endpointKey()) !== sub.endpoint) {
        await invoke({ action: 'subscribe', subscription: sub.toJSON(), device: deviceLabel() });
        storage.set(endpointKey(), sub.endpoint);
      }
    }
  } catch (e) { push.enabled = false; push.error = e.message || String(e); }
  push.checked = true;
  push.checking = false;
  notify('push');
  return push;
}

export async function enablePush() {
  if (!pushSupported()) return { ok: false, message: 'Este navegador no admite avisos con la app cerrada.' };
  if (needsInstallFirst()) return { ok: false, message: 'En iPhone, primero instala Brújula: Compartir → «Agregar a pantalla de inicio», y ábrela desde ese ícono.' };
  if (!cloud.user || !navigator.onLine) return { ok: false, message: 'Necesitas conexión y haber iniciado sesión.' };
  await checkPush({ force: true });
  if (!push.enabled) return { ok: false, message: push.error || 'El servidor de avisos aún no está configurado (guía: docs/AVISOS_PUSH.md).' };
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, message: 'Sin permiso de notificaciones. Actívalo en la configuración del sitio del navegador.' };
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, push.publicKey)) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(push.publicKey) });
    const r = await invoke({ action: 'subscribe', subscription: sub.toJSON(), device: deviceLabel(), test: true });
    storage.set(endpointKey(), sub.endpoint);
    Object.assign(push, { subscribed: true, endpoint: sub.endpoint, devices: r.devices ?? null, error: '' });
    if (!prefs(store.state).pushEnabled) { store.state.preferences = { ...prefs(store.state), pushEnabled: true }; commit(); }
    await syncPushQueue({ force: true });
    notify('push');
    return { ok: true, test: r.test || null };
  } catch (e) {
    return { ok: false, message: 'No se pudo activar: ' + (e.message || e) };
  }
}

/** Quita este dispositivo. Si era el último, desactiva los avisos push de la cuenta. */
export async function disablePush() {
  const sub = await currentSubscription();
  let devices = null;
  if (sub) {
    try { devices = (await invoke({ action: 'unsubscribe', endpoint: sub.endpoint })).devices ?? null; } catch (_) { /* sin red: el servidor la borra al fallar el envío */ }
    try { await sub.unsubscribe(); } catch (_) { /* ya no existía */ }
  }
  Object.assign(push, { subscribed: false, endpoint: null });
  syncedTags = new Set();
  storage.remove(syncKey());
  storage.remove(endpointKey());
  if (devices === 0 && prefs(store.state).pushEnabled) { store.state.preferences = { ...prefs(store.state), pushEnabled: false }; commit(); }
  reschedule();
  notify('push');
  return { ok: true, devices };
}

export const sendTestPush = () => invoke({ action: 'test' });

/** Envía al servidor la lista de próximos avisos (solo si cambió y con la copia al día). */
export async function syncPushQueue({ force = false } = {}) {
  const s = store.state;
  if (!prefs(s).pushEnabled || !cloud.user || !navigator.onLine || cloud.status !== 'synced' || cloud.conflict) return null;
  if (!push.checked) await checkPush();
  if (!push.enabled) return null;
  const now = Date.now();
  const items = reminderItems(s, { now, until: now + 7 * 86400000, max: 60 }).map((it) => ({
    tag: it.tag, fire_at: new Date(it.at).toISOString(), expire_at: new Date(it.expire).toISOString(), title: it.title, body: it.body, url: it.url,
  }));
  const hash = shortHash(JSON.stringify(items));
  const saved = storage.getJSON(syncKey(), null);
  if (!force && saved?.hash === hash && saved.stateAt === (cloud.remoteAt || null)) { syncedTags = new Set(items.map((i) => i.tag)); return saved; }
  const r = await invoke({ action: 'sync', items, state_at: cloud.remoteAt || null });
  if (r.ok && !r.stale) {
    syncedTags = r.devices ? new Set(items.map((i) => i.tag)) : new Set();
    push.lastSyncAt = new Date().toISOString();
    storage.setJSON(syncKey(), { hash, stateAt: cloud.remoteAt || null, at: push.lastSyncAt, count: items.length });
    reschedule();
  }
  return r;
}

export function initPush() {
  if (window.BRUJULA_DEMO === true) return;
  // Avisos locales: no repetir los que el servidor ya va a enviar a ESTE dispositivo.
  setPushCoverage((tag) => push.subscribed && push.enabled && pushHealthy() && syncedTags.has(tag));
  const later = debounce(() => { syncPushQueue().catch(() => { /* se reintenta en el próximo cambio */ }); }, 4000);
  let lastCheck = 0;
  subscribe((reason) => {
    if (reason === 'account') {
      Object.assign(push, { checked: false, enabled: false, subscribed: false, endpoint: null, error: '', lastRunAt: null });
      syncedTags = new Set();
      if (store.userId && prefs(store.state).pushEnabled) setTimeout(() => checkPush().then(later, () => {}), 1200);
      return;
    }
    if (['push', 'route', 'ui', 'pwa'].includes(reason) || !prefs(store.state).pushEnabled) return;
    later();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !store.userId || !prefs(store.state).pushEnabled) return;
    if (Date.now() - lastCheck > 10 * 60000) { lastCheck = Date.now(); checkPush({ force: true }).then(later, () => {}); } else later();
  });
  setInterval(() => { if (prefs(store.state).pushEnabled) later(); }, 30 * 60000);
  // En equipos compartidos: al cerrar sesión, este navegador deja de recibir avisos de la cuenta.
  signOutHooks.push(async () => { if ((await currentSubscription()) && store.userId) await disablePushLocalOnly(); });
}

async function disablePushLocalOnly() {
  const sub = await currentSubscription();
  if (!sub) return;
  try { await invoke({ action: 'unsubscribe', endpoint: sub.endpoint }); } catch (_) { /* sin red */ }
  try { await sub.unsubscribe(); } catch (_) { /* ya no existía */ }
  storage.remove(endpointKey());
  Object.assign(push, { subscribed: false, endpoint: null });
}
