// Brújula 4 · Estudio: cursos, temas (dominio y requisitos), evaluaciones y repasos espaciados.

import { esc, cut, cap, plural } from '../core/util.js';
import { store } from '../core/store.js';
import { courseOf, EVAL_TYPES, DIFFICULTY_KINDS, lessonFor, isUsableBlock } from '../core/model.js';
import { todayISO, fmtRelDay, fmtShort, diffDays, fmtDuration } from '../core/dates.js';
import { rankPriorities, upcomingEvaluations } from '../engine/priority.js';
import { dueTopics, GRADES, GRADE_LABEL, overdueDays, nextEvaluationFor } from '../engine/srs.js';
import { courseStats } from '../engine/insights.js';
import { icon } from '../ui/icons.js';
import { action } from '../ui/dom.js';
import { go } from '../ui/router.js';
import { courseTag, levelChip, masteryMeter, emptyState, sectionHead, blockRow } from './common.js';
import { openCourseForm, openTopicForm, openEvaluationForm, openDifficultyForm } from '../ui/forms.js';
import { openQuickReview } from '../ui/details.js';
import { reviewTopic, scheduleTopic, planExam, resolveDifficulty, findTopic } from '../features/actions.js';

const TABS = [['cursos', 'Cursos', 'library'], ['temas', 'Temas', 'layers'], ['evaluaciones', 'Exámenes', 'target'], ['repasos', 'Repasos', 'rotate-ccw']];
let topicFilter = 'all';

export function title(c) {
  if (c.route.name === 'tema') return findTopic(c.route.params[0])?.title || 'Tema';
  return 'Estudio';
}
export function subtitle(c) {
  if (c.route.name === 'tema') { const t = findTopic(c.route.params[0]); return t ? courseOf(c.state, t.courseId).name : ''; }
  const s = c.state;
  const n = s.topics.length;
  return n ? `${plural(n, 'tema', 'temas')} · ${plural(s.courses.filter((x) => !x.archived).length, 'curso', 'cursos')}` : 'Cursos, temas y exámenes';
}

function tabsBar(cur, s) {
  const counts = { repasos: dueTopics(s, todayISO()).length, evaluaciones: upcomingEvaluations(s, new Date(), 60).length };
  return `<nav class="tabs fill" aria-label="Secciones de estudio">${TABS.map(([k, label, ic]) => `<a href="#/estudio/${k}" ${k === cur ? 'aria-current="page"' : ''}>${icon(ic, 'sm')}${label}${counts[k] ? ` <span class="count-badge">${counts[k]}</span>` : ''}</a>`).join('')}</nav>`;
}

function coursesTab(s, now) {
  const stats = courseStats(s, now);
  const archived = s.courses.filter((c) => c.archived);
  const cards = stats.map((st) => {
    const c = st.course;
    return `<a class="course-card" href="#/curso/${encodeURIComponent(c.id)}" style="--c:${esc(c.color)};text-decoration:none;color:inherit">
      <div class="hstack between"><h3>${esc(c.name)}</h3>${st.nextEval ? `<span class="chip ${st.nextEval.daysLeft <= 3 ? 'urgent' : ''}">${icon('target', 'sm')}${st.nextEval.daysLeft === 0 ? 'hoy' : st.nextEval.daysLeft === 1 ? 'mañana' : st.nextEval.daysLeft + ' días'}</span>` : ''}</div>
      ${st.mastery != null ? `<div class="hstack" style="gap:10px">${masteryMeter(st.mastery)}<span class="small muted nowrap">${st.mastery}% dominio</span></div>` : ''}
      <div class="stats">${st.topics ? `<span><b>${st.topics}</b> ${st.topics === 1 ? 'tema' : 'temas'}</span>` : '<span class="zero">Sin temas aún</span>'}${st.due ? `<span><b>${st.due}</b> por repasar</span>` : ''}${st.studiedWeek ? `<span><b>${esc(fmtDuration(st.studiedWeek))}</b> esta semana</span>` : ''}${c.credits ? `<span><b>${c.credits}</b> créditos</span>` : ''}</div>
    </a>`;
  }).join('');
  return `<div class="stack">
    <div class="hstack between"><p class="muted small">1. Crea tu curso. 2. Entra al curso y añade temas. 3. Pulsa «Programar sesión» para llevar un tema al horario. 4. Registra exámenes para que Brújula priorice repasos.</p><button type="button" class="btn btn-sm" data-act="new-course">${icon('plus', 'sm')}Curso</button></div>
    ${stats.length ? `<div class="cards two three">${cards}</div>` : emptyState({ title: 'Agrega tus cursos', text: 'Nombre, color, dificultad y créditos. Luego sus temas y exámenes.', action: 'new-course', actionLabel: 'Nuevo curso' })}
    ${archived.length ? `<details><summary class="label">${plural(archived.length, 'curso archivado', 'cursos archivados')}</summary><div class="hstack" style="margin-top:8px">${archived.map((c) => `<a class="chip" href="#/curso/${encodeURIComponent(c.id)}">${esc(c.name)}</a>`).join('')}</div></details>` : ''}
  </div>`;
}

