// Brújula 4 · Hoy: qué hacer ahora, qué necesita tu decisión y qué es prioritario.

import { esc, cut, cap, plural } from '../core/util.js';
import { device, notify } from '../core/store.js';
import { courseOf, prefs, EVAL_TYPES } from '../core/model.js';
import { fmtLong, fmtRelDay, fmtDuration, fmtIn, toMin, toHHMM, addDays, fmtRange } from '../core/dates.js';
import { computeFocus } from '../engine/priority.js';
import { isFixedKind } from '../engine/scheduler.js';
import { habitStreak } from '../engine/insights.js';
import { icon } from '../ui/icons.js';
import { action } from '../ui/dom.js';
import { go } from '../ui/router.js';
import { cloud } from '../cloud/cloud.js';
import { pwa, promptInstall, applyUpdate } from '../features/pwa.js';
import { courseTag, kindChip, sectionHead, emptyState } from './common.js';
import { setOutcome, proposeMove, toggleHabit, planExam, scheduleTopic, mode, modeDetail } from '../features/actions.js';
import { openDecisionsSheet, openQuickReview, openEvaluationDetail, openConflictSheet, openRoutineSheet } from '../ui/details.js';
import { haptic } from '../core/util.js';

export const title = () => 'Hoy';
export const subtitle = (c) => cap(fmtLong(c.today));

const TRIANGLE = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 5 L28.5 26.5 L3.5 26.5 Z" fill="var(--paper)" stroke="var(--route)" stroke-width="3" stroke-linejoin="round"/></svg>';
const FINISH = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" fill="var(--paper)" stroke="var(--route)" stroke-width="2.6"/><circle cx="16" cy="16" r="7.5" fill="none" stroke="var(--route)" stroke-width="2.6"/></svg>';

