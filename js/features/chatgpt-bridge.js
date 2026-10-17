// Brújula 4.2 · puente opcional con ChatGPT mediante solicitudes de Supabase.
// ChatGPT NO se ejecuta dentro de la aplicación. Solo prepara el contexto y permite
// recuperar una propuesta escrita por el usuario en su ChatGPT conectado a Supabase.
import {store} from '../core/store.js';
import {courseOf,prefs} from '../core/model.js';
import {todayISO,addDays} from '../core/dates.js';
import {cloud,getClient} from '../cloud/cloud.js';
import {validateChanges} from '../engine/scheduler.js';
import {openProposal} from '../ui/proposal.js';
import {openSheet,toast} from '../ui/feedback.js';
import {icon} from '../ui/icons.js';
import {esc} from '../core/util.js';
import {copyText} from '../ui/dom.js';

const TABLE='brujula_assistant_requests';
export async function createChatGPTRequest(instruction='',extras={}){
  if(!cloud.user)throw Error('Primero inicia sesión en Brújula.');
  const s=store.state,client=await getClient();
  const min=addDays(todayISO(),-1),max=addDays(todayISO(),125);
  const context={
    version:1,createdAt:new Date().toISOString(),
    ...(extras.material ? {material:extras.material} : {}),
    request:String(instruction||'Propón un horario de estudio equilibrado con mis prioridades.').slice(0,700),
    courses:s.courses.map(c=>({id:c.id,name:c.name,importance:c.importance,difficulty:c.difficulty})),
    blocks:s.blocks.filter(b=>b.date>=min&&b.date<=max).slice(0,600).map(b=>({
      id:b.id,course:courseOf(s,b.courseId).name,date:b.date,start:b.start,end:b.end,
      title:b.title,kind:b.kind,status:b.status,priority:b.priority,
      fixed:!!b.semesterFixed})),
    preferences:{wake:prefs(s).wake,sleep:prefs(s).sleep,lunchStart:prefs(s).lunchStart,
      lunchEnd:prefs(s).lunchEnd,breakMins:prefs(s).breakMins,maxStudyMin:prefs(s).maxStudyMin}
  };
  const {data,error}=await client.from(TABLE).insert({user_id:cloud.user.id,schedule_snapshot:context})
    .select('id,expires_at').single();
  if(error)throw Error('No se pudo enviar la solicitud: '+error.message);
  return data;
}
export function openChatGPTGuide(request){
  const instruction = 'Brújula: consulta exclusivamente la solicitud con ID '+request.id+
    ' en mi proyecto Supabase conectado. Prepara una propuesta JSON con {version:1,changes:[...]} y guarda la propuesta en ESA SOLICITUD. No consultes ni muestres datos de otras cuentas.';
  const sheet=openSheet({title:'Planificar con ChatGPT (beta)',
    body:'<div class="stack"><p>Tu solicitud y los bloques necesarios ya están guardados de forma privada en Supabase. <b>No necesitas copiar tu calendario.</b></p>'+
      '<div class="notice"><div><b>1.</b> Pulsa «Copiar mensaje» y luego «Abrir ChatGPT». Pega allí el mensaje corto (solo el ID, no tu calendario).<br><b>2.</b> Cuando ChatGPT haya preparado la propuesta, vuelve aquí y pulsa <b>Buscar propuesta</b>. Si la copia falla, mantén presionado el texto de abajo o selecciónalo con Ctrl+C.</div></div>'+
      '<label class="field"><span>Mensaje para ChatGPT (puedes seleccionarlo manualmente)</span><textarea class="textarea" data-gpt-message rows="5" readonly spellcheck="false" aria-label="Mensaje para copiar en ChatGPT">'+esc(instruction)+'</textarea></label>'+ 
      '<p class="small muted">Solicitud '+esc(request.id.slice(0,8))+' · expira '+esc(new Date(request.expires_at).toLocaleString('es-PE'))+'. Es una integración beta, sin API de OpenAI ni cargos nuevos.</p></div>',
    foot:'<button type="button" class="btn" data-sheet-close>Cerrar</button>'+
      '<button type="button" class="btn btn-soft" data-copy-gpt>Copiar mensaje</button>'+ 
      '<button type="button" class="btn btn-soft" data-open-gpt>Abrir ChatGPT</button>'+
      '<button type="button" class="btn btn-primary" data-load-plan>Buscar propuesta</button>',
    onMount(card){
      const field=card.querySelector('[data-gpt-message]');
      field?.addEventListener('click',()=>field.select());
      card.querySelector('[data-copy-gpt]')?.addEventListener('click',async()=>{
        const btn=card.querySelector('[data-copy-gpt]');
        const ok=await copyText(instruction);
        if(ok){
          btn.textContent='✓ Copiado';
          toast('Mensaje copiado. Ahora abre ChatGPT y pégalo.',{tone:'ok'});
        }else{
          field?.focus();
          field?.select();
          toast('Tu navegador bloqueó la copia. El mensaje quedó seleccionado: usa Ctrl+C o mantén pulsado para copiar.',{tone:'warn',duration:8000});
        }
      });
      card.querySelector('[data-open-gpt]')?.addEventListener('click',()=>{
        window.open('https://chatgpt.com/','_blank','noopener,noreferrer');
      });
      card.querySelector('[data-load-plan]')?.addEventListener('click',async()=>{
        const btn=card.querySelector('[data-load-plan]');btn.disabled=true;
        try{const result=await checkChatGPTProposal(request.id);
          if(result)sheet.close();
        }catch(e){toast(e.message,{tone:'warn'});}finally{btn.disabled=false;}
      });
    }
  });
  return sheet;
}
export async function requestChatGPT(instruction='',extras={}){
  const r=await createChatGPTRequest(instruction,extras);
  openChatGPTGuide(r);
  return r;
}
export async function checkChatGPTProposal(requestId=null){
  const client=await getClient();
  let query=client.from(TABLE).select('id,proposal,status,expires_at').eq('user_id',cloud.user.id)
    .eq('status','proposed').gt('expires_at',new Date().toISOString());
  if(requestId)query=query.eq('id',requestId);
  const {data,error}=await query.order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw Error(error.message);
  if(!data?.proposal){toast('Todavía no llegó una propuesta de ChatGPT. Vuelve cuando te responda.',{tone:'warn'});return false;}
  const changes=data.proposal.changes;
  if(data.proposal.version!==1||!Array.isArray(changes))throw Error('La propuesta no tiene un formato seguro.');
  const res=validateChanges(store.state,changes,{source:'ai',maxChanges:12});
  openProposal({title:'Propuesta de ChatGPT',ops:res.ops,rejected:res.rejected,warnings:res.warnings,
    source:'ai',eventReason:'Propuesta de ChatGPT aplicada por el usuario',
    onApplied:()=>client.from(TABLE).update({status:'applied',updated_at:new Date().toISOString()})
      .eq('id',data.id).eq('user_id',cloud.user.id).then(()=>{},()=>{})});
  return true;
}
