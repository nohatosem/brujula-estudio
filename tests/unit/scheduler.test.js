import test from 'node:test';
import assert from 'node:assert/strict';
import { rulesFrom } from '../../js/engine/rules.js';
import { conflicts, violations, findSlot, suggestSlots, freeWindows, validateChanges, planExamPrep, planWeek, isLocked, stillApplicable } from '../../js/engine/scheduler.js';
import { toMin, addDays as addDaysT } from '../../js/core/dates.js';
import { newBlock, newTopic, newEvaluation, blankState } from '../../js/core/model.js';

const NOW = new Date(2026, 9, 17, 9, 0); // sábado 17 oct 2026, 09:00
const prefs = { wake: '07:00', sleep: '22:00', lunchStart: '12:00', lunchEnd: '13:00', breakMins: 15, maxStudyMin: 240 };
const rules = rulesFrom(prefs);
const B = (date, start, end, extra = {}) => newBlock({ date, start, end, title: extra.title || `${date} ${start}`, ...extra });

function stateWith(blocks) {
  const s = blankState();
  s.preferences = { ...s.preferences, ...prefs };
  s.courses.push({ id: 'fis', name: 'Física I', color: '#000', difficulty: 5, importance: 5 });
  s.blocks = blocks;
  return s;
}

test('reglas: valores por defecto, horas inválidas y dormir de madrugada', () => {
  const r = rulesFrom({});
  assert.equal(r.wake, 7 * 60);
  assert.equal(r.sleep, 21 * 60);
  const bad = rulesFrom({ wake: '25:00', sleep: 'x' });
  assert.ok(bad.issues.length >= 2);
  const late = rulesFrom({ wake: '08:00', sleep: '00:30' });
  assert.equal(late.sleep, 24 * 60 - 1, 'dormir 00:30 deja el día hasta 23:59');
});

test('cruces detectados por día', () => {
  const blocks = [B('2026-10-18', '10:00', '11:00'), B('2026-10-18', '10:30', '11:30'), B('2026-10-18', '11:30', '12:00'), B('2026-10-19', '10:00', '11:00')];
  const c = conflicts(blocks);
  assert.equal(c.length, 1);
  assert.equal(c[0].a.start, '10:00');
});

test('violaciones: sueño, almuerzo, pasado, cruce, separación y límite diario', () => {
  const blocks = [B('2026-10-18', '15:00', '16:00', { kind: 'study' }), B('2026-10-18', '16:30', '19:30', { kind: 'study' })];
  const ctx = { blocks, rules, now: NOW };
  const v = (date, s, e, kind = 'personal') => violations(ctx, { date, start: toMin(s), end: toMin(e), kind });
  assert.deepEqual(v('2026-10-18', '06:00', '07:30'), ['sleep']);
  assert.deepEqual(v('2026-10-18', '11:30', '12:30'), ['lunch']);
  assert.deepEqual(v('2026-10-17', '08:00', '08:30'), ['past']);
  assert.deepEqual(v('2026-10-18', '15:30', '16:15', 'personal'), ['overlap']);
  assert.deepEqual(v('2026-10-18', '16:05', '16:20', 'personal'), ['gap']);
  assert.deepEqual(v('2026-10-18', '20:00', '21:00', 'study'), ['limit'], '240 min de estudio ya están usados');
  assert.deepEqual(v('2026-10-18', '20:00', '21:00', 'personal'), []);
});

test('findSlot: primer día con hueco y hora más cercana a la preferida, respetando todo', () => {
  const blocks = [B('2026-10-17', '09:30', '12:00'), B('2026-10-17', '13:00', '21:45')];
  const ctx = { blocks, rules, now: NOW };
  const s = findSlot(ctx, { duration: 60, kind: 'personal', preferStart: toMin('15:00') });
  assert.deepEqual(s, { date: '2026-10-18', start: '15:00', end: '16:00' }, 'hoy no cabe una hora; mañana a la misma hora');
  const morning = findSlot({ blocks: [], rules, now: NOW }, { duration: 30, kind: 'personal' });
  assert.equal(morning.date, '2026-10-17');
  assert.ok(toMin(morning.start) >= toMin('09:15'), 'deja al menos 15 min desde ahora');
  const none = findSlot({ blocks: [], rules, now: NOW }, { duration: 1000, kind: 'study' });
  assert.equal(none, null);
  const alts = suggestSlots({ blocks: [], rules, now: NOW }, { duration: 45, kind: 'study', perDay: 2, limit: 4, preferStart: toMin('16:00') });
  assert.equal(alts.length, 4);
  assert.equal(alts[0].start, '16:00');
});

