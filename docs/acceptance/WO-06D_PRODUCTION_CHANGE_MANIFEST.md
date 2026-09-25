# WO-06D Production Change Manifest + Authorization Packet

- Authority base: `56f18930b8a89b19cdbfdde24d090649329d50c9`
- Branch: `codex/wo-06d-production-change-manifest`
- Result: `WO-06D_MANIFEST_PACKET_VALID / MERGE_PENDING / FINAL_REVIEW_PENDING / DEPLOYMENT_AUTHORIZATION_REQUEST_BLOCKED`
- Machine authority candidate: `docs/operations/production-change-manifest.v1.json`
- Safety design: [Production Cutover Safety Contract V1](../operations/PRODUCTION_CUTOVER_SAFETY_CONTRACT_V1.md)
- Retained input design: [Production Evidence Input Boundary V1](../operations/PRODUCTION_EVIDENCE_INPUT_BOUNDARY_V1.md)

This checkpoint covers the three safety-definition corrections, source-barrier correction, and published operation-bound final-sync admission correction. It is not a production executor, external-capability acceptance or permission to deploy.

### One contract revision for three review classes

The complete design and failure semantics are in `docs/operations/PRODUCTION_CUTOVER_SAFETY_CONTRACT_V1.md`; this evidence does not duplicate that authority specification.

| Class | Implemented contract and regression control | Production capability status |
| --- | --- | --- |
| Target-writer race, comments `4103936494` / `4104786562` | Eight exact ordered PROD-13 effects bind authorization, persistent fencing, database/attachment drain, source consistency, same-fence final parity, immediate health/TLS, Switch, read-only verification and success-only release. Ordinary writers remain denied; the final-sync exception below is confined to its authorized phase. Reordering is rejected. | `CUTOVER_TARGET_WRITE_FENCE_CAPABILITY = BLOCKED`; deployed fence, bounded exception, drain and failure retention are not implemented or accepted here. |
| Schema trust, comment `4105956155` | Complete canonical schema identity is pinned in reviewed validator source before compilation. A copied admitted snapshot prevents subsequent caller mutation. Joint schema/manifest alteration cannot self-authorize. | Repository validation control implemented; not production authorization or a defense against rewriting trusted validator code itself. |
| Cleanup recovery, comment `4105956167` | PROD-14 binds only rollback 12, which denies new cleanup at all four entries, cancels schedules, drains in-flight work and restores captured disabled configuration. Only approved PROD-14 derives it; ordered recovery puts it first in the applicable subset. | `RESTORED_CLEANUP_DISABLE_CAPABILITY = BLOCKED`; deployed disable-and-drain behavior remains unimplemented/unverified. |

`FINAL_PARITY_UNDER_FENCE_PLAN` replaces the old pre-request final-parity result. Acquisition, drain, final parity and release receipts are generated after exact authorization, not required before requesting their producing action. The final proof binds source snapshot and source-barrier epoch, database/upload-volume identities, target revision, attachment digests, parent cutover, sync operation when used and target-fence epoch. Staging, admin, API, integration/callback, background and direct-storage writers are covered.

Failure, restart, timeout, barrier loss or uncertainty invalidates parity and retains CLOSED admission on both sides independently of process/container lifetime. No automatic retry or lease-expiry release. Divergent staging facts stop cutover, not authorize deletion. Cleanup remains disabled through successful Switch until separately authorized PROD-14. Existing post-Switch authority recovery stays independently blocked.

PROD-14 captures disabled configuration and verifies disable/drain recovery before restoring any control. Its effects and rollback-12 effects are order-sensitive. The rollback strategy is `STOP_CLEANUP_THEN_ROUTE_RUNTIME_PRESERVE_DATA`; it executes only the approved/applicable derived subset. Disabling cleanup cannot restore deleted files, so PROD-14 remains `IRREVERSIBLE_OR_EXTERNAL`.

### Source barrier and operation-bound final-sync correction

The source-barrier implementation `4854d4d560fa8bea9029ce023ddbb63e1d60e1f0` corrected comment `4106772579`. Both offline and final-sync paths exclude and drain ordinary source database/upload writers before final sync/parity. Both barriers remain held through Switch, old-source demotion and read-only verification. Success releases only the target fence; old-source writes remain denied, including stale clients and direct old-endpoint access. Failure or uncertainty retains both sides closed.

Independent review of the subsequent `02429a5d00c98e9f1197946da10c8fdd66eaf1f4` checkpoint identified P1 `4107098930` and P2 `4107145082`. That checkpoint's green CI was not accepted as a clean review. Published implementation `2623a442c4d9c42fec68a4ce06f693af5b227e54`, whose parent is exactly that checkpoint, corrects both definitions together:

