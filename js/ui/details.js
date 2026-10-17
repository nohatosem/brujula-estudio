// Brújula 4 · hojas de detalle: actividad, decisiones, repaso rápido, evaluación,
// conflicto de nube, rutina, estado de sincronización y bienvenida a 4.0.

import { esc, cap, plural } from '../core/util.js';
import { store, device, commit, notify } from '../core/store.js';
import { courseOf, statusLabel, prefs, KIND_LABEL, EVAL_TYPES, PRIORITY_LABEL, lessonFor, APP_VERSION } from '../core/model.js';
import { fmtRelDay, fmtRange, fmtLong, fmtDuration, todayISO, addDays, toMin, isValidTime, diffDays, blockTime } from '../core/dates.js';
import { isFixedKind, isFlexible } from '../engine/scheduler.js';
import { needsDecision, prepPercent } from '../engine/priority.js';
import { GRADES, GRADE_LABEL, LEVEL_LABEL } from '../engine/srs.js';
import { rulesFrom } from '../engine/rules.js';
import { openSheet, toast, confirmSheet } from './feedback.js';
import { icon } from './icons.js';
import { go } from './router.js';
import { openBlockForm, openEvaluationForm } from './forms.js';
import { setOutcome, proposeMove, reviewTopic, planExam, recordGrade, dismissOldDecisions, findTopic, findEval, mode, modeDetail } from '../features/actions.js';
import { cloud, resolveConflict, pushNow, checkRemote } from '../cloud/cloud.js';
import { download } from './dom.js';

const S = () => store.state;
const courseTag = (id) => { const c = courseOf(S(), id); return `<span class="course-tag" style="--c:${esc(c.color)}">${esc(c.name)}</span>`; };

// ——— Actividad ———
export function openBlockDetail(id) {
  const b = S().blocks.find((x) => x.id === id);
  if (!b) { toast('Esa actividad ya no existe.', { tone: 'warn' }); return; }
  const today = todayISO();
  const topic = b.topicId ? findTopic(b.topicId) : null;
  const ev = b.evaluationId ? findEval(b.evaluationId) : null;
  const ended = blockTime(b, 'end') <= Date.now();
  const started = blockTime(b, 'start') <= Date.now();
  const fixed = isFixedKind(b.kind);
  const outcomes = fixed ? '' : b.kind === 'study'
    ? `<div class="qa" role="group" aria-label="Resultado"><button type="button" class="ok" data-o="mastered">${icon('check')}Lo domino</button><button type="button" class="rev" data-o="review">${icon('rotate-ccw')}Repasar</button><button type="button" data-o="paused">${icon('circle-pause')}Pausar</button><button type="button" class="no" data-o="missed">${icon('x')}No hice</button></div>`
    : `<div class="qa" role="group" aria-label="Resultado"><button type="button" class="ok" data-o="mastered">${icon('check')}Hecho</button><button type="button" class="no" data-o="missed">${icon('x')}No hice</button></div>`;
  const s = openSheet({
    title: b.title,
    subtitle: `${esc(cap(fmtRelDay(b.date, today)))} · ${esc(fmtLong(b.date))} · <time>${esc(fmtRange(b.start, b.end))}</time>`,
    body: `<div class="hstack">${courseTag(b.courseId)}<span class="chip ${b.kind !== 'study' ? 'k-' + b.kind : ''}">${icon(fixed ? 'lock' : b.kind === 'study' ? 'book-open' : 'sprout', 'sm')}${KIND_LABEL[b.kind]}</span>${b.status !== 'scheduled' ? `<span class="chip s-${esc(b.status)}">${esc(statusLabel(b))}</span>` : ''}${b.priority !== 'normal' ? `<span class="chip urgent">${PRIORITY_LABEL[b.priority]}</span>` : ''}<span class="chip">${esc(fmtDuration(toMin(b.end) - toMin(b.start)))}</span></div>
      ${b.goal ? `<p>${esc(b.goal)}</p>` : ''}
      ${fixed ? `<div class="notice">${icon('shield-check')}<div>${b.kind === 'exam' ? 'Examen' : 'Clase'} protegido: la reprogramación automática y la IA no lo mueven.</div></div>` : ''}
      ${topic ? `<button type="button" class="set-row" data-topic style="border:1px solid var(--line);border-radius:14px;padding:10px 12px">${icon('layers')}<span class="txt"><b>${esc(topic.title)}</b><small>${esc(LEVEL_LABEL[topic.level] || '')} · dominio ${Number(topic.mastery) || 0}%${topic.srs?.due ? ` · repaso ${esc(fmtRelDay(topic.srs.due, today))}` : ''}</small></span>${icon('chevron-right', 'sm')}</button>` : ''}
      ${ev ? `<button type="button" class="set-row" data-eval style="border:1px solid var(--line);border-radius:14px;padding:10px 12px">${icon('target')}<span class="txt"><b>${esc(ev.title)}</b><small>${esc(EVAL_TYPES[ev.type] || '')} · ${esc(fmtRelDay(ev.date, today))}</small></span>${icon('chevron-right', 'sm')}</button>` : ''}
      ${b.lastReason ? `<p class="hint">Último motivo: ${esc(b.lastReason)}</p>` : ''}
      ${!fixed && (started || ended || b.status !== 'scheduled') ? `<div class="stack"><span class="label">¿Cómo fue?</span>${outcomes}</div>` : ''}`,
    foot: `${b.kind === 'study' ? `<a class="btn btn-primary" href="#/sesion/${encodeURIComponent(b.id)}" data-close>${icon('play')}Sesión guiada</a>` : ''}
      ${isFlexible(b) ? `<button type="button" class="btn" data-move>${icon('calendar-clock')}Mover</button>` : ''}
      <button type="button" class="btn" data-edit>${icon('pencil')}Editar</button>`,
    onMount(card) {
      card.addEventListener('click', (e) => {
        const o = e.target.closest('[data-o]');
        if (o) { s.close(); void setOutcome(b.id, o.dataset.o); return; }
        if (e.target.closest('[data-move]')) { s.close(); void proposeMove(b.id); return; }
        if (e.target.closest('[data-edit]')) { s.close(); openBlockForm(b); return; }
        if (e.target.closest('[data-topic]')) { s.close(); go('tema/' + encodeURIComponent(topic.id)); return; }
        if (e.target.closest('[data-eval]')) { s.close(); openEvaluationDetail(ev.id); return; }
        if (e.target.closest('[data-close]')) setTimeout(() => s.close(), 0);
      });
    },
  });
}

