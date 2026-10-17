// Brújula 4 · Sesión guiada (modo enfoque): preparar → entender → practicar → evaluar → cerrar.

import { esc, cap } from '../core/util.js';
import { store, commit } from '../core/store.js';
import { courseOf, lessonFor, KIND_LABEL, DIFFICULTY_KINDS, prefs } from '../core/model.js';
import { fmtRelDay, fmtRange, pad } from '../core/dates.js';
import { icon } from '../ui/icons.js';
import { action, copyText } from '../ui/dom.js';
import { go } from '../ui/router.js';
import { toast, confirmSheet } from '../ui/feedback.js';
import { setOutcome, findTopic } from '../features/actions.js';
import * as audio from '../features/audio.js';
import { openAssistant } from '../assistant/panel.js';
import { openBlockForm } from '../ui/forms.js';

export const full = true;
export const title = (c) => store.state.blocks.find((b) => b.id === c.route.params[0])?.title || 'Sesión';

const STAGES = ['Preparar', 'Entender', 'Practicar', 'Evaluar', 'Cerrar'];
let tickTimer = null;
let picked = { outcome: null, kinds: new Set() };
let lastBlockId = null;

const B = (c) => store.state.blocks.find((b) => b.id === c.route.params[0]);
function timerState() {
  const t = store.state.timer || {};
  const p = prefs(store.state);
  const total = (t.mode === 'break' ? p.breakMin : p.focusMin) * 60;
  const remain = t.running ? Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000)) : Math.min(t.remaining ?? total, total);
  return { t, total, remain };
}
const mmss = (s) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;

function timerHTML() {
  const { t, total, remain } = timerState();
  const pctDone = Math.round(((total - remain) / total) * 100);
  return `<div class="timer" id="timerBox">
    <div class="timer-ring" style="--p:${pctDone}"><span>${icon(t.mode === 'break' ? 'coffee' : 'timer')}</span></div>
    <div class="grow"><div class="timer-clock" id="timerClock" aria-live="off">${mmss(remain)}</div><small>${t.mode === 'break' ? 'Descanso' : 'Concentración'}${t.cycles ? ` · ${t.cycles} ${t.cycles === 1 ? 'ciclo' : 'ciclos'}` : ''}</small></div>
    <button type="button" class="icon-btn" data-act="timer-toggle" aria-label="${t.running ? 'Pausar' : 'Iniciar'} temporizador">${icon(t.running ? 'pause' : 'play')}</button>
    <button type="button" class="icon-btn" data-act="timer-reset" aria-label="Reiniciar">${icon('rotate-ccw')}</button>
    <button type="button" class="icon-btn" data-act="timer-mode" aria-label="${t.mode === 'break' ? 'Volver a concentración' : 'Tomar descanso'}">${icon(t.mode === 'break' ? 'brain' : 'coffee')}</button>
  </div>`;
}

