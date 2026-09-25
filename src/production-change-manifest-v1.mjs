import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';

const EXPECTED_AUTHORITY_BASE = "56f18930b8a89b19cdbfdde24d090649329d50c9";

const EXPECTED_SECRET_IDS = Object.freeze([
  "VIEWER_TOKEN",
  "SUBMITTER_TOKEN",
  "SCHEDULER_TOKEN",
  "ADMIN_TOKEN"
]);

const EXPECTED_GATE_BINDINGS = new Map(Object.entries({
  "WO06A_LOCAL_BASELINE": {
    "status": "SATISFIED",
    "evidence": "WO-06A_PREDEPLOY_EVIDENCE_BASELINE_PASS"
  },
  "WO06B_MIGRATION_RECOVERY": {
    "status": "SATISFIED",
    "evidence": "WO-06B_MIGRATION_RECOVERY_ACCEPTANCE_PASS"
  },
  "WO06C_LOCAL_BOUNDARY": {
    "status": "SATISFIED",
    "evidence": "WO-06C_LOCAL_EXTERNAL_BOUNDARY_PASS"
  },
  "WO06C_VCP_EXTERNAL": {
    "status": "BLOCKED",
    "evidence": "BLOCKED_EXTERNAL_RUNTIME"
  },
  "VCP_DEPLOYABLE_ADAPTER_WIRING": {
    "status": "BLOCKED",
    "evidence": "REAL_VCP_ADAPTER_RUNTIME_WIRING_NOT_IMPLEMENTED"
  },
  "WO06C_KIOSK_DEVICE": {
    "status": "BLOCKED",
    "evidence": "BLOCKED_DEVICE"
  },
  "KIOSK_DEPLOYABLE_AUTH_WIRING": {
    "status": "BLOCKED",
    "evidence": "PRODUCTION_ENTRYPOINT_AUTH_INJECTION_NOT_IMPLEMENTED"
  },
  "WO06C_DINGTALK_PROVIDER": {
    "status": "READY_FOR_AUTHORIZATION",
    "evidence": "READY_FOR_EXTERNAL_INTEGRATION_AUTHORIZATION"
  },
  "DINGTALK_TARGET_BINDING": {
    "status": "BLOCKED",
    "evidence": "EXACT_APP_PROVIDER_AND_TEST_DESTINATION_UNRESOLVED"
  },
  "DINGTALK_DEPLOYABLE_ADAPTER_WIRING": {
    "status": "BLOCKED",
    "evidence": "REAL_DINGTALK_ADAPTER_CREDENTIALS_AND_RUNTIME_WIRING_NOT_IMPLEMENTED"
  },
  "CUTOVER_FORWARD_CHAIN": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_VERIFIED_PROD_02_03_04_05_06_07_09_10_11_AND_PROD_08_IF_USED"
  },
  "CUTOVER_SWITCH_RECOVERY": {
    "status": "BLOCKED",
    "evidence": "POST_SWITCH_DUAL_READ_COMPATIBLE_WRITE_AND_SWITCH_RECORD_NOT_DESIGNED"
  },
  "CUTOVER_SOURCE_CONSISTENCY": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_CONTINUED_SOURCE_QUIESCENCE_OR_VERIFIED_FINAL_SYNCHRONIZATION_PARITY"
  },
  "CUTOVER_LIVE_SERVICE_READINESS": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_IMMEDIATE_LOOPBACK_HEALTH_AND_ROUTED_TLS_PROBE"
  },
  "TARGET_HOST_BINDING": {
    "status": "BLOCKED",
    "evidence": "EXACT_CANDIDATE_PRODUCTION_HOST_UNRESOLVED"
  },
  "CONTAINER_START_READINESS": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_VERIFIED_PROD_02_03_04_09"
  },
  "PRE_CUTOVER_ORPHAN_CLEANUP_CONTROL": {
    "status": "BLOCKED",
    "evidence": "ALL_STARTUP_PERIODIC_AND_REQUEST_TRIGGERED_ORPHAN_CLEANUP_DISABLE_NOT_IMPLEMENTED"
  },
  "HEALTH_SMOKE_READINESS": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_VERIFIED_PROD_05"
  },
  "PROXY_BACKEND_READINESS": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_VERIFIED_PROD_04_05_06"
  },
  "PRE_CUTOVER_ROUTE_WRITE_RESTRICTION": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_PUBLIC_WRITE_BLOCK_OR_BOUNDED_STAGING_ACCESS"
  },
  "PRODUCTION_IMPORT_STORAGE_READINESS": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_VERIFIED_PROD_02"
  },
  "PRODUCTION_IMPORT_TARGET_ABSENCE": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_TARGET_SQLITE_PATH_ABSENT_BEFORE_PROD_05"
  },
  "PRODUCTION_IMPORT_SOURCE_CONSISTENCY": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_OFFLINE_SOURCE_QUIESCENCE_OR_VERIFIED_UPLOAD_MIGRATION_COORDINATION"
  },
  "PRODUCTION_ATTACHMENT_COPY_CAPABILITY": {
    "status": "BLOCKED",
    "evidence": "TARGET_UPLOAD_BYTE_COPY_AND_VERIFICATION_NOT_IMPLEMENTED"
  },
  "INTEGRATION_DEPLOYMENT_READINESS": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_VERIFIED_PROD_02_03_04_05_06_07_09_AND_PROD_08_IF_USED"
  },
  "PRODUCTION_TARGET_FACTS": {
    "status": "BLOCKED",
    "evidence": "UNRESOLVED_OUTSIDE_REPOSITORY"
  },
  "PRODUCTION_DATA_MIGRATION": {
    "status": "BLOCKED",
    "evidence": "REAL_PRODUCTION_INPUT_NOT_VALIDATED"
  },
  "POST_CUTOVER_ORPHAN_CLEANUP_RESTORATION": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_VERIFIED_PROD_13_AND_POST_CUTOVER_ATTACHMENT_PARITY"
  },
  "PRODUCTION_DEPLOYMENT_GATE": {
    "status": "BLOCKED",
    "evidence": "BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE"
  }
}));

const EXPECTED_REQUESTABLE = Object.freeze([]);

const EXPECTED_DEPLOYMENT_BLOCKERS = Object.freeze([
  "VCP_DEPLOYABLE_ADAPTER_WIRING",
  "KIOSK_DEPLOYABLE_AUTH_WIRING",
  "PRODUCTION_TARGET_FACTS",
  "PRODUCTION_DATA_MIGRATION",
  "PRODUCTION_DEPLOYMENT_GATE"
]);

const EXPECTED_REVALIDATION_CHECKLIST = Object.freeze([
  "AUTHORITY_HEAD"
]);

