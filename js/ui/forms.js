// Brújula 4 · formularios en hojas: alta rápida, actividad, curso, tema, evaluación y dificultad.

import { store, change } from '../core/store.js';
import { newBlock, KIND_LABEL, PRIORITY_LABEL, EVAL_TYPES, DIFFICULTY_KINDS, COURSE_COLORS, courseOf } from '../core/model.js';
import { todayISO, addDays, toMin, toHHMM, isValidDate, isValidTime, fmtRange, fmtRelDay, weekdayIndex, WEEKDAYS_SHORT } from '../core/dates.js';
import { esc, gid, cut, norm } from '../core/util.js';
import { rulesFrom } from '../engine/rules.js';
import { findSlot, violations, VIOLATION_TEXT } from '../engine/scheduler.js';
import { parseQuickAdd } from '../engine/quickadd.js';
import { openSheet, toast, confirmSheet } from './feedback.js';
import { formData } from './dom.js';
import { icon } from './icons.js';
import { undoToast } from '../features/undo-toast.js';
import { saveTopic, saveEvaluation, deleteBlock, deleteTopic, deleteEvaluation, addDifficulty, findTopic } from '../features/actions.js';

const S = () => store.state;
const activeCourses = () => S().courses.filter((c) => !c.archived);
const courseOptions = (selected) => activeCourses().map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
const KIND_ICON = { study: 'book-open', class: 'graduation-cap', exam: 'target', personal: 'sprout' };
const segKinds = (sel, name = 'kind') => `<div class="pick" role="radiogroup" aria-label="Tipo">${Object.entries(KIND_LABEL).map(([k, v]) => `<label><input type="radio" name="${name}" value="${k}" ${k === sel ? 'checked' : ''}><span>${icon(KIND_ICON[k])}${v}</span></label>`).join('')}</div>`;
const DEFAULT_DUR = { study: 45, class: 90, exam: 120, personal: 30 };

function rulesNow() { return rulesFrom(S().preferences); }
function suggest(duration, kind, fromDate, excludeId) {
  return findSlot({ blocks: S().blocks, rules: rulesNow(), now: new Date(), excludeIds: excludeId ? new Set([excludeId]) : null }, { duration, kind, fromDate, days: fromDate ? 7 : 8, preferStart: kind === 'study' ? 16 * 60 : null });
}
function placementWarnings({ date, start, end, kind, id }) {
  if (!isValidDate(date) || !isValidTime(start) || !isValidTime(end) || toMin(end) <= toMin(start)) return [];
  const v = violations({ blocks: S().blocks, rules: rulesNow(), now: new Date(), excludeIds: id ? new Set([id]) : null }, { date, start: toMin(start), end: toMin(end), kind });
  return v.filter((c) => c !== 'past' || date < todayISO()).map((c) => VIOLATION_TEXT[c]);
}

// ——— Alta rápida ———