// ——— Todas las decisiones pendientes ———
export function openDecisionsSheet() {
  const now = new Date();
  const list = S().blocks.filter((b) => needsDecision(b, now)).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
  const old = list.filter((b) => b.date < addDays(todayISO(), -6));
  const row = (b) => `<li class="decide-item"><div class="decide-top"><div class="grow"><b>${esc(b.title)}</b><div class="meta">${courseTag(b.courseId)}<span>${esc(cap(fmtRelDay(b.date, todayISO())))} · ${esc(b.start)}</span></div></div></div>
    <div class="qa"><button type="button" class="ok" data-id="${esc(b.id)}" data-o="mastered">${icon('check')}${b.kind === 'study' ? 'Lo domino' : 'Hecho'}</button>${b.kind === 'study' ? `<button type="button" class="rev" data-id="${esc(b.id)}" data-o="review">${icon('rotate-ccw')}Repasar</button>` : ''}<button type="button" class="no" data-id="${esc(b.id)}" data-o="missed">${icon('x')}No hice</button></div></li>`;
  const s = openSheet({
    title: 'Actividades por confirmar', subtitle: 'Brújula nunca las marca sola: tú decides.', wide: true,
    body: `<ul class="list">${list.map(row).join('')}</ul>`,
    foot: old.length ? `<button type="button" class="btn" data-dismiss>${icon('archive')}Dejar de preguntar por ${plural(old.length, 'la anterior', 'las anteriores')} a esta semana</button>` : '',
    onMount(card) {
      card.addEventListener('click', (e) => {
        const o = e.target.closest('[data-o]');
        if (o) { o.closest('li').remove(); void setOutcome(o.dataset.id, o.dataset.o); if (!card.querySelector('li')) s.close(); return; }
        if (e.target.closest('[data-dismiss]')) { s.close(); dismissOldDecisions(old.map((b) => b.id)); }
      });
    },
  });
}

