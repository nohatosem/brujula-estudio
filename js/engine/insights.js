// Brújula 4 · métricas de seguimiento y contexto compacto para el asistente.

import { weekDays, todayISO, addDays, diffDays, blockMinutes, nowMin, toHHMM, fmtWeekday } from '../core/dates.js';
import { isUsableBlock, courseOf } from '../core/model.js';
import { cut } from '../core/util.js';
import { rulesFrom, describeRules } from './rules.js';
import { conflicts, isLocked, studyMinutesOn } from './scheduler.js';
import { rankPriorities, upcomingEvaluations, needsDecision } from './priority.js';
import { dueTopics } from './srs.js';

const DONE = new Set(['mastered', 'review']);
const PARTIAL = new Set(['progress', 'paused']);

export function weekStats(state, dateInWeek, now = new Date()) {
  const days = weekDays(dateInWeek);
  const nowMs = now.getTime();
  const perDay = days.map((date) => {
    const blocks = state.blocks.filter((b) => isUsableBlock(b) && b.date === date);
    const study = blocks.filter((b) => b.kind === 'study');
    const planned = study.reduce((n, b) => n + blockMinutes(b), 0);
    const done = study.filter((b) => DONE.has(b.status)).reduce((n, b) => n + blockMinutes(b), 0);
    const partial = study.filter((b) => PARTIAL.has(b.status)).reduce((n, b) => n + blockMinutes(b), 0);
    const missed = study.filter((b) => b.status === 'missed').reduce((n, b) => n + blockMinutes(b), 0);
    const classes = blocks.filter((b) => b.kind === 'class').reduce((n, b) => n + blockMinutes(b), 0);
    const personalDone = blocks.filter((b) => b.kind === 'personal' && b.status === 'mastered').length;
    return { date, planned, done, partial, missed, classes, personalDone, count: blocks.length };
  });
  const sumOf = (k) => perDay.reduce((n, d) => n + d[k], 0);
  const decided = state.blocks.filter((b) => isUsableBlock(b) && days.includes(b.date) && b.kind === 'study' && (DONE.has(b.status) || PARTIAL.has(b.status) || b.status === 'missed'));
  const finishedUndecided = state.blocks.filter((b) => isUsableBlock(b) && days.includes(b.date) && b.kind === 'study' && needsDecision(b, new Date(nowMs)));
  const doneCount = decided.filter((b) => DONE.has(b.status)).length;
  const base = decided.length + finishedUndecided.length;
  return {
    days: perDay,
    planned: sumOf('planned'), done: sumOf('done'), partial: sumOf('partial'), missed: sumOf('missed'),
    completion: base ? Math.round((doneCount / base) * 100) : null,
    sessionsDone: doneCount, sessionsTotal: base,
  };
}

