# WO-06B Migration / Backup / Restore / Rollback Fresh Acceptance

- Authority base: `b66c6e0377531064b4e1db03dbc2067d4457acf0`
- Branch: `codex/wo-06b-migration-recovery-acceptance`
- Current result: `FRESH_ACCEPTANCE_RUNNING`
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

- initial apply: `APPLIED_VERIFIED`;
- backup: `BACKUP_VERIFIED`;
- rollback restore: `ROLLBACK_VERIFIED`;
- target proof: `ALREADY_APPLIED_VERIFIED`;
- completed replay: `ALREADY_APPLIED_VERIFIED`;
- `switchReadiness`: always `BLOCKED`.

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
