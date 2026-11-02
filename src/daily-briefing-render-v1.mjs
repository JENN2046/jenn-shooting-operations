// Pure read-only renderers. Only the briefing DTO is consumed; no clock, I/O,
// network, schedule inference or write-capable link is introduced here.
const STATES = new Set(['ready','empty','unknown','conflict']);
const STATE_LABELS = {ready:'可查看',empty:'无符合条件记录',unknown:'未知 · 数据不足',conflict:'冲突 · 待核实'};
const RUN_LABELS = {notStarted:'尚无开拍事实',scheduled:'待开拍',shooting:'拍摄中',blocked:'受阻',completed:'已完成',cancelled:'本次执行已取消',unknown:'未知 · 待核实'};
const ACTION_LABELS = {ownerField:'核对现场',reconcile:'核实事实',selectActual:'核对实际开拍或完成',viewRun:'查看执行事实',dayAdjustment:'核对当日安排',editOrder:'核对订单',duration:'补充时长依据',proposal:'核对排期建议',viewState:'查看当前状态',reschedule:'核对改期需要'};
const SEVERITIES = {critical:'严重',warning:'提醒',info:'信息'};
const MISSING = '未提供';
const ERROR = '无法生成每日简报：输入无效。未展示输入内容。';
const NOTICE = '只读简报：仅展示已提供的事实，不排期、不发送通知、不修改数据；预计结束不代表实际完成。';
const DATE_NOTICE = '所选日期视图使用当前已记录事实，并非历史状态重放';

// Prevent terminal escapes, bidirectional overrides and untrusted line breaks
// from masquerading as the renderer's own structure. HTML is escaped separately.
const clean = value => typeof value === 'string' ? value
  .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]/g,' ').trim() : '';
