// Editor de rutina diaria: seleccionar horarios, revisar conflictos, guardar 4 meses con Deshacer.
import {esc} from '../core/util.js';
import {store,change} from '../core/store.js';
import {openSheet,confirmSheet,toast} from './feedback.js';
import {undoToast} from '../features/undo-toast.js';
import {routineDefaults,draftDailyRoutine} from '../engine/daily-routine.js';

export function openDailyRoutineSheet(){
  const defaults=routineDefaults(store.state);
  const body='<div class="stack"><p class="muted small">Preparamos cuatro meses de rutina desde tus horas de despertar y dormir. No cambiamos tus clases, exámenes ni sesiones existentes. Si alguna hora se cruza, buscamos otra hora libre del mismo día.</p>'+
    '<form id="dailyRoutineForm" class="stack">'+defaults.map(t=>
      '<div class="panel panel-tight"><label class="hstack" style="align-items:center"><input type="checkbox" data-enable="'+esc(t.id)+'" checked><b>'+esc(t.title)+'</b></label>'+
      '<div class="form-grid" style="margin-top:10px"><label class="field"><span>Desde</span><input class="input" type="time" data-from="'+esc(t.id)+'" value="'+esc(t.start)+'"></label>'+
      '<label class="field"><span>Hasta</span><input class="input" type="time" data-until="'+esc(t.id)+'" value="'+esc(t.end)+'"></label></div></div>'
    ).join('')+'</form>'+
    '<div class="notice" id="dailyRoutineSummary" aria-live="polite">Calculando los horarios…</div>'+
    '<p class="hint">El almuerzo ya está reservado en Ajustes y no se duplicará. El sueño es un horario protegido. Puedes editar las horas antes de guardar.</p></div>';
  const sheet=openSheet({
    title:'Mi rutina diaria · 4 meses',wide:true,body,
    foot:'<button type="button" class="btn" data-sheet-close>Cancelar</button><button type="button" class="btn btn-primary" data-apply-routine>Agregar al horario</button>',
    onMount(card){
      const form=card.querySelector('#dailyRoutineForm');
      const summary=card.querySelector('#dailyRoutineSummary');
      const button=card.querySelector('[data-apply-routine]');
      const read=()=>defaults.map(t=>({...t,
        enabled:form.querySelector('[data-enable="'+t.id+'"]').checked,
        start:form.querySelector('[data-from="'+t.id+'"]').value,
        end:form.querySelector('[data-until="'+t.id+'"]').value
      }));
      const build=()=>draftDailyRoutine(store.state,read(),{now:new Date()});
      function preview(){
        const plan=build();
        if(plan.error){summary.textContent=plan.error;button.disabled=true;return;}
        button.disabled=!plan.items.length;
        summary.innerHTML='<b>'+plan.items.length+' actividades listas</b> desde '+esc(plan.from)+' hasta '+esc(plan.until)+
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
        if(!plan.items.length){toast('No hay actividades nuevas para agregar.',{tone:'warn'});return;}
        if(plan.skipped.length){
          const yes=await confirmSheet({title:'Algunas actividades necesitan ajuste',
            text:'Se agregarán '+plan.items.length+' actividades. '+plan.skipped.length+' sesiones se omitirán (cruce, horario ocupado o ya existente). No se modificarán tus clases.',
            confirm:'Agregar las compatibles',cancel:'Seguir editando'});
          if(!yes)return;
        }
        const fresh=build(); // revalidación por si el horario cambió con la ventana abierta
        if(fresh.error||fresh.items.length!==plan.items.length){toast('Tu horario cambió. Vuelve a revisar el resumen.',{tone:'warn'});preview();return;}
        const {entry}=change({label:'Rutina diaria de cuatro meses',type:'routine',
          mutate(s){s.blocks.push(...fresh.items);},
          event:{status:'progress',type:'routine',title:'Rutina diaria',course:'Vida y bienestar',
            reason:'Actividades cotidianas añadidas desde Semana por decisión del usuario'}
        });
        sheet.close();
        undoToast('Rutina diaria agregada · Deshacer',entry);
      });
      preview();
    }
  });
  return sheet;
}
