// Explicit synthetic-only runner; no startup wiring, environment DB defaults or HTTP surface.
import { readFileSync } from 'node:fs';
import { executeLocalEmptyDbMaintenanceV1 } from '../src/empty-db-maintenance-v1.mjs';
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--local-synthetic') {
  console.error('Usage: node scripts/local-empty-db-maintenance.mjs --local-synthetic packet.json authorization.json observed-runtime.json');
  process.exitCode = 2;
} else {
  try {
    const [packet, authorization, runtime] = args.slice(1).map(path => JSON.parse(readFileSync(path, 'utf8')));
    console.log(JSON.stringify(executeLocalEmptyDbMaintenanceV1({ packet, authorization, runtime }), null, 2));
  } catch (error) {
    // Do not emit packet content, paths, credentials or raw database exceptions.
    console.error(JSON.stringify({ ok: false, code: error.code?.startsWith('MAINTENANCE_')
      || error.code?.startsWith('SCHEMA_') ? error.code : 'MAINTENANCE_EXECUTION_FAILED' }));
    process.exitCode = 1;
  }
}
