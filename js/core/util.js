// Brújula 4 · utilidades puras compartidas (sin DOM salvo donde se indica).

/** Escapa texto para insertarlo de forma segura en HTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Identificador compatible con el formato de Brújula 3.x (fecha + azar). */
export const gid = () => String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8);

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** Normaliza para comparar: sin tildes, minúsculas y sin espacios extremos. */
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  return wrapped;
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => Object.prototype.hasOwnProperty.call(obj || {}, k)).map((k) => [k, obj[k]]));

export const uniq = (arr) => [...new Set(arr)];

export const sum = (arr, f = (x) => x) => arr.reduce((n, x) => n + (Number(f(x)) || 0), 0);

export const byKey = (f) => (a, b) => { const x = f(a), y = f(b); return x < y ? -1 : x > y ? 1 : 0; };

/** Recorta texto respetando la longitud máxima. */
export const cut = (s, n) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, Math.max(0, n - 1)) + '…' : t; };

/** Capitaliza la primera letra (en español). */
export const cap = (s) => { const t = String(s ?? ''); return t ? t[0].toLocaleUpperCase('es') + t.slice(1) : t; };

/** Similaridad simple entre dos textos (0..1) por palabras significativas. */
export function wordOverlap(a, b) {
  const words = (s) => new Set(norm(s).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 2));
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / Math.min(A.size, B.size);
}

/** Vibración breve en dispositivos que la admiten (DOM). */
export function haptic(pattern = 12) {
  try { if (navigator.vibrate && !matchMedia('(prefers-reduced-motion: reduce)').matches) navigator.vibrate(pattern); } catch (_) { /* opcional */ }
}

/** Lectura/escritura segura en localStorage (DOM). */
export const storage = {
  get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch (_) { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch (_) { /* ignorar */ } },
  getJSON(key, fallback = null) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } },
  setJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } },
};
