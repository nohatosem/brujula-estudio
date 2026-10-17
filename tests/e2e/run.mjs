// Pruebas de punta a punta de Brújula 4 (Playwright + Supabase simulado + supabase-js real).
// Uso: node tests/e2e/run.mjs [filtro]
import { startServer, createMock, launchBrowser, openApp, login, sleep } from './harness.mjs';
import { demoState } from '../fixtures/demo.js';
import { legacyState } from '../fixtures/legacy39.js';
import { newBlock } from '../../js/core/model.js';

const filter = process.argv[2] || '';
const server = await startServer();
const browser = await launchBrowser();
const results = [];
const T0 = '2026-10-17T15:00:00Z';
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); };
const S = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.brujula.store.state)));
const cloudStatus = (page) => page.evaluate(() => window.brujula.cloud.status);
const waitFor = async (fn, ms = 6000, label = 'condición') => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(120); } throw new Error('Tiempo agotado esperando: ' + label); };
const noWelcome = (uid) => ({ brujula_device_v4: { ['welcome4_' + uid]: true } });
let full = null; // Chromium completo, solo para las pruebas de notificaciones
const fullBrowser = async () => (full ??= await launchBrowser({ full: true }));
const notifs = (page) => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, data: n.data })));

async function test(name, fn) {
  if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return;
  const started = Date.now();
  const ctxs = [];
  const app = async (opts) => { const r = await openApp(opts?.browser || browser, { base: server.url, ...opts }); ctxs.push(r); return r; };
  try {
    await fn(app);
    const errs = ctxs.flatMap((c) => c.errors).filter((e) => !/Failed to load resource|net::ERR_|internetdisconnected/i.test(e));
    if (errs.length) throw new Error('Errores en la página: ' + errs.slice(0, 3).join(' | '));
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log('✔', name);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log('✘', name, '\n   ', e.message);
  } finally {
    for (const c of ctxs) await c.context.close().catch(() => {});
  }
}

// ——— Cuenta, aislamiento y migración ———

await test('acceso: contraseña incorrecta muestra error claro y no abre la app', async (app) => {
  const mock = createMock(); mock.db.addUser('ana@example.com');
  const { page } = await app({ mock });
  await page.goto(server.url + '/index.html');
  await page.waitForSelector('#authEmail');
  await page.fill('#authEmail', 'ana@example.com'); await page.fill('#authPassword', 'mala-clave');
  await page.click('.auth-card [type="submit"]');
  await waitFor(async () => (await page.textContent('#authMsg')).includes('incorrectos'), 6000, 'mensaje de error');
  assert(!(await page.$('#main')), 'no debe abrir la app');
});

await test('acceso: registro con confirmación por correo', async (app) => {
  const mock = createMock(); mock.db.autoConfirm = false;
  const { page } = await app({ mock });
  await page.goto(server.url + '/index.html');
  await page.click('[data-tab="signup"]');
  await page.fill('#authEmail', 'nuevo@example.com'); await page.fill('#authPassword', 'secreto123');
  await page.click('.auth-card [type="submit"]');
  await waitFor(async () => (await page.textContent('#authMsg')).includes('Revisa tu correo'), 6000, 'aviso de confirmación');
});

await test('aislamiento: cada cuenta ve solo su horario (también en el mismo navegador)', async (app) => {
  const mock = createMock();
  const a = mock.db.addUser('a@example.com'), b = mock.db.addUser('b@example.com');
  mock.db.setRow(a.id, demoState(), T0);
  const { page } = await app({ mock, storage: { ...noWelcome(a.id), brujula_device_v4: { ['welcome4_' + a.id]: true, ['welcome4_' + b.id]: true } } });
  await page.goto(server.url + '/index.html');
  await login(page, 'a@example.com');
  await waitFor(async () => (await S(page)).blocks.length > 20, 6000, 'datos de A');
  await page.evaluate(() => { location.hash = '#/ajustes'; });
  await page.click('[data-act="sign-out"]');
  await page.click('.sheet-card [data-ok]');
  await page.waitForSelector('#authEmail');
  assert(!(await page.content()).includes('Vectores: suma'), 'tras cerrar sesión no queda contenido de A en pantalla');
  await login(page, 'b@example.com');
  await sleep(800);
  const sb = await S(page);
  eq(sb.blocks.length, 0, 'B empieza vacío');
  assert(!(await page.content()).includes('Física I'), 'B no ve cursos de A');
  await page.click('[data-act="habit"]');
  await sleep(300);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  assert(keys.includes('brujula_user_v3_' + a.id) && keys.includes('brujula_user_v3_' + b.id), 'copias locales separadas por cuenta (claves de 3.9)');
  const bLocal = await page.evaluate((id) => localStorage.getItem('brujula_user_v3_' + id), b.id);
  assert(!bLocal.includes('Vectores'), 'la copia de B no contiene datos de A');
});

