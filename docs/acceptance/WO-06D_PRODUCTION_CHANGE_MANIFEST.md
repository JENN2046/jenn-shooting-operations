# WO-06D Production Change Manifest + Authorization Packet

- Authority base: `56f18930b8a89b19cdbfdde24d090649329d50c9`
- Branch: `codex/wo-06d-production-change-manifest`
- Current result: `WO-06D_MANIFEST_PACKET_VALID / MERGE_PENDING / DEPLOYMENT_AUTHORIZATION_REQUEST_BLOCKED`
- Deployment gate: `BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE`

## Goal

Freeze the exact production-change surface and the human-authorization packet without performing any production action.

WO-06D answers:

1. What could change in production?
2. What exact target would each change apply to?
3. What prerequisites must be true first?
4. What evidence must be captured?
5. What rollback action corresponds to the change?
6. Which actions are requestable for separate explicit authorization?
7. Which actions remain blocked and why?

## Authority artifact

Machine-readable authority candidate:

`docs/operations/production-change-manifest.v1.json`

Schema:

`contracts/production-change-manifest.v1.schema.json`

Validator:

`npm run validate:production-manifest`

The authorization packet is nested inside the manifest so it cannot drift from the change list it governs.

Pre-request revalidation is split into a truly global checklist plus action-specific checks. The global checklist now contains only `AUTHORITY_HEAD`. Host identity/conflict facts, backup/rollback proof, secret storage, external readiness, rollback-target scope, build source/base digest, and built-image digest are all bound only to the actions that can actually satisfy and require them. PROD-01 has no action-specific revalidation and remains gated only by its exact candidate-host binding plus the global authority-head check.

## Frozen authorization semantics

```text
approvalModel = EXACT_ACTION_IDS_AND_TARGETS_ONLY
blanketApprovalAllowed = false
requestedActionIds = []
approvedActionIds = []
deploymentAuthorizationRequest = BLOCKED_PREREQUISITES
deploymentGate = BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

Nothing in WO-06D is an authorization to execute an action.

## Current blockers

The deployment authorization request remains blocked by the dedicated deployment-level set:

- VCP real compatibility: `WO06C_VCP_EXTERNAL`;
- Kiosk real-device evidence: `WO06C_KIOSK_DEVICE`;
- unresolved production host/route/storage facts: `PRODUCTION_TARGET_FACTS`;
- unvalidated real production migration inputs: `PRODUCTION_DATA_MIGRATION`;
- the explicit production deployment gate itself: `PRODUCTION_DEPLOYMENT_GATE`.

This subset is frozen separately as `deploymentBlockingGateIds`.

`blockingGateIds` has a different, exhaustive meaning: it must equal **every gate whose current status is `BLOCKED`**. It therefore also contains the action-specific blockers `DINGTALK_TARGET_BINDING`, `CUTOVER_FORWARD_CHAIN`, `CUTOVER_SWITCH_RECOVERY`, `TARGET_HOST_BINDING`, `CONTAINER_START_READINESS`, `HEALTH_SMOKE_READINESS`, `PROXY_BACKEND_READINESS`, `PRODUCTION_IMPORT_STORAGE_READINESS`, and `INTEGRATION_DEPLOYMENT_READINESS`. The validator derives the expected exhaustive set from the gate statuses, so a newly blocked gate cannot be omitted from the CLI checklist.

WO-06C still classifies the local DingTalk provider boundary as `READY_FOR_EXTERNAL_INTEGRATION_AUTHORIZATION`, but WO-06D separately freezes `DINGTALK_TARGET_BINDING = BLOCKED` because no concrete app/provider identity plus bounded test destination has been supplied. Provider readiness therefore does not make `PROD-12` requestable.

## Requestable actions

No action definition is currently requestable. The frozen requestable set is empty.

`PROD-01-TARGET-READONLY-PREFLIGHT` is `BLOCKED_PREREQUISITE` behind `TARGET_HOST_BINDING`, not `PRODUCTION_TARGET_FACTS`. This breaks the prerequisite cycle: one exact candidate host must be structurally bound first, then PROD-01 may verify that binding and discover the disk/port/container/proxy/TLS facts that later close `PRODUCTION_TARGET_FACTS`.

`PROD-12-DINGTALK-PROVIDER-INTEGRATION` remains `BLOCKED_PREREQUISITE` with `authorityTarget = UNRESOLVED_DINGTALK_TARGET_BINDING` and prerequisite `DINGTALK_TARGET_BINDING`. It cannot become requestable until a concrete DingTalk app/provider identity and one bounded test destination are structurally bound in a separately reviewed authority revision.

All mutation/deployment/cutover actions remain blocked or conditional.

## Rollback rule

Rollback order is frozen as:

```text
remove new route
→ revert only the newly changed firewall/security-group rule
→ stop new container
→ remove the exact PROD-04 image digest after proving it is unused
→ revoke/remove role-token runtime bindings created by PROD-03
→ disable only VCP configuration introduced by PROD-10
→ disable only Kiosk configuration introduced by PROD-11
→ disable only DingTalk configuration introduced by PROD-12
→ preserve data volume and stop mutation
```

Data-volume deletion is explicitly forbidden by this packet.

## Historical preflight note

`docs/DEPLOYMENT_PREFLIGHT.md` is retained as historical context, but it is not the current production authorization authority. Any statement there that conflicts with WO-06A/B/C/D must defer to the current WO-06 authority and this manifest.

## Exit

This work package may become:

```text
WO-06D_MANIFEST_PACKET_VALID
DEPLOYMENT_AUTHORIZATION_REQUEST = BLOCKED_PREREQUISITES
BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

