// Brújula 4 · acciones del dominio: resultados de sesiones, reprogramación por modos,
// repasos, temas, evaluaciones, dificultades y hábitos. Todo cambio pasa por `change()`
// (deshacer + historial) y las reglas críticas las aplica el planificador local.

import { store, change, commit } from '../core/store.js';
import { newBlock, newTopic, newEvaluation, makeEvent, pushEvent, courseOf, topicTitleFrom, prefs, MODES, isUsableBlock } from '../core/model.js';
import { todayISO, addDays, toMin, toHHMM, fmtDayShort, fmtRange, fmtRelDay, blockMinutes, diffDays } from '../core/dates.js';
import { esc, gid, norm, cut, plural } from '../core/util.js';
import { rulesFrom } from '../engine/rules.js';
import { findSlot, suggestSlots, isLocked, isFlexible, isFixedKind, planExamPrep, planWeek } from '../engine/scheduler.js';
import { rankPriorities } from '../engine/priority.js';
import { gradeTopic, outcomeToGrade, nextEvaluationFor, GRADE_LABEL } from '../engine/srs.js';
import { toast, openSheet, confirmSheet } from '../ui/feedback.js';
import { openProposal } from '../ui/proposal.js';
import { icon } from '../ui/icons.js';
import { undoToast } from './undo-toast.js';

const S = () => store.state;
export const findBlock = (id) => S().blocks.find((b) => b.id === id);
export const findTopic = (id) => S().topics.find((t) => t.id === id);
export const findEval = (id) => S().evaluations.find((e) => e.id === id);
const ctx = (excludeIds) => ({ blocks: S().blocks, rules: rulesFrom(S().preferences), now: new Date(), excludeIds });
const when = (slot) => `${fmtRelDay(slot.date, todayISO())} ${fmtRange(slot.start, slot.end)}`;
export const mode = () => (['confirm', 'mixed', 'flex'].includes(prefs(S()).replanMode) ? prefs(S()).replanMode : 'confirm');

// ——— Resultado de una actividad ———

const OUTCOME_TEXT = { mastered: 'Hecho. ¡Bien!', review: 'Anotado para repasar.', progress: 'Guardado como en proceso.', paused: 'Sesión pausada.', missed: 'Registrada como no realizada.' };

/** Busca o crea el tema de una sesión de estudio y aplica la calificación del resultado. */
function linkTopicAndGrade(s, x, status) {
  if (x.kind !== 'study' || !['mastered', 'review', 'progress'].includes(status)) return null;
  let t = x.topicId ? s.topics.find((y) => y.id === x.topicId) : null;
  if (!t) {
    const title = topicTitleFrom(x.title);
    if (!title) return null;
    t = s.topics.find((y) => y.courseId === x.courseId && norm(y.title) === norm(title));
    if (!t) { t = newTopic({ courseId: x.courseId, title, difficulty: Number(x.difficulty) || 3, origin: 'session' }); s.topics.push(t); }
    x.topicId = t.id;
  }
  const ev = nextEvaluationFor(s, t);
  Object.assign(t, gradeTopic(t, outcomeToGrade(status), { today: todayISO(), examDate: ev?.date }));
  return t;
}

/**
 * Registra el resultado y, según el modo, propone o aplica la reprogramación.
 * status: mastered | review | progress | paused | missed
 */
export async function setOutcome(id, status, { reason = '', difficulty = null, quiet = false } = {}) {
  const b = findBlock(id);
  if (!b) return;
  if (status === 'missed' && isFixedKind(b.kind)) { toast('Las clases y exámenes no se marcan como «no hecho».', { tone: 'warn' }); return; }
  const { entry } = change({
    label: `Resultado de «${cut(b.title, 40)}»`, type: 'status', blockIds: [b.id], topicIds: b.topicId ? [b.topicId] : [],
    mutate(s) {
      const x = s.blocks.find((y) => y.id === id);
      x.status = status;
      x.decisionDismissed = false;
      if (reason) x.lastReason = reason;
      if (status === 'review') x.reviewDate = addDays(todayISO(), 1);
      if (status === 'mastered') { x.reviewDate = ''; x.doneAt = new Date().toISOString(); }
      linkTopicAndGrade(s, x, status);
      if (x.kind==='personal' && x.habitId) {
        s.habits[x.date] ??= {};
        s.habits[x.date][x.habitId]=s.blocks.some(z=>z.date===x.date&&z.habitId===x.habitId&&z.status==='mastered');
      }
      if (difficulty && (difficulty.text || difficulty.kind)) {
        s.difficulties.unshift({ id: gid(), at: new Date().toISOString(), topicId: x.topicId || null, courseId: x.courseId, blockId: x.id, kind: difficulty.kind || 'other', text: String(difficulty.text || '').slice(0, 300), resolved: false });
      }
    },
    event: { block: b, status, reason, type: 'status' },
  });
  if (status === 'missed') return afterMissed(id, entry);
  if (status === 'review') return afterReview(id, entry);
  if (!quiet) undoToast(OUTCOME_TEXT[status] || 'Guardado.', entry);
}

