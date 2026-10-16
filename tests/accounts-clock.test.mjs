import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createApp} from '../server.mjs';

const start=Date.parse('2026-10-16T10:00:00+08:00');
async function fixture(t){
  let clock=start;const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'turtle-accounts-'));
  let server=createApp({dataDir,now:()=>clock,clockInterval:30});server.listen(0,'127.0.0.1');await once(server,'listening');let base='http://127.0.0.1:'+server.address().port;
  t.after(()=>{server.closeAllConnections();server.close();});
  async function call(route,data,cookie){const r=await fetch(base+'/api/'+route,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const register=(username)=>call('auth/register',{username,password:'long-secret-123',name:username});
  async function restart(){server.closeAllConnections();server.close();server=createApp({dataDir,now:()=>clock,clockInterval:30});server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;}
  return {call,register,dataDir,restart,setTime:v=>clock=v,get base(){return base;}};
}
const task={title:'服务器计时',quadrant:'plan',startDate:'2026-10-16',deadlineDate:'2026-10-16',deadlineTime:'10:02',duration:1,repeat:'once',acknowledged:true};

test('默认要求账号；密码哈希、跨设备身份恢复、服务端注销撤销',async t=>{
  const f=await fixture(t);assert.equal((await f.call('rooms',{name:'匿名'})).status,401);
  assert.equal((await f.call('auth/register',{username:'abc',password:'short'})).status,400);
  const a=await f.register('alice');assert.equal(a.status,200);assert.equal(a.data.account.username,'alice');assert.deepEqual(a.data.teams,[]);
  assert.equal((await f.register('ALICE')).status,409);
  const room=await f.call('rooms',{name:'阿龟'},a.cookie);const memberId=room.data.me;
  const login=await f.call('auth/login',{username:'ALICE',password:'long-secret-123'});assert.equal(login.data.me,memberId);assert.equal(login.data.room.id,room.data.room.id);
  const raw=fs.readFileSync(path.join(f.dataDir,'rooms.json'),'utf8');assert.ok(!raw.includes('long-secret-123'));assert.ok(!raw.includes(a.cookie.split('=')[1]));assert.ok(!JSON.stringify(login.data).includes('sessionHash'));assert.ok(!JSON.stringify(login.data).includes('password'));
  assert.equal((await f.call('auth/login',{username:'alice',password:'wrong'})).status,401);
  await f.call('auth/logout',{},login.cookie);assert.equal((await f.call('state',undefined,login.cookie)).status,401);assert.equal((await f.call('state',undefined,a.cookie)).status,200);
  await f.restart();assert.equal((await f.call('state',undefined,a.cookie)).data.me,memberId);
});

test('团队隔离、重复加入保留身份、切换限制和被移出后失去权限',async t=>{
  const f=await fixture(t),a=await f.register('alice'),b=await f.register('bobby');
  const ra=await f.call('rooms',{name:'阿龟',roomName:'A队'},a.cookie),rb=await f.call('rooms',{name:'小龟',roomName:'B队'},b.cookie);
  const created=await f.call('tasks',task,a.cookie),id=created.data.room.tasks[0].id;
  assert.equal((await f.call('task-action',{taskId:id,day:'2026-10-16',action:'start'},b.cookie)).status,403);
  assert.equal((await f.call('switch-team',{roomId:ra.data.room.id},b.cookie)).status,403);
  const joined=await f.call('join',{name:'伙伴',invite:ra.data.room.shortCode},b.cookie);assert.equal(joined.data.teams.length,2);
  const again=await f.call('join',{name:'别名',invite:ra.data.room.invite},b.cookie);assert.equal(again.data.me,joined.data.me);assert.equal(again.data.room.members.length,2);
  assert.equal((await f.call('task-action',{taskId:id,day:'2026-10-16',action:'start'},b.cookie)).status,403,'同队成员也不能操作别人的任务');
  const switched=await f.call('switch-team',{roomId:rb.data.room.id},b.cookie);assert.equal(switched.data.room.tasks.length,0);
  await f.call('switch-team',{roomId:ra.data.room.id},b.cookie);await f.call('kick',{to:joined.data.me},a.cookie);
  const removed=await f.call('state',undefined,b.cookie);assert.equal(removed.data.room,undefined);assert.equal(removed.data.teams.length,1);
  assert.equal((await f.call('switch-team',{roomId:ra.data.room.id},b.cookie)).status,403);
});

test('时间和操作许可由服务器生成；拒绝伪造时间，离开及重启后恢复',async t=>{
  const f=await fixture(t),a=await f.register('alice');await f.call('rooms',{name:'阿龟'},a.cookie);
  const created=await f.call('tasks',task,a.cookie),id=created.data.room.tasks[0].id,me=created.data.me;
  let state=created.data.timeline.days['2026-10-16'][me].states[id];assert.equal(state.canStart,true);assert.equal(state.canComplete,false);
  await f.call('task-action',{taskId:id,day:'2026-10-16',action:'start',startedAt:0},a.cookie);
  assert.equal((await f.call('task-action',{taskId:id,day:'2026-10-16',action:'complete',now:start+999999,remaining:0},a.cookie)).status,400);
  f.setTime(start+30000);await f.restart();let timeline=(await f.call('timeline',undefined,a.cookie)).data;state=timeline.days['2026-10-16'][me].states[id];assert.equal(state.displayRemaining,30000);assert.equal(state.startedAt,start);assert.equal(state.canComplete,false);
  f.setTime(start+60000);state=(await f.call('timeline',undefined,a.cookie)).data.days['2026-10-16'][me].states[id];assert.equal(state.canComplete,true);
  assert.equal((await f.call('task-action',{taskId:id,day:'2026-10-16',action:'complete'},a.cookie)).status,200);
  const exp=await f.call('tasks',{...task,title:'逾期'},a.cookie),eid=exp.data.room.tasks.at(-1).id;
  f.setTime(start+120001);state=(await f.call('timeline',undefined,a.cookie)).data.days['2026-10-16'][me].states[eid];assert.equal(state.status,'expired');assert.equal(state.canComplete,false);
  assert.equal((await f.call('task-action',{taskId:eid,day:'2026-10-16',action:'complete'},a.cookie)).status,409);
});

test('没有页面操作时 SSE 时钟仍推送到时状态；注销关闭流',async t=>{
  const f=await fixture(t),a=await f.register('alice');await f.call('rooms',{name:'阿龟'},a.cookie);const created=await f.call('tasks',task,a.cookie),id=created.data.room.tasks[0].id,me=created.data.me;
  await f.call('task-action',{taskId:id,day:'2026-10-16',action:'start'},a.cookie);
  const ctrl=new AbortController();t.after(()=>ctrl.abort());const response=await fetch(f.base+'/api/events',{headers:{cookie:a.cookie},signal:ctrl.signal});const reader=response.body.getReader();let buffer='';
  async function next(){while(!buffer.includes('\n\n')){const r=await reader.read();if(r.done)return null;buffer+=new TextDecoder().decode(r.value);}const i=buffer.indexOf('\n\n'),event=buffer.slice(0,i);buffer=buffer.slice(i+2);return event;}
  await next();f.setTime(start+60000);let tick;do{tick=await next();}while(!tick?.startsWith('event: clock')||!JSON.parse(tick.split('data: ')[1]).days['2026-10-16'][me].states[id].canComplete);
  assert.ok(tick.includes('"displayRemaining":0'));await f.call('auth/logout',{},a.cookie);while(await next()){};
});

test('旧设备身份绑定账号保留成员 ID、记录和团队；旧凭据失效',async t=>{
  const f=await fixture(t);const guest=createApp({dataDir:f.dataDir,now:()=>start,allowGuest:true});guest.listen(0,'127.0.0.1');await once(guest,'listening');
  const r=await fetch('http://127.0.0.1:'+guest.address().port+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'旧伙伴'})}),old=await r.json(),cookie=r.headers.get('set-cookie').split(';')[0];guest.closeAllConnections();guest.close();await f.restart();
  const linked=await f.call('auth/link',{username:'old-turtle',password:'long-secret-123'},cookie);assert.equal(linked.data.me,old.me);assert.equal(linked.data.room.id,old.room.id);
  assert.equal((await f.call('state',undefined,cookie)).status,401);assert.equal((await f.call('auth/login',{username:'old-turtle',password:'long-secret-123'})).data.me,old.me);
});

test('改密码撤销其它设备；会话到期；跨源和暴力请求被拒绝',async t=>{
  const f=await fixture(t),a=await f.register('alice'),b=await f.call('auth/login',{username:'alice',password:'long-secret-123'});
  const changed=await f.call('auth/password',{currentPassword:'long-secret-123',password:'new-long-secret-456'},a.cookie);assert.equal(changed.status,200);assert.equal((await f.call('state',undefined,b.cookie)).status,401);
  assert.equal((await f.call('auth/login',{username:'alice',password:'long-secret-123'})).status,401);
  const cross=await fetch(f.base+'/api/auth/register',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({})});assert.equal(cross.status,403);
  for(let i=0;i<30;i++)await f.call('auth/login',{username:'alice',password:'x'.repeat(129)});
  assert.equal((await f.call('auth/login',{username:'alice',password:'new-long-secret-456'})).status,429);
  f.setTime(start+31*86400000);assert.equal((await f.call('state',undefined,changed.cookie)).status,401);
});
