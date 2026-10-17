// Brújula 4 · Ajustes: cuenta y nube, rutina, modos, sesiones, avisos, privacidad de IA,
// apariencia, instalación, datos y opciones avanzadas (ChatGPT, solicitudes, Supabase propio).

import { esc, plural } from '../core/util.js';
import { store, commit, replaceState, device, KEYS } from '../core/store.js';
import { prefs, loadState, blankState, courseOf, statusLabel, APP_VERSION, summarize } from '../core/model.js';
import { todayISO, addDays, fmtDuration } from '../core/dates.js';
import { rulesFrom } from '../engine/rules.js';
import { validateChanges } from '../engine/scheduler.js';
import { icon } from '../ui/icons.js';
import { action, copyText, download } from '../ui/dom.js';
import { openSheet, toast, confirmSheet, promptSheet } from '../ui/feedback.js';
import { openProposal } from '../ui/proposal.js';
import { cloud, signOut, pullNow, updatePassword, privacyCheck, configure, resetConfig, usingCustomConfig, conflictBackups, getClient, PUBLIC_CONFIG } from '../cloud/cloud.js';
import { mode, modeDetail } from '../features/actions.js';
import { enableReminders, permission, notificationsSupported } from '../features/reminders.js';
import { push, pushSupported, needsInstallFirst, pushHealthy, checkPush, enablePush, disablePush, sendTestPush } from '../features/push.js';
import { applyTheme } from '../features/theme.js';
import { pwa } from '../features/pwa.js';
import { progressReport } from './progress.js';
import { storage } from '../core/util.js';

export const title = () => 'Ajustes';
export const subtitle = () => `Brújula ${APP_VERSION}`;

