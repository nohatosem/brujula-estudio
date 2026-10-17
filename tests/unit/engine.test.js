import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeTopic, dueTopics, outcomeToGrade } from '../../js/engine/srs.js';
import { computeFocus, rankPriorities, needsDecision } from '../../js/engine/priority.js';
import { parseQuickAdd } from '../../js/engine/quickadd.js';
import { aiContext, weekStats, studyStreak } from '../../js/engine/insights.js';
import { newBlock, newTopic, newEvaluation, blankState, loadState } from '../../js/core/model.js';
import { legacyState } from '../fixtures/legacy39.js';

const NOW = new Date(2026, 9, 17, 10, 30); // sábado 17 oct 2026, 10:30
const TODAY = '2026-10-17';

test('repaso espaciado: intervalos, dominio y tope antes del examen', () => {
  let t = newTopic({ title: 'MRU', mastery: 40 });
  t = gradeTopic(t, 'good', { today: TODAY });
  assert.equal(t.srs.interval, 1);
  assert.equal(t.srs.due, '2026-10-18');
  t = gradeTopic(t, 'good', { today: '2026-10-18' });
  assert.equal(t.srs.interval, 3);
  t = gradeTopic(t, 'easy', { today: '2026-10-21' });
  assert.ok(t.srs.interval > 3);
  assert.equal(t.level, 'mastered');
  const again = gradeTopic(t, 'again', { today: '2026-10-22' });
  assert.equal(again.level, 'review');
  assert.equal(again.srs.due, '2026-10-23');
  assert.ok(again.mastery < t.mastery);
  const capped = gradeTopic(newTopic({ srs: { ease: 2.5, interval: 10, reps: 3, lapses: 0 } }), 'easy', { today: TODAY, examDate: '2026-10-20' });
  assert.equal(capped.srs.due, '2026-10-19', 'el repaso queda el día antes del examen');
  assert.equal(outcomeToGrade('review'), 'again');
  assert.throws(() => gradeTopic(t, 'perfecto'));
});

test('decisiones: nunca se infiere «no hecho» por la hora; clases y exámenes no piden decisión', () => {
  const past = newBlock({ date: TODAY, start: '08:00', end: '09:00', kind: 'study' });
  const cls = newBlock({ date: TODAY, start: '08:00', end: '09:00', kind: 'class' });
  const running = newBlock({ date: TODAY, start: '10:00', end: '11:00', kind: 'study' });
  assert.ok(needsDecision(past, NOW));
  assert.ok(!needsDecision(cls, NOW));
  assert.ok(!needsDecision(running, NOW));
  assert.equal(past.status, 'scheduled', 'el estado no cambia solo');
  const s = blankState();
  s.blocks = [past, cls, running, newBlock({ date: TODAY, start: '15:00', end: '16:00', title: 'Siguiente' })];
  const f = computeFocus(s, NOW);
  assert.equal(f.current.id, running.id);
  assert.equal(f.next.title, 'Siguiente');
  assert.equal(f.minutesToNext, 270);
  assert.deepEqual(f.decisions.map((b) => b.id), [past.id]);
});

test('prioridades: examen cercano + tema débil van primero, con razones legibles', () => {
  const s = blankState();
  s.courses.push({ id: 'fis', name: 'Física I', color: '#000', difficulty: 5, importance: 5 }, { id: 'web', name: 'Web', color: '#111', difficulty: 2, importance: 2 });
  const weak = newTopic({ courseId: 'fis', title: 'Cinemática', mastery: 15, level: 'learning' });
  const strong = newTopic({ courseId: 'fis', title: 'Unidades', mastery: 95, level: 'mastered' });
  const other = newTopic({ courseId: 'web', title: 'HTML', mastery: 30, level: 'learning' });
  const due = newTopic({ courseId: 'web', title: 'CSS', mastery: 70, level: 'learning', srs: { ease: 2.5, interval: 3, reps: 2, lapses: 0, due: '2026-10-15', last: '2026-10-12' } });
  s.topics = [weak, strong, other, due];
  s.evaluations = [newEvaluation({ courseId: 'fis', title: 'Examen de Física', date: '2026-10-20', topicIds: [weak.id, strong.id] })];
  s.difficulties = [{ id: 'd1', topicId: weak.id, kind: 'algebra', text: 'despejes', resolved: false }];
  const list = rankPriorities(s, NOW);
  assert.equal(list[0].title, 'Cinemática');
  const texts = list[0].reasons.map((r) => r.text);
  assert.ok(texts.includes('Examen en 3 días'));
  assert.ok(texts.some((x) => /Dominio 15%/.test(x)));
  assert.ok(texts.includes('1 dificultad'));
  const css = list.find((x) => x.title === 'CSS');
  assert.equal(css.action, 'review-topic');
  assert.ok(css.reasons.some((r) => /vencido hace 2 d/.test(r.text)));
  assert.ok(!list.some((x) => x.title === 'Unidades' && x.score > list[0].score));
  assert.ok(list.some((x) => x.type === 'evaluation'));
  assert.equal(dueTopics(s, TODAY).map((t) => t.title)[0], 'CSS');
});