after exact-head validation and independent review.

That state means the authorization packet is well-formed, not that deployment is approved or even request-ready.


## Fresh implementation-bearing evidence

- Head: `a1eb4199cf7a7cbaf68e24b0a20ef72f2876e6ff`
- GitHub Actions run: `36036138172`
- Conclusion: `success`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`

Repository gate:

```text
npm ci                         PASS
npm run check                  PASS
tests                          564
pass                           563
fail                           0
skipped                        1
```

The single skip remains the external VCP adapter and does not close WO-06C external validation.

Manifest targeted tests:

```text
tests  34
pass   34
fail   0
```

Machine verdict:

```json
{
  "status": "WO_06D_MANIFEST_VALID",
  "manifestDigest": "sha256:ae134f0803e558ad15f8f19428158b450d8c745534cb2ebaeb8465d70144cf7e",
  "authorizationPacket": "FROZEN_NOT_REQUESTED",
  "deploymentAuthorizationRequest": "BLOCKED_PREREQUISITES",
  "deploymentGate": "BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE",
  "requestableActionIds": [],
  "blockingGateIds": [
    "WO06C_VCP_EXTERNAL",
    "WO06C_KIOSK_DEVICE",
    "DINGTALK_TARGET_BINDING",
    "CUTOVER_FORWARD_CHAIN",
    "CUTOVER_SWITCH_RECOVERY",
    "TARGET_HOST_BINDING",
    "CONTAINER_START_READINESS",
    "HEALTH_SMOKE_READINESS",
    "PROXY_BACKEND_READINESS",
    "PRODUCTION_IMPORT_STORAGE_READINESS",
    "INTEGRATION_DEPLOYMENT_READINESS",
    "PRODUCTION_TARGET_FACTS",
    "PRODUCTION_DATA_MIGRATION",
    "PRODUCTION_DEPLOYMENT_GATE"
  ],
  "deploymentBlockingGateIds": [
    "WO06C_VCP_EXTERNAL",
    "WO06C_KIOSK_DEVICE",
    "PRODUCTION_TARGET_FACTS",
    "PRODUCTION_DATA_MIGRATION",
    "PRODUCTION_DEPLOYMENT_GATE"
  ]
}
```

The validator also fresh-rejects:

- ordinary Bearer/access-token/token-shaped secret material embedded in schema-valid free text, including Bearer credentials split by raw newline, tab, or CRLF whitespace before JSON serialization;
- secret fields, pre-populated approved action IDs and blanket approval;
- missing or extra entries in the exhaustive `blockingGateIds` surface, including action-specific blocked gates;
- drift in the separate deployment-level `deploymentBlockingGateIds` subset;
- authority-target widening for frozen action IDs;
- production data/VCP/Kiosk/cutover actions that drop `PRODUCTION_TARGET_FACTS` or any other frozen prerequisite;
- any action whose requestable/non-requestable status drifts from the frozen empty requestable set;
- attempts to make DingTalk requestable with either of two different app/destination candidates before exact target binding;
- rollback bindings redirected to the wrong rollback action, even when the replacement is syntactically a rollback action;
- rollback references to non-rollback actions;
- additional or replaced production action IDs;
- a hostile combined mutation that simultaneously widens target, requestability, prerequisites and rollback while embedding a Bearer secret.

## PR-branch closure state

Before merge, this branch may claim only:

```text
WO-06D_MANIFEST_PACKET_VALID
MERGE_PENDING
DEPLOYMENT_AUTHORIZATION_REQUEST = BLOCKED_PREREQUISITES
BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

After merge, a docs-only authority closure may publish WO-06D PASS if the final PR head also passes the unchanged workflow and independent review.


## Review hardening closure candidate

Codex review on the prior head reported four P1 and one P2 authorization-surface gaps. They are addressed together by freezing the authority contract for all frozen action IDs.

| Finding | Closure |
| --- | --- |
| P1 Bearer detector escaped incorrectly | Bearer whitespace detection now uses the intended regex and hostile free-text token regressions |
| P1 authorityTarget was free text | every frozen action ID is bound to its exact authorityTarget |
| P1 target-facts prerequisite could be removed | all frozen preconditions are checked as exact sets; the four high-risk actions explicitly retain `PRODUCTION_TARGET_FACTS` |
| P1 requestable status check was one-way | action status is frozen per ID and requestable-status membership is validated bidirectionally |
| P2 rollback only checked category | each action is bound to its exact rollback-action set; rollback category checks remain defense in depth |