test('freeWindows: huecos del día sin almuerzo ni actividades', () => {
  const w = freeWindows({ blocks: [B('2026-10-18', '09:00', '10:00')], rules, now: NOW }, '2026-10-18', 20);
  assert.deepEqual(w.map((x) => [x.start, x.end]), [[420, 525], [615, 720], [780, 1320]]);
});

test('validateChanges (IA): estricta, sin borrar ni tocar protegidos', () => {
  const cls = B('2026-10-19', '08:00', '10:00', { kind: 'class', title: 'Clase de Física', courseId: 'fis' });
  const study = B('2026-10-19', '15:00', '16:00', { kind: 'study', title: 'MRU', courseId: 'fis' });
  const done = B('2026-10-19', '17:00', '18:00', { kind: 'study', title: 'Vectores', courseId: 'fis', status: 'mastered' });
  const s = stateWith([cls, study, done]);
  const r = validateChanges(s, [
    { action: 'delete', id: study.id },
    { action: 'update', id: cls.id, start: '09:00', end: '11:00' },
    { action: 'update', id: done.id, start: '19:00', end: '20:00' },
    { action: 'add', course: 'Física I', date: '2026-10-19', start: '06:00', end: '07:00', title: 'Muy temprano', kind: 'study', priority: 'normal', difficulty: 3 },
    { action: 'add', course: 'Física I', date: '2026-10-19', start: '20:00', end: '20:30', title: 'Clase falsa', kind: 'class', priority: 'normal', difficulty: 3 },
    { action: 'add', course: 'Química', date: '2026-10-19', start: '19:00', end: '19:30', title: 'Repaso', kind: 'study', priority: 'normal', difficulty: 3 },
    { action: 'update', id: study.id, start: '16:30', end: '17:30', secret: 'x' },
    { action: 'update', id: study.id, date: '2026-10-20', start: '16:00', end: '17:00' },
    { action: 'add', course: 'Física I', date: '2026-10-20', start: '18:00', end: '18:30', title: 'Repaso: MRU', kind: 'study', priority: 'high', difficulty: 4 },
  ], { source: 'ai', rules, now: NOW, maxChanges: 12 });
  assert.equal(r.ops.length, 2, 'solo los dos cambios seguros pasan');
  assert.equal(r.rejected.length, 7);
  const why = r.rejected.map((x) => x.reasons.join(' | ')).join('\n');
  assert.match(why, /no puede borrar/);
  assert.match(why, /protegidas/);
  assert.match(why, /sueño/);
  assert.match(why, /solo puede crear/);
  assert.match(why, /No existe el curso/);
  assert.match(why, /Campos no permitidos/);
  assert.equal(r.ops[0].label.verb, 'Mover');
  assert.equal(r.ops[1].label.verb, 'Añadir');
  assert.equal(s.blocks.find((b) => b.id === study.id).date, '2026-10-19', 'no muta el estado original');
  const many = Array.from({ length: 9 }, (_, i) => ({ action: 'add', course: 'Física I', date: '2026-10-21', start: `${String(8 + i).padStart(2, '0')}:00`, end: `${String(8 + i).padStart(2, '0')}:20`, title: 'T' + i, kind: 'personal', priority: 'normal', difficulty: 1 }));
  const capped = validateChanges(s, many, { source: 'ai', rules, now: NOW });
  assert.ok(capped.rejected.some((x) => /Máximo 8/.test(x.reasons[0])), 'la IA no puede proponer más de 8 cambios');
});

test('validateChanges (importación): las reglas son avisos y se permite borrar', () => {
  const study = B('2026-10-19', '15:00', '16:00', { kind: 'study', title: 'MRU', courseId: 'fis' });
  const s = stateWith([study]);
  const r = validateChanges(s, [
    { action: 'add', course: 'Física I', date: '2026-10-19', start: '15:30', end: '16:30', title: 'Cruce', kind: 'exam', priority: 'critical', difficulty: 5 },
    { action: 'delete', id: study.id },
  ], { source: 'import', rules, now: NOW });
  assert.equal(r.ops.length, 2);
  assert.ok(r.warnings.some((w) => /se cruza/.test(w)));
});

