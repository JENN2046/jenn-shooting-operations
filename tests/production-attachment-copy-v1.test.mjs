import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  copyAndVerifyAttachments,
  copyAttachmentsAndEvaluateParityTestCandidate,
  createAttachmentParityIsolatedTestAuthority,
  describeAttachmentParityScope,
  evaluateAttachmentDatabaseParityCandidate,
  verifyAttachmentDatabaseParity,
} from '../src/production-attachment-copy-v1.mjs';
import {
  captureSqlitePhysicalFamily,
  resolveExistingPath,
  sameSqlitePhysicalFamily,
  sqlitePhysicalFamiliesAreDisjoint,
} from '../src/migration-sqlite-v2.mjs';
import { V1_SCHEMA_SQL } from '../src/sqlite-schema-v2.mjs';
import { sha256Digest } from '../src/migration-v2.mjs';
import { filesystemPathComparisonKey } from '../src/platform-filesystem.mjs';
import {
  parseAttachmentCopyArgs,
  runAttachmentCopyCommand,
} from '../scripts/copy-production-attachments.mjs';

const CREATED_AT = '2026-09-26T00:00:00.000Z';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function uploadFact({
  id,
  operationId = 'OPERATION-0001',
  body,
  originalName = 'fixture.bin',
  claimedTaskId = null,
  storedName,
} = {}) {
  const digest = sha256(body);
  return {
    id,
    operation_id: operationId,
    original_name: originalName,
    content_type: 'application/octet-stream',
    kind: 'attachment',
    size: body.length,
    sha256: digest,
    stored_name: storedName ?? `${digest}.bin`,
    claimed_task_id: claimedTaskId,
    created_at: CREATED_AT,
  };
}

