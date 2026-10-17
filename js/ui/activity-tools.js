// Controles de la agenda: resultado con Deshacer y notas de cada actividad.
import { esc, haptic } from '../core/util.js';
import { store, change } from '../core/store.js';
import { setOutcome } from '../features/actions.js';
import { undoToast } from '../features/undo-toast.js';
import { action } from './dom.js';
import { icon } from './icons.js';
import { openSheet, toast } from './feedback.js';

export const isFinished = b => b.status === 'mastered' || b.status === 'review';

export function activityCheck(b) {
  if (isFinished(b)) return `<span class="activity-check is-done" role="img" aria-label="Actividad hecha: ${esc(b.title)}">${icon('check', 'sm')}</span>`;
  return `<button type="button" class="activity-check" data-act="complete-activity" data-id="${esc(b.id)}" aria-label="Marcar ${esc(b.title)} como hecha" title="Marcar como hecha">${icon('check', 'sm')}</button>`;
}

export function activityNote(b) {
  return `<button type="button" class="activity-note ${b.notes ? 'has-note' : ''}" data-act="activity-note" data-id="${esc(b.id)}" aria-label="${b.notes ? 'Editar' : 'Añadir'} nota: ${esc(b.title)}" title="${b.notes ? 'Editar nota' : 'Añadir nota'}">${icon('pencil', 'sm')}</button>`;
}

action('complete-activity', el => {
  const b = store.state.blocks.find(x => x.id === el.dataset.id);
  if (!b || isFinished(b)) return;
  haptic();
  return setOutcome(b.id, 'mastered');
});

action('activity-note', el => {
  const id = el.dataset.id;
  const b = store.state.blocks.find(x => x.id === id);
  if (!b) return;
  const original = b.notes || '';
  const sheet = openSheet({
    title: 'Nota de la actividad', subtitle: esc(b.title),
    body: `<label class="field"><span class="sr-only">Tu nota</span><textarea class="textarea" data-note rows="5" maxlength="6000" autofocus placeholder="Materiales, un recordatorio o lo que quieras tener a mano…">${esc(original)}</textarea></label>`,
    foot: '<button type="button" class="btn" data-sheet-close>Cancelar</button><button type="button" class="btn btn-primary" data-save-note>Guardar nota</button>',
    onMount(card) {
      card.querySelector('[data-save-note]').addEventListener('click', () => {
        const current = store.state.blocks.find(x => x.id === id);
        if (!current) { toast('Esta actividad ya no existe.', {tone:'warn'}); sheet.close(); return; }
        if ((current.notes || '') !== original) { toast('La nota cambió mientras la editabas. Vuelve a abrirla para revisar la versión actual.', {tone:'warn'}); return; }
        const notes = card.querySelector('[data-note]').value.slice(0, 6000);
        if (notes === original) { sheet.close(); return; }
        const {entry} = change({label:'Nota de la actividad', type:'note', blockIds:[id],
          mutate(s) { s.blocks.find(x => x.id === id).notes = notes; }});
        sheet.close();
        undoToast('Nota guardada · Deshacer', entry);
      });
    },
  });
});
