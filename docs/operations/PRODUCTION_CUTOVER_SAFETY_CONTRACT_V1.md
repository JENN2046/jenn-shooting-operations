# WO-06D production safety contract v1

## Scope and authority

This document binds the three remaining review classes as one repository-only contract revision: target writer fencing, schema identity, and recovery from restored orphan cleanup. It changes no production service, integration, data, credential, route, or approval.

The manifest is a non-authorizing definition, not an executor or a production-readiness attestation. All requested, approved, requestable, and derived rollback sets remain empty. The existing deployment gate remains blocked. The two new capability gates are also BLOCKED:

- `CUTOVER_TARGET_WRITE_FENCE_CAPABILITY`: a deployed target-wide fence, drain, and durable fail-closed retention implementation has not been verified.
- `RESTORED_CLEANUP_DISABLE_CAPABILITY`: repository-level exact disable/drain control now exists, but deployed multi-process behavior and recovery execution have not been acceptance-verified.

A future authority revision must supply independently reviewed implementation and deployment evidence before these gates can close.

The repository now contains a persistent orphan-cleanup control used by startup, periodic, request-triggered, and maintenance cleanup paths. Disabled state survives restart through a marker stored beside the database; destructive cleanup runs register active markers for their full database-and-file lifetime; disable closes admission before waiting for active markers to drain; stale or uncertain run markers keep cleanup closed. Re-enabling requires the exact disable epoch and zero active runs. These repository semantics support later PROD-05/PROD-14 acceptance, but do not by themselves close either cleanup-related production gate. Passing the contract tests does not close either capability gate. Existing post-Switch authority recovery remains separately blocked by `CUTOVER_SWITCH_RECOVERY`; it is not invented by this revision.

## Schema trust boundary

The original bytes of both JSON inputs first pass the existing strict duplicate-rejecting admission layer. The semantic validator then compares the complete canonical schema SHA-256 against a literal pin in its own reviewed source, before compiling any supplied schema. The expected identity is never read from the candidate schema or manifest.

Canonicalization sorts object keys recursively, preserves array order and every scalar value, and uses the existing stable JSON representation. Formatting and object-key order do not alter identity. Any schema-content change, including removal of a constraint or insertion of an external reference, fails with `SCHEMA_AUTHORITY_INVALID`. The validator compiles a copy of the admitted snapshot, so subsequent mutation of the caller's schema object does not change its contract. Failures return fixed root-path issues without source values or a successful digest.

This binds schema to the reviewed validator; it is not a signature, protected-branch configuration, or a claim that code can police an attacker allowed to rewrite the validator itself. Changing the literal pin is an authority-code change and requires review and exact-head CI. Production authorization still requires exact human intent; a matching schema fingerprint is not authorization.

## Cutover request boundary

Before requesting PROD-13, bind the exact database, upload volume, service, writer inventory, fence capability, operation plan, failure retention, and success-only release policy. Include staging principals, direct APIs, VCP/Kiosk/DingTalk and callback paths where applicable, background jobs, timers, maintenance tooling, and every direct database or attachment writer across processes. A route restriction alone is not a target fence. Unknown writers or unverified coverage keep the capability blocked.

`FINAL_PARITY_UNDER_FENCE_PLAN` replaces the former pre-request final-parity result. Acquiring the fence, draining writers, generating the actual final parity proof, switching, and releasing are effects inside the exact authorized PROD-13 operation. Their output receipts cannot be prerequisites for requesting that same operation.

Existing pre-request `FINAL_SOURCE_QUIESCENCE_OR_SYNC_PROOF` must bind either continuously held source write exclusion or a verified coordination capability and exact plan that excludes every source writer before final synchronization/parity and through old-source demotion. A momentary source check or completed sync is insufficient. The source capability and plan are pre-request facts; acquisition/drain receipts are produced only inside the authorized operation. `CUTOVER_SOURCE_CONSISTENCY` remains BLOCKED until that capability is verified in a later authority revision. If bounded final synchronization is needed, its exact authority must already exist; PROD-13 does not imply a new data-import approval.

PROD-13 authority explicitly includes the exact source and target database/upload write barriers. Source exclusion covers ordinary requests, uploads, integrations, callbacks, cleanup, background work and direct storage writers across processes, not just the synchronization worker. Bind the source barrier identity/epoch and snapshot to the same operation as the target fence. Both barriers span final parity, Switch and read-only verification. On success the old source stays write-disabled, including stale clients and direct old-endpoint access; only the target opens for approved production writes. A separately designed and authorized recovery path is required before any later old-source return to authority.

## Ordered execution contract

