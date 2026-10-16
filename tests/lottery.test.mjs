import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createApp} from '../server.mjs';
import {weekStart,weekTicket,validateTask,dayKey} from '../public/domain.js';

const time=Date.parse('2026-10-13T10:00:00+08:00'); // 2026-10-13 是周二
const DAY='2026-10-13',MONDAY='2026-10-12';
const input=(overrides={})=>({title:'阅读 20 页',quadrant:'plan',startDate:DAY,startTime:'10:00',deadlineDate:DAY,deadlineTime:'23:59',duration:0,repeat:'once',weekdays:[],acknowledged:true,...overrides});
async function fixture(t){
  let clock=time;
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'turtle-lottery-'));
  const server=createApp({allowGuest:true,dataDir,now:()=>clock});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  t.after(()=>{server.closeAllConnections();server.close();});
  async function call(route,data,cookie){const response=await fetch(base+'/api/'+route,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0],data:await response.json()};}
  const a=await call('rooms',{name:'小叶'});const b=await call('join',{name:'阿森',invite:a.data.room.invite});
  return {server,base,call,a,b,dataDir,setTime:n=>clock=n};
}
const dailyTask=(assignee='a')=>({...validateTask(input({repeat:'daily',until:'2026-10-14'}),time),id:'t',assignee});

test('周一起点定位与周全清判定：未完成、逾期、未来承诺、空周均不发券',()=>{
  assert.equal(weekStart('2026-10-13'),MONDAY);
  assert.equal(weekStart('2026-10-12'),MONDAY);
  assert.equal(weekStart('2026-10-11'),'2026-10-05'); // 周日属于上一周
  const member={id:'a',joinedAt:time};const task=dailyTask();
  // 周二当天任务未完成 → 本周未全清
  assert.equal(weekTicket({tasks:[task],records:{}},member,DAY,time),null);
  // 周二完成后，但周三（本周内）仍有承诺未到期 → 不能提前发券
  const doneTuesday={tasks:[task],records:{'t:2026-10-13:a':{status:'done'}}};
  assert.equal(weekTicket(doneTuesday,member,DAY,time),null);
  // 周三也完成（承诺已全部到期且完成）→ 发券，凭证为本周一
  const allDone={tasks:[task],records:{'t:2026-10-13:a':{status:'done'},'t:2026-10-14:a':{status:'done'}}};
  assert.equal(weekTicket(allDone,member,'2026-10-14',time+86400000),MONDAY);
  // 周二逾期（没做就过了截止）→ 本周作废
  const late=time+86400000;
  assert.equal(weekTicket({tasks:[task],records:{}},member,'2026-10-14',late),null);
  // 例外记录视同未完成
  assert.equal(weekTicket({tasks:[task],records:{'t:2026-10-13:a':{status:'exception',reason:'生病'},'t:2026-10-14:a':{status:'done'}}},member,'2026-10-14',late),null);
  // 空周（无任何承诺）→ 不发券
  assert.equal(weekTicket({tasks:[],records:{}},member,DAY,time),null);
});