const EXPECTED_ACTION_REVALIDATION = Object.freeze({
  "PROD-02-CREATE-ISOLATED-APP-STORAGE": Object.freeze([
    "TARGET_HOST_IDENTITY",
    "DISK_PORT_ROUTE_CONFLICTS",
    "ROLLBACK_TARGETS"
  ]),
  "PROD-03-GENERATE-INSTALL-TOKENS": Object.freeze([
    "TARGET_HOST_IDENTITY",
    "DISK_PORT_ROUTE_CONFLICTS",
    "SECRET_STORAGE",
    "ROLLBACK_TARGETS"
  ]),
  "PROD-04-BUILD-IMAGE": Object.freeze([
    "TARGET_HOST_IDENTITY",
    "DISK_PORT_ROUTE_CONFLICTS",
    "BUILD_SOURCE_AUTHORITY_COMMIT",
    "BUILD_BASE_IMAGE_DIGEST"
  ]),
  "PROD-05-START-ISOLATED-CONTAINER": Object.freeze([
    "TARGET_HOST_IDENTITY",
    "DISK_PORT_ROUTE_CONFLICTS",
    "BUILT_IMAGE_DIGEST",
    "ALL_ORPHAN_CLEANUP_ENTRY_POINTS_DISABLED",
    "ROLLBACK_TARGETS"
  ]),
  "PROD-06-LOOPBACK-HEALTH-SMOKE": Object.freeze([
    "TARGET_HOST_IDENTITY",
    "DISK_PORT_ROUTE_CONFLICTS",
    "BUILT_IMAGE_DIGEST"
  ]),
  "PROD-07-CONFIGURE-REVERSE-PROXY-TLS": Object.freeze([
    "TARGET_HOST_IDENTITY",
    "DISK_PORT_ROUTE_CONFLICTS",
    "BUILT_IMAGE_DIGEST",
    "ALL_ORPHAN_CLEANUP_ENTRY_POINTS_STILL_DISABLED",
    "ROLLBACK_TARGETS",
    "PRE_CUTOVER_ROUTE_ACCESS_POLICY"
  ]),
  "PROD-08-FIREWALL-SECURITY-GROUP": Object.freeze([
    "TARGET_HOST_IDENTITY",
    "DISK_PORT_ROUTE_CONFLICTS",
    "ROLLBACK_TARGETS"
  ]),
  "PROD-09-PRODUCTION-DATA-IMPORT": Object.freeze([
    "TARGET_HOST_IDENTITY",
    "DISK_PORT_ROUTE_CONFLICTS",
    "BACKUP_ROLLBACK_PROOF",
    "IMPORT_TARGET_SQLITE_ABSENCE_PROOF",
    "SOURCE_QUIESCENCE_OR_COORDINATION_PROOF",
    "TARGET_UPLOAD_VOLUME_IDENTITY",
    "ATTACHMENT_COPY_PLAN",
    "ROLLBACK_TARGETS"
  ]),
  "PROD-10-ENABLE-VCP-REMOTE-SYNC": Object.freeze([
    "TARGET_HOST_IDENTITY",
    "DISK_PORT_ROUTE_CONFLICTS",
    "BUILT_IMAGE_DIGEST",
    "SECRET_STORAGE",
    "VCP_RUNTIME_ADAPTER_CONFIGURATION",
    "ROLLBACK_TARGETS"
  ]),
  "PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE": Object.freeze([
    "TARGET_HOST_IDENTITY",
    "DISK_PORT_ROUTE_CONFLICTS",
    "BUILT_IMAGE_DIGEST",
    "SECRET_STORAGE",
    "KIOSK_AUTH_RUNTIME_CONFIGURATION",
    "EXTERNAL_READINESS_GATES",
    "ROLLBACK_TARGETS"
  ]),
  "PROD-12-DINGTALK-PROVIDER-INTEGRATION": Object.freeze([
    "SECRET_STORAGE",
    "DINGTALK_RUNTIME_ADAPTER_CONFIGURATION",
    "EXTERNAL_READINESS_GATES",
    "ROLLBACK_TARGETS"
  ]),
  "PROD-13-CUTOVER-SWITCH": Object.freeze([
    "TARGET_HOST_IDENTITY",
    "DISK_PORT_ROUTE_CONFLICTS",
    "BUILT_IMAGE_DIGEST",
    "BACKUP_ROLLBACK_PROOF",
    "EXTERNAL_READINESS_GATES",
    "PRE_CUTOVER_ROUTE_RESTRICTION_STILL_ACTIVE",
    "FINAL_SOURCE_QUIESCENCE_OR_SYNC_PROOF",
    "FINAL_SOURCE_TARGET_PARITY",
    "PRE_SWITCH_LOOPBACK_HEALTH",
    "PRE_SWITCH_ROUTED_TLS_PROBE",
    "ALL_ORPHAN_CLEANUP_ENTRY_POINTS_STILL_DISABLED",
    "ROLLBACK_TARGETS"
  ]),
  "PROD-14-RESTORE-ORPHAN-CLEANUP": Object.freeze([
    "CUTOVER_COMPLETION_PROOF",
    "POST_CUTOVER_ATTACHMENT_PARITY",
    "CLEANUP_RESTORATION_CONFIG"
  ])
});

const EXPECTED_TARGET_UNRESOLVED_FACTS = Object.freeze([
  "TARGET_HOST_IDENTITY",
  "DISK_CAPACITY",
  "PORT_CONFLICT_CHECK",
  "CONTAINER_NAME",
  "REVERSE_PROXY_ROUTE",
  "TLS_CERTIFICATE_BINDING"
]);

