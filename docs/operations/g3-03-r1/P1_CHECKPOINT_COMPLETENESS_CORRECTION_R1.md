# P1 correction: reject WAL main files without checkpoint-completion evidence

The P1 on PR61 (`discussion_r4230099390`, reviewed head `b26b72e181`) identifies a missing prerequisite: absence of a visible WAL sidecar does not prove that all committed transactions reached the main file. Internal SQLite integrity, stable inode/hash and an authenticated source cannot establish that missing history on their own.

## Current behavior

The witness now rejects every valid-header 2/2 input with `WAL_CHECKPOINT_COMPLETENESS_UNPROVEN`, before constructing an in-memory SQLite connection for that input. The private-header normalization path is removed. There is no CLI flag, caller boolean or synthetic-profile exception that enables 2/2 acceptance. No trusted checkpoint evidence input currently exists, so 2/2 support is **DEFERRED**, including genuine checkpointed files.

The 1/1 path retains its existing semantic checks, exact production identity/hash requirements, O_NOATIME without fallback, full parent/leaf bindings, sidecar rejection and authority-denying outputs. Acceptance of 1/1 bytes is not a new provenance or historical completeness guarantee; source/custody proof obligations remain external and mandatory. The optional signature verifier remains unchanged and is not a substitute for missing source evidence.

No production checkpoint, journal-mode conversion, DB mutation or WAL recovery is attempted. A production target with 2/2 headers must remain BLOCKED until a separately reviewed method supplies independently bound completion evidence; an owner assertion or locally generated success boolean is insufficient. Any later 2/2 implementation must bind actual database identity/content, trusted checkpoint lifecycle and continued custody, and be reviewed against the frozen method. This patch does not claim that lifecycle has been implemented.

## Bounded verification

The focused Python suite includes:

- a genuinely checkpointed, sidecar-free synthetic 2/2 pair still refuses without bound evidence, before SQLite construction, with file metadata unchanged;
- a synthetic 2/2 header is refused before SQLite interpretation;
- an active-only 2/2 CLI input returns exit2 with WITNESS_FAIL_CLOSED and no observation artifact;
- existing 1/1 semantic mismatch checks, invalid/mixed headers, sidecars, O_NOATIME denial and parent/file drift checks remain covered.

The Node wrapper now discovers both witness Python suites (`test_g3*witness*.py`) so ordinary npm test / CI includes the compatibility rejection checks. Previously its discovery selected only the original semantic suite. Local focused Python result: 26 tests PASS; exact-head Node/full/remote CI outcomes are reported in the PR delivery receipt, not predeclared here.

## Historical evidence and readiness

The archived R1/R2/G3-03 ZIP, manifest, challenges and original results are not rewritten or re-counted. Their 2/2 positives describe the older implementation and do not establish completeness or current-head acceptance. `results.md` now links this correction. The updated prospective observation-code SHA pins the new rejecting implementation; historical approval/ledger bytes and original G2/G3 contracts are unchanged.

The PR stack remains on MERGE HOLD pending exact-head verification and reviewer re-review of this correction. Previous candidate image/archive and production-preparation approvals must not be reused as a new-head attestation; production proof remains NOT_ADMITTED. This patch addresses the unsafe acceptance path by refusal; it does not deliver the previously intended operational 2/2 compatibility.