// ——— Reprogramación según el modo ———

export function moveBlock(id, slot, { reason = 'Reprogramación confirmada', type = 'move' } = {}) {
  const b = findBlock(id);
  const { entry } = change({
    label: `Mover «${cut(b.title, 40)}»`, type, blockIds: [id],
    mutate(s) {
      const x = s.blocks.find((y) => y.id === id);
      const old = { date: x.date, start: x.start, end: x.end, status: x.status, reviewDate: x.reviewDate };
      x.date = slot.date; x.start = slot.start; x.end = slot.end; x.status = 'scheduled'; x.reviewDate = ''; x.decisionDismissed = false;
      s.latestMove = { id, old, next: { date: x.date, start: x.start, end: x.end }, at: Date.now() };
      s.latestAutomation = { type: 'move', id, at: Date.now() };
    },
    event: { block: b, status: 'scheduled', reason: `${reason}: ${fmtDayShort(b.date)} ${b.start} → ${fmtDayShort(slot.date)} ${slot.start}`, type },
  });
  return entry;
}

function slotsFor(b) {
  const duration = blockMinutes(b);
  const c = ctx(new Set([b.id]));
  const opts = { duration, kind: b.kind, preferStart: toMin(b.start), avoid: { date: b.date, start: toMin(b.start) }, days: 10 };
  return { best: findSlot(c, opts), alternatives: suggestSlots(c, { ...opts, limit: 5, perDay: 2 }) };
}

async function afterMissed(id) {
  const b = findBlock(id);
  if (!b || !isFlexible(b)) { toast(OUTCOME_TEXT.missed); return; }
  const m = mode();
  const auto = m === 'flex' || (m === 'mixed' && b.kind === 'personal');
  const { best, alternatives } = slotsFor(b);
  if (!best) { toast('Registrada. No hay un hueco libre en 10 días; muévela a mano.', { tone: 'warn', action: { label: 'Editar', run: () => window.dispatchEvent(new CustomEvent('brujula-edit-block', { detail: id })) } }); return; }
  if (auto) {
    const entry = moveBlock(id, best, { reason: `Reprogramación automática (modo ${MODES[m]})`, type: 'auto-move' });
    undoToast(`Movida a ${when(best)}`, entry);
    return;
  }
  return askMove(b, best, alternatives, { intro: 'No pasa nada. ¿La pasamos a otro momento?' });
}

/** Hoja para elegir el nuevo horario (siempre con confirmación). */
export function askMove(b, best, alternatives, { intro = '' } = {}) {
  const options = [best, ...alternatives.filter((a) => !(a.date === best.date && a.start === best.start))].slice(0, 5);
  const radios = options.map((o, i) => `<label><input type="radio" name="slot" value="${i}" ${i === 0 ? 'checked' : ''}><span>${icon('calendar-clock')}${esc(when(o))}</span></label>`).join('');
  return new Promise((resolve) => {
    const s = openSheet({
      title: 'Elegir otro momento',
      subtitle: esc(cut(b.title, 80)),
      body: `${intro ? `<p class="muted">${esc(intro)}</p>` : ''}<div class="pick" role="radiogroup" aria-label="Horarios libres">${radios}</div>
        <p class="hint">Respeta tu sueño, almuerzo y ${S().preferences?.breakMins ?? 15} min entre actividades. Clases y exámenes no se tocan.</p>`,
      foot: `<button type="button" class="btn" data-sheet-close>Ahora no</button><button type="button" class="btn btn-primary" data-ok>${icon('check')}Mover</button>`,
      onMount(card) {
        card.querySelector('[data-ok]').addEventListener('click', () => {
          const i = Number(card.querySelector('input[name="slot"]:checked')?.value || 0);
          const slot = options[i];
          s.close();
          const entry = moveBlock(b.id, slot, { reason: 'Reprogramación confirmada' });
          undoToast(`Movida a ${when(slot)}`, entry);
          resolve(true);
        });
      },
      onClose: () => resolve(false),
    });
  });
}

