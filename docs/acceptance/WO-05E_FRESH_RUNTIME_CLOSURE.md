# WO-05E Fresh Runtime Closure

- Issue: #10
- Authority base: `79cff08aff2b17ee28b506377966087fd962d5a3`
- Reconstruction branch: `codex/wo-05e-fresh-runtime-closure`
- Scope: fresh-runtime failure reproduction evidence, minimal WAL physical-family correction, focused regression, final exact-head rerun gate
- Current result: `FRESH_RUNTIME_FIX_IMPLEMENTED / FINAL_EXACT_HEAD_RERUN_REQUIRED`
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
- `mtimeNs`.

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

Existing real-writer protections remain in place, including:

- source scan concurrent writer -> `SOURCE_CHANGED_DURING_SCAN`;
- recovery/backup concurrent writer -> fail closed;
- content-equivalent source writes and inode replacement -> fail closed.

The regression intentionally does **not** require WAL `ctimeNs` equality.

## 4. Exact-head rerun status

After reconstructing the visible GitHub branch, an independent execution container attempted to clone:

`codex/wo-05e-fresh-runtime-closure`

for a fresh exact-head rerun.

The attempt failed before checkout with:

```text
fatal: unable to access 'https://github.com/JENN2046/jenn-shooting-operations.git/':
Could not resolve host: github.com
```

The container has Git available, but outbound GitHub DNS/network is blocked.

Therefore this document does **not** claim that the reconstructed GitHub head has completed the final full runtime sequence yet.

## 5. Required final runtime sequence

On the final reviewed PR head, a connected clean environment must run:

```sh
npm ci
npm run validate:contract
npm run validate:shadow
npm test
npm run check
```

The final record must include:

- OS;
- Node version;
- npm version;
- Node tzdata/runtime timezone-data fingerprint when available;
- dependency install result;
- complete test/pass/fail/skip counts;
- `validate:shadow` output proving:
  - `datasetClass=synthetic`;
  - `gateStatus=BLOCKED_DATA`;
  - no unqualified real shadow-acceptance PASS.

## 6. Closure rule

Until that exact-head rerun succeeds, the strongest honest WO-05E state is:

```text
POST_MERGE_CODE_EVIDENCE_VERIFIED
FRESH_RUNTIME_FIX_IMPLEMENTED
FINAL_EXACT_HEAD_RERUN_REQUIRED
BLOCKED_DATA
```

Only after the final exact-head runtime sequence passes may WO-05E move to:

```text
SHADOW_EVALUATOR_PASS_WITH_BLOCKED_DATA
```

Even then:

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
