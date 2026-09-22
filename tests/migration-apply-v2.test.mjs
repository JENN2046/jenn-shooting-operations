import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  existsSync,
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
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  applyIsolatedMigration,
  preflightIsolatedApplyPaths,
} from '../src/migration-apply-sqlite-v2.mjs';
import { buildMigrationPlan } from '../src/migration-v2.mjs';
import { readV1Source, resolveExistingPath } from '../src/migration-sqlite-v2.mjs';
import { V1_SCHEMA_SQL } from '../src/sqlite-schema-v2.mjs';

const STARTED_AT = '2026-09-22T12:00:00.000Z';
const COMPLETED_AT = '2026-09-22T12:00:01.000Z';
const VERIFIED_AT = '2026-09-22T12:00:02.000Z';

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
    for (const upload of uploads) insertUpload.run(
      upload.id, upload.operation_id, upload.original_name, upload.content_type,
      upload.kind, upload.size, upload.sha256, upload.stored_name,
      upload.claimed_task_id, upload.created_at ?? STARTED_AT,
    );
  } finally {
    db.close();
  }
  return source;
}

function buildPlan(source) {
  return buildMigrationPlan({
    source: readV1Source(resolveExistingPath(source)),
    businessTimeZone: 'UTC',
    importedAt: STARTED_AT,
  });
}

function paths(root) {
  return {
    fixtureRoot: root,
    source: join(root, 'source.sqlite'),
    backup: join(root, 'backup.sqlite'),
    rollbackTarget: join(root, 'rollback.sqlite'),
    target: join(root, 'target.sqlite'),
    proofSeal: join(root, 'proof-seal.json'),
  };
}

