// Geometry is captured before rendering so the same surface can grow into its destination.
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const fluid='cubic-bezier(.22,.8,.2,1)';
const order=['home','topics','ledger','team','nest','fit'];
let origin=null,dialogOrigin=null;
const running=new Set(),layers=new Set();
function animate(el,frames,options={}){
  if(reduced.matches)return;
  const a=el.animate(frames,{duration:460,easing:fluid,...options});running.add(a);
  a.finished.catch(()=>{}).finally(()=>running.delete(a));return a;
}
function clear(){for(const a of running)a.cancel();running.clear();for(const el of layers)el.remove();layers.clear();}
function measure(el){const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:r.x,y:r.y,width:r.width,height:r.height,radius:s.borderRadius,background:s.backgroundColor};}
function takeOrigin(){const value=origin;origin=null;return value&&performance.now()-value.at<1000?value:null;}
function surface(from,to,parent=document.body){
  const el=document.createElement('div');el.className='motion-surface';el.setAttribute('aria-hidden','true');el.inert=true;
  parent.append(el);layers.add(el);
  const frame=r=>({left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px',borderRadius:r.radius,background:r.background});
  Object.assign(el.style,frame(to));
  const a=animate(el,[{...frame(from),opacity:1},{...frame(to),opacity:1,offset:.85},{...frame(to),opacity:0}],{duration:520});
  a?.finished.catch(()=>{}).finally(()=>{el.remove();layers.delete(el);});return el;
}
document.addEventListener('click',e=>{
  const el=e.target.closest('button');
  origin=el&&!el.disabled?{...measure(el),element:el,at:performance.now(),card:el.matches('.task,.topic-card,.expense-card')}:null;
},true);
let pressed=null,pressAnimation=null;
function release(cancel=false){
  if(!pressed)return;const el=pressed;pressed=null;pressAnimation?.cancel();el.classList.remove('motion-pressed');
  if(!cancel&&el.isConnected)animate(el,[{scale:'.96'},{scale:'1.018',offset:.65},{scale:'1'}],{duration:360,easing:'cubic-bezier(.2,.7,.3,1)'});
}
function press(el){if(!el||el.disabled||reduced.matches)return;release(true);pressed=el;el.classList.add('motion-pressed');pressAnimation=animate(el,[{scale:'1'},{scale:'.96'}],{duration:100,fill:'forwards'});}
document.addEventListener('pointerdown',e=>{if(e.button===0)press(e.target.closest('button'));},true);
document.addEventListener('pointerup',()=>release(),true);
document.addEventListener('pointercancel',()=>release(true),true);
document.addEventListener('keydown',e=>{if(!e.repeat&&[' ','Enter'].includes(e.key))press(e.target.closest('button'));},true);
document.addEventListener('keyup',e=>{if([' ','Enter'].includes(e.key))release();},true);
window.addEventListener('blur',()=>release(true));
reduced.addEventListener('change',()=>{release(true);clear();});

export function openPanel(dialog,html){
  const from=takeOrigin(),wasOpen=dialog.open;clear();
  dialog.innerHTML=`<div class="dialog-content">${html}</div>`;
  if(!wasOpen)dialog.showModal();
  if(!wasOpen)dialogOrigin=from;
  if(reduced.matches)return;
  const content=dialog.querySelector('.dialog-content'),to=measure(dialog);
  if(from&&!wasOpen){
    // A child of the dialog remains in the top layer, above its backdrop.
    surface(from,to,dialog);
    animate(dialog,[{background:'transparent',boxShadow:'none',offset:0},{background:'transparent',offset:.85},{background:to.background}],{duration:520});
    animate(content,[{opacity:0,translate:'0 12px'},{opacity:1,translate:'0 0'}],{delay:160,duration:360,fill:'backwards'});
  }else animate(content,[{opacity:0,translate:'0 8px'},{opacity:1,translate:'0 0'}],{duration:240});
}
export function closePanel(dialog){
  if(!dialog.open)return;const from=measure(dialog),target=dialogOrigin?.element;clear();
  dialog.close();dialogOrigin=null;
  if(!reduced.matches&&target?.isConnected)surface(from,measure(target));
}
export function changePage(previous,next,update){
  const from=takeOrigin(),app=document.querySelector('#app');clear();
  const old=app.firstElementChild,rect=old?.getBoundingClientRect();
  const direction=order.includes(previous)&&order.includes(next)?Math.sign(order.indexOf(next)-order.indexOf(previous)):next==='home'||next==='topics'?-1:1;
  let outgoing;
  if(old&&!reduced.matches&&previous!==next&&!from?.card){
    outgoing=old.cloneNode(true);outgoing.querySelectorAll('.nav,[id]').forEach(el=>el.matches('.nav')?el.remove():el.removeAttribute('id'));
    outgoing.removeAttribute('id');outgoing.classList.add('motion-outgoing');outgoing.inert=true;outgoing.setAttribute('aria-hidden','true');
    Object.assign(outgoing.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});
    document.body.append(outgoing);layers.add(outgoing);
  }
  update();
  const page=app.firstElementChild;if(!page||reduced.matches||previous===next)return;
  if(from?.card){
    const to=measure(page);to.background=getComputedStyle(document.documentElement).getPropertyValue('--cream').trim()||'#faf9f3';to.radius='24px';
    surface(from,to);
    page.style.transformOrigin='50% 0';
    const a=animate(page,[{opacity:0,transform:'scale(.97)'},{opacity:1,transform:'scale(1)'}],{duration:420,delay:100,fill:'backwards'});
    a?.finished.catch(()=>{}).finally(()=>page.style.removeProperty('transform-origin'));
  }else{
    // Keep the navigation stationary while the content travels in tab order.
    const children=[...page.children].filter(el=>!el.matches('.nav'));
    children.forEach(el=>animate(el,[{opacity:0,translate:`${direction*54}px 0`},{opacity:1,translate:'0 0'}],{duration:380}));
    if(outgoing){const a=animate(outgoing,[{opacity:1,translate:'0 0'},{opacity:0,translate:`${-direction*54}px 0`}],{duration:300});a?.finished.catch(()=>{}).finally(()=>{outgoing.remove();layers.delete(outgoing);});}
  }
}
