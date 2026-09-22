import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const PROFILE_STRICT = 'strict-write';
const PROFILE_LEGACY = 'legacy-read';
const CLASSIFICATIONS = {
  L1: 'L1_GRANDFATHERED_OPAQUE',
  L2: 'L2_REPAIR_REQUIRED',
  L3: 'L3_SOURCE_CORRUPT',
};
const RESERVED_V2_PROPERTIES = new Set([
  'projectionRevision', 'scheduleRevision', 'runRevision', 'expectedScheduleRevision', 'expectedRunRevision',
  'requests', 'scheduleItems', 'productionRuns', 'taskBindings', 'allocationMode', 'resourceId',
  'resourceResolutionStatus', 'bufferAfterMinutes', 'scheduleStatus', 'lockStatus', 'nextStart', 'diagnostics',
  'requestLifecycle', 'lifecycleProvenance', 'v1StatusMode', 'sourceOperationId', 'deliverables',
  'coreBriefSummary', 'briefUrl', 'heroAssetId', 'sampleStatus', 'sampleShelfId', 'lightingPreset',
  'reflectivity', 'priority',
]);
const FRAGMENT_RESERVED_V1_PROPERTIES = {
  root: new Set(['schemaVersion', 'revision', 'updatedAt', 'products', 'tasks', 'sessions']),
  task: new Set(['id', 'sku', 'name', 'client', 'deliver', 'kind', 'status', 'source', 'createdAt', 'updatedAt', 'assets', 'request']),
  session: new Set(['id', 'ids', 'date', 'start', 'end', 'place', 'note', 'updatedAt']),
  request: new Set(['productionType', 'shootingSubtype', 'deliverableCount', 'aspectRatio', 'durationSeconds', 'audioRequirement', 'requestedBy', 'desiredDate', 'note']),
  asset: new Set(['id', 'name', 'contentType', 'kind', 'size', 'sha256']),
};
const ALLOWED_TIMESTAMP_FRAGMENT_OVERLAYS = new Set([
  'task:/createdAt',
  'task:/updatedAt',
  'session:/updatedAt',
]);
const UNSAFE_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

function loadSchema(filename) {
  return JSON.parse(readFileSync(new URL(`../contracts/${filename}`, import.meta.url), 'utf8'));
}

const ajv = new Ajv2020({ allErrors: true, strict: true, ownProperties: true });
addFormats(ajv, { mode: 'full' });