export function topicRow(t, s, today, { rankReasons = null } = {}) {
  const od = overdueDays(t, today);
  const ev = nextEvaluationFor(s, t, today);
  const reasons = rankReasons || [];
  const missingPre = (t.prereqIds || []).map(findTopic).filter((p) => p && p.level !== 'mastered');
  const due = od != null && od >= 0;
  return `<li class="topic-row"><div style="min-width:0">
      <a class="t" href="#/tema/${encodeURIComponent(t.id)}">${esc(t.title)}</a>
      <div class="sub">${levelChip(t)}${masteryMeter(t.mastery)}<span>${Number(t.mastery) || 0}%</span>
        ${due ? `<span class="chip ${od > 0 ? 'urgent' : 'route'}">${icon('rotate-ccw', 'sm')}${od === 0 ? 'Repasar hoy' : `Vencido ${od} d`}</span>` : t.srs?.due ? `<span>repaso ${esc(fmtRelDay(t.srs.due, today))}</span>` : ''}
        ${ev ? `<span class="chip ${diffDays(today, ev.date) <= 3 ? 'urgent' : ''}">${icon('target', 'sm')}${esc(cut(ev.title, 24))}</span>` : ''}
        ${missingPre.length ? `<span class="chip" title="Requisitos pendientes">${icon('git-branch', 'sm')}Antes: ${esc(cut(missingPre[0].title, 22))}</span>` : ''}
        ${reasons.filter((r) => r.code === 'diff').map((r) => `<span class="chip">${esc(r.text)}</span>`).join('')}
      </div></div>
    <button type="button" class="btn btn-sm ${due ? 'btn-primary' : ''}" data-act="${due ? 'topic-review' : 'topic-plan'}" data-id="${esc(t.id)}">${icon(due ? 'rotate-ccw' : 'calendar-plus', 'sm')}${due ? 'Repasar' : 'Programar'}</button>
  </li>`;
}

