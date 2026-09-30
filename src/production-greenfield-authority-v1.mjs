import { createHash } from 'node:crypto';
import { containsForbiddenEvidenceInput } from './production-evidence-input-boundary-v1.mjs';

const EXPECTED_BASE_MANIFEST_DIGEST =
  'sha256:e84bc05f9351773316e2f4c33eab77b67743d44c39689276aea67412294d514a';

const EXPECTED_NOT_APPLICABLE_GATES = Object.freeze([
  'PRODUCTION_DATA_MIGRATION',
  'PRODUCTION_IMPORT_SOURCE_CONSISTENCY',
  'PRODUCTION_ATTACHMENT_COPY_CAPABILITY',
  'CUTOVER_SOURCE_CONSISTENCY',
  'CUTOVER_SWITCH_RECOVERY',
  'CUTOVER_TARGET_WRITE_FENCE_CAPABILITY',
]);

const EXPECTED_SUPERSEDED_GATES = Object.freeze([
  'CONTAINER_START_READINESS',
  'INTEGRATION_DEPLOYMENT_READINESS',
  'CUTOVER_FORWARD_CHAIN',
  'POST_CUTOVER_ORPHAN_CLEANUP_RESTORATION',
]);

const EXPECTED_COMPLETED = Object.freeze([
  'PROD-01-TARGET-READONLY-PREFLIGHT',
  'PROD-02-CREATE-ISOLATED-APP-STORAGE',
  'PHASE-B-TARGET-VOLUME-ACCEPTANCE',
  'PROD-03-GENERATE-INSTALL-TOKENS',
  'PROD-04-BUILD-IMAGE',
  'PROD-05-START-ISOLATED-CONTAINER',
  'PROD-06-LOOPBACK-HEALTH-SMOKE',
  'PROD-07-CONFIGURE-REVERSE-PROXY-TLS',
  'PROD-GF-13R-RECONCILE-DURABLE-ACTIVATION',
  'PROD-GF-13-ACTIVATE',
  'PROD-GF-14L-RESTORE-CLEANUP-RUNTIME-LIFECYCLE',
  'PROD-10-ENABLE-VCP-REMOTE-SYNC',
]);

const EXPECTED_CONTAINER_START = Object.freeze([
  'PROD-02-CREATE-ISOLATED-APP-STORAGE',
  'PROD-03-GENERATE-INSTALL-TOKENS',
  'PROD-04-BUILD-IMAGE',
  'PRODUCTION_IMPORT_TARGET_ABSENCE',
  'GREENFIELD_NO_EXISTING_SOURCE',
  'PRE_CUTOVER_ORPHAN_CLEANUP_CONTROL',
  'PRODUCTION_DEPLOYMENT_GATE',
]);

const EXPECTED_FORWARD_CHAIN = Object.freeze([
  'PROD-02-CREATE-ISOLATED-APP-STORAGE',
  'PROD-03-GENERATE-INSTALL-TOKENS',
  'PROD-04-BUILD-IMAGE',
  'PROD-05-START-ISOLATED-CONTAINER',
  'PROD-06-LOOPBACK-HEALTH-SMOKE',
  'PROD-07-CONFIGURE-REVERSE-PROXY-TLS',
]);

const EXPECTED_CONDITIONAL_ACTIONS = Object.freeze([
  'PROD-08-FIREWALL-SECURITY-GROUP',
]);

const EXPECTED_POST_ACTIVATION_INTEGRATION_ACTIONS = Object.freeze([
  'PROD-10-ENABLE-VCP-REMOTE-SYNC',
  'PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE',
]);

const EXPECTED_INTEGRATION_PREREQUISITES = Object.freeze([
  'GREENFIELD_ACTIVATION_COMPLETION',
  'GREENFIELD_FORWARD_CHAIN',
  'PRODUCTION_TARGET_FACTS',
  'PRODUCTION_DEPLOYMENT_GATE',
]);

const EXPECTED_TOP_LEVEL_KEYS = Object.freeze([
  'schemaVersion',
  'authorityId',
  'baseManifestDigest',
  'deploymentMode',
  'target',
  'acceptance',
  'notApplicableBaseGateIds',
  'supersededBaseGateIds',
  'completedAcceptanceIds',
  'greenfieldContainerStartPrerequisites',
  'greenfieldForwardChain',
  'greenfieldConditionalActionIds',
  'postActivationIntegrationActionIds',
  'greenfieldIntegrationPrerequisites',
  'greenfieldPreActivationWriteFence',
  'greenfieldActivationAction',
  'greenfieldActivationReconciliationAction',
  'greenfieldCleanupAction',
  'greenfieldCleanupLifecycleAction',
  'greenfieldCleanupRollbackAction',
  'greenfieldKioskAcceptancePreparationAction',
  'greenfieldKioskAcceptancePreparationRollbackAction',
  'greenfieldKioskAcceptancePreparationConfigContract',
  'authorization',
]);

const EXPECTED_PRE_ACTIVATION_WRITE_FENCE = Object.freeze({
  runtimeMode: 'disabled',
  runtimeEnvironmentVariable: 'WRITE_ADMISSION_MODE',
  runtimeEnvironmentValue: 'disabled',
  blockedHttpMethods: Object.freeze(['POST', 'PUT', 'PATCH', 'DELETE']),
  coveredWriterClasses: Object.freeze([
    'STAGING_PRINCIPAL',
    'ADMIN_PRINCIPAL',
    'API_WRITE_ENDPOINTS',
    'BACKGROUND_WRITER',
    'DIRECT_STORAGE_BYPASS_WRITER',
  ]),
  requirements: Object.freeze([
    'ALL_HTTP_WRITES_REJECTED_BEFORE_STORE_DISPATCH',
    'V1_DIRECT_STORE_MUTATIONS_REJECTED',
    'PROD_07_STAGING_WRITES_FORBIDDEN_ON_GREENFIELD_PATH',
    'ORPHAN_CLEANUP_DISABLED_AND_DRAINED',
    'WRITE_CAPABLE_INTEGRATIONS_DISABLED',
    'BACKGROUND_WRITER_INVENTORY_ZERO',
    'UNCONTROLLED_DIRECT_STORAGE_WRITER_INVENTORY_ZERO',
    'NO_OTHER_CONTAINER_MOUNTS_TARGET_VOLUME',
    'EMPTY_TARGET_SCHEMA_BOOTSTRAP_BEFORE_LISTEN_ONLY',
    'CLEANUP_ENABLE_FORBIDDEN_WHILE_WRITE_ADMISSION_DISABLED',
    'NO_CONTAINER_RESTART_FOR_ADMISSION_ENABLE',
    'ATOMIC_IN_PROCESS_ADMISSION_ENABLE_AFTER_VERIFICATION',
  ]),
  activationTransition: 'SIGUSR2_IN_PROCESS_WRITE_ADMISSION_ENABLE',
  heldFromActionId: 'PROD-05-START-ISOLATED-CONTAINER',
  heldThroughActionId: 'PROD-GF-13-ACTIVATE',
  evidenceRequired: Object.freeze([
    'WRITE_ADMISSION_DISABLED_PROOF',
    'ALL_MUTATING_HTTP_METHODS_DENIED_PROOF',
    'V1_DIRECT_STORE_WRITE_DENIAL_PROOF',
    'PROD_07_STAGING_WRITE_DENIAL_PROOF',
    'ORPHAN_CLEANUP_DISABLE_AND_DRAIN_PROOF',
    'WRITE_CAPABLE_INTEGRATIONS_DISABLED_PROOF',
    'BACKGROUND_WRITER_INVENTORY_ZERO_PROOF',
    'UNCONTROLLED_DIRECT_STORAGE_WRITER_INVENTORY_ZERO_PROOF',
    'TARGET_VOLUME_SINGLE_CONTAINER_MOUNT_PROOF',
    'EMPTY_TARGET_BOOTSTRAP_REVISION_ZERO_PROOF',
    'CLEANUP_ENABLE_DENIAL_PROOF',
    'SAME_PROCESS_ADMISSION_TRANSITION_PROOF',
    'WRITE_ADMISSION_ENABLE_RECEIPT',
  ]),
});

const EXPECTED_ACTIVATION = Object.freeze({
  id: 'PROD-GF-13-ACTIVATE',
  title: 'Activate first greenfield production service',
  category: 'CUTOVER',
  risk: 'CRITICAL',
  sideEffect: 'IRREVERSIBLE_OR_EXTERNAL',
  requiresExplicitAuthorization: true,
  authorityTarget:
    'Exact new Jenn Shooting Operations route and client activation on ins-mi85f3my only; no previous Jenn Shooting Operations production authority exists',
  preconditions: Object.freeze([
    'GREENFIELD_NO_EXISTING_SOURCE',
    'PRODUCTION_TARGET_FACTS',
    'GREENFIELD_FORWARD_CHAIN',
    'GREENFIELD_PRE_ACTIVATION_WRITE_FENCE_HELD_AND_DRAINED',
    'CUTOVER_LIVE_SERVICE_READINESS',
    'PRODUCTION_DEPLOYMENT_GATE',
  ]),
  effects: Object.freeze([
    'After exact PROD-GF-13 authorization, revalidate the bound host, exact target storage identities, no-existing-source evidence, activation route and client scope; no source barrier, source sync or old-source demotion exists on this greenfield path',
    'Hold the greenfield pre-activation write fence across staging, admin, API, background and direct-storage bypass writer classes; reject every mutating HTTP method before store dispatch, reject V1 direct-store mutation entrypoints, keep PROD-07 staging writes forbidden, keep cleanup disabled and drained, keep write-capable integrations disabled, and require zero background and uncontrolled direct-storage writer inventory while verifying loopback health and routed TLS; only empty-target schema and revision-zero bootstrap before listen is allowed',
    'Promote only the approved new route and client entrypoint mappings to production and record one activation receipt while the same write fence remains held; do not overwrite or claim any previous Jenn Shooting Operations authority',
    'Perform read-only post-activation health, routing, client-mapping, database and attachment-baseline verification while the write fence remains held; failure removes only newly introduced exposure/runtime bindings and preserves the data volume',
    'Only after every read-only verification succeeds while the same process, route, image, target volume and disabled write fence remain unchanged, perform one atomic in-process write-admission enable transition and record its receipt; there is no container restart or route change between verification and admission, PROD-10/PROD-11 remain separately blocked until post-activation prerequisites and exact authorization, and orphan cleanup stays disabled until separately authorized greenfield cleanup restoration',
  ]),
  rollbackActionIds: Object.freeze([
    'ROLLBACK-01-REMOVE-NEW-ROUTE',
    'ROLLBACK-05-REVERT-FIREWALL-RULE',
    'ROLLBACK-02-STOP-NEW-CONTAINER',
    'ROLLBACK-08-REMOVE-BUILT-IMAGE',
    'ROLLBACK-06-REVOKE-ROLE-TOKENS',
    'ROLLBACK-04-PRESERVE-DATA-VOLUME',
  ]),
  evidenceRequired: Object.freeze([
    'GREENFIELD_NO_EXISTING_SOURCE_PROOF',
    'NO_PREVIOUS_PRODUCTION_AUTHORITY_PROOF',
    'GREENFIELD_FORWARD_CHAIN_COMPLETION_PROOF',
    'GREENFIELD_PRE_ACTIVATION_WRITE_FENCE_PROOF',
    'PRE_ACTIVATION_WRITER_DRAIN_PROOF',
    'PROD_07_STAGING_WRITE_DENIAL_PROOF',
    'TARGET_STORAGE_IDENTITIES',
    'ACTIVATION_ROUTE_AND_CLIENT_SCOPE',
    'PRE_ACTIVATION_LOOPBACK_HEALTH',
    'PRE_ACTIVATION_ROUTED_TLS_PROBE',
    'PRE_ACTIVATION_ORPHAN_CLEANUP_GUARD_PROOF',
    'ACTIVATION_RECORD',
    'READ_ONLY_POST_ACTIVATION_VERIFICATION',
    'PRE_ENABLE_SAME_PROCESS_AND_FENCE_PROOF',
    'WRITE_ADMISSION_ENABLE_RECEIPT',
    'ROLLBACK_TARGETS',
  ]),
});