The validator compares PROD-13 `effects` as an exact ordered array, not as a set. Dropping, duplicating, substituting, or reordering a step invalidates the packet.

| Step | Required condition or effect |
| --- | --- |
| 1 | After exact authorization, acquire persistent admission fencing for the bound target database and upload volume, all writers, operation, and fence epoch. No sync exception is active. |
| 2 | Retain the target fence with no sync exception. Acquire and retain the exact source-wide database/upload barrier, deny and drain all source writers across processes, and drain all initial target database/attachment mutations. Keep every orphan-cleanup entry point disabled. |
| 3 | Only after step 2 proves both drains and the source barrier, admit the separately authorized operation-bound final-sync writer through the same target fence. Revoke its exception, drain database and attachment work, and seal before parity. Offline mode grants no exception. |
| 4 | With zero remaining writers and a sealed sync phase, recompute source-target database and attachment parity. Bind the proof to source snapshot and barrier epoch, target identities/revision/attachment digests, operation, and target fence epoch. |
| 5 | Immediately before Switch, confirm both barriers and all proof bindings, no intervening writes on either side, cleanup guard, and read-only loopback/routed TLS health. |
| 6 | Retain both barriers while promoting only the approved mappings. Record and verify old-source demotion with persistent denied writes; do not reopen target writes yet. |
| 7 | Retain both barriers through read-only post-Switch health, routing, client-mapping, database, and attachment verification; all failure/uncertainty holds both sides closed. |
| 8 | Only complete success and proven old-source demotion permit target-fence release into approved production writes. Old-source writes stay denied; cleanup stays disabled until authorized PROD-14. |

Step 2 is an unconditional authorized effect for both offline and synchronized paths, not an assumption that source exclusion was established elsewhere. It produces `SOURCE_WRITE_BARRIER_ACQUISITION_AND_DRAIN_PROOF` for the exact source database/upload identities, owner, operation and epoch. A source barrier already held under the bound plan must be verified and retained without an admission gap; the step does not require creating a second barrier or reopening the source. All ordinary source requests, uploads, integrations, callbacks, background work, timers, maintenance, cleanup and direct-storage writers are excluded across processes; their database and attachment work must finish or be safely aborted under the verified drain mechanism. Unknown coverage, incomplete drain or uncertain ownership fails closed immediately and cannot advance to step 3 or offline parity. The global failure rule below applies at every step, not only after Switch. Actual acquisition/drain proof stays execution evidence, never a pre-request requirement for its producing action.

The final-sync identity is not a standing bypass. The admission, revocation, database-drain, attachment-drain and phase-seal receipts prove the bounded lifecycle when synchronization is used; on the offline path they prove that no exception was admitted and the phase was sealed without writes. They do not require performing synchronization merely to obtain evidence.

A database revision alone does not prove attachment stability. Receipt bindings must cover the actual upload-volume identity and attachment manifest/digests as well. Staging acceptance can already have created divergent facts; final parity failure stops cutover. It does not authorize deleting staging records, deleting files, overwriting source data, or ignoring differences.

## Failure and recovery

Failure, timeout, restart, source-barrier or target-fence loss, unknown ownership, incomplete drain, unexpected writers, or inconsistent receipts invalidate the final parity proof. The default remains CLOSED write admission on both sides. No lease expiry, process exit, new-container removal, or automatic retry may reopen either side. The required deployed controls must retain this state independently of the process or container being replaced.

Before Switch, leave the old authority mapping in place but do not automatically resume its writes; retain both barriers and the target for inspection. After Switch, use only the separately designed and explicitly bound authority-recovery capability; the current manifest continues to block that unavailable capability. Hold both sides closed through recovery and do not use stale parity to release either. Read-only verification cannot silently invoke a write probe, integration event, or cleanup. Releasing the target on success never releases the old source.

These are required semantics of the future executor and deployed barriers, not claims that the repository now executes or experimentally proves them. This revision enforces the definition's binding and order. Production acceptance must demonstrate real writer coverage, drain behavior, persistence across failures, identity continuity, source demotion, and safe target-only release before execution becomes requestable. The offline and synchronized branches both require source exclusion; synchronization without that guarantee remains unsupported and blocked.

## Cleanup restoration and coauthorized recovery

PROD-14 remains a separate irreversible/external forward action. It requires successful cutover and post-cutover attachment parity, plus the blocked `RESTORED_CLEANUP_DISABLE_CAPABILITY`. Before enabling anything, bind the exact service, upload volume, four controls, and captured pre-restoration disabled configuration; verify the disable/cancel/drain capability and rollback target.

