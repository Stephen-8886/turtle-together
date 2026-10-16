import {randomBytes,randomUUID,createHash,timingSafeEqual,scrypt} from 'node:crypto';
import {promisify} from 'node:util';

const derive=promisify(scrypt),options={N:32768,r:8,p:3,maxmem:64*1024*1024};
const fail=(status,message)=>Object.assign(new Error(message),{status});
export const sessionHash=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);};
const credential=req=>String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('turtle_session='))?.slice(15)||'';
const publicAccount=a=>a?{id:a.id,username:a.username,name:a.name}:null;
function validate(input){
  const username=String(input.username||'').trim().toLowerCase(),password=input.password;
  if(!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username))throw fail(400,'账号为 3–32 位英文字母、数字、下划线、点或短横线。');
  if(typeof password!=='string'||password.length<10||password.length>128)throw fail(400,'密码请使用 10–128 个字符。');
  const name=String(input.name||username).trim();if(!name||name.length>20)throw fail(400,'昵称为 1–20 字。');
  return {username,password,name};
}
async function passwordHash(password){const salt=randomBytes(16).toString('hex');const key=await derive(password,salt,64,options);return {salt,key:key.toString('hex')};}
async function verify(password,stored){const key=await derive(password,stored?.salt||'00000000000000000000000000000000',64,options);return !!stored&&same(key.toString('hex'),stored.key);}

export function createAuth({db,now,save,send,closeSessions}){
  db.accounts??=[];db.sessions??=[];
  const teams=account=>account?db.rooms.filter(r=>r.members.some(m=>m.accountId===account.id)).map(r=>({id:r.id,name:r.name,memberId:r.members.find(m=>m.accountId===account.id).id})):[];
  function identify(req){
    const raw=credential(req);if(!raw)throw fail(401,'请先登录账号。');const digest=sessionHash(raw);
    const session=db.sessions.find(s=>same(s.hash,digest)&&s.expiresAt>now());
    if(session){const account=db.accounts.find(a=>a.id===session.accountId);if(!account)throw fail(401,'登录已失效。');const room=db.rooms.find(r=>r.id===session.roomId),member=room?.members.find(m=>m.accountId===account.id);return {account,session,room:member?room:null,member,sessionHash:digest};}
    // 已存在的设备身份可继续使用并绑定账号；不能通过匿名接口新建身份。
    for(const room of db.rooms){const member=room.members.find(m=>!m.accountId&&same(m.sessionHash,digest));if(member)return {room,member,sessionHash:digest,legacy:true};}
    throw fail(401,'登录已失效，请重新登录。');
  }
  const summary=c=>({account:publicAccount(c.account),teams:teams(c.account),needsAccount:!c.account,serverNow:now()});
  function setCookie(req,res,raw,maxAge=30*86400){const secure=req.socket.encrypted||(process.env.TRUST_PROXY==='1'&&req.headers['x-forwarded-proto']==='https');res.setHeader('Set-Cookie',`turtle_session=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure?'; Secure':''}`);}
  function newSession(req,res,account,roomId){
    db.sessions=db.sessions.filter(s=>s.expiresAt>now());
    const raw=randomBytes(32).toString('base64url'),session={hash:sessionHash(raw),accountId:account.id,roomId,createdAt:now(),expiresAt:now()+30*86400000};db.sessions.push(session);setCookie(req,res,raw);return identify({headers:{cookie:'turtle_session='+raw}});
  }
  function revoke(context){db.sessions=db.sessions.filter(s=>s.hash!==context.sessionHash);if(context.legacy)delete context.member.sessionHash;closeSessions(context.sessionHash);}
  async function handle({req,res,url,body,snapshot}){
    if(!url.pathname.startsWith('/api/auth/'))return false;
    if(req.method==='GET'&&url.pathname==='/api/auth/me'){send(res,200,summary(identify(req)));return true;}
    if(req.method!=='POST')throw fail(404,'没有这个账号操作。');
    const input=await body(req);let context;
    if(['/api/auth/register','/api/auth/link'].includes(url.pathname)){
      const values=validate(input);if(db.accounts.some(a=>a.username===values.username))throw fail(409,'这个账号名已被使用。');
      if(url.pathname.endsWith('/link')){context=identify(req);if(!context.legacy)throw fail(409,'当前身份已经绑定账号。');}
      const password=await passwordHash(values.password);
      if(db.accounts.some(a=>a.username===values.username))throw fail(409,'这个账号名已被使用。');
      if(context&&identify(req).member!==context.member)throw fail(409,'这个设备身份已改变，请重新打开后绑定。');
      const account={id:randomUUID(),username:values.username,name:values.name,password,createdAt:now()};db.accounts.push(account);
      const room=context?.room;if(context){context.member.accountId=account.id;delete context.member.sessionHash;closeSessions(context.sessionHash);}
      context=newSession(req,res,account,room?.id);
    }else if(url.pathname==='/api/auth/login'){
      const username=String(input.username||'').trim().toLowerCase(),password=input.password;
      if(typeof password!=='string'||password.length>128)throw fail(400,'请输入有效的账号和密码。');
      const account=db.accounts.find(a=>a.username===username);if(!await verify(password,account?.password))throw fail(401,'账号或密码不正确。');
      const list=teams(account);context=newSession(req,res,account,list[0]?.id);
    }else if(url.pathname==='/api/auth/password'){
      context=identify(req);if(!context.account)throw fail(403,'请先绑定账号。');
      if(typeof input.currentPassword!=='string'||input.currentPassword.length>128||!await verify(input.currentPassword,context.account.password))throw fail(401,'当前密码不正确。');
      validate({username:context.account.username,password:input.password});const password=await passwordHash(input.password);
      context.account.password=password;
      for(const session of db.sessions.filter(s=>s.accountId===context.account.id))closeSessions(session.hash);
      db.sessions=db.sessions.filter(s=>s.accountId!==context.account.id);context=newSession(req,res,context.account,context.room?.id);
    }else if(url.pathname==='/api/auth/logout'){
      context=identify(req);revoke(context);setCookie(req,res,'',0);save();send(res,200,{ok:true});return true;
    }else throw fail(404,'没有这个账号操作。');
    save();send(res,200,context.member?snapshot(context.room,context.member,context):summary(context));return true;
  }
  return {identify,summary,handle,revoke,setCookie,isValid:hash=>db.sessions.some(s=>s.hash===hash&&s.expiresAt>now())||db.rooms.some(r=>r.members.some(m=>!m.accountId&&m.sessionHash===hash))};
}