Additional hostile regression rejects unknown/replaced action IDs and a combined multi-axis authorization widening attempt.

Implementation-bearing hardening evidence:

```text
head   38453503ade5b276735097e59d17bb44959e20ca
run    35986269431
result success

full suite      549 tests / 548 pass / 0 fail / 1 expected VCP skip
manifest suite  19 / 19 PASS
manifest digest sha256:b03782756107194f5edf7fa624abf0223f5628e7316134d91b312b79962e05f1
```

The manifest body itself is unchanged, so its canonical digest remains stable while the validator around it becomes stricter.

This evidence update is docs-only. The resulting final PR head must also pass the unchanged WO-06D workflow before merge.


## Second review hardening closure candidate

The re-review identified three additional P1 gaps. They are closed on implementation-bearing head `38453503ade5b276735097e59d17bb44959e20ca`:

| Finding | Closure |
| --- | --- |
| P1 authorityBase accepted any SHA | schema now binds `authorityBase` to the frozen authority commit and regression proves unrelated SHAs fail closed |
| P1 action risk/sideEffect/evidence could be understated | all frozen action IDs now freeze title, category, risk, sideEffect, status, authorityTarget, preconditions, effects, rollback bindings and evidenceRequired |
| P1 mustRevalidateBeforeRequest could be reduced | the complete pre-request revalidation checklist is validated as an exact frozen set |

Additional hostile regressions also freeze:

- target unresolved-fact set;
- global invariants;
- gate evidence text;
- action title/category/effects;
- combined semantic widening after schema admission.

Implementation-bearing evidence:

```text
head   38453503ade5b276735097e59d17bb44959e20ca
run    35986269431
result success

full suite      549 tests / 548 pass / 0 fail / 1 expected VCP skip
manifest suite  19 / 19 PASS
manifest digest sha256:b03782756107194f5edf7fa624abf0223f5628e7316134d91b312b79962e05f1
```

The manifest JSON remains unchanged, so the digest is stable. This evidence update is docs-only and must itself pass the unchanged workflow before review closure.


## Final firewall rollback-order correction

A final Codex P2 identified that `PROD-08-FIREWALL-SECURITY-GROUP` had an exact per-action rollback binding to `ROLLBACK-05-REVERT-FIREWALL-RULE`, but the global ordered rollback plan omitted that rollback step.

The manifest and validator now freeze the global rollback order as:

```text
ROLLBACK-01-REMOVE-NEW-ROUTE
→ ROLLBACK-05-REVERT-FIREWALL-RULE
→ ROLLBACK-02-STOP-NEW-CONTAINER
→ ROLLBACK-03-DISABLE-EXTERNAL-CONFIG
→ ROLLBACK-04-PRESERVE-DATA-VOLUME
```

The firewall rule is reverted immediately after removing the newly exposed route, restoring the network boundary before the remaining runtime/config rollback steps.

Hostile regression proves that both omission and misplacement of `ROLLBACK-05` fail with `ROLLBACK_PLAN_ORDER_INVALID`.

Final manifest-bearing implementation evidence:

```text
head   097800f17df598d02b0c7f51d893cbe69b2d1d9b
run    35987184987
result success

full suite      550 tests / 549 pass / 0 fail / 1 expected VCP skip
manifest suite  20 / 20 PASS
manifest digest sha256:99c7c6c6f2477d1c256879bb14ccc964122232a9d032b070c084b727c37938a7
```

This P2 intentionally changes the manifest body, so the prior `sha256:b037827...` digest remains historical evidence only. The digest above is the current manifest authority candidate.

The resulting docs-only PR head must pass the unchanged WO-06D workflow before the review thread is closed.


## DingTalk exact-target P1 correction

Latest Codex P1 showed that the previously frozen DingTalk `authorityTarget` text was still generic and therefore could not satisfy `EXACT_ACTION_IDS_AND_TARGETS_ONLY` while `PROD-12` remained requestable.

The fail-closed correction does not invent an app ID, provider ID, recipient, webhook or credential:

- new gate: `DINGTALK_TARGET_BINDING = BLOCKED / EXACT_APP_PROVIDER_AND_TEST_DESTINATION_UNRESOLVED`;
- `PROD-12` status: `BLOCKED_PREREQUISITE`;
- `PROD-12.authorityTarget = UNRESOLVED_DINGTALK_TARGET_BINDING`;
- `PROD-12` prerequisites include both `WO06C_DINGTALK_PROVIDER` and `DINGTALK_TARGET_BINDING`;
- authorization-packet `requestableActionIds` contains only `PROD-01-TARGET-READONLY-PREFLIGHT`;
- requested and approved arrays remain empty.

