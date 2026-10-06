import { businessInitialResource, businessInitialConfig } from './business-defaults-v1.mjs';
import { createSqliteSchedulingAdminStoreV1 } from './sqlite-scheduling-admin-store-v1.mjs';
import { createSqliteScheduleRescheduleStoreV1 } from './sqlite-schedule-reschedule-store-v1.mjs';
import { normalizeSchedulingConfig, compileSchedulingCalendarDate } from './scheduling-admin-contract-v2.mjs';
import { canonicalJsonSchedulingV1, SCHEDULING_TIME_ZONE_DATA_VERSION } from './scheduling-contract-v1.mjs';
import { validateTrustedPrincipal } from './authorization-v2.mjs';

const denied = code => ({ ok: false, code });
const scoped = (p, ids, admin = false) => validateTrustedPrincipal(p).ok
  && (admin ? p.role === 'administrator' : ['scheduler', 'administrator'].includes(p.role))
  && Array.isArray(ids) && ids.length > 0 && ids.every(id => p.resourceIds.includes(id));
const dateAt = (instant, zone) => new Intl.DateTimeFormat('en-CA', {
  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(instant));

// Pure rule compilation and read-only occupancy checks; caller owns the activation transaction.
export function checkBusinessCalendarImpact({ db, configRow, at }) {
  let config;
  try { config = JSON.parse(configRow.config_json); } catch { return denied('CONFIG_INVALID'); }
  const admitted = normalizeSchedulingConfig(config);
  if (!admitted.ok || admitted.configDigest !== configRow.config_digest) return denied('CONFIG_INVALID');
  const conflicts = [];
  for (const row of db.prepare(`SELECT id, resource_id, resource_resolution_status, planned_start,
    planned_end, buffer_after_minutes FROM schedule_items WHERE schedule_status <> 'cancelled'
    AND (buffer_after_minutes IS NULL OR julianday(planned_end) + buffer_after_minutes / 1440.0 >= julianday(?)) ORDER BY id`).all(at)) {
    let fits = false;
    if (row.resource_resolution_status === 'resolved' && row.buffer_after_minutes !== null) {
      const result = compileSchedulingCalendarDate({ configJson: config, resourceId: row.resource_id,
        date: dateAt(row.planned_start, config.businessTimeZone),
        calendarCompilerVersion: configRow.calendar_compiler_version,
        timeZoneDataVersion: SCHEDULING_TIME_ZONE_DATA_VERSION });
      const start = Date.parse(row.planned_start);
      const end = Date.parse(row.planned_end) + row.buffer_after_minutes * 60_000;
      fits = result.ok && result.windows.some(w => start >= Date.parse(w.start) && end <= Date.parse(w.end));
    }
    if (!fits) conflicts.push({ scheduleItemId: row.id, resourceId: row.resource_id, code: 'EXISTING_SESSION_OUTSIDE_CALENDAR' });
  }
  return conflicts.length ? { ok: false, code: 'CALENDAR_HAS_CONFLICTS', conflicts } : { ok: true, conflicts };
}

function preservePastRules(db, config, at) {
  const row = db.prepare(`SELECT v.config_json FROM scheduling_active_config a
    JOIN scheduling_config_versions v ON v.config_version=a.config_version WHERE a.id=1`).get();
  if (!row) return { ok: true };
  const old = JSON.parse(row.config_json);
  if (old.businessTimeZone !== config.businessTimeZone) return denied('BUSINESS_TIMEZONE_CHANGE_UNSUPPORTED');
  // A v1 -> v2 transition needs the separate migration review, not a silently rewritten past.
  if (old.schemaVersion !== config.schemaVersion) return denied('CONFIG_SCHEMA_TRANSITION_REQUIRES_REVIEW');
  const today = dateAt(at, config.businessTimeZone);
  for (const previous of old.resourceCalendars) {
    const next = config.resourceCalendars.find(c => c.resourceId === previous.resourceId);
    if (!next) return denied('RESOURCE_CALENDAR_REMOVAL_UNSUPPORTED');
    const pastOverrides = c => c.dateOverrides.filter(d => d.date < today);
    if (canonicalJsonSchedulingV1(pastOverrides(previous)) !== canonicalJsonSchedulingV1(pastOverrides(next))) return denied('PAST_CALENDAR_CHANGE_FORBIDDEN');
    if (old.schemaVersion === 2) {
      const pastRules = c => c.rules.filter(r => r.effectiveFrom < today);
      if (canonicalJsonSchedulingV1(pastRules(previous)) !== canonicalJsonSchedulingV1(pastRules(next))) return denied('PAST_CALENDAR_CHANGE_FORBIDDEN');
    } else if (canonicalJsonSchedulingV1(previous.weeklyWindows) !== canonicalJsonSchedulingV1(next.weeklyWindows)) {
      return denied('V1_RECURRING_CHANGE_REQUIRES_V2');
    }
  }
  return { ok: true };
}

export function createBusinessSchedulingApplication({ db, writeAdmissionControl, clock, refreshProjections, proposalStore }) {
  const active = () => db.prepare(`SELECT v.* FROM scheduling_active_config a JOIN scheduling_config_versions v
    ON v.config_version=a.config_version WHERE a.id=1`).get();
  const configScope = command => command?.configJson?.resourceCalendars?.map(c => c.resourceId);
  const guard = ({ configRow, at }) => {
    const past = preservePastRules(db, JSON.parse(configRow.config_json), at);
    return past.ok ? checkBusinessCalendarImpact({ db, configRow, at }) : past;
  };
  const adminStore = createSqliteSchedulingAdminStoreV1({ db, now: clock, refreshProjections, validateActivation: guard });
  const reschedules = createSqliteScheduleRescheduleStoreV1({ db, now: clock, refreshProjections,
    writeAdmission: () => !writeAdmissionControl.isDisabled() });
  const permitWrite = () => !writeAdmissionControl.isDisabled();
  return {
    readManagement({ principal }) {
      if (!scoped(principal, principal?.resourceIds)) return denied('FORBIDDEN');
      const resources = db.prepare(`SELECT resource_id, v1_display_place, status, capability_json,
        capability_digest FROM scheduling_resources ORDER BY resource_id`).all().filter(r => principal.resourceIds.includes(r.resource_id));
      const versions = db.prepare(`SELECT * FROM scheduling_config_versions ORDER BY published_at DESC, config_version DESC`).all()
        .filter(v => scoped(principal, JSON.parse(v.config_json).resourceCalendars.map(c => c.resourceId)));
      const current = active();
      const today=dateAt(clock().toISOString(),'Asia/Shanghai');
      const initialResource=businessInitialResource(principal.resourceIds[0]);
      return { ok: true, businessToday:today, initialResource, initialConfig:businessInitialConfig(initialResource,today), principal: { subjectId: principal.subjectId, role: principal.role, resourceIds: principal.resourceIds },
        revisions: db.prepare('SELECT schedule_revision AS scheduleRevision, projection_revision AS projectionRevision FROM revision_counters WHERE id=1').get() ?? null,
        resources, configs: versions.map(v => ({ configVersion: v.config_version, publishedAt: v.published_at, configJson: JSON.parse(v.config_json), configDigest: v.config_digest,
          calendarCompilerVersion: v.calendar_compiler_version, active: v.config_version === current?.config_version,
          everActive: Boolean(db.prepare('SELECT 1 FROM scheduling_config_activations WHERE config_version=? LIMIT 1').get(v.config_version)) })),
        sessions: db.prepare(`SELECT id, resource_id AS resourceId, planned_start AS plannedStart, planned_end AS plannedEnd,
          buffer_after_minutes AS bufferAfterMinutes, schedule_status AS status, lock_status AS lockStatus,
          EXISTS(SELECT 1 FROM production_runs r WHERE r.schedule_item_id=s.id) AS hasRunHistory
          FROM schedule_items s ORDER BY planned_start,id`).all().filter(s => principal.resourceIds.includes(s.resourceId)).map(s=>({...s,requestNames:db.prepare('SELECT r.name FROM schedule_item_tasks b JOIN requests_v2 r ON r.id=b.task_id WHERE b.schedule_item_id=? ORDER BY b.display_order').all(s.id).map(r=>r.name)})),
        writeAdmission: writeAdmissionControl.status().mode };
    },
    previewConfig({ command, principal }) {
      if (!command || !scoped(principal, configScope(command), true)) return denied('FORBIDDEN');
      if (Object.keys(command).length!==3 || !['configJson','expectedProjectionRevision','baseConfigDigest'].every(k=>Object.hasOwn(command,k))
        || !Number.isSafeInteger(command.expectedProjectionRevision) || command.expectedProjectionRevision<0
        || !(command.baseConfigDigest===null || /^sha256:[a-f0-9]{64}$/.test(command.baseConfigDigest))) return denied('INVALID_REQUEST');
      const before=db.prepare('SELECT projection_revision FROM revision_counters WHERE id=1').get();
      if (before?.projection_revision!==command.expectedProjectionRevision || (active()?.config_digest??null)!==command.baseConfigDigest) return denied('SCHEDULING_REVISION_CONFLICT');
      const n = normalizeSchedulingConfig(command.configJson);
      if (!n.ok) return n;
      const row = { config_json: n.configJson, config_digest: n.configDigest,
        calendar_compiler_version: n.config.schemaVersion === 2 ? 'calendar-compiler-v2' : 'calendar-compiler-v1' };
      const impact = guard({ configRow: row, at: clock().toISOString() });
      return { ok: true, configJson: n.config, configDigest: n.configDigest, impact,
        expectedProjectionRevision: command.expectedProjectionRevision, baseConfigDigest: command.baseConfigDigest };
    },
    manage({ kind, command, principal }) {
      if (!permitWrite()) return denied('WRITE_ADMISSION_DISABLED');
      if (!scoped(principal, principal?.resourceIds, true)) return denied('FORBIDDEN');
      if (kind === 'registerResource') {
        if (!scoped(principal, [command?.resource?.resourceId], true)) return denied('FORBIDDEN');
        return adminStore.registerResource(command, principal.subjectId);
      }
      if (kind === 'publishConfig') {
        if (!scoped(principal, configScope(command), true)) return denied('FORBIDDEN');
        return adminStore.publishConfig(command, principal.subjectId);
      }
      if (kind === 'activateConfig') {
        const row = db.prepare('SELECT config_json FROM scheduling_config_versions WHERE config_version=?').get(command?.configVersion ?? '');
        if (!row) return denied('CONFIG_VERSION_NOT_FOUND');
        if (!scoped(principal, JSON.parse(row.config_json).resourceCalendars.map(c => c.resourceId), true)) return denied('FORBIDDEN');
        return adminStore.activateConfig(command, principal.subjectId);
      }
      return denied('INVALID_REQUEST');
    },
    readBusinessOperation({ operationId, principal }) {
      if (!scoped(principal, principal?.resourceIds)) return denied('FORBIDDEN');
      const reschedule = reschedules.readOperation(operationId, principal);
      if (reschedule.ok) return reschedule;
      const row = db.prepare('SELECT kind,response_json FROM scheduling_admin_operations WHERE operation_id=?').get(operationId);
      if (row) {
        const receipt = JSON.parse(row.response_json);
        const ids = receipt.resourceId ? [receipt.resourceId] : (() => {
          const v=db.prepare('SELECT config_json FROM scheduling_config_versions WHERE config_version=?').get(receipt.configVersion ?? '');
          return v ? JSON.parse(v.config_json).resourceCalendars.map(c=>c.resourceId) : [];
        })();
        if (!scoped(principal, ids, true)) return denied('FORBIDDEN');
        return { ok: true, kind: row.kind, receipt };
      }
      const proposal = db.prepare('SELECT proposal_id FROM scheduling_proposals WHERE generation_operation_id=?').get(operationId);
      if (proposal) return this.readBusinessProposal({ proposalId: proposal.proposal_id, principal });
      const decision = db.prepare('SELECT proposal_id,receipt_json FROM scheduling_proposal_decisions WHERE decision_id=?').get(operationId);
      if (decision) {
        const access=this.readBusinessProposal({proposalId:decision.proposal_id,principal});
        return access.ok ? {ok:true,receipt:JSON.parse(decision.receipt_json)} : access;
      }
      return denied('OPERATION_NOT_FOUND');
    },
    generateProposal({ command, principal }) {
      if (!permitWrite()) return denied('WRITE_ADMISSION_DISABLED');
      if (!scoped(principal, command?.resourceScope)) return denied('FORBIDDEN');
      return proposalStore.generate(command, principal.subjectId);
    },
    readBusinessProposal({ proposalId, principal }) {
      if (!scoped(principal, principal?.resourceIds)) return denied('FORBIDDEN');
      const found = proposalStore.read(proposalId);
      return !found.ok || scoped(principal, found.proposal.resourceScope) ? found : denied('FORBIDDEN');
    },
    reschedule({ command, principal, executionGuard }) { return reschedules.reschedule(command, principal, { executionGuard }); },
  };
}
