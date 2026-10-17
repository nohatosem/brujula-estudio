// Brújula 4.2.2 · plantilla cotidiana de cuatro meses.
// Planifica sin escribir en el estado; el usuario revisa y pulsa Aplicar.
// Las clases y sesiones ya guardadas se respetan. No se cambian las horas de sueño.
import { gid, norm } from '../core/util.js';
import { newBlock, prefs } from '../core/model.js';
import { todayISO, addDays, toHHMM, toMin, isValidDate, blockTime } from '../core/dates.js';
import { violations } from './scheduler.js';
import { rulesFrom } from './rules.js';

export const DAILY_TEMPLATE = [
  { id:'higiene', title:'Higiene y tender la cama', offset:0, duration:15, when:'morning', habitId:null },
  { id:'ejercicio', title:'Ejercicio de la mañana', offset:30, duration:30, when:'morning', habitId:'move' },
  { id:'desayuno', title:'Desayunar', offset:75, duration:30, when:'morning', habitId:null },
  { id:'lectura', title:'Lectura personal', offset:120, duration:15, when:'morning', habitId:null, enabled:false },
  { id:'limpieza', title:'Limpieza y orden', offset:-120, duration:20, when:'evening', habitId:'clean' },
  { id:'cena', title:'Cenar y descansar', offset:-85, duration:30, when:'evening', habitId:null },
  { id:'preparar', title:'Preparar el día siguiente', offset:-40, duration:20, when:'evening', habitId:null },
];

const clock = n => toHHMM(Math.min(1439,Math.max(0,n)));
export function routineDefaults(state) {
  const r=rulesFrom(prefs(state));
  const saved=new Map((state.preferences?.dailyRoutine?.templates||[]).map(t=>[t.id,t]));
  return DAILY_TEMPLATE.map(t=>{
    const start = t.when==='morning' ? r.wake+t.offset : r.sleep+t.offset;
    return {...t, enabled:t.enabled!==false, start:clock(start), end:clock(start+t.duration), ...saved.get(t.id)};
  });
}
/** Solo actividades personales: una sesión académica de lectura no es la rutina personal. */
export function routineKeysOf(b){
  if(b.kind!=='personal')return [];
  if(b.routineKey)return [b.routineKey];
  const title=norm(b.title||'');
  return [
    ['higiene',/\b(higiene|aseo|tender la cama|rutina de manana)\b/],
    ['ejercicio',/\b(ejercicio|movilidad|entrenamiento|gimnasio)\b/],
    ['desayuno',/\b(desayuno|desayunar)\b/],['lectura',/\b(lectura|leer)\b/],
    ['limpieza',/\b(limpieza|limpiar|ordenar)\b/],['cena',/\b(cena|cenar)\b/],
    ['preparar',/\b(preparar|preparacion|planificar).*(dia siguiente|manana)\b/]
  ].filter(([,re])=>re.test(title)).map(([key])=>key);
}
function plusMonths(yyyyMMdd,months){
  const d=new Date(yyyyMMdd+'T12:00:00');
  const day=d.getDate();
  d.setDate(1);d.setMonth(d.getMonth()+months);
  d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
/** Función pura. Devuelve {items,skipped,totalDays,until,error?}; nunca borra ni mueve. */
export function draftDailyRoutine(state, templates, {
  startDate=todayISO(),now=new Date(),months=4,untilDate=null
}={}){
  const r=rulesFrom(state.preferences), active=templates.filter(t=>t.enabled);
  if(!active.length)return {error:'Selecciona al menos una actividad diaria.'};
  if(active.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.end)||
     toMin(t.end)-toMin(t.start)<10||toMin(t.end)-toMin(t.start)>120))
    return {error:'Revisa las horas: las actividades deben durar entre 10 minutos y 2 horas.'};
  const curso=(state.courses||[]).find(c=>!c.archived&&/vida|bienestar|personal/i.test(c.name))?.id||
    (state.courses||[]).find(c=>c.id==='vida')?.id||'vida';
  const from=startDate<todayISO(now)?todayISO(now):startDate;
  if(!isValidDate(from))return {error:'Revisa la fecha de inicio de la rutina.'};
  const until=untilDate||plusMonths(from,months);
  if(!isValidDate(until)||until<from)return {error:'La fecha final debe ser posterior al inicio.'};
  const byDay=new Map(),existing=new Set();
  for(const b of state.blocks){
    if(!byDay.has(b.date))byDay.set(b.date,[]);
    byDay.get(b.date).push(b);
    for(const key of routineKeysOf(b))existing.add(b.date+'|'+key);
  }
  const items=[],skipped=[],adjusted=[],series=new Map(active.map(t=>[t.id,gid()]));
  let totalDays=0;
  for(let d=from;d<=until;d=addDays(d,1)){
    if(++totalDays>135)break;
    const draft=byDay.get(d)||[];
    for(const t of active){
      // Repetir la plantilla no debe crear otra sesión del mismo tipo en la misma fecha.
      const duplicate=existing.has(d+'|'+t.id);
      if(duplicate){skipped.push({date:d,title:t.title,why:'ya existe'});continue;}
      const b=newBlock({courseId:curso,date:d,start:t.start,end:t.end,
        title:t.title,goal:'Cuidar mi rutina diaria sin quitar tiempo a mis clases.',
        kind:'personal',status:'scheduled',difficulty:1,priority:'normal',
        semesterFixed:true,origin:'daily-routine',routineKey:t.id,
        seriesId:series.get(t.id),seriesUntil:until,...(t.habitId?{habitId:t.habitId}:{})});
      let issues=violations({blocks:draft,rules:r,now},{date:d,start:toMin(b.start),end:toMin(b.end),kind:'personal'});
      if(issues.length){
        // Mantener la rutina diaria buscando una alternativa en la misma mañana/tarde.
        // Nunca trasladamos clases ni dejamos que una comida invada almuerzo o sueño.
        const duration=toMin(b.end)-toMin(b.start);
        const windowEnd=t.when==='morning'?Math.min(r.lunch[0],12*60):r.sleep;
        const startAt=Math.max(t.when==='morning'?r.wake:Math.max(r.lunch[1],18*60),toMin(b.start));
        let moved=false;
        for(let minute=Math.ceil(startAt/15)*15;minute+duration<=windowEnd;minute+=15){
          const v=violations({blocks:draft,rules:r,now},
            {date:d,start:minute,end:minute+duration,kind:'personal'});
          if(!v.length){
            b.start=toHHMM(minute);b.end=toHHMM(minute+duration);
            adjusted.push({date:d,title:t.title,start:b.start,end:b.end});
            moved=true;break;
          }
        }
        if(!moved){skipped.push({date:d,title:t.title,why:issues.join(', ')});continue;}
      }
      draft.push(b);items.push(b);existing.add(d+'|'+t.id);
    }
  }
  return {items,skipped,adjusted,totalDays,until,from,activeCount:active.length};
}

