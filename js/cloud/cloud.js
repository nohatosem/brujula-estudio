// Brújula 4 · cuenta y nube (Supabase). Solo se usa la clave pública (publishable/anon).
// Sincronización segura: escritura condicional por updated_at, sin sobrescribir en silencio
// lo que otro dispositivo guardó, y carga automática cuando este dispositivo está vacío.

import { storage, clone, debounce } from '../core/util.js';
import { store, KEYS, readLocal, setAccount, clearAccount, replaceState, notify } from '../core/store.js';
import { blankState, isBlankState, loadState, summarize } from '../core/model.js';

const TABLE = 'brujula_user_state';
export const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
export const PUBLIC_CONFIG = { url: 'https://qqnawpbcaxooytizhsfq.supabase.co', key: 'sb_publishable_Dljli0E4IFkgbbRBqba7yg_5WcLHEm6' };

export const cloud = {
  config: null, client: null, user: null,
  status: 'loading', // loading | signed-out | synced | saving | pending | offline | error | conflict
  message: '', loading: true, busy: false, dirty: false, enabled: false,
  remoteAt: null, lastSyncAt: null, conflict: null, recovery: false, fromCache: false,
};

const emit = () => notify('cloud');
const setStatus = (status, message = '') => { cloud.status = status; cloud.message = message; emit(); };

/** Solo claves públicas: sb_publishable_… o JWT con rol anon. Nunca secret/service_role. */
export function isPublicSupabaseKey(value) {
  const key = String(value || '').trim();
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  if (key.startsWith('sb_secret_')) return false;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const seg = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(seg.padEnd(Math.ceil(seg.length / 4) * 4, '='))).role === 'anon';
  } catch (_) { return false; }
}

function loadConfig() {
  const saved = storage.getJSON(KEYS.cloudConfig);
  if (saved && /^https:\/\/[a-zA-Z0-9.-]+\.supabase\.co$/.test(saved.url) && isPublicSupabaseKey(saved.key)) return saved;
  if (saved) storage.remove(KEYS.cloudConfig);
  return PUBLIC_CONFIG;
}

