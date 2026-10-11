import {normalizeSchedulingConfigV2,normalizePublishSchedulingConfigV2,compileSchedulingCalendarDateV2} from './scheduling-admin-contract-v2.mjs';
import {normalizeClassificationRulesV3} from './scheduling-admin-contract-v1.mjs';
import {canonicalJsonSchedulingV1 as json,digestCanonicalJsonSchedulingV1 as digest} from './scheduling-contract-v1.mjs';
const shell=c=>{const {externalNotifications,...base}=c;return {...base,schemaVersion:2,durationFallbackRules:[],bufferRules:[]};};
const need=r=>{if(!r.ok)throw new Error(r.reason??r.code);return r;};
const attempt=(code,fn)=>{try{return fn();}catch(e){return {ok:false,code,reason:e.message};}};
export function normalizeSchedulingConfigV3(input){return attempt('SCHEDULING_CONFIG_INVALID',()=>{
 if(input?.externalNotifications!=='disabled')throw new Error('EXTERNAL_NOTIFICATIONS_MUST_BE_DISABLED');
 if(input?.schemaVersion!==3)throw new Error('SCHEMA_VERSION_INVALID');
 const base=need(normalizeSchedulingConfigV2(shell(input))).config;
 const rules=need(normalizeClassificationRulesV3(input));
 const config={...base,schemaVersion:3,externalNotifications:'disabled',durationFallbackRules:rules.durationFallbackRules,bufferRules:rules.bufferRules};
 return {ok:true,config,configJson:json(config),configDigest:digest({domain:'scheduling-config-v3',configJson:config})};
});}
export function normalizePublishSchedulingConfigV3(input){return attempt('PUBLISH_SCHEDULING_CONFIG_INVALID',()=>{
 const admitted=need(normalizeSchedulingConfigV3(input?.configJson));
 if(input.configDigest!==admitted.configDigest)throw new Error('CONFIG_DIGEST_MISMATCH');
 if(input.calendarCompilerVersion!=='calendar-compiler-v3'||input.algorithmVersion!=='deterministic-scheduler-v2')throw new Error('CLASSIFICATION_VERSION_REQUIRED');
 const surrogate=need(normalizeSchedulingConfigV2(shell(admitted.config)));
 const checked=need(normalizePublishSchedulingConfigV2({...input,calendarCompilerVersion:'calendar-compiler-v2',configJson:surrogate.config,configDigest:surrogate.configDigest}));
 const command={...checked.command,calendarCompilerVersion:'calendar-compiler-v3',configJson:admitted.config,configDigest:admitted.configDigest};
 const {operationId,...content}=command;
 return {ok:true,commandType:'PublishSchedulingConfigV3',command,commandJson:json(command),commandDigest:digest({domain:'scheduling-config-publish-command-v3',command:content})};
});}
export function compileSchedulingCalendarDateV3(input){return attempt('SCHEDULING_CALENDAR_COMPILE_INVALID',()=>{
 if(input.calendarCompilerVersion!=='calendar-compiler-v3')throw new Error('CALENDAR_COMPILER_VERSION_UNSUPPORTED');
 const config=need(normalizeSchedulingConfigV3(input.configJson)).config;
 const compiled=need(compileSchedulingCalendarDateV2({...input,configJson:shell(config),calendarCompilerVersion:'calendar-compiler-v2'}));
 const {ok,resultDigest,...base}=compiled;const result={...base,calendarCompilerVersion:'calendar-compiler-v3'};
 return {ok:true,...result,resultDigest:digest({domain:'scheduling-calendar-compile-result-v3',result})};
});}
