// Host-side acceptance. Allocates and removes only its own labelled synthetic volume/containers.
// Requires the existing local Docker socket. Never selects a production target or provider.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dockerMaintenanceReadV1 as docker, observeOfflineDockerTargetV1, digestOfflineMaintenanceV1,
  executeOfflineMaintenanceAdapterV1, acquireOfflineMaintenanceFenceV1 } from '../src/offline-maintenance-adapter-v1.mjs';
import { MIGRATIONS } from '../src/sqlite-schema-v2.mjs';
const EMPTY_DB_MAINTENANCE_SCHEMA_DIGEST_V1 = digestOfflineMaintenanceV1(MIGRATIONS.map(({version,name,checksum})=>({version,name,checksum})));
import { digestResourceCapabilitiesV1 } from '../src/scheduling-contract-v1.mjs';
import { normalizeSchedulingConfigV1, SCHEDULING_CALENDAR_COMPILER_VERSION_V1 } from '../src/scheduling-admin-contract-v1.mjs';
const [imageId, sourceRevision] = process.argv.slice(2);
assert.equal(process.argv.length, 4); assert.match(imageId, /^sha256:[a-f0-9]{64}$/u); assert.match(sourceRevision, /^[a-f0-9]{40}$/u);
const root = mkdtempSync(join(tmpdir(), 'jso-adapter-test-'));
const volumeName = `jso-adapter-test-${randomUUID()}`;
const fencePath = join(root, 'fence.json'), policyPath = join(root, 'policy.json'), approvalPath = join(root, 'approval.json');
const owned = []; const records = [];
writeFileSync(fencePath, '{}', { mode: 0o600 });
writeFileSync(`${fencePath}.coordinator`, '{}', { mode: 0o600 });
const runArgs = ['--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--no-healthcheck', '--mount', `type=volume,src=${volumeName},dst=/maintenance-data`,
  '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', '--tmpfs', '/app/data:ro,noexec,nosuid,size=1m'];