function topicsTab(s, now) {
  const today = todayISO(now);
  const ranked = rankPriorities(s, now).filter((p) => p.type === 'topic');
  const rankMap = new Map(ranked.map((p, i) => [p.id, { i, reasons: p.reasons }]));
  const active = s.courses.filter((c) => !c.archived);
  let topics = s.topics.filter((t) => active.some((c) => c.id === t.courseId));
  if (topicFilter !== 'all') topics = topics.filter((t) => t.courseId === topicFilter);
  topics.sort((a, b) => (rankMap.get(a.id)?.i ?? 999) - (rankMap.get(b.id)?.i ?? 999) || (a.mastery || 0) - (b.mastery || 0));
  const groups = { work: topics.filter((t) => t.level !== 'mastered'), done: topics.filter((t) => t.level === 'mastered') };
  return `<div class="stack">
    <div class="hstack between"><div class="tabs" role="tablist" aria-label="Filtrar por curso"><button type="button" role="tab" aria-selected="${topicFilter === 'all'}" data-act="topic-filter" data-id="all">Todos</button>${active.map((c) => `<button type="button" role="tab" aria-selected="${topicFilter === c.id}" data-act="topic-filter" data-id="${esc(c.id)}">${esc(cut(c.name, 18))}</button>`).join('')}</div>
      <button type="button" class="btn btn-sm" data-act="new-topic" data-course="${esc(topicFilter === 'all' ? '' : topicFilter)}">${icon('plus', 'sm')}Tema</button></div>
    ${topics.length ? `<div class="panel"><ul class="list">${groups.work.map((t) => topicRow(t, s, today, { rankReasons: rankMap.get(t.id)?.reasons })).join('')}</ul>
      ${groups.done.length ? `<details style="margin-top:6px"><summary class="label">${plural(groups.done.length, 'tema dominado', 'temas dominados')}</summary><ul class="list">${groups.done.map((t) => topicRow(t, s, today)).join('')}</ul></details>` : ''}</div>`
      : emptyState({ title: 'Aún no hay temas', text: 'Cada sesión de estudio crea su tema al marcar «Lo domino» o «Repasar». También puedes añadirlos con sus requisitos.', action: 'new-topic', actionLabel: 'Nuevo tema' })}
  </div>`;
}

function evalsTab(s, now) {
  const today = todayISO(now);
  const upcoming = upcomingEvaluations(s, now, 365);
  const past = s.evaluations.filter((e) => e.date < today || e.status === 'done' || e.status === 'graded').sort((a, b) => b.date.localeCompare(a.date));
  const card = (e) => `<button type="button" class="eval-card ${e.daysLeft <= 3 ? 'soon' : ''}" data-act="open-eval" data-id="${esc(e.id)}">
    <span class="eval-days"><b>${e.daysLeft}</b><span>${e.daysLeft === 0 ? 'hoy' : e.daysLeft === 1 ? 'día' : 'días'}</span></span>
    <b class="t">${esc(e.title)}</b>
    <span class="hstack small">${courseTag(e.courseId, { short: true })}<span class="muted">${esc(EVAL_TYPES[e.type] || '')} · ${esc(fmtShort(e.date))}${e.time ? ' ' + esc(e.time) : ''}${e.weight ? ` · ${e.weight}%` : ''}</span></span>
    ${e.prep != null ? `<span class="hstack small" style="gap:8px">${masteryMeter(e.prep)}<span class="muted nowrap">${e.prep}% listo</span></span>` : '<span class="small muted">Sin temas asignados</span>'}
  </button>`;
  return `<div class="stack">
    <div class="hstack between"><p class="muted small">Exámenes, prácticas y entregas. Tu preparación se mide con el dominio de sus temas.</p><button type="button" class="btn btn-sm" data-act="new-eval">${icon('plus', 'sm')}Evaluación</button></div>
    ${upcoming.length ? `<div class="cards two">${upcoming.map(card).join('')}</div>` : emptyState({ title: 'Sin evaluaciones próximas', text: 'Registra exámenes, entregas y exposiciones para ver la cuenta regresiva y armar planes.', action: 'new-eval', actionLabel: 'Nueva evaluación' })}
    ${past.length ? `<section class="section">${sectionHead('Pasadas')}<div class="panel"><ul class="list">${past.slice(0, 12).map((e) => `<li class="topic-row"><div><button type="button" class="t" data-act="open-eval" data-id="${esc(e.id)}">${esc(e.title)}</button><div class="sub">${courseTag(e.courseId, { short: true })}<span>${esc(fmtShort(e.date))}</span></div></div>${e.grade != null ? `<span class="chip ok">${esc(e.grade)}/${esc(e.maxGrade || 20)}</span>` : `<button type="button" class="btn btn-sm" data-act="open-eval" data-id="${esc(e.id)}">Nota</button>`}</li>`).join('')}</ul></div></section>` : ''}
  </div>`;
}

