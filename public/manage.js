import {browserSession} from './browser-session.js?v=jso-session-field-20261018-r1';
import {mergeFiles,fileSelectionError} from './common.js';
import {referenceGallery,clearReferenceImages} from './references.js?v=public-board-20261018-r1';
const $=s=>document.querySelector(s);
let dayPreview=null,editingOrder=null,pageDraftDirty=false;
let token='',state=null,preview=null,published=null,publishedBinding=null,editing=null,proposal=null,busy=false;
let pending=null;try{pending=JSON.parse(sessionStorage.getItem('jso.pending.operation')||'null');}catch{}
const messages={DYNAMIC_PLAN_SAME_DATE_ONLY:'计划调整须保持在场次原日期内，开始时间必须晚于现在；跨日期请使用拍摄改期。',DYNAMIC_FORECAST_NOT_CURRENT:'需要已有的正在拍摄或受阻执行记录；未确认的实际状态不能当作已知。',DYNAMIC_OCCUPANCY_UNKNOWN:'已有占用信息不完整，请先核对。',DYNAMIC_PREVIEW_CHANGED:'现场、安排或配置已变化，请重新预览。',DYNAMIC_TODAY_ONLY:'仅支持北京时间当天，结束时间必须晚于现在。',DYNAMIC_UNRESOLVED:'存在未解决项，整批未保存。',FORBIDDEN:'没有这个资源的操作权限。',WRITE_ADMISSION_DISABLED:'当前处于禁写状态，不能保存。',CALENDAR_HAS_CONFLICTS:'新规则与已排场次冲突，请先改期。',SCHEDULING_REVISION_CONFLICT:'安排已被其他操作更新，请刷新并重新核对。',RESCHEDULE_REVISION_CONFLICT:'安排已变化，请刷新后重新核对。',SCHEDULING_RESOURCE_OVERLAP_OR_UNKNOWN:'与已有拍摄或缓冲冲突，或存在尚未确定的占用。',PAST_CALENDAR_CHANGE_FORBIDDEN:'历史工作规则需要保留，请选择今天或以后的生效日。',SCHEDULING_QUIESCENCE_HELD:'维护操作正在持锁，暂不能修改。',OPERATION_NOT_FOUND:'暂未找到回执，不能据此认定未提交。请保持待核对状态。',CONFIG_SCHEMA_TRANSITION_REQUIRES_REVIEW:'已有旧版日历需要单独迁移，页面暂不直接转换。'};
function say(text){$('#message').textContent=text;}
function syncBusy(){$('#reference-files').disabled=busy||Boolean(pending)||Boolean(editingOrder);document.querySelectorAll('#management-view button,#login button,#unknown button,#view-switch button').forEach(b=>b.disabled=busy||Boolean(pending)&&!['login-button','reconcile','refresh','logout'].includes(b.id));$('#unknown').hidden=!pending;}
function savePending(value){pending=value;if(value)sessionStorage.setItem('jso.pending.operation',JSON.stringify(value));else sessionStorage.removeItem('jso.pending.operation');syncBusy();}
function fail(result){return new Error(messages[result.code]||`操作未完成：${result.code||'请稍后核对'}`);}
async function api(path,body,signal){const init={signal,method:body?'POST':'GET',headers:{...(browserSession.enabled?{}:{Authorization:`Bearer ${token}`}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined};const response=await(browserSession.enabled?browserSession.request(path,init):fetch(path,init));let result;try{result=await response.json();}catch{throw new Error('响应无法确认，请核对原操作结果。');}if(!response.ok||!result.ok)throw Object.assign(fail(result),{definite:response.status<500,result});return result;}
async function mutation(path,body){if(pending)throw new Error('请先核对上一次操作。');savePending({path,body,id:body.operationId||body.decisionId||body.submission?.operationId||(body.eventId?`admin:${body.eventId}`:undefined)});try{const r=await api(path,body);savePending(null);return r;}catch(e){if(e.definite)savePending(null);throw e;}}
async function work(fn){if(busy)return;busy=true;syncBusy();say('正在处理…');try{await fn();if($('#message').textContent==='正在处理…')say('已更新当前显示。');}catch(e){say(e.message);}finally{busy=false;syncBusy();}}
function newId(prefix){return `${prefix}-${crypto.randomUUID()}`;}
const row=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
const active=()=>state.configs.find(c=>c.active);
const draftBase=()=>structuredClone(active()?.configJson||state.initialConfig);
function exceptionRow(value={date:'',status:'closed',windows:[]}){
 const e=document.createElement('div');e.className='exception';e.dataset.originalDate=value.date;
 const make=(label,type,val)=>{const l=row('label',label),i=document.createElement('input');i.type=type;i.value=val||'';l.append(i);e.append(l);return i;};
 const date=make('日期','date',value.date);date.required=true;
 const label=row('label','当天安排'),select=document.createElement('select');for(const [v,t] of [['closed','休息'],['custom','自定义时段']]){const o=row('option',t);o.value=v;select.append(o);}select.value=value.status;label.append(select);e.append(label);
 const times=['第一段开始','第一段结束','第二段开始（可选）','第二段结束（可选）'].map((t,i)=>make(t,'time',value.windows[Math.floor(i/2)]?.[i%2?'end':'start']));
 const remove=row('button','删除例外');remove.type='button';remove.className='secondary';remove.addEventListener('click',()=>{pageDraftDirty=true;e.remove();invalidate();});e.append(remove);
 const past=value.date&&value.date<state.businessToday;if(past){remove.dataset.locked='yes';e.querySelectorAll('input,select,button').forEach(el=>el.disabled=true);}
 const enabled=()=>times.forEach(t=>t.disabled=past||select.value==='closed');select.addEventListener('change',enabled);enabled();
 e.values=()=>({date:date.value,status:select.value,windows:select.value==='closed'?[]:[{start:times[0].value,end:times[1].value},...(times[2].value||times[3].value?[{start:times[2].value,end:times[3].value}]:[])]});$('#exceptions').append(e);
}
function invalidate(){preview=null;$('#preview').hidden=true;}
function beginReschedule(s){editing=s;$('#reschedule-form').hidden=false;$('#edit-title').textContent=`调整 ${s.requestNames?.join('、')||'拍摄场次'}`;const start=local(s.plannedStart).split(' '),end=local(s.plannedEnd).split(' ');$('#shoot-date').value=start[0];$('#shoot-start').value=start[1];$('#shoot-end').value=end[1];$('#buffer-note').textContent=`拍后保留 ${s.bufferAfterMinutes} 分钟。改期不会发送外部通知。`;$('#shoot-date').focus();}
const dailyStatus={notStarted:'待开始',scheduled:'待开始',shooting:'拍摄中',blocked:'受阻',completed:'已完成',cancelled:'已取消',unknown:'事实待核对'};
function dailyEntry(text,action,type,id,snapshot,sourceFacts=null){
 const button=row('button',text);button.type='button';button.className='secondary';button.dataset.dailyAction=action;
 button.addEventListener('click',()=>openDailyEntry(action,type,id,snapshot,sourceFacts));return button;
}
// Navigation/selection only. Every submit remains in the original handler,
// with its preview, CAS, idempotency and unknown-result reconciliation intact.
function openDailyEntry(action,type,id,snapshot,sourceFacts){
 if(busy||pending){say('请先核对当前管理操作。');return;}
 if(snapshot!==state){say('作业已更新，当前编辑仍使用原版本；请先处理编辑并刷新，再选择快捷入口。');return;}
 const focus=id=>{$('#'+id)?.scrollIntoView?.({block:'start',behavior:'smooth'});$('#'+id)?.focus?.();};
 let session=state.sessions.find(s=>s.id===id);const order=state.orderFacts.find(r=>r.id===id);
 if(type==='request'&&['reschedule','dayAdjustment','selectActual','reconcile'].includes(action)){
  const bindings=state.sessions.filter(s=>sourceFacts?.scheduleItemIds?.includes(s.id)&&s.requestIds.includes(id)&&s.status!=='cancelled');
  if(bindings.length!==1){say('此订单没有唯一可选场次，请在下方明确选择并核对。');focus('reschedule-panel');return;}
  session=bindings[0];
 }
 if(action==='ownerField'){if(browserSession.enabled)showView(true);else focus('actual-item');return;}
 if(action==='proposal'){focus('proposal-panel');return;}
 if(action==='duration'){const form=[...$('#requests').children].find(form=>form.dataset.requestId===id);(form||$('#durations-panel')).scrollIntoView?.({block:'start'});form?.querySelector?.('input')?.focus();return;}
 if(action==='editOrder'){
  if(pageDraftDirty||editingOrder||referenceFiles.length){say('请先处理未保存的订单或页面编辑。');return;}
  if(order?.editable&&order.shootingSubtype!=='细节')beginOrderEdit(order);focus('order-panel');return;
 }
 if(action==='reschedule'){
  if(pageDraftDirty||editing){say('请先处理未保存的页面编辑。');return;}
  if(session&&!session.hasRunHistory&&session.lockStatus==='unlocked'&&session.status!=='cancelled')beginReschedule(session);
  else say('此场已有执行记录或被锁定，请先核对实际执行或当天动态调整。');
  focus('reschedule-panel');return;
 }
 if(action==='dayAdjustment'){
  if(pageDraftDirty||dayPreview){say('请先处理未保存的动态调整或页面编辑。');focus('dynamic-panel');return;}
  if(session&&local(session.plannedStart).slice(0,10)===state.businessToday){$('#dynamic-item').value=session.id;rememberChoice('dynamic-item');selectDynamic();}
  focus('dynamic-panel');return;
 }
 if(action==='selectActual'||action==='reconcile'||action==='viewRun'){
  if(session){$('#actual-item').value=session.id;rememberChoice('actual-item');}focus('actual-item');return;
 }
 focus('identity');
}
function renderDaily(snapshot){
 const daily=snapshot.dailyOperations;$('#daily-panel').hidden=!daily;
 if(!daily)return;
 $('#daily-date').textContent=daily.date+' · 北京时间';
 $('#daily-summary').replaceChildren();
 for(const [label,value]of [['今日场次',daily.summary.total],['已完成',daily.summary.completed],['拍摄中',daily.summary.shooting],['待开始',daily.summary.pending],['受阻',daily.summary.blocked],['预计最晚拍完',daily.summary.latestExpectedEnd?local(daily.summary.latestExpectedEnd).slice(11):'—']]){
  const stat=row('div','');stat.className='daily-stat';stat.append(row('strong',String(value)),row('span',label));$('#daily-summary').append(stat);
 }
 function card(target,title,session){
  const out=$('#'+target);out.replaceChildren(row('h3',title));
  if(!session){out.append(row('p',title==='当前拍摄'?'没有唯一执行中场次，请查看待处理。':'暂无待开始场次。'));return;}
  out.append(row('strong',session.requestNames.join('、')||session.id),row('p',dailyStatus[session.runStatus]||'事实待核对'),row('p',`计划 ${local(session.plannedStart)} — ${local(session.plannedEnd)} · 缓冲 ${session.bufferAfterMinutes??'未确定'} 分钟`));
  if(session.startedAt)out.append(row('p','实际开始 '+local(session.startedAt)+(session.elapsedMinutes!==null?` · 已过 ${session.elapsedMinutes} 分钟`:'')));
  if(session.completedAt)out.append(row('p','实际完成 '+local(session.completedAt)));
  if(session.confirmedForecast)out.append(row('p','已确认预计结束 '+local(session.confirmedForecast.estimatedEnd)+'（不是实际完成）'));
  if(title==='下一场'){
   out.append(row('p',session.orders.map(order=>`${order.shootingSubtype} · ${order.sampleStatus==='arrivedVerified'?'样品已核实': '样品尚未核实'}`).join('；')));
   out.append(row('p',`计划拍摄 ${Math.round((Date.parse(session.plannedEnd)-Date.parse(session.plannedStart))/60000)} 分钟`));
   if(daily.summary.gapToNextMinutes!==null)out.append(row('p',`与当前场的计划间隔 ${daily.summary.gapToNextMinutes} 分钟`));
  }
  out.append(referenceGallery(session.referenceImages,()=>token));
  if(!session.referenceImagesAvailable)out.append(row('small','暂无参考图'));
  if(snapshot.principal.role==='administrator')out.append(dailyEntry('本人现场','ownerField','scheduleItem',session.id,snapshot),dailyEntry(title==='下一场'?'查看并开拍':'查看实际执行','selectActual','scheduleItem',session.id,snapshot),dailyEntry('当天动态调整','dayAdjustment','scheduleItem',session.id,snapshot));
  if(!session.hasRunHistory&&session.lockStatus==='unlocked')out.append(dailyEntry('改期','reschedule','scheduleItem',session.id,snapshot));
 }
 card('daily-current','当前拍摄',daily.currentSession);card('daily-next','下一场',daily.nextSession);
 $('#daily-attention-title').textContent=`待处理 · ${daily.attentionQueue.length}`;$('#daily-attention').replaceChildren();
 const actionLabels={ownerField:'本人现场',selectActual:'核对实际执行',reconcile:'核对执行事实',dayAdjustment:'当天动态调整',reschedule:'改期',editOrder:'订单维护',duration:'时长维护',proposal:'Proposal',viewState:'查看状态'};
 for(const item of daily.attentionQueue){const line=row('li','');line.className=item.severity;
  const session=snapshot.sessions.find(session=>session.id===item.entityId),order=snapshot.orderFacts.find(order=>order.id===item.entityId);
  const name=session?.requestNames.join('、')||order?.name||(item.entityType==='system'?'工作台':'拍摄事实');
  const facts=item.sourceFacts;
  const sample={arrivedVerified:'样品已核实',inTransit:'样品运输中',unavailable:'样品不可用'};
  const evidence=facts.plannedEnd?`计划结束 ${local(facts.plannedEnd)}；${facts.runs.length?facts.runs.map(run=>dailyStatus[run.status]||'待核对').join('、'):'尚无实际执行记录'}`
   :facts.requestId?`期望 ${facts.desiredDate||'未填'} · ${sample[facts.sampleStatus]||'样品待核实'} · ${facts.duration?facts.duration.durationMs/60000+' 分钟':'时长待填'}`:item.reason;
  line.append(row('strong',name+' · '+item.summary),row('small',evidence));
  line.append(dailyEntry(actionLabels[item.recommendedAction]||'查看记录',item.recommendedAction,item.entityType,item.entityId,snapshot,item.sourceFacts));$('#daily-attention').append(line);
 }
 if(!daily.attentionQueue.length)$('#daily-attention').append(row('li','暂无待处理事项。'));
 $('#daily-ready-title').textContent=`可排但未排订单 · ${daily.readyUnscheduledOrders.length}`;$('#daily-ready').replaceChildren();
 for(const order of daily.readyUnscheduledOrders){const line=row('li','');line.append(row('strong',order.name),row('small',`${order.shootingSubtype} · 样品已核实 · ${order.duration.durationMs/60000} 分钟 · 期望 ${order.desiredDate||'未填'}`),dailyEntry('订单维护','editOrder','request',order.id,snapshot),dailyEntry('时长维护','duration','request',order.id,snapshot),dailyEntry('Proposal','proposal','request',order.id,snapshot));$('#daily-ready').append(line);}
 if(!daily.readyUnscheduledOrders.length)$('#daily-ready').append(row('li','暂无样品与时长均具备的未排订单。'));
 $('#daily-sessions').replaceChildren(...daily.todaySessions.map(session=>row('p',`${local(session.plannedStart).slice(11)} — ${local(session.plannedEnd).slice(11)} · ${session.requestNames.join('、')||session.id} · ${dailyStatus[session.runStatus]||'待核对'}`)));
 $('#daily-observed').textContent=`读取于 ${local(daily.observedAt)}。实际开拍与完成只采用已记录的执行事实。`;
}
function renderSessions(snapshot){
 $('#sessions').replaceChildren();for(const s of snapshot.sessions){const e=row('div','');e.className='session';e.dataset.scheduleItemId=s.id;e.append(row('strong',s.requestNames?.join('、')||'未命名拍摄'),row('p',`${local(s.plannedStart)} — ${local(s.plannedEnd)} · 缓冲 ${s.bufferAfterMinutes??'未确定'} 分钟`));const b=row('button','调整时间');b.type='button';b.disabled=s.hasRunHistory||s.lockStatus!=='unlocked'||s.status==='cancelled';b.dataset.locked=b.disabled?'yes':'';b.addEventListener('click',()=>beginReschedule(s));e.append(b);$('#sessions').append(e);}
 if(!snapshot.sessions.length)$('#sessions').append(row('p','暂无已排场次。'));
}
function render(){
 $('#workspace').hidden=false;$('#login').hidden=true;$('#view-switch').hidden=!browserSession.enabled;$('#identity').textContent=`${state.principal.subjectId} · ${state.writeAdmission==='disabled'?'当前禁写':'可编辑'} · 北京时间`;
 $('#setup').hidden=state.resources.length>0||state.principal.role!=='administrator';
 const current=active();$('#config-state').textContent=current?'当前规则已生效。后续修改会保留历史版本。':'尚未设置工作日历。';
 $('#calendar-fields').disabled=state.principal.role!=='administrator'||!state.resources.length;
 const config=draftBase(); const cal=config.resourceCalendars[0];
 const rules=cal.rules||[];const rule=[...rules].reverse().find(r=>r.effectiveFrom<=state.businessToday)||rules[0];
 const windows=(rule?.weeklyWindows||cal.weeklyWindows||[]).filter(w=>w.weekday===1);
 $('#effective').value=rule?.effectiveFrom>state.businessToday?rule.effectiveFrom:state.businessToday;$('#effective').min=state.businessToday;
 $('#saturday').value=rule?.alternatingSaturday?'alternating':rule?.weeklyWindows.some(w=>w.weekday===6)?'weekly':'off';syncSaturday();
 if(rule?.alternatingSaturday)$('#anchor').value=rule.alternatingSaturday.workingAnchorDate;
 for(const [id,v] of [['am-start',windows[0]?.start],['am-end',windows[0]?.end],['pm-start',windows[1]?.start],['pm-end',windows[1]?.end]])if(v)$(`#${id}`).value=v;
 $('#exceptions').replaceChildren();cal.dateOverrides.forEach(exceptionRow);
 for(const [id,subtype] of durationFields(config)){const rule=config.durationFallbackRules.find(r=>r.shootingSubtype===subtype);$(`#${id}`).value=rule?rule.durationMs/60000:'';}
 const buffers=config.bufferRules.map(r=>r.bufferAfterMinutes);$('#buffer-minutes').value=new Set(buffers).size===1?buffers[0]:'';
 $('#requests').replaceChildren();for(const request of state.requests||[]){const form=document.createElement('form');form.dataset.requestId=request.id;form.append(row('strong',request.name));const label=row('label','预计拍摄分钟数'),input=document.createElement('input');input.type='number';input.min='1';input.max='1440';input.required=true;input.value=request.durationEstimateJson?JSON.parse(request.durationEstimateJson).durationMs/60000:'';label.append(input);form.append(label);const save=row('button','保存该单时长');save.type='submit';form.append(save);form.addEventListener('submit',e=>{e.preventDefault();work(async()=>{await mutation(`/api/v3/business/requests/${encodeURIComponent(request.id)}/duration`,{operationId:newId('DURATION'),requestId:request.id,expectedScheduleRevision:state.revisions.scheduleRevision,expectedProjectionRevision:state.revisions.projectionRevision,durationMinutes:Number(input.value)});await refresh();say('逐单时长已保存，已有场次未移动。');});});$('#requests').append(form);}
 renderSessions(state);
 dayPreview=null;$('#dynamic-preview').hidden=true;renderSessionChoice('dynamic-item',state.sessions.filter(s=>s.status==='confirmed'&&local(s.plannedStart).slice(0,10)===state.businessToday),s=>s.requestNames?.join('、')||s.id);selectDynamic();
 $('#plan-from').value=state.businessToday;$('#plan-through').value=state.businessToday;
 const inactive=state.configs.filter(c=>!c.active&&!c.everActive);published=null;$('#saved-preview').hidden=true;
 $('#saved-version').replaceChildren(...inactive.map(c=>{const o=row('option',`保存于 ${local(c.publishedAt)} · ${c.configVersion.slice(-8)}`);o.value=c.configVersion;return o;}));$('#published').hidden=!inactive.length||state.principal.role!=='administrator';
 renderOrderPanel();renderDaily(state);invalidate();syncBusy();
}
// All user times are explicit Asia/Shanghai; host timezone is irrelevant.
function local(iso){if(!iso||!Number.isFinite(Date.parse(iso)))return '时间待核对';const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map(v=>[v.type,v.value]));return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;}
async function refresh(){state=await api('/api/v3/business/state');pageDraftDirty=false;automaticDisplayed=state.revisions;clearReferenceImages();render();}
function previewBinding(){return {expectedProjectionRevision:state.revisions?.projectionRevision,baseConfigDigest:active()?.configDigest??null};}
function buildConfig(){const config=draftBase();if(![2,3].includes(config.schemaVersion))throw new Error('旧版日历需要迁移后再编辑。');const cal=config.resourceCalendars[0],effectiveFrom=$('#effective').value;
 if(effectiveFrom<state.businessToday)throw new Error('请选择今天或以后的生效日期。');
 const windows=[{start:$('#am-start').value,end:$('#am-end').value},{start:$('#pm-start').value,end:$('#pm-end').value}];
 const rules=cal.rules.filter(r=>r.effectiveFrom!==effectiveFrom);rules.push({effectiveFrom,weeklyWindows:($('#saturday').value==='weekly'?[1,2,3,4,5,6]:[1,2,3,4,5]).flatMap(weekday=>windows.map(w=>({weekday,...w}))),alternatingSaturday:$('#saturday').value==='alternating'?{workingAnchorDate:$('#anchor').value,windows}:null});cal.rules=rules;
 cal.dateOverrides=[...$('#exceptions').children].map(e=>e.values());
 for(const [id,subtype] of durationFields(config)){const value=$(`#${id}`).value;config.durationFallbackRules=config.durationFallbackRules.filter(r=>!(r.productionType==='平面'&&r.shootingSubtype===subtype));if(value!=='')config.durationFallbackRules.push({ruleId:`DURATION-${id}`,productionType:'平面',shootingSubtype:subtype,durationMs:Number(value)*60000});}
 const minutes=Number($('#buffer-minutes').value);if($('#buffer-minutes').value===''||!Number.isSafeInteger(minutes)||minutes<0||minutes>1440)throw new Error('请填写统一缓冲分钟数。');
 for(const rule of config.bufferRules)rule.bufferAfterMinutes=minutes;
 return config;
}
function syncSaturday(){$('#anchor-label').hidden=$('#saturday').value!=='alternating';$('#anchor').required=$('#saturday').value==='alternating';}
$('#saturday').addEventListener('change',syncSaturday);
$('#login').addEventListener('submit',e=>{e.preventDefault();work(async()=>{const entered=$('#token').value;$('#token').value='';await browserSession.init();if(browserSession.enabled){await browserSession.login(entered);token='';}else token=entered;await refresh();say('已读取工作安排。');});});
$('#logout').addEventListener('click',async()=>{const confirmed=!browserSession.enabled||await browserSession.logout();token='';state=null;clearReferenceImages();$('#order-list').replaceChildren();if(!pending)resetOrderForm();$('#workspace').hidden=true;$('#login').hidden=false;$('#view-switch').hidden=true;showView(false);say(confirmed?'已退出。未确认操作和现场队列仍保留。':'本机已锁定；服务端退出待联网确认。现场队列仍保留。');});
$('#refresh').addEventListener('click',()=>work(refresh));
$('#register').addEventListener('click',()=>work(async()=>{if(!state.revisions)throw new Error('尚未建立初始化控制记录，不能在页面自动初始化。');await mutation('/api/v3/business/resources',{operationId:newId('RESOURCE'),expectedScheduleRevision:state.revisions.scheduleRevision,expectedProjectionRevision:state.revisions.projectionRevision,resource:state.initialResource});await refresh();say('已登记一个摄影师资源。');}));
$('#add-exception').addEventListener('click',()=>{pageDraftDirty=true;exceptionRow();invalidate();});$('#calendar-form').addEventListener('input',invalidate);
$('#calendar-form').addEventListener('submit',e=>{e.preventDefault();work(async()=>{preview=await api('/api/v3/business/config/preview',{configJson:buildConfig(),...previewBinding()});$('#preview').hidden=false;$('#preview-summary').textContent=preview.impact.ok?'未发现与现有场次冲突。保存会生成新版本，随后尝试生效。':messages[preview.impact.code]||`不能生效：${preview.impact.code}`;$('#conflicts').replaceChildren(...(preview.impact.conflicts||[]).map(c=>row('li',`${c.scheduleItemId}：不在新工作时段内`)));$('#publish').dataset.locked=preview.impact.ok?'':'yes';say('预览完成。');});});
async function activate(version,binding){if(!binding)throw new Error('请重新核对这份规则。');const config=state.configs.find(c=>c.configVersion===version);if(!config)throw new Error('请刷新并选择已保存配置。');const checked=await api('/api/v3/business/config/preview',{configJson:config.configJson,...binding});if(!checked.impact.ok)throw fail(checked.impact);await mutation('/api/v3/business/config/activate',{operationId:newId('ACTIVATE'),configVersion:version,expectedProjectionRevision:checked.expectedProjectionRevision});await refresh();say('新工作规则已生效。既有场次未被移动。');}
$('#publish').addEventListener('click',()=>work(async()=>{if(!preview?.impact.ok)throw new Error('请先完成无冲突预览。');const version=newId('calendar');const binding={expectedProjectionRevision:preview.expectedProjectionRevision,baseConfigDigest:preview.baseConfigDigest};await mutation('/api/v3/business/config/publish',{operationId:newId('PUBLISH'),configVersion:version,algorithmVersion:preview.configJson.schemaVersion===3?'deterministic-scheduler-v2':'deterministic-scheduler-v1',calendarCompilerVersion:`calendar-compiler-v${preview.configJson.schemaVersion}`,estimatePolicyVersion:'estimate-policy-v1',configJson:preview.configJson,configDigest:preview.configDigest});await refresh();published=version;$('#published').hidden=false;try{await activate(version,binding);}catch(e){say(`配置已保存，尚未生效。${e.message}`);}}));
$('#saved-version').addEventListener('change',()=>{published=null;$('#saved-preview').hidden=true;});
$('#inspect-saved').addEventListener('click',()=>work(async()=>{
 const selected=state.configs.find(c=>c.configVersion===$('#saved-version').value);if(!selected)throw new Error('请先选择待生效记录。');
 const checked=await api('/api/v3/business/config/preview',{configJson:selected.configJson,...previewBinding()});
 const c=selected.configJson,week=['','周一','周二','周三','周四','周五','周六','周日'];
 const windows=ws=>ws.map(w=>`${w.start}–${w.end}`).join('、')||'休息';
 $('#saved-details').textContent=`保存记录：${selected.configVersion}；时区：${c.businessTimeZone}。`+c.resourceCalendars.map(cal=>{
   const rules=cal.rules||[{effectiveFrom:'旧版每周规则',weeklyWindows:cal.weeklyWindows,alternatingSaturday:null}];
   return `资源 ${state.resources.find(r=>r.resource_id===cal.resourceId)?.v1_display_place||cal.resourceId}：`+rules.map(r=>`从 ${r.effectiveFrom} 起，`+[1,2,3,4,5,6,7].map(day=>`${week[day]} ${windows(r.weeklyWindows.filter(w=>w.weekday===day))}`).join('；')+(r.alternatingSaturday?`；周六按隔周规则替代，锚点 ${r.alternatingSaturday.workingAnchorDate}，上班时段 ${windows(r.alternatingSaturday.windows)}`:'')).join('。')+'。日期例外：'+(cal.dateOverrides.map(d=>d.date+' '+(d.status==='closed'?'休息':windows(d.windows))).join('；')||'无');
 }).join('。')+'。基准耗时：'+c.durationFallbackRules.map(r=>`${r.productionType||'全部类型'}/${r.shootingSubtype||'全部子类型'} ${r.durationMs/60000}分钟`).join('、')+'。拍后缓冲：'+c.bufferRules.map(r=>`${r.productionType||'全部类型'}/${r.shootingSubtype||'全部子类型'} ${r.bufferAfterMinutes}分钟`).join('、');
 $('#saved-record').textContent=JSON.stringify(c,null,2);
 $('#saved-conflicts').replaceChildren(...(checked.impact.conflicts||[]).map(c=>row('li',`冲突场次：${c.scheduleItemId}`)));if(!checked.impact.ok)$('#saved-conflicts').append(row('li',messages[checked.impact.code]||checked.impact.code));
 published=checked.impact.ok?selected.configVersion:null;publishedBinding={expectedProjectionRevision:checked.expectedProjectionRevision,baseConfigDigest:checked.baseConfigDigest};$('#activate').dataset.locked=published?'':'yes';$('#saved-preview').hidden=false;
}));
$('#activate').addEventListener('click',()=>work(async()=>{if(!published)throw new Error('请先核对待生效规则。');await activate(published,publishedBinding);}));
$('#reschedule-form').addEventListener('submit',e=>{e.preventDefault();work(async()=>{const config=active();if(!config||!editing)throw new Error('请先选择场次及有效日历。');const iso=id=>new Date(`${$('#shoot-date').value}T${$(id).value}:00+08:00`).toISOString();await mutation(`/api/v3/business/schedule-items/${encodeURIComponent(editing.id)}/reschedule`,{operationId:newId('MOVE'),scheduleItemId:editing.id,resourceId:editing.resourceId,plannedStart:iso('#shoot-start'),plannedEnd:iso('#shoot-end'),expectedScheduleRevision:state.revisions.scheduleRevision,expectedProjectionRevision:state.revisions.projectionRevision,configDigest:config.configDigest});$('#reschedule-form').hidden=true;editing=null;await refresh();say('改期已保存，未发送外部通知。');});});
$('#cancel-edit').addEventListener('click',()=>{$('#reschedule-form').hidden=true;editing=null;});
$('#reconcile').addEventListener('click',()=>work(async()=>{if(!pending)return;const result=await api(`/api/v3/business/operations/${encodeURIComponent(pending.id)}`);if(result.ok){const wasOrder=pending.path==='/api/v3/business/requests';savePending(null);if(wasOrder)resetOrderForm();await refresh();say('已找到原操作回执，请查看当前状态后继续。');}}));
$('#proposal-form').addEventListener('submit',e=>{e.preventDefault();work(async()=>{const start=new Date(`${$('#plan-from').value}T00:00:00+08:00`),end=new Date(`${$('#plan-through').value}T00:00:00+08:00`);end.setTime(end.getTime()+86400000);proposal=await mutation('/api/v3/business/proposals',{operationId:newId('PLAN'),planningWindowStart:start.toISOString(),planningWindowEnd:end.toISOString(),resourceScope:state.resources.map(r=>r.resource_id)});renderProposal();say('提案已生成，尚未采用。');});});
function renderProposal(){const p=proposal.proposal;const out=$('#proposal');out.replaceChildren();const items=JSON.parse(p.proposedItemsJson),diagnostics=JSON.parse(p.diagnosticsJson);for(const i of items)out.append(row('p',`${i.requestId} · ${local(i.plannedStart)} — ${local(i.plannedEnd)}`));for(const d of diagnostics)out.append(row('p',`待处理：${d.code} ${d.requestId||''}`));if(!items.length)out.append(row('p','没有可采用场次，请完善任务资料或调整范围。'));
 for(const [type,text]of [['accept','采用全部场次'],['reject','放弃这份提案']]){if(type==='accept'&&!items.length)continue;const b=row('button',text);b.type='button';b.addEventListener('click',()=>work(async()=>{await mutation(`/api/v3/proposals/${encodeURIComponent(p.proposalId)}/decisions`,{decisionId:newId('DECISION'),proposalId:p.proposalId,decisionType:type,selectedProposalItemIds:type==='accept'?items.map(i=>i.proposalItemId):null,decisionNote:null,reasonCode:type==='reject'?'HUMAN_REJECTED':null});out.replaceChildren(row('p',type==='accept'?'已采用。':'已放弃。'));await refresh();say('提案处理完成。');}));out.append(b);}}
// Preserve semantic disabled state in addition to in-flight guards.
const baseSync=syncBusy;syncBusy=function(){baseSync();document.querySelectorAll('button[data-locked="yes"]').forEach(b=>b.disabled=true);};syncBusy();

function choiceKey(id){return `jso.choice.${JSON.stringify([state.principal.subjectId,[...state.principal.resourceIds].sort()])}.${id}`;}
function rememberChoice(id){try{sessionStorage.setItem(choiceKey(id),$('#'+id).value);}catch{}}
function renderSessionChoice(id,sessions,label){
 const select=$('#'+id),key=choiceKey(id);let selected='';
 if(select.dataset.owner===key)selected=select.value;
 else try{selected=sessionStorage.getItem(key)||'';}catch{}
 const valid=sessions.some(s=>s.id===selected),placeholder=row('option',selected&&!valid?'原场次已不适用，请重新选择':'请选择场次');placeholder.value='';
 select.replaceChildren(placeholder,...sessions.map(s=>{const o=row('option',label(s));o.value=s.id;return o;}));
 select.value=valid?selected:'';select.dataset.owner=key;
 $('#'+id+'-notice').textContent=selected&&!valid?'原先选择的场次已不在当前可操作范围，请重新选择后再操作。':'';
 rememberChoice(id);
}
for(const id of ['actual-item','dynamic-item'])$('#'+id).addEventListener('change',()=>{rememberChoice(id);$('#'+id+'-notice').textContent='';});
function loadDynamic(){
 dayPreview=null;$('#dynamic-preview').hidden=true;
 const s=state?.sessions.find(s=>s.id===$('#dynamic-item').value);
 if(!s){$('#dynamic-facts').textContent='请先选择当天场次。';for(const id of ['dynamic-start','dynamic-end','dynamic-buffer'])$('#'+id).value='';return;}
 const forecast=s.confirmedForecast;
 const facts=(s.runs||[]).length?'已记录执行事实：'+s.runs.map(r=>`${({scheduled:'未开始',shooting:'拍摄中',blocked:'受阻',completed:'已完成',cancelled:'已取消'})[r.status]||r.status}；实际开始 ${r.startedAt?local(r.startedAt):'未记录'}；实际完成 ${r.completedAt?local(r.completedAt):'未记录'}`).join('。'):'尚无执行事实，不能把过期计划推定为已经结束。';
 $('#dynamic-facts').textContent=`原计划：${local(s.plannedStart)} — ${local(s.plannedEnd)}。`+(forecast?`已确认预计结束：${local(forecast.estimatedEnd)}（确认于 ${local(forecast.confirmedAt)}，不是实际完成）。`:'尚无已确认预计结束。')+facts;
 const useForecast=$('#dynamic-mode').value==='forecast';
 $('#dynamic-start').value=local(s.plannedStart).slice(11,16);
 $('#dynamic-end').value=useForecast?(forecast?local(forecast.estimatedEnd).slice(11,16):''):local(s.plannedEnd).slice(11,16);
 $('#dynamic-buffer').value=(useForecast?forecast?.bufferAfterMinutes:null)??s.bufferAfterMinutes??'';
}
$('#dynamic-mode').addEventListener('change',loadDynamic);
function selectDynamic(){const s=state?.sessions.find(s=>s.id===$('#dynamic-item').value);$('#dynamic-mode').value=s?.runs?.length?'forecast':'plan';loadDynamic();}
$('#dynamic-item').addEventListener('change',selectDynamic);
$('#dynamic-form').addEventListener('input',()=>{dayPreview=null;$('#dynamic-preview').hidden=true;});
$('#dynamic-form').addEventListener('submit',e=>{e.preventDefault();work(async()=>{
 const s=state.sessions.find(s=>s.id===$('#dynamic-item').value);if(!s)throw new Error('当天没有可选择的场次。');
 const mode=$('#dynamic-mode').value;const instant=id=>new Date(`${state.businessToday}T${$(id).value}:00+08:00`).toISOString();
 const input={scheduleItemId:s.id,resourceId:s.resourceId,mode,plannedStart:mode==='plan'?instant('#dynamic-start'):null,endAt:instant('#dynamic-end'),bufferAfterMinutes:Number($('#dynamic-buffer').value)};
 const result=await api('/api/v3/business/day-adjustment/preview',input);dayPreview=result;
 const p=result.preview;$('#dynamic-summary').textContent=p.canApply?'请核对以下整批调整。保存前会再次校验现场和版本。':'存在未解决项，整批不会保存。请调整输入或明确某日例外后重新预览。';
 $('#dynamic-changes').replaceChildren();if(p.forecast)$('#dynamic-changes').append(row('li',`Owner预计结束 ${local(p.forecast.estimatedEnd)}；不是实际完成记录。本场预计缓冲 ${p.forecast.bufferAfterMinutes} 分钟。`));
 for(const c of p.changes)$('#dynamic-changes').append(row('li',`${c.before.scheduleItemId}：${local(c.before.plannedStart)}–${local(c.before.plannedEnd)} → ${local(c.after.plannedStart)}–${local(c.after.plannedEnd)}；缓冲 ${c.after.bufferAfterMinutes} 分钟`));
 for(const issue of [...p.warnings,...p.unresolved])$('#dynamic-changes').append(row('li',`${issue.scheduleItemId||''} ${dynamicReason(issue.code)}`));
 $('#dynamic-confirm').dataset.locked=p.canApply?'':'yes';$('#dynamic-preview').hidden=false;
 });});
const dynamicReason=code=>({PREDECESSOR_ORDER_CONFLICT:'不能越过原先前序场次，必须保持顺序。',FORECAST_OUTSIDE_DEFAULT_WINDOW:'现场估计越出默认工作窗口：请确认现场处理；不会据此批准加班。',ANCHOR_OUTSIDE_WORK_WINDOW:'本场无法完整落在工作时段内（含缓冲）。',NO_ROOM_TODAY:'当天无法容纳，未自动跨天或取消。',FIXED_SUCCESSOR_CONFLICT:'与已开始、锁定或其他不可移动后续安排冲突。',ANCHOR_FIXED_CONFLICT:'与固定占用冲突。',OTHER_RUN_END_UNKNOWN:'其他正在执行场次的结束时间未知。',UNKNOWN_OCCUPANCY:'占用信息不完整，不能确认。'}[code]||code);
$('#dynamic-confirm').addEventListener('click',()=>work(async()=>{if(!dayPreview?.preview.canApply)throw new Error('请先完成可行的预览。');await mutation('/api/v3/business/day-adjustment/apply',{operationId:newId('DAY'),input:dayPreview.preview.input,previewDigest:dayPreview.previewDigest});await refresh();say('整批调整已保存；实际事实未改写，未发送外部通知。');}));

function durationFields(config){return [['duration-detail','细节'],['duration-model','模特'],['duration-scene','场景'],...(config.schemaVersion===3?[['duration-main3d','产品3D主图'],['duration-still-detail','细节图'],['duration-function','功能图']]:[])];}
let draftOperationId=newId('ORDER'),referenceFiles=[],referenceUploads=new Map();
function resetOrderDraft(){draftOperationId=newId('ORDER');referenceFiles=[];referenceUploads.clear();$('#reference-files').value='';$('#reference-selection').replaceChildren();}
function resetOrderForm(){resetOrderDraft();$('#order-form').reset();editingOrder=null;$('#order-references').disabled=false;$('#order-edit-state').textContent='新建订单';syncOrderCategory();}
function renderReferenceSelection(){const list=$('#reference-selection');list.replaceChildren();for(const file of referenceFiles)list.append(row('li',file.name+' · '+(referenceUploads.has(file)?'已上传，待订单关联':'待上传')));}
$('#reference-files').addEventListener('change',()=>{if(busy||pending||editingOrder)return;const files=mergeFiles(referenceFiles,Array.from($('#reference-files').files));const error=fileSelectionError(files.map(file=>({file,kind:'image'})));if(error){say(error);$('#reference-files').value='';return;}referenceFiles=files;renderReferenceSelection();});
async function uploadReferences(){
 for(const file of referenceFiles){if(referenceUploads.has(file))continue;
  const path='/api/v3/business/references?operationId='+encodeURIComponent(draftOperationId),init={method:'POST',headers:{...(browserSession.enabled?{}:{Authorization:'Bearer '+token}),'Content-Type':file.type,'X-File-Name':encodeURIComponent(file.name)},body:file};const response=await(browserSession.enabled?browserSession.request(path,init):fetch(path,init));
  const result=await response.json();if(!response.ok||!result.ok)throw new Error('参考图上传未完成：'+(result.code||'请重试')+'；订单尚未保存。');
  referenceUploads.set(file,result.upload.id);renderReferenceSelection();
 }
 return [...new Set(referenceFiles.map(f=>referenceUploads.get(f)))];
}

const orderFields={sku:'sku',name:'name',requestedBy:'requested',desiredDate:'date',aspectRatio:'ratio',sampleStatus:'sample',priority:'priority',lightingPreset:'light',reflectivity:'reflectivity',coreBriefSummary:'brief',note:'note'};
function beginOrderEdit(r){editingOrder=r.id;resetOrderDraft();$('#order-references').disabled=true;const v=r.submission;for(const [key,id]of Object.entries(orderFields))$('#order-'+id).value=v[key]??'';$('#order-category').value=v.kind;$('#order-subtype').value=v.shootingSubtype;$('#order-count').value=v.deliverables.count;$('#order-edit-state').textContent='维护：'+r.name;syncOrderCategory();}
function renderOrderPanel(){
 $('#order-panel').hidden=state.protocolVersion!==3||state.principal.role!=='administrator';
 const facts=state.orderFacts||[],filter=$('#order-filter').value||'all';
 const names=['产品3D主图','细节图','功能图','模特','场景','细节'];
 $('#order-counts').textContent=`全部 ${facts.length}；静物 ${facts.filter(r=>r.kind==='静物').length}；`+names.map(n=>`${n==='细节'?'历史细节（未细分）':n} ${facts.filter(r=>r.shootingSubtype===n).length}`).join('；');
 $('#order-list').replaceChildren();
 for(const r of facts.filter(r=>filter==='all'||(filter==='静物'?r.kind==='静物':r.shootingSubtype===filter))){const line=row('p',`${r.name} · ${r.kind==='静物'?'静物 / ':''}${r.shootingSubtype==='细节'?'历史细节（未细分）':r.shootingSubtype} · ${r.lifecycle}`);if(r.editable&&r.shootingSubtype!=='细节'){const b=row('button','维护未排订单');b.type='button';b.addEventListener('click',()=>beginOrderEdit(r));line.append(b);}line.append(referenceGallery(r.references,()=>token));$('#order-list').append(line);}
 renderSessionChoice('actual-item',state.sessions.filter(s=>s.status==='confirmed'),s=>`${s.requestNames?.join('、')||s.id} · ${local(s.plannedStart)} · ${s.runs?.[0]?.status||'未开始'}`);
}
function syncOrderCategory(){$('#order-subtype-label').hidden=$('#order-category').value!=='静物';}
$('#order-category').addEventListener('change',syncOrderCategory);
$('#order-filter').addEventListener('change',renderOrderPanel);
$('#order-new').addEventListener('click',()=>{editingOrder=null;resetOrderDraft();$('#order-references').disabled=false;$('#order-edit-state').textContent='新建订单';});
$('#order-form').addEventListener('submit',e=>{e.preventDefault();work(async()=>{
 const category=$('#order-category').value;const submission={schemaVersion:3,operationId:editingOrder?newId('ORDER'):draftOperationId,productionType:'平面',kind:category,shootingSubtype:category==='静物'?$('#order-subtype').value:category,deliverables:{type:'flat',count:Number($('#order-count').value)},uploadIds:[]};
 for(const [key,id]of Object.entries(orderFields))submission[key]=$('#order-'+id).value;
 if(!editingOrder)submission.uploadIds=await uploadReferences();
 const command={submission,expectedScheduleRevision:state.revisions.scheduleRevision,expectedProjectionRevision:state.revisions.projectionRevision,...(editingOrder?{requestId:editingOrder}:{})};
 await mutation(editingOrder?'/api/v3/business/requests/edit':'/api/v3/business/requests',command);resetOrderForm();await refresh();say('订单已保存，请明确逐单时长后预览首次排期。');
});});
async function actualEvent(eventType){const s=state.sessions.find(s=>s.id===$('#actual-item').value);if(!s)throw new Error('请选择已确认场次。');const run=s.runs?.[0];await mutation('/api/v3/business/run-events',{eventId:newId('ACTUAL'),runId:run?.id||newId('RUN'),scheduleItemId:s.id,eventType,expectedRunRevision:run?.runRevision??0});await refresh();say(eventType==='start'?'已按当前时间记录实际开拍。':'已按当前时间记录实际完成。');}
$('#actual-start').addEventListener('click',()=>work(()=>actualEvent('start')));
$('#actual-complete').addEventListener('click',()=>work(()=>actualEvent('complete')));

// Existing authenticated snapshot, with one bounded read. Preserve drafts and
// their original CAS base; never silently rebase an unsaved form onto new facts.
let automaticRead=false,automaticTimer=null,automaticController=null,automaticDisplayed=null;
async function refreshScheduleAutomatically(){
 if(automaticRead||(!token&&!browserSession.authenticated)||!state||busy||pending||document.hidden)return;
 const original=state,identityToken=token;automaticRead=true;
 const controller=automaticController=new AbortController(),deadline=window.setTimeout(()=>controller.abort(),10000);
 try{const next=await api('/api/v3/business/state',undefined,controller.signal);
  if(token!==identityToken||state!==original||busy||pending)return;
  const keys=['scheduleRevision','projectionRevision'],displayed=automaticDisplayed||state.revisions;
  const draft=pageDraftDirty||editingOrder||editing||dayPreview||preview||proposal||published||referenceFiles.length;
  if(keys.some(k=>next.revisions?.[k]<displayed?.[k]))return;
  if(keys.every(k=>next.revisions?.[k]===displayed?.[k])){
   const sameBase=keys.every(k=>next.revisions?.[k]===state.revisions?.[k])&&next.businessToday===state.businessToday;
   if(!sameBase&&!draft){state=next;render();$('#auto-sync-state').textContent='今日作业已更新。';}
   else if(sameBase){state.dailyOperations=next.dailyOperations;state.writeAdmission=next.writeAdmission;renderDaily(state);}
   else renderDaily(next);
   syncBusy();return;
  }
  automaticDisplayed=next.revisions;
  if(draft){renderSessions(next);renderDaily(next);syncBusy();$('#auto-sync-state').textContent='排班已更新；未保存的编辑已保留，请刷新后重新核对。';}
  else{state=next;render();$('#auto-sync-state').textContent='排班已自动更新。';}
 }catch{if(token===identityToken)$('#auto-sync-state').textContent='暂未更新，当前显示为最近读取的安排。';}
 finally{window.clearTimeout(deadline);if(automaticController===controller)automaticController=null;automaticRead=false;}
}
if(typeof window!=='undefined'){
 const start=()=>{if(automaticTimer===null)automaticTimer=window.setInterval(()=>{void refreshScheduleAutomatically();},5000);};
 document.addEventListener('input',e=>{if(e.target.closest?.('#workspace'))pageDraftDirty=true;});
 document.addEventListener('change',e=>{if(e.target.closest?.('#workspace'))pageDraftDirty=true;});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshScheduleAutomatically();});
 window.addEventListener('focus',()=>{void refreshScheduleAutomatically();});
 window.addEventListener('pagehide',()=>{window.clearInterval(automaticTimer);automaticTimer=null;automaticController?.abort();});
 window.addEventListener('pageshow',start);start();
}

