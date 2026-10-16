import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createApp} from '../server.mjs';
import {validateTask,dayKey,addDays,isDue,occurrence,settlement,dietWeekCount} from '../public/domain.js';

const time=Date.parse('2026-10-13T10:00:00+08:00');
const input=(overrides={})=>({title:'阅读 20 页',quadrant:'plan',startDate:'2026-10-13',startTime:'10:00',deadlineDate:'2026-10-13',deadlineTime:'23:59',duration:1,repeat:'once',weekdays:[],acknowledged:true,...overrides});
async function fixture(t){
  let clock=time;
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'turtle-test-'));
  const server=createApp({allowGuest:true,dataDir,now:()=>clock});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  t.after(()=>{server.closeAllConnections();server.close();});
  async function call(route,data,cookie){const response=await fetch(base+'/api/'+route,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0],data:await response.json()};}
  const a=await call('rooms',{name:'小叶'});const b=await call('join',{name:'阿森',invite:a.data.room.invite});
  return {server,base,call,a,b,dataDir,setTime:n=>clock=n};
}
test('北京时间、每天和指定星期独立生成任务',()=>{
  assert.equal(dayKey(Date.parse('2026-10-12T18:00:00Z')),'2026-10-13');assert.equal(addDays('2026-12-31',1),'2027-01-01');
  const member={id:'a',joinedAt:time};const weekly={...validateTask(input({repeat:'weekly',weekdays:[2,4]}),time),id:'t',assignee:'a'};
  assert.ok(isDue(weekly,'2026-10-13',member));assert.ok(!isDue(weekly,'2026-10-14',member));assert.ok(isDue(weekly,'2026-10-15',member));
  const daily={...weekly,repeat:'daily',until:'2026-10-16'};assert.ok(isDue(daily,'2026-10-14',member));assert.ok(!isDue(daily,'2026-10-17',member));
  const records={'t:2026-10-13:a':{status:'done'}};assert.equal(occurrence(daily,'2026-10-14','a',records,time).status,'pending');
});
test('拒绝无确认、无效日期、过去截止、不够专注时间和空星期',()=>{
  for(const override of [{acknowledged:false},{startDate:'2026-02-30'},{deadlineTime:'09:59'},{deadlineTime:'10:01',duration:2},{repeat:'weekly',weekdays:[]},{repeat:'weekly',weekdays:[9]},{duration:-1},{duration:1.5}])assert.throws(()=>validateTask(input(override),time));
  const cross=validateTask(input({repeat:'daily',startTime:'23:00',deadlineTime:'01:00',overnight:true,duration:60}),time);assert.equal(cross.overnight,true);
  const once=validateTask(input({until:'2026-10-13',deadlineDate:'2026-10-15'}),time);assert.equal(once.until,'');
});
test('持续时间由服务器强制执行，刷新不会重置计时，提交后不能修改',async t=>{
  const f=await fixture(t);const created=await f.call('tasks',input(),f.a.cookie);assert.equal(created.status,200);const id=created.data.room.tasks[0].id;
  const action=action=>f.call('task-action',{taskId:id,day:'2026-10-13',action},f.a.cookie);
  assert.equal((await action('complete')).status,400);await action('start');f.setTime(time+30000);assert.equal((await action('complete')).status,400);
  const refreshed=await f.call('state',undefined,f.a.cookie);const record=Object.values(refreshed.data.room.records)[0];assert.equal(record.startedAt,time);
  assert.equal((await f.call('tasks/'+id,{duration:0},f.a.cookie)).status,404);
  f.setTime(time+60000);assert.equal((await action('complete')).status,200);assert.equal((await action('complete')).status,409);
});
test('不能操作别人的计划；可以提前开始；逾期不能完成',async t=>{
  const f=await fixture(t);const created=await f.call('tasks',input({duration:0,startTime:'11:00',deadlineTime:'12:00'}),f.a.cookie);const id=created.data.room.tasks[0].id;
  assert.equal((await f.call('task-action',{taskId:id,day:'2026-10-13',action:'complete'},f.b.cookie)).status,403);
  assert.equal((await f.call('task-action',{taskId:id,day:'2026-10-13',action:'start'},f.a.cookie)).status,200,'允许在承诺开始时间之前提前开始');
  f.setTime(time+3*3600000);assert.equal((await f.call('task-action',{taskId:id,day:'2026-10-13',action:'complete'},f.a.cookie)).status,409);
});
test('全员任务按人结算，未全部完成不能领取奖励，奖励幂等',async t=>{
  const f=await fixture(t);const created=await f.call('tasks',input({duration:0,assignee:'all'}),f.a.cookie);const id=created.data.room.tasks[0].id;
  assert.equal((await f.call('reward',{day:'2026-10-13'},f.a.cookie)).status,409);
  await f.call('task-action',{taskId:id,day:'2026-10-13',action:'complete'},f.a.cookie);
  const b=await f.call('state',undefined,f.b.cookie);assert.equal(settlement(b.data.room,b.data.room.members.find(m=>m.id===b.data.me),'2026-10-13',time).done,0);
  await f.call('reward',{day:'2026-10-13'},f.a.cookie);const reward=await f.call('reward',{day:'2026-10-13'},f.a.cookie);assert.equal(reward.data.rewards.length,1);
  assert.equal((await f.call('reward',{day:'2026-10-13'},f.b.cookie)).status,409);
});
test('督促送达目标成员、冷却 60 秒、支持免打扰与离线未读',async t=>{
  const f=await fixture(t);assert.equal((await f.call('nudge',{to:f.b.data.me},f.a.cookie)).status,200);
  assert.equal((await f.call('nudge',{to:f.b.data.me},f.a.cookie)).status,429);
  const b=await f.call('state',undefined,f.b.cookie);assert.equal(b.data.inbox.length,1);assert.equal(b.data.inbox[0].from,f.a.data.me);
  const a=await f.call('state',undefined,f.a.cookie);assert.equal(a.data.inbox.length,0);
  await f.call('read-nudges',{ids:b.data.inbox.map(n=>n.id)},f.b.cookie);assert.equal((await f.call('state',undefined,f.b.cookie)).data.inbox.length,0);
  f.setTime(time+60000);await f.call('profile',{dnd:true},f.b.cookie);assert.equal((await f.call('nudge',{to:f.b.data.me},f.a.cookie)).status,409);
  await f.call('profile',{dnd:false},f.b.cookie);assert.equal((await f.call('nudge',{to:f.b.data.me},f.a.cookie)).status,200);
});
test('两个用户通过 SSE 实时收到任务与督促',async t=>{
  const f=await fixture(t);const controller=new AbortController();t.after(()=>controller.abort());
  const response=await fetch(f.base+'/api/events',{headers:{Cookie:f.b.cookie},signal:controller.signal});const reader=response.body.getReader();
  let buffer='';async function next(){while(!buffer.includes('\n\n')){const {value,done}=await reader.read();if(done)throw new Error('SSE unexpectedly ended');buffer+=new TextDecoder().decode(value);}const idx=buffer.indexOf('\n\n');const item=buffer.slice(0,idx);buffer=buffer.slice(idx+2);return JSON.parse(item.slice(6));}
  assert.equal((await next()).me,f.b.data.me);await f.call('tasks',input({duration:0}),f.a.cookie);assert.equal((await next()).room.tasks[0].title,'阅读 20 页');
  await f.call('nudge',{to:f.b.data.me},f.a.cookie);assert.equal((await next()).inbox.length,1);controller.abort();
});
test('异常记录保留原始承诺，数据在服务重启后仍存在',async t=>{
  const f=await fixture(t);const created=await f.call('tasks',input(),f.a.cookie);const task=created.data.room.tasks[0];
  await f.call('task-action',{taskId:task.id,day:'2026-10-13',action:'exception',reason:'临时生病，需要休息'},f.a.cookie);
  const saved=JSON.parse(fs.readFileSync(path.join(f.dataDir,'rooms.json'),'utf8'));assert.equal(saved.rooms[0].tasks[0].duration,1);assert.equal(Object.values(saved.rooms[0].records)[0].status,'exception');
  const restarted=createApp({allowGuest:true,dataDir:f.dataDir,now:()=>time});restarted.listen(0,'127.0.0.1');await once(restarted,'listening');t.after(()=>{restarted.closeAllConnections();restarted.close();});
  const response=await fetch('http://127.0.0.1:'+restarted.address().port+'/api/state',{headers:{Cookie:f.a.cookie}});const result=await response.json();assert.equal(result.room.tasks[0].id,task.id);assert.equal(Object.values(result.room.records)[0].reason,'临时生病，需要休息');
});
test('房间隔离、会话信息不会出现在公开状态，跨域修改被拒绝',async t=>{
  const f=await fixture(t);assert.equal((await f.call('state')).status,401);assert.ok(f.a.cookie.includes('turtle_session='));
  assert.ok(f.a.data.room.members.every(m=>!('sessionHash'in m)));const other=await f.call('rooms',{name:'另一小队'});
  assert.equal((await f.call('nudge',{to:f.a.data.me},other.cookie)).status,400);
  const cross=await fetch(f.base+'/api/profile',{method:'POST',headers:{Cookie:f.a.cookie,Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({name:'changed'})});assert.equal(cross.status,403);
  const traversal=await fetch(f.base+'/%2e%2e%2fserver.mjs');assert.equal(traversal.status,404);
});

test('轻食周计数：旧数组与新顿数表兼容合并',()=>{
  const wk='2026-10-12',today='2026-10-15';
  const legacy={diet:['2026-10-12','2026-10-14'],workout:[],issued:{}};
  assert.equal(dietWeekCount(legacy,wk,today),2);
  const modern={diet:[],dietMap:{'2026-10-14':3,'2026-10-15':1},workout:[],issued:{}};
  assert.equal(dietWeekCount(modern,wk,today),4);
  const mixed={diet:['2026-10-13'],dietMap:{'2026-10-15':2,'2026-10-09':5},workout:[],issued:{}};
  assert.equal(dietWeekCount(mixed,wk,today),3,'旧数组1+本周map2=3，上周记录不计');
});
