// Brújula 4 · respuestas locales del asistente (sin IA, sin gastar cuota).
// Cubren lo que se resuelve con los datos del dispositivo: qué hacer, horario, cruces,
// exámenes, repasos, descanso y «no pude hacer X».

import { norm, cut, plural, wordOverlap } from '../core/util.js';
import { store } from '../core/store.js';
import { courseOf, prefs, isUsableBlock } from '../core/model.js';
import { todayISO, addDays, fmtRelDay, fmtDuration, fmtRange, fmtIn } from '../core/dates.js';
import { computeFocus, upcomingEvaluations, countdownText } from '../engine/priority.js';
import { conflicts, dayBlocks, isLocked, studyMinutesOn } from '../engine/scheduler.js';
import { dueTopics } from '../engine/srs.js';
import { weekStats } from '../engine/insights.js';
import { rulesFrom } from '../engine/rules.js';

const has = (v, re) => re.test(v);

/** Busca la actividad flexible que la persona menciona («no pude estudiar física»). */
export function matchBlock(text, { flexibleOnly = true } = {}) {
  const s = store.state;
  const v = norm(text);
  const today = todayISO();
  const candidates = s.blocks.filter((b) => isUsableBlock(b) && (!flexibleOnly || !isLocked(b)) && b.date >= addDays(today, -7) && b.date <= addDays(today, 14));
  let best = null;
  for (const b of candidates) {
    const title = norm(b.title), course = norm(courseOf(s, b.courseId).name);
    let score = wordOverlap(text, b.title) * 2 + (v.includes(title) ? 3 : 0) + (course.length > 3 && v.includes(course.split(' ')[0]) ? 1 : 0);
    if (!score) continue;
    score += b.status === 'missed' ? 0.5 : 0;
    score -= Math.abs((new Date(b.date) - new Date(today)) / 86400000) * 0.05;
    if (!best || score > best.score) best = { b, score };
  }
  return best && best.score >= 1 ? best.b : null;
}

const fmtBlock = (b) => `${b.start} ${b.title}`;

