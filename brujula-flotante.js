/* Brújula 3.8 — Ventana flotante de Gemini y planificador confirmable. */
(() => {
"use strict";
const $=id=>document.getElementById(id);
let owner="",pending=null,busy=false;
const minute=s=>{const a=String(s).split(":").map(Number);return a[0]*60+a[1];};
const validTime=s=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s);
function clearPending(){
 pending=null;const p=$("brujulaFloatProposal");
 if(p){p.hidden=true;p.replaceChildren()}
 const b=$("brujulaFloatApprove");if(b)b.disabled=true;
}
function status(s,err=false){
 const el=$("brujulaFloatStatus");if(el){el.textContent=String(s);el.dataset.error=String(err)}
}
function sync(){
 if(!window.brujulaFloatReady||typeof cloud==="undefined")return;
 const id=cloud.user?.id||"";
 if(id!==owner){owner=id;clearPending();window.brujulaVoice?.stop?.("",false)}
 const b=$("brujulaFloatLauncher"),p=$("brujulaFloatPanel");
 if(b)b.hidden=!id;
 if(p&&!id)p.hidden=true;
 const name=$("brujulaFloatAccount");if(name)name.textContent=cloud.user?.email||"Tu tutor";
}
function toggle(open){
 sync();if(!owner)return;
 const panel=$("brujulaFloatPanel"),button=$("brujulaFloatLauncher");
 if(!panel||!button)return;
 const visible=typeof open==="boolean"?open:panel.hidden;
 panel.hidden=!visible;button.setAttribute("aria-expanded",String(visible));
 if(visible){window.brujulaAi?.refresh?.();$("brujulaAiInput")?.focus({preventScroll:true})}
 else{window.brujulaVoice?.stop?.("",false);window.speechSynthesis?.cancel?.()}
}
function validate(proposal){
 if(!proposal||proposal.version!==1||!Array.isArray(proposal.changes)||!proposal.changes.length||proposal.changes.length>3)
  throw Error("Gemini no devolvió cambios válidos.");
 if(!cloud.user||!cloud.enabled||cloud.conflict)throw Error("Primero sincroniza tu cuenta en Mi cuenta y resuelve posibles conflictos.");
 for(const ch of proposal.changes){
  if(!ch||!["add","update"].includes(ch.action))throw Error("No se permiten eliminaciones.");
  if(ch.action==="update"){
   const old=state.blocks.find(b=>b.id===ch.id);
   if(!old)throw Error("La propuesta menciona una actividad inexistente.");
   if(old.status==="mastered"||["class","exam"].includes(old.kind))throw Error("Las clases, exámenes y sesiones dominadas están protegidas.");
   if("kind" in ch&&["class","exam"].includes(ch.kind))throw Error("No se pueden convertir actividades en clases o exámenes.");
  }else{
   if(ch.id||!["study","personal"].includes(ch.kind))throw Error("Las actividades nuevas deben ser estudio o vida personal.");
   if(!state.courses.some(c=>c.name===ch.course))throw Error("El curso propuesto no existe.");
  }
 }
 const result=buildAIPlan(JSON.stringify({version:1,changes:proposal.changes}));
 if(result.conflicts)throw Error("La propuesta choca con otras actividades. Pide otra alternativa.");
 const p={wake:"07:00",sleep:"21:00",lunchStart:"12:00",lunchEnd:"13:00",breakMins:15,...(state.preferences||{})};
 if(!["wake","sleep","lunchStart","lunchEnd"].every(k=>validTime(p[k])))throw Error("Primero corrige tus horas en Bienestar.");
 const gap=Math.max(0,Math.min(90,Number(p.breakMins)||0));
 for(const op of result.operations){
  const b=result.draft.find(x=>x.id===op.id);
  if(!b)throw Error("Falta la actividad revisada.");
  const start=minute(b.start),end=minute(b.end);
  if(start<minute(p.wake)||end>minute(p.sleep)||(start<minute(p.lunchEnd)&&end>minute(p.lunchStart)))
   throw Error("La propuesta interfiere con tu sueño o almuerzo.");
  if(result.draft.some(x=>x.id!==b.id&&x.date===b.date&&
    ((x.end<=b.start&&start-minute(x.end)>=0&&start-minute(x.end)<gap)||
     (x.start>=b.end&&minute(x.start)-end>=0&&minute(x.start)-end<gap))))
   throw Error("La propuesta no respeta los descansos entre actividades.");
 }
 return result;
}
function preview(result){
 const box=$("brujulaFloatProposal");box.replaceChildren();box.hidden=false;
 const title=document.createElement("strong");title.textContent="Gemini propone:";box.append(title);
 const list=document.createElement("ul");
 for(const op of result.operations){const li=document.createElement("li");li.textContent=op.label;list.append(li)}
 box.append(list);
 const note=document.createElement("p");note.textContent="Todavía no se ha cambiado nada. Tú decides.";box.append(note);
}
async function propose(){
 if(busy)return;sync();
 const input=$("brujulaAiInput");
 if(!owner||!input?.value.trim())return status("Escribe qué actividad quieres mover o añadir.",true);
 if(!$("brujulaAiConsent")?.checked)return status("Acepta primero el envío de tu mensaje a Gemini.",true);
 if(!$("brujulaAiShareSchedule")?.checked)return status("Marca «Compartir mi horario». Es necesario para proponer cambios.",true);
 if(window.brujulaAi?.isBusy?.())return status("Espera a que termine la respuesta actual.",true);
 busy=true;clearPending();$("brujulaFloatPropose").disabled=true;
 status("Preparando tu propuesta; tu horario sigue intacto…");
 const account=owner;
 try{
  const client=await getSupabaseClient();
  const {data,error}=await client.functions.invoke("brujula-ai",{body:{
   mode:"schedule_proposal",consent:true,shareSchedule:true,
   message:input.value.trim().slice(0,1800),
   courses:state.courses.map(c=>c.name),
   schedule:state.blocks.slice(0,90).map(b=>({
    id:b.id,course:course(b.courseId).name,date:b.date,start:b.start,end:b.end,
    title:b.title,kind:b.kind,status:b.status,priority:b.priority,difficulty:b.difficulty
   })),preferences:state.preferences||{}
  }});
  if(error){let detail="";try{detail=(await error.context?.json?.())?.error||""}catch(_){}throw Error(detail||error.message||"Error de conexión.")}
  if(!cloud.user||cloud.user.id!==account)throw Error("La sesión cambió; se descartó la propuesta.");
  if(!data?.proposal)throw Error(data?.error||"Gemini no pudo preparar cambios.");
  if(data.clarification||!data.proposal.changes?.length){status(data.clarification||"Dime qué actividad quieres cambiar.");return}
  const result=validate(data.proposal);
  pending={result,userId:account,version:state.savedAt};
  preview(result);
  $("brujulaFloatApprove").disabled=false;
  status("Revisa la propuesta. Solo se aplicará cuando la confirmes.");
 }catch(e){clearPending();status(e.message||"No se pudo preparar la propuesta.",true)}
 finally{busy=false;$("brujulaFloatPropose").disabled=false}
}
function approve(){
 if(!pending||!cloud.user||pending.userId!==cloud.user.id||pending.version!==state.savedAt){
  clearPending();return status("El horario cambió. Pide una propuesta nueva.",true);
 }
 if(!cloud.enabled||cloud.conflict)return status("Sincroniza tu cuenta antes de aplicar.",true);
 aiPlan.pending=pending.result;
 clearPending();toggle(false);applyAIPlan();
}
function init(){
 if($("brujulaFloatRoot"))return;
 const root=document.createElement("div");root.id="brujulaFloatRoot";root.className="brujula-float-root";
 root.innerHTML=[
  '<button type="button" id="brujulaFloatLauncher" class="brujula-float-launcher" aria-expanded="false" aria-controls="brujulaFloatPanel" hidden>✦ <span>Mi asistente</span></button>',
  '<aside id="brujulaFloatPanel" class="brujula-float-panel" role="dialog" aria-modal="false" aria-label="Asistente de Brújula" hidden>',
  '<header class="brujula-float-head"><div><b>✦ Brújula IA</b><small id="brujulaFloatAccount">Tu tutor</small></div><button type="button" id="brujulaFloatClose" aria-label="Cerrar asistente">×</button></header>',
  '<div class="brujula-float-body"><p class="brujula-float-intro">Consulta Gemini o pide que reorganice tu horario. Todo cambio requiere tu permiso.</p>',
  '<div class="brujula-ai-feed" id="brujulaAiFeed" role="log" aria-label="Conversación Gemini"></div>',
  '<label class="label" for="brujulaAiInput">¿En qué puedo ayudarte?</label>',
  '<textarea class="field" id="brujulaAiInput" maxlength="1800" placeholder="Ej.: No pude estudiar Física; ¿puedes mover mi repaso al martes?"></textarea>',
  '<label class="brujula-ai-option"><input type="checkbox" id="brujulaAiConsent"><span>Autorizo enviar mi conversación a Gemini de Google; los datos del nivel gratuito pueden usarse para mejorar sus productos.</span></label>',
  '<label class="brujula-ai-option"><input type="checkbox" id="brujulaAiShareSchedule"><span>Compartir mi horario con Gemini (opcional para consultas; necesario para cambiar horarios).</span></label>',
  '<div class="brujula-float-actions"><button id="brujulaAiSend" type="button" class="btn primary" data-brujula-ai="send">Enviar pregunta →</button>',
  '<button type="button" class="btn" id="brujulaFloatPropose" data-brujula-float="propose">📅 Proponer cambio</button></div>',
  '<details class="brujula-float-extra"><summary>🎙 Voz y más opciones</summary><div class="brujula-voice-panel">',
  '<button type="button" class="btn" id="brujulaVoiceTalk" data-brujula-voice="talk">🎙 Conversar</button>',
  '<button type="button" class="btn" id="brujulaVoiceDictate" data-brujula-voice="dictate">🎤 Dictar</button>',
  '<span class="brujula-voice-status" id="brujulaVoiceStatus" role="status"></span></div>',
  '<button type="button" class="btn small" data-brujula-ai="speak">🔊 Escuchar</button>',
  '<button type="button" class="btn small" data-brujula-ai="clear">Borrar chat</button></details>',
  '<div id="brujulaFloatProposal" class="brujula-float-proposal" hidden></div>',
  '<button type="button" id="brujulaFloatApprove" class="btn primary full" data-brujula-float="approve" disabled>✓ Revisar y aplicar</button>',
  '<p class="brujula-float-status" id="brujulaFloatStatus" role="status">Tus actividades siguen sin cambios.</p>',
  '<p class="brujula-float-status" id="brujulaAiStatus" role="status">Límite: 15 consultas diarias de IA por cuenta.</p>',
  '</div></aside>'
 ].join("");
 document.body.append(root);window.brujulaFloatReady=true;
 root.addEventListener("click",e=>{
  if(e.target.closest("#brujulaFloatLauncher"))toggle();
  else if(e.target.closest("#brujulaFloatClose"))toggle(false);
  else{const a=e.target.closest("[data-brujula-float]")?.dataset.brujulaFloat;
    if(a==="propose")void propose();if(a==="approve")approve()}
 });
 document.addEventListener("click",e=>{if(e.target.closest("[data-brujula-open]"))toggle(true)});
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("brujulaFloatPanel").hidden)toggle(false)});
 const former=render;render=function(){former();sync()};
 sync();window.brujulaAi?.refresh?.();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();