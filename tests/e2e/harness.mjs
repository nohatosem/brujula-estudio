// Banco de pruebas E2E: servidor estático + Supabase simulado (Auth, PostgREST y Functions)
// interceptado con Playwright. Usa supabase-js REAL (compilado desde su código fuente) para
// que las llamadas de la app sean las mismas que en producción.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const ROOT = new URL('../..', import.meta.url).pathname;
export const SUPABASE_URL = 'https://qqnawpbcaxooytizhsfq.supabase.co';
// supabase-js: si hay una copia local (SUPABASE_JS_BUNDLE) se sirve esa; si no, se descarga del CDN real.
const SUPABASE_BUNDLE = process.env.SUPABASE_JS_BUNDLE || '/home/claude/testkit/supabase-test-build.js';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

export function startServer(root = ROOT, port = 0) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = normalize(join(root, p));
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      const s = await stat(file).catch(() => null);
      if (!s || !s.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404'); return; }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(await readFile(file));
    } catch (e) { res.writeHead(500).end(String(e)); }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));
}

const norm = (t) => new Date(t).toISOString().replace('Z', '+00:00');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (sub, role = 'authenticated') => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role, exp: Math.floor(Date.now() / 1000) + 3600 })}.firma`;

export function createMock() {
  const db = {
    users: new Map(), // email -> {id, email, password, confirmed}
    tokens: new Map(), // access_token -> user id
    refresh: new Map(),
    rows: new Map(), // user_id -> {payload, updated_at}
    requests: [],
    log: [],
    ai: null, // (body) => ({status, json})
    push: null, // (body, uid) => ({status, json}); null = función «brujula-push» no desplegada (404)
    pushCalls: [],
    offline: false,
    autoConfirm: true,
    foreignRowsVisible: false,
  };
  let n = 0;
  const userJSON = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.confirmed ? '2026-10-01T00:00:00Z' : null, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' });
  const session = (u) => {
    const access = fakeJwt(u.id) + '.' + (n++);
    const refresh = 'r-' + u.id + '-' + (n++);
    db.tokens.set(access, u.id); db.refresh.set(refresh, u.id);
    return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user: userJSON(u) };
  };
  db.addUser = (email, password = 'secreto123', id = null) => { const u = { id: id || `00000000-0000-4000-8000-${String(db.users.size + 1).padStart(12, '0')}`, email, password, confirmed: true }; db.users.set(email, u); return u; };
  db.setRow = (uid, payload, updated_at = new Date().toISOString()) => db.rows.set(uid, { payload: JSON.parse(JSON.stringify(payload)), updated_at: norm(updated_at) });

  const json = (route, status, body, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'x-supabase-api-version': '2024-01-01', ...headers }, body: body === undefined ? '' : JSON.stringify(body) });

  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (db.offline) return route.abort('internetdisconnected');
    const body = (() => { try { return req.postDataJSON(); } catch (_) { return null; } })();
    const auth = req.headers()['authorization'] || '';
    const uid = db.tokens.get(auth.replace(/^Bearer\s+/i, '')) || null;
    db.log.push({ method, path: url.pathname, search: url.search, uid });
    const p = url.pathname;
    // ——— Auth ———
    if (p === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const u = db.users.get(String(body?.email || '').toLowerCase());
        if (!u || u.password !== body?.password) return json(route, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        if (!u.confirmed) return json(route, 400, { code: 'email_not_confirmed', error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
        return json(route, 200, session(u));
      }
      if (grant === 'refresh_token') {
        const id = db.refresh.get(body?.refresh_token);
        const u = [...db.users.values()].find((x) => x.id === id);
        if (!u) return json(route, 400, { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
        return json(route, 200, session(u));
      }
    }
    if (p === '/auth/v1/signup') {
      const email = String(body?.email || '').toLowerCase();
      if (db.users.has(email)) return json(route, 422, { code: 'user_already_exists', msg: 'User already registered' });
      const u = db.addUser(email, body?.password);
      u.confirmed = db.autoConfirm;
      return json(route, 200, db.autoConfirm ? session(u) : userJSON(u));
    }
    if (p === '/auth/v1/user') {
      const u = [...db.users.values()].find((x) => x.id === uid);
      if (!u) return json(route, 401, { code: 'bad_jwt', msg: 'invalid JWT' });
      if (method === 'PUT') { if (body?.password) u.password = body.password; return json(route, 200, userJSON(u)); }
      return json(route, 200, userJSON(u));
    }
    if (p === '/auth/v1/logout') { db.tokens.delete(auth.replace(/^Bearer\s+/i, '')); return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }); }
    if (p === '/auth/v1/recover') return json(route, 200, {});
    // ——— PostgREST ———
    if (p === '/rest/v1/brujula_user_state') {
      if (!uid) return json(route, 401, { code: '42501', message: 'permission denied' });
      const filters = [...url.searchParams.entries()].filter(([k]) => !['select', 'on_conflict', 'limit', 'order'].includes(k));
      const ownOnly = (rowUid) => rowUid === uid || db.foreignRowsVisible;
      const match = (rowUid, row) => filters.every(([k, v]) => {
        const [op, ...rest] = v.split('.'); const val = rest.join('.');
        const field = k === 'user_id' ? rowUid : row[k];
        if (op === 'eq') return k === 'updated_at' ? Date.parse(field) === Date.parse(val) : String(field) === val;
        if (op === 'neq') return String(field) !== val;
        return true;
      });
      const pickCols = (rowUid, row) => {
        const sel = (url.searchParams.get('select') || '*').split(',');
        const full = { user_id: rowUid, ...row };
        return sel.includes('*') ? full : Object.fromEntries(sel.map((c) => [c, full[c]]));
      };
      const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
      const respond = (list) => {
        if (wantsObject) { if (list.length !== 1) return json(route, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `Results contain ${list.length} rows` }); return json(route, 200, list[0]); }
        return json(route, 200, list);
      };
      if (method === 'GET') {
        const list = [...db.rows.entries()].filter(([u]) => ownOnly(u)).filter(([u, r]) => match(u, r)).map(([u, r]) => pickCols(u, r));
        return respond(list.slice(0, Number(url.searchParams.get('limit')) || 1000));
      }
      if (method === 'PATCH') {
        const hits = [...db.rows.entries()].filter(([u]) => u === uid).filter(([u, r]) => match(u, r));
        for (const [u, r] of hits) { if (body.payload !== undefined) r.payload = JSON.parse(JSON.stringify(body.payload)); r.updated_at = norm(body.updated_at || new Date()); }
        return respond(hits.map(([u, r]) => pickCols(u, r)));
      }
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        const upsert = (req.headers()['prefer'] || '').includes('merge-duplicates');
        const out = [];
        for (const r of rows) {
          if (r.user_id !== uid) return json(route, 403, { code: '42501', message: 'new row violates row-level security policy' });
          if (db.rows.has(uid) && !upsert) return json(route, 409, { code: '23505', message: 'duplicate key value violates unique constraint "brujula_user_state_pkey"' });
          db.rows.set(uid, { payload: JSON.parse(JSON.stringify(r.payload)), updated_at: norm(r.updated_at || new Date()) });
          out.push(pickCols(uid, db.rows.get(uid)));
        }
        return respond(out);
      }
    }
    if (p === '/rest/v1/brujula_assistant_requests') {
      if (!uid) return json(route, 401, { message: 'permission denied' });
      if (method === 'POST') { const r = { id: 'req-' + (n++), user_id: uid, schedule_snapshot: body.schedule_snapshot, proposal: null, status: 'pending', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600e3).toISOString() }; db.requests.push(r); return json(route, 201, { id: r.id, expires_at: r.expires_at }); }
      if (method === 'GET') { const list = db.requests.filter((r) => r.user_id === uid && r.status === 'proposed').map(({ id, proposal, status, expires_at }) => ({ id, proposal, status, expires_at })); return json(route, 200, list.slice(-1)); }
      if (method === 'PATCH') { const id = (url.searchParams.get('id') || '').replace('eq.', ''); const r = db.requests.find((x) => x.id === id && x.user_id === uid); if (r) Object.assign(r, body); return json(route, 200, r ? [r] : []); }
    }
    // ——— Edge Function ———
    if (p === '/functions/v1/brujula-ai') {
      if (!uid) return json(route, 401, { error: 'Inicia sesión en Brújula.' });
      db.lastAI = body;
      if (!db.ai) return json(route, 503, { error: 'Gemini todavía no está activado. El administrador debe guardar GEMINI_API_KEY en Supabase → Edge Function Secrets.' });
      const r = await db.ai(body);
      return json(route, r.status || 200, r.json);
    }
    if (p === '/functions/v1/brujula-push') {
      db.pushCalls.push({ uid, body });
      if (!db.push) return json(route, 404, { code: 'NOT_FOUND', message: 'Requested function was not found' });
      if (!uid) return json(route, 401, { error: 'Inicia sesión para usar los avisos.' });
      const r = await db.push(body, uid);
      return json(route, r.status || 200, r.json);
    }
    return json(route, 404, { message: 'mock: ruta no implementada ' + method + ' ' + p });
  }
  return { db, handle };
}

/** `full`: Chromium completo (headless nuevo), necesario para notificaciones y push. */
function playwright() {
  for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/npm-tools/node_modules/playwright'].filter(Boolean)) {
    try { return require(m); } catch (_) { /* siguiente */ }
  }
  throw new Error('Instala Playwright: npm i -D playwright && npx playwright install chromium');
}
export async function launchBrowser({ full = false } = {}) {
  return playwright().chromium.launch({ args: ['--no-sandbox'], ...(full ? { channel: 'chromium' } : {}) });
}

export async function launch(opts = {}) {
  const browser = opts.browser || await launchBrowser();
  const r = await openApp(browser, opts);
  return { ...r, browser: opts.browser ? { close: () => r.context.close() } : browser };
}

export async function openApp(browser, { mobile = true, dark = false, base, mock, time = '2026-10-17T10:30:00-05:00', storage = null, serviceWorkers = 'block', permissions = [] } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 860 },
    deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile,
    locale: 'es-PE', timezoneId: 'America/Lima', colorScheme: dark ? 'dark' : 'light',
    serviceWorkers,
    permissions,
  });
  const bundle = await readFile(SUPABASE_BUNDLE, 'utf8').catch(() => null);
  await context.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2**', (route) => (mock.db.offline ? route.abort('internetdisconnected') : bundle ? route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: bundle }) : route.continue()));
  await context.route(SUPABASE_URL + '/**', (route) => mock.handle(route));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (time) await page.clock.setFixedTime(new Date(time));
  if (storage) {
    // Siembra localStorage una sola vez, antes de que corra la app (simula un dispositivo con datos).
    await context.addInitScript((s) => {
      try { if (!localStorage.getItem('__seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); localStorage.setItem('__seeded', '1'); } } catch (_) { /* nada */ }
    }, storage);
  }
  return { context, page, errors };
}

export async function login(page, email, password = 'secreto123') {
  await page.waitForSelector('#authEmail', { timeout: 15000 });
  await page.fill('#authEmail', email);
  await page.fill('#authPassword', password);
  await page.click('.auth-card [type="submit"]');
  await page.waitForSelector('#main', { timeout: 15000 });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