function stageContent(b, L, stage, topic) {
  const field = (name, label, placeholder, rows = 3) => `<label class="field"><span>${label}</span><textarea class="textarea" id="sf-${name}" data-input="session-field" data-field="${name}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(b[name] || '')}</textarea></label>`;
  if (stage === 0) return `<h2 class="sr-only">Preparar</h2>
    <div class="lesson question"><b>Tu objetivo</b>\n${esc(b.goal || 'Entender el tema, practicar y detectar lo que falta.')}</div>
    <div class="stack"><span class="label">Antes de empezar</span>
      <div class="hstack small">${icon('check', 'sm')}Agua y material a mano</div>
      <div class="hstack small">${icon('check', 'sm')}Celular en silencio, sin redes</div>
      <div class="hstack small">${icon('check', 'sm')}Una sola pestaña abierta</div></div>
    <div class="stack"><span class="label">Sonido ambiental (opcional)</span><div class="seg" role="group" aria-label="Sonido ambiental">
      <button type="button" data-act="ambient" data-kind="off" aria-pressed="${!audio.ambientOn()}">${icon('volume-x')}Silencio</button>
      <button type="button" data-act="ambient" data-kind="rain" aria-pressed="${audio.ambientKind() === 'rain'}">${icon('audio-lines')}Lluvia</button>
      <button type="button" data-act="ambient" data-kind="chord" aria-pressed="${audio.ambientKind() === 'chord'}">${icon('headphones')}Acorde</button></div>
      <p class="hint">Se genera aquí mismo; no usa canciones ni internet.</p></div>`;
  if (stage === 1) return `<h2 class="sr-only">Entender</h2>
    ${L.intro ? `<div class="lesson">${esc(L.intro)}</div>` : `<div class="notice">${icon('lightbulb')}<div>Este tema aún no tiene explicación guardada. Pídesela al asistente o añade tus apuntes.</div></div>
      <div class="btn-row"><button type="button" class="btn" data-act="ask-gemini" data-kind="explain">${icon('sparkles')}Explícamelo desde cero</button><button type="button" class="btn" data-act="edit-material">${icon('pencil')}Añadir apuntes</button></div>`}
    ${field('notes', 'Explícalo con tus palabras', '¿Qué entendí? ¿Qué parte me confunde todavía?', 4)}`;
  if (stage === 2) {
    const shown = Math.min(b.revealed || 0, L.steps.length);
    return `<h2 class="sr-only">Practicar</h2>
      ${L.problem ? `<div class="lesson question"><b>Ejercicio</b>\n${esc(L.problem)}</div>` : `<div class="notice">${icon('lightbulb')}<div>No hay ejercicio guardado. Pide uno al asistente o usa uno de tu material.</div></div><button type="button" class="btn" data-act="ask-gemini" data-kind="exercise">${icon('sparkles')}Dame un ejercicio</button>`}
      ${field('attempt', 'Tu intento (sin mirar la solución)', 'Datos, fórmula, procedimiento y resultado…', 4)}
      ${L.steps.length ? `<div class="stack"><div class="section-head"><h3 style="font-size:var(--fs-16)">Solución paso a paso</h3><span class="chip">${shown}/${L.steps.length}</span></div>
        <div class="step-reveal">${L.steps.slice(0, shown).map((st, i) => `<div class="s"><b>${i + 1}</b><span>${esc(st)}</span></div>`).join('')}</div>
        ${shown < L.steps.length ? `<button type="button" class="btn" data-act="reveal-step">${icon('eye')}Mostrar el paso ${shown + 1}</button>` : `<span class="chip ok">${icon('check', 'sm')}Todos los pasos visibles</span>`}</div>` : ''}`;
  }
  if (stage === 3) return `<h2 class="sr-only">Evaluar</h2>
    <p class="muted">Responde de memoria. No importa fallar: así sabemos qué reforzar.</p>
    ${L.question ? `<div class="lesson question"><b>Pregunta</b>\n${esc(L.question)}</div>` : `<div class="notice">${icon('lightbulb')}<div>No hay pregunta de control. El asistente puede hacerte un mini examen.</div></div><button type="button" class="btn" data-act="ask-gemini" data-kind="quiz">${icon('sparkles')}Hazme 3 preguntas</button>`}
    ${field('quizAttempt', 'Mi respuesta', 'Escribe antes de ver la solución', 3)}
    ${L.answer ? `<details ${b.answerShown ? 'open' : ''} data-act-toggle="answer"><summary class="label">Comparar con la respuesta</summary><div class="lesson" style="margin-top:8px">${esc(L.answer)}</div></details>` : ''}`;
  const kinds = Object.entries(DIFFICULTY_KINDS).map(([k, v]) => `<label><input type="checkbox" name="dk" value="${k}" ${picked.kinds.has(k) ? 'checked' : ''} data-change="pick-kind"><span>${v}</span></label>`).join('');
  const opt = (k, cls, ic, t, sub) => `<button type="button" class="outcome ${cls}" data-act="pick-outcome" data-o="${k}" aria-pressed="${picked.outcome === k}"><span class="ico">${icon(ic)}</span><span><b>${t}</b><small>${sub}</small></span></button>`;
  return `<h2 class="sr-only">Cerrar</h2>
    <div class="outcomes" role="group" aria-label="¿Cómo terminó la sesión?">
      ${opt('mastered', 'ok', 'check', 'Lo resuelvo solo', topic ? 'Sube el dominio y aleja el próximo repaso' : 'Marcar como dominado')}
      ${opt('review', 'rev', 'rotate-ccw', 'No lo entendí del todo', 'Programo un repaso espaciado')}
      ${opt('progress', 'pause', 'timer', 'Avancé, falta terminar', 'Queda en proceso')}
      ${opt('missed', 'no', 'x', 'No pude hacerla', 'Busco otro momento según tu modo')}
    </div>
    <div class="stack"><span class="label">¿Qué te costó? (opcional)</span><div class="pick">${kinds}</div></div>
    ${field('notes', 'Mi duda más importante para la próxima vez', 'Ej.: me confundo con las unidades', 2)}`;
}

