# PROD-GF-15 Kiosk Production Smoke Schedule Preparation R1

Status: ACTION FROZEN / NOT REQUESTABLE / NO PRODUCTION WRITE AUTHORIZED

PROD-GF-15-PREPARE-DEVICE-ACCEPTANCE-SCHEDULE is a separate explicit production action used only to prepare the bounded production Scheduling fixture required by the later PROD-11 production smoke.

It is **not** the WO-03 dataset or execution environment, cannot satisfy or replace WO-03 REAL_DEVICE_ACCEPTANCE / OFFLINE_REPLAY_RESULT evidence, is not PROD-11 itself, grants no standing scheduling authority, and does not enable Kiosk authentication.

## Why this action exists

Fresh production inspection showed:

- scheduling_resources = 0
- STUDIO-PROD-01 = absent
- scheduling_active_config = 0
- schedule_items = 0
- requests_v2 = 0
- non-empty requests_v2.brief_url = 0

The isolated WO-03 matrix owns concurrent start / 409 conflict, 202 reviewRequired, offline replay, grouped-session, accessibility and device-handoff evidence on isolated test identity/data. GF-15 does not prepare or mutate that environment.

The later bounded PROD-11 production smoke, after isolated WO-03 passes and production Kiosk activation becomes authorized, needs one exact production schedule item so the two-event START -> COMPLETE smoke can bind to a real production scheduling fact. Preparing that production-smoke schedule is therefore a separate production write with separate authority.

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

The bounded request materialization capability must materialize **one exact request command and one complete `requests_v2` row**. The contract leaves no unspecified persisted column for a future implementation to choose.

Canonical command fixed fields:

- schemaVersion: 2
- operationId: PRODGF15-REQUEST-R1
- productionType: 平面
- sku: GF15-ACCEPT-PROD-01
- name: PROD-11 Kiosk Production Smoke
- kind / shootingSubtype: 细节 / 细节
- aspectRatio: 1:1
- deliverables: flat / count 1
- requestedBy: internal-acceptance
- note: empty string
- coreBriefSummary: PROD-11 Kiosk Production Smoke
- sampleStatus: arrivedVerified
- lightingPreset: GF15-ACCEPT-NEUTRAL
- reflectivity: low
- priority: p0
- uploadIds: empty
- briefUrl / heroAssetId / sampleShelfId: omitted
- desiredDate: exact authorization-bound future Asia/Shanghai local date

The persisted-row contract covers **all 36 `requests_v2` columns**.

Fixed persisted values:

- id: REQ-GF15-ACCEPT-PROD-01
- sku: GF15-ACCEPT-PROD-01
- name / legacy_deliver_text / core_brief_summary: PROD-11 Kiosk Production Smoke
- client / requested_by: internal-acceptance
- kind: 细节
- legacy_v1_status: null
- v1_status_mode: canonical
- request_lifecycle / lifecycle_provenance: open / domain_command
- source: submission
- v1_assets_present / v1_request_present: 0 / 1
- production_type / shooting_subtype: 平面 / 细节
- deliverable_count / aspect_ratio: 1 / 1:1
- duration_seconds / audio_requirement: null / null
- note: empty string
- source_operation_id: PRODGF15-REQUEST-R1
- brief_url / hero_asset_id / sample_shelf_id: null
- sample_status: arrivedVerified
- lighting_preset: GF15-ACCEPT-NEUTRAL
- reflectivity: low
- priority: p0
- migration_batch_id: null

Only these persisted values are derived or authorization-bound later:

- source_ordinal: next available canonical ordinal selected inside the materialization transaction
- business_created_at: trusted server time inside that transaction
- business_updated_at: exactly the same value as business_created_at
- imported_at: exactly the same value as business_created_at
- desired_date: exact authorization-bound future Asia/Shanghai date

The target packet must carry the exact command with bound desiredDate. The materialization receipt must attest the complete `requests_v2` row. No other persisted field may be omitted, inferred differently, or populated by implementation discretion.

Required Scheduling facts remain:

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

The authorization-bound target packet must supply the one future Asia/Shanghai date and exactly one local start/end window, then carry the complete normalized config JSON and its canonical config digest. The digest must equal digestSchedulingConfigV1 for that exact final config. No other config field may vary at authorization or execution time. The bound local window and planning range must provide at least 1,200,000 ms (20 minutes) of contiguous capacity for the frozen 900,000 ms duration plus 5-minute buffer.

Before the first GF-15 mutation, while the same Scheduling quiescence lease is already held, a **pure deterministic-scheduler-v1 preflight** must be run from the frozen target packet, exact resource/config, empty occupied set and the exact synthetic candidate represented by the frozen request contract. It must yield exactly one proposed item for REQ-GF15-ACCEPT-PROD-01 on STUDIO-PROD-01 inside the bound planning window; zero or multiple items fail closed before any persistent fact is created. The later live deterministic proposal must use the same resourceScope and exactly the authorization-bound planning window. Before accepting anything, the assembled candidate set must contain exactly one candidate, its requestId must be REQ-GF15-ACCEPT-PROD-01, the proposal must contain exactly one proposed item for that request, and the decision must select exactly that item. Any unrelated open candidate blocks GF-15.