const validateV1SnapshotStructure = ajv.compile(loadSchema('schedule-snapshot.schema.json'));
const validateV1SubmissionStructure = ajv.compile(loadSchema('request-submission.schema.json'));
const validateV2SnapshotStructure = ajv.compile(loadSchema('schedule-snapshot.v2.schema.json'));
const validateV2SubmissionStructure = ajv.compile(loadSchema('request-submission.v2.schema.json'));
const validateLegacyFragmentStructure = ajv.compile(loadSchema('legacy-compat-fragment.v2.schema.json'));
const validateDateTimeFormat = ajv.compile({ type: 'string', format: 'date-time' });

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapePointer(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function getAtPointer(value, pointer) {
  if (!pointer) return value;
  return pointer.split('/').slice(1).reduce((current, segment) => {
    if (current === undefined || current === null) return undefined;
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    return current[key];
  }, value);
}

function issue(code, path, message, classification = CLASSIFICATIONS.L2, keyword = 'semantic') {
  return { code, path: path || '/', message, classification, keyword };
}

function classifySchemaError(error) {
  const path = error.instancePath || '/';
  if (error.keyword === 'additionalProperties') {
    if (UNSAFE_PROPERTY_NAMES.has(error.params.additionalProperty)) return CLASSIFICATIONS.L3;
    return RESERVED_V2_PROPERTIES.has(error.params.additionalProperty) ? CLASSIFICATIONS.L2 : CLASSIFICATIONS.L1;
  }
  if (error.keyword === 'required' && error.params.missingProperty === 'id' && /^\/(tasks|sessions)\/\d+$/.test(path)) {
    return CLASSIFICATIONS.L3;
  }
  if (/^\/(tasks|sessions)\/\d+\/id$/.test(path)) return CLASSIFICATIONS.L3;
  if (error.keyword === 'format' && /^\/(tasks\/\d+\/(createdAt|updatedAt)|sessions\/\d+\/updatedAt)$/.test(path)) {
    return CLASSIFICATIONS.L1;
  }
  if (path === '/revision' && ['maximum', 'minimum', 'type'].includes(error.keyword)) return CLASSIFICATIONS.L3;
  if (error.keyword === 'uniqueItems' && /^\/sessions\/\d+\/ids$/.test(path)) return CLASSIFICATIONS.L2;
  if (path === '/' && ['type', 'required'].includes(error.keyword)) return CLASSIFICATIONS.L3;
  if (['/tasks', '/sessions'].includes(path) && error.keyword === 'type') return CLASSIFICATIONS.L3;
  return CLASSIFICATIONS.L2;
}

function schemaIssues(validate, value) {
  validate(value);
  return (validate.errors || []).map(error => {
    const path = error.keyword === 'additionalProperties'
      ? `${error.instancePath}/${escapePointer(error.params.additionalProperty)}`
      : (error.instancePath || '/');
    const code = error.keyword === 'additionalProperties'
      ? 'ADDITIONAL_PROPERTY'
      : `SCHEMA_${error.keyword.toUpperCase()}`;
    return issue(code, path, `${path} ${error.message}`, classifySchemaError(error), error.keyword);
  });
}

function isCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function v1SnapshotSemanticIssues(snapshot) {
  const issues = [];
  if (!isRecord(snapshot)) return issues;

  const taskIds = new Set();
  if (Array.isArray(snapshot.tasks)) {
    snapshot.tasks.forEach((task, index) => {
      if (!isRecord(task) || typeof task.id !== 'string') return;
      if (taskIds.has(task.id)) {
        issues.push(issue('DUPLICATE_TASK_ID', `/tasks/${index}/id`, `tasks[${index}].id is duplicated`, CLASSIFICATIONS.L3));
      }
      taskIds.add(task.id);
      if (isRecord(task.request) && typeof task.request.desiredDate === 'string' && task.request.desiredDate && !isCalendarDate(task.request.desiredDate)) {
        issues.push(issue('INVALID_CALENDAR_DATE', `/tasks/${index}/request/desiredDate`, `tasks[${index}].request.desiredDate is not a real calendar date`));
      }
    });
  }

  const sessionIds = new Set();
  if (Array.isArray(snapshot.sessions)) {
    snapshot.sessions.forEach((session, index) => {
      if (!isRecord(session)) return;
      if (typeof session.id === 'string') {
        if (sessionIds.has(session.id)) {
          issues.push(issue('DUPLICATE_SESSION_ID', `/sessions/${index}/id`, `sessions[${index}].id is duplicated`, CLASSIFICATIONS.L3));
        }
        sessionIds.add(session.id);
      }
      if (Array.isArray(session.ids)) {
        session.ids.forEach((taskId, taskIndex) => {
          if (typeof taskId === 'string' && !taskIds.has(taskId)) {
            issues.push(issue('UNKNOWN_TASK_REFERENCE', `/sessions/${index}/ids/${taskIndex}`, `sessions[${index}] references unknown task ${taskId}`, CLASSIFICATIONS.L3));
          }
        });
      }
      if (typeof session.date === 'string' && !isCalendarDate(session.date)) {
        issues.push(issue('INVALID_CALENDAR_DATE', `/sessions/${index}/date`, `sessions[${index}].date is not a real calendar date`));
      }
      if (typeof session.start === 'string' && typeof session.end === 'string'
          && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(session.start)
          && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(session.end)
          && session.start >= session.end) {
        issues.push(issue('INVALID_TIME_RANGE', `/sessions/${index}/end`, `sessions[${index}] end must be later than start`));
      }
    });
  }
  return issues;
}

function v1SubmissionSemanticIssues(submission) {
  if (!isRecord(submission)) return [];
  if (typeof submission.desiredDate === 'string' && !isCalendarDate(submission.desiredDate)) {
    return [issue('INVALID_CALENDAR_DATE', '/desiredDate', 'desiredDate is not a real calendar date')];
  }
  return [];
}

function briefHostIssues(briefUrl, path, allowedBriefHosts) {
  if (briefUrl === undefined || briefUrl === null) return [];
  if (!Array.isArray(allowedBriefHosts) || allowedBriefHosts.length === 0) {
    return [issue('BRIEF_HOST_ALLOWLIST_REQUIRED', path, 'briefUrl requires an explicit non-empty allowedBriefHosts configuration')];
  }
  if (allowedBriefHosts.some(host => typeof host !== 'string' || !host.trim())) {
    return [issue('BRIEF_HOST_ALLOWLIST_INVALID', path, 'allowedBriefHosts must contain non-empty host names')];
  }
  let hostname;
  try {
    hostname = new URL(briefUrl).hostname.toLowerCase();
  } catch {
    return [];
  }
  const allowed = new Set(allowedBriefHosts.map(host => host.toLowerCase()));
  return allowed.has(hostname)
    ? []
    : [issue('BRIEF_HOST_NOT_ALLOWED', path, 'briefUrl host is not in allowedBriefHosts')];
}

function strictResult(profile, issues) {
  return { ok: issues.length === 0, profile, errors: issues };
}

function legacyResult(value, issues) {
  const ranks = { [CLASSIFICATIONS.L1]: 1, [CLASSIFICATIONS.L2]: 2, [CLASSIFICATIONS.L3]: 3 };
  const classification = issues.length === 0
    ? 'L0_STRICT'
    : issues.reduce((highest, current) => ranks[current.classification] > ranks[highest] ? current.classification : highest, CLASSIFICATIONS.L1);
  const fragments = issues
    .filter(current => current.classification === CLASSIFICATIONS.L1)
    .map(current => ({
      jsonPointer: current.path,
      value: structuredClone(getAtPointer(value, current.path)),
      violationCode: current.code,
    }));
  return {
    ok: classification !== CLASSIFICATIONS.L3,
    profile: PROFILE_LEGACY,
    classification,
    switchReady: classification === 'L0_STRICT' || classification === CLASSIFICATIONS.L1,
    errors: issues,
    fragments,
  };
}

function validLifecycleCombination(request) {
  if (!isRecord(request)) return true;
  const { legacyV1Status, v1StatusMode, requestLifecycle, lifecycleProvenance } = request;
  if (v1StatusMode === 'legacyExact') {
    const lifecycleByStatus = {
      pending: 'open',
      scheduled: 'open',
      completed: 'fulfilled',
      cancelled: 'cancelled',
    };
    return lifecycleProvenance === 'legacySnapshot'
      && lifecycleByStatus[legacyV1Status] === requestLifecycle;
  }
  if (v1StatusMode === 'legacyOmitted') {
    return legacyV1Status === null && requestLifecycle === null && lifecycleProvenance === 'legacySnapshot';
  }
  if (v1StatusMode === 'canonical') {
    return lifecycleProvenance === 'domainCommand'
      && ['open', 'fulfilled', 'cancelled'].includes(requestLifecycle);
  }
  return true;
}

export function validateV1Snapshot(snapshot, { profile = PROFILE_STRICT } = {}) {
  if (![PROFILE_STRICT, PROFILE_LEGACY].includes(profile)) throw new TypeError(`unsupported V1 validation profile: ${profile}`);
  const issues = [...schemaIssues(validateV1SnapshotStructure, snapshot), ...v1SnapshotSemanticIssues(snapshot)]
    .map(current => current.classification === CLASSIFICATIONS.L1
      && hasUnsafeObjectKey(getAtPointer(snapshot, current.path))
      ? issue('UNSAFE_ADDITIONAL_PROPERTY_VALUE', current.path, `${current.path} contains an unsafe object property`, CLASSIFICATIONS.L3)
      : current);
  return profile === PROFILE_LEGACY ? legacyResult(snapshot, issues) : strictResult(profile, issues);
}

export function validateV1Submission(submission) {
  const issues = [...schemaIssues(validateV1SubmissionStructure, submission), ...v1SubmissionSemanticIssues(submission)];
  return strictResult(PROFILE_STRICT, issues);
}

function v2SnapshotSemanticIssues(snapshot, { allowedBriefHosts } = {}) {
  const issues = [];
  if (!isRecord(snapshot)) return issues;

  const requestIds = new Set();
  if (Array.isArray(snapshot.requests)) {
    snapshot.requests.forEach((request, index) => {
      if (!isRecord(request) || typeof request.id !== 'string') return;
      if (requestIds.has(request.id)) issues.push(issue('DUPLICATE_REQUEST_ID', `/requests/${index}/id`, `requests[${index}].id is duplicated`));
      requestIds.add(request.id);
      if (!validLifecycleCombination(request)) {
        issues.push(issue('INVALID_REQUEST_LIFECYCLE_COMBINATION', `/requests/${index}`, 'legacy status, status mode, request lifecycle and provenance are inconsistent'));
      }
      if (typeof request.desiredDate === 'string' && !isCalendarDate(request.desiredDate)) {
        issues.push(issue('INVALID_CALENDAR_DATE', `/requests/${index}/desiredDate`, `requests[${index}].desiredDate is not a real calendar date`));
      }
      issues.push(...briefHostIssues(request.briefUrl, `/requests/${index}/briefUrl`, allowedBriefHosts));
    });
  }

  const scheduleItems = new Map();
  if (Array.isArray(snapshot.scheduleItems)) {
    snapshot.scheduleItems.forEach((item, index) => {
      if (!isRecord(item)) return;
      if (typeof item.id === 'string') {
        if (scheduleItems.has(item.id)) issues.push(issue('DUPLICATE_SCHEDULE_ITEM_ID', `/scheduleItems/${index}/id`, `scheduleItems[${index}].id is duplicated`));
        scheduleItems.set(item.id, item);
      }
      if (Array.isArray(item.taskBindings)) {
        const bindingIds = new Set();
        item.taskBindings.forEach((binding, bindingIndex) => {
          if (!isRecord(binding)) return;
          if (binding.displayOrder !== bindingIndex) {
            issues.push(issue('INVALID_BINDING_ORDER', `/scheduleItems/${index}/taskBindings/${bindingIndex}/displayOrder`, 'task binding displayOrder must be contiguous and match array order'));
          }
          if (typeof binding.taskId === 'string') {
            if (bindingIds.has(binding.taskId)) issues.push(issue('DUPLICATE_TASK_BINDING', `/scheduleItems/${index}/taskBindings/${bindingIndex}/taskId`, 'task binding is duplicated'));
            bindingIds.add(binding.taskId);
            if (!requestIds.has(binding.taskId)) issues.push(issue('UNKNOWN_REQUEST_REFERENCE', `/scheduleItems/${index}/taskBindings/${bindingIndex}/taskId`, `unknown canonical request ${binding.taskId}`));
          }
        });
        if (item.allocationMode === 'single' && item.taskBindings.length !== 1) {
          issues.push(issue('INVALID_ALLOCATION_CARDINALITY', `/scheduleItems/${index}/taskBindings`, 'single allocation must contain exactly one task binding'));
        }
        if (item.allocationMode === 'groupedUnallocated' && item.taskBindings.length < 2) {
          issues.push(issue('INVALID_ALLOCATION_CARDINALITY', `/scheduleItems/${index}/taskBindings`, 'groupedUnallocated allocation must contain at least two task bindings'));
        }
      }
      if (typeof item.plannedStart === 'string' && typeof item.plannedEnd === 'string'
          && !Number.isNaN(Date.parse(item.plannedStart)) && !Number.isNaN(Date.parse(item.plannedEnd))
          && Date.parse(item.plannedStart) >= Date.parse(item.plannedEnd)) {
        issues.push(issue('INVALID_TIME_RANGE', `/scheduleItems/${index}/plannedEnd`, 'plannedEnd must be later than plannedStart'));
      }
      if (item.resourceResolutionStatus === 'resolved' && item.resourceId === null) {
        issues.push(issue('RESOURCE_NOT_RESOLVED', `/scheduleItems/${index}/resourceId`, 'resolved schedule item requires resourceId'));
      }
      if (item.resourceResolutionStatus === 'unresolved' && item.resourceId !== null) {
        issues.push(issue('RESOURCE_RESOLUTION_CONFLICT', `/scheduleItems/${index}/resourceId`, 'unresolved schedule item must not claim a resourceId'));
      }
    });
  }

  const runIds = new Set();
  if (Array.isArray(snapshot.productionRuns)) {
    snapshot.productionRuns.forEach((run, index) => {
      if (!isRecord(run)) return;
      if (typeof run.id === 'string') {
        if (runIds.has(run.id)) issues.push(issue('DUPLICATE_RUN_ID', `/productionRuns/${index}/id`, `productionRuns[${index}].id is duplicated`));
        runIds.add(run.id);
      }
      const scheduleItem = scheduleItems.get(run.scheduleItemId);
      if (!scheduleItem) issues.push(issue('UNKNOWN_SCHEDULE_REFERENCE', `/productionRuns/${index}/scheduleItemId`, `unknown schedule item ${run.scheduleItemId}`));
      if (run.scope === 'task') {
        if (typeof run.taskId !== 'string' || !requestIds.has(run.taskId)) {
          issues.push(issue('INVALID_SINGLE_RUN_TASK', `/productionRuns/${index}/taskId`, 'single run requires a canonical request taskId'));
        } else if (scheduleItem && (
          scheduleItem.allocationMode !== 'single'
          || !Array.isArray(scheduleItem.taskBindings)
          || !scheduleItem.taskBindings.some(binding => binding?.taskId === run.taskId)
        )) {
          issues.push(issue('RUN_TASK_BINDING_MISMATCH', `/productionRuns/${index}/taskId`, 'single run taskId must match its single schedule item binding'));
        }
      } else if (run.scope === 'block' && run.taskId !== null) {
        issues.push(issue('INVALID_GROUPED_RUN_TASK', `/productionRuns/${index}/taskId`, 'block run must not claim a single taskId'));
      } else if (run.scope === 'block' && scheduleItem?.allocationMode !== 'groupedUnallocated') {
        issues.push(issue('RUN_SCOPE_MISMATCH', `/productionRuns/${index}/scope`, 'block run requires a groupedUnallocated schedule item'));
      }
    });
  }
  return issues;
}

export function validateV2Snapshot(snapshot, options = {}) {
  const issues = [...schemaIssues(validateV2SnapshotStructure, snapshot), ...v2SnapshotSemanticIssues(snapshot, options)];
  return strictResult(PROFILE_STRICT, issues);
}

export function validateV2Submission(submission, { allowedBriefHosts } = {}) {
  const issues = [
    ...schemaIssues(validateV2SubmissionStructure, submission),
    ...v1SubmissionSemanticIssues(submission),
    ...briefHostIssues(submission?.briefUrl, '/briefUrl', allowedBriefHosts),
  ];
  return strictResult(PROFILE_STRICT, issues);
}

function hasUnsafeObjectKey(value) {
  if (Array.isArray(value)) return value.some(hasUnsafeObjectKey);
  if (!isRecord(value)) return false;
  return Object.keys(value).some(key => UNSAFE_PROPERTY_NAMES.has(key) || hasUnsafeObjectKey(value[key]));
}

export function validateLegacyCompatFragment(fragment) {
  const issues = schemaIssues(validateLegacyFragmentStructure, fragment);
  if (!isRecord(fragment)) return strictResult(PROFILE_STRICT, issues);

  let timestampOverlay = false;
  if (typeof fragment.json_pointer === 'string') {
    const segments = fragment.json_pointer.split('/').slice(1)
      .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
    if (segments.some(segment => UNSAFE_PROPERTY_NAMES.has(segment))) {
      issues.push(issue('UNSAFE_FRAGMENT_POINTER', '/json_pointer', 'json_pointer contains an unsafe property segment', CLASSIFICATIONS.L3));
    }
    timestampOverlay = ALLOWED_TIMESTAMP_FRAGMENT_OVERLAYS.has(`${fragment.entity_type}:${fragment.json_pointer}`);
    const reservedPointer = FRAGMENT_RESERVED_V1_PROPERTIES[fragment.entity_type]?.has(segments[0])
      || segments.some(segment => RESERVED_V2_PROPERTIES.has(segment));
    if (reservedPointer && !(timestampOverlay && fragment.violation_code === 'SCHEMA_FORMAT')) {
      issues.push(issue('RESERVED_FRAGMENT_POINTER', '/json_pointer', 'json_pointer targets a reserved V1 or V2 field', CLASSIFICATIONS.L3));
    }
  }

  if (typeof fragment.value_json === 'string') {
    let parsed;
    try {
      parsed = JSON.parse(fragment.value_json);
    } catch {
      issues.push(issue('INVALID_FRAGMENT_JSON', '/value_json', 'value_json must contain exactly one valid JSON value', CLASSIFICATIONS.L3));
    }
    if (parsed !== undefined && hasUnsafeObjectKey(parsed)) {
      issues.push(issue('UNSAFE_FRAGMENT_VALUE', '/value_json', 'value_json contains an unsafe object property', CLASSIFICATIONS.L3));
    }
    if (timestampOverlay && fragment.violation_code === 'SCHEMA_FORMAT'
        && (typeof parsed !== 'string' || validateDateTimeFormat(parsed))) {
      issues.push(issue('INVALID_TIMESTAMP_OVERLAY_VALUE', '/value_json', 'timestamp overlay must preserve a string that fails the RFC 3339 date-time format', CLASSIFICATIONS.L3));
    }
    if (typeof fragment.value_digest === 'string') {
      const expected = `sha256:${createHash('sha256').update(fragment.value_json).digest('hex')}`;
      if (fragment.value_digest !== expected) {
        issues.push(issue('FRAGMENT_DIGEST_MISMATCH', '/value_digest', 'value_digest does not match the exact value_json bytes', CLASSIFICATIONS.L3));
      }
    }
  }
  return strictResult(PROFILE_STRICT, issues);
}

export function normalizePlannerData(input, now = new Date().toISOString()) {
  if (!isRecord(input)) throw new TypeError('planner data must be an object');
  return {
    schemaVersion: 1,
    revision: Number.isSafeInteger(input.revision) && input.revision >= 0 ? input.revision : 0,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now,
    products: Array.isArray(input.products) ? input.products : [],
    tasks: Array.isArray(input.tasks) ? input.tasks : [],
    sessions: Array.isArray(input.sessions) ? input.sessions : [],
  };
}

function legacyMessages(result) {
  return result.errors.map(error => error.message);
}

// Current V1 store compatibility exports. Both now converge on the
// authoritative strict-write entry instead of maintaining a second contract.
export function validateSnapshot(snapshot) {
  return legacyMessages(validateV1Snapshot(snapshot));
}

export function validateSubmission(submission) {
  return legacyMessages(validateV1Submission(submission));
}