/** «Mover» pedido por la persona: siempre muestra opciones. */
export async function proposeMove(id) {
  const b = findBlock(id);
  if (!b) return;
  if (isLocked(b)) { toast(b.status === 'mastered' ? 'Las actividades ya dominadas no se mueven.' : 'Las clases y exámenes están protegidos. Edítalos si cambió el horario oficial.', { tone: 'warn' }); return; }
  const { best, alternatives } = slotsFor(b);
  if (!best) { toast('No encontré un hueco que respete tus descansos en 10 días.', { tone: 'warn' }); return; }
  return askMove(b, best, alternatives);
}

// ——— Repasos ———

function reviewBlockFor(b, slot) {
  const topicTitle = topicTitleFrom(b.title) || b.title;
  return newBlock({
    ...slot, courseId: b.courseId, title: ('Repaso: ' + topicTitle).slice(0, 130), kind: 'study',
    goal: 'Volver al tema que no quedó claro y resolver un ejercicio sin ayuda.', difficulty: Number(b.difficulty) || 3,
    priority: 'high', sourceReviewId: b.id, topicId: b.topicId || undefined, lesson: { ...(b.lesson || {}) }, origin: 'review',
  });
}

function reviewSlot(b, topic) {
  const rules = rulesFrom(S().preferences);
  const today = todayISO();
  const from = topic?.srs?.due && topic.srs.due > today ? topic.srs.due : addDays(today, 1);
  const c = ctx();
  const opts = { duration: rules.reviewMin, kind: 'study', fromDate: from, preferStart: toMin(b.start), days: 10 };
  return { best: findSlot(c, opts), alternatives: suggestSlots(c, { ...opts, limit: 5, perDay: 2 }) };
}

async function afterReview(id) {
  const b = findBlock(id);
  if (!b || b.kind !== 'study') { toast(OUTCOME_TEXT.review); return; }
  const today = todayISO();
  if (S().blocks.some((x) => x.sourceReviewId === b.id && x.status === 'scheduled' && x.date >= today)) { toast('Anotado. Ese tema ya tiene un repaso programado.'); return; }
  const topic = b.topicId ? findTopic(b.topicId) : null;
  const { best, alternatives } = reviewSlot(b, topic);
  if (!best) { toast('Anotado para repasar. No encontré un hueco libre en 10 días.', { tone: 'warn' }); return; }
  if (mode() !== 'confirm') {
    const entry = createBlocks([reviewBlockFor(b, best)], { label: `Repaso de «${cut(b.title, 40)}»`, reason: `Repaso espaciado automático (modo ${MODES[mode()]})`, type: 'auto-review' });
    undoToast(`Repaso programado ${when(best)}`, entry);
    return;
  }
  return askReview(b, best, alternatives);
}

export function askReview(b, best, alternatives) {
  const rules = rulesFrom(S().preferences);
  const options = [best, ...alternatives.filter((a) => !(a.date === best.date && a.start === best.start))].slice(0, 5);
  const radios = options.map((o, i) => `<label><input type="radio" name="slot" value="${i}" ${i === 0 ? 'checked' : ''}><span>${icon('calendar-clock')}${esc(when(o))}</span></label>`).join('');
  return new Promise((resolve) => {
    const s = openSheet({
      title: `¿Programo un repaso de ${rules.reviewMin} min?`,
      subtitle: esc(cut(b.title, 80)),
      body: `<p class="muted">Repasar al día siguiente fija mejor lo que costó. Elige el momento:</p><div class="pick" role="radiogroup" aria-label="Horarios libres">${radios}</div>`,
      foot: `<button type="button" class="btn" data-sheet-close>Ahora no</button><button type="button" class="btn btn-primary" data-ok>${icon('rotate-ccw')}Programar</button>`,
      onMount(card) {
        card.querySelector('[data-ok]').addEventListener('click', () => {
          const slot = options[Number(card.querySelector('input[name="slot"]:checked')?.value || 0)];
          s.close();
          const entry = createBlocks([reviewBlockFor(b, slot)], { label: `Repaso de «${cut(b.title, 40)}»`, reason: 'Repaso confirmado', type: 'review' });
          undoToast(`Repaso programado ${when(slot)}`, entry);
          resolve(true);
        });
      },
      onClose: () => resolve(false),
    });
  });
}

