import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ScheduleStore} from '../src/store.mjs';import {initializeWritableSchema} from '../src/sqlite-schema-v2.mjs';
import {createConversationBoundary} from '../src/jso-conversation-boundary-v1.mjs';import {createTrustedPrincipal} from '../src/authorization-v2.mjs';
import {createSqliteAgentGrantAttemptStoreV1} from '../src/sqlite-agent-grant-attempt-store-v1.mjs';import {agentCommandDigest} from '../src/jso-agent-api-v1.mjs';
const command={operationId:'operation1',scheduleItemId:'item1',resourceId:'R',plannedStart:'2040-01-01T01:00:00.000Z',plannedEnd:'2040-01-01T02:00:00.000Z',expectedScheduleRevision:0,expectedProjectionRevision:0,configDigest:'sha256:'+'a'.repeat(64)};
test('durable cancellation survives same-store reconstruction and SQLite close/reopen, binds all original identities',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'jso-cancel-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const filename=join(dir,'test.sqlite');let store=new ScheduleStore({filename});t.after(()=>{if(store.db.isOpen)store.close()});initializeWritableSchema(store.db);
 let owner='owner';const make=()=>createConversationBoundary({store,identities:['assistant','other'].map(subjectId=>({token:subjectId.padEnd(40,'x'),subjectId,mode:'executor',resourceIds:['R']})),ownerAuthenticate:async()=>createTrustedPrincipal({subjectId:owner,role:'administrator',resourceIds:['R']}).principal});
 const body={sourceRef:'original',assistantSubjectId:'assistant',command};const a=make();assert.equal((await a.ownerCall('',body)).ok,true);assert.equal((await a.ownerCall('',{...body,cancel:true})).cancelled,true);
 assert.equal((await make().ownerCall('',body)).code,'CANCELLED');store.close();store=new ScheduleStore({filename});const b=make();assert.equal((await b.ownerCall('',body)).code,'CANCELLED');assert.equal((await b.ownerCall('',{...body,cancel:true})).cancelled,true);
 for(const change of [{assistantSubjectId:'other'},{command:{...command,operationId:'different'}}])assert.equal((await b.ownerCall('',{...body,...change})).code,'SOURCE_REBOUND');owner='other-owner';assert.equal((await b.ownerCall('',body)).code,'SOURCE_REBOUND');owner='owner';
 const sent={...body,sourceRef:'dispatched'};assert.equal((await b.ownerCall('',sent)).ok,true);assert.equal(createSqliteAgentGrantAttemptStoreV1({db:store.db}).claim({approvalRef:sent.sourceRef,subjectId:'assistant',action:'reschedule',commandDigest:agentCommandDigest('reschedule',command)}).ok,true);
 assert.equal((await b.ownerCall('',{...sent,cancel:true})).code,'RECONCILIATION_REQUIRED');assert.equal((await make().ownerCall('',sent)).code,'RECONCILIATION_REQUIRED');
 assert.equal(store.db.prepare("SELECT count(*) AS n FROM operations WHERE kind='conversation.cancel'").get().n,1);
});