- The same persistent target fence denies every ordinary writer. Acquisition and the initial all-process database/attachment drain have no active sync exception.
- Only after the exact source barrier is held and drained may phase 3 admit the separately approved final-sync identity. Its authority binds the sync operation and parent cutover, source/target storage identities, both barrier epochs, mutation scope and finite bounds. This grants no source writes or general staging/admin/direct-storage authority. The offline path grants no exception.
- Before parity, revoke that exception, drain its database and attachment work, and durably seal the phase. Delayed, replayed and stale-epoch grants cannot reopen it. Parity, Switch and read-only verification require zero active exception and zero in-flight mutation. Failed or uncertain synchronization is not automatically retried.
- `CUTOVER_SOURCE_CONSISTENCY` remains BLOCKED and now has the exact criterion `REQUIRES_DEPLOYABLE_SOURCE_WRITE_BARRIER_AND_EXACT_OFFLINE_OR_OPERATION_BOUND_FINAL_SYNC_PLAN_THROUGH_OLD_SOURCE_DEMOTION`, pinned in both manifest and validator. Completed synchronization parity alone is insufficient.

Pre-request checks include `SOURCE_WRITE_BARRIER_CAPABILITY_PROOF`, `SOURCE_WRITE_BARRIER_PLAN`, `FINAL_SYNC_OPERATION_AND_AUTHORITY_TARGETS` and `FINAL_SYNC_EXCEPTION_ADMISSION_REVOCATION_DRAIN_AND_SEAL_PLAN`. These bind capabilities, plans and exact authority, not receipts from unapproved execution. The admission, revocation, database-drain, attachment-drain, phase-seal and zero-active-mutation receipts are execution evidence. Offline receipts demonstrate absence and sealing without inventing synchronization writes.

Five source-barrier evidence items and invariant `SOURCE_AND_TARGET_WRITE_BARRIERS_SPAN_PARITY_SWITCH_AND_DEMOTION` remain frozen. The additional invariant `FINAL_SYNC_EXCEPTION_IS_OPERATION_BOUND_PHASE_LIMITED_REVOKED_DRAINED_AND_SEALED_BEFORE_PARITY` and the two new final-sync regression groups cover the narrow exception. Existing safety/source-barrier/core assertions were updated only for the revised contract terms and receipts; all 28 pairwise cutover-order rejection cases remain. These are definition/validator tests, not deployed concurrency proof.

### Preserved boundaries

The packet remains non-authorizing:

```text
approvalModel = EXACT_ACTION_IDS_AND_TARGETS_ONLY
blanketApprovalAllowed = false
requestedActionIds = []
approvedActionIds = []
requestableActionIds = []
derivedRollbackActionIds = []
authorizationPacket = FROZEN_NOT_REQUESTED
deploymentAuthorizationRequest = BLOCKED_PREREQUISITES
deploymentGate = BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

`AUTHORITY_HEAD` is still the only global pre-request check. PROD-01 does not require its own discovered facts. VCP/Kiosk retain deployable wiring -> separately authorized enablement -> real acceptance -> cutover. Their post-enable compatibility/device gates stay BLOCKED and remain cutover prerequisites, not deployment-level blockers. PROD-12 retains exact target/wiring and completed-deployment requirements. PROD-09 still requires source consistency, absent target SQLite, isolated storage and attachment parity before startup. Container removal precedes unused-image removal; named data is preserved.

The manifest has 31 gates, 27 exhaustive BLOCKED gates and 25 actions. The deployment subset stays exactly the five gates shown in the machine verdict. No gate is promoted. The final-sync revision did not change schema content or its pin.

Raw duplicate rejection and declaration-only evidence admission are unchanged. Both files are read once as bytes; matching the schema pin and parsing its admitted snapshot do not replace raw-source checks. Unsupported credential/config/header snippets remain rejected at every length. Runtime authentication, dependencies and workflow permissions are unchanged. Invalid semantic results return without a digest. This remains bounded admission, not universal detection of unlabelled secrets or covert encodings.

### Fresh implementation-bearing evidence

- Implementation SHA: `2623a442c4d9c42fec68a4ce06f693af5b227e54`
- Parent checkpoint: `02429a5d00c98e9f1197946da10c8fdd66eaf1f4`
- Implementation tree: `bf94a5a0adf98c8ca56ce39bfb4e0750bfa2c406`
- GitHub Actions run #117: `36171063329`
- Job: `108190419732`
- Workflow: `.github/workflows/wo06d-production-authorization.yml`
- Event: `push`; attempt: `1`; result: `success`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`
- Runner: Ubuntu `24.04.5`, Linux `6.17.0-1022-azure`

The complete job log was inspected. Checkout and recorded `git rev-parse HEAD` both match the published implementation SHA. Every workflow step succeeded. This is GitHub execution evidence, not the earlier worker's local-only result.