export function studyStreak(state, today = todayISO()) {
  const days = new Set(state.blocks.filter((b) => isUsableBlock(b) && b.kind === 'study' && DONE.has(b.status)).map((b) => b.date));
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

export function habitStreak(state, habitId, today = todayISO()) {
  const h = state.habits || {};
  let d = h[today]?.[habitId] ? today : addDays(today, -1);
  let n = 0;
  while (h[d]?.[habitId]) { n++; d = addDays(d, -1); }
  return n;
}

export function courseStats(state, now = new Date()) {
  const today = todayISO(now);
  const from = addDays(today, -6);
  const evals = upcomingEvaluations(state, now, 120);
  return state.courses.filter((c) => !c.archived).map((c) => {
    const topics = state.topics.filter((t) => t.courseId === c.id);
    const mastery = topics.length ? Math.round(topics.reduce((n, t) => n + (Number(t.mastery) || 0), 0) / topics.length) : null;
    const studied = state.blocks.filter((b) => isUsableBlock(b) && b.courseId === c.id && b.kind === 'study' && b.date >= from && b.date <= today && DONE.has(b.status)).reduce((n, b) => n + blockMinutes(b), 0);
    const upcoming = state.blocks.filter((b) => isUsableBlock(b) && b.courseId === c.id && b.date >= today).length;
    return {
      course: c, topics: topics.length, mastery,
      mastered: topics.filter((t) => t.level === 'mastered').length,
      due: topics.filter((t) => t.srs?.due && t.srs.due <= today).length,
      nextEval: evals.find((e) => e.courseId === c.id) || null,
      studiedWeek: studied, upcoming,
    };
  });
}

export function difficultyStats(state) {
  const open = (state.difficulties || []).filter((d) => !d.resolved);
  const byKind = {};
  for (const d of open) byKind[d.kind || 'other'] = (byKind[d.kind || 'other'] || 0) + 1;
  const top = Object.entries(byKind).sort((a, b) => b[1] - a[1])[0] || null;
  return { open: open.length, total: (state.difficulties || []).length, byKind, top: top ? { kind: top[0], count: top[1] } : null };
}

/**
 * Contexto compacto para Gemini (solo se envía con permiso explícito).
 * Sin notas, diario, respuestas ni material de estudio.
 */
export function aiContext(state, now = new Date(), { days = 14, maxBlocks = 80, maxChars = 17000 } = {}) {
  const today = todayISO(now);
  const rules = rulesFrom(state.preferences);
  const topicById = new Map(state.topics.map((t) => [t.id, t]));
  const build = (windowDays, limit) => {
    const from = addDays(today, -2), to = addDays(today, windowDays);
    const schedule = state.blocks
      .filter((b) => isUsableBlock(b) && b.date >= from && b.date <= to)
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
      .slice(0, limit)
      .map((b) => ({
        id: String(b.id).slice(0, 80), course: cut(courseOf(state, b.courseId).name, 60), date: b.date, start: b.start, end: b.end,
        title: cut(b.title, 80), kind: b.kind, status: b.status, priority: b.priority, difficulty: Number(b.difficulty) || 3,
        locked: isLocked(b), ...(b.topicId && topicById.get(b.topicId) ? { topic: cut(topicById.get(b.topicId).title, 60) } : {}),
      }));
    const topics = rankPriorities(state, now).filter((p) => p.type === 'topic').slice(0, 30).map((p) => {
      const t = topicById.get(p.id);
      return { title: cut(t.title, 70), course: cut(courseOf(state, t.courseId).name, 60), mastery: Number(t.mastery) || 0, level: t.level, due: t.srs?.due || null };
    });
    const evaluations = upcomingEvaluations(state, now, 40).slice(0, 12).map((e) => ({ title: cut(e.title, 70), course: cut(courseOf(state, e.courseId).name, 60), type: e.type, date: e.date, daysLeft: e.daysLeft, prep: e.prep, weight: e.weight || null }));
    const load = {};
    for (let i = 0; i < 7; i++) { const d = addDays(today, i); load[d] = studyMinutesOn(state.blocks, d); }
    return {
      today, weekday: fmtWeekday(today), now: toHHMM(nowMin(now)),
      rules: describeRules(rules),
      courses: state.courses.filter((c) => !c.archived).slice(0, 30).map((c) => ({ name: cut(c.name, 60), difficulty: Number(c.difficulty) || 3, importance: Number(c.importance) || 3, credits: c.credits ?? null })),
      schedule, topics, evaluations,
      metrics: {
        studyMinByDay: load,
        conflicts: conflicts(state.blocks, { from: today }).length,
        decisionsPending: state.blocks.filter((b) => needsDecision(b, now)).length,
        reviewsDue: dueTopics(state, today).length,
        difficulties: (state.difficulties || []).filter((d) => !d.resolved).length,
      },
    };
  };
  let ctx = build(days, maxBlocks);
  for (const [d, n] of [[10, 60], [7, 45], [5, 35]]) {
    if (JSON.stringify(ctx).length <= maxChars) break;
    ctx = build(d, n);
  }
  return ctx;
}

/** Resumen pequeño para el chat cuando se permite compartir el horario. */
export function chatSchedule(state, now = new Date()) {
  const today = todayISO(now);
  return state.blocks
    .filter((b) => isUsableBlock(b) && b.date >= today && diffDays(today, b.date) <= 7 && b.status !== 'mastered')
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    .slice(0, 25)
    .map((b) => ({ date: b.date, start: b.start, end: b.end, title: cut(b.title, 90), status: b.status }));
}
