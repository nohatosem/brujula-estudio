// Brújula 4 · Semana: franja de días + agenda (móvil) y cuadrícula horaria con arrastre (escritorio).

import { esc, cut, cap, plural, haptic } from '../core/util.js';
import { store } from '../core/store.js';
import { courseOf } from '../core/model.js';
import { weekDays, addDays, todayISO, fmtLong, fmtShort, WEEKDAYS_SHORT, MONTHS, parseISO, toMin, toHHMM, nowMin, fmtDuration, isValidDate, fmtRange } from '../core/dates.js';
import { conflicts, dayBlocks, freeWindows, violations, VIOLATION_TEXT, isFlexible, isFixedKind, studyMinutesOn } from '../engine/scheduler.js';
import { rulesFrom } from '../engine/rules.js';
import { icon } from '../ui/icons.js';
import { action } from '../ui/dom.js';
import { go } from '../ui/router.js';
import { toast } from '../ui/feedback.js';
import { blockRow, emptyState } from './common.js';
import { changeMode, mode, modeDetail, moveBlock, planWeekFlow } from '../features/actions.js';
import { undoToast } from '../features/undo-toast.js';
import { openBlockDetail } from '../ui/details.js';
import { undo, notify } from '../core/store.js';

let selected = null;
const HH = 52; // px por hora en la cuadrícula

function anchorDate(c) {
  const p = c.route.params[0];
  if (isValidDate(p)) return p;
  return selected || c.today;
}