const EXPECTED_INVARIANTS = Object.freeze([
  "NO_EXISTING_ROUTE_OR_CONTAINER_OVERWRITE",
  "APP_PORT_LOOPBACK_ONLY",
  "NO_SECRET_IN_GIT_LOGS_CHAT",
  "NO_PRODUCTION_DATA_MUTATION_WITHOUT_SEPARATE_AUTHORIZATION",
  "NO_SWITCH_OR_CUTOVER_FROM_PREDEPLOY_APPROVAL",
  "NO_AGENT_AUTO_ADOPTION_PERMISSION_EXPANSION",
  "ROLLBACK_PRESERVES_DATA_VOLUME",
  "ROLLBACK_AUTHORITY_ONLY_DERIVED_FROM_APPROVED_FORWARD_ACTION",
  "NO_CUTOVER_WITHOUT_POST_SWITCH_AUTHORITY_RECOVERY",
  "TARGET_PREFLIGHT_REQUIRES_BOUND_CANDIDATE_NOT_PREFLIGHT_RESULTS",
  "RUNTIME_START_AND_HEALTH_REQUIRE_VERIFIED_PREDECESSORS",
  "BUILT_IMAGE_ROLLBACK_REQUIRES_EXACT_DIGEST_AND_ZERO_RUNTIME_REFERENCES",
  "PRODUCTION_IMPORT_REQUIRES_VERIFIED_STORAGE_PREPARATION",
  "EXTERNAL_WRITE_INTEGRATIONS_REQUIRE_VERIFIED_DEPLOYMENT_CHAIN",
  "INTEGRATION_ROLLBACK_AUTHORITY_IS_SOURCE_ACTION_SCOPED",
  "CREATED_STORAGE_IS_INTENTIONALLY_RETAINED_ON_ROLLBACK",
  "BUILD_OUTPUT_DIGEST_IS_NOT_A_GLOBAL_PRE_REQUEST_PREREQUISITE",
  "BUILD_REQUEST_REVALIDATES_SOURCE_AND_BASE_DIGEST_SEPARATELY",
  "HOST_CONFLICT_REVALIDATION_REQUIRES_COMPLETED_PREFLIGHT",
  "GLOBAL_PRE_REQUEST_REVALIDATION_IS_AUTHORITY_ONLY",
  "INITIAL_TARGET_PREFLIGHT_HAS_NO_LATER_STAGE_REVALIDATION",
  "PRODUCTION_IMPORT_REQUIRES_OFFLINE_OR_VERIFIED_COORDINATED_SOURCE_STATE",
  "PRODUCTION_IMPORT_REQUIRES_ABSENT_TARGET_SQLITE_PATH",
  "PRODUCTION_IMPORT_PRECEDES_CONTAINER_INITIALIZATION",
  "IMAGE_ROLLBACK_REQUIRES_CONTAINER_OBJECT_REMOVAL",
  "PRODUCTION_IMPORT_REQUIRES_ATTACHMENT_BYTES_IN_TARGET_VOLUME",
  "PRE_CUTOVER_ROUTE_BLOCKS_PUBLIC_WRITES_UNTIL_SWITCH",
  "VCP_GUARDED_PUSH_WRITES_ARE_NOT_REVERSED_BY_CONFIG_ROLLBACK",
  "KIOSK_EVENT_WRITES_ARE_NOT_REVERSED_BY_CONFIG_ROLLBACK",
  "KIOSK_REAL_DEVICE_ACCEPTANCE_FOLLOWS_DEPLOYABLE_AUTH_WIRING",
  "CUTOVER_REQUIRES_FINAL_SOURCE_TARGET_PARITY",
  "CUTOVER_REQUIRES_IMMEDIATE_SERVICE_HEALTH_AND_ROUTE_PROBE",
  "PRE_CUTOVER_RUNTIME_DISALLOWS_ORPHAN_CLEANUP",
  "PRE_CUTOVER_ORPHAN_CLEANUP_GUARD_COVERS_ALL_ENTRY_POINTS",
  "DINGTALK_PROVIDER_ACTION_REQUIRES_DEPLOYABLE_RUNTIME_ADAPTER",
  "VCP_EXTERNAL_COMPATIBILITY_FOLLOWS_DEPLOYABLE_ADAPTER_ENABLEMENT",
  "ORPHAN_CLEANUP_RESTORATION_REQUIRES_POST_CUTOVER_ATTACHMENT_PARITY"
]);

const EXPECTED_ROLLBACK_ORDER = Object.freeze([
  "ROLLBACK-01-REMOVE-NEW-ROUTE",
  "ROLLBACK-05-REVERT-FIREWALL-RULE",
  "ROLLBACK-02-STOP-NEW-CONTAINER",
  "ROLLBACK-08-REMOVE-BUILT-IMAGE",
  "ROLLBACK-06-REVOKE-ROLE-TOKENS",
  "ROLLBACK-09-DISABLE-VCP-CONFIG",
  "ROLLBACK-10-DISABLE-KIOSK-CONFIG",
  "ROLLBACK-11-DISABLE-DINGTALK-CONFIG",
  "ROLLBACK-04-PRESERVE-DATA-VOLUME"
]);