function rumbo(f, s) {
  const p = prefs(s);
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
      <div class="rumbo-top"><span class="rumbo-kicker"><span class="live" aria-hidden="true"></span>Ahora</span></div>
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
    const free = f.freeNow && f.freeNow.minutes >= 25 ? f.freeNow : null;
    const top = f.priorities[0];
    const primary = b.kind === 'study' && wait <= 30
      ? `<a class="btn btn-primary btn-lg" href="#/sesion/${encodeURIComponent(b.id)}">${icon('play')}Empezar ya</a>`
      : `<button type="button" class="btn btn-lg" data-act="open-block" data-id="${esc(b.id)}">${icon('info')}Ver detalles</button>`;
    return `<section class="rumbo" aria-labelledby="rumboTitle">
      <div class="rumbo-control" aria-label="Control ${indexOf(b)} de ${f.todays.length}">${indexOf(b)}</div>
      <div class="rumbo-top"><span class="rumbo-kicker">${icon('navigation', 'sm')}Siguiente · ${esc(fmtIn(wait))}</span></div>
      <h2 class="rumbo-title" id="rumboTitle">${esc(b.title)}</h2>
      <div class="rumbo-meta"><span class="course-tag" style="--c:${esc(c.color)}">${esc(c.name)}</span>${kindChip(b)}<span class="chip"><time>${esc(fmtRange(b.start, b.end))}</time></span></div>
      ${free && top ? `<div class="notice route">${icon('lightbulb')}<div>Tienes <b>${esc(fmtDuration(Math.min(free.minutes, wait - (f.rules.gap || 0))))}</b> libres antes. Lo más útil: <b>${esc(cut(top.title, 60))}</b>.</div></div>` : ''}
      <div class="rumbo-actions">${primary}${free && top ? priorityButton(top, 'btn-lg') : ''}</div>
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
      <div class="rumbo-meta">${courseTag(top.courseId)}${top.reasons.slice(0, 3).map((r) => `<span class="chip ${r.tone === 'urgent' ? 'urgent' : ''}">${esc(r.text)}</span>`).join('')}</div>
      <p class="rumbo-goal">${f.freeNow ? `Tienes ${esc(fmtDuration(f.freeNow.minutes))} libres hoy.` : 'No queda nada programado hoy.'} Esto es lo que más te acerca a tus metas.</p>
      <div class="rumbo-actions">${priorityButton(top, 'btn-lg btn-primary')}<button type="button" class="btn btn-lg btn-quiet" data-act="quick-add">${icon('plus')}Otra cosa</button></div>
    </section>`;
  }
  return `<section class="rumbo calm" aria-labelledby="rumboTitle">
    <div class="rumbo-control" aria-hidden="true">${icon('sun')}</div>
    <div class="rumbo-top"><span class="rumbo-kicker">${icon('compass', 'sm')}Día libre</span></div>
    <h2 class="rumbo-title" id="rumboTitle">${s.blocks.length ? 'Nada pendiente hoy' : 'Empieza tu recorrido'}</h2>
    <p class="rumbo-goal">${s.blocks.length ? 'Descansar también es avanzar. Si quieres, planifica algo corto.' : 'Escribe una actividad como la dirías: «Repasar Física mañana 4pm». Yo busco el hueco.'}</p>
    <div class="rumbo-actions"><button type="button" class="btn btn-primary btn-lg" data-act="quick-add">${icon('plus')}Planificar</button>${!s.courses.some((c) => !['general', 'vida'].includes(c.id)) ? `<a class="btn btn-lg" href="#/estudio">${icon('book-open')}Agregar mis cursos</a>` : ''}</div>
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

function decisionItem(b, today) {
  const study = b.kind === 'study';
  return `<li class="decide-item">
    <div class="decide-top"><div class="grow"><button type="button" class="t" data-act="open-block" data-id="${esc(b.id)}" style="text-align:left"><b>${esc(b.title)}</b></button>
      <div class="meta">${courseTag(b.courseId, { short: true })}<span>${esc(cap(fmtRelDay(b.date, today)))} · <time>${esc(b.start)}</time></span></div></div></div>
    <div class="qa" role="group" aria-label="¿Cómo te fue con ${esc(b.title)}?">
      <button type="button" class="ok" data-act="outcome" data-id="${esc(b.id)}" data-status="mastered">${icon('check')}${study ? 'Lo domino' : 'Hecho'}</button>
      ${study ? `<button type="button" class="rev" data-act="outcome" data-id="${esc(b.id)}" data-status="review">${icon('rotate-ccw')}Repasar</button>` : ''}
      <button type="button" class="no" data-act="outcome" data-id="${esc(b.id)}" data-status="missed">${icon('x')}No hice</button>
    </div>
  </li>`;
}

function courseLine(f, s) {
  const r = f.rules;
  const items = [];
  const hh = (m) => toHHMM(Math.min(1439, m));
  items.push(`<li class="cl cl-start"><span class="cl-mark">${TRIANGLE}</span><time>${hh(r.wake)}</time><span class="cl-body"><b>Salida</b></span><span></span></li>`);
  let cursor = r.wake;
  const now = f.nowMin;
  f.todays.forEach((b, i) => {
    const st = toMin(b.start), en = toMin(b.end);
    const gapStart = Math.max(cursor, now);
    if (st - gapStart >= 30 && st > now) {
      items.push(`<li class="cl gap"><span class="cl-gap-label">${esc(fmtDuration(st - gapStart))} libres <button type="button" data-act="quick-add" data-date="${esc(f.today)}" data-start="${hh(Math.ceil((gapStart + (r.gap || 0)) / 5) * 5)}">${icon('plus', 'sm')}Añadir</button></span></li>`);
    }
    const isNow = f.current && f.current.id === b.id;
    const done = b.status === 'mastered' || b.status === 'review';
    const cls = [isNow ? 'now' : '', done ? 'done' : '', b.status === 'missed' ? 'missed' : '', isFixedKind(b.kind) ? 'fixed' : ''].join(' ');
    const mark = done ? icon('check') : b.status === 'missed' ? icon('x', 'sm') : String(i + 1);
    items.push(`<li class="cl ${cls}"><span class="cl-mark" aria-hidden="true">${mark}</span><time>${esc(b.start)}</time>
      <button type="button" class="cl-body" data-act="open-block" data-id="${esc(b.id)}"><b>${esc(b.title)}</b><span class="meta">${courseTag(b.courseId, { short: true })}${kindChip(b)}${b.status === 'missed' ? '<span class="chip s-missed">No realizada</span>' : ''}${isNow ? '<span class="chip route">Ahora</span>' : ''}</span></button><span></span></li>`);
    cursor = Math.max(cursor, en);
  });
  const tail = Math.max(cursor, now);
  if (r.sleep - tail >= 45 && now < r.sleep) items.push(`<li class="cl gap"><span class="cl-gap-label">${esc(fmtDuration(r.sleep - tail))} libres <button type="button" data-act="quick-add" data-date="${esc(f.today)}" data-start="${hh(Math.ceil((tail + (r.gap || 0)) / 5) * 5)}">${icon('plus', 'sm')}Añadir</button></span></li>`);
  items.push(`<li class="cl cl-finish"><span class="cl-mark">${FINISH}</span><time>${hh(r.sleep)}</time><span class="cl-body"><b>Descanso</b></span><span></span></li>`);
  return `<ol class="course-line" aria-label="Recorrido de hoy">${items.join('')}</ol>`;
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

function habitsToday(s, today) {
  const defs = (s.habitDefs || []).filter((h) => h.active !== false);
  if (!defs.length) return '';
  const done = s.habits[today] || {};
  const count = defs.filter((h) => done[h.id]).length;
  return `<section class="section">${sectionHead('Hábitos de hoy', { link: '#/habitos', linkLabel: `${count}/${defs.length}` })}
    <div class="habit-row">${defs.map((h) => { const on = !!done[h.id]; const streak = habitStreak(s, h.id, today); return `<button type="button" class="habit-pill" aria-pressed="${on}" data-act="habit" data-habit="${esc(h.id)}" data-date="${esc(today)}">${icon(on ? 'circle-check' : h.icon || 'circle')}${esc(h.name)}${streak > 1 ? `<span class="streak">${icon('flame', 'sm')}${streak}</span>` : ''}</button>`; }).join('')}</div></section>`;
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

export function render(c) {
  const s = c.state;
  const f = computeFocus(s, c.now);
  const decisions = f.decisions;
  const m = mode();
  const decide = decisions.length ? `<section class="section" aria-labelledby="decTitle">
      <div class="section-head"><h2 id="decTitle">¿Cómo te fue? <span class="count-badge">${decisions.length}</span></h2><a class="link" href="#/ajustes/modos" title="Modo de reprogramación">${icon(modeDetail(m).icon, 'sm')}${esc(modeDetail(m).title)}</a></div>
      <div class="panel"><ul class="list">${decisions.slice(0, 3).map((b) => decisionItem(b, f.today)).join('')}</ul>
      ${decisions.length > 3 ? `<button type="button" class="btn btn-quiet btn-block" data-act="all-decisions">Ver ${decisions.length - 3} más</button>` : ''}</div></section>` : '';
  const prios = f.priorities.slice(0, 4);
  const priorities = `<section class="section" aria-labelledby="prioTitle"><div class="section-head"><h2 id="prioTitle">Prioridades</h2>${prios.some((p) => p.type === 'topic') ? `<button type="button" class="btn btn-sm btn-quiet" data-act="plan-week">${icon('wand-sparkles', 'sm')}Planificar semana</button>` : `<a class="link" href="#/estudio/temas">Estudio${icon('chevron-right', 'sm')}</a>`}</div>
    ${prios.length ? `<div class="panel"><ol class="list">${prios.map((p, i) => `<li class="prio"><span class="prio-rank" aria-label="Prioridad ${i + 1}">${i + 1}</span>
        <div class="prio-title">${esc(p.title)}</div>${priorityButton(p)}
        <div class="prio-why">${courseTag(p.courseId, { short: true })}${p.reasons.slice(0, 3).map((r) => `<span class="chip ${r.tone === 'urgent' ? 'urgent' : r.tone === 'ok' ? 'ok' : ''}">${esc(r.text)}</span>`).join('')}</div></li>`).join('')}</ol></div>`
      : emptyState({ title: 'Sin prioridades aún', text: 'Agrega tus cursos, temas y exámenes; Brújula ordenará qué estudiar primero.', action: 'go', actionLabel: 'Ir a Estudio', actionIcon: 'book-open' }).replace('data-act="go"', 'data-act="go" data-to="estudio"')}
  </section>`;
  const line = `<section class="section" aria-labelledby="lineTitle"><div class="section-head"><h2 id="lineTitle">Recorrido de hoy</h2>${f.todays.length ? `<span class="chip">${f.done}/${f.todays.length} hechos</span>` : ''}</div>
    ${f.load.studyMin && !f.load.overloaded ? `<p class="small muted" style="margin-top:-6px">${esc(fmtDuration(f.load.studyMin))} de estudio hoy · tu límite es ${esc(fmtDuration(f.load.maxStudy))}</p>` : ''}
    ${f.load.overloaded ? `<div class="notice warn">${icon('triangle-alert')}<div>Hoy tienes <b>${esc(fmtDuration(f.load.studyMin))}</b> de estudio, más que tu límite de ${esc(fmtDuration(f.load.maxStudy))}. Considera mover algo.</div></div>` : ''}
    <div class="panel">${courseLine(f, s)}</div></section>`;
  return `<div class="today">${banners(s)}
    <div class="today-grid"><div class="stack-lg">${rumbo(f, s)}${decide}${line}</div>
    <div class="today-side">${priorities}${evalCards(f)}${habitsToday(s, f.today)}</div></div>
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
