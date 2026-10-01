import { readFileSync } from 'node:fs';
import { executeOfflineMaintenanceAdapterV1 } from '../src/offline-maintenance-adapter-v1.mjs';
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--execute-approved') {
  console.error('Usage: node scripts/offline-empty-db-maintenance.mjs --execute-approved packet.json policy.json approval.json');
  process.exitCode = 2;
} else {
  try {
    const packet = JSON.parse(readFileSync(args[1], 'utf8'));
    console.log(JSON.stringify(await executeOfflineMaintenanceAdapterV1({ packet, policyPath: args[2], approvalPath: args[3] }), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: /^MAINTENANCE_|^SCHEMA_/u.test(error.code)
      ? error.code : 'MAINTENANCE_ADAPTER_EXECUTION_FAILED' }));
    process.exitCode = 1;
  }
}
