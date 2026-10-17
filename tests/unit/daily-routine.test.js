import test from 'node:test';
import assert from 'node:assert/strict';
import {blankState,newBlock} from '../../js/core/model.js';
import {draftDailyRoutine,draftRoutineReplacement,routineDefaults} from '../../js/engine/daily-routine.js';
import {store,change,undo,canUndo} from '../../js/core/store.js';

const now=new Date(2026,9,17,13,45),from='2026-10-19';
const opts={now,startDate:from,untilDate:from};
function state(){const s=blankState();s.preferences.wake='05:00';return s;}

test('rutina 05:00: conserva ocho horas de descanso y la lectura es opcional',()=>{
  const s=state(),defs=routineDefaults(s);
  assert.equal(defs[0].start,'05:00');assert.equal(s.preferences.sleep,'21:00');
  assert.equal(defs.filter(t=>t.enabled).length,6);
  const draft=draftDailyRoutine(s,defs,opts);assert.equal(draft.items.length,6);
  assert.equal(draftDailyRoutine(s,defs.map(t=>({...t,enabled:true})),opts).items.length,7);
});

test('rutina: reconoce ejercicio y limpieza ya existentes sin moverlos ni duplicarlos',()=>{
  const s=state();s.blocks=[newBlock({date:from,start:'18:00',end:'18:30',kind:'personal',title:'Ejercicio y movilidad'}),
    newBlock({date:from,start:'16:00',end:'16:30',kind:'personal',title:'Limpieza y organización'})];
  const before=JSON.stringify(s),p=draftDailyRoutine(s,routineDefaults(s),opts);
  assert.equal(p.items.length,4);assert.equal(p.skipped.length,2);assert.equal(JSON.stringify(s),before);
});

test('editar rutina: conserva IDs, notas, clases y actividades realizadas',()=>{
  const s=state();s.blocks=draftDailyRoutine(s,routineDefaults(s),opts).items;
  const exercise=s.blocks.find(b=>b.routineKey==='ejercicio');exercise.notes='Conservar esta nota';
  const hygiene=s.blocks.find(b=>b.routineKey==='higiene');hygiene.status='mastered';
  const cls=newBlock({date:from,start:'09:00',end:'11:00',kind:'class',title:'Clase protegida'});s.blocks.push(cls);
  const templates=routineDefaults(s).map(t=>t.id==='ejercicio'?{...t,start:'05:45',end:'06:00'}:t);
  const before=JSON.stringify(s),p=draftRoutineReplacement(s,templates,opts);
  assert.ok(!p.error,p.error);assert.equal(p.items.length,5);
  const updated=p.items.find(b=>b.id===exercise.id);assert.equal(updated.notes,exercise.notes);assert.equal(updated.start,'05:45');
  assert.ok(!p.removedIds.includes(hygiene.id));assert.ok(!p.removedIds.includes(cls.id));assert.equal(JSON.stringify(s),before);
});

test('editar rutina: un ajuste imposible no borra la repetición anterior',()=>{
  const s=state();s.blocks=draftDailyRoutine(s,routineDefaults(s),opts).items;
  const before=JSON.stringify(s);
  const p=draftRoutineReplacement(s,routineDefaults(s).map(t=>t.id==='higiene'?{...t,start:'20:50',end:'21:10'}:t),opts);
  assert.ok(p.error);assert.equal(JSON.stringify(s),before);
});

test('rutina: desactivar una actividad afecta a sus repeticiones futuras programadas',()=>{
  const s=state();s.blocks=draftDailyRoutine(s,routineDefaults(s),opts).items;
  const p=draftRoutineReplacement(s,routineDefaults(s).map(t=>t.id==='limpieza'?{...t,enabled:false}:t),opts);
  assert.ok(!p.error,p.error);assert.equal(p.items.length,5);assert.ok(!p.items.some(b=>b.routineKey==='limpieza'));
});

test('Deshacer recupera las preferencias y protege los cambios posteriores',()=>{
  store.state=blankState();store.userId=null;
  const {entry}=change({label:'Rutina',preferenceKeys:['wake','dailyRoutine'],
    mutate(s){s.preferences.wake='05:00';s.preferences.dailyRoutine={until:'2027-02-18'};},render:false});
  assert.equal(undo(entry.id).ok,true);assert.equal(store.state.preferences.wake,'07:00');
  assert.ok(!Object.hasOwn(store.state.preferences,'dailyRoutine'));
  const {entry:e}=change({label:'Rutina',preferenceKeys:['wake'],mutate(s){s.preferences.wake='05:00';},render:false});
  store.state.preferences.wake='06:00';assert.equal(canUndo(e).ok,false);
});
