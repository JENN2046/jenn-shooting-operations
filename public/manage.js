const $=s=>document.querySelector(s);
let token='',state=null,preview=null,published=null,publishedBinding=null,editing=null,proposal=null,busy=false;
let pending=null;try{pending=JSON.parse(sessionStorage.getItem('jso.pending.operation')||'null');}catch{}
const messages={FORBIDDEN:'没有这个资源的操作权限。',WRITE_ADMISSION_DISABLED:'当前处于禁写状态，不能保存。',CALENDAR_HAS_CONFLICTS:'新规则与已排场次冲突，请先改期。',SCHEDULING_REVISION_CONFLICT:'安排已被其他操作更新，请刷新并重新核对。',RESCHEDULE_REVISION_CONFLICT:'安排已变化，请刷新后重新核对。',SCHEDULING_RESOURCE_OVERLAP_OR_UNKNOWN:'与已有拍摄或缓冲冲突，或存在尚未确定的占用。',PAST_CALENDAR_CHANGE_FORBIDDEN:'历史工作规则需要保留，请选择今天或以后的生效日。',SCHEDULING_QUIESCENCE_HELD:'维护操作正在持锁，暂不能修改。',OPERATION_NOT_FOUND:'暂未找到回执，不能据此认定未提交。请保持待核对状态。',CONFIG_SCHEMA_TRANSITION_REQUIRES_REVIEW:'已有旧版日历需要单独迁移，页面暂不直接转换。'};
function say(text){$('#message').textContent=text;}
function syncBusy(){document.querySelectorAll('button').forEach(b=>b.disabled=busy||Boolean(pending)&&!['login-button','reconcile','refresh','logout'].includes(b.id));$('#unknown').hidden=!pending;}
function savePending(value){pending=value;if(value)sessionStorage.setItem('jso.pending.operation',JSON.stringify(value));else sessionStorage.removeItem('jso.pending.operation');syncBusy();}
function fail(result){return new Error(messages[result.code]||`操作未完成：${result.code||'请稍后核对'}`);}
async function api(path,body){const response=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});let result;try{result=await response.json();}catch{throw new Error('响应无法确认，请核对原操作结果。');}if(!response.ok||!result.ok)throw Object.assign(fail(result),{definite:response.status<500,result});return result;}
async function mutation(path,body){if(pending)throw new Error('请先核对上一次操作。');savePending({path,body,id:body.operationId||body.decisionId});try{const r=await api(path,body);savePending(null);return r;}catch(e){if(e.definite)savePending(null);throw e;}}
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
 $('#effective').value=state.businessToday;$('#effective').min=state.businessToday;
 if(rule?.alternatingSaturday)$('#anchor').value=rule.alternatingSaturday.workingAnchorDate;
 for(const [id,v] of [['am-start',windows[0]?.start],['am-end',windows[0]?.end],['pm-start',windows[1]?.start],['pm-end',windows[1]?.end]])if(v)$(`#${id}`).value=v;
 $('#exceptions').replaceChildren();cal.dateOverrides.forEach(exceptionRow);
 for(const [id,subtype] of [['duration-detail','细节'],['duration-model','模特'],['duration-scene','场景']]){const rule=config.durationFallbackRules.find(r=>r.shootingSubtype===subtype);if(rule)$(`#${id}`).value=rule.durationMs/60000;}
 $('#sessions').replaceChildren();for(const s of state.sessions){const e=row('div','');e.className='session';e.append(row('strong',s.requestNames?.join('、')||'未命名拍摄'),row('p',`${local(s.plannedStart)} — ${local(s.plannedEnd)} · 缓冲 ${s.bufferAfterMinutes??'未确定'} 分钟`));const b=row('button','调整时间');b.type='button';b.disabled=s.hasRunHistory||s.lockStatus!=='unlocked'||s.status==='cancelled';b.dataset.locked=b.disabled?'yes':'';b.addEventListener('click',()=>{editing=s;$('#reschedule-form').hidden=false;$('#edit-title').textContent=`调整 ${s.requestNames?.join('、')||'拍摄场次'}`;const start=local(s.plannedStart).split(' '),end=local(s.plannedEnd).split(' ');$('#shoot-date').value=start[0];$('#shoot-start').value=start[1];$('#shoot-end').value=end[1];$('#buffer-note').textContent=`拍后保留 ${s.bufferAfterMinutes} 分钟。改期不会发送外部通知。`;$('#shoot-date').focus();});e.append(b);$('#sessions').append(e);}
 if(!state.sessions.length)$('#sessions').append(row('p','暂无已排场次。'));
 $('#plan-from').value=state.businessToday;$('#plan-through').value=state.businessToday;
 const inactive=state.configs.filter(c=>!c.active&&!c.everActive);published=null;$('#saved-preview').hidden=true;
 $('#saved-version').replaceChildren(...inactive.map(c=>{const o=row('option',`保存于 ${local(c.publishedAt)} · ${c.configVersion.slice(-8)}`);o.value=c.configVersion;return o;}));$('#published').hidden=!inactive.length||state.principal.role!=='administrator';
 invalidate();syncBusy();
}
// All user times are explicit Asia/Shanghai; host timezone is irrelevant.
function local(iso){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map(v=>[v.type,v.value]));return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;}
async function refresh(){state=await api('/api/v2/business/state');render();}
function previewBinding(){return {expectedProjectionRevision:state.revisions?.projectionRevision,baseConfigDigest:active()?.configDigest??null};}
function buildConfig(){const config=draftBase();if(config.schemaVersion!==2)throw new Error('旧版日历需要迁移后再编辑。');const cal=config.resourceCalendars[0],effectiveFrom=$('#effective').value;
 if(effectiveFrom<state.businessToday)throw new Error('请选择今天或以后的生效日期。');
 const windows=[{start:$('#am-start').value,end:$('#am-end').value},{start:$('#pm-start').value,end:$('#pm-end').value}];
 const rules=cal.rules.filter(r=>r.effectiveFrom!==effectiveFrom);rules.push({effectiveFrom,weeklyWindows:[1,2,3,4,5].flatMap(weekday=>windows.map(w=>({weekday,...w}))),alternatingSaturday:{workingAnchorDate:$('#anchor').value,windows}});cal.rules=rules;
 cal.dateOverrides=[...$('#exceptions').children].map(e=>e.values());
 for(const [id,subtype]of[['duration-detail','细节'],['duration-model','模特'],['duration-scene','场景']]){const rule=config.durationFallbackRules.find(r=>r.shootingSubtype===subtype);if(rule)rule.durationMs=Number($(`#${id}`).value)*60000;}
 return config;
}
$('#login').addEventListener('submit',e=>{e.preventDefault();work(async()=>{token=$('#token').value;$('#token').value='';await refresh();say('已读取工作安排。');});});
$('#logout').addEventListener('click',()=>{token='';state=null;$('#workspace').hidden=true;$('#login').hidden=false;say('已退出。未确认操作的引用仍保留，供下次核对。');});
$('#refresh').addEventListener('click',()=>work(refresh));
$('#register').addEventListener('click',()=>work(async()=>{if(!state.revisions)throw new Error('尚未建立初始化控制记录，不能在页面自动初始化。');await mutation('/api/v2/business/resources',{operationId:newId('RESOURCE'),expectedScheduleRevision:state.revisions.scheduleRevision,expectedProjectionRevision:state.revisions.projectionRevision,resource:state.initialResource});await refresh();say('已登记一个摄影师资源。');}));
$('#add-exception').addEventListener('click',()=>{exceptionRow();invalidate();});$('#calendar-form').addEventListener('input',invalidate);
$('#calendar-form').addEventListener('submit',e=>{e.preventDefault();work(async()=>{preview=await api('/api/v2/business/config/preview',{configJson:buildConfig(),...previewBinding()});$('#preview').hidden=false;$('#preview-summary').textContent=preview.impact.ok?'未发现与现有场次冲突。保存会生成新版本，随后尝试生效。':messages[preview.impact.code]||`不能生效：${preview.impact.code}`;$('#conflicts').replaceChildren(...(preview.impact.conflicts||[]).map(c=>row('li',`${c.scheduleItemId}：不在新工作时段内`)));$('#publish').dataset.locked=preview.impact.ok?'':'yes';say('预览完成。');});});
async function activate(version,binding){if(!binding)throw new Error('请重新核对这份规则。');const config=state.configs.find(c=>c.configVersion===version);if(!config)throw new Error('请刷新并选择已保存配置。');const checked=await api('/api/v2/business/config/preview',{configJson:config.configJson,...binding});if(!checked.impact.ok)throw fail(checked.impact);await mutation('/api/v2/business/config/activate',{operationId:newId('ACTIVATE'),configVersion:version,expectedProjectionRevision:checked.expectedProjectionRevision});await refresh();say('新工作规则已生效。既有场次未被移动。');}
$('#publish').addEventListener('click',()=>work(async()=>{if(!preview?.impact.ok)throw new Error('请先完成无冲突预览。');const version=newId('calendar');const binding={expectedProjectionRevision:preview.expectedProjectionRevision,baseConfigDigest:preview.baseConfigDigest};await mutation('/api/v2/business/config/publish',{operationId:newId('PUBLISH'),configVersion:version,algorithmVersion:'deterministic-scheduler-v1',calendarCompilerVersion:'calendar-compiler-v2',estimatePolicyVersion:'estimate-policy-v1',configJson:preview.configJson,configDigest:preview.configDigest});await refresh();published=version;$('#published').hidden=false;try{await activate(version,binding);}catch(e){say(`配置已保存，尚未生效。${e.message}`);}}));
$('#saved-version').addEventListener('change',()=>{published=null;$('#saved-preview').hidden=true;});
$('#inspect-saved').addEventListener('click',()=>work(async()=>{
 const selected=state.configs.find(c=>c.configVersion===$('#saved-version').value);if(!selected)throw new Error('请先选择待生效记录。');
 const checked=await api('/api/v2/business/config/preview',{configJson:selected.configJson,...previewBinding()});
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
$('#reschedule-form').addEventListener('submit',e=>{e.preventDefault();work(async()=>{const config=active();if(!config||!editing)throw new Error('请先选择场次及有效日历。');const iso=id=>new Date(`${$('#shoot-date').value}T${$(id).value}:00+08:00`).toISOString();await mutation(`/api/v2/business/schedule-items/${encodeURIComponent(editing.id)}/reschedule`,{operationId:newId('MOVE'),scheduleItemId:editing.id,resourceId:editing.resourceId,plannedStart:iso('#shoot-start'),plannedEnd:iso('#shoot-end'),expectedScheduleRevision:state.revisions.scheduleRevision,expectedProjectionRevision:state.revisions.projectionRevision,configDigest:config.configDigest});$('#reschedule-form').hidden=true;editing=null;await refresh();say('改期已保存，未发送外部通知。');});});
$('#cancel-edit').addEventListener('click',()=>{$('#reschedule-form').hidden=true;editing=null;});
$('#reconcile').addEventListener('click',()=>work(async()=>{if(!pending)return;const result=await api(`/api/v2/business/operations/${encodeURIComponent(pending.id)}`);if(result.ok){savePending(null);await refresh();say('已找到原操作回执，请查看当前状态后继续。');}}));
$('#proposal-form').addEventListener('submit',e=>{e.preventDefault();work(async()=>{const start=new Date(`${$('#plan-from').value}T00:00:00+08:00`),end=new Date(`${$('#plan-through').value}T00:00:00+08:00`);end.setTime(end.getTime()+86400000);proposal=await mutation('/api/v2/business/proposals',{operationId:newId('PLAN'),planningWindowStart:start.toISOString(),planningWindowEnd:end.toISOString(),resourceScope:state.resources.map(r=>r.resource_id)});renderProposal();say('提案已生成，尚未采用。');});});
function renderProposal(){const p=proposal.proposal;const out=$('#proposal');out.replaceChildren();const items=JSON.parse(p.proposedItemsJson),diagnostics=JSON.parse(p.diagnosticsJson);for(const i of items)out.append(row('p',`${i.requestId} · ${local(i.plannedStart)} — ${local(i.plannedEnd)}`));for(const d of diagnostics)out.append(row('p',`待处理：${d.code} ${d.requestId||''}`));if(!items.length)out.append(row('p','没有可采用场次，请完善任务资料或调整范围。'));
 for(const [type,text]of [['accept','采用全部场次'],['reject','放弃这份提案']]){if(type==='accept'&&!items.length)continue;const b=row('button',text);b.type='button';b.addEventListener('click',()=>work(async()=>{await mutation(`/api/v2/proposals/${encodeURIComponent(p.proposalId)}/decisions`,{decisionId:newId('DECISION'),proposalId:p.proposalId,decisionType:type,selectedProposalItemIds:type==='accept'?items.map(i=>i.proposalItemId):null,decisionNote:null,reasonCode:type==='reject'?'HUMAN_REJECTED':null});out.replaceChildren(row('p',type==='accept'?'已采用。':'已放弃。'));await refresh();say('提案处理完成。');}));out.append(b);}}
// Preserve semantic disabled state in addition to in-flight guards.
const baseSync=syncBusy;syncBusy=function(){baseSync();document.querySelectorAll('button[data-locked="yes"]').forEach(b=>b.disabled=true);};syncBusy();