export const title = () => 'Semana';
export function subtitle(c) {
  const days = weekDays(anchorDate(c));
  const a = parseISO(days[0]), b = parseISO(days[6]);
  return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} de ${MONTHS[b.getMonth()]}` : `${a.getDate()} ${MONTHS[a.getMonth()].slice(0, 3)} – ${b.getDate()} ${MONTHS[b.getMonth()].slice(0, 3)}`;
}

function modeCard(s) {
  const m = mode();
  const last = (s.undo || [])[0];
  const undoable = last && Date.now() - new Date(last.at).getTime() < 3 * 86400000;
  const btn = (k, ic, label) => `<button type="button" data-act="mode" data-mode="${k}" aria-pressed="${m === k}">${icon(ic)}${label}</button>`;
  return `<section class="panel mode-card" aria-label="Reprogramación">
    <div class="section-head"><h2 style="font-size:var(--fs-16)">Si algo no se cumple</h2>${undoable ? `<button type="button" class="btn btn-sm btn-quiet" data-act="undo-last" title="${esc(last.label)}">${icon('undo-2', 'sm')}Deshacer</button>` : ''}</div>
    <div class="seg" role="group" aria-label="Modo de reprogramación">${btn('confirm', 'hand', 'Preguntar')}${btn('mixed', 'shuffle', 'Mixto')}${btn('flex', 'zap', 'Automático')}</div>
    <p class="why">${icon('info', 'sm')}${esc(modeDetail(m).text)}</p>
  </section>`;
}

function dayStrip(days, sel, today, s) {
  return `<div class="day-strip" role="tablist" aria-label="Días de la semana">${days.map((d, i) => {
    const blocks = dayBlocks(s.blocks, d);
    const dots = Math.min(5, blocks.length);
    const exam = blocks.some((b) => b.kind === 'exam');
    return `<button type="button" class="day-btn ${d === today ? 'is-today' : ''}" role="tab" aria-selected="${d === sel}" aria-pressed="${d === sel}" data-act="pick-day" data-date="${d}" aria-label="${esc(fmtLong(d))}, ${plural(blocks.length, 'actividad', 'actividades')}">
      <span class="wd">${WEEKDAYS_SHORT[i]}</span><span class="dn">${parseISO(d).getDate()}</span>
      <span class="load" aria-hidden="true">${Array.from({ length: dots }, (_, k) => `<i class="on ${exam && k === 0 ? 'exam' : ''}"></i>`).join('')}</span></button>`;
  }).join('')}</div>`;
}

function agenda(date, s, rules, conflictIds) {
  const today = todayISO();
  const blocks = dayBlocks(s.blocks, date);
  const ctx = { blocks: s.blocks, rules, now: new Date() };
  const study = studyMinutesOn(s.blocks, date);
  const head = `<div class="day-head"><h3>${esc(cap(fmtLong(date)))}</h3></div>
    ${study ? `<p class="small muted">${esc(fmtDuration(study))} de estudio${study > rules.maxStudy ? ` · <b style="color:var(--alert)">supera tu límite de ${esc(fmtDuration(rules.maxStudy))}</b>` : ''}</p>` : ''}`;
  if (!blocks.length) return `<section class="day-agenda stack">${head}${emptyState({ title: date < today ? 'No hubo actividades' : 'Día libre', text: date < today ? '' : 'Toca «Añadir» o escribe en el + lo que quieras planificar.', action: date >= today ? 'quick-add' : '', actionLabel: 'Planificar' }).replace('data-act="quick-add"', `data-act="quick-add" data-date="${esc(date)}"`)}</section>`;
  const free = date >= today ? freeWindows(ctx, date, 45) : [];
  const rows = [];
  let fi = 0;
  for (const b of blocks) {
    while (fi < free.length && free[fi].end <= toMin(b.start)) { rows.push(gapRow(date, free[fi])); fi++; }
    rows.push(blockRow(b, { conflict: conflictIds.has(b.id) }));
  }
  while (fi < free.length) { rows.push(gapRow(date, free[fi])); fi++; }
  return `<section class="day-agenda stack">${head}<div class="agenda">${rows.join('')}</div></section>`;
}

function gapRow(date, w) {
  return `<div class="agenda-gap">${esc(fmtDuration(w.end - w.start))} libres desde ${toHHMM(w.start)}<button type="button" data-act="quick-add" data-date="${esc(date)}" data-start="${toHHMM(Math.ceil(w.start / 5) * 5)}">${icon('plus', 'sm')}Añadir</button></div>`;
}

/** Distribuye actividades que se solapan en carriles (lado a lado). */
function lanes(blocks) {
  const out = new Map();
  const sorted = [...blocks].sort((a, b) => toMin(a.start) - toMin(b.start) || toMin(b.end) - toMin(a.end));
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const laneEnds = [];
    for (const b of cluster) {
      let lane = laneEnds.findIndex((e) => e <= toMin(b.start));
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = toMin(b.end);
      out.set(b.id, { lane, of: 0 });
    }
    for (const b of cluster) out.get(b.id).of = laneEnds.length;
    cluster = []; clusterEnd = -1;
  };
  for (const b of sorted) {
    if (cluster.length && toMin(b.start) >= clusterEnd) flush();
    cluster.push(b); clusterEnd = Math.max(clusterEnd, toMin(b.end));
  }
  if (cluster.length) flush();
  return out;
}

function timeGrid(days, s, rules, conflictIds, today) {
  const all = days.flatMap((d) => dayBlocks(s.blocks, d));
  const first = Math.min(rules.wake, ...all.map((b) => toMin(b.start)));
  const last = Math.max(rules.sleep, ...all.map((b) => toMin(b.end)));
  const h0 = Math.max(0, Math.floor(first / 60)), h1 = Math.min(24, Math.ceil(last / 60));
  const px = (m) => ((m - h0 * 60) / 60) * HH;
  const hours = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);
  const nowM = nowMin();
  const cols = days.map((d) => {
    const blocks = dayBlocks(s.blocks, d);
    const L = lanes(blocks);
    const rest = [[h0 * 60, rules.wake], [rules.sleep, h1 * 60], rules.lunch].filter(([a, b]) => b > a).map(([a, b]) => `<div class="tgrid-rest" style="top:${px(a)}px;height:${px(b) - px(a)}px"></div>`).join('');
    const evs = blocks.map((b) => {
      const c = courseOf(s, b.courseId);
      const { lane, of } = L.get(b.id);
      const top = px(toMin(b.start)), height = Math.max(22, px(toMin(b.end)) - top - 2);
      const w = 100 / of;
      return `<button type="button" class="tg-ev ${isFixedKind(b.kind) ? 'fixed' : ''} ${b.status === 'mastered' ? 'done' : ''} ${conflictIds.has(b.id) ? 'conflict' : ''}" style="--c:${esc(c.color)};top:${top}px;height:${height}px;left:calc(${lane * w}% + 3px);right:auto;width:calc(${w}% - 6px)" data-ev="${esc(b.id)}" ${isFlexible(b) ? 'data-drag="1"' : ''} title="${esc(b.title)} · ${esc(fmtRange(b.start, b.end))}">
        <b>${isFixedKind(b.kind) ? icon('lock', 'sm') : ''}${esc(cut(b.title, 60))}</b><span>${esc(b.start)}–${esc(b.end)}</span></button>`;
    }).join('');
    const nowLine = d === today && nowM >= h0 * 60 && nowM <= h1 * 60 ? `<div class="tg-now" style="top:${px(nowM)}px"></div>` : '';
    return `<div class="tgrid-col ${d === today ? 'is-today' : ''}" data-col="${d}" style="height:${(h1 - h0) * HH}px">${rest}${evs}${nowLine}</div>`;
  }).join('');
  return `<div class="tgrid-wrap" data-h0="${h0}">
    <div class="tgrid-headrow"><span></span>${days.map((d, i) => `<button type="button" class="${d === today ? 'is-today' : ''}" data-act="pick-day-agenda" data-date="${d}"><span class="small">${WEEKDAYS_SHORT[i]}</span><b>${parseISO(d).getDate()}</b></button>`).join('')}</div>
    <div class="tgrid-scroll" id="tgScroll"><div class="tgrid" style="--hh:${HH}px">
      <div class="tgrid-hours" style="height:${(h1 - h0) * HH}px">${hours.map((h) => `<span style="top:${(h - h0) * HH}px">${String(h).padStart(2, '0')}:00</span>`).join('')}</div>${cols}</div></div>
  </div>`;
}

export function render(c) {
  const s = c.state;
  const rules = rulesFrom(s.preferences);
  const anchor = anchorDate(c);
  const days = weekDays(anchor);
  const sel = days.includes(selected) ? selected : days.includes(c.today) ? c.today : days[0];
  selected = sel;
  const cl = conflicts(s.blocks).filter((x) => days.includes(x.a.date));
  const conflictIds = new Set(cl.flatMap((x) => [x.a.id, x.b.id]));
  const prev = addDays(days[0], -7), next = addDays(days[0], 7);
  return `<div class="week has-grid">
    <div class="week-bar"><h2 class="sr-only">Semana del ${esc(fmtShort(days[0]))}</h2>
      <a class="btn btn-sm" href="#/semana/${prev}" aria-label="Semana anterior">${icon('chevron-left')}</a>
      <a class="btn btn-sm" href="#/semana/${c.today}">Hoy</a>
      <a class="btn btn-sm" href="#/semana/${next}" aria-label="Semana siguiente">${icon('chevron-right')}</a>
      <span class="grow"></span>
      ${cl.length ? `<span class="chip urgent">${icon('triangle-alert', 'sm')}${plural(cl.length, 'cruce', 'cruces')}</span>` : ''}
      <button type="button" class="btn btn-sm" data-act="plan-week">${icon('wand-sparkles', 'sm')}Planificar semana</button>
      <button type="button" class="btn btn-sm btn-primary" data-act="quick-add" data-date="${esc(sel)}">${icon('plus', 'sm')}Añadir</button>
    </div>
    ${modeCard(s)}
    ${dayStrip(days, sel, c.today, s)}
    ${agenda(sel, s, rules, conflictIds)}
    ${timeGrid(days, s, rules, conflictIds, c.today)}
  </div>`;
}

export function mount(root) {
  // Deslizar a izquierda/derecha sobre la agenda cambia de día (móvil).
  const agendaEl = root.querySelector('.day-agenda');
  if (agendaEl) {
    let sx = null, sy = null;
    agendaEl.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
    agendaEl.addEventListener('touchend', (e) => {
      if (sx == null) return;
      const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy; sx = null;
      if (Math.abs(dx) < 70 || Math.abs(dy) > 45) return;
      const next = addDays(selected, dx < 0 ? 1 : -1);
      const days = weekDays(selected);
      selected = next;
      if (!days.includes(next)) go('semana/' + next); else notify('ui');
    }, { passive: true });
  }
  const scroller = root.querySelector('#tgScroll');
  const wrap = root.querySelector('.tgrid-wrap');
  if (!scroller || !wrap) return;
  const h0 = Number(wrap.dataset.h0);
  // Desplaza para mostrar la hora actual o el inicio del día.
  const target = Math.max(0, ((Math.max(nowMin() - 90, rulesFrom(store.state.preferences).wake) / 60) - h0) * HH);
  scroller.scrollTop = target;
  let drag = null;
  scroller.addEventListener('pointerdown', (e) => {
    const ev = e.target.closest('.tg-ev');
    if (!ev || e.button !== 0) return;
    const b = store.state.blocks.find((x) => x.id === ev.dataset.ev);
    drag = { el: ev, b, x: e.clientX, y: e.clientY, moved: false, top0: ev.offsetTop, col0: ev.parentElement, can: !!ev.dataset.drag, pointer: e.pointerId };
  });
  scroller.addEventListener('pointermove', (e) => {
    if (!drag || !drag.can) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    if (!drag.moved) { drag.moved = true; drag.el.setPointerCapture(drag.pointer); drag.el.classList.add('dragging'); }
    const step = HH / 4; // 15 min
    const top = Math.max(0, Math.round((drag.top0 + dy) / step) * step);
    drag.el.style.top = top + 'px';
    const col = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.classList?.contains('tgrid-col'));
    if (col && col !== drag.el.parentElement) col.appendChild(drag.el);
    const date = drag.el.parentElement.dataset.col;
    const start = h0 * 60 + Math.round((top / HH) * 60 / 15) * 15;
    const dur = toMin(drag.b.end) - toMin(drag.b.start);
    drag.target = { date, start: toHHMM(start), end: toHHMM(start + dur) };
    const v = violations({ blocks: store.state.blocks, rules: rulesFrom(store.state.preferences), now: new Date(), excludeIds: new Set([drag.b.id]) }, { date, start, end: start + dur, kind: drag.b.kind });
    drag.v = v.filter((x) => x !== 'limit' || drag.b.kind === 'study');
    drag.el.classList.toggle('invalid', drag.v.length > 0);
    drag.el.querySelector('span').textContent = `${drag.target.start}–${drag.target.end}`;
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) { openBlockDetail(d.b.id); return; }
    d.el.classList.remove('dragging');
    if (!d.target || (d.target.date === d.b.date && d.target.start === d.b.start)) { notify('drag'); return; }
    if (d.v?.length) { toast(`No se puede: ${VIOLATION_TEXT[d.v[0]]}.`, { tone: 'warn' }); notify('drag'); return; }
    haptic();
    const entry = moveBlock(d.b.id, d.target, { reason: 'Movida arrastrando en la semana', type: 'move' });
    undoToast(`Movida a ${d.target.start}`, entry);
  };
  scroller.addEventListener('pointerup', end);
  scroller.addEventListener('pointercancel', () => { if (drag) { drag = null; notify('drag'); } });
  // Clic en hueco vacío → alta rápida a esa hora.
  scroller.addEventListener('click', (e) => {
    const col = e.target.closest('.tgrid-col');
    if (!col || e.target.closest('.tg-ev')) return;
    const rect = col.getBoundingClientRect();
    const m = h0 * 60 + Math.floor(((e.clientY - rect.top) / HH) * 4) * 15;
    import('../ui/forms.js').then(({ openQuickAdd }) => openQuickAdd({ date: col.dataset.col, start: toHHMM(Math.max(0, Math.min(23 * 60 + 45, m))) }));
  });
}

action('pick-day', (el) => { selected = el.dataset.date; notify('ui'); });
action('pick-day-agenda', (el) => { selected = el.dataset.date; go('semana/' + el.dataset.date); });
action('mode', (el) => changeMode(el.dataset.mode));
action('plan-week', () => planWeekFlow());
action('undo-last', () => { const r = undo(); toast(r.ok ? `Deshecho: ${r.entry.label}` : r.reason, { tone: r.ok ? 'ok' : 'warn' }); });