function options(root, plan, extra = {}) {
  return {
    ...paths(root),
    plan,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    clock: () => new Date(VERIFIED_AT),
    ...extra,
  };
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function artifactState(root) {
  const named = ['backup.sqlite', 'rollback.sqlite', 'target.sqlite', 'proof-seal.json'];
  return {
    entries: readdirSync(root).toSorted(),
    artifacts: Object.fromEntries(named.map(name => {
      const path = join(root, name);
      const stat = statSync(path, { bigint: true });
      return [name, {
        hash: hashFile(path),
        size: stat.size,
        mtimeNs: stat.mtimeNs,
        ino: stat.ino,
      }];
    })),
  };
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

test('apply path preflight is read-only and classifies every admitted path', async () => {
  await withFixtureRoot(async root => {
    const source = createSource(root);
    const uploadRoot = join(root, 'uploads');
    const resourceMapPath = join(root, 'resource-map.json');
    mkdirSync(uploadRoot, { mode: 0o700 });
    writeFileSync(resourceMapPath, '{"version":1}\n', { mode: 0o600 });
    const beforeEntries = readdirSync(root).toSorted();
    const beforeSourceDigest = hashFile(source);

    const admission = preflightIsolatedApplyPaths({
      ...paths(root),
      uploadRoot,
      resourceMapPath,
    });

    assert.equal(admission.root.realPath, root);
    assert.equal(admission.source.state, 'file');
    assert.equal(admission.uploadRoot.state, 'directory');
    assert.equal(admission.resourceMap.state, 'file');
    assert.equal(admission.target.state, 'absent');
    assert.equal(admission.backup.state, 'absent');
    assert.equal(admission.rollbackTarget.state, 'absent');
    assert.equal(admission.proofSeal.state, 'absent');
    assert.deepEqual(readdirSync(root).toSorted(), beforeEntries);
    assert.equal(hashFile(source), beforeSourceDigest);
  });
});

test('apply path preflight fails closed when the effective uid changes during admission', async () => {
  await withFixtureRoot(async root => {
    createSource(root);
    const originalGetuid = process.getuid;
    const actualUid = originalGetuid.call(process);
    let calls = 0;
    try {
      process.getuid = () => {
        calls += 1;
        return calls < 3 ? actualUid : actualUid + 1;
      };
      assert.throws(
        () => preflightIsolatedApplyPaths(paths(root)),
        error => error.code === 'DESTINATION_PARENT_CHANGED'
          && error.result === 'INVALID_USAGE',
      );
    } finally {
      process.getuid = originalGetuid;
    }
  });
});

test('apply path preflight rejects out-of-root inputs before source validation or artifact creation', async t => {
  const outsideRoot = mkdtempSync(join(tmpdir(), 'jso-preflight-outside-'));
  chmodSync(outsideRoot, 0o700);
  try {
    const outsideSource = join(outsideRoot, 'source.sqlite');
    const outsideResource = join(outsideRoot, 'resource-map.json');
    const outsideUploads = join(outsideRoot, 'uploads');
    writeFileSync(outsideSource, 'source sentinel', { mode: 0o600 });
    writeFileSync(outsideResource, 'not json and must not be read', { mode: 0o600 });
    mkdirSync(outsideUploads, { mode: 0o700 });
    const outsideSourceDigest = hashFile(outsideSource);
    const outsideResourceDigest = hashFile(outsideResource);

    await t.test('source outside root', async () => withFixtureRoot(async root => {
      const beforeEntries = readdirSync(root).toSorted();
      assert.throws(
        () => preflightIsolatedApplyPaths({ ...paths(root), source: outsideSource }),
        error => error.code === 'UNSAFE_DESTINATION' && error.result === 'INVALID_USAGE',
      );
      assert.deepEqual(readdirSync(root).toSorted(), beforeEntries);
      assert.equal(hashFile(outsideSource), outsideSourceDigest);
    }));

    await t.test('resource map outside root wins before invalid source inspection', async () => withFixtureRoot(async root => {
      mkdirSync(join(root, 'source.sqlite'));
      const beforeEntries = readdirSync(root).toSorted();
      assert.throws(
        () => preflightIsolatedApplyPaths({
          ...paths(root),
          resourceMapPath: outsideResource,
        }),
        error => error.code === 'UNSAFE_DESTINATION' && error.result === 'INVALID_USAGE',
      );
      assert.deepEqual(readdirSync(root).toSorted(), beforeEntries);
      assert.equal(hashFile(outsideResource), outsideResourceDigest);
    }));

    await t.test('upload root outside root wins before missing source inspection', async () => withFixtureRoot(async root => {
      const beforeEntries = readdirSync(root).toSorted();
      assert.throws(
        () => preflightIsolatedApplyPaths({
          ...paths(root),
          uploadRoot: outsideUploads,
        }),
        error => error.code === 'UNSAFE_DESTINATION' && error.result === 'INVALID_USAGE',
      );
      assert.deepEqual(readdirSync(root).toSorted(), beforeEntries);
    }));
  } finally {
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('isolated apply creates a sealed verified target and exact replay is read-only', async () => {
  await withFixtureRoot(async root => {
    const source = createSource(root, { snapshot: emptySnapshot({ revision: 4 }) });
    const plan = buildPlan(source);
    const first = await applyIsolatedMigration(options(root, plan));
    assert.equal(first.status, 'APPLIED_VERIFIED');
    assert.equal(first.batchIdentity, plan.batchIdentity);
    assert.match(first.targetArtifactDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.match(first.backupProofIdentity, /^sha256:[a-f0-9]{64}$/u);
    assert.match(first.rollbackProofIdentity, /^sha256:[a-f0-9]{64}$/u);
    const sealText = readFileSync(join(root, 'proof-seal.json'), 'utf8');
    const seal = JSON.parse(sealText);
    assert.equal(JSON.stringify(seal).includes(root), false);
    assert.equal(seal.verifiedAt, VERIFIED_AT);
    assert.equal(seal.targetArtifactDigest, first.targetArtifactDigest);
    const beforeReplay = artifactState(root);

    const replay = await applyIsolatedMigration(options(root, plan, {
      startedAt: '2026-10-01T00:00:00.000Z',
      completedAt: '2026-10-01T00:00:01.000Z',
    }));
    assert.equal(replay.status, 'ALREADY_APPLIED_VERIFIED');
    assert.deepEqual(artifactState(root), beforeReplay);
    assert.equal(replay.targetArtifactDigest, first.targetArtifactDigest);
  });
});

test('completed targets require an exact untampered proof seal', async t => {
  await t.test('missing seal', async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    await applyIsolatedMigration(options(root, plan));
    unlinkSync(join(root, 'proof-seal.json'));
    await assert.rejects(
      applyIsolatedMigration(options(root, plan)),
      error => error.code === 'PROOF_SEAL_REQUIRED',
    );
    assert.equal(existsSync(join(root, 'target.sqlite')), true);
  }));

  await t.test('tampered seal', async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    await applyIsolatedMigration(options(root, plan));
    appendFileSync(join(root, 'proof-seal.json'), ' ');
    await assert.rejects(
      applyIsolatedMigration(options(root, plan)),
      error => error.code === 'PROOF_SEAL_INVALID',
    );
    assert.equal(existsSync(join(root, 'target.sqlite')), true);
  }));
});

test('schema and materializer faults preserve the failed target without a failed batch row', async t => {
  const cases = [
    ['before_schema', false],
    ['after_schema', true],
    ['after_batch', true],
  ];
  for (const [stage, schemaExpected] of cases) {
    await t.test(stage, async () => withFixtureRoot(async root => {
      const source = createSource(root);
      const plan = buildPlan(source);
      await assert.rejects(applyIsolatedMigration(options(root, plan, {
        faultInjector(current) {
          if (current === stage) throw new Error('PRIVATE FAULT');
        },
      })), error => error.code === 'TARGET_APPLY_FAILED' && !error.message.includes('PRIVATE FAULT'));
      for (const name of ['backup.sqlite', 'rollback.sqlite', 'target.sqlite']) {
        assert.equal(existsSync(join(root, name)), true, `${stage}:${name}`);
      }
      assert.equal(existsSync(join(root, 'proof-seal.json')), false);
      const db = new DatabaseSync(join(root, 'target.sqlite'), { readOnly: true });
      try {
        const hasBatch = db.prepare(`
          SELECT COUNT(*) AS count FROM sqlite_schema
          WHERE type = 'table' AND name = 'migration_batches'
        `).get().count === 1;
        assert.equal(hasBatch, schemaExpected);
        if (hasBatch) {
          assert.equal(db.prepare('SELECT COUNT(*) AS count FROM migration_batches').get().count, 0);
        }
      } finally {
        db.close();
      }
    }));
  }
});

test('input identity is frozen before backup and checked at every pre-commit checkpoint', async () => {
  await withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    await assert.rejects(applyIsolatedMigration(options(root, plan, {
      faultInjector(stage) {
        if (stage !== 'after_backup') return;
        const db = new DatabaseSync(source);
        try {
          db.prepare(`
            INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
            VALUES ('fixture.precommit-change', 'test', NULL, 0, 'private', ?)
          `).run(COMPLETED_AT);
        } finally {
          db.close();
        }
      },
    })), error => error.code === 'SOURCE_CHANGED_DURING_APPLY');
    assert.equal(existsSync(join(root, 'backup.sqlite')), true);
    assert.equal(existsSync(join(root, 'rollback.sqlite')), false);
    assert.equal(existsSync(join(root, 'target.sqlite')), false);
    assert.equal(existsSync(join(root, 'proof-seal.json')), false);
  });
});

