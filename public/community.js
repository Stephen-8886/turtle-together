import {dayKey} from './domain.js';
import {CATEGORIES,money,validateExpense,expenseSummary} from './community-domain.js';

export function createCommunityUI({getState,getView,now,api,go,render,nav,esc,art,toast,showDialog,closeDialog,online,getLocal,putLocal}){
  const $=s=>document.querySelector(s),state=()=>getState(),person=id=>state()?.room.members.find(m=>m.id===id);
  const uid=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
  const stamp=at=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));
  let topicId=null,filter={month:dayKey(now()).slice(0,7),member:'',category:''},recorder=null,permissionPending=false;
  const chats=new Map(),voices=new Map(),sending=new Set();
  const draftKey=id=>'turtle.chat-draft:'+state().me+':'+id;
  const draft=id=>getLocal(draftKey(id),{text:'',clientId:uid()});
  const saveDraft=(id,data)=>putLocal(draftKey(id),data);
  const topics=()=>state().room.topics||[],expenses=()=>state().room.expenses||[];
  const hint=()=>online()?'':'<p class="offline-banner">暂时离线，联网后可发送消息或记账。语音回听需要网络。</p>';
  const empty=(title,copy)=>`<div class="community-empty">${art('hero')}<h2>${title}</h2><p>${copy}</p></div>`;
  function topicList(){
    return `<section class="page community-page"><div class="eyebrow">LITTLE CONVERSATIONS</div><header><h1>一起聊聊</h1><p class="subtitle">把想法慢慢说，把共识好好留下。</p></header>${hint()}<div class="conversation-hero"><div><span class="badge">${state().room.members.length} 位伙伴的小客厅</span><h2>有些好主意，<br>是一起聊出来的。</h2></div>${art('hero','hero-art')}</div><button class="btn" data-new-topic>＋ 新建一个话题</button><div class="section-label"><h3>我们的讨论</h3><span>${topics().length} 个话题</span></div><div class="topic-list">${topics().length?topics().slice().sort((a,b)=>(b.last?.at||b.createdAt)-(a.last?.at||a.createdAt)).map(t=>`<button class="topic-card" data-topic="${t.id}"><span class="topic-symbol" aria-hidden="true">☷</span><span class="topic-copy"><strong>${esc(t.title)}</strong><span>${esc(t.last?(person(t.last.owner)?.name||'伙伴')+'：'+t.last.text:t.description||'还没有消息，来聊第一句吧。')}</span><small>${stamp(t.last?.at||t.createdAt)} · ${t.count} 条记录</small></span><span class="topic-arrow" aria-hidden="true">›</span></button>`).join(''):empty('种下一个新话题','周末安排、共同目标，或今天的小心事。')}</div><p class="small">话题与消息对小队所有伙伴可见，发送后保留记录。</p>${nav('topics')}</section>`;
  }
  function chat(){
    const topic=topics().find(t=>t.id===topicId);if(!topic)return topicList();
    return `<section class="page chat-page"><div class="chat-top"><button class="back" data-view="topics">‹ 所有话题</button><a class="export-link" href="/api/topics/${topic.id}/export" target="_blank" rel="noopener">导出 PDF ↗</a></div><header class="chat-header"><span class="eyebrow">一起聊聊 / ${esc(state().room.name)}</span><h1>${esc(topic.title)}</h1>${topic.description?`<p class="subtitle">${esc(topic.description)}</p>`:''}<p class="small">${esc(person(topic.owner)?.name)} 发起 · <span id="message-count">${topic.count}</span> 条记录 · 北京时间</p></header>${hint()}<button class="text-btn" id="load-earlier" data-earlier hidden>查看更早的消息</button><div class="messages" id="messages" role="log" aria-label="话题聊天记录" aria-live="polite"><p class="empty">正在打开讨论…</p></div><p class="form-error" id="chat-error" role="alert"></p><button class="text-btn" id="retry-messages" data-retry-messages hidden>重新加载消息</button><form id="message-form" class="composer"><div id="voice-draft"></div><label class="sr-only" for="message-text">聊天消息</label><textarea id="message-text" rows="2" maxlength="4000" placeholder="慢慢说，我在听…">${esc(draft(topicId).text)}</textarea><div class="composer-tools"><button type="button" class="voice-button" data-record>◉ 录语音</button><label class="upload-audio">上传语音<input type="file" id="audio-input" accept="audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav,audio/x-wav,.m4a,.mp3,.wav,.ogg,.webm"></label><button class="btn small" type="submit" id="send-message">发送 ↑</button></div><p class="small">语音最长 2 分钟 / 5 MB，试听后发送。${!window.isSecureContext?'当前 HTTP 页面请使用上传语音；在线录音需要 HTTPS。':''}</p></form></section>`;
  }
  function messageHtml(m){
    return `<article class="chat-message ${m.owner===state().me?'mine':''}" data-message-id="${m.id}"><span class="avatar">${esc((person(m.owner)?.name||'伙').slice(0,1))}</span><div class="message-body"><div class="chat-meta"><b>${esc(person(m.owner)?.name||'伙伴')}</b><time>${stamp(m.at)}</time></div><div class="chat-bubble">${m.type==='audio'?`<div class="voice-caption">◉ 语音 · ${Math.ceil(m.duration)} 秒</div><audio controls preload="none" src="/api/audio/${m.id}" aria-label="${esc(person(m.owner)?.name)}的语音"></audio><a class="audio-download" href="/api/audio/${m.id}?download=1" download>下载原始语音 ↓</a>`:''}${m.text?`<p>${esc(m.text)}</p>`:''}</div></div></article>`;
  }
  function paintMessages({prepend=false,initial=false}={}){
    const list=$('#messages'),cache=chats.get(topicId);if(!list||!cache)return;
    const wasBottom=list.scrollHeight-list.scrollTop-list.clientHeight<70,oldHeight=list.scrollHeight;
    if(!cache.messages.length)list.innerHTML='<p class="empty">把想说的话，留在这里。<br>伙伴进入这个话题后也能看到。</p>';
    else{
      list.querySelector('.empty')?.remove();
      const existing=new Set([...list.querySelectorAll('[data-message-id]')].map(e=>e.dataset.messageId));
      const html=cache.messages.filter(m=>!existing.has(m.id)).map(messageHtml).join('');
      list.insertAdjacentHTML(prepend?'afterbegin':'beforeend',html);
    }
    if(prepend)list.scrollTop+=list.scrollHeight-oldHeight;else if(initial||wasBottom)list.scrollTop=list.scrollHeight;
    $('#load-earlier').hidden=!cache.hasEarlier;$('#message-count').textContent=topics().find(t=>t.id===topicId)?.count||0;
  }
  async function loadMessages(earlier=false){
    const id=topicId;if(!id||getView()!=='chat')return;
    let cache=chats.get(id);if(!cache){cache={messages:[],hasEarlier:false,loading:false,initialized:false};chats.set(id,cache);}if(cache.loading){cache.again=true;return;}
    cache.loading=true;const initial=!cache.initialized;
    const query=earlier&&cache.messages.length?'?before='+cache.messages[0].seq:cache.initialized&&cache.messages.length?'?after='+cache.messages.at(-1).seq:'';
    try{
      const result=await api(`topics/${id}/messages${query}`);const merged=new Map(cache.messages.map(m=>[m.id,m]));for(const m of result.messages)merged.set(m.id,m);cache.messages=[...merged.values()].sort((a,b)=>a.seq-b.seq);cache.initialized=true;
      if(initial||earlier)cache.hasEarlier=result.hasEarlier;
      if(id===topicId&&getView()==='chat'){paintMessages({prepend:earlier,initial});$('#chat-error').textContent='';$('#retry-messages').hidden=true;}
      if(result.hasMore)cache.again=true;
    }catch(err){if(id===topicId&&getView()==='chat'){$('#chat-error').textContent=err.message;$('#retry-messages').hidden=false;if(!cache.initialized)$('#messages').innerHTML='<p class="empty">消息暂未加载，联网后可重试。</p>';}}
    finally{cache.loading=false;if(cache.again){cache.again=false;if(id===topicId&&getView()==='chat')loadMessages();}}
  }
  function updateVoice(){
    const el=$('#voice-draft');if(!el)return;const voice=voices.get(topicId),active=recorder?.topic===topicId;
    const key=active?'recording':voice?.url||'empty';
    if(el.dataset.preview!==key){
      el.dataset.preview=key;
      if(active)el.innerHTML=`<div class="recording"><span class="record-dot"></span><strong>正在录音 <span id="record-seconds">${Math.floor((performance.now()-recorder.start)/1000)}</span>s / 120s</strong><button type="button" data-stop-record>停止并试听</button></div>`;
      else if(voice)el.innerHTML=`<div class="voice-preview"><div><strong>发送前，听一听 · ${Math.ceil(voice.duration)} 秒</strong><button type="button" data-discard-voice aria-label="删除待发送语音">×</button></div><audio controls src="${voice.url}" aria-label="待发送语音试听"></audio></div>`;
      else el.innerHTML='';
    }
    const record=$('[data-record]');record.disabled=active||permissionPending||!!voice||sending.has(topicId);record.textContent=permissionPending?'麦克风连接中…':'◉ 录语音';
    $('#audio-input').disabled=active||permissionPending||!!voice||sending.has(topicId);$('#send-message').disabled=active||permissionPending||sending.has(topicId)||!online();$('#message-text').disabled=sending.has(topicId);
  }
  function keepVoice(id,blob,duration){
    if(!blob.size||blob.size>5*1024*1024||!Number.isFinite(duration)||duration<=0||duration>120.5){toast('语音需在 2 分钟和 5 MB 以内，请重新录制或选择。');return;}
    const old=voices.get(id);if(old)URL.revokeObjectURL(old.url);voices.set(id,{blob,duration,url:URL.createObjectURL(blob)});const d=draft(id);saveDraft(id,{...d,clientId:uid()});if(id===topicId&&getView()==='chat')updateVoice();
  }
  function stopRecording(){if(recorder&&recorder.media.state!=='inactive')recorder.media.stop();}
  async function record(){
    if(!online())throw new Error('请联网后录制语音。');
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('当前浏览器无法录音。请用 HTTPS 打开，或上传已有语音文件。');
    const id=topicId;permissionPending=true;updateVoice();let stream;
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(getView()!=='chat'||topicId!==id){stream.getTracks().forEach(t=>t.stop());return;}
      const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
      const media=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),chunks=[];
      const current={topic:id,media,start:performance.now(),stream,failed:false};recorder=current;
      media.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);if(chunks.reduce((n,b)=>n+b.size,0)>5*1024*1024&&media.state!=='inactive')media.stop();};
      media.onerror=()=>{current.failed=true;toast('录音中断，请重新录制。');stopRecording();};
      media.onstop=()=>{clearInterval(current.timer);clearTimeout(current.limit);stream.getTracks().forEach(t=>t.stop());const duration=(performance.now()-current.start)/1000;if(recorder===current)recorder=null;if(!current.failed)keepVoice(id,new Blob(chunks,{type:media.mimeType||mime}),duration);if(topicId===id&&getView()==='chat')updateVoice();};
      media.start(1000);current.timer=setInterval(()=>{const sec=$('#record-seconds');if(sec)sec.textContent=Math.min(120,Math.floor((performance.now()-current.start)/1000));},500);current.limit=setTimeout(()=>{if(media.state!=='inactive')media.stop();},120000);
    }catch(err){stream?.getTracks().forEach(t=>t.stop());throw new Error(err.name==='NotAllowedError'?'麦克风未获授权。可在浏览器设置中允许，或上传已有语音。':'麦克风暂不可用，请检查设备或上传已有语音。');}
    finally{permissionPending=false;if(getView()==='chat')updateVoice();}
  }
  async function uploadAudio(file){
    if(!file)return;if(file.size>5*1024*1024)throw new Error('语音文件不能超过 5 MB。');
    const id=topicId;const fallback={m4a:'audio/mp4',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',webm:'audio/webm'}[file.name.split('.').at(-1).toLowerCase()];
    const mime=fallback||file.type;if(!['audio/mp4','audio/mpeg','audio/wav','audio/x-wav','audio/ogg','audio/webm'].includes(mime))throw new Error('请选择 M4A、MP3、WAV、Ogg 或 WebM 语音。');
    const context=new (window.AudioContext||window.webkitAudioContext)();
    try{const buffer=await context.decodeAudioData(await file.arrayBuffer());keepVoice(id,new Blob([file],{type:mime}),buffer.duration);}catch{throw new Error('无法读取这份语音，请换用可播放的音频文件。');}finally{await context.close();}
  }
  async function sendMessage(e){
    e.preventDefault();const id=topicId;if(sending.has(id)||recorder||permissionPending)return;
    if(!online()){toast('暂时离线，内容已保留，请联网后发送。');return;}
    const d=draft(id),text=$('#message-text').value.trim(),voice=voices.get(id);if(!text&&!voice){toast('先写一句话，或录一段语音。');return;}
    sending.add(id);updateVoice();
    try{
      const input={clientId:d.clientId,type:voice?'audio':'text',text};
      if(voice){input.audio=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(voice.blob);});input.mime=voice.blob.type;input.duration=voice.duration;}
      await api(`topics/${id}/messages`,input);saveDraft(id,{text:'',clientId:uid()});if(voice){URL.revokeObjectURL(voice.url);voices.delete(id);}if(getView()==='chat'&&topicId===id){$('#message-text').value='';await loadMessages();$('#messages').scrollTop=$('#messages').scrollHeight;}
    }catch(err){toast(err.message+' 内容保留，可重试发送。');}
    finally{sending.delete(id);if(getView()==='chat'&&topicId===id)updateVoice();}
  }
  function ledger(){
    const summary=expenseSummary(expenses(),filter),monthTotal=expenseSummary(expenses(),{month:filter.month});
    return `<section class="page ledger-page"><div class="eyebrow">OUR EVERYDAY LEDGER</div><header><h1>一起把日子过好</h1><p class="subtitle">每一笔小开支，都值得被好好看见。</p></header>${hint()}<div class="ledger-total"><div class="ledger-month"><span>${filter.month.replace('-',' 年 ')} 月 · 小队总支出</span><span>人民币 CNY</span></div><strong class="total-money">${money(monthTotal.total)}</strong><p>${monthTotal.rows.length} 笔生活记录 · ${Object.keys(monthTotal.byMember).length} 位伙伴记账</p><img src="/assets/turtle-brand.svg" alt="" class="ledger-turtle"></div><button class="btn" data-new-expense>＋ 记一笔我的开支</button><div class="ledger-filters"><label class="field">月份<input id="expense-month" type="month" value="${filter.month}" required></label><label class="field">成员<select id="expense-member"><option value="">全部伙伴</option>${state().room.members.map(m=>`<option value="${m.id}" ${m.id===filter.member?'selected':''}>${esc(m.name)}${m.id===state().me?'（我）':''}</option>`).join('')}</select></label><label class="field">分类<select id="expense-category"><option value="">全部分类</option>${CATEGORIES.map(c=>`<option ${c===filter.category?'selected':''}>${c}</option>`).join('')}</select></label></div><div class="white-card expense-breakdown"><div class="section-label"><h3>这一月，花在哪里</h3><span>当前筛选</span></div>${summary.rows.length?`<div class="member-totals">${Object.entries(summary.byMember).map(([id,total])=>`<div><span class="avatar">${esc((person(id)?.name||'伙').slice(0,1))}</span><span>${esc(person(id)?.name)}<b>${money(total)}</b></span></div>`).join('')}</div><div class="category-bars">${Object.entries(summary.byCategory).sort((a,b)=>b[1]-a[1]).map(([category,total])=>`<div class="category-row"><span>${category}</span><div class="category-track"><i style="width:${total/summary.total*100}%"></i></div><b>${money(total)}</b></div>`).join('')}</div>`:'<p class="empty">这个筛选下还没有开支。</p>'}</div><div class="section-label"><h3>开支明细</h3><span>${summary.rows.length} 笔 · ${money(summary.total)}</span></div><div class="expense-list">${summary.rows.length?summary.rows.map(e=>`<button class="expense-card" data-expense="${e.id}"><span class="expense-category-symbol" aria-hidden="true">${{餐饮:'♨',交通:'↗',购物:'◇',居家:'⌂',娱乐:'♪',健康:'✚',学习:'▤',其他:'…'}[e.category]}</span><span class="expense-copy"><strong>${esc(e.title)}</strong><small>${esc(person(e.owner)?.name)} · ${e.category} · ${e.date.slice(5)}</small></span><b>${money(e.cents)}</b></button>`).join(''):empty('从一笔小开支开始','各自记账，彼此可见，让生活更有数。')}</div><p class="small">本人登记自己的开支，小队共同查看。仅本人可更正或删除自己的账单。</p>${nav('ledger')}</section>`;
  }
  function newTopic(){
    showDialog(`<form id="topic-form" class="page"><h2>开一个小话题</h2><p>给这次讨论起个名字。所有小队伙伴都可以加入聊天。</p><label class="field">话题名称<input name="title" maxlength="80" placeholder="例如：我们的周末小旅行" required></label><label class="field">话题说明（可选）<textarea name="description" maxlength="500" placeholder="这次想一起聊什么？"></textarea></label><p class="form-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" type="button" data-close>再想想</button><button class="btn" type="submit">开始讨论</button></div></form>`);
    const form=$('#topic-form'),cid=uid();form.addEventListener('submit',async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;try{await api('topics',{...Object.fromEntries(new FormData(form)),clientId:cid});const topic=topics().find(t=>t.clientId===cid&&t.owner===state().me);topicId=topic.id;closeDialog();go('chat');}catch(err){form.querySelector('.form-error').textContent=err.message;button.disabled=false;}});
  }
  function expenseForm(expense=null){
    showDialog(`<form id="expense-form" class="page"><h2>${expense?'更正这笔开支':'记下一笔小开支'}</h2><p>记在 ${esc(person(state().me)?.name)} 名下，伙伴也能看到。</p><label class="field">支出名称<input name="title" maxlength="80" value="${esc(expense?.title||'')}" placeholder="例如：今天的午餐" required></label><div class="expense-form-row"><label class="field">金额（元）<input name="amount" type="text" inputmode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" value="${expense?(expense.cents/100).toFixed(2):''}" placeholder="0.00" required></label><label class="field">支出日期<input name="date" type="date" max="${dayKey(now())}" value="${expense?.date||dayKey(now())}" required></label></div><label class="field">支出分类<select name="category">${CATEGORIES.map(c=>`<option ${c===expense?.category?'selected':''}>${c}</option>`).join('')}</select></label><label class="field">备注（可选）<textarea name="note" maxlength="500" placeholder="这笔开支的小细节…">${esc(expense?.note||'')}</textarea></label><p class="form-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" type="button" data-close>取消</button><button class="btn" type="submit">${expense?'保存更正':'记好啦'}</button></div></form>`);
    const form=$('#expense-form'),cid=uid();form.addEventListener('submit',async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;try{const input=Object.fromEntries(new FormData(form));validateExpense(input,now());await api(expense?'expenses/'+expense.id:'expenses',{...input,clientId:cid,...(expense?{action:'update',version:expense.version}:{})});filter.month=input.date.slice(0,7);filter.member='';filter.category='';closeDialog();go('ledger');toast(expense?'账单已更正，伙伴同步可见。':'这笔开支，已经记好啦。');}catch(err){form.querySelector('.form-error').textContent=err.message;button.disabled=false;}});
  }
  function expenseDetail(id){
    const e=expenses().find(e=>e.id===id);if(!e)return;
    showDialog(`<h2>${esc(e.title)}</h2><strong class="detail-money">${money(e.cents)}</strong><div class="summary">${esc(person(e.owner)?.name)} · ${e.category}<br>支出日期：${e.date}<br>登记时间：${stamp(e.createdAt)}${e.updatedAt?'<br>最后更正：'+stamp(e.updatedAt):''}</div>${e.note?`<p class="detail-note">${esc(e.note)}</p>`:''}${e.owner===state().me?`<div class="dialog-actions"><button class="btn soft" data-edit-expense="${e.id}">更正账单</button><button class="btn secondary" data-delete-expense="${e.id}">删除账单</button></div>`:'<p>这是伙伴登记的开支，可以查看，不能代为修改。</p>'}<button class="btn" data-close>收好账本</button>`);
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||button.disabled||!state())return;
    try{
      if(button.hasAttribute('data-new-topic'))newTopic();
      if(button.dataset.topic){topicId=button.dataset.topic;go('chat');}
      if(button.hasAttribute('data-earlier'))await loadMessages(true);
      if(button.hasAttribute('data-retry-messages'))await loadMessages();
      if(button.hasAttribute('data-record'))await record();
      if(button.hasAttribute('data-stop-record'))stopRecording();
      if(button.hasAttribute('data-discard-voice')){const voice=voices.get(topicId);if(voice)URL.revokeObjectURL(voice.url);voices.delete(topicId);updateVoice();}
      if(button.hasAttribute('data-new-expense'))expenseForm();
      if(button.dataset.expense)expenseDetail(button.dataset.expense);
      if(button.dataset.editExpense){const e=expenses().find(e=>e.id===button.dataset.editExpense);if(e)expenseForm(e);}
      if(button.dataset.deleteExpense){const e=expenses().find(e=>e.id===button.dataset.deleteExpense);showDialog(`<h2>删除这笔开支？</h2><p>${esc(e.title)} · ${money(e.cents)}。删除后会从双方统计中移除。</p><div class="dialog-actions"><button class="btn secondary" data-close>保留</button><button class="btn" id="confirm-delete-expense">确认删除</button></div><p class="form-error" role="alert"></p>`);$('#confirm-delete-expense').onclick=async()=>{const btn=$('#confirm-delete-expense');btn.disabled=true;try{await api('expenses/'+e.id,{action:'delete',version:e.version});closeDialog();render();toast('这笔账单已删除。');}catch(err){$('#dialog .form-error').textContent=err.message;btn.disabled=false;}};}
    }catch(err){toast(err.message);}
  });
  document.addEventListener('change',async e=>{
    if(!state())return;try{
      if(e.target.id==='audio-input'){await uploadAudio(e.target.files[0]);e.target.value='';}
      if(e.target.id==='expense-month'&&/^\d{4}-\d{2}$/.test(e.target.value)){filter.month=e.target.value;render();}
      if(e.target.id==='expense-member'){filter.member=e.target.value;render();}
      if(e.target.id==='expense-category'){filter.category=e.target.value;render();}
    }catch(err){toast(err.message);e.target.value='';}
  });
  $('#dialog').addEventListener('close',()=>{if(state()&&['topics','ledger'].includes(getView()))render();});
  window.addEventListener('pagehide',()=>{stopRecording();recorder?.stream.getTracks().forEach(t=>t.stop());});
  window.addEventListener('beforeunload',e=>{if(recorder||voices.size||sending.size){e.preventDefault();e.returnValue='';}});
  return {
    reset(){stopRecording();recorder?.stream.getTracks().forEach(t=>t.stop());for(const voice of voices.values())if(voice.url)URL.revokeObjectURL(voice.url);chats.clear();voices.clear();sending.clear();topicId=null;filter={month:dayKey(now()).slice(0,7),member:'',category:''};},
    pages:{topics:topicList,chat,ledger},
    bind(){if(getView()==='chat'&&$('#message-form')){$('#message-form').addEventListener('submit',sendMessage);$('#message-text').addEventListener('input',e=>saveDraft(topicId,{text:e.target.value,clientId:uid()}));paintMessages({initial:true});updateVoice();loadMessages();}},
    receive(){if(getView()==='chat'){const topic=topics().find(t=>t.id===topicId);if(topic&&topic.count!==(chats.get(topicId)?.messages.at(-1)?.seq||0))loadMessages();updateVoice();return true;}return false;},
    leave(next){if(next!=='chat')stopRecording();},
    isChat(){return getView()==='chat'&&!!$('#message-form');}
  };
}