Its only rollback is `ROLLBACK-12-DISABLE-RESTORED-ORPHAN-CLEANUP`, coauthorized solely through an approved PROD-14. Approving PROD-13, a sibling integration, or the rollback identifier alone grants no such authority. `ROLLBACK_ONLY` describes the recovery definition, not a claim of present deployed capability. Current approvals remain empty.

On partial restoration or failed verification, immediately deny new cleanup admissions at startup, the periodic timer, `saveUpload`, and `submitRequest`; cancel scheduled work; drain already admitted cleanup using the preverified mechanism; restore the captured disabled configuration; and prove no further cleanup mutation continues. Preserve the database, upload volume, and unrelated configuration.

The global strategy is `STOP_CLEANUP_THEN_ROUTE_RUNTIME_PRESERVE_DATA`. Execute only the ordered intersection with rollback IDs actually derived from the approved and applicable forward changes. Rollback 12 comes first when PROD-14 is in scope; it does not make every listed rollback executable. Existing route/firewall/runtime/image/token/integration recovery order and named-volume preservation remain intact.

PROD-14 and rollback-12 effects are order-sensitive too. The forward action stays `IRREVERSIBLE_OR_EXTERNAL`: disabling configuration cannot restore records or bytes already deleted. No data restoration, deletion compensation, or new standalone approval is fabricated. Failure evidence must retain that distinction.

## Repository acceptance

Retain the existing hostile-input and production-boundary regression corpus. Update only assertions made obsolete by the reviewed contract changes. Add tests for capability removal/self-promotion, every new proof and plan binding, all pairwise cutover step swaps, step removal/duplication, fail-open substitutions, cleanup recovery scope/order, and unchanged old recovery boundaries.

Schema tests jointly change candidate schema and manifest authority fields, remove schema constants/constraints, inject an unsupported schema/reference, and mutate supplied schema objects after validator construction. An isolated real CLI test must reject a forged pair with nonzero exit, empty stdout, fixed error output and no digest, while normal formatting variants still succeed. Fixtures are synthetic; tests perform no production operations and never execute shell/config snippets.

Source-barrier regressions additionally reject target-only fencing, one-time source checks, synchronization without source exclusion, source-barrier omission from proof bindings, premature source/target release and old-source write resumption after demotion. Source-acquisition regressions require the explicit unconditional acquire/retain/deny/drain effect before both branches and reject the prior target-only step, assumption-only source checks, incomplete storage/writer coverage and delayed acquisition. The acquisition/drain receipt remains required after authorization and forbidden as a pre-request output. Existing safety, source-barrier and final-sync groups remain unchanged.

Publish one combined implementation checkpoint, run exact-head repository and targeted CI, synchronize acceptance/work-order evidence from that successful run, and run the docs-only final head independently. Resolve review threads only with this evidence. Final independent review and merge checks must use the exact current head, not an ancestor's green result.

## Operation-bound final-sync admission correction

The persistent target fence initially denies **every ordinary writer** and has no synchronization exception while it is acquired and while step 2 acquires/retains the source barrier and completes both initial all-process database and attachment drains. The offline path never creates an exception. The synchronized path may create exactly one narrow exception only after that explicit source-acquisition step completes and proves the exact source-wide database/upload barrier is held and all source work is drained.

That exception is not a bypass or a reopening of staging. Its grant is bound to the separately approved final-sync identity and operation, its parent PROD-13 cutover, the exact source and target database/upload identities, both source-barrier and target-fence epochs, an enumerated database/attachment mutation scope, and finite time and work bounds. It grants no source write, admin, general staging, arbitrary direct-storage, integration, callback, cleanup, or ordinary application authority. Every ordinary target writer remains denied by the same persistent fence.

Before final parity, the executor must revoke the exception, drain both its database and attachment work, and durably seal the synchronization phase. The seal rejects delayed grants, replay, reuse by another operation, and any source-barrier or target-fence epoch mismatch. Parity, the immediate pre-Switch checks, Switch, and read-only post-Switch verification all require zero active exception and zero in-flight mutation. A completion receipt cannot replace revocation, both drains, and sealing receipts.

Any failed or uncertain fence/barrier acquisition, synchronization, revocation, database drain, attachment drain, seal, restart, or ownership check invalidates parity and leaves both sides closed. A possibly committed synchronization is never retried automatically, and admission is never reopened automatically. Source exclusion, old-source demotion, target-only success release, cleanup disabling, scoped cleanup recovery, schema identity and the non-authorizing state are unchanged. These are definition and validator regressions, **not real deployed concurrency proof**; `CUTOVER_TARGET_WRITE_FENCE_CAPABILITY` remains BLOCKED until a deployable implementation enforces grant, revocation, drain and sealing semantics.
