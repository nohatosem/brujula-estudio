// Brújula 4 · instalación como app y actualizaciones del service worker.
// Actualizar nunca borra datos: solo cambia los archivos de la aplicación en caché.

export const pwa = { canInstall: false, updateReady: false, standalone: false, ios: false, registration: null, offlineReady: false };
let deferred = null;
let notify = () => {};

export function initPWA({ onChange } = {}) {
  notify = onChange || notify;
  pwa.standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  pwa.ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; pwa.canInstall = true; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; pwa.canInstall = false; pwa.standalone = true; notify(); });
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    pwa.registration = reg;
    const watch = (w) => {
      if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { pwa.updateReady = true; notify(); } });
    };
    if (reg.waiting && navigator.serviceWorker.controller) { pwa.updateReady = true; notify(); }
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    navigator.serviceWorker.ready.then(() => { pwa.offlineReady = true; });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading || !pwa.applying) return; reloading = true; location.reload(); });
}

export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const choice = await deferred.userChoice.catch(() => null);
  deferred = null;
  pwa.canInstall = false;
  notify();
  return choice?.outcome === 'accepted';
}

export function applyUpdate() {
  const w = pwa.registration?.waiting;
  if (!w) { location.reload(); return; }
  pwa.applying = true;
  w.postMessage({ type: 'SKIP_WAITING' });
  setTimeout(() => location.reload(), 2500);
}