export function render(c) {
  const b = B(c);
  if (!b) return `<div class="session"><div class="session-main"><div class="empty"><h3>Esta sesión ya no existe</h3><a class="btn" href="#/hoy">Volver a Hoy</a></div></div></div>`;
  if (lastBlockId !== b.id) { picked = { outcome: null, kinds: new Set() }; lastBlockId = b.id; }
  const course = courseOf(c.state, b.courseId);
  const topic = b.topicId ? findTopic(b.topicId) : null;
  const L = lessonFor(b, topic);
  const stage = Math.max(0, Math.min(4, Number(b.stage) || 0));
  const isLast = stage === 4;
  return `<div class="session" style="--c:${esc(course.color)}">
    <header class="session-top">
      <a class="icon-btn" href="#/hoy" aria-label="Salir de la sesión">${icon('x')}</a>
      <div class="grow"><span class="course-tag" style="--c:${esc(course.color)}">${esc(course.name)}</span><div class="small muted">${esc(cap(fmtRelDay(b.date, c.today)))} · <time>${esc(fmtRange(b.start, b.end))}</time>${b.kind !== 'study' ? ' · ' + esc(KIND_LABEL[b.kind]) : ''}</div></div>
      <button type="button" class="icon-btn" data-act="session-assistant" aria-label="Preguntar al asistente">${icon('sparkles')}</button>
      <button type="button" class="icon-btn" data-act="session-edit" aria-label="Editar actividad">${icon('pencil')}</button>
    </header>
    <main class="session-main">
      <h1 class="session-title">${esc(b.title)}</h1>
      <nav class="steps" aria-label="Etapas">${STAGES.map((x, i) => `<button type="button" class="${i === stage ? 'on' : i < stage ? 'done' : ''}" data-act="stage" data-stage="${i}" ${i === stage ? 'aria-current="step"' : ''}>${x}</button>`).join('')}</nav>
      ${b.kind === 'study' ? timerHTML() : ''}
      <section class="stack" aria-live="polite">${stageContent(b, L, stage, topic)}</section>
      <details class="stack"><summary class="label">Audio y ayudas</summary><div class="stack" style="margin-top:10px">
        <div class="tool-row">
          <button type="button" class="btn btn-sm" data-act="read-lesson">${icon('volume-2', 'sm')}Escuchar explicación</button>
          <button type="button" class="btn btn-sm" data-act="stop-audio">${icon('square', 'sm')}Detener</button>
          <button type="button" class="btn btn-sm" data-act="rec-toggle" id="recBtn">${icon(audio.isRecording() ? 'square' : 'mic', 'sm')}${audio.isRecording() ? 'Detener grabación' : 'Grabar nota de voz'}</button>
          <button type="button" class="btn btn-sm" data-act="rec-play" id="recPlay" disabled>${icon('play', 'sm')}Mi nota</button>
          <button type="button" class="btn btn-sm" data-act="rec-download" id="recDl" disabled>${icon('download', 'sm')}Guardar archivo</button>
          <button type="button" class="btn btn-sm btn-quiet" data-act="rec-delete" id="recDel" disabled>${icon('trash', 'sm')}Borrar</button>
        </div>
        <p class="hint" id="recStatus">Las notas de voz se guardan solo en este dispositivo (máx. 2 min). No se suben a la nube.</p>
        <div class="tool-row"><button type="button" class="btn btn-sm" data-act="copy-tutor">${icon('copy', 'sm')}Copiar tutor para ChatGPT</button><button type="button" class="btn btn-sm" data-act="copy-exam">${icon('copy', 'sm')}Copiar simulacro para ChatGPT</button></div>
      </div></details>
      ${!isLast ? `<button type="button" class="btn btn-quiet btn-sm" data-act="time-up" style="justify-self:start">${icon('clock-alert', 'sm')}Se acabó el tiempo: dejar para repasar y seguir</button>` : ''}
    </main>
    <footer class="session-foot">
      <button type="button" class="btn" data-act="stage-prev" ${stage === 0 ? 'disabled' : ''}>${icon('arrow-left')}Atrás</button>
      ${isLast ? `<button type="button" class="btn btn-primary" data-act="finish-session" ${picked.outcome ? '' : 'disabled'}>${icon('check')}Guardar y salir</button>` : `<button type="button" class="btn btn-primary" data-act="stage-next">Continuar${icon('arrow-right')}</button>`}
    </footer>
  </div>`;
}

