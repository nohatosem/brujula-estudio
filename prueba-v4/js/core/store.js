// Brújula 4 · estado en memoria, guardado local por cuenta y pila de deshacer.
// Claves de almacenamiento idénticas a 3.9: nada se pierde al actualizar.

import { storage, clone, gid } from './util.js';
import { blankState, loadState, UNDO_LIMIT, makeEvent, pushEvent } from './model.js';

export const KEYS = {
  legacy: 'brujula_estudio_v1',
  guest: 'brujula_guest_v3',
  user: (id) => 'brujula_user_v3_' + id,
  marker: (id) => 'brujula_last_synced_v3_' + id,
  meta: (id) => 'brujula_sync_meta_v4_' + id,
  backupPre4: (id) => 'brujula_backup_pre4_' + id,
  conflictBackup: (id) => 'brujula_conflict_backup_v4_' + id,
  cloudConfig: 'brujula_cloud_public_config_v2',
  legacyMarker: 'brujula_cloud_last_synced_v2',
  device: 'brujula_device_v4',
};

const listeners = new Set();
export const store = {
  state: blankState(),
  userId: null,
  storageOk: true,
  migration: null,
  afterSave: null, // lo conecta la nube para encolar la sincronización
};

export const getState = () => store.state;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function notify(reason) { for (const fn of listeners) { try { fn(reason); } catch (e) { console.error(e); } } }

/** Preferencias de este dispositivo (no se sincronizan): tema, avisos vistos, etc. */
export const device = {
  get() { return storage.getJSON(KEYS.device, {}) || {}; },
  set(patch) { const v = { ...device.get(), ...patch }; storage.setJSON(KEYS.device, v); return v; },
};

/** Lee la copia local de una cuenta y la migra en memoria (sin tocar savedAt). */
export function readLocal(uid) {
  const raw = storage.get(KEYS.user(uid));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const { state, report } = loadState(parsed);
    if (report.from < 4 && !storage.get(KEYS.backupPre4(uid))) storage.set(KEYS.backupPre4(uid), raw); // copia previa a 4.0
    return { state, report };
  } catch (e) {
    console.warn('Copia local ilegible', e);
    return null;
  }
}

export function setAccount(uid, state, migration = null) {
  store.userId = uid;
  store.state = state || blankState();
  store.migration = migration;
  notify('account');
}

export function clearAccount() {
  store.userId = null;
  store.state = blankState();
  store.migration = null;
  notify('account');
}

export function persistLocal() {
  if (!store.userId) return false;
  store.storageOk = storage.set(KEYS.user(store.userId), JSON.stringify(store.state));
  return store.storageOk;
}

/** Guarda (marca savedAt, escribe local y avisa a la nube) y vuelve a pintar. */
export function commit({ render = true, save = true, reason = 'change' } = {}) {
  if (save) {
    store.state.savedAt = Date.now();
    persistLocal();
    try { store.afterSave?.(); } catch (e) { console.error(e); }
  }
  if (render) notify(reason);
}

/** Reemplaza el estado completo (recuperar de la nube, restaurar copia). */
export function replaceState(next, { save = true } = {}) {
  store.state = next;
  if (save) persistLocal();
  notify('replace');
}

// ——— Deshacer ———

const print = (b) => (b ? [b.date, b.start, b.end, b.status, b.title, b.courseId].join('|') : null);

/**
 * Ejecuta `mutate(state)` registrando lo necesario para deshacerlo.
 * blockIds: bloques existentes que pueden cambiar. Los nuevos se detectan solos.
 */
export function change({ label, type = 'change', blockIds = [], topicIds = [], evaluationIds = [], mutate, event = null, render = true }) {
  const s = store.state;
  const before = blockIds.map((id) => s.blocks.find((b) => b.id === id)).filter(Boolean).map((b) => clone(b));
  const topicsBefore = topicIds.map((id) => s.topics.find((t) => t.id === id)).filter(Boolean).map((t) => clone(t));
  const evalsBefore = evaluationIds.map((id) => s.evaluations.find((e) => e.id === id)).filter(Boolean).map((e) => clone(e));
  const existing = new Set(s.blocks.map((b) => b.id));
  const existingTopics = new Set(s.topics.map((t) => t.id));
  const existingEvals = new Set(s.evaluations.map((e) => e.id));
  const result = mutate(s);
  const createdIds = s.blocks.filter((b) => !existing.has(b.id)).map((b) => b.id);
  const createdTopicIds = s.topics.filter((t) => !existingTopics.has(t.id)).map((t) => t.id);
  const createdEvalIds = s.evaluations.filter((e) => !existingEvals.has(e.id)).map((e) => e.id);
  const prints = {};
  for (const id of [...blockIds, ...createdIds]) prints[id] = print(s.blocks.find((b) => b.id === id));
  const entry = { id: gid(), at: new Date().toISOString(), label, type, before, createdIds, topicsBefore, createdTopicIds, evalsBefore, createdEvalIds, prints };
  s.undo = [entry, ...(s.undo || [])].slice(0, UNDO_LIMIT);
  if (event) pushEvent(s, makeEvent(s, event));
  commit({ render });
  return { result, entry };
}

export function canUndo(entry) {
  const s = store.state;
  if (!entry) return { ok: false, reason: 'No hay nada que deshacer.' };
  for (const [id, p] of Object.entries(entry.prints || {})) {
    const cur = s.blocks.find((b) => b.id === id);
    if (print(cur) !== p) return { ok: false, reason: 'Esa actividad cambió después; edítala a mano.' };
  }
  return { ok: true };
}

export function undo(entryId) {
  const s = store.state;
  const entry = (s.undo || []).find((e) => e.id === entryId) || (s.undo || [])[0];
  const check = canUndo(entry);
  if (!check.ok) return check;
  s.blocks = s.blocks.filter((b) => !entry.createdIds.includes(b.id));
  for (const b of entry.before) {
    const i = s.blocks.findIndex((x) => x.id === b.id);
    if (i >= 0) s.blocks[i] = clone(b); else s.blocks.push(clone(b));
  }
  s.topics = s.topics.filter((t) => !(entry.createdTopicIds || []).includes(t.id));
  for (const t of entry.topicsBefore || []) { const i = s.topics.findIndex((x) => x.id === t.id); if (i >= 0) s.topics[i] = clone(t); else s.topics.push(clone(t)); }
  s.evaluations = s.evaluations.filter((e) => !(entry.createdEvalIds || []).includes(e.id));
  for (const e of entry.evalsBefore || []) { const i = s.evaluations.findIndex((x) => x.id === e.id); if (i >= 0) s.evaluations[i] = clone(e); else s.evaluations.push(clone(e)); }
  s.undo = s.undo.filter((e) => e.id !== entry.id);
  pushEvent(s, makeEvent(s, { status: 'progress', type: 'undo', title: entry.label, course: 'Brújula', reason: 'Se deshizo el cambio' }));
  // Compatibilidad 3.9: su botón «Deshacer» usa estos campos.
  s.latestMove = null; s.latestAutomation = null;
  commit();
  return { ok: true, entry };
}
