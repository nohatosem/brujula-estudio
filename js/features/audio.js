// Brújula 4 · audio de estudio: lectura en voz alta, sonido ambiental generado y notas de voz
// guardadas SOLO en este dispositivo (IndexedDB «brujula_audio_v1», mismas claves que 3.x).

import { store } from '../core/store.js';

// ——— Lectura en voz alta ———
export const canSpeak = () => 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
export function pickVoice() {
  if (!canSpeak()) return null;
  const voices = speechSynthesis.getVoices();
  const spanish = voices.filter(v => /^es([-_]|$)/i.test(v.lang || ''));
  return spanish.find(v=>/^es[-_]pe$/i.test(v.lang)) ||
    spanish.find(v=>/^es[-_]419$/i.test(v.lang)) ||
    spanish.find(v=>/^es[-_](mx|co|ar|cl|es)$/i.test(v.lang)) ||
    spanish[0] || null;
}
/** Chrome a veces entrega sus voces después de cargar la página. Esperamos brevemente. */
export async function waitForSpanishVoice(timeout=3000) {
  if (!canSpeak()) return false;
  if (pickVoice()) return true;
  return await new Promise(resolve=>{
    let finished=false;
    let timer=null;
    function finish(){
      if(finished)return;
      finished=true;
      if(timer!=null)clearTimeout(timer);
      speechSynthesis.removeEventListener?.('voiceschanged',onVoices);
      resolve(!!pickVoice());
    }
    function onVoices(){if(pickVoice())finish();}
    speechSynthesis.addEventListener?.('voiceschanged',onVoices);
    timer=setTimeout(finish,timeout);
    speechSynthesis.getVoices();
  });
}
export function speak(text, { rate = 0.92, onend = null } = {}) {
  if (!canSpeak()) return false;
  stopSpeaking();
  const clean = String(text || '').replace(/https?:\/\/\S+/g, 'enlace').replace(/[*_#`>]/g, '').slice(0, 3500).trim();
  if (!clean) return false;
  const v = pickVoice();
  if (!v) return false; // No usar nunca la voz predeterminada inglesa.
  const u = new SpeechSynthesisUtterance(clean);
  u.voice = v; u.lang = v.lang || 'es-ES'; u.rate = rate; u.pitch = 1;
  if (onend) { u.onend = onend; u.onerror = onend; }
  speechSynthesis.speak(u);
  return true;
}
export function stopSpeaking() { try { if (canSpeak()) speechSynthesis.cancel(); } catch (_) { /* nada */ } }
export const isSpeaking = () => canSpeak() && speechSynthesis.speaking;

// ——— Sonido ambiental (generado en el navegador, sin archivos externos) ———
const ambient = { ctx: null, nodes: [], kind: null };
export const ambientOn = () => !!ambient.ctx;
export const ambientKind = () => ambient.kind;
export async function startAmbient(kind = 'rain') {
  stopAmbient();
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  let ctx;
  try { ctx = new AC(); } catch (_) { return false; }
  ambient.ctx = ctx; ambient.kind = kind;
  // En teléfonos, AudioContext suele iniciar 'suspended'; reanudar desde el clic.
  try { if(ctx.state !== 'running') await ctx.resume(); }
  catch (_) { stopAmbient();return false; }
  if(ctx.state !== 'running'){stopAmbient();return false;}
  const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  master.gain.linearRampToValueAtTime(kind === 'rain' ? 0.32 : 0.42, ctx.currentTime + 0.35);
  ambient.nodes.push(master);
  if (kind === 'rain') {
    // Ruido marrón filtrado: suena como lluvia suave lejana.
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const white = Math.random() * 2 - 1; last = (last + 0.02 * white) / 1.02; data[i] = last * 3.2; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
    src.connect(hp); hp.connect(lp); lp.connect(master); src.start();
    ambient.nodes.push(src, lp, hp);
  } else {
    // Acorde suave y audible también en altavoces de teléfonos.
    [261.63, 329.63, 392, 523.25].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = i===0 ? 'triangle' : 'sine'; o.frequency.value = f;
      g.gain.value = i===0 ? 0.075 : i===3 ? 0.025 : 0.05;
      o.connect(g); g.connect(master); o.start();
      ambient.nodes.push(o, g);
    });
  }
  return true;
}
export function stopAmbient() {
  for (const n of ambient.nodes) { try { n.stop?.(); } catch (_) { /* nada */ } try { n.disconnect?.(); } catch (_) { /* nada */ } }
  ambient.nodes = [];
  if (ambient.ctx) { try{Promise.resolve(ambient.ctx.close()).catch(()=>{});}catch(_){} ambient.ctx = null; }
  ambient.kind = null;
}

