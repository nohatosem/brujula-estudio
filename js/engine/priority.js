// Brújula 4 · prioridad dinámica: qué hacer ahora, qué necesita tu decisión y qué es prioritario.
// Puntuaciones deterministas y explicables (cada elemento lleva sus razones).

import { todayISO, nowMin, toMin, diffDays, blockTime, blockMinutes, addDays, fmtRelDay } from '../core/dates.js';
import { isUsableBlock, courseOf, EVAL_TYPES, prefs } from '../core/model.js';
import { isFixedKind, freeWindows, studyMinutesOn } from './scheduler.js';
import { rulesFrom } from './rules.js';
import { overdueDays, nextEvaluationFor } from './srs.js';

const byStart = (a, b) => (a.date + a.start).localeCompare(b.date + b.start);
const PRIORITY_BOOST = { normal: 0, high: 12, critical: 24 };

export function countdownText(days) {
  if (days <= 0) return 'hoy';
  if (days === 1) return 'mañana';
  return `en ${days} días`;
}

/** Bloque terminado que espera tu respuesta (nunca se marca solo como «no hecho»). */
export function needsDecision(b, now = new Date()) {
  if (!isUsableBlock(b) || isFixedKind(b.kind) || b.decisionDismissed) return false;
  if (!['scheduled', 'progress'].includes(b.status)) return false;
  return blockTime(b, 'end') <= now.getTime();
}

export function prepPercent(state, ev) {
  const topics = (ev.topicIds || []).map((id) => state.topics.find((t) => t.id === id)).filter(Boolean);
  if (!topics.length) return null;
  return Math.round(topics.reduce((n, t) => n + (Number(t.mastery) || 0), 0) / topics.length);
}

export function upcomingEvaluations(state, now = new Date(), horizon = 45) {
  const today = todayISO(now);
  return (state.evaluations || [])
    .filter((e) => e.status === 'upcoming' && e.date >= today && diffDays(today, e.date) <= horizon)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || '')))
    .map((e) => ({ ...e, daysLeft: diffDays(today, e.date), prep: prepPercent(state, e) }));
}

