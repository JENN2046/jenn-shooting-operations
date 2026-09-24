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

DingTalk is separately requestable for an integration-authorization step because WO-06C classified it as `READY_FOR_EXTERNAL_INTEGRATION_AUTHORIZATION`; this does not authorize credentials or traffic.

## Requestable actions

Only these action definitions are currently marked requestable, and neither has been requested or approved:

- `PROD-01-TARGET-READONLY-PREFLIGHT`
- `PROD-12-DINGTALK-PROVIDER-INTEGRATION`

All mutation/deployment/cutover actions remain blocked or conditional.

## Rollback rule

Rollback order is frozen as:

```text
remove new route
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

- Head: `f746a408c5d689a1667f6a887740572010719b66`
- GitHub Actions run: `35985335257`
- Conclusion: `success`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`

Repository gate:

```text
npm ci                         PASS
npm run check                  PASS
tests                          542
pass                           541
fail                           0
skipped                        1
```

The single skip remains the external VCP adapter and does not close WO-06C external validation.

Manifest targeted tests:

```text
tests  12
pass   12
fail   0
```

Machine verdict:

```json
{
  "status": "WO_06D_MANIFEST_VALID",
  "manifestDigest": "sha256:b03782756107194f5edf7fa624abf0223f5628e7316134d91b312b79962e05f1",
  "authorizationPacket": "FROZEN_NOT_REQUESTED",
  "deploymentAuthorizationRequest": "BLOCKED_PREREQUISITES",
  "deploymentGate": "BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE",
  "requestableActionIds": [
    "PROD-01-TARGET-READONLY-PREFLIGHT",
    "PROD-12-DINGTALK-PROVIDER-INTEGRATION"
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
- any action whose requestable/non-requestable status drifts from the frozen two-action set;
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
head   f746a408c5d689a1667f6a887740572010719b66
run    35985335257
result success

full suite      542 tests / 541 pass / 0 fail / 1 expected VCP skip
manifest suite  12 / 12 PASS
manifest digest sha256:b03782756107194f5edf7fa624abf0223f5628e7316134d91b312b79962e05f1
```

The manifest body itself is unchanged, so its canonical digest remains stable while the validator around it becomes stricter.

This evidence update is docs-only. The resulting final PR head must also pass the unchanged WO-06D workflow before merge.