await test('migración 3.9 → 4.0: datos intactos, temas y evaluaciones nuevos, sin escribir en la nube hasta editar', async (app) => {
  const mock = createMock(); const u = mock.db.addUser('legacy@example.com');
  const legacy = legacyState();
  mock.db.setRow(u.id, legacy, T0);
  const { page } = await app({ mock, storage: noWelcome(u.id) });
  await page.goto(server.url + '/index.html');
  await login(page, 'legacy@example.com');
  await waitFor(async () => (await S(page)).blocks.length === legacy.blocks.length, 6000, 'copia de la nube cargada');
  const s = await S(page);
  eq(s.schema, 4, 'schema 4');
  eq(s.version, 2, 'version se mantiene en 2 (compatible con 3.9)');
  eq(s.topics.length, 6, 'temas inferidos');
  eq(s.evaluations.length, 1, 'examen detectado');
  for (const old of legacy.blocks) { const now = s.blocks.find((x) => x.id === old.id); for (const k of Object.keys(old)) eq(now[k], old[k], 'campo ' + k); }
  eq(s.journal, legacy.journal, 'diario intacto');
  eq(s.preferences.replanMode, 'mixed', 'modo elegido en 3.9 se respeta');
  await sleep(2500);
  assert(!mock.db.rows.get(u.id).payload.schema, 'la migración sola no reescribe la nube');
  await page.click('[data-act="habit"]');
  await waitFor(() => mock.db.rows.get(u.id).payload.schema === 4, 8000, 'push tras editar');
  const row = mock.db.rows.get(u.id).payload;
  eq(row.version, 2, 'nube sigue en version 2');
  eq(row.blocks.length, legacy.blocks.length, 'mismas actividades en la nube');
});

await test('migración: si traías Mixto, te lo explica y eliges mantenerlo o volver a Preguntar', async (app) => {
  for (const choice of ['keep', 'confirm']) {
    const mock = createMock(); const u = mock.db.addUser('legacy@example.com');
    mock.db.setRow(u.id, legacyState(), T0);
    const { page, context } = await app({ mock });
    await page.goto(server.url + '/index.html');
    await login(page, 'legacy@example.com');
    await page.waitForSelector('dialog.sheet [data-mode-pick]', { timeout: 6000 });
    assert((await page.textContent('dialog.sheet')).includes('Sigues en modo Mixto'), 'explica el modo heredado');
    await page.click(`dialog.sheet [data-mode-pick="${choice}"]`);
    await waitFor(async () => { const p = (await S(page)).preferences; return choice === 'keep' ? !!p.replanConsentAt && p.replanMode === 'mixed' : p.replanMode === 'confirm'; }, 4000, 'elección guardada: ' + choice);
    await context.close();
  }
});

await test('dispositivo nuevo: carga la copia de la nube automáticamente (sin conflicto)', async (app) => {
  const mock = createMock(); const u = mock.db.addUser('n@example.com');
  mock.db.setRow(u.id, demoState(), T0);
  const { page } = await app({ mock, storage: noWelcome(u.id) });
  await page.goto(server.url + '/index.html');
  await login(page, 'n@example.com');
  await waitFor(async () => (await cloudStatus(page)) === 'synced', 6000, 'sincronizado');
  assert((await S(page)).blocks.length > 20, 'datos cargados');
  assert(!(await page.$('dialog.sheet')), 'sin hoja de conflicto');
});

await test('conflicto real: elegir la copia de la nube conserva una copia de este dispositivo', async (app) => {
  const mock = createMock(); const u = mock.db.addUser('c@example.com');
  const remote = demoState(); mock.db.setRow(u.id, remote, T0);
  const local = demoState(); local.savedAt = remote.savedAt + 5000; local.blocks = local.blocks.slice(0, 5);
  const { page } = await app({ mock, storage: { ...noWelcome(u.id), ['brujula_user_v3_' + u.id]: local, ['brujula_last_synced_v3_' + u.id]: '2026-10-10T00:00:00+00:00' } });
  await page.goto(server.url + '/index.html');
  await login(page, 'c@example.com');
  await page.waitForSelector('dialog.sheet [data-cloud]', { timeout: 8000 });
  eq(await cloudStatus(page), 'conflict', 'estado de conflicto');
  await page.click('dialog.sheet [data-cloud]');
  await waitFor(async () => (await S(page)).blocks.length === remote.blocks.length, 6000, 'copia de la nube aplicada');
  const backup = await page.evaluate((id) => JSON.parse(localStorage.getItem('brujula_conflict_backup_v4_' + id)), u.id);
  eq(backup.payload.blocks.length, 5, 'copia de seguridad del dispositivo');
});

await test('otro dispositivo cambió la nube: se aplica solo si aquí no hay cambios', async (app) => {
  const mock = createMock(); const u = mock.db.addUser('d@example.com');
  mock.db.setRow(u.id, demoState(), T0);
  const { page } = await app({ mock, storage: noWelcome(u.id) });
  await page.goto(server.url + '/index.html');
  await login(page, 'd@example.com');
  await waitFor(async () => (await cloudStatus(page)) === 'synced', 6000, 'sincronizado');
  const other = demoState(); other.savedAt += 99999; other.blocks.push({ ...other.blocks[0], id: 'desde-otro', title: 'Creada en el celular', date: '2026-10-18', start: '20:00', end: '20:30', kind: 'personal' });
  mock.db.setRow(u.id, other, '2026-10-17T16:00:00Z');
  await page.evaluate(() => window.brujula.sync.checkRemote());
  await waitFor(async () => (await S(page)).blocks.some((b) => b.id === 'desde-otro'), 6000, 'cambio remoto aplicado');
});

