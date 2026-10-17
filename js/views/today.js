// Brújula 4.2.4 · Hoy: un foco, una lista y una agenda semanal amplia.

import { esc, cut, cap, plural } from '../core/util.js';
import { device, notify } from '../core/store.js';
import { courseOf, prefs, EVAL_TYPES, isUsableBlock } from '../core/model.js';
import { fmtLong, fmtIn, toMin, addDays, fmtRange, fmtShort, WEEKDAYS_SHORT } from '../core/dates.js';
import { computeFocus } from '../engine/priority.js';
import { icon } from '../ui/icons.js';
import { action } from '../ui/dom.js';
import { go } from '../ui/router.js';
import { cloud } from '../cloud/cloud.js';
import { pwa, promptInstall, applyUpdate } from '../features/pwa.js';
import { courseTag, kindChip, sectionHead } from './common.js';
import { setOutcome, proposeMove, toggleHabit, planExam, scheduleTopic } from '../features/actions.js';
import { openDecisionsSheet, openQuickReview, openEvaluationDetail, openConflictSheet, openRoutineSheet } from '../ui/details.js';
import { haptic } from '../core/util.js';
import { activityCheck, activityNote, isFinished } from '../ui/activity-tools.js';

export const title = () => 'Hoy';
export const subtitle = (c) => cap(fmtLong(c.today));

