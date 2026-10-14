export const ZONE = 'Asia/Shanghai';
export const QUADRANTS = [
  {id:'do',name:'重要且紧急',hint:'先做重要的事',color:'pink'},
  {id:'plan',name:'重要但不紧急',hint:'为未来留点时间',color:'light'},
  {id:'delegate',name:'不重要但紧急',hint:'快快处理掉',color:'orange'},
  {id:'relax',name:'不重要且不紧急',hint:'给生活一点留白',color:'blue'}
];
export const dayKey = (now=Date.now()) => new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
export const addDays = (day,n) => new Date(Date.parse(day+'T12:00:00+08:00')+n*86400000).toISOString().slice(0,10);
export const weekday = day => new Date(day+'T12:00:00+08:00').getUTCDay();
export const validDay = day => typeof day==='string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && !isNaN(Date.parse(day)) && new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;
export function times(task,day){
  const start = Date.parse(`${day}T${task.startTime||'00:00'}:00+08:00`);
  const endDay=task.repeat==='once'?task.deadlineDate:addDays(day,task.overnight?1:0);
  return {start,end:Date.parse(`${endDay}T${task.deadlineTime}:00+08:00`)};
}
export function isDue(task,day,member){
  if(day<task.startDate || day<dayKey(member.joinedAt) || (task.until && day>task.until))return false;
  if(task.assignee!=='all' && task.assignee!==member.id)return false;
  if(task.repeat==='once')return day>=task.startDate && day<=task.deadlineDate;
  return task.repeat==='daily' || task.weekdays.includes(weekday(day));
}
export const occurrenceDay = (task,day) => task.repeat==='once'?task.startDate:day;
export const occurrenceKey = (task,day,memberId) => `${task.id}:${occurrenceDay(task,day)}:${memberId}`;
export function occurrence(task,day,memberId,records,now=Date.now()){
  const record=records[occurrenceKey(task,day,memberId)]||{};
  const {start,end}=times(task,occurrenceDay(task,day));
  const remaining=record.startedAt?Math.max(0,task.duration*60000-(now-record.startedAt)):task.duration*60000;
  const status=record.status || (now>end?'expired':record.startedAt?'focusing':now<start?'scheduled':'pending');
  return {...record,status,start,end,remaining};
}
export function settlement(room,member,day,now=Date.now()){
  const tasks=room.tasks.filter(t=>isDue(t,day,member));
  const completed=tasks.filter(t=>occurrence(t,day,member.id,room.records,now).status==='done');
  return {total:tasks.length,done:completed.length,minutes:completed.reduce((n,t)=>n+t.duration,0),ready:tasks.length>0&&tasks.length===completed.length,signature:tasks.map(t=>t.id).sort().join(',')};
}
export function validateTask(input,now=Date.now()){
  const fail=message=>{throw new Error(message);};
  const task={title:String(input.title||'').trim(),note:String(input.note||'').trim(),quadrant:input.quadrant,startDate:input.startDate,startTime:input.startTime||'',deadlineDate:input.deadlineDate,deadlineTime:input.deadlineTime,duration:Number(input.duration||0),repeat:input.repeat,weekdays:[...new Set(input.weekdays||[])],until:input.repeat==='once'?'':input.until||'',overnight:input.overnight===true,assignee:input.assignee==='all'?'all':'self'};
  if(!task.title || task.title.length>80)fail('请填写 1–80 字的任务名称。');
  if(task.note.length>500)fail('备注最多 500 字。');
  if(!QUADRANTS.some(q=>q.id===task.quadrant))fail('请选择一个象限。');
  if(!validDay(task.startDate) || task.startDate<dayKey(now))fail('任务日期不能早于今天。');
  if(!['once','daily','weekly'].includes(task.repeat))fail('请选择重复方式。');
  if(task.repeat==='weekly' && (!task.weekdays.length || task.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6)))fail('请选择至少一个星期。');
  if(!Number.isInteger(task.duration)||task.duration<0||task.duration>1440)fail('专注时长应为 0–1440 分钟，0 表示仅按截止时间完成。');
  const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if((task.startTime&&!time.test(task.startTime))||!time.test(task.deadlineTime))fail('请填写有效的开始与截止时间。');
  if(!validDay(task.deadlineDate)||task.deadlineDate<task.startDate)fail('截止日期不能早于开始日期。');
  if(task.until&&(!validDay(task.until)||task.until<task.startDate))fail('重复结束日期不能早于开始日期。');
  let first=task.startDate;
  if(task.repeat==='weekly'){let n=0;while(!task.weekdays.includes(weekday(first))&&n++<7)first=addDays(first,1);if(task.until&&first>task.until)fail('所选时间范围内没有重复日期。');}
  const {start,end}=times(task,first);
  if(end<=Math.max(start,now))fail('截止时间必须晚于开始时间和现在。');
  if(end-Math.max(start,now)<task.duration*60000)fail('截止前剩余时间不足以完成承诺的专注时长。');
  if(input.acknowledged!==true)fail('请认真阅读并勾选时间承诺。');
  return task;
}
