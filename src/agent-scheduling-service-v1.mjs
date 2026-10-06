import { canonicalJsonSchedulingV1, digestCanonicalJsonSchedulingV1 } from './scheduling-contract-v1.mjs';
import { authorizeCapability, validateTrustedPrincipal } from './authorization-v2.mjs';
import { normalizeSchedulingConfig, compileSchedulingCalendarDate } from './scheduling-admin-contract-v2.mjs';

const denied = code => ({ ok: false, code });
function checkedReceipt(row) {
  try {
    const receipt = JSON.parse(row.receipt_json);
    return canonicalJsonSchedulingV1(receipt) === row.receipt_json
      && digestCanonicalJsonSchedulingV1(receipt) === row.receipt_digest ? receipt : null;
  } catch { return null; }
}

function exact(input, keys) {
  return input && Object.getPrototypeOf(input) === Object.prototype
    && Reflect.ownKeys(input).length === keys.length && keys.every(key => {
      const d = Object.getOwnPropertyDescriptor(input, key);
      return d && Object.hasOwn(d, 'value') && d.enumerable;
    });
}
function scoped(principal, ids, capability = 'readSchedule') {
  return validateTrustedPrincipal(principal).ok && Array.isArray(ids) && ids.length > 0
    && new Set(ids).size === ids.length
    && ids.every(resourceId => authorizeCapability({ principal, resourceId, capability }).allowed);
}
function isoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00.000Z'))
    && new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value;
}
function readTransaction(db, work) {
  db.exec('BEGIN DEFERRED');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}
const revisions = db => db.prepare('SELECT schedule_revision AS scheduleRevision,projection_revision AS projectionRevision FROM revision_counters WHERE id=1').get() ?? null;
const activeConfig = db => db.prepare(`SELECT v.config_version,v.config_json,v.config_digest,v.calendar_compiler_version
  FROM scheduling_active_config a JOIN scheduling_config_versions v ON v.config_version=a.config_version WHERE a.id=1`).get();
const businessSchemaReady = db => Boolean(db.prepare(`SELECT 1 FROM schema_migrations
  WHERE version = 11 AND name = 'business_calendar_and_reschedule'`).get());
function validConfig(row) {
  if (!row) return null;
  try {
    const n = normalizeSchedulingConfig(JSON.parse(row.config_json));
    return n.ok && n.configJson === row.config_json && n.configDigest === row.config_digest ? n.config : null;
  } catch { return null; }
}
const decisionSummary = receipt => ({ decisionId: receipt.decisionId, proposalId: receipt.proposalId,
  decisionType: receipt.decisionType, selectedProposalItemIds: receipt.selectedProposalItemIdsJson === null ? null : JSON.parse(receipt.selectedProposalItemIdsJson),
  adoptedItems: receipt.adoptedItemsJson === null ? null : JSON.parse(receipt.adoptedItemsJson), baseScheduleRevision: receipt.baseScheduleRevision,
  resultingScheduleRevision: receipt.resultingScheduleRevision, reasonCode: receipt.reasonCode,
  decidedAt: receipt.decidedAt, decisionCommandDigest: receipt.decisionCommandDigest });
const rescheduleSummary = receipt => ({ operationId: receipt.operationId, scheduleItemId: receipt.after?.scheduleItemId,
  resourceId: receipt.after?.resourceId, before: receipt.before, after: receipt.after,
  scheduleRevision: receipt.scheduleRevision, projectionRevision: receipt.projectionRevision,
  commandDigest: receipt.commandDigest, notificationStatus: receipt.notificationStatus });

/** Local injected facade. Authentication and exact write grants belong to its trusted adapter.
 * No user/model supplied role, approval reference or prompt can create that authority.
 */