await test('escritura condicional: si otro dispositivo escribió, no se sobrescribe en silencio', async (app) => {
  const mock = createMock(); const u = mock.db.addUser('e@example.com');
  mock.db.setRow(u.id, demoState(), T0);
  const { page } = await app({ mock, storage: noWelcome(u.id) });
  await page.goto(server.url + '/index.html');
  await login(page, 'e@example.com');
  await waitFor(async () => (await cloudStatus(page)) === 'synced', 6000, 'sincronizado');
  const other = demoState(); other.savedAt += 777; mock.db.setRow(u.id, other, '2026-10-17T16:30:00Z');
  await page.click('[data-act="habit"]');
  await waitFor(async () => (await cloudStatus(page)) === 'conflict', 8000, 'conflicto detectado');
  eq(mock.db.rows.get(u.id).payload.savedAt, other.savedAt, 'la nube conserva lo del otro dispositivo');
});

await test('sin conexión: guarda local y sincroniza al volver internet', async (app) => {
  const mock = createMock(); const u = mock.db.addUser('f@example.com');
  mock.db.setRow(u.id, demoState(), T0);
  const { page, context } = await app({ mock, storage: noWelcome(u.id) });
  await page.goto(server.url + '/index.html');
  await login(page, 'f@example.com');
  await waitFor(async () => (await cloudStatus(page)) === 'synced', 6000, 'sincronizado');
  mock.db.offline = true; await context.setOffline(true);
  await page.click('[data-act="habit"]');
  await waitFor(async () => ['offline', 'error'].includes(await cloudStatus(page)), 8000, 'estado sin conexión');
  const localHabit = (await S(page)).habits['2026-10-17'];
  mock.db.offline = false; await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitFor(async () => (await cloudStatus(page)) === 'synced', 8000, 'sincronizado de nuevo');
  eq(mock.db.rows.get(u.id).payload.habits['2026-10-17'], localHabit, 'la nube recibió el cambio hecho sin conexión');
});

// ——— Modos de reprogramación ———

async function demoLogin(app, prefs = {}, opts = {}) {
  const mock = createMock(); const u = mock.db.addUser('m@example.com');
  const s = demoState(); s.preferences = { ...s.preferences, ...prefs };
  mock.db.setRow(u.id, s, T0);
  const r = await app({ mock, storage: noWelcome(u.id), ...opts });
  await r.page.goto(server.url + '/index.html');
  await login(r.page, 'm@example.com');
  await waitFor(async () => (await cloudStatus(r.page)) === 'synced', 6000, 'sincronizado');
  return { ...r, mock, u };
}
const blockBy = async (page, title) => (await S(page)).blocks.find((b) => b.title === title);

await test('nunca marca «no hecho» por la hora: lo pasado espera tu decisión', async (app) => {
  const { page } = await demoLogin(app);
  const b = await blockBy(page, 'Límites: ejercicios');
  eq(b.status, 'scheduled', 'sigue programada aunque ya pasó');
  assert(await page.$(`.decide-item [data-id="${b.id}"][data-status="missed"]`), 'se pregunta con «No hice»');
});

await test('modo Preguntar: «No hice» propone horario y Deshacer lo revierte', async (app) => {
  const { page } = await demoLogin(app);
  const b = await blockBy(page, 'Límites: ejercicios');
  await page.click(`.decide-item [data-id="${b.id}"][data-status="missed"]`);
  await page.waitForSelector('dialog.sheet [data-ok]');
  const moved0 = await blockBy(page, 'Límites: ejercicios');
  eq([moved0.date, moved0.status], ['2026-10-16', 'missed'], 'antes de aceptar no se mueve nada');
  await page.click('dialog.sheet [data-ok]');
  await waitFor(async () => (await blockBy(page, 'Límites: ejercicios')).date >= '2026-10-17', 5000, 'movida');
  const moved = await blockBy(page, 'Límites: ejercicios');
  eq(moved.status, 'scheduled', 'reprogramada');
  assert(moved.start >= '07:00' && moved.end <= '23:00' && !(moved.start < '14:00' && moved.end > '13:00'), 'respeta sueño y almuerzo');
  await page.click('.toast button');
  await waitFor(async () => (await blockBy(page, 'Límites: ejercicios')).date === '2026-10-16', 5000, 'deshecho');
});

