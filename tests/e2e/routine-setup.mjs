// La prueba puede cargar una copia local autorizada mediante BRUJULA_SETUP_STATE_FILE.
// Supabase se simula en memoria; no se envían datos a un servidor real.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {startServer,createMock,launchBrowser,openApp,login} from './harness.mjs';
import {blankState,newBlock} from '../../js/core/model.js';
import {routineDefaults,draftDailyRoutine} from '../../js/engine/daily-routine.js';
const require=createRequire(import.meta.url);
const server=await startServer();
const browser=process.env.BRUJULA_CHROMIUM_EXECUTABLE?await require('playwright').chromium.launch({executablePath:process.env.BRUJULA_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--no-zygote','--disable-gpu']}):await launchBrowser();
let state;
if(process.env.BRUJULA_SETUP_STATE_FILE)state=JSON.parse(await readFile(process.env.BRUJULA_SETUP_STATE_FILE,'utf8'));
else {
  state=blankState();state.preferences.wake='05:00';state.preferences.routineConfirmed=true;
  const templates=routineDefaults(state);
  state.blocks=draftDailyRoutine(state,templates,{startDate:'2026-10-18',untilDate:'2027-02-18',now:new Date(2026,9,17,14)}).items;
  state.preferences.dailyRoutine={version:1,startDate:'2026-10-18',until:'2027-02-18',templates:templates.map(({id,start,end,enabled})=>({id,start,end,enabled}))};
}
const cls=newBlock({id:'protected-class',date:'2026-10-20',start:'11:00',end:'11:45',kind:'class',title:'Clase protegida de prueba'});
state.blocks.push(cls);
const finished=state.blocks.find(b=>b.routineKey==='higiene'&&b.date==='2026-10-18');finished.status='mastered';
const exercise=state.blocks.find(b=>b.routineKey==='ejercicio');exercise.notes='Conservar la nota al editar toda la rutina';
const initial=structuredClone(state),count=state.blocks.length;
const mock=createMock(),user=mock.db.addUser('routine@example.com');mock.db.setRow(user.id,state);
const app=await openApp(browser,{mock,mobile:false,time:'2026-10-17T14:00:00-05:00',storage:{brujula_device_v4:{['welcome4_'+user.id]:true}}});
const {page,context}=app;
await page.emulateMedia({reducedMotion:'reduce'});
await context.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
const S=()=>page.evaluate(()=>JSON.parse(JSON.stringify(window.brujula.store.state)));
let passed=0;const pass=m=>{passed++;console.log('✔',m);};
const sorted=blocks=>[...blocks].sort((a,b)=>a.id.localeCompare(b.id));
try{
  await page.goto(server.url+'/index.html',{waitUntil:'domcontentloaded'});await login(page,'routine@example.com');
  await page.waitForFunction(n=>window.brujula.store.state.blocks.length===n,count);
  assert.equal((await S()).preferences.wake,'05:00');assert.equal((await S()).preferences.sleep,'21:00');
  pass('Carga y sincroniza la planificación completa con despertar 05:00');
  await page.evaluate(()=>location.hash='#/semana/2026-10-19');await page.locator('.week-scope').waitFor();
  await page.locator('[data-view="academic"]').click();await page.locator('[data-view="academic"][aria-pressed="true"]').waitFor();assert.equal(await page.locator('.tg-ev[data-ev="protected-class"]').count(),1);
  const dailyId=state.blocks.find(b=>b.routineKey==='higiene'&&b.date==='2026-10-19').id;
  assert.equal(await page.locator('.tg-ev[data-ev="'+dailyId+'"]').count(),0);
  await page.locator('[data-view="personal"]').click();await page.locator('[data-view="personal"][aria-pressed="true"]').waitFor();assert.equal(await page.locator('.tg-ev[data-ev="protected-class"]').count(),0);
  assert.equal(await page.locator('.tg-ev[data-ev="'+dailyId+'"]').count(),1);
  pass('Semana separa académico y rutina sin modificar las actividades');
  await page.locator('[data-act="daily-routine"]').click();
  assert.equal(await page.locator('[data-from="higiene"]').inputValue(),'05:00');
  for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('.sheet-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1));}
  await page.locator('[data-from="ejercicio"]').fill('05:45');await page.locator('[data-until="ejercicio"]').fill('06:00');
  await page.locator('[data-apply-routine]').click();
  await page.waitForFunction(()=>window.brujula.store.state.preferences.dailyRoutine.templates.find(t=>t.id==='ejercicio').start==='05:45');
  const after=await S();assert.equal(after.blocks.length,count);
  assert.equal(after.blocks.find(b=>b.id===exercise.id).notes,exercise.notes);
  assert.equal(after.blocks.find(b=>b.id===finished.id).status,'mastered');
  assert.deepEqual(after.blocks.find(b=>b.id===cls.id),cls);
  assert.ok(after.blocks.filter(b=>b.origin==='daily-routine'&&b.routineKey==='ejercicio').every(b=>b.start==='05:45'));
  pass('Edición conjunta: mantiene cantidad, IDs, notas, realizadas y clases; formulario móvil sin desbordamiento');
  await page.evaluate(()=>window.brujula.sync.flush());assert.equal(mock.db.rows.get(user.id).payload.blocks.length,count);
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-act="undo-last"]').waitFor();
  assert.equal((await S()).preferences.dailyRoutine.templates.find(t=>t.id==='ejercicio').start,'05:45');
  await page.locator('[data-act="undo-last"]').click();
  const undone=await S();assert.deepEqual(sorted(undone.blocks),sorted(initial.blocks));
  assert.deepEqual(undone.preferences,initial.preferences);
  await page.evaluate(()=>window.brujula.sync.flush());
  pass('Recarga y Deshacer recuperan la rutina completa y su configuración');
  const voice=await page.evaluate(async()=>{
    const voices=[];const synthesis=Object.assign(new EventTarget(),{getVoices:()=>voices,cancel(){},speak(u){this.last=u;}});
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:synthesis});
    window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
    const a=await import('/js/features/audio.js');voices.push({lang:'en-US'});
    const rejectsEnglish=!a.speak('Prueba')&&!(await a.waitForSpanishVoice(5));
    voices.push({lang:'es-PE'});const spanish=a.speak('Explicación en español');
    return {rejectsEnglish,spanish,language:synthesis.last?.lang};
  });
  assert.deepEqual(voice,{rejectsEnglish:true,spanish:true,language:'es-PE'});
  pass('Audio: elige español y rechaza usar la voz inglesa como sustitución');
  assert.deepEqual(app.errors.filter(e=>!/Failed to load resource|net::ERR_|internetdisconnected/i.test(e)),[]);
  console.log(passed+'/'+passed+' comprobaciones correctas; '+count+' actividades probadas con servidor simulado');
}finally{await context.close();await browser.close();await server.close();}
