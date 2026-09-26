import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
  writeSync,
} from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  MigrationError,
  canonicalJson,
  sha256Digest,
} from './migration-v2.mjs';
import {
  captureSqlitePhysicalFamily,
  resolveExistingPath,
  sameFile,
  sameSqlitePhysicalFamily,
} from './migration-sqlite-v2.mjs';
import {
  hasExactPermissions,
  supportsDirectoryFsync,
} from './platform-filesystem.mjs';

const COPY_BUFFER_BYTES = 64 * 1024;
const STORED_NAME = /^[a-f0-9]{64}\.[a-z0-9]+$/u;

function fail(code, result = 'INVALID_TARGET') {
  throw new MigrationError(code, result);
}

function sameStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function pathWithin(path, directory) {
  return path === directory || path.startsWith(`${directory}${sep}`);
}

function assertPathDomainsDisjoint(sourceDatabase, targetDatabase, sourceRoot, targetRoot) {
  if (sameFile(sourceDatabase, targetDatabase)) {
    fail('SOURCE_TARGET_DATABASE_CONFLICT', 'INVALID_USAGE');
  }
  if (sameFile(sourceRoot, targetRoot)
      || pathWithin(sourceRoot.realPath, targetRoot.realPath)
      || pathWithin(targetRoot.realPath, sourceRoot.realPath)) {
    fail('SOURCE_TARGET_UPLOAD_ROOT_CONFLICT', 'INVALID_USAGE');
  }
  for (const database of [sourceDatabase, targetDatabase]) {
    if (pathWithin(database.realPath, sourceRoot.realPath)
        || pathWithin(database.realPath, targetRoot.realPath)) {
      fail('DATABASE_UPLOAD_ROOT_CONFLICT', 'INVALID_USAGE');
    }
  }
}

function pathIdentity(info) {
  return Object.freeze({
    pathDigest: info.pathDigest,
    device: info.device,
    inode: info.inode,
  });
}

function parityScopeDigest(sourceDatabase, targetDatabase, sourceRoot, targetRoot) {
  return sha256Digest({
    schemaVersion: 1,
    sourceDatabase: pathIdentity(sourceDatabase),
    targetDatabase: pathIdentity(targetDatabase),
    sourceUploadRoot: pathIdentity(sourceRoot),
    targetUploadRoot: pathIdentity(targetRoot),
  });
}

function assertQuiescenceLease(lease, scopeDigest) {
  if (!lease
      || lease.kind !== 'ATTACHMENT_PARITY_QUIESCENCE_V1'
      || lease.scopeDigest !== scopeDigest
      || typeof lease.assertHeld !== 'function') {
    fail('ATTACHMENT_PARITY_QUIESCENCE_REQUIRED', 'BLOCKED_PREREQUISITE');
  }
  let held;
  try {
    held = lease.assertHeld();
  } catch {
    fail('ATTACHMENT_PARITY_QUIESCENCE_LOST', 'BLOCKED_PREREQUISITE');
  }
  if (held !== true) {
    fail('ATTACHMENT_PARITY_QUIESCENCE_LOST', 'BLOCKED_PREREQUISITE');
  }
}

export function describeAttachmentParityScope({
  sourceDatabasePath,
  sourceUploadRoot,
  targetDatabasePath,
  targetUploadRoot,
} = {}) {
  const sourceDatabase = resolveExistingPath(sourceDatabasePath, 'file');
  const targetDatabase = resolveExistingPath(targetDatabasePath, 'file');
  const sourceRoot = resolveExistingPath(sourceUploadRoot, 'directory');
  const targetRoot = resolveExistingPath(targetUploadRoot, 'directory');
  assertPathDomainsDisjoint(sourceDatabase, targetDatabase, sourceRoot, targetRoot);
  return Object.freeze({
    schemaVersion: 1,
    scopeDigest: parityScopeDigest(sourceDatabase, targetDatabase, sourceRoot, targetRoot),
  });
}

