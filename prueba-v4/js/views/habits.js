// Brújula 4 · Vida: hábitos con rachas, diario de 3 minutos y bienestar.

import { esc, cut, gid, cap } from '../core/util.js';
import { store, commit, change } from '../core/store.js';
import { prefs } from '../core/model.js';
import { todayISO, addDays, fmtLong, fmtRelDay } from '../core/dates.js';
import { habitStreak } from '../engine/insights.js';
import { icon, ICONS } from '../ui/icons.js';
import { action } from '../ui/dom.js';
import { openSheet } from '../ui/feedback.js';

import { sectionHead } from './common.js';
import { undoToast } from '../features/undo-toast.js';

export const title = () => 'Vida';
export const subtitle = () => 'Hábitos y diario';

const HABIT_ICONS = ['moon', 'dumbbell', 'brush-cleaning', 'messages-square', 'brain', 'sun', 'heart', 'coffee', 'footprints', 'book-open', 'utensils', 'leaf', 'users', 'guitar', 'bed', 'heart-pulse'].filter((n) => ICONS.has(n));
const ICON_NAMES = { moon: 'Luna', dumbbell: 'Ejercicio', 'brush-cleaning': 'Orden', 'messages-square': 'Conversar', brain: 'Mente', sun: 'Sol', heart: 'Corazón', coffee: 'Café', footprints: 'Caminar', 'book-open': 'Lectura', utensils: 'Comida', leaf: 'Naturaleza', users: 'Amistades', guitar: 'Música', bed: 'Dormir', 'heart-pulse': 'Salud' };
const PROMPTS = [['win', '¿Qué hice bien hoy?', 'Ej.: intenté dos ejercicios difíciles'], ['improve', '¿Qué mejoraré mañana?', 'Ej.: empezar sin esperar a tener ganas'], ['joy', 'Algo que disfruté o agradezco', 'Ej.: salir a caminar']];

export function render(c) {
  const s = c.state;
  const today = c.today;
  const defs = (s.habitDefs || []).filter((h) => h.active !== false);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const doneToday = defs.filter((h) => s.habits[today]?.[h.id]).length;
  const journal = s.journal[today] || {};
  const past = Object.keys(s.journal || {}).filter((d) => d < today && Object.values(s.journal[d] || {}).some((v) => String(v || '').trim())).sort().reverse().slice(0, 10);
  return `<div class="stack-lg">
    <section class="section">${sectionHead('Hábitos de hoy', { act: 'habit-manage', actLabel: 'Editar', actIcon: 'pencil' })}
      <p class="small muted">${doneToday}/${defs.length} hoy. Son sugerencias, no exámenes: suma lo que puedas.</p>
      <div class="panel"><ul class="list">${defs.map((h) => {
        const on = !!s.habits[today]?.[h.id];
        const streak = habitStreak(s, h.id, today);
        return `<li class="habit-line"><button type="button" class="ico" aria-pressed="${on}" data-act="habit" data-habit="${esc(h.id)}" data-date="${esc(today)}" aria-label="${on ? 'Desmarcar' : 'Marcar'} ${esc(h.name)}">${icon(on ? 'check' : h.icon || 'circle')}</button>
          <div><b>${esc(h.name)}</b><div class="week-dots" aria-label="Últimos 7 días">${days.map((d) => `<i class="${s.habits[d]?.[h.id] ? 'on' : ''} ${d === today ? 'today' : ''}" title="${esc(fmtRelDay(d, today))}"></i>`).join('')}</div></div>
          <span class="small ${streak > 1 ? '' : 'faint'}" style="display:inline-flex;align-items:center;gap:4px;color:${streak > 1 ? 'var(--contour)' : ''}">${streak > 1 ? icon('flame', 'sm') + streak : ''}</span></li>`;
      }).join('')}</ul></div>
    </section>
    <section class="section">${sectionHead('Diario de 3 minutos')}
      <div class="panel stack">${PROMPTS.map(([k, q, ph]) => `<label class="field"><span>${q}</span><textarea class="textarea" rows="2" id="jr-${k}" data-input="journal" data-key="${k}" placeholder="${esc(ph)}" maxlength="1200">${esc(journal[k] || '')}</textarea></label>`).join('')}
        <p class="hint">Se guarda mientras escribes, en tu cuenta. Nunca se envía a la IA.</p></div>
      ${past.length ? `<details><summary class="label">Días anteriores</summary><div class="stack" style="margin-top:10px">${past.map((d) => `<div class="panel panel-tight"><b class="small">${esc(cap(fmtLong(d)))}</b>${PROMPTS.map(([k, q]) => s.journal[d][k] ? `<p class="small"><span class="muted">${q}</span> ${esc(cut(s.journal[d][k], 300))}</p>` : '').join('')}</div>`).join('')}</div></details>` : ''}
    </section>
    <section class="panel stack"><h2 style="font-size:var(--fs-18)">Avanzar sin agobiarte</h2><p class="muted">Un día difícil puede pedir menos esfuerzo y más descanso. Constancia es volver al plan cuando puedas.</p>
      <div class="btn-row"><button type="button" class="btn" data-act="quick-add">${icon('sprout')}Planificar algo personal</button><button type="button" class="btn" data-act="routine">${icon('moon')}Mi rutina (${esc(prefs(s).wake)}–${esc(prefs(s).sleep)})</button></div></section>
  </div>`;
}

