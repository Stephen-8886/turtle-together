import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

export function validateBackend(value,{allowLocal=false}={}){
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||(allowLocal&&url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))))throw new Error('请输入 HTTPS 服务器根地址，例如 https://example.com。');
  return url.origin;
}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
export function createClientServer({publicDir,backend,allowLocal=false}){
  const remote=validateBackend(backend,{allowLocal});
  const upstream=new URL(remote);
  return http.createServer((req,res)=>{
    const local='http://127.0.0.1:'+req.socket.localPort;
    if(req.headers.host!==new URL(local).host||(req.headers.origin&&req.headers.origin!==local)){res.writeHead(403);res.end('Forbidden');return;}
    if(!['GET','HEAD','POST'].includes(req.method)){res.writeHead(405);res.end();return;}
    const url=new URL(req.url,local);
    if(url.pathname.startsWith('/api/')){
      const headers={};for(const key of ['content-type','content-length','cookie','range','accept'])if(req.headers[key])headers[key]=req.headers[key];
      if(req.headers.origin)headers.origin=remote;
      const request=(upstream.protocol==='https:'?https:http).request(new URL(url.pathname+url.search,remote),{method:req.method,headers},response=>{
        const out={};for(const key of ['content-type','content-length','cache-control','content-range','accept-ranges','content-disposition','x-content-type-options','content-security-policy'])if(response.headers[key])out[key]=response.headers[key];
        if(response.headers['set-cookie'])out['set-cookie']=response.headers['set-cookie'].map(c=>c.replace(/;\s*Secure/ig,'').replace(/;\s*Domain=[^;]+/ig,''));
        res.writeHead(response.statusCode,out);response.pipe(res);
      });
      request.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'无法连接服务器，请检查网络和客户端服务器设置。'}));});
      request.setTimeout(35000,()=>request.destroy());res.on('close',()=>request.destroy());req.pipe(request);return;
    }
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    let file;try{file=path.resolve(publicDir,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));}catch{res.writeHead(400);res.end();return;}
    if(!file.startsWith(path.resolve(publicDir)+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
  });
}
