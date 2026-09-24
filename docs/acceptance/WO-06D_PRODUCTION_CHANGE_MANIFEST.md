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

Only this action definition is currently marked requestable, and it has not been requested or approved:

- `PROD-01-TARGET-READONLY-PREFLIGHT`

`PROD-12-DINGTALK-PROVIDER-INTEGRATION` is now `BLOCKED_PREREQUISITE` with `authorityTarget = UNRESOLVED_DINGTALK_TARGET_BINDING` and prerequisite `DINGTALK_TARGET_BINDING`. It cannot become requestable until a concrete DingTalk app/provider identity and one bounded test destination are structurally bound in a separately reviewed authority revision.

All mutation/deployment/cutover actions remain blocked or conditional.

## Rollback rule

Rollback order is frozen as:

```text
remove new route
→ revert only the newly changed firewall/security-group rule
→ stop new container
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

- Head: `89c6c95a0d3b30a4dc36067aac7d3d81aec1ef15`
- GitHub Actions run: `36014400886`
- Conclusion: `success`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`

Repository gate:

```text
npm ci                         PASS
npm run check                  PASS
tests                          551
pass                           550
fail                           0
skipped                        1
```

The single skip remains the external VCP adapter and does not close WO-06C external validation.

Manifest targeted tests:

```text
tests  21
pass   21
fail   0
```

Machine verdict:

```json
{
  "status": "WO_06D_MANIFEST_VALID",
  "manifestDigest": "sha256:2083b959badbf0a11ea1df2c5af32c111c8eac2200738d4db41d025de13b4833",
  "authorizationPacket": "FROZEN_NOT_REQUESTED",
  "deploymentAuthorizationRequest": "BLOCKED_PREREQUISITES",
  "deploymentGate": "BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE",
  "requestableActionIds": [
    "PROD-01-TARGET-READONLY-PREFLIGHT"
  ],
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
- any action whose requestable/non-requestable status drifts from the frozen single-action set;
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