function createDatabase(path, uploads = []) {
  const db = new DatabaseSync(path);
  try {
    db.exec(V1_SCHEMA_SQL);
    const snapshot = {
      schemaVersion: 1,
      revision: 0,
      updatedAt: CREATED_AT,
      products: [],
      tasks: [],
      sessions: [],
    };
    db.prepare(`
      INSERT INTO schedule_state (id, revision, updated_at, snapshot_json)
      VALUES (1, 0, ?, ?)
    `).run(CREATED_AT, JSON.stringify(snapshot));
    const insert = db.prepare(`
      INSERT INTO uploads (
        id, operation_id, original_name, content_type, kind, size, sha256,
        stored_name, claimed_task_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of uploads) {
      insert.run(
        row.id,
        row.operation_id,
        row.original_name,
        row.content_type,
        row.kind,
        row.size,
        row.sha256,
        row.stored_name,
        row.claimed_task_id,
        row.created_at,
      );
    }
  } finally {
    db.close();
  }
}

function createFixture(uploads) {
  const testAuthority = createAttachmentParityIsolatedTestAuthority();
  const root = testAuthority.root;
  const sourceDatabasePath = join(root, 'source.sqlite');
  const targetDatabasePath = join(root, 'target.sqlite');
  const sourceUploadRoot = join(root, 'source-uploads');
  const targetUploadRoot = join(root, 'target-uploads');
  try {
    mkdirSync(sourceUploadRoot, { mode: 0o700 });
    mkdirSync(targetUploadRoot, { mode: 0o700 });
    createDatabase(sourceDatabasePath, uploads);
    createDatabase(targetDatabasePath, uploads);
    return {
      root,
      sourceDatabasePath,
      targetDatabasePath,
      sourceUploadRoot,
      targetUploadRoot,
      testAuthority,
      cleanup() {
        testAuthority.close();
      },
    };
  } catch (error) {
    testAuthority.close();
    throw error;
  }
}

function writeSourceFiles(fixture, rows, bodiesByName) {
  for (const row of rows) {
    if (row.stored_name === null || existsSync(join(fixture.sourceUploadRoot, row.stored_name))) continue;
    const body = bodiesByName.get(row.stored_name);
    assert.ok(body, row.stored_name);
    writeFileSync(join(fixture.sourceUploadRoot, row.stored_name), body, { mode: 0o600 });
  }
}

function parityPaths(fixture, extra = {}) {
  return {
    sourceDatabasePath: fixture.sourceDatabasePath,
    sourceUploadRoot: fixture.sourceUploadRoot,
    targetDatabasePath: fixture.targetDatabasePath,
    targetUploadRoot: fixture.targetUploadRoot,
    ...extra,
  };
}

function copyOptions(fixture, extra = {}) {
  const {
    quiescenceCapability,
    heldState,
    ...optionOverrides
  } = extra;
  const options = parityPaths(fixture, optionOverrides);
  return {
    ...options,
    quiescenceCapability: quiescenceCapability ?? fixture.testAuthority.mint({
      ...options,
      heldState,
    }),
  };
}

test('production copy wrapper delegates to the private mutator without test-only fault injection', () => {
  const source = copyAndVerifyAttachments.toString();
  assert.match(source, /copyAttachmentsAndEvaluateParityInternal/u);
  assert.doesNotMatch(source, /copyAttachmentsAndEvaluateParityCandidate/u);
  assert.doesNotMatch(source, /faultInjector/u);
});

test('production receipt APIs reject caller-forged quiescence capabilities even with the exact scope digest', () => {
  const body = Buffer.from('forged-provider-capability');
  const row = uploadFact({ id: 'UPLOAD-FORGED-PROVIDER', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    const paths = parityPaths(fixture);
    const scope = describeAttachmentParityScope(paths);
    const forged = {
      kind: 'ATTACHMENT_PARITY_QUIESCENCE_V1',
      scopeDigest: scope.scopeDigest,
      assertHeld: () => true,
    };

    assert.throws(
      () => copyAndVerifyAttachments({
        ...paths,
        quiescenceCapability: forged,
      }),
      error => error.code === 'ATTACHMENT_PARITY_PROVIDER_AUTH_REQUIRED',
    );
    assert.equal(existsSync(join(fixture.targetUploadRoot, row.stored_name)), false);

    assert.throws(
      () => verifyAttachmentDatabaseParity({
        ...paths,
        quiescenceCapability: forged,
      }),
      error => error.code === 'ATTACHMENT_PARITY_PROVIDER_AUTH_REQUIRED',
    );
  } finally {
    fixture.cleanup();
  }
});

test('sandbox holders cannot reuse cap.constructor to mint LIVE_PROVIDER authority', () => {
  const body = Buffer.from('constructor-mint-bypass');
  const row = uploadFact({ id: 'UPLOAD-CONSTRUCTOR-BYPASS', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    const paths = parityPaths(fixture);
    const testCapability = fixture.testAuthority.mint(paths);
    const scope = describeAttachmentParityScope(paths);

    assert.throws(
      () => new testCapability.constructor({
        scopeDigest: scope.scopeDigest,
        authorityClass: 'LIVE_PROVIDER',
        assertHeld: () => true,
      }),
      error => error.code === 'ATTACHMENT_PARITY_PROVIDER_AUTH_REQUIRED',
    );

    assert.equal(existsSync(join(fixture.targetUploadRoot, row.stored_name)), false);
  } finally {
    fixture.cleanup();
  }
});

test('sandbox capability cannot monkeypatch the private capability class authentication logic', () => {
  const body = Buffer.from('frozen-capability-class');
  const row = uploadFact({ id: 'UPLOAD-FROZEN-CAPABILITY', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    const paths = parityPaths(fixture);
    const testCapability = fixture.testAuthority.mint(paths);
    const Capability = testCapability.constructor;

    assert.equal(Object.isFrozen(Capability), true);
    assert.equal(Object.isFrozen(Capability.prototype), true);
    assert.throws(
      () => {
        Capability.inspect = () => ({ scopeDigest: 'forged', authorityClass: 'LIVE_PROVIDER' });
      },
      TypeError,
    );

    assert.throws(
      () => copyAndVerifyAttachments({
        ...paths,
        quiescenceCapability: testCapability,
      }),
      error => error.code === 'ATTACHMENT_PARITY_PROVIDER_AUTH_REQUIRED',
    );
    assert.equal(existsSync(join(fixture.targetUploadRoot, row.stored_name)), false);
  } finally {
    fixture.cleanup();
  }
});

test('production capability authentication ignores WeakSet prototype monkeypatching', () => {
  const body = Buffer.from('weakset-monkeypatch');
  const row = uploadFact({ id: 'UPLOAD-WEAKSET-MONKEYPATCH', body });
  const fixture = createFixture([row]);
  const originalHas = WeakSet.prototype.has;
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    const paths = parityPaths(fixture);
    const forged = {
      kind: 'ATTACHMENT_PARITY_QUIESCENCE_V1',
      scopeDigest: describeAttachmentParityScope(paths).scopeDigest,
      assertHeld: () => true,
    };

    WeakSet.prototype.has = () => true;

    assert.throws(
      () => copyAndVerifyAttachments({
        ...paths,
        quiescenceCapability: forged,
      }),
      error => error.code === 'ATTACHMENT_PARITY_PROVIDER_AUTH_REQUIRED',
    );
    assert.equal(existsSync(join(fixture.targetUploadRoot, row.stored_name)), false);
  } finally {
    WeakSet.prototype.has = originalHas;
    fixture.cleanup();
  }
});

test('sandbox containment does not depend on mutable String prototype methods', () => {
  const body = Buffer.from('prototype-containment');
  const row = uploadFact({ id: 'UPLOAD-PROTOTYPE-CONTAINMENT', body });
  const fixtureA = createFixture([row]);
  const fixtureB = createFixture([row]);
  const originalStartsWith = String.prototype.startsWith;
  try {
    String.prototype.startsWith = () => false;
    assert.throws(
      () => fixtureA.testAuthority.mint(parityPaths(fixtureB)),
      error => error.code === 'ATTACHMENT_PARITY_TEST_SCOPE_INVALID',
    );
  } finally {
    String.prototype.startsWith = originalStartsWith;
    fixtureA.cleanup();
    fixtureB.cleanup();
  }
});

test('isolated test authority cannot mint a mutating capability for another sandbox', () => {
  const body = Buffer.from('test-authority-scope');
  const row = uploadFact({ id: 'UPLOAD-TEST-AUTHORITY-SCOPE', body });
  const fixtureA = createFixture([row]);
  const fixtureB = createFixture([row]);
  try {
    assert.throws(
      () => fixtureA.testAuthority.mint(parityPaths(fixtureB)),
      error => error.code === 'ATTACHMENT_PARITY_TEST_SCOPE_INVALID',
    );
  } finally {
    fixtureA.cleanup();
    fixtureB.cleanup();
  }
});

test('copy and verify refuse to issue receipts without an exact-scope quiescence lease', () => {
  const body = Buffer.from('quiescence-required');
  const row = uploadFact({ id: 'UPLOAD-QUIESCENCE-REQUIRED', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    const paths = parityPaths(fixture);

    assert.throws(
      () => copyAttachmentsAndEvaluateParityTestCandidate(paths),
      error => error.code === 'ATTACHMENT_PARITY_TEST_AUTH_REQUIRED',
    );
    assert.equal(existsSync(join(fixture.targetUploadRoot, row.stored_name)), false);

    assert.throws(
      () => evaluateAttachmentDatabaseParityCandidate(paths),
      error => error.code === 'ATTACHMENT_PARITY_QUIESCENCE_REQUIRED',
    );
  } finally {
    fixture.cleanup();
  }
});

test('quiescence lease is bound to exact database and upload-root identities', () => {
  const body = Buffer.from('quiescence-scope');
  const row = uploadFact({ id: 'UPLOAD-QUIESCENCE-SCOPE', body });
  const fixtureA = createFixture([row]);
  const fixtureB = createFixture([row]);
  try {
    writeSourceFiles(fixtureA, [row], new Map([[row.stored_name, body]]));
    writeSourceFiles(fixtureB, [row], new Map([[row.stored_name, body]]));

    const leaseA = fixtureA.testAuthority.mint(parityPaths(fixtureA));
    assert.throws(
      () => copyAttachmentsAndEvaluateParityTestCandidate({
        ...parityPaths(fixtureB),
        quiescenceCapability: leaseA,
      }),
      error => error.code === 'ATTACHMENT_PARITY_TEST_AUTH_REQUIRED',
    );
    assert.equal(existsSync(join(fixtureB.targetUploadRoot, row.stored_name)), false);
  } finally {
    fixtureA.cleanup();
    fixtureB.cleanup();
  }
});

test('verified attachment copy binds target bytes to matching source/target database facts and replays read-only', () => {
  const bodyA = Buffer.from('attachment-copy-a');
  const bodyB = Buffer.from('attachment-copy-b');
  const rows = [
    uploadFact({ id: 'UPLOAD-A', body: bodyA }),
    uploadFact({ id: 'UPLOAD-B', body: bodyB }),
  ];
  const fixture = createFixture(rows);
  try {
    writeSourceFiles(
      fixture,
      rows,
      new Map(rows.map((row, index) => [row.stored_name, index === 0 ? bodyA : bodyB])),
    );

    const sourceBefore = new Map(rows.map(row => [
      row.stored_name,
      {
        bytes: readFileSync(join(fixture.sourceUploadRoot, row.stored_name)),
        stat: statSync(join(fixture.sourceUploadRoot, row.stored_name), { bigint: true }),
      },
    ]));

    const first = copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture));
    assert.equal(first.status, 'ATTACHMENT_COPY_PARITY_CANDIDATE');
    assert.equal(first.copiedFiles, 2);
    assert.equal(first.reusedFiles, 0);
    assert.equal(first.uniqueFiles, 2);
    assert.equal(first.uploadRows, 2);
    assert.match(first.parityDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.match(first.candidateCopyDigest, /^sha256:[a-f0-9]{64}$/u);

    for (const row of rows) {
      assert.deepEqual(
        readFileSync(join(fixture.targetUploadRoot, row.stored_name)),
        readFileSync(join(fixture.sourceUploadRoot, row.stored_name)),
      );
    }

    const targetBeforeReplay = new Map(rows.map(row => [
      row.stored_name,
      statSync(join(fixture.targetUploadRoot, row.stored_name), { bigint: true }),
    ]));
    const replay = copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture));
    assert.equal(replay.status, 'ATTACHMENT_COPY_PARITY_CANDIDATE');
    assert.equal(replay.copiedFiles, 0);
    assert.equal(replay.reusedFiles, 2);
    assert.equal(replay.parityDigest, first.parityDigest);
    assert.equal(replay.candidateCopyDigest, first.candidateCopyDigest);

    for (const row of rows) {
      const sourceAfter = statSync(join(fixture.sourceUploadRoot, row.stored_name), { bigint: true });
      const sourceExpected = sourceBefore.get(row.stored_name);
      assert.deepEqual(readFileSync(join(fixture.sourceUploadRoot, row.stored_name)), sourceExpected.bytes);
      assert.equal(sourceAfter.ino, sourceExpected.stat.ino);
      const targetAfter = statSync(join(fixture.targetUploadRoot, row.stored_name), { bigint: true });
      assert.equal(targetAfter.ino, targetBeforeReplay.get(row.stored_name).ino);
      assert.equal(targetAfter.mtimeNs, targetBeforeReplay.get(row.stored_name).mtimeNs);
    }
  } finally {
    fixture.cleanup();
  }
});

test('duplicate database references to identical stored bytes copy once and remain parity-valid', () => {
  const body = Buffer.from('shared-attachment-bytes');
  const first = uploadFact({ id: 'UPLOAD-1', body, operationId: 'OPERATION-0001' });
  const second = uploadFact({
    id: 'UPLOAD-2',
    body,
    operationId: 'OPERATION-0002',
    storedName: first.stored_name,
  });
  const rows = [first, second];
  const fixture = createFixture(rows);
  try {
    writeSourceFiles(fixture, rows, new Map([[first.stored_name, body]]));
    const receipt = copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture));
    assert.equal(receipt.uploadRows, 2);
    assert.equal(receipt.uniqueFiles, 1);
    assert.equal(receipt.copiedFiles, 1);
    assert.equal(readdirFileCount(fixture.targetUploadRoot), 1);
  } finally {
    fixture.cleanup();
  }
});

function readdirFileCount(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile()).length;
}

test('filesystem root upload domains still detect descendants', () => {
  const body = Buffer.from('filesystem-root-domain');
  const row = uploadFact({ id: 'UPLOAD-FILESYSTEM-ROOT', body });
  const fixture = createFixture([row]);
  try {
    const filesystemRoot = parse(fixture.root).root;
    assert.throws(
      () => describeAttachmentParityScope({
        ...parityPaths(fixture),
        sourceUploadRoot: filesystemRoot,
      }),
      error => ['SOURCE_TARGET_UPLOAD_ROOT_CONFLICT', 'DATABASE_UPLOAD_ROOT_CONFLICT']
        .includes(error.code),
    );
  } finally {
    fixture.cleanup();
  }
});

test('source and target upload roots cannot overlap by ancestry', () => {
  const body = Buffer.from('nested-root');
  const row = uploadFact({ id: 'UPLOAD-NESTED-ROOT', body });
  const fixture = createFixture([row]);
  const nestedTarget = join(fixture.sourceUploadRoot, 'nested-target');
  mkdirSync(nestedTarget, { mode: 0o700 });
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    assert.throws(
      () => copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture, {
        targetUploadRoot: nestedTarget,
      })),
      error => error.code === 'SOURCE_TARGET_UPLOAD_ROOT_CONFLICT',
    );
  } finally {
    fixture.cleanup();
  }
});

test('source attachment hardlinks are rejected before target mutation', () => {
  const body = Buffer.from('source-hardlink');
  const row = uploadFact({ id: 'UPLOAD-SOURCE-HARDLINK', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    linkSync(
      join(fixture.sourceUploadRoot, row.stored_name),
      join(fixture.root, 'source-hardlink-alias.bin'),
    );
    assert.throws(
      () => copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture)),
      error => error.code === 'SOURCE_ATTACHMENT_MISMATCH',
    );
    assert.equal(existsSync(join(fixture.targetUploadRoot, row.stored_name)), false);
  } finally {
    fixture.cleanup();
  }
});

test('target attachment hardlinks are rejected as conflicts', () => {
  const body = Buffer.from('target-hardlink');
  const row = uploadFact({ id: 'UPLOAD-TARGET-HARDLINK', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    const targetPath = join(fixture.targetUploadRoot, row.stored_name);
    writeFileSync(targetPath, body, { mode: 0o600 });
    linkSync(targetPath, join(fixture.root, 'target-hardlink-alias.bin'));
    assert.throws(
      () => copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture)),
      error => error.code === 'TARGET_ATTACHMENT_CONFLICT',
    );
  } finally {
    fixture.cleanup();
  }
});

test('target creation stays bound to the validated root inode across pathname replacement', () => {
  const body = Buffer.from('root-descriptor-binding');
  const row = uploadFact({ id: 'UPLOAD-ROOT-DESCRIPTOR', body });
  const fixture = createFixture([row]);
  const displacedRoot = join(fixture.root, 'target-uploads-displaced');
  const outsideRoot = mkdtempSync(join(tmpdir(), 'jenn-outside-target-'));
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    const outsidePath = join(outsideRoot, row.stored_name);

    assert.throws(
      () => copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture, {
        faultInjector(stage) {
          if (stage !== 'before_target_create') return;
          renameSync(fixture.targetUploadRoot, displacedRoot);
          symlinkSync(outsideRoot, fixture.targetUploadRoot, 'dir');
        },
      })),
      error => ['TARGET_UPLOAD_ROOT_CHANGED', 'TARGET_ATTACHMENT_COPY_FAILED']
        .includes(error.code),
    );

    assert.equal(
      existsSync(outsidePath),
      false,
      'descriptor-bound create must never escape to replacement parent',
    );
  } finally {
    fixture.cleanup();
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('pre-existing target orphans fail before missing referenced files are copied', () => {
  const body = Buffer.from('pre-copy-orphan');
  const row = uploadFact({ id: 'UPLOAD-PRE-COPY-ORPHAN', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    writeFileSync(
      join(fixture.targetUploadRoot, `${'b'.repeat(64)}.bin`),
      Buffer.from('orphan-before-copy'),
      { mode: 0o600 },
    );
    assert.throws(
      () => copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture)),
      error => error.code === 'TARGET_ATTACHMENT_ORPHAN',
    );
    assert.equal(existsSync(join(fixture.targetUploadRoot, row.stored_name)), false);
  } finally {
    fixture.cleanup();
  }
});

test('final parity stays bound to the originally acknowledged target upload-root inode', () => {
  const body = Buffer.from('root-identity');
  const row = uploadFact({ id: 'UPLOAD-ROOT-IDENTITY', body });
  const fixture = createFixture([row]);
  const displacedRoot = join(fixture.root, 'target-uploads-original');
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    assert.throws(
      () => copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture, {
        faultInjector(stage) {
          if (stage !== 'before_final_parity') return;
          renameSync(fixture.targetUploadRoot, displacedRoot);
          mkdirSync(fixture.targetUploadRoot, { mode: 0o700 });
          writeFileSync(
            join(fixture.targetUploadRoot, row.stored_name),
            body,
            { mode: 0o600 },
          );
        },
      })),
      error => error.code === 'TARGET_UPLOAD_ROOT_CHANGED',
    );
  } finally {
    fixture.cleanup();
  }
});

test('SQLite upload-fact queries deserialize verified bytes into memory without a writable snapshot file', () => {
  const moduleSource = readFileSync(
    new URL('../src/production-attachment-copy-v1.mjs', import.meta.url),
    'utf8',
  );
  const captureStart = moduleSource.indexOf('function readCapturedDatabaseBytes(');
  const normalizedStart = moduleSource.indexOf('function normalizedUniqueFiles(', captureStart);
  assert.notEqual(captureStart, -1);
  assert.notEqual(normalizedStart, -1);

  const factReadSource = moduleSource.slice(captureStart, normalizedStart);
  assert.match(factReadSource, /new DatabaseSync\(':memory:'\)/u);
  assert.match(factReadSource, /db\.deserialize\(snapshot\.bytes\)/u);
  assert.doesNotMatch(factReadSource, /new DatabaseSync\(databaseInfo\.realPath/u);
  assert.doesNotMatch(factReadSource, /jenn-sqlite-facts-/u);
  assert.doesNotMatch(factReadSource, /snapshotRoot/u);
  assert.doesNotMatch(factReadSource, /rmSync\(/u);
});

test('upload-fact reads reject an active SQLite sidecar family before target mutation', () => {
  const body = Buffer.from('sidecar-free-fact-read');
  const row = uploadFact({ id: 'UPLOAD-SIDECAR-BLOCK', body });
  const fixture = createFixture([row]);
  let writer;

  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    writer = new DatabaseSync(fixture.sourceDatabasePath);
    writer.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;');
    writer.prepare('UPDATE uploads SET original_name = ? WHERE id = ?')
      .run('sidecar-active.bin', row.id);

    assert.equal(
      existsSync(fixture.sourceDatabasePath + '-wal')
        || existsSync(fixture.sourceDatabasePath + '-shm'),
      true,
      'test must hold an active SQLite sidecar family',
    );

    assert.throws(
      () => copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture)),
      error => error.code === 'SOURCE_UPLOAD_DATABASE_INVALID'
        && error.result === 'BLOCKED_PREREQUISITE',
    );

    assert.equal(
      existsSync(join(fixture.targetUploadRoot, row.stored_name)),
      false,
      'sidecar-bearing fact read must fail before target attachment mutation',
    );
  } finally {
    try { writer?.close(); } catch {}
    fixture.cleanup();
  }
});

test('there is no filesystem snapshot for a same-UID process to rewrite during SQLite query', () => {
  const body = Buffer.from('memory-deserialize-snapshot');
  const row = uploadFact({ id: 'UPLOAD-MEMORY-SNAPSHOT', body });
  const fixture = createFixture([row]);
  let hookObserved = false;

  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));

    const receipt = copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture, {
      faultInjector(stage, details) {
        if (stage !== 'before_source_snapshot_sqlite_open') return;
        hookObserved = true;
        assert.deepEqual(details, { storage: 'memory' });
      },
    }));

    assert.equal(hookObserved, true);
    assert.equal(receipt.status, 'ATTACHMENT_COPY_PARITY_CANDIDATE');
    assert.deepEqual(
      readFileSync(join(fixture.targetUploadRoot, row.stored_name)),
      body,
    );
  } finally {
    fixture.cleanup();
  }
});

test('database pathname replacement after bound snapshot copy fails before target mutation', () => {
  const body = Buffer.from('inode-bound-snapshot');
  const row = uploadFact({ id: 'UPLOAD-INODE-SNAPSHOT', body });
  const fixture = createFixture([row]);
  const replacementPath = join(fixture.root, 'source-replacement.sqlite');
  const heldOriginalPath = join(fixture.root, 'source-original-held.sqlite');
  let swapped = false;

  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    createDatabase(replacementPath, [{
      ...row,
      original_name: 'unacknowledged-replacement.bin',
    }]);

    assert.throws(
      () => copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture, {
        faultInjector(stage) {
          if (stage !== 'after_source_database_snapshot_copy' || swapped) return;
          renameSync(fixture.sourceDatabasePath, heldOriginalPath);
          renameSync(replacementPath, fixture.sourceDatabasePath);
          swapped = true;
        },
      })),
      error => error.code === 'SOURCE_UPLOAD_DATABASE_INVALID',
    );

    assert.equal(
      existsSync(join(fixture.targetUploadRoot, row.stored_name)),
      false,
      'unacknowledged database facts must fail before attachment mutation',
    );
  } finally {
    if (swapped) {
      try { renameSync(fixture.sourceDatabasePath, replacementPath); } catch {}
      try { renameSync(heldOriginalPath, fixture.sourceDatabasePath); } catch {}
    }
    fixture.cleanup();
  }
});

test('database reads stay bound to the originally resolved target database inode', () => {
  const body = Buffer.from('db-path-replacement');
  const row = uploadFact({ id: 'UPLOAD-DB-PATH-REPLACE', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture));

    assert.throws(
      () => evaluateAttachmentDatabaseParityCandidate(copyOptions(fixture, {
        faultInjector(stage) {
          if (stage !== 'before_initial_database_read') return;
          const replacement = readFileSync(fixture.sourceDatabasePath);
          renameSync(
            fixture.targetDatabasePath,
            join(fixture.root, 'target-original.sqlite'),
          );
          writeFileSync(fixture.targetDatabasePath, replacement, { mode: 0o600 });
        },
      })),
      error => error.code === 'TARGET_UPLOAD_DATABASE_INVALID',
    );
  } finally {
    fixture.cleanup();
  }
});

test('filesystem namespace folding ignores later String case and normalization monkeypatching', () => {
  const originalLower = String.prototype.toLowerCase;
  const originalUpper = String.prototype.toUpperCase;
  const originalNormalize = String.prototype.normalize;
  try {
    String.prototype.toLowerCase = () => 'forged-lower';
    String.prototype.toUpperCase = () => 'FORGED-UPPER';
    String.prototype.normalize = () => 'forged-normalized';

    const sourceKey = filesystemPathComparisonKey(
      '/tmp/TARGÉT.sqlite-wal',
      '/tmp/TARGÉT.sqlite-wal',
      { caseInsensitive: true, canonicalEquivalent: true },
    );
    const targetKey = filesystemPathComparisonKey(
      '/tmp/targe\u0301t.sqlite-wal',
      '/tmp/target.sqlite',
      { caseInsensitive: true, canonicalEquivalent: true },
    );
    assert.equal(sourceKey, targetKey);
    assert.notEqual(sourceKey, 'forged-lower');
    assert.notEqual(sourceKey, 'forged-normalized');
  } finally {
    String.prototype.toLowerCase = originalLower;
    String.prototype.toUpperCase = originalUpper;
    String.prototype.normalize = originalNormalize;
  }
});

test('filesystem-aware namespace keys fold case when the filesystem is case-insensitive', () => {
  const sourceKey = sha256Digest(filesystemPathComparisonKey(
    '/tmp/TARGET.sqlite-wal',
    '/tmp/TARGET.sqlite-wal',
    { caseInsensitive: true },
  ));
  const targetWalKey = sha256Digest(filesystemPathComparisonKey(
    '/tmp/target.sqlite-wal',
    '/tmp/target.sqlite',
    { caseInsensitive: true },
  ));

  assert.equal(sourceKey, targetWalKey);
  assert.equal(
    sqlitePhysicalFamiliesAreDisjoint(
      { namespace: { database: sourceKey } },
      { namespace: { wal: targetWalKey } },
    ),
    false,
  );
});

test('filesystem-aware namespace keys fold NFC and NFD on canonical-equivalent filesystems', () => {
  const sourceKey = sha256Digest(filesystemPathComparisonKey(
    '/tmp/café.sqlite-wal',
    '/tmp/café.sqlite-wal',
    { caseInsensitive: true, canonicalEquivalent: true },
  ));
  const targetWalKey = sha256Digest(filesystemPathComparisonKey(
    '/tmp/cafe\u0301.sqlite-wal',
    '/tmp/cafe\u0301.sqlite',
    { caseInsensitive: true, canonicalEquivalent: true },
  ));

  assert.equal(sourceKey, targetWalKey);
  assert.equal(
    sqlitePhysicalFamiliesAreDisjoint(
      { namespace: { database: sourceKey } },
      { namespace: { wal: targetWalKey } },
    ),
    false,
  );
});

test('SQLite family disjointness rejects cross-role future sidecar path collisions', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-sqlite-family-namespace-'));
  const targetPath = join(root, 'target.sqlite');
  const sourcePath = targetPath + '-wal';

  try {
    writeFileSync(sourcePath, Buffer.from('source-db-at-target-wal-path'), { mode: 0o600 });
    writeFileSync(targetPath, Buffer.from('target-db'), { mode: 0o600 });

    const sourceInfo = resolveExistingPath(sourcePath, 'file');
    const targetInfo = resolveExistingPath(targetPath, 'file');
    const sourceFamily = captureSqlitePhysicalFamily(sourceInfo, {
      includeDatabaseDigest: true,
      requireSingleLink: true,
    });
    const targetFamily = captureSqlitePhysicalFamily(targetInfo, {
      includeDatabaseDigest: true,
      requireSingleLink: true,
    });

    assert.equal(
      sqlitePhysicalFamiliesAreDisjoint(sourceFamily, targetFamily),
      false,
      'source database path must collide with target future WAL namespace',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SQLite family sidecars must be single-link and source/target families disjoint', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-sqlite-family-alias-'));
  const sourcePath = join(root, 'source.sqlite');
  const targetPath = join(root, 'target.sqlite');
  const sourceWal = sourcePath + '-wal';
  const targetWal = targetPath + '-wal';

  try {
    writeFileSync(sourcePath, Buffer.from('source-db'), { mode: 0o600 });
    writeFileSync(targetPath, Buffer.from('target-db'), { mode: 0o600 });
    writeFileSync(sourceWal, Buffer.from('shared-wal-state'), { mode: 0o600 });
    linkSync(sourceWal, targetWal);

    const sourceInfo = resolveExistingPath(sourcePath, 'file');
    const targetInfo = resolveExistingPath(targetPath, 'file');

    assert.throws(
      () => captureSqlitePhysicalFamily(sourceInfo, {
        includeDatabaseDigest: true,
        requireSingleLink: true,
      }),
      error => error.code === 'SOURCE_CHANGED_DURING_SCAN',
    );

    const sourceFamily = captureSqlitePhysicalFamily(sourceInfo, {
      includeDatabaseDigest: true,
    });
    const targetFamily = captureSqlitePhysicalFamily(targetInfo, {
      includeDatabaseDigest: true,
    });
    assert.equal(sqlitePhysicalFamiliesAreDisjoint(sourceFamily, targetFamily), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('strong SQLite physical-family proof includes database content digest and detects writes', () => {
  const body = Buffer.from('strong-family-write');
  const row = uploadFact({ id: 'UPLOAD-STRONG-FAMILY', body });
  const fixture = createFixture([row]);
  try {
    const targetInfo = resolveExistingPath(fixture.targetDatabasePath, 'file');
    const before = captureSqlitePhysicalFamily(
      targetInfo,
      { includeDatabaseDigest: true },
    );
    assert.match(before.database.digest, /^sha256:[a-f0-9]{64}$/u);

    const target = new DatabaseSync(fixture.targetDatabasePath);
    try {
      target.prepare('UPDATE uploads SET original_name = ? WHERE id = ?')
        .run('strong-family-changed.bin', row.id);
    } finally {
      target.close();
    }

    const after = captureSqlitePhysicalFamily(
      targetInfo,
      { includeDatabaseDigest: true },
    );
    assert.equal(sameSqlitePhysicalFamily(before, after), false);
  } finally {
    fixture.cleanup();
  }
});

test('quiescence loss between the two closing family captures blocks the receipt', () => {
  const body = Buffer.from('between-family-quiescence-loss');
  const row = uploadFact({ id: 'UPLOAD-BETWEEN-FAMILY-LEASE', body });
  const fixture = createFixture([row]);
  const state = { held: true };
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture, { heldState: state }));

    state.held = true;
    assert.throws(
      () => evaluateAttachmentDatabaseParityCandidate(copyOptions(fixture, {
        heldState: state,
        faultInjector(stage) {
          if (stage === 'between_final_family_captures') state.held = false;
        },
      })),
      error => error.code === 'ATTACHMENT_PARITY_QUIESCENCE_LOST',
    );
  } finally {
    fixture.cleanup();
  }
});

test('WAL write immediately before final family capture invalidates parity', () => {
  const body = Buffer.from('final-family-wal-write');
  const row = uploadFact({ id: 'UPLOAD-FINAL-FAMILY-WAL', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture));

    assert.throws(
      () => evaluateAttachmentDatabaseParityCandidate(copyOptions(fixture, {
        faultInjector(stage) {
          if (stage !== 'before_final_family_compare') return;
          const target = new DatabaseSync(fixture.targetDatabasePath);
          try {
            target.exec('PRAGMA journal_mode = WAL;');
            target.prepare('UPDATE uploads SET original_name = ? WHERE id = ?')
              .run('changed-at-final-family.bin', row.id);
          } finally {
            target.close();
          }
        },
      })),
      error => error.code === 'TARGET_UPLOAD_DATABASE_CHANGED_DURING_PARITY',
    );
  } finally {
    fixture.cleanup();
  }
});

test('database writes during the final filesystem pass invalidate the physical-family proof', () => {
  const body = Buffer.from('final-window-db-write');
  const row = uploadFact({ id: 'UPLOAD-FINAL-WINDOW-DB', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture));

    assert.throws(
      () => evaluateAttachmentDatabaseParityCandidate(copyOptions(fixture, {
        faultInjector(stage) {
          if (stage !== 'after_final_database_recheck') return;
          const target = new DatabaseSync(fixture.targetDatabasePath);
          try {
            target.prepare('UPDATE uploads SET original_name = ? WHERE id = ?')
              .run('changed-inside-final-window.bin', row.id);
          } finally {
            target.close();
          }
        },
      })),
      error => error.code === 'TARGET_UPLOAD_DATABASE_CHANGED_DURING_PARITY',
    );
  } finally {
    fixture.cleanup();
  }
});

test('filesystem drift after the final database recheck still blocks parity receipt', () => {
  const body = Buffer.from('post-db-byte-drift');
  const row = uploadFact({ id: 'UPLOAD-POST-DB-DRIFT', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture));

    const wrong = Buffer.from('X'.repeat(body.length));
    assert.equal(wrong.length, body.length);
    assert.throws(
      () => evaluateAttachmentDatabaseParityCandidate(copyOptions(fixture, {
        faultInjector(stage) {
          if (stage === 'after_final_database_recheck') {
            writeFileSync(
              join(fixture.targetUploadRoot, row.stored_name),
              wrong,
              { mode: 0o600 },
            );
          }
        },
      })),
      error => error.code === 'TARGET_ATTACHMENT_MISMATCH',
    );
  } finally {
    fixture.cleanup();
  }
});

test('source and target attachment paths cannot be hard-link aliases of one inode', () => {
  const body = Buffer.from('cross-root-hardlink');
  const row = uploadFact({ id: 'UPLOAD-CROSS-HARDLINK', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    linkSync(
      join(fixture.sourceUploadRoot, row.stored_name),
      join(fixture.targetUploadRoot, row.stored_name),
    );
    assert.throws(
      () => evaluateAttachmentDatabaseParityCandidate(copyOptions(fixture)),
      error => ['SOURCE_ATTACHMENT_MISMATCH', 'TARGET_ATTACHMENT_MISMATCH', 'SOURCE_TARGET_ATTACHMENT_ALIAS']
        .includes(error.code),
    );
  } finally {
    fixture.cleanup();
  }
});

test('database fact mismatch fails before target bytes are copied', () => {
  const body = Buffer.from('db-mismatch');
  const row = uploadFact({ id: 'UPLOAD-DB-MISMATCH', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    const target = new DatabaseSync(fixture.targetDatabasePath);
    try {
      target.prepare('UPDATE uploads SET original_name = ? WHERE id = ?')
        .run('different.bin', row.id);
    } finally {
      target.close();
    }

    assert.throws(
      () => copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture)),
      error => error.code === 'UPLOAD_DATABASE_FACTS_MISMATCH',
    );
    assert.equal(existsSync(join(fixture.targetUploadRoot, row.stored_name)), false);
  } finally {
    fixture.cleanup();
  }
});

test('exact target bytes with permissive mode are rejected instead of reused', () => {
  const body = Buffer.from('target-mode');
  const row = uploadFact({ id: 'UPLOAD-TARGET-MODE', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    const targetPath = join(fixture.targetUploadRoot, row.stored_name);
    writeFileSync(targetPath, body, { mode: 0o600 });
    chmodSync(targetPath, 0o644);

    assert.throws(
      () => copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture)),
      error => error.code === 'TARGET_ATTACHMENT_CONFLICT',
    );
    assert.equal((statSync(targetPath).mode & 0o777), 0o644);
  } finally {
    fixture.cleanup();
  }
});

test('existing conflicting target bytes are never overwritten', () => {
  const body = Buffer.from('expected-target-bytes');
  const row = uploadFact({ id: 'UPLOAD-CONFLICT', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    const targetPath = join(fixture.targetUploadRoot, row.stored_name);
    writeFileSync(targetPath, Buffer.from('wrong-target-bytes'), { mode: 0o600 });
    const before = readFileSync(targetPath);

    assert.throws(
      () => copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture)),
      error => error.code === 'TARGET_ATTACHMENT_CONFLICT',
    );
    assert.deepEqual(readFileSync(targetPath), before);
  } finally {
    fixture.cleanup();
  }
});

test('target parity rejects unreferenced regular files', () => {
  const body = Buffer.from('referenced');
  const row = uploadFact({ id: 'UPLOAD-ORPHAN', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture));
    writeFileSync(
      join(fixture.targetUploadRoot, `${'a'.repeat(64)}.bin`),
      Buffer.from('orphan'),
      { mode: 0o600 },
    );

    assert.throws(
      () => evaluateAttachmentDatabaseParityCandidate(copyOptions(fixture)),
      error => error.code === 'TARGET_ATTACHMENT_ORPHAN',
    );
  } finally {
    fixture.cleanup();
  }
});

test('source drift after copy prevents a parity receipt', () => {
  const body = Buffer.from('source-drift');
  const row = uploadFact({ id: 'UPLOAD-SOURCE-DRIFT', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    assert.throws(
      () => copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture, {
        faultInjector(stage) {
          if (stage === 'after_file_copy') {
            unlinkSync(join(fixture.sourceUploadRoot, row.stored_name));
            writeFileSync(
              join(fixture.sourceUploadRoot, row.stored_name),
              Buffer.from('source-drift-replacement'),
              { mode: 0o600 },
            );
          }
        },
      })),
      error => error.code === 'SOURCE_ATTACHMENT_MISMATCH',
    );
  } finally {
    fixture.cleanup();
  }
});

test('target tamper before final parity prevents a receipt', () => {
  const body = Buffer.from('target-drift');
  const row = uploadFact({ id: 'UPLOAD-TARGET-DRIFT', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    assert.throws(
      () => copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture, {
        faultInjector(stage) {
          if (stage === 'before_final_parity') {
            writeFileSync(
              join(fixture.targetUploadRoot, row.stored_name),
              Buffer.from('target-drift-replacement'),
              { mode: 0o600 },
            );
          }
        },
      })),
      error => error.code === 'TARGET_ATTACHMENT_MISMATCH',
    );
  } finally {
    fixture.cleanup();
  }
});

test('database upload facts changing during final parity prevent a receipt', () => {
  const body = Buffer.from('database-drift');
  const row = uploadFact({ id: 'UPLOAD-DATABASE-DRIFT', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    assert.throws(
      () => copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture, {
        faultInjector(stage) {
          if (stage !== 'before_final_database_recheck') return;
          const target = new DatabaseSync(fixture.targetDatabasePath);
          try {
            target.prepare('UPDATE uploads SET original_name = ? WHERE id = ?')
              .run('changed-during-parity.bin', row.id);
          } finally {
            target.close();
          }
        },
      })),
      error => error.code === 'UPLOAD_DATABASE_FACTS_CHANGED_DURING_PARITY',
    );
  } finally {
    fixture.cleanup();
  }
});

test('rows without stored bytes require no target file but remain bound into database facts', () => {
  const row = {
    ...uploadFact({ id: 'UPLOAD-NO-FILE', body: Buffer.alloc(0) }),
    stored_name: null,
  };
  const fixture = createFixture([row]);
  try {
    const receipt = copyAttachmentsAndEvaluateParityTestCandidate(copyOptions(fixture));
    assert.equal(receipt.uploadRows, 1);
    assert.equal(receipt.uniqueFiles, 0);
    assert.equal(receipt.copiedFiles, 0);
    assert.equal(receipt.totalBytes, 0);
  } finally {
    fixture.cleanup();
  }
});


test('attachment copy command requires explicit isolated-target acknowledgement for apply', () => {
  assert.throws(
    () => parseAttachmentCopyArgs([
      '--apply',
      '--source-db', '/tmp/source.sqlite',
      '--source-upload-root', '/tmp/source-uploads',
      '--target-db', '/tmp/target.sqlite',
      '--target-upload-root', '/tmp/target-uploads',
    ]),
    error => error.code === 'ISOLATED_TARGET_ACK_REQUIRED',
  );
  assert.throws(
    () => parseAttachmentCopyArgs([
      '--verify-only',
      '--source-db', '/tmp/source.sqlite',
      '--source-upload-root', '/tmp/source-uploads',
      '--target-db', '/tmp/target.sqlite',
      '--target-upload-root', '/tmp/target-uploads',
      '--acknowledge-isolated-target',
    ]),
    error => error.code === 'APPLY_ARGUMENT_NOT_ALLOWED',
  );
});

test('attachment copy CLI preserves INVALID_USAGE exit code 3', () => {
  const scriptPath = fileURLToPath(
    new URL('../scripts/copy-production-attachments.mjs', import.meta.url),
  );
  const result = spawnSync(process.execPath, [scriptPath, '--apply'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 3);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, 'ATTACHMENT_COPY_FAILED');
  assert.equal(payload.result, 'INVALID_USAGE');
  assert.equal(payload.code, 'MISSING_REQUIRED_ARGUMENT');
});

test('attachment copy command cannot mint production authority from a caller-forged capability', () => {
  const body = Buffer.from('command-copy-fixture');
  const row = uploadFact({ id: 'UPLOAD-COMMAND', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    const common = [
      '--source-db', fixture.sourceDatabasePath,
      '--source-upload-root', fixture.sourceUploadRoot,
      '--target-db', fixture.targetDatabasePath,
      '--target-upload-root', fixture.targetUploadRoot,
      '--format', 'json',
    ];
    const scope = describeAttachmentParityScope(parityPaths(fixture));
    const forged = {
      kind: 'ATTACHMENT_PARITY_QUIESCENCE_V1',
      scopeDigest: scope.scopeDigest,
      assertHeld: () => true,
    };

    assert.throws(
      () => runAttachmentCopyCommand([
        '--apply',
        ...common,
        '--acknowledge-isolated-target',
      ]),
      error => error.code === 'ATTACHMENT_PARITY_PROVIDER_AUTH_REQUIRED',
    );

    assert.throws(
      () => runAttachmentCopyCommand([
        '--apply',
        ...common,
        '--acknowledge-isolated-target',
      ], { quiescenceCapability: forged }),
      error => error.code === 'ATTACHMENT_PARITY_PROVIDER_AUTH_REQUIRED',
    );

    assert.throws(
      () => runAttachmentCopyCommand(
        ['--verify-only', ...common],
        { quiescenceCapability: forged },
      ),
      error => error.code === 'ATTACHMENT_PARITY_PROVIDER_AUTH_REQUIRED',
    );
    assert.equal(existsSync(join(fixture.targetUploadRoot, row.stored_name)), false);
  } finally {
    fixture.cleanup();
  }
});