export function openQuickAdd({ date = null, start = null } = {}) {
  const today = todayISO();
  const examples = ['Repasar vectores mañana 4pm', 'Clase de Física lunes 8:00', 'Gym hoy 6 a 7 de la tarde', 'Examen de C++ el 28/10 a las 9'];
  let parsed = null;
  const sheet = openSheet({
    title: 'Planificar',
    body: `<label class="field"><span class="sr-only">¿Qué quieres planificar?</span>
        <input class="input" id="qaText" autocomplete="off" autofocus placeholder="Ej.: ${esc(examples[Math.floor(Math.random() * examples.length)])}" maxlength="160" enterkeyhint="done"></label>
      <div id="qaPreview" class="stack" aria-live="polite"></div>
      <div class="hstack" id="qaKinds">${Object.entries(KIND_LABEL).map(([k, v]) => `<button type="button" class="btn btn-sm btn-soft" data-kind="${k}">${icon(KIND_ICON[k], 'sm')}${v}</button>`).join('')}</div>`,
    foot: `<button type="button" class="btn shrink" data-more>${icon('sliders-horizontal')}Detalles</button><button type="button" class="btn btn-primary" data-save disabled>${icon('check')}Guardar</button>`,
    onMount(card) {
      const input = card.querySelector('#qaText');
      const preview = card.querySelector('#qaPreview');
      const save = card.querySelector('[data-save]');
      let forcedKind = null;
      const compute = () => {
        const p = parseQuickAdd(input.value, { courses: S().courses, now: new Date(), today, sessionMin: rulesNow().sessionMin });
        if (forcedKind) p.kind = forcedKind;
        if (!p.title && input.value.trim()) p.title = input.value.trim().slice(0, 130);
        if (date && !p.found.includes('date')) p.date = date;
        if (start && !p.start) { p.start = start; p.end = toHHMM(Math.min(1439, toMin(start) + p.duration)); }
        let suggested = false;
        if (!p.start) {
          const slot = suggest(p.duration, p.kind, p.date || null);
          if (slot) { p.date = slot.date; p.start = slot.start; p.end = slot.end; suggested = true; }
        }
        if (!p.date) p.date = today;
        if (!p.courseId) p.courseId = p.kind === 'personal' ? (S().courses.find((c) => /vida|bienestar|personal/i.test(c.name))?.id || activeCourses()[0]?.id) : activeCourses().find((c) => !/vida|bienestar/i.test(c.name))?.id || activeCourses()[0]?.id;
        parsed = { ...p, suggested };
        return parsed;
      };
      const paint = () => {
        const text = input.value.trim();
        if (!text) { preview.innerHTML = '<p class="hint">Escribe qué, cuándo y cuánto. Si no pones hora, busco un hueco que respete tus descansos.</p>'; save.disabled = true; return; }
        const p = compute();
        const warns = p.start ? placementWarnings({ date: p.date, start: p.start, end: p.end, kind: p.kind }) : [];
        const c = courseOf(S(), p.courseId);
        preview.innerHTML = `<div class="panel panel-tight stack" style="--c:${esc(c.color)}">
            <b style="font-size:1.05rem">${esc(p.title || 'Sin título')}</b>
            <div class="hstack small">
              <span class="chip ${p.kind !== 'study' ? 'k-' + p.kind : ''}">${icon(KIND_ICON[p.kind], 'sm')}${KIND_LABEL[p.kind]}</span>
              <span class="course-tag" style="--c:${esc(c.color)}">${esc(c.name)}</span>
              ${p.start ? `<span class="chip route">${icon('calendar-clock', 'sm')}${esc(fmtRelDay(p.date, today))} ${esc(fmtRange(p.start, p.end))}</span>` : '<span class="chip urgent">Sin hueco libre</span>'}
              ${p.priority ? `<span class="chip urgent">${PRIORITY_LABEL[p.priority]}</span>` : ''}
            </div>
            ${p.suggested ? `<span class="hint">${icon('sparkle', 'sm')} Hora sugerida: el primer hueco libre que respeta tu rutina.</span>` : ''}
            ${warns.length ? `<span class="error-text">${esc(warns.join(' · '))}</span>` : ''}
          </div>`;
        save.disabled = !p.title || !p.start;
      };
      input.addEventListener('input', paint);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !save.disabled) { e.preventDefault(); save.click(); } });
      card.querySelector('#qaKinds').addEventListener('click', (e) => {
        const b = e.target.closest('[data-kind]');
        if (!b) return;
        forcedKind = forcedKind === b.dataset.kind ? null : b.dataset.kind;
        card.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('btn-primary', x.dataset.kind === forcedKind));
        card.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('btn-soft', x.dataset.kind !== forcedKind));
        if (!input.value.trim()) input.value = KIND_LABEL[forcedKind || 'study'] + ' ';
        input.focus(); paint();
      });
      card.querySelector('[data-more]').addEventListener('click', () => {
        const p = input.value.trim() ? compute() : null;
        sheet.close();
        openBlockForm(p ? newBlock({ title: p.title, date: p.date, start: p.start || '15:00', end: p.end || '16:00', kind: p.kind, courseId: p.courseId, priority: p.priority || 'normal' }) : newBlock({ date: date || today, ...(start ? { start, end: toHHMM(toMin(start) + 60) } : {}) }), { isNew: true });
      });
      save.addEventListener('click', async () => {
        const p = parsed || compute();
        if (!p.title || !p.start) return;
        const b = newBlock({ title: p.title, date: p.date, start: p.start, end: p.end, kind: p.kind, courseId: p.courseId, priority: p.priority || 'normal', difficulty: p.kind === 'exam' ? 4 : 3, origin: 'quick-add' });
        const overlap = placementWarnings(b).includes(VIOLATION_TEXT.overlap);
        if (overlap && !(await confirmSheet({ title: 'Se cruza con otra actividad', text: '¿Guardar de todos modos?', confirm: 'Guardar igual' }))) return;
        sheet.close();
        const { entry } = change({ label: `Añadir «${cut(b.title, 40)}»`, type: 'add', mutate: (st) => { st.blocks.push(b); ensureEvaluationForExam(st, b); }, event: { block: b, status: 'scheduled', reason: 'Alta rápida', type: 'add' } });
        undoToast(`Guardado: ${fmtRelDay(b.date, today)} ${b.start}`, entry);
      });
      paint();
    },
  });
  return sheet;
}