// ——— Repaso rápido de un tema (sin crear bloque) ———
export function openQuickReview(topicId) {
  const t = findTopic(topicId);
  if (!t) return;
  const L = lessonFor({ title: t.title, courseId: t.courseId, lesson: t.lesson || {} }, t);
  const s = openSheet({
    title: `Repasar: ${t.title}`, subtitle: `${courseTag(t.courseId)}`,
    body: `${L.question ? `<div class="lesson question"><b>Pregunta:</b> ${esc(L.question)}</div><details><summary class="label">Ver respuesta</summary><div class="lesson" style="margin-top:8px">${esc(L.answer || 'Compara con tus apuntes.')}</div></details>`
      : `<p class="muted">Explícalo en voz alta o en papel sin mirar tus apuntes. Luego califica con honestidad.</p>`}
      <div class="stack"><span class="label">¿Cómo te fue?</span><div class="grade-row">${GRADES.map((g) => `<button type="button" class="${g}" data-g="${g}">${esc(GRADE_LABEL[g])}</button>`).join('')}</div>
      <p class="hint">«No lo entendí» lo trae mañana; «Fácil» lo aleja varios días. Si tienes un examen cerca, el repaso nunca queda después.</p></div>`,
    foot: `<button type="button" class="btn" data-plan>${icon('calendar-plus')}Programar sesión</button><a class="btn" href="#/tema/${encodeURIComponent(t.id)}" data-close>${icon('layers')}Ver tema</a>`,
    onMount(card) {
      card.addEventListener('click', (e) => {
        const g = e.target.closest('[data-g]');
        if (g) { s.close(); reviewTopic(t.id, g.dataset.g); return; }
        if (e.target.closest('[data-plan]')) { s.close(); import('../features/actions.js').then((m) => m.scheduleTopic(t.id)); return; }
        if (e.target.closest('[data-close]')) setTimeout(() => s.close(), 0);
      });
    },
  });
}

// ——— Evaluación ———
export function openEvaluationDetail(id) {
  const e = findEval(id);
  if (!e) return;
  const today = todayISO();
  const days = diffDays(today, e.date);
  const topics = (e.topicIds || []).map(findTopic).filter(Boolean);
  const prep = prepPercent(S(), e);
  const planned = S().blocks.filter((b) => b.evaluationId === e.id && b.kind === 'study' && b.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const past = e.date < today || e.status === 'done' || e.status === 'graded';
  const s = openSheet({
    title: e.title, subtitle: `${esc(EVAL_TYPES[e.type] || 'Evaluación')} · ${esc(fmtLong(e.date))}${e.time ? ' · ' + esc(e.time) : ''}`, wide: true,
    body: `<div class="kpis"><div class="kpi"><b>${days < 0 ? '—' : days}</b><span>${days === 0 ? 'Es hoy' : days === 1 ? 'día' : days < 0 ? 'Ya pasó' : 'días'}</span></div>
        <div class="kpi"><b>${prep == null ? '—' : prep + '%'}</b><span>Preparación</span></div>
        <div class="kpi"><b>${planned.length}</b><span>Sesiones programadas</span></div>${e.weight ? `<div class="kpi"><b>${e.weight}%</b><span>de la nota</span></div>` : ''}</div>
      <div class="hstack">${courseTag(e.courseId)}</div>
      ${topics.length ? `<div class="stack"><span class="label">Temas</span><ul class="list">${topics.map((t) => `<li class="topic-row"><div><a class="t" href="#/tema/${encodeURIComponent(t.id)}" data-close>${esc(t.title)}</a><div class="sub"><span class="level ${esc(t.level)}">${esc(LEVEL_LABEL[t.level])}</span><span>${Number(t.mastery) || 0}%</span></div></div><span class="meter ${t.mastery >= 85 ? 'm-high' : t.mastery >= 50 ? 'm-mid' : 'm-low'}" style="width:90px"><span style="--v:${Number(t.mastery) || 0}%"></span></span></li>`).join('')}</ul></div>` : '<p class="hint">Asigna temas para medir tu preparación y armar un plan.</p>'}
      ${planned.length ? `<div class="stack"><span class="label">Plan</span>${planned.slice(0, 6).map((b) => `<div class="hstack small"><span class="chip">${esc(cap(fmtRelDay(b.date, today)))} ${esc(b.start)}</span><span>${esc(b.title)}</span></div>`).join('')}</div>` : ''}
      ${past ? `<div class="form-grid"><label class="field"><span>Nota obtenida</span><input class="input" type="number" step="0.5" min="0" id="gradeIn" value="${esc(e.grade ?? '')}"></label><label class="field"><span>Sobre</span><input class="input" type="number" min="1" id="gradeMax" value="${esc(e.maxGrade || 20)}"></label></div>` : ''}
      ${e.notes ? `<p class="muted">${esc(e.notes)}</p>` : ''}`,
    foot: `${past ? `<button type="button" class="btn btn-primary" data-grade>${icon('check')}Guardar nota</button>` : `<button type="button" class="btn btn-primary" data-plan>${icon('route')}${planned.length ? 'Completar plan' : 'Armar plan de estudio'}</button>`}<button type="button" class="btn" data-edit>${icon('pencil')}Editar</button>`,
    onMount(card) {
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-plan]')) { s.close(); planExam(e.id); return; }
        if (ev.target.closest('[data-edit]')) { s.close(); openEvaluationForm(e); return; }
        if (ev.target.closest('[data-grade]')) { recordGrade(e.id, card.querySelector('#gradeIn').value, card.querySelector('#gradeMax').value); s.close(); return; }
        if (ev.target.closest('[data-close]')) setTimeout(() => s.close(), 0);
      });
    },
  });
}

