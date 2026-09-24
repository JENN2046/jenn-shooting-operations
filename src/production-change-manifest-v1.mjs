import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';

const EXPECTED_SECRET_IDS = Object.freeze([
  'VIEWER_TOKEN',
  'SUBMITTER_TOKEN',
  'SCHEDULER_TOKEN',
  'ADMIN_TOKEN',
]);

const EXPECTED_GATE_STATUS = new Map([
  ['WO06A_LOCAL_BASELINE', 'SATISFIED'],
  ['WO06B_MIGRATION_RECOVERY', 'SATISFIED'],
  ['WO06C_LOCAL_BOUNDARY', 'SATISFIED'],
  ['WO06C_VCP_EXTERNAL', 'BLOCKED'],
  ['WO06C_KIOSK_DEVICE', 'BLOCKED'],
  ['WO06C_DINGTALK_PROVIDER', 'READY_FOR_AUTHORIZATION'],
  ['PRODUCTION_TARGET_FACTS', 'BLOCKED'],
  ['PRODUCTION_DATA_MIGRATION', 'BLOCKED'],
  ['PRODUCTION_DEPLOYMENT_GATE', 'BLOCKED'],
]);

const EXPECTED_REQUESTABLE = Object.freeze([
  'PROD-01-TARGET-READONLY-PREFLIGHT',
  'PROD-12-DINGTALK-PROVIDER-INTEGRATION',
]);

const EXPECTED_BLOCKERS = Object.freeze([
  'WO06C_VCP_EXTERNAL',
  'WO06C_KIOSK_DEVICE',
  'PRODUCTION_TARGET_FACTS',
  'PRODUCTION_DATA_MIGRATION',
  'PRODUCTION_DEPLOYMENT_GATE',
]);

const EXPECTED_ROLLBACK_ORDER = Object.freeze([
  'ROLLBACK-01-REMOVE-NEW-ROUTE',
  'ROLLBACK-02-STOP-NEW-CONTAINER',
  'ROLLBACK-03-DISABLE-EXTERNAL-CONFIG',
  'ROLLBACK-04-PRESERVE-DATA-VOLUME',
]);

