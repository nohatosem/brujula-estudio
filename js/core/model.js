// Brújula 4 · modelo de datos, normalización y migración NO destructiva desde 3.x.
// Regla de oro: los campos de Brújula 3.9 nunca se borran ni se reinterpretan.
// Se mantiene `version: 2` para que un dispositivo con 3.9 en caché pueda seguir
// leyendo la copia; las novedades viven en campos adicionales (schema 4).

import { gid, norm, clone } from './util.js';
import { todayISO, addDays, isValidDate, isValidTime, toMin, diffDays } from './dates.js';

export const APP_VERSION = '4.2.5';
export const SCHEMA = 4;
export const STATE_VERSION = 2;
export const UNDO_LIMIT = 12;
export const EVENTS_LIMIT = 500;

export const KINDS = ['study', 'class', 'exam', 'personal'];
export const KIND_LABEL = { study: 'Estudio', class: 'Clase', exam: 'Examen', personal: 'Personal' };
export const STATUSES = ['scheduled', 'progress', 'mastered', 'review', 'paused', 'missed'];
export const PRIORITIES = ['normal', 'high', 'critical'];
export const PRIORITY_LABEL = { normal: 'Normal', high: 'Alta', critical: 'Urgente' };
export const EVAL_TYPES = { exam: 'Examen', quiz: 'Práctica calificada', assignment: 'Entrega', project: 'Proyecto', presentation: 'Exposición' };
export const DIFFICULTY_KINDS = { concept: 'Concepto', formula: 'Fórmula', algebra: 'Álgebra', units: 'Unidades', time: 'Tiempo', other: 'Otro' };
export const MODES = { confirm: 'Preguntar', mixed: 'Mixto', flex: 'Automático' };

export function statusLabel(b) {
  const s = b?.status;
  if (s === 'mastered') return b.kind === 'study' ? 'Dominado' : 'Hecho';
  return ({ review: 'Por repasar', progress: 'En proceso', scheduled: 'Programado', paused: 'Pausada', missed: 'No realizada' })[s] || 'Programado';
}

export const DEFAULT_TIMER = { running: false, endAt: 0, remaining: 1500, mode: 'focus', blockId: null, cycles: 0 };

// Valores heredados de 3.9 (mismos nombres y valores por defecto) + nuevos de 4.0.
export const DEFAULT_PREFS = {
  wake: '07:00', sleep: '21:00', breakMins: 15, lunchStart: '12:00', lunchEnd: '13:00', reminders: false, replanMode: 'confirm',
  maxStudyMin: 360, reminderLead: 10, focusMin: 25, breakMin: 5, sessionMin: 45, reviewMin: 25,
  theme: 'auto', aiConsent: false, aiShareSchedule: false, aiDirect: false, aiDirectConsentAt: null, routineConfirmed: false, pushEnabled: false,
};

export const DEFAULT_HABITS = [
  { id: 'sleep', name: 'Dormir y recuperarme', icon: 'moon', active: true },
  { id: 'move', name: 'Moverme', icon: 'dumbbell', active: true },
  { id: 'clean', name: 'Cuidar mi espacio', icon: 'brush-cleaning', active: true },
  { id: 'social', name: 'Conectar con alguien', icon: 'messages-square', active: true },
  { id: 'focus', name: 'Estudiar sin distracciones', icon: 'brain', active: true },
  { id: 'joy', name: 'Algo que disfruto', icon: 'sun', active: true },
];

export const COURSE_COLORS = ['#3F7CAC', '#A3157A', '#2B7448', '#9C4F17', '#6B57B5', '#B3261E', '#1B8A8F', '#8A6200', '#C2477E', '#4E5A55'];

export function blankState() {
  return {
    version: STATE_VERSION, schema: SCHEMA,
    courses: [
      { id: 'general', name: 'Mis estudios', color: '#4286a9', difficulty: 3, importance: 3, credits: null, archived: false },
      { id: 'vida', name: 'Vida y bienestar', color: '#a79b76', difficulty: 2, importance: 3, credits: null, archived: false },
    ],
    blocks: [], topics: [], evaluations: [], difficulties: [], events: [],
    habits: {}, habitDefs: clone(DEFAULT_HABITS), journal: {},
    timer: { ...DEFAULT_TIMER }, preferences: { ...DEFAULT_PREFS }, undo: [],
    savedAt: Date.now(),
  };
}