function snapshot() {
  const code = `const {DatabaseSync}=require('node:sqlite');const{createHash}=require('node:crypto');
    const db=new DatabaseSync('/maintenance-data/shooting-operations.sqlite',{readOnly:true});
    const rows=Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
      .map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]));
    console.log(JSON.stringify({digest:'sha256:'+createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
      counts:Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,v.length]))}));db.close();`;
  return JSON.parse(docker(['run', ...runArgs, '--entrypoint', 'node', imageId, '-e', code]));
}
try {
  docker(['volume', 'create', '--label', 'jso.synthetic=true', volumeName]);
  // Synthetic setup only. No production schema creation or permission change is performed.
  docker(['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--cap-add', 'CHOWN',
    '--user', '0', '--no-healthcheck', '--mount', `type=volume,src=${volumeName},dst=/maintenance-data`,
    '--tmpfs', '/app/data:ro', '--entrypoint', 'node', imageId, '-e',
    "const fs=require('node:fs');fs.chmodSync('/maintenance-data',0o700);fs.chownSync('/maintenance-data',1000,1000)"]);
  docker(['run', ...runArgs, '--entrypoint', 'node', imageId, '--input-type=module', '-e',
    "import{ScheduleStore}from'./src/store.mjs';const s=new ScheduleStore({filename:'/maintenance-data/shooting-operations.sqlite',uploadRoot:'/maintenance-data/uploads',writeAdmissionMode:'disabled',orphanCleanupMode:'disabled'});s.close()"]);
  const observed = observeOfflineDockerTargetV1({ imageId, volumeName, fencePath });
  assert.equal(observed.runtime.sourceRevision, sourceRevision);
  const target = JSON.parse(docker(['run', ...runArgs, '--entrypoint', 'node', imageId,
    'scripts/offline-maintenance-helper.mjs', 'observe'])).target;
  const initial = snapshot(); assert.equal(initial.counts.revision_counters, 0);
  const scope = 'LOCAL_SYNTHETIC_ADAPTER';
  const policy = { schemaVersion: 1, scope, host: observed.host, storage: observed.storage, fence: observed.fence,
    runtime: observed.runtime, writerContainerIds: [] };
  const packet = (kind, operationId, command = null, expected = { scheduleRevision: 0, projectionRevision: 0 }) =>
    ({ schemaVersion: 1, scope, host: observed.host, storage: observed.storage, fence: observed.fence,
      operation: { schemaVersion: 1, operationId, kind, actor: `uid:${observed.host.operatorUid}`,
        approvalRef: 'synthetic:adapter-acceptance', target, runtime: observed.runtime,
        schemaDigest: EMPTY_DB_MAINTENANCE_SCHEMA_DIGEST_V1, businessTimeZone: 'Asia/Shanghai', expected, command,
        adapterBinding: { host: observed.host, storage: observed.storage, fence: observed.fence } } });
  function approve(value) {
    const approval = { schemaVersion: 1, scope, operatorUid: observed.host.operatorUid,
      approvalRef: value.operation.approvalRef, packetDigest: digestOfflineMaintenanceV1(value),
      policyDigest: digestOfflineMaintenanceV1(policy), notBefore: new Date(Date.now() - 10000).toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(), recoveryRef: 'synthetic:retain-reconcile-no-reset', prerequisiteDigest: null };
    writeFileSync(policyPath, JSON.stringify(policy), { mode: 0o600 });
    writeFileSync(approvalPath, JSON.stringify(approval), { mode: 0o600 });
  }
  const execute = (value, read, spawnHelper) => executeOfflineMaintenanceAdapterV1({ packet: value, policyPath, approvalPath, ...(read ? { read } : {}), ...(spawnHelper ? { spawnHelper } : {}) });
  const init = packet('initialize', 'SYNTHETIC-ADAPTER-INIT');
  approve(init);
  const lock = acquireOfflineMaintenanceFenceV1(observed.fence, scope);
  await assert.rejects(execute(init), { code: 'MAINTENANCE_ADAPTER_FENCE_BUSY_OR_UNAVAILABLE' }); lock.close();
  assert.deepEqual(snapshot(), initial); records.push('independent live kernel lock refusal; no DB facts');
  await assert.rejects(execute({ ...init, host: { ...init.host, bootId: 'wrong' } }),
    { code: 'MAINTENANCE_ADAPTER_OBSERVED_BINDING_MISMATCH' });
  assert.deepEqual(snapshot(), initial); records.push('fresh host mismatch refusal; no DB facts');
  // Introduce a real, unregistered mounted container at the before-COMMIT observation.
  // It writes no data. Refusal exercises rollback after the core has written all init facts.
  let helperInspects = 0, rogue;
  const driftRead = args => {
    if (args[0] === 'inspect' && args[1]?.startsWith('jso-maintenance-helper-') && ++helperInspects === 2) {
      rogue = docker(['create', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--no-healthcheck',
        '--mount', `type=volume,src=${volumeName},dst=/maintenance-data`, '--tmpfs', '/app/data:ro',
        '--entrypoint', 'node', imageId, '-e', 'setInterval(()=>{},1000)']); owned.push(rogue);
    }
    return docker(args);
  };
  await assert.rejects(execute(init, driftRead), { code: 'MAINTENANCE_ADAPTER_UNREGISTERED_WRITER' });
  assert.deepEqual(snapshot(), initial); docker(['rm', rogue]); owned.splice(owned.indexOf(rogue), 1);
  records.push('real inventory drift during transaction refuses commit and rolls back all init facts');
  const first = await execute(init); assert.equal(first.response.exactReplay, false);
  const initialized = snapshot(); assert.equal(initialized.counts.empty_db_initialization, 1);
  assert.equal((await execute(init)).response.exactReplay, true); assert.deepEqual(snapshot(), initialized);
  records.push('real isolated volume initializes once and exact replay adds no facts');
  // A real guarded runtime must refuse startup while an exclusive maintenance lock is held.
  const writer = docker(['create', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--no-healthcheck', '--restart', 'no', '--mount', `type=volume,src=${volumeName},dst=/app/data`,
    '--mount', `type=bind,src=${fencePath},dst=/jso-maintenance-fence/guard.lock,readonly`, '--tmpfs', '/tmp:rw,size=32m',
    '--env', 'WRITE_ADMISSION_MODE=disabled', '--env', 'ORPHAN_CLEANUP_MODE=disabled', '--env', 'KIOSK_AUTH_CONFIG_PATH=',
    '--entrypoint', 'node', imageId, 'scripts/guarded-offline-runtime.mjs', '/jso-maintenance-fence/guard.lock']);
  owned.push(writer);
  const exclusive = acquireOfflineMaintenanceFenceV1(observed.fence, scope);
  docker(['start', writer]); const exit = docker(['wait', writer]); assert.equal(exit, '1'); exclusive.close();
  const guardLogs = spawnSync('/usr/bin/docker', ['--host', 'unix:///var/run/docker.sock', 'logs', writer], { encoding: 'utf8' });
  assert.equal(guardLogs.status, 0); assert.match(guardLogs.stderr, /MAINTENANCE_RUNTIME_FENCE_BUSY/u);
  policy.writerContainerIds = [writer]; approve(init);
  assert.equal((await execute(init)).response.exactReplay, true);
  records.push('actual shared-lock runtime startup denied under exclusive lock; stopped guarded roster admitted');
  const capabilityJson = { schemaVersion: 1, capabilityIds: ['FLAT'] };
  const capabilityDigest = digestResourceCapabilitiesV1(capabilityJson);
  const register = packet('registerResource', 'SYNTHETIC-ADAPTER-RESOURCE', { operationId: 'SYNTHETIC-ADAPTER-RESOURCE',
    expectedScheduleRevision: 0, expectedProjectionRevision: 0, resource: { resourceId: 'SYNTHETIC-STUDIO',
      v1DisplayPlace: '合成摄影棚', status: 'active', capabilityJson, capabilityDigest } });
  approve(register);
  // Parallel actual adapters contend on the kernel fence; exactly one new receipt is permitted.
  const concurrency = await Promise.allSettled([execute(register), execute(register)]);
  assert.equal(concurrency.filter(r => r.status === 'fulfilled' && !r.value.response.exactReplay).length, 1);
  for (const r of concurrency) if (r.status === 'rejected') assert.match(r.reason.code, /FENCE_BUSY|HELPER_REFUSED/u);
  assert.equal((await execute(register)).response.exactReplay, true);
  assert.equal(snapshot().counts.empty_db_maintenance_operations, 1);
  records.push('concurrent real adapters commit one configuration receipt; retry is exact replay');
  const normalized = normalizeSchedulingConfigV1({ schemaVersion: 1, businessTimeZone: 'Asia/Shanghai',
    resourceCalendars: [{ resourceId: 'SYNTHETIC-STUDIO', capabilityDigest,
      weeklyWindows: [{ weekday: 4, start: '09:00', end: '17:00' }], dateOverrides: [] }],
    durationFallbackRules: [{ ruleId: 'default', productionType: null, shootingSubtype: null, durationMs: 3600000 }],
    bufferRules: [], softScoringWeights: { LIGHTING_SWITCH: 0, REFLECTIVITY_SEQUENCE: 0, IDLE_GAP: 0,
      EXPECTED_OVERRUN: 0, DESIRED_DATE_MISS: 0 }, compatibleAlgorithmVersions: ['synthetic-r1'] });
  assert(normalized.ok);
  const publish = packet('publishConfig', 'SYNTHETIC-ADAPTER-PUBLISH', { operationId: 'SYNTHETIC-ADAPTER-PUBLISH',
    configVersion: 'synthetic-r1', algorithmVersion: 'synthetic-r1', calendarCompilerVersion: SCHEDULING_CALENDAR_COMPILER_VERSION_V1,
    estimatePolicyVersion: 'synthetic-r1', configJson: normalized.config, configDigest: normalized.configDigest },
  { scheduleRevision: 1, projectionRevision: 1 });
  approve(publish);
  // A real Docker transport proxy drops only the committed result; observation still uses real Docker.
  // This is an explicit synthetic transport fault, not a claim of a production failure drill.
  const proxy = join(root, 'drop-result.mjs');
  writeFileSync(proxy, `import{spawn}from'node:child_process';
    const c=spawn('/usr/bin/docker',process.argv.slice(2),{stdio:['inherit','pipe','inherit']});
    let b='',dropped=false;c.stdout.setEncoding('utf8');c.stdout.on('data',x=>{b+=x;while(b.includes('\\n')){const i=b.indexOf('\\n'),l=b.slice(0,i);b=b.slice(i+1);
      let result=false;try{result=JSON.parse(l).phase==='result'}catch{};
      if(result)dropped=true;else process.stdout.write(l+'\\n')}});
    c.on('exit',code=>{if(b)process.stdout.write(b);process.exitCode=dropped?75:code});`);
  const dropResult = (_binary, args, options) => spawn(process.execPath, [proxy, ...args], options);
  await assert.rejects(execute(publish, undefined, dropResult), { code: 'MAINTENANCE_ADAPTER_OUTCOME_UNKNOWN' });
  const afterUnknown = snapshot(); assert.equal(afterUnknown.counts.scheduling_config_versions, 1);
  assert.equal((await execute(publish)).response.exactReplay, true); assert.deepEqual(snapshot(), afterUnknown);
  records.push('real COMMIT with injected result-channel loss yields UNKNOWN; exact-packet reconciliation adds no facts');
  assert.equal(snapshot().counts.scheduling_active_config, 0);
  const activate = packet('activateConfig', 'SYNTHETIC-ADAPTER-ACTIVATE', { operationId: 'SYNTHETIC-ADAPTER-ACTIVATE',
    configVersion: 'synthetic-r1', expectedProjectionRevision: 1 }, { scheduleRevision: 1, projectionRevision: 1 });
  approve(activate); await execute(activate); const final = snapshot();
  assert.equal((await execute(activate)).response.exactReplay, true); assert.deepEqual(snapshot(), final);
  records.push('publication remains inactive; separate activation and replay preserve committed facts');
  console.log(JSON.stringify({ status: 'LOCAL_SYNTHETIC_OFFLINE_ADAPTER_PASS', recordedAt: new Date().toISOString(),
    sourceRevision, imageId, observedHost: observed.host, observedStorage: observed.storage,
    observedTarget: target, initial, final, cases: records, productionAccessed: false,
    authenticationClass: 'SELF_AUTHORED_SYNTHETIC', productionFenceEnforcement: 'NOT_VERIFIED',
    productionBackupRecovery: 'NOT_VERIFIED', physicalDeviceAcceptance: 'NOT_RUN', externalAcceptance: 'NOT_RUN',
    productionAuthorization: 'NOT_GRANTED' }, null, 2));
} finally {
  for (const id of owned) { try { docker(['rm', '--force', id]); } catch {} }
  try { docker(['volume', 'rm', volumeName]); } catch {}
  rmSync(root, { recursive: true, force: true });
}