function rumbo(f, s) {
  const nm = f.nowMin;
  const indexOf = (b) => f.todays.indexOf(b) + 1;
  if (f.current) {
    const b = f.current, c = courseOf(s, b.courseId);
    const span = toMin(b.end) - toMin(b.start);
    const pct = Math.round(((nm - toMin(b.start)) / span) * 100);
    const primary = b.kind === 'study'
      ? `<a class="btn btn-primary btn-lg" href="#/sesion/${encodeURIComponent(b.id)}">${icon('play')}Empezar sesión</a>`
      : b.kind === 'personal' ? `<button type="button" class="btn btn-primary btn-lg" data-act="outcome" data-id="${esc(b.id)}" data-status="mastered">${icon('check')}Marcar hecho</button>`
        : `<button type="button" class="btn btn-lg" data-act="open-block" data-id="${esc(b.id)}">${icon('info')}Ver detalles</button>`;
    return `<section class="rumbo" aria-labelledby="rumboTitle">
      <div class="rumbo-control" aria-label="Control ${indexOf(b)} de ${f.todays.length}">${indexOf(b)}</div>
      <div class="rumbo-top"><span class="rumbo-kicker"><span class="live" aria-hidden="true"></span>Tu rumbo ahora</span></div>
      <h2 class="rumbo-title" id="rumboTitle">${esc(b.title)}</h2>
      <div class="rumbo-meta"><span class="course-tag" style="--c:${esc(c.color)}">${esc(c.name)}</span>${kindChip(b)}<span class="chip"><time>${esc(fmtRange(b.start, b.end))}</time></span></div>
      ${b.goal ? `<p class="rumbo-goal">${esc(cut(b.goal, 160))}</p>` : ''}
      <div class="rumbo-bar" role="progressbar" aria-label="Tiempo transcurrido" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="--v:${pct}%"></span></div>
      <div class="rumbo-actions">${primary}<button type="button" class="btn btn-lg btn-quiet" data-act="open-block" data-id="${esc(b.id)}" aria-label="Más opciones">${icon('ellipsis')}</button></div>
    </section>`;
  }
  if (f.next) {
    const b = f.next, c = courseOf(s, b.courseId);
    const wait = f.minutesToNext;
    const primary = b.kind === 'study' && wait <= 30
      ? `<a class="btn btn-primary btn-lg" href="#/sesion/${encodeURIComponent(b.id)}">${icon('play')}Empezar ya</a>`
      : `<button type="button" class="btn btn-lg" data-act="open-block" data-id="${esc(b.id)}">${icon('info')}Ver detalles</button>`;
    return `<section class="rumbo" aria-labelledby="rumboTitle">
      <div class="rumbo-control" aria-label="Control ${indexOf(b)} de ${f.todays.length}">${indexOf(b)}</div>
      <div class="rumbo-top"><span class="rumbo-kicker">${icon('compass', 'sm')}Tu rumbo ahora · ${esc(fmtIn(wait))}</span></div>
      <h2 class="rumbo-title" id="rumboTitle">${esc(b.title)}</h2>
      <div class="rumbo-meta"><span class="course-tag" style="--c:${esc(c.color)}">${esc(c.name)}</span>${kindChip(b)}<span class="chip"><time>${esc(fmtRange(b.start, b.end))}</time></span></div>
      <div class="rumbo-actions">${primary}</div>
    </section>`;
  }
  if (f.dayOver) {
    const tomorrow = s.blocks.filter((b) => b.date === addDays(f.today, 1)).sort((a, b) => a.start.localeCompare(b.start));
    return `<section class="rumbo calm" aria-labelledby="rumboTitle">
      <div class="rumbo-control finish" aria-hidden="true">${icon('moon')}</div>
      <div class="rumbo-top"><span class="rumbo-kicker">${icon('moon', 'sm')}Hora de descansar</span></div>
      <h2 class="rumbo-title" id="rumboTitle">Recorrido terminado</h2>
      <p class="rumbo-goal">${tomorrow.length ? `Mañana: ${plural(tomorrow.length, 'actividad', 'actividades')}, la primera a las ${esc(tomorrow[0].start)}.` : 'Mañana está libre por ahora.'} Dormir bien también es estudiar.</p>
    </section>`;
  }
  const top = f.priorities[0];
  if (top) {
    return `<section class="rumbo" aria-labelledby="rumboTitle">
      <div class="rumbo-control" aria-hidden="true">${icon('locate-fixed')}</div>
      <div class="rumbo-top"><span class="rumbo-kicker">${icon('compass', 'sm')}Tu rumbo ahora</span></div>
      <h2 class="rumbo-title" id="rumboTitle">${esc(top.title)}</h2>
      <div class="rumbo-meta">${courseTag(top.courseId)}${top.reasons.slice(0, 1).map((r) => `<span class="chip ${r.tone === 'urgent' ? 'urgent' : ''}">${esc(r.text)}</span>`).join('')}</div>
      <p class="rumbo-goal">Una sesión corta para seguir avanzando.</p>
      <div class="rumbo-actions">${priorityButton(top, 'btn-lg btn-primary')}<button type="button" class="btn btn-lg btn-quiet" data-act="quick-add">${icon('plus')}Otra cosa</button></div>
    </section>`;
  }
  return `<section class="rumbo calm" aria-labelledby="rumboTitle">
    <div class="rumbo-control" aria-hidden="true">${icon('sun')}</div>
    <div class="rumbo-top"><span class="rumbo-kicker">${icon('compass', 'sm')}Tu rumbo ahora</span></div>
    <h2 class="rumbo-title" id="rumboTitle">${s.blocks.length ? 'Nada pendiente hoy' : 'Empieza tu recorrido'}</h2>
    <p class="rumbo-goal">${s.blocks.length ? 'Descansar también es avanzar. Si quieres, planifica algo corto.' : 'Escribe una actividad como la dirías: «Repasar Física mañana 4pm». Yo busco el hueco.'}</p>
    <div class="rumbo-actions"><button type="button" class="btn btn-primary btn-lg" data-act="quick-add">${icon('plus')}Añadir actividad</button>${!s.courses.some((c) => !['general', 'vida'].includes(c.id)) ? `<a class="btn btn-lg" href="#/estudio">${icon('book-open')}Agregar mis cursos</a>` : ''}</div>
  </section>`;
}

function priorityButton(p, cls = 'btn-sm') {
  const map = {
    'review-topic': ['rotate-ccw', 'Repasar'], 'plan-topic': ['calendar-plus', 'Programar'],
    'plan-exam': ['route', 'Plan'], 'open-evaluation': ['target', 'Ver'], reschedule: ['calendar-clock', 'Mover'],
  };
  const [ic, label] = map[p.action] || ['chevron-right', 'Ver'];
  return `<button type="button" class="btn ${cls}" data-act="prio" data-type="${esc(p.type)}" data-id="${esc(p.id)}" data-do="${esc(p.action)}">${icon(ic, 'sm')}${label}</button>`;
}

