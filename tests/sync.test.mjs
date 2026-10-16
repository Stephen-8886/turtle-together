import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createApp} from '../server.mjs';

const time=Date.parse('2026-10-13T10:00:00+08:00');
async function fixture(t,seed){
  let clock=time;
  const dataDir=seed?fs.mkdtempSync(path.join(os.tmpdir(),'turtle-sync-')):fs.mkdtempSync(path.join(os.tmpdir(),'turtle-sync-'));
  if(seed)fs.writeFileSync(path.join(dataDir,'rooms.json'),JSON.stringify(seed));
  const server=createApp({allowGuest:true,dataDir,now:()=>clock});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  t.after(()=>{server.closeAllConnections();server.close();});
  async function call(route,data,cookie){const response=await fetch(base+'/api/'+route,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});const setCookie=response.headers.get('set-cookie')||'';let json=null;try{json=await response.json();}catch{}return {status:response.status,data:json,cookie:setCookie.split(';')[0]||undefined};}
  const a=await call('rooms',{name:'阿龟',roomName:'第一小队'});
  const b=await call('rooms',{name:'小龟',roomName:'第二小队'});
  return {base,call,a,b,dataDir,setClock:v=>clock=v};
}

test('建房自动生成 6 位同步码：无混淆字符、两队不重复',async t=>{
  const f=await fixture(t);
  const c1=f.a.data.room.shortCode,c2=f.b.data.room.shortCode;
  assert.match(c1,/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  assert.notEqual(c1,c2);
  assert.ok(!/[IO0L1]/.test(c1),'同步码不应包含易混淆字符');
  assert.ok(f.a.data.room.invite.length>30,'长邀请码仍然保留');
});

test('同步码（大小写不敏感）与长邀请码均可加入同一小队并实时共享',async t=>{
  const f=await fixture(t);
  const c1=f.a.data.room.shortCode;
  // 小写输入短码加入
  const join1=await f.call('join',{name:'同步伙伴',invite:c1.toLowerCase()});
  assert.equal(join1.status,200);
  assert.equal(join1.data.room.id,f.a.data.room.id);
  assert.equal(join1.data.room.members.length,2);
  // 长邀请码加入仍然可用
  const join2=await f.call('join',{name:'链接伙伴',invite:f.a.data.room.invite});
  assert.equal(join2.status,200);
  assert.equal(join2.data.room.id,f.a.data.room.id);
  // 第一小队现在 3 人，第二小队不受影响
  assert.equal((await f.call('state',undefined,f.a.cookie)).data.room.members.length,3);
  assert.equal((await f.call('state',undefined,f.b.cookie)).data.room.members.length,1);
  // 无效同步码
  assert.equal((await f.call('join',{name:'走错门',invite:'ZZZZZZ'})).status,404);
  assert.equal((await f.call('join',{name:'空码',invite:''})).status,404);
});

test('旧数据（无同步码字段）加载时自动补齐并持久化',async t=>{
  const seed={rooms:[{id:'old-room',name:'旧小队',invite:'old_invite_token_value',members:[],tasks:[],records:{},nudges:[]}]};
  const f=await fixture(t,seed);
  const raw=JSON.parse(fs.readFileSync(path.join(f.dataDir,'rooms.json'),'utf8'));
  assert.match(raw.rooms[0].shortCode,/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  // 用补齐的同步码也能加入旧小队
  const join=await f.call('join',{name:'新伙伴',invite:raw.rooms[0].shortCode});
  assert.equal(join.status,200);
  assert.equal(join.data.room.id,'old-room');
});

test('房主可移出伙伴（移出后立即失去访问权），非房主无权移出',async t=>{
  const f=await fixture(t);
  const aId=f.a.data.me;
  const joinB=await f.call('join',{name:'伙伴君',invite:f.a.data.room.shortCode},f.b.cookie);
  const bId=joinB.data.me;
  assert.equal(joinB.status,200);
  assert.equal((await f.call('kick',{to:aId},joinB.cookie)).status,403,'非房主不能移出');
  assert.equal((await f.call('kick',{to:aId},f.a.cookie)).status,400,'不能移出自己');
  const kick=await f.call('kick',{to:bId},f.a.cookie);
  assert.equal(kick.status,200);
  assert.equal((await f.call('state',undefined,f.a.cookie)).data.room.members.length,1);
  assert.equal((await f.call('state',undefined,joinB.cookie)).status,401,'被移出者应 401');
});

test('承诺开始时间之前的任务可以提前开始专注',async t=>{
  const f=await fixture(t);
  const created=await f.call('tasks',{title:'晚间专注',quadrant:'plan',startDate:'2026-10-13',deadlineDate:'2026-10-13',startTime:'23:00',deadlineTime:'23:59',duration:10,repeat:'once',acknowledged:true,assignee:'self'},f.a.cookie);
  assert.equal(created.status,200);
  const id=created.data.room.tasks[0].id;
  const start=await f.call('task-action',{taskId:id,day:'2026-10-13',action:'start'},f.a.cookie);
  assert.equal(start.status,200,'startTime 23:00 而当前 10:00 应允许提前开始');
  const st=await f.call('state',undefined,f.a.cookie);
  assert.ok(JSON.stringify(st.data.room.records).includes('startedAt'),'服务端应记录 startedAt');
});

test('身材管理：轻食打卡可取消，达标发券每周限一次，与幸运转盘券独立',async t=>{
  const f=await fixture(t);
  const room=f.a.data.room;
  // 设奖品（房主 a）
  const prizes=await f.call('fit-prizes',{prizes:['无糖奶茶','电影之夜','谢谢参与']},f.a.cookie);
  assert.equal(prizes.status,200);
  // 目标 2 次
  assert.equal((await f.call('fit-goal',{goal:2},f.a.cookie)).status,200);
  // 顿数制：同一天可累加。记 1 顿不发（goal=2）
  await f.call('fit-log',{kind:'diet'},f.a.cookie);
  assert.equal((await f.call('state',undefined,f.a.cookie)).data.fitTickets.length,0);
  // 同一天第 2 顿 → 达标发券
  await f.call('fit-log',{kind:'diet'},f.a.cookie);
  assert.equal((await f.call('state',undefined,f.a.cookie)).data.fitTickets.length,1,'同一天两顿即达标');
  // 第 3 顿（未发新券，每周限 1 张）
  await f.call('fit-log',{kind:'diet'},f.a.cookie);
  // 第 4 顿 → 拒绝（一天上限 3）
  assert.equal((await f.call('fit-log',{kind:'diet'},f.a.cookie)).status,400,'一天最多 3 顿');
  // 减一顿 → 今天 2 顿
  await f.call('fit-log',{kind:'diet',op:'minus'},f.a.cookie);
  const st2=await f.call('state',undefined,f.a.cookie);
  assert.equal(st2.data.room.fit[st2.data.me].dietMap['2026-10-13'],2,'减一顿生效');
  // 推进到次日再记一顿（跨天仍正常累计）
  f.setClock(Date.parse('2026-10-14T10:00:00+08:00'));
  await f.call('fit-log',{kind:'diet'},f.a.cookie);
  const st=await f.call('state',undefined,f.a.cookie);
  assert.equal(st.data.fitTickets.length,1,'达标应发 1 张身材转盘券');
  // 取消再打卡（issued 已标记）→ 不重复发
  await f.call('fit-log',{kind:'diet'},f.a.cookie);
  await f.call('fit-log',{kind:'diet'},f.a.cookie);
  assert.equal((await f.call('state',undefined,f.a.cookie)).data.fitTickets.length,1,'每周最多 1 张');
  // 锻炼打卡不影响券
  await f.call('fit-log',{kind:'workout'},f.a.cookie);
  assert.equal((await f.call('state',undefined,f.a.cookie)).data.fitTickets.length,1);
  // 锻炼 toggle 取消 → workout 数组回 0
  await f.call('fit-log',{kind:'workout'},f.a.cookie);
  const st3=await f.call('state',undefined,f.a.cookie);
  assert.equal(st3.data.room.fit[st3.data.me].workout.length,0,'锻炼打卡可取消');
  // 幸运转盘券（lottery）不受影响：fitTickets 与 tickets 独立
  assert.equal(st3.data.tickets.length,0,'幸运转盘券应为 0');
  // 抽奖：扣券 + fitSpins 记录
  const preSpin=await f.call('state',undefined,f.a.cookie);
  const spin=await f.call('fit-spin',{},f.a.cookie);
  assert.equal(spin.status,200);
  const st4=await f.call('state',undefined,f.a.cookie);
  assert.equal(st4.data.fitTickets.filter(t=>!t.usedAt).length,0,'抽奖后券被核销');
  assert.equal(st4.data.room.fitSpins.length,1);
  assert.ok(st4.data.room.fitSpins[0].prizeLabel);
  // 无券再抽 → 409
  assert.equal((await f.call('fit-spin',{},f.a.cookie)).status,409);
  // 目标越界
  assert.equal((await f.call('fit-goal',{goal:0},f.a.cookie)).status,400);
  assert.equal((await f.call('fit-goal',{goal:22},f.a.cookie)).status,400);
  // 奖品个数校验
  assert.equal((await f.call('fit-prizes',{prizes:['只有一个']},f.a.cookie)).status,400);
  // 非房主（b 加入 a 的小队后）不能设奖品
  const joinB=await f.call('join',{name:'伙伴君',invite:f.a.data.room.shortCode},f.b.cookie);
  assert.equal(joinB.status,200);
  assert.equal((await f.call('fit-prizes',{prizes:['a','b']},joinB.cookie)).status,403);
});
