import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, chmodSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireOfflineMaintenanceFenceV1, observeFenceFileV1, digestOfflineMaintenanceV1,
  readOfflineMaintenanceApprovalV1, assertOfflineDockerInventoryV1, assertCanonicalOfflineBindSourceV1, assertOfflineMaintenancePermitDeadlineV1 } from '../src/offline-maintenance-adapter-v1.mjs';

// Inventory/image tokens here are deliberately synthetic. Actual Docker acceptance is separate.
const imageId = `sha256:${'a'.repeat(64)}`, sourceRevision = 'b'.repeat(40);
const writerId = 'c'.repeat(64), helperId = 'd'.repeat(64);
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'jso-adapter-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fencePath = join(root, 'fence.json'); writeFileSync(fencePath, '{}', { mode: 0o600 });
  const host = { operatorUid: process.getuid(), machineIdDigest: `sha256:${'e'.repeat(64)}`,
    bootId: 'synthetic-boot', hostname: 'synthetic-host', dockerDaemonId: 'synthetic-daemon', dockerDaemonName: 'synthetic-host' };
  const storage = { name: 'jso-adapter-test-synthetic', driver: 'local', createdAt: 'synthetic-time',
    mountpointDigest: `sha256:${'f'.repeat(64)}`, optionsDigest: digestOfflineMaintenanceV1({}) };
  const observed = { host, storage, fence: observeFenceFileV1(fencePath), runtime: { sourceRevision, imageId },
    mountpoint: '/synthetic/volumes/data', syntheticVolume: true };
  const packet = { schemaVersion: 1, scope: 'LOCAL_SYNTHETIC_ADAPTER', host, storage,
    fence: observed.fence, operation: { actor: `uid:${process.getuid()}`, approvalRef: 'test:approval', runtime: observed.runtime, adapterBinding: { host, storage, fence: observed.fence } } };
  const policy = { schemaVersion: 1, scope: packet.scope, host, storage, fence: observed.fence,
    runtime: observed.runtime, writerContainerIds: [writerId] };
  const approval = { schemaVersion: 1, scope: packet.scope, operatorUid: process.getuid(), approvalRef: packet.operation.approvalRef,
    packetDigest: digestOfflineMaintenanceV1(packet), policyDigest: digestOfflineMaintenanceV1(policy),
    notBefore: '2026-10-01T00:00:00Z', expiresAt: '2026-10-01T02:00:00Z', recoveryRef: 'synthetic:preserve-reconcile', prerequisiteDigest: null };
  const policyPath = join(root, 'policy.json'), approvalPath = join(root, 'approval.json');
  const save = () => { writeFileSync(policyPath, JSON.stringify(policy), { mode: 0o600 });
    writeFileSync(approvalPath, JSON.stringify(approval), { mode: 0o600 }); };
  save();
  const admit = (overrides = {}) => readOfflineMaintenanceApprovalV1({ packet, observed, policyPath, approvalPath,
    now: new Date('2026-10-01T01:00:00Z'), ...overrides });
  const writer = { Id: writerId, Image: imageId, Path: 'node',
    Args: ['scripts/guarded-offline-runtime.mjs', '/jso-maintenance-fence/guard.lock'],
    Config: { User: 'node', Env: ['WRITE_ADMISSION_MODE=disabled', 'ORPHAN_CLEANUP_MODE=disabled', 'KIOSK_AUTH_CONFIG_PATH='] },
    State: { Running: false, Restarting: false, Paused: false }, HostConfig: { Privileged: false, RestartPolicy: { Name: 'no' } },
    Mounts: [{ Type: 'volume', Name: storage.name, Source: observed.mountpoint, Destination: '/app/data', RW: true },
      { Type: 'bind', Source: fencePath, Destination: '/jso-maintenance-fence/guard.lock', RW: false }] };
  const helper = { Id: helperId, Image: imageId, Path: 'node', Args: ['scripts/offline-maintenance-helper.mjs', 'execute'],
    Config: { User: 'node', Env: ['WRITE_ADMISSION_MODE=disabled', 'ORPHAN_CLEANUP_MODE=disabled', 'KIOSK_AUTH_CONFIG_PATH='] },
    State: { Running: true, Restarting: false, Paused: false }, HostConfig: { Privileged: false, NetworkMode: 'none', ReadonlyRootfs: true,
      CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], RestartPolicy: { Name: 'no' }, PortBindings: {} },
    Mounts: [{ Type: 'bind', Source: observed.mountpoint, Destination: '/maintenance-data', RW: true },
      { Type: 'bind', Source: fencePath, Destination: '/jso-maintenance-fence/guard.lock', RW: false }] };
  const check = containers => assertOfflineDockerInventoryV1({ containers, observed, policy, helperId });
  return { packet, policy, approval, observed, approvalPath, policyPath, fencePath, save, admit, writer, helper, check };
}
test('kernel exclusive fence rejects concurrent acquisition and release permits the next owner', t => {
  const f = fixture(t), lock = acquireOfflineMaintenanceFenceV1(f.observed.fence, f.packet.scope);
  try {
    lock.assertHeld();
    assert.throws(() => acquireOfflineMaintenanceFenceV1(f.observed.fence, f.packet.scope), { code: 'MAINTENANCE_ADAPTER_FENCE_BUSY_OR_UNAVAILABLE' });
  } finally { lock.close(); }
  assert.throws(() => lock.assertHeld(), { code: 'MAINTENANCE_ADAPTER_FENCE_LOST' });
  const next = acquireOfflineMaintenanceFenceV1(f.observed.fence, f.packet.scope); next.assertHeld(); next.close();
});
test('independent observed binding and protected fixture approval admit one exact packet', t => {
  const f = fixture(t); assert.deepEqual(f.admit().policy, f.policy);
  for (const key of ['host', 'storage', 'fence']) {
    assert.throws(() => f.admit({ observed: { ...f.observed, [key]: {} } }), { code: 'MAINTENANCE_ADAPTER_OBSERVED_BINDING_MISMATCH' });
  }
  assert.throws(() => f.admit({ observed: { ...f.observed, runtime: { ...f.observed.runtime, imageId: `sha256:${'0'.repeat(64)}` } } }),
    { code: 'MAINTENANCE_ADAPTER_OBSERVED_BINDING_MISMATCH' });
});
test('wrong operator, changed packet, expired or overlong approval fail closed', t => {
  const f = fixture(t);
  assert.throws(() => f.admit({ packet: { ...f.packet, operation: { ...f.packet.operation, actor: 'uid:99999' } } }),
    { code: 'MAINTENANCE_ADAPTER_OPERATOR_MISMATCH' });
  f.approval.packetDigest = 'wrong'; f.save(); assert.throws(f.admit, { code: 'MAINTENANCE_ADAPTER_APPROVAL_DENIED' });
  f.approval.packetDigest = digestOfflineMaintenanceV1(f.packet); f.save();
  assert.throws(() => f.admit({ now: new Date('2026-10-01T02:00:00Z') }), { code: 'MAINTENANCE_ADAPTER_APPROVAL_DENIED' });
  f.approval.expiresAt = '2026-10-02T00:00:00Z'; f.save(); assert.throws(f.admit, { code: 'MAINTENANCE_ADAPTER_APPROVAL_DENIED' });
});
test('fixture scope never admits an unlabelled production volume or protected-production claim', t => {
  const f = fixture(t);
  assert.throws(() => f.admit({ observed: { ...f.observed, syntheticVolume: false } }), { code: 'MAINTENANCE_ADAPTER_SYNTHETIC_SCOPE_REQUIRED' });
  assert.throws(() => f.admit({ packet: { ...f.packet, scope: 'OFFLINE_PRODUCTION_MAINTENANCE' } }), { code: 'MAINTENANCE_ADAPTER_APPROVAL_UNTRUSTED' });
});
test('writable approvals, symlinks and hardlink aliases cannot supply authority or a fence', t => {
  const f = fixture(t); chmodSync(f.approvalPath, 0o666); assert.throws(f.admit, { code: 'MAINTENANCE_ADAPTER_APPROVAL_UNTRUSTED' });
  chmodSync(f.approvalPath, 0o600); const linked = f.approvalPath + '.link'; linkSync(f.approvalPath, linked);
  assert.throws(f.admit, { code: 'MAINTENANCE_ADAPTER_APPROVAL_UNTRUSTED' });
  const symlink = f.fencePath + '.symlink'; symlinkSync(f.fencePath, symlink);
  assert.throws(() => observeFenceFileV1(symlink), { code: 'MAINTENANCE_ADAPTER_FENCE_INVALID' });
});
test('a substituted durable observation tuple is refused before admission', t => {
  const f = fixture(t);
  assert.throws(() => f.admit({ packet: { ...f.packet, operation: { ...f.packet.operation, adapterBinding: {} } } }),
    { code: 'MAINTENANCE_ADAPTER_DURABLE_BINDING_MISMATCH' });
});
test('policy roster changes invalidate its independently approved digest', t => {
  const f = fixture(t); f.policy.writerContainerIds = []; f.save();
  assert.throws(f.admit, { code: 'MAINTENANCE_ADAPTER_APPROVAL_DENIED' });
});
test('exact stopped guarded roster and isolated helper are admitted; unrelated services are ignored', t => {
  const f = fixture(t); f.check([f.writer, f.helper, { Id: 'unrelated', Mounts: [] }]);
});
for (const [label, mutate, code] of [
  ['running writer', c => { c.State.Running = true; }, 'MAINTENANCE_ADAPTER_WRITER_NOT_STOPPED'],
  ['enabled admission', c => { c.Config.Env[0] = 'WRITE_ADMISSION_MODE=enabled'; }, 'MAINTENANCE_ADAPTER_WRITER_GUARD_MISSING'],
  ['privileged writer', c => { c.HostConfig.Privileged = true; }, 'MAINTENANCE_ADAPTER_WRITER_GUARD_MISSING'],
  ['automatic restart', c => { c.HostConfig.RestartPolicy.Name = 'always'; }, 'MAINTENANCE_ADAPTER_WRITER_NOT_STOPPED'],
  ['guard bypass', c => { c.Args = ['src/server.mjs']; }, 'MAINTENANCE_ADAPTER_WRITER_GUARD_MISSING'],
  ['mutable image mismatch', c => { c.Image = `sha256:${'0'.repeat(64)}`; }, 'MAINTENANCE_ADAPTER_WRITER_GUARD_MISSING'],
  ['unregistered container', c => { c.Id = 'e'.repeat(64); }, 'MAINTENANCE_ADAPTER_UNREGISTERED_WRITER'],
  ['bind alias', c => { c.Mounts[0].Type = 'bind'; }, 'MAINTENANCE_ADAPTER_STORAGE_ALIAS'],
]) test(`independent Docker inventory refuses ${label}`, t => {
  const f = fixture(t); mutate(f.writer); assert.throws(() => f.check([f.writer, f.helper]), { code });
});
test('missing roster and helper network/port/rootfs/fence mismatch are refused', t => {
  const f = fixture(t); assert.throws(() => f.check([f.helper]), { code: 'MAINTENANCE_ADAPTER_WRITER_ROSTER_INCOMPLETE' });
  for (const mutate of [c => { c.HostConfig.NetworkMode = 'bridge'; }, c => { c.HostConfig.ReadonlyRootfs = false; },
    c => { c.HostConfig.PortBindings = { '3800/tcp': [{}] }; }, c => { c.Mounts.pop(); }]) {
    const helper = structuredClone(f.helper); mutate(helper);
    assert.throws(() => f.check([f.writer, helper]), { code: 'MAINTENANCE_ADAPTER_HELPER_MISMATCH' });
  }
});

