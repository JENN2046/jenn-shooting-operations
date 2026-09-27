import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

function directoryMatchesIdentity(path, identity) {
  try {
    const metadata = lstatSync(path, { bigint: true });
    return metadata.isDirectory()
      && !metadata.isSymbolicLink()
      && metadata.dev.toString() === identity.device
      && metadata.ino.toString() === identity.inode;
  } catch {
    return false;
  }
}

function directoryDescriptorMatchesIdentity(descriptor, identity) {
  try {
    const metadata = fstatSync(descriptor, { bigint: true });
    return metadata.isDirectory()
      && metadata.dev.toString() === identity.device
      && metadata.ino.toString() === identity.inode;
  } catch {
    return false;
  }
}

function clearDirectoryContentsByDescriptor(descriptor) {
  const metadata = fstatSync(descriptor, { bigint: true });
  if (!metadata.isDirectory()) {
    throw new Error('descriptor is not a directory');
  }
  const boundRoot = `/proc/self/fd/${descriptor}`;
  for (const child of readdirSync(boundRoot)) {
    rmSync(join(boundRoot, child), { recursive: true, force: true });
  }
}

export function createAttachmentParityIsolatedTestAuthority() {
  let sandboxRoot;
  let sandboxDescriptor;
  let sandboxIdentity;

  if (process.platform === 'linux') {
    let parentDescriptor;
    let createdPath;
    try {
      const sandboxParent = realpathSync(tmpdir());
      parentDescriptor = openSync(
        sandboxParent,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
      );
      const parentMetadata = fstatSync(parentDescriptor, { bigint: true });
      if (!parentMetadata.isDirectory()) {
        fail('ATTACHMENT_PARITY_TEST_AUTH_UNAVAILABLE', 'BLOCKED_PREREQUISITE');
      }

      createdPath = mkdtempSync(
        join(`/proc/self/fd/${parentDescriptor}`, 'jenn-attachment-parity-test-'),
      );
      sandboxDescriptor = openSync(
        createdPath,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
      );
      const sandboxMetadata = fstatSync(sandboxDescriptor, { bigint: true });
      if (!sandboxMetadata.isDirectory()) {
        fail('ATTACHMENT_PARITY_TEST_AUTH_UNAVAILABLE', 'BLOCKED_PREREQUISITE');
      }
      sandboxIdentity = Object.freeze({
        device: sandboxMetadata.dev.toString(),
        inode: sandboxMetadata.ino.toString(),
      });

      // Resolve through the held directory descriptor, never through the
      // reusable pathname. Then require that the still-exposed creation name
      // identifies that same inode before publishing the authority root.
      sandboxRoot = realpathSync(`/proc/self/fd/${sandboxDescriptor}`);
      if (!directoryMatchesIdentity(sandboxRoot, sandboxIdentity)
          || !directoryMatchesIdentity(createdPath, sandboxIdentity)) {
        fail('ATTACHMENT_PARITY_TEST_SANDBOX_CHANGED', 'INVALID_USAGE');
      }
    } catch (error) {
      if (sandboxDescriptor !== undefined) {
        // Constructor failure cleanup must stay bound to the exact directory
        // already opened. An unverified/replaced public pathname is preserved.
        try { clearDirectoryContentsByDescriptor(sandboxDescriptor); } catch {}
        try { closeSync(sandboxDescriptor); } catch {}
        sandboxDescriptor = undefined;
      }
      if (error instanceof MigrationError) throw error;
      fail('ATTACHMENT_PARITY_TEST_AUTH_UNAVAILABLE', 'BLOCKED_PREREQUISITE');
    } finally {
      if (parentDescriptor !== undefined) {
        try { closeSync(parentDescriptor); } catch {}
      }
    }
  } else {
    sandboxRoot = realpathSync(mkdtempSync(join(tmpdir(), 'jenn-attachment-parity-test-')));
    const sandboxMetadata = lstatSync(sandboxRoot, { bigint: true });
    sandboxIdentity = Object.freeze({
      device: sandboxMetadata.dev.toString(),
      inode: sandboxMetadata.ino.toString(),
    });
  }

  let active = true;

  const assertSandboxBinding = () => {
    if (process.platform !== 'linux') {
      if (!directoryMatchesIdentity(sandboxRoot, sandboxIdentity)) {
        fail('ATTACHMENT_PARITY_TEST_SANDBOX_CHANGED', 'INVALID_USAGE');
      }
      return;
    }
    if (!directoryDescriptorMatchesIdentity(sandboxDescriptor, sandboxIdentity)
        || !directoryMatchesIdentity(sandboxRoot, sandboxIdentity)) {
      fail('ATTACHMENT_PARITY_TEST_SANDBOX_CHANGED', 'INVALID_USAGE');
    }
  };

  const resolveSandboxMember = (inputPath, expectedType) => {
    if (process.platform !== 'linux') {
      const info = resolveExistingPath(inputPath, expectedType);
      if (!pathWithin(info.realPath, sandboxRoot)) {
        fail('ATTACHMENT_PARITY_TEST_SCOPE_INVALID', 'INVALID_USAGE');
      }
      return info;
    }

    assertSandboxBinding();
    if (typeof inputPath !== 'string' || !isAbsolute(inputPath)) {
      fail('ATTACHMENT_PARITY_TEST_SCOPE_INVALID', 'INVALID_USAGE');
    }
    const absoluteInput = resolve(inputPath);
    if (!pathWithin(absoluteInput, sandboxRoot)) {
      fail('ATTACHMENT_PARITY_TEST_SCOPE_INVALID', 'INVALID_USAGE');
    }

    const relation = relative(sandboxRoot, absoluteInput);
    const boundRoot = realpathSync(`/proc/self/fd/${sandboxDescriptor}`);
    if (!directoryMatchesIdentity(boundRoot, sandboxIdentity)) {
      fail('ATTACHMENT_PARITY_TEST_SANDBOX_CHANGED', 'INVALID_USAGE');
    }

    const boundInfo = resolveExistingPath(
      relation === ''
        ? `/proc/self/fd/${sandboxDescriptor}`
        : join(`/proc/self/fd/${sandboxDescriptor}`, relation),
      expectedType,
    );
    if (!pathWithin(boundInfo.realPath, boundRoot)) {
      fail('ATTACHMENT_PARITY_TEST_SCOPE_INVALID', 'INVALID_USAGE');
    }

    const exposedInfo = resolveExistingPath(inputPath, expectedType);
    if (!sameFile(boundInfo, exposedInfo)) {
      fail('ATTACHMENT_PARITY_TEST_SANDBOX_CHANGED', 'INVALID_USAGE');
    }
    assertSandboxBinding();
    return boundInfo;
  };

  return Object.freeze({
    root: sandboxRoot,
    mint({
      sourceDatabasePath,
      sourceUploadRoot,
      targetDatabasePath,
      targetUploadRoot,
      heldState = { held: true },
    } = {}) {
      if (!active) fail('ATTACHMENT_PARITY_TEST_AUTHORITY_CLOSED', 'INVALID_USAGE');
      const sourceDatabase = resolveSandboxMember(sourceDatabasePath, 'file');
      const targetDatabase = resolveSandboxMember(targetDatabasePath, 'file');
      const sourceRoot = resolveSandboxMember(sourceUploadRoot, 'directory');
      const targetRoot = resolveSandboxMember(targetUploadRoot, 'directory');
      assertSandboxBinding();
      assertPathDomainsDisjoint(sourceDatabase, targetDatabase, sourceRoot, targetRoot);
      return new AttachmentParityCapability(CAPABILITY_MINT_TOKEN, {
        scopeDigest: parityScopeDigest(sourceDatabase, targetDatabase, sourceRoot, targetRoot),
        authorityClass: TEST_AUTHORITY,
        assertHeld: () => {
          if (!active || heldState?.held !== true) return false;
          try {
            assertSandboxBinding();
            return true;
          } catch {
            return false;
          }
        },
      });
    },
    close() {
      if (!active) return;
      active = false;

      if (process.platform !== 'linux') {
        if (!directoryMatchesIdentity(sandboxRoot, sandboxIdentity)) {
          fail('ATTACHMENT_PARITY_TEST_SANDBOX_CHANGED', 'INVALID_USAGE');
        }
        rmSync(sandboxRoot, { recursive: true, force: true });
        return;
      }

      let cleanupError = null;
      let publicPathChanged = !directoryMatchesIdentity(sandboxRoot, sandboxIdentity);
      try {
        const heldMetadata = fstatSync(sandboxDescriptor, { bigint: true });
        if (!heldMetadata.isDirectory()
            || heldMetadata.dev.toString() !== sandboxIdentity.device
            || heldMetadata.ino.toString() !== sandboxIdentity.inode) {
          cleanupError = new MigrationError(
            'ATTACHMENT_PARITY_TEST_SANDBOX_CHANGED',
            'INVALID_USAGE',
          );
        } else {
          clearDirectoryContentsByDescriptor(sandboxDescriptor);
        }
      } catch (error) {
        cleanupError ??= error;
      }

      // Never recursively remove the reusable public pathname. Keeping the
      // exact directory descriptor open lets us clean only the directory that
      // this authority created, even if its visible name has been replaced.
      // The now-empty temp directory itself is intentionally left behind:
      // Node core has no unlinkat(dirfd, name, AT_REMOVEDIR), and a pathname
      // rmdir would reintroduce a same-UID rename race.
      publicPathChanged ||= !directoryMatchesIdentity(sandboxRoot, sandboxIdentity);
      try {
        closeSync(sandboxDescriptor);
      } catch (error) {
        cleanupError ??= error;
      }
      sandboxDescriptor = undefined;

      if (publicPathChanged) {
        cleanupError ??= new MigrationError(
          'ATTACHMENT_PARITY_TEST_SANDBOX_CHANGED',
          'INVALID_USAGE',
        );
      }
      if (cleanupError) {
        if (cleanupError instanceof MigrationError) throw cleanupError;
        throw new MigrationError(
          'ATTACHMENT_PARITY_TEST_CLEANUP_FAILED',
          'INVALID_USAGE',
        );
      }
    },
  });
}

export function copyAttachmentsAndEvaluateParityTestCandidate({
  sourceDatabasePath,
  sourceUploadRoot,
  targetDatabasePath,
  targetUploadRoot,
  quiescenceCapability,
  faultInjector,
} = {}) {
  const domain = resolveParityDomain({
    sourceDatabasePath,
    sourceUploadRoot,
    targetDatabasePath,
    targetUploadRoot,
  });
  const inspected = inspectCapability(quiescenceCapability, domain.scopeDigest);
  if (!inspected || inspected.authorityClass !== TEST_AUTHORITY) {
    fail('ATTACHMENT_PARITY_TEST_AUTH_REQUIRED', 'BLOCKED_PREREQUISITE');
  }

  return copyAttachmentsAndEvaluateParityInternal({
    sourceDatabasePath,
    sourceUploadRoot,
    targetDatabasePath,
    targetUploadRoot,
    quiescenceCapability,
    faultInjector,
  });
}

export function assertPathDomainsDisjointTestCandidate({
  sourceDatabase,
  targetDatabase,
  sourceRoot,
  targetRoot,
} = {}) {
  return assertPathDomainsDisjoint(sourceDatabase, targetDatabase, sourceRoot, targetRoot);
}
