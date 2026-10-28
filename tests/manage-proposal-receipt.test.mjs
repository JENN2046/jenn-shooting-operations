import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {dom,managementScript} from './support/manage-synthetic-dom.mjs';

for (const [actual,expected] of [['stale','提案已失效，未采用'],['accept','已采用。'],['partiallyAccept','已采用。'],['reject','已放弃。'],[undefined,'回执状态无法确认']]) {
  test(`shipped proposal handler reports authoritative receipt ${actual}`,async()=>{
    const {ids,document}=dom();let calls=0;
    const context=vm.createContext({document,structuredClone,Intl,Date,Number,JSON,Map,Set,Error,crypto:{randomUUID},
      sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
      fetch:async()=>{calls++;return {ok:true,status:200,json:async()=>({ok:true,receipt:{decisionType:actual}})};}});
    vm.runInContext(managementScript(),context);
    vm.runInContext(`refresh=async()=>{}; proposal={proposal:{proposalId:'P',proposedItemsJson:JSON.stringify([{proposalItemId:'I',requestId:'R',plannedStart:'2099-01-01T01:00:00.000Z',plannedEnd:'2099-01-01T01:30:00.000Z'}]),diagnosticsJson:'[]'}};renderProposal();`,context);
    const accept=ids.get('proposal').children.find(e=>e.tagName==='button'&&e.textContent==='采用全部场次');
    await accept.fire('click');
    for(let n=0;n<30&&ids.get('message').textContent==='正在处理…';n++)await new Promise(r=>setImmediate(r));
    assert.equal(calls,1);
    assert.ok(ids.get('message').textContent.includes(expected),ids.get('message').textContent);
    if(actual==='stale')assert.ok(!ids.get('message').textContent.includes('已采用'));
  });
}

test('expired proposal is visibly blocked and a clock crossing prevents any HTTP write',async()=>{
  const {ids,document}=dom();let calls=0;
  class Clock extends Date {static time=Date.parse('2099-01-01T00:00:00.000Z');static now(){return Clock.time;}}
  const context=vm.createContext({document,structuredClone,Intl,Date:Clock,Number,JSON,Map,Set,Error,crypto:{randomUUID},
    sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},fetch:async()=>{calls++;throw Error('unexpected write');}});
  vm.runInContext(managementScript(),context);
  vm.runInContext(`proposal={proposal:{proposalId:'P',proposedItemsJson:JSON.stringify([{proposalItemId:'I',requestId:'R',plannedStart:'2099-01-01T01:00:00.000Z',plannedEnd:'2099-01-01T01:30:00.000Z'}]),diagnosticsJson:'[]'}};renderProposal();`,context);
  const accept=ids.get('proposal').children.find(e=>e.tagName==='button'&&e.textContent==='采用全部场次');
  assert.equal(accept.disabled,false);
  Clock.time=Date.parse('2099-01-01T01:00:00.000Z');await accept.fire('click');
  assert.equal(calls,0);assert.match(ids.get('message').textContent,/已经过去/);
  vm.runInContext('renderProposal()',context);
  assert.ok(ids.get('proposal').children.some(e=>e.dataset.locked==='yes'&&e.disabled));
});

test('today planning starts at least one minute after the browser clock, not midnight',async()=>{
 const {ids,document}=dom();const calls=[];
 class Clock extends Date {static now(){return Date.parse('2099-01-01T02:00:00.000Z');}}
 const context=vm.createContext({document,structuredClone,Intl,Date:Clock,Number,JSON,Map,Set,Error,crypto:{randomUUID},
  sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},fetch:async(path,opt)=>{calls.push(JSON.parse(opt.body));return {ok:true,status:200,json:async()=>({ok:true,proposal:{proposalId:'P',proposedItemsJson:'[]',diagnosticsJson:'[]'}})};}});
 vm.runInContext(managementScript(),context);
 vm.runInContext("state={resources:[{resource_id:'R'}]}",context);
 ids.get('plan-from').value='2099-01-01';ids.get('plan-through').value='2099-01-01';
 await ids.get('proposal-form').fire('submit');
 for(let n=0;n<30&&ids.get('message').textContent==='正在处理…';n++)await new Promise(r=>setImmediate(r));
 assert.equal(calls.length,1);assert.equal(calls[0].planningWindowStart,'2099-01-01T02:01:00.000Z');
 assert.equal(calls[0].planningWindowEnd,'2099-01-01T16:00:00.000Z');
});