export function createBlocks(blocks, { label = 'Nuevas actividades', reason = '', type = 'add' } = {}) {
  const { entry } = change({
    label, type,
    mutate(s) { for (const b of blocks) s.blocks.push(b); s.latestAutomation = blocks[0]?.sourceReviewId ? { type: 'review', id: blocks[0].id, at: Date.now() } : s.latestAutomation; },
    event: { block: blocks[0], status: 'scheduled', reason: reason || label, type },
  });
  return entry;
}

// ——— Modos ———

const MODE_DETAIL = {
  confirm: { title: 'Preguntar', icon: 'hand', text: 'Te propongo cada cambio y tú decides.' },
  mixed: { title: 'Mixto', icon: 'shuffle', text: 'Muevo solas tus tareas personales y creo repasos; el estudio no realizado te lo pregunto.' },
  flex: { title: 'Automático', icon: 'zap', text: 'Muevo solas las tareas flexibles (estudio y personales) y creo repasos.' },
};
export const modeDetail = (m) => MODE_DETAIL[m] || MODE_DETAIL.confirm;

export async function changeMode(next) {
  if (!MODE_DETAIL[next] || next === mode()) return;
  if (next !== 'confirm') {
    const ok = await confirmSheet({
      title: `Activar modo ${MODE_DETAIL[next].title}`,
      confirm: 'Activar', cancel: 'Seguir en Preguntar',
      details: `<div class="stack"><p>${esc(MODE_DETAIL[next].text)}</p>
        <div class="notice">${icon('shield-check')}<div><b>Siempre protegido:</b> clases, exámenes, temas dominados, tu sueño, tu almuerzo y los descansos entre actividades. Si no hay hueco, no muevo nada.</div></div>
        <div class="notice">${icon('undo-2')}<div>Cada cambio automático se puede <b>deshacer</b> y queda en tu historial. Solo actúa cuando tú marcas «No lo hice» o «Repasar»; nunca por la hora.</div></div>
        <p class="hint">Gemini solo aplica cambios directamente si activaste «Asistente directo» en Ajustes; las reglas de protección siguen vigentes.</p></div>`,
    });
    if (!ok) return;
  }
  const s = S();
  s.preferences = { ...prefs(s), replanMode: next, replanConsentAt: next === 'confirm' ? null : new Date().toISOString() };
  pushEvent(s, makeEvent(s, { status: 'progress', type: 'mode', title: `Modo ${MODE_DETAIL[next].title}`, course: 'Brújula', reason: next === 'confirm' ? 'Vuelve a preguntar antes de cada cambio' : 'Activado con consentimiento' }));
  commit();
  toast(`Modo ${MODE_DETAIL[next].title} activo.`, { tone: 'ok' });
}

// ——— Decisiones pendientes ———

export function dismissOldDecisions(ids) {
  const { entry } = change({
    label: 'Dejar de preguntar', type: 'dismiss', blockIds: ids,
    mutate(s) { for (const id of ids) { const x = s.blocks.find((b) => b.id === id); if (x) x.decisionDismissed = true; } },
  });
  undoToast(`${plural(ids.length, 'actividad archivada', 'actividades archivadas')}. Siguen en tu historial.`, entry);
}

// ——— Temas ———

export function saveTopic(fields, id = null) {
  const prereqs = (fields.prereqIds || []).filter((p) => p && p !== id);
  if (id && createsCycle(id, prereqs)) { toast('Ese requisito crearía un ciclo entre temas.', { tone: 'warn' }); return null; }
  const { result } = change({
    label: id ? 'Editar tema' : 'Nuevo tema', type: 'topic', topicIds: id ? [id] : [],
    mutate(s) {
      if (id) { const t = s.topics.find((x) => x.id === id); Object.assign(t, { ...fields, prereqIds: prereqs, updatedAt: new Date().toISOString() }); return t; }
      const t = newTopic({ ...fields, prereqIds: prereqs, origin: 'user' });
      s.topics.push(t);
      return t;
    },
  });
  return result;
}

