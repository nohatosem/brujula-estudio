import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState, migrateToV4, loadState, blankState, isBlankState, lessonFor, topicTitleFrom, SCHEMA } from '../../js/core/model.js';
import { diffDays, addDays, weekStart, fmtRelDay, fmtDuration, isValidDate, fmtLong } from '../../js/core/dates.js';
import { legacyState } from '../fixtures/legacy39.js';

test('fechas: aritmética y formatos en español', () => {
  assert.equal(diffDays('2026-10-17', '2026-10-20'), 3);
  assert.equal(diffDays('2026-12-30', '2027-01-02'), 3);
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(weekStart('2026-10-17'), '2026-10-12'); // sábado → lunes
  assert.equal(weekStart('2026-10-12'), '2026-10-12');
  assert.equal(fmtRelDay('2026-10-18', '2026-10-17'), 'mañana');
  assert.equal(fmtRelDay('2026-10-21', '2026-10-17'), 'el miércoles');
  assert.equal(fmtRelDay('2026-10-14', '2026-10-17'), 'hace 3 días');
  assert.equal(fmtDuration(90), '1 h 30 min');
  assert.equal(fmtDuration(45), '45 min');
  assert.equal(fmtLong('2026-10-17'), 'sábado 17 de octubre');
  assert.ok(isValidDate('2026-02-28'));
  assert.ok(!isValidDate('2026-02-30'));
});

test('normalizeState: rechaza archivos ajenos y conserva campos desconocidos', () => {
  assert.throws(() => normalizeState({ hello: 1 }), /no válido/);
  assert.throws(() => normalizeState({ version: 9, blocks: [], courses: [] }), /no válido/);
  const s = normalizeState(legacyState());
  assert.equal(s.version, 2);
  assert.deepEqual(s.unknownFieldFromFuture, { keep: true });
  assert.equal(s.timer.running, false, 'el temporizador no sigue corriendo al cargar');
  assert.equal(s.blocks.length, 12);
});

test('migración 3.9 → 4: crea temas y evaluaciones sin tocar los datos antiguos', () => {
  const legacy = legacyState();
  const { state, report } = loadState(legacy, { today: '2026-10-17' });
  assert.equal(state.schema, SCHEMA);
  assert.equal(state.version, 2, 'se mantiene version 2 para clientes 3.9');
  assert.equal(state.savedAt, legacy.savedAt, 'la migración no cambia savedAt (no provoca conflictos)');
  // Campos heredados intactos
  for (const old of legacy.blocks) {
    const now = state.blocks.find((b) => b.id === old.id);
    for (const k of Object.keys(old)) assert.deepEqual(now[k], old[k], `campo ${k} intacto en ${old.title}`);
  }
  assert.deepEqual(state.journal, legacy.journal);
  assert.deepEqual(state.habits, legacy.habits);
  assert.equal(state.preferences.replanMode, 'mixed', 'respeta el modo elegido');
  assert.equal(state.preferences.sleep, '22:30');
  // Temas: Fundamentos (dominado), Vectores (repasar, con su repaso agrupado), MRU, despejes, cinemática, C++
  const titles = state.topics.map((t) => t.title).sort();
  assert.deepEqual(titles, ['C++: variables y entrada/salida', 'Cinemática: aceleración', 'Fundamentos y unidades', 'MRU desde cero', 'Matemáticas para Física: despejes', 'Vectores: magnitud y dirección'].sort());
  const vectores = state.topics.find((t) => t.title.startsWith('Vectores'));
  assert.equal(vectores.level, 'review');
  assert.equal(vectores.srs.due, '2026-10-18');
  const linked = state.blocks.filter((b) => b.topicId === vectores.id);
  assert.equal(linked.length, 2, 'la sesión y su repaso quedan vinculados al mismo tema');
  assert.equal(state.topics.find((t) => t.title.startsWith('Fundamentos')).level, 'mastered');
  assert.ok(!state.topics.some((t) => /simulacro|clase/i.test(t.title)), 'simulacros y clases no son temas');
  // Evaluaciones
  assert.equal(report.evaluations, 1);
  const ev = state.evaluations[0];
  assert.equal(ev.type, 'exam');
  assert.equal(ev.date, '2026-10-20');
  assert.ok(ev.topicIds.length >= 3);
  const exam = state.blocks.find((b) => b.kind === 'exam');
  assert.equal(exam.evaluationId, ev.id);
  assert.equal(state.blocks.find((b) => /Simulacro/.test(b.title)).evaluationId, ev.id);
});

test('migración idempotente: ejecutarla dos veces no duplica nada', () => {
  const { state } = loadState(legacyState(), { today: '2026-10-17' });
  const topics = state.topics.length, evals = state.evaluations.length;
  const again = migrateToV4(state, { today: '2026-10-17' });
  assert.equal(again.topics, 0);
  assert.equal(state.topics.length, topics);
  assert.equal(state.evaluations.length, evals);
  const reloaded = loadState(JSON.parse(JSON.stringify(state)), { today: '2026-10-17' }).state;
  assert.equal(reloaded.topics.length, topics);
});

test('estado vacío y material de estudio incluido', () => {
  assert.ok(isBlankState(blankState()));
  assert.ok(!isBlankState(loadState(legacyState()).state));
  assert.equal(topicTitleFrom('Repaso: Vectores'), 'Vectores');
  assert.equal(topicTitleFrom('Simulacro de Física I'), '');
  const l = lessonFor({ title: 'MRU desde cero', courseId: 'fis', lesson: {} });
  assert.match(l.intro, /rectilíneo uniforme/);
  const own = lessonFor({ title: 'MRU', lesson: { intro: 'Mi explicación' } });
  assert.equal(own.intro, 'Mi explicación');
});

test('reversión segura: un estado 4.0 sigue siendo válido para Brújula 3.9', async () => {
  const { demoState } = await import('../fixtures/demo.js');
  // Copia literal de la validación de normalizeState() de Brújula 3.9 (index.html).
  const normalize39 = (v) => {
    if (!v || ![1, 2].includes(v.version) || !Array.isArray(v.blocks) || !Array.isArray(v.courses) || !v.timer) throw Error('Archivo de Brújula no válido');
    return { ...v, version: 2, events: Array.isArray(v.events) ? v.events : [], habits: v.habits || {}, journal: v.journal || {}, savedAt: Number(v.savedAt) || Date.now(), timer: { ...v.timer, running: false, remaining: 1500 } };
  };
  for (const s of [loadState(legacyState(), { today: '2026-10-17' }).state, loadState(demoState(), { today: '2026-10-17' }).state]) {
    const back = normalize39(JSON.parse(JSON.stringify(s)));
    assert.ok(back.topics?.length && Array.isArray(back.evaluations), '3.9 conserva los campos nuevos al guardar ({...v})');
    for (const b of back.blocks) {
      assert.ok(['study', 'class', 'exam', 'personal'].includes(b.kind), 'tipo conocido por 3.9: ' + b.kind);
      assert.ok(['scheduled', 'progress', 'mastered', 'review', 'paused', 'missed'].includes(b.status), 'estado conocido por 3.9: ' + b.status);
      assert.match(b.date, /^\d{4}-\d{2}-\d{2}$/); assert.match(b.start, /^\d{2}:\d{2}$/); assert.match(b.end, /^\d{2}:\d{2}$/);
    }
  }
});
