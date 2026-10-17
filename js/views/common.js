// Brújula 4 · piezas de interfaz compartidas por las pantallas.

import { esc, cut } from '../core/util.js';
import { courseOf, statusLabel, KIND_LABEL, EVAL_TYPES } from '../core/model.js';
import { fmtRelDay, todayISO, fmtRange, toMin } from '../core/dates.js';
import { LEVEL_LABEL } from '../engine/srs.js';
import { isFixedKind } from '../engine/scheduler.js';
import { icon } from '../ui/icons.js';
import { store } from '../core/store.js';

export const KIND_ICON = { study: 'book-open', class: 'graduation-cap', exam: 'target', personal: 'sprout' };

export function courseTag(courseId, { short = false } = {}) {
  const c = courseOf(store.state, courseId);
  return `<span class="course-tag" style="--c:${esc(c.color)}"><span class="ellipsis">${esc(short ? cut(c.name, 22) : c.name)}</span></span>`;
}

export function kindChip(b) {
  if (b.kind === 'study') return '';
  return `<span class="chip k-${b.kind}">${icon(isFixedKind(b.kind) ? 'lock' : KIND_ICON[b.kind], 'sm')}${KIND_LABEL[b.kind]}</span>`;
}

export function statusChip(b) {
  if (!b.status || b.status === 'scheduled') return '';
  const ico = { mastered: 'check', review: 'rotate-ccw', missed: 'x', paused: 'circle-pause', progress: 'timer' }[b.status] || 'circle';
  return `<span class="chip s-${b.status}">${icon(ico, 'sm')}${esc(statusLabel(b))}</span>`;
}

export function levelChip(t) {
  return `<span class="level ${esc(t.level || 'new')}">${esc(LEVEL_LABEL[t.level] || 'Nuevo')}</span>`;
}

export function masteryMeter(m, { label = true } = {}) {
  const v = Math.max(0, Math.min(100, Number(m) || 0));
  const cls = v >= 85 ? 'm-high' : v >= 50 ? 'm-mid' : 'm-low';
  return `<span class="meter ${cls}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}" ${label ? `aria-label="Dominio ${v}%"` : ''}><span style="--v:${v}%"></span></span>`;
}

/** Fila de actividad para agendas (botón que abre el detalle). */
export function blockRow(b, { conflict = false, showDate = false } = {}) {
  const c = courseOf(store.state, b.courseId);
  const fixed = isFixedKind(b.kind);
  const done = b.status === 'mastered';
  return `<button type="button" class="ev ${fixed ? 'fixed' : ''} k-${b.kind} ${done ? 'done' : ''} ${conflict ? 'conflict' : ''}" style="--c:${esc(c.color)}" data-act="open-block" data-id="${esc(b.id)}">
    <span class="ev-time"><b>${esc(b.start)}</b><span>${esc(b.end)}</span></span>
    <span class="ev-body"><span class="ev-title">${esc(b.title)}</span>
      <span class="ev-meta">${showDate ? `<span>${esc(fmtRelDay(b.date, todayISO()))}</span>` : ''}<span class="course-tag" style="--c:${esc(c.color)}"><span class="ellipsis">${esc(cut(c.name, 26))}</span></span>${kindChip(b)}${statusChip(b)}${conflict ? `<span class="chip urgent">${icon('triangle-alert', 'sm')}Cruce</span>` : ''}</span></span>
    <span aria-hidden="true">${icon('chevron-right', 'sm')}</span>
  </button>`;
}

export function sectionHead(title, { count = null, link = null, linkLabel = 'Ver todo', act = null, actLabel = '', actIcon = 'plus', iconName = null } = {}) {
  return `<div class="section-head"><h2>${iconName ? icon(iconName) : ''}${esc(title)}${count != null ? ` <span class="count-badge">${count}</span>` : ''}</h2>
    ${link ? `<a class="link" href="${esc(link)}">${esc(linkLabel)}${icon('chevron-right', 'sm')}</a>` : ''}
    ${act ? `<button type="button" class="btn btn-sm btn-quiet" data-act="${esc(act)}">${icon(actIcon, 'sm')}${esc(actLabel)}</button>` : ''}</div>`;
}

export function emptyState({ title, text = '', action = '', actionLabel = '', actionIcon = 'plus', center = false }) {
  return `<div class="empty ${center ? 'center' : ''}"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action ? `<button type="button" class="btn btn-sm" data-act="${esc(action)}">${icon(actionIcon, 'sm')}${esc(actionLabel)}</button>` : ''}</div>`;
}

export function evalTypeLabel(e) { return EVAL_TYPES[e.type] || 'Evaluación'; }

export function timeRange(b) { return `<time>${esc(fmtRange(b.start, b.end))}</time>`; }
export function durationMin(b) { return toMin(b.end) - toMin(b.start); }