test('全清自动发券、转盘消费券并记录；权限与校验完整',async t=>{
  const f=await fixture(t);
  // 奖品池：仅最早加入的房主可设置
  assert.equal((await f.call('lottery-prizes',{prizes:['a','b']},f.b.cookie)).status,403);
  assert.equal((await f.call('lottery-prizes',{prizes:['只有一项']},f.a.cookie)).status,400);
  assert.equal((await f.call('lottery-prizes',{prizes:['a','a']},f.a.cookie)).status,400);
  assert.equal((await f.call('lottery-prizes',{prizes:Array.from({length:13},(_,i)=>'奖'+i)},f.a.cookie)).status,400);
  assert.equal((await f.call('lottery-prizes',{prizes:['奶茶一杯',{label:'谢谢参与'},'早睡一晚']},f.a.cookie)).status,200);
  const prizes=(await f.call('state',undefined,f.a.cookie)).data.room.prizes;
  assert.equal(prizes.length,3);
  // 未完成、无券不能抽奖
  assert.equal((await f.call('lottery-spin',{},f.a.cookie)).status,409);
  assert.equal((await f.call('lottery-spin',{},f.b.cookie)).status,409);
  // 完成 → 领日奖 → 周券自动发放（周二完成，本周承诺已全部到期且完成）
  const created=await f.call('tasks',input(),f.a.cookie);const id=created.data.room.tasks[0].id;
  assert.equal((await f.call('task-action',{taskId:id,day:DAY,action:'complete'},f.a.cookie)).status,200);
  const rewarded=await f.call('reward',{day:DAY},f.a.cookie);
  assert.equal(rewarded.status,200);
  assert.equal(rewarded.data.tickets.length,1);
  assert.equal(rewarded.data.tickets[0].week,MONDAY);
  // 未完成的伙伴没有券
  assert.equal((await f.call('state',undefined,f.b.cookie)).data.tickets.length,0);
  // 抽奖消费券并公开记录（券留痕：标记 usedAt，不删除）
  const spin=await f.call('lottery-spin',{},f.a.cookie);
  assert.equal(spin.status,200);
  assert.equal(spin.data.tickets.length,1);
  assert.ok(spin.data.tickets[0].usedAt);
  assert.equal(spin.data.tickets.filter(t=>!t.usedAt).length,0);
  assert.equal(spin.data.room.spins.length,1);
  assert.ok(prizes.some(p=>p.id===spin.data.room.spins[0].prizeId));
  assert.ok(['奶茶一杯','谢谢参与','早睡一晚'].includes(spin.data.room.spins[0].prizeLabel));
  // 券已消费，不能连抽
  assert.equal((await f.call('lottery-spin',{},f.a.cookie)).status,409);
  // 同日重复领奖不重复发券（券已被使用也不重发）
  const again=await f.call('reward',{day:DAY},f.a.cookie);
  assert.equal(again.status,200);assert.equal(again.data.tickets.length,1);
  // 会话哈希不通过任何状态泄漏
  assert.ok(spin.data.room.members.every(m=>!('sessionHash'in m)&&!('tickets'in m)));
  // 数据落盘：prizes/spins/tickets 持久化
  const raw=JSON.parse(fs.readFileSync(path.join(f.dataDir,'rooms.json'),'utf8'));
  assert.equal(raw.rooms[0].prizes.length,3);
  assert.equal(raw.rooms[0].spins.length,1);
  assert.equal(raw.rooms[0].members[0].tickets.length,1); // 留痕
  assert.ok(raw.rooms[0].members[0].tickets[0].usedAt);
  assert.equal(raw.rooms[0].members[0].rewards.length,1);
});

test('周中有未完成的另一天承诺时，即使当天全清也不发券',async t=>{
  const f=await fixture(t);
  // 两个任务：周二的任务 + 周三截止的任务
  await f.call('tasks',input(),f.a.cookie);
  await f.call('tasks',input({title:'周三的承诺',startDate:'2026-10-14',deadlineDate:'2026-10-14'}),f.a.cookie);
  const tasks=(await f.call('state',undefined,f.a.cookie)).data.room.tasks;
  await f.call('task-action',{taskId:tasks[0].id,day:DAY,action:'complete'},f.a.cookie);
  const rewarded=await f.call('reward',{day:DAY},f.a.cookie);
  assert.equal(rewarded.status,200);
  assert.equal(rewarded.data.tickets.length,0); // 周三还有承诺没到期 → 不发
  // 周三完成后 → 发券
  f.setTime(time+86400000); // 周三 10:00
  const t2='2026-10-14T10:00:00+08:00';void t2;
  assert.equal((await f.call('task-action',{taskId:tasks[1].id,day:'2026-10-14',action:'complete'},f.a.cookie)).status,200);
  const rewarded2=await f.call('reward',{day:'2026-10-14'},f.a.cookie);
  assert.equal(rewarded2.status,200);
  assert.equal(rewarded2.data.tickets.length,1);
  assert.equal(rewarded2.data.tickets[0].week,MONDAY);
  assert.equal(dayKey(time+86400000),'2026-10-14');
});
