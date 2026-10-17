// Brújula 4 · panel del asistente: respuestas locales sin cuota + Gemini (chat, análisis
// y propuestas validadas) + voz. Las conversaciones son temporales y por cuenta.

import { esc, cut, norm, plural } from '../core/util.js';
import { store, subscribe, commit, change } from '../core/store.js';
import { prefs, courseOf } from '../core/model.js';

import { computeFocus, upcomingEvaluations } from '../engine/priority.js';
import { icon } from '../ui/icons.js';

import { toast } from '../ui/feedback.js';
import { openProposal, applyOps } from '../ui/proposal.js';
import { stillApplicable } from '../engine/scheduler.js';
import { draftRecurring } from '../engine/recurrence.js';
import { undoToast } from '../features/undo-toast.js';
import { localReply, localAnalysis } from './local.js';
import { chat, scheduleAI, quota } from './gemini.js';
import { configureVoice, listen, startConversation, stopVoice, speakAndContinue, voiceState, canListen } from './voice.js';
import { cloud } from '../cloud/cloud.js';

const st = { el: null, open: false, owner: null, feed: [], turns: [], proposals: [], routinePlans: [], busy: false, pending: null, context: null, lastFocus: null };
const ANALYZE = /(analiza|analisis|revisa mi (semana|horario|plan)|como (va|esta|ves) mi (semana|horario)|diagnostic|evalua mi|que (puedo )?mejor|optimiza|equilibr)/;
const PLAN = /(organiza|reorganiza|planifica|programa(me|r)?|agenda(me|r)?|anade|agrega|crea(me)? (una |un )?(sesion|bloque|repaso|horario)|reprograma|mueve|cambia|pasa(lo|la)? .*(a|para) |libera|distribuye|arma(me)? (un )?(plan|horario)|ponme)/;
export const classify = (text) => { const v = norm(text); return ANALYZE.test(v) ? 'analyze' : PLAN.test(v) ? 'plan' : 'chat'; };

function ensure() {
  if (st.el) return st.el;
  const el = document.createElement('section');
  el.className = 'assistant';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'asTitle');
  el.innerHTML = `<header class="as-head"><h2 id="asTitle">${icon('sparkles')}Asistente</h2>
      <button type="button" class="icon-btn" data-as="talk" aria-pressed="false" aria-label="Conversar por voz" ${canListen() ? '' : 'hidden'}>${icon('headphones')}</button>
      <button type="button" class="icon-btn" data-as="clear" aria-label="Borrar conversación">${icon('trash')}</button>
      <button type="button" class="icon-btn" data-as="close" aria-label="Cerrar asistente">${icon('x')}</button></header>
    <div class="as-feed" id="asFeed" role="log" aria-live="polite" aria-label="Conversación"></div>
    <div class="as-suggest" id="asSuggest" aria-label="Sugerencias"></div>
    <p class="as-status" id="asStatus" role="status"></p>
    <form class="as-input" id="asForm"><label class="sr-only" for="asText">Mensaje</label>
      <textarea id="asText" rows="1" maxlength="1800" placeholder="Pregunta o pide un cambio…" enterkeyhint="send"></textarea>
      <button type="button" class="icon-btn mic" data-as="mic" aria-pressed="false" aria-label="Dictar" ${canListen() ? '' : 'hidden'}>${icon('mic')}</button>
      <button type="submit" class="icon-btn send" aria-label="Enviar">${icon('send')}</button></form>`;
  document.body.appendChild(el);
  st.el = el;
  const input = el.querySelector('#asText');
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(140, input.scrollHeight) + 'px'; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); submit(); } });
  el.querySelector('#asForm').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeAssistant(); } });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-as]');
    if (b) {
      const a = b.dataset.as;
      if (a === 'close') closeAssistant();
      else if (a === 'clear') { st.feed = []; st.turns = []; st.proposals = []; paint(); status('Conversación borrada.'); }
      else if (a === 'mic') { if (voiceState().phase === 'dictation') stopVoice(); else listen('dictation'); }
      else if (a === 'talk') { if (voiceState().conversation) stopVoice('Conversación por voz detenida.'); else if (!prefs(store.state).aiConsent) { push({ who: 'bot', src: 'system', text: 'Para conversar por voz con Gemini primero autoriza su uso.', actions: [{ label: 'Permitir Gemini', act: 'consent' }] }); } else startConversation(); }
      return;
    }
    const x = e.target.closest('[data-x]');
    if (x) runAction(st.feed[Number(x.dataset.m)]?.actions?.[Number(x.dataset.x)], x);
    const sug = e.target.closest('[data-sug]');
    if (sug) { const item = suggestions()[Number(sug.dataset.sug)]; if (item?.say) { if (item.fill) { input.value = item.say; input.focus(); grow(); } else send(item.say); } else runAction(item, sug); }
  });
  configureVoice({
    onText: (t) => { input.value = t; grow(); },
    onFinal: (t) => { input.value = ''; void send(t); },
    onStatus: (m) => status(m),
    onState: (v) => {
      el.querySelector('[data-as="mic"]')?.setAttribute('aria-pressed', String(v.phase === 'dictation'));
      el.querySelector('[data-as="talk"]')?.setAttribute('aria-pressed', String(v.conversation));
    },
  });
  return el;
}

