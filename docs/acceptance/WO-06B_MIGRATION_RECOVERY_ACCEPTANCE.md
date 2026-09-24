# WO-06B Migration / Backup / Restore / Rollback Fresh Acceptance

- Authority base: `b66c6e0377531064b4e1db03dbc2067d4457acf0`
- Branch: `codex/wo-06b-migration-recovery-acceptance`
- Current result: `WO-06B_MIGRATION_RECOVERY_ACCEPTANCE_PASS`
- Deployment gate: `BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE`

## Scope

WO-06B fresh-validates the already frozen isolated migration/recovery contract.

It does not authorize or perform:

- production database migration;
- online migration;
- Switch/cutover;
- real upload-volume migration;
- production backup/restore;
- deployment or release.

All acceptance work uses a newly created temporary fixture root whose name satisfies the frozen isolated-apply contract.

## Required fresh chain

The final branch head must execute:

```text
npm ci
npm run check
targeted migration/recovery tests
fresh full-chain acceptance harness
```

The harness must prove:

```text
V1 source
→ dry-run
→ verified backup
→ verified rollback restore to new path
→ isolated V2 apply
→ target post-verify
→ proof seal
→ read-only backup re-verification
→ read-only rollback re-verification
→ same-batch completed replay
```

Required status codes:

- dry-run: exit 0 with `PASS` or `PASS_WITH_WARNINGS`, and `switchReadiness=NOT_RUN`;
- initial apply: `APPLIED_VERIFIED`;
- backup: `BACKUP_VERIFIED`;
- rollback restore: `ROLLBACK_VERIFIED`;
- target proof: `ALREADY_APPLIED_VERIFIED`;
- completed replay: `ALREADY_APPLIED_VERIFIED`;
- apply/replay `switchReadiness`: `BLOCKED`.

The source must remain byte-identical and completed replay must not rewrite backup, rollback, target or proof-seal artifacts.

## Failure semantics

Any failure yields:

```text
WO-06B_BLOCKED_LOCAL
BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

A successful isolated fixture run must never be relabeled as production migration readiness or Switch readiness.

## Exit state

Only after exact-head fresh CI and independent review may this work package record:

```text
WO-06B_MIGRATION_RECOVERY_ACCEPTANCE_PASS
BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```


## Fresh run history

### Run 1 — HARNESS_CONTRACT_MISMATCH

- Head: `9437eda7485347add5018a045a7d846c49b3a3aa`
- GitHub Actions run: `35975791946`
- `npm run check`: PASS
- targeted migration/recovery suite: `126/126 PASS`
- full-chain harness: FAIL before apply

Failure:

```text
dry-run switchReadiness
actual:   NOT_RUN
expected: BLOCKED
```

Classification: acceptance-harness assertion error, not migration/recovery implementation failure.

Frozen semantics:

- dry-run performs mapping/readiness analysis only and reports `switchReadiness=NOT_RUN`;
- verified isolated apply/replay must remain `switchReadiness=BLOCKED`.

Run 1 is preserved as non-PASS evidence. A fresh rerun on the corrected harness is required.


### Final implementation-head run — FRESH_PASS

- Final implementation-bearing head: `b10a2ff8fac20d6ba892a5a8bfc3232c4189c73d`
- GitHub Actions run: `35976098214`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`
- `npm run check`: 530 tests / 529 pass / 0 fail / 1 expected external-VCP skip
- targeted migration/recovery suite: `126/126 PASS`
- full-chain harness: PASS

Machine-readable harness result:

```json
{
  "status": "WO_06B_FRESH_ACCEPTANCE_PASS",
  "dryRunResult": "PASS",
  "applyResult": "APPLIED_VERIFIED",
  "backupStatus": "BACKUP_VERIFIED",
  "rollbackStatus": "ROLLBACK_VERIFIED",
  "targetStatus": "ALREADY_APPLIED_VERIFIED",
  "replayResult": "ALREADY_APPLIED_VERIFIED",
  "switchReadiness": "BLOCKED",
  "sourceUnchanged": true,
  "artifactsStableOnReplay": true
}
```

Existing targeted tests in the same exact-head run also covered backup tamper, non-SQLite backup, sidecar injection, partial restore preservation, source changes during scan/apply, target tamper, path identity conflicts and schema drift.

This record cites the final implementation-bearing exact-head run. Any later commit that changes only this evidence text must itself pass the unchanged WO-06B workflow before merge; that docs-only run is attached to the PR/check record and does not replace the implementation-head acceptance run above.

## Closure

The WO-06B implementation/runtime evidence gate is satisfied on isolated fixtures:

```text
WO-06B_MIGRATION_RECOVERY_ACCEPTANCE_PASS
BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

This result does not authorize production migration, restore, cutover or deployment.
