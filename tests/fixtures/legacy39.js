// Estado tal como lo guardaba Brújula 3.9 (version 2), construido con la misma
// semilla de ejemplo que traía la app, con estados variados.
export function legacyState() {
  let n = 0;
  const id = () => `1760000000000-${(n++).toString(36).padStart(5, 'a')}`;
  const blocks = [];
  const add = (date, start, end, courseId, title, kind = 'study', goal = '', difficulty = 4, priority = 'normal', status = 'scheduled', extra = {}) =>
    blocks.push({ id: id(), date, start, end, courseId, title, kind, goal, difficulty, priority, status, reviewDate: '', notes: '', attempt: '', revealed: 0, stage: 0, lesson: {}, ...extra });
  add('2026-10-16', '19:00', '21:30', 'vida', 'Recuperación: descansar y dormir', 'personal', 'Hoy no hay estudio.', 1, 'normal', 'mastered');
  add('2026-10-17', '08:30', '10:00', 'fis', 'Fundamentos y unidades', 'study', 'Entender magnitudes.', 5, 'high', 'mastered');
  add('2026-10-17', '10:15', '11:45', 'fis', 'Vectores: magnitud y dirección', 'study', 'Sumar vectores.', 5, 'high', 'review', { reviewDate: '2026-10-18', notes: 'me confundo con el sentido' });
  add('2026-10-17', '14:00', '15:30', 'fis', 'MRU desde cero', 'study', 'Resolver MRU.', 5, 'high');
  add('2026-10-17', '15:45', '16:45', 'mat', 'Matemáticas para Física: despejes', 'study', 'Despejar.', 4, 'high');
  add('2026-10-18', '08:30', '10:00', 'fis', 'Cinemática: aceleración', 'study', 'Identificar datos.', 5, 'high');
  add('2026-10-18', '14:00', '15:30', 'fis', 'Simulacro de Física I', 'study', 'Practicar bajo tiempo.', 5, 'critical');
  add('2026-10-19', '08:30', '10:00', 'fis', 'Repaso: Vectores: magnitud y dirección', 'study', 'Volver.', 5, 'high', 'scheduled', { sourceReviewId: 'x' });
  add('2026-10-20', '09:00', '11:00', 'fis', 'Examen de Física I', 'exam', 'Revisar ubicación.', 5, 'critical');
  add('2026-10-21', '15:00', '16:00', 'cpp', 'C++: variables y entrada/salida', 'study', 'Programa simple.', 4, 'normal', 'missed', { lastReason: 'me quedé dormido' });
  add('2026-10-21', '17:00', '17:30', 'vida', 'Entrenamiento suave en casa', 'personal', 'Calentar.', 1);
  add('2026-10-23', '07:00', '11:00', 'fis', 'Bloque de clase del viernes (confirmar)', 'class', 'Ajusta.', 3);
  return {
    version: 2,
    courses: [
      { id: 'fis', name: 'Física I', color: '#4286a9', difficulty: 5 }, { id: 'mat', name: 'Matemáticas de apoyo', color: '#a878c7', difficulty: 4 },
      { id: 'cpp', name: 'C++ y algoritmos', color: '#5374ba', difficulty: 4 }, { id: 'vida', name: 'Vida y bienestar', color: '#a77178', difficulty: 1 },
    ],
    blocks,
    events: [{ id: 'e1', at: '2026-10-17T13:00:00.000Z', blockId: blocks[1].id, course: 'Física I', title: 'Fundamentos y unidades', status: 'mastered', reason: '' }],
    habits: { '2026-10-16': { sleep: true, move: false } },
    journal: { '2026-10-16': { win: 'Hice dos ejercicios', improve: '', joy: 'caminar' } },
    timer: { running: true, endAt: 1760000000000, remaining: 700, mode: 'focus', blockId: null, cycles: 2 },
    preferences: { wake: '07:00', sleep: '22:30', breakMins: 15, lunchStart: '12:30', lunchEnd: '13:30', reminders: true, replanMode: 'mixed' },
    latestMove: null, latestAutomation: null, unknownFieldFromFuture: { keep: true },
    savedAt: 1760700000000,
  };
}