function status(text) { const s = st.el?.querySelector('#asStatus'); if (s) s.textContent = text || ''; }
function quotaText() { return quota.remaining != null ? `Gemini: quedan ${quota.remaining} consultas hoy.` : ''; }

function push(item) { st.feed.push(item); if (st.feed.length > 60) st.feed.shift(); paint(); }

function suggestions() {
  const s = store.state;
  const out = [{ label: '¿Qué hago ahora?', icon: 'compass', say: '¿Qué hago ahora?' }, { label: 'Analiza mi semana', icon: 'gauge', say: 'Analiza mi semana' }, { label: 'Planifica mi semana', icon: 'wand-sparkles', say: 'Planifica mi semana' }, { label: 'Rutina 4 meses', icon: 'calendar-range', say: 'Todos los lunes estudiar Física de 15:00 a 17:00 durante cuatro meses', fill: true }];
  const ev = upcomingEvaluations(s, new Date(), 14)[0];
  if (ev) out.push({ label: `Plan para ${cut(ev.title, 22)}`, icon: 'route', act: 'as-plan', id: ev.id });
  const f = computeFocus(s, new Date());
  if (f.decisions[0]) out.push({ label: `No pude: ${cut(f.decisions[0].title, 20)}`, icon: 'calendar-clock', say: `No pude hacer «${f.decisions[0].title}»` });
  out.push({ label: 'Explícame un tema', icon: 'lightbulb', say: 'Explícame ', fill: true });
  out.push({ label: '¿Tengo cruces?', icon: 'triangle-alert', say: '¿Tengo cruces?' });
  return out;
}