// Full authority contract per action ID. Human-readable and machine-relevant
// fields are frozen together so a production operation cannot be made to look
// safer, narrower, or easier to authorize without invalidating the packet.
const EXPECTED_ACTION_BINDINGS = new Map(Object.entries({
  "PROD-01-TARGET-READONLY-PREFLIGHT": {
    "id": "PROD-01-TARGET-READONLY-PREFLIGHT",
    "title": "Read-only target host preflight",
    "category": "TARGET",
    "risk": "LOW",
    "sideEffect": "READ_ONLY",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "UNRESOLVED_PRODUCTION_HOST_IDENTITY",
    "preconditions": [
      "TARGET_HOST_BINDING"
    ],
    "effects": [
      "Verify the bound candidate host identity and resolve disk/port/container/proxy/TLS deployment facts without mutation"
    ],
    "rollbackActionIds": [],
    "evidenceRequired": [
      "BOUND_HOST_IDENTITY_MATCH",
      "DISK_CAPACITY",
      "PORT_CONFLICTS",
      "CONTAINER_CONFLICTS",
      "REVERSE_PROXY_ROUTE_CONFLICTS",
      "TLS_BINDING_FACTS"
    ]
  },
  "PROD-02-CREATE-ISOLATED-APP-STORAGE": {
    "id": "PROD-02-CREATE-ISOLATED-APP-STORAGE",
    "title": "Create isolated application directory and persistent volume",
    "category": "FILESYSTEM",
    "risk": "MEDIUM",
    "sideEffect": "IRREVERSIBLE_OR_EXTERNAL",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Resolved production host; new isolated application directory and data volume only",
    "preconditions": [
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Create new isolated application storage without modifying existing application data; retain the created directory and volume on rollback"
    ],
    "rollbackActionIds": [
      "ROLLBACK-04-PRESERVE-DATA-VOLUME"
    ],
    "evidenceRequired": [
      "TARGET_PATH",
      "VOLUME_NAME",
      "OWNER_MODE",
      "FREE_SPACE",
      "RETAINED_STORAGE_ARTIFACT_ACKNOWLEDGED"
    ]
  },
  "PROD-03-GENERATE-INSTALL-TOKENS": {
    "id": "PROD-03-GENERATE-INSTALL-TOKENS",
    "title": "Generate and install four role tokens",
    "category": "SECRET",
    "risk": "HIGH",
    "sideEffect": "REVERSIBLE",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Resolved production host restricted runtime configuration for four role tokens",
    "preconditions": [
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Generate independent secret values and install them outside Git/logs/chat"
    ],
    "rollbackActionIds": [
      "ROLLBACK-06-REVOKE-ROLE-TOKENS"
    ],
    "evidenceRequired": [
      "SECRET_STORAGE_PATH",
      "FILE_OWNER_MODE",
      "NO_SECRET_OUTPUT_PROOF"
    ]
  },
  "PROD-04-BUILD-IMAGE": {
    "id": "PROD-04-BUILD-IMAGE",
    "title": "Build production image from approved authority source",
    "category": "BUILD",
    "risk": "MEDIUM",
    "sideEffect": "REVERSIBLE",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Resolved production host image store; exact approved authority commit only",
    "preconditions": [
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Create a new application image without replacing running services"
    ],
    "rollbackActionIds": [
      "ROLLBACK-08-REMOVE-BUILT-IMAGE"
    ],
    "evidenceRequired": [
      "AUTHORITY_COMMIT",
      "IMAGE_ID_OR_DIGEST",
      "NODE_BASE_DIGEST",
      "BUILD_LOG_LOW_DISCLOSURE"
    ]
  },
  "PROD-05-START-ISOLATED-CONTAINER": {
    "id": "PROD-05-START-ISOLATED-CONTAINER",
    "title": "Start isolated application container",
    "category": "RUNTIME",
    "risk": "HIGH",
    "sideEffect": "REVERSIBLE",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Resolved production host; one new loopback-only container and dedicated data volume",
    "preconditions": [
      "PRODUCTION_TARGET_FACTS",
      "CONTAINER_START_READINESS",
      "PRE_CUTOVER_ORPHAN_CLEANUP_CONTROL",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Start new service bound to host loopback only with every orphan-upload cleanup entry point disabled through cutover, including startup, periodic timer, saveUpload, and submitRequest-triggered cleanup"
    ],
    "rollbackActionIds": [
      "ROLLBACK-02-STOP-NEW-CONTAINER"
    ],
    "evidenceRequired": [
      "CONTAINER_NAME",
      "IMAGE_DIGEST",
      "LOOPBACK_BIND",
      "HEALTH_STATUS",
      "RUNTIME_UID",
      "STORAGE_TOKEN_IMAGE_PREDECESSOR_PROOF",
      "PRODUCTION_IMPORT_COMPLETION_PROOF",
      "STARTUP_ORPHAN_CLEANUP_DISABLED",
      "PERIODIC_ORPHAN_CLEANUP_DISABLED",
      "REQUEST_TRIGGERED_ORPHAN_CLEANUP_DISABLED",
      "ALL_ORPHAN_CLEANUP_ENTRY_POINTS_DISABLED_PROOF"
    ]
  },
  "PROD-06-LOOPBACK-HEALTH-SMOKE": {
    "id": "PROD-06-LOOPBACK-HEALTH-SMOKE",
    "title": "Run production-host loopback health smoke",
    "category": "RUNTIME",
    "risk": "LOW",
    "sideEffect": "READ_ONLY",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "New isolated container on resolved production host",
    "preconditions": [
      "PRODUCTION_TARGET_FACTS",
      "HEALTH_SMOKE_READINESS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Read health endpoint and verify local runtime facts only"
    ],
    "rollbackActionIds": [],
    "evidenceRequired": [
      "HEALTHZ_STATUS",
      "CONTAINER_UID",
      "DATABASE_PATH",
      "VOLUME_MOUNT",
      "CONTAINER_START_COMPLETION_PROOF"
    ]
  },
  "PROD-07-CONFIGURE-REVERSE-PROXY-TLS": {
    "id": "PROD-07-CONFIGURE-REVERSE-PROXY-TLS",
    "title": "Add isolated reverse-proxy route and HTTPS binding",
    "category": "NETWORK",
    "risk": "HIGH",
    "sideEffect": "REVERSIBLE",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Exact resolved reverse-proxy route and TLS binding only",
    "preconditions": [
      "PRODUCTION_TARGET_FACTS",
      "PROXY_BACKEND_READINESS",
      "PRE_CUTOVER_ROUTE_WRITE_RESTRICTION",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Expose the new loopback service only through a staging HTTPS route that blocks public unauthenticated writes; any pre-cutover write access is restricted to exact bounded staging principals"
    ],
    "rollbackActionIds": [
      "ROLLBACK-01-REMOVE-NEW-ROUTE"
    ],
    "evidenceRequired": [
      "ROUTE",
      "HOSTNAME",
      "TLS_BINDING",
      "CONFIG_TEST",
      "NO_EXISTING_ROUTE_OVERWRITE",
      "BACKEND_BUILD_START_HEALTH_PROOF",
      "STAGING_ROUTE_ACCESS_POLICY",
      "PUBLIC_WRITE_ENDPOINTS_BLOCKED",
      "BOUNDED_STAGING_PRINCIPAL_SCOPE",
      "PRE_CUTOVER_WRITE_DENIAL_PROBE",
      "STAGING_REQUEST_PATH_CLEANUP_DISABLED_PROOF"
    ]
  },
  "PROD-08-FIREWALL-SECURITY-GROUP": {
    "id": "PROD-08-FIREWALL-SECURITY-GROUP",
    "title": "Change firewall or security group only if required",
    "category": "NETWORK",
    "risk": "CRITICAL",
    "sideEffect": "REVERSIBLE",
    "status": "CONDITIONAL_NOT_REQUESTED",
    "authorityTarget": "Exact named firewall/security-group rule only",
    "preconditions": [
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Potentially change network reachability; no action unless necessity is separately proven"
    ],
    "rollbackActionIds": [
      "ROLLBACK-05-REVERT-FIREWALL-RULE"
    ],
    "evidenceRequired": [
      "NECESSITY_PROOF",
      "CURRENT_RULE",
      "PROPOSED_RULE",
      "IMPACT_RADIUS"
    ]
  },
  "PROD-09-PRODUCTION-DATA-IMPORT": {
    "id": "PROD-09-PRODUCTION-DATA-IMPORT",
    "title": "Import or migrate real production workbench data",
    "category": "DATA",
    "risk": "CRITICAL",
    "sideEffect": "IRREVERSIBLE_OR_EXTERNAL",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Exact approved production source database/upload set to a new isolated target",
    "preconditions": [
      "PRODUCTION_DATA_MIGRATION",
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_IMPORT_STORAGE_READINESS",
      "PRODUCTION_IMPORT_TARGET_ABSENCE",
      "PRODUCTION_IMPORT_SOURCE_CONSISTENCY",
      "PRODUCTION_ATTACHMENT_COPY_CAPABILITY",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Create migrated production facts in an isolated target only after separate real-input validation",
      "Copy every source upload byte referenced by a non-null stored_name into the isolated target upload volume and verify source/target attachment parity"
    ],
    "rollbackActionIds": [
      "ROLLBACK-04-PRESERVE-DATA-VOLUME"
    ],
    "evidenceRequired": [
      "SOURCE_IDENTITY",
      "BACKUP_PROOF",
      "ROLLBACK_PROOF",
      "TARGET_DIGEST",
      "PROOF_SEAL",
      "MAINTENANCE_WINDOW",
      "IMPORT_TARGET_SQLITE_ABSENCE_PROOF",
      "SOURCE_QUIESCENCE_OR_COORDINATION_PROOF",
      "STORAGE_PREPARATION_COMPLETION_PROOF",
      "SOURCE_UPLOAD_MANIFEST_DIGEST",
      "TARGET_UPLOAD_MANIFEST_DIGEST",
      "SOURCE_TARGET_UPLOAD_MANIFEST_MATCH",
      "ATTACHMENT_BYTE_COPY_COMPLETION_PROOF",
      "ATTACHMENT_RECORD_FILE_PARITY_PROOF"
    ]
  },
  "PROD-10-ENABLE-VCP-REMOTE-SYNC": {
    "id": "PROD-10-ENABLE-VCP-REMOTE-SYNC",
    "title": "Enable VCP remote synchronization",
    "category": "INTEGRATION",
    "risk": "HIGH",
    "sideEffect": "IRREVERSIBLE_OR_EXTERNAL",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Exact VCP runtime adapter configuration and one approved service endpoint",
    "preconditions": [
      "VCP_DEPLOYABLE_ADAPTER_WIRING",
      "PRODUCTION_TARGET_FACTS",
      "INTEGRATION_DEPLOYMENT_READINESS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Allow VCP to pull and guarded-push against the deployed service; guarded push may persist new revisioned task facts that configuration rollback does not remove"
    ],
    "rollbackActionIds": [
      "ROLLBACK-09-DISABLE-VCP-CONFIG"
    ],
    "evidenceRequired": [
      "VCP_RUNTIME_WIRING_PROOF",
      "VCP_ADAPTER_REVISION",
      "SERVICE_ENDPOINT",
      "PRINCIPAL_SCOPE",
      "PULL_PUSH_VERIFY_RESULT",
      "DEPLOYMENT_CHAIN_COMPLETION_PROOF"
    ]
  },
  "PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE": {
    "id": "PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE",
    "title": "Enable real Kiosk device and identity mapping",
    "category": "INTEGRATION",
    "risk": "HIGH",
    "sideEffect": "IRREVERSIBLE_OR_EXTERNAL",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Exact approved Kiosk device/browser and trusted identity mapping",
    "preconditions": [
      "KIOSK_DEPLOYABLE_AUTH_WIRING",
      "PRODUCTION_TARGET_FACTS",
      "INTEGRATION_DEPLOYMENT_READINESS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Allow real device to read and submit authorized run events; accepted or review-required submissions may persist production runs, reviews, receipts, and audit facts that configuration rollback does not remove"
    ],
    "rollbackActionIds": [
      "ROLLBACK-10-DISABLE-KIOSK-CONFIG"
    ],
    "evidenceRequired": [
      "KIOSK_AUTH_RUNTIME_WIRING_PROOF",
      "DEVICE_IDENTITY",
      "RESOURCE_SCOPE",
      "REAL_DEVICE_ACCEPTANCE",
      "OFFLINE_REPLAY_RESULT",
      "DEPLOYMENT_CHAIN_COMPLETION_PROOF"
    ]
  },
  "PROD-12-DINGTALK-PROVIDER-INTEGRATION": {
    "id": "PROD-12-DINGTALK-PROVIDER-INTEGRATION",
    "title": "Configure and validate DingTalk provider integration",
    "category": "INTEGRATION",
    "risk": "HIGH",
    "sideEffect": "IRREVERSIBLE_OR_EXTERNAL",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "UNRESOLVED_DINGTALK_TARGET_BINDING",
    "preconditions": [
      "WO06C_DINGTALK_PROVIDER",
      "DINGTALK_TARGET_BINDING",
      "DINGTALK_DEPLOYABLE_ADAPTER_WIRING"
    ],
    "effects": [
      "May perform real provider authentication and bounded integration traffic only after explicit authorization"
    ],
    "rollbackActionIds": [
      "ROLLBACK-11-DISABLE-DINGTALK-CONFIG"
    ],
    "evidenceRequired": [
      "DINGTALK_RUNTIME_WIRING_PROOF",
      "PROVIDER_CONFIG_SCOPE",
      "TEST_DESTINATION",
      "SEND_RESULT",
      "CALLBACK_POLICY",
      "SECRET_STORAGE_PROOF"
    ]
  },
  "PROD-13-CUTOVER-SWITCH": {
    "id": "PROD-13-CUTOVER-SWITCH",
    "title": "Perform production cutover or Switch",
    "category": "CUTOVER",
    "risk": "CRITICAL",
    "sideEffect": "IRREVERSIBLE_OR_EXTERNAL",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Exact approved production route/data/client switch only",
    "preconditions": [
      "WO06C_VCP_EXTERNAL",
      "WO06C_KIOSK_DEVICE",
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_DATA_MIGRATION",
      "CUTOVER_SOURCE_CONSISTENCY",
      "CUTOVER_LIVE_SERVICE_READINESS",
      "CUTOVER_FORWARD_CHAIN",
      "CUTOVER_SWITCH_RECOVERY",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Change which production endpoint/data/client path is authoritative",
      "Promote the staging route to general production authority only as part of the exact approved cutover after revalidating the pre-cutover write restriction"
    ],
    "rollbackActionIds": [
      "ROLLBACK-07-RESTORE-PREVIOUS-AUTHORITY-SWITCH",
      "ROLLBACK-01-REMOVE-NEW-ROUTE",
      "ROLLBACK-05-REVERT-FIREWALL-RULE",
      "ROLLBACK-02-STOP-NEW-CONTAINER",
      "ROLLBACK-08-REMOVE-BUILT-IMAGE",
      "ROLLBACK-06-REVOKE-ROLE-TOKENS",
      "ROLLBACK-09-DISABLE-VCP-CONFIG",
      "ROLLBACK-10-DISABLE-KIOSK-CONFIG",
      "ROLLBACK-04-PRESERVE-DATA-VOLUME"
    ],
    "evidenceRequired": [
      "CUTOVER_PLAN",
      "FORWARD_CHAIN_COMPLETION_PROOF",
      "VCP_KIOSK_ENABLEMENT_COMPLETION_PROOF",
      "SWITCH_RECORD",
      "DUAL_READ_COMPATIBLE_WRITE_RECOVERY_PROOF",
      "POST_SWITCH_RECOVERY_DESIGN",
      "PRE_CUTOVER_BACKUP",
      "CLIENT_SWITCH_LIST",
      "ROLLBACK_TRIGGER",
      "POST_CUTOVER_VERIFICATION",
      "PRE_CUTOVER_ROUTE_RESTRICTION_PROOF",
      "PRE_SWITCH_SOURCE_TARGET_PARITY_PROOF",
      "PRE_SWITCH_ATTACHMENT_PARITY_PROOF",
      "PRE_SWITCH_HEALTH_STATUS",
      "PRE_SWITCH_ROUTED_TLS_STATUS",
      "PRE_SWITCH_ORPHAN_CLEANUP_GUARD_PROOF",
      "POST_CUTOVER_CLEANUP_RESTORATION_PLAN"
    ]
  },
  "PROD-14-RESTORE-ORPHAN-CLEANUP": {
    "id": "PROD-14-RESTORE-ORPHAN-CLEANUP",
    "title": "Restore normal orphan-upload cleanup after cutover",
    "category": "RUNTIME",
    "risk": "HIGH",
    "sideEffect": "IRREVERSIBLE_OR_EXTERNAL",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Exact orphan-upload cleanup controls of the newly authoritative production service only",
    "preconditions": [
      "POST_CUTOVER_ORPHAN_CLEANUP_RESTORATION"
    ],
    "effects": [
      "Restore startup, periodic, saveUpload-triggered, and submitRequest-triggered orphan cleanup only after cutover completion and post-cutover attachment parity are verified"
    ],
    "rollbackActionIds": [],
    "evidenceRequired": [
      "CUTOVER_COMPLETION_PROOF",
      "POST_CUTOVER_ATTACHMENT_PARITY_PROOF",
      "STARTUP_ORPHAN_CLEANUP_RESTORED",
      "PERIODIC_ORPHAN_CLEANUP_RESTORED",
      "REQUEST_TRIGGERED_ORPHAN_CLEANUP_RESTORED",
      "POST_RESTORE_HEALTH_STATUS"
    ]
  },
  "ROLLBACK-01-REMOVE-NEW-ROUTE": {
    "id": "ROLLBACK-01-REMOVE-NEW-ROUTE",
    "title": "Remove newly added reverse-proxy route",
    "category": "ROLLBACK",
    "risk": "HIGH",
    "sideEffect": "REVERSIBLE",
    "status": "ROLLBACK_ONLY",
    "authorityTarget": "Only the newly added route from this deployment",
    "preconditions": [],
    "effects": [
      "Remove exposure of the new service without modifying old routes"
    ],
    "rollbackActionIds": [],
    "evidenceRequired": [
      "ROUTE_REMOVED",
      "OLD_ROUTES_UNCHANGED"
    ]
  },
  "ROLLBACK-02-STOP-NEW-CONTAINER": {
    "id": "ROLLBACK-02-STOP-NEW-CONTAINER",
    "title": "Stop and remove newly started application container",
    "category": "ROLLBACK",
    "risk": "MEDIUM",
    "sideEffect": "REVERSIBLE",
    "status": "ROLLBACK_ONLY",
    "authorityTarget": "Only the newly started container object from this deployment; named data volume is excluded from deletion",
    "preconditions": [],
    "effects": [
      "Stop and remove only the new container object so it releases its image reference; preserve the named data volume"
    ],
    "rollbackActionIds": [],
    "evidenceRequired": [
      "CONTAINER_STOPPED",
      "CONTAINER_REMOVED",
      "IMAGE_REFERENCE_RELEASED",
      "DATA_VOLUME_PRESERVED"
    ]
  },
  "ROLLBACK-09-DISABLE-VCP-CONFIG": {
    "id": "ROLLBACK-09-DISABLE-VCP-CONFIG",
    "title": "Disable VCP configuration introduced by PROD-10",
    "category": "ROLLBACK",
    "risk": "HIGH",
    "sideEffect": "REVERSIBLE",
    "status": "ROLLBACK_ONLY",
    "authorityTarget": "Only the VCP runtime adapter configuration and service endpoint binding introduced by PROD-10",
    "preconditions": [],
    "effects": [
      "Disable only the VCP integration configuration introduced by PROD-10 without affecting Kiosk or DingTalk"
    ],
    "rollbackActionIds": [],
    "evidenceRequired": [
      "VCP_INTEGRATION_DISABLED",
      "KIOSK_DINGTALK_UNCHANGED",
      "SECRET_VALUES_NOT_LOGGED"
    ]
  },
  "ROLLBACK-10-DISABLE-KIOSK-CONFIG": {
    "id": "ROLLBACK-10-DISABLE-KIOSK-CONFIG",
    "title": "Disable Kiosk configuration introduced by PROD-11",
    "category": "ROLLBACK",
    "risk": "HIGH",
    "sideEffect": "REVERSIBLE",
    "status": "ROLLBACK_ONLY",
    "authorityTarget": "Only the Kiosk device and trusted identity mapping introduced by PROD-11",
    "preconditions": [],
    "effects": [
      "Disable only the Kiosk integration configuration introduced by PROD-11 without affecting VCP or DingTalk"
    ],
    "rollbackActionIds": [],
    "evidenceRequired": [
      "KIOSK_INTEGRATION_DISABLED",
      "VCP_DINGTALK_UNCHANGED"
    ]
  },
  "ROLLBACK-11-DISABLE-DINGTALK-CONFIG": {
    "id": "ROLLBACK-11-DISABLE-DINGTALK-CONFIG",
    "title": "Disable DingTalk configuration introduced by PROD-12",
    "category": "ROLLBACK",
    "risk": "HIGH",
    "sideEffect": "REVERSIBLE",
    "status": "ROLLBACK_ONLY",
    "authorityTarget": "Only the DingTalk provider configuration introduced by PROD-12",
    "preconditions": [],
    "effects": [
      "Disable only the DingTalk integration configuration introduced by PROD-12 without affecting VCP or Kiosk"
    ],
    "rollbackActionIds": [],
    "evidenceRequired": [
      "DINGTALK_INTEGRATION_DISABLED",
      "VCP_KIOSK_UNCHANGED",
      "SECRET_VALUES_NOT_LOGGED"
    ]
  },
  "ROLLBACK-04-PRESERVE-DATA-VOLUME": {
    "id": "ROLLBACK-04-PRESERVE-DATA-VOLUME",
    "title": "Preserve new data volume and stop mutation",
    "category": "ROLLBACK",
    "risk": "LOW",
    "sideEffect": "READ_ONLY",
    "status": "ROLLBACK_ONLY",
    "authorityTarget": "New deployment data volume only",
    "preconditions": [],
    "effects": [
      "Preserve evidence/data; do not delete or overwrite the volume"
    ],
    "rollbackActionIds": [],
    "evidenceRequired": [
      "VOLUME_PRESERVED",
      "MUTATION_STOPPED"
    ]
  },
  "ROLLBACK-05-REVERT-FIREWALL-RULE": {
    "id": "ROLLBACK-05-REVERT-FIREWALL-RULE",
    "title": "Revert only the newly changed firewall/security-group rule",
    "category": "ROLLBACK",
    "risk": "CRITICAL",
    "sideEffect": "REVERSIBLE",
    "status": "ROLLBACK_ONLY",
    "authorityTarget": "Exact firewall/security-group rule changed by PROD-08 only",
    "preconditions": [],
    "effects": [
      "Restore the previous rule exactly"
    ],
    "rollbackActionIds": [],
    "evidenceRequired": [
      "PREVIOUS_RULE_RESTORED"
    ]
  },
  "ROLLBACK-06-REVOKE-ROLE-TOKENS": {
    "id": "ROLLBACK-06-REVOKE-ROLE-TOKENS",
    "title": "Revoke and remove generated role-token configuration",
    "category": "ROLLBACK",
    "risk": "HIGH",
    "sideEffect": "REVERSIBLE",
    "status": "ROLLBACK_ONLY",
    "authorityTarget": "Only the four role tokens and server-restricted runtime bindings created by PROD-03",
    "preconditions": [],
    "effects": [
      "Remove the generated role-token bindings from server-restricted runtime configuration without exposing token values"
    ],
    "rollbackActionIds": [],
    "evidenceRequired": [
      "ROLE_TOKEN_BINDINGS_REMOVED",
      "SECRET_VALUES_NOT_LOGGED"
    ]
  },
  "ROLLBACK-07-RESTORE-PREVIOUS-AUTHORITY-SWITCH": {
    "id": "ROLLBACK-07-RESTORE-PREVIOUS-AUTHORITY-SWITCH",
    "title": "Restore previous authoritative endpoint, data path, and client mappings",
    "category": "ROLLBACK",
    "risk": "CRITICAL",
    "sideEffect": "IRREVERSIBLE_OR_EXTERNAL",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "UNRESOLVED_POST_SWITCH_AUTHORITY_RECOVERY_CAPABILITY",
    "preconditions": [
      "CUTOVER_SWITCH_RECOVERY"
    ],
    "effects": [
      "Restore the previously authoritative endpoint, data path, and client mappings using a separately designed compatible recovery path and recorded switch state"
    ],
    "rollbackActionIds": [],
    "evidenceRequired": [
      "DUAL_READ_COMPATIBLE_WRITE_RECOVERY_PROOF",
      "SWITCH_RECORD",
      "PREVIOUS_AUTHORITY_RESTORED"
    ]
  },
  "ROLLBACK-08-REMOVE-BUILT-IMAGE": {
    "id": "ROLLBACK-08-REMOVE-BUILT-IMAGE",
    "title": "Remove image built by PROD-04",
    "category": "ROLLBACK",
    "risk": "MEDIUM",
    "sideEffect": "REVERSIBLE",
    "status": "ROLLBACK_ONLY",
    "authorityTarget": "Only the exact image digest created by PROD-04 on the resolved production host",
    "preconditions": [],
    "effects": [
      "Remove only the PROD-04 image after proving no running container references that digest"
    ],
    "rollbackActionIds": [],
    "evidenceRequired": [
      "IMAGE_DIGEST_MATCH",
      "CONTAINER_REFERENCE_ABSENT",
      "IMAGE_NOT_IN_USE",
      "IMAGE_REMOVED"
    ]
  }
}));