test('nonlexical bind symlink and symlink directory ancestors are refused before exclusion', t => {
  const f = fixture(t), alias = f.fencePath + '.volume-alias'; symlinkSync(f.observed.mountpoint, alias);
  for (const source of [alias, alias + '/subdirectory']) {
    assert.throws(() => f.check([f.writer, f.helper, { Id: 'unfenced', Mounts: [{ Type: 'bind', Source: source }] }]),
      { code: 'MAINTENANCE_ADAPTER_STORAGE_ALIAS' });
  }
});
test('unobservable bind source cannot be silently excluded from the storage inventory', t => {
  const f = fixture(t);
  assert.throws(() => assertCanonicalOfflineBindSourceV1(f.fencePath + '.absent'),
    { code: 'MAINTENANCE_ADAPTER_STORAGE_OBSERVATION_UNAVAILABLE' });
});
test('helper deadline is checked at actual decision and expiry boundary fails closed', () => {
  const permit = { notBefore: 1000, expiresAt: 2000 };
  assertOfflineMaintenancePermitDeadlineV1(permit, 1999);
  for (const now of [999, 2000, 2001]) assert.throws(() => assertOfflineMaintenancePermitDeadlineV1(permit, now),
    { code: 'MAINTENANCE_ADAPTER_APPROVAL_DENIED' });
  for (const bad of [{}, { ...permit, expiresAt: '2000' }, { ...permit, expiresAt: NaN },
    { ...permit, expiresAt: 6 * 3600000 + 1001 }]) assert.throws(() => assertOfflineMaintenancePermitDeadlineV1(bad, 1500),
    { code: 'MAINTENANCE_ADAPTER_APPROVAL_DENIED' });
});