await test('modo Mixto: pide consentimiento; mueve sola la tarea personal y pregunta por el estudio', async (app) => {
  const { page } = await demoLogin(app);
  await page.evaluate(() => { location.hash = '#/semana'; }); await sleep(300);
  await page.click('[data-act="mode"][data-mode="mixed"]');
  await page.waitForSelector('dialog.sheet [data-ok]');
  eq((await S(page)).preferences.replanMode, 'confirm', 'sin aceptar no cambia');
  await page.click('dialog.sheet [data-ok]');
  await waitFor(async () => (await S(page)).preferences.replanMode === 'mixed', 4000, 'modo mixto');
  await page.evaluate(() => { location.hash = '#/hoy'; }); await sleep(300);
  const p = await blockBy(page, 'Ordenar el cuarto');
  await page.click(`.decide-item [data-id="${p.id}"][data-status="missed"]`);
  await waitFor(async () => (await blockBy(page, 'Ordenar el cuarto')).date >= '2026-10-17', 5000, 'personal movida sola');
  assert(!(await page.$('dialog.sheet')), 'sin preguntar para lo personal');
  const st = await blockBy(page, 'Límites: ejercicios');
  await page.click(`.decide-item [data-id="${st.id}"][data-status="missed"]`);
  await page.waitForSelector('dialog.sheet [data-ok]');
  eq((await blockBy(page, 'Límites: ejercicios')).date, '2026-10-16', 'el estudio espera confirmación');
});

await test('modo Automático: mueve estudio flexible y crea repaso espaciado; clases protegidas', async (app) => {
  const { page } = await demoLogin(app, { replanMode: 'flex', replanConsentAt: '2026-10-01T00:00:00Z' });
  const st = await blockBy(page, 'Límites: ejercicios');
  await page.click(`.decide-item [data-id="${st.id}"][data-status="missed"]`);
  await waitFor(async () => (await blockBy(page, 'Límites: ejercicios')).date >= '2026-10-17', 5000, 'estudio movido solo');
  const moved = await blockBy(page, 'Límites: ejercicios');
  const s1 = await S(page);
  const clash = s1.blocks.filter((x) => x.id !== moved.id && x.date === moved.date && x.start < moved.end && moved.start < x.end);
  eq(clash.length, 0, 'sin cruces');
  // Repasar → repaso automático al día siguiente
  const ord = await blockBy(page, 'Ordenar el cuarto');
  void ord;
  await page.evaluate(() => { location.hash = '#/semana/2026-10-17'; }); await sleep(300);
  const vec = await blockBy(page, 'Vectores: suma y componentes');
  await page.evaluate((id) => document.querySelector(`[data-act="open-block"][data-id="${id}"]`).click(), vec.id);
  await page.click('dialog.sheet [data-o="review"]');
  await waitFor(async () => (await S(page)).blocks.some((x) => x.sourceReviewId === vec.id), 5000, 'repaso creado');
  const rev = (await S(page)).blocks.find((x) => x.sourceReviewId === vec.id);
  assert(rev.date >= '2026-10-18', 'el repaso es otro día (espaciado)');
  eq(rev.end > rev.start, true, 'horas válidas');
  const topic = (await S(page)).topics.find((t) => t.id === vec.topicId);
  eq(topic.level, 'review', 'el tema queda para repasar');
  // Clase protegida: el detalle no ofrece mover ni «no hice»
  const cls = (await S(page)).blocks.find((x) => x.kind === 'class' && x.date === '2026-10-19');
  await page.evaluate(() => { location.hash = '#/semana/2026-10-19'; }); await sleep(300);
  await page.evaluate(() => { const el = document.querySelector('.day-btn[data-date="2026-10-19"]'); el && el.click(); }); await sleep(250);
  await page.evaluate((id) => document.querySelector(`[data-act="open-block"][data-id="${id}"]`).click(), cls.id);
  await page.waitForSelector('dialog.sheet');
  assert(!(await page.$('dialog.sheet [data-move]')) && !(await page.$('dialog.sheet [data-o]')), 'clase sin mover ni resultado');
});

// ——— Alta rápida, planes y sesión ———

await test('alta rápida: entiende español y un examen crea su evaluación', async (app) => {
  const { page } = await demoLogin(app);
  await page.click('.tab-add');
  await page.fill('#qaText', 'Examen de Cálculo I el 28/10 a las 9');
  await sleep(200);
  await page.click('dialog.sheet [data-save]');
  await sleep(300);
  if (await page.$('dialog.sheet [data-ok]')) { assert((await page.textContent('dialog.sheet:last-of-type')).includes('Se cruza'), 'avisa del cruce con la clase'); await page.click('dialog.sheet:last-of-type [data-ok]'); }
  await waitFor(async () => (await S(page)).blocks.some((b) => b.kind === 'exam' && b.date === '2026-10-28'), 4000, 'examen creado');
  const s = await S(page);
  const ex = s.blocks.find((b) => b.kind === 'exam' && b.date === '2026-10-28');
  eq([ex.start, ex.end, ex.courseId], ['09:00', '11:00', 'cal'], 'hora y curso');
  assert(s.evaluations.some((e) => e.blockId === ex.id), 'evaluación vinculada');
});

