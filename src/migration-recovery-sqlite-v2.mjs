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
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite';

import {
  MIGRATION_SPEC_VERSION,
  MIGRATION_VERSION,
  MigrationError,
  canonicalJson,
  parseResourceMap,
  sha256Digest,
} from './migration-v2.mjs';
import {
  readResourceMapFile,
  readV1Source,
  verifyUploadManifest,
} from './migration-sqlite-v2.mjs';
import {
  hasExactPermissions,
  pathsEqual,
  supportsDirectoryFsync,
} from './platform-filesystem.mjs';

const FIXTURE_PREFIX = 'jenn-shooting-migration-fixture-';
const SIDECAR_SUFFIXES = Object.freeze(['-wal', '-shm', '-journal']);
const V1_TABLES = Object.freeze(['schedule_state', 'operations', 'audit_log', 'uploads']);
const COPY_BUFFER_SIZE = 64 * 1024;

function fail(code, result, message = code) {
  throw new MigrationError(code, result, message);
}

function lstatOrNull(path) {
  try {
    return lstatSync(path, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function stableStat(metadata) {
  return {
    dev: metadata.dev.toString(),
    ino: metadata.ino.toString(),
    size: metadata.size.toString(),
    mtimeNs: metadata.mtimeNs.toString(),
    ctimeNs: metadata.ctimeNs.toString(),
  };
}

function databaseFamily(path, code, result) {
  const entry = candidate => {
    let metadata;
    try {
      metadata = lstatSync(candidate, { bigint: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      fail(code, result);
    }
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1n) fail(code, result);
    return stableStat(metadata);
  };
  const family = {
    database: entry(path),
    wal: entry(`${path}-wal`),
    shm: entry(`${path}-shm`),
    journal: entry(`${path}-journal`),
  };
  if (!family.database) fail(code, result);
  return family;
}

function assertDatabaseFamily(path, baseline, code, result) {
  if (canonicalJson(databaseFamily(path, code, result)) !== canonicalJson(baseline)) fail(code, result);
}

function assertSameStat(left, right, code, result) {
  if (canonicalJson(stableStat(left)) !== canonicalJson(stableStat(right))) fail(code, result);
}

function assertFixtureRoot(fixtureRoot) {
  if (typeof fixtureRoot !== 'string' || !isAbsolute(fixtureRoot) || fixtureRoot.includes('\0')) {
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
  const resolved = resolve(fixtureRoot);
  const linkMetadata = lstatOrNull(resolved);
  if (!linkMetadata || linkMetadata.isSymbolicLink() || !linkMetadata.isDirectory()) {
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
  const realRoot = realpathSync(resolved);
  const realTmp = realpathSync(tmpdir());
  const metadata = statSync(realRoot, { bigint: true });
  if (!pathsEqual(dirname(realRoot), realTmp) || !basename(realRoot).startsWith(FIXTURE_PREFIX)) {
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
  if (!hasExactPermissions(metadata, 0o700n)
      || (typeof process.getuid === 'function' && metadata.uid !== BigInt(process.getuid()))) {
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
  return { realPath: realRoot, metadata };
}

function assertInsideRoot(path, root) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) {
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
  const resolved = resolve(path);
  const relation = relative(root.realPath, resolved);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
  return resolved;
}

function existingFixtureFile(path, root, code = 'PATH_IDENTITY_CONFLICT') {
  const candidate = assertInsideRoot(path, root);
  const linkMetadata = lstatOrNull(candidate);
  if (!linkMetadata || linkMetadata.isSymbolicLink() || !linkMetadata.isFile()) {
    fail(code, 'INVALID_USAGE');
  }
  const realPath = realpathSync(candidate);
  if (!pathsEqual(realPath, candidate)) fail(code, 'INVALID_USAGE');
  const metadata = statSync(realPath, { bigint: true });
  if (metadata.nlink !== 1n) fail(code, 'INVALID_USAGE');
  return {
    realPath,
    pathDigest: sha256Digest(realPath),
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    metadata,
  };
}

function existingFixtureDirectory(path, root) {
  const candidate = assertInsideRoot(path, root);
  const linkMetadata = lstatOrNull(candidate);
  if (!linkMetadata || linkMetadata.isSymbolicLink() || !linkMetadata.isDirectory()) {
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
  const realPath = realpathSync(candidate);
  if (!pathsEqual(realPath, candidate)) fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  const metadata = statSync(realPath, { bigint: true });
  return {
    realPath,
    pathDigest: sha256Digest(realPath),
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    metadata,
  };
}

function assertRootStable(root) {
  const current = lstatOrNull(root.realPath);
  if (!current || current.isSymbolicLink() || !current.isDirectory()
      || !sameIdentity(current, root.metadata)
      || !hasExactPermissions(current, 0o700n)) {
    fail('DESTINATION_PARENT_CHANGED', 'INVALID_USAGE');
  }
}

function fsyncDirectory(path, code, result) {
  if (!supportsDirectoryFsync()) return;
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
    fsyncSync(descriptor);
  } catch {
    fail(code, result);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function assertNoSidecars(path, code, result) {
  for (const suffix of SIDECAR_SUFFIXES) {
    if (lstatOrNull(`${path}${suffix}`)) fail(code, result);
  }
}

function assertExistingIdentity(info, code, result) {
  const metadata = lstatOrNull(info.realPath);
  if (!metadata || metadata.isSymbolicLink() || !metadata.isFile()
      || metadata.nlink !== 1n
      || metadata.dev.toString() !== info.device
      || metadata.ino.toString() !== info.inode) {
    fail(code, result);
  }
}

function assertExistingDirectoryIdentity(info, code, result) {
  if (!info) return;
  const metadata = lstatOrNull(info.realPath);
  if (!metadata || metadata.isSymbolicLink() || !metadata.isDirectory()
      || metadata.dev.toString() !== info.device
      || metadata.ino.toString() !== info.inode) {
    fail(code, result);
  }
}

function prepareNewArtifact(path, root, conflicts) {
  const candidate = assertInsideRoot(path, root);
  const parentPath = dirname(candidate);
  const parentLink = lstatOrNull(parentPath);
  if (!parentLink || parentLink.isSymbolicLink() || !parentLink.isDirectory()) {
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
  const parentRealPath = realpathSync(parentPath);
  if (!pathsEqual(parentRealPath, parentPath)) fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  const parentMetadata = statSync(parentRealPath, { bigint: true });
  const candidateMetadata = lstatOrNull(candidate);
  if (candidateMetadata) {
    if (candidateMetadata.isSymbolicLink()) fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
    if (conflicts.some(conflict => (
      BigInt(conflict.device) === candidateMetadata.dev && BigInt(conflict.inode) === candidateMetadata.ino
    ))) fail('PATH_IDENTITY_CONFLICT', 'INVALID_USAGE');
    fail('DESTINATION_EXISTS', 'INVALID_USAGE');
  }
  for (const suffix of SIDECAR_SUFFIXES) {
    if (lstatOrNull(`${candidate}${suffix}`)) fail('DESTINATION_SIDECAR_EXISTS', 'INVALID_USAGE');
  }
  if (conflicts.some(conflict => pathsEqual(conflict.realPath, candidate))) {
    fail('PATH_IDENTITY_CONFLICT', 'INVALID_USAGE');
  }
  return {
    path: candidate,
    pathDigest: sha256Digest(candidate),
    parentRealPath,
    parentMetadata,
  };
}

function assertParentStable(prepared) {
  const linkMetadata = lstatOrNull(prepared.parentRealPath);
  if (!linkMetadata || linkMetadata.isSymbolicLink() || !linkMetadata.isDirectory()) {
    fail('DESTINATION_PARENT_CHANGED', 'INVALID_USAGE');
  }
  const current = statSync(prepared.parentRealPath, { bigint: true });
  if (!sameIdentity(current, prepared.parentMetadata)) {
    fail('DESTINATION_PARENT_CHANGED', 'INVALID_USAGE');
  }
}

function createExclusiveArtifact(prepared) {
  assertParentStable(prepared);
  let descriptor;
  try {
    descriptor = openSync(
      prepared.path,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW | fsConstants.O_RDWR,
      0o600,
    );
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'ELOOP') fail('DESTINATION_EXISTS', 'INVALID_USAGE');
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
  const created = fstatSync(descriptor, { bigint: true });
  if (!created.isFile() || created.nlink !== 1n || !hasExactPermissions(created, 0o600n)) {
    closeSync(descriptor);
    fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  }
  assertParentStable(prepared);
  return { descriptor, metadata: created };
}

function assertArtifactIdentity(prepared, created, code, result) {
  assertParentStable(prepared);
  const pathMetadata = lstatOrNull(prepared.path);
  if (!pathMetadata || pathMetadata.isSymbolicLink() || !pathMetadata.isFile()
      || pathMetadata.nlink !== 1n || !hasExactPermissions(pathMetadata, 0o600n)
      || !sameIdentity(pathMetadata, created.metadata)) {
    fail(code, result);
  }
  for (const suffix of SIDECAR_SUFFIXES) {
    if (lstatOrNull(`${prepared.path}${suffix}`)) fail(code, result);
  }
  return pathMetadata;
}

function hashFileStable(path, invalidCode, invalidResult) {
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) fail(invalidCode, invalidResult);
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_SIZE);
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = fstatSync(descriptor, { bigint: true });
    assertSameStat(before, after, invalidCode, invalidResult);
    return `sha256:${hash.digest('hex')}`;
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    fail(invalidCode, invalidResult);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function integrityAndCounts(path, invalidCode, invalidResult) {
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec('PRAGMA query_only = ON; PRAGMA foreign_keys = ON;');
    if (Number(db.prepare('PRAGMA query_only').get()?.query_only) !== 1) fail(invalidCode, invalidResult);
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') fail(invalidCode, invalidResult);
    const rowCounts = Object.fromEntries(V1_TABLES.map(table => [
      table,
      db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
    ]));
    return { integrity: 'ok', rowCounts };
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    fail(invalidCode, invalidResult);
  } finally {
    try { db?.close(); } catch {}
  }
}

function normalizeBackupJournal(path) {
  let db;
  try {
    db = new DatabaseSync(path);
    const mode = db.prepare('PRAGMA journal_mode = DELETE').get()?.journal_mode;
    if (String(mode).toLowerCase() !== 'delete') fail('BACKUP_CREATE_FAILED', 'INVALID_SOURCE');
    db.exec('PRAGMA synchronous = FULL;');
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    fail('BACKUP_CREATE_FAILED', 'INVALID_SOURCE');
  } finally {
    try { db?.close(); } catch {}
  }
}

function assertSourceMatchesPlan(source, plan, code, result) {
  if (!plan?.source
      || source.schemaDigest !== plan.source.schemaDigest
      || source.structuralDigest !== plan.source.structuralDigest
      || canonicalJson(source.snapshot) !== canonicalJson(plan.source.snapshot)
      || canonicalJson(source.operations) !== canonicalJson(plan.source.operations)
      || canonicalJson(source.uploads) !== canonicalJson(plan.source.uploads)
      || canonicalJson(source.auditSummary) !== canonicalJson(plan.source.auditSummary)) {
    fail(code, result);
  }
}

function attachmentEvidence(uploadRootInfo, plan, duringFileScan) {
  if (uploadRootInfo) {
    for (const upload of plan.records.uploads) {
      if (upload.stored_name === null) continue;
      const candidate = resolve(uploadRootInfo.realPath, upload.stored_name);
      const metadata = lstatOrNull(candidate);
      if (!metadata || metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1n) {
        fail('UPLOAD_PATH_UNSAFE', 'INVALID_SOURCE');
      }
    }
  }
  const summary = verifyUploadManifest(uploadRootInfo, plan, {
    hashUploads: true,
    duringFileScan,
  });
  const entries = plan.records.uploads.map(upload => ({
    idDigest: sha256Digest(upload.id),
    claimedTaskDigest: upload.claimed_task_id === null ? null : sha256Digest(upload.claimed_task_id),
    storedNameDigest: upload.stored_name === null ? null : sha256Digest(upload.stored_name),
    size: upload.size,
    expectedHashDigest: sha256Digest(upload.sha256),
  })).toSorted((left, right) => left.idDigest.localeCompare(right.idDigest));
  return {
    summary,
    digest: sha256Digest({ entries, summary }),
  };
}

function attachmentPhysicalIdentity(uploadRootInfo, plan, code = 'UPLOAD_MANIFEST_MISMATCH') {
  if (!uploadRootInfo) return { root: null, files: [] };
  const rootMetadata = lstatOrNull(uploadRootInfo.realPath);
  if (!rootMetadata || rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    fail(code, 'INVALID_SOURCE');
  }
  const rootPrefix = `${uploadRootInfo.realPath}${sep}`;
  const files = plan.records.uploads.filter(upload => upload.stored_name !== null).map(upload => {
    const candidate = resolve(uploadRootInfo.realPath, upload.stored_name);
    if (!candidate.startsWith(rootPrefix)) fail(code, 'INVALID_SOURCE');
    const metadata = lstatOrNull(candidate);
    if (!metadata || metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1n) {
      fail(code, 'INVALID_SOURCE');
    }
    return {
      idDigest: sha256Digest(upload.id),
      pathDigest: sha256Digest(candidate),
      stat: stableStat(metadata),
    };
  }).toSorted((left, right) => left.idDigest.localeCompare(right.idDigest));
  return { root: stableStat(rootMetadata), files };
}

function assertAttachmentPhysicalIdentity(uploadRootInfo, plan, baseline, code, result) {
  const current = attachmentPhysicalIdentity(uploadRootInfo, plan, code);
  if (canonicalJson(current) !== canonicalJson(baseline)) fail(code, result);
}

function collectEvidence(pathInfo, plan, invalidCode, invalidResult, { duringScan } = {}) {
  try {
    const source = readV1Source(pathInfo, { duringScan });
    assertSourceMatchesPlan(source, plan, invalidCode, invalidResult);
    const checked = integrityAndCounts(pathInfo.realPath, invalidCode, invalidResult);
    const snapshotCanonicalDigest = sha256Digest(source.snapshot);
    const databaseEvidenceDigest = sha256Digest({
      schemaDigest: source.schemaDigest,
      structuralDigest: source.structuralDigest,
      snapshotRevision: source.snapshot.revision,
      snapshotCanonicalDigest,
      rowCounts: checked.rowCounts,
      auditSummary: source.auditSummary,
    });
    return {
      source,
      integrity: checked.integrity,
      rowCounts: checked.rowCounts,
      snapshotRevision: source.snapshot.revision,
      snapshotCanonicalDigest,
      databaseEvidenceDigest,
    };
  } catch (error) {
    if (error instanceof MigrationError && error.code === invalidCode) throw error;
    fail(invalidCode, invalidResult);
  }
}

function comparableEvidence(evidence) {
  return {
    integrity: evidence.integrity,
    rowCounts: evidence.rowCounts,
    snapshotRevision: evidence.snapshotRevision,
    snapshotCanonicalDigest: evidence.snapshotCanonicalDigest,
    databaseEvidenceDigest: evidence.databaseEvidenceDigest,
  };
}

function resolveUploadRoot(uploadRoot, root) {
  if (uploadRoot === undefined || uploadRoot === null) return undefined;
  return existingFixtureDirectory(uploadRoot, root);
}

function validateResourceMapPath(resourceMapPath, root, sourceInfo, plan) {
  if (!plan.resourceMap && resourceMapPath === undefined) return undefined;
  if (typeof resourceMapPath !== 'string') fail('UNSAFE_DESTINATION', 'INVALID_USAGE');
  const resourceMapInfo = existingFixtureFile(resourceMapPath, root);
  if (sameIdentity(resourceMapInfo.metadata, sourceInfo.metadata)) {
    fail('PATH_IDENTITY_CONFLICT', 'INVALID_USAGE');
  }
  const parsed = parseResourceMap(readResourceMapFile(resourceMapInfo), plan.businessTimeZone);
  if (!plan.resourceMap
      || parsed.digest !== plan.resourceMap.digest
      || parsed.mapVersion !== plan.resourceMap.mapVersion) {
    fail('BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  }
  return resourceMapInfo;
}

function sourceIdentityDigest(sourceInfo) {
  return sha256Digest({
    pathDigest: sourceInfo.pathDigest,
    device: sourceInfo.device,
    inode: sourceInfo.inode,
  });
}

function assertRecoveryArtifactMode(info, code, result) {
  const metadata = lstatOrNull(info.realPath);
  if (!metadata || !hasExactPermissions(metadata, 0o600n)) fail(code, result);
}

function backupProofIdentity(receipt) {
  return sha256Digest({
    artifactDigest: receipt.artifactDigest,
    databaseEvidenceDigest: receipt.databaseEvidenceDigest,
    uploadManifestDigest: receipt.uploadManifestDigest,
    sourceIdentityDigest: receipt.sourceIdentityDigest,
    migrationSpecVersion: receipt.migrationSpecVersion,
    migrationVersion: receipt.migrationVersion,
    configurationDigest: receipt.configurationDigest,
    resourceMapDigest: receipt.resourceMapDigest,
    businessTimeZone: receipt.businessTimeZone,
  });
}

function rollbackProofIdentity(receipt) {
  return sha256Digest({
    backupProofIdentity: receipt.backupProofIdentity,
    artifactDigest: receipt.artifactDigest,
    databaseEvidenceDigest: receipt.databaseEvidenceDigest,
    uploadManifestDigest: receipt.uploadManifestDigest,
  });
}

export async function createVerifiedBackup({
  fixtureRoot,
  source,
  backup,
  plan,
  uploadRoot,
  resourceMapPath,
  expectedAttachmentDigest,
  duringBackup,
  duringFileScan,
  duringSourceScan,
  duringVerification,
} = {}) {
  const root = assertFixtureRoot(fixtureRoot);
  const sourceInfo = existingFixtureFile(source, root);
  const sourceFamilyBaseline = databaseFamily(
    sourceInfo.realPath,
    'BACKUP_EVIDENCE_MISMATCH',
    'INVALID_SOURCE',
  );
  const uploadRootInfo = resolveUploadRoot(uploadRoot, root);
  const attachmentIdentityBaseline = attachmentPhysicalIdentity(uploadRootInfo, plan);
  const resourceMapInfo = validateResourceMapPath(resourceMapPath, root, sourceInfo, plan);
  const prepared = prepareNewArtifact(backup, root, [sourceInfo]);
  const sourceBefore = collectEvidence(
    sourceInfo,
    plan,
    'BACKUP_EVIDENCE_MISMATCH',
    'INVALID_SOURCE',
    { duringScan: duringSourceScan },
  );
  const attachmentsBefore = attachmentEvidence(uploadRootInfo, plan, duringFileScan);
  const created = createExclusiveArtifact(prepared);
  let sourceDb;
  try {
    sourceDb = new DatabaseSync(sourceInfo.realPath, { readOnly: true });
    sourceDb.exec('PRAGMA query_only = ON; PRAGMA foreign_keys = ON;');
    await sqliteBackup(sourceDb, prepared.path);
    normalizeBackupJournal(prepared.path);
    if (duringBackup) await duringBackup();
    fsyncSync(created.descriptor);
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    fail('BACKUP_CREATE_FAILED', 'INVALID_SOURCE');
  } finally {
    try { sourceDb?.close(); } catch {}
    closeSync(created.descriptor);
  }
  assertArtifactIdentity(prepared, created, 'BACKUP_CREATE_FAILED', 'INVALID_SOURCE');
  fsyncDirectory(prepared.parentRealPath, 'BACKUP_CREATE_FAILED', 'INVALID_SOURCE');
  assertRootStable(root);
  const backupFamilyBaseline = databaseFamily(
    prepared.path,
    'BACKUP_EVIDENCE_MISMATCH',
    'INVALID_SOURCE',
  );
  const sourceAfter = collectEvidence(sourceInfo, plan, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  assertExistingIdentity(sourceInfo, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  if (canonicalJson(comparableEvidence(sourceBefore)) !== canonicalJson(comparableEvidence(sourceAfter))) {
    fail('BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  }
  const attachmentsAfter = attachmentEvidence(uploadRootInfo, plan);
  if (attachmentsBefore.digest !== attachmentsAfter.digest) fail('UPLOAD_MANIFEST_MISMATCH', 'INVALID_SOURCE');
  if (expectedAttachmentDigest !== undefined && expectedAttachmentDigest !== attachmentsAfter.digest) {
    fail('UPLOAD_MANIFEST_MISMATCH', 'INVALID_SOURCE');
  }

  const backupInfo = existingFixtureFile(prepared.path, root);
  const backupEvidence = collectEvidence(backupInfo, plan, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  if (canonicalJson(comparableEvidence(sourceBefore)) !== canonicalJson(comparableEvidence(backupEvidence))) {
    fail('BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  }
  const artifactDigest = hashFileStable(prepared.path, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  if (duringVerification) duringVerification();
  assertDatabaseFamily(
    sourceInfo.realPath,
    sourceFamilyBaseline,
    'BACKUP_EVIDENCE_MISMATCH',
    'INVALID_SOURCE',
  );
  assertDatabaseFamily(
    backupInfo.realPath,
    backupFamilyBaseline,
    'BACKUP_EVIDENCE_MISMATCH',
    'INVALID_SOURCE',
  );
  assertNoSidecars(backupInfo.realPath, 'BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  assertAttachmentPhysicalIdentity(
    uploadRootInfo,
    plan,
    attachmentIdentityBaseline,
    'UPLOAD_MANIFEST_MISMATCH',
    'INVALID_SOURCE',
  );
  assertExistingIdentity(backupInfo, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  assertExistingDirectoryIdentity(uploadRootInfo, 'UPLOAD_MANIFEST_MISMATCH', 'INVALID_SOURCE');
  if (resourceMapInfo) assertExistingIdentity(resourceMapInfo, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  const receipt = {
    status: 'BACKUP_VERIFIED',
    backupInfo: Object.freeze({
      pathDigest: backupInfo.pathDigest,
    }),
    artifactDigest,
    databaseEvidenceDigest: backupEvidence.databaseEvidenceDigest,
    schemaDigest: backupEvidence.source.schemaDigest,
    structuralDigest: backupEvidence.source.structuralDigest,
    snapshotRevision: backupEvidence.snapshotRevision,
    snapshotCanonicalDigest: backupEvidence.snapshotCanonicalDigest,
    rowCounts: Object.freeze({ ...backupEvidence.rowCounts }),
    auditSummary: Object.freeze({ ...backupEvidence.source.auditSummary }),
    uploadManifestDigest: attachmentsAfter.digest,
    sourceIdentityDigest: sourceIdentityDigest(sourceInfo),
    migrationSpecVersion: MIGRATION_SPEC_VERSION,
    migrationVersion: MIGRATION_VERSION,
    configurationDigest: plan.configurationDigest,
    resourceMapDigest: plan.resourceMap?.digest ?? null,
    businessTimeZone: plan.businessTimeZone,
  };
  return Object.freeze({ ...receipt, backupProofIdentity: backupProofIdentity(receipt) });
}

function assertBackupReceipt(receipt, evidence, artifactDigest, attachments, plan) {
  if (receipt?.status !== 'BACKUP_VERIFIED'
      || receipt.artifactDigest !== artifactDigest
      || receipt.databaseEvidenceDigest !== evidence.databaseEvidenceDigest
      || receipt.schemaDigest !== evidence.source.schemaDigest
      || receipt.structuralDigest !== evidence.source.structuralDigest
      || receipt.snapshotRevision !== evidence.snapshotRevision
      || receipt.snapshotCanonicalDigest !== evidence.snapshotCanonicalDigest
      || canonicalJson(receipt.rowCounts) !== canonicalJson(evidence.rowCounts)
      || canonicalJson(receipt.auditSummary) !== canonicalJson(evidence.source.auditSummary)
      || receipt.uploadManifestDigest !== attachments.digest
      || receipt.migrationSpecVersion !== MIGRATION_SPEC_VERSION
      || receipt.migrationVersion !== MIGRATION_VERSION
      || receipt.configurationDigest !== plan.configurationDigest
      || receipt.resourceMapDigest !== (plan.resourceMap?.digest ?? null)
      || receipt.businessTimeZone !== plan.businessTimeZone) {
    fail('BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  }
  if (receipt.backupProofIdentity !== backupProofIdentity(receipt)) {
    fail('BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  }
}

function assertCurrentSourceReceipt(receipt, sourceInfo, evidence, attachments) {
  if (receipt.sourceIdentityDigest !== sourceIdentityDigest(sourceInfo)
      || receipt.databaseEvidenceDigest !== evidence.databaseEvidenceDigest
      || receipt.uploadManifestDigest !== attachments.digest) {
    fail('BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  }
}

export function verifyExistingBackup({
  fixtureRoot,
  source,
  backup,
  plan,
  uploadRoot,
  resourceMapPath,
  expectedAttachmentDigest,
  duringVerification,
} = {}) {
  const root = assertFixtureRoot(fixtureRoot);
  const sourceInfo = existingFixtureFile(source, root);
  const backupInfo = existingFixtureFile(backup, root);
  if (sameIdentity(sourceInfo.metadata, backupInfo.metadata)) fail('PATH_IDENTITY_CONFLICT', 'INVALID_USAGE');
  assertNoSidecars(backupInfo.realPath, 'BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  assertRecoveryArtifactMode(backupInfo, 'BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  const sourceFamilyBaseline = databaseFamily(
    sourceInfo.realPath,
    'BACKUP_EVIDENCE_MISMATCH',
    'INVALID_SOURCE',
  );
  const backupFamilyBaseline = databaseFamily(
    backupInfo.realPath,
    'BACKUP_EVIDENCE_MISMATCH',
    'INVALID_SOURCE',
  );
  const uploadRootInfo = resolveUploadRoot(uploadRoot, root);
  const attachmentIdentityBaseline = attachmentPhysicalIdentity(uploadRootInfo, plan);
  const resourceMapInfo = validateResourceMapPath(resourceMapPath, root, sourceInfo, plan);
  const sourceEvidence = collectEvidence(sourceInfo, plan, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  const backupEvidence = collectEvidence(backupInfo, plan, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  if (canonicalJson(comparableEvidence(sourceEvidence)) !== canonicalJson(comparableEvidence(backupEvidence))) {
    fail('BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  }
  const attachments = attachmentEvidence(uploadRootInfo, plan);
  if (expectedAttachmentDigest !== undefined && expectedAttachmentDigest !== attachments.digest) {
    fail('UPLOAD_MANIFEST_MISMATCH', 'INVALID_SOURCE');
  }
  const artifactDigest = hashFileStable(backupInfo.realPath, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  if (duringVerification) duringVerification();
  assertNoSidecars(backupInfo.realPath, 'BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  assertDatabaseFamily(
    sourceInfo.realPath,
    sourceFamilyBaseline,
    'BACKUP_EVIDENCE_MISMATCH',
    'INVALID_SOURCE',
  );
  assertDatabaseFamily(
    backupInfo.realPath,
    backupFamilyBaseline,
    'BACKUP_EVIDENCE_MISMATCH',
    'INVALID_SOURCE',
  );
  assertAttachmentPhysicalIdentity(
    uploadRootInfo,
    plan,
    attachmentIdentityBaseline,
    'UPLOAD_MANIFEST_MISMATCH',
    'INVALID_SOURCE',
  );
  assertExistingIdentity(sourceInfo, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  assertExistingIdentity(backupInfo, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  assertExistingDirectoryIdentity(uploadRootInfo, 'UPLOAD_MANIFEST_MISMATCH', 'INVALID_SOURCE');
  if (resourceMapInfo) assertExistingIdentity(resourceMapInfo, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  assertRootStable(root);
  const receipt = {
    status: 'BACKUP_VERIFIED',
    backupInfo: Object.freeze({
      pathDigest: backupInfo.pathDigest,
    }),
    artifactDigest,
    databaseEvidenceDigest: backupEvidence.databaseEvidenceDigest,
    schemaDigest: backupEvidence.source.schemaDigest,
    structuralDigest: backupEvidence.source.structuralDigest,
    snapshotRevision: backupEvidence.snapshotRevision,
    snapshotCanonicalDigest: backupEvidence.snapshotCanonicalDigest,
    rowCounts: Object.freeze({ ...backupEvidence.rowCounts }),
    auditSummary: Object.freeze({ ...backupEvidence.source.auditSummary }),
    uploadManifestDigest: attachments.digest,
    sourceIdentityDigest: sourceIdentityDigest(sourceInfo),
    migrationSpecVersion: MIGRATION_SPEC_VERSION,
    migrationVersion: MIGRATION_VERSION,
    configurationDigest: plan.configurationDigest,
    resourceMapDigest: plan.resourceMap?.digest ?? null,
    businessTimeZone: plan.businessTimeZone,
  };
  return Object.freeze({ ...receipt, backupProofIdentity: backupProofIdentity(receipt) });
}

function copyExclusive(sourcePath, prepared, duringCopy) {
  const created = createExclusiveArtifact(prepared);
  let sourceDescriptor;
  try {
    sourceDescriptor = openSync(sourcePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const sourceBefore = fstatSync(sourceDescriptor, { bigint: true });
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_SIZE);
    let chunk = 0;
    while (true) {
      const bytesRead = readSync(sourceDescriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      let offset = 0;
      while (offset < bytesRead) {
        offset += writeSync(created.descriptor, buffer, offset, bytesRead - offset);
      }
      chunk += 1;
      if (duringCopy) duringCopy({ chunk, bytesWritten: bytesRead });
    }
    fsyncSync(created.descriptor);
    const sourceAfter = fstatSync(sourceDescriptor, { bigint: true });
    assertSameStat(sourceBefore, sourceAfter, 'ROLLBACK_RESTORE_FAILED', 'INVALID_TARGET');
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    fail('ROLLBACK_RESTORE_FAILED', 'INVALID_TARGET');
  } finally {
    if (sourceDescriptor !== undefined) closeSync(sourceDescriptor);
    closeSync(created.descriptor);
  }
  assertArtifactIdentity(prepared, created, 'ROLLBACK_RESTORE_FAILED', 'INVALID_TARGET');
  fsyncDirectory(prepared.parentRealPath, 'ROLLBACK_RESTORE_FAILED', 'INVALID_TARGET');
}

export function restoreVerifiedBackup({
  fixtureRoot,
  source,
  backup,
  rollbackTarget,
  plan,
  backupReceipt,
  uploadRoot,
  resourceMapPath,
  expectedAttachmentDigest,
  duringCopy,
  afterCopy,
  duringVerification,
} = {}) {
  const root = assertFixtureRoot(fixtureRoot);
  const sourceInfo = existingFixtureFile(source, root);
  const backupInfo = existingFixtureFile(backup, root);
  if (sameIdentity(sourceInfo.metadata, backupInfo.metadata)) fail('PATH_IDENTITY_CONFLICT', 'INVALID_USAGE');
  assertNoSidecars(backupInfo.realPath, 'BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  assertRecoveryArtifactMode(backupInfo, 'BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  const sourceFamilyBaseline = databaseFamily(
    sourceInfo.realPath,
    'BACKUP_EVIDENCE_MISMATCH',
    'INVALID_SOURCE',
  );
  const backupFamilyBaseline = databaseFamily(
    backupInfo.realPath,
    'BACKUP_EVIDENCE_MISMATCH',
    'INVALID_SOURCE',
  );
  const uploadRootInfo = resolveUploadRoot(uploadRoot, root);
  const attachmentIdentityBaseline = attachmentPhysicalIdentity(uploadRootInfo, plan);
  const resourceMapInfo = validateResourceMapPath(resourceMapPath, root, sourceInfo, plan);
  const sourceEvidence = collectEvidence(sourceInfo, plan, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  const backupEvidence = collectEvidence(backupInfo, plan, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  const artifactDigest = hashFileStable(backupInfo.realPath, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  const attachments = attachmentEvidence(uploadRootInfo, plan);
  if (expectedAttachmentDigest !== undefined && expectedAttachmentDigest !== attachments.digest) {
    fail('UPLOAD_MANIFEST_MISMATCH', 'INVALID_SOURCE');
  }
  assertBackupReceipt(backupReceipt, backupEvidence, artifactDigest, attachments, plan);
  assertCurrentSourceReceipt(backupReceipt, sourceInfo, sourceEvidence, attachments);
  const prepared = prepareNewArtifact(rollbackTarget, root, [sourceInfo, backupInfo]);
  copyExclusive(backupInfo.realPath, prepared, duringCopy);
  assertRootStable(root);
  const restoredFamilyBaseline = databaseFamily(
    prepared.path,
    'ROLLBACK_EVIDENCE_MISMATCH',
    'INVALID_TARGET',
  );
  if (afterCopy) afterCopy(prepared.path);

  const restoredInfo = existingFixtureFile(prepared.path, root);
  const restoredEvidence = collectEvidence(
    restoredInfo,
    plan,
    'ROLLBACK_EVIDENCE_MISMATCH',
    'INVALID_TARGET',
  );
  const restoredDigest = hashFileStable(
    restoredInfo.realPath,
    'ROLLBACK_EVIDENCE_MISMATCH',
    'INVALID_TARGET',
  );
  if (restoredDigest !== artifactDigest
      || canonicalJson(comparableEvidence(restoredEvidence)) !== canonicalJson(comparableEvidence(backupEvidence))) {
    fail('ROLLBACK_EVIDENCE_MISMATCH', 'INVALID_TARGET');
  }
  const restoredAttachments = attachmentEvidence(uploadRootInfo, plan);
  if (restoredAttachments.digest !== backupReceipt.uploadManifestDigest) {
    fail('ROLLBACK_EVIDENCE_MISMATCH', 'INVALID_TARGET');
  }
  if (duringVerification) duringVerification();
  assertNoSidecars(backupInfo.realPath, 'BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  assertNoSidecars(restoredInfo.realPath, 'ROLLBACK_NOT_VERIFIED', 'INVALID_TARGET');
  assertDatabaseFamily(
    sourceInfo.realPath,
    sourceFamilyBaseline,
    'BACKUP_NOT_VERIFIED',
    'INVALID_SOURCE',
  );
  assertDatabaseFamily(
    backupInfo.realPath,
    backupFamilyBaseline,
    'BACKUP_NOT_VERIFIED',
    'INVALID_SOURCE',
  );
  assertDatabaseFamily(
    restoredInfo.realPath,
    restoredFamilyBaseline,
    'ROLLBACK_EVIDENCE_MISMATCH',
    'INVALID_TARGET',
  );
  assertAttachmentPhysicalIdentity(
    uploadRootInfo,
    plan,
    attachmentIdentityBaseline,
    'ROLLBACK_EVIDENCE_MISMATCH',
    'INVALID_TARGET',
  );
  assertExistingIdentity(sourceInfo, 'BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  assertExistingIdentity(backupInfo, 'BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  assertExistingIdentity(restoredInfo, 'ROLLBACK_EVIDENCE_MISMATCH', 'INVALID_TARGET');
  assertExistingDirectoryIdentity(uploadRootInfo, 'ROLLBACK_EVIDENCE_MISMATCH', 'INVALID_TARGET');
  if (resourceMapInfo) assertExistingIdentity(resourceMapInfo, 'BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  assertRootStable(root);
  const receipt = {
    status: 'ROLLBACK_VERIFIED',
    rollbackInfo: Object.freeze({
      pathDigest: restoredInfo.pathDigest,
    }),
    artifactDigest: restoredDigest,
    databaseEvidenceDigest: restoredEvidence.databaseEvidenceDigest,
    uploadManifestDigest: restoredAttachments.digest,
    backupProofIdentity: backupReceipt.backupProofIdentity,
  };
  return Object.freeze({ ...receipt, rollbackProofIdentity: rollbackProofIdentity(receipt) });
}

export function verifyExistingRestore({
  fixtureRoot,
  source,
  backup,
  rollbackTarget,
  plan,
  backupReceipt,
  uploadRoot,
  resourceMapPath,
  expectedAttachmentDigest,
  duringVerification,
} = {}) {
  const root = assertFixtureRoot(fixtureRoot);
  const sourceInfo = existingFixtureFile(source, root);
  const backupInfo = existingFixtureFile(backup, root);
  const restoredInfo = existingFixtureFile(rollbackTarget, root);
  if (sameIdentity(sourceInfo.metadata, backupInfo.metadata)
      || sameIdentity(sourceInfo.metadata, restoredInfo.metadata)
      || sameIdentity(backupInfo.metadata, restoredInfo.metadata)) {
    fail('PATH_IDENTITY_CONFLICT', 'INVALID_USAGE');
  }
  assertNoSidecars(backupInfo.realPath, 'BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  assertNoSidecars(restoredInfo.realPath, 'ROLLBACK_NOT_VERIFIED', 'INVALID_TARGET');
  assertRecoveryArtifactMode(backupInfo, 'BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  assertRecoveryArtifactMode(restoredInfo, 'ROLLBACK_NOT_VERIFIED', 'INVALID_TARGET');
  const sourceFamilyBaseline = databaseFamily(
    sourceInfo.realPath,
    'BACKUP_EVIDENCE_MISMATCH',
    'INVALID_SOURCE',
  );
  const backupFamilyBaseline = databaseFamily(
    backupInfo.realPath,
    'BACKUP_EVIDENCE_MISMATCH',
    'INVALID_SOURCE',
  );
  const restoredFamilyBaseline = databaseFamily(
    restoredInfo.realPath,
    'ROLLBACK_EVIDENCE_MISMATCH',
    'INVALID_TARGET',
  );
  const uploadRootInfo = resolveUploadRoot(uploadRoot, root);
  const attachmentIdentityBaseline = attachmentPhysicalIdentity(uploadRootInfo, plan);
  const resourceMapInfo = validateResourceMapPath(resourceMapPath, root, sourceInfo, plan);
  const sourceEvidence = collectEvidence(sourceInfo, plan, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  const backupEvidence = collectEvidence(backupInfo, plan, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  const restoredEvidence = collectEvidence(
    restoredInfo,
    plan,
    'ROLLBACK_EVIDENCE_MISMATCH',
    'INVALID_TARGET',
  );
  const attachments = attachmentEvidence(uploadRootInfo, plan);
  if (expectedAttachmentDigest !== undefined && expectedAttachmentDigest !== attachments.digest) {
    fail('UPLOAD_MANIFEST_MISMATCH', 'INVALID_SOURCE');
  }
  const backupDigest = hashFileStable(backupInfo.realPath, 'BACKUP_EVIDENCE_MISMATCH', 'INVALID_SOURCE');
  const restoredDigest = hashFileStable(
    restoredInfo.realPath,
    'ROLLBACK_EVIDENCE_MISMATCH',
    'INVALID_TARGET',
  );
  assertBackupReceipt(backupReceipt, backupEvidence, backupDigest, attachments, plan);
  assertCurrentSourceReceipt(backupReceipt, sourceInfo, sourceEvidence, attachments);
  if (backupDigest !== restoredDigest
      || canonicalJson(comparableEvidence(backupEvidence)) !== canonicalJson(comparableEvidence(restoredEvidence))) {
    fail('ROLLBACK_NOT_VERIFIED', 'INVALID_TARGET');
  }
  if (duringVerification) duringVerification();
  assertNoSidecars(backupInfo.realPath, 'BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  assertNoSidecars(restoredInfo.realPath, 'ROLLBACK_NOT_VERIFIED', 'INVALID_TARGET');
  assertDatabaseFamily(
    sourceInfo.realPath,
    sourceFamilyBaseline,
    'BACKUP_NOT_VERIFIED',
    'INVALID_SOURCE',
  );
  assertDatabaseFamily(
    backupInfo.realPath,
    backupFamilyBaseline,
    'BACKUP_NOT_VERIFIED',
    'INVALID_SOURCE',
  );
  assertDatabaseFamily(
    restoredInfo.realPath,
    restoredFamilyBaseline,
    'ROLLBACK_NOT_VERIFIED',
    'INVALID_TARGET',
  );
  assertAttachmentPhysicalIdentity(
    uploadRootInfo,
    plan,
    attachmentIdentityBaseline,
    'ROLLBACK_NOT_VERIFIED',
    'INVALID_TARGET',
  );
  assertExistingIdentity(sourceInfo, 'BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  assertExistingIdentity(backupInfo, 'BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  assertExistingIdentity(restoredInfo, 'ROLLBACK_NOT_VERIFIED', 'INVALID_TARGET');
  assertExistingDirectoryIdentity(uploadRootInfo, 'ROLLBACK_NOT_VERIFIED', 'INVALID_TARGET');
  if (resourceMapInfo) assertExistingIdentity(resourceMapInfo, 'BACKUP_NOT_VERIFIED', 'INVALID_SOURCE');
  assertRootStable(root);
  const receipt = {
    status: 'ROLLBACK_VERIFIED',
    rollbackInfo: Object.freeze({
      pathDigest: restoredInfo.pathDigest,
    }),
    artifactDigest: restoredDigest,
    databaseEvidenceDigest: restoredEvidence.databaseEvidenceDigest,
    uploadManifestDigest: attachments.digest,
    backupProofIdentity: backupReceipt.backupProofIdentity,
  };
  return Object.freeze({ ...receipt, rollbackProofIdentity: rollbackProofIdentity(receipt) });
}
