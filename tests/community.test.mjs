import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';
import {validateExpense,expenseSummary} from '../public/community-domain.js';
const time=Date.parse('2026-10-13T10:00:00+08:00');
const expense=(more={})=>({title:'午餐',amount:'12.30',category:'餐饮',date:'2026-10-13',clientId:randomUUID(),...more});
async function fixture(t){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'turtle-community-'));const server=createApp({allowGuest:true,dataDir,now:()=>time});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  t.after(()=>{server.closeAllConnections();server.close();});
  const call=async(route,data,cookie)=>{const r=await fetch(base+'/api/'+route,{method:data===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,cookie:r.headers.get('set-cookie')?.split(';')[0],data:await r.json()};};
  const a=await call('rooms',{name:'小叶'}),b=await call('join',{name:'阿森',invite:a.data.room.invite}),other=await call('rooms',{name:'隔壁'});
  const topic=await call('topics',{title:'周末计划 <script>',description:'一起好好讨论',clientId:randomUUID()},a.cookie);
  return {server,dataDir,base,call,a,b,other,id:topic.data.room.topics[0]?.id};
}
test('人民币整数分计算、月份/成员/分类统计和输入边界',()=>{
  const a=validateExpense(expense({amount:'0.10'}),time),b=validateExpense(expense({amount:'0.20'}),time);
  assert.equal(a.cents+b.cents,30);
  for(const more of [{amount:'0'},{amount:'-1'},{amount:'1.001'},{amount:'1e3'},{amount:'10000000'},{date:'2026-02-30'},{date:'2026-10-14'},{category:'unknown'},{title:' '}])assert.throws(()=>validateExpense(expense(more),time));
  const summary=expenseSummary([{...a,owner:'a',createdAt:1},{...b,owner:'b',createdAt:2},{...b,owner:'a',date:'2026-09-13',createdAt:3}],{month:'2026-10'});
  assert.equal(summary.total,30);assert.equal(summary.byMember.a,10);assert.equal(summary.byCategory['餐饮'],30);
  assert.equal(expenseSummary(summary.rows,{month:'2026-10',member:'b',category:'餐饮'}).total,20);
});
test('双方话题文字聊天、幂等重试、分页、房间隔离和转义导出',async t=>{
  const f=await fixture(t);assert.ok(f.id);
  const input={type:'text',text:'明天一起出发 <img src=x onerror=alert(1)>',clientId:randomUUID()};
  assert.equal((await f.call(`topics/${f.id}/messages`,input,f.a.cookie)).status,200);
  await f.call(`topics/${f.id}/messages`,input,f.a.cookie);
  await f.call(`topics/${f.id}/messages`,{...input,text:'好的！',clientId:randomUUID()},f.b.cookie);
  const got=await f.call(`topics/${f.id}/messages`,undefined,f.b.cookie);assert.equal(got.data.messages.length,2);assert.equal(got.data.messages[1].owner,f.b.data.me);
  assert.equal((await f.call(`topics/${f.id}/messages?after=1`,undefined,f.a.cookie)).data.messages.length,1);
  assert.equal((await f.call(`topics/${f.id}/messages?before=2`,undefined,f.a.cookie)).data.messages.length,1);
  assert.equal((await f.call(`topics/${f.id}/messages`,input,f.other.cookie)).status,404);
  assert.equal((await f.call(`topics/${f.id}/messages`,{...input,text:''},f.b.cookie)).status,400);
  const exported=await fetch(f.base+`/api/topics/${f.id}/export`,{headers:{cookie:f.a.cookie}});const html=await exported.text();assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('好的！'));assert.ok(!html.includes('<img src=x'));
  assert.equal((await fetch(f.base+`/api/topics/${f.id}/export`,{headers:{cookie:f.other.cookie}})).status,404);
  assert.equal((await fetch(f.base+`/api/topics/${f.id}/export`)).status,401);
  const state=await f.call('state',undefined,f.a.cookie);assert.equal(state.data.room.topics[0].count,2);assert.ok(!JSON.stringify(state.data).includes('onerror')); // Only the latest preview is sent, no entire message history.
});
test('语音受保护保存、播放范围、下载、验证与持久化',async t=>{
  const f=await fixture(t);const bytes=Buffer.alloc(100);bytes.write('RIFF',0);bytes.write('WAVE',8);
  const input={type:'audio',audio:bytes.toString('base64'),mime:'audio/wav',duration:2,text:'语音备注',clientId:randomUUID()};
  assert.equal((await f.call(`topics/${f.id}/messages`,input,f.a.cookie)).status,200);
  const messages=(await f.call(`topics/${f.id}/messages`,undefined,f.b.cookie)).data.messages,id=messages[0].id;
  const play=await fetch(f.base+'/api/audio/'+id,{headers:{cookie:f.b.cookie,Range:'bytes=0-11'}});assert.equal(play.status,206);assert.equal((await play.arrayBuffer()).byteLength,12);
  const download=await fetch(f.base+'/api/audio/'+id+'?download=1',{headers:{cookie:f.a.cookie}});assert.match(download.headers.get('content-disposition'),/attachment/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
  assert.equal((await fetch(f.base+'/api/audio/'+id,{headers:{cookie:f.other.cookie}})).status,404);assert.equal((await fetch(f.base+'/api/audio/'+id)).status,401);
  for(const more of [{duration:121},{mime:'text/html'},{audio:Buffer.from('<html>dangerous</html>').toString('base64')},{audio:'!bad'},{audio:Buffer.alloc(5*1024*1024+1).toString('base64')}])assert.ok((await f.call(`topics/${f.id}/messages`,{...input,...more,clientId:randomUUID()},f.a.cookie)).status>=400);
  assert.ok(fs.existsSync(path.join(f.dataDir,'media',id+'.wav')));
  const saved=JSON.parse(fs.readFileSync(path.join(f.dataDir,'rooms.json')));assert.equal(saved.rooms[0].topics[0].messages[0].id,id);assert.ok(!JSON.stringify(saved).includes(input.audio));
});
test('账单同步、幂等、本人修改删除权限和并发版本检查',async t=>{
  const f=await fixture(t),input=expense();let result=await f.call('expenses',input,f.a.cookie);const e=result.data.room.expenses[0];
  await f.call('expenses',input,f.a.cookie);assert.equal((await f.call('state',undefined,f.b.cookie)).data.room.expenses.length,1);
  const edit={...expense({amount:'18.88'}),version:1,action:'update'};
  assert.equal((await f.call('expenses/'+e.id,edit,f.b.cookie)).status,403);assert.equal((await f.call('expenses/'+e.id,edit,f.other.cookie)).status,404);
  result=await f.call('expenses/'+e.id,edit,f.a.cookie);assert.equal(result.data.room.expenses[0].cents,1888);assert.equal(result.data.room.expenses[0].version,2);
  assert.equal((await f.call('expenses/'+e.id,edit,f.a.cookie)).status,409);
  assert.equal((await f.call('expenses/'+e.id,{action:'delete',version:2},f.b.cookie)).status,403);
  assert.equal((await f.call('expenses/'+e.id,{action:'delete',version:2},f.a.cookie)).data.room.expenses.length,0);
});
test('旧数据兼容，重启后话题、文字、账单与会话仍然可用',async t=>{
  const f=await fixture(t);await f.call(`topics/${f.id}/messages`,{type:'text',text:'明天见',clientId:randomUUID()},f.a.cookie);await f.call('expenses',expense(),f.b.cookie);
  f.server.closeAllConnections();await new Promise(resolve=>f.server.close(resolve));
  const saved=JSON.parse(fs.readFileSync(path.join(f.dataDir,'rooms.json')));delete saved.rooms[1].topics;delete saved.rooms[1].expenses;fs.writeFileSync(path.join(f.dataDir,'rooms.json'),JSON.stringify(saved));
  const restarted=createApp({allowGuest:true,dataDir:f.dataDir});restarted.listen(0,'127.0.0.1');await once(restarted,'listening');t.after(()=>{restarted.closeAllConnections();restarted.close();});const base='http://127.0.0.1:'+restarted.address().port;
  const read=async(route,cookie)=>(await fetch(base+'/api/'+route,{headers:{cookie}})).json();
  const state=await read('state',f.a.cookie);assert.equal(state.room.expenses[0].cents,1230);assert.equal(state.room.topics[0].count,1);assert.equal((await read(`topics/${f.id}/messages`,f.b.cookie)).messages[0].text,'明天见');
  const old=await read('state',f.other.cookie);assert.deepEqual(old.room.topics,[]);assert.deepEqual(old.room.expenses,[]);
});