Exact implementation-bearing evidence:

```text
head             89c6c95a0d3b30a4dc36067aac7d3d81aec1ef15
run              36014400886
result           success
full suite       551 tests / 550 pass / 0 fail / 1 expected VCP skip
manifest suite   21 / 21 PASS
manifest digest  sha256:2083b959badbf0a11ea1df2c5af32c111c8eac2200738d4db41d025de13b4833
```

The hostile regression attempts two different DingTalk app/destination candidate targets and proves neither can be promoted into the frozen requestable surface.


## Production-host target and role-token rollback correction

Exact-current review on `66023a218d...` identified two additional gaps:

1. `PROD-01-TARGET-READONLY-PREFLIGHT` was still requestable while `target.hostIdentifier = null`.
2. `PROD-03-GENERATE-INSTALL-TOKENS` had no rollback dedicated to removing the four generated role-token bindings.

The fail-closed correction now freezes:

```text
PROD-01.status = BLOCKED_PREREQUISITE
PROD-01.authorityTarget = UNRESOLVED_PRODUCTION_HOST_IDENTITY
PROD-01.preconditions = [PRODUCTION_TARGET_FACTS]

requestableActionIds = []

PROD-03.rollbackActionIds = [ROLLBACK-06-REVOKE-ROLE-TOKENS]
ROLLBACK-06.status = ROLLBACK_ONLY
```

`ROLLBACK-06-REVOKE-ROLE-TOKENS` is scoped only to the four role tokens and server-restricted runtime bindings created by `PROD-03`; its evidence requires `ROLE_TOKEN_BINDINGS_REMOVED` and `SECRET_VALUES_NOT_LOGGED`. The global rollback order includes rollback 06 after stopping the new container and before disabling external integration configuration.

Hostile regression attempts two different production-host candidate targets and proves neither can enter the requestable surface while host identity is unresolved. Additional regression proves `PROD-03` cannot be rebound to the generic external-config rollback and that rollback 06 cannot be omitted from the global sequence.

Exact implementation-bearing evidence:

```text
head             239527fbdd88e6aad27fc039ac1ab20d9165b138
run              36015492997
result           success
full suite       553 tests / 552 pass / 0 fail / 1 expected VCP skip
manifest suite   23 / 23 PASS
manifest digest  sha256:4ae83ba4ce1fb4e6cace95b2768a011f36bd91efb4432b36bae49e92845b3531
```

The packet remains `FROZEN_NOT_REQUESTED`; requested/approved action arrays remain empty; deployment authorization remains blocked.


## Cutover forward-chain + derived rollback authority correction

Exact-current review identified two additional future-execution contract gaps:

1. `PROD-13-CUTOVER-SWITCH` could previously become authorizable after closing broad gates without proving the forward deployment chain had actually succeeded.
2. Rollback actions were marked as requiring their own explicit approval even though a forward action may need immediate recovery authority during an incident.

The current machine contract now adds:

```text
CUTOVER_FORWARD_CHAIN = BLOCKED
evidence = REQUIRES_VERIFIED_PROD_02_03_04_05_06_07_09_AND_PROD_08_IF_USED

PROD-13.preconditions += CUTOVER_FORWARD_CHAIN
PROD-13.evidenceRequired += FORWARD_CHAIN_COMPLETION_PROOF

rollbackAuthorizationModel = BOUND_ROLLBACK_IDS_COAUTHORIZED_WITH_FORWARD_ACTION
separateRollbackApprovalRequired = false
derivedRollbackActionIds = []
```

The cutover rollback binding now also covers all six frozen rollback capabilities, including firewall revert and role-token revocation. Forward actions continue to require explicit human authorization; rollback-only actions do not require a second standalone approval and can only receive authority as the exact derived rollback set of an approved forward action.

Hostile regressions prove that the cutover chain gate/completion proof cannot be removed or self-promoted, rollback authority cannot be forged without a forward approval, and rollback actions cannot be changed back into second-approval operations.

Exact implementation-bearing evidence:

```text
head             a9f80f38b2745ee739f6d35fae708172840cdefa
run              36016721973
result           success
full suite       555 tests / 554 pass / 0 fail / 1 expected VCP skip
manifest suite   25 / 25 PASS
manifest digest  sha256:f3d912fa3afeb94473bee8d75583516a0899e45f69374d7754b8d0389e0f3575
```

The current packet still carries no requested, approved, requestable, or derived rollback action IDs. No deployment or rollback action was executed.


## Post-Switch authority recovery blocker

The latest P1 correctly distinguishes pre-Switch deployment rollback from post-Switch business recovery. The existing migration authority states that after Switch, recovery requires a separately designed dual-read / compatible-write path plus a switch record; WO-06D must not infer that capability from pre-Switch backup/restore evidence.

The current manifest therefore freezes:

```text
CUTOVER_SWITCH_RECOVERY = BLOCKED
evidence = POST_SWITCH_DUAL_READ_COMPATIBLE_WRITE_AND_SWITCH_RECORD_NOT_DESIGNED

PROD-13.preconditions += CUTOVER_SWITCH_RECOVERY
PROD-13.rollbackActionIds += ROLLBACK-07-RESTORE-PREVIOUS-AUTHORITY-SWITCH

ROLLBACK-07.status = BLOCKED_PREREQUISITE
ROLLBACK-07.authorityTarget = UNRESOLVED_POST_SWITCH_AUTHORITY_RECOVERY_CAPABILITY
ROLLBACK-07.preconditions = [CUTOVER_SWITCH_RECOVERY]
```

`ROLLBACK-07` is deliberately **not** in the executable global rollback order and is not derived as co-authorized rollback authority while blocked. It is a structural recovery requirement, not a claim that post-Switch reversal already exists.

`PROD-13` now also requires `POST_SWITCH_RECOVERY_DESIGN`, `DUAL_READ_COMPATIBLE_WRITE_RECOVERY_PROOF`, and `SWITCH_RECORD` evidence. Regression proves the recovery gate cannot be self-promoted, the switch-restore rollback cannot be dropped from the cutover binding, and the blocked rollback cannot be activated without a new reviewed authority revision.

Exact implementation-bearing evidence:

```text
head             11c172f50d6cf843eed391de400f473f43db1f04
run              36020032853
result           success
full suite       556 tests / 555 pass / 0 fail / 1 expected VCP skip
manifest suite   26 / 26 PASS
manifest digest  sha256:91d0fd5fb681e402fd0fda67f211d6abc6002eab4eff3976e8c5c441d483de3e
```

No Switch, route mutation, client remap, migration, provider call, or production rollback was executed.


## Exhaustive blockers + proxy backend predecessor correction

Two P2 findings on exact head `5c5c977f...` exposed adjacent prerequisite semantics:

1. the CLI blocker checklist was not exhaustive because action-specific blocked gates were omitted;
2. `PROD-07-CONFIGURE-REVERSE-PROXY-TLS` could be authorized before the backend had been built, started, and health-checked.

The current contract now freezes two distinct blocker surfaces:

```text
blockingGateIds = every gate with status BLOCKED

deploymentBlockingGateIds =
  WO06C_VCP_EXTERNAL
  WO06C_KIOSK_DEVICE
  PRODUCTION_TARGET_FACTS
  PRODUCTION_DATA_MIGRATION
  PRODUCTION_DEPLOYMENT_GATE
```

Current exhaustive `blockingGateIds` also includes:

```text
DINGTALK_TARGET_BINDING
CUTOVER_FORWARD_CHAIN
CUTOVER_SWITCH_RECOVERY
PROXY_BACKEND_READINESS
```

The validator computes the exhaustive expected set directly from current gate statuses. Hostile regression removes several action-specific blockers, adds a non-blocked gate, narrows the deployment subset, and widens the deployment subset with an action-specific blocker; every case fails closed.

Proxy exposure now has its own predecessor gate:

```text
PROXY_BACKEND_READINESS = BLOCKED
evidence = REQUIRES_VERIFIED_PROD_04_05_06

PROD-07.preconditions += PROXY_BACKEND_READINESS
PROD-07.evidenceRequired += BACKEND_BUILD_START_HEALTH_PROOF
```

This prevents reverse-proxy/TLS exposure until the exact build → start → loopback-health sequence has verified a healthy backend. Regression proves the gate/evidence cannot be removed or self-promoted.

Exact implementation-bearing evidence:

```text
head             3440cf3efdc6c5fa5a0ea1667ea21f43a99a7260
run              36022131601
result           success
full suite       557 tests / 556 pass / 0 fail / 1 expected VCP skip
manifest suite   27 / 27 PASS
manifest digest  sha256:c10a179016e15aac94614fa6588e772b67b6f0dc533e1454603c6c98ef3cabbb
```

No proxy route, TLS binding, container, provider, migration, cutover, or deployment action was executed.


## Target-preflight cycle + runtime predecessor correction

Exact-current review on `fc13553c...` identified two issues, and adjacent inspection found the same predecessor gap one step later at health smoke.

The preflight cycle is now broken explicitly:

```text
TARGET_HOST_BINDING = BLOCKED
evidence = EXACT_CANDIDATE_PRODUCTION_HOST_UNRESOLVED

PROD-01.preconditions = [TARGET_HOST_BINDING]
PROD-01.preconditions does NOT include PRODUCTION_TARGET_FACTS
```

This separates **authority to inspect one exact candidate host** from **facts learned by that inspection**. PROD-01 verifies the bound host identity and discovers disk, port, container, proxy-route, and TLS facts; those outputs are what later close `PRODUCTION_TARGET_FACTS`.

Container startup now has a frozen predecessor gate:

```text
CONTAINER_START_READINESS = BLOCKED
evidence = REQUIRES_VERIFIED_PROD_02_03_04

PROD-05.preconditions += CONTAINER_START_READINESS
PROD-05.evidenceRequired += STORAGE_TOKEN_IMAGE_PREDECESSOR_PROOF
```

The adjacent health-smoke step is also fail-closed:

```text
HEALTH_SMOKE_READINESS = BLOCKED
evidence = REQUIRES_VERIFIED_PROD_05

PROD-06.preconditions += HEALTH_SMOKE_READINESS
PROD-06.evidenceRequired += CONTAINER_START_COMPLETION_PROOF
```

Together with the existing proxy gate, the frozen dependency path is:

```text
exact candidate host binding
→ PROD-01 read-only preflight
→ production target facts
→ PROD-02 storage / PROD-03 tokens / PROD-04 image
→ PROD-05 isolated container start
→ PROD-06 loopback health
→ PROD-07 reverse proxy/TLS
```

Hostile regressions reject restoring the target-facts cycle, removing the candidate-host binding, dropping startup/health predecessor gates or evidence, and self-promoting those gates.

Exact implementation-bearing evidence:

```text
head             5ea293522846b9be2b6e82803c0df3b56826d591
run              36024210771
result           success
full suite       559 tests / 558 pass / 0 fail / 1 expected VCP skip
manifest suite   29 / 29 PASS
manifest digest  sha256:7de680a5e8b748faddc9cea087914acc5b26a22229c7e508c9f7c0bd492f01c3
```

No host inspection, storage creation, token generation, image build, container start, health request, proxy change, or production mutation was executed.


## Cutover integration completion + image rollback correction

Exact-current review on `4d56c34b...` identified two remaining gaps:

1. the cutover forward-chain contract omitted successful completion of VCP and Kiosk enablement actions;
2. `PROD-04-BUILD-IMAGE` was classified `REVERSIBLE` but had no exact rollback authority.

The cutover predecessor contract now freezes:

```text
CUTOVER_FORWARD_CHAIN = BLOCKED
evidence = REQUIRES_VERIFIED_PROD_02_03_04_05_06_07_09_10_11_AND_PROD_08_IF_USED

PROD-13.evidenceRequired += VCP_KIOSK_ENABLEMENT_COMPLETION_PROOF
```

This distinguishes WO-06C readiness evidence from actual completion of:

```text
PROD-10-ENABLE-VCP-REMOTE-SYNC
PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE
```

The image build now has a dedicated rollback:

```text
PROD-04.rollbackActionIds = [ROLLBACK-08-REMOVE-BUILT-IMAGE]

ROLLBACK-08.status = ROLLBACK_ONLY
ROLLBACK-08.authorityTarget =
  Only the exact image digest created by PROD-04 on the resolved production host
```

Rollback 08 requires `IMAGE_DIGEST_MATCH`, `IMAGE_NOT_IN_USE`, and `IMAGE_REMOVED`, so it cannot widen into image-store cleanup. It is inserted after stopping the new container in the global rollback order and is also bound into PROD-13's full rollback set.

Exact implementation-bearing evidence:

```text
head             0ecdcfb56413c6303d292a65d2b2601fa5d701fa
run              36025922987
result           success
full suite       560 tests / 559 pass / 0 fail / 1 expected VCP skip
manifest suite   30 / 30 PASS
manifest digest  sha256:29e56b86e43fa01117058b432d8f2df4ff3ddf994aa566c9d71059ee824345fe
```

No VCP/Kiosk enablement, image removal, container stop, cutover, or other production action was executed.


## Import-storage + integration deployment-chain correction

Exact-current review on `ca6aa2b...` identified two remaining dependency shortcuts:

1. `PROD-09-PRODUCTION-DATA-IMPORT` could run before PROD-02 created the isolated storage target.
2. `PROD-10` / `PROD-11` could enable external-write integrations before the applicable PROD-02–09 deployment chain had completed.

The import path is now frozen behind:

```text
PRODUCTION_IMPORT_STORAGE_READINESS = BLOCKED
evidence = REQUIRES_VERIFIED_PROD_02

PROD-09.preconditions += PRODUCTION_IMPORT_STORAGE_READINESS
PROD-09.evidenceRequired += STORAGE_PREPARATION_COMPLETION_PROOF
```

The VCP/Kiosk enablement path is now frozen behind:

```text
INTEGRATION_DEPLOYMENT_READINESS = BLOCKED
evidence = REQUIRES_VERIFIED_PROD_02_03_04_05_06_07_09_AND_PROD_08_IF_USED

PROD-10.preconditions += INTEGRATION_DEPLOYMENT_READINESS
PROD-11.preconditions += INTEGRATION_DEPLOYMENT_READINESS

PROD-10.evidenceRequired += DEPLOYMENT_CHAIN_COMPLETION_PROOF
PROD-11.evidenceRequired += DEPLOYMENT_CHAIN_COMPLETION_PROOF
```