export function createAgentSchedulingServiceV1({ db, proposalStore, application, writeAdmissionControl } = {}) {
  if (!db || typeof proposalStore?.preview !== 'function' || typeof proposalStore?.adoptPreview !== 'function'
    || typeof application?.reschedule !== 'function' || typeof writeAdmissionControl?.isDisabled !== 'function') {
    throw new TypeError('trusted database, proposal store, application and write-admission control required');
  }
  return Object.freeze({
    readState({ principal, command }) {
      if (!businessSchemaReady(db)) return denied('BUSINESS_SCHEMA11_REQUIRED');
      if (!exact(command, ['resourceScope'])) return denied('INVALID_REQUEST');
      if (!scoped(principal, command.resourceScope)) return denied('FORBIDDEN');
      return readTransaction(db, () => {
        const row = activeConfig(db), config = validConfig(row);
        if (row && !config) return denied('SCHEDULING_CONFIG_INVALID');
        const resources = db.prepare('SELECT resource_id AS resourceId,v1_display_place AS displayName,status FROM scheduling_resources ORDER BY resource_id').all()
          .filter(r => command.resourceScope.includes(r.resourceId));
        const sessions = db.prepare(`SELECT id AS scheduleItemId,resource_id AS resourceId,planned_start AS plannedStart,planned_end AS plannedEnd,
          buffer_after_minutes AS bufferAfterMinutes,schedule_status AS status,lock_status AS lockStatus
          FROM schedule_items ORDER BY planned_start,id`).all().filter(r => command.resourceScope.includes(r.resourceId));
        return { ok: true, revisions: revisions(db), resources, sessions,
          activeConfig: row ? { configVersion: row.config_version, configDigest: row.config_digest, businessTimeZone: config.businessTimeZone } : null,
          writeAdmission: writeAdmissionControl.isDisabled() ? 'disabled' : 'enabled' };
      });
    },
    previewCalendar({ principal, command }) {
      if (!businessSchemaReady(db)) return denied('BUSINESS_SCHEMA11_REQUIRED');
      if (!exact(command, ['resourceId', 'startDate', 'endDate']) || !isoDate(command.startDate) || !isoDate(command.endDate)) return denied('INVALID_REQUEST');
      if (!scoped(principal, [command.resourceId])) return denied('FORBIDDEN');
      const first = Date.parse(command.startDate), last = Date.parse(command.endDate);
      if (last < first || (last - first) / 86400000 + 1 > 366) return denied('SCHEDULING_PLANNING_RANGE_UNSUPPORTED');
      return readTransaction(db, () => {
        const row = activeConfig(db), config = validConfig(row);
        if (!row) return denied('SCHEDULING_CONFIG_NOT_ACTIVE');
        if (!config) return denied('SCHEDULING_CONFIG_INVALID');
        const days = [];
        for (let day = first; day <= last; day += 86400000) {
          const date = new Date(day).toISOString().slice(0, 10);
          const result = compileSchedulingCalendarDate({configJson:config,resourceId:command.resourceId,date,
            calendarCompilerVersion:row.calendar_compiler_version,timeZoneDataVersion:process.versions.tz});
          if (!result.ok) return result;
          days.push({date,source:result.source,windows:result.windows,resultDigest:result.resultDigest});
        }
        return {ok:true,resourceId:command.resourceId,businessTimeZone:config.businessTimeZone,configVersion:row.config_version,configDigest:row.config_digest,days};
      });
    },
    generateProposal({ principal, command }) {
      if (!businessSchemaReady(db)) return denied('BUSINESS_SCHEMA11_REQUIRED');
      if (!scoped(principal, command?.resourceScope)) return denied('FORBIDDEN');
      return proposalStore.preview(command, principal.subjectId);
    },
    adoptProposal({ principal, command, executionGuard = () => true }) {
      if (!businessSchemaReady(db)) return denied('BUSINESS_SCHEMA11_REQUIRED');
      if (!scoped(principal, command?.generationCommand?.resourceScope, 'modifySchedule')) return denied('FORBIDDEN');
      if (writeAdmissionControl.isDisabled()) return denied('WRITE_ADMISSION_DISABLED');
      const result = proposalStore.adoptPreview(command, principal, { executionGuard: () => !writeAdmissionControl.isDisabled() && executionGuard() === true && !writeAdmissionControl.isDisabled() });
      return result.ok ? {ok:true,receipt:decisionSummary(result.receipt),exactReplay:result.exactReplay} : result;
    },
    reschedule({ principal, command, executionGuard = () => true }) {
      if (!businessSchemaReady(db)) return denied('BUSINESS_SCHEMA11_REQUIRED');
      if (!scoped(principal, [command?.resourceId], 'modifySchedule')) return denied('FORBIDDEN');
      if (writeAdmissionControl.isDisabled()) return denied('WRITE_ADMISSION_DISABLED');
      const result = application.reschedule({principal,command,executionGuard: () => !writeAdmissionControl.isDisabled() && executionGuard() === true && !writeAdmissionControl.isDisabled()});
      return result.ok ? {ok:true,receipt:rescheduleSummary(result.receipt),exactReplay:result.exactReplay} : result;
    },
    readReceipt({ principal, command }) {
      if (!businessSchemaReady(db)) return denied('BUSINESS_SCHEMA11_REQUIRED');
      if (!exact(command, ['operationId']) || typeof command.operationId !== 'string' || !command.operationId.length || command.operationId.length > 160) return denied('INVALID_REQUEST');
      if (!validateTrustedPrincipal(principal).ok) return denied('FORBIDDEN');
      return readTransaction(db, () => {
        const invalid = () => denied('AGENT_RECEIPT_INTEGRITY_FAILED');
        const checkedProposal = proposalId => {
          try { const found = proposalStore.read(proposalId); return found.ok ? found : null; }
          catch { return null; }
        };
        const moved = db.prepare('SELECT resource_id,receipt_json,receipt_digest FROM schedule_reschedule_operations WHERE operation_id=?').get(command.operationId);
        if (moved) {
          const receipt = checkedReceipt(moved);
          if (!receipt || receipt.operationId !== command.operationId
            || receipt.before?.resourceId !== moved.resource_id || receipt.after?.resourceId !== moved.resource_id) return invalid();
          return scoped(principal,[moved.resource_id]) ? {ok:true,kind:'reschedule',receipt:rescheduleSummary(receipt),receiptDigest:moved.receipt_digest} : denied('FORBIDDEN');
        }
        const decision = db.prepare('SELECT proposal_id,receipt_json,receipt_digest FROM scheduling_proposal_decisions WHERE decision_id=?').get(command.operationId);
        if (decision) {
          const found = checkedProposal(decision.proposal_id), receipt = checkedReceipt(decision);
          if (!found || !receipt || receipt.proposalId !== found.proposal.proposalId || receipt.decisionId !== command.operationId) return invalid();
          if (!scoped(principal,found.proposal.resourceScope)) return denied('FORBIDDEN');
          try { return {ok:true,kind:'proposalDecision',receipt:decisionSummary(receipt),receiptDigest:decision.receipt_digest}; }
          catch { return invalid(); }
        }
        const generated = db.prepare('SELECT proposal_id FROM scheduling_proposals WHERE generation_operation_id=?').get(command.operationId);
        if (generated) {
          const found = checkedProposal(generated.proposal_id);
          if (!found || found.proposal.generationOperationId !== command.operationId) return invalid();
          const proposal = found.proposal;
          return scoped(principal,proposal.resourceScope) ? {ok:true,kind:'proposalGeneration',receipt:{operationId:command.operationId,proposalId:proposal.proposalId,status:found.lifecycle.status,inputDigest:proposal.inputDigest,resultDigest:proposal.resultDigest,configDigest:proposal.configDigest,baseScheduleRevision:proposal.baseScheduleRevision}} : denied('FORBIDDEN');
        }
        return denied('OPERATION_NOT_FOUND');
      });
    },
  });
}
