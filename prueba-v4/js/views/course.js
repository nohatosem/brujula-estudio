// Brújula 4 · detalle de un curso: dominio por temas, evaluaciones, dificultades y sesiones.

import { esc, cut } from '../core/util.js';
import { EVAL_TYPES, DIFFICULTY_KINDS, isUsableBlock } from '../core/model.js';
import { fmtRelDay, fmtShort, fmtDuration, addDays } from '../core/dates.js';
import { rankPriorities, upcomingEvaluations } from '../engine/priority.js';
import { courseStats } from '../engine/insights.js';
import { icon } from '../ui/icons.js';
import { action } from '../ui/dom.js';
import { masteryMeter, emptyState, sectionHead, blockRow } from './common.js';
import { topicRow } from './study.js';
import { openCourseForm } from '../ui/forms.js';
import { store } from '../core/store.js';

const findCourse = (s, id) => s.courses.find((c) => c.id === id);
export const title = (c) => findCourse(c.state, c.route.params[0])?.name || 'Curso';
export const subtitle = (c) => { const x = findCourse(c.state, c.route.params[0]); return x ? `Dificultad ${x.difficulty}/5 · importancia ${x.importance || 3}/5${x.credits ? ` · ${x.credits} créditos` : ''}` : ''; };

export function render(c) {
  const s = c.state;
  const course = findCourse(s, c.route.params[0]);
  if (!course) return emptyState({ title: 'Ese curso no existe', action: 'go', actionLabel: 'Volver a Estudio' }).replace('data-act="go"', 'data-act="go" data-to="estudio"');
  const today = c.today;
  const st = courseStats(s, c.now).find((x) => x.course.id === course.id) || { topics: 0, mastery: null, studiedWeek: 0, due: 0 };
  const ranked = rankPriorities(s, c.now).filter((p) => p.type === 'topic' && p.courseId === course.id);
  const rankMap = new Map(ranked.map((p, i) => [p.id, { i, reasons: p.reasons }]));
  const topics = s.topics.filter((t) => t.courseId === course.id).sort((a, b) => (rankMap.get(a.id)?.i ?? 999) - (rankMap.get(b.id)?.i ?? 999));
  const evals = upcomingEvaluations(s, c.now, 365).filter((e) => e.courseId === course.id);
  const diffs = (s.difficulties || []).filter((d) => !d.resolved && (d.courseId === course.id || topics.some((t) => t.id === d.topicId)));
  const upcoming = s.blocks.filter((b) => isUsableBlock(b) && b.courseId === course.id && b.date >= today && b.date <= addDays(today, 7)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const byKind = {};
  for (const d of diffs) byKind[d.kind] = (byKind[d.kind] || 0) + 1;
  return `<div class="stack-lg">
    <section class="course-hero" style="--c:${esc(course.color)}">
      <div class="hstack between"><a class="back" href="#/estudio">${icon('chevron-left', 'sm')}Estudio</a><button type="button" class="btn btn-sm" data-act="edit-course" data-id="${esc(course.id)}">${icon('pencil', 'sm')}Editar</button></div>
      <h2>${esc(course.name)}</h2>
      ${course.archived ? '<span class="chip">Archivado</span>' : ''}
      <div class="kpis">
        <div class="kpi"><b>${st.mastery == null ? '—' : st.mastery + '%'}</b><span>Dominio promedio</span></div>
        <div class="kpi"><b>${st.topics}</b><span>Temas</span></div>
        <div class="kpi"><b>${esc(fmtDuration(st.studiedWeek))}</b><span>Estudiado en 7 días</span></div>
        <div class="kpi"><b>${evals[0] ? evals[0].daysLeft : '—'}</b><span>${evals[0] ? `días para ${esc(cut(evals[0].title, 22))}` : 'Sin evaluaciones'}</span></div>
      </div>
      <div class="btn-row"><button type="button" class="btn" data-act="new-topic" data-course="${esc(course.id)}">${icon('plus')}Tema</button><button type="button" class="btn" data-act="new-eval" data-course="${esc(course.id)}">${icon('target')}Evaluación</button>${evals[0] ? `<button type="button" class="btn btn-primary" data-act="plan-exam" data-id="${esc(evals[0].id)}">${icon('route')}Plan para ${esc(cut(evals[0].title, 24))}</button>` : ''}</div>
    </section>
    <section class="section">${sectionHead('Temas por prioridad', { count: topics.length || null })}
      ${topics.length ? `<div class="panel"><ul class="list">${topics.map((t) => topicRow(t, s, today, { rankReasons: rankMap.get(t.id)?.reasons })).join('')}</ul></div>` : emptyState({ title: 'Sin temas todavía', text: 'Divide el curso en temas para medir tu dominio y planificar repasos.', action: 'new-topic', actionLabel: 'Nuevo tema' }).replace('data-act="new-topic"', `data-act="new-topic" data-course="${esc(course.id)}"`)}
    </section>
    ${evals.length ? `<section class="section">${sectionHead('Evaluaciones')}<div class="cards two">${evals.map((e) => `<button type="button" class="eval-card ${e.daysLeft <= 3 ? 'soon' : ''}" data-act="open-eval" data-id="${esc(e.id)}"><span class="eval-days"><b>${e.daysLeft}</b><span>${e.daysLeft === 1 ? 'día' : 'días'}</span></span><b class="t">${esc(e.title)}</b><span class="small muted">${esc(EVAL_TYPES[e.type] || '')} · ${esc(fmtShort(e.date))}${e.weight ? ` · ${e.weight}%` : ''}</span>${e.prep != null ? `<span class="hstack small" style="gap:8px">${masteryMeter(e.prep)}<span class="muted">${e.prep}%</span></span>` : ''}</button>`).join('')}</div></section>` : ''}
    ${diffs.length ? `<section class="section">${sectionHead('Dificultades abiertas', { count: diffs.length })}<div class="panel stack"><div class="hstack">${Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="chip">${esc(DIFFICULTY_KINDS[k] || 'Otro')} · ${n}</span>`).join('')}</div>
      <ul class="list">${diffs.slice(0, 6).map((d) => `<li class="topic-row"><div><b style="font-weight:600">${esc(d.text || DIFFICULTY_KINDS[d.kind])}</b><div class="sub">${d.topicId ? `<a href="#/tema/${encodeURIComponent(d.topicId)}">${esc(cut(store.state.topics.find((t) => t.id === d.topicId)?.title || '', 40))}</a>` : ''}<span>${esc(fmtRelDay(d.at.slice(0, 10), today))}</span></div></div><button type="button" class="btn btn-sm btn-quiet" data-act="diff-resolve" data-id="${esc(d.id)}" data-v="1">${icon('check', 'sm')}Resuelta</button></li>`).join('')}</ul></div></section>` : ''}
    <section class="section">${sectionHead('Próximos 7 días')}${upcoming.length ? `<div class="agenda">${upcoming.map((b) => blockRow(b, { showDate: true })).join('')}</div>` : '<p class="small muted">No hay sesiones de este curso en la próxima semana.</p>'}</section>
  </div>`;
}

action('edit-course', (el) => openCourseForm(store.state.courses.find((c) => c.id === el.dataset.id)));
