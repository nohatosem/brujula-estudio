// Brújula 4 · planificador determinista: cruces, huecos válidos, validación de
// propuestas (IA, importación, automatización) y plan de preparación de exámenes.

import { toMin, toHHMM, addDays, todayISO, nowMin, isValidDate, isValidTime, diffDays, fmtDayShort, fmtRange, blockMinutes } from '../core/dates.js';
import { isUsableBlock, newBlock, KINDS, PRIORITIES, courseOf } from '../core/model.js';
import { gid, norm, cut } from '../core/util.js';
import { rulesFrom } from './rules.js';

export const isFixedKind = (k) => k === 'class' || k === 'exam';
/** Protegido: clases, exámenes y sesiones dominadas no se mueven solas. */
export const isLocked = (b) => !b || b.status === 'mastered' || isFixedKind(b.kind);
export const isFlexible = (b) => !!b && !isLocked(b) && (b.kind === 'study' || b.kind === 'personal');

export const overlap = (aS, aE, bS, bE, gap = 0) => aS < bE + gap && aE > bS - gap;
const byStart = (a, b) => (a.date + a.start).localeCompare(b.date + b.start);

export function dayBlocks(blocks, date) {
  return blocks.filter((b) => isUsableBlock(b) && b.date === date).sort(byStart);
}