await test('plan de examen: sesiones antes de la fecha, sin cruces, con aprobación', async (app) => {
  const { page } = await demoLogin(app);
  await page.evaluate(() => { location.hash = '#/estudio/evaluaciones'; }); await sleep(300);
  await page.click('[data-act="open-eval"][data-id="ev-fis"]');
  await page.click('dialog.sheet [data-plan]');
  await page.waitForSelector('dialog.sheet [data-apply]');
  const before = (await S(page)).blocks.length;
  await page.click('dialog.sheet [data-apply]');
  await waitFor(async () => (await S(page)).blocks.length > before, 4000, 'plan aplicado');
  const s = await S(page);
  const plan = s.blocks.filter((b) => b.origin === 'exam-plan');
  assert(plan.length >= 2, 'varias sesiones');
  for (const b of plan) {
    assert(b.date < '2026-10-20', 'antes del examen');
    assert(!s.blocks.some((x) => x.id !== b.id && x.date === b.date && x.start < b.end && b.start < x.end), 'sin cruces: ' + b.title);
  }
});

await test('plan semanal: reparte prioridades sin cruces, respeta el descanso y se puede deshacer', async (app) => {
  const { page } = await demoLogin(app);
  await page.evaluate(() => { location.hash = '#/semana'; }); await sleep(300);
  await page.click('[data-act="plan-week"]');
  await page.waitForSelector('dialog.sheet [data-apply]');
  const before = (await S(page)).blocks.length;
  await page.click('dialog.sheet [data-apply]');
  await waitFor(async () => (await S(page)).blocks.length > before, 4000, 'plan aplicado');
  const s = await S(page);
  const plan = s.blocks.filter((b) => b.origin === 'week-plan');
  assert(plan.length >= 3, 'varias sesiones: ' + plan.length);
  const p = s.preferences;
  for (const b of plan) {
    assert(!('why' in b), 'no guarda datos temporales');
    assert(b.date >= '2026-10-17' && b.date <= '2026-10-23', 'dentro de la semana');
    assert(b.start >= p.wake && b.end <= p.sleep, 'respeta el sueño: ' + b.start);
    assert(!(b.start < p.lunchEnd && p.lunchStart < b.end), 'respeta el almuerzo: ' + b.start);
    assert(!s.blocks.some((x) => x.id !== b.id && x.status !== 'missed' && x.date === b.date && x.start < b.end && b.start < x.end), 'sin cruces: ' + b.title);
    assert(b.topicId && s.topics.some((t) => t.id === b.topicId), 'ligada a un tema');
  }
  await page.click('.toast button');
  await waitFor(async () => (await S(page)).blocks.filter((b) => b.origin === 'week-plan').length === 0, 4000, 'deshecho');
});

await test('celular: ninguna pantalla se desplaza en horizontal (320–390 px)', async (app) => {
  const { page } = await demoLogin(app);
  const bad = [];
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 760 });
    for (const r of ['#/hoy', '#/semana', '#/estudio', '#/estudio/temas', '#/estudio/evaluaciones', '#/estudio/repasos', '#/curso/fis', '#/tema/t-001', '#/progreso', '#/habitos', '#/ajustes']) {
      await page.evaluate((h) => { location.hash = h; }, r); await sleep(250);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (sw > 0) bad.push(`${width}px ${r} (+${sw}px)`);
    }
  }
  eq(bad, [], 'desplazamiento horizontal');
});

await test('sesión guiada: «No lo entendí» actualiza el tema, anota la dificultad y propone repaso', async (app) => {
  const { page } = await demoLogin(app);
  const vec = await blockBy(page, 'Vectores: suma y componentes');
  await page.evaluate((id) => { location.hash = '#/sesion/' + id; }, vec.id); await sleep(400);
  for (let i = 0; i < 4; i++) { await page.click('[data-act="stage-next"]'); await sleep(120); }
  await page.click('[data-act="pick-outcome"][data-o="review"]'); await sleep(150);
  await page.click('label:has(input[name="dk"][value="formula"]) span');
  assert(await page.isChecked('input[name="dk"][value="formula"]'), 'chip de dificultad marcado');
  await page.click('[data-act="finish-session"]');
  await page.waitForSelector('dialog.sheet [data-ok]');
  await page.click('dialog.sheet [data-ok]');
  await waitFor(async () => (await S(page)).blocks.some((x) => x.sourceReviewId === vec.id), 5000, 'repaso programado');
  const s = await S(page);
  const t = s.topics.find((x) => x.id === vec.topicId);
  eq(t.level, 'review', 'tema por repasar');
  eq(t.srs.due, '2026-10-18', 'repaso mañana');
  assert(s.difficulties.some((d) => d.kind === 'formula' && d.blockId === vec.id), 'dificultad registrada');
});

// ——— Asistente ———

await test('asistente local: responde sin gastar cuota', async (app) => {
  const { page, mock } = await demoLogin(app);
  await page.click('.topbar [data-act="assistant"]');
  await page.click('[data-sug="0"]');
  await waitFor(async () => (await page.textContent('#asFeed')).includes('Ahora:'), 4000, 'respuesta local');
  eq(mock.db.lastAI, undefined, 'no llamó a Gemini');
});

