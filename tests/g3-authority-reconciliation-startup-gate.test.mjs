import assert from 'node:assert/strict';
import { link, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertG3AuthorityReconciliationStartupAllowed,
  isFrozenProductionDatabasePath,
  pathsReferToSameFile,
} from '../src/g3-authority-reconciliation-startup-gate-v1.mjs';
import { createOperationsServer } from '../src/server.mjs';
import { ScheduleStore } from '../src/store.mjs';

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

test('reconciliation startup gate normalizes production path aliases', () => {
  assert.equal(isFrozenProductionDatabasePath('/app/data/../data/shooting-operations.sqlite'), true);
});

test('reconciliation startup gate blocks SQLite file URI aliases of production', () => {
  for (const databasePath of [
    'file:%2Fapp%2Fdata%2Fshooting-operations.sqlite',
    'file:/app/data/shooting-operations.sqlite',
    'file:///app/data/shooting-operations.sqlite',
    'file://localhost/app/data/shooting-operations.sqlite',
    'file:%2Fapp%2Fdata%2Fshooting-operations.sqlite?mode=rw&cache=private',
    'file:/app/data/%73hooting-operations.sqlite#ignored',
  ]) {
    assert.equal(isFrozenProductionDatabasePath(databasePath), true, databasePath);
    assert.throws(
      () => assertG3AuthorityReconciliationStartupAllowed({
        databasePath,
        reconciliationRecord: record,
      }),
      /G3_AUTHORITY_RECONCILIATION_STARTUP_BLOCKED/,
    );
  }

  assert.throws(
    () => isFrozenProductionDatabasePath('file://evil/app/data/shooting-operations.sqlite'),
    /G3_AUTHORITY_RECONCILIATION_DATABASE_URI_INVALID/,
  );
});

test('same-file identity catches symlink and hardlink aliases', async () => {
  const root = await mkdtemp(join(tmpdir(), 'g3-startup-alias-'));
  try {
    const target = join(root, 'target.sqlite');
    const symlinkAlias = join(root, 'symlink.sqlite');
    const hardlinkAlias = join(root, 'hardlink.sqlite');
    await writeFile(target, 'sqlite-placeholder');
    await symlink(target, symlinkAlias);
    await link(target, hardlinkAlias);
    assert.equal(pathsReferToSameFile(target, symlinkAlias), true);
    assert.equal(pathsReferToSameFile(target, hardlinkAlias), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reconciliation startup gate does not block non-production database paths', () => {
  for (const databasePath of [
    '/tmp/jso-test.sqlite',
    'file:%2Ftmp%2Fjso-test.sqlite?mode=rw',
  ]) {
    assert.equal(isFrozenProductionDatabasePath(databasePath), false);
    assert.deepEqual(
      assertG3AuthorityReconciliationStartupAllowed({
        databasePath,
        reconciliationRecord: record,
      }),
      { allowed: true, reason: 'NON_PRODUCTION_DATABASE_PATH' },
    );
  }
});

test('writable ScheduleStore cannot bypass reconciliation with the frozen production database', () => {
  for (const filename of [
    '/app/data/shooting-operations.sqlite',
    'file:%2Fapp%2Fdata%2Fshooting-operations.sqlite',
  ]) {
    assert.throws(
      () => new ScheduleStore({
        filename,
        writeAdmissionMode: 'enabled',
        orphanCleanupMode: 'inherit',
      }),
      /G3_AUTHORITY_RECONCILIATION_STARTUP_BLOCKED/,
    );
  }
});

test('server factory cannot bypass reconciliation with the frozen production database', () => {
  for (const databasePath of [
    '/app/data/shooting-operations.sqlite',
    'file:%2Fapp%2Fdata%2Fshooting-operations.sqlite',
  ]) {
    assert.throws(
      () => createOperationsServer({
        databasePath,
        writeAdmissionMode: 'enabled',
        orphanCleanupMode: 'inherit',
      }),
      /G3_AUTHORITY_RECONCILIATION_STARTUP_BLOCKED/,
    );
  }
});

test('direct server startup fails before opening the frozen production database', () => {
  const root = new URL('../', import.meta.url).pathname;
  for (const databasePath of [
    '/app/data/shooting-operations.sqlite',
    'file:%2Fapp%2Fdata%2Fshooting-operations.sqlite',
  ]) {
    const run = spawnSync(process.execPath, ['src/server.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_PATH: databasePath,
        WRITE_ADMISSION_MODE: 'enabled',
        ORPHAN_CLEANUP_MODE: 'inherit',
      },
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /G3_AUTHORITY_RECONCILIATION_STARTUP_BLOCKED/);
    assert.doesNotMatch(run.stdout, /Jenn Shooting Operations listening/);
  }
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