export function localReply(text) {
  const s = store.state;
  const v = norm(text);
  const now = new Date();
  const today = todayISO(now);
  const f = computeFocus(s, now);
  const p = prefs(s);
  const r = rulesFrom(s.preferences);

  if (has(v, /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey)\b/) || has(v, /que puedes hacer|ayuda$|^ayuda|como funcionas/)) {
    return { text: 'Puedo decirte qué hacer ahora, revisar tu horario, cruces, exámenes y repasos, y buscar otro momento para algo que no pudiste hacer, sin gastar consultas. Con Gemini puedo explicarte temas, analizar tu semana y proponerte cambios que tú apruebas.', actions: [{ label: '¿Qué hago ahora?', say: '¿Qué hago ahora?' }, { label: 'Analiza mi semana', say: 'Analiza mi semana' }] };
  }

  if (has(v, /(planifica|organiza|arma|prepara|reparte)(me)? (toda )?(mi |la )?semana/) || has(v, /plan (de|para) (la |mi )?semana/)) {
    return { text: 'Armo tu semana con tus prioridades: temas débiles con examen cerca, repasos que tocan y lo pendiente, en los días con menos carga y respetando tu descanso. Lo revisas antes de aplicar.', actions: [{ label: 'Ver plan semanal', act: 'as-week', primary: true }, { label: 'Pedir ideas a Gemini', say: 'Analiza mi semana' }] };
  }

  if (has(v, /(no pude|no hice|no alcance|no llegue|se me paso|mueve|mover|muevelo|reprograma|cambia(r)? (de )?(hora|dia)|pasalo|pasa(r)? para|otro momento|otro horario)/)) {
    const b = matchBlock(text);
    if (b) return { text: `Encontré «${b.title}» (${fmtRelDay(b.date, today)} ${fmtRange(b.start, b.end)}). Busco un hueco que respete tu sueño, tu almuerzo y tus descansos; tú eliges.`, actions: [{ label: 'Buscar otro momento', act: 'as-move', id: b.id }, ...(b.date <= today && b.status !== 'missed' ? [{ label: 'Marcar «No lo hice»', act: 'as-missed', id: b.id }] : [])] };
    if (has(v, /(organiza|planifica|reorganiza)/)) return null;
    const pending = f.decisions.slice(0, 3);
    if (pending.length) return { text: `¿Cuál de estas? ${pending.map((x) => `«${x.title}»`).join(', ')}. También puedes escribir el nombre de la actividad.`, actions: pending.map((x) => ({ label: cut(x.title, 28), act: 'as-move', id: x.id })) };
    return null;
  }

  if (has(v, /(que hago|que sigue|que me toca|ahora que|siguiente|por donde empiezo|que estudio)/)) {
    if (f.current) return { text: `Ahora: «${f.current.title}» hasta las ${f.current.end}.${f.current.kind === 'study' ? ' Abre la sesión guiada y empieza por el objetivo.' : ''}`, actions: f.current.kind === 'study' ? [{ label: 'Empezar sesión', href: `#/sesion/${encodeURIComponent(f.current.id)}` }] : [] };
    const top = f.priorities[0];
    if (f.next) return { text: `Lo siguiente es «${f.next.title}» ${fmtIn(f.minutesToNext)} (${f.next.start}).${top && f.freeNow && f.freeNow.minutes >= 25 ? ` Antes tienes ${fmtDuration(f.freeNow.minutes)} libres: lo más útil sería «${top.title}» (${top.reasons.map((x) => x.text).slice(0, 2).join(', ')}).` : ''}` };
    if (top) return { text: `No tienes nada más programado hoy. Lo más útil ahora: «${top.title}» — ${top.reasons.map((x) => x.text).join(', ')}.`, actions: [{ label: 'Ver prioridades', href: '#/hoy' }] };
    return { text: 'No tienes nada pendiente ni prioridades marcadas. Buen momento para descansar o planificar tus próximos exámenes.' };
  }

  if (has(v, /(cruce|choque|solap|superpo|se cruzan)/)) {
    const c = conflicts(s.blocks, { from: today });
    return c.length ? { text: `Encontré ${plural(c.length, 'cruce', 'cruces')}: ${c.slice(0, 3).map((x) => `«${x.a.title}» y «${x.b.title}» (${fmtRelDay(x.a.date, today)})`).join('; ')}. Abre una para moverla.`, actions: c.slice(0, 2).map((x) => ({ label: `Abrir ${cut(x.b.title, 22)}`, act: 'as-open', id: x.b.id })) } : { text: 'No hay cruces en tu horario desde hoy.' };
  }

  if (has(v, /(examen|examenes|evaluacion|parcial|final|entrega|practica calificada)/) && !has(v, /(explica|que es|como se|resuelve|ejercicio)/)) {
    const list = upcomingEvaluations(s, now, 60);
    if (!list.length) return { text: 'No tienes evaluaciones registradas en los próximos 60 días. Agrégalas en Estudio → Evaluaciones para ver la cuenta regresiva y armar planes.', actions: [{ label: 'Nueva evaluación', href: '#/estudio/evaluaciones' }] };
    const first = list[0];
    if (has(v, /(plan|preparar|prepara|organiza)/)) return { text: `Armo un plan para «${first.title}» (${countdownText(first.daysLeft)}): sesiones repartidas antes, primero los temas débiles, y un simulacro final. Lo revisas antes de aplicarlo.`, actions: [{ label: 'Ver plan propuesto', act: 'as-plan', id: first.id }] };
    return { text: list.slice(0, 4).map((e) => `• ${e.title} (${courseOf(s, e.courseId).name}) — ${countdownText(e.daysLeft)}${e.prep != null ? `, preparación ${e.prep}%` : ''}`).join('\n'), actions: [{ label: 'Plan para ' + cut(first.title, 20), act: 'as-plan', id: first.id }] };
  }

  if (has(v, /(repas|repaso|que repaso|toca repasar)/) && !has(v, /(programa|agenda|crea)/)) {
    const due = dueTopics(s, today);
    return due.length ? { text: `Te ${due.length === 1 ? 'toca repasar' : 'tocan'} ${due.slice(0, 5).map((t) => `«${t.title}»`).join(', ')}${due.length > 5 ? ` y ${due.length - 5} más` : ''}.`, actions: [{ label: 'Ir a repasos', href: '#/estudio/repasos' }] } : { text: 'Hoy no tienes repasos pendientes. Cuando marques «Repasar» en una sesión, aparecerán en el día justo.' };
  }

  if (has(v, /(descans|dormir|sueno|duermo|almuerzo|rutina)/)) {
    return { text: `Protejo tu descanso de ${p.sleep} a ${p.wake}, tu almuerzo de ${p.lunchStart} a ${p.lunchEnd} y ${p.breakMins} min entre actividades. Máximo ${fmtDuration(r.maxStudy)} de estudio al día. Nada automático se programa ahí.`, actions: [{ label: 'Cambiar rutina', act: 'routine' }] };
  }

  if (has(v, /\b(hoy|manana|pasado manana)\b/) && has(v, /(que tengo|horario|agenda|actividades|plan|que hay)/)) {
    const d = has(v, /pasado manana/) ? addDays(today, 2) : has(v, /manana/) ? addDays(today, 1) : today;
    const list = dayBlocks(s.blocks, d);
    return list.length ? { text: `${cap1(fmtRelDay(d, today))}: ${list.map(fmtBlock).join(' · ')}. ${fmtDuration(studyMinutesOn(s.blocks, d))} de estudio.` } : { text: `${cap1(fmtRelDay(d, today))} no tienes nada programado.` };
  }

  if (has(v, /(como voy|mi progreso|cuanto estudie|estadistic|rendimiento)/)) {
    const w = weekStats(s, today, now);
    return { text: `Esta semana: ${fmtDuration(w.done)} estudiados de ${fmtDuration(w.planned)} planificados${w.completion != null ? `, ${w.completion}% de sesiones cumplidas` : ''}. ${dueTopics(s, today).length} repasos pendientes.`, actions: [{ label: 'Ver progreso', href: '#/progreso' }, { label: 'Análisis con Gemini', say: 'Analiza mi semana' }] };
  }
  return null;
}

