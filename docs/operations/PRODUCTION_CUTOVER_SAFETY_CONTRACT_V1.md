# WO-06D production safety contract v1

## Scope and authority

This document binds the three remaining review classes as one repository-only contract revision: target writer fencing, schema identity, and recovery from restored orphan cleanup. It changes no production service, integration, data, credential, route, or approval.

The manifest is a non-authorizing definition, not an executor or a production-readiness attestation. All requested, approved, requestable, and derived rollback sets remain empty. The existing deployment gate remains blocked. The two new capability gates are also BLOCKED:

- `CUTOVER_TARGET_WRITE_FENCE_CAPABILITY`: a deployed target-wide fence, drain, and durable fail-closed retention implementation has not been verified.
- `RESTORED_CLEANUP_DISABLE_CAPABILITY`: exact restoration rollback and in-flight cleanup drain have not been implemented and verified.

A future authority revision must supply independently reviewed implementation and deployment evidence before these gates can close. Passing the contract tests does not close either capability gate. Existing post-Switch authority recovery remains separately blocked by `CUTOVER_SWITCH_RECOVERY`; it is not invented by this revision.

## Schema trust boundary

The original bytes of both JSON inputs first pass the existing strict duplicate-rejecting admission layer. The semantic validator then compares the complete canonical schema SHA-256 against a literal pin in its own reviewed source, before compiling any supplied schema. The expected identity is never read from the candidate schema or manifest.

Canonicalization sorts object keys recursively, preserves array order and every scalar value, and uses the existing stable JSON representation. Formatting and object-key order do not alter identity. Any schema-content change, including removal of a constraint or insertion of an external reference, fails with `SCHEMA_AUTHORITY_INVALID`. The validator compiles a copy of the admitted snapshot, so subsequent mutation of the caller's schema object does not change its contract. Failures return fixed root-path issues without source values or a successful digest.

This binds schema to the reviewed validator; it is not a signature, protected-branch configuration, or a claim that code can police an attacker allowed to rewrite the validator itself. Changing the literal pin is an authority-code change and requires review and exact-head CI. Production authorization still requires exact human intent; a matching schema fingerprint is not authorization.

## Cutover request boundary

Before requesting PROD-13, bind the exact database, upload volume, service, writer inventory, fence capability, operation plan, failure retention, and success-only release policy. Include staging principals, direct APIs, VCP/Kiosk/DingTalk and callback paths where applicable, background jobs, timers, maintenance tooling, and every direct database or attachment writer across processes. A route restriction alone is not a target fence. Unknown writers or unverified coverage keep the capability blocked.

`FINAL_PARITY_UNDER_FENCE_PLAN` replaces the former pre-request final-parity result. Acquiring the fence, draining writers, generating the actual final parity proof, switching, and releasing are effects inside the exact authorized PROD-13 operation. Their output receipts cannot be prerequisites for requesting that same operation.

Existing pre-request source-consistency evidence must establish continued source quiescence or an already authorized coordination capability. It cannot substitute for the fresh final database and attachment parity measured after the target is fenced. If a bounded final synchronization is needed, its exact authority must already exist; PROD-13 does not imply a new data-import approval.

## Ordered execution contract

The validator compares PROD-13 `effects` as an exact ordered array, not as a set. Dropping, duplicating, substituting, or reordering a step invalidates the packet.

| Step | Required condition or effect |
| --- | --- |
| 1 | After exact authorization, acquire persistent admission fencing for the bound target database and upload volume, all writers, operation, and fence epoch. |
| 2 | Keep that fence and drain all in-flight database and attachment mutations across all processes. Keep every orphan-cleanup entry point disabled. |
| 3 | Confirm continued source quiescence. If separately authorized bounded final synchronization is used, admit only its exclusive writer, then revoke it and drain again. |
| 4 | With zero remaining writers, recompute source-target database and attachment parity. Bind the proof to the source snapshot, target identities, target revision, attachment digests, operation, and fence epoch. |
| 5 | Immediately before Switch, confirm the same fence and proof bindings, no intervening writes, source consistency, cleanup guard, and read-only loopback and routed TLS health. |
| 6 | Retain the fence while promoting only the exact approved endpoint, data path, and client mappings. Record the Switch without reopening writes. |
| 7 | Retain the same fence through read-only post-Switch health, routing, client-mapping, database, and attachment verification. |
| 8 | Only complete success permits recorded release of that exact fence into the approved production write policy. Cleanup remains disabled until separately authorized PROD-14. |

