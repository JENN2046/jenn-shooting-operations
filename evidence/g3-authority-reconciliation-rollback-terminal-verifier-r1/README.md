# G3 Auth Reconciliation Rollback Terminal Verifier R1

Status: **FROZEN / REVIEW-ONLY / NOT PRODUCTION AUTHORITY**

This evidence branch freezes the independent, read-only verifier used after the one-shot reconciliation rollback.

It does not modify canonical authority, #52, the rollback target, the approval state, the executable packet, or production data.

## Bound authority

- canonical head: `50fe31cff4ab72bfaabaa0e63927a08bde681111`
- #52 target evidence head: `d4377d36e09344b5899f80bc492d7e14190364b9`
- rollback target digest: `sha256:b71d4853f47c8f2404b331c8a9e810747ba211a867353607819ee70ff15bf509`
- rollback executor: `sha256:b510e978e3b3e2cc3f10a008d23921a2a44eecd0c9c8496c871eab2a500c10fd`

## Terminal semantics

The verifier inherits the G2 terminal model instead of creating a new outcome family.

- no durable attempt ledger: `NOT_STARTED`, no terminal receipt
- exact Schema10 restoration proven after a started attempt: `ROLLED_BACK`
- started attempt but exact restoration cannot be proven: `UNKNOWN`
- inability to prove containment or trusted live evidence: fail closed, `UNKNOWN`, no acceptable receipt

`COMMITTED` is not emitted by this rollback-specific verifier.

## Independence

The verifier does not import or invoke the rollback executor. It hashes the frozen executor as an input artifact, verifies the signed approval and packet independently, derives the one-shot attempt ledger path independently, and opens SQLite only with `mode=ro&immutable=1`.

The verifier emits evidence and receipt JSON only to stdout. It does not write a receipt, claim an attempt, exchange files, start services, or re-admit writers.

This branch is evidence-only and must not be merged merely to run the verifier.