test('post-commit and pre-seal faults return COMMITTED_BUT_UNVERIFIED and preserve target', async t => {
  for (const stage of ['after_commit', 'before_seal']) {
    await t.test(stage, async () => withFixtureRoot(async root => {
      const source = createSource(root);
      const plan = buildPlan(source);
      await assert.rejects(applyIsolatedMigration(options(root, plan, {
        faultInjector(current) {
          if (current === stage) throw new Error('PRIVATE POST COMMIT FAULT');
        },
      })), error => (
        error.code === 'COMMITTED_BUT_UNVERIFIED'
        && !error.message.includes('PRIVATE POST COMMIT FAULT')
      ));
      assert.equal(existsSync(join(root, 'target.sqlite')), true);
      assert.equal(existsSync(join(root, 'proof-seal.json')), false);
      const db = new DatabaseSync(join(root, 'target.sqlite'), { readOnly: true });
      try {
        assert.equal(db.prepare('SELECT status FROM migration_batches').get().status, 'completed');
      } finally {
        db.close();
      }
    }));
  }
});

test('source or upload drift after commit cannot produce a proof seal', async t => {
  await t.test('source drift', async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    await assert.rejects(applyIsolatedMigration(options(root, plan, {
      faultInjector(stage) {
        if (stage !== 'after_target_verify') return;
        const db = new DatabaseSync(source);
        try {
          db.prepare(`
            INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
            VALUES ('fixture.changed', 'test', NULL, 0, 'private', ?)
          `).run(COMPLETED_AT);
        } finally {
          db.close();
        }
      },
    })), error => error.code === 'COMMITTED_BUT_UNVERIFIED');
    assert.equal(existsSync(join(root, 'target.sqlite')), true);
    assert.equal(existsSync(join(root, 'proof-seal.json')), false);
  }));

  await t.test('upload drift', async () => withFixtureRoot(async root => {
    const uploadRoot = join(root, 'uploads');
    mkdirSync(uploadRoot, { mode: 0o700 });
    const body = Buffer.from('fixture-upload');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const storedName = `${sha256}.bin`;
    const uploadPath = join(uploadRoot, storedName);
    writeFileSync(uploadPath, body, { mode: 0o600 });
    const source = createSource(root, { uploads: [{
      id: 'UPLOAD-1',
      operation_id: 'OP-1',
      original_name: 'private-name.bin',
      content_type: 'application/octet-stream',
      kind: 'attachment',
      size: body.length,
      sha256,
      stored_name: storedName,
      claimed_task_id: null,
    }] });
    const plan = buildPlan(source);
    await assert.rejects(applyIsolatedMigration(options(root, plan, {
      uploadRoot,
      faultInjector(stage) {
        if (stage === 'after_target_verify') {
          unlinkSync(uploadPath);
          writeFileSync(uploadPath, body, { mode: 0o600 });
        }
      },
    })), error => error.code === 'COMMITTED_BUT_UNVERIFIED');
    assert.equal(existsSync(join(root, 'target.sqlite')), true);
    assert.equal(existsSync(join(root, 'proof-seal.json')), false);
  }));

  await t.test('before-seal drift is checked before final recovery proof', async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    await assert.rejects(applyIsolatedMigration(options(root, plan, {
      faultInjector(stage) {
        if (stage !== 'before_seal') return;
        const db = new DatabaseSync(source);
        try {
          db.prepare(`
            INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
            VALUES ('fixture.before-seal', 'test', NULL, 0, 'private', ?)
          `).run(COMPLETED_AT);
        } finally {
          db.close();
        }
      },
    })), error => error.code === 'COMMITTED_BUT_UNVERIFIED');
    assert.equal(existsSync(join(root, 'target.sqlite')), true);
    assert.equal(existsSync(join(root, 'proof-seal.json')), false);
  }));

  await t.test('post-seal recheck preserves but permanently rejects a stale seal', async () => withFixtureRoot(async root => {
    const uploadRoot = join(root, 'uploads');
    mkdirSync(uploadRoot, { mode: 0o700 });
    const body = Buffer.from('post-seal-upload');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const storedName = `${sha256}.bin`;
    const uploadPath = join(uploadRoot, storedName);
    writeFileSync(uploadPath, body, { mode: 0o600 });
    const source = createSource(root, { uploads: [{
      id: 'UPLOAD-POST-SEAL-1',
      operation_id: 'OP-POST-SEAL-1',
      original_name: 'private-post-seal.bin',
      content_type: 'application/octet-stream',
      kind: 'attachment',
      size: body.length,
      sha256,
      stored_name: storedName,
      claimed_task_id: null,
    }] });
    const plan = buildPlan(source);
    await assert.rejects(applyIsolatedMigration(options(root, plan, {
      uploadRoot,
      clock: () => ({
        toISOString() {
          unlinkSync(uploadPath);
          writeFileSync(uploadPath, body, { mode: 0o600 });
          return VERIFIED_AT;
        },
      }),
    })), error => error.code === 'COMMITTED_BUT_UNVERIFIED');
    assert.equal(existsSync(join(root, 'target.sqlite')), true);
    assert.equal(existsSync(join(root, 'proof-seal.json')), true);
    await assert.rejects(
      applyIsolatedMigration(options(root, plan, { uploadRoot })),
      error => error.code === 'PROOF_SEAL_INVALID',
    );
  }));
});

