// Run inside a disposable network-isolated candidate container, with NO bind mounts.
// Starts the actual server entrypoint twice on private loopback; no credentials.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const root = mkdtempSync(join(tmpdir(), 'jso-candidate-startup-'));
const databasePath = join(root, 'synthetic.sqlite');
const result = { status: 'LOCAL_BARE_IMAGE_STARTUP_AND_REOPEN_PASS',
  serviceContext: 'PROD11_PRODUCTION', credentialsCreated: false,
  hostPortPublished: false, deviceAcceptance: 'NOT_RUN', starts: [] };
try {
  for (let start = 0; start < 2; start++) {
    const child = spawn(process.execPath, ['src/server.mjs'], { env: {
      PATH: process.env.PATH, HOST: '127.0.0.1', PORT: '3800',
      DATABASE_PATH: databasePath, UPLOAD_ROOT: join(root, 'uploads'),
      KIOSK_SERVICE_CONTEXT: 'PROD11_PRODUCTION', ORPHAN_CLEANUP_MODE: 'disabled',
      WRITE_ADMISSION_MODE: 'disabled',
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostic = '';
    child.stderr.on('data', bytes => { diagnostic += bytes; });
    const exited = once(child, 'exit');
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error(`Server exited: ${diagnostic}`);
        try { ready = (await fetch('http://127.0.0.1:3800/healthz')).status === 200; } catch {}
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert(ready, `Health never became ready: ${diagnostic}`);
      const read = await fetch('http://127.0.0.1:3800/api/v2/kiosk/current?resourceId=STUDIO-PROD-01');
      assert.equal((await read.json()).code, 'AUTH_NOT_CONFIGURED');
      const write = await fetch('http://127.0.0.1:3800/api/v2/schedule-items/LOCAL-UNAUTHORIZED/events',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal((await write.json()).code, 'WRITE_ADMISSION_DISABLED');
      const db = new DatabaseSync(databasePath, { readOnly: true });
      const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r => r.version);
      assert.deepEqual(versions, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const eventCount = db.prepare('SELECT COUNT(*) AS n FROM production_events').get().n;
      const smokeOwnerCount = db.prepare('SELECT COUNT(*) AS n FROM kiosk_smoke_runtime_session').get().n;
      assert.equal(eventCount, 0); assert.equal(smokeOwnerCount, 0);
      const initializationCount = db.prepare('SELECT COUNT(*) AS n FROM empty_db_initialization').get().n;
      const counterCount = db.prepare('SELECT COUNT(*) AS n FROM revision_counters').get().n;
      assert.equal(initializationCount, 0); assert.equal(counterCount, 0);
      db.close();
      const stat = statSync(databasePath, { bigint: true });
      result.starts.push({ health: 200, disabledReadStatus: read.status,
        disabledWriteStatus: write.status, kioskCode: 'AUTH_NOT_CONFIGURED',
        writeCode: 'WRITE_ADMISSION_DISABLED', versions,
        eventCount, smokeOwnerCount, initializationCount, counterCount, databaseDevice: String(stat.dev), databaseInode: String(stat.ino) });
    } finally {
      child.kill('SIGTERM');
      await exited;
    }
  }
  assert.equal(result.starts[0].databaseDevice, result.starts[1].databaseDevice);
  assert.equal(result.starts[0].databaseInode, result.starts[1].databaseInode);
  result.databaseIdentityPreservedAcrossProcessReopen = true;
  console.log(JSON.stringify(result, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