function msgHTML(m, i) {
  if (m.who === 'me') return `<div class="msg me">${esc(m.text)}</div>`;
  if (m.who === 'typing') return `<div class="msg bot typing" aria-label="Escribiendo"><span></span><span></span><span></span></div>`;
  const src = m.src === 'local' ? `${icon('compass')}Brújula · sin usar cuota` : m.src === 'gemini' ? `${icon('sparkles')}Gemini` : m.src === 'error' ? `${icon('triangle-alert')}Aviso` : `${icon('shield-check')}Privacidad`;
  const insights = (m.insights || []).map((x) => `<div class="insight ${esc(x.type || 'tip')}">${icon(x.type === 'risk' ? 'triangle-alert' : x.type === 'win' ? 'trophy' : 'lightbulb')}<div><b>${esc(cut(x.title, 120))}</b>${x.detail ? `<div class="small muted">${esc(cut(x.detail, 300))}</div>` : ''}</div></div>`).join('');
  const actions = (m.actions || []).map((a, k) => a.href ? `<a class="btn btn-sm" href="${esc(a.href)}" data-x="${k}" data-m="${i}">${esc(a.label)}</a>` : `<button type="button" class="btn btn-sm ${a.primary ? 'btn-primary' : ''}" data-x="${k}" data-m="${i}">${a.icon ? icon(a.icon, 'sm') : ''}${esc(a.label)}</button>`).join('');
  return `<div class="msg bot"><div class="src">${src}</div>${m.text ? esc(m.text) : ''}${insights ? `<div style="margin-top:6px">${insights}</div>` : ''}${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}

function paint() {
  if (!st.el) return;
  const feed = st.el.querySelector('#asFeed');
  const intro = !st.feed.length ? `<div class="msg bot"><div class="src">${icon('compass')}Brújula</div>Hola${cloud.user?.email ? ', ' + esc(cloud.user.email.split('@')[0]) : ''}. Puedo decirte qué hacer ahora, mover algo que no pudiste hacer o analizar tu semana. Nada cambia sin tu aprobación.</div>` : '';
  feed.innerHTML = intro + st.feed.map(msgHTML).join('') + (st.busy ? msgHTML({ who: 'typing' }) : '');
  feed.scrollTop = feed.scrollHeight;
  st.el.querySelector('#asSuggest').innerHTML = suggestions().map((x, i) => `<button type="button" data-sug="${i}">${icon(x.icon)}${esc(x.label)}</button>`).join('');
  const send = st.el.querySelector('.send'); if (send) send.disabled = st.busy;
}

// Rutina hablada: un solo cambio reversible puede generar 4 meses de sesiones.
// Revalidamos antes de escribir; en automático solo actuamos tras permiso único.
function saveRecurring(raw, savedAt = null) {
  if (savedAt != null && Number(store.state.savedAt) !== Number(savedAt)) {
    push({ who:'bot', src:'error', text:'Tu horario cambió desde la propuesta. Vuelve a dar la orden para recalcular.' }); return;
  }
  const plan = draftRecurring(raw, store.state, new Date());
  if (!plan || plan.error) { push({who:'bot',src:'error',text:plan?.error||'No reconocí la rutina.'}); return; }
  if (plan.kind === 'remove' && plan.ids.length > 126) { push({who:'bot',src:'error',text:'Demasiadas sesiones para retirar de una vez.'}); return; }
  const touched = plan.ids || [];
  const { entry } = change({
    label:plan.message,type:'recurring',blockIds:touched,
    mutate(state) {
      if(plan.kind === 'add'){
        if(plan.newCourse&&!state.courses.some(c=>c.id===plan.newCourse.id))state.courses.push(plan.newCourse);
        state.blocks.push(...plan.items);
      }
      else if(plan.kind === 'remove')state.blocks=state.blocks.filter(b=>!touched.includes(b.id));
      else if(plan.kind === 'move')for(const next of plan.items){
        const b=state.blocks.find(x=>x.id===next.id); if(b)Object.assign(b,next);
      }
    },
    event:{status:'progress',type:'recurring',title:'Rutina del semestre',course:'Brújula',reason:plan.message}
  });
  undoToast('Horario actualizado · Deshacer',entry);
  push({who:'bot',src:'local',text:'✓ '+plan.message+' Puedes deshacer el cambio desde el aviso o en Semana.'});
}
function askRecurring(raw){
  const plan=draftRecurring(raw,store.state,new Date());
  if(!plan)return false;
  if(plan.error){push({who:'bot',src:'local',text:plan.error});return true;}
  if(prefs(store.state).aiDirect){saveRecurring(raw);return true;}
  const idx=st.routinePlans.push({raw,at:store.state.savedAt})-1;
  push({who:'bot',src:'local',text:plan.message+' ¿Lo guardo?',actions:[
    {label:'Guardar rutina',act:'routine-apply',idx,primary:true,icon:'check'},
    {label:'Permitir cambios directos',act:'direct-enable',idx,icon:'zap'}
  ]});
  return true;
}

async function runAction(a, el) {
  if (!a) return;
  if (a.href) { closeAssistant(); return; }
  if (a.say) { void send(a.say); return; }
  if (a.act === 'routine-apply') {
    const r=st.routinePlans[a.idx]; if(r)saveRecurring(r.raw,r.at); return;
  }
  if (a.act === 'direct-enable') {
    const { confirmSheet } = await import('../ui/feedback.js');
    const ok=await confirmSheet({title:'Asistente directo',text:'¿Permitir que Brújula aplique sin preguntar cada cambio seguro que le pidas? Las clases, los exámenes y el descanso estarán protegidos frente a reprogramaciones automáticas.',confirm:'Permitir una vez'});
    if(ok){
      store.state.preferences={...prefs(store.state),aiDirect:true,aiDirectConsentAt:new Date().toISOString()};
      commit();
      const r=st.routinePlans[a.idx];if(r)saveRecurring(r.raw);
    }
    return;
  }
  import('../features/actions.js').then(async (A) => {
    if (a.act === 'as-move') { closeAssistant(); await A.proposeMove(a.id); }
    else if (a.act === 'as-missed') { closeAssistant(); await A.setOutcome(a.id, 'missed'); }
    else if (a.act === 'as-plan') { closeAssistant(); A.planExam(a.id); }
    else if (a.act === 'as-week') { closeAssistant(); A.planWeekFlow(); }
    else if (a.act === 'as-open') { closeAssistant(); (await import('../ui/details.js')).openBlockDetail(a.id); }
    else if (a.act === 'routine') { closeAssistant(); (await import('../ui/details.js')).openRoutineSheet(); }
    else if (a.act === 'consent' || a.act === 'share') {
      const p = prefs(store.state);
      store.state.preferences = { ...p, aiConsent: true, aiConsentAt: p.aiConsentAt || new Date().toISOString(), ...(a.act === 'share' || a.share ? { aiShareSchedule: true } : {}) };
      commit();
      el?.closest('.msg')?.querySelector('.actions')?.remove();
      const pend = st.pending; st.pending = null;
      if (pend) { if (pend.intent !== 'chat' && !prefs(store.state).aiShareSchedule) { askShare(pend); return; } await runAI(pend.text, pend.intent); }
    } else if (a.act === 'deny') { st.pending = null; el?.closest('.msg')?.querySelector('.actions')?.remove(); push({ who: 'bot', src: 'local', text: 'De acuerdo. Sigo con respuestas locales; puedes activarlo cuando quieras en Ajustes → Asistente.' }); }
    else if (a.act === 'review') { const v = st.proposals[a.idx]; if (v) openProposal({ title: 'Propuesta de Gemini', ops: v.ops, rejected: v.rejected, warnings: v.warnings, source: 'ai', eventReason: 'Propuesta de Gemini aprobada por ti' }); }
    else if (a.act === 'local-analysis') { push({ who: 'bot', src: 'local', text: 'Análisis rápido de los próximos 7 días:', insights: localAnalysis() }); }
    else if (a.act === 'speak') { const msg = el?.closest('.msg'); const text = st.feed[Number(el?.dataset.m)]?.text || msg?.textContent || ''; const { speak, isSpeaking, stopSpeaking } = await import('../features/audio.js'); if (isSpeaking()) stopSpeaking(); else if (!speak(text)) toast('Tu navegador no puede leer en voz alta.'); }
  });
}

function askShare(pending) {
  st.pending = pending;
  push({ who: 'bot', src: 'system', text: 'Para analizar o cambiar tu horario necesito enviar a Gemini tus próximas actividades, temas y exámenes (sin notas, diario ni contraseñas).', actions: [{ label: 'Permitir enviar mi horario', act: 'share', primary: true }, { label: 'Ahora no', act: 'deny' }] });
}

async function submit() {
  const input = st.el.querySelector('#asText');
  const text = input.value;
  input.value = ''; input.style.height = 'auto';
  await send(text);
}

export async function send(raw) {
  const text = String(raw || '').trim().slice(0, 1800);
  if (!text || st.busy) return;
  push({ who: 'me', text });
  if(askRecurring(text))return;
  const local = localReply(text);
  if (local) {
    push({ who: 'bot', src: 'local', text: local.text, actions: local.actions || [] });
    speakAndContinue(local.text);
    return;
  }
  const intent = classify(text);
  const p = prefs(store.state);
  if (!p.aiConsent) {
    st.pending = { text, intent };
    push({ who: 'bot', src: 'system', text: 'Para responder esto uso Gemini de Google. Tu mensaje viaja a tu función segura de Supabase y de ahí a Google; en el nivel gratuito, Google puede usarlo para mejorar sus productos. No incluyas datos sensibles.', actions: [{ label: 'Permitir Gemini', act: intent === 'chat' ? 'consent' : 'consent', primary: true, share: false }, { label: 'Solo respuestas locales', act: 'deny' }, ...(intent === 'analyze' ? [{ label: 'Análisis local', act: 'local-analysis' }] : [])] });
    if (voiceState().conversation) stopVoice('Autoriza Gemini para seguir conversando.');
    return;
  }
  if (intent !== 'chat' && !p.aiShareSchedule) { askShare({ text, intent }); return; }
  await runAI(text, intent);
}

async function runAI(text, intent) {
  st.busy = true; paint(); status('Consultando a Gemini…');
  try {
    const ctxText = st.context?.blockId ? (() => { const b = store.state.blocks.find((x) => x.id === st.context.blockId); return b ? `[Contexto: estoy en una sesión de «${b.title}» del curso ${courseOf(store.state, b.courseId).name}.] ` : ''; })() : '';
    if (intent === 'chat') {
      const reply = await chat(ctxText + text, st.turns, { share: prefs(store.state).aiShareSchedule });
      st.turns.push({ role: 'user', text }, { role: 'model', text: reply });
      st.turns = st.turns.slice(-12);
      push({ who: 'bot', src: 'gemini', text: reply, actions: [{ label: 'Escuchar', act: 'speak', icon: 'volume-2' }] });
      speakAndContinue(reply);
    } else {
      const r = await scheduleAI(intent, text);
      if (r.question && !r.validation.ops.length) { push({ who: 'bot', src: 'gemini', text: r.question }); speakAndContinue(r.question); }
      else {
        const v = r.validation;
        if(intent === 'plan' && prefs(store.state).aiDirect && v.ops.length &&
           !v.rejected.length && !v.warnings.length && v.ops.length<=5 &&
           stillApplicable(store.state,v.ops)) {
          const {entry}=change({
            label:'Gemini: '+v.ops.length+' ajustes',type:'ai',
            blockIds:v.ops.filter(op=>op.action!=='add').map(op=>op.id),
            mutate:(state)=>applyOps(state,v.ops),
            event:{status:'progress',type:'ai',title:'Cambio directo de Gemini',
              course:'Mi horario',reason:'Petición explícita; modo directo autorizado'}
          });
          undoToast('Gemini actualizó '+v.ops.length+' actividades · Deshacer',entry);
          push({who:'bot',src:'gemini',text:'✓ Hecho: '+v.ops.length+' cambios seguros guardados en tu horario. Puedes deshacerlos.'});
          status(quotaText());
          return;
        }
        const idx = st.proposals.push(v) - 1;
        const parts = [];
        if (r.summary) parts.push(r.summary);
        if (v.ops.length) parts.push(`Propongo ${plural(v.ops.length, 'cambio', 'cambios')}${v.rejected.length ? ` (descarté ${v.rejected.length} por no respetar tus reglas)` : ''}. Ya verifiqué cruces, sueño, almuerzo y protegidos.`);
        else if (v.rejected.length) parts.push(`Gemini sugirió ${plural(v.rejected.length, 'cambio', 'cambios')}, pero ninguno pasó las comprobaciones de seguridad. Pide otra alternativa.`);
        else if (intent === 'plan') parts.push('No encontré cambios necesarios.');
        const actions = v.ops.length || v.rejected.length ? [{ label: v.ops.length ? `Revisar ${plural(v.ops.length, 'cambio', 'cambios')}` : 'Ver por qué', act: 'review', idx, primary: true, icon: 'list-checks' }] : [];
        push({ who: 'bot', src: 'gemini', text: parts.join(' '), insights: r.insights.slice(0, 5), actions });
        if (r.legacy && intent === 'analyze') status('Tu función de Supabase es la versión anterior: despliega la nueva para análisis estructurado.');
        speakAndContinue(parts.join(' '));
      }
    }
    status(quotaText());
  } catch (e) {
    push({ who: 'bot', src: 'error', text: e.message || 'No se pudo completar la consulta.', actions: intent === 'analyze' ? [{ label: 'Ver análisis local', act: 'local-analysis' }] : [] });
    status('');
    if (voiceState().conversation) stopVoice('Se pausó la conversación por un error.');
  } finally { st.busy = false; paint(); }
}

export function openAssistant({ prefill = '', autoSend = false, context = null } = {}) {
  if (!cloud.user) { toast('Inicia sesión para usar el asistente.'); return; }
  const el = ensure();
  if (st.owner !== cloud.user.id) { st.owner = cloud.user.id; st.feed = []; st.turns = []; st.proposals = []; st.routinePlans = []; }
  st.context = context;
  st.lastFocus = document.activeElement;
  el.hidden = false;
  st.open = true;
  const app = document.getElementById('app'); if (app) app.inert = true;
  paint();
  status(quotaText());
  const input = el.querySelector('#asText');
  if (prefill && autoSend) void send(prefill);
  else if (prefill) { input.value = prefill; }
  setTimeout(() => input.focus(), 50);
}

export function closeAssistant() {
  if (!st.el || !st.open) return;
  stopVoice();
  st.el.hidden = true;
  st.open = false;
  const app = document.getElementById('app'); if (app) app.inert = false;
  try { st.lastFocus?.focus?.(); } catch (_) { /* nada */ }
}

export function initAssistant() {
  subscribe((reason) => {
    if (reason === 'account') { closeAssistant(); st.feed = []; st.turns = []; st.proposals = []; st.routinePlans = []; st.owner = store.userId; }
    if (st.open) paint();
  });
  window.addEventListener('hashchange', () => { if (st.open) closeAssistant(); });
}