function createsCycle(id, prereqs) {
  const map = new Map(S().topics.map((t) => [t.id, t.id === id ? prereqs : t.prereqIds || []]));
  const seen = new Set();
  const visit = (x) => { if (x === id && seen.size) return true; if (seen.has(x)) return false; seen.add(x); return (map.get(x) || []).some(visit); };
  return prereqs.some((p) => { seen.clear(); seen.add('__start'); return visit(p); });
}

export function deleteTopic(id) {
  const t = findTopic(id);
  const { entry } = change({
    label: `Eliminar tema «${cut(t?.title, 40)}»`, type: 'topic', topicIds: [id], blockIds: S().blocks.filter((b) => b.topicId === id).map((b) => b.id),
    evaluationIds: S().evaluations.filter((e) => (e.topicIds || []).includes(id)).map((e) => e.id),
    mutate(s) {
      s.topics = s.topics.filter((x) => x.id !== id);
      for (const b of s.blocks) if (b.topicId === id) delete b.topicId;
      for (const e of s.evaluations) e.topicIds = (e.topicIds || []).filter((x) => x !== id);
      for (const x of s.topics) x.prereqIds = (x.prereqIds || []).filter((p) => p !== id);
    },
  });
  undoToast('Tema eliminado. Sus sesiones siguen en el horario.', entry);
}

export function reviewTopic(id, grade) {
  const t = findTopic(id);
  if (!t) return;
  const { entry } = change({
    label: `Repaso de «${cut(t.title, 40)}»`, type: 'topic-review', topicIds: [id],
    mutate(s) { const x = s.topics.find((y) => y.id === id); const ev = nextEvaluationFor(s, x); Object.assign(x, gradeTopic(x, grade, { today: todayISO(), examDate: ev?.date })); },
    event: { status: grade === 'again' ? 'review' : 'mastered', type: 'topic-review', title: t.title, course: courseOf(S(), t.courseId).name, reason: `Repaso: ${GRADE_LABEL[grade]}` },
  });
  const nt = findTopic(id);
  undoToast(`${GRADE_LABEL[grade]} · próximo repaso ${fmtRelDay(nt.srs.due, todayISO())}`, entry);
}

/** Programa una sesión para un tema (pregunta el momento). */
export async function scheduleTopic(id, { title = null } = {}) {
  const t = findTopic(id);
  if (!t) return;
  const rules = rulesFrom(S().preferences);
  const due = t.srs?.due && t.srs.due > todayISO() ? t.srs.due : todayISO();
  const isReview = t.level === 'review' || (t.srs?.due && t.srs.due <= todayISO());
  const duration = isReview ? rules.reviewMin : rules.sessionMin;
  const c = ctx();
  const opts = { duration, kind: 'study', fromDate: due, preferStart: 16 * 60, days: 10 };
  const best = findSlot(c, opts);
  if (!best) { toast('No encontré un hueco libre que respete tus descansos.', { tone: 'warn' }); return; }
  const alternatives = suggestSlots(c, { ...opts, limit: 5, perDay: 2 });
  const block = (slot) => newBlock({ ...slot, courseId: t.courseId, title: (title || (isReview ? 'Repaso: ' : 'Estudiar: ') + t.title).slice(0, 130), kind: 'study', goal: isReview ? 'Recordar sin mirar y resolver un ejercicio.' : 'Entender la idea central y practicar un ejemplo.', difficulty: Number(t.difficulty) || 3, priority: 'high', topicId: t.id, lesson: { ...(t.lesson || {}) }, origin: 'topic' });
  const options = [best, ...alternatives.filter((a) => !(a.date === best.date && a.start === best.start))].slice(0, 5);
  const radios = options.map((o, i) => `<label><input type="radio" name="slot" value="${i}" ${i === 0 ? 'checked' : ''}><span>${icon('calendar-clock')}${esc(when(o))}</span></label>`).join('');
  const s = openSheet({
    title: isReview ? `Repasar ${t.title}` : `Estudiar ${t.title}`,
    subtitle: `${duration} min · ${esc(courseOf(S(), t.courseId).name)}`,
    body: `<div class="pick" role="radiogroup" aria-label="Horarios libres">${radios}</div>`,
    foot: `<button type="button" class="btn" data-sheet-close>Cancelar</button><button type="button" class="btn btn-primary" data-ok>${icon('calendar-plus')}Programar</button>`,
    onMount(card) {
      card.querySelector('[data-ok]').addEventListener('click', () => {
        const slot = options[Number(card.querySelector('input[name="slot"]:checked')?.value || 0)];
        s.close();
        const entry = createBlocks([block(slot)], { label: `Sesión de «${cut(t.title, 40)}»`, reason: 'Sesión programada desde el tema', type: 'topic-session' });
        undoToast(`Programado ${when(slot)}`, entry);
      });
    },
  });
}