// ——— Conflicto de nube ———
let conflictShownFor = null;
export function maybeShowConflict() {
  if (!cloud.conflict) { conflictShownFor = null; return; }
  const key = cloud.conflict.remote?.updated_at;
  if (conflictShownFor === key) return;
  conflictShownFor = key;
  openConflictSheet();
}

export function openConflictSheet() {
  const c = cloud.conflict;
  if (!c) { toast('Tu copia está al día.', { tone: 'ok' }); return; }
  const when = (ms) => (ms ? new Date(ms).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }) : 'desconocida');
  const card = (title, sum, ico) => `<div class="panel stack"><b class="hstack">${icon(ico)}${title}</b><span class="small muted">Última edición: ${esc(when(sum.savedAt))}</span><span class="small">${plural(sum.blocks, 'actividad', 'actividades')} · ${plural(sum.upcoming, 'próxima', 'próximas')} · ${plural(sum.topics, 'tema', 'temas')}</span></div>`;
  const s = openSheet({
    title: 'Elige qué copia conservar', wide: true,
    body: `<p class="muted">Tu horario cambió en otro dispositivo y también aquí. Para no perder nada, guardo una copia de la que no elijas.</p>
      <div class="cards two">${card('Copia de la nube', c.remoteSummary, 'cloud')}${card('Este dispositivo', c.localSummary, 'smartphone')}</div>
      <button type="button" class="btn btn-quiet btn-sm" data-dl>${icon('download', 'sm')}Descargar las dos copias</button>`,
    foot: `<button type="button" class="btn" data-device>${icon('smartphone')}Usar este dispositivo</button><button type="button" class="btn btn-primary" data-cloud>${icon('cloud')}Usar la nube</button>`,
    onMount(el) {
      el.addEventListener('click', async (e) => {
        if (e.target.closest('[data-dl]')) {
          const stamp = todayISO();
          download(`brujula-nube-${stamp}.json`, JSON.stringify(c.remote.payload, null, 2));
          setTimeout(() => download(`brujula-dispositivo-${stamp}.json`, JSON.stringify(S(), null, 2)), 400);
          return;
        }
        if (e.target.closest('[data-cloud]')) { s.close(); await resolveConflict('cloud'); toast('Listo: usas la copia de la nube. La de este dispositivo quedó guardada.', { tone: 'ok' }); }
        if (e.target.closest('[data-device]')) {
          if (!(await confirmSheet({ title: 'Reemplazar la copia de la nube', text: 'La nube tomará lo que ves en este dispositivo. Guardo una copia de la versión de la nube por si acaso.', confirm: 'Reemplazar' }))) return;
          s.close(); await resolveConflict('device'); toast('Listo: la nube ahora tiene la copia de este dispositivo.', { tone: 'ok' });
        }
      });
    },
  });
}