const text = value => clean(value) || (typeof value === 'number' && Number.isFinite(value) ? String(value) : MISSING);
const escape = value => text(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function valid(briefing) {
  if (!record(briefing) || briefing.ok !== true || briefing.version !== 1
    || briefing.kind !== 'jso-daily-briefing' || briefing.readonly !== true
    || briefing.timeZone !== 'Asia/Shanghai' || !['complete','needs_review'].includes(briefing.dataQuality)
    || !record(briefing.sections) || !Array.isArray(briefing.issues)) return false;
  return ['today','current','next','readyOrders','attention'].every(key => {
    const section = briefing.sections[key];
    return record(section) && STATES.has(section.state)
      && (['today','readyOrders','attention'].includes(key)
        ? Array.isArray(section.items) && section.items.every(record)
        : section.item === null || record(section.item));
  }) && briefing.issues.every(record);
}

function time(value) {
  if (value === null || value === undefined || value === '') return MISSING;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '未提供（时间待核实）';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',
  }).format(new Date(value)) + '（上海）';
}
const minutes = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value} 分钟` : MISSING;
const message = section => clean(section.message) || MISSING;
const todayHeading = briefing => briefing.date === briefing.businessToday ? '今天' : '所选日期场次';

function sessionFields(item,compact = false) {
  const forecast = record(item.forecast) ? item.forecast : {};
  const status = RUN_LABELS[item.runStatus] || `未识别状态（${text(item.runStatus)}）`;
  if (compact) return [
    ['计划',`${time(item.plannedStart)} → ${time(item.plannedEnd)}`],
    ['执行状态',status],
    ...(item.completedAt === null || item.completedAt === undefined || item.completedAt === ''
      ? [] : [['实际完成',time(item.completedAt)]]),
  ];
  return [
    ['计划开始',time(item.plannedStart)],['计划结束',time(item.plannedEnd)],
    ['执行状态',status],
    ['实际开拍',time(item.startedAt)],['实际完成',time(item.completedAt)],
    ['已记录预计结束',time(forecast.estimatedEnd)],
    ['预计结束后缓冲',minutes(forecast.bufferAfterMinutes)],
  ];
}
const orderFields = item => [
  ['时长',minutes(item.durationMinutes)],['时长依据',text(item.durationSource)],
];
const attentionFields = item => [
  ['级别',SEVERITIES[item.severity] || text(item.severity)],['关联对象',text(item.entityId)],
  ['建议',ACTION_LABELS[item.recommendedAction] || text(item.recommendedAction)],
];
function sourceFields(item,type) {
  if (type === 'session') return [
    ['场次 ID',text(item.id)],['资源',text(item.resourceId)],
    ['预计依据 operationId',text(item.forecast?.operationId)],
  ];
  return type === 'order' ? [['订单 ID',text(item.id)]]
    : [['事项代码',text(item.code)],['关联对象',text(item.entityId)]];
}
function evidenceFields(item,block) {
  const source = sourceFields(item,block.type);
  if (block.type !== 'session') return source;
  const forecast = record(item.forecast) ? item.forecast : {};
  return [...source,['计划时长',minutes(item.plannedDurationMinutes)],...(block.compact ? [
    ['实际开拍',time(item.startedAt)],['已记录预计结束',time(forecast.estimatedEnd)],
    ['预计结束后缓冲',minutes(forecast.bufferAfterMinutes)],
  ] : [])];
}

function blocks(briefing) {
  const sections = briefing.sections;
  return [
    {heading:todayHeading(briefing),section:sections.today,type:'session',compact:true},
    {heading:'当前',section:sections.current,type:'session'},
    {heading:'下一场',section:sections.next,type:'session'},
    {heading:'可排未排',section:sections.readyOrders,type:'order'},
    {heading:'阻塞与待处理',section:sections.attention,type:'attention'},
  ];
}
const items = block => Array.isArray(block.section.items) ? block.section.items : block.section.item ? [block.section.item] : [];
const fields = (item,block) => block.type === 'session' ? sessionFields(item,block.compact) : block.type === 'order' ? orderFields(item) : attentionFields(item);
const itemTitle = (item,type) => text(type === 'attention' ? item.summary : item.name);

export function renderDailyBriefingText(briefing) {
  if (!valid(briefing)) return ERROR;
  const lines = [
    `JSO 每日简报 · ${text(briefing.date)}`,
    NOTICE,
    `所选日期：${text(briefing.date)}；业务今天：${text(briefing.businessToday)}`,
    `业务时区：Asia/Shanghai；观察时间：${time(briefing.observedAt)}`,
    `简报信息：${briefing.dataQuality === 'complete' ? '字段齐备' : '存在待核实信息'}`,
    `修订：排班 ${text(briefing.revisions?.scheduleRevision)} / 投影 ${text(briefing.revisions?.projectionRevision)}`,
  ];
  if (briefing.date !== briefing.businessToday) lines.push(DATE_NOTICE);
  for (const [index,block] of blocks(briefing).entries()) {
    lines.push('',`${index + 1}. ${block.heading}｜${STATE_LABELS[block.section.state]}`,message(block.section));
    for (const item of items(block)) {
      lines.push(`- ${itemTitle(item,block.type)}`);
      for (const [label,value] of fields(item,block)) lines.push(`  ${label}：${value}`);
      lines.push(`  来源依据：${sourceFields(item,block.type).map(([label,value]) => `${label}：${value}`).join('；')}`);
    }
  }
  if (briefing.issues.length) {
    lines.push('','数据核实提示');
    for (const issue of briefing.issues) {
      lines.push(`- ${text(issue.code)}｜${text(issue.section)}｜${text(issue.message)}${issue.entityId === undefined ? '' : `（对象：${text(issue.entityId)}）`}`);
    }
  }
  return lines.join('\n');
}

const CSS = `
:root{color-scheme:light;--ink:#192d3b;--muted:#596b73;--line:#dce3df;--paper:#fffefa;--accent:#195c53}*{box-sizing:border-box}body{margin:0;background:#edf1ed;color:var(--ink);font-family:system-ui,-apple-system,"Noto Sans CJK SC",sans-serif;line-height:1.65}main{max-width:1100px;margin:auto;padding:44px 28px 64px}header{background:var(--ink);color:#fffefa;border-radius:22px;padding:30px 34px;margin-bottom:24px}.eyebrow{font-size:12px;letter-spacing:.16em;color:#bdd5cd}h1{font-size:clamp(25px,4vw,36px);line-height:1.3;margin:10px 0 16px}h2{font-size:20px;margin:0}h3{font-size:17px;overflow-wrap:anywhere;margin:0 0 14px}.notice{font-size:14px;color:#dce7e0;max-width:760px}.meta{display:flex;flex-wrap:wrap;gap:8px 24px;color:#dce7e0;font-size:13px;margin-top:20px}.fixture{background:#fff0c2;color:#5c4100;padding:14px 20px;border:1px solid #e6cc76;border-radius:12px;margin-bottom:18px;font-weight:700}.quality{display:inline-block;border:1px solid #73958c;border-radius:6px;padding:2px 9px;margin-top:16px;font-size:13px}.layout{display:grid;grid-template-columns:1fr 1fr;gap:20px}.section{background:var(--paper);border:1px solid var(--line);border-radius:17px;padding:24px;min-width:0}.section:first-child,.section:last-child{grid-column:1/-1}.section-heading{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.number{color:var(--accent);font-size:13px;font-weight:700}.badge{font-size:12px;padding:3px 8px;border-radius:5px;background:#e8f0eb;color:#25594c}.unknown,.conflict{background:#fbebcc;color:#77500b}.empty{background:#eef0ee;color:#5c6964}.section-message{color:var(--muted);font-size:14px;margin:12px 0 18px;overflow-wrap:anywhere}.cards{display:grid;gap:14px}.item{border-top:1px solid var(--line);padding-top:18px}dl{display:grid;grid-template-columns:minmax(112px,.8fr) minmax(0,1.8fr);gap:6px 14px;margin:0;font-size:13px}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}.issues{margin-top:22px;padding:22px 24px;border-left:3px solid #bb8e3e;background:#fff8e8;border-radius:0 12px 12px 0}.issues li{margin:8px 0;overflow-wrap:anywhere}.issues p{font-size:13px;color:var(--muted)}footer{font-size:12px;color:var(--muted);margin-top:26px}.error{padding:28px;background:var(--paper);border-radius:16px}@media(max-width:680px){main{padding:22px 14px 40px}header{padding:24px 22px}.layout{grid-template-columns:1fr}.section{padding:20px}.section:first-child,.section:last-child{grid-column:auto}dl{grid-template-columns:110px minmax(0,1fr)}}@media print{body{background:white}main{max-width:none;padding:0}header{background:white;color:var(--ink);border:1px solid var(--line)}.eyebrow,.notice,.meta{color:var(--muted)}.section,.item{break-inside:avoid}.layout{display:block}.section{margin-bottom:16px}}`;

const EVIDENCE_CSS = `details{margin-top:14px;border-top:1px dashed var(--line);padding-top:10px}summary{color:var(--muted);font-size:12px;cursor:pointer}details dl{margin-top:12px}.today .cards{grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.today .item{padding:14px;border:1px solid var(--line);border-radius:10px;background:#f8faf6}.today h3{font-size:16px;margin-bottom:8px}.today dl{grid-template-columns:78px minmax(0,1fr);font-size:12px;gap:4px 10px}.date-notice{font-size:13px;color:#f7dca4;margin:16px 0 0}@media(max-width:680px){.today .cards{grid-template-columns:1fr}}@media print{details{break-inside:avoid}.date-notice{color:#77500b}}`;
function document(title,body) {
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${escape(title)}</title><style>${CSS}${EVIDENCE_CSS}</style></head><body><main>${body}</main></body></html>`;
}
const fieldHtml = values => `<dl>${values.map(([label,value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>`;

export function renderDailyBriefingHtml(briefing,{synthetic = false} = {}) {
  const fixture = synthetic === true ? '<aside class="fixture">模拟样本 · 非真实业务数据 · 仅用于本地展示与验证</aside>' : '';
  if (!valid(briefing)) return document('JSO 只读简报 · 输入无效',`${fixture}<div class="error"><h1>无法生成每日简报</h1><p>${ERROR}</p><p>只读展示；未执行任何业务操作。</p></div>`);
  const title = `JSO 每日简报 · ${text(briefing.date)}`;
  const sections = blocks(briefing).map((block,index) => `<section class="section${block.compact ? ' today' : ''}"><div class="section-heading"><span class="number">0${index + 1}</span><h2>${escape(block.heading)}</h2><span class="badge ${block.section.state}">${STATE_LABELS[block.section.state]}</span></div><p class="section-message">${escape(message(block.section))}</p><div class="cards">${items(block).map(item => `<article class="item"><h3>${escape(itemTitle(item,block.type))}</h3>${fieldHtml(fields(item,block))}<details><summary>来源依据</summary>${fieldHtml(evidenceFields(item,block))}</details></article>`).join('')}</div></section>`).join('');
  const issues = briefing.issues.length ? `<aside class="issues"><h2>数据核实提示</h2><p>以下提示描述当前投影的资料边界，不代表已经执行处理。</p><ul>${briefing.issues.map(issue => `<li><strong>${escape(issue.code)}</strong> · ${escape(issue.section)}：${escape(issue.message)}${issue.entityId === undefined ? '' : `（对象：${escape(issue.entityId)}）`}</li>`).join('')}</ul></aside>` : '';
  const dateNotice = briefing.date !== briefing.businessToday ? `<p class="date-notice">${DATE_NOTICE}</p>` : '';
  return document(title,`${fixture}<header><div class="eyebrow">JENN SHOOTING OPERATIONS / READ ONLY</div><h1>${escape(title)}</h1><p class="notice">${NOTICE}</p><div class="meta"><span>所选日期：${escape(briefing.date)}</span><span>业务今天：${escape(briefing.businessToday)}</span><span>业务时区：Asia/Shanghai（上海）</span><span>观察时间：${escape(time(briefing.observedAt))}</span></div><div class="quality">${briefing.dataQuality === 'complete' ? '简报字段齐备' : '存在待核实信息 · 请先核对事实'}</div>${dateNotice}</header><div class="layout">${sections}</div>${issues}<footer>排班修订 ${escape(briefing.revisions?.scheduleRevision)} · 投影修订 ${escape(briefing.revisions?.projectionRevision)} · 计划、实际与预计分别展示；本简报不授予任何执行或写入权限。</footer>`);
}