test('prioridades: un requisito pendiente sube por encima del tema que depende de él', () => {
  const s = blankState();
  const base = newTopic({ courseId: 'general', title: 'Despejes', mastery: 40, level: 'learning' });
  const adv = newTopic({ courseId: 'general', title: 'Cinemática', mastery: 10, level: 'learning', prereqIds: [base.id] });
  s.topics = [base, adv];
  s.evaluations = [newEvaluation({ courseId: 'general', title: 'Parcial', date: '2026-10-19', topicIds: [adv.id] })];
  const list = rankPriorities(s, NOW);
  const b = list.find((x) => x.id === base.id), a = list.find((x) => x.id === adv.id);
  assert.ok(b.reasons.some((r) => /Base para Cinemática/.test(r.text)));
  assert.ok(a.reasons.some((r) => /Antes: Despejes/.test(r.text)));
});

test('alta rápida en español', () => {
  const courses = [{ id: 'fis', name: 'Física I' }, { id: 'cpp', name: 'C++ y algoritmos' }, { id: 'vida', name: 'Vida y bienestar' }, { id: 'mat', name: 'Matemáticas de apoyo' }];
  const p = (t) => parseQuickAdd(t, { courses, now: NOW, today: TODAY, sessionMin: 45 });
  let r = p('Repasar vectores física mañana 4pm 45 min');
  assert.deepEqual([r.title, r.date, r.start, r.end, r.kind, r.courseId], ['Repasar vectores', '2026-10-18', '16:00', '16:45', 'study', 'fis']);
  r = p('Examen de Física I el lunes a las 9 de la mañana');
  assert.equal(r.kind, 'exam');
  assert.equal(r.date, '2026-10-19');
  assert.equal(r.start, '09:00');
  assert.equal(r.end, '11:00', 'examen: 2 h por defecto');
  assert.equal(r.courseId, 'fis');
  r = p('Gym hoy de 6 a 7 de la tarde');
  assert.deepEqual([r.title, r.date, r.start, r.end, r.kind], ['Gym', TODAY, '18:00', '19:00', 'personal']);
  r = p('C++ ejercicios de punteros 25/10 15:00-16:30 urgente');
  assert.deepEqual([r.date, r.start, r.end, r.courseId, r.priority, r.title], ['2026-10-25', '15:00', '16:30', 'cpp', 'critical', 'Ejercicios de punteros']);
  r = p('Leer capítulo 3 el viernes');
  assert.equal(r.date, '2026-10-23');
  assert.equal(r.start, null, 'sin hora: la app sugiere un hueco');
  assert.equal(r.title, 'Leer capítulo 3');
  r = p('Llamar a mamá a las 8');
  assert.deepEqual([r.title, r.start, r.kind], ['Llamar a mamá', '08:00', 'personal']);
  r = p('Examen de Física I el lunes a las 9 de la mañana');
  assert.equal(r.title, 'Examen de Física I', 'en exámenes el curso queda en el título');
  r = p('Física 2h esta tarde');
  assert.deepEqual([r.title, r.date, r.start, r.end, r.duration], ['Física', TODAY, '15:00', '17:00', 120]);
  r = p('Repaso de 3 temas de mate');
  assert.equal(r.start, null, '«de 3» no es una hora');
  assert.equal(r.courseId, 'mat');
  r = p('Clase de cálculo el 3 de noviembre 8:00');
  assert.deepEqual([r.kind, r.date, r.start, r.end], ['class', '2026-11-03', '08:00', '09:30']);
  r = p('estudiar 1h30 mañana por la mañana');
  assert.deepEqual([r.duration, r.date, r.start], [90, '2026-10-18', '09:00']);
});

test('contexto para la IA: compacto y sin notas privadas', () => {
  const { state } = loadState(legacyState(), { today: TODAY });
  const ctx = aiContext(state, NOW);
  const text = JSON.stringify(ctx);
  assert.ok(text.length < 17000);
  assert.ok(!text.includes('me confundo'), 'no envía notas');
  assert.ok(!text.includes('Hice dos ejercicios'), 'no envía el diario');
  assert.ok(ctx.schedule.every((b) => b.id && b.date && b.start));
  assert.ok(ctx.schedule.find((b) => b.kind === 'exam').locked);
  assert.equal(ctx.rules.sleep, '22:30');
  const w = weekStats(state, TODAY, NOW);
  assert.ok(w.planned > 0);
  assert.equal(typeof studyStreak(state, TODAY), 'number');
});