## Canonical path only

The only admitted path is:

bounded canonical requests_v2 materialization
-> RegisterSchedulingResourceV1
-> PublishSchedulingConfigV1
-> ActivateSchedulingConfigV1
-> SetRequestRequirements
-> deterministic proposal generation
-> pre-arm exact Outbox isolation or bind atomic acceptance-time isolation
-> canonical proposal accept decision
-> derived schedule item and schedule_item_tasks

Direct table insertion into request, resource, config, schedule, proposal, decision, revision, operation, or outbox tables is forbidden.

## Capability blockers

GF-15 remains not requestable until all three bounded capabilities exist and pass exact-head review.

1. KIOSK_ACCEPTANCE_REQUEST_MATERIALIZATION_CAPABILITY

Current POST /api/v1/requests updates the V1 snapshot but does not create a canonical requests_v2 row. A bounded, idempotent, exact-target request materialization capability is therefore required.

2. KIOSK_ACCEPTANCE_OUTBOX_ISOLATION_CAPABILITY

Canonical proposal acceptance creates a schedule.confirmed.v1 Notification Outbox intent. Isolation must be pre-armed for the exact proposal/decision before acceptance, or installed atomically inside the same acceptance transaction. From the instant the enqueue commits, the exact production-smoke intent must already be excluded from dispatcher claiming. A post-commit pending/claimable interval is forbidden. The intent remains permanently isolated from real-provider delivery without deleting or rewriting unrelated outbox facts.

3. KIOSK_ACCEPTANCE_SCHEDULING_QUIESCENCE_CAPABILITY

Scheduling resource changes, config activation, request-requirements changes, and final proposal acceptance can stale stored draft proposals globally. GF-15 must therefore acquire a bounded Scheduling quiescence lease before the first mutation and hold it through the final proposal decision.

The lease must be acquired **before** the prewrite draft-proposal gate is evaluated. While that same lease is held, the production database must show zero draft scheduling proposals before the first GF-15 mutation. Unrelated proposal generation and Scheduling-admin writes are forbidden while the lease is held. After GF-15 generates its proposal, the stored draft set must contain exactly that GF-15 proposal and no other draft. The lease is released only after the exact decision and post-decision verification complete.

Current fresh baseline: draft scheduling proposals = 0.

## Database-wide brief-host gate

Before the first GF-15 write, the entire requests_v2 table must be rescanned. Any non-empty brief_url blocks GF-15 until every observed host is explicitly reviewed against the frozen Kiosk allowlist. A scheduled-only scan is insufficient.

## Containment rollback

Bound rollback: ROLLBACK-GF-13-CONTAIN-DEVICE-ACCEPTANCE-SCHEDULE.

Rollback is containment, not deletion:

- keep PROD-11 blocked and Kiosk authentication disabled;
- if GF-15 activated STUDIO-PROD-01, replace only that resource to inactive with the same capability digest;
- if a prior active config existed, reactivate exactly that config;
- if no prior config existed, retain the acceptance config but keep the acceptance resource inactive because the current domain has no delete-or-clear-active-config command;
- contain the production-smoke outbox intent using the preverified isolation capability; isolation remains in force from enqueue commit and must never rely on post-commit catch-up;
- before any rollback Scheduling resource/config mutation, continue the still-held forward GF15 quiescence lease or reacquire a bounded rollback lease tied to the exact GF15 source receipts;
- while that lease is held, fail closed unless the stored draft set is empty or contains only the exact source-bound GF15 proposal and no unrelated draft;
- while the same lease is held, revalidate that STUDIO-PROD-01 still has the exact GF15 active value/capability digest/source operation from the forward receipts and that the active config still has GF15-ACCEPT-CONFIG-R1 plus the exact GF15 activation operation; any later Scheduling owner/value change blocks rollback;
- only after both the draft gate and mutable-post-state ownership gate pass may rollback deactivate STUDIO-PROD-01 or reactivate the exact prior config; an already-contained state is accepted only as an exact rollback replay bound to the same GF15 source receipts; if any gate fails, perform no Scheduling rollback mutation;
- keep the lease through containment/post-state verification, then release it and record the release receipt;
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
- KIOSK_ACCEPTANCE_SCHEDULING_QUIESCENCE_CAPABILITY
- GF15_ACCEPTANCE_CANDIDATE_ISOLATION
- prewrite draft proposal count is exactly zero
- KIOSK_ACCEPTANCE_TARGET_PACKET containing the exact future local date/window plus the complete normalized config JSON and canonical config digest
- DATABASE_WIDE_BRIEF_HOST_COMPATIBILITY
- fresh exact production target attestation

Only after GF-15 completes with exact evidence may authority advance toward PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE.
