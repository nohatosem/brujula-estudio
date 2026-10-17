// Brújula 4 · utilidades de interfaz: selección, delegación de acciones y formularios.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const actions = new Map();
/** Registra un manejador para elementos con data-act="nombre". */
export function action(name, fn) { actions.set(name, fn); }
export function runAction(name, el, ev) {
  const fn = actions.get(name);
  if (!fn) { console.warn('Acción sin manejador:', name); return; }
  try {
    const r = fn(el, ev);
    if (r && typeof r.catch === 'function') r.catch((e) => { console.error(e); window.dispatchEvent(new CustomEvent('brujula-error', { detail: e })); });
  } catch (e) { console.error(e); window.dispatchEvent(new CustomEvent('brujula-error', { detail: e })); }
}

/** Delegación global: click, change e input sobre [data-act] / [data-input] / [data-change]. */
export function delegate(root = document) {
  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled || el.closest('[inert]')) return;
    const isLink = el.tagName === 'A' && el.getAttribute('href') && !el.dataset.prevent;
    if (!isLink) ev.preventDefault();
    runAction(el.dataset.act, el, ev);
  });
  root.addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-change]');
    if (el) runAction(el.dataset.change, el, ev);
  });
  root.addEventListener('input', (ev) => {
    const el = ev.target.closest('[data-input]');
    if (el) runAction(el.dataset.input, el, ev);
  });
  root.addEventListener('submit', (ev) => {
    const form = ev.target.closest('form[data-submit]');
    if (!form) return;
    ev.preventDefault();
    runAction(form.dataset.submit, form, ev);
  });
}

export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') {
      if (form.querySelectorAll(`[name="${CSS.escape(el.name)}"]`).length > 1) { (out[el.name] ||= []); if (el.checked) out[el.name].push(el.value); }
      else out[el.name] = el.checked;
    } else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; else if (!(el.name in out)) out[el.name] = out[el.name] ?? null; }
    else out[el.name] = el.value;
  }
  return out;
}

/** Conserva el foco y la selección del elemento activo al volver a pintar. */
export function keepFocus(fn) {
  const a = document.activeElement;
  const key = a && (a.id || a.dataset?.focusKey);
  const sel = a && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
  fn();
  if (!key) return;
  const next = document.getElementById(key) || document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
  if (next && next !== document.activeElement) {
    next.focus({ preventScroll: true });
    if (sel && typeof next.setSelectionRange === 'function') { try { next.setSelectionRange(sel[0], sel[1]); } catch (_) { /* no aplica */ } }
  }
}

export function announce(text) {
  const live = document.getElementById('live');
  if (live) { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); }
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    ta.remove();
    return ok;
  }
}

export function download(filename, text, mime = 'application/json;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