test('existing replay rechecks target, seal, recovery proofs, and input identity at the end', async t => {
  await t.test('preexisting sidecar', async () => withFixtureRoot(async root => {
    const source = createSource(root);
    const plan = buildPlan(source);
    await applyIsolatedMigration(options(root, plan));
    const beforeTarget = hashFile(join(root, 'target.sqlite'));
    writeFileSync(join(root, 'target.sqlite-wal'), 'orphan');
    await assert.rejects(
      applyIsolatedMigration(options(root, plan)),
      error => error.code === 'TARGET_IDENTITY_CHANGED',
    );
    assert.equal(hashFile(join(root, 'target.sqlite')), beforeTarget);
    assert.equal(existsSync(join(root, 'target.sqlite-wal')), true);
    assert.equal(existsSync(join(root, 'proof-seal.json')), true);
  }));

  for (const stage of ['existing_before_target_verify', 'existing_after_target_verify']) {
    await t.test(`${stage} sidecar`, async () => withFixtureRoot(async root => {
      const source = createSource(root);
      const plan = buildPlan(source);
      await applyIsolatedMigration(options(root, plan));
      const before = artifactState(root);
      await assert.rejects(applyIsolatedMigration(options(root, plan, {
        faultInjector(current) {
          if (current === stage) writeFileSync(join(root, 'target.sqlite-journal'), 'orphan');
        },
      })), error => error.code === 'TARGET_IDENTITY_CHANGED');
      assert.equal(hashFile(join(root, 'target.sqlite')), before.artifacts['target.sqlite'].hash);
      assert.equal(hashFile(join(root, 'proof-seal.json')), before.artifacts['proof-seal.json'].hash);
      assert.equal(existsSync(join(root, 'target.sqlite-journal')), true);
    }));
  }

  await t.test('post-verification identical upload replacement', async () => withFixtureRoot(async root => {
    const uploadRoot = join(root, 'uploads');
    mkdirSync(uploadRoot, { mode: 0o700 });
    const body = Buffer.from('replay-upload');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const storedName = `${sha256}.bin`;
    const uploadPath = join(uploadRoot, storedName);
    writeFileSync(uploadPath, body, { mode: 0o600 });
    const source = createSource(root, { uploads: [{
      id: 'UPLOAD-REPLAY-1',
      operation_id: 'OP-REPLAY-1',
      original_name: 'private-replay.bin',
      content_type: 'application/octet-stream',
      kind: 'attachment',
      size: body.length,
      sha256,
      stored_name: storedName,
      claimed_task_id: null,
    }] });
    const plan = buildPlan(source);
    await applyIsolatedMigration(options(root, plan, { uploadRoot }));
    await assert.rejects(applyIsolatedMigration(options(root, plan, {
      uploadRoot,
      faultInjector(stage) {
        if (stage !== 'existing_after_target_verify') return;
        unlinkSync(uploadPath);
        writeFileSync(uploadPath, body, { mode: 0o600 });
      },
    })), error => error.code === 'SOURCE_CHANGED_DURING_APPLY');
    assert.equal(existsSync(join(root, 'proof-seal.json')), true);
    await assert.rejects(
      applyIsolatedMigration(options(root, plan, { uploadRoot })),
      error => error.code === 'PROOF_SEAL_INVALID',
    );
  }));
});
