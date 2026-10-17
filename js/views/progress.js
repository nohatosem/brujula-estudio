// Brújula 4 · Progreso: estudio realizado vs planificado, dominio por curso, dificultades e historial.

import { esc, cut } from '../core/util.js';
import { store, undo } from '../core/store.js';
import { courseOf, DIFFICULTY_KINDS, statusLabel, APP_VERSION } from '../core/model.js';
import { todayISO, weekDays, addDays, fmtDuration, fmtShort, WEEKDAYS_SHORT, isValidDate, parseISO, MONTHS } from '../core/dates.js';
import { weekStats, courseStats, difficultyStats, studyStreak } from '../engine/insights.js';
import { dueTopics } from '../engine/srs.js';
import { icon } from '../ui/icons.js';
import { action, copyText } from '../ui/dom.js';
import { toast } from '../ui/feedback.js';
import { masteryMeter, sectionHead, emptyState } from './common.js';

export const title = () => 'Progreso';
export function subtitle(c) {
  const d = weekDays(anchor(c));
  const a = parseISO(d[0]), b = parseISO(d[6]);
  return `Semana del ${a.getDate()} ${MONTHS[a.getMonth()].slice(0, 3)} al ${b.getDate()} ${MONTHS[b.getMonth()].slice(0, 3)}`;
}
const anchor = (c) => (isValidDate(c.route.params[0]) ? c.route.params[0] : c.today);

const EVENT_ICON = { mastered: 'check', review: 'rotate-ccw', paused: 'circle-pause', missed: 'x', scheduled: 'calendar-clock', progress: 'activity' };
let historyFilter = 'all';

