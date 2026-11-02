import test from 'node:test';
import assert from 'node:assert/strict';
import {renderDailyBriefingText,renderDailyBriefingHtml} from '../src/daily-briefing-render-v1.mjs';

function fixture() {
  const session = {id:'session-one',name:'产品拍摄',resourceId:'studio-a',
    plannedStart:'2026-10-12T01:00:00.000Z',plannedEnd:'2026-10-12T02:00:00.000Z',
    plannedDurationMinutes:60,runStatus:'shooting',startedAt:'2026-10-12T01:05:00.000Z',completedAt:null,
    forecast:{estimatedEnd:'2026-10-12T02:20:00.000Z',bufferAfterMinutes:15,operationId:'forecast-01'}};
  return {ok:true,version:1,kind:'jso-daily-briefing',date:'2026-10-12',businessToday:'2026-10-12',
    timeZone:'Asia/Shanghai',observedAt:'2026-10-12T01:30:00.000Z',
    revisions:{scheduleRevision:7,projectionRevision:11},readonly:true,dataQuality:'complete',issues:[],
    sections:{
      today:{state:'ready',items:[session],message:'所选日期有一场计划。'},
      current:{state:'ready',item:structuredClone(session),message:'存在唯一执行中事实。'},
      next:{state:'empty',item:null,message:'没有符合条件的下一场。'},
      readyOrders:{state:'ready',items:[{id:'order-one',name:'待排订单',durationMinutes:30,durationSource:'explicit'}],message:'仅展示，不自动排期。'},
      attention:{state:'ready',items:[{code:'UNSCHEDULED_READY',severity:'info',entityId:'order-one',summary:'尚无有效排期。',recommendedAction:'proposal'}],message:'处理动作由原入口决定。'},
    }};
}

test('renders five clear sections, Shanghai observation and separate plan/actual/forecast without mutating input',()=>{
  const input=fixture(),before=structuredClone(input);
  const output=renderDailyBriefingText(input),html=renderDailyBriefingHtml(input);
  for(const title of ['今天','当前','下一场','可排未排','阻塞与待处理']) {
    assert.ok(output.includes(title),title);
    assert.ok(html.includes(`<h2>${title}</h2>`),title);
  }
  assert.match(output,/业务时区：Asia\/Shanghai/);
  assert.match(output,/观察时间：.*09:30:00（上海）/);
  assert.match(output,/计划结束：.*10:00:00（上海）/);
  assert.match(output,/实际开拍：.*09:05:00（上海）/);
  assert.match(output,/实际完成：未提供/);
  assert.match(output,/已记录预计结束：.*10:20:00（上海）/);
  assert.match(output,/预计结束不代表实际完成/);
  assert.match(output,/预计依据 operationId：forecast-01/);
  const today=html.match(/<section class="section today">([\s\S]*?)<\/section>/)[1];
  const primary=today.split('<details>')[0];
  assert.match(primary,/<dt>计划<\/dt>/);
  assert.doesNotMatch(primary,/场次 ID|资源|operationId|实际开拍|已记录预计结束|实际完成/);
  assert.match(today,/<details><summary>来源依据<\/summary>/);
  assert.match(today,/<dt>场次 ID<\/dt><dd>session-one<\/dd>/);
  const textToday=output.split('1. 今天')[1].split('2. 当前')[0];
  assert.doesNotMatch(textToday,/实际开拍：|已记录预计结束：|计划时长：/);
  assert.doesNotMatch(html,/<details\s+open/);
  assert.deepEqual(input,before);
  const completed=fixture();completed.sections.today.items[0].runStatus='completed';
  completed.sections.today.items[0].completedAt='2026-10-12T02:15:00.000Z';
  const completedPrimary=renderDailyBriefingHtml(completed).match(/<section class="section today">([\s\S]*?)<\/section>/)[1].split('<details>')[0];
  assert.match(completedPrimary,/<dt>实际完成<\/dt><dd>.*10:15:00（上海）<\/dd>/);
});

test('missing DTO fields remain explicit and are not derived from names or planned times',()=>{
  const input=fixture();
  input.sections.current.item={name:'缺失资料的场次',runStatus:'unknown',forecast:null};
  input.sections.today.items=[input.sections.current.item];
  input.sections.readyOrders.items=[{id:'durationless',name:'缺时长',durationMinutes:null,durationSource:null}];
  const output=renderDailyBriefingText(input),html=renderDailyBriefingHtml(input);
  assert.match(output,/场次 ID：未提供/);
  assert.match(output,/计划结束：未提供/);
  assert.match(output,/实际开拍：未提供/);
  assert.match(output,/已记录预计结束：未提供/);
  assert.match(output,/时长依据：未提供/);
  assert.match(html,/<dt>实际完成<\/dt><dd>未提供<\/dd>/);
  assert.match(output,/执行状态：未知 · 待核实/);
});

