# WO-05E Fresh Runtime Closure

- Issue: #10
- Authority base: `79cff08aff2b17ee28b506377966087fd962d5a3`
- Reconstruction branch: `codex/wo-05e-fresh-runtime-closure`
- Scope: fresh-runtime failure reproduction evidence, minimal WAL physical-family correction, focused regression, final exact-head rerun gate
- Current result: `SHADOW_EVALUATOR_PASS_WITH_BLOCKED_DATA`
- Real shadow-data gate: `BLOCKED_DATA`

## 1. Initial fresh-runtime evidence

A Codex runtime task started from the exact authority HEAD `79cff08aff2b17ee28b506377966087fd962d5a3` in a clean worktree and recorded:

- Node.js: `22.22.2`
- npm: `11.4.2`
- lockfile install: `npm ci` succeeded, 6 dependencies installed, 0 vulnerabilities
- `npm run validate:contract`: PASS
- `npm run validate:shadow`: PASS with `datasetClass=synthetic` and `gateStatus=BLOCKED_DATA`
- initial full runtime validation exposed two `SOURCE_CHANGED_DURING_SCAN` failures while reading idle SQLite WAL sources
- the failures were classified as WAL `ctime` changes caused by the Node/SQLite read-only snapshot path rather than a content write
- a minimal local correction that excluded only WAL `ctime` from physical-family equality subsequently produced:
  - `npm test`: 527 tests, 526 passed, 0 failed, 1 skipped
  - `npm run check`: PASS, including contract validation, synthetic shadow validation, and the same 527-test suite
- literal `npm check` is not a script runner in npm 11.4.2 and returned `Unknown command: "check"`; the repository command is `npm run check`

That task environment then disappeared before its local commit could be pushed. The reported local commit `1644a88b5896006f354257658c6148a2d8bc03b5` was never visible in this GitHub repository and is not treated as authority.

## 2. Reconstructed minimal fix on GitHub

This branch reconstructs the narrow runtime fix directly from the visible authority HEAD.

### Source scan family

`src/migration-sqlite-v2.mjs` continues to compare the database, WAL, SHM and journal physical family before and after the read-only source scan.

Only the WAL family member omits `ctimeNs`.

The WAL comparison still includes:

- device;
- inode;
- size;
- `mtimeNs`;
- SHA-256 content digest.

The digest is computed through a read-only descriptor with before/after file-stat stability checks. Recovery/backup hashing also binds the descriptor's `dev/ino` to the inode inspected by the surrounding `lstat`, preventing pathname ABA swaps from pairing one inode's metadata with another inode's digest. Dropping the long-lived WAL `ctimeNs` comparison therefore does not allow an in-place content rewrite with restored `mtime`, or a transient WAL inode swap, to pass.

The main database, SHM and journal comparisons retain their previous `ctimeNs` checks.

### Backup/recovery family

`src/migration-recovery-sqlite-v2.mjs` applies the same narrow WAL-only rule to database-family stability.

Other uses of `stableStat()` remain unchanged and continue to include `ctimeNs`.

No retry or best-effort fallback is introduced. A real source-family mutation still fails closed.

## 3. Focused regression evidence

The idle-WAL source-reader regression now explicitly records the WAL before the read-only scan and confirms afterward:

- SHA-256 content hash unchanged;
- device unchanged;
- inode unchanged;
- size unchanged;
- `mtimeNs` unchanged.

The verified-backup WAL regression records the same properties around `createVerifiedBackup()`.

Additional focused regressions rewrite the existing WAL in place, preserve inode/size, restore the original nanosecond `mtime`, and confirm both source scanning and backup verification still fail closed because the production WAL SHA-256 changes.

Existing real-writer protections remain in place, including:

- source scan concurrent writer -> `SOURCE_CHANGED_DURING_SCAN`;
- recovery/backup concurrent writer -> fail closed;
- content-equivalent source writes and inode replacement -> fail closed.

The regression intentionally does **not** require WAL `ctimeNs` equality.

## 4. Phase 1 exact-head runtime result

A GitHub Actions exact-head runtime gate was added directly to the PR branch so the runner checks out the real GitHub commit instead of relying on a transient Codex worktree.

Phase 1 ran on:

```text
HEAD 85536f53ade1af8d35f96671e386485f1124d77f
GitHub Actions run 35954996312
conclusion = success
```

Runtime facts:

- runner: Ubuntu 24.04 / Linux `6.17.0-1022-azure`;
- Node.js: `22.22.2`;
- npm: `11.4.2`;
- Node tzdata: `2025c`;
- ICU: `78.2`.

Phase 1 commands all passed:

- `npm ci`;
- `npm run validate:contract`;
- `npm run validate:shadow`;
- `npm test`;
- `npm run check`.

The shadow gate output remained:

```text
datasetClass=synthetic
gateStatus=BLOCKED_DATA
resultDigest=sha256:73da98b7d91688235da5ce3547c7e06af685532697e699aa01a589c6619c3e4c
```

The test suite completed twice during the explicit `npm test` step and the repository `npm run check` step with the same counts:

```text
tests = 527
pass = 526
fail = 0
skipped = 1
cancelled = 0
todo = 0
```

The only skip is the external VCP sync adapter test because that adapter is not present in the workspace; no production DB, credential, provider, deployment, or real business dataset was used.

## 5. Final-head rerun rule

This document/status update is the only Phase 2 change after the successful Phase 1 runtime gate.

The resulting final PR head must itself pass the same GitHub Actions workflow, which runs:

```sh
npm ci
npm run validate:contract
npm run validate:shadow
npm test
npm run check
```

PR #11 must not merge unless the workflow attached to that exact final commit succeeds.

The final-head workflow must continue to prove:

- Node `22.22.2` and npm `11.4.2`;
- `datasetClass=synthetic`;
- `gateStatus=BLOCKED_DATA`;
- no unqualified real shadow-acceptance PASS;
- complete test/pass/fail/skip counts with zero failures.

## 6. Authority closure

PR #11 merged into `codex/v2-1-architecture-freeze` as:

```text
2f0e1266e0c1d6dd43c7ca18bde47e4c61daee82
```

The final tested PR head was:

```text
623e8eac956bccc80e642ae89652a90eb910750e
```

The merge commit and tested head have the same Git tree:

```text
04f949dd6e8a5d389afab925076374af3d76523c
```

Therefore the merged implementation tree is byte-for-byte the tested tree for repository content.

The final exact-head GitHub Actions gate on `623e8eac956bccc80e642ae89652a90eb910750e` passed with:

```text
530 tests
529 passed
0 failed
1 skipped
0 cancelled
0 todo
```

The authoritative WO-05E implementation state is now:

```text
SHADOW_EVALUATOR_PASS_WITH_BLOCKED_DATA
```

This closes only the implementation/runtime evidence gate.

The real data gate remains separate and unchanged:

```text
approved/real Level C dataset = 0
real shadow acceptance = BLOCKED_DATA
```

must remain unchanged.

## 7. Non-scope

This fix does not change:

- Level A/B/C qualification;
- metric formulas;
- threshold policy;
- trusted approval semantics;
- Agent/human permissions;
- production DB access;
- provider/network behavior;
- deployment or release behavior.