function reviewsTab(s, now) {
  const today = todayISO(now);
  const due = dueTopics(s, today);
  const soon = s.topics.filter((t) => t.srs?.due && t.srs.due > today && diffDays(today, t.srs.due) <= 7).sort((a, b) => a.srs.due.localeCompare(b.srs.due));
  const reviewBlocks = s.blocks.filter((b) => isUsableBlock(b) && b.kind === 'study' && /^repaso/i.test(b.title) && b.date >= today && b.status === 'scheduled').sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const card = (t) => {
    const L = lessonFor({ title: t.title, courseId: t.courseId, lesson: t.lesson || {} }, t);
    return `<li class="review-card"><div class="hstack between"><div style="min-width:0"><a class="t" href="#/tema/${encodeURIComponent(t.id)}" style="font-weight:650">${esc(t.title)}</a><div class="sub hstack small" style="margin-top:4px">${courseTag(t.courseId, { short: true })}${levelChip(t)}<span class="muted">${overdueDays(t, today) > 0 ? `vencido hace ${overdueDays(t, today)} d` : 'toca hoy'}</span></div></div></div>
      ${L.question ? `<details><summary class="small muted">Pregunta de control</summary><p class="lesson question" style="margin-top:6px">${esc(L.question)}</p></details>` : ''}
      <div class="grade-row" role="group" aria-label="¿Cómo te fue con ${esc(t.title)}?">${GRADES.map((g) => `<button type="button" class="${g}" data-act="grade" data-id="${esc(t.id)}" data-g="${g}">${esc(GRADE_LABEL[g])}</button>`).join('')}</div></li>`;
  };
  return `<div class="stack-lg">
    <section class="section">${sectionHead('Para hoy', { count: due.length })}
      ${due.length ? `<p class="small muted">Explícalo sin mirar y califícate. Brújula calcula el próximo repaso (antes de tu examen si lo hay).</p><div class="panel"><ul class="list">${due.map(card).join('')}</ul></div>` : emptyState({ title: 'Nada que repasar hoy', text: 'Cuando marques «Repasar» o califiques un tema, aparecerá aquí en el día justo.' })}
    </section>
    ${reviewBlocks.length ? `<section class="section">${sectionHead('Repasos en tu horario')}<div class="agenda">${reviewBlocks.slice(0, 8).map((b) => blockRow(b, { showDate: true })).join('')}</div></section>` : ''}
    ${soon.length ? `<section class="section">${sectionHead('Próximos 7 días')}<div class="panel"><ul class="list">${soon.map((t) => `<li class="topic-row"><div><a class="t" href="#/tema/${encodeURIComponent(t.id)}">${esc(t.title)}</a><div class="sub">${courseTag(t.courseId, { short: true })}<span>${esc(fmtRelDay(t.srs.due, today))}</span></div></div><button type="button" class="btn btn-sm btn-quiet" data-act="topic-review" data-id="${esc(t.id)}">Adelantar</button></li>`).join('')}</ul></div></section>` : ''}
  </div>`;
}

