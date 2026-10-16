import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {once} from 'node:events';
import {createApp} from '../server.mjs';
import {createClientServer,validateBackend} from '../clients/windows/proxy.mjs';

test('客户端代理使用内置界面、隔离来源、转发账号和服务器事件',async t=>{
  const backend=createApp({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'turtle-proxy-')),clockInterval:50});backend.listen(0,'127.0.0.1');await once(backend,'listening');
  const remote='http://127.0.0.1:'+backend.address().port;
  assert.throws(()=>validateBackend(remote));assert.throws(()=>validateBackend('https://evil.example/path'));assert.throws(()=>validateBackend('https://name:pass@example.com'));
  const proxy=createClientServer({publicDir:path.resolve('public'),backend:remote,allowLocal:true});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');const base='http://127.0.0.1:'+proxy.address().port;
  t.after(()=>{proxy.closeAllConnections();proxy.close();backend.closeAllConnections();backend.close();});
  assert.match(await (await fetch(base)).text(),/龟龟同频/);
  const foreign=await fetch(base+'/api/auth/register',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});assert.equal(foreign.status,403);
  const register=await fetch(base+'/api/auth/register',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:'native-user',password:'long-secret-123'})});assert.equal(register.status,200);const cookie=register.headers.get('set-cookie').split(';')[0];
  const created=await fetch(base+'/api/rooms',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',cookie},body:JSON.stringify({name:'本地客户端'})});assert.equal(created.status,200);
  const controller=new AbortController();t.after(()=>controller.abort());const stream=await fetch(base+'/api/events',{headers:{cookie},signal:controller.signal});const reader=stream.body.getReader();let text='';while(!text.includes('event: clock'))text+=new TextDecoder().decode((await reader.read()).value);assert.ok(text.includes('"serverNow"'));controller.abort();
  await fetch(base+'/api/logout',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',cookie},body:'{}'});assert.equal((await fetch(base+'/api/state',{headers:{cookie}})).status,401);
});
