// Exporta los siete días visibles. Solo lee el estado: no cambia el horario.
import { addDays, isValidDate, todayISO } from '../core/dates.js';
import { KIND_LABEL, statusLabel } from '../core/model.js';

function cell(value) {
  let text = String(value ?? '');
  // Los textos del usuario se abren como texto, nunca como fórmulas de una hoja.
  if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function weekCSV(state, from = todayISO()) {
  if (!isValidDate(from)) throw Error('La fecha de la semana no es válida.');
  const until = addDays(from, 6);
  const rows = [['Fecha', 'Desde', 'Hasta', 'Actividad', 'Curso o área', 'Tipo', 'Estado', 'Notas']];
  const courses = new Map(state.courses.map(c => [c.id, c.name]));
  const blocks = state.blocks.filter(b => b.date >= from && b.date <= until)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  for (const b of blocks) rows.push([b.date, b.start, b.end, b.title, courses.get(b.courseId) || '',
    KIND_LABEL[b.kind] || b.kind, statusLabel(b), b.notes || '']);
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
