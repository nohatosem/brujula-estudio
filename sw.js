/* Brújula 4 · service worker.
   - App instalable y usable sin conexión (copia local de la app, nunca de tus datos de Supabase).
   - Actualizar NO borra localStorage ni IndexedDB: solo reemplaza los archivos de la app.
   - Las peticiones a Supabase (cuenta, datos, Gemini) nunca se guardan en caché. */
const VERSION = '4.2.0';
const CACHE = 'brujula-app-v' + VERSION;
const RUNTIME = 'brujula-runtime-v1';
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
// PRECACHE:START (lo regenera tools/precache.mjs)
const SHELL = [
  './',
  './icon.svg',
  './index.html',
  './js/ui/dom.js',
  './js/ui/forms.js',
  './js/ui/icons.js',
  './actualizar.html',
  './js/core/util.js',
  './js/ui/router.js',
  './js/core/dates.js',
  './js/core/model.js',
  './js/core/store.js',
  './js/engine/srs.js',
  './js/ui/details.js',
  './js/views/auth.js',
  './js/views/week.js',
  './js/app.js?v=4.2.0',
  './js/cloud/cloud.js',
  './js/ui/feedback.js',
  './js/ui/proposal.js',
  './js/views/study.js',
  './js/views/today.js',
  './icons/badge-96.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/engine/rules.js',
  './js/engine/recurrence.js',
  './js/features/chatgpt-bridge.js',
  './js/features/materials.js',
  './js/features/pwa.js',
  './js/views/common.js',
  './js/views/course.js',
  './js/views/habits.js',
  './assets/contours.svg',
  './js/features/push.js',
  './js/views/session.js',
  './icons/brand-mark.svg',
  './icons/favicon-32.png',
  './js/features/audio.js',
  './js/features/theme.js',
  './js/views/progress.js',
  './js/views/settings.js',
  './manifest.webmanifest',
  './js/assistant/local.js',
  './js/assistant/panel.js',
  './js/assistant/voice.js',
  './js/engine/insights.js',
  './js/engine/priority.js',
  './js/engine/quickadd.js',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './js/assistant/gemini.js',
  './js/engine/scheduler.js',
  './js/features/actions.js',
  './css/brujula.css?v=4.0.0',
  './js/features/reminders.js',
  './js/features/undo-toast.js',
  './icons/apple-touch-icon.png',
];
// PRECACHE:END

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Comprueba que GitHub Pages ya sirve esta versión (evita mezclar archivos de dos versiones).
    const index = await fetch('./index.html', { cache: 'reload' });
    if (!index.ok || !(await index.clone().text()).includes('BRUJULA-VERSION-' + VERSION)) throw new Error('La versión publicada aún no coincide');
    await cache.put('./index.html', index);
    await Promise.all(SHELL.filter((u) => u !== './index.html').map(async (url) => {
      const res = await fetch(url, { cache: 'reload' });
      if (!res.ok) throw new Error('No se pudo guardar ' + url);
      await cache.put(url, res);
    }));
    // Si venimos de Brújula 3.x (otra estrategia de caché), activamos de inmediato:
    // la página ya se está ejecutando con los archivos nuevos.
    const keys = await caches.keys();
    if (keys.some((k) => k.startsWith('brujula-offline-'))) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => (k.startsWith('brujula-app-v') && k !== CACHE) || k.startsWith('brujula-offline-')).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

const MAINTENANCE = /\/(actualizar|brujula-actualizada)\.html$/;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Supabase (auth, datos, funciones) y cualquier API: siempre red, nunca caché.
  if (/\.supabase\.(co|in)$/.test(url.hostname)) return;
  // Cliente supabase-js desde el CDN: copia de respaldo para abrir sin conexión.
  if (url.href.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2')) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => null);
      return cached || (await network) || Response.error();
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    if (MAINTENANCE.test(url.pathname)) { event.respondWith(fetch(req).catch(() => caches.match('./index.html'))); return; }
    // App de una sola página: la copia guardada abre al instante y sin conexión.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match('./index.html');
      if (cached) return cached;
      try { return await fetch(req); } catch (_) { return new Response('<p style="font-family:system-ui;padding:24px">Sin conexión. Abre Brújula de nuevo cuando tengas internet.</p>', { headers: { 'content-type': 'text/html; charset=utf-8' } }); }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      return res;
    } catch (_) {
      return (await cache.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './index.html', self.registration.scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) { await c.focus(); if ('navigate' in c) { try { await c.navigate(target); } catch (_) { /* misma página */ } } return; }
    }
    await self.clients.openWindow(target);
  })());
});

// Avisos con la app cerrada (opcional): solo llegan si se desplegó «brujula-push»
// (docs/AVISOS_PUSH.md). El contenido viene cifrado de extremo a extremo.
const safeUrl = (u) => (typeof u === 'string' && /^\.\/index\.html#\/[\w\-\/%.]*$/.test(u) ? u : './index.html#/hoy');
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = {}; }
  const title = String(data.title || 'Brújula').slice(0, 120);
  event.waitUntil(self.registration.showNotification(title, {
    body: String(data.body || 'Tienes una actividad próxima.').slice(0, 240), tag: String(data.tag || 'brujula-push').slice(0, 100),
    icon: './icons/icon-192.png', badge: './icons/badge-96.png', data: { url: safeUrl(data.url) },
  }));
});
// Si el navegador renueva la suscripción, se crea otra con la misma clave; la app la
// registra en el servidor la próxima vez que se abra (el service worker no tiene sesión).
self.addEventListener('pushsubscriptionchange', (event) => {
  const options = event.oldSubscription?.options;
  if (!options?.applicationServerKey) return;
  event.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: options.applicationServerKey }).catch(() => null));
});