/** Un examen del calendario tiene su evaluación (para prioridades y planes). Se llama dentro de `mutate`. */
export function ensureEvaluationForExam(s, b) {
  if (!b || b.kind !== 'exam' || s.evaluations.some((e) => e.blockId === b.id)) return;
  const ev = { id: gid(), courseId: b.courseId, title: b.title, type: 'exam', date: b.date, time: b.start, weight: null, topicIds: s.topics.filter((t) => t.courseId === b.courseId && t.level !== 'mastered').map((t) => t.id), status: b.date < todayISO() ? 'done' : 'upcoming', grade: null, maxGrade: 20, blockId: b.id, notes: '', origin: 'calendar' };
  s.evaluations.push(ev);
  b.evaluationId = ev.id;
}

// ——— Actividad (crear / editar) ———

export function openBlockForm(block, { isNew = false } = {}) {
  const s = S();
  const b = block || newBlock({ date: todayISO() });
  const existing = !isNew && s.blocks.some((x) => x.id === b.id);
  const topics = (courseId) => s.topics.filter((t) => t.courseId === courseId);
  const topicOpts = (courseId, sel) => `<option value="">Sin tema</option>${topics(courseId).map((t) => `<option value="${esc(t.id)}" ${t.id === sel ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}`;
  const L = b.lesson || {};
  const dur = Math.max(5, toMin(b.end) - toMin(b.start));
  const body = `<form class="stack" id="blockForm" novalidate>
    <label class="field"><span>Qué</span><input class="input" name="title" required maxlength="130" value="${esc(b.title)}" placeholder="Ej.: MRU — 3 ejercicios" ${isNew ? 'autofocus' : ''}></label>
    ${segKinds(b.kind)}
    <div class="form-grid">
      <label class="field full"><span>Curso o área</span><select class="select" name="courseId">${courseOptions(b.courseId)}</select></label>
      <label class="field"><span>Día</span><input class="input" type="date" name="date" value="${esc(b.date)}" required></label>
      <label class="field"><span>Duración</span><select class="select" name="dur">${[15, 25, 30, 45, 60, 90, 120, 150, 180, 240].map((m) => `<option value="${m}" ${m === dur ? 'selected' : ''}>${m < 60 ? m + ' min' : (m / 60) + ' h'}</option>`).join('')}${[15, 25, 30, 45, 60, 90, 120, 150, 180, 240].includes(dur) ? '' : `<option value="${dur}" selected>${dur} min</option>`}</select></label>
      <label class="field"><span>Desde</span><input class="input" type="time" name="start" value="${esc(b.start)}" required></label>
      <label class="field"><span>Hasta</span><input class="input" type="time" name="end" value="${esc(b.end)}" required></label>
    </div>
    <div class="hstack"><button type="button" class="btn btn-sm btn-soft" data-find>${icon('sparkle', 'sm')}Buscar hueco libre</button><span class="hint" id="bfWarn" aria-live="polite"></span></div>
    ${!existing ? `<details class="stack"><summary class="label">Repetir cada semana</summary>
      <div class="pick" style="margin-top:8px">${WEEKDAYS_SHORT.map((d, i) => `<label><input type="checkbox" name="repeatDays" value="${i}"><span>${d}</span></label>`).join('')}</div>
      <label class="field" style="margin-top:8px"><span>Hasta</span><input class="input" type="date" name="repeatUntil" value="${esc(addDays(b.date, 7 * 16))}"></label>
      <p class="hint">Ideal para tu horario de clases del ciclo. Se crea una actividad por cada día.</p></details>` : ''}
    <div class="form-grid">
      <label class="field"><span>Prioridad</span><select class="select" name="priority">${Object.entries(PRIORITY_LABEL).map(([k, v]) => `<option value="${k}" ${k === b.priority ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span>Dificultad</span><select class="select" name="difficulty">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === Number(b.difficulty) ? 'selected' : ''}>${n} de 5</option>`).join('')}</select></label>
      <label class="field full" id="bfTopicWrap"><span>Tema</span><select class="select" name="topicId">${topicOpts(b.courseId, b.topicId)}</select></label>
    </div>
    <label class="field"><span>Objetivo</span><textarea class="textarea" name="goal" rows="2" maxlength="1200" placeholder="Ej.: resolver 3 problemas sin ayuda">${esc(b.goal)}</textarea></label>
    <details><summary class="label">Material para la sesión guiada</summary><div class="stack" style="margin-top:10px">
      <label class="field"><span>Explicación o apuntes</span><textarea class="textarea" name="intro" maxlength="6000">${esc(L.intro || '')}</textarea></label>
      <label class="field"><span>Ejercicio</span><textarea class="textarea" name="problem" rows="2" maxlength="3000">${esc(L.problem || '')}</textarea></label>
      <label class="field"><span>Pasos de solución (uno por línea)</span><textarea class="textarea" name="steps" rows="3" maxlength="4000">${esc((L.steps || []).join('\n'))}</textarea></label>
      <label class="field"><span>Pregunta de control</span><input class="input" name="question" maxlength="500" value="${esc(L.question || '')}"></label>
      <label class="field"><span>Respuesta esperada</span><input class="input" name="answer" maxlength="500" value="${esc(L.answer || '')}"></label>
    </div></details>
  </form>`;
  const sheet = openSheet({
    title: existing ? 'Editar actividad' : 'Nueva actividad', body, wide: true,
    foot: `${existing ? `<button type="button" class="btn btn-danger shrink" data-del aria-label="Eliminar">${icon('trash')}</button>` : ''}<button type="button" class="btn" data-sheet-close>Cancelar</button><button type="button" class="btn btn-primary" data-save>${icon('check')}Guardar</button>`,
    onMount(card) {
      const form = card.querySelector('#blockForm');
      const el = (n) => form.elements[n];
      const warn = card.querySelector('#bfWarn');
      const kind = () => form.querySelector('input[name="kind"]:checked')?.value || 'study';
      const syncEnd = () => { if (isValidTime(el('start').value)) el('end').value = toHHMM(Math.min(1439, toMin(el('start').value) + Number(el('dur').value))); };
      const check = () => {
        const w = placementWarnings({ date: el('date').value, start: el('start').value, end: el('end').value, kind: kind(), id: b.id });
        warn.textContent = w.length ? '⚠ ' + w.join(' · ') : '';
        warn.className = w.length ? 'error-text' : 'hint';
        card.querySelector('#bfTopicWrap').hidden = kind() !== 'study';
      };
      el('start').addEventListener('change', () => { syncEnd(); check(); });
      el('dur').addEventListener('change', () => { syncEnd(); check(); });
      el('end').addEventListener('change', () => { const d = toMin(el('end').value) - toMin(el('start').value); if (d > 0) { if (![...el('dur').options].some((o) => Number(o.value) === d)) el('dur').insertAdjacentHTML('beforeend', `<option value="${d}">${d} min</option>`); el('dur').value = String(d); } check(); });
      el('date').addEventListener('change', check);
      form.addEventListener('change', (e) => {
        if (e.target.name === 'kind') { const k = kind(); if (!existing) { el('dur').value = String(DEFAULT_DUR[k]); syncEnd(); } check(); }
        if (e.target.name === 'courseId') { el('topicId').innerHTML = topicOpts(el('courseId').value, ''); }
      });
      card.querySelector('[data-find]').addEventListener('click', () => {
        const slot = suggest(Number(el('dur').value), kind(), el('date').value >= todayISO() ? el('date').value : null, b.id);
        if (!slot) { toast('No hay un hueco libre que respete tus descansos esa semana.', { tone: 'warn' }); return; }
        el('date').value = slot.date; el('start').value = slot.start; el('end').value = slot.end; check();
        toast(`Hueco libre: ${fmtRelDay(slot.date, todayISO())} ${slot.start}`, { tone: 'ok' });
      });
      card.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (await confirmSheet({ title: 'Eliminar actividad', text: `«${cut(b.title, 60)}» y sus notas se eliminarán. Podrás deshacerlo.`, confirm: 'Eliminar', danger: true })) { sheet.close(); deleteBlock(b.id); }
      });
      card.querySelector('[data-save]').addEventListener('click', async () => {
        const d = formData(form);
        d.kind = kind();
        if (!d.title.trim()) { el('title').focus(); toast('Escribe un título.', { tone: 'warn' }); return; }
        if (!isValidDate(d.date) || !isValidTime(d.start) || !isValidTime(d.end) || toMin(d.end) <= toMin(d.start)) { toast('Revisa el día y las horas: el fin debe ser posterior al inicio.', { tone: 'warn' }); return; }
        const warns = placementWarnings({ ...d, id: b.id });
        if (warns.includes(VIOLATION_TEXT.overlap) && !(await confirmSheet({ title: 'Se cruza con otra actividad', text: '¿Guardar de todos modos?', confirm: 'Guardar igual' }))) return;
        const lesson = { intro: d.intro.trim(), problem: d.problem.trim(), steps: d.steps.split('\n').map((x) => x.trim()).filter(Boolean), question: d.question.trim(), answer: d.answer.trim() };
        const fields = { title: d.title.trim(), kind: d.kind, courseId: d.courseId, date: d.date, start: d.start, end: d.end, priority: d.priority, difficulty: Number(d.difficulty), goal: d.goal.trim(), lesson };
        if (d.kind === 'study' && d.topicId) fields.topicId = d.topicId;
        const days = (d.repeatDays || []).map(Number);
        const until = isValidDate(d.repeatUntil) ? d.repeatUntil : addDays(d.date, 7 * 16);
        sheet.close();
        if (existing) {
          const { entry } = change({
            label: `Editar «${cut(fields.title, 40)}»`, type: 'edit', blockIds: [b.id],
            mutate(st) {
              const x = st.blocks.find((y) => y.id === b.id);
              const moved = x.date !== fields.date || x.start !== fields.start;
              Object.assign(x, fields);
              if (d.kind !== 'study' || !d.topicId) delete x.topicId;
              if (moved && ['missed', 'paused'].includes(x.status)) x.status = 'scheduled';
              const ev = x.evaluationId ? st.evaluations.find((e) => e.id === x.evaluationId && e.blockId === x.id) : null;
              if (ev) { ev.date = x.date; ev.time = x.start; ev.title = x.title; ev.courseId = x.courseId; }
            },
          });
          undoToast('Actividad actualizada.', entry);
          return;
        }
        const created = [];
        const seriesId = days.length ? gid() : null;
        const base = newBlock({ ...b, ...fields, id: gid(), status: 'scheduled', origin: b.origin || 'form' });
        if (seriesId) base.seriesId = seriesId;
        created.push(base);
        if (days.length) {
          for (let dte = addDays(d.date, 1); dte <= until && created.length < 160; dte = addDays(dte, 1)) {
            if (days.includes(weekdayIndex(dte))) created.push(newBlock({ ...fields, id: gid(), date: dte, seriesId, lesson: { ...lesson }, origin: 'series' }));
          }
        }
        const { entry } = change({ label: created.length > 1 ? `Serie «${cut(fields.title, 30)}»` : `Añadir «${cut(fields.title, 40)}»`, type: 'add', mutate: (st) => { st.blocks.push(...created); for (const x of created) ensureEvaluationForExam(st, x); }, event: { block: base, status: 'scheduled', reason: created.length > 1 ? `Serie semanal de ${created.length} actividades` : 'Nueva actividad', type: 'add' } });
        undoToast(created.length > 1 ? `${created.length} actividades creadas.` : 'Actividad guardada.', entry);
      });
      check();
    },
  });
  return sheet;
}

// ——— Curso ———

export function openCourseForm(course = null) {
  const c = course || { id: null, name: '', color: COURSE_COLORS[S().courses.length % COURSE_COLORS.length], difficulty: 3, importance: 3, credits: '' };
  const swatches = COURSE_COLORS.map((col) => `<label><input type="radio" name="color" value="${col}" ${col.toLowerCase() === String(c.color).toLowerCase() ? 'checked' : ''}><span style="background:${col};color:#fff;border-color:${col};min-width:36px;justify-content:center" aria-label="Color ${col}">${col.toLowerCase() === String(c.color).toLowerCase() ? icon('check', 'sm') : '&nbsp;'}</span></label>`).join('');
  const sheet = openSheet({
    title: c.id ? 'Editar curso' : 'Nuevo curso',
    body: `<form class="stack" id="courseForm">
      <label class="field"><span>Nombre</span><input class="input" name="name" required maxlength="80" value="${esc(c.name)}" placeholder="Ej.: Cálculo II" autofocus></label>
      <div class="field"><span>Color</span><div class="pick" id="swatches">${swatches}${COURSE_COLORS.some((x) => x.toLowerCase() === String(c.color).toLowerCase()) ? '' : `<label><input type="radio" name="color" value="${esc(c.color)}" checked><span style="background:${esc(c.color)};color:#fff;min-width:36px">${icon('check', 'sm')}</span></label>`}</div></div>
      <div class="form-grid">
        <label class="field"><span>Dificultad</span><select class="select" name="difficulty">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === Number(c.difficulty) ? 'selected' : ''}>${n} de 5</option>`).join('')}</select></label>
        <label class="field"><span>Importancia</span><select class="select" name="importance">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === Number(c.importance || 3) ? 'selected' : ''}>${n} de 5</option>`).join('')}</select></label>
        <label class="field"><span>Créditos</span><input class="input" name="credits" type="number" min="0" max="30" step="1" inputmode="numeric" value="${esc(c.credits ?? '')}" placeholder="Opcional"></label>
      </div>
      <p class="hint">Importancia y dificultad ayudan a decidir qué estudiar primero.</p>
    </form>`,
    foot: `${c.id ? `<button type="button" class="btn shrink" data-archive>${icon(c.archived ? 'archive-restore' : 'archive')}${c.archived ? 'Reactivar' : 'Archivar'}</button>` : ''}<button type="button" class="btn" data-sheet-close>Cancelar</button><button type="button" class="btn btn-primary" data-save>${icon('check')}Guardar</button>`,
    onMount(card) {
      const form = card.querySelector('#courseForm');
      card.querySelector('#swatches').addEventListener('change', () => { card.querySelectorAll('#swatches span').forEach((sp) => { sp.innerHTML = sp.previousElementSibling.checked ? icon('check', 'sm') : '&nbsp;'; }); });
      card.querySelector('[data-archive]')?.addEventListener('click', () => {
        sheet.close();
        const { entry } = change({ label: 'Archivar curso', type: 'course', mutate: (st) => { const x = st.courses.find((y) => y.id === c.id); x.archived = !x.archived; } });
        undoToast(c.archived ? 'Curso reactivado.' : 'Curso archivado. Sus actividades se conservan.', entry);
      });
      card.querySelector('[data-save]').addEventListener('click', () => {
        const d = formData(form);
        const name = d.name.trim();
        if (!name) { form.elements.name.focus(); return; }
        if (S().courses.some((x) => x.id !== c.id && norm(x.name) === norm(name))) { toast('Ya existe un curso con ese nombre.', { tone: 'warn' }); return; }
        const fields = { name, color: d.color || c.color, difficulty: Number(d.difficulty), importance: Number(d.importance), credits: d.credits === '' ? null : Number(d.credits) };
        sheet.close();
        const { entry } = change({
          label: c.id ? 'Editar curso' : 'Nuevo curso', type: 'course',
          mutate: (st) => { if (c.id) Object.assign(st.courses.find((x) => x.id === c.id), fields); else st.courses.push({ id: gid(), archived: false, ...fields }); },
        });
        undoToast(c.id ? 'Curso actualizado.' : 'Curso creado.', entry);
      });
    },
  });
  return sheet;
}

// ——— Tema ———

export function openTopicForm(topic = null, { courseId = null } = {}) {
  const s = S();
  const t = topic || { id: null, title: '', courseId: courseId || activeCourses()[0]?.id, difficulty: 3, prereqIds: [], lesson: {}, notes: '' };
  const prereqList = (cid) => s.topics.filter((x) => x.courseId === cid && x.id !== t.id).map((x) => `<label><input type="checkbox" name="prereqIds" value="${esc(x.id)}" ${(t.prereqIds || []).includes(x.id) ? 'checked' : ''}><span>${esc(cut(x.title, 40))}</span></label>`).join('') || '<span class="hint">Aún no hay otros temas en este curso.</span>';
  const L = t.lesson || {};
  const sheet = openSheet({
    title: t.id ? 'Editar tema' : 'Nuevo tema', wide: true,
    body: `<form class="stack" id="topicForm">
      <label class="field"><span>Tema</span><input class="input" name="title" required maxlength="120" value="${esc(t.title)}" placeholder="Ej.: Movimiento rectilíneo uniforme" autofocus></label>
      <div class="form-grid">
        <label class="field"><span>Curso</span><select class="select" name="courseId">${courseOptions(t.courseId)}</select></label>
        <label class="field"><span>Dificultad</span><select class="select" name="difficulty">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === Number(t.difficulty) ? 'selected' : ''}>${n} de 5</option>`).join('')}</select></label>
      </div>
      <div class="field"><span>Necesito dominar antes</span><div class="pick" id="prereqs">${prereqList(t.courseId)}</div></div>
      <details><summary class="label">Material del tema</summary><div class="stack" style="margin-top:10px">
        <label class="field"><span>Explicación o apuntes</span><textarea class="textarea" name="intro" maxlength="6000">${esc(L.intro || '')}</textarea></label>
        <label class="field"><span>Ejercicio</span><textarea class="textarea" name="problem" rows="2" maxlength="3000">${esc(L.problem || '')}</textarea></label>
        <label class="field"><span>Pasos (uno por línea)</span><textarea class="textarea" name="steps" rows="3" maxlength="4000">${esc((L.steps || []).join('\n'))}</textarea></label>
        <label class="field"><span>Pregunta de control</span><input class="input" name="question" maxlength="500" value="${esc(L.question || '')}"></label>
        <label class="field"><span>Respuesta</span><input class="input" name="answer" maxlength="500" value="${esc(L.answer || '')}"></label>
      </div></details>
      <label class="field"><span>Notas</span><textarea class="textarea" name="notes" rows="2" maxlength="2000">${esc(t.notes || '')}</textarea></label>
    </form>`,
    foot: `${t.id ? `<button type="button" class="btn btn-danger shrink" data-del aria-label="Eliminar tema">${icon('trash')}</button>` : ''}<button type="button" class="btn" data-sheet-close>Cancelar</button><button type="button" class="btn btn-primary" data-save>${icon('check')}Guardar</button>`,
    onMount(card) {
      const form = card.querySelector('#topicForm');
      form.elements.courseId.addEventListener('change', () => { card.querySelector('#prereqs').innerHTML = prereqList(form.elements.courseId.value); });
      card.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (await confirmSheet({ title: 'Eliminar tema', text: 'Las sesiones del horario se conservan; solo se quita el seguimiento del tema.', confirm: 'Eliminar', danger: true })) { sheet.close(); deleteTopic(t.id); }
      });
      card.querySelector('[data-save]').addEventListener('click', () => {
        const d = formData(form);
        if (!d.title.trim()) { form.elements.title.focus(); return; }
        const lesson = { intro: d.intro.trim(), problem: d.problem.trim(), steps: d.steps.split('\n').map((x) => x.trim()).filter(Boolean), question: d.question.trim(), answer: d.answer.trim() };
        const saved = saveTopic({ title: d.title.trim(), courseId: d.courseId, difficulty: Number(d.difficulty), prereqIds: d.prereqIds || [], lesson, notes: d.notes.trim() }, t.id);
        if (saved) { sheet.close(); toast(t.id ? 'Tema actualizado.' : 'Tema creado.', { tone: 'ok' }); }
      });
    },
  });
  return sheet;
}