const EXPECTED_ACTIVATION_RECONCILIATION = Object.freeze({
  id: 'PROD-GF-13R-RECONCILE-DURABLE-ACTIVATION',
  title: 'Reconcile out-of-order durable activation remediation',
  category: 'GOVERNANCE',
  risk: 'HIGH',
  sideEffect: 'READ_ONLY',
  requiresExplicitAuthorization: true,
  authorityTarget:
    'Exact durable Jenn Shooting Operations production container, loopback bind, approved data volume and restart proof on ins-mi85f3my only',
  preconditions: Object.freeze([
    'PROD_GF_13_RUNTIME_ACTIVATION_PASS',
    'OUT_OF_ORDER_DURABILITY_REMEDIATION_DISCLOSED',
    'PRODUCTION_TARGET_FACTS',
    'TARGET_STORAGE_IDENTITIES',
    'LOOPBACK_BACKEND_BINDING',
    'PRODUCTION_DEPLOYMENT_GATE',
  ]),
  effects: Object.freeze([
    'Acknowledge the owner-directed out-of-order durability remediation without representing it as prior exact-action authorization',
    'Perform read-only reconciliation of the current durable production container against the approved image, route, loopback-only host bind, exact target volume name/source/destination/device-inode identity, exact database path/device-inode identity, restart durability proof, database baseline, orphan-cleanup disabled state and integration-disabled state',
    'If and only if every bound fact matches, record reconciliation completion and then allow PROD-GF-13 activation completion to become authoritative; do not recreate, restart, signal, remount, rebind, enable cleanup or enable integrations as part of this reconciliation',
  ]),
  rollbackActionIds: Object.freeze([]),
  evidenceRequired: Object.freeze([
    'OUT_OF_ORDER_REMEDIATION_DISCLOSURE',
    'DURABLE_CONTAINER_IDENTITY',
    'DURABLE_IMAGE_IDENTITY',
    'DURABLE_LOOPBACK_BIND_IDENTITY',
    'DURABLE_TARGET_VOLUME_NAME',
    'DURABLE_TARGET_VOLUME_SOURCE',
    'DURABLE_TARGET_VOLUME_DESTINATION',
    'DURABLE_TARGET_VOLUME_DEVICE_INODE',
    'DURABLE_DATABASE_PATH',
    'DURABLE_DATABASE_DEVICE_INODE',
    'DURABLE_RESTART_PROOF',
    'POST_RESTART_HEALTH_STATUS',
    'POST_RESTART_WRITE_ADMISSION_STATUS',
    'POST_RESTART_UNAUTHENTICATED_WRITE_DENIAL',
    'POST_RESTART_DATABASE_BASELINE',
    'POST_RESTART_ORPHAN_CLEANUP_DISABLED_PROOF',
    'POST_RESTART_INTEGRATIONS_DISABLED_PROOF',
  ]),
});

const EXPECTED_CLEANUP = Object.freeze({
  "id": "PROD-GF-14-RESTORE-ORPHAN-CLEANUP",
  "title": "Restore orphan cleanup after greenfield activation",
  "category": "RUNTIME",
  "risk": "HIGH",
  "sideEffect": "IRREVERSIBLE_OR_EXTERNAL",
  "requiresExplicitAuthorization": true,
  "authorityTarget": "Exact orphan-upload cleanup controls of the greenfield Jenn Shooting Operations production service only",
  "preconditions": [
    "GREENFIELD_ACTIVATION_COMPLETION",
    "GREENFIELD_ATTACHMENT_BASELINE",
    "RESTORED_CLEANUP_DISABLE_CAPABILITY"
  ],
  "effects": [
    "After verified greenfield activation, verify the target attachment baseline and capture the exact disabled cleanup configuration before enabling any cleanup entry point",
    "Restore only the approved startup, periodic, saveUpload-triggered and submitRequest-triggered cleanup controls; failure invokes only the PROD-GF-14-bound disable-and-drain recovery and never deletes or rewrites deployment data as rollback"
  ],
  "rollbackActionIds": [
    "ROLLBACK-12-DISABLE-RESTORED-ORPHAN-CLEANUP"
  ],
  "evidenceRequired": [
    "GREENFIELD_ACTIVATION_COMPLETION_PROOF",
    "GREENFIELD_ATTACHMENT_BASELINE_PROOF",
    "CLEANUP_DISABLE_CAPABILITY_PROOF",
    "CLEANUP_PRE_RESTORE_DISABLED_STATE",
    "STARTUP_ORPHAN_CLEANUP_RESTORED",
    "PERIODIC_ORPHAN_CLEANUP_RESTORED",
    "REQUEST_TRIGGERED_ORPHAN_CLEANUP_RESTORED",
    "POST_RESTORE_HEALTH_STATUS",
    "CLEANUP_ROLLBACK_TARGET_BINDING",
    "DELETION_IRREVERSIBILITY_ACKNOWLEDGED"
  ]
});

const EXPECTED_CLEANUP_LIFECYCLE = Object.freeze({
  "id": "PROD-GF-14L-RESTORE-CLEANUP-RUNTIME-LIFECYCLE",
  "title": "Restore greenfield orphan cleanup with exact runtime lifecycle authority",
  "category": "RUNTIME",
  "risk": "HIGH",
  "sideEffect": "IRREVERSIBLE_OR_EXTERNAL",
  "requiresExplicitAuthorization": true,
  "authorityTarget": "Exact Jenn Shooting Operations orphan-cleanup controls plus only the production container recreate/restart operations required to persist cleanup restoration on the same approved image, loopback bind, data volume and database identity",
  "preconditions": [
    "GREENFIELD_ACTIVATION_COMPLETION",
    "GREENFIELD_ATTACHMENT_BASELINE",
    "GF14_FAIL_CLOSED_DISABLED_STATE",
    "RESTORED_CLEANUP_DISABLE_CAPABILITY",
    "GF14_EXACT_RUNTIME_IDENTITY",
    "GF14_GREENFIELD_ROLLBACK_CONTRACT_DEFINED",
    "PRODUCTION_TARGET_FACTS",
    "PRODUCTION_DEPLOYMENT_GATE"
  ],
  "effects": [
    "Revalidate the exact current container, approved image, loopback bind, data volume, database identity, disabled cleanup marker epoch, zero active cleanup runs, attachment baseline and write-admission state before mutation",
    "Prepare a persistent cleanup-enabled runtime configuration bound to the exact disabled marker epoch and restore only startup, periodic, saveUpload-triggered and submitRequest-triggered orphan cleanup",
    "If persistence requires process lifecycle alignment, recreate or restart only the exact production container name with the same approved image, loopback bind, data volume, database path and write-admission mode; no route, token, integration or business-data mutation is authorized",
    "Verify cleanup enabled after first start and controlled restart, verify health and authorization boundaries, prove business/database/attachment baseline unchanged, and retain the Greenfield-specific rollback package",
    "On any failure invoke only ROLLBACK-GF-12-DISABLE-RESTORED-ORPHAN-CLEANUP; do not delete or rewrite business data as rollback and acknowledge already-deleted orphan files would be irreversible"
  ],
  "rollbackActionIds": [
    "ROLLBACK-GF-12-DISABLE-RESTORED-ORPHAN-CLEANUP"
  ],
  "evidenceRequired": [
    "GF14_FAIL_CLOSED_DISABLED_STATE_PROOF",
    "GREENFIELD_ACTIVATION_COMPLETION_PROOF",
    "GREENFIELD_ATTACHMENT_BASELINE_PROOF",
    "GF14_EXACT_CONTAINER_IDENTITY",
    "GF14_EXACT_IMAGE_IDENTITY",
    "GF14_EXACT_LOOPBACK_BIND_IDENTITY",
    "GF14_EXACT_VOLUME_IDENTITY",
    "GF14_EXACT_DATABASE_IDENTITY",
    "GF14_DISABLED_MARKER_EPOCH",
    "CLEANUP_DISABLE_CAPABILITY_PROOF",
    "GF14_CLEANUP_ENABLED_RUNTIME_CONFIG",
    "STARTUP_ORPHAN_CLEANUP_RESTORED",
    "PERIODIC_ORPHAN_CLEANUP_RESTORED",
    "REQUEST_TRIGGERED_ORPHAN_CLEANUP_RESTORED",
    "CONTROLLED_RESTART_PROOF",
    "POST_RESTORE_HEALTH_STATUS",
    "WRITE_ADMISSION_UNCHANGED",
    "BUSINESS_BASELINE_UNCHANGED_PROOF",
    "GF14_GREENFIELD_ROLLBACK_CONTRACT_BINDING",
    "DELETION_IRREVERSIBILITY_ACKNOWLEDGED"
  ]
});

const EXPECTED_CLEANUP_ROLLBACK = Object.freeze({
  "id": "ROLLBACK-GF-12-DISABLE-RESTORED-ORPHAN-CLEANUP",
  "title": "Disable and drain cleanup restored by PROD-GF-14L",
  "category": "ROLLBACK",
  "risk": "HIGH",
  "sideEffect": "REVERSIBLE",
  "requiresExplicitAuthorization": false,
  "authorityTarget": "Only cleanup controls restored by PROD-GF-14L and only the exact production container lifecycle alignment required to persist disabled cleanup on the same approved image, loopback bind, data volume and database identity",
  "preconditions": [],
  "effects": [
    "Immediately block new orphan-cleanup admissions, drain in-flight cleanup work and persist the captured disabled cleanup runtime configuration",
    "If the running container embeds a cleanup-enabled startup configuration, recreate or restart only the exact same production container name using the same approved image, loopback bind, data volume, database identity and write-admission mode so disabled cleanup survives restart",
    "Verify cleanup disabled and drained, service health, write admission unchanged, data volume and database identity preserved, unrelated configuration unchanged, and acknowledge already-deleted records or files are not recovered"
  ],
  "rollbackActionIds": [],
  "evidenceRequired": [
    "GF14L_ROLLBACK_SOURCE_BINDING",
    "CLEANUP_ROLLBACK_TARGET_MATCH",
    "ALL_RESTORED_CLEANUP_ENTRY_POINTS_DISABLED",
    "CLEANUP_IN_FLIGHT_WORK_DRAINED",
    "PRE_GF14_DISABLED_RUNTIME_CONFIG_RESTORED",
    "EXACT_CONTAINER_LIFECYCLE_TARGET_BINDING",
    "POST_ROLLBACK_HEALTH_STATUS",
    "WRITE_ADMISSION_UNCHANGED",
    "DATA_VOLUME_PRESERVED",
    "DATABASE_IDENTITY_PRESERVED",
    "UNRELATED_CONFIGURATION_UNCHANGED",
    "DELETIONS_NOT_REVERSED_ACKNOWLEDGED"
  ]
});


const EXPECTED_KIOSK_ACCEPTANCE_PREPARATION_CONFIG = Object.freeze({
  schemaVersion: 1,
  configVersion: 'GF15-ACCEPT-CONFIG-R1',
  algorithmVersion: 'deterministic-scheduler-v1',
  calendarCompilerVersion: 'calendar-compiler-v1',
  estimatePolicyVersion: 'estimate-policy-v1',
  businessTimeZone: 'Asia/Shanghai',
  resourceCalendarStatic: Object.freeze({
    resourceId: 'STUDIO-PROD-01',
    capabilityDigest: 'sha256:d32c7c24657ca59e09348cb394471525bdefee9777b51d498eb3b2ba16782068',
    weeklyWindows: Object.freeze([]),
  }),
  dateOverrideContract: Object.freeze({
    status: 'custom',
    dateSource: 'AUTHORIZATION_BOUND_FUTURE_ASIA_SHANGHAI_DATE',
    windowSource: 'AUTHORIZATION_BOUND_SINGLE_LOCAL_WINDOW',
  }),
  durationFallbackRules: Object.freeze([
    Object.freeze({
      ruleId: 'GF15-DURATION-FLAT-DETAIL',
      productionType: '平面',
      shootingSubtype: '细节',
      durationMs: 900000,
    }),
  ]),
  bufferRules: Object.freeze([
    Object.freeze({
      ruleId: 'GF15-BUFFER-FLAT-DETAIL',
      productionType: '平面',
      shootingSubtype: '细节',
      bufferAfterMinutes: 5,
    }),
  ]),
  softScoringWeights: Object.freeze({
    LIGHTING_SWITCH: 0,
    REFLECTIVITY_SEQUENCE: 0,
    IDLE_GAP: 0,
    EXPECTED_OVERRUN: 0,
    DESIRED_DATE_MISS: 0,
  }),
  compatibleAlgorithmVersions: Object.freeze([
    'deterministic-scheduler-v1',
  ]),
  finalBindingRequirements: Object.freeze([
    'TARGET_PACKET_CONTAINS_COMPLETE_NORMALIZED_CONFIG_JSON',
    'TARGET_PACKET_CONTAINS_CONFIG_DIGEST',
    'ONLY_DATE_OVERRIDE_DATE_START_END_MAY_VARY',
    'CONFIG_DIGEST_MUST_EQUAL_DIGEST_SCHEDULING_CONFIG_V1',
    'TARGET_PACKET_WINDOW_MINIMUM_CONTIGUOUS_CAPACITY_MS_1200000',
    'TARGET_PACKET_DETERMINISTIC_PROPOSAL_PREFLIGHT_EXACTLY_ONE_ITEM_PASS',
  ]),
});

