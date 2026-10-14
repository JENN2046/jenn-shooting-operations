// Author ChartController: CreateChart + ReplaceData; no invented VChart HTTP API.
export function chartData(state, observedAt) {
  if(!state?.ok || state.businessSchemaVersion!==12)throw new TypeError('Schema12 JSO read required');
  return {source:'JSO',observedAt,refreshMode:'explicit-read-then-ReplaceData',
    businessTimeZone:state.activeConfig?.businessTimeZone,revisions:state.revisions,
    orders:state.orders,resources:state.resources,sessions:state.sessions,progress:state.progress};
}
export const runtime = `return {
  render(context) {
    const d=context.data;
    const root=context.root; root.replaceChildren();
    const title=document.createElement('h2'); title.textContent='JSO · 拍摄进度'; root.append(title);
    const note=document.createElement('p'); note.textContent='Asia/Shanghai · 最近读取 '+d.observedAt+' · 排程版本 '+d.revisions.scheduleRevision+' · 显式刷新快照'; root.append(note);
    const table=document.createElement('table');
    for(const order of d.orders) {
      const session=d.sessions.find(s=>d.progress.find(p=>p.scheduleItemId===s.scheduleItemId)?.requestIds.includes(order.id));
      const progress=d.progress.find(p=>p.scheduleItemId===session?.scheduleItemId);
      const row=document.createElement('tr');
      for(const value of [order.name,order.shootingSubtype,session?new Date(session.plannedStart).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'待排期',progress?.runs.at(-1)?.status??'未开始']) {
        const cell=document.createElement('td');cell.textContent=value;row.append(cell);
      } table.append(row);
    } root.append(table);context.reportReady?.();context.reportStable?.();
  }, mount(context){this.render(context);}, update(change,context){this.render(context);}, resize(){},setTheme(){},destroy(){}
};`;
export function createChartCommand(data) {
  return {command:'CreateChart',manifest:{id:'jso-local-candidate',name:'JSO 拍摄进度',libraries:[],window:{width:1000,height:650}},
    template:'<main></main>',style:'main{font:16px sans-serif;padding:24px}td{padding:12px;border-bottom:1px solid #ddd}',runtime,initialData:data,open:false};
}
export function refreshChartCommand(data, expectedDataRevision) {
  if(!Number.isSafeInteger(expectedDataRevision)||expectedDataRevision<1)throw new TypeError('chart data revision required');
  return {command:'ReplaceData',chartId:'jso-local-candidate',data,expectedDataRevision};
}
