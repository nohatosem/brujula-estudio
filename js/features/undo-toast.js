// Aviso con botón «Deshacer» conectado a la pila de deshacer del estado.
import { undo } from '../core/store.js';
import { toast } from '../ui/feedback.js';

export function undoToast(message, entry, tone = 'ok') {
  return toast(message, {
    tone,
    action: entry ? { label: 'Deshacer', run: () => { const r = undo(entry.id); toast(r.ok ? 'Cambio deshecho.' : r.reason, { tone: r.ok ? 'ok' : 'warn' }); } } : null,
  });
}
