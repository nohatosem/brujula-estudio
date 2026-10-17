import test from 'node:test';
import assert from 'node:assert/strict';
import { blankState, newBlock } from '../../js/core/model.js';
import { weekCSV } from '../../js/features/week-export.js';

test('descarga semanal: siete días visibles, ordenados, con notas y sin cambiar el estado', () => {
  const s = blankState();
  s.blocks = [
    newBlock({date:'2026-10-26', title:'Fuera de la semana'}),
    newBlock({date:'2026-10-25', title:'Último día', notes:'Recordar el cuaderno'}),
    newBlock({date:'2026-10-19', title:'Física: vectores', start:'09:00', end:'10:00'}),
    newBlock({date:'2026-10-18', title:'Semana anterior'}),
  ];
  const before = JSON.stringify(s);
  const csv = weekCSV(s, '2026-10-19');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('Física: vectores'));
  assert.ok(csv.includes('Recordar el cuaderno'));
  assert.ok(csv.indexOf('Física: vectores') < csv.indexOf('Último día'));
  assert.ok(!csv.includes('Fuera de la semana'));
  assert.ok(!csv.includes('Semana anterior'));
  assert.equal(JSON.stringify(s), before);
});

test('descarga semanal: conserva comillas y saltos de línea y trata fórmulas como texto', () => {
  const s = blankState();
  s.blocks = [newBlock({date:'2026-10-19', title:'=1+1', notes:'Traer "Física"\nEjercicios, 1 y 2'})];
  const csv = weekCSV(s, '2026-10-19');
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"Traer ""Física""\nEjercicios, 1 y 2"'));
  assert.throws(() => weekCSV(s, '2026-02-31'), /fecha/);
});
