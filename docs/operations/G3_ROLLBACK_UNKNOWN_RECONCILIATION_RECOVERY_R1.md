# G3 Rollback UNKNOWN Reconciliation Recovery R1

Status: **RECOVERY AUTHORITY SURFACE FREEZE CANDIDATE / NOT EXECUTABLE**

This record addresses the rollback attempt that durably consumed its one-shot replay identity but stopped before `RENAME_EXCHANGE`.

It does not authorize a production mutation. It does not retry the prior attempt. Writers remain blocked, the production service remains stopped, and G4 remains blocked.

## 1. Proven incident

The prior rollback attempt is frozen as:

```text
operationId =
G3-AUTH-RECON-ROLLBACK-20261007-R1

packetId =
G3-AUTH-RECON-ROLLBACK-PACKET-20261007-R1

rollbackTargetDigest =
sha256:b71d4853f47c8f2404b331c8a9e810747ba211a867353607819ee70ff15bf509

attempt record sha256 =
sha256:bfd40da521d2a3871ffcf4b4913de260d51c368eeca0ca775c4bda6b25b5645a

terminal outcome =
UNKNOWN
```

Read-only forensics established the failure stage:

```text
fresh preflight = PASS
durable claim = CREATED
post-claim canonical lookup = TIMEOUT after 8 seconds
error = ROLLBACK_CANONICAL_AUTHORITY_UNAVAILABLE
RENAME_EXCHANGE = NOT EXECUTED
active DB mutation = NOT OBSERVED
```

The exact active and preserved bytes remained:

```text
active Schema11 =
sha256:0eae48b85f362cf1064f92e14511865fe7fd68dbc13a85d4c6efd6e656e736d9

preserved Schema10 =
sha256:5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7
```

The prior attempt is permanently consumed. Its replay identity, target, approval and attempt ledger are not modified or reused.

## 2. Recovery is a new operation, not a retry

The only admissible route is a new human-reconciled operation:

```text
actionId =
G3_AUTHORITY_BINDING_RECONCILIATION_ROLLBACK_UNKNOWN_RECOVERY_TO_10

operationId =
G3-AUTH-RECON-ROLLBACK-RECOVERY-20261007-R1

packetId =
G3-AUTH-RECON-ROLLBACK-RECOVERY-PACKET-20261007-R1

contractId =
G3_AUTHORITY_BINDING_RECONCILIATION_ROLLBACK_RECOVERY_V1

targetId =
G3-AUTH-RECON-ROLLBACK-RECOVERY-TARGET-20261007-R1
```

A future exact recovery target must bind:

1. the post-merge canonical authority head;
2. the exact recovery executor digest;
3. the exact read-only terminal verifier digest;
4. the exact prior UNKNOWN attempt identity and attempt-record digest;
5. the exact current active Schema11 identity;
6. the exact preserved Schema10 identity;
7. fresh containment requirements;
8. the new recovery replay identity.

The target must be frozen before approval. A fresh explicit human approval and Ed25519 signature must bind the new exact target digest.

## 3. Corrected authority admission boundary

The prior executor treated canonical branch stability as something to re-query after the one-shot claim. That created an unsafe dependency:

```text
claim consumed
→ remote GitHub lookup
→ transient timeout
→ UNKNOWN before exchange
```

R1 changes the boundary.

**The durable one-shot claim is the authority-admission boundary.**

Before the claim, the executor must complete every external or fallible admission check, including:

- signed approval and exact target verification;
- prior UNKNOWN attempt binding;
- host / instance / filesystem binding;
- active Schema11 and preserved Schema10 identity;
- integrity and foreign-key checks;
- service, Docker, sidecar, `lsof` and `fuser` containment;
- final `git ls-remote` equality with the approved canonical head.

If any of those checks fail, no new recovery claim is consumed.

Immediately after the final canonical equality check, the executor performs one bounded local exact revalidation of the prior UNKNOWN ledger, both DB inode/hash identities and SQLite sidecar absence. This revalidation has no network, metadata-service, Docker, process-discovery, approval or Git dependency. If it passes, the executor creates the durable new recovery claim.

The renameat2 libc symbol is resolved and configured during preflight before the final canonical check and durable claim. The post-claim path receives the already-resolved function and performs no dynamic syscall resolution.

After a durable claim, the executor is deliberately network-free. It may only:

```text
RENAME_EXCHANGE
→ fsync active parent
→ fsync preserved parent
→ emit UNCLASSIFIED
```

No GitHub lookup, metadata-service request, Docker inspection, `lsof`, `fuser`, approval verification or other remote/external dependency is allowed after the claim.

A canonical branch movement after the durable claim does not retroactively revoke an already admitted attempt. The exact approved head must match at admission, not be polled as an unprovable continuous invariant through the syscall.

## 4. Claim durability failure

The claim itself has one additional fail-closed rule.

If the attempt file is created but a later write/fsync step makes claim durability uncertain, the executor emits `UNKNOWN` with:

```text
claimMayHaveOccurred = true
exchangeMayHaveOccurred = false
automaticRetryAllowed = false
```

It must not proceed to exchange and must not retry.

## 5. Recovery sequence

The sequence is:

```text
merge recovery authority surface
→ freeze exact post-merge recovery target
→ request new explicit human approval
→ verify signed approval bundle
→ fresh live read-only preflight
→ final canonical check
→ durable new recovery claim
→ one RENAME_EXCHANGE
→ independent terminal verification
```

A successful terminal verifier may classify only `ROLLED_BACK`.

Any ambiguity is `UNKNOWN` and remains a hard stop.

Even after `ROLLED_BACK`, this recovery does not authorize writer readmission or production service start. A fresh clean G3 Schema10→11 authority surface, target and approval are still required.

## 6. Hard prohibitions

```text
NO reuse of the prior rollback replay identity
NO mutation of the prior attempt ledger
NO automatic retry
NO second exchange under the prior authority
NO recovery before exact post-merge target freeze
NO recovery without new explicit human approval
NO post-claim canonical network lookup
NO writer readmission
NO production service start
NO G4
```

Machine-readable record:

`docs/operations/g3-rollback-unknown-reconciliation-recovery.r1.json`

Recovery executor candidate:

```text
scripts/g3-authority-reconciliation-rollback-executor.py
sha256:67ed0b02e0dca7887b191b1959efbeab39c40dc2d3f5dc643a9b286761b36233
```

Read-only recovery terminal verifier candidate:

```text
scripts/g3-authority-reconciliation-rollback-recovery-terminal-verifier.py
sha256:1842f3333e0c71641cf31cd1c9b666037382be7671c769fc7b90c8741720fdbc
```

The future exact recovery target must bind both digests. The verifier classifies the admitted attempt from the durable `authorityHeadAtAdmission` stored in the attempt record and performs no post-claim GitHub canonical lookup.