This prevents guarded VCP pushes or Kiosk event submissions against an absent, empty, or not-yet-verified production service. Hostile regressions reject dropping either predecessor gate/proof and reject self-promotion of the gates.

Exact implementation-bearing evidence:

```text
head             450fba3eb6a7d6fbdbdf5b76f6245c59e62ed004
run              36027812496
result           success
full suite       562 tests / 561 pass / 0 fail / 1 expected VCP skip
manifest suite   32 / 32 PASS
manifest digest  sha256:8ba31e0ab3a4d7afd0d0e505f4331714d366bd6bc21fddb982705d4e603a343b
```

No storage creation, production import, VCP/Kiosk enablement, external write, or other production mutation was executed.


## Source-scoped integration rollback + raw secret scan + retained storage semantics

Exact-current review on `11afe530...` identified three contract gaps:

1. VCP, Kiosk, and DingTalk shared one rollback ID, so rollback authority from one integration could disable another.
2. secret scanning happened after stable JSON serialization, allowing raw newline/tab whitespace inside Bearer material to evade the regex.
3. PROD-02 claimed `REVERSIBLE` even though rollback intentionally preserves the created directory and volume.

Integration rollback authority is now source-scoped:

```text
PROD-10 → ROLLBACK-09-DISABLE-VCP-CONFIG
PROD-11 → ROLLBACK-10-DISABLE-KIOSK-CONFIG
PROD-12 → ROLLBACK-11-DISABLE-DINGTALK-CONFIG
```

Each rollback target is bound only to configuration introduced by its originating forward action. Derived rollback regression proves approval of one integration cannot derive either of the other two rollback IDs. PROD-13 carries only the VCP and Kiosk rollback capabilities required by its cutover chain; DingTalk rollback is not added to cutover authority.

Secret material is now scanned recursively over the original manifest string values **before** stable JSON escaping. Regressions cover Bearer credentials separated by ordinary space, raw newline, tab, and CRLF.

PROD-02 is no longer described as fully reversible:

```text
PROD-02.sideEffect = IRREVERSIBLE_OR_EXTERNAL
PROD-02.rollbackActionIds = [ROLLBACK-04-PRESERVE-DATA-VOLUME]
PROD-02.evidenceRequired += RETAINED_STORAGE_ARTIFACT_ACKNOWLEDGED
```

Its effect now explicitly states that the newly created directory and volume are intentionally retained on rollback. This preserves the existing no-destructive-data-deletion rule rather than introducing an unsafe automatic volume deletion path.

Exact implementation-bearing evidence:

```text
head             e864db2360c66dff91054df2e601614e37e0d885
run              36030322588
result           success
full suite       564 tests / 563 pass / 0 fail / 1 expected VCP skip
manifest suite   34 / 34 PASS
manifest digest  sha256:312c7a6d738da3d01f4f332b9e556e92b00835b3960f574df80e7154df6144a9
```

No integration configuration, storage, secret, rollback, or other production mutation was executed.


## Action-specific image digest revalidation

Exact-current review on `3307e794...` identified that the global `mustRevalidateBeforeRequest` list still required `IMAGE_DIGEST` before PROD-04 had created any image, recreating a prerequisite cycle for PROD-01 and PROD-04.

The current machine contract removes all built-image digest requirements from the global checklist and freezes a separate action-specific map:

```text
global mustRevalidateBeforeRequest:
  AUTHORITY_HEAD
  TARGET_HOST_IDENTITY
  DISK_PORT_ROUTE_CONFLICTS
  BACKUP_ROLLBACK_PROOF
  SECRET_STORAGE
  EXTERNAL_READINESS_GATES
  ROLLBACK_TARGETS

PROD-04-BUILD-IMAGE:
  BUILD_SOURCE_AUTHORITY_COMMIT
  BUILD_BASE_IMAGE_DIGEST

downstream actions that depend on the built runtime:
  PROD-05 / PROD-06 / PROD-07 / PROD-10 / PROD-11 / PROD-13
  → BUILT_IMAGE_DIGEST
```

PROD-01 is deliberately absent from `actionSpecificRevalidation`, so target preflight cannot be blocked by an image that does not yet exist. PROD-04 likewise cannot require its own output digest; it binds source authority and the base-image digest before execution instead.

Hostile regressions reject:

- reintroducing `IMAGE_DIGEST` into the global checklist;
- making PROD-04 require `BUILT_IMAGE_DIGEST`;
- dropping `BUILD_BASE_IMAGE_DIGEST` from the build request checks;
- adding a built-image digest prerequisite to PROD-01.

Exact implementation-bearing evidence:

```text
head             7cb0597171846f56f060d8289b147602dd6b8f1f
run              36032380591
result           success
full suite       564 tests / 563 pass / 0 fail / 1 expected VCP skip
manifest suite   34 / 34 PASS
manifest digest  sha256:cd6f28259bff04abb06a7bc6c91f176ae3814e47bd9dcfd12fce3ce0341acdfc
```

