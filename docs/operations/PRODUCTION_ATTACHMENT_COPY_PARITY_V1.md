# Production Attachment Copy + DB/File Parity V1

## Purpose

This work package implements the attachment-copy/parity **candidate engine** and the production receipt authority boundary.

The candidate engine can copy and evaluate isolated test data, but it returns only non-authoritative `*_CANDIDATE` results. Production `*_VERIFIED` receipts are reserved for a private-class-branded `LIVE_PROVIDER` capability and cannot currently be minted because Stage 3 exposes no live capability mint.

It is repository engine evidence for `PRODUCTION_ATTACHMENT_COPY_CAPABILITY`. It is not production deployment evidence and grants no production authorization.

## Inputs

The parity engine requires four explicit storage inputs:

- source SQLite database;
- source upload root;
- target SQLite database;
- target upload root.

Candidate-engine mutation tests use a private-class-branded `TEST_SANDBOX` capability minted only by `createAttachmentParityIsolatedTestAuthority()`. That authority creates its own temporary sandbox and refuses to mint for any resolved DB/root identity outside that sandbox. The exported mutating test wrapper accepts only this TEST brand; production copy bypasses the test wrapper and calls the private mutator only after LIVE_PROVIDER authentication.

Production receipt APIs do **not** trust caller-supplied lease fields or mutable collection prototypes. Capability authenticity is checked by private class fields, and construction additionally requires a module-private mint token. Production APIs require the `LIVE_PROVIDER` authority class, while Stage 3 intentionally exposes no live mint. Knowing the scope digest, monkeypatching `WeakSet.prototype.has`, supplying `assertHeld: () => true`, or obtaining a legitimate TEST instance's `.constructor` cannot create production authority without the private mint token. A future live provider must execute inside this private authority boundary while actually holding offline-maintenance or coordinated-write exclusion.

The source and target databases must be different physical files. Database files must have one hard link and every read is bound to the device/inode captured during initial path resolution.

The source and target upload roots must be different physical directories and may not contain one another. Database files may not be located inside either upload root.

The original source/target database and upload-root identities remain authoritative for the whole operation. Final parity does not re-resolve a pathname into a new baseline; path replacement at any later stage fails closed.

The final parity window captures the complete SQLite physical family for both databases: main database identity plus WAL/SHM/journal state, with both the main SQLite file and WAL bytes content-hashed for the closing proof.

Physical-family snapshots remain supplemental drift evidence, not a substitute for writer exclusion. Candidate evaluation continuously checks its branded capability, including between the two closing family captures. Mutating candidate execution accepts only `TEST_SANDBOX` or future `LIVE_PROVIDER` brands; a sandbox capability is scope-bound to the module-created temporary root and cannot be repointed at production paths. Production receipt issuance accepts only `LIVE_PROVIDER`.

For Stage-3 strong-family verification, the main SQLite file and every present `-wal`, `-shm`, or `-journal` sidecar must have exactly one hard link. Source and target families are compared as a **full cross-product** of present device/inode identities, not merely same-role members. Their expected database/WAL/SHM/journal namespaces are also compared as a full cross-product using filesystem-aware comparison keys. The key is derived from a read-only case-sensitivity probe against the existing main database path, so future absent sidecars use the same case semantics as their filesystem. Any physical or namespace overlap is rejected as `SOURCE_TARGET_SQLITE_FAMILY_ALIAS`.

The target database is expected to be the isolated migration target produced by the existing migration path. This capability does not create or migrate the target database.

## Database fact binding

SQLite upload-fact queries never open the acknowledged database pathname directly.

Fact reads require the quiescence/coordination provider to present a **checkpointed sidecar-free SQLite family**. If a captured `-wal`, `-shm`, or `-journal` member is present, the fact read fails closed as a blocked prerequisite before target-byte mutation. The final parity drift proof may still observe SQLite family members later, but upload facts are never queried from a live sidecar-bearing family.

For every fact read, the engine:

