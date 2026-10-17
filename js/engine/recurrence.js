// Brújula 4.1: agenda recurrente de 4 meses y órdenes sencillas.
import { gid,norm } from '../core/util.js';
import { newBlock } from '../core/model.js';
import { addDays,todayISO,iso,toMin,toHHMM,weekdayIndex } from '../core/dates.js';
import { violations } from './scheduler.js';
import { rulesFrom } from './rules.js';
const N=['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
const SUB=[
 [/\bfisica\b/,'Física I','study'],[/\b(matematicas|calculo|algebra|vectores)\b/,'Matemáticas','study'],
 [/\b(c\+\+|programacion|algoritmos)\b/,'Programación C++','study'],[/\b(redes|cisco)\b/,'Redes','study'],
 [/\b(html|css|javascript)\b/,'Desarrollo web','study'],[/\b(limpieza|limpiar|ordenar|lavar)\b/,'Limpieza','personal'],
 [/\b(gym|gimnasio|ejercicio|entrenamiento)\b/,'Ejercicio','personal'],[/\b(lectura|leer)\b/,'Lectura','personal']];
const RANGE=/\b(?:de(?:sde)?\s+)?(\d{1,2}(?::\d{2})?)\s*(a\.?\s*m\.?|p\.?\s*m\.?)?\s*(?:a(?:\s+las)?|hasta|al|[-–])\s*(\d{1,2}(?::\d{2})?)\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/i;
const REM=/\b(borra|elimina|quita|cancela|suspende)\b/;
const MOV=/\b(mueve|cambia|pasa|traslada|reprograma)\b/;
const subject=v=>SUB.find(([r])=>r.test(v));
const label=d=>N[d];
function getDays(v){
 if(/\b(todos los dias|cada dia|diariamente|a diario)\b/.test(v))return [0,1,2,3,4,5,6];
 if(/\b(lunes a viernes|dias laborables)\b/.test(v))return [0,1,2,3,4];
 return N.map((n,i)=>new RegExp('\\b'+n+'\\b').test(v)?i:-1).filter(n=>n>=0);
}
function minute(v,mer){
 const m=/^(\d{1,2})(?::(\d\d))?$/.exec(v);if(!m)return NaN;
 let h=Number(m[1]),mins=Number(m[2]||0);if(h>23||mins>59)return NaN;
 if(mer){if(h===0||h>12)return NaN;h=h%12+(/p/.test(mer)?12:0);}
 return 60*h+mins;
}
function times(v){
 const m=RANGE.exec(v);if(!m)return null;
 const am=m[2]?.replace(/\s|\./g,'')||'',pm=m[4]?.replace(/\s|\./g,'')||'';
 const partOfDay=!am&&!pm&&/\b(tarde|noche)\b/.test(v)?'pm':'';
 const a=minute(m[1],am||pm||partOfDay),b=minute(m[3],pm||am||partOfDay);
 if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||b-a>720)return {error:'Revisa la hora: el final debe ser posterior al inicio (máximo 12 horas).'};
 return {start:toHHMM(a),end:toHHMM(b)};
}
function endDate(start){
 const d=new Date(start+'T12:00:00');const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+4);
 d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));return iso(d);
}
function about(v,sub){
 if(/\bclases?\b/.test(v))return 'Clase de '+(sub?.[1]||'estudio');
 if(sub)return sub[2]==='study'?'Estudiar '+sub[1]:sub[1];
 const str=v.replace(RANGE,' ').replace(/\b(todos|los|cada|dia|dias|de|la|el|por|durante|cuatro|4|meses?|quiero|programa|agrega|ponme|tengo|rutina|semanal|hacer|una|un)\b/g,' ').replace(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/g,' ').replace(/\s+/g,' ').trim();
 return (str||'Actividad').slice(0,100);
}
function course(state,sub,kind){
 const a=(state.courses||[]).filter(c=>!c.archived);
 if(kind==='personal')return a.find(c=>/\b(vida|bienestar|personal)\b/.test(norm(c.name)))?.id||'vida';
 if(sub){const c=a.find(c=>norm(c.name).includes(norm(sub[1]))||norm(sub[1]).includes(norm(c.name)));return c?.id||null;}
 return a.find(c=>c.id==='general')?.id||a[0]?.id||'general';
}
function safe(state,now,items,ignore=[]){
 const blocks=state.blocks.filter(b=>!ignore.includes(b.id));
 for(const b of items){
  const v=violations({blocks,rules:rulesFrom(state.preferences),now},
    {date:b.date,start:toMin(b.start),end:toMin(b.end),kind:b.kind});
  if(v.length)return 'Se cruza con otra actividad o un descanso el '+b.date+' a las '+b.start+' ('+v.join(', ')+'). Prueba otra hora.';
  blocks.push(b);
 }
 return null;
}
function series(state,v,weekday){
 const sub=subject(v),today=todayISO();
 const matches=state.blocks.filter(b=>b.seriesId&&b.date>=today&&b.status!=='mastered'
   &&(weekday==null||weekdayIndex(b.date)===weekday)
   &&(sub?norm(b.title).includes(norm(sub[1])):norm(v).includes(norm(b.title))));
 const ids=[...new Set(matches.map(b=>b.seriesId))];
 if(ids.length!==1)return {error:ids.length?'Hay varias rutinas parecidas; menciona el nombre y día.':'No encontré esa rutina futura. Menciona el nombre y día.'};
 return {items:state.blocks.filter(b=>b.seriesId===ids[0]&&b.date>=today&&b.status!=='mastered'&&(weekday==null||weekdayIndex(b.date)===weekday))};
}
/** Nunca muta el estado. Devuelve null si no es una orden repetitiva. */
export function draftRecurring(raw,state,now=new Date()){
 const v=norm(raw),days=getDays(v),remove=REM.test(v),move=MOV.test(v);
 if(!days.length||!(/\b(todos|cada|semanal|fij[oa]|meses|rutina|lunes a viernes|dias laborables|los (lunes|martes|miercoles|jueves|viernes|sabado|domingo))\b/.test(v)||remove||move))return null;
 if(remove||move){
  const found=series(state,v,remove&&days.length>1?null:days[0]);if(found.error)return {error:found.error};
  const old=found.items;
  if(remove)return {kind:'remove',ids:old.map(b=>b.id),items:[],message:'Eliminar '+old.length+' sesiones futuras de '+old[0].title+'.'};
  const range=times(v);if(range?.error)return range;
  if(days.length<2&&!range)return {error:'Indica el nuevo día o las nuevas horas.'};
  const offset=days.length>1?(days[days.length-1]-days[0]+7)%7:0;
  const items=old.map(b=>({...b,date:addDays(b.date,offset),start:range?.start||b.start,end:range?.end||b.end}));
  const bad=safe(state,now,items,old.map(b=>b.id));
  return bad?{error:bad}:{kind:'move',ids:old.map(b=>b.id),items,message:'Mover '+old.length+' sesiones de '+old[0].title+'.'};
 }
 if(/\b(dormir|sueno)\b/.test(v))return {error:'El sueño se configura en Ajustes → Rutina y descansos.'};
 const range=times(v);if(!range)return {error:'Indica inicio y fin. Ejemplo: «todos los lunes Física de 15:00 a 17:00».'};
 if(range.error)return range;
 const sub=subject(v),kind=/\bclases?\b/.test(v)?'class':sub?.[2]||'study';
 const title=about(v,sub),id=gid(),from=todayISO(now),until=endDate(from),items=[];
 const knownCourse=course(state,sub,kind);
 const newCourse=!knownCourse&&sub&&kind!=='personal'?{id:gid(),name:sub[1],
   color:'#3F7CAC',difficulty:3,importance:3,credits:null,archived:false}:null;
 const courseId=knownCourse||newCourse?.id||'general';
 for(let date=from;date<=until;date=addDays(date,1)){
  if(!days.includes(weekdayIndex(date)))continue;
  if(date===from&&toMin(range.start)<now.getHours()*60+now.getMinutes())continue;
  const habit=kind==='personal'?(state.habitDefs||[]).find(h=>norm(h.name)===norm(title)||norm(h.name).includes(norm(title))||norm(title).includes(norm(h.name))):null;
  items.push(newBlock({...range,date,title,courseId,kind,...(habit?{habitId:habit.id}:{}),
    semesterFixed:true,seriesId:id,seriesUntil:until,seriesDays:days,origin:'routine-ai'}));
  if(items.length>126)return {error:'Hay demasiadas repeticiones. Divide la rutina en dos órdenes.'};
 }
 if(!items.length)return {error:'No quedaron fechas futuras para esa rutina.'};
 const bad=safe(state,now,items);if(bad)return {error:bad};
 return {kind:'add',ids:[],items,newCourse,message:'Crear '+title+' los '+days.map(label).join(', ')+' de '+range.start+' a '+range.end+' hasta '+until+' ('+items.length+' veces).'};
}
