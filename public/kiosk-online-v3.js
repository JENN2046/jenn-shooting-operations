import {createBrowserQueueStorage,createKioskOfflineQueue} from '/kiosk-offline-queue-v2.js?v=kiosk-v3-offline-20261018-r2';
import {createKioskTransportV3} from '/kiosk-queue-protocol-v3.js?v=kiosk-v3-offline-20261018-r2';
import {deriveKioskActionState,createKioskControlLock} from '/kiosk-control-lock.js?v=kiosk-v3-offline-20261018-r2';
const $=id=>document.getElementById(id);
const labels={scheduled:'待开始',shooting:'拍摄中',blocked:'已暂停（需工作安排处理）',completed:'已完成',unsupported:'需负责人处理'};
const messages={SCHEDULING_REVISION_CONFLICT:'排期已变化，请刷新核对后再操作。',RUN_REVISION_CONFLICT:'现场状态已变化，请刷新核对。',RESOURCE_ALREADY_RUNNING:'本资源已有正在拍摄的场次。',RUN_PREPARATION_REQUIRED:'场次状态已变化或尚未就绪，请核对。',FORBIDDEN:'此设备无权操作该资源。',WRITE_ADMISSION_DISABLED:'当前处于禁写状态。',KIOSK_TODAY_ONLY:'只能开始北京时间当天的场次。',UNAUTHENTICATED:'设备身份无效，请重新登录。'};
let token='',identity=null,model=null,selected=null,pending=null,pendingKey=null,storageBlocked=false,busy=false,fresh=false,controlling=false,controlAcquiring=false,epoch=0,canRetry=false,queue=null,queueKey=null,accessBlocked=false,offlineRead=false;
const uid=prefix=>`${prefix}-${crypto.randomUUID()}`;
const say=s=>{$('live-message').textContent=s;};
const time=s=>s?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(s)):'—';
const current=()=>model?.sessions.find(s=>s.id===selected);
function queued(){try{const q=queue?.inspect();if(q&&!q.ok)storageBlocked=true;return q?.ok?q:null;}catch{storageBlocked=true;return null;}}
function action(s){
 return deriveKioskActionState({serverItem:s?{scheduleItemId:s.id,runId:s.run?.id??null,runRevision:s.run?.runRevision??0,runState:s.state}:null,pendingItems:queued()?.items.filter(i=>i.scheduleItemId===s?.id)??[],controlling,busy});
}
function allowed(){const q=queued();return Boolean(identity&&model&&(fresh||offlineRead||!navigator.onLine)&&controlling&&!busy&&!pending&&!storageBlocked&&!accessBlocked&&!model.conflict&&model.writeAdmission==='enabled'&&q&&!q.items.some(i=>i.recordingMode==='server-received')&&!['conflict','reviewRequired'].includes(q.syncStatus));}
function installQueue(){
 const binding={subjectId:identity.subjectId,deviceId:identity.deviceId,resourceId:identity.resourceId},e=epoch;
 queueKey='jenn.kiosk.queue.v3:'+JSON.stringify([binding.subjectId,binding.deviceId,binding.resourceId]);
 const storage=createBrowserQueueStorage({storage:localStorage,key:queueKey,protocolVersion:3});
 const transport=createKioskTransportV3({fetchImpl:fetch,binding,getToken:()=>token,isCurrent:()=>e===epoch&&!!identity&&controlling&&!accessBlocked,onReceipt:(r,item)=>{
  const s=model?.sessions.find(s=>s.id===item.scheduleItemId);
  if(s&&r.runRevision>=(s.run?.runRevision??0)){s.state=r.resultingState;s.run={id:r.runId,status:r.resultingState,runRevision:r.runRevision,startedAt:r.startedAt,completedAt:r.completedAt};}
 }});
 queue=createKioskOfflineQueue({storage,transport,clock:()=>new Date()});queued();
}
function controls(){
 for(const b of $('online-day').querySelectorAll('button'))b.disabled=busy;
 const s=current(),a=action(s),live=model?.sessions.some(x=>['shooting','blocked'].includes(action(x).state));
 $('action-start').disabled=!(allowed()&&s?.supported&&a.actions.includes('start')&&!live);
 $('action-complete').disabled=!(allowed()&&s?.supported&&a.actions.includes('complete'));
 $('online-refresh').disabled=!identity||busy||!navigator.onLine;
 $('online-reconcile').hidden=!pending&&!queued()?.pendingCount;$('online-reconcile').disabled=busy||!identity||!navigator.onLine||!controlling;
 $('online-retry').hidden=!pending||!canRetry;$('online-retry').disabled=busy||!fresh||!navigator.onLine||!controlling;
 const q=queued(),legacyOnline=q?.items.some(i=>i.recordingMode==='server-received');$('pending-count').textContent=String((pending?1:0)+(q?.pendingCount??0));
 $('sync-status').textContent=storageBlocked?'本机记录不可用，请保留数据':legacyOnline?'旧在线记录待核对回执，暂停新增现场记录':q?.syncStatus==='conflict'?'冲突：记录保留，请负责人核对':q?.syncStatus==='reviewRequired'?'时间待核对：原记录保留':q?.pendingCount?'待同步：'+q.pendingCount+'条，尚未确认为事实':'没有待同步现场记录';
 $('offline-records').replaceChildren(...(q?.items??[]).map(i=>{const li=document.createElement('li');li.textContent=`${i.eventType==='start'?'开拍':'完成'} · ${time(i.occurredAt)} · ${i.recordingMode==='device-declared'?'设备声明时间':'原在线命令，时间以服务器回执为准'} · ${q.syncStatus==='conflict'?'冲突保留':q.syncStatus==='reviewRequired'?'时间待核对':'待同步'}`;return li;}));
 $('pending-state').hidden=!a.unconfirmed;$('pending-state').textContent='本机记录：'+(labels[a.state]??a.state)+'（未获服务端确认）';
 $('server-status').textContent=navigator.onLine?(fresh?'服务端：已同步':offlineRead?'服务端：连接不可用，现场记录先存本机':'服务端：待刷新'):'服务端：离线，显示上次已读场次';
 $('lock-status').textContent=controlling?'控制权：当前页面':'控制权：另一页面或不可用';
}
const stateLabel=s=>s?.supported===false?'只读：需负责人处理':labels[s?.state]??'—';
function slot(prefix,s){
 const notice=$(prefix==='current'?'grouped-notice':'next-grouped-notice');
 notice.hidden=!s||s.supported!==false;
 notice.textContent=s?.allocationMode==='grouped_unallocated'?'组合场次只读：未拆分单任务工时，请交负责人处理。':'此场次不支持在线操作，只读；请交负责人处理。';
 $(prefix+'-title').textContent=s?s.tasks.map(t=>t.name).join(' / '):'暂无场次';
 $(prefix+'-time').textContent=s?`${time(s.plannedStart)} — ${time(s.plannedEnd)}`:'—';
 $(prefix+'-tasks').replaceChildren(...(s?.tasks??[]).map(t=>{const li=document.createElement('li');li.textContent=`${t.sku} · ${t.name} · ${t.kind==='静物'?'静物 / ':''}${t.shootingSubtype}`;return li;}));
}
function render(){
 $('online-current-label').textContent=selected&&model?.currentId===selected?'NOW / 当前场次':'所选场次';
 slot('current',current());$('confirmed-state').textContent='服务端：'+stateLabel(current());
 slot('next',model?.sessions.find(s=>s.state==='scheduled'&&s.id!==selected));
 $('online-day').replaceChildren(...(model?.sessions??[]).map(s=>{const li=document.createElement('li'),b=document.createElement('button');b.type='button';b.textContent=`${time(s.plannedStart)} · ${s.tasks.map(t=>t.shootingSubtype+' '+t.name).join(' / ')} · ${stateLabel(s)}`;b.disabled=busy;b.addEventListener('click',()=>{selected=s.id;render();});li.append(b);return li;}));controls();
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
function releaseControl(){lock.stop();controlling=false;controlAcquiring=false;controls();}
function requestControl(){if(!identity||controlAcquiring)return;if(!controlling){lock.stop();lock.start();}}
function logout(){epoch++;releaseControl();token='';identity=null;model=null;pending=null;pendingKey=null;queue=null;queueKey=null;accessBlocked=false;offlineRead=false;selected=null;busy=false;fresh=false;canRetry=false;$('online-login').hidden=false;$('online-logout').hidden=true;$('online-identity').textContent='';$('complete-dialog').close();render();}
async function refresh(){
 const e=epoch;fresh=false;controls();
 try{const next=await api('day');if(e!==epoch)return;model=next;fresh=true;offlineRead=false;if(!model.sessions.some(s=>s.id===selected))selected=model.currentId??model.sessions.find(s=>s.state==='scheduled')?.id??model.sessions[0]?.id??null;render();}
 catch(err){if(e!==epoch)return;if(err.status===401){logout();say(err.message);return;}fresh=false;offlineRead=!err.status||err.status>=500;if(err.status===403){accessBlocked=true;releaseControl();}render();say(navigator.onLine?err.message:'已离线；保留上次已读场次，现场记录先存本机。');}
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
async function synchronize(){
 if(!queue||pending||busy||!identity||!controlling||!navigator.onLine||accessBlocked)return;
 const e=epoch;busy=true;controls();
 try{
  const result=await queue.replay({resourceId:identity.resourceId});if(e!==epoch)return;
  if(result.serverStatus?.httpStatus===401||result.stopCode==='UNAUTHENTICATED'){logout();say('身份失效；原记录仍保留，联网重新登录同一身份后核对。');return;}
  if(result.serverStatus?.httpStatus===403||result.stopCode==='FORBIDDEN'){accessBlocked=true;releaseControl();}
  say(!result.ok?'本机记录不可用，请保留数据。':result.stopCode==='LEGACY_ONLINE_EVENT_REVIEW_REQUIRED'?'旧在线记录尚无回执，原命令保留；无法自动改成设备时间，请负责人核对。':result.syncStatus==='conflict'?'同步冲突：'+(result.stopCode??'请核对原记录')+'；原时间和版本均保留。':result.syncStatus==='reviewRequired'?'设备声明时间超出允许范围，原记录保留待核对。':result.pendingCount?'结果尚未确认，记录保留；再次同步先查原编号回执。':'现场记录已保存，已核对服务器回执。');
 }catch{if(e===epoch)say('暂未完成同步；原记录保留，未当作保存成功。');}
 finally{if(e===epoch){busy=false;await refresh();controls();}}
}
async function act(eventType){
 if(!allowed())return;
 const s=current(),a=action(s);if(!s?.supported||!a.actions.includes(eventType)||!['start','complete'].includes(eventType))return;
 const q=queued();if(!q)return;const stored=queueStorageState();if(!stored)return;
 const prior=q.items.filter(i=>i.scheduleItemId===s.id).at(-1);
 const item={schemaVersion:3,eventId:uid('KIOSK-EVENT'),runId:a.runId??uid('KIOSK-RUN'),scheduleItemId:s.id,eventType,expectedRunRevision:a.expectedRunRevision,expectedScheduleRevision:prior?.expectedScheduleRevision??model.revisions.scheduleRevision,occurredAt:new Date().toISOString(),recordingMode:'device-declared',subjectId:identity.subjectId,deviceId:identity.deviceId,resourceId:identity.resourceId,localSequence:stored.nextLocalSequence};
 const saved=queue.enqueue(item);if(!saved.ok){storageBlocked=true;say('无法持久保存本机记录，未发送。');controls();return;}
 say('已保存本机现场记录：设备声明时间，待同步。');render();
 if(navigator.onLine)await synchronize();
}
function queueStorageState(){try{return createBrowserQueueStorage({storage:localStorage,key:queueKey,protocolVersion:3}).load()??{nextLocalSequence:0};}catch{storageBlocked=true;say('无法读取本机记录，已停止操作。');controls();return null;}}
$('online-login').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;releaseControl();const e=++epoch;token=$('online-token').value;$('online-token').value='';busy=true;fresh=false;identity=null;model=null;controls();
 try{const who=await api('identity');if(e!==epoch)return;identity=who;requestControl();pendingKey='jenn.kiosk.online-v3.pending:'+JSON.stringify([who.subjectId,who.deviceId,who.resourceId]);loadPending();installQueue();$('online-login').hidden=true;$('online-logout').hidden=false;$('online-identity').textContent=`设备 ${who.deviceId} · 操作员 ${who.subjectId} · 资源 ${who.resourceId}`;if(!storageBlocked)say(pending?'发现上次待核对操作，请先核对；不会自动发送。':'已加载场次；断网时可先记录本机现场时间。');await refresh();}
 catch(err){if(e===epoch){releaseControl();token='';identity=null;say(err.message);}}
 finally{if(e===epoch){busy=false;controls();if(!pending&&queued()?.pendingCount)void synchronize();}}
});
$('online-logout').addEventListener('click',()=>{logout();say('已退出；未确认操作仍保留，重新登录同一身份后核对。');});
$('action-start').addEventListener('click',()=>act('start'));
$('action-complete').addEventListener('click',()=>{if(!$('action-complete').disabled)$('complete-dialog').showModal();});
$('complete-cancel').addEventListener('click',()=>$('complete-dialog').close());
$('complete-confirm').addEventListener('click',()=>{$('complete-dialog').close();act('complete');});
$('online-refresh').addEventListener('click',async()=>{await refresh();if(identity&&fresh)requestControl();});
$('online-reconcile').addEventListener('click',async()=>{
 if(!pending){await synchronize();return;}
 if(busy||!controlling||!navigator.onLine)return;busy=true;controls();const e=epoch;
 try{await api('events/'+encodeURIComponent(pending.command.eventId));if(e!==epoch)return;savePending(null);say('已核对：上次操作已保存。');}
 catch(err){if(e!==epoch)return;if(err.code==='EVENT_NOT_FOUND'){canRetry=true;say('暂未找到回执。可按原编号重试；不会新建重复操作。');}else say(err.message);}
 finally{if(e===epoch){busy=false;await refresh();controls();}}
});
$('online-retry').addEventListener('click',async()=>{if(!pending||!canRetry||busy||!fresh||!navigator.onLine||!controlling)return;const e=epoch;busy=true;controls();try{await sendPending();}finally{if(e===epoch){busy=false;await refresh();controls();}}});
window.addEventListener('offline',()=>{fresh=false;offlineRead=true;controls();say('已离线；保留已读场次，操作记录设备声明时间并先存本机。');});
window.addEventListener('online',()=>{if(identity&&!busy){if(queued()?.pendingCount)void synchronize();else void refresh();}});
window.addEventListener('storage',e=>{if(e.key==='jenn.kiosk.offline-queue.v2')$('legacy-warning').hidden=e.newValue===null;if(identity&&!busy){if(e.key===pendingKey)loadPending();if(e.key===pendingKey||e.key?.startsWith(queueKey+'.'))render();}});
try{$('legacy-warning').hidden=localStorage.getItem('jenn.kiosk.offline-queue.v2')===null;}catch{storageBlocked=true;say('浏览器存储不可用，现场操作保持关闭。');}
const lock=createKioskControlLock({locks:navigator.locks,storage:localStorage,eventTarget:window,ownerId:uid('TAB'),onChange:s=>{controlAcquiring=s.status==='acquiring';controlling=s.controlling;controls();}});
window.addEventListener('pagehide',()=>{fresh=false;releaseControl();});
window.addEventListener('pageshow',async()=>{fresh=false;if(identity&&!busy){await refresh();if(identity&&fresh)requestControl();}});
setInterval(()=>{if(identity&&!busy&&navigator.onLine&&!document.hidden){if(queued()?.pendingCount)void synchronize();else void refresh();}},15000);
render();