// ——— Notas de voz (solo en este dispositivo) ———
const account = () => store.userId || 'invitado';
export const voiceKey = (blockId) => 'account:' + account() + ':block:' + blockId;
function db() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(Error('Este navegador no permite guardar audio.')); return; }
    const req = indexedDB.open('brujula_audio_v1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('notes');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || Error('No se pudo abrir el audio local.'));
  });
}
async function op(kind, key, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('notes', kind === 'get' ? 'readonly' : 'readwrite');
    const st = tx.objectStore('notes');
    const req = kind === 'get' ? st.get(key) : kind === 'put' ? st.put(value, key) : st.delete(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => d.close();
    tx.onerror = () => { d.close(); reject(tx.error); };
  });
}
export const getNote = (blockId) => op('get', voiceKey(blockId));
export const deleteNote = (blockId) => op('delete', voiceKey(blockId));

const rec = { recorder: null, stream: null, timer: null, blockId: null };
let player = null, playerUrl = null;
export const isRecording = () => !!rec.recorder && rec.recorder.state === 'recording';
export const canRecord = () => !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder;

export async function startRecording(blockId, { onStop } = {}) {
  if (!canRecord()) throw Error('La grabación necesita un navegador con micrófono (HTTPS).');
  if (isRecording()) throw Error('Ya hay una grabación en curso.');
  stopPlayback(); stopSpeaking(); stopAmbient();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  const key = voiceKey(blockId);
  rec.recorder = recorder; rec.stream = stream; rec.blockId = blockId;
  recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    clearTimeout(rec.timer);
    rec.recorder = null; rec.stream = null;
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    let result = { ok: false, message: 'La grabación estaba vacía.' };
    if (blob.size > 12 * 1024 * 1024) result = { ok: false, message: 'Audio demasiado grande; graba menos de 2 minutos.' };
    else if (blob.size > 0) {
      try { await op('put', key, { blob, at: Date.now(), mime: blob.type }); result = { ok: true }; } catch (_) { result = { ok: false, message: 'No se pudo guardar. Revisa el espacio libre.' }; }
    }
    onStop?.(result);
  };
  recorder.start();
  rec.timer = setTimeout(stopRecording, 120000);
}
export function stopRecording() {
  if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop();
  if (rec.stream) { rec.stream.getTracks().forEach((t) => t.stop()); }
  clearTimeout(rec.timer);
}
export async function playNote(blockId, { download = false, title = 'nota' } = {}) {
  const saved = await getNote(blockId);
  if (!saved?.blob) throw Error('Todavía no hay grabación para esta sesión.');
  stopPlayback();
  playerUrl = URL.createObjectURL(saved.blob);
  if (download) {
    const a = document.createElement('a');
    a.href = playerUrl; a.download = `brujula-${title}.${String(saved.mime).includes('mp4') ? 'm4a' : 'webm'}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(stopPlayback, 1500);
    return;
  }
  player = new Audio(playerUrl);
  player.onended = stopPlayback;
  await player.play();
}
export function stopPlayback() {
  if (player) { player.pause(); player = null; }
  if (playerUrl) { URL.revokeObjectURL(playerUrl); playerUrl = null; }
}
export function stopAllAudio() { stopRecording(); stopPlayback(); stopSpeaking(); stopAmbient(); }
