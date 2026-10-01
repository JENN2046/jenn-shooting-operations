import { executeLocalEmptyDbMaintenanceV1 } from '../../src/empty-db-maintenance-v1.mjs';
import { authorizationFor } from './empty-db-maintenance-fixture.mjs';
const packet = JSON.parse(process.argv[2]);
try {
  const response = executeLocalEmptyDbMaintenanceV1({ packet, runtime: packet.runtime,
    authorization: authorizationFor(packet), beforeCommit: () => {
      if (process.argv[3] === 'crash') process.kill(process.pid, 'SIGKILL');
    } });
  console.log(JSON.stringify(response));
} catch (error) {
  console.log(JSON.stringify({ ok: false, code: error.code ?? 'FAILED', diagnostic: error.message })); process.exitCode = 1;
}