export function prefs(state) {
  return { ...DEFAULT_PREFS, ...(state?.preferences || {}) };
}

export function newBlock(fields = {}) {
  return {
    id: gid(), date: todayISO(), start: '15:00', end: '16:00', courseId: 'general', title: '', kind: 'study',
    goal: '', difficulty: 3, priority: 'normal', status: 'scheduled', reviewDate: '', notes: '', attempt: '',
    quizAttempt: '', revealed: 0, stage: 0, lesson: {}, ...fields,
  };
}

export function newTopic(fields = {}) {
  const now = new Date().toISOString();
  return {
    id: gid(), courseId: 'general', title: '', difficulty: 3, mastery: 0, level: 'new', prereqIds: [], notes: '',
    lesson: {}, srs: { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: null, last: null }, createdAt: now, updatedAt: now, ...fields,
  };
}

export function newEvaluation(fields = {}) {
  return { id: gid(), courseId: 'general', title: '', type: 'exam', date: todayISO(), time: '', weight: null, topicIds: [], status: 'upcoming', grade: null, maxGrade: 20, blockId: null, notes: '', ...fields };
}

/** Valida y completa un estado importado o leído. Lanza error si no es de Brújula. */
export function normalizeState(v) {
  if (!v || typeof v !== 'object' || ![1, 2].includes(v.version) || !Array.isArray(v.blocks) || !Array.isArray(v.courses)) throw Error('Archivo de Brújula no válido');
  const timer = { ...DEFAULT_TIMER, ...(v.timer && typeof v.timer === 'object' ? v.timer : {}), running: false, remaining: 1500 };
  const out = {
    ...v, version: STATE_VERSION,
    events: Array.isArray(v.events) ? v.events : [],
    habits: v.habits && typeof v.habits === 'object' ? v.habits : {},
    journal: v.journal && typeof v.journal === 'object' ? v.journal : {},
    savedAt: Number(v.savedAt) || Date.now(),
    timer,
  };
  out.courses = out.courses.filter((c) => c && typeof c === 'object' && c.id).map((c) => ({ difficulty: 3, color: '#4286a9', ...c, name: String(c.name || 'Curso') }));
  out.blocks = out.blocks.filter((b) => b && typeof b === 'object' && b.id).map((b) => ({
    goal: '', difficulty: 3, priority: 'normal', status: 'scheduled', reviewDate: '', notes: '', attempt: '', quizAttempt: '', revealed: 0, stage: 0, lesson: {}, kind: 'study',
    ...b, title: String(b.title ?? ''),
  }));
  return out;
}

/** ¿Se puede mostrar y calcular con este bloque? (fecha y horas válidas). */
export const isUsableBlock = (b) => !!b && isValidDate(b.date) && isValidTime(b.start) && isValidTime(b.end) && toMin(b.end) > toMin(b.start);

export function isBlankState(s) {
  if (!s) return true;
  const defaultCourses = (s.courses || []).every((c) => ['general', 'vida'].includes(c.id));
  return !(s.blocks || []).length && !(s.topics || []).length && !(s.evaluations || []).length && defaultCourses
    && !Object.keys(s.journal || {}).length && !Object.keys(s.habits || {}).length;
}

export function summarize(s, today = todayISO()) {
  const blocks = s?.blocks || [];
  return {
    blocks: blocks.length,
    upcoming: blocks.filter((b) => b.date >= today).length,
    courses: (s?.courses || []).length,
    topics: (s?.topics || []).length,
    savedAt: Number(s?.savedAt) || 0,
  };
}

// ——— Migración a schema 4 ———

const REVIEW_PREFIX = /^\s*(repaso|repasar|review)\s*(de|del)?\s*[:\-–—]?\s*/i;
const NOT_A_TOPIC = /simulacro|examen de pr[aá]ctica|repasar errores|errores de|bloque de clase|recuperaci[oó]n|descans/i;

export function topicTitleFrom(title) {
  const t = String(title || '').replace(REVIEW_PREFIX, '').trim();
  if (!t || NOT_A_TOPIC.test(t)) return '';
  return t.slice(0, 120);
}

const STATUS_MASTERY = { mastered: 85, review: 30, progress: 45, paused: 30 };

