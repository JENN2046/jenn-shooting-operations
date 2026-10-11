const $=s=>document.querySelector(s);
let dayPreview=null;
let token='',state=null,preview=null,published=null,publishedBinding=null,editing=null,proposal=null,busy=false;
let pending=null;try{pending=JSON.parse(sessionStorage.getItem('jso.pending.operation')||'null');}catch{}
const messages={DYNAMIC_FORECAST_NOT_CURRENT:'需要已有的正在拍摄或受阻执行记录；未确认的实际状态不能当作已知。',DYNAMIC_OCCUPANCY_UNKNOWN:'已有占用信息不完整，请先核对。',DYNAMIC_PREVIEW_CHANGED:'现场、安排或配置已变化，请重新预览。',DYNAMIC_TODAY_ONLY:'仅支持北京时间当天，结束时间必须晚于现在。',DYNAMIC_UNRESOLVED:'存在未解决项，整批未保存。',FORBIDDEN:'没有这个资源的操作权限。',WRITE_ADMISSION_DISABLED:'当前处于禁写状态，不能保存。',CALENDAR_HAS_CONFLICTS:'新规则与已排场次冲突，请先改期。',SCHEDULING_REVISION_CONFLICT:'安排已被其他操作更新，请刷新并重新核对。',RESCHEDULE_REVISION_CONFLICT:'安排已变化，请刷新后重新核对。',SCHEDULING_RESOURCE_OVERLAP_OR_UNKNOWN:'与已有拍摄或缓冲冲突，或存在尚未确定的占用。',PAST_CALENDAR_CHANGE_FORBIDDEN:'历史工作规则需要保留，请选择今天或以后的生效日。',SCHEDULING_QUIESCENCE_HELD:'维护操作正在持锁，暂不能修改。',OPERATION_NOT_FOUND:'暂未找到回执，不能据此认定未提交。请保持待核对状态。',CONFIG_SCHEMA_TRANSITION_REQUIRES_REVIEW:'已有旧版日历需要单独迁移，页面暂不直接转换。'};
function say(text){$('#message').textContent=text;}
function syncBusy(){document.querySelectorAll('button').forEach(b=>b.disabled=busy||Boolean(pending)&&!['login-button','reconcile','refresh','logout'].includes(b.id));$('#unknown').hidden=!pending;}
function savePending(value){pending=value;if(value)sessionStorage.setItem('jso.pending.operation',JSON.stringify(value));else sessionStorage.removeItem('jso.pending.operation');syncBusy();}
function fail(result){return new Error(messages[result.code]||`操作未完成：${result.code||'请稍后核对'}`);}
async function api(path,body){const response=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});let result;try{result=await response.json();}catch{throw new Error('响应无法确认，请核对原操作结果。');}if(!response.ok||!result.ok)throw Object.assign(fail(result),{definite:response.status<500,result});return result;}
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
 const remove=row('button','删除例外');remove.type='button';remove.className='secondary';remove.addEventListener('click',()=>{e.remove();invalidate();});e.append(remove);
 const past=value.date&&value.date<state.businessToday;if(past){remove.dataset.locked='yes';e.querySelectorAll('input,select,button').forEach(el=>el.disabled=true);}
 const enabled=()=>times.forEach(t=>t.disabled=past||select.value==='closed');select.addEventListener('change',enabled);enabled();
 e.values=()=>({date:date.value,status:select.value,windows:select.value==='closed'?[]:[{start:times[0].value,end:times[1].value},...(times[2].value||times[3].value?[{start:times[2].value,end:times[3].value}]:[])]});$('#exceptions').append(e);
}
function invalidate(){preview=null;$('#preview').hidden=true;}
function render(){
 $('#workspace').hidden=false;$('#login').hidden=true;$('#identity').textContent=`${state.principal.subjectId} · ${state.writeAdmission==='disabled'?'当前禁写':'可编辑'} · 北京时间`;
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
 $('#requests').replaceChildren();for(const request of state.requests||[]){const form=document.createElement('form');form.append(row('strong',request.name));const label=row('label','预计拍摄分钟数'),input=document.createElement('input');input.type='number';input.min='1';input.max='1440';input.required=true;input.value=request.durationEstimateJson?JSON.parse(request.durationEstimateJson).durationMs/60000:'';label.append(input);form.append(label);const save=row('button','保存该单时长');save.type='submit';form.append(save);form.addEventListener('submit',e=>{e.preventDefault();work(async()=>{await mutation(`/api/v3/business/requests/${encodeURIComponent(request.id)}/duration`,{operationId:newId('DURATION'),requestId:request.id,expectedScheduleRevision:state.revisions.scheduleRevision,expectedProjectionRevision:state.revisions.projectionRevision,durationMinutes:Number(input.value)});await refresh();say('逐单时长已保存，已有场次未移动。');});});$('#requests').append(form);}
 $('#sessions').replaceChildren();for(const s of state.sessions){const e=row('div','');e.className='session';e.append(row('strong',s.requestNames?.join('、')||'未命名拍摄'),row('p',`${local(s.plannedStart)} — ${local(s.plannedEnd)} · 缓冲 ${s.bufferAfterMinutes??'未确定'} 分钟`));const b=row('button','调整时间');b.type='button';b.disabled=s.hasRunHistory||s.lockStatus!=='unlocked'||s.status==='cancelled';b.dataset.locked=b.disabled?'yes':'';b.addEventListener('click',()=>{editing=s;$('#reschedule-form').hidden=false;$('#edit-title').textContent=`调整 ${s.requestNames?.join('、')||'拍摄场次'}`;const start=local(s.plannedStart).split(' '),end=local(s.plannedEnd).split(' ');$('#shoot-date').value=start[0];$('#shoot-start').value=start[1];$('#shoot-end').value=end[1];$('#buffer-note').textContent=`拍后保留 ${s.bufferAfterMinutes} 分钟。改期不会发送外部通知。`;$('#shoot-date').focus();});e.append(b);$('#sessions').append(e);}
 if(!state.sessions.length)$('#sessions').append(row('p','暂无已排场次。'));
 dayPreview=null;$('#dynamic-preview').hidden=true;renderSessionChoice('dynamic-item',state.sessions.filter(s=>s.status==='confirmed'&&local(s.plannedStart).slice(0,10)===state.businessToday),s=>s.requestNames?.join('、')||s.id);selectDynamic();
 $('#plan-from').value=state.businessToday;$('#plan-through').value=state.businessToday;
 const inactive=state.configs.filter(c=>!c.active&&!c.everActive);published=null;$('#saved-preview').hidden=true;
 $('#saved-version').replaceChildren(...inactive.map(c=>{const o=row('option',`保存于 ${local(c.publishedAt)} · ${c.configVersion.slice(-8)}`);o.value=c.configVersion;return o;}));$('#published').hidden=!inactive.length||state.principal.role!=='administrator';
 renderOrderPanel();invalidate();syncBusy();
}
// All user times are explicit Asia/Shanghai; host timezone is irrelevant.
function local(iso){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map(v=>[v.type,v.value]));return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;}
async function refresh(){state=await api('/api/v3/business/state');render();}
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
$('#login').addEventListener('submit',e=>{e.preventDefault();work(async()=>{token=$('#token').value;$('#token').value='';await refresh();say('已读取工作安排。');});});
$('#logout').addEventListener('click',()=>{token='';state=null;$('#workspace').hidden=true;$('#login').hidden=false;say('已退出。未确认操作的引用仍保留，供下次核对。');});
$('#refresh').addEventListener('click',()=>work(refresh));
$('#register').addEventListener('click',()=>work(async()=>{if(!state.revisions)throw new Error('尚未建立初始化控制记录，不能在页面自动初始化。');await mutation('/api/v3/business/resources',{operationId:newId('RESOURCE'),expectedScheduleRevision:state.revisions.scheduleRevision,expectedProjectionRevision:state.revisions.projectionRevision,resource:state.initialResource});await refresh();say('已登记一个摄影师资源。');}));
$('#add-exception').addEventListener('click',()=>{exceptionRow();invalidate();});$('#calendar-form').addEventListener('input',invalidate);
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
$('#reconcile').addEventListener('click',()=>work(async()=>{if(!pending)return;const result=await api(`/api/v3/business/operations/${encodeURIComponent(pending.id)}`);if(result.ok){savePending(null);await refresh();say('已找到原操作回执，请查看当前状态后继续。');}}));
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
let editingOrder=null;
const orderFields={sku:'sku',name:'name',requestedBy:'requested',desiredDate:'date',aspectRatio:'ratio',sampleStatus:'sample',priority:'priority',lightingPreset:'light',reflectivity:'reflectivity',coreBriefSummary:'brief',note:'note'};
function renderOrderPanel(){
 $('#order-panel').hidden=state.protocolVersion!==3||state.principal.role!=='administrator';
 const facts=state.orderFacts||[],filter=$('#order-filter').value||'all';
 const names=['产品3D主图','细节图','功能图','模特','场景','细节'];
 $('#order-counts').textContent=`全部 ${facts.length}；静物 ${facts.filter(r=>r.kind==='静物').length}；`+names.map(n=>`${n==='细节'?'历史细节（未细分）':n} ${facts.filter(r=>r.shootingSubtype===n).length}`).join('；');
 $('#order-list').replaceChildren();
 for(const r of facts.filter(r=>filter==='all'||(filter==='静物'?r.kind==='静物':r.shootingSubtype===filter))){const line=row('p',`${r.name} · ${r.kind==='静物'?'静物 / ':''}${r.shootingSubtype==='细节'?'历史细节（未细分）':r.shootingSubtype} · ${r.lifecycle}`);if(r.editable&&r.shootingSubtype!=='细节'){const b=row('button','维护未排订单');b.type='button';b.addEventListener('click',()=>{editingOrder=r.id;const v=r.submission;for(const [key,id]of Object.entries(orderFields))$('#order-'+id).value=v[key]??'';$('#order-category').value=v.kind;$('#order-subtype').value=v.shootingSubtype;$('#order-count').value=v.deliverables.count;$('#order-edit-state').textContent='维护：'+r.name;syncOrderCategory();});line.append(b);}$('#order-list').append(line);}
 renderSessionChoice('actual-item',state.sessions.filter(s=>s.status==='confirmed'),s=>`${s.requestNames?.join('、')||s.id} · ${local(s.plannedStart)} · ${s.runs?.[0]?.status||'未开始'}`);
}
function syncOrderCategory(){$('#order-subtype-label').hidden=$('#order-category').value!=='静物';}
$('#order-category').addEventListener('change',syncOrderCategory);
$('#order-filter').addEventListener('change',renderOrderPanel);
$('#order-new').addEventListener('click',()=>{editingOrder=null;$('#order-edit-state').textContent='新建订单';});
$('#order-form').addEventListener('submit',e=>{e.preventDefault();work(async()=>{
 const category=$('#order-category').value;const submission={schemaVersion:3,operationId:newId('ORDER'),productionType:'平面',kind:category,shootingSubtype:category==='静物'?$('#order-subtype').value:category,deliverables:{type:'flat',count:Number($('#order-count').value)},uploadIds:[]};
 for(const [key,id]of Object.entries(orderFields))submission[key]=$('#order-'+id).value;
 const command={submission,expectedScheduleRevision:state.revisions.scheduleRevision,expectedProjectionRevision:state.revisions.projectionRevision,...(editingOrder?{requestId:editingOrder}:{})};
 await mutation(editingOrder?'/api/v3/business/requests/edit':'/api/v3/business/requests',command);editingOrder=null;$('#order-edit-state').textContent='新建订单';await refresh();say('订单已保存，请明确逐单时长后预览首次排期。');
});});
async function actualEvent(eventType){const s=state.sessions.find(s=>s.id===$('#actual-item').value);if(!s)throw new Error('请选择已确认场次。');const run=s.runs?.[0];await mutation('/api/v3/business/run-events',{eventId:newId('ACTUAL'),runId:run?.id||newId('RUN'),scheduleItemId:s.id,eventType,expectedRunRevision:run?.runRevision??0});await refresh();say(eventType==='start'?'已按当前时间记录实际开拍。':'已按当前时间记录实际完成。');}
$('#actual-start').addEventListener('click',()=>work(()=>actualEvent('start')));
$('#actual-complete').addEventListener('click',()=>work(()=>actualEvent('complete')));