await test('Gemini: consentimiento, análisis y propuesta validada con aprobación', async (app) => {
  const { page, mock } = await demoLogin(app);
  mock.db.ai = async (body) => ({ json: { analysis: { summary: 'Tu parcial de Física está cerca y MRU sigue débil.', insights: [{ type: 'risk', title: 'Parcial en 3 días', detail: 'Preparación 41%.' }], changes: [
    { action: 'add', course: 'Física I', date: '2026-10-18', start: '12:00', end: '12:25', title: 'Repaso: MRU', goal: 'Resolver 2 problemas', kind: 'study', priority: 'high', difficulty: 3, reason: 'Repaso vencido' },
    { action: 'add', course: 'Física I', date: '2026-10-18', start: '23:30', end: '23:55', title: 'Muy tarde', goal: '', kind: 'study', priority: 'normal', difficulty: 3 },
  ], question: null }, remaining: 14, model: 'gemini-3.5-flash-lite' } });
  await page.click('.topbar [data-act="assistant"]');
  await page.click('[data-sug="1"]');
  await page.waitForSelector('#asFeed .msg.bot .actions button');
  eq(mock.db.lastAI, undefined, 'sin permiso no se envía nada');
  await page.click('#asFeed .msg.bot:last-child .actions button.btn-primary');
  await page.waitForSelector('text=Permitir enviar mi horario');
  await page.click('text=Permitir enviar mi horario');
  await waitFor(async () => (await page.textContent('#asFeed')).includes('Revisar 1 cambio'), 6000, 'propuesta');
  const sent = JSON.stringify(mock.db.lastAI);
  assert(mock.db.lastAI.mode === 'analyze' && mock.db.lastAI.consent === true && mock.db.lastAI.context, 'cuerpo de análisis');
  assert(!sent.includes('Resolví 3 ejercicios') && !sent.includes('Caminar con mi hermana'), 'no envía el diario');
  await page.click('text=Revisar 1 cambio');
  await page.waitForSelector('dialog.sheet [data-apply]');
  assert((await page.textContent('dialog.sheet')).includes('descartado'), 'muestra el cambio descartado');
  await page.click('dialog.sheet [data-apply]');
  await waitFor(async () => (await S(page)).blocks.some((b) => b.title === 'Repaso: MRU' && b.date === '2026-10-18'), 4000, 'cambio aplicado');
  assert(!(await S(page)).blocks.some((b) => b.title === 'Muy tarde'), 'el cambio inseguro nunca se aplica');
});

await test('Gemini sin desplegar o sin clave: mensaje claro y la app sigue funcionando', async (app) => {
  const { page, mock } = await demoLogin(app, { aiConsent: true, aiShareSchedule: true });
  mock.db.ai = null;
  await page.click('.topbar [data-act="assistant"]');
  await page.fill('#asText', '¿Qué es un vector unitario?');
  await page.click('#asForm .send');
  await waitFor(async () => (await page.textContent('#asFeed')).includes('GEMINI_API_KEY'), 6000, 'error claro');
});

await test('propuesta JSON de ChatGPT: se verifica y se aplica solo lo aprobado', async (app) => {
  const { page } = await demoLogin(app);
  await page.evaluate(() => { location.hash = '#/ajustes'; }); await sleep(300);
  await page.click('[data-act="chatgpt-import"]');
  await page.fill('#jsonIn', JSON.stringify({ version: 1, changes: [{ action: 'add', course: 'Redes y Cisco', date: '2026-10-21', start: '18:00', end: '19:00', title: 'Subredes: práctica', kind: 'study', priority: 'normal', difficulty: 3 }] }));
  await page.click('dialog.sheet [data-ok]');
  await page.waitForSelector('dialog.sheet [data-apply]');
  await page.click('dialog.sheet [data-apply]');
  await waitFor(async () => (await S(page)).blocks.some((b) => b.title === 'Subredes: práctica'), 4000, 'importado');
});

// ——— Avisos ———

const avisoState = (prefs = {}) => {
  const s = demoState();
  s.preferences = { ...s.preferences, reminderLead: 10, ...prefs };
  s.blocks.push(newBlock({ id: 'b-aviso', date: '2026-10-17', start: '10:40', end: '11:20', courseId: 'fis', title: 'Repaso con aviso', kind: 'study', notes: 'SECRETO-NOTA' }));
  s.journal['2026-10-17'] = { win: 'SECRETO-DIARIO' };
  return s;
};
async function deliverPush(context, page, data) {
  const cdp = await context.newCDPSession(page);
  const regs = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => regs.push(...e.registrations));
  await cdp.send('ServiceWorker.enable');
  await waitFor(async () => regs.some((r) => !r.isDeleted), 3000, 'registro del service worker');
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: server.url, registrationId: regs.find((r) => !r.isDeleted).registrationId, data: JSON.stringify(data) });
}
// PushManager real no funciona sin servicio de push en las pruebas: se simula SOLO la suscripción.
const fakePushManager = () => {
  let current = null;
  PushManager.prototype.getSubscription = async () => current;
  PushManager.prototype.subscribe = async (opts) => {
    const k = opts.applicationServerKey;
    current = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-device', options: { userVisibleOnly: true, applicationServerKey: k instanceof ArrayBuffer ? k : k.buffer.slice(k.byteOffset, k.byteOffset + k.byteLength) },
      toJSON() { return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) } }; },
      unsubscribe: async () => { current = null; return true; },
    };
    return current;
  };
};

