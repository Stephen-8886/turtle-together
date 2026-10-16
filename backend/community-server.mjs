import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateExpense} from './public/community-domain.js';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=at=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'medium',hour12:false}).format(new Date(at));
const clientId=input=>{if(typeof input.clientId!=='string'||!/^[a-zA-Z0-9_-]{12,80}$/.test(input.clientId))throw fail(400,'缺少发送标识，请刷新后重试。');return input.clientId;};
export const topicView=t=>({id:t.id,title:t.title,description:t.description,owner:t.owner,createdAt:t.createdAt,clientId:t.clientId,count:t.messages.length,last:t.messages.length?{at:t.messages.at(-1).at,owner:t.messages.at(-1).owner,text:t.messages.at(-1).type==='audio'?'[语音] '+t.messages.at(-1).text:t.messages.at(-1).text.slice(0,80)}:null});
const audioTypes={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav'};
function validateAudio(input){
  const mime=String(input.mime||'').split(';')[0].toLowerCase(),ext=audioTypes[mime];
  if(!ext)throw fail(400,'支持 WebM、Ogg、M4A、MP3 或 WAV 语音。');
  if(typeof input.audio!=='string'||input.audio.length>7*1024*1024||input.audio.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(input.audio))throw fail(400,'语音数据无效。');
  const bytes=Buffer.from(input.audio,'base64');
  if(bytes.length<12||bytes.length>5*1024*1024)throw fail(413,'语音不能超过 5 MB，也不能为空。');
  const signatures={webm:()=>bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])),ogg:()=>bytes.toString('ascii',0,4)==='OggS',m4a:()=>bytes.toString('ascii',4,8)==='ftyp',mp3:()=>bytes.toString('ascii',0,3)==='ID3'||(bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0),wav:()=>bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE'};
  if(!signatures[ext]())throw fail(400,'文件内容与语音格式不匹配。');
  const duration=Number(input.duration);if(!Number.isFinite(duration)||duration<=0||duration>120.5)throw fail(400,'每条语音最长 2 分钟。');
  return {bytes,mime,ext,duration:Math.round(duration*10)/10};
}
function exportHtml(room,topic,origin,now){
  const name=id=>room.members.find(m=>m.id===id)?.name||'伙伴';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(topic.title)} · 聊天记录</title><link rel="stylesheet" href="/export.css"><script src="/export.js" defer></script></head><body><aside class="export-tools"><strong>聊天记录 · 导出 PDF</strong><p>点击下方按钮，在打印窗口选择「保存为 PDF」。手机也可用浏览器分享或打印菜单保存。</p><button id="print-export">保存为 PDF</button><p>PDF 保留文字与语音索引，不嵌入音频。回听链接需要登录原小队，服务器也需保持可访问；长期备份请另行下载原始语音。</p></aside><main><header><span class="brand">龟龟同频 / 一起聊聊</span><h1>${esc(topic.title)}</h1><p>${esc(topic.description)}</p><div class="export-meta">小队：${esc(room.name)}<br>创建人：${esc(name(topic.owner))} · ${stamp(topic.createdAt)}<br>导出时间：${stamp(now)}（北京时间） · 共 ${topic.messages.length} 条消息</div></header>${topic.messages.length?topic.messages.map((m,i)=>`<article><div class="message-meta">${i+1}. ${esc(name(m.owner))}<time>${stamp(m.at)}</time></div>${m.text?`<p class="message-text">${esc(m.text)}</p>`:''}${m.type==='audio'?`<div class="voice-note">语音 · ${m.duration} 秒 · <a href="${esc(origin)}/api/audio/${m.id}?download=1">回听 / 下载原始语音</a><small>语音编号：${m.id}</small></div>`:''}</article>`).join(''):'<p>这个话题还没有消息。</p>'}<footer>龟龟同频 · 认真倾听，让每一次讨论有迹可循。<br>本记录由小队成员导出；语音时长为录制或上传时的记录值。</footer></main></body></html>`;
}
export function createCommunity({dataDir,now}){
  const mediaDir=path.join(dataDir,'media');fs.mkdirSync(mediaDir,{recursive:true});
  return async function handle({req,res,url,room,member,body,send,authorize=()=>{}}){
    const route=url.pathname;
    if(!/^\/api\/(topics(?:\/|$)|audio\/|expenses(?:\/|$))/.test(route))return false;
    room.topics??=[];room.expenses??=[];
    const topicMatch=route.match(/^\/api\/topics\/([^/]+)\/(messages|export)$/);
    const audioMatch=route.match(/^\/api\/audio\/([^/]+)$/);
    const expenseMatch=route.match(/^\/api\/expenses\/([^/]+)$/);
    let topic;if(topicMatch){topic=room.topics.find(t=>t.id===topicMatch[1]);if(!topic)throw fail(404,'话题不存在或不属于当前小队。');}
    if(req.method==='GET'&&topicMatch?.[2]==='messages'){
      const after=url.searchParams.has('after')?Number(url.searchParams.get('after')):null,before=url.searchParams.has('before')?Number(url.searchParams.get('before')):null;
      if([after,before].some(n=>n!==null&&(!Number.isSafeInteger(n)||n<0)))throw fail(400,'消息页码无效。');
      const eligible=topic.messages.filter(m=>(after===null||m.seq>after)&&(before===null||m.seq<before));
      const messages=after===null?eligible.slice(-100):eligible.slice(0,100);
      send(res,200,{messages,hasEarlier:messages.length>0&&messages[0].seq>1,hasMore:after!==null&&eligible.length>100});return {sent:true};
    }
    if(req.method==='GET'&&topicMatch?.[2]==='export'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(exportHtml(room,topic,url.origin,now()));return {sent:true};
    }
    if(req.method==='GET'&&audioMatch){
      const message=room.topics.flatMap(t=>t.messages).find(m=>m.id===audioMatch[1]&&m.type==='audio');if(!message)throw fail(404,'语音不存在或没有访问权限。');
      const file=path.join(mediaDir,message.id+'.'+audioTypes[message.mime]);if(!fs.existsSync(file))throw fail(404,'语音文件暂不可用，请联系小队维护者。');
      const size=fs.statSync(file).size;let start=0,end=size-1,status=200;
      if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match||(!match[1]&&!match[2]))throw fail(416,'音频范围无效。');if(!match[1])start=Math.max(0,size-Number(match[2]));else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}if(start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return {sent:true};}status=206;}
      res.writeHead(status,{'Content-Type':message.mime,'Content-Length':end-start+1,'Cache-Control':'private, no-store','Accept-Ranges':'bytes',...(status===206?{'Content-Range':`bytes ${start}-${end}/${size}`}:{ }),'Content-Disposition':`${url.searchParams.has('download')?'attachment':'inline'}; filename="voice-${message.id}.${audioTypes[message.mime]}"`});fs.createReadStream(file,{start,end}).pipe(res);return {sent:true};
    }
    if(req.method!=='POST')throw fail(404,'没有这个操作。');
    const input=await body(req,topicMatch?.[2]==='messages'?7*1024*1024+20000:20000);
    authorize();
    if(route==='/api/topics'){
      const cid=clientId(input);if(room.topics.some(t=>t.owner===member.id&&t.clientId===cid))return {changed:false};
      const title=String(input.title||'').trim(),description=String(input.description||'').trim();if(!title||title.length>80||description.length>500)throw fail(400,'话题名称为 1–80 字，说明最多 500 字。');
      if(room.topics.length>=500)throw fail(400,'小队话题已达 500 个。');room.topics.push({id:randomUUID(),clientId:cid,title,description,owner:member.id,createdAt:now(),messages:[]});
    }else if(topicMatch?.[2]==='messages'){
      const cid=clientId(input);if(topic.messages.some(m=>m.owner===member.id&&m.clientId===cid))return {changed:false};
      if(room.topics.reduce((n,t)=>n+t.messages.length,0)>=10000)throw fail(400,'小队消息已达 10000 条，请导出备份后联系维护者。');
      const text=String(input.text||'').trim();if(text.length>4000||!['text','audio'].includes(input.type)||(input.type==='text'&&!text))throw fail(400,'请填写 1–4000 字的消息。');
      const message={id:randomUUID(),clientId:cid,seq:topic.messages.length+1,owner:member.id,at:now(),type:input.type,text};
      if(input.type==='audio'){
        const audio=validateAudio(input);const total=room.topics.flatMap(t=>t.messages).reduce((n,m)=>n+(m.bytes||0),0);if(total+audio.bytes.length>250*1024*1024)throw fail(413,'小队语音空间已达 250 MB，请联系维护者。');
        fs.writeFileSync(path.join(mediaDir,message.id+'.'+audio.ext),audio.bytes,{flag:'wx'});Object.assign(message,{mime:audio.mime,bytes:audio.bytes.length,duration:audio.duration});
      }
      topic.messages.push(message);
    }else if(route==='/api/expenses'){
      const cid=clientId(input);if(room.expenses.some(e=>e.owner===member.id&&e.clientId===cid))return {changed:false};
      const expense=validateExpense(input,now());if(room.expenses.length>=10000)throw fail(400,'小队账单已达 10000 笔。');room.expenses.push({...expense,id:randomUUID(),clientId:cid,owner:member.id,createdAt:now(),version:1});
    }else if(expenseMatch){
      const expense=room.expenses.find(e=>e.id===expenseMatch[1]);if(!expense)throw fail(404,'账单不存在。');if(expense.owner!==member.id)throw fail(403,'只能更正或删除自己登记的账单。');
      if(input.version!==expense.version)throw fail(409,'这笔账单已更新，请重新打开后再修改。');
      if(input.action==='delete')room.expenses=room.expenses.filter(e=>e!==expense);else if(input.action==='update')Object.assign(expense,validateExpense(input,now()),{updatedAt:now(),version:expense.version+1});else throw fail(400,'未知账单操作。');
    }else throw fail(404,'没有这个操作。');
    return {changed:true};
  };
}
