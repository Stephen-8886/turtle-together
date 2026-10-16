import {dayKey,validDay,isDue,occurrence,occurrenceDay,settlement} from './public/domain.js';

export function taskState(room,task,day,member,at){
  const s=occurrence(task,day,member.id,room.records,at);
  const current=day===dayKey(at)||(occurrenceDay(task,day)<dayKey(at)&&at<=s.end);
  const open=!['done','exception','expired'].includes(s.status);
  return {...s,canStart:current&&open&&!s.startedAt&&s.end-at>=task.duration*60000,
    canComplete:current&&open&&(task.duration===0||(!!s.startedAt&&s.remaining===0)),
    canException:day<=dayKey(at)&&!['done','exception'].includes(s.status),
    action:task.duration===0||s.startedAt?'complete':'start',
    displayRemaining:['done','exception','expired'].includes(s.status)?0:task.duration===0?Math.max(0,s.end-at):s.remaining};
}

export function timeline(room,at,selection={}){
  const today=dayKey(at),day=validDay(selection.day)?selection.day:today;
  const days=[...new Set([today,day,validDay(selection.focusDay)?selection.focusDay:day])];
  const result={serverNow:at,today,days:{}};
  for(const d of days){
    result.days[d]={};
    for(const member of room.members){
      const tasks=room.tasks.filter(t=>isDue(t,d,member));
      result.days[d][member.id]={tasks:tasks.map(t=>t.id),states:Object.fromEntries(tasks.map(t=>[t.id,taskState(room,t,d,member,at)])),stats:settlement(room,member,d,at)};
    }
  }
  return result;
}
