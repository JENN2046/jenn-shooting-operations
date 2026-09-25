# WO-06D Production Change Manifest + Authorization Packet

- Authority base: `56f18930b8a89b19cdbfdde24d090649329d50c9`
- Branch: `codex/wo-06d-production-change-manifest`
- Result: `WO-06D_MANIFEST_PACKET_VALID / MERGE_PENDING / FINAL_REVIEW_PENDING / DEPLOYMENT_AUTHORIZATION_REQUEST_BLOCKED`
- Machine authority candidate: `docs/operations/production-change-manifest.v1.json`
- Safety design: [Production Cutover Safety Contract V1](../operations/PRODUCTION_CUTOVER_SAFETY_CONTRACT_V1.md)
- Retained input design: [Production Evidence Input Boundary V1](../operations/PRODUCTION_EVIDENCE_INPUT_BOUNDARY_V1.md)

This checkpoint covers the safety-definition corrections, continuous source/target barriers, operation-bound final-sync admission and explicit source-barrier acquisition before either execution branch. It is not a production executor, external-capability acceptance or permission to deploy. Complete semantics remain in the linked safety design; this document records implementation and verification evidence.

### Preserved three-class safety contract

| Class | Implemented contract and regression control | Production capability status |
| --- | --- | --- |
| Target-writer race, comments `4103936494` / `4104786562` | Eight exact ordered PROD-13 effects bind authorization, persistent fencing, database/attachment drain, source consistency, same-fence final parity, immediate health/TLS, Switch, read-only verification and success-only release. Ordinary writers remain denied; the final-sync exception is confined to its authorized phase. Reordering is rejected. | `CUTOVER_TARGET_WRITE_FENCE_CAPABILITY = BLOCKED`; deployed fence, bounded exception, drain and failure retention are not implemented or accepted here. |
| Schema trust, comment `4105956155` | Complete canonical schema identity is pinned in reviewed validator source before compilation. A copied admitted snapshot prevents subsequent caller mutation. Joint schema/manifest alteration cannot self-authorize. | Repository validation control implemented; not production authorization or a defense against rewriting trusted validator code itself. |
| Cleanup recovery, comment `4105956167` | PROD-14 binds only rollback 12, which denies new cleanup at all four entries, cancels schedules, drains in-flight work and restores captured disabled configuration. Only approved PROD-14 derives it; ordered recovery puts it first in the applicable subset. | `RESTORED_CLEANUP_DISABLE_CAPABILITY = BLOCKED`; deployed disable-and-drain behavior remains unimplemented/unverified. |

`FINAL_PARITY_UNDER_FENCE_PLAN` replaces the old pre-request final-parity result. Acquisition, drain, final parity and release receipts are generated after exact authorization, not required before requesting their producing action. The final proof binds source snapshot and source-barrier epoch, database/upload-volume identities, target revision, attachment digests, parent cutover, sync operation when used and target-fence epoch. Staging, admin, API, integration/callback, background and direct-storage writers are covered.

Failure, restart, timeout, barrier loss or uncertainty invalidates parity and retains CLOSED admission on both sides independently of process/container lifetime. No automatic retry or lease-expiry release. Divergent staging facts stop cutover, not authorize deletion. Cleanup remains disabled through successful Switch until separately authorized PROD-14. Existing post-Switch authority recovery stays independently blocked.

PROD-14 captures disabled configuration and verifies disable/drain recovery before restoring any control. Its effects and rollback-12 effects are order-sensitive. The rollback strategy is `STOP_CLEANUP_THEN_ROUTE_RUNTIME_PRESERVE_DATA`; it executes only the approved/applicable derived subset. Disabling cleanup cannot restore deleted files, so PROD-14 remains `IRREVERSIBLE_OR_EXTERNAL`.

### Source barrier and operation-bound final-sync contract

Both offline and final-sync paths exclude and drain ordinary source database/upload writers before final sync/parity. Both barriers remain held through Switch, old-source demotion and read-only verification. Success releases only the target fence; old-source writes remain denied, including stale clients and direct old-endpoint access. Failure or uncertainty retains both sides closed.

