// Brújula 4 · vista previa y aprobación de cambios (IA, importación, planes de examen).
// Nada se aplica sin pulsar «Aplicar». Antes de aplicar se vuelve a comprobar que el
// horario no cambió desde que se preparó la propuesta.

import { esc, plural } from '../core/util.js';
import { store, change } from '../core/store.js';
import { stillApplicable, describeChange } from '../engine/scheduler.js';
import { openSheet, toast } from './feedback.js';
import { icon } from './icons.js';
import { undoToast } from '../features/undo-toast.js';

const SOURCE = {
  ai: { label: 'Propuesta de Gemini', note: 'Gemini propone; Brújula ya comprobó cruces, descansos y protegidos. Tú decides.' },
  plan: { label: 'Plan de estudio', note: 'Sesiones repartidas antes de la evaluación, con los temas más débiles primero.' },
  import: { label: 'Cambios importados', note: 'Revisa cada cambio. Los avisos no bloquean porque es tu propio archivo.' },
  local: { label: 'Propuesta', note: '' },
};

export function applyOps(s, ops) {
  for (const op of ops) {
    if (op.action === 'add') s.blocks.push({ ...op.after });
    else if (op.action === 'update') {
      const x = s.blocks.find((b) => b.id === op.id);
      if (!x) continue;
      for (const k of ['date', 'start', 'end', 'title', 'goal', 'kind', 'priority', 'difficulty', 'courseId']) x[k] = op.after[k];
      if (op.before && (op.before.date !== op.after.date || op.before.start !== op.after.start)) { x.status = x.status === 'missed' || x.status === 'paused' ? 'scheduled' : x.status; x.decisionDismissed = false; }
    } else if (op.action === 'delete') s.blocks = s.blocks.filter((b) => b.id !== op.id);
  }
}

/**
 * ops: [{action, id, before, after, label:{verb,text}}]
 * rejected: [{change, reasons}] · warnings: [texto]
 */
export function openProposal({ title, ops, rejected = [], warnings = [], source = 'local', summary = '', eventReason = '', onApplied = null, extra = '' }) {
  const meta = SOURCE[source] || SOURCE.local;
  ops.forEach((op) => { op.label = op.label || describeChange(store.state, op); });
  const list = ops.map((op, i) => `<label class="prop-item"><input type="checkbox" checked data-op="${i}">
    <span><span class="verb">${esc(op.label.verb)}</span>${esc(op.label.text)}${op.why ? `<span class="why">${esc(op.why)}</span>` : ''}</span></label>`).join('');
  const rej = rejected.length ? `<details class="prop-rejected"><summary>${plural(rejected.length, 'cambio descartado', 'cambios descartados')} por seguridad</summary><ul>${rejected.map((r) => `<li><b>${esc(r.change?.title || r.change?.id || 'Cambio')}</b>: ${esc(r.reasons.join('; '))}</li>`).join('')}</ul></details>` : '';
  const warn = warnings.length ? `<div class="notice warn">${icon('triangle-alert')}<div>${warnings.slice(0, 6).map((w) => `<div>${esc(w)}</div>`).join('')}</div></div>` : '';
  const body = `${summary ? `<p>${esc(summary)}</p>` : ''}${meta.note ? `<p class="hint">${esc(meta.note)}</p>` : ''}
    ${ops.length ? `<div class="proposal">${list}</div>` : '<div class="empty"><h3>No hay cambios seguros</h3><p>Pide otra alternativa o ajústalo a mano.</p></div>'}
    ${warn}${rej}${extra}`;
  const sheet = openSheet({
    title: title || meta.label, body, wide: ops.length > 4,
    foot: `<button type="button" class="btn" data-sheet-close>Descartar</button>${ops.length ? `<button type="button" class="btn btn-primary" data-apply>${icon('check')}<span>Aplicar ${ops.length}</span></button>` : ''}`,
    onMount(card) {
      const btn = card.querySelector('[data-apply]');
      const selected = () => [...card.querySelectorAll('[data-op]')].filter((c) => c.checked).map((c) => ops[Number(c.dataset.op)]);
      card.addEventListener('change', () => { if (btn) { const n = selected().length; btn.querySelector('span').textContent = n ? `Aplicar ${n}` : 'Elige al menos uno'; btn.disabled = !n; } });
      btn?.addEventListener('click', () => {
        const chosen = selected();
        if (!chosen.length) return;
        if (!stillApplicable(store.state, chosen)) { sheet.close(); toast('Tu horario cambió mientras revisabas. Pide una propuesta nueva.', { tone: 'warn' }); return; }
        const ids = chosen.filter((o) => o.action !== 'add').map((o) => o.id);
        const { entry } = change({
          label: `${meta.label}: ${plural(chosen.length, 'cambio', 'cambios')}`, type: source, blockIds: ids,
          mutate: (s) => applyOps(s, chosen),
          event: { status: 'progress', type: source, title: meta.label, course: 'Mi horario', reason: eventReason || `${plural(chosen.length, 'cambio aprobado', 'cambios aprobados')} por ti` },
        });
        sheet.close(true);
        undoToast(`${plural(chosen.length, 'cambio aplicado', 'cambios aplicados')}`, entry);
        onApplied?.(chosen);
      });
    },
  });
  return sheet;
}
