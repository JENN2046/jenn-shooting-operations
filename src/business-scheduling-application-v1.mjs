import {createBusinessRunV3} from './business-run-v3.mjs';
import {createBusinessOrderV3} from './business-order-v3.mjs';
import { createDynamicDayAdjustment, validateDynamicReceiptRow } from './dynamic-day-adjustment-v1.mjs';
import { businessInitialResource, businessInitialConfig, businessInitialConfigV3 } from './business-defaults-v1.mjs';
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
    if (old.schemaVersion >= 2) {
      const pastRules = c => c.rules.filter(r => r.effectiveFrom < today);
      if (canonicalJsonSchedulingV1(pastRules(previous)) !== canonicalJsonSchedulingV1(pastRules(next))) return denied('PAST_CALENDAR_CHANGE_FORBIDDEN');
    } else if (canonicalJsonSchedulingV1(previous.weeklyWindows) !== canonicalJsonSchedulingV1(next.weeklyWindows)) {
      return denied('V1_RECURRING_CHANGE_REQUIRES_V2');
    }
  }
  return { ok: true };
}

export function createBusinessSchedulingApplication({ db, writeAdmissionControl, clock, refreshProjections, proposalStore }) {
  const businessSchemaReady = () => Boolean(db.prepare(`SELECT 1 FROM schema_migrations
    WHERE version = 11 AND name = 'business_calendar_and_reschedule'`).get());
  const requireBusinessSchema = () => businessSchemaReady() ? null : denied('BUSINESS_SCHEMA11_REQUIRED');
  const active = () => db.prepare(`SELECT v.* FROM scheduling_active_config a JOIN scheduling_config_versions v
    ON v.config_version=a.config_version WHERE a.id=1`).get();
  const configScope = command => command?.configJson?.resourceCalendars?.map(c => c.resourceId);
  const guard = ({ configRow, at }) => {
    const past = preservePastRules(db, JSON.parse(configRow.config_json), at);
    return past.ok ? checkBusinessCalendarImpact({ db, configRow, at }) : past;
  };
  // Unassigned requests are global. Only an administrator covering the entire
  // registered catalogue may inspect or edit their estimates.
  const ownsRequestCatalogue = principal => {
    const ids = db.prepare('SELECT resource_id FROM scheduling_resources').all().map(r => r.resource_id);
    return scoped(principal, ids, true);
  };
  const ownsRequest = (principal, requestId) => ownsRequestCatalogue(principal)
    && db.prepare(`SELECT s.resource_id,s.resource_resolution_status FROM schedule_item_tasks b
      JOIN schedule_items s ON s.id=b.schedule_item_id WHERE b.task_id=?`).all(requestId)
      .every(r => r.resource_resolution_status === 'resolved' && principal.resourceIds.includes(r.resource_id));
  const adminStore = createSqliteSchedulingAdminStoreV1({ db, now: clock, refreshProjections, validateActivation: guard });
  const reschedules = createSqliteScheduleRescheduleStoreV1({ db, now: clock, refreshProjections,
    writeAdmission: () => !writeAdmissionControl.isDisabled() });
  const runEvent = createBusinessRunV3({db,now:clock,writeAdmission:()=>!writeAdmissionControl.isDisabled()});
  const orders = createBusinessOrderV3({db,now:clock,refreshProjections,writeAdmission:()=>!writeAdmissionControl.isDisabled()});
  const dynamic = createDynamicDayAdjustment({db,now:clock,refreshProjections,writeAdmission:()=>!writeAdmissionControl.isDisabled()});
  const permitWrite = () => !writeAdmissionControl.isDisabled();
  return {
    authorizeReferenceUpload({principal,operationId}) {
      if(!db.prepare('SELECT 1 FROM schema_migrations WHERE version=12').get())return denied('BUSINESS_SCHEMA12_REQUIRED');
      if(!ownsRequestCatalogue(principal))return denied('FORBIDDEN');
      if(db.prepare('SELECT 1 FROM operations WHERE operation_id=?').get(operationId))return denied('UPLOAD_ORDER_ALREADY_SAVED');
      return {ok:true};
    },
    authorizeReferenceRead({principal,uploadId}) {
      if(!db.prepare('SELECT 1 FROM schema_migrations WHERE version=12').get())return denied('BUSINESS_SCHEMA12_REQUIRED');
      const asset=db.prepare('SELECT * FROM uploads WHERE id=? AND kind=?').get(uploadId,'image');
      if(!asset?.claimed_task_id||!ownsRequest(principal,asset.claimed_task_id))return denied('FORBIDDEN');
      return {ok:true};
    },
    readBoard({principal}) {
      if(!db.prepare('SELECT 1 FROM schema_migrations WHERE version=12').get())return denied('BUSINESS_SCHEMA12_REQUIRED');
      if(!ownsRequestCatalogue(principal))return denied('FORBIDDEN');
      return this.readManagement({principal});
    },
    recordActualEvent(input) {return db.prepare('SELECT 1 FROM schema_migrations WHERE version=12').get()?runEvent(input):denied('BUSINESS_SCHEMA12_REQUIRED');},
    createOrder(input) {return db.prepare('SELECT 1 FROM schema_migrations WHERE version=12').get()?orders.create(input):denied('BUSINESS_SCHEMA12_REQUIRED');},
    editOrder(input) {return db.prepare('SELECT 1 FROM schema_migrations WHERE version=12').get()?orders.edit(input):denied('BUSINESS_SCHEMA12_REQUIRED');},
    readManagement({ principal }) {
      const schema = requireBusinessSchema(); if (schema) return schema;
      if (!scoped(principal, principal?.resourceIds)) return denied('FORBIDDEN');
      const resources = db.prepare(`SELECT resource_id, v1_display_place, status, capability_json,
        capability_digest FROM scheduling_resources ORDER BY resource_id`).all().filter(r => principal.resourceIds.includes(r.resource_id));
      const versions = db.prepare(`SELECT * FROM scheduling_config_versions ORDER BY published_at DESC, config_version DESC`).all()
        .filter(v => scoped(principal, JSON.parse(v.config_json).resourceCalendars.map(c => c.resourceId)));
      const current = active();
      const today=dateAt(clock().toISOString(),'Asia/Shanghai');
      const initialResource=businessInitialResource(principal.resourceIds[0]);
      const orderRows=ownsRequestCatalogue(principal)?db.prepare('SELECT * FROM requests_v2 ORDER BY source_ordinal').all().filter(r=>ownsRequest(principal,r.id)):[];
      // Confirmed estimates live in immutable adjustment receipts, independently of the plan.
      // Revision ordering remains deterministic even when multiple confirmations share a clock tick.
      const forecasts=new Map();
      for(const row of db.prepare(`SELECT r.* FROM schedule_reschedule_operations r
        JOIN operations o ON o.operation_id=r.operation_id WHERE o.kind='dynamicDayAdjustment'`).all()) {
        if(!principal.resourceIds.includes(row.resource_id))continue;
        const receipt=validateDynamicReceiptRow(row),input=receipt.preview.input;
        if(input.mode!=='forecast')continue;
        const prior=forecasts.get(input.scheduleItemId);
        if(!prior||receipt.scheduleRevision>prior.scheduleRevision)forecasts.set(input.scheduleItemId,{
          estimatedEnd:input.endAt,bufferAfterMinutes:input.bufferAfterMinutes,
          confirmedAt:receipt.createdAt,operationId:receipt.operationId,scheduleRevision:receipt.scheduleRevision});
      }
      const orderFacts=orderRows.map(r=>({references:db.prepare("SELECT id,original_name AS name,content_type AS contentType,size FROM uploads WHERE claimed_task_id=? AND kind='image' ORDER BY claimed_order,id").all(r.id),id:r.id,name:r.name,kind:r.kind,shootingSubtype:r.shooting_subtype,lifecycle:r.request_lifecycle,
        editable:r.request_lifecycle==='open'&&!db.prepare('SELECT 1 FROM schedule_item_tasks WHERE task_id=?').get(r.id)&&!db.prepare('SELECT 1 FROM production_runs WHERE task_id=?').get(r.id),
        submission:{schemaVersion:3,productionType:r.production_type,sku:r.sku,name:r.name,kind:r.kind,shootingSubtype:r.shooting_subtype,aspectRatio:r.aspect_ratio,
          deliverables:{type:'flat',count:r.deliverable_count},requestedBy:r.requested_by,desiredDate:r.desired_date,note:r.note??'',coreBriefSummary:r.core_brief_summary??'',sampleStatus:r.sample_status,lightingPreset:r.lighting_preset,reflectivity:r.reflectivity,priority:r.priority,uploadIds:[]}}));
      return { ok: true, protocolVersion:db.prepare('SELECT 1 FROM schema_migrations WHERE version=12').get()?3:2,orderFacts, businessToday:today, initialResource, initialConfig:(db.prepare("SELECT 1 FROM schema_migrations WHERE version=12").get()?businessInitialConfigV3:businessInitialConfig)(initialResource,today), principal: { subjectId: principal.subjectId, role: principal.role, resourceIds: principal.resourceIds },
        revisions: db.prepare('SELECT schedule_revision AS scheduleRevision, projection_revision AS projectionRevision FROM revision_counters WHERE id=1').get() ?? null,
        resources, configs: versions.map(v => ({ configVersion: v.config_version, publishedAt: v.published_at, configJson: JSON.parse(v.config_json), configDigest: v.config_digest,
          calendarCompilerVersion: v.calendar_compiler_version, active: v.config_version === current?.config_version,
          everActive: Boolean(db.prepare('SELECT 1 FROM scheduling_config_activations WHERE config_version=? LIMIT 1').get(v.config_version)) })),
        sessions: db.prepare(`SELECT id, resource_id AS resourceId, planned_start AS plannedStart, planned_end AS plannedEnd,
          buffer_after_minutes AS bufferAfterMinutes, schedule_status AS status, lock_status AS lockStatus,
          EXISTS(SELECT 1 FROM production_runs r WHERE r.schedule_item_id=s.id) AS hasRunHistory
          FROM schedule_items s ORDER BY planned_start,id`).all().filter(s => principal.resourceIds.includes(s.resourceId)).map(s=>({...s,requestIds:db.prepare('SELECT task_id FROM schedule_item_tasks WHERE schedule_item_id=? ORDER BY display_order').all(s.id).map(r=>r.task_id),confirmedForecast:forecasts.get(s.id)??null,runs:db.prepare('SELECT id,status,run_revision AS runRevision,started_at AS startedAt,completed_at AS completedAt FROM production_runs WHERE schedule_item_id=? ORDER BY created_at,id').all(s.id),requestNames:db.prepare('SELECT r.name FROM schedule_item_tasks b JOIN requests_v2 r ON r.id=b.task_id WHERE b.schedule_item_id=? ORDER BY b.display_order').all(s.id).map(r=>r.name)})),
        requests: ownsRequestCatalogue(principal) ? db.prepare(`SELECT r.id,r.name,r.kind,r.sample_status AS sampleStatus,r.priority,r.production_type AS productionType,
          r.shooting_subtype AS shootingSubtype,q.duration_estimate_json AS durationEstimateJson
          FROM requests_v2 r LEFT JOIN scheduling_request_requirements q ON q.request_id=r.id
          WHERE r.request_lifecycle='open' ORDER BY r.id`).all().filter(r => ownsRequest(principal,r.id)) : [],
        writeAdmission: writeAdmissionControl.status().mode };
    },
    previewDayAdjustment({command,principal}) { const schema=requireBusinessSchema();return schema??dynamic.preview(command,principal); },
    applyDayAdjustment({command,principal}) { const schema=requireBusinessSchema();return schema??dynamic.apply(command,principal); },
    setRequestDuration({ command, principal }) {
      const schema = requireBusinessSchema(); if (schema) return schema;
      if (!permitWrite()) return denied('WRITE_ADMISSION_DISABLED');
      if (!ownsRequestCatalogue(principal)) return denied('FORBIDDEN');
      const keys=['operationId','requestId','expectedScheduleRevision','expectedProjectionRevision','durationMinutes'];
      if (!command || Object.keys(command).length!==keys.length || !keys.every(k=>Object.hasOwn(command,k))
        || !Number.isSafeInteger(command.durationMinutes) || command.durationMinutes<1 || command.durationMinutes>1440)
        return denied('INVALID_REQUEST');
      if (typeof command.requestId!=='string' || !ownsRequest(principal,command.requestId)) return denied('FORBIDDEN');
      const request=db.prepare('SELECT production_type,shooting_subtype,request_lifecycle FROM requests_v2 WHERE id=?').get(command.requestId);
      if (!request) return denied('REQUEST_NOT_FOUND');
      if (request.request_lifecycle!=='open') return denied('REQUEST_NOT_OPEN');
      if (request.production_type!=='平面' || !['细节','模特','场景','产品3D主图','细节图','功能图'].includes(request.shooting_subtype)) return denied('REQUEST_TYPE_UNSUPPORTED');
      const existing=db.prepare('SELECT required_capability_ids_json FROM scheduling_request_requirements WHERE request_id=?').get(command.requestId);
      const {durationMinutes,...binding}=command;
      return adminStore.setRequestRequirements({...binding,
        requiredCapabilityIds: existing ? JSON.parse(existing.required_capability_ids_json) : ['FLAT'],
        durationEstimate:{durationMs:durationMinutes*60000,source:'explicit',sourceVersion:'business-duration-v1'}},principal.subjectId);
    },
    previewConfig({ command, principal }) {
      const schema = requireBusinessSchema(); if (schema) return schema;
      if (!command || !scoped(principal, configScope(command), true)) return denied('FORBIDDEN');
      if (Object.keys(command).length!==3 || !['configJson','expectedProjectionRevision','baseConfigDigest'].every(k=>Object.hasOwn(command,k))
        || !Number.isSafeInteger(command.expectedProjectionRevision) || command.expectedProjectionRevision<0
        || !(command.baseConfigDigest===null || /^sha256:[a-f0-9]{64}$/.test(command.baseConfigDigest))) return denied('INVALID_REQUEST');
      const before=db.prepare('SELECT projection_revision FROM revision_counters WHERE id=1').get();
      if (before?.projection_revision!==command.expectedProjectionRevision || (active()?.config_digest??null)!==command.baseConfigDigest) return denied('SCHEDULING_REVISION_CONFLICT');
      const n = normalizeSchedulingConfig(command.configJson);
      if (!n.ok) return n;
      const row = { config_json: n.configJson, config_digest: n.configDigest,
        calendar_compiler_version: `calendar-compiler-v${n.config.schemaVersion}` };
      const impact = guard({ configRow: row, at: clock().toISOString() });
      return { ok: true, configJson: n.config, configDigest: n.configDigest, impact,
        expectedProjectionRevision: command.expectedProjectionRevision, baseConfigDigest: command.baseConfigDigest };
    },
    manage({ kind, command, principal }) {
      const schema = requireBusinessSchema(); if (schema) return schema;
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
      const schema = requireBusinessSchema(); if (schema) return schema;
      if (!scoped(principal, principal?.resourceIds)) return denied('FORBIDDEN');
      const own=db.prepare('SELECT kind,response_json FROM operations WHERE operation_id=?').get(operationId);
      if(own && ['business.order.create.v3','business.order.edit.v3','business.run.v3','business.notificationPolicy.v3'].includes(own.kind)){
        const receipt=JSON.parse(own.response_json);
        if(principal.role!=='administrator'||(receipt.actor&&receipt.actor!==principal.subjectId))return denied('FORBIDDEN');
        if(receipt.requestId&&!ownsRequest(principal,receipt.requestId))return denied('FORBIDDEN');
        if(receipt.runId){const row=db.prepare('SELECT s.resource_id FROM production_runs r JOIN schedule_items s ON s.id=r.schedule_item_id WHERE r.id=?').get(receipt.runId);if(!row||!principal.resourceIds.includes(row.resource_id))return denied('FORBIDDEN');}
        if(receipt.resourceIds&&!scoped(principal,receipt.resourceIds,true))return denied('FORBIDDEN');
        return {ok:true,kind:own.kind,receipt};
      }
      const reschedule = reschedules.readOperation(operationId, principal);
      if (reschedule.ok || reschedule.code!=='RESCHEDULE_OPERATION_NOT_FOUND') return reschedule;
      const row = db.prepare('SELECT kind,response_json FROM scheduling_admin_operations WHERE operation_id=?').get(operationId);
      if (row) {
        const receipt = JSON.parse(row.response_json);
        if (row.kind === 'setRequestRequirements') {
          if (!ownsRequest(principal,receipt.requestId)) return denied('FORBIDDEN');
          return {ok:true,kind:row.kind,receipt};
        }
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
      const schema = requireBusinessSchema(); if (schema) return schema;
      if (!permitWrite()) return denied('WRITE_ADMISSION_DISABLED');
      if (!scoped(principal, command?.resourceScope)) return denied('FORBIDDEN');
      return proposalStore.generate(command, principal.subjectId);
    },
    readBusinessProposal({ proposalId, principal }) {
      const schema = requireBusinessSchema(); if (schema) return schema;
      if (!scoped(principal, principal?.resourceIds)) return denied('FORBIDDEN');
      const found = proposalStore.read(proposalId);
      return !found.ok || scoped(principal, found.proposal.resourceScope) ? found : denied('FORBIDDEN');
    },
    reschedule({ command, principal, executionGuard }) {
      const schema = requireBusinessSchema(); if (schema) return schema;
      return reschedules.reschedule(command, principal, { executionGuard });
    },
  };
}
