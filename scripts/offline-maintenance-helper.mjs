// Private host-coordinator port. No startup defaults, migrations, auth or release.
import { readSync, writeSync } from 'node:fs';
import { bindOfflineEmptyDbMaintenanceTargetV1, executeOfflineEmptyDbMaintenanceTransactionV1,
  digestEmptyDbMaintenancePacketV1 } from '../src/empty-db-maintenance-v1.mjs';
import { acquireOfflineMaintenanceFenceV1, assertOfflineMaintenancePermitDeadlineV1 } from '../src/offline-maintenance-adapter-v1.mjs';
function input() {
  const bytes = []; const byte = Buffer.alloc(1);
  while (bytes.length <= 1024 * 1024) {
    if (readSync(0, byte, 0, 1, null) !== 1) throw Object.assign(new Error(), { code: 'MAINTENANCE_ADAPTER_OBSERVER_LOST' });
    if (byte[0] === 10) return JSON.parse(Buffer.from(bytes).toString('utf8'));
    bytes.push(byte[0]);
  }
  throw Object.assign(new Error(), { code: 'MAINTENANCE_ADAPTER_PROTOCOL_INVALID' });
}
const send = value => writeSync(1, JSON.stringify(value) + '\n');
let lock;
try {
  if (process.argv.length !== 3 || !['observe', 'execute'].includes(process.argv[2])) throw new Error();
  if (process.argv[2] === 'observe') send({ target: bindOfflineEmptyDbMaintenanceTargetV1(), nodeVersion: process.version });
  else {
    // Decode UTF-8 JSON correctly; the protocol carries config display names too.
    const context = input();
    if (context.nodeVersion !== process.version) throw Object.assign(new Error(), { code: 'MAINTENANCE_ADAPTER_RUNTIME_INVALID' });
    lock = acquireOfflineMaintenanceFenceV1({ ...context.fence, path: '/jso-maintenance-fence/guard.lock' });
    lock.assertHeld();
    send({ phase: 'ready' });
    const openPermit = input();
    if (openPermit.permitOpen !== true) throw Object.assign(new Error(), { code: 'MAINTENANCE_ADAPTER_OBSERVER_LOST' });
    assertOfflineMaintenancePermitDeadlineV1(openPermit);
    const packet = context.operation;
    let commitPermit;
    const authorization = { scope: 'OFFLINE_ADAPTER_TRUST_PORT', actor: packet.actor, approvalRef: packet.approvalRef,
      packetDigest: digestEmptyDbMaintenancePacketV1(packet), writeAdmission: 'disabled', cleanup: 'disabled',
      kiosk: 'disabled', writersStopped: true };
    const response = executeOfflineEmptyDbMaintenanceTransactionV1({ packet, authorization, runtime: packet.runtime,
      beforeCommit() {
        lock.assertHeld(); send({ phase: 'beforeCommit' });
        commitPermit = input();
        if (commitPermit.permitCommit !== true) throw Object.assign(new Error(), { code: 'MAINTENANCE_ADAPTER_OBSERVER_LOST' });
        lock.assertHeld();
      }, beforeCommitDecision() { assertOfflineMaintenancePermitDeadlineV1(commitPermit); } });
    send({ phase: 'result', response });
  }
} catch (error) {
  send({ phase: 'refused', code: /^MAINTENANCE_|^SCHEMA_/u.test(error.code)
    ? error.code : 'MAINTENANCE_ADAPTER_HELPER_REFUSED',
    transactionOutcome: error.transactionOutcome === 'ROLLED_BACK_BEFORE_COMMIT'
      ? error.transactionOutcome : 'UNKNOWN_OR_NOT_STARTED' });
  process.exitCode = 1;
} finally { lock?.close(); }
