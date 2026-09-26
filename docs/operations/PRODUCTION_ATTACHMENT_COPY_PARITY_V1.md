# Production Attachment Copy + DB/File Parity V1

## Purpose

This capability copies attachment bytes from a verified source upload root into an already isolated target upload volume, then proves that the target SQLite upload facts and target attachment bytes describe the same set.

It is repository implementation evidence for `PRODUCTION_ATTACHMENT_COPY_CAPABILITY`. It is not production deployment evidence and grants no production authorization.

## Inputs

The controlled command requires four explicit inputs:

- source SQLite database;
- source upload root;
- target SQLite database;
- target upload root.

The source and target databases must be different physical files. Database files must have one hard link and every read is bound to the device/inode captured during initial path resolution.

The source and target upload roots must be different physical directories and may not contain one another. Database files may not be located inside either upload root.

The original source/target database and upload-root identities remain authoritative for the whole operation. Final parity does not re-resolve a pathname into a new baseline; path replacement at any later stage fails closed.

The final parity window also captures the complete SQLite physical family for both databases: main database identity plus WAL/SHM/journal state, with WAL bytes content-hashed. The family is captured before the final database reread and compared again after the final filesystem pass. A live SQLite writer during that window therefore invalidates the receipt even when the main database inode does not change.

The target database is expected to be the isolated migration target produced by the existing migration path. This capability does not create or migrate the target database.

## Database fact binding

Both databases are opened read-only with SQLite `query_only` enabled.

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

## Target DB/file parity

After copy, parity stays bound to the original resolved database/root identities. It verifies source and target bytes and the exact target directory set, re-reads both SQLite upload fact sets, verifies the filesystem again, re-reads database facts again, and performs a final filesystem pass after the last database read.

The target upload root must contain exactly the unique files referenced by the database, with one exception: an empty `.cleanup` directory is tolerated. A non-empty cleanup directory, symlink, unexpected directory, or unreferenced regular file fails parity. Unexpected target entries are also rejected before any missing attachment is copied.

The verifier re-checks each file pathname after reading and requires it still to reference the same single-link inode that was hashed. Target attachment replay additionally requires mode `0600`. Target-directory scans compare directory metadata before and after enumeration, so concurrent entry-set changes cannot silently pass the scan.

The verifier also revalidates the originally resolved database and upload-root device/inode identities throughout the proof, and the final SQLite physical-family comparison spans the last DB read through the last filesystem pass. Replacing a database file or upload-root directory with matching contents, or committing a WAL-backed DB write during that final pass, therefore cannot become a successful receipt.

Successful verification produces:

- `uploadFactsDigest`;
- `attachmentBytesDigest`;
- `parityDigest`.

`parityDigest` binds the target database upload facts to the exact attachment byte set without exposing original filenames or absolute paths.

## Replay semantics

A completed copy may be replayed.

Exact target files are re-used without rewriting them. Operational counters such as `copiedFiles` and `reusedFiles` are informational and are not part of the stable proof identity.

`copyProofDigest` is derived from the parity identity only, so initial copy and exact replay converge on the same proof.

## Command surface

Repository command:

`npm run attachments:copy -- ...`

Modes:

- `--apply`: may create missing target attachment files and requires `--acknowledge-isolated-target`;
- `--verify-only`: read-only parity verification and rejects the apply acknowledgement.

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
- source drift before final parity.

A failed or incomplete run never produces a parity receipt.

## Production boundary

This repository implementation does not close `PRODUCTION_ATTACHMENT_COPY_CAPABILITY`.

The gate remains `BLOCKED` until a later authority revision binds and acceptance-verifies the real target upload volume, real production source state, deployed command/runtime identity, and PROD-09 execution evidence.

No production database, attachment tree, deployment host, container, provider, device, route, credential, or cutover is touched by this work package.
