import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createApp} from '../server.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/HUAWEI/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
let clock=Date.parse('2026-10-16T10:00:00+08:00');const server=createApp({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'turtle-win-backend-')),now:()=>clock,clockInterval:100});server.listen(0,'127.0.0.1');await once(server,'listening');const backend='http://127.0.0.1:'+server.address().port;
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'turtle-win-profile-'));fs.writeFileSync(path.join(profile,'server.txt'),backend);
const out=path.resolve('test-results/windows');fs.mkdirSync(out,{recursive:true});
const executable=path.resolve('dist/windows/TurtleTogether/TurtleTogether.exe');
const client=spawn(executable,[],{windowsHide:true,env:{...process.env,TURTLE_CLIENT_DATA_DIR:profile,TURTLE_CLIENT_TEST_HIDDEN:'1',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9227'}});
let browser;const errors=[],checks=[];
try{
  for(let i=0;i<60;i++){try{const result=await fetch('http://127.0.0.1:9227/json/version');if(result.ok())break;}catch{}await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.connectOverCDP('http://127.0.0.1:9227');const context=browser.contexts()[0];let page=context.pages()[0];if(!page)page=await context.waitForEvent('page');page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('button',{name:'注册账号',exact:true}).click();await page.locator('[name=username]').fill('native-turtle');await page.locator('[name=password]').fill('native-secret-123');await page.getByPlaceholder('伙伴怎么称呼你？').fill('桌面龟');await page.getByRole('button',{name:'注册，和龟龟一起出发',exact:true}).click();await page.getByRole('button',{name:'和龟龟一起出发',exact:true}).click();await page.locator('.nav').waitFor();checks.push('真实 Windows exe 启动、内置 UI、注册与建队');
  await page.evaluate(()=>fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'桌面专注',quadrant:'plan',startDate:'2026-10-16',deadlineDate:'2026-10-16',deadlineTime:'23:59',duration:1,repeat:'once',acknowledged:true})}));await page.getByRole('button',{name:/桌面专注，/}).click();await page.getByRole('button',{name:'开始专注',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#focus-action')?.textContent==='专注中，请走完承诺的时间');clock+=30000;await page.waitForFunction(()=>document.querySelector('#timer')?.textContent==='00:30');checks.push('本地客户端通过代理接收服务器时间推送');await page.screenshot({path:path.join(out,'focus.png')});
  await page.getByRole('button',{name:'💬 一起聊聊',exact:true}).click();await page.getByRole('button',{name:'＋ 新建一个话题',exact:true}).click();await page.getByRole('textbox',{name:'话题名称',exact:true}).fill('桌面聊天');await page.getByRole('button',{name:'开始讨论',exact:true}).click();await page.locator('#message-text').fill('来自 exe 的消息');await page.getByRole('button',{name:'发送 ↑',exact:true}).click();await page.getByText('来自 exe 的消息',{exact:true}).waitFor();checks.push('exe 文字聊天留痕');
  await page.getByRole('link',{name:'导出 PDF ↗',exact:true}).click();let popup;for(let i=0;i<100;i++){popup=context.pages().find(p=>!p.isClosed()&&p.url().includes('/export'));if(popup)break;await new Promise(r=>setTimeout(r,100));}assert.ok(popup,'原生窗口应显示导出页');await popup.getByText('来自 exe 的消息',{exact:true}).waitFor();await popup.screenshot({path:path.join(out,'export.png')});checks.push('exe 内部打开完整聊天导出窗口');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser?.close();await new Promise(resolve=>{const stop=spawn('taskkill',['/PID',String(client.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});stop.on('exit',resolve);});server.closeAllConnections();server.close();}
