// Brújula 4 · acceso: entrar, crear cuenta y recuperar contraseña (Supabase Auth).

import { esc } from '../core/util.js';
import { icon } from '../ui/icons.js';
import { action, formData } from '../ui/dom.js';
import { cloud, signIn, signUp, sendPasswordReset } from '../cloud/cloud.js';

let tab = 'login';
let msg = { text: '', tone: '' };
let busy = false;

const COURSE_ART = `<svg viewBox="0 0 360 92" class="auth-art" aria-hidden="true" fill="none" stroke="var(--route)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
  <path d="M20 70 L34 46 L48 70 Z" fill="var(--paper)"/>
  <path d="M46 56 L104 34" /><circle cx="118" cy="30" r="13" fill="var(--paper)"/><text x="118" y="35" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif" font-size="14" font-weight="700" fill="var(--route)" stroke="none">1</text>
  <path d="M131 34 L196 58" /><circle cx="210" cy="62" r="13" fill="var(--paper)"/><text x="210" y="67" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif" font-size="14" font-weight="700" fill="var(--route)" stroke="none">2</text>
  <path d="M223 58 L282 36" /><circle cx="300" cy="30" r="15" fill="var(--paper)"/><circle cx="300" cy="30" r="8.5"/>
</svg>`;

export function render() {
  const signup = tab === 'signup';
  return `<div class="auth">
    <section class="auth-hero">
      <svg class="mark" viewBox="0 0 512 512" aria-hidden="true"><circle cx="256" cy="256" r="150" fill="none" stroke="currentColor" stroke-width="30"/><g transform="rotate(32 256 256)"><path d="M256 138 L300 256 L212 256 Z" fill="var(--route)"/><path d="M256 374 L300 256 L212 256 Z" fill="currentColor" fill-opacity=".5"/></g><circle cx="256" cy="256" r="14" fill="var(--paper)"/></svg>
      <h1>Brújula</h1>
      <p>Te dice qué hacer ahora, qué tienes pendiente y qué es prioritario. Para estudiar mejor sin dejar de vivir.</p>
      ${COURSE_ART}
    </section>
    <form class="auth-card" data-submit="auth-submit" novalidate>
      <div class="seg" role="group" aria-label="Acceso"><button type="button" data-act="auth-tab" data-tab="login" aria-pressed="${!signup}">Entrar</button><button type="button" data-act="auth-tab" data-tab="signup" aria-pressed="${signup}">Crear cuenta</button></div>
      <label class="field"><span>Correo</span><input class="input" type="email" name="email" id="authEmail" autocomplete="email" inputmode="email" required placeholder="tu@correo.com"></label>
      <label class="field"><span>Contraseña</span><span class="pw-wrap"><input class="input" type="password" name="password" id="authPassword" minlength="6" required autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="${signup ? 'Mínimo 6 caracteres' : 'Tu contraseña'}"><button type="button" class="icon-btn" data-act="toggle-pw" aria-label="Mostrar contraseña">${icon('eye')}</button></span></label>
      <button class="btn btn-primary btn-lg btn-block" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Un momento…' : signup ? 'Crear mi cuenta' : 'Entrar'}</button>
      ${signup ? '<p class="hint">Cada cuenta empieza con su propio horario, privado.</p>' : '<button type="button" class="btn btn-quiet btn-sm" data-act="forgot">¿Olvidaste tu contraseña?</button>'}
      <p class="auth-msg ${esc(msg.tone)}" role="status" aria-live="polite" id="authMsg">${esc(msg.text || cloud.message || '')}</p>
    </form>
  </div>`;
}

export function update(root) {
  const m = root.querySelector('#authMsg');
  if (m && !msg.text) m.textContent = cloud.message || '';
}

function setMsg(text, tone = '') {
  msg = { text, tone };
  const m = document.getElementById('authMsg');
  if (m) { m.textContent = text; m.className = `auth-msg ${tone}`; }
}

action('auth-tab', (el) => {
  const email = document.getElementById('authEmail')?.value || '';
  tab = el.dataset.tab; msg = { text: '', tone: '' };
  const root = document.getElementById('app');
  root.innerHTML = render();
  const e = document.getElementById('authEmail'); if (e) { e.value = email; (email ? document.getElementById('authPassword') : e).focus(); }
});
action('toggle-pw', (el) => {
  const input = document.getElementById('authPassword');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  el.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
  el.innerHTML = icon(show ? 'eye-off' : 'eye');
});
action('auth-submit', async (form) => {
  if (busy) return;
  const { email, password } = formData(form);
  const em = String(email || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(em)) { setMsg('Escribe un correo válido.', 'err'); document.getElementById('authEmail').focus(); return; }
  if (String(password || '').length < 6) { setMsg('La contraseña debe tener al menos 6 caracteres.', 'err'); document.getElementById('authPassword').focus(); return; }
  busy = true;
  const btn = form.querySelector('[type="submit"]'); if (btn) { btn.disabled = true; btn.textContent = 'Un momento…'; }
  setMsg('');
  try {
    if (tab === 'signup') {
      const r = await signUp(em, password);
      if (r.needsConfirmation) { tab = 'login'; busy = false; document.getElementById('app').innerHTML = render(); document.getElementById('authEmail').value = em; setMsg('Cuenta creada. Revisa tu correo (y spam) para confirmarla; luego entra.', 'ok'); return; }
    } else await signIn(em, password);
  } catch (e) {
    setMsg(e.message || 'No se pudo entrar.', 'err');
  } finally {
    busy = false;
    const b = document.querySelector('.auth-card [type="submit"]'); if (b) { b.disabled = false; b.textContent = tab === 'signup' ? 'Crear mi cuenta' : 'Entrar'; }
  }
});
action('forgot', async () => {
  const em = (document.getElementById('authEmail')?.value || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(em)) { setMsg('Escribe tu correo arriba y vuelve a pulsar «¿Olvidaste tu contraseña?».', 'err'); document.getElementById('authEmail').focus(); return; }
  try { await sendPasswordReset(em); setMsg('Te envié un enlace para crear una contraseña nueva. Ábrelo en este dispositivo.', 'ok'); } catch (e) { setMsg(e.message, 'err'); }
});