const EXPECTED_KIOSK_ACCEPTANCE_REQUEST_CONTRACT = Object.freeze({
  schemaVersion: 1,
  requestId: 'REQ-GF15-ACCEPT-PROD-01',
  requestOperationId: 'PRODGF15-REQUEST-R1',
  commandContract: Object.freeze({
    submissionSchemaVersion: 2,
    fixedFields: Object.freeze({
      operationId: 'PRODGF15-REQUEST-R1',
      productionType: '平面',
      sku: 'GF15-ACCEPT-PROD-01',
      name: 'PROD-11 Kiosk Production Smoke',
      kind: '细节',
      shootingSubtype: '细节',
      aspectRatio: '1:1',
      deliverables: Object.freeze({ type: 'flat', count: 1 }),
      requestedBy: 'internal-acceptance',
      note: '',
      coreBriefSummary: 'PROD-11 Kiosk Production Smoke',
      sampleStatus: 'arrivedVerified',
      lightingPreset: 'GF15-ACCEPT-NEUTRAL',
      reflectivity: 'low',
      priority: 'p0',
      uploadIds: Object.freeze([]),
    }),
    dynamicFields: Object.freeze({
      desiredDate: 'AUTHORIZATION_BOUND_FUTURE_ASIA_SHANGHAI_DATE',
    }),
    omittedOptionalFields: Object.freeze(['briefUrl', 'heroAssetId', 'sampleShelfId']),
  }),
  completePersistedColumns: Object.freeze([
  "id",
  "source_ordinal",
  "sku",
  "name",
  "client",
  "legacy_deliver_text",
  "kind",
  "legacy_v1_status",
  "v1_status_mode",
  "request_lifecycle",
  "lifecycle_provenance",
  "source",
  "business_created_at",
  "business_updated_at",
  "imported_at",
  "v1_assets_present",
  "v1_request_present",
  "production_type",
  "shooting_subtype",
  "deliverable_count",
  "aspect_ratio",
  "duration_seconds",
  "audio_requirement",
  "requested_by",
  "desired_date",
  "note",
  "source_operation_id",
  "core_brief_summary",
  "brief_url",
  "hero_asset_id",
  "sample_status",
  "sample_shelf_id",
  "lighting_preset",
  "reflectivity",
  "priority",
  "migration_batch_id"
]),
  fixedPersistedFields: Object.freeze({
  id: 'REQ-GF15-ACCEPT-PROD-01',
  sku: 'GF15-ACCEPT-PROD-01',
  name: 'PROD-11 Kiosk Production Smoke',
  client: 'internal-acceptance',
  legacy_deliver_text: 'PROD-11 Kiosk Production Smoke',
  kind: '细节',
  legacy_v1_status: null,
  v1_status_mode: 'canonical',
  request_lifecycle: 'open',
  lifecycle_provenance: 'domain_command',
  source: 'submission',
  v1_assets_present: 0,
  v1_request_present: 1,
  production_type: '平面',
  shooting_subtype: '细节',
  deliverable_count: 1,
  aspect_ratio: '1:1',
  duration_seconds: null,
  audio_requirement: null,
  requested_by: 'internal-acceptance',
  note: '',
  source_operation_id: 'PRODGF15-REQUEST-R1',
  core_brief_summary: 'PROD-11 Kiosk Production Smoke',
  brief_url: null,
  hero_asset_id: null,
  sample_status: 'arrivedVerified',
  sample_shelf_id: null,
  lighting_preset: 'GF15-ACCEPT-NEUTRAL',
  reflectivity: 'low',
  priority: 'p0',
  migration_batch_id: null
}),
  derivedPersistedFields: Object.freeze({
  source_ordinal: 'NEXT_AVAILABLE_CANONICAL_SOURCE_ORDINAL_IN_MATERIALIZATION_TRANSACTION',
  business_created_at: 'TRUSTED_SERVER_TIME_IN_MATERIALIZATION_TRANSACTION',
  business_updated_at: 'SAME_AS_BUSINESS_CREATED_AT',
  imported_at: 'SAME_AS_BUSINESS_CREATED_AT',
  desired_date: 'AUTHORIZATION_BOUND_FUTURE_ASIA_SHANGHAI_DATE'
}),
  finalBindingRequirements: Object.freeze([
  "TARGET_PACKET_CONTAINS_EXACT_REQUEST_COMMAND_WITH_BOUND_DESIRED_DATE",
  "MATERIALIZATION_RECEIPT_CONTAINS_COMPLETE_REQUESTS_V2_ROW",
  "MATERIALIZED_ROW_MATCHES_ALL_FIXED_AND_DERIVED_FIELDS",
  "NO_UNLISTED_OR_UNBOUND_REQUESTS_V2_FIELD"
]),
});

const EXPECTED_KIOSK_ACCEPTANCE_PREPARATION = Object.freeze({
  id: 'PROD-GF-15-PREPARE-DEVICE-ACCEPTANCE-SCHEDULE',
  title: 'Prepare bounded Kiosk production-smoke schedule',
  category: 'DATA',
  risk: 'HIGH',
  sideEffect: 'IRREVERSIBLE_OR_EXTERNAL',
  requiresExplicitAuthorization: true,
  authorityTarget:
    'Only the exact production-smoke-only scheduling fixture resourceId STUDIO-PROD-01, requestId REQ-GF15-ACCEPT-PROD-01, requestOperationId PRODGF15-REQUEST-R1, resourceOperationId PRODGF15-RESOURCE-R1, configVersion GF15-ACCEPT-CONFIG-R1, configPublishOperationId PRODGF15-CONFIG-PUBLISH-R1, configActivateOperationId PRODGF15-CONFIG-ACTIVATE-R1, requestRequirementsOperationId PRODGF15-REQS-R1, proposalOperationId PRODGF15-PROPOSAL-R1, decisionId PRODGF15-DECISION-R1 and one derived scheduleItemId within one authorization-bound future Asia/Shanghai window; no general scheduling rollout',
  requestContract: EXPECTED_KIOSK_ACCEPTANCE_REQUEST_CONTRACT,
  preconditions: Object.freeze([
    'GREENFIELD_ACTIVATION_COMPLETION',
    'PROD_10_COMPLETION',
    'KIOSK_DEPLOYABLE_AUTH_WIRING',
    'PROD11_DEPLOYMENT_CONTRACT_FREEZE',
    'PRODUCTION_TARGET_FACTS',
    'PRODUCTION_DEPLOYMENT_GATE',
    'DATABASE_WIDE_BRIEF_HOST_COMPATIBILITY',
    'KIOSK_ACCEPTANCE_TARGET_PACKET',
    'GF15_ACCEPTANCE_CANDIDATE_ISOLATION',
    'KIOSK_ACCEPTANCE_SCHEDULING_QUIESCENCE_CAPABILITY',
    'KIOSK_ACCEPTANCE_REQUEST_MATERIALIZATION_CAPABILITY',
    'KIOSK_ACCEPTANCE_OUTBOX_ISOLATION_CAPABILITY',
  ]),
  effects: Object.freeze([
    'Revalidate the exact production host, container, image, volume, database, Kiosk-disabled state and whole-database requests_v2 brief-host compatibility; acquire the bounded GF15 Scheduling quiescence capability before reading the prewrite draft-proposal gate; while that same lease is held revalidate current Scheduling revisions, prove zero stored draft scheduling proposals and absence-or-exact-replay state of every frozen acceptance identifier, then prove the authorization-bound local window and planning range contain at least 1200000 ms of contiguous capacity for the frozen 900000 ms duration plus 5-minute buffer and run a pure deterministic-scheduler-v1 preflight from the frozen target packet that yields exactly one proposed item for REQ-GF15-ACCEPT-PROD-01 on STUDIO-PROD-01; only after that preflight passes may the first GF15 mutation occur; retain the lease through the final proposal decision so unrelated proposal or scheduling-admin writes cannot race the preparation chain',
    'Materialize exactly one canonical production-smoke-only requests_v2 request through the dedicated bounded domain capability and require its exact command plus all 36 persisted requests_v2 fields to match requestContract, register only STUDIO-PROD-01 with the frozen FLAT capability digest, publish and activate only the frozen acceptance scheduling config, and record only the exact request requirements required by the acceptance fixture',
    'Generate one deterministic scheduling proposal scoped only to STUDIO-PROD-01 and the exact authorization-bound production-smoke window while the Scheduling quiescence capability remains held; fail closed unless the assembled candidate set contains exactly one candidate whose requestId is REQ-GF15-ACCEPT-PROD-01, the proposal contains exactly one proposed item for that request, the stored draft-proposal set contains exactly that GF15 proposal and no other draft, and the decision selects exactly that item; before submitting the decision, pre-arm Outbox isolation for the exact proposal/decision or require the same acceptance transaction to atomically install isolation, and prove that the resulting schedule.confirmed.v1 intent is never dispatcher-claimable from enqueue commit with no post-commit claimable window; only then accept the exact item, capture the derived schedule item ID, and release quiescence after post-decision verification',
    'Perform no raw SQL bypass, no unrelated scheduling mutation, no general scheduling rollout, no Kiosk credential/config/profile enablement, and no production run event; preserve VCP state unchanged',
    'Acknowledge that request/resource/config/proposal/decision/schedule/outbox facts are persistent production facts; rollback is containment-only and never deletes or rewrites those immutable facts',
  ]),
  rollbackActionIds: Object.freeze([
    'ROLLBACK-GF-13-CONTAIN-DEVICE-ACCEPTANCE-SCHEDULE',
  ]),
  evidenceRequired: Object.freeze([
    'GF15_EXACT_TARGET_ATTESTATION',
    'PROD10_COMPLETION_PROOF',
    'PROD11_DEPLOYMENT_CONTRACT_FREEZE_PROOF',
    'GF15_REQUEST_MATERIALIZATION_CAPABILITY_PROOF',
    'GF15_OUTBOX_ISOLATION_CAPABILITY_PROOF',
    'GF15_SCHEDULING_QUIESCENCE_CAPABILITY_PROOF',
    'GF15_ACCEPTANCE_TARGET_PACKET',
    'GF15_BOUND_CONFIG_JSON',
    'GF15_BOUND_CONFIG_DIGEST',
    'GF15_PREWRITE_SCHEDULING_BASELINE',
    'GF15_PREWRITE_DRAFT_PROPOSAL_COUNT_ZERO',
    'GF15_TARGET_PACKET_MINIMUM_1200000MS_CONTIGUOUS_CAPACITY_PROOF',
    'GF15_PREWRITE_DETERMINISTIC_PROPOSAL_PREFLIGHT_ONE_ITEM_PASS',
    'GF15_CANDIDATE_ISOLATION_PROOF',
    'GF15_POST_GENERATION_ONLY_ACCEPTANCE_DRAFT_PROOF',
    'DATABASE_WIDE_BRIEF_HOST_SCAN',
    'GF15_SCHEDULING_QUIESCENCE_ACQUIRE_RECEIPT',
    'GF15_BOUND_REQUEST_COMMAND',
    'GF15_BOUND_REQUEST_ROW_CONTRACT',
    'GF15_MATERIALIZED_REQUEST_ROW_ATTESTATION',
    'GF15_ACCEPTANCE_REQUEST_MATERIALIZATION_RECEIPT',
    'GF15_RESOURCE_REGISTRATION_RECEIPT',
    'GF15_RESOURCE_CAPABILITY_DIGEST',
    'GF15_CONFIG_PUBLISH_RECEIPT',
    'GF15_CONFIG_ACTIVATION_RECEIPT',
    'GF15_REQUEST_REQUIREMENTS_RECEIPT',
    'GF15_PROPOSAL_GENERATION_RECEIPT',
    'GF15_PROPOSAL_INPUT_DIGEST',
    'GF15_PROPOSAL_RESULT_DIGEST',
    'GF15_SELECTED_REQUEST_BINDING_PROOF',
    'GF15_DECISION_RECEIPT',
    'GF15_DERIVED_SCHEDULE_ITEM_ID',
    'GF15_OUTBOX_ISOLATION_PREARM_OR_ATOMIC_BINDING_PROOF',
    'GF15_OUTBOX_NEVER_CLAIMABLE_PROOF',
    'GF15_OUTBOX_ISOLATION_PROOF',
    'GF15_UNRELATED_SCHEDULING_FACTS_UNCHANGED',
    'GF15_KIOSK_REMAINS_DISABLED',
    'GF15_VCP_UNCHANGED',
    'GF15_SCHEDULING_QUIESCENCE_RELEASE_RECEIPT',
    'GF15_ROLLBACK_CONTAINMENT_BINDING',
  ]),
});