function topicDetail(c, id) {
  const s = c.state;
  const t = findTopic(id);
  if (!t) return emptyState({ title: 'Ese tema ya no existe', action: 'go', actionLabel: 'Volver a Estudio' }).replace('data-act="go"', 'data-act="go" data-to="estudio/temas"');
  const today = c.today;
  const course = courseOf(s, t.courseId);
  const sessions = s.blocks.filter((b) => b.topicId === t.id && isUsableBlock(b)).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
  const diffs = (s.difficulties || []).filter((d) => d.topicId === t.id);
  const prereqs = (t.prereqIds || []).map(findTopic).filter(Boolean);
  const dependents = s.topics.filter((x) => (x.prereqIds || []).includes(t.id));
  const ev = nextEvaluationFor(s, t, today);
  const od = overdueDays(t, today);
  return `<div class="stack-lg">
    <section class="course-hero" style="--c:${esc(course.color)}">
      <div class="hstack between"><a class="back" href="#/curso/${encodeURIComponent(course.id)}">${icon('chevron-left', 'sm')}${esc(course.name)}</a><button type="button" class="btn btn-sm" data-act="edit-topic" data-id="${esc(t.id)}">${icon('pencil', 'sm')}Editar</button></div>
      <h2>${esc(t.title)}</h2>
      <div class="hstack">${levelChip(t)}<span class="chip">Dificultad ${esc(t.difficulty)}/5</span>${ev ? `<span class="chip ${diffDays(today, ev.date) <= 3 ? 'urgent' : ''}">${icon('target', 'sm')}${esc(ev.title)} ${esc(fmtRelDay(ev.date, today))}</span>` : ''}</div>
      <div class="kpis"><div class="kpi"><b>${Number(t.mastery) || 0}%</b><span>Dominio estimado</span></div><div class="kpi"><b>${t.srs?.due ? esc(cap(fmtRelDay(t.srs.due, today))) : '—'}</b><span>Próximo repaso</span></div><div class="kpi"><b>${sessions.length}</b><span>Sesiones</span></div><div class="kpi"><b>${diffs.filter((d) => !d.resolved).length}</b><span>Dificultades abiertas</span></div></div>
      <div class="btn-row"><button type="button" class="btn ${od != null && od >= 0 ? 'btn-primary' : ''}" data-act="topic-review" data-id="${esc(t.id)}">${icon('rotate-ccw')}Repasar ahora</button><button type="button" class="btn" data-act="topic-plan" data-id="${esc(t.id)}">${icon('calendar-plus')}Programar sesión</button><button type="button" class="btn" data-act="topic-diff" data-id="${esc(t.id)}">${icon('flag')}Me costó algo</button></div>
    </section>
    ${prereqs.length || dependents.length ? `<section class="section">${sectionHead('Requisitos')}<div class="panel stack">
      ${prereqs.length ? `<div class="stack"><span class="label">Necesitas antes</span><div class="hstack">${prereqs.map((p) => `<a class="chip ${p.level === 'mastered' ? 'ok' : ''}" href="#/tema/${encodeURIComponent(p.id)}">${icon(p.level === 'mastered' ? 'check' : 'git-branch', 'sm')}${esc(p.title)}</a>`).join('')}</div></div>` : ''}
      ${dependents.length ? `<div class="stack"><span class="label">Es base para</span><div class="hstack">${dependents.map((p) => `<a class="chip" href="#/tema/${encodeURIComponent(p.id)}">${esc(p.title)}</a>`).join('')}</div></div>` : ''}</div></section>` : ''}
    <section class="section">${sectionHead('Dificultades', { act: 'topic-diff', actLabel: 'Anotar', actIcon: 'plus' }).replace('data-act="topic-diff"', `data-act="topic-diff" data-id="${esc(t.id)}"`)}
      ${diffs.length ? `<div class="panel"><ul class="list">${diffs.map((d) => `<li class="topic-row"><div><b style="font-weight:600;${d.resolved ? 'text-decoration:line-through;color:var(--ink-3)' : ''}">${esc(d.text || DIFFICULTY_KINDS[d.kind] || 'Dificultad')}</b><div class="sub"><span class="chip">${esc(DIFFICULTY_KINDS[d.kind] || 'Otro')}</span><span>${esc(fmtRelDay(d.at.slice(0, 10), today))}</span></div></div><button type="button" class="btn btn-sm btn-quiet" data-act="diff-resolve" data-id="${esc(d.id)}" data-v="${d.resolved ? '0' : '1'}">${icon(d.resolved ? 'rotate-ccw' : 'check', 'sm')}${d.resolved ? 'Reabrir' : 'Resuelta'}</button></li>`).join('')}</ul></div>` : '<p class="small muted">Anota qué te cuesta (concepto, fórmula, álgebra, unidades o tiempo). Sube la prioridad del tema y te ayuda a ver patrones.</p>'}
    </section>
    <section class="section">${sectionHead('Sesiones')}${sessions.length ? `<div class="agenda">${sessions.slice(0, 10).map((b) => blockRow(b, { showDate: true })).join('')}</div>` : '<p class="small muted">Todavía no hay sesiones de este tema.</p>'}</section>
    <section class="section">
      ${sectionHead('Materiales PDF')}
      <div class="panel stack">
        <p class="small muted">Guarda archivos privados para este tema. El texto extraído de PDFs digitales puede prepararse para ChatGPT; los escaneos necesitan OCR.</p>
        <div class="hstack"><button type="button" class="btn btn-sm" data-act="pdf-upload" data-id="${esc(t.id)}">${icon('upload', 'sm')}Subir PDF</button></div>
        ${(t.materials||[]).length ? `<div class="stack">${t.materials.map((m)=>`<div class="hstack between" style="gap:8px;flex-wrap:wrap"><span class="small" style="min-width:0;overflow-wrap:anywhere">${icon('file-text', 'sm')}${esc(m.name)}</span><div class="hstack"><button type="button" class="btn btn-sm" data-act="pdf-open" data-id="${esc(t.id)}" data-pdf="${esc(m.id)}">Abrir</button><button type="button" class="btn btn-sm" data-act="pdf-analyze" data-id="${esc(t.id)}" data-pdf="${esc(m.id)}">ChatGPT</button><button type="button" class="icon-btn" data-act="pdf-delete" data-id="${esc(t.id)}" data-pdf="${esc(m.id)}" aria-label="Quitar PDF">${icon('trash-2', 'sm')}</button></div></div>`).join('')}</div>` : '<p class="small muted">Aún no hay materiales adjuntos.</p>'}
      </div>
    </section>
    ${t.notes ? `<section class="section">${sectionHead('Notas')}<p class="lesson">${esc(t.notes)}</p></section>` : ''}
  </div>`;
}