The separately authorized final-sync exception is phase-limited, bound to parent cutover, sync operation/identity, source/target storage, both epochs, mutation scope and finite bounds. It grants no source writes or general staging/admin/direct-storage authority. Offline mode grants none. Before parity, revoke the exception, drain its database and attachment work and durably seal the phase. Delayed, replayed and stale-epoch grants cannot reopen it. Parity, Switch and read-only verification require zero active exception and zero in-flight mutation; possibly committed synchronization is not automatically retried.

`CUTOVER_SOURCE_CONSISTENCY` remains BLOCKED with the exact criterion `REQUIRES_DEPLOYABLE_SOURCE_WRITE_BARRIER_AND_EXACT_OFFLINE_OR_OPERATION_BOUND_FINAL_SYNC_PLAN_THROUGH_OLD_SOURCE_DEMOTION`, pinned in both manifest and validator. Completed synchronization parity alone is insufficient.

Pre-request checks include `SOURCE_WRITE_BARRIER_CAPABILITY_PROOF`, `SOURCE_WRITE_BARRIER_PLAN`, `FINAL_SYNC_OPERATION_AND_AUTHORITY_TARGETS` and `FINAL_SYNC_EXCEPTION_ADMISSION_REVOCATION_DRAIN_AND_SEAL_PLAN`. These bind capabilities, plans and exact authority, not receipts from unapproved execution. Admission, revocation, database-drain, attachment-drain, phase-seal and zero-active-mutation receipts are execution evidence. Offline receipts demonstrate absence and sealing without inventing synchronization writes.

Five source-barrier evidence items and invariant `SOURCE_AND_TARGET_WRITE_BARRIERS_SPAN_PARITY_SWITCH_AND_DEMOTION` remain frozen, together with `FINAL_SYNC_EXCEPTION_IS_OPERATION_BOUND_PHASE_LIMITED_REVOKED_DRAINED_AND_SEALED_BEFORE_PARITY`. These are definition/validator controls, not deployed concurrency proof.

### Explicit source-acquisition correction

Review comment `4107365457` identified that the final-sync revision conditioned admission on a source barrier already being held but omitted the effect that acquired it. Implementation `4cf90416c190e1bcac0b6ae00812030ce5075cd8` restores that effect in existing step 2, before the offline/synchronized branch and without increasing the eight-step sequence:

```text
With the same fence and no sync exception active, acquire and retain the source-wide database/upload barrier; deny and drain all source writers across processes; drain all initial in-flight target database and attachment mutations across every process; keep every orphan-cleanup entry point disabled
```

The exact same string is frozen in the manifest and validator. Step 1's exact authorization and persistent target fence precede it. It is unconditional for both branches; step 3 cannot admit sync and step 4 cannot check offline parity until the source barrier and both initial drains are proven. Already-held source exclusion is verified and retained under the exact plan, with no release/reacquire gap or unnecessary second barrier.

The safety design explicitly covers all source requests, uploads, integrations, callbacks, cleanup, background work, timers, maintenance and direct-storage writers across processes, including database and attachment work. Unknown coverage, incomplete drain or uncertain ownership stops before synchronization/parity. Global fail-closed semantics apply at every step, not only after Switch. The existing `SOURCE_WRITE_BARRIER_ACQUISITION_AND_DRAIN_PROOF` is produced after authorization; it is not a pre-request requirement for its own producer.

The source correction changes one line in the manifest and the matching validator line, adds two regression groups and aligns the safety design. Existing tests, schema, schema pin, dependencies, workflow and runtime authentication are unchanged. New regressions require explicit acquisition/retention/denial/drain and reject the previous target-only step, assumption-only wording, missing acquisition or drain, synchronization-writer-only coverage, database-only coverage, single-process coverage, offline skipping, delayed acquisition, missing execution receipt and a pre-request receipt cycle. All 28 existing pairwise cutover reordering checks remain. No source barrier, sync, writer or production service executes in these tests.

### Preserved boundaries

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

`AUTHORITY_HEAD` is the only global pre-request check. PROD-01 does not require its own discovered facts. VCP/Kiosk retain deployable wiring -> separately authorized enablement -> real acceptance -> cutover. Their post-enable compatibility/device gates stay BLOCKED and remain cutover prerequisites, not deployment-level blockers. PROD-12 retains exact target/wiring and completed-deployment requirements. PROD-09 still requires source consistency, absent target SQLite, isolated storage and attachment parity before startup. Container removal precedes unused-image removal; named data is preserved.