export function render(c) {
  const s = c.state;
  const a = anchor(c);
  const w = weekStats(s, a, c.now);
  const days = weekDays(a);
  const max = Math.max(60, ...w.days.map((d) => d.planned));
  const courses = courseStats(s, c.now).filter((x) => x.topics || x.studiedWeek);
  const diff = difficultyStats(s);
  const streak = studyStreak(s, c.today);
  const due = dueTopics(s, c.today).length;
  const events = (s.events || []).filter((e) => historyFilter === 'all' || (historyFilter === 'changes' ? ['move', 'auto-move', 'auto-review', 'review', 'ai', 'plan', 'import', 'undo', 'mode', 'add', 'delete'].includes(e.type) : e.type === 'status' || !e.type)).slice(0, 40);
  const undoList = (s.undo || []).slice(0, 5);
  return `<div class="stack-lg">
    <div class="hstack"><a class="btn btn-sm" href="#/progreso/${addDays(days[0], -7)}" aria-label="Semana anterior">${icon('chevron-left')}</a><a class="btn btn-sm" href="#/progreso/${c.today}">Esta semana</a><a class="btn btn-sm" href="#/progreso/${addDays(days[0], 7)}" aria-label="Semana siguiente">${icon('chevron-right')}</a></div>
    <div class="kpis">
      <div class="kpi"><b>${esc(fmtDuration(w.done))}</b><span>estudiado de ${esc(fmtDuration(w.planned))}</span></div>
      <div class="kpi"><b>${w.completion == null ? '—' : w.completion + '%'}</b><span>sesiones cumplidas</span></div>
      <div class="kpi"><b>${streak}</b><span>${streak === 1 ? 'día seguido' : 'días seguidos'} estudiando</span></div>
      <div class="kpi"><b>${due}</b><span>repasos pendientes</span></div>
    </div>
    <section class="section">${sectionHead('Estudio por día')}
      <div class="panel stack"><div class="bars" role="img" aria-label="Minutos de estudio planificados y realizados por día">${w.days.map((d, i) => `<div class="bar ${d.date === c.today ? 'today' : ''}" title="${esc(fmtShort(d.date))}: ${esc(fmtDuration(d.done))} de ${esc(fmtDuration(d.planned))}"><div class="bar-stack"><span class="planned" style="--p:${Math.round((d.planned / max) * 100)}%"></span><span class="done" style="--d:${Math.round((d.done / max) * 100)}%"></span></div><small>${WEEKDAYS_SHORT[i]}</small></div>`).join('')}</div>
      <div class="legend"><span><i style="background:var(--route)"></i>Realizado</span><span><i style="background:color-mix(in srgb, var(--route) 18%, var(--sunken))"></i>Planificado</span>${w.missed ? `<span>${esc(fmtDuration(w.missed))} no realizados</span>` : ''}</div></div>
    </section>
    <section class="section">${sectionHead('Dominio por curso')}
      ${courses.length ? `<div class="panel">${courses.map((x) => `<div class="hbar"><a href="#/curso/${encodeURIComponent(x.course.id)}" class="course-tag" style="--c:${esc(x.course.color)}"><span class="ellipsis">${esc(x.course.name)}</span></a>${masteryMeter(x.mastery ?? 0)}<span class="small muted">${x.mastery == null ? '—' : x.mastery + '%'}</span></div>`).join('')}</div>` : emptyState({ title: 'Aún sin datos de dominio', text: 'Cierra sesiones con «Lo domino» o «Repasar» y aquí verás cómo avanzas por curso.' })}
    </section>
    <section class="section">${sectionHead('Dificultades', { count: diff.open || null })}
      ${diff.total ? `<div class="panel stack">${diff.top ? `<p>Tu dificultad más frecuente: <b>${esc(DIFFICULTY_KINDS[diff.top.kind] || 'Otra')}</b> (${diff.top.count}). Practica ese tipo de ejercicio primero.</p>` : '<p>Todas tus dificultades están resueltas.</p>'}
        <div class="hstack">${Object.entries(diff.byKind).map(([k, n]) => `<span class="chip">${esc(DIFFICULTY_KINDS[k] || 'Otro')} · ${n}</span>`).join('')}</div></div>` : '<p class="small muted">Cuando anotes qué te costó en una sesión, verás aquí tus patrones.</p>'}
    </section>
    ${undoList.length ? `<section class="section">${sectionHead('Cambios recientes')}<div class="panel"><ul class="list">${undoList.map((u, i) => `<li class="history-item"><span class="ico">${icon(u.type?.startsWith('auto') ? 'zap' : u.type === 'ai' ? 'sparkles' : 'pencil')}</span><div class="hstack between"><div><b>${esc(u.label)}</b><small>${esc(new Date(u.at).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }))}</small></div>${i === 0 ? `<button type="button" class="btn btn-sm" data-act="undo-entry" data-id="${esc(u.id)}">${icon('undo-2', 'sm')}Deshacer</button>` : ''}</div></li>`).join('')}</ul></div></section>` : ''}
    <section class="section"><div class="section-head"><h2>Historial</h2><div class="tabs" role="tablist" aria-label="Filtrar historial">${[['all', 'Todo'], ['status', 'Sesiones'], ['changes', 'Cambios']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${historyFilter === k}" data-act="history-filter" data-id="${k}">${l}</button>`).join('')}</div></div>
      ${events.length ? `<div class="panel"><ul class="list">${events.map((e) => `<li class="history-item"><span class="ico">${icon(EVENT_ICON[e.status] || 'circle')}</span><div><b>${esc(e.title || 'Actividad')}</b> <span class="chip s-${esc(e.status)}">${esc(statusLabel({ status: e.status, kind: 'study' }))}</span><small>${esc(e.course)} · ${esc(new Date(e.at).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }))}${e.reason ? ' · ' + esc(cut(e.reason, 120)) : ''}</small></div></li>`).join('')}</ul></div>` : emptyState({ title: 'Sin registros aún', text: 'Cada resultado, movimiento y repaso queda anotado aquí.' })}
    </section>
    <div class="btn-row"><button type="button" class="btn" data-act="copy-report">${icon('copy')}Copiar informe para ChatGPT</button></div>
  </div>`;
}

export function progressReport(s) {
  const t = todayISO();
  const sorted = [...s.blocks].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).filter((b) => b.date >= addDays(t, -7) && b.date <= addDays(t, 7));
  const lines = [`BRÚJULA ${APP_VERSION} — Informe académico`, `Generado: ${new Date().toLocaleString('es-PE')}`, '', 'SESIONES (últimos 7 y próximos 7 días):'];
  for (const b of sorted) lines.push(`${b.date} ${b.start}-${b.end} | ${courseOf(s, b.courseId).name} | ${b.title} | ${statusLabel(b)}${b.lastReason ? ' | Motivo: ' + b.lastReason : ''}`);
  lines.push('', 'TEMAS (dominio estimado):');
  for (const tp of s.topics.slice(0, 40)) lines.push(`${courseOf(s, tp.courseId).name} | ${tp.title} | ${tp.mastery || 0}% | ${tp.level}${tp.srs?.due ? ' | repaso ' + tp.srs.due : ''}`);
  const ev = (s.events || []).slice(0, 15);
  lines.push('', `EVENTOS RECIENTES (${ev.length}):`);
  ev.forEach((e) => lines.push(`${new Date(e.at).toLocaleString('es-PE')} | ${e.course}: ${e.title} | ${e.status}${e.reason ? ' | ' + e.reason : ''}`));
  lines.push('', 'INSTRUCCIONES PARA MI ASISTENTE: Lee los avances. Propón solo los cambios necesarios según dificultad, próximas evaluaciones y descanso. Prioriza repasos, no trates una pausa como fracaso y pregúntame si falta un dato. No afirmes que puedes modificar la app directamente.');
  return lines.join('\n');
}

action('undo-entry', (el) => { const r = undo(el.dataset.id); toast(r.ok ? `Deshecho: ${r.entry.label}` : r.reason, { tone: r.ok ? 'ok' : 'warn' }); });
action('history-filter', (el) => { historyFilter = el.dataset.id; import('../core/store.js').then((m) => m.notify('ui')); });
action('copy-report', async () => { toast((await copyText(progressReport(store.state))) ? 'Informe copiado. Pégalo en tu ChatGPT.' : 'No se pudo copiar.', { tone: 'ok' }); });