1. captures the strong single-link SQLite physical family for the acknowledged main DB inode and requires it to be sidecar-free;
2. creates a private snapshot directory, opens that directory with `O_DIRECTORY | O_NOFOLLOW`, and verifies the opened directory inode;
3. copies the acknowledged main DB through a no-follow source descriptor into `/proc/self/fd/<snapshotDirFd>/snapshot.sqlite`;
4. fsyncs the private main DB, opens it read-only, and pins its private snapshot device/inode plus source size/SHA-256;
5. re-captures the original physical family and requires exact equality;
6. keeps the private main-file FD open through the whole query;
7. opens SQLite only as `file:/proc/self/fd/<snapshotMainFd>?immutable=1`, with `query_only` enabled;
8. verifies the held private main FD still has the same snapshot inode, size, and source SHA-256 before and after the query;
9. rechecks the original acknowledged family after the query before accepting rows.

Because SQLite opens the held main-file descriptor rather than either the acknowledged DB pathname or the temporary snapshot pathname, replacing the production path, the `jenn-sqlite-facts-*` directory, or `snapshot.sqlite` cannot redirect the connection to another inode. `immutable=1` also prevents the private fact read from consulting mutable snapshot journal/WAL paths.

Platforms without the required descriptor-bound `/proc/self/fd` primitive fail closed before fact admission; portable activation remains part of later provider/deployment acceptance.

The capability compares the complete ordered upload compatibility facts used for byte ownership:

- upload id;
- operation id;
- original name;
- content type;
- upload kind;
- size;
- SHA-256;
- stored name;
- claimed task id;
- creation time.

Copy is rejected before target-byte mutation if source and target upload facts differ.

Multiple rows may reference the same `stored_name` only when size and SHA-256 are identical. Such bytes are copied once.

Rows whose `stored_name` is null remain part of the database-facts digest but require no file.

## Byte copy

For every unique referenced stored file:

1. validate the stored name as a bounded single basename;
2. open the source with `O_NOFOLLOW`;
3. bind the open descriptor to the inspected inode;
4. verify source size while copying;
5. create the target with `O_EXCL | O_NOFOLLOW` and mode `0600`;
6. stream bytes without loading the entire attachment into memory;
7. compute SHA-256 while copying;
8. `fsync` the target file;
9. verify source descriptor identity remained stable;
10. verify copied byte count and SHA-256;
11. `fsync` the target upload directory where supported.

Source and target attachment files must each have exactly one hard link. A source/target hard-link alias can therefore never qualify as an isolated copy.

An existing target file is never overwritten. Exact existing bytes are accepted as a replay only after the same no-follow, single-link, inode, size and hash verification; a conflicting existing file fails closed.

Missing target-file creation is bound to the already validated target upload-root inode. On Linux, the engine opens the target root with `O_DIRECTORY | O_NOFOLLOW`, verifies its device/inode, and creates the child through `/proc/self/fd/<dirfd>/<storedName>`. Renaming/replacing the root pathname therefore cannot redirect creation outside the acknowledged directory. Platforms without an equivalent descriptor-bound primitive fail closed with `TARGET_ROOT_DESCRIPTOR_BINDING_UNAVAILABLE` before target mutation; portable activation remains part of later provider/deployment acceptance.

## Target DB/file parity

After copy, parity stays bound to the original resolved database/root identities. It verifies source and target bytes and the exact target directory set, re-reads both SQLite upload fact sets, verifies the filesystem again, re-reads database facts again, and performs a final filesystem pass after the last database read.

The target upload root must contain exactly the unique files referenced by the database, with one exception: an empty `.cleanup` directory is tolerated. A non-empty cleanup directory, symlink, unexpected directory, or unreferenced regular file fails parity. Unexpected target entries are also rejected before any missing attachment is copied.

The verifier re-checks each file pathname after reading and requires it still to reference the same single-link inode that was hashed. Target attachment replay additionally requires mode `0600`. Target-directory scans compare directory metadata before and after enumeration, so concurrent entry-set changes cannot silently pass the scan.

