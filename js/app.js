// Brújula 4.0 · arranque, estructura de la app y bucle de pintado.
// Sin dependencias de compilación: módulos ES servidos tal cual por GitHub Pages.

import { injectSprite, icon } from './ui/icons.js';
import { delegate, action, keepFocus, $ } from './ui/dom.js';
import { route, onRoute, go } from './ui/router.js';
import { store, subscribe, device } from './core/store.js';
import { APP_VERSION, prefs } from './core/model.js';
import { todayISO } from './core/dates.js';
import { esc } from './core/util.js';
import { cloud, boot, checkRemote, pushNow, flush } from './cloud/cloud.js';
import { toast, closeAllSheets, topSheet } from './ui/feedback.js';
import { openQuickAdd } from './ui/forms.js';
import { openBlockDetail, openSyncSheet, maybeShowConflict, maybeShowWelcome } from './ui/details.js';
import { applyTheme } from './features/theme.js';
import { initPWA, pwa } from './features/pwa.js';
import { initReminders } from './features/reminders.js';
import { initPush } from './features/push.js';
import { openAssistant, initAssistant } from './assistant/panel.js';
import { needsDecision } from './engine/priority.js';
import { dueTopics } from './engine/srs.js';
import * as todayView from './views/today.js';
import * as weekView from './views/week.js';
import * as studyView from './views/study.js';
import * as courseView from './views/course.js';
import * as sessionView from './views/session.js';
import * as progressView from './views/progress.js';
import * as habitsView from './views/habits.js';
import * as settingsView from './views/settings.js';
import * as authView from './views/auth.js';

const VIEWS = { hoy: todayView, semana: weekView, estudio: studyView, curso: courseView, tema: studyView, sesion: sessionView, progreso: progressView, habitos: habitsView, ajustes: settingsView };
const NAV = [
  { key: 'hoy', label: 'Hoy', icon: 'compass' },
  { key: 'semana', label: 'Semana', icon: 'calendar-days' },
  { key: 'estudio', label: 'Estudio', icon: 'book-open' },
  { key: 'progreso', label: 'Progreso', icon: 'chart-column' },
  { key: 'habitos', label: 'Vida', icon: 'sprout' },
  { key: 'ajustes', label: 'Ajustes', icon: 'settings' },
];
const BRAND = `<svg class="mark" viewBox="0 0 512 512" aria-hidden="true"><circle cx="256" cy="256" r="150" fill="none" stroke="currentColor" stroke-width="30"/><g transform="rotate(32 256 256)"><path d="M256 138 L300 256 L212 256 Z" fill="var(--route)"/><path d="M256 374 L300 256 L212 256 Z" fill="currentColor" fill-opacity=".5"/></g><circle cx="256" cy="256" r="14" fill="var(--paper)"/></svg>`;
export const brandMark = () => BRAND;

const ctx = () => ({ state: store.state, cloud, route: route.current, now: new Date(), today: todayISO() });
const navKey = (name) => (name === 'curso' || name === 'tema' ? 'estudio' : name === 'sesion' ? 'hoy' : name);

function syncPill() {
  const st = cloud.status;
  const label = { synced: 'Guardado', saving: 'Guardando…', pending: 'Guardando…', offline: 'Sin conexión', error: 'Sin sincronizar', conflict: 'Revisar copia', loading: 'Conectando…' }[st] || '';
  return `<span class="sync-pill ${esc(st)}"><span class="d" aria-hidden="true"></span>${esc(label)}</span>`;
}
function syncIcon() {
  const st = cloud.status;
  const name = st === 'offline' || st === 'error' ? 'cloud-off' : st === 'synced' ? 'cloud-check' : 'cloud';
  return `<button type="button" class="icon-btn" data-act="sync-status" aria-label="Estado de la nube: ${esc(st)}">${icon(name)}${st === 'conflict' || st === 'error' ? '<span class="dot"></span>' : ''}</button>`;
}

function badgeCounts() {
  const s = store.state, now = new Date();
  return { decisions: s.blocks.filter((b) => needsDecision(b, now)).length, reviews: dueTopics(s, todayISO()).length };
}

