// Editor de rutina diaria: seleccionar horarios, revisar conflictos, guardar 4 meses con Deshacer.
import {esc} from '../core/util.js';
import {store,change} from '../core/store.js';
import {openSheet,confirmSheet,toast} from './feedback.js';
import {undoToast} from '../features/undo-toast.js';
import {routineDefaults,draftRoutineReplacement} from '../engine/daily-routine.js';
import {todayISO} from '../core/dates.js';

export function openDailyRoutineSheet(){
  const defaults=routineDefaults(store.state);
  const profile=store.state.preferences.dailyRoutine;
  const start=profile?.startDate>todayISO()?profile.startDate:todayISO();
  const body='<div class="stack"><p class="muted small">Edita aquí toda tu rutina futura. Se conservan las actividades realizadas, las notas y tu horario académico.</p>'+
    '<form id="dailyRoutineForm" class="stack"><label class="field"><span>Aplicar desde</span><input class="input" type="date" data-routine-from value="'+esc(start)+'" min="'+todayISO()+'"></label>'+defaults.map(t=>
      '<div class="panel panel-tight"><label class="hstack" style="align-items:center"><input type="checkbox" data-enable="'+esc(t.id)+'" '+(t.enabled?'checked':'')+'><b>'+esc(t.title)+'</b></label>'+
      '<div class="form-grid" style="margin-top:10px"><label class="field"><span>Desde</span><input class="input" type="time" data-from="'+esc(t.id)+'" value="'+esc(t.start)+'"></label>'+
      '<label class="field"><span>Hasta</span><input class="input" type="time" data-until="'+esc(t.id)+'" value="'+esc(t.end)+'"></label></div></div>'
    ).join('')+'</form>'+
    '<div class="notice" id="dailyRoutineSummary" aria-live="polite">Calculando los horarios…</div>'+
    '<p class="hint">El almuerzo ya está reservado en Ajustes y no se duplicará. El sueño es un horario protegido. Puedes editar las horas antes de guardar.</p></div>';
  const sheet=openSheet({
    title:'Mi rutina diaria · 4 meses',wide:true,body,
    foot:'<button type="button" class="btn" data-sheet-close>Cancelar</button><button type="button" class="btn btn-primary" data-apply-routine>'+(profile?'Guardar rutina':'Agregar al horario')+'</button>',
    onMount(card){
      const form=card.querySelector('#dailyRoutineForm');
      const summary=card.querySelector('#dailyRoutineSummary');
      const button=card.querySelector('[data-apply-routine]');
      const read=()=>defaults.map(t=>({...t,
        enabled:form.querySelector('[data-enable="'+t.id+'"]').checked,
        start:form.querySelector('[data-from="'+t.id+'"]').value,
        end:form.querySelector('[data-until="'+t.id+'"]').value
      }));
      const build=()=>draftRoutineReplacement(store.state,read(),{now:new Date(),
        startDate:form.querySelector('[data-routine-from]').value,
        untilDate:profile?.until>=form.querySelector('[data-routine-from]').value?profile.until:null});
      function preview(){
        const plan=build();
        if(plan.error){summary.textContent=plan.error;button.disabled=true;return;}
        button.disabled=!plan.items.length&&!plan.removedIds.length;
        summary.innerHTML='<b>'+plan.updated+' actividades a actualizar · '+(plan.items.length-plan.updated)+' nuevas</b> desde '+esc(plan.from)+' hasta '+esc(plan.until)+
          '. <br>'+plan.adjusted.length+' horarios adaptados por clases u otras actividades. '+
          plan.skipped.length+' sesiones no se pudieron añadir o ya existían.'+
          (plan.adjusted.length?'<details><summary>Ver ejemplos de ajustes</summary><p class="small">'+
            plan.adjusted.slice(0,8).map(a=>esc(a.date+' · '+a.title+' '+a.start+'–'+a.end)).join('<br>')+'</p></details>':'')+
          (plan.skipped.length?'<details><summary>Ver actividades omitidas</summary><p class="small">'+
            plan.skipped.slice(0,8).map(a=>esc(a.date+' · '+a.title+' ('+a.why+')')).join('<br>')+'</p></details>':'');
      }
      form.addEventListener('input',preview);
      card.querySelector('[data-apply-routine]').addEventListener('click',async()=>{
        const plan=build();
        if(plan.error){toast(plan.error,{tone:'warn'});return;}
        if(!plan.items.length&&!plan.removedIds.length){toast('No hay actividades para actualizar.',{tone:'warn'});return;}
        if(plan.skipped.some(item=>item.why!=='ya existe')){
          const yes=await confirmSheet({title:'Revisa las actividades omitidas',
            text:'Se guardarán '+plan.items.length+' actividades de la rutina. '+plan.skipped.length+' ya existen o no caben. Las actividades personales equivalentes y tus clases se conservan.',
            confirm:'Guardar las compatibles',cancel:'Seguir editando'});
          if(!yes)return;
        }
        const fresh=build(); // revalidación por si el horario cambió con la ventana abierta
        if(fresh.error||fresh.items.length!==plan.items.length){toast('Tu horario cambió. Vuelve a revisar el resumen.',{tone:'warn'});preview();return;}
        const {entry}=change({label:'Rutina diaria de cuatro meses',type:'routine',blockIds:fresh.removedIds,
          preferenceKeys:['dailyRoutine'],
          mutate(s){
            const ids=new Set(fresh.removedIds);
            s.blocks=s.blocks.filter(b=>!ids.has(b.id));s.blocks.push(...fresh.items);
            s.preferences.dailyRoutine={version:1,startDate:profile?.startDate||fresh.from,until:fresh.until,
              templates:read().map(({id,enabled,start,end})=>({id,enabled,start,end}))};
          },
          event:{status:'progress',type:'routine',title:'Rutina diaria',course:'Vida y bienestar',
            reason:'Actividades cotidianas añadidas desde Semana por decisión del usuario'}
        });
        sheet.close();
        undoToast('Rutina diaria guardada · Deshacer',entry);
      });
      preview();
    }
  });
  return sheet;
}