/** Análisis determinista (sin IA) de los próximos 7 días. */
export function localAnalysis() {
  const s = store.state;
  const now = new Date();
  const today = todayISO(now);
  const r = rulesFrom(s.preferences);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    const m = studyMinutesOn(s.blocks, d);
    if (m > r.maxStudy) out.push({ type: 'risk', title: `${cap1(fmtRelDay(d, today))} está sobrecargado`, detail: `${fmtDuration(m)} de estudio (tu límite es ${fmtDuration(r.maxStudy)}).` });
  }
  const c = conflicts(s.blocks, { from: today });
  if (c.length) out.push({ type: 'risk', title: plural(c.length, 'cruce de horario', 'cruces de horario'), detail: c.slice(0, 2).map((x) => `«${x.a.title}» y «${x.b.title}»`).join('; ') });
  for (const e of upcomingEvaluations(s, now, 10)) if (e.prep != null && e.prep < 60) out.push({ type: 'risk', title: `${e.title} ${countdownText(e.daysLeft)}`, detail: `Preparación ${e.prep}%. Conviene un plan de estudio.` });
  const due = dueTopics(s, today);
  if (due.length) out.push({ type: 'tip', title: plural(due.length, 'repaso pendiente', 'repasos pendientes'), detail: due.slice(0, 3).map((t) => t.title).join(', ') });
  const w = weekStats(s, today, now);
  if (w.completion != null && w.completion >= 70) out.push({ type: 'win', title: `${w.completion}% de sesiones cumplidas`, detail: 'Buen ritmo esta semana.' });
  if (!out.length) out.push({ type: 'win', title: 'Semana equilibrada', detail: 'Sin sobrecargas, cruces ni exámenes en riesgo.' });
  return out;
}

const cap1 = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
