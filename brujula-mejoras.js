/* Brújula 3.5: preferencias, conflictos, recordatorios mientras está abierta,
   diálogo guiado local y reprogramación con confirmación. Sin llamadas a IA. */
(()=>{
'use strict';
const DEFAULTS={wake:'07:00',sleep:'21:00',breakMins:15,lunchStart:'12:00',lunchEnd:'13:00',reminders:false};
let chatMessages=[],lastAccount=null,lastUserQuestion='',lastReminderDate='';
const seenNotifications=new Set();
const html=s=>esc(String(s??''));
const pref=()=>({...DEFAULTS,...(state.preferences||{})});
const codeTime=m=>`${pad(Math.floor(m/60))}:${pad(m%60)}`;
const dateNow=()=>nowISO();
const validTime=t=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t);
const lower=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function accountCheck(){const id=cloud.user?.id||null;if(lastAccount!==id){lastAccount=id;chatMessages=[];lastUserQuestion='';seenNotifications.clear()}}
function clashes(){const out=[];const all=state.blocks||[];for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
 const a=all[i],b=all[j];if(a.date===b.date&&a.start<b.end&&b.start<a.end){out.push({a,b});if(out.length>=30)return out}
}return out}
function protectedHours(t,end,p){const wake=hmin(p.wake),sleep=hmin(p.sleep);
 if(!(wake<sleep))return true; // La madrugada queda protegida, nunca arriesgar descanso.
 if(t<wake||end>sleep)return true;
 const lunchStart=hmin(p.lunchStart),lunchEnd=hmin(p.lunchEnd);
 return t<lunchEnd&&end>lunchStart;
}
function proposeProtectedMove(b){
 if(!b||b.status==='mastered'||['class','exam'].includes(b.kind)){toast('No puedo mover clases, exámenes ni tareas dominadas.');return}
 if(!cloud.user||cloud.conflict){toast('Inicia sesión y resuelve conflictos de nube antes de modificar tu horario.');return}
 const p=pref(),duration=hmin(b.end)-hmin(b.start);
 if(duration<5||duration>240){toast('La duración necesita un ajuste manual.');openBlock(b);return}
 const now=new Date(),today=dateNow();let candidate=null;
 for(let offset=0;offset<10&&!candidate;offset++){
  const day=shift(today,offset),blockDay=byDate(day);
  for(let start=Math.ceil(hmin(p.wake)/15)*15;start+duration<=hmin(p.sleep);start+=15){
   const end=start+duration;if(protectedHours(start,end,p))continue;
   if(day===today&&start<=now.getHours()*60+now.getMinutes()+15)continue;
   if(day===b.date&&start===hmin(b.start))continue;
   if(blockDay.some(x=>x.id!==b.id&&start<hmin(x.end)+p.breakMins&&end>hmin(x.start)-p.breakMins))continue;
   candidate={date:day,start:codeTime(start),end:codeTime(end)};break;
  }
 }
 if(!candidate){toast('No encontré un espacio que respete tus preferencias. Puedes editarlo manualmente.');return}
 if(!confirm(`Propuesta para «${b.title}»:\n\nAntes: ${b.date}, ${b.start}–${b.end}\nDespués: ${candidate.date}, ${candidate.start}–${candidate.end}\n\nRespeté el sueño, las comidas y ${p.breakMins} minutos de separación.\n¿Confirmas el cambio?`))return;
 const old={date:b.date,start:b.start,end:b.end,status:b.status,reviewDate:b.reviewDate};
 b.date=candidate.date;b.start=candidate.start;b.end=candidate.end;b.status='scheduled';b.reviewDate='';
 state.latestMove={id:b.id,old,next:{date:b.date,start:b.start,end:b.end},at:Date.now()};
 recordEvent(b,'scheduled',`Cambio confirmado desde ${old.date} ${old.start}–${old.end}`);
 save();ui.date=b.date;ui.view='inicio';render();toast('Actividad reprogramada con tu autorización.');
}
function undoLastMove(){const move=state.latestMove;
 if(!move)return toast('No hay cambios recientes para deshacer.');
 const b=state.blocks.find(x=>x.id===move.id);if(!b)return toast('Ya no existe esa actividad.');
 if(b.date!==move.next.date||b.start!==move.next.start||b.end!==move.next.end)return toast('La actividad cambió de nuevo. Edítala manualmente.');
 if(state.blocks.some(x=>x.id!==b.id&&x.date===move.old.date&&move.old.start<x.end&&move.old.end>x.start))return toast('No puedo deshacer: el horario anterior está ocupado.');
 if(!confirm('¿Restaurar el horario anterior de «'+b.title+'»?'))return;
 Object.assign(b,move.old);state.latestMove=null;recordEvent(b,b.status,'Se deshizo una reprogramación');save();ui.date=b.date;render();toast('Cambio deshecho.');
}
function prefMarkup(){const p=pref();return `<section class="card br-extra" id="brPreferences"><div class="section-head"><div><h2>🌙 Mi rutina y mis descansos</h2><p class="mini">Estos ajustes se guardan solo en tu cuenta y ayudan a encontrar horas adecuadas.</p></div></div><div class="br-pref-grid"><label>Despertar<input class="field" name="wake" type="time" value="${html(p.wake)}"></label><label>Dormir<input class="field" name="sleep" type="time" value="${html(p.sleep)}"></label><label>Inicio de comida<input class="field" name="lunchStart" type="time" value="${html(p.lunchStart)}"></label><label>Fin de comida<input class="field" name="lunchEnd" type="time" value="${html(p.lunchEnd)}"></label><label>Descanso entre tareas<select class="field" name="breakMins">${[0,10,15,20,30].map(n=>`<option value="${n}" ${Number(p.breakMins)===n?'selected':''}>${n} minutos</option>`).join('')}</select></label></div><div class="row"><button class="btn primary" type="button" data-br="save-prefs">Guardar preferencias</button><button class="btn" type="button" data-br="enable-reminders">🔔 ${p.reminders?'Avisos activados':'Activar avisos'}</button></div><p class="footnote">Los avisos de navegador se muestran mientras Brújula está abierta. No son notificaciones push con la página cerrada. No hay vigilancia externa.</p></section>`}
function conflictMarkup(){const conflicts=clashes(),move=state.latestMove;
 return `<section class="br-conflict" aria-live="polite"><span>🗓️ <b>${conflicts.length?conflicts.length+' cruces detectados':'Sin cruces de actividades'}</b></span>${conflicts.length?`<details><summary>Ver conflictos</summary>${conflicts.slice(0,6).map(c=>`<p><b>${html(c.a.date)}:</b> ${html(c.a.title)} (${html(c.a.start)}–${html(c.a.end)}) y ${html(c.b.title)} (${html(c.b.start)}–${html(c.b.end)})</p>`).join('')}</details>`:''}${move?'<button class="btn small" data-br="undo-move">↶ Deshacer último cambio</button>':''}</section>`
}
function contextLines(){const due=pendingBlocks();return due.length?`Tienes ${due.length} pendiente(s). ${due.slice(0,3).map(b=>b.title).join('; ')}.`:'No veo actividades vencidas. Puedes planificar una sesión o revisar tus prioridades.'}
function chatMarkup(){accountCheck();return `<section class="card br-chat" aria-label="Asistente de horario"><div class="section-head"><div><h2>✦ Guía de mi horario</h2><p class="mini">Habla o escribe sobre tus pendientes. Esta guía funciona con reglas locales, no es un modelo de IA.</p></div></div><div class="br-chat-history" id="brChatLog" aria-live="polite"><div class="br-bubble bot">Hola. ${html(contextLines())} Puedo buscar huecos, revisar choques y ayudarte a proteger el descanso.</div>${chatMessages.slice(-10).map(m=>`<div class="br-bubble ${m.role==='user'?'person':'bot'}">${html(m.text)}</div>`).join('')}</div><div class="br-quick"><button data-br="quick" data-say="¿Qué pendientes tengo?" class="btn small">Pendientes</button><button data-br="quick" data-say="¿Hay choques?" class="btn small">Choques</button><button data-br="quick" data-say="Quiero reprogramar una actividad" class="btn small">Reprogramar</button><button data-br="quick" data-say="¿Cómo protejo mi descanso?" class="btn small">Descanso</button></div><form id="brChatForm" class="br-chat-form"><input class="field" id="brChatInput" required maxlength="400" aria-label="Mensaje a la guía" placeholder="Ej.: No pude estudiar Física hoy"><button class="btn primary" type="submit">Enviar</button><button class="btn" type="button" data-br="dictate" aria-label="Dictar con el micrófono">🎙️</button><button class="btn" type="button" data-br="read-reply" aria-label="Escuchar respuesta">🔊</button></form><p class="footnote">Para explicaciones libres, proyectos o preguntas sobre PDF usa ChatGPT con tu propia cuenta. La guía solo maneja planificación; no comparte tu cuenta personal.</p></section>`}
function matchTask(q){const blocks=state.blocks.filter(b=>!['class','exam'].includes(b.kind)&&b.status!=='mastered');
 const simplified=lower(q);const found=blocks.map(b=>({b,key:lower(b.title),course:lower(course(b.courseId).name)})).filter(x=>simplified.includes(x.key)||x.key.split(/[ :,-]/).some(w=>w.length>3&&simplified.includes(w))||simplified.includes(x.course)&&x.course.length>3).sort((a,b)=>b.key.length-a.key.length);
 return found[0]?.b||null;}
