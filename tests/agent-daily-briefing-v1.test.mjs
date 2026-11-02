import test from 'node:test';
import assert from 'node:assert/strict';
import {readAgentDailyBriefingV1} from '../src/agent-daily-briefing-v1.mjs';
import {readSchedulingBoardFacts} from '../src/scheduling-board-read-model.mjs';

// A read-only statement double makes forbidden queries and transaction ownership
// visible; transport tests separately exercise the real SQLite authenticated lane.
function fixture({details=false,orders=true,unresolved=false}={}) {
  const queries=[];
  const session={id:'SCOPED-SESSION',resourceId:'PHOTO',
    plannedStart:'2026-10-12T01:00:00.000Z',plannedEnd:'2026-10-12T02:00:00.000Z',
    bufferAfterMinutes:10,status:'confirmed',lockStatus:'unlocked',
    resourceResolutionStatus:unresolved?'unresolved':'resolved',allocationMode:'exclusive',
    legacyPlaceText:'PRIVATE_LEGACY_PLACE',hasRunHistory:1};
  const db={exec(){throw Error('HELPER_MUST_NOT_OWN_TRANSACTION');},prepare(sql){
    assert.match(sql.trim(),/^SELECT /);
    queries.push(sql);
    if(sql.includes('SELECT r.name')) {
      assert.equal(details,true,'private request name query must be opt-in');
      return {all:()=>[{name:'PRIVATE_JOINED_NAME'}]};
    }
    assert.doesNotMatch(sql,/uploads|duration_estimate|scheduling_request_requirements|\brequests_v2\b/);
    if(sql.includes('schedule_reschedule_operations')) return {all:()=>[]};
    if(sql.includes('FROM schedule_items s'))return {all:()=>[
      {...session,...(/\bnote\b/.test(sql)?{note:'PRIVATE_SESSION_NOTE'}:{})},
      {...session,id:'OTHER-SESSION',resourceId:'OTHER'},
    ]};
    if(sql.includes('SELECT task_id'))return {all:id=>{
      assert.equal(id,'SCOPED-SESSION');return [{task_id:'VISIBLE-ORDER'}];
    }};
    if(sql.includes('FROM production_runs'))return {all:id=>{
      assert.equal(id,'SCOPED-SESSION');return [{id:'RUN-ONE',status:'blocked',runRevision:2,
        startedAt:'2026-10-12T01:05:00.000Z',completedAt:null,privatePayload:'PRIVATE_RUN_FIELD'}];
    }};
    throw Error('UNEXPECTED_READ');
  }};
  const state={revisions:{scheduleRevision:3,projectionRevision:5},writeAdmission:'disabled',
    orders:orders?[{id:'VISIBLE-ORDER',name:'授权订单',kind:'平面',shootingSubtype:'细节图',
      lifecycle:'open',sampleStatus:'arrivedVerified',priority:'p1',desiredDate:'2026-10-12',
      client:'PRIVATE_CLIENT',note:'PRIVATE_ORDER_NOTE',references:[{name:'PRIVATE_REFERENCE'}],
      durationEstimate:{durationMs:30000,source:'PRIVATE_ESTIMATE'}}]:[],
  };
  return {db,state,queries,resourceScope:['PHOTO'],configRow:null,config:null,
    observedAt:'2026-10-12T01:30:00.000Z'};
}

test('Agent briefing consumes scoped safe facts, preserves actual block, and owns no transaction or write',()=>{
  const input=fixture(),before=structuredClone(input.state);
  const briefing=readAgentDailyBriefingV1(input);
  assert.equal(briefing.ok,true);
  assert.equal(briefing.readonly,true);
  assert.deepEqual(briefing.revisions,{scheduleRevision:3,projectionRevision:5});
  assert.equal(briefing.observedAt,input.observedAt);
  assert.equal(briefing.date,'2026-10-12');
  assert.equal(briefing.sections.today.items.length,1);
  assert.equal(briefing.sections.current.item.id,'SCOPED-SESSION');
  assert.equal(briefing.sections.current.item.runStatus,'blocked');
  assert.equal(briefing.sections.current.item.name,'授权订单');
  assert.equal(briefing.sections.current.item.completedAt,null);
  assert.ok(briefing.sections.attention.items.some(item=>item.code==='BLOCKED_RUN'));
  assert.ok(briefing.sections.attention.items.some(item=>item.code==='WRITE_ADMISSION_DISABLED'));
  assert.doesNotMatch(JSON.stringify(briefing),/PRIVATE_|OTHER-SESSION/);
  assert.deepEqual(input.state,before);
  const sessionRead=input.queries.find(sql=>sql.includes('FROM schedule_items s'));
  assert.doesNotMatch(sessionRead,/\bnote\b/);
  assert.equal(input.queries.some(sql=>sql.includes('SELECT r.name')),false);
});

test('withheld estimate and catalogue coverage stays unknown rather than missing, empty or ready',()=>{
  const input=fixture();
  const briefing=readAgentDailyBriefingV1(input);
  assert.equal(briefing.dataQuality,'needs_review');
  assert.equal(briefing.sections.readyOrders.state,'unknown');
  assert.deepEqual(briefing.sections.readyOrders.items,[]);
  assert.equal(briefing.sections.attention.state,'unknown');
  assert.match(briefing.sections.attention.message,/覆盖不完整/);
  assert.ok(briefing.issues.some(issue=>issue.code==='ORDER_ESTIMATES_NOT_EXPOSED'&&issue.section==='metadata'));
  assert.equal(briefing.issues.some(issue=>['READY_ORDERS_MISSING','DURATION_MISSING'].includes(issue.code)),false);
  assert.equal(briefing.sections.attention.items.some(item=>['DURATION_MISSING','UNSCHEDULED_READY'].includes(item.code)),false);
  assert.equal(Object.hasOwn(briefing,'requests'),false);
});

test('missing scoped order name does not acquire private joined name or widen request visibility',()=>{
  const input=fixture({orders:false,unresolved:true});
  const briefing=readAgentDailyBriefingV1(input);
  assert.equal(briefing.ok,true);
  assert.equal(briefing.sections.today.items[0].name,'订单名称未提供');
  assert.ok(briefing.issues.some(issue=>issue.code==='ORDER_NAME_MISSING'));
  assert.ok(briefing.sections.attention.items.some(item=>item.code==='UNKNOWN_OCCUPANCY'));
  assert.doesNotMatch(JSON.stringify(briefing),/PRIVATE_|VISIBLE-ORDER|OTHER-SESSION/);
  assert.equal(input.queries.some(sql=>sql.includes('SELECT r.name')),false);
});

test('shared board read model keeps details for old callers and omits note plus joined names when disabled',()=>{
  const old=fixture({details:true});
  const rich=readSchedulingBoardFacts({db:old.db,resourceIds:['PHOTO'],orderRows:[]});
  assert.equal(rich.sessions[0].note,'PRIVATE_SESSION_NOTE');
  assert.deepEqual(rich.sessions[0].requestNames,['PRIVATE_JOINED_NAME']);
  assert.ok(old.queries.some(sql=>sql.includes('SELECT r.name')));
  const scoped=fixture();
  const safe=readSchedulingBoardFacts({db:scoped.db,resourceIds:['PHOTO'],orderRows:[],includeSessionDetails:false});
  assert.deepEqual(safe.orderFacts,[]);
  assert.equal(Object.hasOwn(safe.sessions[0],'note'),false);
  assert.equal(Object.hasOwn(safe.sessions[0],'requestNames'),false);
  assert.equal(scoped.queries.some(sql=>sql.includes('SELECT r.name')),false);
});