function shellHTML() {
  return `<aside class="rail" aria-label="Navegación principal">
      <a class="brand" href="#/hoy" aria-label="Brújula, inicio">${BRAND}<b>Brújula</b></a>
      <button type="button" class="btn btn-primary btn-block" data-act="quick-add">${icon('plus')}Añadir actividad</button>
      <nav class="rail-nav" id="railNav"></nav>
      <div class="rail-foot">
        <button type="button" class="btn btn-soft btn-block" data-act="assistant">${icon('sparkles')}Asistente</button>
        <button type="button" class="rail-account" data-act="sync-status" id="railAccount"></button>
      </div>
    </aside>
    <header class="topbar" id="topbar">
      <div class="topbar-title"><h1 id="pageTitle"></h1><p id="pageSub"></p></div>
      <div class="topbar-actions"><span id="syncSlot"></span><button type="button" class="icon-btn" data-act="assistant" aria-label="Abrir asistente">${icon('sparkles')}</button></div>
    </header>
    <main class="main" id="main" tabindex="-1"></main>
    <nav class="tabbar" aria-label="Navegación">
      <a class="tab" href="#/hoy" data-nav="hoy">${icon('compass')}<span>Hoy</span></a>
      <a class="tab" href="#/semana" data-nav="semana">${icon('calendar-days')}<span>Semana</span></a>
      <button type="button" class="tab-add" data-act="quick-add" aria-label="Añadir actividad">${icon('plus')}</button>
      <a class="tab" href="#/estudio" data-nav="estudio">${icon('book-open')}<span>Estudio</span></a>
      <button type="button" class="tab" data-act="more" data-nav="more">${icon('ellipsis')}<span>Más</span></button>
    </nav>`;
}

function renderChrome(view, r) {
  const key = navKey(r.name);
  const counts = badgeCounts();
  const rail = $('#railNav');
  if (rail) rail.innerHTML = NAV.map((n) => `<a class="rail-link" href="#/${n.key}" ${n.key === key ? 'aria-current="page"' : ''}>${icon(n.icon)}<span>${n.label}</span>${n.key === 'hoy' && counts.decisions ? `<span class="count">${counts.decisions}</span>` : n.key === 'estudio' && counts.reviews ? `<span class="count">${counts.reviews}</span>` : ''}</a>`).join('');
  document.querySelectorAll('.tabbar [data-nav]').forEach((t) => { const on = t.dataset.nav === key || (t.dataset.nav === 'more' && ['progreso', 'habitos', 'ajustes'].includes(key)); if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  const c = ctx();
  const title = typeof view.title === 'function' ? view.title(c) : view.title || 'Brújula';
  const sub = typeof view.subtitle === 'function' ? view.subtitle(c) : '';
  const pt = $('#pageTitle'); if (pt) pt.textContent = title;
  const ps = $('#pageSub'); if (ps) ps.textContent = sub || '';
  const slot = $('#syncSlot'); if (slot) slot.innerHTML = syncIcon();
  const acc = $('#railAccount'); if (acc) acc.innerHTML = `${icon('user-round')}<span class="grow ellipsis">${esc(cloud.user?.email || '')}<br>${syncPill()}</span>`;
  document.title = `${title} · Brújula`;
}

let lastView = null;
function render(reason = 'render') {
  const root = $('#app');
  if (!cloud.user) {
    lastView = null;
    root.className = 'app-auth';
    if (cloud.loading) { root.innerHTML = `<div class="boot" role="status">${BRAND}<p>Abriendo Brújula…</p></div>`; return; }
    if (!root.querySelector('.auth') || reason !== 'cloud') { root.innerHTML = authView.render(ctx()); authView.mount?.(root, ctx()); }
    else authView.update?.(root, ctx());
    return;
  }
  const r = route.current;
  if (r.name === 'nuevo') { go('hoy', { replace: true }); setTimeout(() => openQuickAdd(), 50); return; }
  if (r.name === 'asistente') { go('hoy', { replace: true }); setTimeout(() => openAssistant(), 50); return; }
  const view = VIEWS[r.name] || todayView;
  if (!root.querySelector('#main')) { root.className = 'app'; root.innerHTML = shellHTML(); }
  root.classList.toggle('focus-mode', !!view.full);
  renderChrome(view, r);
  if (reason === 'cloud' && view !== settingsView && lastView === view) { maybeShowConflict(); maybeShowRecovery(); return; }
  const main = $('#main');
  main.classList.toggle('full', !!view.full);
  if (lastView && lastView !== view) { try { lastView.unmount?.(); } catch (e) { console.error(e); } }
  keepFocus(() => { main.innerHTML = view.render(ctx()); });
  view.mount?.(main, ctx());
  if (lastView !== view) { window.scrollTo({ top: 0 }); if (reason === 'route') main.focus({ preventScroll: true }); }
  lastView = view;
  maybeShowConflict();
  maybeShowRecovery();
}

// Enlace de «olvidé mi contraseña»: Supabase abre la app con una sesión de recuperación.
let recoveryOpen = false;
function maybeShowRecovery() {
  if (!cloud.recovery || recoveryOpen) return;
  recoveryOpen = true;
  import('./ui/feedback.js').then(({ openSheet, toast: t }) => {
    const s = openSheet({
      title: 'Crea tu nueva contraseña',
      body: `<label class="field"><span>Nueva contraseña</span><input class="input" type="password" id="newPw" minlength="6" autocomplete="new-password" autofocus></label><p class="hint">Mínimo 6 caracteres.</p>`,
      foot: `<button type="button" class="btn btn-primary" data-ok>${icon('check')}Guardar contraseña</button>`,
      onMount(card) {
        card.querySelector('[data-ok]').addEventListener('click', async () => {
          const pw = card.querySelector('#newPw').value;
          if (pw.length < 6) { t('La contraseña debe tener al menos 6 caracteres.', { tone: 'warn' }); return; }
          try { const { updatePassword } = await import('./cloud/cloud.js'); await updatePassword(pw); s.close(); t('Contraseña actualizada.', { tone: 'ok' }); } catch (e) { t(e.message, { tone: 'warn' }); }
        });
      },
      onClose() { recoveryOpen = false; cloud.recovery = false; },
    });
  });
}

let pending = null;
/** Agrupa avisos en un solo pintado por fotograma; «cloud» solo repinta la barra salvo que haya algo más. */
function schedule(reason) {
  const idle = pending === null;
  if (idle || pending === 'cloud') pending = reason;
  if (idle) requestAnimationFrame(() => { const why = pending; pending = null; render(why); });
}

// ——— Acciones globales ———
action('quick-add', (el) => openQuickAdd({ date: el.dataset.date || null, start: el.dataset.start || null }));
action('open-block', (el) => openBlockDetail(el.dataset.id));
action('assistant', () => openAssistant());
action('sync-status', () => openSyncSheet());
action('go', (el) => go(el.dataset.to));
action('more', () => {
  import('./ui/feedback.js').then(({ openSheet }) => {
    const items = [['progreso', 'chart-column', 'Progreso', 'Horas, dominio y dificultades'], ['habitos', 'sprout', 'Vida', 'Hábitos y diario'], ['ajustes', 'settings', 'Ajustes', 'Cuenta, rutina, modos y datos']];
    const s = openSheet({
      title: 'Más',
      body: `<div class="set-card">${items.map(([k, i, t, d]) => `<a class="set-row" href="#/${k}" data-close>${icon(i)}<span class="txt"><b>${t}</b><small>${d}</small></span>${icon('chevron-right', 'sm')}</a>`).join('')}
        <button type="button" class="set-row" data-close data-act="assistant">${icon('sparkles')}<span class="txt"><b>Asistente</b><small>Gemini y guía de tu horario</small></span>${icon('chevron-right', 'sm')}</button></div>`,
      onMount(card) { card.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) setTimeout(() => s.close(), 0); }); },
    });
  });
});

