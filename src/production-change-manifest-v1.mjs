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
  "WO06C_KIOSK_DEVICE": {
    "status": "BLOCKED",
    "evidence": "BLOCKED_DEVICE"
  },
  "WO06C_DINGTALK_PROVIDER": {
    "status": "READY_FOR_AUTHORIZATION",
    "evidence": "READY_FOR_EXTERNAL_INTEGRATION_AUTHORIZATION"
  },
  "DINGTALK_TARGET_BINDING": {
    "status": "BLOCKED",
    "evidence": "EXACT_APP_PROVIDER_AND_TEST_DESTINATION_UNRESOLVED"
  },
  "CUTOVER_FORWARD_CHAIN": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_VERIFIED_PROD_02_03_04_05_06_07_09_10_11_AND_PROD_08_IF_USED"
  },
  "CUTOVER_SWITCH_RECOVERY": {
    "status": "BLOCKED",
    "evidence": "POST_SWITCH_DUAL_READ_COMPATIBLE_WRITE_AND_SWITCH_RECORD_NOT_DESIGNED"
  },
  "TARGET_HOST_BINDING": {
    "status": "BLOCKED",
    "evidence": "EXACT_CANDIDATE_PRODUCTION_HOST_UNRESOLVED"
  },
  "CONTAINER_START_READINESS": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_VERIFIED_PROD_02_03_04"
  },
  "HEALTH_SMOKE_READINESS": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_VERIFIED_PROD_05"
  },
  "PROXY_BACKEND_READINESS": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_VERIFIED_PROD_04_05_06"
  },
  "PRODUCTION_IMPORT_STORAGE_READINESS": {
    "status": "BLOCKED",
    "evidence": "REQUIRES_VERIFIED_PROD_02"
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
  "PRODUCTION_DEPLOYMENT_GATE": {
    "status": "BLOCKED",
    "evidence": "BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE"
  }
}));

const EXPECTED_REQUESTABLE = Object.freeze([]);

