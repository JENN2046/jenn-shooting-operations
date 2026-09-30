import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteOutboxRepositoryV1 } from '../../src/sqlite-outbox-repository-v1.mjs';
import { createSqliteSchedulingProposalStoreV1 } from '../../src/sqlite-scheduling-proposal-store-v1.mjs';
import { assembleSchedulingInputFromSqliteV1 } from '../../src/sqlite-scheduling-input-assembler-v1.mjs';

const db = new DatabaseSync(workerData.path);
db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 0;');
const shared = new Int32Array(workerData.shared);
if (workerData.mode === 'late-generation') {
  try {
    const store = createSqliteSchedulingProposalStoreV1({ db, assembleInput: assembleSchedulingInputFromSqliteV1,
      now: () => {
        // Computation/read transaction completed; block just before the persistence transaction.
        parentPort.postMessage({ ready: true });
        if (Atomics.wait(shared, 0, 0, 10000) === 'timed-out') throw new Error('barrier timeout');
        return new Date(workerData.now);
      } });
    parentPort.postMessage({ result: store.generate(workerData.command, 'scheduler:race') });
  } catch (error) { parentPort.postMessage({ error: error.code ?? error.message }); }
  db.close();
} else {
  const repo = createSqliteOutboxRepositoryV1({ db });
  const ids = [];
  let iterations = 0;
  const tick = () => {
    const result = repo.claimBatch({ workerId: 'gf15-racing-worker', now: workerData.now, limit: 8 });
    iterations += 1;
    if (result.code === 'STORE_BUSY') { Atomics.add(shared, 1, 1); Atomics.notify(shared, 1); }
    if (result.ok) { ids.push(...result.items.map(item => item.outboxId)); Atomics.add(shared, 2, 1); Atomics.notify(shared, 2); }
    if (iterations === 1) parentPort.postMessage({ ready: true, ids });
    if (Atomics.load(shared, 0) === 1) { parentPort.postMessage({ done: true, ids, iterations }); db.close(); }
    else setTimeout(tick, 1);
  };
  tick();
}