// ——— Rutina ———
export function openRoutineSheet() {
  const p = prefs(S());
  const s = openSheet({
    title: 'Tu rutina', subtitle: 'Brújula nunca programa en tu sueño ni en tu almuerzo.',
    body: `<form class="form-grid" id="routineForm">
      <label class="field"><span>Me levanto</span><input class="input" type="time" name="wake" value="${esc(p.wake)}"></label>
      <label class="field"><span>Me duermo</span><input class="input" type="time" name="sleep" value="${esc(p.sleep)}"></label>
      <label class="field"><span>Almuerzo desde</span><input class="input" type="time" name="lunchStart" value="${esc(p.lunchStart)}"></label>
      <label class="field"><span>Hasta</span><input class="input" type="time" name="lunchEnd" value="${esc(p.lunchEnd)}"></label>
      <label class="field"><span>Descanso entre actividades</span><select class="select" name="breakMins">${[0, 5, 10, 15, 20, 30].map((n) => `<option value="${n}" ${Number(p.breakMins) === n ? 'selected' : ''}>${n} min</option>`).join('')}</select></label>
      <label class="field"><span>Máximo de estudio al día</span><select class="select" name="maxStudyMin">${[120, 180, 240, 300, 360, 420, 480, 600].map((n) => `<option value="${n}" ${Number(p.maxStudyMin) === n ? 'selected' : ''}>${n / 60} h</option>`).join('')}</select></label>
    </form><p class="hint" id="routineErr" aria-live="polite"></p>`,
    foot: `<button type="button" class="btn" data-sheet-close>Cancelar</button><button type="button" class="btn btn-primary" data-save>${icon('check')}Guardar</button>`,
    onMount(card) {
      card.querySelector('[data-save]').addEventListener('click', () => {
        const f = Object.fromEntries(new FormData(card.querySelector('#routineForm')).entries());
        const err = card.querySelector('#routineErr');
        if (!['wake', 'sleep', 'lunchStart', 'lunchEnd'].every((k) => isValidTime(f[k]))) { err.textContent = 'Completa todas las horas.'; err.className = 'error-text'; return; }
        if (toMin(f.lunchStart) >= toMin(f.lunchEnd)) { err.textContent = 'El almuerzo debe terminar después de empezar.'; err.className = 'error-text'; return; }
        const late = toMin(f.sleep) <= 4 * 60;
        if (!late && toMin(f.wake) >= toMin(f.sleep)) { err.textContent = 'La hora de dormir debe ser posterior a la de levantarte (o de madrugada, hasta las 04:00).'; err.className = 'error-text'; return; }
        S().preferences = { ...p, ...f, breakMins: Number(f.breakMins), maxStudyMin: Number(f.maxStudyMin), routineConfirmed: true };
        commit();
        s.close();
        const r = rulesFrom(S().preferences);
        toast(`Rutina guardada: ${fmtDuration(r.sleep - r.wake)} despierto.`, { tone: 'ok' });
      });
    },
  });
}

// ——— Sincronización ———
export function openSyncSheet() {
  const st = cloud.status;
  const text = {
    synced: ['cloud-check', 'Todo guardado en tu cuenta', cloud.lastSyncAt ? `Última sincronización: ${new Date(cloud.lastSyncAt).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}` : 'Tus cambios se sincronizan solos.'],
    saving: ['cloud', 'Guardando…', 'Un momento.'], pending: ['cloud', 'Guardando…', 'Hay cambios por subir.'],
    offline: ['cloud-off', 'Sin conexión', 'Tus cambios se guardan en este dispositivo y se subirán al volver internet.'],
    error: ['cloud-off', 'No se pudo sincronizar', cloud.message || 'Lo intentaré de nuevo en unos segundos.'],
    conflict: ['triangle-alert', 'Hay dos versiones distintas', 'Elige qué copia conservar.'],
    loading: ['cloud', 'Conectando…', ''],
  }[st] || ['cloud', 'Estado desconocido', ''];
  const s = openSheet({
    title: text[1],
    body: `<div class="icon-row">${icon(text[0], 'lg')}<span class="muted">${esc(text[2])}</span></div>
      <div class="set-card"><div class="set-row">${icon('user-round')}<span class="txt"><b>${esc(cloud.user?.email || '')}</b><small>Tus datos están separados por cuenta.</small></span></div></div>`,
    foot: `${st === 'conflict' ? `<button type="button" class="btn btn-primary" data-resolve>Revisar copias</button>` : `<button type="button" class="btn" data-sync>${icon('refresh-cw')}Sincronizar ahora</button>`}<a class="btn" href="#/ajustes/cuenta" data-close>${icon('settings')}Cuenta</a>`,
    onMount(card) {
      card.addEventListener('click', async (e) => {
        if (e.target.closest('[data-resolve]')) { s.close(); openConflictSheet(); }
        if (e.target.closest('[data-sync]')) { s.close(); if (cloud.enabled) { await pushNow(); await checkRemote(); } else { const m = await import('../cloud/cloud.js'); await m.boot(); } toast(cloud.status === 'synced' ? 'Sincronizado.' : cloud.message || 'No se pudo sincronizar.', { tone: cloud.status === 'synced' ? 'ok' : 'warn' }); }
        if (e.target.closest('[data-close]')) setTimeout(() => s.close(), 0);
      });
    },
  });
}