// This is the authority surface of the production packet. The manifest may
// carry human-readable effects/evidence text, but an action ID cannot widen
// its requestability, target, prerequisite gates, or rollback binding.
const EXPECTED_ACTION_BINDINGS = new Map(Object.entries({
  "PROD-01-TARGET-READONLY-PREFLIGHT": {
    "status": "REQUESTABLE_EXPLICIT_AUTHORIZATION",
    "authorityTarget": "One identified production host; read-only disk/port/container/proxy inspection only",
    "preconditions": [],
    "rollbackActionIds": []
  },
  "PROD-02-CREATE-ISOLATED-APP-STORAGE": {
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Resolved production host; new isolated application directory and data volume only",
    "preconditions": [
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "rollbackActionIds": [
      "ROLLBACK-04-PRESERVE-DATA-VOLUME"
    ]
  },
  "PROD-03-GENERATE-INSTALL-TOKENS": {
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Resolved production host restricted runtime configuration for four role tokens",
    "preconditions": [
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "rollbackActionIds": [
      "ROLLBACK-03-DISABLE-EXTERNAL-CONFIG"
    ]
  },
  "PROD-04-BUILD-IMAGE": {
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Resolved production host image store; exact approved authority commit only",
    "preconditions": [
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "rollbackActionIds": []
  },
  "PROD-05-START-ISOLATED-CONTAINER": {
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Resolved production host; one new loopback-only container and dedicated data volume",
    "preconditions": [
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "rollbackActionIds": [
      "ROLLBACK-02-STOP-NEW-CONTAINER"
    ]
  },
  "PROD-06-LOOPBACK-HEALTH-SMOKE": {
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "New isolated container on resolved production host",
    "preconditions": [
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "rollbackActionIds": []
  },
  "PROD-07-CONFIGURE-REVERSE-PROXY-TLS": {
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Exact resolved reverse-proxy route and TLS binding only",
    "preconditions": [
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "rollbackActionIds": [
      "ROLLBACK-01-REMOVE-NEW-ROUTE"
    ]
  },
  "PROD-08-FIREWALL-SECURITY-GROUP": {
    "status": "CONDITIONAL_NOT_REQUESTED",
    "authorityTarget": "Exact named firewall/security-group rule only",
    "preconditions": [
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "rollbackActionIds": [
      "ROLLBACK-05-REVERT-FIREWALL-RULE"
    ]
  },
  "PROD-09-PRODUCTION-DATA-IMPORT": {
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Exact approved production source database/upload set to a new isolated target",
    "preconditions": [
      "PRODUCTION_DATA_MIGRATION",
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "rollbackActionIds": [
      "ROLLBACK-04-PRESERVE-DATA-VOLUME"
    ]
  },
  "PROD-10-ENABLE-VCP-REMOTE-SYNC": {
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Exact VCP runtime adapter configuration and one approved service endpoint",
    "preconditions": [
      "WO06C_VCP_EXTERNAL",
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "rollbackActionIds": [
      "ROLLBACK-03-DISABLE-EXTERNAL-CONFIG"
    ]
  },
  "PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE": {
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Exact approved Kiosk device/browser and trusted identity mapping",
    "preconditions": [
      "WO06C_KIOSK_DEVICE",
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "rollbackActionIds": [
      "ROLLBACK-03-DISABLE-EXTERNAL-CONFIG"
    ]
  },
  "PROD-12-DINGTALK-PROVIDER-INTEGRATION": {
    "status": "REQUESTABLE_EXPLICIT_AUTHORIZATION",
    "authorityTarget": "Exact DingTalk app/provider configuration and bounded test destination",
    "preconditions": [
      "WO06C_DINGTALK_PROVIDER"
    ],
    "rollbackActionIds": [
      "ROLLBACK-03-DISABLE-EXTERNAL-CONFIG"
    ]
  },
  "PROD-13-CUTOVER-SWITCH": {
    "status": "BLOCKED_PREREQUISITE",
    "authorityTarget": "Exact approved production route/data/client switch only",
    "preconditions": [
      "WO06C_VCP_EXTERNAL",
      "WO06C_KIOSK_DEVICE",
      "PRODUCTION_TARGET_FACTS",
      "PRODUCTION_DATA_MIGRATION",
      "PRODUCTION_DEPLOYMENT_GATE"
    ],
    "rollbackActionIds": [
      "ROLLBACK-01-REMOVE-NEW-ROUTE",
      "ROLLBACK-02-STOP-NEW-CONTAINER",
      "ROLLBACK-03-DISABLE-EXTERNAL-CONFIG",
      "ROLLBACK-04-PRESERVE-DATA-VOLUME"
    ]
  },
  "ROLLBACK-01-REMOVE-NEW-ROUTE": {
    "status": "ROLLBACK_ONLY",
    "authorityTarget": "Only the newly added route from this deployment",
    "preconditions": [],
    "rollbackActionIds": []
  },
  "ROLLBACK-02-STOP-NEW-CONTAINER": {
    "status": "ROLLBACK_ONLY",
    "authorityTarget": "Only the newly started container from this deployment",
    "preconditions": [],
    "rollbackActionIds": []
  },
  "ROLLBACK-03-DISABLE-EXTERNAL-CONFIG": {
    "status": "ROLLBACK_ONLY",
    "authorityTarget": "Only new VCP/Kiosk/DingTalk configuration introduced by an approved action",
    "preconditions": [],
    "rollbackActionIds": []
  },
  "ROLLBACK-04-PRESERVE-DATA-VOLUME": {
    "status": "ROLLBACK_ONLY",
    "authorityTarget": "New deployment data volume only",
    "preconditions": [],
    "rollbackActionIds": []
  },
  "ROLLBACK-05-REVERT-FIREWALL-RULE": {
    "status": "ROLLBACK_ONLY",
    "authorityTarget": "Exact firewall/security-group rule changed by PROD-08 only",
    "preconditions": [],
    "rollbackActionIds": []
  }
}));

const FORBIDDEN_SECRET_PATTERNS = Object.freeze([
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/iu,
  /access_token\s*=\s*[^\s"',;]{8,}/iu,
  /sk-[A-Za-z0-9_-]{16,}/u,
  /replace-with-random-/iu,
]);

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

    if (!sameSet(value.secrets.map(entry => entry.id), EXPECTED_SECRET_IDS)) {
      issues.push(issue('SECRET_SET_INVALID', '/secrets'));
    }

    const gateMap = new Map(value.gates.map(gate => [gate.id, gate]));
    if (gateMap.size !== value.gates.length) {
      issues.push(issue('DUPLICATE_GATE_ID', '/gates'));
    }
    if (!sameSet([...gateMap.keys()], [...EXPECTED_GATE_STATUS.keys()])) {
      issues.push(issue('GATE_SET_INVALID', '/gates'));
    }
    for (const [id, status] of EXPECTED_GATE_STATUS) {
      if (gateMap.get(id)?.status !== status) {
        issues.push(issue('GATE_STATUS_INVALID', '/gates/' + id));
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
      if (action.status !== expected.status) {
        issues.push(issue('ACTION_STATUS_INVALID', '/actions/' + actionId + '/status'));
      }
      if (action.authorityTarget !== expected.authorityTarget) {
        issues.push(issue('AUTHORITY_TARGET_INVALID', '/actions/' + actionId + '/authorityTarget'));
      }
      if (!sameSet(action.preconditions, expected.preconditions)) {
        issues.push(issue('ACTION_PRECONDITIONS_INVALID', '/actions/' + actionId + '/preconditions'));
      }
      if (!sameSet(action.rollbackActionIds, expected.rollbackActionIds)) {
        issues.push(issue('ROLLBACK_BINDING_INVALID', '/actions/' + actionId + '/rollbackActionIds'));
      }
      for (const rollbackId of action.rollbackActionIds) {
        if (actionMap.get(rollbackId)?.category !== 'ROLLBACK') {
          issues.push(issue('ROLLBACK_REFERENCE_INVALID', '/actions/' + actionId + '/rollbackActionIds'));
        }
      }
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

    if (!sameSet(value.authorizationPacket.blockingGateIds, EXPECTED_BLOCKERS)) {
      issues.push(issue('AUTHORIZATION_BLOCKER_SET_INVALID', '/authorizationPacket/blockingGateIds'));
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

    const text = stableJson(value);
    if (FORBIDDEN_SECRET_PATTERNS.some(pattern => pattern.test(text))) {
      issues.push(issue('SECRET_MATERIAL_DETECTED', '/'));
    }

    const digest = 'sha256:' + createHash('sha256').update(text).digest('hex');
    return Object.freeze({
      ok: issues.length === 0,
      digest,
      issues: Object.freeze(issues),
    });
  };
}