action('journal', (el) => {
  const s = store.state, d = todayISO();
  s.journal[d] ??= {};
  s.journal[d][el.dataset.key] = el.value.slice(0, 1200);
  commit({ render: false });
});

action('habit-manage', () => {
  const s = store.state;
  const row = (h) => `<div class="habit-edit" data-h="${esc(h.id)}" data-icon="${esc(h.icon || 'heart')}">
    <div class="hstack"><button type="button" class="ico-pick" data-pick aria-expanded="false" aria-label="Cambiar icono de ${esc(h.name || 'hábito nuevo')}">${icon(h.icon || 'heart')}</button>
      <input class="input grow" data-k="name" value="${esc(h.name)}" maxlength="50" aria-label="Nombre del hábito" placeholder="Ej.: Leer 10 minutos">
      <label class="check" style="align-items:center"><input type="checkbox" data-k="active" ${h.active !== false ? 'checked' : ''}><span class="small">Activo</span></label></div>
    <div class="icon-grid" role="radiogroup" aria-label="Icono" hidden>${HABIT_ICONS.map((i) => `<button type="button" role="radio" aria-checked="${i === (h.icon || 'heart')}" data-icon-opt="${i}" aria-label="${esc(ICON_NAMES[i] || i)}">${icon(i)}</button>`).join('')}</div></div>`;
  const sheet = openSheet({
    title: 'Mis hábitos', wide: true,
    body: `<div id="habitRows" class="stack">${(s.habitDefs || []).map(row).join('')}</div><button type="button" class="btn btn-sm" data-add>${icon('plus', 'sm')}Añadir hábito</button><p class="hint">Desactivar no borra tu historial.</p>`,
    foot: `<button type="button" class="btn" data-sheet-close>Cancelar</button><button type="button" class="btn btn-primary" data-save>${icon('check')}Guardar</button>`,
    onMount(card) {
      const rows = card.querySelector('#habitRows');
      rows.addEventListener('click', (e) => {
        const pick = e.target.closest('[data-pick]');
        if (pick) {
          const grid = pick.closest('[data-h]').querySelector('.icon-grid');
          const open = grid.hidden;
          rows.querySelectorAll('.icon-grid').forEach((g) => { g.hidden = true; g.closest('[data-h]').querySelector('[data-pick]').setAttribute('aria-expanded', 'false'); });
          grid.hidden = !open;
          pick.setAttribute('aria-expanded', String(open));
          if (open) grid.querySelector('[aria-checked="true"]')?.focus();
          return;
        }
        const opt = e.target.closest('[data-icon-opt]');
        if (opt) {
          const r = opt.closest('[data-h]');
          r.dataset.icon = opt.dataset.iconOpt;
          r.querySelectorAll('[data-icon-opt]').forEach((b) => b.setAttribute('aria-checked', String(b === opt)));
          const btn = r.querySelector('[data-pick]');
          btn.innerHTML = icon(opt.dataset.iconOpt);
          btn.setAttribute('aria-expanded', 'false');
          opt.closest('.icon-grid').hidden = true;
          btn.focus();
        }
      });
      card.querySelector('[data-add]').addEventListener('click', () => { rows.insertAdjacentHTML('beforeend', row({ id: 'h-' + gid(), name: '', icon: 'heart', active: true })); rows.querySelector('[data-h]:last-child input[data-k="name"]').focus(); });
      card.querySelector('[data-save]').addEventListener('click', () => {
        const defs = [...card.querySelectorAll('[data-h]')].map((r) => ({ id: r.dataset.h, icon: r.dataset.icon, name: r.querySelector('[data-k="name"]').value.trim(), active: r.querySelector('[data-k="active"]').checked })).filter((h) => h.name);
        sheet.close();
        const { entry } = change({ label: 'Editar hábitos', type: 'habits', mutate: (st) => { st.habitDefs = defs; } });
        undoToast('Hábitos guardados.', entry);
      });
    },
  });
});