/** Sustituye solo repeticiones futuras sin empezar. Conserva IDs, notas e historial. */
export function draftRoutineReplacement(state,templates,options={}){
  const now=options.now||new Date();
  const from=options.startDate||todayISO(now);
  const until=options.untilDate||plusMonths(from,options.months||4);
  const old=state.blocks.filter(b=>b.origin==='daily-routine'&&b.date>=from&&b.date<=until&&
    b.status==='scheduled'&&blockTime(b)>now.getTime());
  const removedIds=old.map(b=>b.id),ids=new Set(removedIds);
  const base={...state,blocks:state.blocks.filter(b=>!ids.has(b.id))};
  const plan=draftDailyRoutine(base,templates,{...options,now,startDate:from,untilDate:until});
  if(plan.error)return plan;
  const previous=new Map(old.map(b=>[b.date+'|'+b.routineKey,b]));
  const active=new Set(templates.filter(t=>t.enabled).map(t=>t.id));
  const replacements=new Set(plan.items.map(b=>b.date+'|'+b.routineKey));
  for(const b of old){
    if(active.has(b.routineKey)&&!replacements.has(b.date+'|'+b.routineKey)&&
      !base.blocks.some(x=>x.date===b.date&&routineKeysOf(x).includes(b.routineKey)))
      return {error:'No cabe la nueva hora de «'+b.title+'» el '+b.date+'. Ajusta la rutina; se conserva el horario anterior.'};
  }
  plan.items=plan.items.map(b=>{
    const prev=previous.get(b.date+'|'+b.routineKey);
    return prev?{...prev,start:b.start,end:b.end,title:b.title,seriesUntil:until}:b;
  });
  return {...plan,removedIds,updated:plan.items.filter(b=>ids.has(b.id)).length};
}