const FORBIDDEN_SECRET_PATTERNS = Object.freeze([
  // Deliberately count UTF-16 code units, as createAuthorizer does via string.length.
  /Bearer\s+[^\r\n]{16,}/i,
  /sk-[A-Za-z0-9_-]{16,}/u,
  /replace-with-random-/iu,
]);

const ROLE_TOKEN_ASSIGNMENT = /(?:"(?:access_token|VIEWER_TOKEN|SUBMITTER_TOKEN|SCHEDULER_TOKEN|ADMIN_TOKEN)"|'(?:access_token|VIEWER_TOKEN|SUBMITTER_TOKEN|SCHEDULER_TOKEN|ADMIN_TOKEN)'|(?:access_token|VIEWER_TOKEN|SUBMITTER_TOKEN|SCHEDULER_TOKEN|ADMIN_TOKEN))\s*([:=])\s*/giu;

// for...of yields code points; char.length preserves the authorizer's UTF-16 units
// in ordinary, quoted, and escaped segments without counting shell quote syntax.
function shellAssignmentValueLength(text) {
  let length = 0;
  let quote = null;
  let escaped = false;
  for (const char of text) {
    if (escaped) {
      escaped = false;
      // Backslash-newline is removed before shell word parsing, not a word end.
      if (char === '\n') continue;
      // Inside double quotes, other backslashes remain part of the value.
      if (quote === '"' && !['$', '`', '"', '\\'].includes(char)) length += 1;
      length += char.length;
      continue;
    }
    if (quote === null && (char === '\r' || char === '\n')) break;
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      else length += char.length;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) break;
    length += char.length;
  }
  return length;
}

