import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  assertG3AuthorityReconciliationStartupAllowed,
  isFrozenProductionDatabasePath,
} from '../src/g3-authority-reconciliation-startup-gate-v1.mjs';
import { createOperationsServer } from '../src/server.mjs';

const record = JSON.parse(await readFile(new URL(
  '../docs/operations/g3-authority-binding-reconciliation.r1.json', import.meta.url), 'utf8'));

test('reconciliation blocks both frozen production database paths', () => {
  for (const path of record.runtimeStartupGate.productionDatabasePaths) {
    assert.equal(isFrozenProductionDatabasePath(path), true);
    assert.throws(
      () => assertG3AuthorityReconciliationStartupAllowed({
        databasePath: path,
        reconciliationRecord: record,
      }),
      /G3_AUTHORITY_RECONCILIATION_STARTUP_BLOCKED/,
    );
  }
});

test('reconciliation startup gate does not block non-production database paths', () => {
  assert.equal(isFrozenProductionDatabasePath('/tmp/jso-test.sqlite'), false);
  assert.deepEqual(
    assertG3AuthorityReconciliationStartupAllowed({
      databasePath: '/tmp/jso-test.sqlite',
      reconciliationRecord: record,
    }),
    { allowed: true, reason: 'NON_PRODUCTION_DATABASE_PATH' },
  );
});

test('server factory cannot bypass reconciliation with the frozen production database', () => {
  assert.throws(
    () => createOperationsServer({
      databasePath: '/app/data/shooting-operations.sqlite',
      writeAdmissionMode: 'enabled',
      orphanCleanupMode: 'inherit',
    }),
    /G3_AUTHORITY_RECONCILIATION_STARTUP_BLOCKED/,
  );
});

test('direct server startup fails before opening the frozen production database', () => {
  const root = new URL('../', import.meta.url).pathname;
  const run = spawnSync(process.execPath, ['src/server.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_PATH: '/app/data/shooting-operations.sqlite',
      WRITE_ADMISSION_MODE: 'enabled',
      ORPHAN_CLEANUP_MODE: 'inherit',
    },
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /G3_AUTHORITY_RECONCILIATION_STARTUP_BLOCKED/);
  assert.doesNotMatch(run.stdout, /Jenn Shooting Operations listening/);
});

test('compose and image preserve fail-closed reconciliation defaults', async () => {
  const [compose, dockerfile] = await Promise.all([
    readFile(new URL('../compose.yaml', import.meta.url), 'utf8'),
    readFile(new URL('../Dockerfile', import.meta.url), 'utf8'),
  ]);
  assert.match(compose, /WRITE_ADMISSION_MODE: \$\{WRITE_ADMISSION_MODE:-disabled\}/);
  assert.match(compose, /ORPHAN_CLEANUP_MODE: \$\{ORPHAN_CLEANUP_MODE:-disabled\}/);
  assert.match(dockerfile, /g3-authority-binding-reconciliation\.r1\.json/);
});
