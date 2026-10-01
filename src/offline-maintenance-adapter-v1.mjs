import { spawn, spawnSync } from 'node:child_process';
import { openSync, closeSync, fstatSync, lstatSync, realpathSync, readFileSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { hostname, tmpdir } from 'node:os';
import { canonicalJsonSchedulingV1, digestCanonicalJsonSchedulingV1 } from './scheduling-contract-v1.mjs';

const SOCKET = 'unix:///var/run/docker.sock';
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const digest = digestCanonicalJsonSchedulingV1;
const same = (a, b) => canonicalJsonSchedulingV1(a) === canonicalJsonSchedulingV1(b);
const sha = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
export function maintenanceAdapterErrorV1(code) { const error = new Error(code); error.code = code; return error; }
function requireValue(value, code) { if (!value) throw maintenanceAdapterErrorV1(code); }
function exact(value, keys) {
  requireValue(value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)),
  'MAINTENANCE_ADAPTER_PACKET_INVALID');
}
export const digestOfflineMaintenanceV1 = digest;
export function observeFenceFileV1(path) {
  requireValue(typeof path === 'string' && isAbsolute(path) && resolve(path) === path
    && realpathSync(path) === path && !/[,\x00-\x1f]/u.test(path), 'MAINTENANCE_ADAPTER_FENCE_INVALID');
  const stat = lstatSync(path, { bigint: true });
  requireValue(stat.isFile() && stat.nlink === 1n, 'MAINTENANCE_ADAPTER_FENCE_INVALID');
  return { path, device: String(stat.dev), inode: String(stat.ino) };
}
function protectedFile(path, scope) {
  const synthetic = scope === 'LOCAL_SYNTHETIC_ADAPTER';
  const owner = synthetic ? process.getuid() : 0;
  requireValue(realpathSync(path) === resolve(path), 'MAINTENANCE_ADAPTER_APPROVAL_UNTRUSTED');
  const stat = lstatSync(path);
  requireValue(stat.isFile() && stat.nlink === 1 && stat.uid === owner
    && (stat.mode & 0o022) === 0 && stat.size <= 1024 * 1024,
  'MAINTENANCE_ADAPTER_APPROVAL_UNTRUSTED');
  let parent = dirname(path);
  if (synthetic) {
    requireValue(dirname(parent) === realpathSync(tmpdir())
      && /^jso-adapter-test-[A-Za-z0-9_-]+$/u.test(parent.slice(parent.lastIndexOf('/') + 1)),
    'MAINTENANCE_ADAPTER_SYNTHETIC_SCOPE_REQUIRED');
    const root = lstatSync(parent);
    requireValue(root.uid === owner && root.isDirectory() && (root.mode & 0o077) === 0,
      'MAINTENANCE_ADAPTER_APPROVAL_UNTRUSTED');
  } else {
    while (true) {
      const root = lstatSync(parent);
      requireValue(root.uid === 0 && root.isDirectory() && (root.mode & 0o022) === 0
        && realpathSync(parent) === parent, 'MAINTENANCE_ADAPTER_APPROVAL_UNTRUSTED');
      if (parent === '/') break;
      parent = dirname(parent);
    }
  }
  const fd = openSync(path, 'r');
  try {
    const opened = fstatSync(fd);
    requireValue(opened.dev === stat.dev && opened.ino === stat.ino && opened.nlink === 1,
      'MAINTENANCE_ADAPTER_APPROVAL_UNTRUSTED');
    return JSON.parse(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
}
function sharedFenceChallenge(path) {
  const fd = openSync(path, 'r');
  try { return spawnSync('/usr/bin/flock', ['-n', '-s', '3'], { stdio: ['ignore', 'pipe', 'pipe', fd] }); }
  finally { closeSync(fd); }
}
/** Kernel lock, not a boolean token. Existing file only; never creates a fence. */
export function acquireOfflineMaintenanceFenceV1(binding, scope) {
  binding = { path: binding.path, device: binding.device, inode: binding.inode };
  if (scope) protectedFile(binding.path, scope); // Private helper uses a read-only bind already admitted by host.
  requireValue(same(observeFenceFileV1(binding.path), binding), 'MAINTENANCE_ADAPTER_FENCE_MISMATCH');
  const fd = openSync(binding.path, 'r');
  try {
    const stat = fstatSync(fd, { bigint: true });
    requireValue(String(stat.dev) === binding.device && String(stat.ino) === binding.inode,
      'MAINTENANCE_ADAPTER_FENCE_MISMATCH');
    const result = spawnSync('/usr/bin/flock', ['-n', '-x', '3'], { stdio: ['ignore', 'pipe', 'pipe', fd] });
    requireValue(!result.error && result.status === 0, 'MAINTENANCE_ADAPTER_FENCE_BUSY_OR_UNAVAILABLE');
    let closed = false;
    return {
      assertHeld() {
        requireValue(!closed && same(observeFenceFileV1(binding.path), binding), 'MAINTENANCE_ADAPTER_FENCE_LOST');
        const opened = fstatSync(fd, { bigint: true });
        requireValue(String(opened.dev) === binding.device && String(opened.ino) === binding.inode,
          'MAINTENANCE_ADAPTER_FENCE_LOST');
        // A separate open description cannot take even a shared lock while ours is exclusive.
        const challenge = sharedFenceChallenge(binding.path);
        requireValue(!challenge.error && challenge.status === 1, 'MAINTENANCE_ADAPTER_FENCE_LOST');
      },
      close() { if (!closed) { closed = true; closeSync(fd); } },
    };
  } catch (error) { closeSync(fd); throw error; }
}
export function dockerMaintenanceReadV1(args) {
  const result = spawnSync('/usr/bin/docker', ['--host', SOCKET, ...args], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
  });
  requireValue(!result.error && result.status === 0, 'MAINTENANCE_ADAPTER_OBSERVATION_UNAVAILABLE');
  return result.stdout.trim();
}
export function observeOfflineDockerTargetV1({ imageId, volumeName, fencePath }, read = dockerMaintenanceReadV1) {
  requireValue(process.platform === 'linux' && sha(imageId)
    && typeof volumeName === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(volumeName),
  'MAINTENANCE_ADAPTER_TARGET_INVALID');
  const socket = lstatSync('/var/run/docker.sock');
  requireValue(socket.isSocket() && socket.uid === 0, 'MAINTENANCE_ADAPTER_DAEMON_UNTRUSTED');
  const info = JSON.parse(read(['info', '--format', '{{json .}}']));
  const [volume] = JSON.parse(read(['volume', 'inspect', volumeName]));
  const [image] = JSON.parse(read(['image', 'inspect', imageId]));
  requireValue(info.OSType === 'linux' && typeof info.ID === 'string' && info.ID.length > 0
    && typeof info.Name === 'string' && info.Name.length > 0,
  'MAINTENANCE_ADAPTER_DAEMON_UNTRUSTED');
  requireValue(volume?.Name === volumeName && volume.Driver === 'local'
    && (!volume.Options || Object.keys(volume.Options).length === 0)
    && typeof volume.CreatedAt === 'string' && isAbsolute(volume.Mountpoint)
    && !/[,\x00-\x1f]/u.test(volume.Mountpoint),
  'MAINTENANCE_ADAPTER_STORAGE_UNSUPPORTED');
  const sourceRevision = image?.Config?.Labels?.['org.opencontainers.image.revision'];
  const nodeVersion = image?.Config?.Env?.find(value => value.startsWith('NODE_VERSION='))?.slice(13);
  requireValue(image.Id === imageId && image.Os === 'linux' && image.Architecture === 'amd64'
    && /^[a-f0-9]{40}$/u.test(sourceRevision) && nodeVersion === '24.21.0',
  'MAINTENANCE_ADAPTER_RUNTIME_INVALID');
  return {
    host: { operatorUid: process.getuid(), machineIdDigest: hash(readFileSync('/etc/machine-id')),
      bootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), hostname: hostname(),
      dockerDaemonId: info.ID, dockerDaemonName: info.Name },
    storage: { name: volumeName, driver: volume.Driver, createdAt: volume.CreatedAt,
      mountpointDigest: hash(volume.Mountpoint), optionsDigest: digest(volume.Options ?? {}) },
    fence: { ...observeFenceFileV1(fencePath), coordinator: observeFenceFileV1(`${fencePath}.coordinator`) }, runtime: { sourceRevision, imageId }, nodeVersion: `v${nodeVersion}`,
    // Private observer detail used to detect aliases, never taken from packet assertions.
    mountpoint: volume.Mountpoint, syntheticVolume: volume.Labels?.['jso.synthetic'] === 'true',
  };
}
export function readOfflineMaintenanceApprovalV1({ packet, policyPath, approvalPath, observed, now = new Date() }) {
  exact(packet, ['schemaVersion', 'scope', 'host', 'storage', 'fence', 'operation']);
  requireValue(packet.schemaVersion === 1 && ['OFFLINE_PRODUCTION_MAINTENANCE', 'LOCAL_SYNTHETIC_ADAPTER'].includes(packet.scope),
    'MAINTENANCE_ADAPTER_PACKET_INVALID');
  if (packet.scope === 'LOCAL_SYNTHETIC_ADAPTER') requireValue(
    packet.storage.name.startsWith('jso-adapter-test-') && observed.syntheticVolume,
    'MAINTENANCE_ADAPTER_SYNTHETIC_SCOPE_REQUIRED');
  requireValue(same(packet.host, observed.host) && same(packet.storage, observed.storage)
    && same(packet.fence, observed.fence) && same(packet.operation.runtime, observed.runtime),
  'MAINTENANCE_ADAPTER_OBSERVED_BINDING_MISMATCH');
  requireValue(same(packet.operation.adapterBinding, { host: packet.host, storage: packet.storage, fence: packet.fence }),
    'MAINTENANCE_ADAPTER_DURABLE_BINDING_MISMATCH');
  requireValue(packet.operation.actor === `uid:${observed.host.operatorUid}`,
    'MAINTENANCE_ADAPTER_OPERATOR_MISMATCH');
  const policy = protectedFile(policyPath, packet.scope);
  exact(policy, ['schemaVersion', 'scope', 'host', 'storage', 'fence', 'runtime', 'writerContainerIds']);
  requireValue(policy.schemaVersion === 1 && policy.scope === packet.scope
    && same(policy.host, observed.host) && same(policy.storage, observed.storage)
    && same(policy.fence, observed.fence) && same(policy.runtime, observed.runtime)
    && Array.isArray(policy.writerContainerIds) && policy.writerContainerIds.length <= 128
    && new Set(policy.writerContainerIds).size === policy.writerContainerIds.length
    && policy.writerContainerIds.every(id => /^[a-f0-9]{64}$/u.test(id)),
  'MAINTENANCE_ADAPTER_POLICY_MISMATCH');
  const approval = protectedFile(approvalPath, packet.scope);
  exact(approval, ['schemaVersion', 'scope', 'operatorUid', 'approvalRef', 'packetDigest', 'policyDigest',
    'notBefore', 'expiresAt', 'recoveryRef', 'prerequisiteDigest']);
  const start = Date.parse(approval.notBefore), end = Date.parse(approval.expiresAt);
  requireValue(approval.schemaVersion === 1 && approval.scope === packet.scope
    && approval.operatorUid === observed.host.operatorUid && approval.approvalRef === packet.operation.approvalRef
    && approval.packetDigest === digest(packet) && approval.policyDigest === digest(policy)
    && Number.isFinite(start) && Number.isFinite(end) && start <= now.getTime() && now.getTime() < end
    && end - start > 0 && end - start <= 6 * 3600000
    && typeof approval.recoveryRef === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,127}$/u.test(approval.recoveryRef),
  'MAINTENANCE_ADAPTER_APPROVAL_DENIED');
  if (packet.scope === 'OFFLINE_PRODUCTION_MAINTENANCE') {
    const evidence = protectedFile(`${approvalPath}.prerequisites.json`, packet.scope);
    exact(evidence, ['schemaVersion', 'approvalRef', 'packetDigest', 'targetDigest', 'writerStartEnforcement', 'newDataRecovery', 'reviewRef']);
    requireValue(sha(approval.prerequisiteDigest) && digest(evidence) === approval.prerequisiteDigest
      && evidence.schemaVersion === 1 && evidence.approvalRef === approval.approvalRef
      && evidence.packetDigest === approval.packetDigest
      && evidence.targetDigest === digest({ host: observed.host, storage: observed.storage,
        fence: observed.fence, runtime: observed.runtime })
      && evidence.writerStartEnforcement === 'ACCEPTED_GUARDED_ADMINISTRATIVE_WINDOW'
      && evidence.newDataRecovery === 'ACCEPTED_FACT_AWARE_RECOVERY'
      && typeof evidence.reviewRef === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,127}$/u.test(evidence.reviewRef),
    'MAINTENANCE_ADAPTER_PREREQUISITES_NOT_ACCEPTED');
  } else requireValue(approval.prerequisiteDigest === null, 'MAINTENANCE_ADAPTER_SYNTHETIC_SCOPE_REQUIRED');
  return { policy, approval };
}
function disabledRuntime(c) {
  const values = new Map((c.Config?.Env ?? []).map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
  return c.Config?.User === 'node' && values.get('WRITE_ADMISSION_MODE') === 'disabled'
    && values.get('ORPHAN_CLEANUP_MODE') === 'disabled' && values.get('KIOSK_AUTH_CONFIG_PATH') === '';
}
const overlaps = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
export function assertOfflineDockerInventoryV1({ containers, observed, policy, helperId = null }) {
  requireValue(Array.isArray(containers), 'MAINTENANCE_ADAPTER_OBSERVATION_UNAVAILABLE');
  const found = new Set();
  for (const c of containers) {
    const mounts = c.Mounts ?? [];
    const relevant = mounts.filter(m => m.Name === observed.storage.name
      || (typeof m.Source === 'string' && overlaps(m.Source, observed.mountpoint)));
    if (!relevant.length) continue;
    if (c.Id === helperId) {
      requireValue(relevant.length === 1 && relevant[0].Type === 'bind'
        && relevant[0].Source === observed.mountpoint && c.Image === observed.runtime.imageId && c.Path === 'node'
        && same(c.Args, ['scripts/offline-maintenance-helper.mjs', 'execute'])
        && c.HostConfig.NetworkMode === 'none' && c.HostConfig.ReadonlyRootfs === true
        && same(c.HostConfig.CapDrop, ['ALL']) && c.HostConfig.SecurityOpt.includes('no-new-privileges')
        && c.HostConfig.RestartPolicy.Name === 'no' && c.State.Running && !c.State.Restarting
        && !c.State.Paused && c.HostConfig.Privileged === false && disabledRuntime(c)
        && relevant[0].Destination === '/maintenance-data' && relevant[0].RW === true
        && !Object.keys(c.HostConfig.PortBindings ?? {}).length
        && mounts.some(m => m.Type === 'bind' && m.Source === observed.fence.path
          && m.Destination === '/jso-maintenance-fence/guard.lock' && m.RW === false),
      'MAINTENANCE_ADAPTER_HELPER_MISMATCH');
      continue;
    }
    requireValue(relevant.length === 1 && relevant[0].Type === 'volume'
      && relevant[0].Name === observed.storage.name && relevant[0].Source === observed.mountpoint,
    'MAINTENANCE_ADAPTER_STORAGE_ALIAS');
    requireValue(policy.writerContainerIds.includes(c.Id), 'MAINTENANCE_ADAPTER_UNREGISTERED_WRITER');
    found.add(c.Id);
    requireValue(!c.State.Running && !c.State.Restarting && !c.State.Paused
      && c.HostConfig.RestartPolicy.Name === 'no', 'MAINTENANCE_ADAPTER_WRITER_NOT_STOPPED');
    requireValue(c.Image === observed.runtime.imageId && c.Path === 'node'
      && same(c.Args, ['scripts/guarded-offline-runtime.mjs', '/jso-maintenance-fence/guard.lock'])
      && c.HostConfig.Privileged === false && disabledRuntime(c)
      && relevant[0].Destination === '/app/data' && relevant[0].RW === true
      && mounts.some(m => m.Type === 'bind' && m.Source === observed.fence.path
        && m.Destination === '/jso-maintenance-fence/guard.lock' && m.RW === false),
    'MAINTENANCE_ADAPTER_WRITER_GUARD_MISSING');
  }
  requireValue(policy.writerContainerIds.every(id => found.has(id)), 'MAINTENANCE_ADAPTER_WRITER_ROSTER_INCOMPLETE');
}
function inventory(read) {
  const ids = read(['ps', '--all', '--quiet', '--no-trunc']).split(/\s+/u).filter(Boolean);
  requireValue(ids.length <= 512, 'MAINTENANCE_ADAPTER_OBSERVATION_UNAVAILABLE');
  return ids.length ? JSON.parse(read(['inspect', ...ids])) : [];
}
/** Coordinator owns admission and kernel fence; helper is a private transaction port. */
export async function executeOfflineMaintenanceAdapterV1({ packet, policyPath, approvalPath,
  read = dockerMaintenanceReadV1, spawnHelper = spawn } = {}) {
  // JSON sealing prevents asynchronous caller mutation. Observation seams exist for tests only.
  packet = JSON.parse(canonicalJsonSchedulingV1(packet));
  exact(packet, ['schemaVersion', 'scope', 'host', 'storage', 'fence', 'operation']);
  requireValue(packet.schemaVersion === 1 && ['OFFLINE_PRODUCTION_MAINTENANCE', 'LOCAL_SYNTHETIC_ADAPTER'].includes(packet.scope), 'MAINTENANCE_ADAPTER_PACKET_INVALID');
  let observed = observeOfflineDockerTargetV1({ imageId: packet.operation.runtime.imageId,
    volumeName: packet.storage.name, fencePath: packet.fence.path }, read);
  let admitted = readOfflineMaintenanceApprovalV1({ packet, policyPath, approvalPath, observed });
  const policyDigest = digest(admitted.policy);
  requireValue(packet.fence.coordinator && packet.fence.coordinator.path === `${packet.fence.path}.coordinator`
    && packet.fence.coordinator.inode !== packet.fence.inode, 'MAINTENANCE_ADAPTER_FENCE_INVALID');
  const coordinatorLock = acquireOfflineMaintenanceFenceV1(packet.fence.coordinator, packet.scope);
  let lock;
  try { lock = acquireOfflineMaintenanceFenceV1(packet.fence, packet.scope); }
  catch (error) { coordinatorLock.close(); throw error; }
  const name = `jso-maintenance-helper-${randomUUID()}`;
  let child, result, failure, commitPermissionSent = false, ready = false, helperId;
  function revalidate() {
    protectedFile(packet.fence.path, packet.scope);
    coordinatorLock.assertHeld();
    if (!ready) lock.assertHeld();
    else {
      requireValue(same(observeFenceFileV1(packet.fence.path), { path: packet.fence.path, device: packet.fence.device, inode: packet.fence.inode }), 'MAINTENANCE_ADAPTER_FENCE_LOST');
      const challenge = sharedFenceChallenge(packet.fence.path);
      requireValue(!challenge.error && challenge.status === 1, 'MAINTENANCE_ADAPTER_FENCE_LOST');
    }
    observed = observeOfflineDockerTargetV1({ imageId: packet.operation.runtime.imageId,
      volumeName: packet.storage.name, fencePath: packet.fence.path }, read);
    admitted = readOfflineMaintenanceApprovalV1({ packet, policyPath, approvalPath, observed });
    requireValue(digest(admitted.policy) === policyDigest, 'MAINTENANCE_ADAPTER_POLICY_CHANGED');
    assertOfflineDockerInventoryV1({ containers: inventory(read), observed, policy: admitted.policy, helperId });
  }
  try {
    revalidate();
    // The helper reacquires before any DB open. A competing shared writer makes that acquisition fail.
    // The helper owns the fence across COMMIT even if this coordinator is killed.
    lock.close();
    child = spawnHelper('/usr/bin/docker', ['--host', SOCKET, 'run', '--rm', '--interactive', '--name', name,
      '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--restart', 'no', '--no-healthcheck', '--mount', `type=bind,src=${observed.mountpoint},dst=/maintenance-data`,
      '--mount', `type=bind,src=${packet.fence.path},dst=/jso-maintenance-fence/guard.lock,readonly`,
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', '--tmpfs', '/app/data:ro,noexec,nosuid,size=1m',
      '--env', 'WRITE_ADMISSION_MODE=disabled', '--env', 'ORPHAN_CLEANUP_MODE=disabled',
      '--env', 'KIOSK_AUTH_CONFIG_PATH=', '--entrypoint', 'node', observed.runtime.imageId,
      'scripts/offline-maintenance-helper.mjs', 'execute'], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', () => {});
    // Do not forward raw Docker/SQLite errors or records into execution diagnostics.
    child.stderr.resume();
    child.stdin.write(JSON.stringify({ operation: packet.operation, nodeVersion: observed.nodeVersion, fence: packet.fence }) + '\n');
    let buffer = '';
    const timeout = setTimeout(() => { failure = maintenanceAdapterErrorV1('MAINTENANCE_ADAPTER_OUTCOME_UNKNOWN'); child.stdin.end(); }, 60000);
    try {
      await new Promise((resolvePromise, reject) => {
        child.on('error', () => reject(maintenanceAdapterErrorV1('MAINTENANCE_ADAPTER_HELPER_UNAVAILABLE')));
        child.stdout.on('data', bytes => {
          buffer += bytes;
          if (buffer.length > 1024 * 1024) { failure = maintenanceAdapterErrorV1('MAINTENANCE_ADAPTER_PROTOCOL_INVALID'); child.stdin.end(); return; }
          while (buffer.includes('\n')) {
            const index = buffer.indexOf('\n'), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
            try {
              const message = JSON.parse(line);
              if (message.phase === 'ready' && !ready && !failure) {
                [helperId] = JSON.parse(read(['inspect', name])).map(c => c.Id);
                ready = true; revalidate(); child.stdin.write(JSON.stringify({ permitOpen: true }) + '\n');
              } else if (message.phase === 'beforeCommit' && ready && !commitPermissionSent && !failure) {
                [helperId] = JSON.parse(read(['inspect', name])).map(c => c.Id);
                revalidate(); commitPermissionSent = true;
                child.stdin.end(JSON.stringify({ permitCommit: true }) + '\n');
              } else if (message.phase === 'result' && commitPermissionSent && !result && !failure) result = message.response;
              else if (message.phase === 'refused') failure ??= maintenanceAdapterErrorV1(
                /^MAINTENANCE_|^SCHEMA_/u.test(message.code) ? message.code : 'MAINTENANCE_ADAPTER_HELPER_REFUSED');
              else throw maintenanceAdapterErrorV1('MAINTENANCE_ADAPTER_PROTOCOL_INVALID');
            } catch (error) { failure ??= error; child.stdin.end(); }
          }
        });
        child.on('close', code => code === 0 && result && !failure ? resolvePromise() : reject(
          commitPermissionSent ? maintenanceAdapterErrorV1('MAINTENANCE_ADAPTER_OUTCOME_UNKNOWN')
            : failure ?? maintenanceAdapterErrorV1('MAINTENANCE_ADAPTER_HELPER_REFUSED')));
      });
    } finally { clearTimeout(timeout); }
    return { status: 'OFFLINE_MAINTENANCE_COMMITTED_OR_EXACT_REPLAY', response: result,
      packetDigest: digest(packet), observedHost: observed.host, observedStorage: observed.storage,
      observedRuntime: observed.runtime, fence: packet.fence, productionReleaseAuthorized: false,
      authorizationClass: packet.scope === 'LOCAL_SYNTHETIC_ADAPTER' ? 'SELF_AUTHORED_SYNTHETIC' : 'PROTECTED_ROOT_APPROVAL' };
  } finally {
    // The helper owns its kernel fence until after commit/rollback, including coordinator loss.
    if (child && child.exitCode === null) child.stdin.end();
    lock.close();
    coordinatorLock.close();
  }
}
