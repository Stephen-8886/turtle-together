import {seedAccount} from './browser-account-fixture.mjs';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {createApp} from '../server.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'C:/Users/HUAWEI/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output=path.resolve('test-results');fs.mkdirSync(output,{recursive:true});
let clock=Date.parse('2026-10-13T10:00:00+08:00');
const server=createApp({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'turtle-browser-')),now:()=>clock});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[];const results=[];
const capture=(page,name,fullPage=false)=>page.screenshot({path:path.join(output,name),fullPage,animations:'disabled',style:'#toast{visibility:hidden}'});
try{
  const a=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});const b=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
  const pa=await a.newPage(),pb=await b.newPage();for(const p of [pa,pb])p.on('pageerror',e=>errors.push(e.message));
  await seedAccount(pa,base,'browser-alice');await pa.goto(base);await pa.getByPlaceholder('伙伴怎么称呼你？').fill('小叶');await pa.getByRole('button',{name:'和龟龟一起出发'}).click();await pa.getByRole('heading',{name:'慢慢来，也在向前。'}).waitFor();results.push('创建小队');
  let sa=await pa.evaluate(()=>fetch('/api/state').then(r=>r.json()));
  await seedAccount(pb,base,'browser-bobby');await pb.goto(base+'/#join='+sa.room.invite);await pb.getByPlaceholder('伙伴怎么称呼你？').fill('阿森');await pb.getByRole('button',{name:'加入伙伴的小森林'}).click();await pb.getByRole('heading',{name:'慢慢来，也在向前。'}).waitFor();results.push('通过邀请加入另一独立会话');
  await pa.getByRole('button',{name:'＋ 添加一个小承诺',exact:true}).click();await pa.getByRole('textbox',{name:'任务名称',exact:true}).fill('认真阅读 20 页');await pa.locator('[name=duration]').fill('1');await pa.getByRole('checkbox',{name:/我已认真考虑/}).check();await pa.getByRole('button',{name:'确认承诺，种下任务',exact:true}).click();await pa.getByRole('button',{name:'确认提交',exact:true}).click();await pa.getByRole('button',{name:/认真阅读 20 页，/}).waitFor();results.push('填写并确认时间承诺');
  await pb.getByRole('button',{name:'同频小队',exact:true}).click();await pb.getByRole('article').filter({hasText:'小叶'}).getByRole('button',{name:'查看计划'}).click();await pb.getByRole('button',{name:/认真阅读 20 页，/}).waitFor();results.push('伙伴计划实时同步');
  await pb.getByRole('button',{name:'轻轻督促 小叶',exact:true}).click();await pa.getByText('阿森 来给你打气啦！').waitFor();assert.ok(await pa.locator('.nudge-card').evaluate(e=>e.getAnimations().length>0));await capture(pa,'nudge.png');await pa.getByRole('button',{name:'收到督促'}).click();results.push('双用户督促动画与已读');
  await pa.getByRole('button',{name:/认真阅读 20 页，/}).click();await pa.getByRole('button',{name:'开始专注',exact:true}).click();await pa.getByText(/剩余专注时间/).waitFor();assert.equal(await pa.locator('#focus-action').isDisabled(),true);await capture(pa,'focus.png');
  clock+=30000;await pa.reload();await pa.getByRole('button',{name:'回到专注',exact:true}).click();const timer=await pa.locator('#timer').textContent();assert.match(timer,/00:(29|30)/);results.push('刷新后专注计时继续');
  await pa.getByRole('button',{name:'▧ 风景轮播',exact:true}).click();await pa.locator('.scenery-photo').waitFor();const initial=await pa.locator('.scenery-photo').getAttribute('src');await pa.waitForFunction(first=>document.querySelector('.scenery-photo')?.getAttribute('src')!==first,initial,{timeout:15000});await capture(pa,'scenery.png');results.push('风景图片自动轮播');
  await pa.getByRole('button',{name:'选择自己的风景照片',exact:true}).click();await pa.locator('#photo-input').setInputFiles(path.resolve('public/assets/icon-192.png'));await pa.waitForFunction(()=>document.querySelector('.scenery-photo')?.getAttribute('src')?.startsWith('blob:'));
  await pa.reload();await pa.getByRole('button',{name:'回到专注',exact:true}).click();assert.ok((await pa.locator('.scenery-photo').getAttribute('src')).startsWith('blob:'));assert.equal(await pa.locator('.scenery-photo').evaluate(i=>i.complete&&i.naturalWidth===192),true);results.push('自选照片导入并在刷新后保留');
  await pa.getByRole('button',{name:'选择自己的风景照片',exact:true}).click();await pa.getByRole('button',{name:'恢复默认风景',exact:true}).click();await pa.waitForFunction(()=>document.querySelector('.scenery-photo')?.getAttribute('src')?.startsWith('/assets/scenery-'));
  await pa.getByRole('button',{name:'◉ 龟龟陪伴',exact:true}).click();await pa.emulateMedia({reducedMotion:'reduce'});assert.equal(await pa.locator('.focus-art').evaluate(e=>e.getAnimations().length),0);await pa.emulateMedia({reducedMotion:'no-preference'});results.push('遵循系统减少动态效果设置');
  clock+=31000;await pa.reload();await pa.getByRole('button',{name:'回到专注',exact:true}).click();await pa.getByRole('button',{name:'完成本次承诺',exact:true}).click();await pa.getByRole('heading',{name:'今天的你，说到做到。',exact:true}).waitFor();assert.ok(await pa.locator('.reward-art').evaluate(e=>e.getAnimations().length>0));await capture(pa,'reward.png');results.push('满足时长后完成并自动结算动画');
  if(await pa.locator('#dialog[open]').count())await pa.locator('#dialog [data-close]').click();await pa.getByRole('button',{name:'收好奖励，回到小森林',exact:true}).click();
  // Keep the fixture date after reloads even when the host clock crosses midnight.
  await pa.locator('#browse-date').fill('2026-10-13');
  // Additional task data populates all four quadrants; creation still uses the same validated API.
  const extra=[['do','完成项目提案',0],['do','整理会议资料',25],['plan','学习一节英语',20],['delegate','回复合作邮件',0],['relax','整理桌面',5]];
  for(const [quadrant,title,duration] of extra){const r=await pa.evaluate(async data=>{const r=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};},{title,quadrant,duration,startDate:'2026-10-13',startTime:'',deadlineDate:'2026-10-13',deadlineTime:'23:59',repeat:'daily',weekdays:[],acknowledged:true});assert.equal(r.status,200);}
  await pa.getByRole('button',{name:/整理桌面，/}).waitFor();await capture(pa,'home.png',true);
  await pa.getByRole('button',{name:'＋ 添加一个小承诺',exact:true}).click();await pa.getByRole('radio',{name:'每周几',exact:true}).check();await pa.getByRole('checkbox',{name:'二',exact:true}).check();await pa.getByRole('checkbox',{name:'四',exact:true}).check();await pa.getByRole('textbox',{name:'任务名称',exact:true}).fill('周二周四锻炼');await pa.locator('[name=duration]').fill('10');await pa.getByRole('checkbox',{name:/我已认真考虑/}).check();await capture(pa,'add.png',true);await pa.getByRole('button',{name:'确认承诺，种下任务',exact:true}).click();await pa.getByRole('button',{name:'确认提交',exact:true}).click();await pa.getByRole('button',{name:/周二周四锻炼，/}).waitFor();results.push('每周多选安排');
  await pa.getByRole('button',{name:'同频小队',exact:true}).click();await capture(pa,'team.png',true);
  for(const width of [320,360,390,768,1280]){await pa.setViewportSize({width,height:900});const overflow=await pa.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,'horizontal overflow at '+width);}results.push('320–1280px 无横向溢出');
  await pa.setViewportSize({width:390,height:844});await pa.getByRole('button',{name:'今日计划',exact:true}).click();
  const assets=await pa.locator('img').evaluateAll(imgs=>imgs.map(i=>({src:i.getAttribute('src'),ok:i.complete&&i.naturalWidth>0,w:i.getBoundingClientRect().width,h:i.getBoundingClientRect().height})));assert.ok(assets.every(i=>i.ok));results.push('本地 Figma 素材加载与尺寸验证');
  await pa.evaluate(()=>navigator.serviceWorker.ready);await a.setOffline(true);await pa.reload();await pa.getByText('暂时离线，当前显示上次同步的计划。重新连接后才能提交或完成任务。').waitFor();results.push('PWA 离线启动及只读快照');await a.setOffline(false);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({passed:results,errors,assets},null,2));console.log(JSON.stringify({passed:results,errors,assets},null,2));
}finally{await browser.close();server.closeAllConnections();server.close();}
