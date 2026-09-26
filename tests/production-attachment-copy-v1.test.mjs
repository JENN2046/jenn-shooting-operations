import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  copyAndVerifyAttachments,
  verifyAttachmentDatabaseParity,
} from '../src/production-attachment-copy-v1.mjs';
import { V1_SCHEMA_SQL } from '../src/sqlite-schema-v2.mjs';

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
  const root = mkdtempSync(join(tmpdir(), 'jenn-attachment-copy-'));
  const sourceDatabasePath = join(root, 'source.sqlite');
  const targetDatabasePath = join(root, 'target.sqlite');
  const sourceUploadRoot = join(root, 'source-uploads');
  const targetUploadRoot = join(root, 'target-uploads');
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
  };
}

function writeSourceFiles(fixture, rows, bodiesByName) {
  for (const row of rows) {
    if (row.stored_name === null || existsSync(join(fixture.sourceUploadRoot, row.stored_name))) continue;
    const body = bodiesByName.get(row.stored_name);
    assert.ok(body, row.stored_name);
    writeFileSync(join(fixture.sourceUploadRoot, row.stored_name), body, { mode: 0o600 });
  }
}

function copyOptions(fixture, extra = {}) {
  return {
    sourceDatabasePath: fixture.sourceDatabasePath,
    sourceUploadRoot: fixture.sourceUploadRoot,
    targetDatabasePath: fixture.targetDatabasePath,
    targetUploadRoot: fixture.targetUploadRoot,
    ...extra,
  };
}

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

    const first = copyAndVerifyAttachments(copyOptions(fixture));
    assert.equal(first.status, 'ATTACHMENT_COPY_PARITY_VERIFIED');
    assert.equal(first.copiedFiles, 2);
    assert.equal(first.reusedFiles, 0);
    assert.equal(first.uniqueFiles, 2);
    assert.equal(first.uploadRows, 2);
    assert.match(first.parityDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.match(first.copyProofDigest, /^sha256:[a-f0-9]{64}$/u);

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
    const replay = copyAndVerifyAttachments(copyOptions(fixture));
    assert.equal(replay.status, 'ATTACHMENT_COPY_PARITY_VERIFIED');
    assert.equal(replay.copiedFiles, 0);
    assert.equal(replay.reusedFiles, 2);
    assert.equal(replay.parityDigest, first.parityDigest);
    assert.equal(replay.copyProofDigest, first.copyProofDigest);

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
    rmSync(fixture.root, { recursive: true, force: true });
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
    const receipt = copyAndVerifyAttachments(copyOptions(fixture));
    assert.equal(receipt.uploadRows, 2);
    assert.equal(receipt.uniqueFiles, 1);
    assert.equal(receipt.copiedFiles, 1);
    assert.equal(readdirFileCount(fixture.targetUploadRoot), 1);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function readdirFileCount(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile()).length;
}

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
      () => copyAndVerifyAttachments(copyOptions(fixture)),
      error => error.code === 'UPLOAD_DATABASE_FACTS_MISMATCH',
    );
    assert.equal(existsSync(join(fixture.targetUploadRoot, row.stored_name)), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
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
      () => copyAndVerifyAttachments(copyOptions(fixture)),
      error => error.code === 'TARGET_ATTACHMENT_CONFLICT',
    );
    assert.deepEqual(readFileSync(targetPath), before);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('target parity rejects unreferenced regular files', () => {
  const body = Buffer.from('referenced');
  const row = uploadFact({ id: 'UPLOAD-ORPHAN', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    copyAndVerifyAttachments(copyOptions(fixture));
    writeFileSync(
      join(fixture.targetUploadRoot, `${'a'.repeat(64)}.bin`),
      Buffer.from('orphan'),
      { mode: 0o600 },
    );

    assert.throws(
      () => verifyAttachmentDatabaseParity(copyOptions(fixture)),
      error => error.code === 'TARGET_ATTACHMENT_ORPHAN',
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('source drift after copy prevents a parity receipt', () => {
  const body = Buffer.from('source-drift');
  const row = uploadFact({ id: 'UPLOAD-SOURCE-DRIFT', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    assert.throws(
      () => copyAndVerifyAttachments(copyOptions(fixture, {
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
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('target tamper before final parity prevents a receipt', () => {
  const body = Buffer.from('target-drift');
  const row = uploadFact({ id: 'UPLOAD-TARGET-DRIFT', body });
  const fixture = createFixture([row]);
  try {
    writeSourceFiles(fixture, [row], new Map([[row.stored_name, body]]));
    assert.throws(
      () => copyAndVerifyAttachments(copyOptions(fixture, {
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
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rows without stored bytes require no target file but remain bound into database facts', () => {
  const row = {
    ...uploadFact({ id: 'UPLOAD-NO-FILE', body: Buffer.alloc(0) }),
    stored_name: null,
  };
  const fixture = createFixture([row]);
  try {
    const receipt = copyAndVerifyAttachments(copyOptions(fixture));
    assert.equal(receipt.uploadRows, 1);
    assert.equal(receipt.uniqueFiles, 0);
    assert.equal(receipt.copiedFiles, 0);
    assert.equal(receipt.totalBytes, 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
