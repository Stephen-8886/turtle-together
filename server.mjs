import http from 'node:http';
import {randomBytes,randomInt,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dayKey,validDay,isDue,occurrence,occurrenceDay,occurrenceKey,settlement,validateTask,weekTicket,weekStart,dietWeekCount} from './public/domain.js';
import {createCommunity,topicView} from './community-server.mjs';
import {createAuth} from './auth-server.mjs';
import {timeline,taskState} from './server-clock.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const token=()=>randomBytes(24).toString('base64url');
const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);};
export function createApp({dataDir=process.env.DATA_DIR||path.join(root,'data'),now=()=>Date.now(),allowGuest=false,clockInterval=1000}={}){
  fs.mkdirSync(dataDir,{recursive:true});
  const filename=path.join(dataDir,'rooms.json');
  const db=fs.existsSync(filename)?JSON.parse(fs.readFileSync(filename,'utf8')):{rooms:[]};
  // 6 位短同步码：去混淆字符集（无 I/O/0/1/L），旧数据加载时自动补齐
  const codeChars='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const newCode=()=>{let c='';for(let i=0;i<6;i++)c+=codeChars[randomInt(codeChars.length)];return c;};
  const uniqueCode=()=>{let c;do{c=newCode();}while(db.rooms.some(r=>r.shortCode===c));return c;};
  for(const r of db.rooms)if(!r.shortCode)r.shortCode=uniqueCode();
  const community=createCommunity({dataDir,now});
  const clients=new Map();const limits=new Map();
  const save=()=>{fs.writeFileSync(filename+'.tmp',JSON.stringify(db));fs.renameSync(filename+'.tmp',filename);};
  const error=(status,message)=>Object.assign(new Error(message),{status});
  const memberView=m=>({id:m.id,name:m.name,joinedAt:m.joinedAt,dnd:m.dnd});
  const snapshot=(room,member,context={},selection={})=>({...(auth.summary(context)),serverNow:now(),timeline:timeline(room,now(),selection),me:member.id,room:{id:room.id,name:room.name,invite:room.invite,shortCode:room.shortCode,members:room.members.map(memberView),tasks:room.tasks,records:room.records,topics:(room.topics||[]).map(topicView),expenses:room.expenses||[],prizes:room.prizes||[],spins:room.spins||[],fit:room.fit||{},fitPrizes:room.fitPrizes||[],fitSpins:room.fitSpins||[]},inbox:room.nudges.filter(n=>n.to===member.id&&!n.readAt),rewards:member.rewards,tickets:member.tickets||[],fitTickets:member.fitTickets||[]});
  const broadcast=room=>{for(const c of clients.values())if(c.room===room){c.res.write(`data: ${JSON.stringify(snapshot(room,c.member,c.context,c.selection))}\n\n`);}};
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const body=async(req,max=20000)=>{const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>max)throw error(413,'内容太长。');chunks.push(b);}try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!value||Array.isArray(value)||typeof value!=='object')throw new Error();return value;}catch{throw error(400,'请求格式错误。');}};
  const closeSessions=digest=>{for(const [id,c] of clients)if(c.context.sessionHash===digest){c.res.end();clients.delete(id);}};
  const auth=createAuth({db,now,save,send,closeSessions});
  const selection=url=>({day:url.searchParams.get('day'),focusDay:url.searchParams.get('focusDay')});
  const login=(res,room,member,credential,req)=>{const secure=req.socket.encrypted||req.headers['x-forwarded-proto']==='https';res.setHeader('Set-Cookie',`turtle_session=${credential}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure?'; Secure':''}`);save();broadcast(room);send(res,200,snapshot(room,member));};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    try{
      const protocol=req.socket.encrypted||(process.env.TRUST_PROXY==='1'&&req.headers['x-forwarded-proto']==='https')?'https':'http';
      const url=new URL(req.url,protocol+'://'+(req.headers.host||'localhost'));
      if(url.pathname.startsWith('/api/')){
        if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==url.origin)throw error(403,'请求来源不匹配。');
        if(req.method==='POST'&&url.pathname.startsWith('/api/auth/')){
          const key='auth:'+req.socket.remoteAddress;const window=limits.get(key)||{count:0,start:now()};if(now()-window.start>900000){window.count=0;window.start=now();}if(++window.count>30)throw error(429,'账号操作太频繁，请 15 分钟后重试。');limits.set(key,window);
        }
        if(await auth.handle({req,res,url,body,snapshot}))return;
        if(req.method==='POST'&&['/api/rooms','/api/join'].includes(url.pathname)){
          let context;try{context=auth.identify(req);}catch(e){if(!allowGuest)throw e;}
          if(!allowGuest&&!context?.account)throw error(403,'请先绑定账号，再创建或加入小队。');
          const key=req.socket.remoteAddress;const window=limits.get(key)||{count:0,start:now()};if(now()-window.start>60000){window.count=0;window.start=now();}if(++window.count>30)throw error(429,'操作太频繁，稍后再试。');limits.set(key,window);
          const input=await body(req);if(context?.account&&auth.identify(req).session!==context.session)throw error(401,'登录已改变，请重试。');const name=String(input.name||'').trim();if(!name||name.length>20)throw error(400,'请填写 1–20 字的昵称。');
          let room;if(url.pathname==='/api/rooms'){const roomName=String(input.roomName||'小森林自律小队').trim();if(!roomName||roomName.length>40)throw error(400,'小队名称最多 40 字。');room={id:randomUUID(),name:roomName,invite:token(),shortCode:uniqueCode(),members:[],tasks:[],records:{},nudges:[],prizes:[],spins:[]};db.rooms.push(room);}else{const code=String(input.invite||'').trim();room=db.rooms.find(r=>equal(r.invite,code)||r.shortCode===code.toUpperCase());if(!room)throw error(404,'同步码无效，请向伙伴核对后重试。');if(room.members.length>=50)throw error(400,'这个小队已有 50 位伙伴。');}
          if(context?.account){let member=room.members.find(m=>m.accountId===context.account.id);if(!member){member={id:randomUUID(),accountId:context.account.id,name,joinedAt:now(),dnd:false,rewards:[],tickets:[]};room.members.push(member);}context.session.roomId=room.id;closeSessions(context.sessionHash);save();broadcast(room);send(res,200,snapshot(room,member,context,selection(url)));return;}
          const credential=token();const member={id:randomUUID(),name,joinedAt:now(),sessionHash:hash(credential),dnd:false,rewards:[],tickets:[]};room.members.push(member);login(res,room,member,credential,req);return;
        }
        const context=auth.identify(req);const {room,member}=context;
        if(req.method==='GET'&&url.pathname==='/api/state'){send(res,200,member?snapshot(room,member,context,selection(url)):auth.summary(context));return;}
        if(req.method==='POST'&&url.pathname==='/api/switch-team'){
          if(!context.account)throw error(403,'请先绑定账号。');const input=await body(req);const target=db.rooms.find(r=>r.id===input.roomId&&r.members.some(m=>m.accountId===context.account.id));if(!target)throw error(403,'你尚未加入这个小队。');context.session.roomId=target.id;closeSessions(context.sessionHash);save();send(res,200,snapshot(target,target.members.find(m=>m.accountId===context.account.id),context,selection(url)));return;
        }
        if(!room||!member)throw error(403,'请先选择、创建或加入小队。');
        if(req.method==='GET'&&url.pathname==='/api/timeline'){send(res,200,timeline(room,now(),selection(url)));return;}
        if(req.method==='GET'&&url.pathname==='/api/events'){
          res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
          const id=randomUUID();const chosen=selection(url);clients.set(id,{room,member,res,context,selection:chosen});res.write(`data: ${JSON.stringify(snapshot(room,member,context,chosen))}\n\n`);req.on('close',()=>clients.delete(id));return;
        }
        const authorize=()=>{const current=auth.identify(req);if(current.member!==member)throw error(403,'小队身份已改变，请重新打开。');};
        const handled=await community({req,res,url,room,member,body,send,authorize});
        if(handled){if(!handled.sent){if(handled.changed){save();broadcast(room);}send(res,200,snapshot(room,member,context,selection(url)));}return;}
        if(req.method!=='POST')throw error(404,'没有这个操作。');
        const input=await body(req);
        authorize();
        if(url.pathname==='/api/tasks/validate'){send(res,200,{task:validateTask(input,now())});return;}
        if(url.pathname==='/api/tasks'){
          if(room.tasks.length>=2000)throw error(400,'这个小队的承诺已满。');
          const task=validateTask(input,now());task.id=randomUUID();task.owner=member.id;task.assignee=task.assignee==='all'?'all':member.id;task.createdAt=now();room.tasks.push(task);
        }else if(url.pathname==='/api/task-action'){
          const task=room.tasks.find(t=>t.id===input.taskId);const day=input.day;
          if(!task||!validDay(day)||!isDue(task,day,member))throw error(403,'这不是你当天的任务。');
          const key=occurrenceKey(task,day,member.id);const state=taskState(room,task,day,member,now());
          if(input.action==='exception'){
            if(['done','exception'].includes(state.status))throw error(409,'本次任务已结算。');const reason=String(input.reason||'').trim();if(reason.length<2||reason.length>200)throw error(400,'请填写 2–200 字的例外原因。');if(day>dayKey(now()))throw error(400,'只能记录今天或过去的例外。');room.records[key]={...room.records[key],status:'exception',reason,exceptionAt:now()};
          }else{
            // For an overnight / multi-day task, a still-open occurrence may continue next day.
            if(day!==dayKey(now()) && !(occurrenceDay(task,day)<dayKey(now())&&now()<=state.end))throw error(400,'只能操作当前有效的任务。');
            if(['done','exception','expired'].includes(state.status))throw error(409,'本次任务已完成、逾期或记录例外。');
            if(input.action==='start'){
              if(state.end-now()<task.duration*60000&&!state.startedAt)throw error(400,'截止前时间已不足，请如实记录例外。');
              if(!state.startedAt)room.records[key]={startedAt:now()};
            }else if(input.action==='complete'){
              if(task.duration>0&&(!state.startedAt||state.remaining>0))throw error(400,'请先走完承诺的专注时长。');
              room.records[key]={...room.records[key],status:'done',completedAt:now()};
            }else throw error(400,'未知任务操作。');
          }
        }else if(url.pathname==='/api/kick'){
          const target=room.members.find(m=>m.id===input.to);if(!target)throw error(404,'伙伴不在小队里。');if(target.id===member.id)throw error(400,'不能移出自己；如需离开请用「我的小窝 → 切换小队」。');
          const host=room.members.slice().sort((a,b)=>a.joinedAt-b.joinedAt)[0];if(host.id!==member.id)throw error(403,'只有房主可以移出伙伴。');
          room.members=room.members.filter(m=>m.id!==target.id);
          for(const [cid,c] of clients)if(c.member.id===target.id){try{c.res.end();}catch{}clients.delete(cid);}
        }else if(url.pathname==='/api/fit-log'){
          // 身材管理：锻炼按天打卡（toggle）；轻食按顿累加（一天最多 3 顿，可减）
          const kind=input.kind==='workout'?'workout':'diet';const day=dayKey(now());
          room.fit=room.fit||{};const log=room.fit[member.id]=room.fit[member.id]||{diet:[],workout:[],issued:{}};
          if(kind==='workout'){const arr=log.workout;const i=arr.indexOf(day);if(i>=0)arr.splice(i,1);else arr.push(day);}
          else{const dm=log.dietMap=log.dietMap||{};const cur=dm[day]||0;
            if(input.op==='minus'){if(cur>0){dm[day]=cur-1;if(dm[day]<=0)delete dm[day];}}
            else{if(cur>=3)throw error(400,'一天最多记录 3 顿轻食哦。');dm[day]=cur+1;}}
          if(kind==='diet'){const wk=weekStart(day);const today=dayKey(now());const goal=log.goal||5;
            const count=dietWeekCount(log,wk,today);
            if(!log.issued[wk]&&count>=goal){log.issued[wk]=true;(member.fitTickets=member.fitTickets||[]).push({id:randomUUID(),week:wk,at:now()});}}
        }else if(url.pathname==='/api/fit-goal'){
          const g=Math.round(Number(input.goal));if(!(g>=1&&g<=21))throw error(400,'每周轻食目标请设 1–21 次。');
          room.fit=room.fit||{};const log=room.fit[member.id]=room.fit[member.id]||{diet:[],workout:[],issued:{}};log.goal=g;
          // 调低目标后若本周已达标且未发过券，立即发放（旧数组+新顿数表合并计数）
          const wk=weekStart(dayKey(now()));const today=dayKey(now());const countG=dietWeekCount(log,wk,today);if(!log.issued[wk]&&countG>=g){log.issued[wk]=true;(member.fitTickets=member.fitTickets||[]).push({id:randomUUID(),week:wk,at:now()});}
        }else if(url.pathname==='/api/fit-prizes'){
          const owner=room.members.slice().sort((x,y)=>x.joinedAt-y.joinedAt)[0];if(owner.id!==member.id)throw error(403,'只有小队里最早加入的伙伴可以设置身材转盘奖品。');
          const list=Array.isArray(input.prizes)?input.prizes:[];if(list.length<2||list.length>12)throw error(400,'请设置 2–12 个奖品。');
          const prizes=[];const seen=new Set();
          for(const item of list){const label=String(item?.label??item??'').trim();if(!label||label.length>30)throw error(400,'奖品名称应为 1–30 个字。');if(seen.has(label))throw error(400,'奖品名称不能重复：'+label);seen.add(label);prizes.push({id:randomUUID(),label});}
          room.fitPrizes=prizes;
        }else if(url.pathname==='/api/fit-spin'){
          if(!room.fitPrizes||room.fitPrizes.length<2)throw error(409,'身材转盘的奖品还没准备好。');
          const tickets=member.fitTickets||(member.fitTickets=[]);const ticket=tickets.find(t=>!t.usedAt);if(!ticket)throw error(409,'还没有可用的身材转盘券：吃满本周轻食目标即可获得。');
          const prize=room.fitPrizes[randomInt(room.fitPrizes.length)];ticket.usedAt=now();
          room.fitSpins=room.fitSpins||[];room.fitSpins.push({id:randomUUID(),memberId:member.id,prizeId:prize.id,prizeLabel:prize.label,at:now(),week:weekStart(dayKey(now()))});room.fitSpins=room.fitSpins.slice(-500);
        }else if(url.pathname==='/api/nudge'){
          const target=room.members.find(m=>m.id===input.to);if(!target||target===member)throw error(400,'请选择另一位伙伴。');if(target.dnd)throw error(409,'伙伴正在免打扰，晚点再为 TA 打气。');
          const last=room.nudges.findLast(n=>n.from===member.id&&n.to===target.id);if(last&&now()-last.at<60000)throw error(429,`请再等 ${Math.ceil((60000-(now()-last.at))/1000)} 秒，给伙伴一点空间。`);
          room.nudges.push({id:randomUUID(),from:member.id,to:target.id,at:now()});room.nudges=room.nudges.slice(-2000);
        }else if(url.pathname==='/api/read-nudges'){
          for(const n of room.nudges)if(n.to===member.id&&Array.isArray(input.ids)&&input.ids.includes(n.id))n.readAt=now();
        }else if(url.pathname==='/api/profile'){
          if(typeof input.dnd==='boolean')member.dnd=input.dnd;
          if(typeof input.name==='string'){const name=input.name.trim();if(!name||name.length>20)throw error(400,'昵称应为 1–20 字。');member.name=name;}
        }else if(url.pathname==='/api/lottery-prizes'){
          const owner=room.members.slice().sort((x,y)=>x.joinedAt-y.joinedAt)[0];if(owner.id!==member.id)throw error(403,'只有小队里最早加入的伙伴可以设置转盘奖品。');
          const list=Array.isArray(input.prizes)?input.prizes:[];if(list.length<2||list.length>12)throw error(400,'请设置 2–12 个转盘奖品。');
          const prizes=[];const seen=new Set();
          for(const item of list){const label=String(item?.label??item??'').trim();if(!label||label.length>30)throw error(400,'奖品名称应为 1–30 个字。');if(seen.has(label))throw error(400,'奖品名称不能重复：'+label);seen.add(label);prizes.push({id:randomUUID(),label});}
          room.prizes=prizes;
        }else if(url.pathname==='/api/lottery-spin'){
          if(!room.prizes||room.prizes.length<2)throw error(400,'转盘奖品还没准备好，请房主先设置。');
          const tickets=member.tickets||(member.tickets=[]);const ticket=tickets.find(t=>!t.usedAt);if(!ticket)throw error(409,'还没有可用的抽奖券：完成一周内的全部承诺即可获得。');
          const prize=room.prizes[randomInt(room.prizes.length)];ticket.usedAt=now();
          room.spins=room.spins||[];room.spins.push({id:randomUUID(),memberId:member.id,prizeId:prize.id,prizeLabel:prize.label,at:now(),week:weekStart(dayKey(now()))});room.spins=room.spins.slice(-2000);
        }else if(url.pathname==='/api/reward'){
          if(input.day!==dayKey(now()))throw error(400,'只结算今天的承诺。');const result=settlement(room,member,input.day,now());if(!result.ready)throw error(409,'完成当天全部承诺后，再来领取小叶子。');const key=`${input.day}:${result.signature}`;if(!member.rewards.some(r=>r.key===key))member.rewards.push({key,day:input.day,at:now(),minutes:result.minutes,count:result.total});
          const tickets=member.tickets||(member.tickets=[]);const week=weekTicket(room,member,input.day,now());if(week&&!tickets.some(t=>t.week===week))tickets.push({week,at:now()});
        }else if(url.pathname==='/api/logout'){
          auth.revoke(context);auth.setCookie(req,res,'',0);save();send(res,200,{ok:true});return;
        }else throw error(404,'没有这个操作。');
        save();broadcast(room);send(res,200,snapshot(room,member,context,selection(url)));return;
      }
      if(!['GET','HEAD'].includes(req.method))throw error(405,'不支持这个请求。');
      const pathname=decodeURIComponent(url.pathname);const publicDir=path.join(root,'public');const file=path.resolve(publicDir,'.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(publicDir+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())throw error(404,'页面不存在。');
      const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.woff2':'font/woff2'};
      res.writeHead(200,{'Content-Type':(types[path.extname(file)]||'application/octet-stream')+'; charset=utf-8','Cache-Control':pathname==='/sw.js'?'no-cache':'public, max-age=0'});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
    }catch(e){send(res,e.status||400,{error:e.message});}
  });
  const ticker=setInterval(()=>{for(const [id,c] of clients){if(!auth.isValid(c.context.sessionHash)||!c.room.members.includes(c.member)||(c.context.session&&c.context.session.roomId!==c.room.id)){c.res.end();clients.delete(id);continue;}if(!c.res.writableNeedDrain)c.res.write(`event: clock\ndata: ${JSON.stringify(timeline(c.room,now(),c.selection))}\n\n`);}},clockInterval);ticker.unref();
  server.on('close',()=>{clearInterval(ticker);for(const c of clients.values())c.res.end();clients.clear();});
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||4173);createApp().listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`龟龟同频 · http://localhost:${port} · 数据保存在 ${process.env.DATA_DIR||path.join(root,'data')}`));
}
