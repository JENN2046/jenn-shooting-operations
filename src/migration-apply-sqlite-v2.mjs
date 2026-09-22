import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

import { materializeMigrationPlan } from './migration-materialize-sqlite-v2.mjs';
import {
  MigrationError,
  canonicalJson,
  sha256Digest,
} from './migration-v2.mjs';
import {
  createVerifiedBackup,
  restoreVerifiedBackup,
  verifyExistingBackup,
  verifyExistingRestore,
} from './migration-recovery-sqlite-v2.mjs';
import {
  resolveExistingPath,
  verifyV2Target,
} from './migration-sqlite-v2.mjs';
import { initializeWritableSchema } from './sqlite-schema-v2.mjs';

const FIXTURE_PREFIX = 'jenn-shooting-migration-fixture-';
const SIDECARS = Object.freeze(['-wal', '-shm', '-journal']);
const PROOF_FIELDS = Object.freeze([
  'schemaVersion',
  'migrationVersion',
  'batchIdentity',
  'targetArtifactDigest',
  'backupProofIdentity',
  'rollbackProofIdentity',
  'sourceAndUploadIdentityDigest',
  'verifiedAt',
]);
const COPY_BUFFER_SIZE = 64 * 1024;
const MAX_PROOF_BYTES = 64 * 1024;

function fail(code, result = 'INVALID_TARGET') {
  throw new MigrationError(code, result);
}