window.addEventListener('brujula-error', (e) => { toast(e.detail?.message ? `Algo falló: ${e.detail.message}` : 'Algo falló. Inténtalo de nuevo.', { tone: 'warn' }); });
window.addEventListener('brujula-edit-block', (e) => { import('./ui/forms.js').then(({ openBlockForm }) => { const b = store.state.blocks.find((x) => x.id === e.detail); if (b) openBlockForm(b); }); });

// Topbar con sombra al desplazar
let ticking = false;
window.addEventListener('scroll', () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { $('#topbar')?.classList.toggle('scrolled', window.scrollY > 4); ticking = false; }); }, { passive: true });

// Atajos de teclado (escritorio)
document.addEventListener('keydown', (e) => {
  if (!cloud.user || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (topSheet()) return;
  if (e.key === 'n') { e.preventDefault(); openQuickAdd(); }
  else if (e.key === '/') { e.preventDefault(); openAssistant(); }
  else if (e.key === 'h') go('hoy'); else if (e.key === 's') go('semana'); else if (e.key === 'e') go('estudio');
});

// ——— Inicio ———
function start() {
  injectSprite();
  applyTheme(device.get().theme || 'auto');
  delegate(document);
  subscribe((reason) => {
    if (reason === 'account' || reason === 'replace') { closeAllSheets(); applyTheme(device.get().theme || prefs(store.state).theme || 'auto'); }
    if (reason === 'account' && !store.userId && route.current.name !== 'hoy') go('hoy', { replace: true }); // la próxima cuenta empieza en Hoy
    if (reason === 'remote-applied') toast('Actualizado con los cambios de otro dispositivo.', { tone: 'ok' });
    if (['account', 'remote-applied', 'replace'].includes(reason) && store.userId) setTimeout(maybeShowWelcome, 400);
    schedule(reason);
  });
  onRoute(() => { closeAllSheets(); schedule('route'); });
  render('init');
  initAssistant();
  initPWA({ onChange: () => schedule('pwa') });
  initReminders();
  initPush();
  boot();
  // Diagnóstico (consola del navegador / pruebas). No expone credenciales.
  window.brujula = { version: APP_VERSION, store, cloud, pwa, sync: { checkRemote, pushNow, flush } };
}

start();