/**
 * Migra en el sitio (sobre una copia que entregue quien llama). Idempotente.
 * No modifica savedAt: la migración es una transformación determinista y no
 * debe provocar conflictos de sincronización por sí sola.
 */
export function migrateToV4(s, { today = todayISO(), nowISO = new Date().toISOString() } = {}) {
  const report = { from: Number(s.schema) || 2, topics: 0, evaluations: 0, linked: 0 };
  s.topics = Array.isArray(s.topics) ? s.topics : [];
  s.evaluations = Array.isArray(s.evaluations) ? s.evaluations : [];
  s.difficulties = Array.isArray(s.difficulties) ? s.difficulties : [];
  s.habitDefs = Array.isArray(s.habitDefs) && s.habitDefs.length ? s.habitDefs : clone(DEFAULT_HABITS);
  s.undo = Array.isArray(s.undo) ? s.undo.slice(0, UNDO_LIMIT) : [];
  s.preferences = { ...DEFAULT_PREFS, ...(s.preferences || {}) };
  if (!['confirm', 'mixed', 'flex'].includes(s.preferences.replanMode)) s.preferences.replanMode = 'confirm';
  s.courses = s.courses.map((c) => ({ importance: 3, credits: null, archived: false, ...c }));
  if (report.from >= SCHEMA) { s.schema = SCHEMA; return report; }

  // 1) Temas a partir de las sesiones de estudio existentes.
  const groups = new Map();
  const sorted = [...s.blocks].filter(isUsableBlock).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  for (const b of sorted) {
    if (b.kind !== 'study' || b.topicId) continue;
    const title = topicTitleFrom(b.title);
    if (!title) continue;
    const key = (b.courseId || 'general') + '|' + norm(title);
    if (!groups.has(key)) groups.set(key, { title, courseId: b.courseId || 'general', blocks: [] });
    groups.get(key).blocks.push(b);
  }
  for (const g of groups.values()) {
    const existing = s.topics.find((t) => t.courseId === g.courseId && norm(t.title) === norm(g.title));
    const decided = g.blocks.filter((b) => b.status && b.status !== 'scheduled' && b.status !== 'missed');
    const last = decided[decided.length - 1];
    const mastery = last ? (STATUS_MASTERY[last.status] ?? 0) : 0;
    const level = !last ? 'new' : last.status === 'mastered' ? 'mastered' : last.status === 'review' ? 'review' : 'learning';
    const due = level === 'review' ? (isValidDate(last.reviewDate) ? last.reviewDate : today) : null;
    const topic = existing || newTopic({
      courseId: g.courseId, title: g.title,
      difficulty: Math.max(1, Math.min(5, Math.max(...g.blocks.map((b) => Number(b.difficulty) || 3)))),
      mastery, level,
      srs: { ease: 2.5, interval: level === 'mastered' ? 7 : 0, reps: level === 'mastered' ? 1 : 0, lapses: level === 'review' ? 1 : 0, due, last: last ? last.date : null },
      createdAt: nowISO, updatedAt: nowISO, origin: 'migration',
    });
    if (!existing) { s.topics.push(topic); report.topics++; }
    for (const b of g.blocks) { b.topicId = topic.id; report.linked++; }
  }

  // 2) Evaluaciones a partir de los bloques de examen.
  for (const b of sorted) {
    if (b.kind !== 'exam') continue;
    if (s.evaluations.some((e) => e.blockId === b.id)) continue;
    const window = (x) => x.courseId === b.courseId && x.date <= b.date && diffDays(x.date, b.date) <= 21;
    const topicIds = [...new Set(sorted.filter((x) => x.topicId && window(x)).map((x) => x.topicId))];
    const ev = newEvaluation({
      courseId: b.courseId || 'general', title: b.title || 'Examen', type: 'exam', date: b.date, time: b.start,
      topicIds, status: b.date < today ? 'done' : 'upcoming', blockId: b.id, notes: b.goal || '', origin: 'migration',
    });
    s.evaluations.push(ev);
    b.evaluationId = ev.id;
    report.evaluations++;
    for (const x of sorted) if (!x.evaluationId && x.kind === 'study' && window(x) && /simulacro|errores/i.test(x.title || '')) x.evaluationId = ev.id;
  }

  s.schema = SCHEMA;
  s.migratedV4At = nowISO;
  return report;
}