test('stillApplicable detecta cambios posteriores a la propuesta', () => {
  const study = B('2026-10-19', '15:00', '16:00', { kind: 'study', title: 'MRU' });
  const s = stateWith([study]);
  const { ops } = validateChanges(s, [{ action: 'update', id: study.id, start: '16:30', end: '17:30' }], { source: 'ai', rules, now: NOW });
  assert.ok(stillApplicable(s, ops));
  s.blocks[0].start = '15:15';
  assert.ok(!stillApplicable(s, ops));
});

test('planExamPrep: sesiones antes del examen, temas débiles primero y simulacro', () => {
  const s = stateWith([B('2026-10-24', '09:00', '11:00', { kind: 'exam', title: 'Examen de Física', courseId: 'fis' })]);
  const weak = newTopic({ courseId: 'fis', title: 'Cinemática', mastery: 20, level: 'learning' });
  const mid = newTopic({ courseId: 'fis', title: 'Vectores', mastery: 60, level: 'learning' });
  const strong = newTopic({ courseId: 'fis', title: 'Unidades', mastery: 90, level: 'mastered' });
  s.topics = [weak, mid, strong];
  const ev = newEvaluation({ courseId: 'fis', title: 'Examen de Física', date: '2026-10-24', time: '09:00', topicIds: [weak.id, mid.id, strong.id] });
  s.evaluations = [ev];
  const plan = planExamPrep(s, ev, { rules, now: NOW, sessionMin: 45 });
  assert.equal(plan.daysLeft, 7);
  const titles = plan.blocks.map((b) => b.title);
  assert.equal(titles.filter((t) => /Cinemática/.test(t)).length, 2, 'tema débil: dos pasadas');
  assert.equal(titles.filter((t) => /Vectores/.test(t)).length, 1);
  assert.ok(!titles.some((t) => /Unidades/.test(t)), 'tema dominado no se programa');
  assert.ok(titles.some((t) => /^Simulacro/.test(t)));
  for (const b of plan.blocks) {
    assert.ok(b.date < '2026-10-24', 'todo antes del examen');
    assert.equal(b.evaluationId, ev.id);
    assert.deepEqual(violations({ blocks: [...s.blocks, ...plan.blocks.filter((x) => x !== b)], rules, now: NOW }, { date: b.date, start: toMin(b.start), end: toMin(b.end), kind: 'study' }), [], `${b.title} respeta las reglas`);
  }
  const firstWeak = plan.blocks.filter((b) => /Cinemática/.test(b.title)).map((b) => b.date).sort();
  assert.ok(firstWeak[0] < firstWeak[1], 'las dos pasadas quedan en días distintos');
  assert.ok(isLocked(s.blocks[0]));
});

test('planWeek: reparte sesiones por prioridad sin cruces y con repaso en su día', async () => {
  const { rankPriorities } = await import('../../js/engine/priority.js');
  const s = stateWith([B('2026-10-18', '09:00', '12:00', { kind: 'study', title: 'Larga' })]);
  const weak = newTopic({ courseId: 'fis', title: 'Cinemática', mastery: 10, level: 'learning' });
  const due = newTopic({ courseId: 'fis', title: 'MRU', mastery: 60, level: 'review', srs: { ease: 2.5, interval: 1, reps: 1, lapses: 1, due: '2026-10-19', last: '2026-10-18' } });
  s.topics = [weak, due];
  s.evaluations = [newEvaluation({ courseId: 'fis', title: 'Parcial', date: '2026-10-22', topicIds: [weak.id, due.id] })];
  const ranked = rankPriorities(s, NOW);
  const plan = planWeek(s, ranked, { rules, now: NOW });
  const weakSessions = plan.blocks.filter((b) => b.topicId === weak.id);
  const review = plan.blocks.find((b) => b.topicId === due.id);
  assert.equal(weakSessions.length, 2, 'tema débil con examen: dos sesiones');
  assert.ok(weakSessions[1].date > addDaysT(weakSessions[0].date, 1), 'separadas al menos un día');
  assert.ok(review && review.date >= '2026-10-19' && /^Repaso/.test(review.title), 'repaso desde su fecha');
  const all = [...s.blocks, ...plan.blocks];
  for (const b of plan.blocks) {
    assert.deepEqual(violations({ blocks: all.filter((x) => x !== b), rules, now: NOW }, { date: b.date, start: toMin(b.start), end: toMin(b.end), kind: 'study' }), [], b.title);
    assert.equal(b.origin, 'week-plan');
  }
  const again = planWeek({ ...s, blocks: all }, ranked, { rules, now: NOW });
  assert.equal(again.blocks.length, 0, 'no duplica lo ya planificado');
});
