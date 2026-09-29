# PROD-GF-15 Kiosk Acceptance Schedule Preparation R1

Status: ACTION FROZEN / NOT REQUESTABLE / NO PRODUCTION WRITE AUTHORIZED

PROD-GF-15-PREPARE-DEVICE-ACCEPTANCE-SCHEDULE is a separate explicit production action used only to prepare the minimum schedulable context required by the frozen WO-03 / PROD-11 real-device checklist.

It is not PROD-11, grants no standing scheduling authority, and does not enable Kiosk authentication.

## Why this action exists

Fresh production inspection showed:

- scheduling_resources = 0
- STUDIO-PROD-01 = absent
- scheduling_active_config = 0
- schedule_items = 0
- requests_v2 = 0
- non-empty requests_v2.brief_url = 0

The real-device checklist requires concurrent start / 409 conflict, 202 reviewRequired, and offline start -> block -> resume -> complete replay. Those checks cannot be truthfully executed against an empty scheduling domain.

Preparing the acceptance schedule is therefore a separate production write with separate authority.

## Exact Action

Action ID: PROD-GF-15-PREPARE-DEVICE-ACCEPTANCE-SCHEDULE
Risk: HIGH
Side effect: IRREVERSIBLE_OR_EXTERNAL

The canonical Scheduling path persists request/resource/config/proposal/decision/schedule/outbox facts. Several are immutable or append-only and cannot be erased as rollback.

## Frozen target identifiers

- resourceId: STUDIO-PROD-01
- requestId: REQ-GF15-ACCEPT-PROD-01
- requestOperationId: PRODGF15-REQUEST-R1
- resourceOperationId: PRODGF15-RESOURCE-R1
- configVersion: GF15-ACCEPT-CONFIG-R1
- configPublishOperationId: PRODGF15-CONFIG-PUBLISH-R1
- configActivateOperationId: PRODGF15-CONFIG-ACTIVATE-R1
- requestRequirementsOperationId: PRODGF15-REQS-R1
- proposalOperationId: PRODGF15-PROPOSAL-R1
- decisionId: PRODGF15-DECISION-R1
- scheduleItemId: derived canonically from the accepted proposal item plus decisionId

The exact acceptance date, planning window, and calendar window are not standing values. They must be future Asia/Shanghai times bound into the one-time authorization packet immediately before GF-15 can become requestable.

## Frozen acceptance request semantics

The bounded request materialization capability must create exactly one canonical requests_v2 acceptance request with:

- sku: GF15-ACCEPT-PROD-01
- name: PROD-11 Kiosk 真机验收
- client: internal-acceptance
- kind: 细节
- lifecycle: open / domain_command
- source: submission
- productionType: 平面
- shootingSubtype: 细节

- aspectRatio: 1:1
- deliverableCount: 1
- sampleStatus: arrivedVerified
- lightingPreset: GF15-ACCEPT-NEUTRAL
- reflectivity: low
- priority: p0
- briefUrl: null
- desiredDate: exact authorization-bound local date
- requiredCapabilityIds: FLAT
- durationEstimate: 900000 ms, explicit, sourceVersion prod-gf15-r1

No raw SQL insertion is permitted.

## Frozen resource and config semantics

Resource STUDIO-PROD-01 is acceptance-only, active during the prepared test window, labeled Studio PROD 01 Kiosk Acceptance, with canonical capability JSON containing only FLAT.

The config is GF15-ACCEPT-CONFIG-R1. Every static field is frozen now. Only the future local date plus one local start/end window may be bound later by the exact authorization packet.

Static config contract:

- schemaVersion: 1
- businessTimeZone: Asia/Shanghai
- algorithmVersion: deterministic-scheduler-v1
- calendarCompilerVersion: calendar-compiler-v1
- estimatePolicyVersion: estimate-policy-v1
- resourceId: STUDIO-PROD-01
- resource capability digest: sha256:d32c7c24657ca59e09348cb394471525bdefee9777b51d498eb3b2ba16782068
- weeklyWindows: empty
- date override status: custom
- durationFallbackRules: one 平面 / 细节 rule, 900000 ms
- bufferRules: one 平面 / 细节 rule, 5 minutes
- softScoringWeights: LIGHTING_SWITCH 0, REFLECTIVITY_SEQUENCE 0, IDLE_GAP 0, EXPECTED_OVERRUN 0, DESIRED_DATE_MISS 0
- compatibleAlgorithmVersions: deterministic-scheduler-v1