function fsyncDirectory(path) {
  if (!supportsDirectoryFsync()) return;
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
    fsyncSync(descriptor);
  } catch {
    fail('TARGET_UPLOAD_ROOT_CHANGED');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function assertDirectoryStable(info, code) {
  let current;
  try {
    current = lstatSync(info.realPath, { bigint: true });
  } catch {
    fail(code);
  }
  if (!current.isDirectory()
      || current.isSymbolicLink()
      || current.dev.toString() !== info.device
      || current.ino.toString() !== info.inode) {
    fail(code);
  }
  try {
    if (realpathSync(info.realPath) !== info.realPath) fail(code);
  } catch {
    fail(code);
  }
}

function assertDatabaseStable(info, code) {
  let current;
  try {
    current = lstatSync(info.realPath, { bigint: true });
  } catch {
    fail(code);
  }
  if (!current.isFile()
      || current.isSymbolicLink()
      || current.nlink !== 1n
      || current.dev.toString() !== info.device
      || current.ino.toString() !== info.inode) {
    fail(code);
  }
  try {
    if (realpathSync(info.realPath) !== info.realPath) fail(code);
  } catch {
    fail(code);
  }
  return current;
}

function captureDatabaseFamily(databaseInfo, code) {
  assertDatabaseStable(databaseInfo, code);
  try {
    return captureSqlitePhysicalFamily(databaseInfo, { includeDatabaseDigest: true });
  } catch {
    fail(code);
  }
}

function safeStoredName(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\0')
    && basename(value) === value
    && !value.includes('/')
    && !value.includes('\\')
    && STORED_NAME.test(value);
}

function readUploadFacts(databaseInfo, invalidCode) {
  const before = assertDatabaseStable(databaseInfo, invalidCode);
  let db;
  let inTransaction = false;
  try {
    db = new DatabaseSync(databaseInfo.realPath, { readOnly: true });
    assertDatabaseStable(databaseInfo, invalidCode);
    db.exec('PRAGMA query_only = ON; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const queryOnly = db.prepare('PRAGMA query_only').get();
    if (Number(queryOnly?.query_only) !== 1) fail(invalidCode, 'INVALID_TARGET');
    db.exec('BEGIN');
    inTransaction = true;
    assertDatabaseStable(databaseInfo, invalidCode);
    const rows = db.prepare(`
      SELECT id, operation_id, original_name, content_type, kind, size, sha256,
             stored_name, claimed_task_id, created_at
      FROM uploads
      ORDER BY id
    `).all().map(row => Object.freeze({ ...row }));
    assertDatabaseStable(databaseInfo, invalidCode);
    db.exec('COMMIT');
    inTransaction = false;
    return Object.freeze(rows);
  } catch (error) {
    if (inTransaction) {
      try { db?.exec('ROLLBACK'); } catch {}
    }
    if (error instanceof MigrationError) throw error;
    fail(invalidCode);
  } finally {
    try { db?.close(); } catch {}
    const after = assertDatabaseStable(databaseInfo, invalidCode);
    if (!sameStat(before, after)) fail(invalidCode);
  }
}

function normalizedUniqueFiles(rows, invalidCode) {
  const byName = new Map();
  for (const row of rows) {
    if (row.stored_name === null) continue;
    if (!safeStoredName(row.stored_name)
        || !Number.isSafeInteger(row.size)
        || row.size < 0
        || typeof row.sha256 !== 'string'
        || !/^[a-f0-9]{64}$/u.test(row.sha256)) {
      fail(invalidCode);
    }
    const existing = byName.get(row.stored_name);
    const fact = Object.freeze({
      storedName: row.stored_name,
      size: row.size,
      sha256: row.sha256,
    });
    if (existing
        && (existing.size !== fact.size || existing.sha256 !== fact.sha256)) {
      fail('UPLOAD_DATABASE_FACTS_CONFLICT');
    }
    byName.set(row.stored_name, fact);
  }
  return Object.freeze([...byName.values()].sort((a, b) => (
    a.storedName < b.storedName ? -1 : a.storedName > b.storedName ? 1 : 0
  )));
}

function openStableFile(path, expected, code, { requireMode0600 = false } = {}) {
  let link;
  try {
    link = lstatSync(path, { bigint: true });
  } catch {
    fail(code);
  }
  if (!link.isFile() || link.isSymbolicLink() || link.nlink !== 1n) fail(code);
  if (requireMode0600 && !hasExactPermissions(link, 0o600n)) fail(code);

  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile()
        || opened.nlink !== 1n
        || (requireMode0600 && !hasExactPermissions(opened, 0o600n))
        || opened.dev !== link.dev
        || opened.ino !== link.ino
        || opened.size !== BigInt(expected.size)) {
      fail(code);
    }
    return { descriptor, before: opened };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error instanceof MigrationError) throw error;
    fail(code);
  }
}