function configAssignmentValueLength(text) {
  const line = text.split(/\r?\n/u, 1)[0].trim();
  let length = 0;
  let quote = null;
  let escaped = false;
  for (const char of line) {
    if (escaped) {
      length += char.length;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      else length += char.length;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    length += char.length;
  }
  return length;
}

function containsRoleTokenAssignmentSecret(text) {
  for (const match of text.matchAll(ROLE_TOKEN_ASSIGNMENT)) {
    const start = (match.index ?? 0) + match[0].length;
    const remainder = text.slice(start);
    const length = match[1] === '='
      ? shellAssignmentValueLength(remainder)
      : configAssignmentValueLength(remainder);
    if (length >= 16) return true;
  }
  return false;
}

function containsForbiddenSecretMaterial(value) {
  if (typeof value === 'string') {
    return containsRoleTokenAssignmentSecret(value)
      || FORBIDDEN_SECRET_PATTERNS.some(pattern => pattern.test(value));
  }
  if (Array.isArray(value)) return value.some(containsForbiddenSecretMaterial);
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsForbiddenSecretMaterial);
  }
  return false;
}

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
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.every((value, index) => value === right[index]);
}

function sameArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function issue(code, path) {
  return Object.freeze({ code, path });
}

export function deriveCoauthorizedRollbackActionIds(actions, approvedActionIds) {
  const actionMap = new Map((actions ?? []).map(action => [action.id, action]));
  const derived = new Set();
  for (const actionId of approvedActionIds ?? []) {
    const action = actionMap.get(actionId);
    if (!action || action.status === 'ROLLBACK_ONLY') continue;
    for (const rollbackId of action.rollbackActionIds ?? []) {
      if (actionMap.get(rollbackId)?.status === 'ROLLBACK_ONLY') derived.add(rollbackId);
    }
  }
  return Object.freeze([...derived].sort());
}