// ——— Evaluaciones ———

export function saveEvaluation(fields, id = null, { withBlock = true } = {}) {
  const { result, entry } = change({
    label: id ? 'Editar evaluación' : 'Nueva evaluación', type: 'evaluation', evaluationIds: id ? [id] : [],
    blockIds: id && findEval(id)?.blockId ? [findEval(id).blockId] : [],
    mutate(s) {
      let ev = id ? s.evaluations.find((e) => e.id === id) : null;
      if (ev) Object.assign(ev, fields);
      else { ev = newEvaluation({ ...fields, origin: 'user' }); s.evaluations.push(ev); }
      // Bloque del calendario para exámenes/prácticas con hora (protege ese horario).
      if (withBlock && ev.time && ['exam', 'quiz', 'presentation'].includes(ev.type)) {
        const dur = Number(fields.duration) || 120;
        const start = toMin(ev.time), end = Math.min(23 * 60 + 59, start + dur);
        let b = ev.blockId ? s.blocks.find((x) => x.id === ev.blockId) : null;
        if (b) Object.assign(b, { date: ev.date, start: ev.time, end: toHHMM(end), title: ev.title, courseId: ev.courseId });
        else { b = newBlock({ date: ev.date, start: ev.time, end: toHHMM(end), title: ev.title, courseId: ev.courseId, kind: 'exam', priority: 'critical', difficulty: 4, evaluationId: ev.id, origin: 'evaluation' }); s.blocks.push(b); ev.blockId = b.id; }
      }
      return ev;
    },
  });
  undoToast(id ? 'Evaluación actualizada.' : 'Evaluación guardada.', entry);
  return result;
}

export function deleteEvaluation(id) {
  const ev = findEval(id);
  if (!ev) return;
  const { entry } = change({
    label: `Eliminar «${cut(ev.title, 40)}»`, type: 'evaluation', evaluationIds: [id], blockIds: S().blocks.filter((b) => b.evaluationId === id).map((b) => b.id),
    mutate(s) {
      s.evaluations = s.evaluations.filter((e) => e.id !== id);
      s.blocks = s.blocks.filter((b) => !(b.id === ev.blockId && b.kind === 'exam'));
      for (const b of s.blocks) if (b.evaluationId === id) delete b.evaluationId;
    },
  });
  undoToast('Evaluación eliminada.', entry);
}

export function planExam(id) {
  const ev = findEval(id);
  if (!ev) return;
  const plan = planExamPrep(S(), ev, { rules: rulesFrom(S().preferences), now: new Date() });
  if (plan.daysLeft < 1) { toast('La evaluación es hoy o ya pasó.', { tone: 'warn' }); return; }
  if (!plan.blocks.length) { toast(plan.unscheduled.length ? 'No hay huecos libres antes de la evaluación.' : 'Tus temas ya están listos o tienen sesiones programadas.', { tone: plan.unscheduled.length ? 'warn' : 'ok' }); return; }
  const ops = plan.blocks.map((b) => ({ action: 'add', id: b.id, before: null, after: b, why: b.topicId ? `Dominio ${findTopic(b.topicId)?.mastery ?? 0}%` : '' }));
  openProposal({
    title: `Plan para ${ev.title}`, ops, source: 'plan',
    summary: `${plural(plan.blocks.length, 'sesión', 'sesiones')} en ${plural(plan.daysLeft, 'día', 'días')}.`,
    warnings: plan.unscheduled.length ? [`Sin hueco para: ${plan.unscheduled.join(', ')}. Libera tiempo o súbelo a mano.`] : [],
    eventReason: `Plan de estudio para ${ev.title}`,
  });
}