No image build, host preflight, deployment request, or production mutation was executed.


## Host-conflict revalidation after target preflight

Exact-current review on `df4b9be...` identified the remaining preflight cycle: `DISK_PORT_ROUTE_CONFLICTS` was still global even though PROD-01 is the action that discovers those facts.

The global checklist now excludes `DISK_PORT_ROUTE_CONFLICTS`.

The conflict check is action-specific only for later host-dependent actions:

```text
PROD-02 / PROD-03 / PROD-04 / PROD-05 / PROD-06 / PROD-07
PROD-08 / PROD-09 / PROD-10 / PROD-11 / PROD-13
→ DISK_PORT_ROUTE_CONFLICTS
```

PROD-01 is deliberately absent from `actionSpecificRevalidation`, so after an exact candidate host is bound, the read-only preflight can run and produce the disk/port/container/proxy/TLS facts. PROD-12 is also absent because its DingTalk provider target is separately bound and does not depend on production-host conflict facts.

Hostile regression rejects:

- moving `DISK_PORT_ROUTE_CONFLICTS` back into the global checklist;
- adding it to PROD-01;
- replacing it with an unrelated revalidation item on a post-preflight host action.

Exact implementation-bearing evidence:

```text
head             efe576d66d9b2802cd5a81d2ca5ef0008dbafb18
run              36033799141
result           success
full suite       564 tests / 563 pass / 0 fail / 1 expected VCP skip
manifest suite   34 / 34 PASS
manifest digest  sha256:c1b08096be43f98d0f791ee15419c3b22f9b57a6df880e87f18477fa353f2492
```

Run `36033670866` on the immediately prior implementation head failed only because the new hostile regression used an empty array and was rejected by schema before reaching the intended semantic error code. The regression was corrected to use a schema-valid but semantically wrong replacement; no production contract weakening was needed.

No host inspection, deployment request, or production mutation was executed.


## Initial-preflight exemption from later-stage checks

Exact-current review on `0656e01c...` found that three later-stage checks still remained global:

```text
BACKUP_ROLLBACK_PROOF
EXTERNAL_READINESS_GATES
ROLLBACK_TARGETS
```

The same audit also showed that `TARGET_HOST_IDENTITY` and `SECRET_STORAGE` are not universal pre-request facts either. The global checklist is therefore now the minimum true universal:

```text
mustRevalidateBeforeRequest = [AUTHORITY_HEAD]
```

`PROD-01-TARGET-READONLY-PREFLIGHT` has no `actionSpecificRevalidation` entry. After `TARGET_HOST_BINDING` is closed, the read-only inspection can be requested without backup proof, external-readiness closure, secret-storage proof, rollback-target materialization, built-image identity, or host-conflict results that do not exist yet.

Later-stage checks are frozen on the actions that require them. Examples:

```text
PROD-03:
  TARGET_HOST_IDENTITY
  DISK_PORT_ROUTE_CONFLICTS
  SECRET_STORAGE
  ROLLBACK_TARGETS

PROD-09:
  TARGET_HOST_IDENTITY
  DISK_PORT_ROUTE_CONFLICTS
  BACKUP_ROLLBACK_PROOF
  ROLLBACK_TARGETS

PROD-10 / PROD-11:
  TARGET_HOST_IDENTITY
  DISK_PORT_ROUTE_CONFLICTS
  BUILT_IMAGE_DIGEST
  SECRET_STORAGE
  EXTERNAL_READINESS_GATES
  ROLLBACK_TARGETS

PROD-12:
  SECRET_STORAGE
  EXTERNAL_READINESS_GATES
  ROLLBACK_TARGETS

PROD-13:
  TARGET_HOST_IDENTITY
  DISK_PORT_ROUTE_CONFLICTS
  BUILT_IMAGE_DIGEST
  BACKUP_ROLLBACK_PROOF
  EXTERNAL_READINESS_GATES
  ROLLBACK_TARGETS
```

Hostile regressions reject reintroducing later-stage checks globally, attaching external readiness to PROD-01, dropping backup proof from PROD-09, or dropping external readiness from PROD-10.

Run `36036021841` on the immediately prior implementation head failed because a generated validator block contained one duplicate closing token. The syntax-only defect was corrected without changing the frozen revalidation allocation.

Exact implementation-bearing evidence:

```text
head             a1eb4199cf7a7cbaf68e24b0a20ef72f2876e6ff
run              36036138172
result           success
full suite       564 tests / 563 pass / 0 fail / 1 expected VCP skip
manifest suite   34 / 34 PASS
manifest digest  sha256:ae134f0803e558ad15f8f19428158b450d8c745534cb2ebaeb8465d70144cf7e
```

No target preflight, credential operation, external integration, rollback, deployment request, or production mutation was executed.