// ——— Bienvenida a 4.0 (una vez por dispositivo y cuenta) ———
export function maybeShowWelcome() {
  if (!store.userId) return;
  const dev = device.get();
  const key = 'welcome4_' + store.userId;
  if (dev[key] || cloud.conflict) return; // con un conflicto, primero se resuelve eso
  const m = store.migration;
  const migrated = m && m.from < 4;
  if (!migrated && S().blocks.length === 0) return; // cuenta nueva o copia de la nube aún cargando
  device.set({ [key]: true });
  // Si en 3.9 elegiste Mixto o Automático, lo explico y te dejo confirmarlo o volver a Preguntar.
  const current = mode();
  const askMode = migrated && current !== 'confirm' && !prefs(S()).replanConsentAt;
  const md = modeDetail(current);
  const sheet = openSheet({
    title: 'Bienvenido a Brújula 4',
    body: `<p class="muted">Tu horario, tus avances y tu configuración están intactos${migrated ? ` (guardé una copia previa por si acaso)` : ''}.</p>
      <ul class="feature-list">
        <li>${icon('compass')}<span><b>Hoy</b> te dice qué hacer ahora y qué espera tu decisión.</span></li>
        <li>${icon('layers')}<span><b>Temas y dominio</b>: ${migrated && m.topics ? `organicé ${plural(m.topics, 'tema', 'temas')} a partir de tus sesiones.` : 'cada sesión alimenta el dominio de su tema.'}</span></li>
        <li>${icon('target')}<span><b>Exámenes</b> con cuenta regresiva y plan de estudio${migrated && m.evaluations ? ` (${plural(m.evaluations, 'examen detectado', 'exámenes detectados')})` : ''}.</span></li>
        <li>${icon('rotate-ccw')}<span><b>Repasos espaciados</b> y registro de dificultades.</span></li>
        <li>${icon('sparkles')}<span><b>Asistente</b> que analiza tu semana; nada cambia sin tu aprobación.</span></li>
      </ul>
      ${askMode ? `<div class="notice">${icon(md.icon)}<div><b>Sigues en modo ${esc(md.title)}.</b> ${esc(md.text)} Solo actúa cuando marcas «No hice» o «Repasar». Clases, exámenes, temas dominados y tus descansos siguen protegidos, y todo se puede deshacer.</div></div>` : ''}`,
    foot: askMode
      ? `<button type="button" class="btn" data-mode-pick="confirm">Usar Preguntar</button><button type="button" class="btn btn-primary" data-mode-pick="keep">Mantener ${esc(md.title)}</button>`
      : `<button type="button" class="btn btn-primary" data-sheet-close>Empezar</button>`,
    onMount(card) {
      card.querySelectorAll('[data-mode-pick]').forEach((b) => b.addEventListener('click', () => {
        const keep = b.dataset.modePick === 'keep';
        S().preferences = { ...prefs(S()), replanMode: keep ? current : 'confirm', replanConsentAt: keep ? new Date().toISOString() : null };
        commit();
        sheet.close();
        toast(keep ? `Modo ${md.title} confirmado.` : 'Modo Preguntar activado: te consultaré cada cambio.', { tone: 'ok' });
      }));
    },
  });
}

export function versionLabel() { return `Brújula ${APP_VERSION}`; }
export { notify };
