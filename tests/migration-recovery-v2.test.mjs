import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { buildMigrationPlan } from '../src/migration-v2.mjs';
import {
  createVerifiedBackup,
  restoreVerifiedBackup,
  verifyExistingBackup,
  verifyExistingRestore,
} from '../src/migration-recovery-sqlite-v2.mjs';
import { readV1Source, resolveExistingPath } from '../src/migration-sqlite-v2.mjs';
import { V1_SCHEMA_SQL } from '../src/sqlite-schema-v2.mjs';
import { IS_WINDOWS } from '../src/platform-filesystem.mjs';

const FIXED_NOW = '2026-09-22T12:00:00.000Z';

function canCreateFileSymlink() {
  const root = mkdtempSync(join(tmpdir(), 'jso-symlink-probe-'));
  try {
    const target = join(root, 'target');
    const link = join(root, 'link');
    writeFileSync(target, 'probe');
    symlinkSync(target, link);
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return false;
    throw error;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const CAN_CREATE_FILE_SYMLINK = canCreateFileSymlink();

function emptySnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: '2026-09-22T00:00:00.000Z',
    products: [],
    tasks: [],
    sessions: [],
    ...overrides,
  };
}

function createSource(root, { snapshot = emptySnapshot(), uploads = [] } = {}) {
  const source = join(root, 'source.sqlite');
  const db = new DatabaseSync(source);
  try {
    db.exec(V1_SCHEMA_SQL);
    db.prepare(`
      INSERT INTO schedule_state (id, revision, updated_at, snapshot_json)
      VALUES (1, ?, ?, ?)
    `).run(snapshot.revision, snapshot.updatedAt, JSON.stringify(snapshot));
    const insertUpload = db.prepare(`
      INSERT INTO uploads (
        id, operation_id, original_name, content_type, kind, size, sha256,
        stored_name, claimed_task_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const upload of uploads) {
      insertUpload.run(
        upload.id,
        upload.operation_id,
        upload.original_name,
        upload.content_type,
        upload.kind,
        upload.size,
        upload.sha256,
        upload.stored_name,
        upload.claimed_task_id,
        FIXED_NOW,
      );
    }
  } finally {
    db.close();
  }
  return source;
}

function buildPlan(source) {
  return buildMigrationPlan({
    source: readV1Source(resolveExistingPath(source)),
    businessTimeZone: 'UTC',
    importedAt: FIXED_NOW,
  });
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function restoreMtimeNs(path, mtimeNs) {
  const seconds = mtimeNs / 1_000_000_000n;
  const nanos = (mtimeNs % 1_000_000_000n).toString().padStart(9, '0');
  const touch = spawnSync('touch', ['-m', '-d', `@${seconds}.${nanos}`, path], {
    encoding: 'utf8',
  });
  assert.equal(touch.status, 0, touch.stderr);
  assert.equal(statSync(path, { bigint: true }).mtimeNs, mtimeNs);
}

async function withFixtureRoot(action) {
  const root = mkdtempSync(join(tmpdir(), 'jenn-shooting-migration-fixture-'));
  chmodSync(root, 0o700);
  try {
    return await action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('verified backup and restore bind database, artifact, and hashed attachment evidence', async () => {
  await withFixtureRoot(async root => {
    const uploadRoot = join(root, 'uploads');
    mkdirSync(uploadRoot, { mode: 0o700 });
    const body = Buffer.from('fixture-upload');
    const storedName = `${createHash('sha256').update(body).digest('hex')}.bin`;
    writeFileSync(join(uploadRoot, storedName), body, { mode: 0o600 });
    const source = createSource(root, {
      uploads: [{
        id: 'UPLOAD-1',
        operation_id: 'OPERATION-1',
        original_name: 'private-name.bin',
        content_type: 'application/octet-stream',
        kind: 'attachment',
        size: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
        stored_name: storedName,
        claimed_task_id: null,
      }],
    });
    const plan = buildPlan(source);
    const backup = join(root, 'backup.sqlite');
    const rollbackTarget = join(root, 'rollback.sqlite');
    const sourceHash = hashFile(source);
    const sourceStat = statSync(source, { bigint: true });

    const receipt = await createVerifiedBackup({
      fixtureRoot: root,
      source,
      backup,
      plan,
      uploadRoot,
    });
    assert.equal(receipt.status, 'BACKUP_VERIFIED');
    assert.match(receipt.artifactDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(receipt.uploadManifestDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(receipt.backupProofIdentity, /^sha256:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(receipt).includes('private-name.bin'), false);
    assert.equal(JSON.stringify(receipt).includes(storedName), false);

    const restored = restoreVerifiedBackup({
      fixtureRoot: root,
      source,
      backup,
      rollbackTarget,
      plan,
      backupReceipt: receipt,
      uploadRoot,
      expectedAttachmentDigest: receipt.uploadManifestDigest,
    });
    assert.equal(restored.status, 'ROLLBACK_VERIFIED');
    assert.equal(restored.artifactDigest, receipt.artifactDigest);
    assert.match(restored.rollbackProofIdentity, /^sha256:[a-f0-9]{64}$/);
    assert.equal(hashFile(source), sourceHash);
    const afterStat = statSync(source, { bigint: true });
    assert.equal(afterStat.size, sourceStat.size);
    assert.equal(afterStat.mtimeNs, sourceStat.mtimeNs);

    const beforeReplay = {
      backupHash: hashFile(backup),
      rollbackHash: hashFile(rollbackTarget),
      entries: readdirSync(root).toSorted(),
      backupMtime: statSync(backup, { bigint: true }).mtimeNs,
      rollbackMtime: statSync(rollbackTarget, { bigint: true }).mtimeNs,
    };
    const replayReceipt = verifyExistingBackup({
      fixtureRoot: root,
      source,
      backup,
      plan,
      uploadRoot,
      expectedAttachmentDigest: receipt.uploadManifestDigest,
    });
    assert.equal(replayReceipt.status, 'BACKUP_VERIFIED');
    assert.equal(replayReceipt.artifactDigest, receipt.artifactDigest);
    assert.equal(verifyExistingRestore({
      fixtureRoot: root,
      source,
      backup,
      rollbackTarget,
      plan,
      backupReceipt: receipt,
      uploadRoot,
    }).status, 'ROLLBACK_VERIFIED');
    assert.equal(hashFile(backup), beforeReplay.backupHash);
    assert.equal(hashFile(rollbackTarget), beforeReplay.rollbackHash);
    assert.equal(statSync(backup, { bigint: true }).mtimeNs, beforeReplay.backupMtime);
    assert.equal(statSync(rollbackTarget, { bigint: true }).mtimeNs, beforeReplay.rollbackMtime);
    assert.deepEqual(readdirSync(root).toSorted(), beforeReplay.entries);
  });
});

test('SQLite backup includes committed WAL data and remains self-contained', async () => {
  await withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    const keeper = new DatabaseSync(source);
    try {
      assert.equal(keeper.prepare('PRAGMA journal_mode = WAL').get().journal_mode, 'wal');
      keeper.prepare(`
        INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
        VALUES ('fixture.wal', 'test', NULL, 0, 'ok', ?)
      `).run(FIXED_NOW);
      const plan = buildPlan(source);
      const backup = join(root, 'wal-backup.sqlite');
      const sourceHash = hashFile(source);
      const sourceMtime = statSync(source, { bigint: true }).mtimeNs;
      const sourceWal = `${source}-wal`;
      const sourceWalHash = hashFile(sourceWal);
      const sourceWalStat = statSync(sourceWal, { bigint: true });

      const receipt = await createVerifiedBackup({ fixtureRoot: root, source, backup, plan });
      assert.equal(receipt.auditSummary.count, 1);
      assert.equal(existsSync(`${backup}-wal`), false);
      assert.equal(existsSync(`${backup}-shm`), false);
      assert.equal(hashFile(source), sourceHash);
      assert.equal(statSync(source, { bigint: true }).mtimeNs, sourceMtime);

      const afterWalStat = statSync(sourceWal, { bigint: true });
      assert.equal(hashFile(sourceWal), sourceWalHash);
      assert.equal(afterWalStat.dev, sourceWalStat.dev);
      assert.equal(afterWalStat.ino, sourceWalStat.ino);
      assert.equal(afterWalStat.size, sourceWalStat.size);
      assert.equal(afterWalStat.mtimeNs, sourceWalStat.mtimeNs);
      const copy = new DatabaseSync(backup, { readOnly: true });
      try {
        assert.equal(copy.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 1);
      } finally {
        copy.close();
      }
    } finally {
      keeper.close();
    }
  });
});

test('new artifact gate rejects existing, symlink, sidecar, path conflict, and hardlink inputs', async t => {
  await t.test('existing destination', async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    const backup = join(root, 'backup.sqlite');
    writeFileSync(backup, 'do-not-overwrite');
    const before = hashFile(backup);
    await assert.rejects(
      createVerifiedBackup({ fixtureRoot: root, source, backup, plan }),
      error => error.code === 'DESTINATION_EXISTS',
    );
    assert.equal(hashFile(backup), before);
  }));

  await t.test('symlink destination', {
    skip: CAN_CREATE_FILE_SYMLINK ? false : 'file symlink creation is not available on this Windows host',
  }, async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    const backup = join(root, 'backup.sqlite');
    symlinkSync(source, backup);
    await assert.rejects(
      createVerifiedBackup({ fixtureRoot: root, source, backup, plan }),
      error => error.code === 'UNSAFE_DESTINATION',
    );
  }));

  await t.test('orphan sidecar', async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    const backup = join(root, 'backup.sqlite');
    writeFileSync(`${backup}-wal`, 'orphan');
    await assert.rejects(
      createVerifiedBackup({ fixtureRoot: root, source, backup, plan }),
      error => error.code === 'DESTINATION_SIDECAR_EXISTS',
    );
  }));

  await t.test('source path conflict', async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    await assert.rejects(
      createVerifiedBackup({ fixtureRoot: root, source, backup: source, plan }),
      error => error.code === 'PATH_IDENTITY_CONFLICT',
    );
  }));

  await t.test('hardlinked source is rejected', async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const alias = join(root, 'source-alias.sqlite');
    linkSync(source, alias);
    const plan = buildPlan(source);
    await assert.rejects(
      createVerifiedBackup({ fixtureRoot: root, source, backup: join(root, 'backup.sqlite'), plan }),
      error => error.code === 'PATH_IDENTITY_CONFLICT',
    );
  }));
});

test('backup detects a source change and preserves the created artifact', async () => {
  await withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    const backup = join(root, 'backup.sqlite');
    await assert.rejects(createVerifiedBackup({
      fixtureRoot: root,
      source,
      backup,
      plan,
      duringBackup: () => {
        const writer = new DatabaseSync(source);
        try {
          writer.prepare(`
            INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
            VALUES ('fixture.changed', 'test', NULL, 0, 'ok', ?)
          `).run(FIXED_NOW);
        } finally {
          writer.close();
        }
      },
    }), error => error.code === 'BACKUP_EVIDENCE_MISMATCH');
    assert.equal(existsSync(backup), true);
  });
});

test('SOURCE_CHANGED_DURING_SCAN fails closed without retrying a newly stable view', async () => {
  await withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    const keeper = new DatabaseSync(source);
    let scanHookCalls = 0;
    try {
      keeper.prepare('PRAGMA journal_mode = WAL').get();
      await assert.rejects(createVerifiedBackup({
        fixtureRoot: root,
        source,
        backup: join(root, 'backup.sqlite'),
        plan,
        duringSourceScan: () => {
          scanHookCalls += 1;
          const writer = new DatabaseSync(source);
          try {
            writer.prepare(`
              INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
              VALUES ('fixture.concurrent', 'test', NULL, 0, 'ok', ?)
            `).run(FIXED_NOW);
          } finally {
            writer.close();
          }
        },
      }), error => error.code === 'BACKUP_EVIDENCE_MISMATCH');
      assert.equal(scanHookCalls, 1);
      assert.equal(existsSync(join(root, 'backup.sqlite')), false);
    } finally {
      keeper.close();
    }
  });
});

test('backup verification detects WAL content rewrite with restored mtime', async t => {
  if (process.platform !== 'linux') {
    t.skip('requires GNU touch nanosecond timestamp restoration');
    return;
  }

  await withFixtureRoot(async root => {
    const source = createSource(root);
    const keeper = new DatabaseSync(source);
    const wal = `${source}-wal`;
    let originalWal;
    let originalMtime;
    try {
      assert.equal(keeper.prepare('PRAGMA journal_mode = WAL').get().journal_mode, 'wal');
      keeper.prepare(`
        INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
        VALUES ('fixture.digest', 'test', NULL, 0, 'ok', ?)
      `).run(FIXED_NOW);

      const plan = buildPlan(source);
      const backup = join(root, 'backup.sqlite');
      await createVerifiedBackup({ fixtureRoot: root, source, backup, plan });

      originalWal = readFileSync(wal);
      originalMtime = statSync(wal, { bigint: true }).mtimeNs;

      assert.throws(() => verifyExistingBackup({
        fixtureRoot: root,
        source,
        backup,
        plan,
        duringVerification: () => {
          const changed = Buffer.from(originalWal);
          changed[changed.length - 1] ^= 0x01;
          writeFileSync(wal, changed);
          restoreMtimeNs(wal, originalMtime);
          assert.equal(statSync(wal, { bigint: true }).size, BigInt(originalWal.length));
        },
      }), error => error.code === 'BACKUP_EVIDENCE_MISMATCH');
    } finally {
      if (originalWal && originalMtime !== undefined) {
        writeFileSync(wal, originalWal);
        restoreMtimeNs(wal, originalMtime);
      }
      keeper.close();
    }
  });
});

test('read-only replay rejects content-equivalent source writes and inode replacement', async t => {
  await t.test('no-op SQL write changes the frozen physical family', async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    const backup = join(root, 'backup.sqlite');
    await createVerifiedBackup({ fixtureRoot: root, source, backup, plan });
    assert.throws(() => verifyExistingBackup({
      fixtureRoot: root,
      source,
      backup,
      plan,
      duringVerification: () => {
        const writer = new DatabaseSync(source);
        try {
          writer.exec(`
            BEGIN IMMEDIATE;
            UPDATE schedule_state SET updated_at = '2026-09-22T00:00:01.000Z' WHERE id = 1;
            UPDATE schedule_state SET updated_at = '2026-09-22T00:00:00.000Z' WHERE id = 1;
            COMMIT;
          `);
        } finally {
          writer.close();
        }
      },
    }), error => error.code === 'BACKUP_EVIDENCE_MISMATCH');
  }));

  await t.test('byte-identical source replacement changes inode', async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    const backup = join(root, 'backup.sqlite');
    await createVerifiedBackup({ fixtureRoot: root, source, backup, plan });
    assert.throws(() => verifyExistingBackup({
      fixtureRoot: root,
      source,
      backup,
      plan,
      duringVerification: () => {
        const replacement = join(root, 'replacement.sqlite');
        writeFileSync(replacement, readFileSync(source), { mode: 0o600 });
        renameSync(replacement, source);
      },
    }), error => error.code === 'BACKUP_EVIDENCE_MISMATCH');
  }));
});

test('replay detects sidecar and attachment inode changes introduced during verification', async t => {
  await t.test('backup sidecar appears after the read phase', async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    const backup = join(root, 'backup.sqlite');
    await createVerifiedBackup({ fixtureRoot: root, source, backup, plan });
    assert.throws(() => verifyExistingBackup({
      fixtureRoot: root,
      source,
      backup,
      plan,
      duringVerification: () => writeFileSync(`${backup}-wal`, 'late-sidecar'),
    }), error => error.code === 'BACKUP_NOT_VERIFIED');
  }));

  await t.test('byte-identical attachment replacement changes inode', async () => withFixtureRoot(async root => {
    const uploadRoot = join(root, 'uploads');
    mkdirSync(uploadRoot, { mode: 0o700 });
    const body = Buffer.from('stable-attachment');
    const storedName = `${createHash('sha256').update(body).digest('hex')}.bin`;
    const uploadPath = join(uploadRoot, storedName);
    writeFileSync(uploadPath, body, { mode: 0o600 });
    const source = createSource(root, {
      uploads: [{
        id: 'UPLOAD-1', operation_id: 'OP-1', original_name: 'private.bin',
        content_type: 'application/octet-stream', kind: 'attachment', size: body.length,
        sha256: createHash('sha256').update(body).digest('hex'), stored_name: storedName,
        claimed_task_id: null,
      }],
    });
    const plan = buildPlan(source);
    const backup = join(root, 'backup.sqlite');
    await createVerifiedBackup({ fixtureRoot: root, source, backup, plan, uploadRoot });
    assert.throws(() => verifyExistingBackup({
      fixtureRoot: root,
      source,
      backup,
      plan,
      uploadRoot,
      duringVerification: () => {
        const replacement = join(uploadRoot, 'replacement.bin');
        writeFileSync(replacement, body, { mode: 0o600 });
        renameSync(replacement, uploadPath);
      },
    }), error => error.code === 'UPLOAD_MANIFEST_MISMATCH');
  }));
});

test('tampered or corrupt backup fails closed before restore', async t => {
  await t.test('artifact digest tamper', async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    const backup = join(root, 'backup.sqlite');
    const receipt = await createVerifiedBackup({ fixtureRoot: root, source, backup, plan });
    appendFileSync(backup, Buffer.from('tamper'));
    assert.throws(() => restoreVerifiedBackup({
      fixtureRoot: root,
      source,
      backup,
      rollbackTarget: join(root, 'rollback.sqlite'),
      plan,
      backupReceipt: receipt,
    }), error => error.code === 'BACKUP_NOT_VERIFIED');
  }));

  await t.test('non-SQLite backup', async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    const backup = join(root, 'corrupt.sqlite');
    writeFileSync(backup, 'not a sqlite database', { mode: 0o600 });
    assert.throws(() => verifyExistingBackup({ fixtureRoot: root, source, backup, plan }), error => (
      error.code === 'BACKUP_EVIDENCE_MISMATCH'
    ));
  }));
});

test('read-only replay rejects sidecars beside completed recovery artifacts', async t => {
  await t.test('backup sidecar', async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    const backup = join(root, 'backup.sqlite');
    await createVerifiedBackup({ fixtureRoot: root, source, backup, plan });
    writeFileSync(`${backup}-wal`, 'orphan');
    assert.throws(
      () => verifyExistingBackup({ fixtureRoot: root, source, backup, plan }),
      error => error.code === 'BACKUP_NOT_VERIFIED',
    );
  }));

  await t.test('rollback sidecar', async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    const backup = join(root, 'backup.sqlite');
    const rollbackTarget = join(root, 'rollback.sqlite');
    const receipt = await createVerifiedBackup({ fixtureRoot: root, source, backup, plan });
    restoreVerifiedBackup({
      fixtureRoot: root,
      source,
      backup,
      rollbackTarget,
      plan,
      backupReceipt: receipt,
    });
    writeFileSync(`${rollbackTarget}-journal`, 'orphan');
    assert.throws(() => verifyExistingRestore({
      fixtureRoot: root,
      source,
      backup,
      rollbackTarget,
      plan,
      backupReceipt: receipt,
    }), error => error.code === 'ROLLBACK_NOT_VERIFIED');
  }));
});

test('restore failure preserves the exclusive partial artifact and retry refuses it', async () => {
  await withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    const backup = join(root, 'backup.sqlite');
    const rollbackTarget = join(root, 'rollback.sqlite');
    const receipt = await createVerifiedBackup({ fixtureRoot: root, source, backup, plan });
    const sourceHash = hashFile(source);
    const backupHash = hashFile(backup);
    assert.throws(() => restoreVerifiedBackup({
      fixtureRoot: root,
      source,
      backup,
      rollbackTarget,
      plan,
      backupReceipt: receipt,
      duringCopy: () => { throw new Error('injected copy failure'); },
    }), error => error.code === 'ROLLBACK_RESTORE_FAILED');
    assert.equal(existsSync(rollbackTarget), true);
    assert.equal(hashFile(source), sourceHash);
    assert.equal(hashFile(backup), backupHash);
    assert.throws(() => restoreVerifiedBackup({
      fixtureRoot: root,
      source,
      backup,
      rollbackTarget,
      plan,
      backupReceipt: receipt,
    }), error => error.code === 'DESTINATION_EXISTS');
  });
});

test('restore detects post-copy tampering and keeps the failed artifact', async () => {
  await withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    const backup = join(root, 'backup.sqlite');
    const rollbackTarget = join(root, 'rollback.sqlite');
    const receipt = await createVerifiedBackup({ fixtureRoot: root, source, backup, plan });
    assert.throws(() => restoreVerifiedBackup({
      fixtureRoot: root,
      source,
      backup,
      rollbackTarget,
      plan,
      backupReceipt: receipt,
      afterCopy: path => appendFileSync(path, Buffer.from('tamper')),
    }), error => error.code === 'ROLLBACK_EVIDENCE_MISMATCH');
    assert.equal(existsSync(rollbackTarget), true);
  });
});

test('fixture root gate rejects wrong prefix, permissive mode, and paths outside the root', async () => {
  const wrong = mkdtempSync(join(tmpdir(), 'wrong-migration-root-'));
  try {
    chmodSync(wrong, 0o700);
    const source = createSource(wrong);
    const plan = buildPlan(source);
    await assert.rejects(
      createVerifiedBackup({ fixtureRoot: wrong, source, backup: join(wrong, 'backup.sqlite'), plan }),
      error => error.code === 'UNSAFE_DESTINATION',
    );
  } finally {
    rmSync(wrong, { recursive: true, force: true });
  }

  if (!IS_WINDOWS) {
    await withFixtureRoot(async root => {
      const source = createSource(root);
      const plan = buildPlan(source);
      chmodSync(root, 0o755);
      await assert.rejects(
        createVerifiedBackup({ fixtureRoot: root, source, backup: join(root, 'backup.sqlite'), plan }),
        error => error.code === 'UNSAFE_DESTINATION',
      );
    });
  }

  await withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    await assert.rejects(
      createVerifiedBackup({
        fixtureRoot: root,
        source,
        backup: join(tmpdir(), 'outside-backup.sqlite'),
        plan,
      }),
      error => error.code === 'UNSAFE_DESTINATION',
    );
  });
});