function chatReply(q){const v=lower(q),p=pref();
 if(/hola|buenas|ayuda|que puedes hacer/.test(v))return 'Puedo indicarte tus pendientes, detectar cruces y encontrar otro horario para una actividad flexible con tu permiso. También puedes ajustar la rutina en Bienestar.';
 if(/cruc|choqu|solap|superpos/.test(v)){const list=clashes();return list.length?`Encontré ${list.length} cruces. ${list.slice(0,2).map(x=>x.a.title+' y '+x.b.title+' el '+x.a.date).join('. ')}. Puedes editar una actividad para corregirlos.`:'No detecto choques entre tus actividades registradas.';}
 if(/descans|dorm|sueno|sueñ|levantar/.test(v))return `Tu horario protegido está entre ${p.sleep} y ${p.wake}, con ${p.breakMins} minutos entre tareas y comida de ${p.lunchStart} a ${p.lunchEnd}. Puedes cambiarlo en Bienestar. No moveré actividades nocturnas sin tu decisión.`;
 if(/pendient|atrasad|no hice|no pude|reprogram|mover|cambiar horario|pasar para/.test(v)){
  const b=matchTask(q);if(b){const message='Puedo buscar un espacio libre para «'+b.title+'». Haz clic en el botón de propuesta; nada cambia sin confirmación.';lastSuggested=b.id;return message}
  const pending=pendingBlocks();if(pending.length===1){lastSuggested=pending[0].id;return `Tu actividad pendiente es «${pending[0].title}». Pulsa «Proponer nuevo horario» para revisar otro momento.`}
  if(pending.length)return `${contextLines()} Indícame cuál de esas actividades quieres mover o abre Pendientes en el horario.`;
  return 'Para reprogramar, escribe el nombre de una actividad existente, por ejemplo: «No pude estudiar Física». Si no está en tu horario, créala primero.';
 }
 if(/horario|hoy|semana|progreso/.test(v)){const d=byDate(dateNow());return d.length?`Hoy hay ${d.length} actividades: ${d.slice(0,4).map(b=>`${b.start} ${b.title}`).join(', ')}.`:'Hoy no tienes actividades registradas. Puedes añadir una desde Mi horario.';}
 return 'Puedo ayudarte con el horario, descansos y actividades atrasadas. Para resolver materias o analizar un PDF, abre ChatGPT con tu cuenta personal. Puedes crear la actividad y guardar tus notas en Brújula.';
}
let lastSuggested=null,lastReply='';
function sendChat(q){accountCheck();const text=q.trim().slice(0,400);if(!text)return;lastSuggested=null;lastUserQuestion=text;chatMessages.push({role:'user',text});const response=chatReply(text);lastReply=response;chatMessages.push({role:'assistant',text:response});render();const box=document.querySelector('#brChatLog');if(box)box.scrollTop=box.scrollHeight;}
function checkReminders(){if(!cloud.user||!pref().reminders||!('Notification'in window)||Notification.permission!=='granted')return;
 const now=new Date(),time=now.getTime();if(lastReminderDate!==dateNow()){lastReminderDate=dateNow();seenNotifications.clear()}
 for(const b of state.blocks){if(b.date!==dateNow()||b.status==='mastered')continue;const when=new Date(b.date+'T'+b.start+':00').getTime();const n=b.id+':'+b.date+':'+b.start;
 if(time>=when-5*60000&&time<when+2*60000&&!seenNotifications.has(n)){seenNotifications.add(n);try{new Notification('Brújula · '+b.title,{body:`Comienza a las ${b.start}. Puedes revisarla en tu horario.`,tag:n})}catch(e){/* permisos del navegador */}}}
}
const oldAssistant=assistantView;assistantView=function(){return chatMarkup()+`<details class="card br-advanced"><summary>Opciones avanzadas · ChatGPT y propuestas de nube</summary>${oldAssistant()}</details>`};
const oldVida=vida;vida=function(){return prefMarkup()+oldVida()};
const oldWeek=weekSchedule;weekSchedule=function(){return conflictMarkup()+oldWeek()};
proposeMove=proposeProtectedMove;
const oldRender=render;render=function(){accountCheck();oldRender();if(ui.view==='asistente'&&lastSuggested&&document.querySelector('#brChatLog')){const b=state.blocks.find(x=>x.id===lastSuggested);if(b){const btn=document.createElement('button');btn.className='btn primary small';btn.textContent='Proponer nuevo horario para '+b.title;btn.dataset.br='move';btn.dataset.id=b.id;document.querySelector('#brChatLog').appendChild(btn)}}};
document.addEventListener('submit',e=>{if(e.target?.id!=='brChatForm')return;e.preventDefault();const input=document.querySelector('#brChatInput');sendChat(input?.value||'')});
document.addEventListener('click',async e=>{const btn=e.target.closest('[data-br]');if(!btn)return;const a=btn.dataset.br;
 if(a==='quick'){sendChat(btn.dataset.say||'');return}
 if(a==='move'){const b=state.blocks.find(x=>x.id===btn.dataset.id);proposeProtectedMove(b);return}
 if(a==='undo-move'){undoLastMove();return}
 if(a==='save-prefs'){
  const root=document.querySelector('#brPreferences');if(!root)return;
  const form=Object.fromEntries([...root.querySelectorAll('[name]')].map(n=>[n.name,n.value]));
  if(!['wake','sleep','lunchStart','lunchEnd'].every(k=>validTime(form[k]))||hmin(form.wake)>=hmin(form.sleep)||hmin(form.lunchStart)>=hmin(form.lunchEnd)){toast('Revisa las horas: despertar debe ser anterior a dormir y comida debe tener inicio y fin.');return}
  if(hmin(form.sleep)-hmin(form.wake)<600){if(!confirm('Has indicado menos de 10 horas despierto. ¿Guardar estas horas?'))return}
  state.preferences={...pref(),...form,breakMins:Number(form.breakMins)};save();render();toast('Tu rutina se guardó en tu cuenta.');return
 }
 if(a==='enable-reminders'){
  if(!('Notification'in window)){toast('Este navegador no admite notificaciones web.');return}
  let res=Notification.permission;if(res==='default')res=await Notification.requestPermission();if(res!=='granted'){toast('No se autorizó el envío de avisos. Puedes habilitarlo desde Chrome.');return}
  state.preferences={...pref(),reminders:!pref().reminders};save();render();toast(pref().reminders?'Avisos activos mientras Brújula está abierta.':'Avisos desactivados.');return
 }
 if(a==='dictate'){const API=window.SpeechRecognition||window.webkitSpeechRecognition;if(!API){toast('Dictado no disponible en este navegador. Usa el teclado.');return}const r=new API();r.lang='es-PE';r.interimResults=false;r.maxAlternatives=1;r.onresult=ev=>{const input=document.querySelector('#brChatInput');if(input)input.value=ev.results[0][0].transcript};r.onerror=()=>toast('No pude escuchar el dictado. Revisa los permisos del micrófono.');r.start();return}
 if(a==='read-reply'){if(!('speechSynthesis'in window)){toast('La lectura por voz no está disponible.');return}speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(lastReply||'Escribe una pregunta sobre tus horarios.');u.lang='es-PE';u.rate=.95;speechSynthesis.speak(u);return}
});
setInterval(checkReminders,60000);
render();
})();