/** Lista ordenada de prioridades con razones legibles y una acción sugerida. */
export function rankPriorities(state, now = new Date()) {
  const today = todayISO(now);
  const archived = new Set(state.courses.filter((c) => c.archived).map((c) => c.id));
  const items = [];
  const difficulties = (state.difficulties || []).filter((d) => !d.resolved);
  const topicById = new Map((state.topics || []).map((t) => [t.id, t]));
  const prereqBoost = new Map();

  for (const t of state.topics || []) {
    if (archived.has(t.courseId)) continue;
    const course = courseOf(state, t.courseId);
    const importance = (Number(course.importance) || 3) / 5;
    const mastery = Number(t.mastery) || 0;
    const weakness = (100 - mastery) / 100;
    const ev = nextEvaluationFor(state, t, today);
    const days = ev ? diffDays(today, ev.date) : null;
    const urgency = ev ? 1 / (1 + Math.max(0, days) / 3) : 0;
    const od = overdueDays(t, today);
    const dueScore = od == null || od < 0 ? 0 : Math.min(1, 0.45 + od / 7);
    const diffs = difficulties.filter((d) => d.topicId === t.id).length;
    const missingPrereqs = (t.prereqIds || []).map((id) => topicById.get(id)).filter((p) => p && p.level !== 'mastered');
    if (t.level === 'mastered' && dueScore === 0 && !(ev && days <= 7 && mastery < 92)) continue;
    let score = 100 * (0.38 * urgency * (0.35 + 0.65 * weakness) + 0.2 * dueScore + 0.17 * weakness * importance + 0.12 * Math.min(1, diffs / 3) + 0.08 * importance + 0.05 * ((Number(t.difficulty) || 3) / 5));
    if (missingPrereqs.length) {
      score *= 0.7;
      for (const p of missingPrereqs) {
        const add = score * 0.25 + 6;
        const prev = prereqBoost.get(p.id);
        if (!prev || prev.add < add) prereqBoost.set(p.id, { by: t.title, add });
      }
    }
    const reasons = [];
    if (ev) reasons.push({ code: 'eval', tone: days <= 3 ? 'urgent' : 'info', text: `${EVAL_TYPES[ev.type] || 'Evaluación'} ${countdownText(days)}` });
    if (od != null && od >= 0) reasons.push({ code: 'due', tone: od > 0 ? 'urgent' : 'info', text: od === 0 ? 'Repaso para hoy' : `Repaso vencido hace ${od} d` });
    if (t.level === 'new') reasons.push({ code: 'new', tone: 'info', text: 'Sin empezar' });
    else if (mastery < 60) reasons.push({ code: 'weak', tone: 'info', text: `Dominio ${mastery}%` });
    if (diffs) reasons.push({ code: 'diff', tone: 'info', text: diffs === 1 ? '1 dificultad' : `${diffs} dificultades` });
    if (missingPrereqs.length) reasons.push({ code: 'prereq', tone: 'info', text: `Antes: ${missingPrereqs[0].title}` });
    items.push({ type: 'topic', id: t.id, title: t.title, courseId: t.courseId, score, reasons, action: od != null && od >= 0 ? 'review-topic' : 'plan-topic', evaluationId: ev?.id || null });
  }
  for (const it of items) {
    const boost = prereqBoost.get(it.id);
    if (boost) { it.score += boost.add; it.reasons.push({ code: 'base', tone: 'info', text: `Base para ${boost.by}` }); }
  }

  for (const ev of upcomingEvaluations(state, now, 21)) {
    if (archived.has(ev.courseId)) continue;
    const course = courseOf(state, ev.courseId);
    const urgency = 1 / (1 + Math.max(0, ev.daysLeft) / 3);
    const prep = ev.prep ?? 0;
    const planned = state.blocks.some((b) => b.evaluationId === ev.id && b.date >= today && b.status === 'scheduled');
    let score = 100 * (0.6 * urgency * (1 - prep / 100) + 0.2 * ((Number(course.importance) || 3) / 5) + 0.2 * (ev.weight ? Math.min(1, ev.weight / 40) : 0.35));
    if (planned) score *= 0.55;
    const reasons = [{ code: 'eval', tone: ev.daysLeft <= 3 ? 'urgent' : 'info', text: countdownText(ev.daysLeft) }];
    if (ev.prep != null) reasons.push({ code: 'prep', tone: 'info', text: `Preparación ${ev.prep}%` });
    if (ev.weight) reasons.push({ code: 'weight', tone: 'info', text: `Vale ${ev.weight}%` });
    if (planned) reasons.push({ code: 'planned', tone: 'ok', text: 'Con plan' });
    items.push({ type: 'evaluation', id: ev.id, title: ev.title, courseId: ev.courseId, score, reasons, action: planned ? 'open-evaluation' : 'plan-exam' });
  }

  for (const b of state.blocks) {
    if (!isUsableBlock(b) || !['missed', 'paused'].includes(b.status) || isFixedKind(b.kind) || b.decisionDismissed) continue;
    if (b.date < addDays(today, -14)) continue;
    if (state.blocks.some((x) => x.rescheduledFrom === b.id)) continue;
    const topic = b.topicId ? topicById.get(b.topicId) : null;
    const score = 34 + (PRIORITY_BOOST[b.priority] || 0) + (topic ? ((100 - (Number(topic.mastery) || 0)) / 100) * 16 : 0) + (b.kind === 'study' ? 6 : 0);
    items.push({
      type: 'block', id: b.id, title: b.title, courseId: b.courseId, score,
      reasons: [{ code: 'missed', tone: 'info', text: `${b.status === 'missed' ? 'No realizada' : 'Pausada'} ${fmtRelDay(b.date, today)}` }],
      action: 'reschedule',
    });
  }

  items.sort((a, b) => b.score - a.score);
  // Evita repetir un tema que ya aparece a través de su evaluación inmediata.
  return items.filter((it) => it.score >= 8).map((it) => ({ ...it, score: Math.round(it.score) }));
}

/** Resumen para la pantalla principal. */
export function computeFocus(state, now = new Date()) {
  const today = todayISO(now);
  const nm = nowMin(now);
  const rules = rulesFrom(state.preferences);
  const blocks = state.blocks.filter(isUsableBlock);
  const todays = blocks.filter((b) => b.date === today).sort(byStart);
  const active = (b) => !['mastered', 'missed'].includes(b.status) && !b.decisionDismissed;
  const current = todays.find((b) => toMin(b.start) <= nm && nm < toMin(b.end) && active(b)) || null;
  const next = todays.find((b) => toMin(b.start) > nm && active(b)) || null;
  const decisions = blocks.filter((b) => needsDecision(b, now)).sort((a, b) => byStart(b, a));
  const priorities = rankPriorities(state, now);
  const ctx = { blocks, rules, now };
  const windows = nm < rules.sleep ? freeWindows(ctx, today, 15) : [];
  const freeNow = !current && windows.length && windows[0].start <= nm + 5 ? { from: Math.max(nm, windows[0].start), until: windows[0].end, minutes: windows[0].end - Math.max(nm, windows[0].start) } : null;
  const studyMin = studyMinutesOn(blocks, today);
  const remaining = todays.filter((b) => toMin(b.end) > nm && active(b));
  const done = todays.filter((b) => b.status === 'mastered').length;
  return {
    today, nowMin: nm, rules, current, next,
    minutesToNext: next ? toMin(next.start) - nm : null,
    decisions, priorities, freeNow, windows, todays, remaining, done,
    load: { studyMin, maxStudy: rules.maxStudy, overloaded: studyMin > rules.maxStudy, totalMin: todays.reduce((n, b) => n + blockMinutes(b), 0) },
    evaluations: upcomingEvaluations(state, now, 30),
    dayOver: nm >= rules.sleep,
    prefs: prefs(state),
  };
}
