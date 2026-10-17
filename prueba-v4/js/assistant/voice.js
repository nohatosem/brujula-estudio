// Brújula 4 · voz del asistente: dictado y conversación (Web Speech API del navegador).
// El micrófono solo se activa por acción explícita. Algunos navegadores envían el audio a
// su propio servicio de reconocimiento; Brújula no guarda grabaciones de estas conversaciones.

import { speak, stopSpeaking, canSpeak } from '../features/audio.js';

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = () => !!Recognition;

const st = { rec: null, conversation: false, epoch: 0, phase: 'idle' };
let hooks = { onText: () => {}, onFinal: () => {}, onStatus: () => {}, onState: () => {} };
export function configureVoice(h) { hooks = { ...hooks, ...h }; }
export const voiceState = () => ({ conversation: st.conversation, phase: st.phase });

function setPhase(p, msg = '') { st.phase = p; hooks.onState(voiceState()); if (msg) hooks.onStatus(msg); }

export function stopVoice(msg = '') {
  st.epoch++;
  st.conversation = false;
  const old = st.rec; st.rec = null;
  if (old) { old.onresult = old.onerror = old.onend = null; try { old.abort(); } catch (_) { /* nada */ } }
  stopSpeaking();
  setPhase('idle', msg);
}

const ERRORS = {
  'not-allowed': 'El micrófono está bloqueado. Permítelo desde el candado de la barra de direcciones.',
  'service-not-allowed': 'Este navegador no permite el reconocimiento de voz.',
  'audio-capture': 'No se detectó ningún micrófono.',
  network: 'El reconocimiento de voz necesita conexión.',
  'no-speech': 'No escuché nada. Toca el micrófono para intentar otra vez.',
  aborted: 'Micrófono detenido.',
};

/** kind: 'dictation' (escribe en el cuadro) | 'conversation' (envía y responde en voz alta). */
export function listen(kind = 'dictation') {
  if (!Recognition) { hooks.onStatus('Este navegador no reconoce voz. Prueba Chrome o escribe tu mensaje.'); return false; }
  if (st.rec) return false;
  stopSpeaking();
  const mark = st.epoch;
  const rec = new Recognition();
  st.rec = rec;
  rec.lang = 'es-PE'; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 1;
  let finalText = '', failed = false;
  rec.onresult = (e) => {
    if (mark !== st.epoch) return;
    let fin = '', interim = '';
    for (let i = 0; i < e.results.length; i++) { const t = e.results[i]?.[0]?.transcript || ''; if (e.results[i].isFinal) fin += t + ' '; else interim += t + ' '; }
    hooks.onText((fin || interim).trim().slice(0, 1800));
    if (fin.trim()) finalText = fin.trim().slice(0, 1800);
  };
  rec.onerror = (e) => { if (mark !== st.epoch) return; failed = true; stopVoice(ERRORS[e.error] || 'No se pudo reconocer tu voz.'); };
  rec.onend = () => {
    if (mark !== st.epoch || failed) return;
    st.rec = null;
    if (kind === 'dictation') { setPhase('idle', finalText ? 'Dictado listo. Revisa y envía.' : 'No capté ninguna frase.'); return; }
    if (!st.conversation) { setPhase('idle'); return; }
    if (!finalText) { stopVoice('No escuché una pregunta; pausé la conversación para proteger tu privacidad.'); return; }
    setPhase('thinking', 'Pensando…');
    hooks.onFinal(finalText);
  };
  try {
    rec.start();
    setPhase(kind === 'dictation' ? 'dictation' : 'listening', kind === 'dictation' ? 'Te escucho… habla y haz una pausa al terminar.' : 'Te escucho. Haz una pausa al terminar.');
    return true;
  } catch (_) { st.rec = null; stopVoice('No se pudo activar el micrófono.'); return false; }
}

export function startConversation() {
  if (!Recognition) { hooks.onStatus('Este navegador no reconoce voz.'); return false; }
  stopVoice();
  st.conversation = true;
  return listen('conversation');
}

/** Llamar cuando llega la respuesta en modo conversación: la lee y vuelve a escuchar. */
export function speakAndContinue(text) {
  if (!st.conversation) return;
  if (!canSpeak()) { stopVoice('Este navegador no puede leer respuestas en voz alta.'); return; }
  const mark = st.epoch;
  setPhase('speaking', 'Respondiendo…');
  speak(text, { rate: 0.98, onend: () => { if (mark !== st.epoch || !st.conversation) return; listen('conversation'); } });
}

document.addEventListener('visibilitychange', () => { if (document.hidden && (st.conversation || st.rec)) stopVoice('El micrófono se detuvo al salir de Brújula.'); });
window.addEventListener('pagehide', () => stopVoice());
