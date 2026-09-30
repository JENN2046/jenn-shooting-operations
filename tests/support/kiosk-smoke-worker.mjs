import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { createTrustedPrincipal } from '../../src/authorization-v2.mjs';
import { createKioskServiceBindingV1 } from '../../src/kiosk-service-context-v1.mjs';
import { createSqliteKioskRunEventStore } from '../../src/sqlite-kiosk-run-event-store-v2.mjs';
import { createApplyKioskRunEvent } from '../../src/kiosk-run-event-use-case-v2.mjs';
const db = new DatabaseSync(workerData.path);
db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
const gate = new Int32Array(workerData.gate);
const time = new BigInt64Array(workerData.time);
const principal = createTrustedPrincipal({ subjectId: 'KIOSK-PROD-01', role: 'operator', resourceIds: ['STUDIO-PROD-01'] }).principal;
const serviceBinding = createKioskServiceBindingV1(workerData.binding);
let clockInTransaction = false;
const apply = createApplyKioskRunEvent({ serviceBinding,
  clock() { clockInTransaction = db.isTransaction; return new Date(Number(Atomics.load(time, 0))); },
  store: createSqliteKioskRunEventStore({ db, businessTimeZone: 'Asia/Shanghai', allowedBriefHosts: ['brief.example'] }) });
parentPort.postMessage({ ready: true });
Atomics.wait(gate, 0, 0);
try { parentPort.postMessage({ result: apply({ command: workerData.command, principal }), clockInTransaction }); }
finally { db.close(); }
