// Brújula 4 · cliente de la Edge Function «brujula-ai» (Gemini). La clave de Gemini
// vive SOLO en Supabase Secrets; el navegador envía la sesión del usuario.

import { store } from '../core/store.js';
import { courseOf, isUsableBlock } from '../core/model.js';
import { todayISO, addDays } from '../core/dates.js';
import { cut } from '../core/util.js';
import { getClient, cloud } from '../cloud/cloud.js';
import { aiContext, chatSchedule } from '../engine/insights.js';
import { validateChanges } from '../engine/scheduler.js';
import { rulesFrom } from '../engine/rules.js';

export const quota = { remaining: null, model: null };

async function invoke(body) {
  if (!cloud.user) throw Error('Inicia sesión para usar el asistente.');
  if (!navigator.onLine) throw Error('Sin conexión. Las respuestas locales siguen disponibles.');
  const client = await getClient();
  const account = cloud.user.id;
  const { data, error } = await client.functions.invoke('brujula-ai', { body });
  if (error) {
    let detail = '';
    try { detail = (await error.context?.json?.())?.error || ''; } catch (_) { /* sin cuerpo */ }
    const status = error.context?.status;
    if (status === 404) throw Error('La función «brujula-ai» no está desplegada en Supabase.');
    throw Error(detail || error.message || 'No se pudo contactar con Gemini.');
  }
  if (!cloud.user || cloud.user.id !== account) throw Error('La sesión cambió; se descartó la respuesta.');
  if (data && Number.isInteger(data.remaining)) quota.remaining = data.remaining;
  if (data?.model) quota.model = data.model;
  return data || {};
}

export async function chat(message, history = [], { share = false } = {}) {
  const data = await invoke({ mode: 'chat', consent: true, message: message.slice(0, 1800), history: history.slice(-8), shareSchedule: !!share, schedule: share ? chatSchedule(store.state) : [] });
  if (typeof data.reply !== 'string') throw Error(data.error || 'Respuesta inválida de Gemini.');
  return data.reply;
}

/** Payload del modo antiguo (3.8) por si la función desplegada aún no tiene «analyze/plan». */
function legacySchedule() {
  const s = store.state, today = todayISO();
  return s.blocks.filter((b) => isUsableBlock(b) && b.date >= addDays(today, -1) && b.date <= addDays(today, 14))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, 40)
    .map((b) => ({ id: b.id, course: cut(courseOf(s, b.courseId).name, 80), date: b.date, start: b.start, end: b.end, title: cut(b.title, 100), kind: b.kind, status: b.status, priority: b.priority, difficulty: b.difficulty }));
}

function checked(changes) {
  return validateChanges(store.state, Array.isArray(changes) ? changes : [], { source: 'ai', rules: rulesFrom(store.state.preferences), now: new Date(), maxChanges: 6 });
}

/**
 * mode: 'analyze' (diagnóstico + propuestas) | 'plan' (pedido concreto de cambios).
 * Devuelve {summary, insights[], question, validation:{ops, rejected, warnings}, legacy}
 */
export async function scheduleAI(mode, message) {
  const s = store.state;
  const context = aiContext(s, new Date());
  const data = await invoke({ mode, consent: true, shareSchedule: true, message: String(message || (mode === 'analyze' ? 'Analiza mi semana y propón mejoras.' : '')).slice(0, 1800), context });
  if (data.analysis || data.proposal) {
    const a = data.analysis || {};
    const changes = data.analysis?.changes || data.proposal?.changes || [];
    return { summary: a.summary || data.proposal?.explanation || '', insights: Array.isArray(a.insights) ? a.insights : [], question: data.clarification || a.question || null, validation: checked(changes), legacy: false };
  }
  if (typeof data.reply === 'string') {
    // Función 3.8: no conoce estos modos. Para cambios concretos usamos su modo de propuestas.
    if (mode === 'plan') {
      const old = await invoke({ mode: 'schedule_proposal', consent: true, shareSchedule: true, message: String(message).slice(0, 1800), courses: s.courses.map((c) => c.name).slice(0, 35), schedule: legacySchedule(), preferences: s.preferences || {} });
      if (old.clarification || !old.proposal?.changes?.length) return { summary: '', insights: [], question: old.clarification || '¿Qué actividad quieres cambiar?', validation: checked([]), legacy: true };
      return { summary: '', insights: [], question: null, validation: checked(old.proposal.changes), legacy: true };
    }
    return { summary: data.reply, insights: [], question: null, validation: checked([]), legacy: true };
  }
  throw Error(data.error || 'Gemini no devolvió un análisis válido.');
}