export function render(c) {
  if (c.route.name === 'tema') return topicDetail(c, c.route.params[0]);
  const tab = TABS.some(([k]) => k === c.route.params[0]) ? c.route.params[0] : 'cursos';
  const s = c.state;
  const body = tab === 'temas' ? topicsTab(s, c.now) : tab === 'evaluaciones' ? evalsTab(s, c.now) : tab === 'repasos' ? reviewsTab(s, c.now) : coursesTab(s, c.now);
  return `<div class="stack-lg">${tabsBar(tab, s)}${body}</div>`;
}

action('new-course', () => openCourseForm());
action('new-topic', (el) => openTopicForm(null, { courseId: el.dataset.course || null }));
action('edit-topic', (el) => openTopicForm(findTopic(el.dataset.id)));
action('new-eval', (el) => openEvaluationForm(null, { courseId: el.dataset.course || null }));
action('topic-review', (el) => openQuickReview(el.dataset.id));
action('topic-plan', (el) => scheduleTopic(el.dataset.id));
action('topic-diff', (el) => openDifficultyForm({ topicId: el.dataset.id }));
action('diff-resolve', (el) => resolveDifficulty(el.dataset.id, el.dataset.v === '1'));
action('grade', (el) => reviewTopic(el.dataset.id, el.dataset.g));
action('topic-filter', (el) => { topicFilter = el.dataset.id; import('../core/store.js').then((m) => m.notify('ui')); });
action('plan-exam', (el) => planExam(el.dataset.id));


action('pdf-upload', (el) => import('../features/materials.js').then(m=>m.pickPDF(el.dataset.id)));
action('pdf-open', (el) => import('../features/materials.js').then(m=>m.openPDF(el.dataset.id,el.dataset.pdf)).catch(e=>import('../ui/feedback.js').then(x=>x.toast(e.message,{tone:'warn'}))));
action('pdf-analyze', (el) => import('../features/materials.js').then(m=>m.analyzePDF(el.dataset.id,el.dataset.pdf)).catch(e=>import('../ui/feedback.js').then(x=>x.toast(e.message,{tone:'warn'}))));
action('pdf-delete', async (el) => {
  const {confirmSheet,toast}=await import('../ui/feedback.js');
  if(!(await confirmSheet({title:'Quitar material PDF',text:'Se borrará el archivo privado del tema.',confirm:'Quitar',danger:true})))return;
  try{const m=await import('../features/materials.js');await m.removePDF(el.dataset.id,el.dataset.pdf);toast('PDF quitado.');}catch(e){toast(e.message,{tone:'warn'});}
});
