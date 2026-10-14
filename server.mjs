import http from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dayKey,validDay,isDue,occurrence,occurrenceDay,occurrenceKey,settlement,validateTask} from './public/domain.js';
import {createCommunity,topicView} from './community-server.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const token=()=>randomBytes(24).toString('base64url');
const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);};
export function createApp({dataDir=process.env.DATA_DIR||path.join(root,'data'),now=()=>Date.now()}={}){
  fs.mkdirSync(dataDir,{recursive:true});
  const filename=path.join(dataDir,'rooms.json');
  const db=fs.existsSync(filename)?JSON.parse(fs.readFileSync(filename,'utf8')):{rooms:[]};
  const community=createCommunity({dataDir,now});
  const clients=new Map();const limits=new Map();
  const save=()=>{fs.writeFileSync(filename+'.tmp',JSON.stringify(db));fs.renameSync(filename+'.tmp',filename);};
  const error=(status,message)=>Object.assign(new Error(message),{status});
  const memberView=m=>({id:m.id,name:m.name,joinedAt:m.joinedAt,dnd:m.dnd});
  const snapshot=(room,member)=>({serverNow:now(),me:member.id,room:{id:room.id,name:room.name,invite:room.invite,members:room.members.map(memberView),tasks:room.tasks,records:room.records,topics:(room.topics||[]).map(topicView),expenses:room.expenses||[]},inbox:room.nudges.filter(n=>n.to===member.id&&!n.readAt),rewards:member.rewards});
  const broadcast=room=>{for(const c of clients.values())if(c.room===room){c.res.write(`data: ${JSON.stringify(snapshot(room,c.member))}\n\n`);}};
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const body=async(req,max=20000)=>{const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>max)throw error(413,'内容太长。');chunks.push(b);}try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!value||Array.isArray(value)||typeof value!=='object')throw new Error();return value;}catch{throw error(400,'请求格式错误。');}};
  const auth=req=>{const session=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('turtle_session='))?.slice(15);if(!session)throw error(401,'请先创建或加入小队。');for(const room of db.rooms){const member=room.members.find(m=>equal(m.sessionHash,hash(session)));if(member)return {room,member};}throw error(401,'登录已失效，请重新加入。');};
  const login=(res,room,member,credential,req)=>{const secure=req.socket.encrypted||req.headers['x-forwarded-proto']==='https';res.setHeader('Set-Cookie',`turtle_session=${credential}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure?'; Secure':''}`);save();broadcast(room);send(res,200,snapshot(room,member));};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    try{
      const protocol=req.socket.encrypted||(process.env.TRUST_PROXY==='1'&&req.headers['x-forwarded-proto']==='https')?'https':'http';
      const url=new URL(req.url,protocol+'://'+(req.headers.host||'localhost'));
      if(url.pathname.startsWith('/api/')){
        if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==url.origin)throw error(403,'请求来源不匹配。');
        if(req.method==='POST'&&['/api/rooms','/api/join'].includes(url.pathname)){
          const key=req.socket.remoteAddress;const window=limits.get(key)||{count:0,start:now()};if(now()-window.start>60000){window.count=0;window.start=now();}if(++window.count>30)throw error(429,'操作太频繁，稍后再试。');limits.set(key,window);
          const input=await body(req);const name=String(input.name||'').trim();if(!name||name.length>20)throw error(400,'请填写 1–20 字的昵称。');
          let room;if(url.pathname==='/api/rooms'){const roomName=String(input.roomName||'小森林自律小队').trim();if(!roomName||roomName.length>40)throw error(400,'小队名称最多 40 字。');room={id:randomUUID(),name:roomName,invite:token(),members:[],tasks:[],records:{},nudges:[]};db.rooms.push(room);}else{room=db.rooms.find(r=>equal(r.invite,String(input.invite||'')));if(!room)throw error(404,'邀请无效，请向伙伴索取新的邀请。');if(room.members.length>=50)throw error(400,'这个小队已有 50 位伙伴。');}
          const credential=token();const member={id:randomUUID(),name,joinedAt:now(),sessionHash:hash(credential),dnd:false,rewards:[]};room.members.push(member);login(res,room,member,credential,req);return;
        }
        const {room,member}=auth(req);
        if(req.method==='GET'&&url.pathname==='/api/state'){send(res,200,snapshot(room,member));return;}
        if(req.method==='GET'&&url.pathname==='/api/events'){
          res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
          const id=randomUUID();clients.set(id,{room,member,res});res.write(`data: ${JSON.stringify(snapshot(room,member))}\n\n`);const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),20000);req.on('close',()=>{clearInterval(heartbeat);clients.delete(id);});return;
        }
        const handled=await community({req,res,url,room,member,body,send});
        if(handled){if(!handled.sent){if(handled.changed){save();broadcast(room);}send(res,200,snapshot(room,member));}return;}
        if(req.method!=='POST')throw error(404,'没有这个操作。');
        const input=await body(req);
        if(url.pathname==='/api/tasks'){
          if(room.tasks.length>=2000)throw error(400,'这个小队的承诺已满。');
          const task=validateTask(input,now());task.id=randomUUID();task.owner=member.id;task.assignee=task.assignee==='all'?'all':member.id;task.createdAt=now();room.tasks.push(task);
        }else if(url.pathname==='/api/task-action'){
          const task=room.tasks.find(t=>t.id===input.taskId);const day=input.day;
          if(!task||!validDay(day)||!isDue(task,day,member))throw error(403,'这不是你当天的任务。');
          const key=occurrenceKey(task,day,member.id);const state=occurrence(task,day,member.id,room.records,now());
          if(input.action==='exception'){
            if(['done','exception'].includes(state.status))throw error(409,'本次任务已结算。');const reason=String(input.reason||'').trim();if(reason.length<2||reason.length>200)throw error(400,'请填写 2–200 字的例外原因。');if(day>dayKey(now()))throw error(400,'只能记录今天或过去的例外。');room.records[key]={...room.records[key],status:'exception',reason,exceptionAt:now()};
          }else{
            // For an overnight / multi-day task, a still-open occurrence may continue next day.
            if(day!==dayKey(now()) && !(occurrenceDay(task,day)<dayKey(now())&&now()<=state.end))throw error(400,'只能操作当前有效的任务。');
            if(['done','exception','expired'].includes(state.status))throw error(409,'本次任务已完成、逾期或记录例外。');
            if(now()<state.start)throw error(400,'还没到承诺的开始时间。');
            if(input.action==='start'){
              if(state.end-now()<task.duration*60000&&!state.startedAt)throw error(400,'截止前时间已不足，请如实记录例外。');
              if(!state.startedAt)room.records[key]={startedAt:now()};
            }else if(input.action==='complete'){
              if(task.duration>0&&(!state.startedAt||state.remaining>0))throw error(400,'请先走完承诺的专注时长。');
              room.records[key]={...room.records[key],status:'done',completedAt:now()};
            }else throw error(400,'未知任务操作。');
          }
        }else if(url.pathname==='/api/nudge'){
          const target=room.members.find(m=>m.id===input.to);if(!target||target===member)throw error(400,'请选择另一位伙伴。');if(target.dnd)throw error(409,'伙伴正在免打扰，晚点再为 TA 打气。');
          const last=room.nudges.findLast(n=>n.from===member.id&&n.to===target.id);if(last&&now()-last.at<60000)throw error(429,`请再等 ${Math.ceil((60000-(now()-last.at))/1000)} 秒，给伙伴一点空间。`);
          room.nudges.push({id:randomUUID(),from:member.id,to:target.id,at:now()});room.nudges=room.nudges.slice(-2000);
        }else if(url.pathname==='/api/read-nudges'){
          for(const n of room.nudges)if(n.to===member.id&&Array.isArray(input.ids)&&input.ids.includes(n.id))n.readAt=now();
        }else if(url.pathname==='/api/profile'){
          if(typeof input.dnd==='boolean')member.dnd=input.dnd;
          if(typeof input.name==='string'){const name=input.name.trim();if(!name||name.length>20)throw error(400,'昵称应为 1–20 字。');member.name=name;}
        }else if(url.pathname==='/api/reward'){
          if(input.day!==dayKey(now()))throw error(400,'只结算今天的承诺。');const result=settlement(room,member,input.day,now());if(!result.ready)throw error(409,'完成当天全部承诺后，再来领取小叶子。');const key=`${input.day}:${result.signature}`;if(!member.rewards.some(r=>r.key===key))member.rewards.push({key,day:input.day,at:now(),minutes:result.minutes,count:result.total});
        }else if(url.pathname==='/api/logout'){
          res.setHeader('Set-Cookie','turtle_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');send(res,200,{ok:true});return;
        }else throw error(404,'没有这个操作。');
        save();broadcast(room);send(res,200,snapshot(room,member));return;
      }
      if(!['GET','HEAD'].includes(req.method))throw error(405,'不支持这个请求。');
      const pathname=decodeURIComponent(url.pathname);const publicDir=path.join(root,'public');const file=path.resolve(publicDir,'.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(publicDir+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())throw error(404,'页面不存在。');
      const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.woff2':'font/woff2'};
      res.writeHead(200,{'Content-Type':(types[path.extname(file)]||'application/octet-stream')+'; charset=utf-8','Cache-Control':pathname==='/sw.js'?'no-cache':'public, max-age=0'});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
    }catch(e){send(res,e.status||400,{error:e.message});}
  });
  server.on('close',()=>{for(const c of clients.values())c.res.end();clients.clear();});
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||4173);createApp().listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`龟龟同频 · http://localhost:${port} · 数据保存在 ${process.env.DATA_DIR||path.join(root,'data')}`));
}