The authorization-bound target packet must supply the one future Asia/Shanghai date and exactly one local start/end window, then carry the complete normalized config JSON and its canonical config digest. The digest must equal digestSchedulingConfigV1 for that exact final config. No other config field may vary at authorization or execution time.

The deterministic proposal must use resourceScope STUDIO-PROD-01 and exactly the authorization-bound planning window. Before accepting anything, the assembled candidate set must contain exactly one candidate, its requestId must be REQ-GF15-ACCEPT-PROD-01, the proposal must contain exactly one proposed item for that request, and the decision must select exactly that item. Any unrelated open candidate blocks GF-15.

## Canonical path only

The only admitted path is:

bounded canonical requests_v2 materialization
-> RegisterSchedulingResourceV1
-> PublishSchedulingConfigV1
-> ActivateSchedulingConfigV1
-> SetRequestRequirements
-> deterministic proposal generation
-> canonical proposal accept decision
-> derived schedule item and schedule_item_tasks

Direct table insertion into request, resource, config, schedule, proposal, decision, revision, operation, or outbox tables is forbidden.

## Capability blockers

GF-15 remains not requestable until both capabilities exist and pass exact-head review.

1. KIOSK_ACCEPTANCE_REQUEST_MATERIALIZATION_CAPABILITY

Current POST /api/v1/requests updates the V1 snapshot but does not create a canonical requests_v2 row. A bounded, idempotent, exact-target request materialization capability is therefore required.

2. KIOSK_ACCEPTANCE_OUTBOX_ISOLATION_CAPABILITY

Canonical proposal acceptance creates a schedule.confirmed.v1 Notification Outbox intent. The acceptance-only intent must be permanently isolated from future real-provider delivery without deleting or rewriting unrelated outbox facts.

## Database-wide brief-host gate

Before the first GF-15 write, the entire requests_v2 table must be rescanned. Any non-empty brief_url blocks GF-15 until every observed host is explicitly reviewed against the frozen Kiosk allowlist. A scheduled-only scan is insufficient.

## Containment rollback

Bound rollback: ROLLBACK-GF-13-CONTAIN-DEVICE-ACCEPTANCE-SCHEDULE.

Rollback is containment, not deletion:

- keep PROD-11 blocked and Kiosk authentication disabled;
- if GF-15 activated STUDIO-PROD-01, replace only that resource to inactive with the same capability digest;
- if a prior active config existed, reactivate exactly that config;
- if no prior config existed, retain the acceptance config but keep the acceptance resource inactive because the current domain has no delete-or-clear-active-config command;
- contain the acceptance outbox intent using the preverified isolation capability;
- preserve request/resource/config/proposal/decision/schedule/outbox/audit history;
- prove unrelated scheduling facts, storage identity, and VCP are unchanged.

## Requestability

Current machine authority remains:

- authorization.status = FROZEN_NOT_REQUESTED
- requestedActionIds = empty
- approvedActionIds = empty
- requestableActionIds = empty
- nextActionId = PROD-GF-15-PREPARE-DEVICE-ACCEPTANCE-SCHEDULE

GF-15 itself is blocked until:

- KIOSK_ACCEPTANCE_REQUEST_MATERIALIZATION_CAPABILITY
- KIOSK_ACCEPTANCE_OUTBOX_ISOLATION_CAPABILITY
- GF15_ACCEPTANCE_CANDIDATE_ISOLATION
- KIOSK_ACCEPTANCE_TARGET_PACKET containing the exact future local date/window plus the complete normalized config JSON and canonical config digest
- DATABASE_WIDE_BRIEF_HOST_COMPATIBILITY
- fresh exact production target attestation

Only after GF-15 completes with exact evidence may authority advance toward PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE.