/** Carga completa: normaliza + migra sobre una copia. */
export function loadState(raw, opts) {
  const s = normalizeState(clone(raw));
  const report = migrateToV4(s, opts);
  return { state: s, report };
}

// ——— Material de estudio incluido (heredado de 3.x) ———
export const LESSONS = {
  unidades: { intro: 'Una magnitud es algo que puedes medir (como distancia o tiempo). Un número sin unidad puede ser ambiguo. Ejemplo: 5 m indica una longitud, mientras que 5 s indica un tiempo. En física solemos usar metros (m), segundos (s) y kilogramos (kg).', problem: 'Una persona camina 12 metros en 3 segundos. ¿Qué distancia recorre por segundo?', steps: ['Datos: distancia = 12 m y tiempo = 3 s.', 'Buscamos distancia por segundo: 12 m ÷ 3 s.', '12 ÷ 3 = 4. El resultado es 4 m/s.', 'Interpretación: recorrió un promedio de 4 metros cada segundo.'], question: 'Si recorre 20 metros en 5 segundos, ¿cuántos metros por segundo son?', answer: '4 m/s' },
  vectores: { intro: 'Un vector es una cantidad que tiene magnitud y dirección. Piensa en una flecha: su longitud indica cuánto, y su punta indica hacia dónde. En física aparecen en desplazamiento, velocidad y fuerza.', problem: 'Caminas 3 metros hacia el este y después 2 metros hacia el este. ¿Cuál es el desplazamiento resultante?', steps: ['Dibuja dos flechas que apuntan a la derecha.', 'Como ambas tienen la misma dirección y sentido, se suman las magnitudes.', '3 m + 2 m = 5 m.', 'Resultado: 5 metros hacia el este.'], question: 'Si avanzas 4 m al este y 4 m al oeste, ¿cuál es el desplazamiento?', answer: '0 m' },
  mru: { intro: 'En el movimiento rectilíneo uniforme (MRU), un objeto se mueve en línea recta con velocidad constante. Si recorre distancias iguales en tiempos iguales, se comporta así. Fórmula para distancia recorrida: d = v × t.', problem: 'Una bicicleta viaja a 6 m/s durante 4 segundos. ¿Qué distancia recorre?', steps: ['Anota v = 6 m/s y t = 4 s.', 'Usa distancia = velocidad × tiempo: d = v × t.', 'Sustituye: d = 6 × 4.', 'Resultado: d = 24 m.'], question: 'A 3 m/s durante 5 s, ¿qué distancia recorre?', answer: '15 m' },
  cinematica: { intro: 'La cinemática describe cómo se mueven los objetos. Aprende a reconocer qué te preguntan: posición, desplazamiento, velocidad o aceleración. Antes de elegir una fórmula identifica unidades y datos.', problem: 'Un carrito parte del reposo y acelera a 2 m/s² durante 3 s. ¿Cuál es su velocidad final?', steps: ['Datos: velocidad inicial = 0 m/s, aceleración = 2 m/s², tiempo = 3 s.', 'Usa v = v₀ + a × t.', 'Sustituye: v = 0 + 2 × 3.', 'Velocidad final = 6 m/s.'], question: 'Con a = 3 m/s² desde reposo durante 2 s, ¿velocidad final?', answer: '6 m/s' },
  html: { intro: 'HTML describe la estructura del contenido de una página. Una etiqueta tiene, por lo general, apertura y cierre. <h1> define un título principal y <p> un párrafo. HTML no es un lenguaje de programación general.', problem: 'Quieres mostrar el título «Hola» y debajo el texto «Mi página». ¿Cómo lo escribirías?', steps: ['Crea la etiqueta del título: <h1>Hola</h1>.', 'Agrega un párrafo: <p>Mi página</p>.', 'Colócalos dentro de <body> en el archivo HTML.', 'Abre el archivo en un navegador para verlo.'], question: '¿Qué etiqueta usarías para escribir un párrafo?', answer: '<p>' },
  cpp: { intro: 'Una variable guarda un valor que puede cambiar. En C++ debes especificar su tipo, como int para enteros. Una instrucción como int edad = 20; crea una variable entera llamada edad.', problem: 'Declara dos enteros llamados a y b, con valores 3 y 5, y muestra su suma.', steps: ['Incluye <iostream> para mostrar texto.', 'Dentro de main, escribe: int a = 3; int b = 5;', 'Calcula: int suma = a + b;', 'Muestra con std::cout << suma; y prueba que sale 8.'], question: '¿Qué tipo usarías para guardar un número entero?', answer: 'int' },
  cisco: { intro: 'Una red conecta equipos para compartir información. Una dirección IP identifica una interfaz dentro de una red. Un switch conecta equipos locales; un router conecta redes distintas.', problem: 'En Packet Tracer, conecta dos PCs a un switch. ¿Qué necesitas para probar conectividad entre ellas?', steps: ['Coloca un switch y dos PCs en el área de trabajo.', 'Conecta cada PC al switch con el cable apropiado.', 'Asigna IPs de la misma subred, por ejemplo 192.168.1.10/24 y 192.168.1.11/24.', 'Desde una PC realiza ping a la dirección IP de la otra.'], question: '¿Qué dispositivo conecta principalmente diferentes redes?', answer: 'Router' },
  python: { intro: 'Python permite escribir instrucciones simples. Una variable se crea al asignar un valor, por ejemplo: edad = 20. Con print(edad) puedes ver su contenido.', problem: 'Escribe un pequeño programa que almacene 4 y 6 y muestre su suma.', steps: ['Crea a = 4.', 'Crea b = 6.', 'Usa print(a + b).', 'Ejecuta el programa: el resultado es 10.'], question: '¿Qué función muestra información en pantalla?', answer: 'print()' },
  simulacro: { intro: 'Vas a practicar sin apuntes, con tiempo limitado y revisando cada error después. No te apresures a ver la solución: intenta cada problema por separado.', problem: 'Elige cinco ejercicios del material real de tu profesor. Resuélvelos en el tiempo indicado y registra cuáles no lograste completar.', steps: ['Reúne ejercicios solo de los temas incluidos en el examen.', 'Inicia un temporizador y resuelve sin consultar apuntes.', 'Al finalizar, comprueba los resultados y procedimientos.', 'Clasifica errores: concepto, fórmula, álgebra, unidades o tiempo.'], question: '¿Qué tipo de error fue el más frecuente en tu simulacro?', answer: 'Tu propio análisis de los errores.' },
};