test('empty, unknown and conflict stay distinct; selected historical date is not labeled today',()=>{
  const input=fixture();input.date='2026-10-11';input.dataQuality='needs_review';
  input.sections.current={state:'conflict',item:null,message:'多条执行事实，无法选出当前场。'};
  input.sections.readyOrders={state:'unknown',items:[],message:'资料不足，不能断言没有待排订单。'};
  input.issues=[{code:'MULTIPLE_ACTIVE',section:'current',message:'需要核实。',entityId:'session-one'}];
  const output=renderDailyBriefingText(input),html=renderDailyBriefingHtml(input);
  assert.match(output,/1\. 所选日期场次/);
  assert.doesNotMatch(html,/<h2>今天<\/h2>/);
  assert.match(output,/当前｜冲突 · 待核实/);
  assert.match(output,/下一场｜无符合条件记录/);
  assert.match(output,/可排未排｜未知 · 数据不足/);
  assert.match(output,/资料不足，不能断言没有待排订单。/);
  assert.match(html,/存在待核实信息/);
  assert.match(html,/MULTIPLE_ACTIVE/);
  for(const rendered of [output,html])assert.match(rendered,/所选日期视图使用当前已记录事实，并非历史状态重放/);
});

test('HTML escapes all displayed untrusted DTO and issue strings and adds no active content',()=>{
  const input=fixture(),hostile=`<script src="https://bad.invalid/x">alert('x')</script>&`;
  input.sections.today.items[0].name=hostile;
  input.sections.today.items[0].resourceId=hostile;
  input.sections.today.message=hostile;
  input.sections.current.item.forecast.operationId=hostile;
  input.sections.readyOrders.items[0].durationSource=hostile;
  input.sections.attention.items[0].summary=hostile;
  input.sections.attention.items[0].recommendedAction=hostile;
  input.issues=[{code:hostile,section:hostile,message:hostile,entityId:hostile}];
  const html=renderDailyBriefingHtml(input);
  assert.ok(html.includes('&lt;script src=&quot;https://bad.invalid/x&quot;&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;'));
  assert.doesNotMatch(html,/<script\b|<iframe\b|<img\b|<button\b|<form\b|<a\b|\son[a-z]+=/i);
  assert.doesNotMatch(html,/<[^>]*\s(?:src|href)\s*=/i);
  assert.match(html,/default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'/);
});

test('untrusted terminal controls and line breaks cannot forge text headings',()=>{
  const input=fixture();
  input.sections.today.items[0].name='\u001b[31m标题\n6. 伪造段落\t\u202e反向\u0007';
  input.sections.today.message='说明\r\n第二行\u009b';
  const output=renderDailyBriefingText(input),html=renderDailyBriefingHtml(input);
  assert.doesNotMatch(output,/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e]/);
  assert.doesNotMatch(output,/\n6\. 伪造段落/);
  assert.doesNotMatch(html,/[\u001b\u0007\u009b\u202e]/);
});

test('synthetic HTML is prominently labeled while normal output makes no fixture claim',()=>{
  const input=fixture(),html=renderDailyBriefingHtml(input,{synthetic:true});
  assert.match(html,/<aside class="fixture">模拟样本 · 非真实业务数据/);
  assert.doesNotMatch(renderDailyBriefingHtml(input),/<aside class="fixture">/);
});

test('attention identifies its related object and run cancellation is separate from schedule cancellation',()=>{
  const input=fixture();input.sections.current.item.runStatus='cancelled';
  const output=renderDailyBriefingText(input),html=renderDailyBriefingHtml(input);
  assert.match(output,/关联对象：order-one/);
  assert.match(html,/<dt>关联对象<\/dt><dd>order-one<\/dd>/);
  assert.match(output,/本次执行已取消/);
  assert.doesNotMatch(output,/排期已取消/);
  assert.match(html,/简报字段齐备/);
});

test('invalid or error briefing renders a fixed safe error and never leaks raw input',()=>{
  for(const input of [null,[],{}, {ok:false,code:'DAILY_BRIEFING_INPUT_INVALID',raw:'PRIVATE_SENTINEL'},
    {...fixture(),readonly:false},{...fixture(),timeZone:'UTC'},
    {...fixture(),sections:{...fixture().sections,current:{state:'made-up',item:null}}}]) {
    const output=renderDailyBriefingText(input),html=renderDailyBriefingHtml(input,{synthetic:true});
    assert.match(output,/输入无效/);assert.match(html,/输入无效/);
    assert.doesNotMatch(output+html,/PRIVATE_SENTINEL|made-up/);
    assert.doesNotMatch(html,/<script\b|<button\b|<form\b/i);
  }
});
