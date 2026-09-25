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
requestableActionIds = []
derivedRollbackActionIds = []
authorizationPacket = FROZEN_NOT_REQUESTED
deploymentAuthorizationRequest = BLOCKED_PREREQUISITES
deploymentGate = BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

Nothing in WO-06D is an authorization to execute an action.

## Current blockers

The deployment authorization request remains blocked by the dedicated deployment-level set:

- deployable VCP adapter wiring: `VCP_DEPLOYABLE_ADAPTER_WIRING`;
- deployable Kiosk authentication wiring: `KIOSK_DEPLOYABLE_AUTH_WIRING`;
- unresolved production host/route/storage facts: `PRODUCTION_TARGET_FACTS`;
- unvalidated real production migration inputs: `PRODUCTION_DATA_MIGRATION`;
- the explicit production deployment gate itself: `PRODUCTION_DEPLOYMENT_GATE`.

This exact five-gate subset is frozen separately as `deploymentBlockingGateIds`.

`WO06C_VCP_EXTERNAL` is a **post-enable compatibility gate**, not a deployment-level blocker or a PROD-10 prerequisite. It remains `BLOCKED_EXTERNAL_RUNTIME`: after deployable wiring and all other PROD-10 prerequisites are satisfied and exact authorization is granted, PROD-10 produces the real pull → guarded push → verification pull result. That result can close `WO06C_VCP_EXTERNAL`, which remains in the exhaustive blocker set and remains a PROD-13 cutover prerequisite. No such real operation has been executed.

The Kiosk sequence follows the same separation: `KIOSK_DEPLOYABLE_AUTH_WIRING` precedes PROD-11 enablement; post-enable real-device acceptance closes `WO06C_KIOSK_DEVICE` before PROD-13. Neither external acceptance gate is removed or promoted by this summary correction.

`blockingGateIds` has a different, exhaustive meaning: it must equal **every gate whose current status is `BLOCKED`**. The complete current 25-gate set is reproduced in the machine verdict below, including both post-enable compatibility gates, the five deployment-level blockers, and the remaining action-specific blockers. The validator derives the expected exhaustive set from gate statuses, so a newly blocked gate cannot be omitted from the CLI checklist. In particular, `POST_CUTOVER_ORPHAN_CLEANUP_RESTORATION` is a PROD-14 prerequisite, not a sixth deployment-level blocker.

WO-06C still classifies the local DingTalk provider boundary as `READY_FOR_EXTERNAL_INTEGRATION_AUTHORIZATION`, but WO-06D separately freezes both `DINGTALK_TARGET_BINDING = BLOCKED` and `DINGTALK_DEPLOYABLE_ADAPTER_WIRING = BLOCKED`. No concrete app/provider identity plus bounded test destination has been supplied, and real adapter/credential/runtime wiring is not implemented. Provider readiness therefore does not make `PROD-12` requestable.

## Requestable actions

No action definition is currently requestable. The frozen requestable set is empty.

`PROD-01-TARGET-READONLY-PREFLIGHT` is `BLOCKED_PREREQUISITE` behind `TARGET_HOST_BINDING`, not `PRODUCTION_TARGET_FACTS`. This breaks the prerequisite cycle: one exact candidate host must be structurally bound first, then PROD-01 may verify that binding and discover the disk/port/container/proxy/TLS facts that later close `PRODUCTION_TARGET_FACTS`.

`PROD-12-DINGTALK-PROVIDER-INTEGRATION` remains `BLOCKED_PREREQUISITE` with `authorityTarget = UNRESOLVED_DINGTALK_TARGET_BINDING`. It requires both exact target binding and deployable adapter wiring, plus `DINGTALK_RUNTIME_ADAPTER_CONFIGURATION` pre-request revalidation and `DINGTALK_RUNTIME_WIRING_PROOF` completion evidence. These capabilities and targets require a separately reviewed authority revision; this packet grants none of them.

All mutation/deployment/cutover actions remain blocked or conditional.

## Rollback rule

Rollback order is frozen as:

```text
remove new route
→ revert only the newly changed firewall/security-group rule
→ stop and remove the exact new container object while preserving its named volume
→ remove the exact PROD-04 image digest after proving all container references are absent
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

- Head: `cda455204aa91224f85ba87d12968726eb3a4006`
- GitHub Actions run: `36125110628` (run #95)
- Conclusion: `success`
- Runtime: Node `24.21.0`, npm `11.19.0`, tzdata `2026c`, ICU `78.3`

Repository gate:

```text
npm ci                         PASS
npm run check                  PASS
tests                          579
pass                           578
fail                           0
skipped                        1
```

The single skip remains the external VCP adapter and does not close WO-06C external validation.

Manifest targeted tests (`node --test tests/production-change-manifest*.test.mjs`, including the Unicode regression file):

```text
tests  49
pass   49
fail   0
```

Machine verdict:

```json
{
  "status": "WO_06D_MANIFEST_VALID",
  "manifestDigest": "sha256:32fa0a5d754c157345561e9a5e1f6fcd274f8f0f94b96f3f605df4aef609cd47",
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

The validator also fresh-rejects:

- ordinary Bearer/access-token/token-shaped secret material embedded in schema-valid free text, including Bearer credentials split by raw newline, tab, or CRLF whitespace and complete Bearer values containing punctuation or spaces;
- assignments to the four declared deployment role-token names: `VIEWER_TOKEN`, `SUBMITTER_TOKEN`, `SCHEDULER_TOKEN`, and `ADMIN_TOKEN`, with case-insensitive names, optional single/double quotes around the key, either `=` or `:` delimiters, and a parser that follows the complete assignment RHS including shell-concatenated quoted/unquoted segments;
- astral Unicode credentials at the authorizer's 16-UTF-16-code-unit threshold, including ordinary, quoted, escaped and concatenated role-token segments and Bearer values;
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

This evidence update is docs-only. The resulting final PR head must separately pass the WO-06D workflow and independent exact-head review. Its run and final review signal belong in the PR/check record, not an impossible self-referential SHA/run claim in this same document commit.

## Current UTF-16 scanner and human-summary correction

The two role-token parsers now accumulate `char.length` in all six ordinary, quoted, and escaped branches, matching `createAuthorizer`'s `string.length` unit. Bearer detection also counts UTF-16 units rather than Unicode code points. Synthetic eight-emoji fixtures in unquoted `ADMIN_TOKEN=` and quoted `VIEWER_TOKEN:` evidence now produce `SECRET_MATERIAL_DETECTED`; regressions also check the 15/16-unit boundary against the actual in-memory authorizer. No real credential is used.

Both this document and the WO-06 work order now use `VCP_DEPLOYABLE_ADAPTER_WIRING` in the five-item current deployment blocker summary. `WO06C_VCP_EXTERNAL` remains blocked, post-enable, exhaustive, and required for cutover. The manifest JSON and digest are unchanged.

## PR-branch closure state

Before merge, this branch may claim only:

```text
WO-06D_MANIFEST_PACKET_VALID
MERGE_PENDING
DEPLOYMENT_AUTHORIZATION_REQUEST = BLOCKED_PREREQUISITES
BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

After merge, a docs-only authority closure may publish WO-06D PASS if the final PR head also passes the unchanged workflow and independent review.


## Historical review evidence boundary

The remaining sections, from "Review hardening closure candidate" through "Shell-concatenated role-token scanning", preserve the chronological review record and their original head/run/digest evidence. Their uses of "current", requestable sets, blocker lists, and deployment sequences describe those historical revisions only and are not executable current instructions. Use the current summaries and machine verdict above and the current machine manifest for the present contract; later corrections supersede earlier snapshots without erasing their audit trail.

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


## Production-import source consistency gate

Exact-current review on `46baa9e...` identified that PROD-09 could still be requested while the source service was accepting uploads or running cleanup. The frozen migration authority requires offline apply until cross-process upload/migration coordination exists and has been verified.

WO-06D now freezes:

```text
PRODUCTION_IMPORT_SOURCE_CONSISTENCY = BLOCKED
evidence =
  REQUIRES_OFFLINE_SOURCE_QUIESCENCE_OR_VERIFIED_UPLOAD_MIGRATION_COORDINATION

PROD-09.preconditions += PRODUCTION_IMPORT_SOURCE_CONSISTENCY
PROD-09.actionSpecificRevalidation += SOURCE_QUIESCENCE_OR_COORDINATION_PROOF
PROD-09.evidenceRequired += SOURCE_QUIESCENCE_OR_COORDINATION_PROOF
```

This means an authorized production import cannot begin merely because migration inputs, target facts, storage readiness, and the deployment gate are otherwise satisfied. Before request, the source must either be in an offline/quiescent maintenance state or have a separately verified coordination mechanism that prevents races with uploads and cleanup.

`MAINTENANCE_WINDOW` remains execution evidence; it is no longer the only place where source-state consistency appears.

Hostile regressions reject:

- removing the source-consistency gate from PROD-09;
- removing the source-state revalidation proof;
- removing the source-state evidence requirement;
- self-promoting the blocked gate to satisfied.

Exact implementation-bearing evidence:

```text
head             088c1663119c2268136a3f228999fd25d20f9249
run              36084900067
result           success
full suite       565 tests / 564 pass / 0 fail / 1 expected VCP skip
manifest suite   35 / 35 PASS
manifest digest  sha256:7f9b200d9874ef20ddbf449a17ba4c97b2b7d4ff24d774e45e8a7d0395a50d2a
```

No source service, upload volume, production database, migration apply, or other production mutation was touched.


## Declared role-token assignment detection

Exact-current review on `af904b1e...` identified that the secret scanner recognized `access_token=` assignments but not assignments to the four role-token names declared by the manifest.

The assignment detector now covers:

```text
access_token
VIEWER_TOKEN
SUBMITTER_TOKEN
SCHEDULER_TOKEN
ADMIN_TOKEN
```

Matching is case-insensitive and permits whitespace around the assignment operator. The scanner still runs against original string values before JSON serialization.

Hostile regressions prove that schema-valid free text containing each of the four declared role-token assignments is rejected with `SECRET_MATERIAL_DETECTED`, including whitespace/case variants.

The current blocker prose also now includes `PRODUCTION_IMPORT_SOURCE_CONSISTENCY`, matching the exhaustive machine-generated `blockingGateIds` set.

Exact implementation-bearing evidence:

```text
head             556db8e8bf2c01a1fe507ba483d4ee1e07c3fc1d
run              36085417668
result           success
full suite       565 tests / 564 pass / 0 fail / 1 expected VCP skip
manifest suite   35 / 35 PASS
manifest digest  sha256:7f9b200d9874ef20ddbf449a17ba4c97b2b7d4ff24d774e45e8a7d0395a50d2a
```

No token value, secret, credential, or production mutation was introduced or executed.


## Quoted role-token assignment detection

Exact-current review on `f6fa15a1...` identified that assignment-shaped role credentials wrapped in normal shell quotes could bypass the detector.

The assignment value grammar now rejects all three forms for `access_token` and each declared role token:

```text
TOKEN=value
TOKEN="value"
TOKEN='value'
```

Quoted branches require a matching closing quote, while the unquoted branch preserves the existing delimiter restrictions. Matching remains case-insensitive for the token identifier and still runs against original string values before JSON serialization.

Hostile regressions cover:

```text
ADMIN_TOKEN="..."
VIEWER_TOKEN='...'
submitter_token = "..."
```

Each must produce `SECRET_MATERIAL_DETECTED`.

Exact implementation-bearing evidence:

```text
head             ab5df127d0cb92405205cf2b87bb55ac00468b13
run              36095441794
result           success
full suite       565 tests / 564 pass / 0 fail / 1 expected VCP skip
manifest suite   35 / 35 PASS
manifest digest  sha256:7f9b200d9874ef20ddbf449a17ba4c97b2b7d4ff24d774e45e8a7d0395a50d2a
```

The manifest body is unchanged, so its digest remains stable. No credential value or production mutation was introduced.


## Import target absence + pre-runtime ordering

Exact-current review on `115e9fc...` identified that starting PROD-05 before PROD-09 initializes the target SQLite database. The isolated apply path treats any existing target as a completed migration candidate, so a freshly initialized empty runtime database is not a valid unused migration target.

The current contract now requires exact target absence before import:

```text
PRODUCTION_IMPORT_TARGET_ABSENCE = BLOCKED
evidence = REQUIRES_TARGET_SQLITE_PATH_ABSENT_BEFORE_PROD_05

PROD-09.preconditions += PRODUCTION_IMPORT_TARGET_ABSENCE
PROD-09.actionSpecificRevalidation += IMPORT_TARGET_SQLITE_ABSENCE_PROOF
PROD-09.evidenceRequired += IMPORT_TARGET_SQLITE_ABSENCE_PROOF
```

Runtime startup is also sequenced after import completion:

```text
CONTAINER_START_READINESS = BLOCKED
evidence = REQUIRES_VERIFIED_PROD_02_03_04_09

PROD-05.evidenceRequired += PRODUCTION_IMPORT_COMPLETION_PROOF
```

The resulting deployment path is:

```text
target binding
→ preflight
→ target facts
→ storage / tokens / image
→ production import into absent target
→ container start
→ loopback health
→ proxy / TLS
→ integrations
→ cutover
```

This prevents PROD-05 from creating the SQLite file before PROD-09 has completed, and prevents PROD-09 from targeting any already-existing SQLite file.

Exact implementation-bearing evidence:

```text
head             20a5337ddb621a6ed2dc92f270a898a69a695e91
run              36099561361
result           success
full suite       566 tests / 565 pass / 0 fail / 1 expected VCP skip
manifest suite   36 / 36 PASS
manifest digest  sha256:70bc3ed0fb17de09d65b25a8b65c1191e287faf10532d899f54af80a37659df7
```

No container was started, no SQLite target was created, and no production import or mutation was executed.


## Container-object removal before image rollback

Exact-current review on `4f8b95ad...` identified that stopping the new container did not release its Docker image reference. A stopped container still blocks removal of its image.

`ROLLBACK-02-STOP-NEW-CONTAINER` now freezes stronger semantics:

```text
title:
  Stop and remove newly started application container

authorityTarget:
  Only the newly started container object from this deployment;
  named data volume is excluded from deletion

effects:
  Stop and remove only the new container object so it releases its image reference;
  preserve the named data volume

evidence:
  CONTAINER_STOPPED
  CONTAINER_REMOVED
  IMAGE_REFERENCE_RELEASED
  DATA_VOLUME_PRESERVED
```

`ROLLBACK-08-REMOVE-BUILT-IMAGE` additionally requires:

```text
CONTAINER_REFERENCE_ABSENT
IMAGE_NOT_IN_USE
```

The frozen rollback order remains container cleanup before image removal, but the first step now removes the container object rather than leaving a stopped reference behind.

Exact implementation-bearing evidence:

```text
head             f4d04336a0e18ef2fe3a90840a444d2f3da6e4d2
run              36100548171
result           success
full suite       567 tests / 566 pass / 0 fail / 1 expected VCP skip
manifest suite   37 / 37 PASS
manifest digest  sha256:8851d97dd4379ee9d0e5bcd31623e53419d154c700fa35ef26bf5e193ad92e48
```

No container, image, or named volume was changed or deleted.


## Attachment-byte migration capability blocker

Exact-current review on `9ae3c8dd...` identified that the current isolated SQLite apply path verifies source upload identity/manifest but does **not** copy upload bytes into the isolated target volume. Because `uploads` rows and their hashed files together form the attachment fact, database-only import could leave migrated rows pointing at absent files.

WO-06D now fails closed on:

```text
PRODUCTION_ATTACHMENT_COPY_CAPABILITY = BLOCKED
evidence = TARGET_UPLOAD_BYTE_COPY_AND_VERIFICATION_NOT_IMPLEMENTED

PROD-09.preconditions += PRODUCTION_ATTACHMENT_COPY_CAPABILITY
PROD-09.actionSpecificRevalidation += TARGET_UPLOAD_VOLUME_IDENTITY
PROD-09.actionSpecificRevalidation += ATTACHMENT_COPY_PLAN
```

PROD-09 now also freezes the attachment-copy effect and post-copy proof set:

```text
SOURCE_UPLOAD_MANIFEST_DIGEST
TARGET_UPLOAD_MANIFEST_DIGEST
SOURCE_TARGET_UPLOAD_MANIFEST_MATCH
ATTACHMENT_BYTE_COPY_COMPLETION_PROOF
ATTACHMENT_RECORD_FILE_PARITY_PROOF
```

The current repository does not claim this capability exists. The blocker remains closed until a later reviewed implementation copies all bytes referenced by non-null `stored_name` values into the isolated target upload volume and verifies source/target parity.

## Pre-cutover staging-route write restriction

The same review found that PROD-07 could expose the isolated service before cutover while unauthenticated POST write endpoints remained available.

WO-06D now freezes:

```text
PRE_CUTOVER_ROUTE_WRITE_RESTRICTION = BLOCKED
evidence = REQUIRES_PUBLIC_WRITE_BLOCK_OR_BOUNDED_STAGING_ACCESS

PROD-07.preconditions += PRE_CUTOVER_ROUTE_WRITE_RESTRICTION
PROD-07.actionSpecificRevalidation += PRE_CUTOVER_ROUTE_ACCESS_POLICY
```

PROD-07 may expose only a staging HTTPS route where public unauthenticated writes are blocked. Any pre-cutover write capability must be limited to exact bounded staging principals and proved by:

```text
STAGING_ROUTE_ACCESS_POLICY
PUBLIC_WRITE_ENDPOINTS_BLOCKED
BOUNDED_STAGING_PRINCIPAL_SCOPE
PRE_CUTOVER_WRITE_DENIAL_PROBE
```

Before PROD-13 cutover, the packet revalidates:

```text
PRE_CUTOVER_ROUTE_RESTRICTION_STILL_ACTIVE
PRE_CUTOVER_ROUTE_RESTRICTION_PROOF
```

Only the exact approved cutover may promote the staging route to general production authority.

Exact implementation-bearing evidence for both corrections:

```text
head             169d3b0b5341543160a77932ea312f0171e8adc8
run              36102203534
result           success
full suite       569 tests / 568 pass / 0 fail / 1 expected VCP skip
manifest suite   39 / 39 PASS
manifest digest  sha256:fab1175a83759252da74451ae236b23a4bd90e5be32ce4b1aa897c8e633ba7c2
```

No attachment bytes were copied, no route was exposed, and no production write or cutover was executed.


## Colon-delimited role-token secret detection

Exact-current review on `c2a5ba13...` identified that JSON/YAML-style token assignments could bypass the assignment detector because only `=` was recognized.

The secret scanner now rejects both delimiters and common key quoting forms:

```text
ADMIN_TOKEN=value
ADMIN_TOKEN: value
"ADMIN_TOKEN": "value"
'VIEWER_TOKEN': 'value'
scheduler_token : "value"
```

The identifier remains case-insensitive; the scanner still runs on original string values before JSON serialization. Single/double-quoted values require matching closing quotes, while unquoted values retain delimiter restrictions.

Hostile regressions cover YAML, JSON, quoted-key, and mixed-case colon-delimited role-token material, all requiring `SECRET_MATERIAL_DETECTED`.

## VCP guarded-push side-effect classification

The same review confirmed that `PULL_PUSH_VERIFY_RESULT` includes a guarded VCP push that persists revisioned task facts. The integration test demonstrates revision advancement and a stored task after push.

`PROD-10-ENABLE-VCP-REMOTE-SYNC` is therefore frozen as:

```text
sideEffect = IRREVERSIBLE_OR_EXTERNAL
rollback = ROLLBACK-09-DISABLE-VCP-CONFIG
```

Its effect explicitly states that guarded push may persist new revisioned task facts that configuration rollback does not remove. `ROLLBACK-09` disables only the VCP adapter configuration; it is not represented as a data rollback.

A new invariant freezes this distinction:

```text
VCP_GUARDED_PUSH_WRITES_ARE_NOT_REVERSED_BY_CONFIG_ROLLBACK
```

Exact implementation-bearing evidence for both corrections:

```text
head             3e9bd502c0c607767e5d431c1504b08dd5df7537
run              36103380648
result           success
full suite       570 tests / 569 pass / 0 fail / 1 expected VCP skip
manifest suite   40 / 40 PASS
manifest digest  sha256:b44c408eb8a3216d55a54cb6cd890d05f41f04a0bc16132922e17f7ba5f0a220
```

No role credential was added, no VCP push was executed, and no production data or integration state was mutated.


## Kiosk event-write irreversibility

`PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE` is frozen as `IRREVERSIBLE_OR_EXTERNAL`. Real-device acceptance or offline replay can persist production runs, reviews, receipts, and audit facts; `ROLLBACK-10-DISABLE-KIOSK-CONFIG` disables only the Kiosk configuration and identity mapping and does not remove those committed facts.

Frozen invariant: `KIOSK_EVENT_WRITES_ARE_NOT_REVERSED_BY_CONFIG_ROLLBACK`.

Implementation evidence: head `88239a6ae500908551972a9841b94e832075ef1b`, run `36104515602`, full suite 571/570/0/1, manifest suite 41/41, digest `sha256:1c8d005f1cc0675d63d705e14a4cd737dcb06868cd7cf4964789462978223fa5`.


## Request-triggered orphan-cleanup control

Exact-current review on `8903228719...` identified that disabling only startup and periodic orphan cleanup was insufficient: `saveUpload()` and `submitRequest()` can also call `cleanupOrphanUploads()` and therefore delete imported, unclaimed attachments during bounded staging writes.

The frozen cleanup guard now covers **every cleanup entry point**:

```text
PRE_CUTOVER_ORPHAN_CLEANUP_CONTROL = BLOCKED
evidence =
  ALL_STARTUP_PERIODIC_AND_REQUEST_TRIGGERED_ORPHAN_CLEANUP_DISABLE_NOT_IMPLEMENTED
```

PROD-05 requires:

```text
STARTUP_ORPHAN_CLEANUP_DISABLED
PERIODIC_ORPHAN_CLEANUP_DISABLED
REQUEST_TRIGGERED_ORPHAN_CLEANUP_DISABLED
ALL_ORPHAN_CLEANUP_ENTRY_POINTS_DISABLED_PROOF
```

The guard is then revalidated at staging exposure and again immediately before Switch:

```text
PROD-07:
  ALL_ORPHAN_CLEANUP_ENTRY_POINTS_STILL_DISABLED
  STAGING_REQUEST_PATH_CLEANUP_DISABLED_PROOF

PROD-13:
  ALL_ORPHAN_CLEANUP_ENTRY_POINTS_STILL_DISABLED
  PRE_SWITCH_ORPHAN_CLEANUP_GUARD_PROOF
```

The current repository does not claim this runtime guard is implemented; the gate stays BLOCKED until all startup, periodic, `saveUpload`, and `submitRequest` cleanup entry points are disabled through cutover.

## Complete unquoted role-token scanning

The secret detector now scans the complete non-whitespace value for unquoted role-token assignments rather than stopping at comma/semicolon punctuation. Examples such as:

```text
ADMIN_TOKEN=abc,defghijklmnop
VIEWER_TOKEN=abc;defghijklmnop
SCHEDULER_TOKEN: abc,defghijklmnop
```

are rejected with `SECRET_MATERIAL_DETECTED` when the complete value reaches the deployable token-length threshold.

Exact implementation-bearing evidence for both corrections:

```text
head             2120b563b8fa08a95f1f76df0d0d32f48f1a4d13
run              36118906501
result           success
full suite       574 tests / 573 pass / 0 fail / 1 expected VCP skip
manifest suite   44 / 44 PASS
manifest digest  sha256:d6e6b3177fab3fa712c25b8a9e656adff5b9818444a42d66250784473b771596
```

No cleanup operation, staging write, production mutation, or credential value was executed or introduced.


## DingTalk deployable-adapter blocker

Exact-current review on `c29093ac...` confirmed that target binding alone is insufficient because the approved production entrypoint has no real DingTalk adapter, credentials, or runtime composition.

WO-06D now freezes:

```text
DINGTALK_DEPLOYABLE_ADAPTER_WIRING = BLOCKED
evidence = REAL_DINGTALK_ADAPTER_CREDENTIALS_AND_RUNTIME_WIRING_NOT_IMPLEMENTED
```

`PROD-12-DINGTALK-PROVIDER-INTEGRATION` additionally requires the deployable-adapter gate, `DINGTALK_RUNTIME_ADAPTER_CONFIGURATION` pre-request revalidation, and `DINGTALK_RUNTIME_WIRING_PROOF`. The action remains non-requestable until a reviewed real adapter/runtime implementation exists.

## Complete Bearer credential scanning

Bearer detection now scans the complete value through the end of the logical line instead of assuming an unenforced token alphabet. It therefore rejects usable values containing punctuation or spaces, including:

```text
Bearer abc,defghijklmnop
Bearer abc;defghijklmnop
Bearer correct horse battery staple
```

Existing newline/tab/CRLF Bearer regressions remain preserved.

Exact implementation-bearing evidence:

```text
head             1b9edddb7b81a35ea9adbd7e2fc0f810c08fe524
run              36120028211
result           success
full suite       575 tests / 574 pass / 0 fail / 1 expected VCP skip
manifest suite   45 / 45 PASS
manifest digest  sha256:b4cc09447e640f6493341b0d308267b4f5a8ab3863d72003eb214aea54981f47
```


## VCP deployable wiring before post-enable compatibility

Exact-current review on `3aa5bef3...` identified an authorization cycle: `WO06C_VCP_EXTERNAL` required the real pull → guarded push → verification pull that PROD-10 itself is authorized to perform.

The contract now separates wiring from post-enable compatibility:

```text
VCP_DEPLOYABLE_ADAPTER_WIRING = BLOCKED
evidence = REAL_VCP_ADAPTER_RUNTIME_WIRING_NOT_IMPLEMENTED
```

PROD-10 now requires `VCP_DEPLOYABLE_ADAPTER_WIRING`, not `WO06C_VCP_EXTERNAL`. Its pre-request revalidation is `VCP_RUNTIME_ADAPTER_CONFIGURATION`; `PULL_PUSH_VERIFY_RESULT` remains completion evidence produced by the authorized action.

`WO06C_VCP_EXTERNAL` remains BLOCKED and is still a PROD-13 cutover prerequisite. The deployment-level blocker subset now uses the deployable-wiring gate instead of the post-enable compatibility gate.

## Explicit post-cutover orphan-cleanup restoration

Pre-cutover cleanup suppression is temporary protection, not a permanent production mode. A new exact action now owns restoration:

```text
PROD-14-RESTORE-ORPHAN-CLEANUP
status = BLOCKED_PREREQUISITE
sideEffect = IRREVERSIBLE_OR_EXTERNAL
precondition = POST_CUTOVER_ORPHAN_CLEANUP_RESTORATION
```

The gate remains blocked until PROD-13 is verified complete and post-cutover attachment parity is proven:

```text
POST_CUTOVER_ORPHAN_CLEANUP_RESTORATION = BLOCKED
REQUIRES_VERIFIED_PROD_13_AND_POST_CUTOVER_ATTACHMENT_PARITY
```

PROD-14 separately restores startup, periodic, `saveUpload`, and `submitRequest` cleanup and requires post-restore health evidence. PROD-13 itself now requires a `POST_CUTOVER_CLEANUP_RESTORATION_PLAN`, but does not silently re-enable cleanup under cutover authority.

## Shell-concatenated role-token scanning

Role-token detection now parses the complete assignment RHS instead of choosing one regex branch for quoted or unquoted values. Shell concatenation such as:

```text
ADMIN_TOKEN=abc"correct horse battery staple"
VIEWER_TOKEN=abc'correct horse battery staple'
SUBMITTER_TOKEN="correct horse"abc123456
```

is evaluated as one assignment value for secret-length detection and rejected with `SECRET_MATERIAL_DETECTED`.

Exact implementation-bearing evidence:

```text
head             0ed1ea690f1451c8f39fc4ef1fd5cc9627e903de
run              36121925574
result           success
full suite       577 tests / 576 pass / 0 fail / 1 expected VCP skip
manifest suite   47 / 47 PASS
manifest digest  sha256:32fa0a5d754c157345561e9a5e1f6fcd274f8f0f94b96f3f605df4aef609cd47
```

No VCP external write, cutover, cleanup restoration, or production mutation was executed.