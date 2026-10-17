// Brújula 4 · rutas con hash (#/hoy, #/semana/2026-10-17, #/curso/ID, #/sesion/ID…).

const listeners = new Set();
export const ROUTES = ['hoy', 'semana', 'estudio', 'curso', 'tema', 'sesion', 'progreso', 'habitos', 'ajustes', 'nuevo', 'asistente'];

export function parse(hash = location.hash) {
  const clean = String(hash || '').replace(/^#\/?/, '');
  const [name, ...rest] = clean.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
  return { name: ROUTES.includes(name) ? name : 'hoy', params: rest, raw: clean };
}

export const route = { current: parse() };
export function go(path, { replace = false } = {}) {
  const h = '#/' + String(path).replace(/^#?\/?/, '');
  if (location.hash === h) { route.current = parse(h); emit(); return; }
  if (replace) { history.replaceState(null, '', h); route.current = parse(h); emit(); }
  else location.hash = h;
}
export const onRoute = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function emit() { for (const fn of listeners) fn(route.current); }
window.addEventListener('hashchange', () => { route.current = parse(); emit(); });