```text
npm ci                         PASS
npm run check                  PASS
full tests                     640
pass                           639
fail                           0
skipped                        1
manifest targeted tests        110
manifest targeted pass         110
manifest targeted fail         0
manifest targeted skipped      0
```

The only full-suite skip remains the missing external VCP adapter; it is not compatibility PASS. The unchanged targeted command is `node --test tests/production-change-manifest*.test.mjs`. The previous 93 targeted tests plus 13 safety-contract groups, two source-barrier tests and two final-sync-exception tests total 110. Both new final-sync test names and both source-barrier test names appear as passed in the full and targeted logs. No dependency, workflow permission, runtime-authentication change, test-name filter or new skip was introduced.

### Machine verdict

```json
{
  "status": "WO_06D_MANIFEST_VALID",
  "manifestDigest": "sha256:77fd91b1da4febcd28ca379624a523f84758ace6dbb0420fd94a92cea78d88ac",
  "authorizationPacket": "FROZEN_NOT_REQUESTED",
  "deploymentAuthorizationRequest": "BLOCKED_PREREQUISITES",
  "deploymentGate": "BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE",
  "requestableActionIds": [],
  "blockingGateIds": [
    "WO06C_VCP_EXTERNAL",
    "VCP_DEPLOYABLE_ADAPTER_WIRING",
    "WO06C_KIOSK_DEVICE",
    "KIOSK_DEPLOYABLE_AUTH_WIRING",
    "DINGTALK_TARGET_BINDING",
    "DINGTALK_DEPLOYABLE_ADAPTER_WIRING",
    "CUTOVER_FORWARD_CHAIN",
    "CUTOVER_SWITCH_RECOVERY",
    "CUTOVER_SOURCE_CONSISTENCY",
    "CUTOVER_LIVE_SERVICE_READINESS",
    "TARGET_HOST_BINDING",
    "CONTAINER_START_READINESS",
    "PRE_CUTOVER_ORPHAN_CLEANUP_CONTROL",
    "HEALTH_SMOKE_READINESS",
    "PROXY_BACKEND_READINESS",
    "PRE_CUTOVER_ROUTE_WRITE_RESTRICTION",
    "PRODUCTION_IMPORT_STORAGE_READINESS",
    "PRODUCTION_IMPORT_TARGET_ABSENCE",
    "PRODUCTION_IMPORT_SOURCE_CONSISTENCY",
    "PRODUCTION_ATTACHMENT_COPY_CAPABILITY",
    "INTEGRATION_DEPLOYMENT_READINESS",
    "PRODUCTION_TARGET_FACTS",
    "PRODUCTION_DATA_MIGRATION",
    "POST_CUTOVER_ORPHAN_CLEANUP_RESTORATION",
    "CUTOVER_TARGET_WRITE_FENCE_CAPABILITY",
    "RESTORED_CLEANUP_DISABLE_CAPABILITY",
    "PRODUCTION_DEPLOYMENT_GATE"
  ],
  "deploymentBlockingGateIds": [
    "VCP_DEPLOYABLE_ADAPTER_WIRING",
    "KIOSK_DEPLOYABLE_AUTH_WIRING",
    "PRODUCTION_TARGET_FACTS",
    "PRODUCTION_DATA_MIGRATION",
    "PRODUCTION_DEPLOYMENT_GATE"
  ]
}
```

### Verified source identities

These Git blob identities were read from exact-ref file or commit responses for the implementation SHA above, not inferred from filenames or copied from superseded evidence.

| File | Verified Git blob |
| --- | --- |
| `contracts/production-change-manifest.v1.schema.json` | `1b5a0e0b9d74384016792893842eb415fa0c893b` |
| `docs/operations/production-change-manifest.v1.json` | `b4eda292999261279a3b46ffe83b99d923c312d7` |
| `src/production-change-manifest-v1.mjs` | `2e0b480f2d5014c104f0cf38b27e6c361e5e8fb6` |
| `tests/production-change-manifest.test.mjs` | `6fa93fb5be12a55bff30cc8fc735891d54ac6e2f` |
| `tests/production-change-manifest-safety-contract.test.mjs` | `f3359f4cb4b8117bd51b65a4ec04995ad833ba78` |
| `tests/production-change-manifest-source-barrier.test.mjs` | `526521d5c873e6d11c1aecb64df1ed64448fb286` |
| `tests/production-change-manifest-final-sync-exception.test.mjs` | `8d48982644d153ee8ad4abb527121b2641bda079` |
| `docs/operations/PRODUCTION_CUTOVER_SAFETY_CONTRACT_V1.md` | `5fde2733e7dbca27ca28053b3f20d1d1e664b47a` |