function showView(field){
 $('#management-view').hidden=field;$('#owner-field').hidden=!field;
 if(browserSession.enabled){window.dispatchEvent(new CustomEvent('jso-field-view',{detail:{active:field}}));location.hash=field?'field':'manage';}
}
$('#view-manage').addEventListener('click',()=>showView(false));
$('#view-field').addEventListener('click',()=>{if(pending||busy){say('请先核对当前管理操作。');return;}showView(true);});
if(typeof window!=='undefined')window.addEventListener('jso-session-changed',()=>{
 if(browserSession.enabled&&!browserSession.authenticated){clearReferenceImages();state=null;$('#workspace').hidden=true;$('#login').hidden=false;$('#view-switch').hidden=true;showView(false);}
});
if(typeof window!=='undefined')(async()=>{try{await browserSession.init();if(browserSession.enabled){$('#login-policy').textContent='凭据仅用于换取安全会话，不保存在浏览器存储中。会话过期或服务重启后需重新登录；本人现场原记录保留。';await import('./kiosk-online-v3.js?v=jso-session-field-20261018-r1');if(browserSession.authenticated){await refresh();$('#view-switch').hidden=false;showView(location.hash==='#field');}}}catch{say('会话暂未恢复，请联网后重新登录；未确认记录仍保留。');}})();