await test('avisos locales: llegan por el service worker antes de la actividad, sin duplicarse', async (app) => {
  const mock = createMock(); const u = mock.db.addUser('m@example.com');
  mock.db.setRow(u.id, avisoState({ reminders: true }), T0);
  const { page } = await app({ browser: await fullBrowser(), mock, storage: noWelcome(u.id), serviceWorkers: 'allow', permissions: ['notifications'] });
  await page.goto(server.url + '/index.html'); await login(page, 'm@example.com');
  await waitFor(async () => (await notifs(page)).some((n) => n.title === '10:40 · Repaso con aviso'), 8000, 'aviso local 10 min antes');
  const n = (await notifs(page)).find((x) => x.title === '10:40 · Repaso con aviso');
  eq([n.body, n.data.url], ['Física I · empieza en 10 min.', './index.html#/sesion/b-aviso'], 'contenido del aviso');
  await page.evaluate(async () => (await import('/js/features/reminders.js')).reschedule()); await sleep(600);
  eq((await notifs(page)).filter((x) => x.tag === n.tag).length, 1, 'no se repite al reprogramar');
});

await test('avisos con la app cerrada (beta): activar, enviar solo la cola mínima, recibir y no duplicar', async (app) => {
  const mock = createMock(); const u = mock.db.addUser('m@example.com');
  mock.db.setRow(u.id, avisoState({ reminders: false }), T0);
  const srv = { subs: [], queue: null, lastRunAt: '2026-10-17T15:29:30Z' };
  mock.db.push = (body) => {
    if (body.action === 'config') return { json: { enabled: true, publicKey: 'B' + 'Q'.repeat(86), lastRunAt: srv.lastRunAt } };
    if (body.action === 'subscribe') { srv.subs = [body.subscription]; return { json: { ok: true, devices: 1, test: { ok: true, status: 201 } } }; }
    if (body.action === 'sync') { srv.queue = body.items; return { json: { ok: true, queued: body.items.length, devices: srv.subs.length } }; }
    if (body.action === 'test') return { json: { ok: true, devices: 1, sent: 1 } };
    if (body.action === 'unsubscribe') { srv.subs = []; return { json: { ok: true, devices: 0 } }; }
    return { status: 400, json: { error: 'acción' } };
  };
  const { page, context } = await app({ browser: await fullBrowser(), mock, storage: noWelcome(u.id), serviceWorkers: 'allow', permissions: ['notifications'] });
  await context.addInitScript(fakePushManager);
  await page.goto(server.url + '/index.html'); await login(page, 'm@example.com');
  await waitFor(async () => (await cloudStatus(page)) === 'synced', 6000, 'sincronizado');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate(() => { location.hash = '#/ajustes/avisos'; });
  await waitFor(async () => (await page.textContent('#avisos')).includes('Llegan aunque cierres Brújula'), 6000, 'servidor listo');
  await page.click('#avisos label:has(input[data-change="push"])');
  await waitFor(async () => srv.queue?.length > 0, 8000, 'cola enviada');
  const sub = mock.db.pushCalls.find((c) => c.body.action === 'subscribe').body;
  assert(sub.subscription.endpoint.startsWith('https://fcm.googleapis.com/') && sub.test === true && /·/.test(sub.device), 'suscripción con dispositivo y prueba');
  const item = srv.queue.find((i) => i.title === '10:40 · Repaso con aviso');
  assert(item, 'incluye la actividad de las 10:40');
  eq([item.fire_at, item.expire_at, item.url], ['2026-10-17T15:30:00.000Z', '2026-10-17T15:45:00.000Z', './index.html#/sesion/b-aviso'], 'horas en UTC y enlace');
  assert(/^b-[a-z0-9]+$/.test(item.tag), 'etiqueta sin datos legibles');
  const raw = JSON.stringify(srv.queue);
  assert(!raw.includes('SECRETO'), 'nunca envía notas ni diario');
  assert(srv.queue.length <= 60 && srv.queue.every((i) => Date.parse(i.fire_at) <= Date.parse('2026-10-24T15:30:00Z') && Object.keys(i).sort().join() === 'body,expire_at,fire_at,tag,title,url'), 'solo 7 días y campos mínimos');
  assert((await S(page)).preferences.pushEnabled === true, 'queda activado en la cuenta');
  await waitFor(async () => (await page.textContent('#avisos')).includes('Activo en este dispositivo'), 4000, 'estado activo');
  // Con el servidor sano, el aviso local no se duplica…
  await page.click('#avisos label:has(input[data-change="reminders"])');
  await waitFor(async () => (await S(page)).preferences.reminders === true, 4000, 'avisos locales activos');
  await sleep(1200);
  eq((await notifs(page)).filter((n) => n.tag === item.tag).length, 0, 'el aviso local cede al del servidor');
  // …y el push que envía el servidor se muestra una vez, con enlace interno.
  await deliverPush(context, page, { title: item.title, body: item.body, tag: item.tag, url: item.url });
  await waitFor(async () => (await notifs(page)).some((n) => n.tag === item.tag), 5000, 'push mostrado por el service worker');
  eq((await notifs(page)).filter((n) => n.tag === item.tag).map((n) => n.data.url), [item.url], 'un solo aviso');
  await deliverPush(context, page, { title: 'Falso', body: 'x', tag: 'phish', url: 'https://phish.example/login' });
  await waitFor(async () => (await notifs(page)).some((n) => n.tag === 'phish'), 5000, 'push externo');
  eq((await notifs(page)).find((n) => n.tag === 'phish').data.url, './index.html#/hoy', 'enlaces externos se neutralizan');
  // Si el envío programado deja de responder, vuelven los avisos locales.
  await page.evaluate(async () => { for (const n of await (await navigator.serviceWorker.ready).getNotifications()) n.close(); });
  srv.lastRunAt = '2026-10-17T15:00:00Z';
  await page.evaluate(async () => { await (await import('/js/features/push.js')).checkPush({ force: true }); (await import('/js/features/reminders.js')).reschedule(); });
  await waitFor(async () => (await notifs(page)).some((n) => n.tag === item.tag), 6000, 'aviso local de respaldo');
  await waitFor(async () => (await page.textContent('#avisos')).includes('no responde'), 4000, 'aviso de cron caído');
  // Prueba y baja.
  await page.click('[data-act="push-test"]');
  await waitFor(async () => mock.db.pushCalls.some((c) => c.body.action === 'test'), 4000, 'aviso de prueba');
  await page.click('#avisos label:has(input[data-change="push"])');
  await waitFor(async () => (await S(page)).preferences.pushEnabled === false, 5000, 'desactivado en la cuenta');
  eq(srv.subs.length, 0, 'baja en el servidor');
});

