// Brújula 4 · avisos breves (con «Deshacer») y hojas modales accesibles.

import { esc } from '../core/util.js';
import { icon } from './icons.js';
import { announce } from './dom.js';

// ——— Avisos ———
export function toast(message, { tone = 'info', action = null, duration = 4200 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `${icon(tone === 'ok' ? 'circle-check' : tone === 'warn' ? 'triangle-alert' : 'info')}<span class="grow">${esc(message)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { close(); action.run(); });
    el.appendChild(b);
  }
  while (host.children.length >= 3) host.firstElementChild.remove();
  host.appendChild(el);
  announce(message);
  let timer = setTimeout(close, action ? Math.max(duration, 6500) : duration);
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => { timer = setTimeout(close, 2500); });
  function close() { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 220); }
  return close;
}

// ——— Hojas ———
const stack = [];

/**
 * Abre una hoja (diálogo modal). En móvil sube desde abajo; en escritorio es centrada.
 * body/foot son HTML ya escapado. onMount recibe el elemento de la tarjeta.
 */
export function openSheet({ title, subtitle = '', body = '', foot = '', wide = false, onMount = null, onClose = null, label = '' }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet';
  dlg.setAttribute('aria-label', label || title || 'Detalle');
  dlg.innerHTML = `<div class="sheet-card ${wide ? 'wide' : ''}" role="document">
    <div class="sheet-grip" aria-hidden="true"></div>
    <div class="sheet-head"><div class="grow"><h2>${esc(title)}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>
      <button type="button" class="icon-btn" data-sheet-close aria-label="Cerrar">${icon('x')}</button></div>
    <div class="sheet-body">${body}</div>
    ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}
  </div>`;
  document.body.appendChild(dlg);
  const card = dlg.querySelector('.sheet-card');
  let closed = false;
  const api = {
    el: card, dialog: dlg,
    close(result) {
      if (closed) return; closed = true;
      try { dlg.close(); } catch (_) { /* ya cerrado */ }
      dlg.remove();
      const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
      onClose?.(result);
    },
    setBody(html) { card.querySelector('.sheet-body').innerHTML = html; },
  };
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) api.close();
    if (e.target.closest('[data-sheet-close]')) api.close();
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); api.close(); });
  stack.push(api);
  dlg.showModal();
  // Arrastrar hacia abajo para cerrar (móvil)
  const grip = card.querySelector('.sheet-grip');
  let startY = null;
  grip?.addEventListener('pointerdown', (e) => { startY = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip?.addEventListener('pointermove', (e) => { if (startY != null) { const dy = Math.max(0, e.clientY - startY); card.style.transform = `translateY(${dy}px)`; } });
  grip?.addEventListener('pointerup', (e) => { if (startY == null) return; const dy = e.clientY - startY; startY = null; card.style.transform = ''; if (dy > 90) api.close(); });
  onMount?.(card, api);
  const first = card.querySelector('[autofocus]');
  if (first) setTimeout(() => first.focus(), 60);
  return api;
}

export const closeAllSheets = () => { while (stack.length) stack[stack.length - 1].close(); };
export const topSheet = () => stack[stack.length - 1] || null;

export function confirmSheet({ title, text = '', confirm = 'Aceptar', cancel = 'Cancelar', danger = false, details = '' }) {
  return new Promise((resolve) => {
    let answered = false;
    const s = openSheet({
      title,
      body: `${text ? `<p class="muted">${esc(text)}</p>` : ''}${details}`,
      foot: `<button type="button" class="btn" data-sheet-close>${esc(cancel)}</button><button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirm)}</button>`,
      onMount(card) { card.querySelector('[data-ok]').addEventListener('click', () => { answered = true; s.close(); resolve(true); }); setTimeout(() => card.querySelector('[data-ok]').focus(), 60); },
      onClose() { if (!answered) resolve(false); },
    });
  });
}

export function promptSheet({ title, label = '', value = '', placeholder = '', multiline = false, confirm = 'Guardar', optional = true, hint = '' }) {
  return new Promise((resolve) => {
    let answered = false;
    const field = multiline
      ? `<textarea class="textarea" id="promptValue" placeholder="${esc(placeholder)}" maxlength="600">${esc(value)}</textarea>`
      : `<input class="input" id="promptValue" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="300">`;
    const s = openSheet({
      title,
      body: `<label class="field"><span>${esc(label)}</span>${field}</label>${hint ? `<p class="hint">${esc(hint)}</p>` : ''}`,
      foot: `<button type="button" class="btn" data-sheet-close>Cancelar</button><button type="button" class="btn btn-primary" data-ok>${esc(confirm)}</button>`,
      onMount(card) {
        const input = card.querySelector('#promptValue');
        const ok = () => { const v = input.value.trim(); if (!v && !optional) { input.focus(); return; } answered = true; s.close(); resolve(v); };
        card.querySelector('[data-ok]').addEventListener('click', ok);
        if (!multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
        setTimeout(() => input.focus(), 60);
      },
      onClose() { if (!answered) resolve(null); },
    });
  });
}
