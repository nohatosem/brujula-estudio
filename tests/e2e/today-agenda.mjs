// App real + Chromium + supabase-js real; cuentas y servidor completamente simulados.
// BRUJULA_CHROMIUM_EXECUTABLE permite usar un navegador ya instalado.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer, createMock, launchBrowser, openApp, login } from './harness.mjs';
import { blankState, newBlock, APP_VERSION } from '../../js/core/model.js';
import { addDays } from '../../js/core/dates.js';
import { routineDefaults } from '../../js/engine/daily-routine.js';

const require = createRequire(import.meta.url);
const server = await startServer();
const browser = process.env.BRUJULA_CHROMIUM_EXECUTABLE
  ? await require(process.env.PLAYWRIGHT_MODULE || 'playwright').chromium.launch({
    executablePath:process.env.BRUJULA_CHROMIUM_EXECUTABLE,
    args:['--no-sandbox','--no-zygote','--disable-gpu'], headless:true,
  }) : await launchBrowser();
const output = process.env.BRUJULA_SCREENSHOTS || '/tmp/brujula-agenda-qa';
await mkdir(output, {recursive:true});
const mock = createMock();
const user = mock.db.addUser('agenda@example.com');
const state = blankState();
state.preferences.routineConfirmed = true;
state.courses.push({id:'fisica', name:'Física I', color:'#3F7CAC', difficulty:3, importance:4});
for (let i = 0; i < 7; i++) for (const t of routineDefaults(state).filter(t=>t.enabled)) {
  state.blocks.push(newBlock({id:t.id+'-'+i, title:t.title, date:addDays('2026-10-19',i),
    start:t.start, end:t.end, kind:'personal', courseId:'vida', origin:'daily-routine',
    semesterFixed:true, routineKey:t.id, ...(t.habitId ? {habitId:t.habitId} : {})}));
}
state.blocks.push(newBlock({id:'focus', title:'Física I: vectores y resolución de problemas',
  date:'2026-10-19', start:'10:00', end:'11:00', courseId:'fisica',
  goal:'Resolver tres problemas con vectores.'}));
const originalTimes = state.blocks.map(({id,date,start,end}) => ({id,date,start,end}));
mock.db.setRow(user.id, state, '2026-10-17T15:00:00Z');
const app = await openApp(browser, {mock, mobile:false, time:'2026-10-19T10:30:00-05:00',
  storage:{brujula_device_v4:{['welcome4_'+user.id]:true}}});