function lstatOrNull(path) {
  try {
    return lstatSync(path, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
}

function validRfc3339(value) {
  if (typeof value !== 'string') return false;
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d+)?(?<zone>Z|[+-](?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/u.exec(value);
  if (!match) return false;
  const number = key => Number(match.groups[key]);
  const year = number('year');
  const month = number('month');
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12
    && number('day') >= 1 && number('day') <= days[month - 1]
    && number('hour') <= 23 && number('minute') <= 59 && number('second') <= 59
    && (match.groups.zone === 'Z'
      || (number('offsetHour') <= 23 && number('offsetMinute') <= 59))
    && Number.isFinite(Date.parse(value));
}

function fixtureRootInfo(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) {
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
  const resolved = resolve(path);
  const linked = lstatOrNull(resolved);
  if (!linked || linked.isSymbolicLink() || !linked.isDirectory()) {
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
  const realPath = realpathSync(resolved);
  const metadata = statSync(realPath, { bigint: true });
  if (dirname(realPath) !== realpathSync(tmpdir())
      || !basename(realPath).startsWith(FIXTURE_PREFIX)
      || (metadata.mode & 0o777n) !== 0o700n
      || (typeof process.getuid === 'function' && metadata.uid !== BigInt(process.getuid()))) {
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
  return { realPath, metadata };
}

function insideRoot(path, root) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) {
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
  const candidate = resolve(path);
  const relation = relative(root.realPath, candidate);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
  return candidate;
}

function assertRootStable(root) {
  const current = lstatOrNull(root.realPath);
  if (!current || current.isSymbolicLink() || !current.isDirectory()
      || current.dev !== root.metadata.dev || current.ino !== root.metadata.ino
      || current.uid !== root.metadata.uid
      || (typeof process.getuid === 'function' && current.uid !== BigInt(process.getuid()))
      || (current.mode & 0o777n) !== 0o700n) {
    fail('DESTINATION_PARENT_CHANGED', 'INVALID_USAGE');
  }
}

function assertNoSidecars(path) {
  for (const suffix of SIDECARS) {
    if (lstatOrNull(`${path}${suffix}`)) fail('TARGET_IDENTITY_CHANGED');
  }
}

function preflightReadableFile(path, code = 'UNSAFE_DESTINATION') {
  const metadata = lstatOrNull(path);
  if (!metadata || metadata.isSymbolicLink() || !metadata.isFile()
      || metadata.nlink !== 1n || realpathSync(path) !== path
      || (typeof process.getuid === 'function' && metadata.uid !== BigInt(process.getuid()))) {
    fail(code, 'INVALID_USAGE');
  }
  return Object.freeze({ path, state: 'file', metadata });
}

function preflightReadableDirectory(path) {
  const metadata = lstatOrNull(path);
  if (!metadata || metadata.isSymbolicLink() || !metadata.isDirectory()
      || realpathSync(path) !== path
      || (typeof process.getuid === 'function' && metadata.uid !== BigInt(process.getuid()))) {
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
  return Object.freeze({ path, state: 'directory', metadata });
}

function classifyWritePath(path) {
  const metadata = lstatOrNull(path);
  if (!metadata) return Object.freeze({ path, state: 'absent' });
  if (metadata.isSymbolicLink()) return Object.freeze({ path, state: 'symlink', metadata });
  if (metadata.isFile()) return Object.freeze({ path, state: 'file', metadata });
  if (metadata.isDirectory()) return Object.freeze({ path, state: 'directory', metadata });
  return Object.freeze({ path, state: 'other', metadata });
}

export function preflightIsolatedApplyPaths({
  fixtureRoot,
  source,
  target,
  backup,
  rollbackTarget,
  proofSeal,
  uploadRoot,
  resourceMapPath,
} = {}) {
  const root = fixtureRootInfo(fixtureRoot);
  const rawPaths = {
    source,
    target,
    backup,
    rollbackTarget,
    proofSeal,
    ...(uploadRoot === undefined || uploadRoot === null ? {} : { uploadRoot }),
    ...(resourceMapPath === undefined || resourceMapPath === null ? {} : { resourceMapPath }),
  };

  // Containment and lexical alias rejection must complete before any input metadata/content access.
  const contained = Object.fromEntries(
    Object.entries(rawPaths).map(([name, path]) => [name, insideRoot(path, root)]),
  );
  if (new Set(Object.values(contained)).size !== Object.keys(contained).length) {
    fail('PATH_IDENTITY_CONFLICT', 'INVALID_USAGE');
  }

  const result = {
    root,
    source: preflightReadableFile(contained.source),
    target: classifyWritePath(contained.target),
    backup: classifyWritePath(contained.backup),
    rollbackTarget: classifyWritePath(contained.rollbackTarget),
    proofSeal: classifyWritePath(contained.proofSeal),
    uploadRoot: contained.uploadRoot === undefined
      ? null : preflightReadableDirectory(contained.uploadRoot),
    resourceMap: contained.resourceMapPath === undefined
      ? null : preflightReadableFile(contained.resourceMapPath),
  };
  assertRootStable(root);
  return Object.freeze(result);
}

function existingArtifact(path, root, missingCode) {
  const candidate = insideRoot(path, root);
  const linked = lstatOrNull(candidate);
  if (!linked) fail(missingCode);
  if (linked.isSymbolicLink() || !linked.isFile() || linked.nlink !== 1n
      || (linked.mode & 0o777n) !== 0o600n || realpathSync(candidate) !== candidate) {
    fail('TARGET_IDENTITY_CHANGED');
  }
  return { path: candidate, metadata: linked };
}

function assertArtifactStable(artifact) {
  const current = lstatOrNull(artifact.path);
  if (!current || current.isSymbolicLink() || !current.isFile() || current.nlink !== 1n
      || current.dev !== artifact.metadata.dev || current.ino !== artifact.metadata.ino
      || current.size !== artifact.metadata.size
      || current.mtimeNs !== artifact.metadata.mtimeNs
      || current.ctimeNs !== artifact.metadata.ctimeNs
      || (current.mode & 0o777n) !== 0o600n) {
    fail('TARGET_IDENTITY_CHANGED');
  }
}

function fsyncDirectory(path) {
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
    fsyncSync(descriptor);
  } catch {
    fail('TARGET_IDENTITY_CHANGED');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function fsyncArtifact(path) {
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const metadata = fstatSync(descriptor, { bigint: true });
    if (!metadata.isFile() || metadata.nlink !== 1n || (metadata.mode & 0o777n) !== 0o600n) {
      fail('TARGET_IDENTITY_CHANGED');
    }
    fsyncSync(descriptor);
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    fail('TARGET_IDENTITY_CHANGED');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  fsyncDirectory(dirname(path));
  assertNoSidecars(path);
}

function hashFileStable(path) {
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n) fail('TARGET_IDENTITY_CHANGED');
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_SIZE);
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      fail('TARGET_IDENTITY_CHANGED');
    }
    return `sha256:${hash.digest('hex')}`;
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    fail('TARGET_IDENTITY_CHANGED');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function identityStat(metadata) {
  if (!metadata) return null;
  return {
    dev: metadata.dev.toString(),
    ino: metadata.ino.toString(),
    mode: (metadata.mode & 0o777n).toString(),
    size: metadata.size.toString(),
    mtimeNs: metadata.mtimeNs.toString(),
    ctimeNs: metadata.ctimeNs.toString(),
  };
}

function existingInput(path, root, type) {
  const candidate = insideRoot(path, root);
  const metadata = lstatOrNull(candidate);
  const valid = type === 'directory' ? metadata?.isDirectory() : metadata?.isFile();
  if (!metadata || metadata.isSymbolicLink() || !valid || realpathSync(candidate) !== candidate) {
    fail('SOURCE_CHANGED_DURING_APPLY');
  }
  return { path: candidate, metadata };
}

function inputScopeIdentity(root, { source, uploadRoot, resourceMapPath, plan }) {
  const sourceInfo = existingInput(source, root, 'file');
  const sourceSidecars = Object.fromEntries(SIDECARS.map(suffix => [
    suffix,
    identityStat(lstatOrNull(`${sourceInfo.path}${suffix}`)),
  ]));
  let uploads = null;
  if (uploadRoot !== undefined && uploadRoot !== null) {
    const uploadRootInfo = existingInput(uploadRoot, root, 'directory');
    const files = plan.records.uploads
      .filter(upload => upload.stored_name !== null)
      .map(upload => {
        const file = existingInput(resolve(uploadRootInfo.path, upload.stored_name), root, 'file');
        return {
          idDigest: sha256Digest(upload.id),
          storedNameDigest: sha256Digest(upload.stored_name),
          identity: identityStat(file.metadata),
        };
      }).toSorted((left, right) => left.idDigest.localeCompare(right.idDigest));
    uploads = {
      root: identityStat(uploadRootInfo.metadata),
      rootPathDigest: sha256Digest(uploadRootInfo.path),
      files,
    };
  }
  let resourceMap = null;
  if (resourceMapPath !== undefined && resourceMapPath !== null) {
    const mapInfo = existingInput(resourceMapPath, root, 'file');
    resourceMap = {
      identity: identityStat(mapInfo.metadata),
      pathDigest: sha256Digest(mapInfo.path),
    };
  }
  return sha256Digest({
    source: identityStat(sourceInfo.metadata),
    sourcePathDigest: sha256Digest(sourceInfo.path),
    sourceSidecars,
    uploads,
    resourceMap,
  });
}

function assertInputScopeUnchanged(root, input, baseline) {
  if (inputScopeIdentity(root, input) !== baseline) {
    fail('SOURCE_CHANGED_DURING_APPLY', 'INVALID_SOURCE');
  }
}

function sourceAndUploadIdentity(receipt, inputScopeDigest) {
  return sha256Digest({
    sourceIdentityDigest: receipt.sourceIdentityDigest,
    databaseEvidenceDigest: receipt.databaseEvidenceDigest,
    uploadManifestDigest: receipt.uploadManifestDigest,
    inputScopeDigest,
  });
}

function expectedSeal(
  plan,
  targetDigest,
  backupReceipt,
  rollbackReceipt,
  inputScopeDigest,
  verifiedAt,
) {
  return {
    schemaVersion: 1,
    migrationVersion: plan.migrationVersion,
    batchIdentity: plan.batchIdentity,
    targetArtifactDigest: targetDigest,
    backupProofIdentity: backupReceipt.backupProofIdentity,
    rollbackProofIdentity: rollbackReceipt.rollbackProofIdentity,
    sourceAndUploadIdentityDigest: sourceAndUploadIdentity(backupReceipt, inputScopeDigest),
    verifiedAt,
  };
}

function readProofSeal(path, root) {
  const artifact = existingArtifact(path, root, 'PROOF_SEAL_REQUIRED');
  let descriptor;
  try {
    descriptor = openSync(artifact.path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = fstatSync(descriptor, { bigint: true });
    if (before.size > BigInt(MAX_PROOF_BYTES)) fail('PROOF_SEAL_INVALID');
    const buffer = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (offset !== buffer.length || before.dev !== after.dev || before.ino !== after.ino
        || before.size !== after.size || before.mtimeNs !== after.mtimeNs
        || before.ctimeNs !== after.ctimeNs) {
      fail('PROOF_SEAL_INVALID');
    }
    const text = buffer.toString('utf8');
    let seal;
    try {
      seal = JSON.parse(text);
    } catch {
      fail('PROOF_SEAL_INVALID');
    }
    if (!seal || typeof seal !== 'object' || Array.isArray(seal)
        || canonicalJson(seal) !== text
        || canonicalJson(Object.keys(seal).toSorted()) !== canonicalJson([...PROOF_FIELDS].toSorted())
        || !validRfc3339(seal.verifiedAt)) {
      fail('PROOF_SEAL_INVALID');
    }
    return { seal, artifact };
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    fail('PROOF_SEAL_INVALID');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function assertSealMatches(actual, expected) {
  if (canonicalJson(actual) !== canonicalJson(expected)) fail('PROOF_SEAL_INVALID');
}

function createProofSeal(path, root, seal) {
  const candidate = insideRoot(path, root);
  const parent = dirname(candidate);
  const parentLink = lstatOrNull(parent);
  if (!parentLink || parentLink.isSymbolicLink() || !parentLink.isDirectory()
      || realpathSync(parent) !== parent || lstatOrNull(candidate)) {
    fail('PROOF_SEAL_INVALID');
  }
  for (const suffix of SIDECARS) {
    if (lstatOrNull(`${candidate}${suffix}`)) fail('PROOF_SEAL_INVALID');
  }
  let descriptor;
  try {
    descriptor = openSync(
      candidate,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW | fsConstants.O_WRONLY,
      0o600,
    );
    const payload = Buffer.from(canonicalJson(seal), 'utf8');
    let offset = 0;
    while (offset < payload.length) offset += writeSync(descriptor, payload, offset, payload.length - offset);
    fsyncSync(descriptor);
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    fail('PROOF_SEAL_INVALID');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  fsyncDirectory(parent);
  const readBack = readProofSeal(candidate, root);
  assertSealMatches(readBack.seal, seal);
  return readBack;
}

function invokeFault(faultInjector, stage) {
  if (faultInjector) faultInjector(stage);
}

function targetExists(path, root) {
  const candidate = insideRoot(path, root);
  return lstatOrNull(candidate) !== null;
}

function assertNewArtifactSet(root, paths) {
  for (const path of paths) {
    const candidate = insideRoot(path, root);
    if (lstatOrNull(candidate)) fail('DESTINATION_EXISTS', 'INVALID_USAGE');
    for (const suffix of SIDECARS) {
      if (lstatOrNull(`${candidate}${suffix}`)) fail('DESTINATION_SIDECAR_EXISTS', 'INVALID_USAGE');
    }
  }
}

function verifiedResult(
  status,
  plan,
  targetDigest,
  backupReceipt,
  rollbackReceipt,
  inputScopeDigest,
) {
  return Object.freeze({
    status,
    batchIdentity: plan.batchIdentity,
    targetArtifactDigest: targetDigest,
    backupProofIdentity: backupReceipt.backupProofIdentity,
    rollbackProofIdentity: rollbackReceipt.rollbackProofIdentity,
    sourceAndUploadIdentityDigest: sourceAndUploadIdentity(backupReceipt, inputScopeDigest),
  });
}

function verifyCompletedTarget({
  root,
  target,
  proofSeal,
  plan,
  backupReceipt,
  rollbackReceipt,
  inputScopeDigest,
}) {
  const targetArtifact = existingArtifact(target, root, 'TARGET_IDENTITY_CHANGED');
  assertNoSidecars(targetArtifact.path);
  const verification = verifyV2Target(resolveExistingPath(targetArtifact.path), plan);
  if (verification.status !== 'ALREADY_APPLIED_VERIFIED') fail('TARGET_IDENTITY_CHANGED');
  assertArtifactStable(targetArtifact);
  assertNoSidecars(targetArtifact.path);
  const targetDigest = hashFileStable(targetArtifact.path);
  assertArtifactStable(targetArtifact);
  const proof = readProofSeal(proofSeal, root);
  assertSealMatches(proof.seal, expectedSeal(
    plan,
    targetDigest,
    backupReceipt,
    rollbackReceipt,
    inputScopeDigest,
    proof.seal.verifiedAt,
  ));
  assertArtifactStable(proof.artifact);
  assertRootStable(root);
  return { targetArtifact, targetDigest, proof };
}

export async function applyIsolatedMigration({
  fixtureRoot,
  source,
  target,
  backup,
  rollbackTarget,
  proofSeal,
  plan,
  uploadRoot,
  resourceMapPath,
  startedAt,
  completedAt,
  faultInjector,
  clock = () => new Date(),
} = {}) {
  const pathPreflight = preflightIsolatedApplyPaths({
    fixtureRoot,
    source,
    target,
    backup,
    rollbackTarget,
    proofSeal,
    uploadRoot,
    resourceMapPath,
  });
  const root = pathPreflight.root;

  if (targetExists(target, root)) {
    try {
      const input = { source, uploadRoot, resourceMapPath, plan };
      const initialInputScopeDigest = inputScopeIdentity(root, input);
      const backupReceipt = verifyExistingBackup({
        fixtureRoot, source, backup, plan, uploadRoot, resourceMapPath,
      });
      const rollbackReceipt = verifyExistingRestore({
        fixtureRoot, source, backup, rollbackTarget, plan, backupReceipt,
        uploadRoot, resourceMapPath,
        expectedAttachmentDigest: backupReceipt.uploadManifestDigest,
      });
      assertInputScopeUnchanged(root, input, initialInputScopeDigest);
      invokeFault(faultInjector, 'existing_before_target_verify');
      assertInputScopeUnchanged(root, input, initialInputScopeDigest);
      const initialTargetProof = verifyCompletedTarget({
        root, target, proofSeal, plan, backupReceipt, rollbackReceipt,
        inputScopeDigest: initialInputScopeDigest,
      });
      invokeFault(faultInjector, 'existing_after_target_verify');

      const finalBackup = verifyExistingBackup({
        fixtureRoot, source, backup, plan, uploadRoot, resourceMapPath,
        expectedAttachmentDigest: backupReceipt.uploadManifestDigest,
      });
      const finalRollback = verifyExistingRestore({
        fixtureRoot, source, backup, rollbackTarget, plan,
        backupReceipt: finalBackup, uploadRoot, resourceMapPath,
        expectedAttachmentDigest: backupReceipt.uploadManifestDigest,
      });
      assertInputScopeUnchanged(root, input, initialInputScopeDigest);
      if (finalBackup.backupProofIdentity !== backupReceipt.backupProofIdentity
          || finalRollback.rollbackProofIdentity !== rollbackReceipt.rollbackProofIdentity) {
        fail('SOURCE_CHANGED_DURING_APPLY', 'INVALID_SOURCE');
      }
      assertArtifactStable(initialTargetProof.targetArtifact);
      assertNoSidecars(initialTargetProof.targetArtifact.path);
      if (hashFileStable(initialTargetProof.targetArtifact.path)
          !== initialTargetProof.targetDigest) {
        fail('TARGET_IDENTITY_CHANGED');
      }
      const finalProof = readProofSeal(proofSeal, root);
      assertSealMatches(finalProof.seal, initialTargetProof.proof.seal);
      assertArtifactStable(initialTargetProof.proof.artifact);
      assertArtifactStable(finalProof.artifact);
      assertRootStable(root);
      return verifiedResult(
        'ALREADY_APPLIED_VERIFIED', plan, initialTargetProof.targetDigest,
        finalBackup, finalRollback, initialInputScopeDigest,
      );
    } catch (error) {
      if (error instanceof MigrationError) throw error;
      fail('TARGET_IDENTITY_CHANGED');
    }
  }

  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.issues)) {
    fail('INVALID_MIGRATION_PLAN');
  }
  if (plan.issues.some(issue => issue.severity === 'BLOCKER')) {
    fail('BLOCKED_MAPPING', 'BLOCKED_MAPPING');
  }
  if (!validRfc3339(startedAt) || !validRfc3339(completedAt)
      || Date.parse(completedAt) < Date.parse(startedAt)) {
    fail('INVALID_MIGRATION_TIME');
  }

  assertNewArtifactSet(root, [backup, rollbackTarget, target, proofSeal]);
  let committed = false;
  let db;
  try {
    const input = { source, uploadRoot, resourceMapPath, plan };
    const initialInputScopeDigest = inputScopeIdentity(root, input);
    const backupReceipt = await createVerifiedBackup({
      fixtureRoot, source, backup, plan, uploadRoot, resourceMapPath,
    });
    invokeFault(faultInjector, 'after_backup');
    assertInputScopeUnchanged(root, input, initialInputScopeDigest);
    restoreVerifiedBackup({
      fixtureRoot, source, backup, rollbackTarget, plan, backupReceipt,
      uploadRoot, resourceMapPath,
      expectedAttachmentDigest: backupReceipt.uploadManifestDigest,
    });
    invokeFault(faultInjector, 'after_rollback');
    assertInputScopeUnchanged(root, input, initialInputScopeDigest);

    const verifiedBackup = verifyExistingBackup({
      fixtureRoot, source, backup, plan, uploadRoot, resourceMapPath,
      expectedAttachmentDigest: backupReceipt.uploadManifestDigest,
    });
    const verifiedRollback = verifyExistingRestore({
      fixtureRoot, source, backup, rollbackTarget, plan,
      backupReceipt: verifiedBackup, uploadRoot, resourceMapPath,
      expectedAttachmentDigest: verifiedBackup.uploadManifestDigest,
    });
    invokeFault(faultInjector, 'after_readonly_proof');
    assertInputScopeUnchanged(root, input, initialInputScopeDigest);

    try {
      restoreVerifiedBackup({
        fixtureRoot, source, backup, rollbackTarget: target, plan,
        backupReceipt: verifiedBackup, uploadRoot, resourceMapPath,
        expectedAttachmentDigest: verifiedBackup.uploadManifestDigest,
        duringCopy: () => invokeFault(faultInjector, 'during_target_copy'),
      });
    } catch (error) {
      if (error instanceof MigrationError
          && ['BACKUP_NOT_VERIFIED', 'BACKUP_EVIDENCE_MISMATCH', 'UPLOAD_MANIFEST_MISMATCH'].includes(error.code)) {
        throw error;
      }
      fail('TARGET_CREATE_FAILED');
    }
    invokeFault(faultInjector, 'after_target_create');
    assertInputScopeUnchanged(root, input, initialInputScopeDigest);

    db = new DatabaseSync(target);
    const journalMode = db.prepare('PRAGMA journal_mode = DELETE').get()?.journal_mode;
    db.exec('PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
    if (String(journalMode).toLowerCase() !== 'delete'
        || Number(db.prepare('PRAGMA synchronous').get()?.synchronous) !== 2
        || Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys) !== 1) {
      fail('TARGET_APPLY_FAILED');
    }
    invokeFault(faultInjector, 'before_schema');
    assertInputScopeUnchanged(root, input, initialInputScopeDigest);
    initializeWritableSchema(db, { now: () => new Date(startedAt) });
    invokeFault(faultInjector, 'after_schema');
    assertInputScopeUnchanged(root, input, initialInputScopeDigest);
    materializeMigrationPlan({
      db, plan, startedAt, completedAt,
      faultInjector: stage => {
        invokeFault(faultInjector, stage);
        assertInputScopeUnchanged(root, input, initialInputScopeDigest);
      },
    });
    committed = true;
    db.close();
    db = undefined;
    invokeFault(faultInjector, 'after_commit');
    assertInputScopeUnchanged(root, input, initialInputScopeDigest);

    fsyncArtifact(target);
    invokeFault(faultInjector, 'after_target_fsync');
    assertInputScopeUnchanged(root, input, initialInputScopeDigest);
    const targetVerification = verifyV2Target(resolveExistingPath(target), plan);
    if (targetVerification.status !== 'ALREADY_APPLIED_VERIFIED') fail('TARGET_IDENTITY_CHANGED');
    assertNoSidecars(target);
    invokeFault(faultInjector, 'after_target_verify');
    assertInputScopeUnchanged(root, input, initialInputScopeDigest);

    invokeFault(faultInjector, 'before_seal');
    assertInputScopeUnchanged(root, input, initialInputScopeDigest);

    const finalBackup = verifyExistingBackup({
      fixtureRoot, source, backup, plan, uploadRoot, resourceMapPath,
      expectedAttachmentDigest: verifiedBackup.uploadManifestDigest,
    });
    const finalRollback = verifyExistingRestore({
      fixtureRoot, source, backup, rollbackTarget, plan,
      backupReceipt: finalBackup, uploadRoot, resourceMapPath,
      expectedAttachmentDigest: verifiedBackup.uploadManifestDigest,
    });
    if (finalBackup.backupProofIdentity !== verifiedBackup.backupProofIdentity
      || finalRollback.rollbackProofIdentity !== verifiedRollback.rollbackProofIdentity) {
      fail('SOURCE_CHANGED_DURING_APPLY');
    }
    assertInputScopeUnchanged(root, input, initialInputScopeDigest);
    const targetDigest = hashFileStable(target);
    assertNoSidecars(target);

    let verifiedAt;
    try {
      verifiedAt = clock().toISOString();
    } catch {
      fail('PROOF_SEAL_INVALID');
    }
    if (!validRfc3339(verifiedAt)) fail('PROOF_SEAL_INVALID');
    const seal = expectedSeal(
      plan,
      targetDigest,
      finalBackup,
      finalRollback,
      initialInputScopeDigest,
      verifiedAt,
    );
    const targetArtifact = existingArtifact(target, root, 'TARGET_IDENTITY_CHANGED');
    const sealedProof = createProofSeal(proofSeal, root, seal);

    const sealedBackup = verifyExistingBackup({
      fixtureRoot, source, backup, plan, uploadRoot, resourceMapPath,
      expectedAttachmentDigest: verifiedBackup.uploadManifestDigest,
    });
    const sealedRollback = verifyExistingRestore({
      fixtureRoot, source, backup, rollbackTarget, plan,
      backupReceipt: sealedBackup, uploadRoot, resourceMapPath,
      expectedAttachmentDigest: verifiedBackup.uploadManifestDigest,
    });
    assertInputScopeUnchanged(root, input, initialInputScopeDigest);
    if (sealedBackup.backupProofIdentity !== finalBackup.backupProofIdentity
        || sealedRollback.rollbackProofIdentity !== finalRollback.rollbackProofIdentity) {
      fail('SOURCE_CHANGED_DURING_APPLY');
    }
    assertArtifactStable(targetArtifact);
    assertNoSidecars(targetArtifact.path);
    if (hashFileStable(targetArtifact.path) !== targetDigest) fail('TARGET_IDENTITY_CHANGED');
    const finalProof = readProofSeal(proofSeal, root);
    assertSealMatches(finalProof.seal, seal);
    assertArtifactStable(sealedProof.artifact);
    assertArtifactStable(finalProof.artifact);
    assertRootStable(root);
    return verifiedResult(
      'APPLIED_VERIFIED', plan, targetDigest, sealedBackup, sealedRollback,
      initialInputScopeDigest,
    );
  } catch (error) {
    try { db?.close(); } catch {}
    if (committed) fail('COMMITTED_BUT_UNVERIFIED', 'COMMITTED_BUT_UNVERIFIED');
    if (error instanceof MigrationError) throw error;
    fail('TARGET_APPLY_FAILED');
  }
}