/** Material de la sesión: el del bloque, luego el del tema y por último el incluido. */
export function lessonFor(b, topic) {
  const t = (b?.title || '').toLowerCase();
  let key = '';
  if (/simulacro|examen de práctica/.test(t)) key = 'simulacro';
  else if (/vector/.test(t)) key = 'vectores';
  else if (/mru/.test(t)) key = 'mru';
  else if (/cinemática|cinematica|aceleraci/.test(t)) key = 'cinematica';
  else if (/unidades|fundamentos/.test(t)) key = 'unidades';
  else if (b?.courseId === 'web') key = 'html';
  else if (b?.courseId === 'cpp') key = 'cpp';
  else if (b?.courseId === 'net') key = 'cisco';
  else if (b?.courseId === 'py') key = 'python';
  const builtin = LESSONS[key] || {};
  const bl = b?.lesson || {}, tl = topic?.lesson || {};
  const pickText = (k) => bl[k] || tl[k] || builtin[k] || '';
  const steps = bl.steps?.length ? bl.steps : tl.steps?.length ? tl.steps : builtin.steps || [];
  return { intro: pickText('intro'), problem: pickText('problem'), steps, question: pickText('question'), answer: pickText('answer') };
}

/** Evento de historial compatible con 3.x ({id, at, blockId, course, title, status, reason}). */
export function makeEvent(state, { block, status, reason = '', type = 'status', title, course }) {
  const c = block ? (state.courses.find((x) => x.id === block.courseId) || { name: 'Otro' }) : null;
  return {
    id: gid(), at: new Date().toISOString(), blockId: block?.id || '', course: course ?? c?.name ?? 'Brújula',
    title: title ?? block?.title ?? '', status: status || 'progress', reason: String(reason || '').trim(), type,
  };
}

export function pushEvent(state, ev) {
  state.events = [ev, ...(state.events || [])].slice(0, EVENTS_LIMIT);
  return ev;
}

export function courseOf(state, id) {
  return state.courses.find((c) => c.id === id) || { id, name: 'Otro', color: '#77949a', difficulty: 3, importance: 3 };
}

export function addDaysSafe(date, n) { return isValidDate(date) ? addDays(date, n) : addDays(todayISO(), n); }