function verifyFileBytes(path, expected, code, options) {
  const opened = openStableFile(path, expected, code, options);
  const { descriptor, before } = opened;
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
  try {
    while (true) {
      const bytes = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (!sameStat(before, after)) fail(code);
    let finalLink;
    try {
      finalLink = lstatSync(path, { bigint: true });
    } catch {
      fail(code);
    }
    if (!finalLink.isFile() || finalLink.isSymbolicLink() || finalLink.nlink !== 1n
        || (options?.requireMode0600 && !hasExactPermissions(finalLink, 0o600n))
        || !sameStat(after, finalLink)) {
      fail(code);
    }
    if (hash.digest('hex') !== expected.sha256) fail(code);
    return Object.freeze({
      device: after.dev.toString(),
      inode: after.ino.toString(),
    });
  } finally {
    closeSync(descriptor);
  }
}

function assertTargetRootHasNoUnexpectedEntries(targetRootInfo, expectedFiles) {
  const expected = new Set(expectedFiles.map(file => file.storedName));
  let rootBefore;
  let entries;
  try {
    rootBefore = lstatSync(targetRootInfo.realPath, { bigint: true });
    entries = readdirSync(targetRootInfo.realPath, { withFileTypes: true });
  } catch {
    fail('TARGET_UPLOAD_ROOT_CHANGED');
  }
  for (const entry of entries) {
    if (entry.name === '.cleanup') {
      if (!entry.isDirectory() || entry.isSymbolicLink()) fail('TARGET_ATTACHMENT_ORPHAN');
      const cleanupPath = join(targetRootInfo.realPath, entry.name);
      const before = lstatSync(cleanupPath, { bigint: true });
      if (!before.isDirectory() || before.isSymbolicLink()) fail('TARGET_ATTACHMENT_ORPHAN');
      if (readdirSync(cleanupPath).length > 0) fail('TARGET_ATTACHMENT_STAGING_PRESENT');
      const after = lstatSync(cleanupPath, { bigint: true });
      if (!sameStat(before, after)) fail('TARGET_UPLOAD_ROOT_CHANGED');
      continue;
    }
    if (!expected.has(entry.name) || !entry.isFile() || entry.isSymbolicLink()) {
      fail('TARGET_ATTACHMENT_ORPHAN');
    }
  }
  let rootAfter;
  try {
    rootAfter = lstatSync(targetRootInfo.realPath, { bigint: true });
  } catch {
    fail('TARGET_UPLOAD_ROOT_CHANGED');
  }
  if (!sameStat(rootBefore, rootAfter)) fail('TARGET_UPLOAD_ROOT_CHANGED');
}

function scanTargetRoot(targetRootInfo, expectedFiles) {
  const expected = new Set(expectedFiles.map(file => file.storedName));
  let rootBefore;
  let entries;
  try {
    rootBefore = lstatSync(targetRootInfo.realPath, { bigint: true });
    entries = readdirSync(targetRootInfo.realPath, { withFileTypes: true });
  } catch {
    fail('TARGET_UPLOAD_ROOT_CHANGED');
  }
  for (const entry of entries) {
    if (entry.name === '.cleanup') {
      if (!entry.isDirectory() || entry.isSymbolicLink()) fail('TARGET_ATTACHMENT_ORPHAN');
      const cleanupEntries = readdirSync(join(targetRootInfo.realPath, entry.name));
      if (cleanupEntries.length > 0) fail('TARGET_ATTACHMENT_STAGING_PRESENT');
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink() || !expected.has(entry.name)) {
      fail('TARGET_ATTACHMENT_ORPHAN');
    }
  }
  if (entries.filter(entry => entry.name !== '.cleanup').length !== expected.size) {
    fail('TARGET_ATTACHMENT_SET_MISMATCH');
  }
  let rootAfter;
  try {
    rootAfter = lstatSync(targetRootInfo.realPath, { bigint: true });
  } catch {
    fail('TARGET_UPLOAD_ROOT_CHANGED');
  }
  if (!sameStat(rootBefore, rootAfter)) fail('TARGET_UPLOAD_ROOT_CHANGED');
}

function factsDigest(rows) {
  return sha256Digest(rows.map(row => ({
    id: row.id,
    operation_id: row.operation_id,
    original_name: row.original_name,
    content_type: row.content_type,
    kind: row.kind,
    size: row.size,
    sha256: row.sha256,
    stored_name: row.stored_name,
    claimed_task_id: row.claimed_task_id,
    created_at: row.created_at,
  })));
}

function bytesDigest(files) {
  return sha256Digest(files.map(file => ({
    storedName: file.storedName,
    size: file.size,
    sha256: file.sha256,
  })));
}

function verifyAttachmentDatabaseParityResolved({
  sourceDatabase,
  sourceRoot,
  targetDatabase,
  targetRoot,
  quiescenceLease,
  faultInjector,
} = {}) {
  assertPathDomainsDisjoint(sourceDatabase, targetDatabase, sourceRoot, targetRoot);
  const scopeDigest = parityScopeDigest(sourceDatabase, targetDatabase, sourceRoot, targetRoot);
  assertQuiescenceLease(quiescenceLease, scopeDigest);
  assertDatabaseStable(sourceDatabase, 'SOURCE_UPLOAD_DATABASE_INVALID');
  assertDatabaseStable(targetDatabase, 'TARGET_UPLOAD_DATABASE_INVALID');
  assertDirectoryStable(sourceRoot, 'SOURCE_UPLOAD_ROOT_CHANGED');
  assertDirectoryStable(targetRoot, 'TARGET_UPLOAD_ROOT_CHANGED');

  assertQuiescenceLease(quiescenceLease, scopeDigest);
  if (faultInjector) faultInjector('before_initial_database_read');
  assertQuiescenceLease(quiescenceLease, scopeDigest);

  const sourceRows = readUploadFacts(sourceDatabase, 'SOURCE_UPLOAD_DATABASE_INVALID');
  const targetRows = readUploadFacts(targetDatabase, 'TARGET_UPLOAD_DATABASE_INVALID');
  if (canonicalJson(sourceRows) !== canonicalJson(targetRows)) {
    fail('UPLOAD_DATABASE_FACTS_MISMATCH');
  }

  const files = normalizedUniqueFiles(targetRows, 'TARGET_UPLOAD_DATABASE_INVALID');

  const verifyFilesystem = () => {
    assertDatabaseStable(sourceDatabase, 'SOURCE_UPLOAD_DATABASE_INVALID');
    assertDatabaseStable(targetDatabase, 'TARGET_UPLOAD_DATABASE_INVALID');
    assertDirectoryStable(sourceRoot, 'SOURCE_UPLOAD_ROOT_CHANGED');
    assertDirectoryStable(targetRoot, 'TARGET_UPLOAD_ROOT_CHANGED');

    for (const file of files) {
      const sourceIdentity = verifyFileBytes(
        join(sourceRoot.realPath, file.storedName),
        file,
        'SOURCE_ATTACHMENT_MISMATCH',
      );
      const targetIdentity = verifyFileBytes(
        join(targetRoot.realPath, file.storedName),
        file,
        'TARGET_ATTACHMENT_MISMATCH',
        { requireMode0600: true },
      );
      if (sourceIdentity.device === targetIdentity.device
          && sourceIdentity.inode === targetIdentity.inode) {
        fail('SOURCE_TARGET_ATTACHMENT_ALIAS');
      }
    }
    scanTargetRoot(targetRoot, files);

    assertDirectoryStable(sourceRoot, 'SOURCE_UPLOAD_ROOT_CHANGED');
    assertDirectoryStable(targetRoot, 'TARGET_UPLOAD_ROOT_CHANGED');
  };

  verifyFilesystem();
  assertQuiescenceLease(quiescenceLease, scopeDigest);

  if (faultInjector) faultInjector('before_final_database_recheck');
  assertQuiescenceLease(quiescenceLease, scopeDigest);

  const finalSourceRows = readUploadFacts(sourceDatabase, 'SOURCE_UPLOAD_DATABASE_INVALID');
  const finalTargetRows = readUploadFacts(targetDatabase, 'TARGET_UPLOAD_DATABASE_INVALID');
  if (canonicalJson(finalSourceRows) !== canonicalJson(sourceRows)
      || canonicalJson(finalTargetRows) !== canonicalJson(targetRows)
      || canonicalJson(finalSourceRows) !== canonicalJson(finalTargetRows)) {
    fail('UPLOAD_DATABASE_FACTS_CHANGED_DURING_PARITY');
  }

  // The filesystem is checked again after the final DB reads. This closes the
  // mutation window where bytes/set could drift while database facts were
  // being revalidated.
  verifyFilesystem();
  assertQuiescenceLease(quiescenceLease, scopeDigest);

  // Capture the complete SQLite physical families before the last DB read.
  // This binds the final DB read and the last filesystem pass into one
  // read-only stability window without acquiring a production write lock.
  const sourceFamilyBeforeFinalWindow = captureDatabaseFamily(
    sourceDatabase,
    'SOURCE_UPLOAD_DATABASE_INVALID',
  );
  const targetFamilyBeforeFinalWindow = captureDatabaseFamily(
    targetDatabase,
    'TARGET_UPLOAD_DATABASE_INVALID',
  );

  const finalSourceRowsAfterFilesystem = readUploadFacts(
    sourceDatabase,
    'SOURCE_UPLOAD_DATABASE_INVALID',
  );
  const finalTargetRowsAfterFilesystem = readUploadFacts(
    targetDatabase,
    'TARGET_UPLOAD_DATABASE_INVALID',
  );
  if (canonicalJson(finalSourceRowsAfterFilesystem) !== canonicalJson(finalSourceRows)
      || canonicalJson(finalTargetRowsAfterFilesystem) !== canonicalJson(finalTargetRows)
      || canonicalJson(finalSourceRowsAfterFilesystem) !== canonicalJson(finalTargetRowsAfterFilesystem)) {
    fail('UPLOAD_DATABASE_FACTS_CHANGED_DURING_PARITY');
  }

  if (faultInjector) faultInjector('after_final_database_recheck');
  assertQuiescenceLease(quiescenceLease, scopeDigest);

  // One final filesystem pass comes after the last database read so byte/set
  // drift that occurs during that DB read cannot escape into a receipt.
  verifyFilesystem();

  // Compute the candidate receipt entirely from facts already captured while
  // the strong physical-family window is still open. The final external reads
  // below are therefore only the content-level stability proof; no filesystem
  // or database fact is consulted after that proof succeeds.
  const uploadFactsDigest = factsDigest(finalTargetRowsAfterFilesystem);
  const attachmentBytesDigest = bytesDigest(files);
  const parityDigest = sha256Digest({
    schemaVersion: 1,
    uploadFactsDigest,
    attachmentBytesDigest,
  });
  const candidateReceipt = Object.freeze({
    status: 'ATTACHMENT_DATABASE_PARITY_VERIFIED',
    schemaVersion: 1,
    uploadRows: finalTargetRowsAfterFilesystem.length,
    uniqueFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    uploadFactsDigest,
    attachmentBytesDigest,
    parityDigest,
  });

  // All remaining path/root identity checks must run before the closing
  // content-level SQLite-family observation. Once both strong families are
  // captured and compared, returning the already-computed receipt performs no
  // further filesystem/database observation.
  assertDatabaseStable(sourceDatabase, 'SOURCE_UPLOAD_DATABASE_INVALID');
  assertDatabaseStable(targetDatabase, 'TARGET_UPLOAD_DATABASE_INVALID');
  assertDirectoryStable(sourceRoot, 'SOURCE_UPLOAD_ROOT_CHANGED');
  assertDirectoryStable(targetRoot, 'TARGET_UPLOAD_ROOT_CHANGED');

  if (faultInjector) faultInjector('before_final_family_compare');
  assertQuiescenceLease(quiescenceLease, scopeDigest);

  const sourceFamilyAfterFinalWindow = captureDatabaseFamily(
    sourceDatabase,
    'SOURCE_UPLOAD_DATABASE_INVALID',
  );
  assertQuiescenceLease(quiescenceLease, scopeDigest);
  if (faultInjector) faultInjector('between_final_family_captures');
  assertQuiescenceLease(quiescenceLease, scopeDigest);
  const targetFamilyAfterFinalWindow = captureDatabaseFamily(
    targetDatabase,
    'TARGET_UPLOAD_DATABASE_INVALID',
  );
  if (!sameSqlitePhysicalFamily(sourceFamilyBeforeFinalWindow, sourceFamilyAfterFinalWindow)) {
    fail('SOURCE_UPLOAD_DATABASE_CHANGED_DURING_PARITY');
  }
  if (!sameSqlitePhysicalFamily(targetFamilyBeforeFinalWindow, targetFamilyAfterFinalWindow)) {
    fail('TARGET_UPLOAD_DATABASE_CHANGED_DURING_PARITY');
  }
  assertQuiescenceLease(quiescenceLease, scopeDigest);

  return candidateReceipt;
}

export function verifyAttachmentDatabaseParity({
  sourceDatabasePath,
  sourceUploadRoot,
  targetDatabasePath,
  targetUploadRoot,
  quiescenceLease,
  faultInjector,
} = {}) {
  const sourceDatabase = resolveExistingPath(sourceDatabasePath, 'file');
  const targetDatabase = resolveExistingPath(targetDatabasePath, 'file');
  const sourceRoot = resolveExistingPath(sourceUploadRoot, 'directory');
  const targetRoot = resolveExistingPath(targetUploadRoot, 'directory');

  return verifyAttachmentDatabaseParityResolved({
    sourceDatabase,
    sourceRoot,
    targetDatabase,
    targetRoot,
    quiescenceLease,
    faultInjector,
  });
}

export function copyAndVerifyAttachments({
  sourceDatabasePath,
  sourceUploadRoot,
  targetDatabasePath,
  targetUploadRoot,
  quiescenceLease,
  faultInjector,
} = {}) {
  const sourceDatabase = resolveExistingPath(sourceDatabasePath, 'file');
  const targetDatabase = resolveExistingPath(targetDatabasePath, 'file');
  const sourceRoot = resolveExistingPath(sourceUploadRoot, 'directory');
  const targetRoot = resolveExistingPath(targetUploadRoot, 'directory');

  assertPathDomainsDisjoint(sourceDatabase, targetDatabase, sourceRoot, targetRoot);
  const scopeDigest = parityScopeDigest(sourceDatabase, targetDatabase, sourceRoot, targetRoot);
  assertQuiescenceLease(quiescenceLease, scopeDigest);

  const sourceRows = readUploadFacts(sourceDatabase, 'SOURCE_UPLOAD_DATABASE_INVALID');
  const targetRows = readUploadFacts(targetDatabase, 'TARGET_UPLOAD_DATABASE_INVALID');
  if (canonicalJson(sourceRows) !== canonicalJson(targetRows)) {
    fail('UPLOAD_DATABASE_FACTS_MISMATCH');
  }

  const files = normalizedUniqueFiles(sourceRows, 'SOURCE_UPLOAD_DATABASE_INVALID');
  assertTargetRootHasNoUnexpectedEntries(targetRoot, files);
  let copiedFiles = 0;
  let reusedFiles = 0;
  let copiedBytes = 0;

  for (const file of files) {
    assertQuiescenceLease(quiescenceLease, scopeDigest);
    assertDirectoryStable(sourceRoot, 'SOURCE_UPLOAD_ROOT_CHANGED');
    assertDirectoryStable(targetRoot, 'TARGET_UPLOAD_ROOT_CHANGED');

    const sourcePath = resolve(sourceRoot.realPath, file.storedName);
    const targetPath = resolve(targetRoot.realPath, file.storedName);
    if (!sourcePath.startsWith(`${sourceRoot.realPath}${sep}`)
        || !targetPath.startsWith(`${targetRoot.realPath}${sep}`)) {
      fail('UPLOAD_PATH_UNSAFE');
    }

    let existing = null;
    try {
      existing = lstatSync(targetPath, { bigint: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') fail('TARGET_ATTACHMENT_CONFLICT');
    }

    if (existing) {
      if (!existing.isFile() || existing.isSymbolicLink()) fail('TARGET_ATTACHMENT_CONFLICT');
      verifyFileBytes(targetPath, file, 'TARGET_ATTACHMENT_CONFLICT', { requireMode0600: true });
      reusedFiles += 1;
      continue;
    }

    const source = openStableFile(sourcePath, file, 'SOURCE_ATTACHMENT_MISMATCH');
    let targetDescriptor;
    let created = false;
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    const hash = createHash('sha256');
    let bytesWritten = 0;
    try {
      targetDescriptor = openSync(
        targetPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW | fsConstants.O_WRONLY,
        0o600,
      );
      created = true;
      while (true) {
        const bytes = readSync(source.descriptor, buffer, 0, buffer.length, null);
        if (bytes === 0) break;
        hash.update(buffer.subarray(0, bytes));
        let offset = 0;
        while (offset < bytes) {
          offset += writeSync(targetDescriptor, buffer, offset, bytes - offset);
        }
        bytesWritten += bytes;
      }
      fsyncSync(targetDescriptor);
      const sourceAfter = fstatSync(source.descriptor, { bigint: true });
      if (!sameStat(source.before, sourceAfter)
          || bytesWritten !== file.size
          || hash.digest('hex') !== file.sha256) {
        fail('SOURCE_ATTACHMENT_MISMATCH');
      }
    } catch (error) {
      if (error instanceof MigrationError) throw error;
      fail('TARGET_ATTACHMENT_COPY_FAILED');
    } finally {
      closeSync(source.descriptor);
      if (targetDescriptor !== undefined) closeSync(targetDescriptor);
      if (created) {
        // Never delete an ambiguous target path after a failed verification.
        // This is an isolated target: preserve the conflicting artifact as
        // evidence and fail closed until it is explicitly reconciled.
        verifyFileBytes(targetPath, file, 'TARGET_ATTACHMENT_COPY_FAILED', { requireMode0600: true });
      }
    }

    fsyncDirectory(targetRoot.realPath);
    if (faultInjector) faultInjector('after_file_copy', file.storedName);
    assertQuiescenceLease(quiescenceLease, scopeDigest);
    copiedFiles += 1;
    copiedBytes += file.size;
  }

  if (faultInjector) faultInjector('before_final_parity');
  assertQuiescenceLease(quiescenceLease, scopeDigest);
  const parity = verifyAttachmentDatabaseParityResolved({
    sourceDatabase,
    sourceRoot,
    targetDatabase,
    targetRoot,
    quiescenceLease,
    faultInjector,
  });
  assertQuiescenceLease(quiescenceLease, scopeDigest);

  return Object.freeze({
    ...parity,
    status: 'ATTACHMENT_COPY_PARITY_VERIFIED',
    copiedFiles,
    reusedFiles,
    copiedBytes,
    copyProofDigest: sha256Digest({
      schemaVersion: 1,
      parityDigest: parity.parityDigest,
    }),
  });
}
