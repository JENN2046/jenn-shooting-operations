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

The deployment authorization request remains blocked by:

- VCP real compatibility: `WO06C_VCP_EXTERNAL`;
- Kiosk real-device evidence: `WO06C_KIOSK_DEVICE`;
- unresolved production host/route/storage facts: `PRODUCTION_TARGET_FACTS`;
- unvalidated real production migration inputs: `PRODUCTION_DATA_MIGRATION`;
- the explicit production deployment gate itself: `PRODUCTION_DEPLOYMENT_GATE`.

WO-06C still classifies the local DingTalk provider boundary as `READY_FOR_EXTERNAL_INTEGRATION_AUTHORIZATION`, but WO-06D now separately freezes `DINGTALK_TARGET_BINDING = BLOCKED` because no concrete app/provider identity plus bounded test destination has been supplied. Provider readiness therefore does not make `PROD-12` requestable.

## Requestable actions

No action definition is currently requestable. The frozen requestable set is empty.

`PROD-01-TARGET-READONLY-PREFLIGHT` is now `BLOCKED_PREREQUISITE` with `authorityTarget = UNRESOLVED_PRODUCTION_HOST_IDENTITY` and prerequisite `PRODUCTION_TARGET_FACTS`. It cannot become requestable until a concrete production host identity is structurally recorded.

`PROD-12-DINGTALK-PROVIDER-INTEGRATION` remains `BLOCKED_PREREQUISITE` with `authorityTarget = UNRESOLVED_DINGTALK_TARGET_BINDING` and prerequisite `DINGTALK_TARGET_BINDING`. It cannot become requestable until a concrete DingTalk app/provider identity and one bounded test destination are structurally bound in a separately reviewed authority revision.

All mutation/deployment/cutover actions remain blocked or conditional.

## Rollback rule

Rollback order is frozen as:

```text
remove new route
→ revert only the newly changed firewall/security-group rule
→ stop new container
→ revoke/remove role-token runtime bindings created by PROD-03
→ disable newly enabled external config
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

- Head: `11c172f50d6cf843eed391de400f473f43db1f04`
- GitHub Actions run: `36020032853`
- Conclusion: `success`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`

Repository gate:

```text
npm ci                         PASS
npm run check                  PASS
tests                          556
pass                           555
fail                           0
skipped                        1
```

The single skip remains the external VCP adapter and does not close WO-06C external validation.

Manifest targeted tests:

```text
tests  26
pass   26
fail   0
```

Machine verdict:

```json
{
  "status": "WO_06D_MANIFEST_VALID",
  "manifestDigest": "sha256:91d0fd5fb681e402fd0fda67f211d6abc6002eab4eff3976e8c5c441d483de3e",
  "authorizationPacket": "FROZEN_NOT_REQUESTED",
  "deploymentAuthorizationRequest": "BLOCKED_PREREQUISITES",
  "deploymentGate": "BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE",
  "requestableActionIds": [],
  "blockingGateIds": [
    "WO06C_VCP_EXTERNAL",
    "WO06C_KIOSK_DEVICE",
    "PRODUCTION_TARGET_FACTS",
    "PRODUCTION_DATA_MIGRATION",
    "PRODUCTION_DEPLOYMENT_GATE"
  ]
}
```

The validator also fresh-rejects:

- ordinary Bearer/access-token/token-shaped secret material embedded in schema-valid free text;
- secret fields, pre-populated approved action IDs and blanket approval;
- missing authorization blockers;
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

Codex review on the prior head reported four P1 and one P2 authorization-surface gaps. They are addressed together by freezing the authority contract for all 18 action IDs.

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
| P1 action risk/sideEffect/evidence could be understated | all 18 action IDs now freeze title, category, risk, sideEffect, status, authorityTarget, preconditions, effects, rollback bindings and evidenceRequired |
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