function authStorageKey(url) { try { return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`; } catch (_) { return ''; } }

/** Sesión guardada por supabase-js (para abrir sin conexión la copia local de esa cuenta). */
function peekStoredUser() {
  const raw = storage.getJSON(authStorageKey(cloud.config.url));
  const user = raw?.user || raw?.currentSession?.user;
  return user?.id ? { id: user.id, email: user.email || '' } : null;
}

const isNetworkError = (e) => !navigator.onLine || /fetch|network|Failed to fetch|NetworkError|timeout|Load failed/i.test(String(e?.message || e?.name || e || '')) || e?.name === 'AuthRetryableFetchError' || e?.status === 0;

let loadingScript = null;
function loadSupabaseScript() {
  if (window.supabase?.createClient) return Promise.resolve();
  if (loadingScript) return loadingScript;
  loadingScript = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = SUPABASE_JS;
    sc.crossOrigin = 'anonymous';
    sc.async = true;
    const timer = setTimeout(() => reject(Error('La conexión tardó demasiado. Revisa tu internet.')), 20000);
    sc.onload = () => { clearTimeout(timer); resolve(); };
    sc.onerror = () => { clearTimeout(timer); loadingScript = null; sc.remove(); reject(Error('No se pudo cargar la conexión segura. Revisa tu internet.')); };
    document.head.appendChild(sc);
  });
  return loadingScript;
}

export async function getClient() {
  if (cloud.client) return cloud.client;
  await loadSupabaseScript();
  if (!window.supabase?.createClient) throw Error('No se pudo iniciar la conexión con tu cuenta.');
  cloud.client = window.supabase.createClient(cloud.config.url, cloud.config.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  cloud.client.auth.onAuthStateChange((event, session) => setTimeout(() => onAuthEvent(event, session), 0));
  return cloud.client;
}

function onAuthEvent(event, session) {
  if (event === 'PASSWORD_RECOVERY') { cloud.recovery = true; emit(); return; }
  if (event === 'SIGNED_OUT' && cloud.user) { closeAccount('Sesión cerrada.'); return; }
  if (event === 'SIGNED_IN' && session?.user && cloud.user && session.user.id !== cloud.user.id) { closeAccount(); void boot(); }
}

// ——— Arranque ———

export async function boot() {
  cloud.config = cloud.config || loadConfig();
  cloud.loading = true;
  emit();
  const peek = peekStoredUser();
  if (peek && !store.userId) { openAccount(peek, true); }
  try {
    const client = await getClient();
    const { data, error } = await client.auth.getSession();
    const session = data?.session;
    if (!session) {
      if (error && isNetworkError(error) && peek) { cloud.fromCache = true; setStatus('offline', 'Sin conexión. Trabajas con la copia de este dispositivo.'); return; }
      if (store.userId) clearAccount();
      cloud.user = null;
      setStatus('signed-out');
      return;
    }
    let user = session.user;
    try {
      const res = await client.auth.getUser();
      if (res.error) {
        if (!isNetworkError(res.error)) { await client.auth.signOut({ scope: 'local' }).catch(() => {}); closeAccount('Tu sesión caducó. Vuelve a entrar.'); return; }
      } else if (res.data?.user) user = res.data.user;
    } catch (_) { /* sin red: seguimos con la sesión local */ }
    openAccount(user, false);
    await syncOnOpen();
  } catch (e) {
    if (store.userId) { cloud.fromCache = true; setStatus('offline', 'Sin conexión. Trabajas con la copia de este dispositivo.'); }
    else setStatus('signed-out', e.message || 'No se pudo conectar.');
  } finally {
    cloud.loading = false;
    emit();
  }
}

function openAccount(user, fromCache) {
  cloud.user = { id: user.id, email: user.email || '' };
  cloud.fromCache = fromCache;
  if (store.userId === user.id) { emit(); return; }
  const local = readLocal(user.id);
  setAccount(user.id, local?.state || blankState(), local?.report || null);
  cloud.hasLocalCopy = !!local;
  cloud.remoteAt = storage.get(KEYS.marker(user.id)) || null;
  cloud.enabled = false;
  cloud.conflict = null;
}

function closeAccount(message = '') {
  queueSave.cancel?.();
  cloud.user = null; cloud.enabled = false; cloud.remoteAt = null; cloud.conflict = null; cloud.dirty = false; cloud.fromCache = false;
  clearAccount();
  setStatus('signed-out', message);
}

async function readRemote() {
  const { data, error } = await cloud.client.from(TABLE).select('payload,updated_at').eq('user_id', cloud.user.id).maybeSingle();
  if (error) throw Error(error.message);
  return data || null;
}

function setSynced(remoteAt, savedAt) {
  const uid = cloud.user.id;
  cloud.remoteAt = remoteAt;
  storage.set(KEYS.marker(uid), remoteAt);
  storage.setJSON(KEYS.meta(uid), { remoteAt, savedAt });
  cloud.enabled = true;
  cloud.conflict = null;
  cloud.lastSyncAt = Date.now();
  cloud.fromCache = false;
  retry.n = 0;
  setStatus('synced');
}

const localPending = () => {
  const meta = storage.getJSON(KEYS.meta(cloud.user.id));
  return !meta || meta.savedAt !== store.state.savedAt;
};

function applyRemote(remote, { backupLocal = true } = {}) {
  const uid = cloud.user.id;
  const { state, report } = loadState(remote.payload);
  if (report && report.from < 4) {
    // Primera vez que este plan (de 3.x) se abre con la 4.0: copia previa y aviso de bienvenida.
    store.migration = report;
    if (!storage.get(KEYS.backupPre4(uid))) storage.set(KEYS.backupPre4(uid), JSON.stringify(remote.payload));
  }
  const local = store.state;
  if (backupLocal && !isBlankState(local) && Number(local.savedAt) !== Number(state.savedAt)) {
    storage.setJSON(KEYS.conflictBackup(uid), { at: new Date().toISOString(), kind: 'device', payload: local });
  }
  replaceState(state);
  setSynced(remote.updated_at, state.savedAt);
}

function enterConflict(remote) {
  cloud.enabled = false;
  cloud.conflict = { remote, remoteSummary: summarize(remote.payload), localSummary: summarize(store.state) };
  setStatus('conflict', 'Hay cambios distintos en otro dispositivo.');
}

async function syncOnOpen() {
  const uid = cloud.user.id;
  let remote;
  try { remote = await readRemote(); } catch (e) { cloud.fromCache = true; setStatus('offline', 'Sin conexión con la nube. Tus cambios se guardan aquí.'); return; }
  const marker = storage.get(KEYS.marker(uid)) || '';
  const meta = storage.getJSON(KEYS.meta(uid));
  const local = store.state;
  const hasLocal = cloud.hasLocalCopy && !isBlankState(local);

  if (!remote) {
    cloud.remoteAt = null;
    cloud.enabled = true;
    if (hasLocal) await pushNow({ create: true });
    else setStatus('synced', 'Cuenta nueva: tus cambios se guardarán en la nube.');
    return;
  }
  if (!hasLocal) {
    // Copia muy antigua sin cuenta (3.0–3.2) que ya estaba sincronizada con esta nube.
    const legacyMarker = storage.get(KEYS.legacyMarker) || '';
    const legacyRaw = storage.get(KEYS.legacy);
    if (legacyRaw && legacyMarker && legacyMarker === remote.updated_at) {
      try { const { state, report } = loadState(JSON.parse(legacyRaw)); if (report.from < 4) store.migration = report; replaceState(state); setSynced(remote.updated_at, state.savedAt); return; } catch (_) { /* usar la nube */ }
    }
    applyRemote(remote, { backupLocal: false });
    return;
  }
  if (marker && marker === remote.updated_at) {
    cloud.remoteAt = remote.updated_at;
    cloud.enabled = true;
    const sameAsRemote = Number(remote.payload?.savedAt) === Number(local.savedAt);
    if (!sameAsRemote && (meta ? meta.savedAt !== local.savedAt : true)) await pushNow();
    else setSynced(remote.updated_at, local.savedAt);
    return;
  }
  if (meta && meta.savedAt === local.savedAt) { applyRemote(remote); return; }
  if (Number(remote.payload?.savedAt) === Number(local.savedAt)) { setSynced(remote.updated_at, local.savedAt); return; }
  enterConflict(remote);
}

// ——— Guardado ———

const retry = { n: 0, timer: null };
function scheduleRetry() {
  clearTimeout(retry.timer);
  const wait = [4000, 15000, 45000, 120000][Math.min(retry.n, 3)];
  retry.n++;
  retry.timer = setTimeout(() => { if (cloud.dirty) void pushNow(); }, wait);
}

async function insertRow(snapshot, updated_at) {
  const { data, error } = await cloud.client.from(TABLE).insert({ user_id: cloud.user.id, payload: snapshot, updated_at }).select('updated_at').single();
  if (!error) return { row: data };
  if (error.code === '23505' || /duplicate|unique/i.test(error.message)) {
    const remote = await readRemote();
    if (remote) return { remote };
  }
  throw Error(error.message);
}

export async function pushNow({ force = false, create = false } = {}) {
  if (!cloud.user || !cloud.client) return;
  if (cloud.conflict && !force) return;
  if (cloud.busy) { cloud.dirty = true; return; }
  cloud.busy = true;
  cloud.dirty = false;
  setStatus('saving');
  const uid = cloud.user.id;
  const snapshot = clone(store.state);
  const savedAt = snapshot.savedAt;
  const updated_at = new Date().toISOString();
  let conflictWith = null;
  try {
    let row = null;
    if (force) {
      const { data, error } = await cloud.client.from(TABLE).upsert({ user_id: uid, payload: snapshot, updated_at }, { onConflict: 'user_id' }).select('updated_at').single();
      if (error) throw Error(error.message);
      row = data;
    } else if (cloud.remoteAt && !create) {
      // Escritura condicional: solo si nadie cambió la nube desde nuestra última sincronización.
      const { data, error } = await cloud.client.from(TABLE).update({ payload: snapshot, updated_at }).eq('user_id', uid).eq('updated_at', cloud.remoteAt).select('updated_at');
      if (error) throw Error(error.message);
      row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        const remote = await readRemote();
        if (!remote) { const r = await insertRow(snapshot, updated_at); row = r.row; conflictWith = r.remote || null; }
        else if (Number(remote.payload?.savedAt) === Number(savedAt)) row = remote;
        else conflictWith = remote;
      }
    } else {
      const r = await insertRow(snapshot, updated_at);
      row = r.row; conflictWith = r.remote || null;
    }
    if (conflictWith) {
      if (Number(conflictWith.payload?.savedAt) === Number(savedAt)) setSynced(conflictWith.updated_at, savedAt);
      else enterConflict(conflictWith);
    } else {
      setSynced(row.updated_at, savedAt);
      if (store.state.savedAt !== savedAt) cloud.dirty = true;
    }
  } catch (e) {
    cloud.dirty = true;
    setStatus(navigator.onLine ? 'error' : 'offline', navigator.onLine ? 'No se pudo guardar en la nube: ' + (e.message || 'error') : 'Sin conexión. Se guardará al volver.');
    scheduleRetry();
  } finally {
    cloud.busy = false;
    if (cloud.dirty && cloud.enabled && !cloud.conflict && cloud.status === 'synced') queueSave();
    emit();
  }
}

export const queueSave = debounce(() => { void pushNow(); }, 1500);

store.afterSave = () => {
  if (!cloud.user) return;
  if (cloud.enabled && !cloud.conflict) { cloud.dirty = true; if (cloud.status === 'synced') { cloud.status = 'pending'; emit(); } queueSave(); }
};

/** Detecta cambios hechos en otro dispositivo. */
export async function checkRemote() {
  if (!cloud.user || !cloud.client || !cloud.enabled || cloud.busy || cloud.conflict || !navigator.onLine) return;
  try {
    const { data, error } = await cloud.client.from(TABLE).select('updated_at').eq('user_id', cloud.user.id).maybeSingle();
    if (error || !data || data.updated_at === cloud.remoteAt) return;
    const remote = await readRemote();
    if (!remote) return;
    if (!localPending()) { applyRemote(remote); notify('remote-applied'); }
    else enterConflict(remote);
  } catch (_) { /* reintento en la próxima comprobación */ }
}

export async function resolveConflict(choice) {
  const c = cloud.conflict;
  if (!c) return;
  const uid = cloud.user.id;
  if (choice === 'cloud') { applyRemote(c.remote); notify('remote-applied'); return; }
  if (choice === 'device') {
    storage.setJSON(KEYS.conflictBackup(uid) + '_remote', { at: new Date().toISOString(), kind: 'cloud', payload: c.remote.payload });
    cloud.conflict = null;
    await pushNow({ force: true });
  }
}

/** Recupera de la nube aunque no haya conflicto (con copia previa de este dispositivo). */
export async function pullNow() {
  if (!cloud.user) return { ok: false, message: 'Inicia sesión primero.' };
  await getClient();
  const remote = await readRemote();
  if (!remote) return { ok: false, message: 'Todavía no hay una copia en la nube.' };
  applyRemote(remote);
  return { ok: true };
}

export async function flush() {
  if (cloud.dirty && cloud.enabled && !cloud.conflict && !cloud.busy) { queueSave.cancel(); await pushNow(); }
}

// ——— Cuenta ———

export async function signIn(email, password) {
  const client = await getClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw Error(translateAuthError(error));
  await boot();
}

export async function signUp(email, password) {
  const client = await getClient();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw Error(translateAuthError(error));
  if (!data.session) return { needsConfirmation: true };
  await boot();
  return { needsConfirmation: false };
}

export async function sendPasswordReset(email) {
  const client = await getClient();
  const redirectTo = location.origin + location.pathname.replace(/[^/]*$/, '') + 'index.html';
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw Error(translateAuthError(error));
}

export async function updatePassword(password) {
  const client = await getClient();
  const { error } = await client.auth.updateUser({ password });
  if (error) throw Error(translateAuthError(error));
  cloud.recovery = false;
  emit();
}

/** Tareas a ejecutar con la sesión aún abierta (p. ej., dar de baja los avisos push). */
export const signOutHooks = [];

export async function signOut({ wipeLocal = false } = {}) {
  try { await flush(); } catch (_) { /* seguimos */ }
  for (const hook of signOutHooks) {
    try { await Promise.race([hook(), new Promise((r) => setTimeout(r, 4000))]); } catch (_) { /* no bloquea el cierre */ }
  }
  const uid = cloud.user?.id;
  try { await cloud.client?.auth.signOut(); } catch (_) { /* sin red: la sesión local se borra igual */ }
  if (wipeLocal && uid) { storage.remove(KEYS.user(uid)); storage.remove(KEYS.meta(uid)); storage.remove(KEYS.marker(uid)); }
  closeAccount('Sesión cerrada.');
}

export function translateAuthError(e) {
  const m = String(e?.message || e || '');
  if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed/i.test(m)) return 'Confirma tu correo antes de entrar (revisa tu bandeja y spam).';
  if (/already registered|already exists/i.test(m)) return 'Ese correo ya tiene cuenta. Usa «Entrar».';
  if (/password should be at least|weak password/i.test(m)) return 'La contraseña es demasiado corta o débil (mínimo 6 caracteres).';
  if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera unos minutos.';
  if (/fetch|network/i.test(m)) return 'Sin conexión. Revisa tu internet.';
  return m || 'No se pudo completar la operación.';
}

// ——— Configuración avanzada ———

export async function configure(url, key) {
  const u = String(url || '').trim().replace(/\/$/, '');
  const k = String(key || '').trim();
  if (!/^https:\/\/[a-zA-Z0-9.-]+\.supabase\.co$/.test(u)) throw Error('Usa la URL https://…supabase.co de tu proyecto.');
  if (!isPublicSupabaseKey(k)) throw Error('Usa solo la clave pública (sb_publishable_… o anon). Nunca la secret ni service_role.');
  storage.setJSON(KEYS.cloudConfig, { url: u, key: k });
  await signOut();
  cloud.client = null;
  cloud.config = { url: u, key: k };
  await boot();
}

export async function resetConfig() {
  await signOut();
  storage.remove(KEYS.cloudConfig);
  cloud.client = null;
  cloud.config = PUBLIC_CONFIG;
  await boot();
}

export const usingCustomConfig = () => !!storage.getJSON(KEYS.cloudConfig);

/** Prueba de solo lectura: ¿RLS deja ver filas de otras cuentas? */
export async function privacyCheck() {
  if (!cloud.user) throw Error('Inicia sesión primero.');
  const client = await getClient();
  const { data, error } = await client.from(TABLE).select('user_id').neq('user_id', cloud.user.id).limit(3);
  if (error) return { ok: true, message: 'La base de datos rechazó la consulta a otras cuentas (correcto).' };
  if (data && data.length) return { ok: false, message: `ALERTA: se ven ${data.length} fila(s) de otras cuentas. Deja de compartir la app y revisa RLS.` };
  return { ok: true, message: 'No se ven filas de otras cuentas. Para confirmarlo del todo, ejecuta VERIFICAR_AISLAMIENTO.sql y prueba con dos cuentas.' };
}

export function conflictBackups() {
  if (!cloud.user) return [];
  const uid = cloud.user.id;
  return [
    ['device', storage.getJSON(KEYS.conflictBackup(uid))],
    ['cloud', storage.getJSON(KEYS.conflictBackup(uid) + '_remote')],
    ['pre4', (() => { const raw = storage.get(KEYS.backupPre4(uid)); try { return raw ? { at: null, kind: 'pre4', payload: JSON.parse(raw) } : null; } catch (_) { return null; } })()],
  ].filter(([, v]) => v && v.payload);
}

// Pestañas abiertas a la vez: la última escritura local se refleja en las demás.
window.addEventListener('storage', (e) => {
  if (!cloud.user || !e.key) return;
  const uid = cloud.user.id;
  if (e.key === KEYS.user(uid) && e.newValue && !cloud.dirty) {
    try { const { state } = loadState(JSON.parse(e.newValue)); store.state = state; notify('other-tab'); } catch (_) { /* ignorar */ }
  }
  if (e.key === KEYS.marker(uid) && e.newValue) cloud.remoteAt = e.newValue;
});
window.addEventListener('online', () => {
  if (!cloud.user) return;
  if (!cloud.client) { void boot(); return; }
  if (!cloud.enabled && !cloud.conflict) { void syncOnOpen().catch(() => {}); return; }
  if (cloud.dirty) void pushNow(); else void checkRemote();
});
window.addEventListener('offline', () => { if (cloud.user) setStatus('offline', 'Sin conexión. Tus cambios se guardan aquí.'); });
document.addEventListener('visibilitychange', () => {
  if (!cloud.user) return;
  if (document.visibilityState === 'hidden') void flush();
  else void checkRemote();
});
setInterval(() => { if (document.visibilityState === 'visible') void checkRemote(); }, 120000);