The manifest has 31 gates, 27 exhaustive BLOCKED gates and 25 actions. The deployment subset remains exactly the five gates in the verdict. No gate or production capability is promoted. The source-acquisition revision changes neither schema content nor its pin.

Raw duplicate rejection and declaration-only evidence admission are unchanged. Both JSON inputs are read once as bytes before schema and semantic admission. Unsupported credential/config/header snippets remain rejected at every length. Invalid semantic results return without a digest. This remains bounded admission, not universal detection of unlabelled secrets or covert encodings.

### Fresh implementation-bearing evidence

- Implementation SHA: `4cf90416c190e1bcac0b6ae00812030ce5075cd8`
- Parent checkpoint: `1181885fd182ddd5d185846f28dcbffab7eeed49`
- Implementation tree: `398ce977b825077be4d93e7a72cb29b6672bc83b`
- GitHub Actions run #119: `36174425984`
- Job: `108201457151`
- Workflow: `.github/workflows/wo06d-production-authorization.yml`
- Event: `push`; attempt: `1`; result: `success`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`
- Runner: Ubuntu `24.04.5`, Linux `6.17.0-1022-azure`

The complete job log was inspected. Checkout and recorded `git rev-parse HEAD` both match the published implementation SHA. Every workflow step succeeded. These results are from GitHub, not a worker's unpublished local run.

```text
npm ci                         PASS
npm run check                  PASS
full tests                     642
pass                           641
fail                           0
skipped                        1
manifest targeted tests        112
manifest targeted pass         112
manifest targeted fail         0
manifest targeted skipped      0
```

The only full-suite skip is the missing external VCP adapter, not compatibility PASS. The unchanged targeted command is `node --test tests/production-change-manifest*.test.mjs`. The retained 93 targeted tests plus 13 safety-contract groups, two source-barrier, two final-sync-exception and two source-acquisition tests total 112. Both new source-acquisition names and all retained source-barrier/final-sync names pass in both suites. No test-name filtering, extra skip or weaker existing assertion was introduced.

### Machine verdict

```json
{
  "status": "WO_06D_MANIFEST_VALID",
  "manifestDigest": "sha256:25e934fcb1159dd094a533fea042601c2744dc7581bf4b1a84f20ff87a905569",
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

The four changed-file identities were read from the published implementation commit/file responses. The other five entries are the previously verified blobs inherited unchanged from its parent; the complete commit comparison confirms no other source/test/schema changes. This table identifies the files in the current implementation tree, not superseded evidence snapshots.

| File | Git blob in implementation tree |
| --- | --- |
| `contracts/production-change-manifest.v1.schema.json` | `1b5a0e0b9d74384016792893842eb415fa0c893b` |
| `docs/operations/production-change-manifest.v1.json` | `391dd831901c007dfcab01002c50f5a7c8f06a21` |
| `src/production-change-manifest-v1.mjs` | `151f2073c8c6a9e02374db4946eb8e3ac979666d` |
| `tests/production-change-manifest.test.mjs` | `6fa93fb5be12a55bff30cc8fc735891d54ac6e2f` |
| `tests/production-change-manifest-safety-contract.test.mjs` | `f3359f4cb4b8117bd51b65a4ec04995ad833ba78` |
| `tests/production-change-manifest-source-barrier.test.mjs` | `526521d5c873e6d11c1aecb64df1ed64448fb286` |
| `tests/production-change-manifest-final-sync-exception.test.mjs` | `8d48982644d153ee8ad4abb527121b2641bda079` |
| `tests/production-change-manifest-source-acquisition.test.mjs` | `94535e513d78b3feb0338c7445839e694bcddf68` |
| `docs/operations/PRODUCTION_CUTOVER_SAFETY_CONTRACT_V1.md` | `cc13d1f0705429f56f2f2f143d1d08a797b73e8d` |

The complete canonical schema SHA-256 pinned by the validator remains `2627409f8a0d6b7342bfe9ce0ffe616e5697e8f7d26c79aacd9263f2f07aaf9e`, distinct from the manifest digest.

### Coverage and limits

The retained safety matrix covers both blocked capabilities, proof/plan bindings, all 28 pairwise cutover swaps, omitted/duplicated steps, fail-open substitutions, cleanup scope/order and old recovery boundaries. Schema tests jointly forge schema/manifest states, remove constants/constraints, substitute invalid/permissive/external-reference schemas, preserve formatting equivalence and test post-construction mutation. An isolated real CLI test requires nonzero exit, empty stdout, fixed root-path errors and no digest for the forged pair; normal input remains valid and blocked.

Source-barrier, final-sync and source-acquisition tests verify the exact frozen definition, its required effects, receipts and order. They do not implement runtime admission grants or prove real deployed concurrency. Existing hostile-input samples remain. Synthetic CLI fixtures use real source modules without modifying checkout authority; no supplied shell/config text executes. No production operation, credential, migration, integration, network mutation or cutover occurred.

### Final review and merge gate

This evidence correction changes only the acceptance and integrated-readiness Markdown files after successful implementation run #119. The resulting docs-only exact head must independently pass the same workflow. Final SHA/run belong in PR/check records and replies, not inside that same commit. Reply/resolve and independent final-head review follow verification; no zero-thread or clean-review result is pre-claimed here.

The user authorized merge only after unchanged exact head, successful exact-head workflow, zero unresolved threads, independent Codex clean for that SHA and OPEN / mergeable / not merged are verified. Merge uses `expected_head_sha` and grants no production authority. Live review inventory belongs in PR/thread records rather than repeated edits to static test evidence.

### Historical evidence boundary

The final-sync implementation `2623a442c4d9c42fec68a4ce06f693af5b227e54`, tree `bf94a5a0adf98c8ca56ce39bfb4e0750bfa2c406`, passed #117 `36171063329` / job `108190419732`; docs-only `1181885fd182ddd5d185846f28dcbffab7eeed49` passed #118 `36171804403` / job `108192896262`. Both had 640/639/0/1, targeted 110/110 and digest `sha256:77fd91b1da4febcd28ca379624a523f84758ace6dbb0420fd94a92cea78d88ac`. Their complete evidence and eight blob identities remain in Git at `1181885fd182ddd5d185846f28dcbffab7eeed49`. Review identified missing explicit source acquisition, so that checkpoint is not clean and cannot validate the current correction.

Source-barrier implementation `4854d4d560fa8bea9029ce023ddbb63e1d60e1f0` passed #115 `36165638366`, fresh rerun job `108179830147`; docs-only `02429a5d00c98e9f1197946da10c8fdd66eaf1f4` passed #116 `36168398516` / job `108181676602`, with 638/637/0/1 and 108/108. Digest `sha256:ed797ad375fcec18575e14a2dd945f6aa472f0944bd52ccae19ba0e8faf0c004` and seven identities remain at that immutable ref. Its independent review produced the final-sync findings and was not clean. Local-only `d97006c0c2073da5f977c8d075293bcc6d5ee473` is not a published GitHub CI identity.

The first safety batch, implementation `86aabe9dc15e9c8c0cc82ff166b6551e45a463e3` / #113 `36162028011` and docs-only `b4dbb12fcad0c2618b006b5a81f7a096ea9d8881` / #114 `36163156059`, passed 636/635/0/1 and 106/106. Digest `sha256:d9db0806c49189529543c952c7955f35aeb62a90063c32529c1f7e0b4dc83ad3` is historical; its review contained a valid finding.

Previous input evidence remains at `4d21ff89ee16a3662061132cb7c2983a7c53e3cf`. Implementation `3f454f9fb41a5a65b6125360783cc804be15adb9` passed #109 `36152821332`, final docs passed #112 `36156164951`, with 623/622/0/1, targeted 93/93 and digest `sha256:029f63f56fa46faa8fbd0f68ede496dadc01526a83887ea81005e4642ee2ee7c`. These are not current safety evidence.

Earlier chronology remains at `36a8a0a3000e8fb750fe60196eddb7a1c97a960c` and unchanged `HISTORICAL_cb456114` files. No new snapshot is created. Verified input ancestry remains `16bc1a8ce94a53003bb12881d24b8ae9a57b630f` -> `d0632e26e9f6f546dcd46aaa5b3d5cdadae60a13` -> `3f454f9fb41a5a65b6125360783cc804be15adb9`. Local-only `86f6e0793b06baa2f70c7cccf9e327877801bc4a` is not publication/CI evidence. Old no-fence/no-cleanup-rollback/unpinned-schema claims and digests cannot override current definitions; `docs/DEPLOYMENT_PREFLIGHT.md` cannot override current authority.