export function mount(root, c) {
  const b = B(c);
  if (!b) return;
  if (b.kind === 'study' && b.status === 'scheduled' && b.date <= c.today) { b.status = 'progress'; commit({ render: false }); }
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 1000);
  refreshVoice(b.id);
}
export function unmount() { clearInterval(tickTimer); tickTimer = null; audio.stopAllAudio(); }

function tick() {
  const el = document.getElementById('timerClock');
  if (!el) { clearInterval(tickTimer); return; }
  const { t, total, remain } = timerState();
  el.textContent = mmss(remain);
  const ring = document.querySelector('.timer-ring');
  if (ring) ring.style.setProperty('--p', Math.round(((total - remain) / total) * 100));
  if (t.running && remain <= 0) {
    const p = prefs(store.state);
    t.running = false;
    t.mode = t.mode === 'focus' ? 'break' : 'focus';
    t.remaining = (t.mode === 'break' ? p.breakMin : p.focusMin) * 60;
    if (t.mode === 'break') t.cycles = (t.cycles || 0) + 1;
    commit();
    toast(t.mode === 'break' ? `¡Bloque terminado! Descansa ${p.breakMin} min.` : 'Descanso terminado. Sigue cuando quieras.', { tone: 'ok' });
    try { navigator.vibrate?.([120, 80, 120]); } catch (_) { /* opcional */ }
  }
}

async function refreshVoice(id) {
  try {
    const saved = await audio.getNote(id);
    const has = !!saved?.blob;
    for (const k of ['recPlay', 'recDl', 'recDel']) { const el = document.getElementById(k); if (el) el.disabled = !has; }
    const st = document.getElementById('recStatus');
    if (st && has) st.textContent = `Nota guardada en este dispositivo · ${new Date(saved.at).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}`;
  } catch (_) { /* sin IndexedDB */ }
}

