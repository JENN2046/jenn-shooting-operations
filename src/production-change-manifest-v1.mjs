import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';

const EXPECTED_SECRET_IDS = ['VIEWER_TOKEN', 'SUBMITTER_TOKEN', 'SCHEDULER_TOKEN', 'ADMIN_TOKEN'];
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
const EXPECTED_REQUESTABLE = [
  'PROD-01-TARGET-READONLY-PREFLIGHT',
  'PROD-12-DINGTALK-PROVIDER-INTEGRATION',
];
const EXPECTED_BLOCKERS = [
  'WO06C_VCP_EXTERNAL',
  'WO06C_KIOSK_DEVICE',
  'PRODUCTION_TARGET_FACTS',
  'PRODUCTION_DATA_MIGRATION',
  'PRODUCTION_DEPLOYMENT_GATE',
];
const FORBIDDEN_SECRET_PATTERNS = [
  /Bearer\\s+[A-Za-z0-9._-]{16,}/u,
  /access_token=/iu,
  /sk-[A-Za-z0-9_-]{16,}/u,
  /replace-with-random-/iu,
];

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sameSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
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
    if (gateMap.size !== value.gates.length) issues.push(issue('DUPLICATE_GATE_ID', '/gates'));
    for (const [id, status] of EXPECTED_GATE_STATUS) {
      if (gateMap.get(id)?.status !== status) issues.push(issue('GATE_STATUS_INVALID', '/gates/' + id));
    }

    const actionMap = new Map(value.actions.map(action => [action.id, action]));
    if (actionMap.size !== value.actions.length) issues.push(issue('DUPLICATE_ACTION_ID', '/actions'));
    for (const action of value.actions) {
      for (const rollbackId of action.rollbackActionIds) {
        if (actionMap.get(rollbackId)?.category !== 'ROLLBACK') {
          issues.push(issue('ROLLBACK_REFERENCE_INVALID', '/actions/' + action.id));
        }
      }
    }

    const requiredPreconditions = new Map([
      ['PROD-09-PRODUCTION-DATA-IMPORT', ['PRODUCTION_DATA_MIGRATION', 'PRODUCTION_DEPLOYMENT_GATE']],
      ['PROD-10-ENABLE-VCP-REMOTE-SYNC', ['WO06C_VCP_EXTERNAL', 'PRODUCTION_DEPLOYMENT_GATE']],
      ['PROD-11-ENABLE-KIOSK-IDENTITY-DEVICE', ['WO06C_KIOSK_DEVICE', 'PRODUCTION_DEPLOYMENT_GATE']],
      ['PROD-13-CUTOVER-SWITCH', ['WO06C_VCP_EXTERNAL', 'WO06C_KIOSK_DEVICE', 'PRODUCTION_DATA_MIGRATION', 'PRODUCTION_DEPLOYMENT_GATE']],
    ]);
    for (const [actionId, gates] of requiredPreconditions) {
      const action = actionMap.get(actionId);
      if (!action || action.status !== 'BLOCKED_PREREQUISITE'
          || gates.some(gate => !action.preconditions.includes(gate))) {
        issues.push(issue('ACTION_GATE_BINDING_INVALID', '/actions/' + actionId));
      }
    }

    if (!sameSet(value.authorizationPacket.requestableActionIds, EXPECTED_REQUESTABLE)) {
      issues.push(issue('REQUESTABLE_ACTION_SET_INVALID', '/authorizationPacket/requestableActionIds'));
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