The verifier also revalidates the originally resolved database and upload-root device/inode identities throughout the proof. The candidate receipt is computed from already captured facts, all final path/root checks run before the closing family observations, and quiescence is asserted between the source/target captures and before return. Replacing a database file or upload-root directory with matching contents, losing quiescence, or committing a WAL-backed DB write inside the protected window therefore cannot become a successful receipt.

Candidate evaluation produces:

- `uploadFactsDigest`;
- `attachmentBytesDigest`;
- `parityDigest`;
- for copy evaluation, `candidateCopyDigest`.

These values describe evaluated facts but do not grant production authority. Only a future provider-authenticated wrapper may return `ATTACHMENT_DATABASE_PARITY_VERIFIED` / `ATTACHMENT_COPY_PARITY_VERIFIED` and the production-named `copyProofDigest`.

## Replay semantics

A completed copy may be replayed.

Exact target files are re-used without rewriting them. Operational counters such as `copiedFiles` and `reusedFiles` are informational and are not part of the stable proof identity.

`candidateCopyDigest` is derived from the parity identity only, so initial copy and exact replay converge on the same non-authoritative candidate identity. The production-named `copyProofDigest` is reserved for provider-authenticated receipt issuance.

## Command surface

Repository command surface:

`npm run attachments:copy -- ...`

Modes:

- `--apply`: may create missing target attachment files and requires `--acknowledge-isolated-target`;
- `--verify-only`: read-only parity verification and rejects the apply acknowledgement.

The direct CLI intentionally has **no built-in production quiescence provider** in this work package. Direct execution therefore fails closed with `ATTACHMENT_PARITY_PROVIDER_AUTH_REQUIRED`.

Programmatic callers cannot bypass this by constructing an object with the documented scope digest, kind, or `assertHeld()` callback, nor by monkeypatching `WeakSet.prototype.has`. Production receipt APIs accept only the private `LIVE_PROVIDER` class brand; Stage 3 exposes no mint for it. The only exported mint is the isolated TEST authority, and it can authorize mutation only inside its own freshly created temporary sandbox.

Required path arguments:

- `--source-db`;
- `--source-upload-root`;
- `--target-db`;
- `--target-upload-root`.

The command emits only bounded receipt facts and stable error codes. It does not print attachment names, original names, or absolute paths.

## Failure semantics

The capability fails closed for, among other cases:

- source/target database fact mismatch;
- source or target DB/root identity conflicts;
- unsafe stored names;
- duplicate stored-name facts with different size/hash;
- source file missing, symlinked, replaced, size-mismatched, or hash-mismatched;
- target file conflict;
- target byte tampering;
- unexpected target files or directories;
- non-empty target cleanup staging;
- source drift before final parity;
- missing or wrong-scope candidate quiescence probe;
- candidate quiescence loss at any checked point, including between the two closing SQLite-family captures;
- a WAL/SHM/journal-bearing SQLite family at upload-fact read time before provider checkpoint/quiescence;
- caller-forged production capability objects, prototype monkeypatch attempts, or constructor-reuse attempts without the private mint token;
- attempts to use a TEST capability outside its module-created sandbox;
- any source/target SQLite family cross-role inode or filesystem-semantic expected-path namespace collision.

A failed or incomplete run never produces a parity receipt.

## Production boundary

This repository implementation does not close `PRODUCTION_ATTACHMENT_COPY_CAPABILITY`.

The gate remains `BLOCKED` until a later authority revision implements and acceptance-verifies the live provider that can mint the opaque capability while actually holding source/target quiescence, plus the real target upload volume, real production source state, deployed command/runtime identity, and PROD-09 execution evidence. This Stage-3 contract does not implement the later Stage-5 long-lived source/target writer fence.

No production database, attachment tree, deployment host, container, provider, device, route, credential, or cutover is touched by this work package.