await test('avisos con la app cerrada sin servidor: lo explica y no rompe nada', async (app) => {
  const { page, mock } = await demoLogin(app);
  await page.evaluate(() => { location.hash = '#/ajustes/avisos'; });
  await waitFor(async () => (await page.textContent('#avisos')).includes('no está desplegado'), 6000, 'mensaje claro');
  assert(await page.$eval('#avisos input[data-change="push"]', (el) => el.disabled), 'interruptor desactivado');
  eq(mock.db.pushCalls.map((c) => c.body.action), ['config'], 'solo consulta la configuración');
});

// ——— PWA y accesibilidad ———

await test('PWA: service worker guarda la app y abre sin conexión con tus datos locales', async (app) => {
  const { page, mock, context } = await demoLogin(app, {}, { serviceWorkers: 'allow' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await waitFor(async () => (await page.evaluate(async () => { const k = await caches.keys(); if (!k.includes('brujula-app-v4.0.0')) return 0; return (await (await caches.open('brujula-app-v4.0.0')).keys()).length; })) > 40, 15000, 'precaché');
  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  assert(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable') && manifest.start_url === './index.html', 'manifest instalable');
  await page.evaluate(() => window.brujula.sync.flush());
  mock.db.offline = true; await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('#main', { timeout: 15000 });
  assert((await page.textContent('#main')).includes('Vectores'), 'muestra el horario guardado sin conexión');
});

await test('accesibilidad: controles con nombre, idioma y foco visible en todas las pantallas', async (app) => {
  const { page } = await demoLogin(app);
  eq(await page.getAttribute('html', 'lang'), 'es-PE', 'idioma');
  const routes = ['#/hoy', '#/semana', '#/estudio', '#/estudio/temas', '#/estudio/evaluaciones', '#/estudio/repasos', '#/curso/fis', '#/progreso', '#/habitos', '#/ajustes'];
  const problems = [];
  for (const r of routes) {
    await page.evaluate((h) => { location.hash = h; }, r); await sleep(350);
    const bad = await page.evaluate(() => [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')].filter((el) => el.offsetParent !== null).filter((el) => {
      const lab = el.getAttribute('aria-label') || el.getAttribute('title') || (el.labels && el.labels[0] && el.labels[0].textContent.trim()) || (el.closest('label') && el.closest('label').textContent.trim()) || el.textContent.trim() || el.getAttribute('placeholder');
      return !lab;
    }).map((el) => el.outerHTML.slice(0, 120)));
    if (bad.length) problems.push(r + ': ' + bad.slice(0, 3).join(' · '));
  }
  eq(problems, [], 'controles sin nombre accesible');
  // Foco visible con teclado: cada control alcanzado con Tab muestra un contorno de al menos 2 px.
  await page.evaluate(() => { location.hash = '#/hoy'; }); await sleep(350);
  await page.mouse.click(5, 5);
  const noOutline = [], reached = new Set();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => { const el = document.activeElement; if (!el || el === document.body) return null; const cs = getComputedStyle(el); return { tag: el.tagName, label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30), ok: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 }; });
    if (f) reached.add(f.tag + ' ' + f.label);
    if (f && !f.ok) noOutline.push(f.tag + ' ' + f.label);
  }
  assert(reached.size >= 5, 'Tab recorre los controles: ' + [...reached].join(' | '));
  eq(noOutline, [], 'foco visible');
});

await browser.close();
if (full) await full.close();
await server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pruebas E2E correctas`);
if (failed.length) process.exit(1);