function evalCards(f) {
  const list = f.evaluations.slice(0, 3);
  if (!list.length) return '';
  return `<section class="section">${sectionHead('Próximas evaluaciones', { link: '#/estudio/evaluaciones' })}
    <div class="evals-strip">${list.map((e) => `<button type="button" class="eval-card ${e.daysLeft <= 3 ? 'soon' : ''}" data-act="open-eval" data-id="${esc(e.id)}">
      <span class="eval-days"><b>${e.daysLeft === 0 ? '0' : e.daysLeft}</b><span>${e.daysLeft === 0 ? 'hoy' : e.daysLeft === 1 ? 'día' : 'días'}</span></span>
      <b class="t">${esc(e.title)}</b>
      <span class="hstack small">${courseTag(e.courseId, { short: true })}<span class="muted">${esc(EVAL_TYPES[e.type] || '')}</span></span>
      ${e.prep != null ? `<span class="hstack small" style="gap:8px"><span class="meter ${e.prep >= 85 ? 'm-high' : e.prep >= 50 ? 'm-mid' : 'm-low'}" style="flex:1"><span style="--v:${e.prep}%"></span></span><span class="muted">${e.prep}%</span></span>` : '<span class="small muted">Sin temas asignados</span>'}
    </button>`).join('')}</div></section>`;
}

function banners(s) {
  const out = [];
  const dev = device.get();
  if (cloud.conflict) out.push(`<div class="notice danger">${icon('triangle-alert')}<div class="grow"><b>Tu horario cambió en otro dispositivo.</b> Elige qué copia conservar; nada se pierde.</div><button type="button" class="btn btn-sm" data-act="resolve-conflict">Revisar</button></div>`);
  if (pwa.updateReady) out.push(`<div class="banner">${icon('refresh-cw')}<div class="grow"><b>Nueva versión lista</b><small>Tus datos se conservan.</small></div><button type="button" class="btn btn-sm" data-act="apply-update">Actualizar</button></div>`);
  if (!prefs(s).routineConfirmed) out.push(`<div class="notice route">${icon('moon')}<div class="grow">¿Tu día va de <b>${esc(prefs(s).wake)}</b> a <b>${esc(prefs(s).sleep)}</b> con almuerzo ${esc(prefs(s).lunchStart)}–${esc(prefs(s).lunchEnd)}? Lo uso para no programarte en tu descanso.</div><button type="button" class="btn btn-sm" data-act="routine">Ajustar</button></div>`);
  if (pwa.canInstall && !pwa.standalone && !dev.installDismissed) out.push(`<div class="banner">${icon('smartphone')}<div class="grow"><b>Instala Brújula</b><small>Ábrela como app, también sin conexión.</small></div><button type="button" class="btn btn-sm" data-act="install">Instalar</button><button type="button" class="icon-btn" data-act="install-dismiss" aria-label="Ahora no">${icon('x')}</button></div>`);
  return out.join('');
}


function activityItem(b, {now = null, compact = false} = {}) {
  const done = isFinished(b);
  const pendingReview = now != null && !done && toMin(b.end) <= now && b.status !== 'missed';
  const note = String(b.notes || '').trim();
  return `<div class="agenda-activity ${done ? 'is-done' : ''} ${compact ? 'compact' : ''}">
    ${activityCheck(b)}
    <button type="button" class="agenda-activity-body" data-act="open-block" data-id="${esc(b.id)}">
      <span class="agenda-activity-time"><time>${esc(fmtRange(b.start, b.end))}</time>${pendingReview ? '<span>Por confirmar</span>' : b.status === 'missed' ? '<span>No realizada</span>' : ''}</span>
      <b>${esc(b.title)}</b>
      ${note ? `<span class="agenda-activity-note">${esc(cut(note, 180))}</span>` : ''}
    </button>
    ${activityNote(b)}
  </div>`;
}