/** Pares de actividades que se cruzan el mismo día. */
export function conflicts(blocks, { from = null, limit = 60 } = {}) {
  const out = [];
  const byDate = new Map();
  for (const b of blocks) {
    if (!isUsableBlock(b) || (from && b.date < from)) continue;
    if (!byDate.has(b.date)) byDate.set(b.date, []);
    byDate.get(b.date).push(b);
  }
  for (const [, list] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort(byStart);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (toMin(list[j].start) >= toMin(list[i].end)) break;
        out.push({ a: list[i], b: list[j] });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

export const studyMinutesOn = (blocks, date, excludeIds) =>
  blocks.reduce((n, b) => n + (isUsableBlock(b) && b.date === date && b.kind === 'study' && !(excludeIds && excludeIds.has(b.id)) ? blockMinutes(b) : 0), 0);

export const VIOLATION_TEXT = {
  order: 'la hora final debe ser posterior a la inicial',
  sleep: 'cae en tu horario de sueño',
  lunch: 'choca con tu almuerzo',
  past: 'está en el pasado',
  overlap: 'se cruza con otra actividad',
  gap: 'no deja tu descanso entre actividades',
  limit: 'supera tu límite diario de estudio',
};

/**
 * Comprueba un hueco candidato.
 * ctx = {blocks, rules, now, excludeIds?: Set}; cand = {date, start, end (min), kind}
 */
export function violations(ctx, cand) {
  const v = [];
  const r = ctx.rules;
  if (!(cand.end > cand.start)) v.push('order');
  if (cand.start < r.wake || cand.end > r.sleep) v.push('sleep');
  if (overlap(cand.start, cand.end, r.lunch[0], r.lunch[1])) v.push('lunch');
  const now = ctx.now || new Date();
  const today = todayISO(now);
  if (cand.date < today || (cand.date === today && cand.start < nowMin(now))) v.push('past');
  let hit = false, near = false;
  for (const o of ctx.blocks) {
    if (!isUsableBlock(o) || o.date !== cand.date || (ctx.excludeIds && ctx.excludeIds.has(o.id))) continue;
    const os = toMin(o.start), oe = toMin(o.end);
    if (overlap(cand.start, cand.end, os, oe)) hit = true;
    else if (r.gap > 0 && overlap(cand.start, cand.end, os, oe, r.gap)) near = true;
  }
  if (hit) v.push('overlap');
  else if (near) v.push('gap');
  if (cand.kind === 'study' && studyMinutesOn(ctx.blocks, cand.date, ctx.excludeIds) + (cand.end - cand.start) > r.maxStudy) v.push('limit');
  return v;
}

/**
 * Busca el primer día con hueco válido y, dentro de él, la hora más cercana a `preferStart`.
 * opts = {duration, kind, fromDate, days, preferStart, avoid:{date,start}, skipDates:Set, lastDate, minLead}
 */
export function findSlot(ctx, opts) {
  const all = suggestSlots(ctx, { ...opts, perDay: 1, limit: 1 });
  return all[0] || null;
}

/** Varias alternativas (la mejor de cada día, en orden). */
export function suggestSlots(ctx, opts) {
  const r = ctx.rules;
  const duration = Math.round(opts.duration);
  if (!Number.isFinite(duration) || duration < 5 || duration > 600) return [];
  const now = ctx.now || new Date();
  const today = todayISO(now);
  const from = opts.fromDate && opts.fromDate > today ? opts.fromDate : today;
  const days = opts.days ?? 8;
  const limit = opts.limit ?? 4;
  const perDay = opts.perDay ?? 1;
  const lead = opts.minLead ?? 15;
  const out = [];
  for (let d = 0; d < days && out.length < limit; d++) {
    const date = addDays(from, d);
    if (opts.lastDate && date > opts.lastDate) break;
    if (opts.skipDates && opts.skipDates.has(date)) continue;
    const found = [];
    for (let start = Math.ceil(r.wake / 15) * 15; start + duration <= r.sleep; start += 15) {
      if (date === today && start < nowMin(now) + lead) continue;
      if (opts.avoid && opts.avoid.date === date && opts.avoid.start === start) continue;
      if (violations(ctx, { date, start, end: start + duration, kind: opts.kind }).length) continue;
      const score = opts.preferStart == null ? start : Math.abs(start - opts.preferStart) + start / 10000;
      found.push({ date, startMin: start, score });
    }
    found.sort((a, b) => a.score - b.score);
    // Varias opciones el mismo día: separadas al menos una hora.
    const picked = [];
    for (const f of found) {
      if (picked.length >= perDay) break;
      if (picked.every((p) => Math.abs(p.startMin - f.startMin) >= 60)) picked.push(f);
    }
    for (const p of picked) out.push({ date, start: toHHMM(p.startMin), end: toHHMM(p.startMin + duration) });
  }
  return out.slice(0, limit);
}

/** Intervalos libres de un día (para mostrar huecos y sugerir qué hacer). */
export function freeWindows(ctx, date, minMinutes = 20) {
  const r = ctx.rules;
  const busy = dayBlocks(ctx.blocks, date).map((b) => [toMin(b.start) - r.gap, toMin(b.end) + r.gap]);
  busy.push([r.lunch[0], r.lunch[1]]);
  const now = ctx.now || new Date();
  const startOfDay = date === todayISO(now) ? Math.max(r.wake, Math.ceil(nowMin(now) / 5) * 5) : r.wake;
  busy.sort((a, b) => a[0] - b[0]);
  const out = [];
  let cursor = startOfDay;
  for (const [s, e] of busy) {
    if (s > cursor && s - cursor >= minMinutes) out.push({ start: cursor, end: Math.min(s, r.sleep) });
    cursor = Math.max(cursor, e);
    if (cursor >= r.sleep) break;
  }
  if (r.sleep - cursor >= minMinutes) out.push({ start: cursor, end: r.sleep });
  return out.filter((w) => w.end - w.start >= minMinutes);
}

// ——— Validación unificada de cambios ———

const CHANGE_KEYS = new Set(['action', 'id', 'course', 'courseId', 'date', 'start', 'end', 'title', 'goal', 'kind', 'priority', 'difficulty', 'reason']);

export function resolveCourse(state, ch) {
  if (ch.courseId) return state.courses.find((c) => c.id === ch.courseId) || null;
  if (ch.course == null) return null;
  const key = norm(ch.course);
  return state.courses.find((c) => norm(c.name) === key) || null;
}

export function describeChange(state, op) {
  const b = op.after || op.before;
  const name = `«${cut(b.title, 60)}»`;
  const when = (x) => `${fmtDayShort(x.date)} ${fmtRange(x.start, x.end)}`;
  if (op.action === 'delete') return { verb: 'Quitar', text: `${name} · ${when(op.before)}` };
  if (op.action === 'add') return { verb: 'Añadir', text: `${name} · ${when(op.after)} · ${courseOf(state, op.after.courseId).name}` };
  const moved = op.before.date !== op.after.date || op.before.start !== op.after.start || op.before.end !== op.after.end;
  return moved
    ? { verb: 'Mover', text: `${name} · ${when(op.before)} → ${when(op.after)}` }
    : { verb: 'Editar', text: `${name} · ${when(op.after)}` };
}

/**
 * Valida una lista de cambios sobre una copia del horario.
 * source: 'ai' (estricto: sin borrar, sin tocar protegidos, sin romper reglas),
 *         'import' (lo decide la persona: las reglas son avisos), 'local'.
 * Devuelve {draft, ops, rejected:[{change, reasons}], warnings:[texto]}.
 */
export function validateChanges(state, changes, { source = 'ai', rules = rulesFrom(state.preferences), now = new Date(), maxChanges } = {}) {
  if (!Array.isArray(changes)) throw Error('Formato inválido: falta la lista de cambios.');
  const strict = source === 'ai';
  const limit = maxChanges ?? (strict ? 8 : 60);
  const draft = state.blocks.map((b) => ({ ...b }));
  const ops = [], rejected = [], warnings = [];
  const fallbackCourse = state.courses.find((c) => !c.archived) || state.courses[0];

  changes.forEach((ch, index) => {
    const reasons = [];
    const reject = () => rejected.push({ change: ch, index, reasons });
    if (index >= limit) { reasons.push(`Máximo ${limit} cambios por propuesta`); return reject(); }
    if (!ch || typeof ch !== 'object' || Array.isArray(ch)) { reasons.push('Formato no válido'); return reject(); }
    const extra = Object.keys(ch).filter((k) => !CHANGE_KEYS.has(k));
    if (extra.length) reasons.push('Campos no permitidos: ' + extra.join(', '));
    const action = ch.action;
    if (!['add', 'update', 'delete'].includes(action)) { reasons.push('Operación desconocida'); return reject(); }

    if (action === 'delete') {
      const idx = draft.findIndex((b) => b.id === ch.id);
      if (strict) reasons.push('La IA no puede borrar actividades');
      if (idx < 0) reasons.push('No existe la actividad indicada');
      if (reasons.length) return reject();
      const before = draft[idx];
      draft.splice(idx, 1);
      if (isLocked(before)) warnings.push(`Se quitará una actividad protegida: «${before.title}»`);
      return ops.push({ action, id: before.id, before: { ...before }, after: null });
    }

    const old = action === 'update' ? draft.find((b) => b.id === ch.id) : null;
    if (action === 'update' && !old) { reasons.push('No existe la actividad indicada'); return reject(); }
    if (action === 'add' && ch.id) reasons.push('Una actividad nueva no debe traer id');
    if (strict && old && isLocked(old)) reasons.push('Clases, exámenes y sesiones dominadas están protegidas');

    const next = old ? { ...old } : newBlock({ id: gid(), courseId: fallbackCourse?.id || 'general', origin: source });
    for (const k of ['date', 'start', 'end', 'title', 'goal', 'kind', 'priority', 'difficulty']) if (Object.prototype.hasOwnProperty.call(ch, k)) next[k] = ch[k];
    if ('course' in ch || 'courseId' in ch) {
      const c = resolveCourse(state, ch);
      if (!c) reasons.push(`No existe el curso «${ch.course ?? ch.courseId}»`); else next.courseId = c.id;
    } else if (action === 'add' && strict) reasons.push('Falta indicar el curso');
    next.difficulty = Number(next.difficulty);
    if (typeof next.title === 'string') next.title = next.title.trim();
    if (typeof next.goal !== 'string') next.goal = next.goal == null ? '' : String(next.goal);

    if (!isValidDate(next.date)) reasons.push('Fecha no válida');
    if (!isValidTime(next.start) || !isValidTime(next.end)) reasons.push('Hora no válida');
    else if (toMin(next.end) <= toMin(next.start)) reasons.push('La hora final debe ser posterior a la inicial');
    if (!next.title || typeof next.title !== 'string' || next.title.length > 130) reasons.push('Falta el título o es demasiado largo');
    if (next.goal.length > 1200) reasons.push('Objetivo demasiado largo');
    if (!KINDS.includes(next.kind)) reasons.push('Tipo no válido');
    if (!PRIORITIES.includes(next.priority)) reasons.push('Prioridad no válida');
    if (![1, 2, 3, 4, 5].includes(next.difficulty)) reasons.push('Dificultad no válida (1 a 5)');
    if (strict) {
      if (action === 'add' && !['study', 'personal'].includes(next.kind)) reasons.push('La IA solo puede crear estudio o actividades personales');
      if (action === 'update' && 'kind' in ch && ch.kind !== old.kind) reasons.push('La IA no puede cambiar el tipo de actividad');
    }
    if (reasons.length) return reject();

    const dur = toMin(next.end) - toMin(next.start);
    if (strict && (dur < 10 || dur > 300)) reasons.push('Duración fuera de rango (10 a 300 min)');
    const ctx = { blocks: draft, rules, now, excludeIds: new Set([next.id]) };
    const v = violations(ctx, { date: next.date, start: toMin(next.start), end: toMin(next.end), kind: next.kind });
    const dup = draft.some((b) => b.id !== next.id && b.date === next.date && b.start === next.start && norm(b.title) === norm(next.title));
    if (strict) {
      for (const code of v) reasons.push(capFirst(VIOLATION_TEXT[code]));
      if (dup) reasons.push('Ya existe una actividad igual a esa hora');
      if (reasons.length) return reject();
    } else {
      if (v.includes('order')) { reasons.push('La hora final debe ser posterior a la inicial'); return reject(); }
      for (const code of v) warnings.push(`«${cut(next.title, 40)}» ${VIOLATION_TEXT[code]}`);
      if (dup) warnings.push(`«${cut(next.title, 40)}» parece duplicada`);
    }

    if (old) draft[draft.findIndex((b) => b.id === old.id)] = next; else draft.push(next);
    ops.push({ action, id: next.id, before: old ? { ...old } : null, after: { ...next } });
  });

  for (const op of ops) op.label = describeChange(state, op);
  return { draft, ops, rejected, warnings };
}

const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Comprueba que una propuesta aprobada sigue siendo válida ahora (el horario pudo cambiar). */
export function stillApplicable(state, ops) {
  for (const op of ops) {
    if (op.action === 'add') continue;
    const cur = state.blocks.find((b) => b.id === op.id);
    if (!cur) return false;
    const b = op.before;
    if (cur.date !== b.date || cur.start !== b.start || cur.end !== b.end || cur.status !== b.status || cur.title !== b.title) return false;
  }
  return true;
}

// ——— Planificar la semana (determinista, sin IA) ———

/**
 * Propone sesiones para los próximos días a partir de las prioridades:
 * temas débiles con evaluación cercana (2 sesiones), repasos vencidos o del día (1 repaso),
 * y el resto de temas pendientes (1 sesión). Reparte por los días con menos carga.
 * ranked: salida de rankPriorities (solo se usan los de tipo 'topic').
 */
export function planWeek(state, ranked, { rules = rulesFrom(state.preferences), now = new Date(), days = 7, maxSessions = 10 } = {}) {
  const today = todayISO(now);
  const last = addDays(today, days - 1);
  const draft = state.blocks.map((b) => ({ ...b }));
  const ctx = { blocks: draft, rules, now };
  const out = [], skipped = [];
  const planned = (topicId) => draft.filter((b) => b.topicId === topicId && b.date >= today && b.date <= last && b.status === 'scheduled').length;
  const load = (date) => studyMinutesOn(draft, date);
  const window = Array.from({ length: days }, (_, i) => addDays(today, i));
  const topics = ranked.filter((p) => p.type === 'topic').map((p) => ({ p, t: state.topics.find((x) => x.id === p.id) })).filter((x) => x.t);
  for (const { p, t } of topics) {
    if (out.length >= maxSessions) break;
    const mastery = Number(t.mastery) || 0;
    const due = t.srs?.due && t.srs.due <= last ? t.srs.due : null;
    const ev = p.evaluationId ? (state.evaluations || []).find((e) => e.id === p.evaluationId) : null;
    const before = ev && ev.date > today ? ev.date : null; // todo lo del examen, antes del examen
    if (mastery >= 85 && !due) continue; // dominado y sin repaso pendiente: no gastar tiempo
    let need = due ? 1 : before && mastery < 50 ? 2 : 1;
    need = Math.max(0, need - planned(t.id));
    for (let k = 0; k < need && out.length < maxSessions; k++) {
      const isReview = !!due && k === 0;
      const dur = isReview ? rules.reviewMin : rules.sessionMin;
      let candidates = window.filter((d) => (!before || d < before));
      if (isReview) candidates = candidates.filter((d) => d >= (due > today ? due : today));
      // Repasos y temas con examen: cuanto antes. El resto: el día con menos estudio.
      if (isReview || before) candidates.sort((a, b) => a.localeCompare(b));
      else candidates.sort((a, b) => load(a) - load(b) || a.localeCompare(b));
      // Segunda pasada: con un día de por medio (efecto de espaciado); si el examen está
      // demasiado cerca, se acepta el día siguiente.
      let tiers = [candidates];
      if (k > 0) {
        const first = out.filter((b) => b.topicId === t.id).map((b) => b.date).sort()[0];
        if (first) tiers = [candidates.filter((d) => d > addDays(first, 1)), ...(before ? [candidates.filter((d) => d === addDays(first, 1))] : [])];
      }
      let slot = null;
      for (const tier of tiers) {
        for (const d of tier) { slot = findSlot(ctx, { duration: dur, kind: 'study', fromDate: d, days: 1, preferStart: 16 * 60 }); if (slot) break; }
        if (slot) break;
      }
      if (!slot) { skipped.push(t.title); break; }
      const b = newBlock({
        ...slot, courseId: t.courseId, title: ((isReview ? 'Repaso: ' : k ? 'Práctica: ' : 'Estudiar: ') + t.title).slice(0, 130), kind: 'study',
        goal: isReview ? 'Recordar sin mirar y resolver un ejercicio.' : 'Entender la idea central y practicar un ejemplo.',
        difficulty: Number(t.difficulty) || 3, priority: before ? 'high' : 'normal', topicId: t.id, origin: 'week-plan', lesson: t.lesson ? { ...t.lesson } : {},
        ...(ev ? { evaluationId: ev.id } : {}),
      });
      b.why = p.reasons.slice(0, 2).map((r) => r.text).join(' · ');
      draft.push(b);
      out.push(b);
    }
  }
  out.sort(byStart);
  return { blocks: out, skipped };
}

// ——— Plan de preparación para una evaluación ———

/**
 * Propone sesiones distribuidas antes de la evaluación, priorizando temas débiles.
 * Devuelve {blocks: [nuevos bloques], unscheduled: [títulos], daysLeft}.
 */
export function planExamPrep(state, evaluation, { rules = rulesFrom(state.preferences), now = new Date(), sessionMin } = {}) {
  const today = todayISO(now);
  const daysLeft = diffDays(today, evaluation.date);
  const result = { blocks: [], unscheduled: [], daysLeft };
  if (daysLeft < 1) return result;
  const dur = sessionMin || rules.sessionMin;
  const course = courseOf(state, evaluation.courseId);
  let topics = (evaluation.topicIds || []).map((id) => state.topics.find((t) => t.id === id)).filter(Boolean);
  if (!topics.length) topics = state.topics.filter((t) => t.courseId === evaluation.courseId && t.level !== 'mastered');
  const lastDate = addDays(evaluation.date, -1);
  const draft = state.blocks.map((b) => ({ ...b }));
  const ctx = { blocks: draft, rules, now };
  const already = (topicId) => draft.filter((b) => b.topicId === topicId && b.date >= today && b.date <= lastDate && b.status === 'scheduled').length;

  const plan = [];
  const ordered = [...topics].sort((a, b) => (a.mastery || 0) - (b.mastery || 0));
  for (const t of ordered) {
    const m = Number(t.mastery) || 0;
    let need = m < 40 ? 2 : m < 75 ? 1 : 0;
    if (daysLeft <= 2) need = Math.min(need, 1);
    need = Math.max(0, need - already(t.id));
    for (let k = 0; k < need; k++) plan.push({ topic: t, pass: k, title: (k === 0 ? 'Preparar: ' : 'Repaso: ') + t.title });
  }
  if (!topics.length) {
    const n = Math.min(4, Math.max(1, Math.ceil(daysLeft / 2)));
    for (let k = 0; k < n; k++) plan.push({ topic: null, pass: k, title: `Preparar ${evaluation.title}` });
  }
  const span = Math.max(1, diffDays(today, lastDate) + 1);
  // Primera pasada (temas más débiles primero) en la primera mitad; segunda pasada en la segunda.
  const first = plan.filter((p) => p.pass === 0), second = plan.filter((p) => p.pass > 0);
  const ordered2 = [...first.map((p, j) => ({ ...p, ratio: (j / Math.max(1, first.length)) * 0.5 })),
    ...second.map((p, k) => ({ ...p, ratio: 0.5 + (k / Math.max(1, second.length)) * 0.5 }))];
  ordered2.forEach((p) => {
    const target = addDays(today, Math.min(span - 1, Math.floor(p.ratio * span)));
    const slot = findSlot(ctx, { duration: dur, kind: 'study', fromDate: target, lastDate, days: span, preferStart: 16 * 60 })
      || findSlot(ctx, { duration: dur, kind: 'study', fromDate: today, lastDate, days: span, preferStart: 16 * 60 });
    if (!slot) { result.unscheduled.push(p.title); return; }
    const b = newBlock({
      ...slot, courseId: evaluation.courseId, title: p.title.slice(0, 130), kind: 'study',
      goal: p.topic ? `Dejar listo «${p.topic.title}» para ${evaluation.title}.` : `Avanzar la preparación de ${evaluation.title}.`,
      difficulty: p.topic?.difficulty || 3, priority: daysLeft <= 3 ? 'critical' : 'high',
      topicId: p.topic?.id, evaluationId: evaluation.id, origin: 'exam-plan', lesson: p.topic?.lesson ? { ...p.topic.lesson } : {},
    });
    draft.push(b);
    result.blocks.push(b);
  });
  // Simulacro final (si hay al menos dos días).
  if (daysLeft >= 2 && !draft.some((b) => b.evaluationId === evaluation.id && /simulacro/i.test(b.title) && b.date >= today)) {
    const mockDur = Math.min(90, Math.max(45, dur + 15));
    const slot = findSlot(ctx, { duration: mockDur, kind: 'study', fromDate: addDays(evaluation.date, -2) > today ? addDays(evaluation.date, -2) : today, lastDate, days: 3, preferStart: 10 * 60 });
    if (slot) {
      const b = newBlock({ ...slot, courseId: evaluation.courseId, title: `Simulacro: ${evaluation.title}`.slice(0, 130), kind: 'study', goal: 'Practicar sin apuntes y con tiempo; anotar cada error.', difficulty: 4, priority: 'critical', evaluationId: evaluation.id, origin: 'exam-plan' });
      draft.push(b);
      result.blocks.push(b);
    } else result.unscheduled.push(`Simulacro: ${evaluation.title}`);
  }
  result.blocks.sort(byStart);
  result.course = course.name;
  return result;
}
