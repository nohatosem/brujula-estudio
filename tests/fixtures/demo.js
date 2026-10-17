// Estado de demostración realista (schema 4) para pruebas visuales y de flujo.
// «Hoy» es sábado 17 de octubre de 2026.
import { blankState, newBlock, newTopic, newEvaluation } from '../../js/core/model.js';
import { addDays, weekdayIndex } from '../../js/core/dates.js';

export function demoState(today = '2026-10-17') {
  const s = blankState();
  s.savedAt = 1760700000000;
  s.courses = [
    { id: 'fis', name: 'Física I', color: '#3F7CAC', difficulty: 5, importance: 5, credits: 4, archived: false },
    { id: 'cal', name: 'Cálculo I', color: '#6B57B5', difficulty: 4, importance: 5, credits: 4, archived: false },
    { id: 'cpp', name: 'Programación en C++', color: '#2B7448', difficulty: 4, importance: 4, credits: 3, archived: false },
    { id: 'net', name: 'Redes y Cisco', color: '#1B8A8F', difficulty: 3, importance: 3, credits: 3, archived: false },
    { id: 'com', name: 'Comunicación', color: '#9C4F17', difficulty: 2, importance: 2, credits: 2, archived: false },
    { id: 'vida', name: 'Vida y bienestar', color: '#a79b76', difficulty: 1, importance: 3, credits: null, archived: false },
  ];
  s.preferences = { ...s.preferences, wake: '07:00', sleep: '23:00', lunchStart: '13:00', lunchEnd: '14:00', breakMins: 15, maxStudyMin: 360, replanMode: 'confirm', routineConfirmed: true };
  let k = 0;
  const id = (p) => `${p}-${(k++).toString().padStart(3, '0')}`;
  const T = (courseId, title, fields = {}) => { const t = newTopic({ id: id('t'), courseId, title, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-10T12:00:00.000Z', ...fields }); s.topics.push(t); return t; };
  const unidades = T('fis', 'Unidades y magnitudes', { mastery: 90, level: 'mastered', difficulty: 2, srs: { ease: 2.6, interval: 9, reps: 3, lapses: 0, due: '2026-10-25', last: '2026-10-16' } });
  const vectores = T('fis', 'Vectores: suma y componentes', { mastery: 45, level: 'learning', difficulty: 4, prereqIds: [unidades.id], srs: { ease: 2.3, interval: 2, reps: 1, lapses: 1, due: '2026-10-19', last: '2026-10-15' } });
  const mru = T('fis', 'MRU', { mastery: 30, level: 'review', difficulty: 3, prereqIds: [unidades.id], srs: { ease: 2.2, interval: 1, reps: 0, lapses: 1, due: today, last: '2026-10-16' } });
  const cine = T('fis', 'Cinemática: aceleración', { mastery: 0, level: 'new', difficulty: 5, prereqIds: [mru.id, vectores.id] });
  const limites = T('cal', 'Límites', { mastery: 55, level: 'learning', difficulty: 4, srs: { ease: 2.4, interval: 2, reps: 1, lapses: 0, due: '2026-10-16', last: '2026-10-14' } });
  const deriv = T('cal', 'Derivadas: reglas básicas', { mastery: 10, level: 'learning', difficulty: 4, prereqIds: [limites.id] });
  const punteros = T('cpp', 'Punteros y referencias', { mastery: 50, level: 'learning', difficulty: 4 });
  const funciones = T('cpp', 'Funciones', { mastery: 88, level: 'mastered', difficulty: 3, srs: { ease: 2.6, interval: 12, reps: 3, lapses: 0, due: '2026-10-28', last: '2026-10-16' } });
  T('net', 'Direccionamiento IP', { mastery: 65, level: 'learning', difficulty: 3, srs: { ease: 2.5, interval: 4, reps: 2, lapses: 0, due: '2026-10-21', last: '2026-10-17' } });
  T('com', 'Ensayo argumentativo', { mastery: 40, level: 'learning', difficulty: 2 });

  const B = (date, start, end, courseId, title, kind = 'study', extra = {}) => { const b = newBlock({ id: id('b'), date, start, end, courseId, title, kind, goal: extra.goal || '', difficulty: extra.difficulty || (kind === 'study' ? 4 : 3), priority: extra.priority || 'normal', status: extra.status || 'scheduled', ...extra }); s.blocks.push(b); return b; };
  // Horario de clases (lunes 12 a viernes 30)
  for (let d = '2026-10-12'; d <= '2026-10-30'; d = addDays(d, 1)) {
    const w = weekdayIndex(d);
    if (w === 0 || w === 2) { B(d, '08:00', '10:00', 'fis', 'Física I · teoría', 'class', { seriesId: 'serie-fis' }); B(d, '14:00', '15:30', 'cpp', 'Programación en C++', 'class', { seriesId: 'serie-cpp' }); }
    if (w === 1 || w === 3) B(d, '08:00', '10:00', 'cal', 'Cálculo I', 'class', { seriesId: 'serie-cal' });
    if (w === 1) B(d, '15:00', '16:30', 'com', 'Comunicación', 'class', { seriesId: 'serie-com' });
    if (w === 4) B(d, '08:00', '11:00', 'net', 'Laboratorio de redes', 'class', { seriesId: 'serie-net' });
  }
  // Pasado reciente
  B('2026-10-15', '17:00', '18:00', 'fis', 'Repaso: MRU', 'study', { status: 'missed', topicId: mru.id, lastReason: 'Sin tiempo' });
  B('2026-10-16', '16:00', '17:00', 'cal', 'Límites: ejercicios', 'study', { topicId: limites.id });
  B('2026-10-16', '18:00', '18:30', 'vida', 'Ordenar el cuarto', 'personal');
  // Hoy (sábado)
  B(today, '08:30', '10:00', 'fis', 'Unidades y magnitudes', 'study', { status: 'mastered', topicId: unidades.id });
  B(today, '10:15', '11:45', 'fis', 'Vectores: suma y componentes', 'study', { topicId: vectores.id, goal: 'Sumar dos vectores con ángulo y hallar sus componentes sin mirar la solución.', priority: 'high', lesson: { question: 'Un vector de 10 m forma 30° con el eje x. ¿Cuánto vale su componente x?', answer: '10·cos 30° ≈ 8,66 m' } });
  B(today, '14:15', '15:15', 'cal', 'Derivadas: reglas básicas', 'study', { topicId: deriv.id });
  B(today, '15:30', '16:15', 'cpp', 'Punteros: 5 ejercicios', 'study', { topicId: punteros.id });
  B(today, '17:30', '18:30', 'vida', 'Entrenar en casa', 'personal');
  B(today, '19:00', '19:30', 'vida', 'Llamar a la familia', 'personal');
  // Próximos días
  B('2026-10-18', '10:00', '11:30', 'fis', 'Cinemática: aceleración', 'study', { topicId: cine.id, priority: 'high' });
  B('2026-10-18', '16:00', '17:00', 'cal', 'Límites: repaso', 'study', { topicId: limites.id });
  B('2026-10-19', '16:00', '17:00', 'fis', 'Simulacro de Física I', 'study', { priority: 'critical' });
  const exam = B('2026-10-20', '10:30', '12:30', 'fis', 'Parcial de Física I', 'exam', { priority: 'critical' });
  B('2026-10-22', '17:00', '18:00', 'cpp', 'Proyecto C++: avance', 'study', { topicId: punteros.id });

  const e1 = newEvaluation({ id: 'ev-fis', courseId: 'fis', title: 'Parcial de Física I', type: 'exam', date: '2026-10-20', time: '10:30', weight: 30, topicIds: [unidades.id, vectores.id, mru.id, cine.id], blockId: exam.id });
  exam.evaluationId = e1.id;
  s.blocks.find((b) => b.title === 'Simulacro de Física I').evaluationId = e1.id;
  const e2 = newEvaluation({ id: 'ev-cpp', courseId: 'cpp', title: 'Entrega: proyecto C++', type: 'assignment', date: '2026-10-23', time: '', weight: 20, topicIds: [punteros.id, funciones.id] });
  const e3 = newEvaluation({ id: 'ev-cal', courseId: 'cal', title: 'Práctica calificada de Cálculo', type: 'quiz', date: '2026-10-26', time: '10:00', weight: 15, topicIds: [limites.id, deriv.id] });
  s.evaluations = [e1, e2, e3];
  s.difficulties = [
    { id: 'd1', at: '2026-10-15T22:00:00.000Z', topicId: vectores.id, courseId: 'fis', blockId: null, kind: 'concept', text: 'Sumar vectores cuando tienen ángulo', resolved: false },
    { id: 'd2', at: '2026-10-14T22:00:00.000Z', topicId: cine.id, courseId: 'fis', blockId: null, kind: 'algebra', text: 'Despejar t en x = x₀ + v₀t + ½at²', resolved: false },
    { id: 'd3', at: '2026-10-13T22:00:00.000Z', topicId: punteros.id, courseId: 'cpp', blockId: null, kind: 'concept', text: 'Confundo * y &', resolved: false },
  ];
  for (let i = 1; i <= 6; i++) { const d = addDays(today, -i); s.habits[d] = { sleep: i % 3 !== 0, move: i % 2 === 0, clean: i === 2, social: i % 3 === 1, focus: i < 5, joy: i % 2 === 1 }; }
  s.habits[today] = { sleep: true };
  s.journal['2026-10-16'] = { win: 'Resolví 3 ejercicios de límites sin ayuda.', improve: 'Empezar el estudio antes de las 16:00.', joy: 'Caminar con mi hermana.' };
  s.events = [{ id: 'ev1', at: '2026-10-17T14:05:00.000Z', blockId: s.blocks.find((b) => b.title === 'Unidades y magnitudes')?.id, course: 'Física I', title: 'Unidades y magnitudes', status: 'mastered', reason: '', type: 'status' }];
  return s;
}