function todayPending(f) {
  const pending = f.todays.filter(b => !isFinished(b));
  const done = f.todays.filter(isFinished);
  const older = f.decisions.filter(b => b.date < f.today);
  const rows = pending.slice(0, 5).map(b => activityItem(b, {now:f.nowMin})).join('');
  return `<section class="panel today-pending" aria-labelledby="pendingTitle">
    <div class="section-head"><h2 id="pendingTitle">Hoy pendiente <span class="count-badge">${pending.length}</span></h2>
      <button type="button" class="icon-btn" data-act="quick-add" aria-label="Añadir actividad">${icon('plus', 'sm')}</button></div>
    ${pending.length ? rows : '<p class="today-empty">Todo al día. Tienes espacio para descansar.</p>'}
    ${pending.length > 5 ? `<details class="today-more"><summary>Ver ${pending.length - 5} más</summary>${pending.slice(5).map(b => activityItem(b, {now:f.nowMin})).join('')}</details>` : ''}
    ${done.length ? `<details class="today-more completed-activities"><summary>${done.length} ${done.length === 1 ? 'actividad hecha' : 'actividades hechas'}</summary>${done.map(b => activityItem(b)).join('')}</details>` : ''}
    ${older.length ? `<button type="button" class="link today-older" data-act="all-decisions">Revisar ${plural(older.length, 'actividad anterior', 'actividades anteriores')}</button>` : ''}
  </section>`;
}

function miniWeek(s, today) {
  const dates = Array.from({length:7}, (_, i) => addDays(today, i));
  const byDay = new Map(dates.map(d => [d, []]));
  for (const b of s.blocks) if (byDay.has(b.date) && isUsableBlock(b)) byDay.get(b.date).push(b);
  for (const blocks of byDay.values()) blocks.sort((a, b) => a.start.localeCompare(b.start));
  return `<section class="section week-overview" aria-labelledby="overviewTitle">
    <div class="section-head"><div><h2 id="overviewTitle">Mi semana</h2><p class="small muted">${esc(fmtShort(today))} – ${esc(fmtShort(dates[6]))}</p></div>
      <div class="hstack"><button type="button" class="icon-btn" data-act="download-week" data-date="${esc(today)}" aria-label="Descargar semana como CSV editable" title="Descargar semana · CSV editable">${icon('download', 'sm')}</button>
      <a class="link" href="#/semana/${esc(today)}">Abrir horario${icon('chevron-right', 'sm')}</a></div></div>
    <div class="panel week-overview-list">${dates.map((d, i) => {
      const blocks = byDay.get(d);
      const index = (new Date(d + 'T12:00:00').getDay() + 6) % 7;
      return `<section class="week-overview-day ${i === 0 ? 'is-today' : ''}" aria-label="${esc(fmtLong(d))}">
        <a class="week-overview-date" href="#/semana/${d}"><span>${i === 0 ? 'Hoy' : cap(WEEKDAYS_SHORT[index])}</span><b>${Number(d.slice(8))}</b></a>
        <div class="week-overview-activities">${blocks.length ? blocks.map(b => activityItem(b, {compact:true})).join('') : `<div class="week-overview-empty"><span>Sin actividades</span><button type="button" class="link" data-act="quick-add" data-date="${d}">Añadir</button></div>`}</div>
      </section>`;
    }).join('')}</div>
  </section>`;
}

export function render(c) {
  const s = c.state;
  const f = computeFocus(s, c.now);
  return `<div class="today">${banners(s)}
    <div class="today-grid"><div class="today-focus">${rumbo(f, s)}</div>${todayPending(f)}</div>
    ${miniWeek(s, c.today)}${evalCards(f)}
  </div>`;
}

// ——— Acciones de esta pantalla ———
action('outcome', (el) => { haptic(); return setOutcome(el.dataset.id, el.dataset.status); });
action('move', (el) => proposeMove(el.dataset.id));
action('habit', (el) => { haptic(); toggleHabit(el.dataset.date, el.dataset.habit); });
action('all-decisions', () => openDecisionsSheet());
action('open-eval', (el) => openEvaluationDetail(el.dataset.id));
action('resolve-conflict', () => openConflictSheet());
action('routine', () => openRoutineSheet());
action('apply-update', () => applyUpdate());
action('install', () => promptInstall());
action('install-dismiss', () => { device.set({ installDismissed: true }); notify('ui'); });
action('prio', (el) => {
  const { type, id } = el.dataset;
  const what = el.dataset.do;
  if (what === 'review-topic') return openQuickReview(id);
  if (what === 'plan-topic') return scheduleTopic(id);
  if (what === 'plan-exam') return planExam(id);
  if (what === 'open-evaluation') return openEvaluationDetail(id);
  if (what === 'reschedule') return proposeMove(id);
  if (type === 'topic') go('estudio/temas');
});