const sel = (name, value, opts, label) => `<select class="select" data-change="pref" data-key="${name}" aria-label="${esc(label)}" style="width:auto;min-width:110px">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

/** Fila «También con la app cerrada» (Web Push, opcional). */
function pushRow(p) {
  let text, can = true;
  if (!pushSupported()) { text = 'Este navegador no lo admite.'; can = false; }
  else if (needsInstallFirst()) { text = 'En iPhone: instala Brújula en la pantalla de inicio y actívalo desde ahí.'; can = false; }
  else if (!push.checked) text = 'Comprobando el servidor de avisos…';
  else if (!push.enabled && !push.subscribed) { text = push.error ? `${push.error} Guía: docs/AVISOS_PUSH.md.` : 'Falta configurar el servidor de avisos (guía: docs/AVISOS_PUSH.md). Mientras tanto uso los avisos de arriba.'; can = false; }
  else if (push.subscribed && pushHealthy()) text = 'Activo en este dispositivo. Llegan aunque cierres Brújula.';
  else if (push.subscribed) text = 'Activo, pero el envío programado del servidor no responde: revisa el cron. Mientras tanto uso los avisos locales.';
  else if (p.pushEnabled) text = push.error || 'Activado en tu cuenta, pero no en este dispositivo.';
  else text = 'Llegan aunque cierres Brújula. Guarda en tu Supabase la hora y el título de tus próximas actividades (7 días).';
  return `<label class="switch set-row"><span class="txt"><b>También con la app cerrada <span class="chip chip-sm">beta</span></b><small>${esc(text)}</small></span><input type="checkbox" data-change="push" ${push.subscribed ? 'checked' : ''} ${can || push.subscribed ? '' : 'disabled'}></label>
      ${push.subscribed ? `<button type="button" class="set-row" data-act="push-test">${icon('send')}<span class="txt"><b>Enviar aviso de prueba</b><small>Cierra Brújula después de pulsar: debería llegar en segundos.</small></span></button>` : ''}`;
}

export function render(c) {
  const s = c.state;
  const p = prefs(s);
  const r = rulesFrom(s.preferences);
  const m = mode();
  const theme = device.get().theme || 'auto';
  const perm = permission();
  const backups = conflictBackups();
  return `<div class="settings">
    <section class="set-group" id="cuenta"><h2>Cuenta y nube</h2><div class="set-card">
      <div class="set-row">${icon('user-round')}<span class="txt"><b>${esc(cloud.user?.email || '')}</b><small>Tus datos están aislados por cuenta (RLS de Supabase).</small></span></div>
      <button type="button" class="set-row" data-act="sync-status">${icon(cloud.status === 'synced' ? 'cloud-check' : 'cloud')}<span class="txt"><b>Sincronización</b><small>${esc({ synced: 'Al día', saving: 'Guardando…', pending: 'Guardando…', offline: 'Sin conexión: se guarda aquí', error: 'Con errores', conflict: 'Hay dos copias distintas', loading: 'Conectando…' }[cloud.status] || cloud.status)}</small></span>${icon('chevron-right', 'sm')}</button>
      <button type="button" class="set-row" data-act="cloud-pull">${icon('download')}<span class="txt"><b>Recuperar mi copia de la nube</b><small>Reemplaza lo de este dispositivo (guardo una copia antes).</small></span></button>
      <button type="button" class="set-row" data-act="change-password">${icon('key-round')}<span class="txt"><b>Cambiar contraseña</b></span></button>
      <button type="button" class="set-row" data-act="sign-out">${icon('log-out')}<span class="txt"><b>Cerrar sesión</b><small>En equipos compartidos, ciérrala siempre.</small></span></button>
    </div></section>

    <section class="set-group" id="rutina"><h2>Rutina y descansos</h2><div class="set-card">
      <button type="button" class="set-row" data-act="routine">${icon('moon')}<span class="txt"><b>${esc(p.wake)} – ${esc(p.sleep)}</b><small>Almuerzo ${esc(p.lunchStart)}–${esc(p.lunchEnd)} · ${p.breakMins} min entre actividades · máximo ${esc(fmtDuration(r.maxStudy))} de estudio al día</small></span>${icon('chevron-right', 'sm')}</button>
      <div class="set-row has-ctl">${icon('timer')}<span class="txt"><b>Pomodoro</b><small>Concentración · descanso</small></span><span class="ctl">${sel('focusMin', p.focusMin, [[15, '15 min'], [20, '20 min'], [25, '25 min'], [30, '30 min'], [45, '45 min'], [50, '50 min']], 'Minutos de concentración')}${sel('breakMin', p.breakMin, [[3, '3 min'], [5, '5 min'], [10, '10 min'], [15, '15 min']], 'Minutos de descanso')}</span></div>
      <div class="set-row has-ctl">${icon('book-open')}<span class="txt"><b>Duración</b><small>Sesión nueva · repaso</small></span><span class="ctl">${sel('sessionMin', p.sessionMin, [[25, '25 min'], [30, '30 min'], [45, '45 min'], [60, '1 h'], [90, '1 h 30']], 'Duración de sesión')}${sel('reviewMin', p.reviewMin, [[15, '15 min'], [20, '20 min'], [25, '25 min'], [30, '30 min'], [45, '45 min']], 'Duración de repaso')}</span></div>
    </div></section>

    <section class="set-group" id="modos"><h2>Cuando algo no se cumple</h2><div class="set-card"><div class="set-pad">
      <div class="seg" role="group" aria-label="Modo de reprogramación">${[['confirm', 'hand', 'Preguntar'], ['mixed', 'shuffle', 'Mixto'], ['flex', 'zap', 'Automático']].map(([k, i, l]) => `<button type="button" data-act="mode" data-mode="${k}" aria-pressed="${m === k}">${icon(i)}${l}</button>`).join('')}</div>
      <p class="small">${esc(modeDetail(m).text)}</p>
      <p class="hint">Solo actúa cuando marcas «No lo hice» o «Repasar», nunca por la hora. Clases, exámenes, temas dominados y tus descansos están siempre protegidos. Todo se puede deshacer.${p.replanConsentAt ? ` Activado el ${esc(new Date(p.replanConsentAt).toLocaleDateString('es-PE'))}.` : ''}</p>
    </div></div></section>

    <section class="set-group" id="avisos"><h2>Avisos</h2><div class="set-card">
      <label class="switch set-row"><span class="txt"><b>Avisarme antes de cada actividad</b><small>${notificationsSupported() ? (perm === 'denied' ? 'Bloqueado en el navegador: permítelo en la configuración del sitio.' : 'Mientras Brújula esté abierta o recién minimizada.') : 'Este navegador no admite notificaciones.'}</small></span><input type="checkbox" data-change="reminders" ${p.reminders && perm === 'granted' ? 'checked' : ''} ${notificationsSupported() ? '' : 'disabled'}></label>
      <div class="set-row has-ctl">${icon('bell')}<span class="txt"><b>Anticipación</b></span><span class="ctl">${sel('reminderLead', p.reminderLead, [[0, 'A la hora'], [5, '5 min antes'], [10, '10 min antes'], [15, '15 min antes'], [30, '30 min antes']], 'Anticipación del aviso')}</span></div>
      ${pushRow(p)}
    </div></section>

    <section class="set-group" id="ia"><h2>Asistente y privacidad</h2><div class="set-card">
      <label class="switch set-row"><span class="txt"><b>Usar Gemini</b><small>Tus mensajes se envían a Google a través de tu función segura de Supabase. En el nivel gratuito, Google puede usarlos para mejorar sus productos.</small></span><input type="checkbox" data-change="ai-consent" ${p.aiConsent ? 'checked' : ''}></label>
      <label class="switch set-row"><span class="txt"><b>Permitir enviar mi horario</b><small>Necesario para analizar tu semana o proponer cambios. Nunca se envían notas, diario ni contraseñas.</small></span><input type="checkbox" data-change="ai-share" ${p.aiShareSchedule ? 'checked' : ''} ${p.aiConsent ? '' : 'disabled'}></label>
      <div class="set-pad"><p class="hint">Gemini solo propone: cada cambio se valida en tu dispositivo (cruces, sueño, almuerzo, protegidos) y requiere que pulses «Aplicar». Límite: 15 consultas al día por cuenta.</p></div>
    </div></section>

    <section class="set-group" id="apariencia"><h2>Apariencia</h2><div class="set-card"><div class="set-pad">
      <div class="seg" role="group" aria-label="Tema">${[['auto', 'monitor', 'Automático'], ['light', 'sun', 'Claro'], ['dark', 'moon', 'Oscuro']].map(([k, i, l]) => `<button type="button" data-act="theme" data-theme="${k}" aria-pressed="${theme === k}">${icon(i)}${l}</button>`).join('')}</div>
    </div></div></section>

    <section class="set-group" id="instalar"><h2>App en tu celular</h2><div class="set-card">
      ${pwa.standalone ? `<div class="set-row">${icon('smartphone')}<span class="txt"><b>Instalada</b><small>Funciona sin conexión con tu última copia.</small></span></div>`
        : pwa.canInstall ? `<button type="button" class="set-row" data-act="install">${icon('smartphone')}<span class="txt"><b>Instalar Brújula</b><small>Ícono en tu pantalla de inicio y uso sin conexión.</small></span>${icon('chevron-right', 'sm')}</button>`
          : `<div class="set-row">${icon('smartphone')}<span class="txt"><b>Instalar</b><small>${pwa.ios ? 'En Safari: Compartir → «Agregar a pantalla de inicio».' : 'En Chrome Android: menú ⋮ → «Instalar app» o «Agregar a pantalla principal».'}</small></span></div>`}
      ${pwa.updateReady ? `<button type="button" class="set-row" data-act="apply-update">${icon('refresh-cw')}<span class="txt"><b>Actualizar a la nueva versión</b><small>Tus datos se conservan.</small></span></button>` : ''}
    </div></section>

    <section class="set-group" id="datos"><h2>Tus datos</h2><div class="set-card">
      <button type="button" class="set-row" data-act="export-json">${icon('download')}<span class="txt"><b>Descargar copia de seguridad</b><small>Archivo JSON con todo tu plan. Guárdalo en Drive.</small></span></button>
      <button type="button" class="set-row" data-act="import-json">${icon('upload')}<span class="txt"><b>Restaurar una copia</b><small>Reemplaza el plan actual (pido confirmación).</small></span></button>
      <button type="button" class="set-row" data-act="export-csv">${icon('file-spreadsheet')}<span class="txt"><b>Exportar horario (CSV)</b><small>Para Excel o Google Sheets.</small></span></button>
      <button type="button" class="set-row" data-act="copy-report">${icon('copy')}<span class="txt"><b>Copiar informe para ChatGPT</b></span></button>
      ${backups.length ? `<button type="button" class="set-row" data-act="backups">${icon('archive')}<span class="txt"><b>Copias automáticas</b><small>${plural(backups.length, 'copia guardada', 'copias guardadas')} en este dispositivo</small></span>${icon('chevron-right', 'sm')}</button>` : ''}
      <button type="button" class="set-row" data-act="reset-plan" style="color:var(--alert)">${icon('trash')}<span class="txt"><b>Vaciar mi plan</b><small>Borra cursos, actividades y avances de esta cuenta.</small></span></button>
    </div><input type="file" id="importFile" accept="application/json,.json" hidden></section>

    <section class="set-group" id="avanzado"><h2>Avanzado</h2><div class="set-card">
      <button type="button" class="set-row" data-act="chatgpt-import">${icon('file-braces')}<span class="txt"><b>Pegar propuesta JSON de ChatGPT</b><small>Brújula la verifica y te muestra los cambios antes de aplicarlos.</small></span></button>
      <button type="button" class="set-row" data-act="copy-schedule-prompt">${icon('copy')}<span class="txt"><b>Copiar mi horario para ChatGPT</b><small>Incluye cursos y actividades recientes (no tu diario).</small></span></button>
      <button type="button" class="set-row" data-act="copy-plan-template">${icon('wand-sparkles')}<span class="txt"><b>Crear mi horario con ChatGPT</b><small>Copia instrucciones para que te devuelva un JSON importable.</small></span></button>
      <button type="button" class="set-row" data-act="request-ai-plan">${icon('link')}<span class="txt"><b>Solicitud temporal para ChatGPT (Supabase)</b><small>Crea un código; la propuesta vuelve aquí para tu aprobación.</small></span></button>
      <button type="button" class="set-row" data-act="load-ai-plan">${icon('cloud')}<span class="txt"><b>Consultar propuesta de la nube</b></span></button>
      <button type="button" class="set-row" data-act="privacy-check">${icon('shield-check')}<span class="txt"><b>Comprobar acceso privado</b><small>Prueba de solo lectura contra filas de otras cuentas.</small></span></button>
      <button type="button" class="set-row" data-act="custom-config">${icon('sliders-horizontal')}<span class="txt"><b>Proyecto Supabase</b><small>${usingCustomConfig() ? 'Usando un proyecto propio' : 'Conexión pública de Brújula'}</small></span>${icon('chevron-right', 'sm')}</button>
    </div></section>

    <section class="set-group"><h2>Acerca de</h2><div class="set-card">
      <div class="set-row">${icon('compass')}<span class="txt"><b>Brújula ${APP_VERSION}</b><small>Sin servicios de pago. Tipografías Bricolage Grotesque y Atkinson Hyperlegible Next (OFL), iconos Lucide (ISC).</small></span></div>
      <div class="set-pad"><p class="hint">Atajos en computadora: N nuevo · / asistente · H hoy · S semana · E estudio.</p></div>
    </div></section>
  </div>`;
}

export function mount(root, c) {
  if (pushSupported() && !push.checked && !push.checking && cloud.user) checkPush();
  const anchor = c.route.params[0];
  if (anchor) { const el = root.querySelector('#' + CSS.escape(anchor)); if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 30); }
  const file = root.querySelector('#importFile');
  file?.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const { state } = loadState(data);
      const sum = summarize(state);
      if (!(await confirmSheet({ title: 'Restaurar esta copia', text: `Tiene ${plural(sum.blocks, 'actividad', 'actividades')}, ${plural(sum.courses, 'curso', 'cursos')} y ${plural(sum.topics, 'tema', 'temas')}. Reemplazará tu plan actual (guardo una copia automática antes).`, confirm: 'Restaurar' }))) return;
      storage.setJSON(KEYS.conflictBackup(store.userId), { at: new Date().toISOString(), kind: 'device', payload: store.state });
      state.preferences = { ...prefs(store.state), ...(state.preferences || {}) };
      replaceState(state);
      commit();
      toast('Copia restaurada. Se sincronizará con tu cuenta.', { tone: 'ok' });
    } catch (e) { toast('No se pudo leer esa copia: ' + (e.message || 'archivo no válido'), { tone: 'warn' }); }
  });
}

// ——— Acciones ———
const setPref = (key, value) => { store.state.preferences = { ...prefs(store.state), [key]: value }; commit(); };
action('pref', (el) => { setPref(el.dataset.key, Number(el.value)); toast('Guardado.', { tone: 'ok', duration: 1500 }); });
action('reminders', async (el) => { const r = await enableReminders(el.checked); if (!r.ok) { el.checked = false; toast(r.message, { tone: 'warn' }); } else toast(el.checked ? 'Avisos activados.' : 'Avisos desactivados.', { tone: 'ok' }); });
action('push', async (el) => {
  el.disabled = true;
  const r = el.checked ? await enablePush() : await disablePush();
  el.disabled = false;
  if (!r.ok) { el.checked = false; toast(r.message, { tone: 'warn', duration: 8000 }); return; }
  if (el.checked) toast(r.test && !r.test.ok ? 'Activado, pero el aviso de prueba no llegó al servicio de notificaciones. Revisa la guía.' : 'Activado: te llegará un aviso de prueba.', { tone: r.test && !r.test.ok ? 'warn' : 'ok', duration: 6000 });
  else toast(r.devices ? 'Desactivado en este dispositivo.' : 'Avisos con la app cerrada desactivados.', { tone: 'ok' });
});
action('push-test', async () => {
  try { const r = await sendTestPush(); toast(r.sent ? `Aviso enviado a ${r.sent === 1 ? 'tu dispositivo' : r.sent + ' dispositivos'}.` : 'No se pudo entregar: vuelve a activar los avisos en este dispositivo.', { tone: r.sent ? 'ok' : 'warn' }); } catch (e) { toast(e.message, { tone: 'warn' }); }
});
action('ai-consent', (el) => { store.state.preferences = { ...prefs(store.state), aiConsent: el.checked, aiShareSchedule: el.checked ? prefs(store.state).aiShareSchedule : false, aiConsentAt: el.checked ? new Date().toISOString() : null }; commit(); });
action('ai-share', (el) => setPref('aiShareSchedule', el.checked));
action('theme', (el) => { device.set({ theme: el.dataset.theme }); applyTheme(el.dataset.theme); import('../core/store.js').then((m) => m.notify('ui')); });
action('cloud-pull', async () => {
  if (!(await confirmSheet({ title: 'Recuperar de la nube', text: 'Reemplaza el plan de este dispositivo por el de tu cuenta. Guardo una copia de lo que tienes aquí.', confirm: 'Recuperar' }))) return;
  try { const r = await pullNow(); toast(r.ok ? 'Copia de la nube recuperada.' : r.message, { tone: r.ok ? 'ok' : 'warn' }); } catch (e) { toast('No se pudo recuperar: ' + e.message, { tone: 'warn' }); }
});
action('change-password', async () => {
  const pw = await promptSheet({ title: 'Nueva contraseña', label: 'Mínimo 6 caracteres', optional: false, confirm: 'Cambiar' });
  if (!pw) return;
  if (pw.length < 6) { toast('La contraseña debe tener al menos 6 caracteres.', { tone: 'warn' }); return; }
  try { await updatePassword(pw); toast('Contraseña actualizada.', { tone: 'ok' }); } catch (e) { toast(e.message, { tone: 'warn' }); }
});
action('sign-out', () => {
  const s = openSheet({
    title: 'Cerrar sesión',
    body: `<p class="muted">Tus datos quedan guardados en tu cuenta.</p><label class="check"><input type="checkbox" id="wipeLocal"><span>Borrar también la copia de este dispositivo (recomendado en equipos compartidos)</span></label>`,
    foot: `<button type="button" class="btn" data-sheet-close>Cancelar</button><button type="button" class="btn btn-primary" data-ok>${icon('log-out')}Cerrar sesión</button>`,
    onMount(card) { card.querySelector('[data-ok]').addEventListener('click', async () => { const wipe = card.querySelector('#wipeLocal').checked; s.close(); await signOut({ wipeLocal: wipe }); }); },
  });
});
action('export-json', () => { download(`brujula-respaldo-${todayISO()}.json`, JSON.stringify(store.state, null, 2)); toast('Copia descargada. Guárdala en un lugar seguro.', { tone: 'ok' }); });
action('import-json', () => document.getElementById('importFile')?.click());
action('export-csv', () => {
  const s = store.state;
  const rows = [['Fecha', 'Inicio', 'Fin', 'Curso', 'Tipo', 'Tema', 'Objetivo', 'Estado'], ...s.blocks.map((b) => [b.date, b.start, b.end, courseOf(s, b.courseId).name, b.kind, b.title, b.goal || '', statusLabel(b)])];
  const csv = '﻿' + rows.map((r) => r.map((x) => '"' + String(x).replaceAll('"', '""') + '"').join(',')).join('\r\n');
  download('brujula-horario.csv', csv, 'text/csv;charset=utf-8');
  toast('Horario exportado.', { tone: 'ok' });
});
action('backups', () => {
  const list = conflictBackups();
  const label = { device: 'Este dispositivo (antes de cambiar de copia)', cloud: 'Nube (antes de reemplazarla)', pre4: 'Antes de actualizar a 4.0' };
  openSheet({
    title: 'Copias automáticas',
    body: `<div class="set-card">${list.map(([k, v]) => { const sum = summarize(v.payload); return `<button type="button" class="set-row" data-k="${k}">${icon('archive')}<span class="txt"><b>${esc(label[k])}</b><small>${v.at ? esc(new Date(v.at).toLocaleString('es-PE')) + ' · ' : ''}${plural(sum.blocks, 'actividad', 'actividades')}</small></span>${icon('download', 'sm')}</button>`; }).join('')}</div><p class="hint">Descárgalas y usa «Restaurar una copia» si las necesitas.</p>`,
    onMount(card) { card.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; const v = list.find(([k]) => k === b.dataset.k)[1]; download(`brujula-copia-${b.dataset.k}-${todayISO()}.json`, JSON.stringify(v.payload, null, 2)); }); },
  });
});
action('reset-plan', async () => {
  if (!(await confirmSheet({ title: 'Vaciar mi plan', text: 'Se borran cursos, actividades, temas, evaluaciones y avances de esta cuenta (también en la nube). Se conserva tu rutina. Guardo una copia automática en este dispositivo.', confirm: 'Vaciar', danger: true }))) return;
  storage.setJSON(KEYS.conflictBackup(store.userId), { at: new Date().toISOString(), kind: 'device', payload: store.state });
  const fresh = blankState();
  fresh.preferences = { ...prefs(store.state) };
  replaceState(fresh);
  commit();
  toast('Plan vacío. Tienes una copia en «Copias automáticas».', { tone: 'ok' });
});
action('copy-report', async () => toast((await copyText(progressReport(store.state))) ? 'Informe copiado.' : 'No se pudo copiar.', { tone: 'ok' }));

// ChatGPT y propuestas JSON (heredado de 3.x, ahora con validación unificada)
function scheduleForChatGPT() {
  const s = store.state;
  const rows = s.blocks.filter((b) => b.date >= addDays(todayISO(), -14)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, 120);
  return rows.map((b) => ({ id: b.id, curso: courseOf(s, b.courseId).name, fecha: b.date, inicio: b.start, fin: b.end, tema: b.title, tipo: b.kind, prioridad: b.priority, estado: b.status }));
}
action('copy-schedule-prompt', async () => {
  const s = store.state;
  const p = prefs(s);
  const text = `Quiero reorganizar mi horario de Brújula. No alteres actividades dominadas ni clases o exámenes. Respeta mi sueño (${p.wake}–${p.sleep}), almuerzo (${p.lunchStart}–${p.lunchEnd}) y ${p.breakMins} min entre actividades. Pregunta si hay ambigüedades. RESPONDE solo con JSON válido sin markdown:\n{"version":1,"changes":[{"action":"add","course":"Nombre exacto","date":"AAAA-MM-DD","start":"15:00","end":"16:00","title":"Repaso","goal":"Resolver 3 ejercicios","kind":"study","priority":"high","difficulty":4},{"action":"update","id":"ID_REAL","start":"16:00","end":"17:00"}]}\nUsa course exacto del listado e id real para actualizar. Solo los cambios necesarios.\nCURSOS: ${s.courses.filter((c) => !c.archived).map((c) => c.name).join(', ')}\nHORARIO: ${JSON.stringify(scheduleForChatGPT())}`;
  toast((await copyText(text)) ? 'Copiado. Pégalo en tu ChatGPT y luego trae aquí el JSON.' : 'No se pudo copiar.', { tone: 'ok' });
});
action('copy-plan-template', async () => {
  const s = store.state;
  const msg = `Ayúdame a crear un horario en Brújula respetando 8 horas de sueño si es posible, clases fijas y descansos. Pregúntame por mis cursos, horarios fijos, actividades personales, exámenes, prioridades y tiempo disponible. Cuando tengas lo necesario, responde EXCLUSIVAMENTE con JSON válido: {"version":1,"changes":[{"action":"add","course":"Mis estudios","date":"AAAA-MM-DD","start":"15:00","end":"16:00","title":"Tema o actividad","goal":"Objetivo","kind":"study","priority":"normal","difficulty":3}]}. Tipos: study, class, exam, personal. Usa SOLO estos cursos: ${s.courses.filter((c) => !c.archived).map((c) => c.name).join(', ')}. Fechas reales futuras desde ${todayISO()}. No borres nada. Mi contexto es:`;
  toast((await copyText(msg)) ? 'Instrucciones copiadas. Pégalas en tu ChatGPT.' : 'No se pudo copiar.', { tone: 'ok' });
});
export function reviewJSONProposal(text, { source = 'import', onApplied = null } = {}) {
  let plan;
  try {
    const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (cleaned.length > 100000) throw Error('El texto es demasiado grande.');
    plan = JSON.parse(cleaned);
  } catch (e) { toast('No es un JSON válido: ' + e.message, { tone: 'warn' }); return false; }
  if (!plan || plan.version !== 1 || !Array.isArray(plan.changes) || !plan.changes.length) { toast('Formato inválido: usa {"version":1,"changes":[…]}.', { tone: 'warn' }); return false; }
  const r = validateChanges(store.state, plan.changes, { source, rules: rulesFrom(store.state.preferences), now: new Date() });
  openProposal({ title: 'Revisar propuesta', ops: r.ops, rejected: r.rejected, warnings: r.warnings, source, eventReason: 'Cambios importados y revisados por ti', onApplied });
  return true;
}
action('chatgpt-import', () => {
  const s = openSheet({
    title: 'Propuesta JSON', wide: true,
    body: `<label class="field"><span>Pega aquí el JSON que te dio ChatGPT</span><textarea class="textarea" id="jsonIn" rows="10" placeholder='{"version":1,"changes":[…]}' autofocus></textarea></label><p class="hint">No se aplica nada todavía: primero verás cada cambio, los cruces y los avisos.</p>`,
    foot: `<button type="button" class="btn" data-sheet-close>Cancelar</button><button type="button" class="btn btn-primary" data-ok>${icon('shield-check')}Verificar</button>`,
    onMount(card) { card.querySelector('[data-ok]').addEventListener('click', () => { const v = card.querySelector('#jsonIn').value; if (reviewJSONProposal(v)) s.close(); }); },
  });
});
action('request-ai-plan', async () => {
  if (!cloud.user) return;
  try {
    const client = await getClient();
    const s = store.state;
    const snapshot = { version: 1, createdAt: new Date().toISOString(), courses: s.courses.map((c) => ({ id: c.id, name: c.name })), blocks: s.blocks.map((b) => ({ id: b.id, course: courseOf(s, b.courseId).name, date: b.date, start: b.start, end: b.end, title: b.title, goal: b.goal || '', status: b.status, kind: b.kind, priority: b.priority, difficulty: b.difficulty })) };
    const { data, error } = await client.from('brujula_assistant_requests').insert({ user_id: cloud.user.id, schedule_snapshot: snapshot }).select('id,expires_at').single();
    if (error) throw error;
    const msg = 'Brújula: prepara cambios a mi horario. Código temporal de solicitud: ' + data.id + '. No modifiques actividades dominadas ni clases fijas ni suprimas bloques sin mi permiso. Revisa los cruces y prioriza el descanso. Consulta esa solicitud en mi Supabase conectado y guarda una PROPUESTA para que yo la apruebe en la aplicación; no alteres directamente el estado de mi horario.';
    await copyText(msg);
    toast(`Solicitud creada (expira ${new Date(data.expires_at).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}). Mensaje copiado para ChatGPT.`, { tone: 'ok', duration: 7000 });
  } catch (e) { toast('No se pudo crear la solicitud: ' + (e.message || e), { tone: 'warn' }); }
});
action('load-ai-plan', async () => {
  if (!cloud.user) return;
  try {
    const client = await getClient();
    const { data, error } = await client.from('brujula_assistant_requests').select('id,proposal,status,expires_at').eq('user_id', cloud.user.id).eq('status', 'proposed').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!data?.proposal) { toast('Todavía no hay una propuesta nueva.'); return; }
    reviewJSONProposal(JSON.stringify(data.proposal), {
      onApplied: () => client.from('brujula_assistant_requests').update({ status: 'applied', updated_at: new Date().toISOString() }).eq('id', data.id).eq('user_id', cloud.user.id).then(() => {}, () => {}),
    });
  } catch (e) { toast('No se pudo consultar: ' + (e.message || e), { tone: 'warn' }); }
});
action('privacy-check', async () => {
  try { const r = await privacyCheck(); toast(r.message, { tone: r.ok ? 'ok' : 'warn', duration: 9000 }); } catch (e) { toast(e.message, { tone: 'warn' }); }
});
action('custom-config', () => {
  const custom = usingCustomConfig();
  const s = openSheet({
    title: 'Proyecto Supabase',
    body: `<p class="muted">Por defecto Brújula usa su conexión pública (${esc(PUBLIC_CONFIG.url.replace('https://', ''))}). Solo cambia esto si administras tu propio proyecto.</p>
      <label class="field"><span>URL del proyecto</span><input class="input" id="cfgUrl" placeholder="https://ejemplo.supabase.co" autocomplete="off" value="${esc(custom ? cloud.config.url : '')}"></label>
      <label class="field"><span>Clave pública (publishable o anon)</span><input class="input" id="cfgKey" placeholder="sb_publishable_…" autocomplete="off"></label>
      <div class="notice warn">${icon('shield-check')}<div>Nunca pegues claves <b>secret</b> o <b>service_role</b>: Brújula las rechaza.</div></div>`,
    foot: `${custom ? `<button type="button" class="btn" data-reset>Usar la conexión de Brújula</button>` : ''}<button type="button" class="btn btn-primary" data-ok>Guardar y entrar</button>`,
    onMount(card) {
      card.querySelector('[data-ok]').addEventListener('click', async () => { try { s.close(); await configure(card.querySelector('#cfgUrl').value, card.querySelector('#cfgKey').value); } catch (e) { toast(e.message, { tone: 'warn' }); } });
      card.querySelector('[data-reset]')?.addEventListener('click', async () => { s.close(); await resetConfig(); });
    },
  });
});
