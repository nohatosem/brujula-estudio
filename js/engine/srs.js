// Brújula 4 · repaso espaciado (variante sencilla de SM-2) y nivel de dominio por tema.

import { addDays, todayISO, diffDays, isValidDate } from '../core/dates.js';
import { clamp } from '../core/util.js';

export const GRADES = ['again', 'hard', 'good', 'easy'];
export const GRADE_LABEL = { again: 'No lo entendí', hard: 'Me costó', good: 'Bien', easy: 'Fácil' };
export const LEVEL_LABEL = { new: 'Nuevo', learning: 'Aprendiendo', review: 'Repasar', mastered: 'Dominado' };

/** Resultado de una sesión → calificación de repaso. */
export function outcomeToGrade(status) {
  return { mastered: 'good', review: 'again', progress: 'hard' }[status] || null;
}

export function levelFor(mastery, grade) {
  if (grade === 'again') return 'review';
  if (mastery >= 85) return 'mastered';
  return 'learning';
}

/**
 * Aplica una calificación y devuelve el tema actualizado (sin mutar el original).
 * Si hay una evaluación próxima, el siguiente repaso nunca queda después de ella.
 */
export function gradeTopic(topic, grade, { today = todayISO(), examDate = null } = {}) {
  if (!GRADES.includes(grade)) throw Error('Calificación no válida');
  const s = { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: null, last: null, ...(topic.srs || {}) };
  let mastery = Number(topic.mastery) || 0;
  if (grade === 'again') {
    s.reps = 0; s.lapses += 1; s.interval = 1; s.ease = Math.max(1.3, s.ease - 0.2); mastery = Math.max(5, mastery - 20);
  } else if (grade === 'hard') {
    s.interval = Math.max(1, Math.round((s.interval || 1) * 1.2)); s.ease = Math.max(1.3, s.ease - 0.15); mastery = Math.min(100, mastery + 5);
  } else if (grade === 'good') {
    s.reps += 1; s.interval = s.reps === 1 ? 1 : s.reps === 2 ? 3 : Math.round(Math.max(1, s.interval) * s.ease); mastery = Math.min(100, mastery + 15);
  } else {
    s.reps += 1; s.interval = s.reps === 1 ? 3 : Math.round(Math.max(1, s.interval) * s.ease * 1.3); s.ease = Math.min(3, s.ease + 0.15); mastery = Math.min(100, mastery + 25);
  }
  s.interval = clamp(s.interval, 1, 120);
  let due = addDays(today, s.interval);
  if (examDate && isValidDate(examDate) && examDate > today && due >= examDate) {
    const before = addDays(examDate, -1);
    due = before > today ? before : addDays(today, 1);
  }
  s.due = due;
  s.last = today;
  return { ...topic, srs: s, mastery, level: levelFor(mastery, grade), updatedAt: new Date().toISOString() };
}

export const isDue = (topic, today = todayISO()) => !!topic?.srs?.due && topic.srs.due <= today;

/** Días de retraso (>0), 0 si toca hoy, negativo si falta; null si no tiene repaso. */
export const overdueDays = (topic, today = todayISO()) => (topic?.srs?.due ? diffDays(topic.srs.due, today) : null);

export function dueTopics(state, today = todayISO()) {
  const archived = new Set(state.courses.filter((c) => c.archived).map((c) => c.id));
  return (state.topics || [])
    .filter((t) => !archived.has(t.courseId) && isDue(t, today))
    .sort((a, b) => (a.srs.due || '').localeCompare(b.srs.due || '') || (a.mastery || 0) - (b.mastery || 0));
}

/** La evaluación próxima más cercana que incluye este tema (o del mismo curso sin temas asignados). */
export function nextEvaluationFor(state, topic, today = todayISO()) {
  const upcoming = (state.evaluations || []).filter((e) => e.status !== 'done' && e.status !== 'graded' && e.date >= today);
  const direct = upcoming.filter((e) => (e.topicIds || []).includes(topic.id));
  const general = upcoming.filter((e) => e.courseId === topic.courseId && !(e.topicIds || []).length);
  return [...direct, ...general].sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}
