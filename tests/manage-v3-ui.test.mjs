// Real shipped handlers; synthetic DOM and in-process HTTP, not a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {launch} from './support/first-launch-v3-fixture.mjs';
import {dom} from './support/manage-synthetic-dom.mjs';
test('management UI creates distinct still-life order, filters it, sets duration, adopts proposal, records actual start and complete',async()=>{
 const f=await launch();try{
 const {ids,document}=dom();
 const context=vm.createContext({document,structuredClone,Intl,Date,Number,JSON,Map,Set,Error,crypto:{randomUUID},sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},fetch:async(path,opt)=>{const r=await f.call(path,opt.body?JSON.parse(opt.body):undefined,opt.headers.Authorization.slice(7));return {ok:r.status<400,status:r.status,json:async()=>r.body};}});
 vm.runInContext(readFileSync(new URL('../public/manage.js',import.meta.url),'utf8'),context);
 async function fire(id,event){const e=typeof id==='string'?ids.get(id):id;await e.fire(event);for(let i=0;i<150;i++){await new Promise(r=>setImmediate(r));if(ids.get('message').textContent!=='正在处理…')return;}throw Error('UI did not settle');}
 ids.get('token').value='a'.repeat(40);await fire('login','submit');assert.equal(ids.get('order-panel').hidden,false);
 const values={sku:'SYNTHETIC-UI',name:'功能图订单',category:'静物',subtype:'功能图',requested:'Synthetic requester',date:'2026-10-12',count:'1',ratio:'待定',sample:'arrivedVerified',priority:'p1',light:'SOFT',reflectivity:'unknown',brief:'功能图',note:''};
 for(const [k,v]of Object.entries(values))ids.get('order-'+k).value=v;
 await fire('order-form','submit');assert.match(ids.get('message').textContent,/订单已保存/);
 assert.match(ids.get('order-counts').textContent,/功能图 1/);
 ids.get('order-filter').value='产品3D主图';await fire('order-filter','change');assert.equal(ids.get('order-list').children.length,0);
 ids.get('order-filter').value='功能图';await fire('order-filter','change');assert.equal(ids.get('order-list').children.length,1);
 const duration=ids.get('requests').children[0];duration.children[1].children[0].value='30';await fire(duration,'submit');assert.match(ids.get('message').textContent,/时长已保存/);
 ids.get('plan-from').value='2026-10-12';ids.get('plan-through').value='2026-10-12';await fire('proposal-form','submit');
 const accept=ids.get('proposal').children.find(e=>e.tagName==='button'&&e.textContent==='采用全部场次');assert.ok(accept,ids.get('message').textContent);await fire(accept,'click');
 const session=(await f.state()).sessions[0];f.setTime(session.plannedStart);ids.get('actual-item').value=session.id;await fire('actual-start','click');assert.match(ids.get('message').textContent,/实际开拍/);
 f.setTime(new Date(Date.parse(session.plannedStart)+1800000).toISOString());ids.get('actual-item').value=session.id;await fire('actual-complete','click');assert.match(ids.get('message').textContent,/实际完成/);
 assert.equal(f.server.store.db.prepare('SELECT status FROM production_runs').get().status,'completed');
 }finally{f.close();}
});