/** Planifica la próxima semana con las prioridades (propuesta para aprobar). */
export function planWeekFlow() {
  const ranked = rankPriorities(S(), new Date());
  const plan = planWeek(S(), ranked, { rules: rulesFrom(S().preferences), now: new Date() });
  if (!plan.blocks.length) { toast(ranked.some((p) => p.type === 'topic') ? 'Tus temas prioritarios ya tienen sesiones esta semana.' : 'Agrega temas a tus cursos para que pueda planificar tu semana.', { tone: 'ok' }); return; }
  if (prefs(S()).aiDirect && !plan.skipped.length) {
    const entry = createBlocks(plan.blocks, {label:'Plan semanal directo',
      reason:'Distribución solicitada según prioridades y descanso',type:'week-plan'});
    undoToast('Semana organizada · Deshacer',entry);
    return;
  }
  const ops = plan.blocks.map((b) => { const why = b.why; delete b.why; return { action: 'add', id: b.id, before: null, after: b, why }; });
  openProposal({
    title: 'Plan para tu semana', ops, source: 'plan',
    summary: `${plural(plan.blocks.length, 'sesión', 'sesiones')} según tus prioridades, en los días con menos carga.`,
    warnings: plan.skipped.length ? [`Sin hueco para: ${plan.skipped.slice(0, 4).join(', ')}.`] : [],
    eventReason: 'Plan semanal aprobado por ti',
  });
}

export function recordGrade(id, grade, maxGrade) {
  const ev = findEval(id);
  const { entry } = change({ label: 'Nota registrada', type: 'evaluation', evaluationIds: [id], mutate(s) { const e = s.evaluations.find((x) => x.id === id); e.grade = grade === '' || grade == null ? null : Number(grade); e.maxGrade = Number(maxGrade) || 20; e.status = e.grade == null ? 'done' : 'graded'; } });
  undoToast(`Nota guardada para ${cut(ev.title, 40)}.`, entry);
}

// ——— Dificultades ———

export function addDifficulty({ topicId = null, courseId = null, blockId = null, kind = 'other', text = '' }) {
  const t = topicId ? findTopic(topicId) : null;
  const { entry } = change({
    label: 'Dificultad registrada', type: 'difficulty',
    mutate(s) { s.difficulties.unshift({ id: gid(), at: new Date().toISOString(), topicId, courseId: courseId || t?.courseId || null, blockId, kind, text: String(text).slice(0, 300), resolved: false }); },
  });
  undoToast('Dificultad anotada. Subirá la prioridad de ese tema.', entry);
}

export function resolveDifficulty(id, resolved = true) {
  change({ label: 'Dificultad resuelta', type: 'difficulty', mutate(s) { const d = s.difficulties.find((x) => x.id === id); if (d) { d.resolved = resolved; d.resolvedAt = resolved ? new Date().toISOString() : null; } } });
  toast(resolved ? 'Marcada como resuelta.' : 'Vuelve a estar pendiente.', { tone: 'ok' });
}

// ——— Hábitos ———

export function toggleHabit(date, habitId) {
  const s = S();
  s.habits[date] ??= {};
  s.habits[date][habitId] = !s.habits[date][habitId];
  for (const b of s.blocks) if(b.date===date&&b.kind==='personal'&&b.habitId===habitId&&['scheduled','mastered'].includes(b.status)) b.status = s.habits[date][habitId]?'mastered':'scheduled';
  commit();
  return s.habits[date][habitId];
}

// ——— Bloques ———

export function deleteBlock(id) {
  const b = findBlock(id);
  if (!b) return;
  const { entry } = change({ label: `Eliminar «${cut(b.title, 40)}»`, type: 'delete', blockIds: [id], mutate(s) { s.blocks = s.blocks.filter((x) => x.id !== id); }, event: { block: b, status: 'missed', reason: 'Actividad eliminada', type: 'delete' } });
  undoToast('Actividad eliminada.', entry);
}

export function blocksOn(date) {
  return S().blocks.filter((b) => isUsableBlock(b) && b.date === date).sort((a, b) => a.start.localeCompare(b.start));
}

export function daysUntil(date) { return diffDays(todayISO(), date); }