The exclusive synchronization writer is not a standing bypass. `FINAL_SYNC_WRITER_REVOKED_AND_DRAINED` means proof that no such writer exists on the offline path, or that its exact permission was revoked and its work drained when synchronization was used. It does not require performing a synchronization merely to obtain evidence.

A database revision alone does not prove attachment stability. Receipt bindings must cover the actual upload-volume identity and attachment manifest/digests as well. Staging acceptance can already have created divergent facts; final parity failure stops cutover. It does not authorize deleting staging records, deleting files, overwriting source data, or ignoring differences.

## Failure and recovery

Failure, timeout, restart, fence loss, unknown ownership, incomplete drain, unexpected writers, or inconsistent receipts invalidate the final parity proof. The default remains CLOSED write admission. No lease expiry, process exit, new-container removal, or automatic retry may reopen admission. The required deployed capability must retain this state independently of the process or container being replaced.

Before Switch, leave the old authority in place and retain the fenced target for inspection. After Switch, use only the separately designed and explicitly bound authority-recovery capability; the current manifest continues to block that unavailable capability. Hold target admission closed through recovery and do not use stale parity to release it. Read-only verification cannot silently invoke a write probe, integration event, or cleanup.

These are required semantics of the future executor and deployed fence, not claims that the repository now executes or experimentally proves them. This revision enforces the definition's binding and order. Production acceptance must demonstrate real writer coverage, drain behavior, persistence across failures, identity continuity, and safe release before execution becomes requestable.

## Cleanup restoration and coauthorized recovery

PROD-14 remains a separate irreversible/external forward action. It requires successful cutover and post-cutover attachment parity, plus the blocked `RESTORED_CLEANUP_DISABLE_CAPABILITY`. Before enabling anything, bind the exact service, upload volume, four controls, and captured pre-restoration disabled configuration; verify the disable/cancel/drain capability and rollback target.

Its only rollback is `ROLLBACK-12-DISABLE-RESTORED-ORPHAN-CLEANUP`, coauthorized solely through an approved PROD-14. Approving PROD-13, a sibling integration, or the rollback identifier alone grants no such authority. `ROLLBACK_ONLY` describes the recovery definition, not a claim of present deployed capability. Current approvals remain empty.

On partial restoration or failed verification, immediately deny new cleanup admissions at startup, the periodic timer, `saveUpload`, and `submitRequest`; cancel scheduled work; drain already admitted cleanup using the preverified mechanism; restore the captured disabled configuration; and prove no further cleanup mutation continues. Preserve the database, upload volume, and unrelated configuration.

The global strategy is `STOP_CLEANUP_THEN_ROUTE_RUNTIME_PRESERVE_DATA`. Execute only the ordered intersection with rollback IDs actually derived from the approved and applicable forward changes. Rollback 12 comes first when PROD-14 is in scope; it does not make every listed rollback executable. Existing route/firewall/runtime/image/token/integration recovery order and named-volume preservation remain intact.

PROD-14 and rollback-12 effects are order-sensitive too. The forward action stays `IRREVERSIBLE_OR_EXTERNAL`: disabling configuration cannot restore records or bytes already deleted. No data restoration, deletion compensation, or new standalone approval is fabricated. Failure evidence must retain that distinction.

## Repository acceptance

Retain the existing hostile-input and production-boundary regression corpus. Update only assertions made obsolete by the reviewed contract changes. Add tests for capability removal/self-promotion, every new proof and plan binding, all pairwise cutover step swaps, step removal/duplication, fail-open substitutions, cleanup recovery scope/order, and unchanged old recovery boundaries.

Schema tests jointly change candidate schema and manifest authority fields, remove schema constants/constraints, inject an unsupported schema/reference, and mutate supplied schema objects after validator construction. An isolated real CLI test must reject a forged pair with nonzero exit, empty stdout, fixed error output and no digest, while normal formatting variants still succeed. Fixtures are synthetic; tests perform no production operations and never execute shell/config snippets.

Publish one combined implementation checkpoint, run exact-head repository and targeted CI, synchronize acceptance/work-order evidence from that successful run, and run the docs-only final head independently. Resolve review threads only with this evidence. Final independent review and merge checks must use the exact current head, not an ancestor's green result.
