/* Brújula 3.9 · Tres modos simples; replanificación al marcar pendiente.
   Automático solo tras autorización explícita. No mueve clases ni exámenes.
   Gemini sigue proponiendo cambios bajo aprobación. */
(()=>{
"use strict";
const $=id=>document.getElementById(id);
const options={confirm:"Te preguntaré antes de mover algo.",mixed:"Tareas personales y repasos automáticos.",flex:"Reorganizo también el estudio flexible."};
const mode=()=>["confirm","mixed","flex"].includes(state.preferences?.replanMode)?state.preferences.replanMode:"confirm";
const hhmm=n=>pad(Math.floor(n/60))+":"+pad(n%60);
const valid=t=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(t));
const locked=b=>!b||b.status==="mastered"||["class","exam"].includes(b.kind);
const originalMove=proposeMove;
function prefs(){
 const p={wake:"07:00",sleep:"21:00",lunchStart:"12:00",lunchEnd:"13:00",breakMins:15,...(state.preferences||{})};
 if(![p.wake,p.sleep,p.lunchStart,p.lunchEnd].every(valid)||hmin(p.wake)>=hmin(p.sleep)||hmin(p.lunchStart)>=hmin(p.lunchEnd))return null;
 return {...p,breakMins:Math.min(60,Math.max(0,Number(p.breakMins)||0))};
}
function findSlot(b,duration,excludeOwn){
 const p=prefs();if(!p||!Number.isInteger(duration)||duration<10||duration>240)return null;
 const today=nowISO(),now=new Date(),minTime=now.getHours()*60+now.getMinutes()+15;
 for(let offset=0;offset<8;offset++){
  const day=shift(today,offset);
  for(let start=Math.ceil(hmin(p.wake)/15)*15;start+duration<=hmin(p.sleep);start+=15){
   const end=start+duration;
   if(offset===0&&start<minTime)continue;
   if(start<hmin(p.lunchEnd)&&end>hmin(p.lunchStart))continue;
   if(excludeOwn&&day===b.date&&start===hmin(b.start))continue;
   if(state.blocks.some(x=>x.date===day&&!(excludeOwn&&x.id===b.id)
      &&start<hmin(x.end)+p.breakMins&&end>hmin(x.start)-p.breakMins))continue;
   return {date:day,start:hhmm(start),end:hhmm(end)};
  }
 }
 return null;
}
function box(){
 const selected=mode();
 const button=(id,label)=>'<button type="button" class="br-mode-button'+(selected===id?' chosen':'')
  +'" data-replan="select" data-mode="'+id+'" aria-pressed="'+(selected===id)+'">'+label+'</button>';
 return '<section class="br-mode-bar" aria-label="Ajustes del horario">'
   +'<div class="br-mode-header"><strong>⚙ Tu horario</strong>'
   +(state.latestAutomation?'<button type="button" class="br-mode-undo" data-replan="undo">↶ Deshacer</button>':'')+'</div>'
   +'<div class="br-mode-choices" role="group" aria-label="Forma de reprogramar">'
   +button("mixed","✨ Mixto")+button("confirm","✓ Preguntar")+button("flex","⚡ Automático")+'</div>'
   +'<p class="br-mode-caption">'+options[selected]+'</p></section>';
}
function changeMode(value){
 if(!cloud.user)return toast("Inicia sesión primero.");
 if(!options[value]||value===mode())return;
 if(value!=="confirm"&&!window.confirm(value==="mixed"
  ?"Activar Mixto: podrás mover automáticamente tareas personales y crear repasos al marcarlos. ¿Continuar?"
  :"Activar Automático: las tareas personales, los repasos y los estudios flexibles podrán reprogramarse al marcarlos. ¿Continuar?"))return;
 state.preferences={...(state.preferences||{}),replanMode:value};
 save();render();toast("Modo actualizado.");
}
function applyMove(b,where,automated){
 const old={date:b.date,start:b.start,end:b.end,status:b.status,reviewDate:b.reviewDate};
 b.date=where.date;b.start=where.start;b.end=where.end;b.status="scheduled";b.reviewDate="";
 state.latestMove={id:b.id,old,next:{date:b.date,start:b.start,end:b.end},at:Date.now()};
 state.latestAutomation={type:"move",id:b.id,at:Date.now()};
 recordEvent(b,"scheduled",automated?"Reprogramación automática":"Reprogramación autorizada");
 save();ui.date=b.date;render();
 toast("Reprogramada: "+b.date+" "+b.start+". Puedes deshacer.");
}
function move(b,automatic){
 if(locked(b)||!cloud.user||cloud.conflict)return;
 const where=findSlot(b,hmin(b.end)-hmin(b.start),true);
 if(!where)return toast("No encontré un espacio libre. Puedes editar a mano.");
 if(!automatic&&!window.confirm("¿Mover «"+b.title+"» al "+where.date+" de "+where.start+" a "+where.end+"?"))return;
 applyMove(b,where,automatic);
}
function addReview(b,automatic){
 if(locked(b)||b.kind!=="study"||!cloud.user||cloud.conflict)return;
 if(state.blocks.some(x=>x.sourceReviewId===b.id&&x.status!=="mastered"))return toast("Ese tema ya tiene un repaso programado.");
 const where=findSlot(b,25,false);
 if(!where)return toast("No encontré 25 minutos libres para este repaso.");
 if(!automatic&&!window.confirm("¿Programar un repaso de «"+b.title+"» el "+where.date+" a las "+where.start+"?"))return;
 const newBlock={id:gid(),sourceReviewId:b.id,courseId:b.courseId,date:where.date,start:where.start,end:where.end,
  title:("Repaso: "+b.title).slice(0,130),goal:"Practicar un tema pendiente de dominio.",kind:"study",
  difficulty:b.difficulty||3,priority:"high",status:"scheduled",reviewDate:"",lesson:b.lesson||{},
  notes:"",attempt:"",quizAttempt:"",revealed:0,stage:0};
 state.blocks.push(newBlock);
 state.latestAutomation={type:"review",id:newBlock.id,at:Date.now()};
 recordEvent(newBlock,"scheduled",automatic?"Repaso programado automáticamente":"Repaso confirmado");
 save();ui.date=where.date;render();toast("Repaso añadido. Puedes deshacer.");
}
function checkStatus(b,status){
 if(!cloud.user||cloud.conflict||locked(b))return;
 const m=mode();
 if(status==="review")addReview(b,m!=="confirm");
 if(status==="missed"){
  const auto=m==="flex"||(m==="mixed"&&b.kind==="personal");
  move(b,auto);
 }
}
function undo(){
 const log=state.latestAutomation;
 if(!log)return toast("No hay cambios para deshacer.");
 const b=state.blocks.find(x=>x.id===log.id);
 if(!b){state.latestAutomation=null;save();render();return;}
 if(log.type==="review"){
  if(b.status!=="scheduled"||!b.sourceReviewId)return toast("El repaso ya cambió: edítalo manualmente.");
  if(!window.confirm("¿Quitar el repaso «"+b.title+"»?"))return;
  state.blocks=state.blocks.filter(x=>x.id!==b.id);
  recordEvent(b,"missed","Se deshizo el repaso programado");
 }else{
  const m=state.latestMove;
  if(!m||m.id!==b.id||b.date!==m.next.date||b.start!==m.next.start||b.end!==m.next.end)
   return toast("La actividad ya cambió. Edítala manualmente.");
  if(state.blocks.some(x=>x.id!==b.id&&x.date===m.old.date&&m.old.start<x.end&&m.old.end>x.start))
   return toast("No se puede deshacer: la hora anterior está ocupada.");
  if(!window.confirm("¿Restaurar «"+b.title+"» a su hora anterior?"))return;
  Object.assign(b,m.old);recordEvent(b,b.status,"Se deshizo el ajuste automático");
  state.latestMove=null;
 }
 state.latestAutomation=null;save();render();toast("Cambio deshecho.");
}
const prevWeek=weekSchedule;
weekSchedule=function(){return box()+prevWeek()};
const prevStatus=markStatus;
markStatus=function(b,status){
 const eventId=state.events?.[0]?.id;
 prevStatus(b,status);
 if(state.events?.[0]?.id===eventId||state.events?.[0]?.blockId!==b?.id||state.events?.[0]?.status!==status)return;
 if(status==="missed"||status==="review")checkStatus(b,status);
};
proposeMove=function(b){
 if(locked(b))return toast("Clases, exámenes y actividades dominadas no se mueven.");
 if(!cloud.user||cloud.conflict)return toast("Inicia sesión y revisa la nube.");
 const m=mode();
 if(m==="confirm"||(m==="mixed"&&b.kind!=="personal"))return originalMove(b);
 return move(b,true);
};
document.addEventListener("click",e=>{
 const button=e.target.closest("[data-replan]");if(!button)return;
 if(button.dataset.replan==="select")changeMode(button.dataset.mode);
 if(button.dataset.replan==="undo")undo();
});
})();