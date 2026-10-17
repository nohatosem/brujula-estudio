// Avisos: mismo cálculo para los locales y para la cola del servidor push.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderItems, reminderTag, leadMinutes } from '../../js/features/reminders.js';
import { blankState, newBlock } from '../../js/core/model.js';

const NOW = new Date(2026, 9, 17, 10, 30).getTime(); // sábado 17 oct 2026, 10:30 (hora local)
function state(lead, blocks) {
  const s = blankState();
  s.preferences = { ...s.preferences, reminderLead: lead };
  s.courses.push({ id: 'fis', name: 'Física I', color: '#000', difficulty: 4, importance: 4 });
  s.blocks = blocks;
  return s;
}
const B = (start, extra = {}) => newBlock({ id: 'b-' + start.replace(':', ''), date: '2026-10-17', start, end: '23:00', courseId: 'fis', title: 'Clase ' + start, kind: 'class', ...extra });

test('anticipación: «A la hora» (0) se respeta; valores inválidos usan 10', () => {
  assert.equal(leadMinutes(state(0, [])), 0);
  assert.equal(leadMinutes(state('x', [])), 10);
  assert.equal(leadMinutes(state(90, [])), 60);
  const [it] = reminderItems(state(0, [B('11:00')]), { now: NOW });
  assert.equal(it.at, new Date(2026, 9, 17, 11, 0).getTime());
  assert.equal(it.body, 'Física I · empieza ahora.');
});

test('incluye solo actividades futuras y no cerradas; texto y enlace correctos', () => {
  const s = state(10, [B('10:00'), B('11:00'), B('12:00', { status: 'mastered' }), B('13:00', { status: 'missed' }), B('14:00', { kind: 'study', courseId: 'general' })]);
  const items = reminderItems(s, { now: NOW, until: NOW + 12 * 3600000 });
  assert.deepEqual(items.map((i) => i.title), ['11:00 · Clase 11:00', '14:00 · Clase 14:00']);
  assert.equal(items[0].body, 'Física I · empieza en 10 min.');
  assert.equal(items[1].body, 'Empieza en 10 min.', 'sin curso «general» en el texto');
  assert.equal(items[1].url, './index.html#/sesion/b-1400');
  assert.equal(items[0].expire, new Date(2026, 9, 17, 11, 5).getTime(), 'caduca 5 min después del inicio');
});

test('al abrir tarde (late): avisa lo que aún no empezó con los minutos reales', () => {
  const s = state(30, [B('10:40')]);
  assert.equal(reminderItems(s, { now: NOW }).length, 0, 'sin late: el aviso de las 10:10 ya pasó');
  const [it] = reminderItems(s, { now: NOW, late: true });
  assert.equal(it.body, 'Física I · empieza en 10 min.');
  assert.equal(it.at, NOW);
});

test('etiqueta estable, sin datos legibles, distinta si cambia la hora o la anticipación', () => {
  const b = B('11:00');
  assert.equal(reminderTag(b, 10), reminderTag({ ...b }, 10));
  assert.notEqual(reminderTag(b, 10), reminderTag({ ...b, start: '11:30' }, 10));
  assert.notEqual(reminderTag(b, 10), reminderTag(b, 5));
  assert.match(reminderTag(b, 10), /^b-[a-z0-9]+$/);
  assert.ok(!reminderTag(b, 10).includes('Clase'));
});

test('límite y horizonte de la cola (7 días, máx. 60)', () => {
  const blocks = [];
  for (let d = 0; d < 10; d++) for (let h = 8; h < 20; h++) blocks.push(newBlock({ id: `x${d}-${h}`, date: `2026-10-${String(17 + d).padStart(2, '0')}`, start: `${String(h).padStart(2, '0')}:00`, end: `${String(h).padStart(2, '0')}:30`, title: 'x', kind: 'personal' }));
  const items = reminderItems(state(10, blocks), { now: NOW, until: NOW + 7 * 86400000, max: 60 });
  assert.equal(items.length, 60);
  assert.ok(items.every((i, k) => k === 0 || items[k - 1].at <= i.at), 'ordenados por hora');
});