export function createProductionChangeManifestValidator(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true, ownProperties: true });
  const validateSchema = ajv.compile(schema);

  return function validateProductionChangeManifest(value) {
    const issues = [];

    if (!validateSchema(value)) {
      for (const error of validateSchema.errors ?? []) {
        issues.push(issue('SCHEMA_INVALID', error.instancePath || '/'));
      }
      return Object.freeze({ ok: false, issues: Object.freeze(issues) });
    }

    if (value.authorityBase !== EXPECTED_AUTHORITY_BASE) {
      issues.push(issue('AUTHORITY_BASE_INVALID', '/authorityBase'));
    }

    if (!sameSet(value.secrets.map(entry => entry.id), EXPECTED_SECRET_IDS)) {
      issues.push(issue('SECRET_SET_INVALID', '/secrets'));
    }

    if (!sameSet(value.target.unresolvedFacts, EXPECTED_TARGET_UNRESOLVED_FACTS)) {
      issues.push(issue('TARGET_UNRESOLVED_FACTS_INVALID', '/target/unresolvedFacts'));
    }

    if (!sameSet(value.invariants, EXPECTED_INVARIANTS)) {
      issues.push(issue('INVARIANT_SET_INVALID', '/invariants'));
    }

    const gateMap = new Map(value.gates.map(gate => [gate.id, gate]));
    if (gateMap.size !== value.gates.length) {
      issues.push(issue('DUPLICATE_GATE_ID', '/gates'));
    }
    if (!sameSet([...gateMap.keys()], [...EXPECTED_GATE_BINDINGS.keys()])) {
      issues.push(issue('GATE_SET_INVALID', '/gates'));
    }
    for (const [id, expected] of EXPECTED_GATE_BINDINGS) {
      const gate = gateMap.get(id);
      if (gate?.status !== expected.status) {
        issues.push(issue('GATE_STATUS_INVALID', '/gates/' + id + '/status'));
      }
      if (gate?.evidence !== expected.evidence) {
        issues.push(issue('GATE_EVIDENCE_INVALID', '/gates/' + id + '/evidence'));
      }
    }

    const actionMap = new Map(value.actions.map(action => [action.id, action]));
    if (actionMap.size !== value.actions.length) {
      issues.push(issue('DUPLICATE_ACTION_ID', '/actions'));
    }
    if (!sameSet([...actionMap.keys()], [...EXPECTED_ACTION_BINDINGS.keys()])) {
      issues.push(issue('ACTION_SET_INVALID', '/actions'));
    }

    for (const [actionId, expected] of EXPECTED_ACTION_BINDINGS) {
      const action = actionMap.get(actionId);
      if (!action) {
        issues.push(issue('ACTION_BINDING_MISSING', '/actions/' + actionId));
        continue;
      }

      for (const [field, code] of [
        ['title', 'ACTION_TITLE_INVALID'],
        ['category', 'ACTION_CATEGORY_INVALID'],
        ['risk', 'ACTION_RISK_INVALID'],
        ['sideEffect', 'ACTION_SIDE_EFFECT_INVALID'],
        ['status', 'ACTION_STATUS_INVALID'],
        ['authorityTarget', 'AUTHORITY_TARGET_INVALID'],
      ]) {
        if (action[field] !== expected[field]) {
          issues.push(issue(code, '/actions/' + actionId + '/' + field));
        }
      }

      for (const [field, code] of [
        ['preconditions', 'ACTION_PRECONDITIONS_INVALID'],
        ['effects', 'ACTION_EFFECTS_INVALID'],
        ['rollbackActionIds', 'ROLLBACK_BINDING_INVALID'],
        ['evidenceRequired', 'ACTION_EVIDENCE_REQUIRED_INVALID'],
      ]) {
        if (!sameSet(action[field], expected[field])) {
          issues.push(issue(code, '/actions/' + actionId + '/' + field));
        }
      }

      const expectedExplicitAuthorization = action.category !== 'ROLLBACK';
      if (action.requiresExplicitAuthorization !== expectedExplicitAuthorization) {
        issues.push(issue(
          'ACTION_AUTHORIZATION_MODE_INVALID',
          '/actions/' + actionId + '/requiresExplicitAuthorization',
        ));
      }

      for (const rollbackId of action.rollbackActionIds) {
        if (actionMap.get(rollbackId)?.category !== 'ROLLBACK') {
          issues.push(issue('ROLLBACK_REFERENCE_INVALID', '/actions/' + actionId + '/rollbackActionIds'));
        }
      }
    }

    if (value.authorizationPacket.rollbackAuthorizationModel
        !== 'BOUND_ROLLBACK_IDS_COAUTHORIZED_WITH_FORWARD_ACTION') {
      issues.push(issue(
        'ROLLBACK_AUTHORIZATION_MODEL_INVALID',
        '/authorizationPacket/rollbackAuthorizationModel',
      ));
    }
    if (value.authorizationPacket.separateRollbackApprovalRequired !== false) {
      issues.push(issue(
        'SEPARATE_ROLLBACK_APPROVAL_INVALID',
        '/authorizationPacket/separateRollbackApprovalRequired',
      ));
    }
    const derivedRollbackActionIds = deriveCoauthorizedRollbackActionIds(
      value.actions,
      value.authorizationPacket.approvedActionIds,
    );
    if (!sameSet(
      value.authorizationPacket.derivedRollbackActionIds,
      derivedRollbackActionIds,
    )) {
      issues.push(issue(
        'DERIVED_ROLLBACK_AUTHORITY_INVALID',
        '/authorizationPacket/derivedRollbackActionIds',
      ));
    }

    if (!sameSet(value.authorizationPacket.requestableActionIds, EXPECTED_REQUESTABLE)) {
      issues.push(issue('REQUESTABLE_ACTION_SET_INVALID', '/authorizationPacket/requestableActionIds'));
    }

    const actionsWithRequestableStatus = value.actions
      .filter(action => action.status === 'REQUESTABLE_EXPLICIT_AUTHORIZATION')
      .map(action => action.id);
    if (!sameSet(actionsWithRequestableStatus, EXPECTED_REQUESTABLE)) {
      issues.push(issue('REQUESTABLE_STATUS_SET_INVALID', '/actions'));
    }

    const allBlockedGateIds = value.gates
      .filter(gate => gate.status === 'BLOCKED')
      .map(gate => gate.id);
    if (!sameSet(value.authorizationPacket.blockingGateIds, allBlockedGateIds)) {
      issues.push(issue('AUTHORIZATION_BLOCKER_SET_INVALID', '/authorizationPacket/blockingGateIds'));
    }
    if (!sameSet(
      value.authorizationPacket.deploymentBlockingGateIds,
      EXPECTED_DEPLOYMENT_BLOCKERS,
    )) {
      issues.push(issue(
        'DEPLOYMENT_BLOCKER_SET_INVALID',
        '/authorizationPacket/deploymentBlockingGateIds',
      ));
    }

    if (!sameSet(
      value.authorizationPacket.mustRevalidateBeforeRequest,
      EXPECTED_REVALIDATION_CHECKLIST,
    )) {
      issues.push(issue(
        'REVALIDATION_CHECKLIST_INVALID',
        '/authorizationPacket/mustRevalidateBeforeRequest',
      ));
    }

    const actionRevalidation = value.authorizationPacket.actionSpecificRevalidation;
    if (!sameSet(
      Object.keys(actionRevalidation),
      Object.keys(EXPECTED_ACTION_REVALIDATION),
    )) {
      issues.push(issue(
        'ACTION_REVALIDATION_SET_INVALID',
        '/authorizationPacket/actionSpecificRevalidation',
      ));
    }
    for (const [actionId, expectedChecks] of Object.entries(EXPECTED_ACTION_REVALIDATION)) {
      if (!sameSet(actionRevalidation[actionId], expectedChecks)) {
        issues.push(issue(
          'ACTION_REVALIDATION_INVALID',
          '/authorizationPacket/actionSpecificRevalidation/' + actionId,
        ));
      }
    }

    if (value.authorizationPacket.requestedActionIds.length !== 0
        || value.authorizationPacket.approvedActionIds.length !== 0) {
      issues.push(issue('AUTHORIZATION_MUST_BE_EMPTY', '/authorizationPacket'));
    }

    for (const actionId of value.authorizationPacket.requestableActionIds) {
      if (actionMap.get(actionId)?.status !== 'REQUESTABLE_EXPLICIT_AUTHORIZATION') {
        issues.push(issue('REQUESTABLE_ACTION_STATUS_INVALID', '/authorizationPacket/requestableActionIds'));
      }
    }

    if (!sameArray(value.rollbackPlan.orderedActionIds, EXPECTED_ROLLBACK_ORDER)) {
      issues.push(issue('ROLLBACK_PLAN_ORDER_INVALID', '/rollbackPlan/orderedActionIds'));
    }
    for (const actionId of value.rollbackPlan.orderedActionIds) {
      if (actionMap.get(actionId)?.status !== 'ROLLBACK_ONLY') {
        issues.push(issue('ROLLBACK_PLAN_INVALID', '/rollbackPlan/orderedActionIds'));
      }
    }

    if (containsForbiddenSecretMaterial(value)) {
      issues.push(issue('SECRET_MATERIAL_DETECTED', '/'));
    }

    const text = stableJson(value);
    const digest = 'sha256:' + createHash('sha256').update(text).digest('hex');
    return Object.freeze({
      ok: issues.length === 0,
      digest,
      issues: Object.freeze(issues),
    });
  };
}