function current() { const id = decodeURIComponent((location.hash.split('/')[2] || '')); return store.state.blocks.find((b) => b.id === id); }
function setStage(n) { const b = current(); if (!b) return; b.stage = Math.max(0, Math.min(4, n)); commit(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

function tutorPrompt(b, type) {
  const c = courseOf(store.state, b.courseId), L = lessonFor(b, b.topicId ? findTopic(b.topicId) : null);
  if (type === 'exam') return `Eres un examinador universitario paciente y exigente. Estoy estudiando ${c.name}. Tema: ${b.title}. Mi objetivo: ${b.goal || 'dominar este tema'}. Dificultad percibida: ${b.difficulty}/5. Genera un examen diagnóstico de 8 preguntas progresivas, incluyendo problemas abiertos cuando corresponda. Primero solo las preguntas; NO incluyas soluciones hasta que entregue mis respuestas. Después, evalúa cada paso, identifica errores, asigna una calificación justificada y prepara otro ejercicio para cada error. Usa solo los temas indicados; si faltan páginas del material, pídemelas. Contexto disponible: ${L.intro || 'aún no he proporcionado el material del curso'}.`;
  return `Actúa como mi profesor particular muy paciente. Estudio ${c.name}; tema: ${b.title}. Soy principiante y quiero entender desde cero, incluso las matemáticas previas. Objetivo: ${b.goal || 'comprender y aplicar el tema'}. Dificultad: ${b.difficulty}/5. Explica con palabras sencillas, una idea pequeña cada vez, ejemplos cotidianos, luego un ejercicio totalmente guiado. Después haz UNA sola pregunta a la vez y espera mi respuesta. Nunca des por hecho que entiendo un símbolo; comprueba mis conocimientos. No me des directamente la solución de mis ejercicios. Si me equivoco, dame pistas graduales. Mi duda anotada: ${b.notes || 'todavía no la he formulado'}. Material: ${L.intro || 'te lo compartiré cuando lo tenga'}.`;
}

// ——— Acciones ———
action('stage', (el) => setStage(Number(el.dataset.stage)));
action('stage-next', () => { const b = current(); if (b) setStage((b.stage || 0) + 1); });
action('stage-prev', () => { const b = current(); if (b) setStage((b.stage || 0) - 1); });
action('session-field', (el) => { const b = current(); if (!b) return; b[el.dataset.field] = el.value.slice(0, 6000); commit({ render: false }); });
action('reveal-step', () => { const b = current(); if (!b) return; const L = lessonFor(b, b.topicId ? findTopic(b.topicId) : null); b.revealed = Math.min(L.steps.length, (b.revealed || 0) + 1); commit(); });
action('pick-outcome', (el) => { picked.outcome = el.dataset.o; import('../core/store.js').then((m) => m.notify('ui')); });
action('pick-kind', (el) => { if (el.checked) picked.kinds.add(el.value); else picked.kinds.delete(el.value); });
action('timer-toggle', () => {
  const s = store.state; const { t, remain } = timerState();
  if (t.running) { t.remaining = remain; t.running = false; } else { t.endAt = Date.now() + Math.max(1, remain) * 1000; t.running = true; t.blockId = current()?.id || null; }
  s.timer = t; commit();
});
action('timer-reset', () => { const { t, total } = timerState(); t.running = false; t.remaining = total; commit(); });
action('timer-mode', () => { const p = prefs(store.state); const { t } = timerState(); t.running = false; t.mode = t.mode === 'focus' ? 'break' : 'focus'; t.remaining = (t.mode === 'break' ? p.breakMin : p.focusMin) * 60; commit(); });
action('ambient', async (el) => {
  if(el.dataset.kind==='off'){audio.stopAmbient();toast('Sonido ambiental detenido.');}
  else {
    const ok=await audio.startAmbient(el.dataset.kind);
    toast(ok?(el.dataset.kind==='rain'?'Lluvia activada.':'Acorde activado. Revisa el volumen multimedia.') :
      'El navegador bloqueó el audio. Toca el botón otra vez y revisa el volumen multimedia.',
      {tone:ok?'ok':'warn',duration:5300});
  }
  import('../core/store.js').then(m=>m.notify('ui'));
});
action('read-lesson', async () => {
  const b=current(); if(!b)return;
  const L=lessonFor(b,b.topicId?findTopic(b.topicId):null);
  const spanish=await audio.waitForSpanishVoice();
  if(!spanish){
    toast('No se encontró una voz en español. Instala o activa una voz española en el idioma de tu dispositivo y vuelve a probar.',{tone:'warn',duration:8500});
    return;
  }
  if(!audio.speak(L.intro||b.goal||b.title))
    toast('No se pudo iniciar la explicación en español.',{tone:'warn'});
});
action('stop-audio', () => { audio.stopSpeaking(); audio.stopPlayback(); });
action('rec-toggle', async (el) => {
  const b = current(); if (!b) return;
  const st = document.getElementById('recStatus');
  if (audio.isRecording()) { audio.stopRecording(); if (st) st.textContent = 'Guardando grabación…'; return; }
  try {
    await audio.startRecording(b.id, { onStop: (r) => { toast(r.ok ? 'Nota de voz guardada en este dispositivo.' : r.message, { tone: r.ok ? 'ok' : 'warn' }); const btn = document.getElementById('recBtn'); if (btn) btn.innerHTML = `${icon('mic', 'sm')}Grabar nota de voz`; refreshVoice(b.id); } });
    el.innerHTML = `${icon('square', 'sm')}Detener grabación`;
    if (st) st.textContent = 'Grabando… máximo 2 minutos.';
  } catch (e) { toast(e.message || 'No se pudo usar el micrófono. Revisa los permisos.', { tone: 'warn' }); }
});
action('rec-play', async () => { const b = current(); try { await audio.playNote(b.id); } catch (e) { toast(e.message, { tone: 'warn' }); } });
action('rec-download', async () => { const b = current(); try { await audio.playNote(b.id, { download: true, title: b.date }); } catch (e) { toast(e.message, { tone: 'warn' }); } });
action('rec-delete', async () => { const b = current(); if (await confirmSheet({ title: 'Borrar la nota de voz', text: 'Se borra de este dispositivo.', confirm: 'Borrar', danger: true })) { await audio.deleteNote(b.id); audio.stopPlayback(); toast('Nota de voz borrada.'); refreshVoice(b.id); for (const k of ['recPlay', 'recDl', 'recDel']) { const x = document.getElementById(k); if (x) x.disabled = true; } } });
action('copy-tutor', async () => { const b = current(); toast((await copyText(tutorPrompt(b, 'tutor'))) ? 'Copiado. Pégalo en tu ChatGPT.' : 'No se pudo copiar.', { tone: 'ok' }); });
action('copy-exam', async () => { const b = current(); toast((await copyText(tutorPrompt(b, 'exam'))) ? 'Copiado. Pégalo en tu ChatGPT.' : 'No se pudo copiar.', { tone: 'ok' }); });
action('session-assistant', () => { const b = current(); openAssistant({ context: b ? { blockId: b.id } : null }); });
action('ask-gemini', (el) => {
  const b = current(); if (!b) return;
  const c = courseOf(store.state, b.courseId).name;
  const msg = { explain: `Explícame desde cero «${b.title}» (${c}) con un ejemplo cotidiano y luego hazme una pregunta corta.`, exercise: `Dame un ejercicio de nivel ${b.difficulty}/5 sobre «${b.title}» (${c}). No me des la solución hasta que la pida.`, quiz: `Hazme 3 preguntas cortas para comprobar si entiendo «${b.title}» (${c}). Una a la vez.` }[el.dataset.kind];
  openAssistant({ prefill: msg, autoSend: true, context: { blockId: b.id } });
});
action('session-edit', () => { const b = current(); if (b) openBlockForm(b); });
action('edit-material', () => { const b = current(); if (b) openBlockForm(b); });
action('time-up', async () => {
  const b = current(); if (!b) return;
  await setOutcome(b.id, 'review', { reason: 'Se agotó el tiempo de la sesión' });
  goNext(b);
});
action('finish-session', async () => {
  const b = current(); if (!b || !picked.outcome) return;
  const kinds = [...picked.kinds];
  const difficulty = kinds.length || b.notes ? { kind: kinds[0] || 'other', text: kinds.length > 1 ? `${kinds.map((k) => DIFFICULTY_KINDS[k]).join(', ')}${b.notes ? ': ' + b.notes : ''}` : (b.notes || '') } : null;
  const outcome = picked.outcome;
  picked = { outcome: null, kinds: new Set() };
  audio.stopAllAudio();
  go('hoy', { replace: true }); // síncrono: así la hoja del repaso no se cierra al cambiar de ruta
  await setOutcome(b.id, outcome, { difficulty: outcome === 'mastered' && !kinds.length ? null : difficulty });
});

function goNext(b) {
  const next = store.state.blocks.filter((x) => x.date === b.date && x.start >= b.end && x.id !== b.id && x.status !== 'mastered').sort((a, c) => a.start.localeCompare(c.start))[0];
  if (next && next.kind === 'study') go('sesion/' + encodeURIComponent(next.id)); else go('hoy');
}
