import {createKioskControlLock} from '/kiosk-control-lock.js';
const $=id=>document.getElementById(id);
const labels={scheduled:'待开始',shooting:'拍摄中',blocked:'已暂停（需工作安排处理）',completed:'已完成',unsupported:'需负责人处理'};
const messages={SCHEDULING_REVISION_CONFLICT:'排期已变化，请刷新核对后再操作。',RUN_REVISION_CONFLICT:'现场状态已变化，请刷新核对。',RESOURCE_ALREADY_RUNNING:'本资源已有正在拍摄的场次。',RUN_PREPARATION_REQUIRED:'场次状态已变化或尚未就绪，请核对。',FORBIDDEN:'此设备无权操作该资源。',WRITE_ADMISSION_DISABLED:'当前处于禁写状态。',KIOSK_TODAY_ONLY:'只能开始北京时间当天的场次。',UNAUTHENTICATED:'设备身份无效，请重新登录。'};
let token='',identity=null,model=null,selected=null,pending=null,pendingKey=null,storageBlocked=false,busy=false,fresh=false,controlling=false,epoch=0,canRetry=false;
const uid=prefix=>`${prefix}-${crypto.randomUUID()}`;
const say=s=>{$('live-message').textContent=s;};
const time=s=>s?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(s)):'—';
const current=()=>model?.sessions.find(s=>s.id===selected);
function allowed(){return Boolean(identity&&model&&fresh&&navigator.onLine&&controlling&&!busy&&!pending&&!storageBlocked&&!model.conflict&&model.writeAdmission==='enabled');}
function controls(){
 const s=current(),live=model?.sessions.some(x=>['shooting','blocked'].includes(x.state));
 $('action-start').disabled=!(allowed()&&s?.supported&&s.state==='scheduled'&&!live);
 $('action-complete').disabled=!(allowed()&&s?.supported&&s.state==='shooting');
 $('online-refresh').disabled=!identity||busy||!navigator.onLine;
 $('online-reconcile').hidden=!pending;$('online-reconcile').disabled=busy||!identity||!navigator.onLine||!controlling;
 $('online-retry').hidden=!pending||!canRetry;$('online-retry').disabled=busy||!fresh||!navigator.onLine||!controlling;
 $('pending-count').textContent=pending?'1':'0';
 $('server-status').textContent=navigator.onLine?(fresh?'服务端：已同步':'服务端：待刷新'):'服务端：离线，禁止操作';
 $('lock-status').textContent=controlling?'控制权：当前页面':'控制权：另一页面或不可用';
}
function slot(prefix,s){
 $(prefix+'-title').textContent=s?s.tasks.map(t=>t.name).join(' / '):'暂无场次';
 $(prefix+'-time').textContent=s?`${time(s.plannedStart)} — ${time(s.plannedEnd)}`:'—';
 $(prefix+'-tasks').replaceChildren(...(s?.tasks??[]).map(t=>{const li=document.createElement('li');li.textContent=`${t.sku} · ${t.name} · ${t.kind==='静物'?'静物 / ':''}${t.shootingSubtype}`;return li;}));
}
function render(){
 slot('current',current());$('confirmed-state').textContent='服务端：'+(labels[current()?.state]??'—');
 slot('next',model?.sessions.find(s=>s.state==='scheduled'&&s.id!==selected));
 $('online-day').replaceChildren(...(model?.sessions??[]).map(s=>{const li=document.createElement('li'),b=document.createElement('button');b.type='button';b.textContent=`${time(s.plannedStart)} · ${s.tasks.map(t=>t.shootingSubtype+' '+t.name).join(' / ')} · ${labels[s.state]??s.state}`;b.disabled=busy;b.addEventListener('click',()=>{selected=s.id;render();});li.append(b);return li;}));controls();
}
function loadPending(){
 pending=null;storageBlocked=false;canRetry=false;
 try{const raw=localStorage.getItem(pendingKey);if(raw){const p=JSON.parse(raw);if(p.deviceId!==identity.deviceId||p.subjectId!==identity.subjectId||p.resourceId!==identity.resourceId||!p.command?.eventId)throw Error();pending=p;}}
 catch{storageBlocked=true;say('无法安全读取待核对记录，操作已停用；请保留浏览器数据并由负责人核对。');}
}
function savePending(value){
 if(value)localStorage.setItem(pendingKey,JSON.stringify(value));else localStorage.removeItem(pendingKey);
 pending=value;canRetry=false;
}
async function api(path,body){
 const response=await fetch('/api/v3/kiosk/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(12000)});
 const data=await response.json();if(!response.ok||!data.ok)throw Object.assign(Error(messages[data.code]??'暂未完成，请刷新核对。'),{code:data.code,status:response.status});return data;
}
async function refresh(){
 const e=epoch;fresh=false;controls();
 try{const next=await api('day');if(e!==epoch)return;model=next;fresh=true;if(!model.sessions.some(s=>s.id===selected))selected=model.currentId??model.sessions[0]?.id??null;render();}
 catch(err){if(e!==epoch)return;fresh=false;model=null;selected=null;render();say(navigator.onLine?err.message:'已离线，禁止操作；恢复连接后先刷新。');}
}
async function sendPending(){
 const e=epoch;
 try{await api('events',pending.command);if(e!==epoch)return;savePending(null);say('操作已确认。');}
 catch(err){if(e!==epoch)return;
  // A parsed non-auth 4xx is a definitive refusal. Network/5xx/auth uncertainty keeps the same command.
  if(err.status>=400&&err.status<500&&![401,403].includes(err.status)){savePending(null);say(err.message);}
  else {fresh=false;say('结果尚未确认，请核对上次操作；不会自动重发。');}
 }
}
async function act(eventType){
 if(!allowed())return;
 const s=current();if(!s?.supported||(eventType==='start'?s.state!=='scheduled':s.state!=='shooting'))return;
 busy=true;controls();const e=epoch;
 try{
  savePending({subjectId:identity.subjectId,deviceId:identity.deviceId,resourceId:identity.resourceId,command:{eventId:uid('KIOSK-EVENT'),runId:s.run?.id??uid('KIOSK-RUN'),scheduleItemId:s.id,eventType,expectedRunRevision:s.run?.runRevision??0,expectedScheduleRevision:model.revisions.scheduleRevision}});
  await sendPending();
 }catch{storageBlocked=true;say('无法保存待核对记录，已停止发送。');}
 finally{if(e===epoch){busy=false;await refresh();controls();}}
}
$('online-login').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;const e=++epoch;token=$('online-token').value;$('online-token').value='';busy=true;fresh=false;identity=null;model=null;controls();
 try{const who=await api('identity');if(e!==epoch)return;identity=who;pendingKey='jenn.kiosk.online-v3.pending:'+JSON.stringify([who.subjectId,who.deviceId,who.resourceId]);loadPending();$('online-login').hidden=true;$('online-logout').hidden=false;$('online-identity').textContent=`设备 ${who.deviceId} · 操作员 ${who.subjectId} · 资源 ${who.resourceId}`;say(pending?'发现上次待核对操作，请先核对；不会自动发送。':'在线模式：断网禁止操作。');await refresh();}
 catch(err){if(e===epoch){token='';identity=null;say(err.message);}}
 finally{if(e===epoch){busy=false;controls();}}
});
$('online-logout').addEventListener('click',()=>{epoch++;token='';identity=null;model=null;pending=null;pendingKey=null;selected=null;busy=false;fresh=false;canRetry=false;$('online-login').hidden=false;$('online-logout').hidden=true;$('online-identity').textContent='';$('complete-dialog').close();render();say('已退出；未确认操作仍保留，重新登录同一身份后核对。');});
$('action-start').addEventListener('click',()=>act('start'));
$('action-complete').addEventListener('click',()=>{if(!$('action-complete').disabled)$('complete-dialog').showModal();});
$('complete-cancel').addEventListener('click',()=>$('complete-dialog').close());
$('complete-confirm').addEventListener('click',()=>{$('complete-dialog').close();act('complete');});
$('online-refresh').addEventListener('click',()=>refresh());
$('online-reconcile').addEventListener('click',async()=>{
 if(!pending||busy||!controlling||!navigator.onLine)return;busy=true;controls();const e=epoch;
 try{await api('events/'+encodeURIComponent(pending.command.eventId));if(e!==epoch)return;savePending(null);say('已核对：上次操作已保存。');}
 catch(err){if(e!==epoch)return;if(err.code==='EVENT_NOT_FOUND'){canRetry=true;say('暂未找到回执。可按原编号重试；不会新建重复操作。');}else say(err.message);}
 finally{if(e===epoch){busy=false;await refresh();controls();}}
});
$('online-retry').addEventListener('click',async()=>{if(!pending||!canRetry||busy||!fresh||!navigator.onLine||!controlling)return;const e=epoch;busy=true;controls();try{await sendPending();}finally{if(e===epoch){busy=false;await refresh();controls();}}});
window.addEventListener('offline',()=>{fresh=false;controls();say('已离线，禁止操作；本页不使用离线队列。');});
window.addEventListener('online',()=>{if(identity&&!busy)refresh();});
window.addEventListener('storage',e=>{if(identity&&e.key===pendingKey&&!busy){loadPending();controls();}});
try{$('legacy-warning').hidden=localStorage.getItem('jenn.kiosk.offline-queue.v2')===null;}catch{storageBlocked=true;say('浏览器存储不可用，现场操作保持关闭。');}
const lock=createKioskControlLock({locks:navigator.locks,storage:localStorage,eventTarget:window,ownerId:uid('TAB'),onChange:s=>{controlling=s.controlling;controls();}});lock.start();
window.addEventListener('pagehide',()=>lock.stop());
window.addEventListener('pageshow',()=>{lock.start();fresh=false;if(identity&&!busy)refresh();});
setInterval(()=>{if(identity&&!busy&&navigator.onLine&&!document.hidden)refresh();},15000);
render();
