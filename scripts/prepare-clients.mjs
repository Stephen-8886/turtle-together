import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const target of ['clients/windows/public','clients/android/app/src/main/assets/public']){
  fs.mkdirSync(path.join(root,target),{recursive:true});fs.cpSync(path.join(root,'public'),path.join(root,target),{recursive:true});
  // 内置资源随安装包升级，不注册网页 Service Worker。
  const file=path.join(root,target,'app.js');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace("if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});",''));
}
console.log('已复制最新界面资源到 Windows 和 Android 客户端。');