const EXPECTED_KIOSK_ACCEPTANCE_PREPARATION_ROLLBACK = Object.freeze({
  "id": "ROLLBACK-GF-13-CONTAIN-DEVICE-ACCEPTANCE-SCHEDULE",
  "title": "Contain the PROD-GF-15 Kiosk production-smoke scheduling fixture",
  "category": "ROLLBACK",
  "risk": "HIGH",
  "sideEffect": "IRREVERSIBLE_OR_EXTERNAL",
  "requiresExplicitAuthorization": false,
  "authorityTarget": "Only the exact STUDIO-PROD-01 production-smoke fixture and scheduling state introduced by PROD-GF-15, using rollback operationIds PRODGF15-ROLLBACK-RESOURCE-R1 and conditional PRODGF15-ROLLBACK-CONFIG-ACTIVATE-R1; never unrelated production scheduling, VCP, Kiosk configuration or DingTalk configuration",
  "preconditions": [
    "KIOSK_ACCEPTANCE_SCHEDULING_QUIESCENCE_CAPABILITY"
  ],
  "effects": [
    "Immediately block progression to PROD-11 and keep Kiosk authentication/configuration disabled while binding containment to the exact PROD-GF-15 forward receipts, pre-GF15 Scheduling baseline, any durable rollback operation receipts and current scheduling revisions",
    "Before any rollback Scheduling resource/config mutation, continue the still-held forward GF15 Scheduling quiescence lease or reacquire a bounded rollback lease; while that lease is held fail closed unless the stored draft-proposal set is empty or contains only the exact source-bound GF15 proposal and contains no unrelated draft; then revalidate ownership of the mutable GF15 post-state in a state-aware way by classifying the current resource/config pair through rollbackStateMachine using exact forward/rollback operation receipts and the pre-GF15 baseline, including the enumerated partial-forward and partial-rollback states; if either mutable value/source operation is changed by any later Scheduling action, perform no rollback mutation; any unenumerated state, invalid state pair or receipt mismatch also fails closed with no Scheduling rollback mutation",
    "For RESOURCE_FORWARD_APPLIED only, execute rollbackCommandContract.resourceContainment with fixed operationId PRODGF15-ROLLBACK-RESOURCE-R1 and persist its exact first-attempt command JSON/digest; on retry, if that operation already exists, reuse the persisted command/digest unchanged rather than rebinding revisions; RESOURCE_FORWARD_NOT_REACHED is a no-op and RESOURCE_ROLLBACK_APPLIED is exact replay/no-new-mutation",
    "For CONFIG_FORWARD_APPLIED only, if the pre-GF15 baseline had an active config, execute rollbackCommandContract.priorConfigReactivation with fixed operationId PRODGF15-ROLLBACK-CONFIG-ACTIVATE-R1 against that exact prior config and persist the exact first-attempt command JSON/digest after the resource step; retries reuse that exact command/digest unchanged; if forward config activation never happened, leave the exact prior/absent config untouched; if there was no prior config, retain GF15-ACCEPT-CONFIG-R1 with the resource contained inactive because the domain has no delete-or-clear-active-config command",
    "Contain the production-smoke schedule-confirmed Outbox intent through the preverified isolation capability and preserve the acceptance request, resource/config history, proposal, decision, schedule item, outbox and audit facts rather than deleting or rewriting immutable production history",
    "Verify the terminal contained state is one of the exact terminal/replay states defined by rollbackStateMachine, unrelated scheduling facts, production volume/database identity and VCP state are unchanged, confirm PROD-11 remains unauthorized, then release the rollback/continued quiescence lease and record the release receipt"
  ],
  "rollbackActionIds": [],
  "evidenceRequired": [
    "GF15_ROLLBACK_SOURCE_BINDING",
    "GF15_ROLLBACK_PREMUTATION_DRAFT_PROPOSAL_GATE",
    "GF15_ROLLBACK_SCHEDULING_QUIESCENCE_ACQUIRE_OR_CONTINUE_RECEIPT",
    "GF15_ROLLBACK_POSTSTATE_OWNERSHIP_GATE",
    "GF15_ROLLBACK_NO_POST_GF15_SCHEDULING_OVERWRITE_PROOF",
    "GF15_ROLLBACK_STATE_MACHINE_CLASSIFICATION",
    "GF15_ROLLBACK_FORWARD_AND_ROLLBACK_RECEIPT_CONSISTENCY_GATE",
    "GF15_ROLLBACK_RESOURCE_COMMAND_PACKET_OR_NOT_REQUIRED",
    "GF15_ROLLBACK_CONFIG_COMMAND_PACKET_OR_NOT_REQUIRED",
    "GF15_ROLLBACK_EXACT_REPLAY_OR_FIRST_ATTEMPT_PROOF",
    "GF15_ACCEPTANCE_RESOURCE_INACTIVE_OR_UNCHANGED",
    "GF15_PRIOR_CONFIG_RESTORED_OR_NO_PRIOR_CONFIG_ACKNOWLEDGED",
    "GF15_OUTBOX_CONTAINED",
    "GF15_KIOSK_DISABLED",
    "GF15_SCHEDULING_QUIESCENCE_RELEASE_RECEIPT",
    "GF15_IMMUTABLE_FACTS_PRESERVED",
    "GF15_UNRELATED_SCHEDULING_FACTS_UNCHANGED",
    "GF15_PRODUCTION_STORAGE_IDENTITY_PRESERVED",
    "GF15_VCP_UNCHANGED"
  ],
  "rollbackCommandContract": {
    "schemaVersion": 1,
    "resourceContainment": {
      "operationId": "PRODGF15-ROLLBACK-RESOURCE-R1",
      "commandType": "ReplaceSchedulingResourceV1",
      "executeOnlyWhen": "RESOURCE_FORWARD_APPLIED",
      "expectedRevisionsSource": "GF15_ROLLBACK_STATE_SNAPSHOT_CAPTURED_UNDER_QUIESCENCE_BEFORE_FIRST_RESOURCE_ROLLBACK_ATTEMPT",
      "resource": {
        "resourceId": "STUDIO-PROD-01",
        "v1DisplayPlace": "Studio PROD 01 Kiosk Acceptance",
        "status": "inactive",
        "capabilityJson": {
          "schemaVersion": 1,
          "capabilityIds": [
            "FLAT"
          ]
        },
        "capabilityDigest": "sha256:d32c7c24657ca59e09348cb394471525bdefee9777b51d498eb3b2ba16782068"
      },
      "firstAttemptBinding": "PERSIST_EXACT_COMMAND_JSON_AND_COMMAND_DIGEST_BEFORE_OR_WITH_FIRST_ATTEMPT",
      "replayPolicy": "IF_OPERATION_EXISTS_REUSE_EXACT_PERSISTED_COMMAND_JSON_AND_DIGEST_NEVER_REBIND_REVISIONS"
    },
    "priorConfigReactivation": {
      "operationId": "PRODGF15-ROLLBACK-CONFIG-ACTIVATE-R1",
      "commandType": "ActivateSchedulingConfigV1",
      "executeOnlyWhen": "CONFIG_FORWARD_APPLIED_AND_PRE_GF15_ACTIVE_CONFIG_EXISTS",
      "configVersionSource": "GF15_PREWRITE_SCHEDULING_BASELINE.EXACT_PRIOR_ACTIVE_CONFIG_VERSION",
      "expectedProjectionRevisionSource": "POST_RESOURCE_CONTAINMENT_PROJECTION_REVISION_CAPTURED_UNDER_SAME_QUIESCENCE_BEFORE_FIRST_CONFIG_ROLLBACK_ATTEMPT",
      "firstAttemptBinding": "PERSIST_EXACT_COMMAND_JSON_AND_COMMAND_DIGEST_BEFORE_OR_WITH_FIRST_ATTEMPT",
      "replayPolicy": "IF_OPERATION_EXISTS_REUSE_EXACT_PERSISTED_COMMAND_JSON_AND_DIGEST_NEVER_REBIND_REVISIONS"
    },
    "noPriorConfigRule": "IF_NO_PRE_GF15_ACTIVE_CONFIG_EXISTS_NEVER_INVENT_A_CONFIG_REACTIVATION_COMMAND"
  },
  "rollbackStateMachine": {
    "schemaVersion": 1,
    "resourceStates": {
      "RESOURCE_FORWARD_NOT_REACHED": {
        "match": "STUDIO-PROD-01_ABSENT_AND_PRODGF15_RESOURCE_R1_HAS_NO_SUCCESS_RECEIPT",
        "next": "NO_RESOURCE_MUTATION"
      },
      "RESOURCE_FORWARD_APPLIED": {
        "match": "STUDIO-PROD-01_ACTIVE_WITH_EXACT_GF15_CAPABILITY_DIGEST_AND_SOURCE_OPERATION_PRODGF15_RESOURCE_R1_PLUS_SUCCESS_RECEIPT",
        "next": "RUN_EXACT_RESOURCE_CONTAINMENT_COMMAND"
      },
      "RESOURCE_ROLLBACK_APPLIED": {
        "match": "STUDIO-PROD-01_INACTIVE_WITH_EXACT_GF15_CAPABILITY_DIGEST_AND_SOURCE_OPERATION_PRODGF15_ROLLBACK_RESOURCE_R1_PLUS_EXACT_ROLLBACK_OPERATION_RECEIPT",
        "next": "RESOURCE_STEP_EXACT_REPLAY_NO_NEW_MUTATION"
      }
    },
    "configStates": {
      "CONFIG_FORWARD_NOT_REACHED_PRIOR_PRESENT": {
        "match": "CURRENT_ACTIVE_CONFIG_EQUALS_EXACT_PRE_GF15_CONFIG_VERSION_AND_ACTIVATION_OPERATION_FROM_BASELINE_AND_PRODGF15_CONFIG_ACTIVATE_R1_HAS_NO_SUCCESS_RECEIPT",
        "next": "NO_CONFIG_MUTATION"
      },
      "CONFIG_FORWARD_NOT_REACHED_NO_PRIOR": {
        "match": "NO_ACTIVE_CONFIG_AND_PRE_GF15_BASELINE_HAD_NO_ACTIVE_CONFIG_AND_PRODGF15_CONFIG_ACTIVATE_R1_HAS_NO_SUCCESS_RECEIPT",
        "next": "NO_CONFIG_MUTATION"
      },
      "CONFIG_FORWARD_APPLIED": {
        "match": "CURRENT_ACTIVE_CONFIG_IS_GF15_ACCEPT_CONFIG_R1_WITH_ACTIVATION_OPERATION_PRODGF15_CONFIG_ACTIVATE_R1_PLUS_SUCCESS_RECEIPT",
        "next": "REACTIVATE_EXACT_PRIOR_CONFIG_IF_PRIOR_EXISTS_OTHERWISE_RETAIN_GF15_CONFIG_WITH_CONTAINED_INACTIVE_RESOURCE"
      },
      "CONFIG_ROLLBACK_APPLIED_PRIOR_PRESENT": {
        "match": "CURRENT_ACTIVE_CONFIG_EQUALS_EXACT_PRE_GF15_CONFIG_VERSION_WITH_ACTIVATION_OPERATION_PRODGF15_ROLLBACK_CONFIG_ACTIVATE_R1_PLUS_EXACT_ROLLBACK_OPERATION_RECEIPT",
        "next": "CONFIG_STEP_EXACT_REPLAY_NO_NEW_MUTATION"
      },
      "CONFIG_CONTAINED_NO_PRIOR": {
        "match": "PRE_GF15_BASELINE_HAD_NO_ACTIVE_CONFIG_AND_CURRENT_ACTIVE_CONFIG_IS_GF15_ACCEPT_CONFIG_R1_WITH_FORWARD_ACTIVATION_OPERATION_AND_RESOURCE_STATE_IS_RESOURCE_ROLLBACK_APPLIED",
        "next": "NO_CONFIG_MUTATION"
      }
    },
    "validStatePairs": [
      "RESOURCE_FORWARD_NOT_REACHED + CONFIG_FORWARD_NOT_REACHED_PRIOR_PRESENT",
      "RESOURCE_FORWARD_NOT_REACHED + CONFIG_FORWARD_NOT_REACHED_NO_PRIOR",
      "RESOURCE_FORWARD_APPLIED + CONFIG_FORWARD_NOT_REACHED_PRIOR_PRESENT",
      "RESOURCE_FORWARD_APPLIED + CONFIG_FORWARD_NOT_REACHED_NO_PRIOR",
      "RESOURCE_FORWARD_APPLIED + CONFIG_FORWARD_APPLIED",
      "RESOURCE_ROLLBACK_APPLIED + CONFIG_FORWARD_APPLIED",
      "RESOURCE_ROLLBACK_APPLIED + CONFIG_ROLLBACK_APPLIED_PRIOR_PRESENT",
      "RESOURCE_ROLLBACK_APPLIED + CONFIG_CONTAINED_NO_PRIOR"
    ],
    "rejectionRule": "ANY_UNENUMERATED_STATE_OR_PAIR_OR_RECEIPT_MISMATCH_FAILS_CLOSED_WITH_NO_SCHEDULING_ROLLBACK_MUTATION"
  }
});

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map(key => JSON.stringify(key) + ':' + stableJson(value[key]))
      .join(',') + '}';
  }
  return JSON.stringify(value);
}

function sameSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function sameObject(actual, expected) {
  return stableJson(actual) === stableJson(expected);
}

function issue(code, path) {
  return Object.freeze({ code, path });
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value) {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

function validBaseManifestShape(value) {
  if (!plainObject(value)
      || !Array.isArray(value.gates)
      || !Array.isArray(value.actions)
      || !plainObject(value.authorizationPacket)) {
    return false;
  }
  if (!value.gates.every(gate =>
    plainObject(gate)
    && typeof gate.id === 'string'
    && typeof gate.status === 'string'
    && typeof gate.evidence === 'string')) {
    return false;
  }
  if (!value.actions.every(action =>
    plainObject(action)
    && typeof action.id === 'string'
    && stringArray(action.preconditions))) {
    return false;
  }
  for (const key of ['requestedActionIds', 'approvedActionIds', 'requestableActionIds']) {
    if (!stringArray(value.authorizationPacket[key])) return false;
  }
  return true;
}

function validAuthorityShape(value) {
  if (!plainObject(value.target)
      || !plainObject(value.acceptance)
      || !plainObject(value.greenfieldPreActivationWriteFence)
      || !plainObject(value.greenfieldActivationAction)
      || !plainObject(value.greenfieldActivationReconciliationAction)
      || !plainObject(value.greenfieldCleanupAction)
      || !plainObject(value.greenfieldCleanupLifecycleAction)
      || !plainObject(value.greenfieldCleanupRollbackAction)
      || !plainObject(value.greenfieldKioskAcceptancePreparationAction)
      || !plainObject(value.greenfieldKioskAcceptancePreparationRollbackAction)
      || !plainObject(value.greenfieldKioskAcceptancePreparationConfigContract)
      || !plainObject(value.authorization)) {
    return false;
  }
  for (const key of [
    'notApplicableBaseGateIds',
    'supersededBaseGateIds',
    'completedAcceptanceIds',
    'greenfieldContainerStartPrerequisites',
    'greenfieldForwardChain',
    'greenfieldConditionalActionIds',
    'postActivationIntegrationActionIds',
    'greenfieldIntegrationPrerequisites',
  ]) {
    if (!stringArray(value[key])) return false;
  }
  for (const key of ['blockedHttpMethods', 'coveredWriterClasses', 'requirements', 'evidenceRequired']) {
    if (!stringArray(value.greenfieldPreActivationWriteFence[key])) return false;
  }
  for (const action of [
    value.greenfieldActivationAction,
    value.greenfieldActivationReconciliationAction,
    value.greenfieldCleanupAction,
    value.greenfieldCleanupLifecycleAction,
    value.greenfieldCleanupRollbackAction,
    value.greenfieldKioskAcceptancePreparationAction,
    value.greenfieldKioskAcceptancePreparationRollbackAction,
  ]) {
    for (const key of ['preconditions', 'effects', 'rollbackActionIds', 'evidenceRequired']) {
      if (!stringArray(action[key])) return false;
    }
  }
  for (const key of ['requestedActionIds', 'approvedActionIds', 'requestableActionIds']) {
    if (!stringArray(value.authorization[key])) return false;
  }
  return true;
}

export function validateProductionGreenfieldAuthority(value, {
  baseManifest,
} = {}) {
  const issues = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze({ ok: false, issues: Object.freeze([issue('GREENFIELD_SCHEMA_INVALID', '/')]) });
  }
  if (!validAuthorityShape(value)) {
    return Object.freeze({ ok: false, issues: Object.freeze([issue('GREENFIELD_SCHEMA_INVALID', '/')]) });
  }
  if (containsForbiddenEvidenceInput(value)) {
    return Object.freeze({ ok: false, issues: Object.freeze([issue('SECRET_MATERIAL_DETECTED', '/')]) });
  }
  if (!sameSet(Object.keys(value), EXPECTED_TOP_LEVEL_KEYS)) {
    issues.push(issue('GREENFIELD_TOP_LEVEL_KEYS_INVALID', '/'));
  }
  if (!validBaseManifestShape(baseManifest)) {
    return Object.freeze({
      ok: false,
      issues: Object.freeze([issue('BASE_MANIFEST_SCHEMA_INVALID', '/baseManifest')]),
    });
  }
  const derivedBaseManifestDigest =
    'sha256:' + createHash('sha256').update(stableJson(baseManifest)).digest('hex');
  if (derivedBaseManifestDigest !== EXPECTED_BASE_MANIFEST_DIGEST
      || value.baseManifestDigest !== EXPECTED_BASE_MANIFEST_DIGEST) {
    issues.push(issue('BASE_MANIFEST_DIGEST_INVALID', '/baseManifestDigest'));
  }
  if (value.schemaVersion !== 1
      || value.authorityId !== 'WO-06D-GREENFIELD-PRODUCTION-AUTHORITY-R1'
      || value.deploymentMode !== 'GREENFIELD_NO_EXISTING_SOURCE') {
    issues.push(issue('GREENFIELD_AUTHORITY_IDENTITY_INVALID', '/'));
  }

  const expectedTarget = {
    provider: 'TENCENT_CLOUD_CVM',
    instanceId: 'ins-mi85f3my',
    instanceName: 'AGENTS-OS',
    publicIpv4: '159.75.139.246',
    privateIpv4: '172.16.0.12',
    region: 'ap-guangzhou',
    zone: 'ap-guangzhou-7',
    os: 'Ubuntu 24.04.4 LTS',
    architecture: 'amd64',
    dockerVersion: '29.1.3',
    dockerComposeVersion: '2.40.3',
    applicationBind: '127.0.0.1:3800',
    applicationDirectory: '/mnt/datadisk0/apps/jenn-shooting-operations',
    dataVolumeName: 'jenn-shooting-operations_shooting_data',
    dataVolumeMountpoint:
      '/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data',
    backingDevice: '/dev/vdb',
    filesystem: 'ext4',
    publicHostname: 'jso.skmt617.top',
    reverseProxyRoute: 'https://jso.skmt617.top',
    containerName: 'jenn-shooting-operations-prod',
    cloudSecurityGroupStatus: 'UNVERIFIED_CONTROL_PLANE_FACT',
  };
  if (!sameObject(value.target, expectedTarget)) {
    issues.push(issue('GREENFIELD_TARGET_BINDING_INVALID', '/target'));
  }

  const expectedAcceptance = {
    firstProductionDeploymentConfirmedByOwner: true,
    priorJennShootingOperationsProductionDeployment: 'NONE',
    existingProductionSource: 'ABSENT_VERIFIED',
    sourceDiscoveryScope:
      'BOUND_HOST_ACTIVE_FILESYSTEM_AND_LOCAL_RUNTIME_NO_V1_SOURCE_FOUND',
    targetVolumeAcceptance: 'PASS',
    targetFilesystemCaseSemantics: 'CASE_SENSITIVE',
    targetUnicodeCanonicalEquivalence: 'DISTINCT',
    procSelfFdExclusiveCreate: 'PASS',
    sqliteWalFamily: 'PASS',
    sqliteRollbackJournalFamily: 'PASS',
    acceptedContainerNodeVersion: 'v24.21.0',
    activeTargetBindAliases: 0,
    targetVolumeEmptyAfterAcceptance: true,
    acceptanceProbeAssetsRemoved: true,
    prod03: {
      status: 'PASS',
      recordedAtUtc: '2026-09-27T16:34:04.678274744Z',
      secretStoragePath: '/mnt/datadisk0/apps/jenn-shooting-operations/.env.tokens',
      fileOwner: 'ubuntu:ubuntu',
      fileMode: 600,
      fileSizeBytes: 317,
      roleTokenCount: 4,
      uniqueRoleTokenCount: 4,
      tokenHexLength: 64,
      secretValuesRecorded: false,
      noSecretOutput: true,
      rollbackActionId: 'ROLLBACK-06-REVOKE-ROLE-TOKENS',
    },
    prod04: {
      status: 'PASS',
      recordedAtUtc: '2026-09-27T16:48:50.128965614Z',
      authorityCommit: '92b7137211bf807f178901e878a8c3d6e335cec4',
      imageTag:
        'jenn-shooting-operations:prod-92b7137211bf807f178901e878a8c3d6e335cec4',
      imageId:
        'sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545',
      nodeBaseIndexDigest:
        'sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1',
      nodeBaseAmd64Digest:
        'sha256:83f1c388c31fb2e51f7cbd4dea949b96260798c98f206e8e4696bc93bd964e3a',
      imageUser: 'node',
      targetContainers: 0,
      port3800Listeners: 0,
      tempBuildArtifacts: 0,
      buildLogLowDisclosure: true,
      secretValuesOutput: false,
      evidencePath:
        '/mnt/datadisk0/apps/jenn-shooting-operations/prod04-build-evidence.txt',
      rollbackActionId: 'ROLLBACK-08-REMOVE-BUILT-IMAGE',
    },
    prod05: {
      status: 'PASS',
      recordedAtUtc: '2026-09-27T17:50:49Z',
      sourceAuthorityCommit: '92b7137211bf807f178901e878a8c3d6e335cec4',
      containerName: 'jenn-shooting-operations-prod',
      containerId:
        '45ff5469cbd8874fbc3f5ac71260a57596b19f86a26b4131fa38d5d678162a99',
      imageId:
        'sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545',
      loopbackBind: '127.0.0.1:3800',
      healthStatus: 'healthy',
      runtimeUid: 1000,
      runtimeGid: 1000,
      dataVolumeName: 'jenn-shooting-operations_shooting_data',
      dataVolumeBind: '/app/data',
      targetVolumeContainerMountCount: 1,
      readOnlyRootfs: true,
      restartPolicy: 'unless-stopped',
      writeAdmissionMode: 'disabled',
      orphanCleanupMode: 'disabled',
      orphanCleanupState: 'disabled',
      orphanCleanupMarkerValid: true,
      orphanCleanupActiveRuns: 0,
      startupOrphanCleanupDisabled: true,
      periodicOrphanCleanupDisabled: true,
      requestTriggeredOrphanCleanupDisabled: true,
      allOrphanCleanupEntryPointsDisabled: true,
      bootstrapRevision: 0,
      greenfieldNoExistingSource: true,
      productionImportCompletionProof: 'NOT_APPLICABLE_GREENFIELD',
      secretValuesRecorded: false,
      evidencePath:
        '/mnt/datadisk0/apps/jenn-shooting-operations/prod05-start-evidence.txt',
      evidenceSha256:
        'sha256:f33a4175f10318fde375e85ca21a55fb7b1243717d039ffdaee96f3480e047a6',
      rollbackActionId: 'ROLLBACK-02-STOP-NEW-CONTAINER',
      rollbackPreserveDataVolume: 'jenn-shooting-operations_shooting_data',
    },
    prod06: {
      status: 'PASS',
      recordedAtUtc: '2026-09-27T18:08:17Z',
      containerName: 'jenn-shooting-operations-prod',
      containerId:
        '45ff5469cbd8874fbc3f5ac71260a57596b19f86a26b4131fa38d5d678162a99',
      imageId:
        'sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545',
      healthzStatus: 200,
      healthzBody: {
        ok: true,
        service: 'jenn-shooting-operations',
      },
      healthzWriteAdmissionHeader: 'disabled',
      containerState: 'running',
      containerHealth: 'healthy',
      containerUid: 1000,
      containerGid: 1000,
      databasePath: '/app/data/shooting-operations.sqlite',
      volumeMountType: 'volume',
      volumeName: 'jenn-shooting-operations_shooting_data',
      volumeDestination: '/app/data',
      volumeReadWrite: true,
      loopbackBind: '127.0.0.1:3800',
      writeAdmissionMode: 'disabled',
      orphanCleanupMode: 'disabled',
      bootstrapRevision: 0,
      containerStartCompletionProof: 'PROD-05-START-ISOLATED-CONTAINER',
      readOnlySmoke: true,
      secretValuesRecorded: false,
    },
    prod07: {
      status: 'PASS',
      recordedAtUtc: '2026-09-27T22:52:59Z',
      hostname: 'jso.skmt617.top',
      route: 'https://jso.skmt617.top',
      nginxConfigPath: '/etc/nginx/conf.d/jso-shooting-operations.conf',
      nginxConfigMode: 644,
      nginxConfigTest: 'PASS_ROOT_OPERATOR',
      nginxReload: 'PASS_ROOT_OPERATOR',
      nginxActive: true,
      noExistingRouteOverwrite: true,
      preMutationRouteMatchCount: 0,
      postMutationRouteMatchCount: 1,
      backend: 'http://127.0.0.1:3800',
      backendHealthStatus: 200,
      publicHealthStatus: 200,
      publicHealthWriteAdmission: 'disabled',
      httpRedirectStatus: 308,
      tlsOriginCertificateFamily: 'skmt617.top',
      tlsOriginHostnameCoverage: true,
      tlsOriginValidFromUtc: '2026-06-22T08:45:00Z',
      tlsOriginValidToUtc: '2041-06-18T08:45:00Z',
      tlsEdgeStatus: 'PASS',
      dnsProvider: 'Cloudflare',
      dnsProxyMode: 'PROXIED',
      publicWritePostStatus: 503,
      publicWritePutStatus: 503,
      publicWritePatchStatus: 503,
      publicWriteDeleteStatus: 503,
      publicWriteFailureCode: 'WRITE_ADMISSION_DISABLED',
      boundedStagingPrincipalScope: 'NO_PREACTIVATION_WRITES',
      writeAdmissionMode: 'disabled',
      orphanCleanupMode: 'disabled',
      orphanCleanupState: 'disabled',
      orphanCleanupMarkerValid: true,
      orphanCleanupActiveRuns: 0,
      bootstrapRevision: 0,
      stagingRequestPathCleanupDisabled: true,
      prod08RequiredForCurrentHttpsReachability: false,
      secretValuesRecorded: false,
      evidencePath:
        '/mnt/datadisk0/apps/jenn-shooting-operations/prod07-route-evidence.txt',
      evidenceSha256:
        'sha256:a49ecf5e5d358f1774f631af57dd930401a3bc9c6468d339322966d1e6329cc1',
      rollbackActionId: 'ROLLBACK-01-REMOVE-NEW-ROUTE',
    },
    prodGf13: {
      status: 'PASS',
      governanceStatus: 'RECONCILED_EXACT_READ_ONLY',
      activatedAtUtc: '2026-09-27T23:11:00Z',
      verifiedAtUtc: '2026-09-27T23:12:00Z',
      route: 'https://jso.skmt617.top',
      clientScope: 'HTTPS_ROUTE_ONLY_NO_VCP_NO_KIOSK',
      containerName: 'jenn-shooting-operations-prod',
      containerId:
        '45ff5469cbd8874fbc3f5ac71260a57596b19f86a26b4131fa38d5d678162a99',
      imageId:
        'sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545',
      hostPid: 747599,
      containerStartedAt: '2026-09-27T17:49:01.319828677Z',
      dataVolumeName: 'jenn-shooting-operations_shooting_data',
      dataVolumeDeviceInode: '64784:1835042',
      databaseDeviceInode: '64784:1835048',
      preEnableLoopbackHealth: 200,
      preEnableRoutedHealth: 200,
      preEnableWriteAdmission: 'disabled',
      preEnableMutatingMethodsDenied: true,
      preEnableOrphanCleanupState: 'disabled',
      preEnableOrphanCleanupActiveRuns: 0,
      preEnableRevision: 0,
      preEnableUploadRows: 0,
      preEnableOperationRows: 0,
      preEnableAuditRows: 0,
      preEnableAttachmentFiles: 0,
      targetVolumeContainerMountCount: 1,
      containerProcessCount: 1,
      integrationEnvCount: 0,
      directStoreGuardCount: 5,
      nginxConfigSha256:
        'sha256:35ea9acd80ba600e88d8c594a3a2558ec4cb57dd078c61d6832f5798c2eabc33',
      transitionSignal: 'SIGUSR2',
      writeAdmissionEvent: 'WRITE_ADMISSION_ENABLED',
      writeAdmissionRuntimePost: 'enabled',
      writeAdmissionTransitionCount: 1,
      sameContainerPost: true,
      sameHostPidPost: true,
      sameStartedAtPost: true,
      sameImagePost: true,
      sameRouteConfigPost: true,
      sameDataVolumePost: true,
      postEnableLoopbackHealth: 200,
      postEnableRoutedHealth: 200,
      postEnableLoopbackWriteAdmission: 'enabled',
      postEnableRoutedWriteAdmission: 'enabled',
      unauthenticatedWriteProbeStatus: 401,
      unauthenticatedWriteProbeCode: 'UNAUTHORIZED',
      orphanCleanupPost: 'disabled',
      orphanCleanupActiveRunsPost: 0,
      postEnableRevision: 0,
      postEnableUploadRows: 0,
      postEnableOperationRows: 0,
      postEnableAuditRows: 0,
      postEnableAttachmentFiles: 0,
      integrationsRemainDisabled: true,
      orphanCleanupRestorationDeferred: true,
      durabilityRemediationStatus: 'PASS',
      durabilityRemediationStartedAtUtc: '2026-09-27T23:29:06Z',
      durabilityRemediationVerifiedAtUtc: '2026-09-27T23:29:42Z',
      priorContainerId:
        '45ff5469cbd8874fbc3f5ac71260a57596b19f86a26b4131fa38d5d678162a99',
      durableContainerId:
        '1b2afb092d3ec1d834d12ff58fa86f4b1c05ec27913e8e80da278e9e9d0838cb',
      durableContainerStartedAt: '2026-09-27T23:29:33.784982222Z',
      durableContainerImageId:
        'sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545',
      durableContainerRestartPolicy: 'unless-stopped',
      durableContainerReadOnlyRootfs: true,
      durableRuntimeEnvPath:
        '/mnt/datadisk0/apps/jenn-shooting-operations/.env.runtime',
      durableRuntimeEnvSha256:
        'sha256:98519e90c4ac40862af935e52d519ee5ba5b9f2f08b88be7e005253c30a5478c',
      durabilityRemediationScriptPath:
        '/mnt/datadisk0/apps/jenn-shooting-operations/prod-gf13-durability-remediation.sh',
      durabilityRemediationScriptSha256:
        'sha256:eb34f41d56c9fd464ae3517c0aa5b38c6836a96695bc4cbffea5282e682e7fb4',
      firstDurableStartAdmission: 'enabled',
      restartProbePerformed: true,
      restartProbeAdmission: 'enabled',
      publicHealthAfterRestart: 200,
      publicAdmissionAfterRestart: 'enabled',
      unauthenticatedWriteAfterRestartStatus: 401,
      unauthenticatedWriteAfterRestartCode: 'UNAUTHORIZED',
      orphanCleanupAfterRestart: 'disabled',
      orphanCleanupActiveRunsAfterRestart: 0,
      databaseRevisionAfterRestart: 0,
      uploadRowsAfterRestart: 0,
      operationRowsAfterRestart: 0,
      auditRowsAfterRestart: 0,
      activeTargetVolumeMountCountAfterRestart: 1,
      priorContainerRemovedAfterVerification: true,
      durableActivationAcrossRestartVerified: true,
      durableVolumeType: 'volume',
      durableVolumeName: 'jenn-shooting-operations_shooting_data',
      durableVolumeSource:
        '/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data',
      durableVolumeDestination: '/app/data',
      durableVolumeReadWrite: true,
      durableDataDeviceInode: '64784:1835042',
      durableDatabasePath: '/app/data/shooting-operations.sqlite',
      durableDatabaseDeviceInode: '64784:1835048',
      durableDatabaseIdentityVerified: true,
      durableLoopbackHostIp: '127.0.0.1',
      durableLoopbackHostPort: 3800,
      durableContainerPort: '3800/tcp',
      durableVolumeIdentityVerified: true,
      durableLoopbackBindVerified: true,
      governanceReconciliationRequired: false,
      governanceReconciliationCompleted: true,
      governanceReconciliationActionId: 'PROD-GF-13R-RECONCILE-DURABLE-ACTIVATION',
      governanceReconciledAtUtc: '2026-09-28T03:09:43Z',
      secretValuesRecorded: false,
      evidencePath:
        '/mnt/datadisk0/apps/jenn-shooting-operations/prod-gf13-activation-evidence.txt',
      evidenceSha256:
        'sha256:1af2e9dd6ca511631ac5d7efb949d0b96c306b1d2c551241a5910b7ba7b81cb2',
      rollbackPreserveDataVolume: 'jenn-shooting-operations_shooting_data',
    },
    prodGf13r: {
      status: 'PASS',
      recordedAtUtc: '2026-09-28T03:09:43Z',
      actionId: 'PROD-GF-13R-RECONCILE-DURABLE-ACTIVATION',
      sideEffect: 'READ_ONLY',
      targetInstanceId: 'ins-mi85f3my',
      containerName: 'jenn-shooting-operations-prod',
      containerId:
        '1b2afb092d3ec1d834d12ff58fa86f4b1c05ec27913e8e80da278e9e9d0838cb',
      imageId:
        'sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545',
      containerState: 'running',
      containerHealth: 'healthy',
      containerStartedAt: '2026-09-27T23:29:33.784982222Z',
      restartPolicy: 'unless-stopped',
      readOnlyRootfs: true,
      loopbackHostIp: '127.0.0.1',
      loopbackHostPort: 3800,
      containerPort: '3800/tcp',
      volumeType: 'volume',
      volumeName: 'jenn-shooting-operations_shooting_data',
      volumeSource:
        '/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data',
      volumeDestination: '/app/data',
      volumeReadWrite: true,
      activeTargetVolumeMountCount: 1,
      dataDeviceInode: '64784:1835042',
      databasePath: '/app/data/shooting-operations.sqlite',
      databaseDeviceInode: '64784:1835048',
      databaseRuntimePath: '/app/data/shooting-operations.sqlite',
      writeAdmissionEnvironment: 'enabled',
      orphanCleanupEnvironment: 'disabled',
      orphanCleanupDomain: 'jenn-shooting-operations-primary',
      loopbackHealthStatus: 200,
      loopbackWriteAdmission: 'enabled',
      routedHealthStatus: 200,
      routedWriteAdmission: 'enabled',
      unauthenticatedWriteStatus: 401,
      unauthenticatedWriteCode: 'UNAUTHORIZED',
      databaseRevision: 0,
      uploadRows: 0,
      operationRows: 0,
      auditRows: 0,
      attachmentFiles: 0,
      orphanCleanupState: 'disabled',
      orphanCleanupMarkerValid: true,
      orphanCleanupActiveRuns: 0,
      integrationEnvCount: 0,
      nginxConfigSha256:
        'sha256:35ea9acd80ba600e88d8c594a3a2558ec4cb57dd078c61d6832f5798c2eabc33',
      durableRuntimeEnvSha256:
        'sha256:98519e90c4ac40862af935e52d519ee5ba5b9f2f08b88be7e005253c30a5478c',
      activationEvidenceSha256:
        'sha256:1af2e9dd6ca511631ac5d7efb949d0b96c306b1d2c551241a5910b7ba7b81cb2',
      remediationScriptSha256:
        'sha256:eb34f41d56c9fd464ae3517c0aa5b38c6836a96695bc4cbffea5282e682e7fb4',
      noProductionMutation: true,
      secretValuesRecorded: false,
    },
    prodGf14: {
      "status": "ROLLED_BACK_FAIL_CLOSED_LIFECYCLE_AUTHORITY_REQUIRED",
      "authorizedActionId": "PROD-GF-14-RESTORE-ORPHAN-CLEANUP",
      "preflightAtUtc": "2026-09-28T03:28:24Z",
      "restoreStartedAtUtc": "2026-09-28T03:32:51Z",
      "restoreRestartedAtUtc": "2026-09-28T03:34:39.513157967Z",
      "finalizedAtUtc": "2026-09-28T03:35:20Z",
      "verifiedAtUtc": "2026-09-28T03:35:52Z",
      "targetInstanceId": "ins-mi85f3my",
      "containerName": "jenn-shooting-operations-prod",
      "preContainerId": "1b2afb092d3ec1d834d12ff58fa86f4b1c05ec27913e8e80da278e9e9d0838cb",
      "postContainerId": "b66f589647a72ff109158194605d765df46435e1db4babcaa675fc5e75dec0ac",
      "imageId": "sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545",
      "postContainerStartedAt": "2026-09-28T03:34:39.513157967Z",
      "restartPolicy": "unless-stopped",
      "readOnlyRootfs": true,
      "loopbackBind": "127.0.0.1:3800 to 3800/tcp",
      "dataVolumeName": "jenn-shooting-operations_shooting_data",
      "dataVolumeSource": "/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data",
      "dataVolumeDestination": "/app/data",
      "dataDeviceInode": "64784:1835042",
      "databasePath": "/app/data/shooting-operations.sqlite",
      "databaseDeviceInode": "64784:1835048",
      "preWriteAdmission": "enabled",
      "postWriteAdmission": "enabled",
      "preCleanupMode": "disabled",
      "preCleanupState": "disabled",
      "preCleanupEpoch": "36d0854c-26c4-455c-a410-78ab64d9640e",
      "preCleanupMarkerValid": true,
      "preCleanupActiveRuns": 0,
      "cleanupDisableCapabilityProof": "PASS",
      "preRevision": 0,
      "preUploadRows": 0,
      "preUnclaimedUploadRows": 0,
      "preOperationRows": 0,
      "preAuditRows": 0,
      "preAttachmentFiles": 0,
      "preStagedCleanupFiles": 0,
      "preOldOrphanCandidates": 0,
      "candidateProbe": "PASS",
      "candidateRuntimeEnvSha256": "sha256:cdfa4ebba78b413c608f12670b3c02bde9af1315333bae00c1d2de97ad4f081a",
      "postCleanupMode": "enabled",
      "postCleanupState": "enabled",
      "postCleanupMarkerValid": true,
      "postCleanupActiveRuns": 0,
      "cleanupControlRoot": "/app/data/.orphan-cleanup-control/1ad8b65e5b8819bc9c7e4df213b9bb2ef3d0721a45e0a62d54c4e7f6c0bb1d27",
      "startupOrphanCleanupRestored": true,
      "periodicOrphanCleanupRestored": true,
      "saveUploadTriggeredCleanupRestored": true,
      "submitRequestTriggeredCleanupRestored": true,
      "cleanupAdmissionProbe": "PASS",
      "restartProbe": "PASS",
      "publicHealthPost": 200,
      "publicWriteAdmissionPost": "enabled",
      "unauthenticatedWritePostStatus": 401,
      "unauthenticatedWritePostCode": "UNAUTHORIZED",
      "postRevision": 0,
      "postUploadRows": 0,
      "postUnclaimedUploadRows": 0,
      "postOperationRows": 0,
      "postAuditRows": 0,
      "postAttachmentFiles": 0,
      "postStagedCleanupFiles": 0,
      "integrationEnvCountPost": 0,
      "runtimeConfigPromoted": false,
      "currentRuntimeEnvSha256": "sha256:98519e90c4ac40862af935e52d519ee5ba5b9f2f08b88be7e005253c30a5478c",
      "preGf14RuntimeEnvSha256": "sha256:98519e90c4ac40862af935e52d519ee5ba5b9f2f08b88be7e005253c30a5478c",
      "preGf14RuntimeEnvBackup": "/mnt/datadisk0/apps/jenn-shooting-operations/.env.runtime.pre-gf14",
      "rollbackControlRoot": "/app/data/.orphan-cleanup-control/1ad8b65e5b8819bc9c7e4df213b9bb2ef3d0721a45e0a62d54c4e7f6c0bb1d27",
      "deletionIrreversibilityAcknowledged": true,
      "businessDataUnchanged": true,
      "secretValuesRecorded": false,
      "evidencePath": "/mnt/datadisk0/apps/jenn-shooting-operations/prod-gf14-cleanup-evidence.txt",
      "evidenceSha256": "sha256:1bfa0d854c376260753fb4c1c4e4512b56ff7acecc7b6593f845136c0294a6d0",
      "governanceStatus": "SAFE_DISABLED_PENDING_EXACT_GF14L_AUTHORIZATION",
      "governanceReconciliationRequired": false,
      "governanceReconciliationCompleted": false,
      "runtimeCleanupRestorationPass": false,
      "rollbackActionAtExecution": "ROLLBACK-12-DISABLE-RESTORED-ORPHAN-CLEANUP",
      "rollbackBindingStatus": "SAFE_DISABLED_CONTROL_ROLLBACK_COMPLETED",
      "cleanupRollbackTargetBinding": "DISABLED_DRAINED_SAFE_STATE",
      "runtimeCleanupRestorationAttempted": true,
      "rollbackAtUtc": "2026-09-28T04:48:40Z",
      "rollbackCleanupState": "disabled",
      "rollbackCleanupEnabled": false,
      "rollbackCleanupEpoch": "71879def-55f0-40eb-a580-db45d133d70a",
      "rollbackCleanupMarkerValid": true,
      "rollbackCleanupActiveRuns": 0,
      "rollbackDurableRuntimeEnvSha256": "sha256:98519e90c4ac40862af935e52d519ee5ba5b9f2f08b88be7e005253c30a5478c",
      "rollbackContainerRestarted": false,
      "rollbackContainerRecreated": false,
      "rollbackServiceHealth": 200,
      "rollbackWriteAdmission": "enabled",
      "rollbackRevision": 0,
      "rollbackUploadRows": 0,
      "rollbackUnclaimedUploadRows": 0,
      "rollbackOperationRows": 0,
      "rollbackAuditRows": 0,
      "rollbackAttachmentFiles": 0,
      "rollbackStagedCleanupFiles": 0,
      "rollbackIntegrationEnvCount": 0,
      "nextExactActionRequired": "PROD-GF-14L-RESTORE-CLEANUP-RUNTIME-LIFECYCLE"
    },
    prodGf14l: {
      "status": "PASS",
      "actionId": "PROD-GF-14L-RESTORE-CLEANUP-RUNTIME-LIFECYCLE",
      "authorized": true,
      "preflightAtUtc": "2026-09-28T05:12:03Z",
      "firstStartAtUtc": "2026-09-28T05:13:58.471829315Z",
      "controlledRestartAtUtc": "2026-09-28T05:15:44.792470451Z",
      "verifiedAtUtc": "2026-09-28T05:16:16Z",
      "targetInstanceId": "ins-mi85f3my",
      "containerName": "jenn-shooting-operations-prod",
      "preContainerId": "b66f589647a72ff109158194605d765df46435e1db4babcaa675fc5e75dec0ac",
      "postContainerId": "b29798598ac043794420599c23f735c19038744a76f1b490b3e8c5a58e28e6be",
      "imageId": "sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545",
      "restartPolicy": "unless-stopped",
      "readOnlyRootfs": true,
      "loopbackBind": "127.0.0.1:3800 to 3800/tcp",
      "dataVolumeName": "jenn-shooting-operations_shooting_data",
      "dataVolumeSource": "/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data",
      "dataVolumeDestination": "/app/data",
      "dataDeviceInode": "64784:1835042",
      "databasePath": "/app/data/shooting-operations.sqlite",
      "databaseDeviceInode": "64784:1835048",
      "writeAdmissionPre": "enabled",
      "writeAdmissionPost": "enabled",
      "cleanupPreState": "disabled",
      "cleanupPreEnabled": false,
      "cleanupPreEpoch": "71879def-55f0-40eb-a580-db45d133d70a",
      "cleanupPreMarkerValid": true,
      "cleanupPreActiveRuns": 0,
      "cleanupPostMode": "enabled",
      "cleanupPostState": "enabled",
      "cleanupPostEnabled": true,
      "cleanupPostMarkerValid": true,
      "cleanupPostActiveRuns": 0,
      "startupOrphanCleanupRestored": true,
      "periodicOrphanCleanupRestored": true,
      "saveUploadTriggeredCleanupRestored": true,
      "submitRequestTriggeredCleanupRestored": true,
      "cleanupAdmissionProbe": "PASS",
      "controlledRestartProof": "PASS",
      "preRevision": 0,
      "preUploadRows": 0,
      "preUnclaimedRows": 0,
      "preOldOrphanCandidates": 0,
      "preOperationRows": 0,
      "preAuditRows": 0,
      "preAttachmentFiles": 0,
      "preStagedCleanupFiles": 0,
      "postRevision": 0,
      "postUploadRows": 0,
      "postUnclaimedRows": 0,
      "postOperationRows": 0,
      "postAuditRows": 0,
      "postAttachmentFiles": 0,
      "postStagedCleanupFiles": 0,
      "integrationEnvCountPost": 0,
      "publicHealthStatus": 200,
      "publicWriteAdmission": "enabled",
      "unauthenticatedWriteStatus": 401,
      "unauthenticatedWriteCode": "UNAUTHORIZED",
      "persistentRuntimeEnvSha256": "sha256:432b585fbaeee3795631c8e5c064422b3c6f1ae3a122a1eedecd52f138184ba4",
      "rollbackActionId": "ROLLBACK-GF-12-DISABLE-RESTORED-ORPHAN-CLEANUP",
      "rollbackDisabledRuntimePath": "/mnt/datadisk0/apps/jenn-shooting-operations/.env.runtime.pre-gf14",
      "rollbackDisabledRuntimeSha256": "sha256:98519e90c4ac40862af935e52d519ee5ba5b9f2f08b88be7e005253c30a5478c",
      "rollbackScriptPath": "/mnt/datadisk0/apps/jenn-shooting-operations/prod-gf14l-rollback-gf12.sh",
      "rollbackScriptSha256": "sha256:1561c117eca43d894c9ba34545509501990a041a38804313c3d8d307376c7de3",
      "backupContainerRemoved": true,
      "activeTargetVolumeMountCount": 1,
      "noBusinessDataMutationObserved": true,
      "deletionIrreversibilityAcknowledged": true,
      "secretValuesRecorded": false,
      "evidencePath": "/mnt/datadisk0/apps/jenn-shooting-operations/prod-gf14l-lifecycle-evidence.txt",
      "evidenceSha256": "sha256:dc5dba9d51be927755778b3058925f7c50f4cfb8d31bd6957a2cbd20b62d34c9"
    },
    "prod10": {
          "status": "PASS",
          "recordedAtUtc": "2026-09-29T01:24:20Z",
          "actionId": "PROD-10-ENABLE-VCP-REMOTE-SYNC",
          "vcpCoreRelease": "12380d7d",
          "vcpCoreCommit": "12380d7dbd47219c012d3bda029dafdfed4b0224",
          "extensionRelease": "7ea5d49c",
          "extensionCommit": "7ea5d49ca000a2298e012b9ff54ec229ebb59e96",
          "pluginName": "JennShootingOperations",
          "jevCategory": "shooting_operations",
          "serviceEndpoint": "https://jso.skmt617.top",
          "principalScope": "scheduler role for revision guarded V1 snapshot write",
          "credentialSourceClass": "RESTRICTED_RUNTIME_SECRET_REFERENCE",
          "secretValuesRecorded": false,
          "prewriteAttestationFullSha256": "sha256:3da8f0cea76029e5f27244a4988257f9229c5e2d03860137591f3f35b67c0384",
          "prewriteAttestationFinalSha256": "sha256:ab276166e3cdcc601fc397b95a9abe83c73b927ceba14e40e1403501c1a9fcbd",
          "prewriteInstanceId": "ins-mi85f3my",
          "prewriteHostname": "VM-0-12-ubuntu",
          "prewriteContainerId": "b29798598ac043794420599c23f735c19038744a76f1b490b3e8c5a58e28e6be",
          "prewriteImageId": "sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545",
          "prewriteNginxSha256": "sha256:35ea9acd80ba600e88d8c594a3a2558ec4cb57dd078c61d6832f5798c2eabc33",
          "prewriteContainerHealth": "healthy",
          "prewriteBackendHealthStatus": 200,
          "prewritePublicHealthStatus": 200,
          "runningImageValidator": "PASS",
          "preRevision": 2,
          "postRevision": 3,
          "verifiedRevision": 3,
          "operationId": "prod10-reaccept-create-data-r2-0001",
          "createdProductSku": "PROD10-ACCEPT-R2",
          "createdProductName": "PROD-10 VCP 正式接入验收",
          "createdTaskIdSha256": "sha256:87062fd994bc89887e8b4322948b2d4899aa191ae8255f2e904c459c498e0960",
          "createdTaskStatus": "pending",
          "createdTaskSource": "submission",
          "postwriteAttestationSha256": "sha256:9ffbbae81dfe8d969fa073556f33f6e6e83d5368d1c69bf0d0e175583b3aef45",
          "postwriteContainerContinuity": true,
          "businessDataCreated": true,
          "realGuardedPushAttempts": 1,
          "standingAgentWriteCapability": false,
          "acceptanceWriteEnabledPost": false,
          "vcpAppHotMemoryBinding": "resolved",
          "vcpAppColdMemoryBinding": "resolved",
          "kioskChanged": false,
          "dingtalkChanged": false,
          "rollbackActionId": "ROLLBACK-09-DISABLE-VCP-CONFIG",
          "runtimeReceiptSha256": "sha256:25817823aa7f7eb954f4fc072653b5e12b786e502552a16591fdd9ff0fb99689"
    },
  };
  if (!sameObject(value.acceptance, expectedAcceptance)) {
    issues.push(issue('GREENFIELD_ACCEPTANCE_INVALID', '/acceptance'));
  }

  const baseGateMap = new Map((baseManifest?.gates ?? []).map(gate => [gate.id, gate]));
  if (!sameSet(value.notApplicableBaseGateIds, EXPECTED_NOT_APPLICABLE_GATES)) {
    issues.push(issue('GREENFIELD_NOT_APPLICABLE_GATE_SET_INVALID', '/notApplicableBaseGateIds'));
  }
  if (!sameSet(value.supersededBaseGateIds, EXPECTED_SUPERSEDED_GATES)) {
    issues.push(issue('GREENFIELD_SUPERSEDED_GATE_SET_INVALID', '/supersededBaseGateIds'));
  }
  for (const id of [...EXPECTED_NOT_APPLICABLE_GATES, ...EXPECTED_SUPERSEDED_GATES]) {
    if (baseGateMap.get(id)?.status !== 'BLOCKED') {
      issues.push(issue('GREENFIELD_BASE_GATE_STATE_INVALID', '/baseManifest/' + id));
    }
  }

  if (!sameSet(value.completedAcceptanceIds, EXPECTED_COMPLETED)) {
    issues.push(issue('GREENFIELD_COMPLETED_ACCEPTANCE_SET_INVALID', '/completedAcceptanceIds'));
  }
  if (!sameSet(value.greenfieldContainerStartPrerequisites, EXPECTED_CONTAINER_START)) {
    issues.push(issue('GREENFIELD_CONTAINER_START_CONTRACT_INVALID', '/greenfieldContainerStartPrerequisites'));
  }
  if (!sameSet(value.greenfieldForwardChain, EXPECTED_FORWARD_CHAIN)) {
    issues.push(issue('GREENFIELD_FORWARD_CHAIN_INVALID', '/greenfieldForwardChain'));
  }
  if (!sameSet(value.greenfieldConditionalActionIds, EXPECTED_CONDITIONAL_ACTIONS)) {
    issues.push(issue('GREENFIELD_CONDITIONAL_ACTION_SET_INVALID', '/greenfieldConditionalActionIds'));
  }
  if (!sameSet(
    value.postActivationIntegrationActionIds,
    EXPECTED_POST_ACTIVATION_INTEGRATION_ACTIONS,
  )) {
    issues.push(issue(
      'GREENFIELD_INTEGRATION_ACTION_SET_INVALID',
      '/postActivationIntegrationActionIds',
    ));
  }
  if (!sameSet(
    value.greenfieldIntegrationPrerequisites,
    EXPECTED_INTEGRATION_PREREQUISITES,
  )) {
    issues.push(issue(
      'GREENFIELD_INTEGRATION_PREREQUISITES_INVALID',
      '/greenfieldIntegrationPrerequisites',
    ));
  }

  if (!sameObject(
    value.greenfieldPreActivationWriteFence,
    EXPECTED_PRE_ACTIVATION_WRITE_FENCE,
  )) {
    issues.push(issue(
      'GREENFIELD_PRE_ACTIVATION_WRITE_FENCE_INVALID',
      '/greenfieldPreActivationWriteFence',
    ));
  }

  const baseActionMap = new Map(baseManifest.actions.map(action => [action.id, action]));
  for (const id of [
    ...EXPECTED_FORWARD_CHAIN,
    ...EXPECTED_CONDITIONAL_ACTIONS,
    ...EXPECTED_POST_ACTIVATION_INTEGRATION_ACTIONS,
  ]) {
    if (!baseActionMap.has(id)) {
      issues.push(issue('GREENFIELD_ACTION_REFERENCE_INVALID', '/baseManifest/actions/' + id));
    }
  }
  for (const id of EXPECTED_POST_ACTIVATION_INTEGRATION_ACTIONS) {
    if (!baseActionMap.get(id)?.preconditions?.includes('INTEGRATION_DEPLOYMENT_READINESS')) {
      issues.push(issue('GREENFIELD_INTEGRATION_BASE_CONTRACT_INVALID', '/baseManifest/actions/' + id));
    }
  }

  if (!sameObject(value.greenfieldActivationAction, EXPECTED_ACTIVATION)) {
    issues.push(issue('GREENFIELD_ACTIVATION_ACTION_INVALID', '/greenfieldActivationAction'));
  }
  if (!sameObject(
    value.greenfieldActivationReconciliationAction,
    EXPECTED_ACTIVATION_RECONCILIATION,
  )) {
    issues.push(issue(
      'GREENFIELD_ACTIVATION_RECONCILIATION_ACTION_INVALID',
      '/greenfieldActivationReconciliationAction',
    ));
  }
  if (!sameObject(value.greenfieldCleanupAction, EXPECTED_CLEANUP)) {
    issues.push(issue('GREENFIELD_CLEANUP_ACTION_INVALID', '/greenfieldCleanupAction'));
  }
  if (!sameObject(
    value.greenfieldCleanupLifecycleAction,
    EXPECTED_CLEANUP_LIFECYCLE,
  )) {
    issues.push(issue(
      'GREENFIELD_CLEANUP_LIFECYCLE_ACTION_INVALID',
      '/greenfieldCleanupLifecycleAction',
    ));
  }
  if (!sameObject(value.greenfieldCleanupRollbackAction, EXPECTED_CLEANUP_ROLLBACK)) {
    issues.push(issue(
      'GREENFIELD_CLEANUP_ROLLBACK_ACTION_INVALID',
      '/greenfieldCleanupRollbackAction',
    ));
  }
  if (!sameObject(
    value.greenfieldKioskAcceptancePreparationConfigContract,
    EXPECTED_KIOSK_ACCEPTANCE_PREPARATION_CONFIG,
  )) {
    issues.push(issue(
      'GREENFIELD_KIOSK_ACCEPTANCE_PREPARATION_CONFIG_INVALID',
      '/greenfieldKioskAcceptancePreparationConfigContract',
    ));
  }
  if (!sameObject(
    value.greenfieldKioskAcceptancePreparationAction,
    EXPECTED_KIOSK_ACCEPTANCE_PREPARATION,
  )) {
    issues.push(issue(
      'GREENFIELD_KIOSK_ACCEPTANCE_PREPARATION_ACTION_INVALID',
      '/greenfieldKioskAcceptancePreparationAction',
    ));
  }
  if (!sameObject(
    value.greenfieldKioskAcceptancePreparationRollbackAction,
    EXPECTED_KIOSK_ACCEPTANCE_PREPARATION_ROLLBACK,
  )) {
    issues.push(issue(
      'GREENFIELD_KIOSK_ACCEPTANCE_PREPARATION_ROLLBACK_INVALID',
      '/greenfieldKioskAcceptancePreparationRollbackAction',
    ));
  }

  if (value.greenfieldContainerStartPrerequisites.includes('PROD-09-PRODUCTION-DATA-IMPORT')
      || value.greenfieldForwardChain.includes('PROD-09-PRODUCTION-DATA-IMPORT')
      || value.greenfieldForwardChain.some(id => EXPECTED_POST_ACTIVATION_INTEGRATION_ACTIONS.includes(id))
      || value.greenfieldActivationAction.preconditions.includes('CUTOVER_SOURCE_CONSISTENCY')
      || !value.greenfieldActivationAction.preconditions.includes('GREENFIELD_PRE_ACTIVATION_WRITE_FENCE_HELD_AND_DRAINED')
      || value.greenfieldActivationAction.rollbackActionIds.includes('ROLLBACK-07-RESTORE-PREVIOUS-AUTHORITY-SWITCH')
      || value.greenfieldActivationAction.rollbackActionIds.includes('ROLLBACK-09-DISABLE-VCP-CONFIG')
      || value.greenfieldActivationAction.rollbackActionIds.includes('ROLLBACK-10-DISABLE-KIOSK-CONFIG')) {
    issues.push(issue('GREENFIELD_SOURCE_PATH_LEAK_INVALID', '/'));
  }

  const expectedAuthorization = {
    status: 'FROZEN_NOT_REQUESTED',
    approvalModel: 'EXACT_ACTION_IDS_AND_TARGETS_ONLY',
    humanApprovalRequired: true,
    blanketApprovalAllowed: false,
    requestedActionIds: [],
    approvedActionIds: [],
    requestableActionIds: [],
    nextActionId: 'PROD-GF-15-PREPARE-DEVICE-ACCEPTANCE-SCHEDULE',
    nextActionRequiresExplicitAuthorization: true,
  };
  if (!sameObject(value.authorization, expectedAuthorization)) {
    issues.push(issue('GREENFIELD_AUTHORIZATION_STATE_INVALID', '/authorization'));
  }

  if ((baseManifest?.authorizationPacket?.requestedActionIds ?? []).length !== 0
      || (baseManifest?.authorizationPacket?.approvedActionIds ?? []).length !== 0
      || (baseManifest?.authorizationPacket?.requestableActionIds ?? []).length !== 0) {
    issues.push(issue('BASE_AUTHORIZATION_NOT_EMPTY', '/baseManifest/authorizationPacket'));
  }

  if (issues.length > 0) {
    return Object.freeze({ ok: false, issues: Object.freeze(issues) });
  }
  const digest = 'sha256:' + createHash('sha256').update(stableJson(value)).digest('hex');
  return Object.freeze({ ok: true, digest, issues: Object.freeze([]) });
}
