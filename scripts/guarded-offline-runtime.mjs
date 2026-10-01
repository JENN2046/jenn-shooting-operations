// Only a separately approved, disabled runtime start uses this cooperative guard.
// It does not configure a service or grant release. No production deployment in this PR.
import { openSync, closeSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== '/jso-maintenance-fence/guard.lock'
  || process.env.WRITE_ADMISSION_MODE !== 'disabled' || process.env.ORPHAN_CLEANUP_MODE !== 'disabled'
  || process.env.KIOSK_AUTH_CONFIG_PATH) {
  console.error('MAINTENANCE_RUNTIME_GUARD_CONFIGURATION_INVALID'); process.exitCode = 1;
} else {
  const fd = openSync(args[0], 'r');
  const lock = spawnSync('/usr/bin/flock', ['-n', '-s', '3'], { stdio: ['ignore', 'pipe', 'pipe', fd] });
  if (lock.error || lock.status !== 0) {
    closeSync(fd); console.error('MAINTENANCE_RUNTIME_FENCE_BUSY'); process.exitCode = 1;
  } else {
    // The server inherits the same open description, retaining the lock on supervisor loss.
    const child = spawn(process.execPath, ['src/server.mjs'], { stdio: ['inherit', 'inherit', 'inherit', fd] });
    child.on('error', () => { closeSync(fd); process.exitCode = 1; });
    child.on('exit', (code, signal) => { closeSync(fd); process.exitCode = signal ? 1 : code; });
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  }
}