const EXPECTED_DEPLOYMENT_BLOCKERS = Object.freeze([
  "WO06C_VCP_EXTERNAL",
  "WO06C_KIOSK_DEVICE",
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
    "ROLLBACK_TARGETS"
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
    "ROLLBACK_TARGETS"
  ]),
  "PROD-10-ENABLE-VCP-REMOTE-SYNC": Object.freeze([
    "TARGET_HOST_IDENTITY",
    "DISK_PORT_ROUTE_CONFLICTS",
    "BUILT_IMAGE_DIGEST",
    "SECRET_STORAGE",
    "EXTERNAL_READINESS_GATES",
    "ROLLBACK_TARGETS"
  ]),
  "PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE": Object.freeze([
    "TARGET_HOST_IDENTITY",
    "DISK_PORT_ROUTE_CONFLICTS",
    "BUILT_IMAGE_DIGEST",
    "SECRET_STORAGE",
    "EXTERNAL_READINESS_GATES",
    "ROLLBACK_TARGETS"
  ]),
  "PROD-12-DINGTALK-PROVIDER-INTEGRATION": Object.freeze([
    "SECRET_STORAGE",
    "EXTERNAL_READINESS_GATES",
    "ROLLBACK_TARGETS"
  ]),
  "PROD-13-CUTOVER-SWITCH": Object.freeze([
    "TARGET_HOST_IDENTITY",
    "DISK_PORT_ROUTE_CONFLICTS",
    "BUILT_IMAGE_DIGEST",
    "BACKUP_ROLLBACK_PROOF",
    "EXTERNAL_READINESS_GATES",
    "ROLLBACK_TARGETS"
  ])
});
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
  "INITIAL_TARGET_PREFLIGHT_HAS_NO_LATER_STAGE_REVALIDATION"
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
    "title": "Start isolated application container",
    "category": "RUNTIME",
    "risk": "HIGH",
    "sideEffect": "REVERSIBLE",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Resolved production host; one new loopback-only container and dedicated data volume",
    "preconditions": [
      "PRODUCTION_TARGET_FACTS",
      "CONTAINER_START_READINESS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Start new service bound to host loopback only"
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
      "STORAGE_TOKEN_IMAGE_PREDECESSOR_PROOF"
    ]
  },
  "PROD-06-LOOPBACK-HEALTH-SMOKE": {
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
    "title": "Add isolated reverse-proxy route and HTTPS binding",
    "category": "NETWORK",
    "risk": "HIGH",
    "sideEffect": "REVERSIBLE",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Exact resolved reverse-proxy route and TLS binding only",
    "preconditions": [
      "PRODUCTION_TARGET_FACTS",
      "PROXY_BACKEND_READINESS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Expose the new loopback service through one approved HTTPS route"
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
      "BACKEND_BUILD_START_HEALTH_PROOF"
    ]
  },
  "PROD-08-FIREWALL-SECURITY-GROUP": {
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
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Create migrated production facts in an isolated target only after separate real-input validation"
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
      "STORAGE_PREPARATION_COMPLETION_PROOF"
    ]
  },
  "PROD-10-ENABLE-VCP-REMOTE-SYNC": {
    "title": "Enable VCP remote synchronization",
    "category": "INTEGRATION",
    "risk": "HIGH",
    "sideEffect": "REVERSIBLE",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Exact VCP runtime adapter configuration and one approved service endpoint",
    "preconditions": [
      "WO06C_VCP_EXTERNAL",
      "PRODUCTION_TARGET_FACTS",
      "INTEGRATION_DEPLOYMENT_READINESS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Allow VCP to pull and guarded-push against the deployed service"
    ],
    "rollbackActionIds": [
      "ROLLBACK-09-DISABLE-VCP-CONFIG"
    ],
    "evidenceRequired": [
      "VCP_ADAPTER_REVISION",
      "SERVICE_ENDPOINT",
      "PRINCIPAL_SCOPE",
      "PULL_PUSH_VERIFY_RESULT",
      "DEPLOYMENT_CHAIN_COMPLETION_PROOF"
    ]
  },
  "PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE": {
    "title": "Enable real Kiosk device and identity mapping",
    "category": "INTEGRATION",
    "risk": "HIGH",
    "sideEffect": "REVERSIBLE",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Exact approved Kiosk device/browser and trusted identity mapping",
    "preconditions": [
      "WO06C_KIOSK_DEVICE",
      "PRODUCTION_TARGET_FACTS",
      "INTEGRATION_DEPLOYMENT_READINESS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Allow real device to read and submit authorized run events"
    ],
    "rollbackActionIds": [
      "ROLLBACK-10-DISABLE-KIOSK-CONFIG"
    ],
    "evidenceRequired": [
      "DEVICE_IDENTITY",
      "RESOURCE_SCOPE",
      "REAL_DEVICE_ACCEPTANCE",
      "OFFLINE_REPLAY_RESULT",
      "DEPLOYMENT_CHAIN_COMPLETION_PROOF"
    ]
  },
  "PROD-12-DINGTALK-PROVIDER-INTEGRATION": {
    "title": "Configure and validate DingTalk provider integration",
    "category": "INTEGRATION",
    "risk": "HIGH",
    "sideEffect": "IRREVERSIBLE_OR_EXTERNAL",
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "UNRESOLVED_DINGTALK_TARGET_BINDING",
    "preconditions": [
      "WO06C_DINGTALK_PROVIDER",
      "DINGTALK_TARGET_BINDING"
    ],
    "effects": [
      "May perform real provider authentication and bounded integration traffic only after explicit authorization"
    ],
    "rollbackActionIds": [
      "ROLLBACK-11-DISABLE-DINGTALK-CONFIG"
    ],
    "evidenceRequired": [
      "PROVIDER_CONFIG_SCOPE",
      "TEST_DESTINATION",
      "SEND_RESULT",
      "CALLBACK_POLICY",
      "SECRET_STORAGE_PROOF"
    ]
  },
  "PROD-13-CUTOVER-SWITCH": {
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
      "CUTOVER_FORWARD_CHAIN",
      "CUTOVER_SWITCH_RECOVERY",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "effects": [
      "Change which production endpoint/data/client path is authoritative"
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
      "POST_SWITCH_RECOVERY_DESIGN",
      "DUAL_READ_COMPATIBLE_WRITE_RECOVERY_PROOF",
      "SWITCH_RECORD",
      "PRE_CUTOVER_BACKUP",
      "CLIENT_SWITCH_LIST",
      "ROLLBACK_TRIGGER",
      "POST_CUTOVER_VERIFICATION"
    ]
  },
  "ROLLBACK-01-REMOVE-NEW-ROUTE": {
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
    "title": "Stop newly started application container",
    "category": "ROLLBACK",
    "risk": "MEDIUM",
    "sideEffect": "REVERSIBLE",
    "status": "ROLLBACK_ONLY",
    "authorityTarget": "Only the newly started container from this deployment",
    "preconditions": [],
    "effects": [
      "Stop new runtime; preserve data volume"
    ],
    "rollbackActionIds": [],
    "evidenceRequired": [
      "CONTAINER_STOPPED",
      "DATA_VOLUME_PRESERVED"
    ]
  },
  "ROLLBACK-09-DISABLE-VCP-CONFIG": {
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
      "IMAGE_NOT_IN_USE",
      "IMAGE_REMOVED"
    ]
  }
}));

const FORBIDDEN_SECRET_PATTERNS = Object.freeze([
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/iu,
  /access_token\s*=\s*[^\s"',;]{8,}/iu,
  /sk-[A-Za-z0-9_-]{16,}/u,
  /replace-with-random-/iu,
]);

function containsForbiddenSecretMaterial(value) {
  if (typeof value === 'string') {
    return FORBIDDEN_SECRET_PATTERNS.some(pattern => pattern.test(value));
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