// ——— Evaluación ———

export function openEvaluationForm(ev = null, { courseId = null } = {}) {
  const s = S();
  const e = ev || { id: null, title: '', courseId: courseId || activeCourses().find((c) => !/vida|bienestar/i.test(c.name))?.id || activeCourses()[0]?.id, type: 'exam', date: addDays(todayISO(), 7), time: '09:00', weight: '', topicIds: [], notes: '' };
  const linked = e.blockId ? s.blocks.find((b) => b.id === e.blockId) : null;
  const dur = linked ? toMin(linked.end) - toMin(linked.start) : 120;
  const topicChecks = (cid) => s.topics.filter((t) => t.courseId === cid).map((t) => `<label><input type="checkbox" name="topicIds" value="${esc(t.id)}" ${(e.topicIds || []).includes(t.id) || (!e.id && t.level !== 'mastered') ? 'checked' : ''}><span>${esc(cut(t.title, 40))}</span></label>`).join('') || '<span class="hint">Este curso aún no tiene temas. Puedes añadirlos después.</span>';
  const sheet = openSheet({
    title: e.id ? 'Editar evaluación' : 'Nueva evaluación', wide: true,
    body: `<form class="stack" id="evalForm">
      <label class="field"><span>Nombre</span><input class="input" name="title" required maxlength="120" value="${esc(e.title)}" placeholder="Ej.: Parcial de Física I" autofocus></label>
      <div class="pick" role="radiogroup" aria-label="Tipo">${Object.entries(EVAL_TYPES).map(([k, v]) => `<label><input type="radio" name="type" value="${k}" ${k === e.type ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
      <div class="form-grid">
        <label class="field full"><span>Curso</span><select class="select" name="courseId">${courseOptions(e.courseId)}</select></label>
        <label class="field"><span>Fecha</span><input class="input" type="date" name="date" value="${esc(e.date)}" required></label>
        <label class="field"><span>Hora (opcional)</span><input class="input" type="time" name="time" value="${esc(e.time || '')}"></label>
        <label class="field"><span>Duración</span><select class="select" name="duration">${[30, 60, 90, 120, 150, 180].map((m) => `<option value="${m}" ${m === dur ? 'selected' : ''}>${m < 60 ? m + ' min' : m / 60 + ' h'}</option>`).join('')}</select></label>
        <label class="field"><span>Peso en la nota (%)</span><input class="input" type="number" name="weight" min="0" max="100" inputmode="numeric" value="${esc(e.weight ?? '')}" placeholder="Opcional"></label>
      </div>
      <div class="field"><span>Temas que entran</span><div class="pick" id="evTopics">${topicChecks(e.courseId)}</div></div>
      <label class="field"><span>Notas</span><textarea class="textarea" name="notes" rows="2" maxlength="1200" placeholder="Aula, materiales permitidos…">${esc(e.notes || '')}</textarea></label>
      <p class="hint">Si tiene hora, se reserva en tu horario y queda protegida.</p>
    </form>`,
    foot: `${e.id ? `<button type="button" class="btn btn-danger shrink" data-del aria-label="Eliminar evaluación">${icon('trash')}</button>` : ''}<button type="button" class="btn" data-sheet-close>Cancelar</button><button type="button" class="btn btn-primary" data-save>${icon('check')}Guardar</button>`,
    onMount(card) {
      const form = card.querySelector('#evalForm');
      form.elements.courseId.addEventListener('change', () => { card.querySelector('#evTopics').innerHTML = topicChecks(form.elements.courseId.value); });
      card.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (await confirmSheet({ title: 'Eliminar evaluación', text: 'También se quita su bloque del horario. Podrás deshacerlo.', confirm: 'Eliminar', danger: true })) { sheet.close(); deleteEvaluation(e.id); }
      });
      card.querySelector('[data-save]').addEventListener('click', () => {
        const d = formData(form);
        if (!d.title.trim()) { form.elements.title.focus(); return; }
        if (!isValidDate(d.date)) { toast('Elige una fecha válida.', { tone: 'warn' }); return; }
        const fields = { title: d.title.trim(), type: d.type || 'exam', courseId: d.courseId, date: d.date, time: isValidTime(d.time) ? d.time : '', weight: d.weight === '' ? null : Math.max(0, Math.min(100, Number(d.weight))), topicIds: d.topicIds || [], notes: d.notes.trim(), duration: Number(d.duration), status: d.date < todayISO() ? 'done' : 'upcoming' };
        sheet.close();
        saveEvaluation(fields, e.id);
      });
    },
  });
  return sheet;
}

// ——— Dificultad ———

export function openDifficultyForm({ topicId = null, courseId = null, blockId = null } = {}) {
  const t = topicId ? findTopic(topicId) : null;
  const sheet = openSheet({
    title: '¿Qué te costó?', subtitle: t ? esc(t.title) : '',
    body: `<form class="stack" id="diffForm">
      <div class="pick" role="radiogroup" aria-label="Tipo de dificultad">${Object.entries(DIFFICULTY_KINDS).map(([k, v], i) => `<label><input type="radio" name="kind" value="${k}" ${i === 0 ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
      <label class="field"><span>En pocas palabras</span><textarea class="textarea" name="text" rows="3" maxlength="300" placeholder="Ej.: no sé cuándo usar v = v₀ + a·t" autofocus></textarea></label>
    </form>`,
    foot: `<button type="button" class="btn" data-sheet-close>Cancelar</button><button type="button" class="btn btn-primary" data-save>${icon('check')}Anotar</button>`,
    onMount(card) {
      card.querySelector('[data-save]').addEventListener('click', () => {
        const d = formData(card.querySelector('#diffForm'));
        sheet.close();
        addDifficulty({ topicId, courseId: courseId || t?.courseId, blockId, kind: d.kind || 'other', text: d.text.trim() });
      });
    },
  });
  return sheet;
}