The complete canonical schema SHA-256 pinned by the validator is `2627409f8a0d6b7342bfe9ce0ffe616e5697e8f7d26c79aacd9263f2f07aaf9e`; this is a schema identity, not the manifest digest.

### Coverage and limits

The retained 13-group safety matrix covers both blocked capabilities, proof/plan bindings, all 28 pairwise cutover step swaps, omitted/duplicated steps, fail-open substitutions, cleanup scope/order and old recovery boundaries. Schema tests jointly forge schema/manifest states, remove schema constants/constraints, substitute invalid/permissive/external-reference schemas, preserve formatting equivalence and test post-construction mutation. An isolated real CLI test requires nonzero exit, empty stdout, fixed root-path errors and no digest for the forged pair; normal input remains valid and blocked.

The source-barrier and final-sync groups extend that coverage with continuous source exclusion, ordinary-writer denial, phase-limited admission, receipt requirements, revocation, both drains, phase sealing, offline absence and rejection of blanket/early/late/stale grants. Exact frozen definitions are checked; no runtime grant implementation or concurrent production execution is claimed.

Existing groups and hostile-input samples are retained. Synthetic CLI fixtures use real source modules without modifying checkout authority. No supplied shell/config text executes. These tests validate definitions and bindings, not deployed writer fencing or real cleanup recovery. No production operation, credential, migration, integration, network mutation or cutover occurred.

### Final review and merge gate

This evidence correction changes only the acceptance and integrated-readiness Markdown documents after successful implementation run #117. The resulting docs-only exact head must pass the same workflow independently. Final SHA/run belong in the PR/check record and replies, not inside that same commit. Reply/resolve and independent final-head review follow verification; no zero-thread or clean-review result is pre-claimed here.

The user has authorized merge only after these gates pass. Recheck unchanged exact head, successful exact-head workflow, zero unresolved threads, independent Codex clean for that SHA, OPEN / mergeable / not merged; merge with `expected_head_sha`. Merge does not grant production authorization. Subsequent live review inventory is maintained in PR/thread records rather than rewriting static test evidence for every comment.

### Historical evidence boundary

Source-barrier implementation `4854d4d560fa8bea9029ce023ddbb63e1d60e1f0` passed run #115 `36165638366`, fresh rerun job `108179830147`. Docs-only `02429a5d00c98e9f1197946da10c8fdd66eaf1f4` passed #116 `36168398516`, job `108181676602`, with 638/637/0/1 and 108/108. Its digest `sha256:ed797ad375fcec18575e14a2dd945f6aa472f0944bd52ccae19ba0e8faf0c004` and source identities remain available in both documents at that immutable ref. That review produced the two final-sync findings and was not clean. Those results do not validate the current revision. Local-only `d97006c0c2073da5f977c8d075293bcc6d5ee473` is not a GitHub CI identity; current evidence uses the actually published `2623a442c4d9c42fec68a4ce06f693af5b227e54`.

The first safety batch, implementation `86aabe9dc15e9c8c0cc82ff166b6551e45a463e3` / run #113 `36162028011` and docs-only `b4dbb12fcad0c2618b006b5a81f7a096ea9d8881` / run #114 `36163156059`, passed 636/635/0/1 and 106/106. Its digest `sha256:d9db0806c49189529543c952c7955f35aeb62a90063c32529c1f7e0b4dc83ad3` predates source-barrier completion and is not the current digest. Its independent review contained a valid finding, not a clean signal.

The complete previous input evidence remains in Git at `4d21ff89ee16a3662061132cb7c2983a7c53e3cf`. Its implementation `3f454f9fb41a5a65b6125360783cc804be15adb9` passed run #109 `36152821332`, and its final docs passed #112 `36156164951`, with 623/622/0/1 and targeted 93/93. Those results and manifest digest `sha256:029f63f56fa46faa8fbd0f68ede496dadc01526a83887ea81005e4642ee2ee7c` are historical, not evidence for the current safety revision.

Earlier complete chronology remains at `36a8a0a3000e8fb750fe60196eddb7a1c97a960c` and in the unchanged `HISTORICAL_cb456114` files. No new snapshot is created. Verified input ancestry remains `16bc1a8ce94a53003bb12881d24b8ae9a57b630f` -> `d0632e26e9f6f546dcd46aaa5b3d5cdadae60a13` -> `3f454f9fb41a5a65b6125360783cc804be15adb9`. Local-only `86f6e0793b06baa2f70c7cccf9e327877801bc4a` is not publication/CI evidence. Old no-fence/no-cleanup-rollback/unpinned-schema claims and older digests do not override current definitions; `docs/DEPLOYMENT_PREFLIGHT.md` cannot override current authority.
