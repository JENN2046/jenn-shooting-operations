# G3_03_ISOLATED_EVIDENCE_ACCEPTANCE_PACKET_R1 — executed evidence

> Historical results at the recorded old implementation only. The 2/2 acceptance claim is superseded by [the P1 correction](P1_CHECKPOINT_COMPLETENESS_CORRECTION_R1.md); the current witness rejects all 2/2 inputs. The archive remains unchanged and is not current-head acceptance.

Final independent review is reported against the delivery commit in Issue #57 / the separate Draft PR. This source packet itself is not an authority grant.

- Canonical exact head: `371bf8982b0cd0df579b0e981964b27f9d0319fc`.
- Implementation base: `620136f322fddd194144ae90a44d833a40e15fff` (unchanged Draft #56).
- Implementation exact head: `012d15fc65fd4cec010f1551f9f55a8a1ecbe46f`.
- G3-02 authority: https://github.com/JENN2046/jenn-shooting-operations/issues/59#issuecomment-6074360103.
- Changed implementation: Python witness, one prospective observation code pin, 12 new regression test methods. No G2/G3 gate, historical approval or ledger changes. Optional signed-envelope compatibility DEFER (not selected).

## Executed evidence

`evidence.zip` contains raw guest command records, strict SSH receipts, SQLite challenge ledger, exact harness source, runtime pins, manifest, test logs and initial independent review. `evidence-manifest.json` binds every contained evidence file. No private key, VM image or production database is included. The experiment's guest disk/key paths in receipts are historical, deleted paths.

- Python: 24/24 PASS (12 existing semantic tests + 12 new compatibility test methods; subcases are not extra test counts).
- Focused Node: 15/15 PASS in exact-source ASCII checkout.
- `npm run check`: all validators PASS; 1087 tests / 1086 PASS / 0 FAIL / 1 existing skip, Node 24.19.0.
- Real KVM UUID `4518ccfa-3ab8-4aa9-9b67-2990ced4ee66`, ext4, kernel 6.8.0-136-generic. Guest Python 3.12.3 / SQLite 3.45.1. Host Python 3.14.4 / SQLite 3.46.1. Exact binary/script hashes in `runtime-pins.json` and `vm/expected-capture.json`.
- Integration initial: 14 checks PASS (real SSH positives/negatives plus explicitly labelled transcript-copy mutations); after guest reboot: 2 PASS; after owned QEMU SIGKILL/restart: 2 PASS. These are checks, not 18 unique SSH connections.
- Additional guest kernel checks: 4 PASS — actual unprivileged O_NOATIME denial, ordinary writer denial on current originals, private mount-namespace alias of the same original inode pair, custody remaining protected.
- Original active inode 64769:262207 / preserved 64769:262208, raw header 2/2. Final raw hashes respectively `907b3e5ea69a40b119cd74ddc80156dc2efbf5d99c134947a8e236e903b85f55` / `931ca9f28f3e653820c7a84ab6986bdce70ba59d329b25e9def9402594248b0a` unchanged. Both immutable; atime 1000000000ns and mtime 2000000000ns remained unchanged.
- Ledger: 9 consumed challenges, 4 ACCEPTED, 1 completion-expired rejection, 4 nonzero/transport/guest-rejection terminals. All 9 raw transport receipts remain bound to their ledger digest. Strict readback after VM/disk/key deletion PASS.
- Host-key prebinding came from locally controlled QEMU serial before SSH; guest networking restricted with only loopback forwarded SSH and no shared evidence filesystem. Different host/guest execution boundaries, not independent people or adversarial-host protection.

## Failures retained and resolved without weakening assertions

1. First Node run exposed stale prospective witness code pin; updated only that pin. Historical authority untouched.
2. Existing validators/tests use URL.pathname directly and fail from a path with spaces/non-ASCII characters. Full suite ran successfully from a clean ASCII temporary extraction of exact implementation commit; no unrelated path-handling patch. Original failed logs retained.
3. Immediately following SIGKILL, QEMU restart failed while old PID lock was being released. No lock bypass: confirmed old process gone, started the same disposable guest, then captured successfully with a fresh challenge. A premature SSH attempt was rejected and its identity stayed consumed; its raw receipt remains in the ledger. Three distinct boot IDs corroborate initial/reboot/crash phases.

## Verdict boundaries

E1_INTEGRATION=PASS_NONPRODUCTION; E2_INTEGRATION=PASS_NONPRODUCTION; E3_COMPATIBILITY=PASS_SELECTED_UNSIGNED_SSH_PROFILE. Original semantic comparison functions are unchanged; synthetic fixtures are not a reproduction or admission of current production 40/42-table data. Existing strict production pins and semantic predicates remain in force.

Inherited evidence and the new coverage rationale are in `coverage.md`; R1/R2 old counts are not claimed as new executions. Old FD/helper coverage is inherited; new reboot/crash observations specifically cover the changed witness integration.

PRODUCTION_PROOF=NOT_ADMITTED; G3_04_ENTRY_AUTHORIZED=FALSE; PRODUCTION_MUTATIONS=NONE; PR56_MERGE=FALSE. No operation identity outside disposable test ledger, no production custody alteration, adoption, writer release, service start or G4. No new reconciliation exception. Existing three production findings remain open. Stop after independent exact-head review and GitHub delivery.