const {page,context} = app;
await page.emulateMedia({reducedMotion:'reduce'});
await context.route('https://fonts.googleapis.com/**', r => r.fulfill({status:200,contentType:'text/css',body:''}));
let checks = 0;
const pass = name => { checks++; console.log('✔',name); };
const wait = async fn => {
  for (let i = 0; i < 70; i++) { if (await fn()) return; await page.waitForTimeout(100); }
  throw Error('La condición de la prueba no llegó a cumplirse.');
};
const S = () => page.evaluate(() => JSON.parse(JSON.stringify(window.brujula.store.state)));
try {
  await page.goto(server.url+'/index.html', {waitUntil:'domcontentloaded'});
  await login(page,'agenda@example.com');
  await page.waitForFunction(() => window.brujula.store.state.blocks.some(b => b.id === 'focus'));
  await page.locator('.week-overview-day').first().waitFor();
  assert.equal(await page.locator('.week-overview-day').count(),7);
  const mainText = await page.locator('#main').innerText();
  for (const text of ['Qué hacer ahora','Hábitos de hoy','Prioridades','Sugerencia para tu tiempo disponible']) assert.ok(!mainText.includes(text),text);
  const focus = await page.locator('.rumbo').boundingBox();
  const pending = await page.locator('.today-pending').boundingBox();
  const week = await page.locator('.week-overview').boundingBox();
  assert.ok(focus.x < pending.x && Math.abs(focus.y-pending.y)<10, JSON.stringify({focus,pending}));
  assert.ok(week.y > pending.y && week.width > focus.width*1.5);
  await page.screenshot({path:join(output,'hoy-desktop.png'),fullPage:true});
  pass('Hoy: foco a la izquierda, pendientes a la derecha y semana amplia sin paneles duplicados');

  for (const width of [320,390,768]) {
    await page.setViewportSize({width,height:844});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1),'desbordamiento a '+width);
    const bad = await page.locator('.agenda-activity').evaluateAll(rows => rows.some(r => r.scrollWidth>r.clientWidth+1));
    assert.equal(bad,false,'actividad demasiado ancha a '+width);
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:join(output,'hoy-mobile.png'),fullPage:true});
  pass('Móvil y tableta: sin desplazamiento horizontal a 320, 390 y 768 px');

  await page.locator('.today-pending [data-act="complete-activity"][data-id="ejercicio-0"]').click();
  await wait(async() => (await S()).blocks.find(b=>b.id==='ejercicio-0').status==='mastered');
  assert.equal((await S()).habits['2026-10-19'].move,true);
  assert.equal(await page.locator('.week-overview [aria-label="Actividad hecha: Ejercicio de la mañana"]').count(),1);
  await page.locator('#toasts button').last().click();
  await wait(async() => (await S()).blocks.find(b=>b.id==='ejercicio-0').status==='scheduled');
  assert.equal((await S()).habits['2026-10-19'].move,false);
  pass('Check y Deshacer: resultado y hábito coherentes, sin mover horarios');

  const note='Traer cuaderno, lápiz y "tres ejercicios".\nRepasar las unidades.';
  await page.locator('.week-overview [data-act="activity-note"][data-id="focus"]').click();
  await page.locator('[data-note]').fill(note);
  await page.locator('[data-save-note]').click();
  await page.evaluate(()=>window.brujula.sync.flush());
  assert.equal(mock.db.rows.get(user.id).payload.blocks.find(b=>b.id==='focus').notes,note);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.week-overview-day').first().waitFor();
  assert.equal((await S()).blocks.find(b=>b.id==='focus').notes,note);
  assert.ok((await page.locator('.week-overview').innerText()).includes('Traer cuaderno'));
  pass('Notas: edición rápida, guardado y recuperación tras recargar');

  await page.locator('.week-overview [data-act="open-block"][data-id="focus"]').click();
  await page.locator('dialog [data-edit]').click();
  assert.equal(await page.locator('#blockForm [name="title"]').inputValue(),'Física I: vectores y resolución de problemas');
  assert.equal(await page.locator('#blockForm [name="notes"]').inputValue(),note);
  await page.locator('dialog [data-sheet-close]').first().click();
  pass('Editar: el título abre los detalles y el formulario existente conserva la nota');

  const downloaded = page.waitForEvent('download');
  await page.locator('.week-overview [data-act="download-week"]').click();
  const download = await downloaded;
  assert.equal(download.suggestedFilename(),'brujula-semana-2026-10-19.csv');
  await download.saveAs(join(output,'semana.csv'));
  const csv = await readFile(join(output,'semana.csv'),'utf8');
  assert.ok(csv.includes('Física I: vectores y resolución de problemas'));
  assert.ok(csv.includes('""tres ejercicios""'));
  assert.ok(csv.includes('2026-10-25'));
  assert.ok(!csv.includes('2026-10-26'));
  pass('Descarga: CSV editable de los siete días visibles, con notas');

  await page.setViewportSize({width:1366,height:860});
  await page.evaluate(()=>{location.hash='#/semana/2026-10-19';});
  await page.locator('.week-bar').waitFor();
  assert.equal(await page.locator('.week-bar [data-act="download-week"]').count(),1);
  await page.locator('.week-bar [data-act="quick-add"]').click();
  assert.equal(await page.locator('dialog h2').innerText(),'Añadir actividad');
  await page.locator('dialog [data-sheet-close]').first().click();
  assert.equal(await page.locator('[data-act="plan-week"]').count(),1);
  pass('Semana: añadir una actividad y planificar la semana tienen nombres distintos');

  await page.evaluate(()=>{location.hash='#/habitos';});
  await page.locator('[data-act="habit"]').first().waitFor();
  assert.ok((await page.locator('#main').innerText()).includes('Hábitos de hoy'));
  const after = await S();
  assert.deepEqual(after.blocks.map(({id,date,start,end})=>({id,date,start,end})),originalTimes);
  assert.equal(after.preferences.wake,'07:00');assert.equal(after.preferences.sleep,'21:00');
  assert.equal(after.courses.length,state.courses.length);
  pass('Datos: Vida conserva los hábitos; cursos, sueño y horarios permanecen intactos');

  const offline = await openApp(browser, {mock, serviceWorkers:'allow', time:'2026-10-17T10:30:00-05:00',
    storage:{brujula_device_v4:{['welcome4_'+user.id]:true}}});
  try {
    await offline.context.route('https://fonts.googleapis.com/**', r => r.fulfill({status:200,contentType:'text/css',body:''}));
    await offline.page.goto(server.url+'/index.html', {waitUntil:'domcontentloaded'});
    await login(offline.page,'agenda@example.com');
    await offline.page.waitForFunction(async(version) => {
      const cache = await caches.open('brujula-app-v'+version);
      return (await cache.keys()).length >= 60 && !!navigator.serviceWorker.controller;
    },APP_VERSION);
    const cached = await offline.page.evaluate(async(version) => {
      const cache=await caches.open('brujula-app-v'+version);
      return await Promise.all(['./js/ui/activity-tools.js','./js/features/week-export.js','./css/brujula.css?v='+version]
        .map(async path => !!(await cache.match(path))));
    },APP_VERSION);
    assert.deepEqual(cached,[true,true,true]);
    await offline.page.evaluate(async() => {await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');});
    await offline.page.evaluate(()=>window.brujula.sync.flush());
    mock.db.offline=true;
    await offline.context.setOffline(true);
    await offline.page.reload({waitUntil:'domcontentloaded'});
    await offline.page.locator('#main .week-overview').waitFor();
    assert.equal(await offline.page.evaluate(()=>window.brujula.version),APP_VERSION);
    assert.ok((await offline.page.locator('#main').innerText()).includes('Traer cuaderno'));
    pass('PWA: versión, estilos y módulos nuevos en caché; abre sin conexión con las notas guardadas');
  } finally {mock.db.offline=false;await offline.context.close();}

  const errors=app.errors.filter(e=>!/Failed to load resource|net::ERR_|internetdisconnected/i.test(e));
  assert.deepEqual(errors,[]);
  console.log(`${checks}/${checks} comprobaciones de interfaz correctas`);
} finally {
  await context.close();await browser.close();await server.close();
}
