import {
  canonicalJsonSchedulingV1, digestCanonicalJsonSchedulingV1,
  isSchedulingIdentifierV1,
} from './scheduling-contract-v1.mjs';
import {
  normalizeActivateSchedulingConfigV1,
  normalizePublishSchedulingConfigV1,
  normalizeRegisterSchedulingResourceV1,
  normalizeReplaceSchedulingResourceV1,
} from './scheduling-admin-contract-v1.mjs';
import { staleDraftProposalsInTransactionV1 } from './sqlite-scheduling-proposal-store-v1.mjs';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
function denied(code) { return Object.freeze({ ok: false, code }); }

function codePointCompare(left, right) {
  const a = Array.from(left, character => character.codePointAt(0));
  const b = Array.from(right, character => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function admitRequestRequirements(input) {
  try {
    if (!input || Object.getPrototypeOf(input) !== Object.prototype
      || Reflect.ownKeys(input).length !== 6
      || !['operationId', 'expectedScheduleRevision', 'expectedProjectionRevision',
        'requestId', 'requiredCapabilityIds', 'durationEstimate'].every(key => Object.hasOwn(input, key))
      || !isSchedulingIdentifierV1(input.operationId)
      || !isSchedulingIdentifierV1(input.requestId)
      || !Number.isSafeInteger(input.expectedScheduleRevision)
      || input.expectedScheduleRevision < 0
      || !Number.isSafeInteger(input.expectedProjectionRevision)
      || input.expectedProjectionRevision < 0
      || !Array.isArray(input.requiredCapabilityIds)
      || input.requiredCapabilityIds.some(id => !isSchedulingIdentifierV1(id))) {
      return denied('SCHEDULING_REQUEST_REQUIREMENTS_INVALID');
    }
    const ids = input.requiredCapabilityIds.toSorted(codePointCompare);
    if (new Set(ids).size !== ids.length) return denied('SCHEDULING_REQUEST_REQUIREMENTS_INVALID');
    let durationEstimate = null;
    if (input.durationEstimate !== null) {
      const value = input.durationEstimate;
      if (!value || Object.getPrototypeOf(value) !== Object.prototype
        || Reflect.ownKeys(value).length !== 3
        || !['durationMs', 'source', 'sourceVersion'].every(key => Object.hasOwn(value, key))
        || !Number.isSafeInteger(value.durationMs) || value.durationMs <= 0
        || value.source !== 'explicit' || !isSchedulingIdentifierV1(value.sourceVersion, 128)) {
        return denied('SCHEDULING_REQUEST_REQUIREMENTS_INVALID');
      }
      durationEstimate = { durationMs: value.durationMs, source: 'explicit',
        sourceVersion: value.sourceVersion,
      };
    }
    const command = { operationId: input.operationId,
      expectedScheduleRevision: input.expectedScheduleRevision,
      expectedProjectionRevision: input.expectedProjectionRevision,
      requestId: input.requestId, requiredCapabilityIds: ids, durationEstimate,
    };
    return { ok: true, command, commandDigest: digestCanonicalJsonSchedulingV1({
      domain: 'scheduling-request-requirements-command-v1',
      expectedScheduleRevision: command.expectedScheduleRevision,
      expectedProjectionRevision: command.expectedProjectionRevision,
      requestId: command.requestId, requiredCapabilityIds: ids, durationEstimate,
    }) };
  } catch { return denied('SCHEDULING_REQUEST_REQUIREMENTS_INVALID'); }
}

function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function counters(db) {
  return db.prepare(`SELECT schedule_revision, projection_revision
    FROM revision_counters WHERE id = 1`).get() ?? null;
}

function replay(db, operationId, commandDigest) {
  const row = db.prepare(`SELECT command_digest, response_json
    FROM scheduling_admin_operations WHERE operation_id = ?`).get(operationId);
  if (!row) return null;
  return row.command_digest === commandDigest
    ? { ok: true, ...JSON.parse(row.response_json), exactReplay: true }
    : denied('IDEMPOTENCY_KEY_REUSE');
}

function saveOperation(db, { operationId, commandDigest, kind, response, at }) {
  db.prepare(`INSERT INTO scheduling_admin_operations
    (operation_id, command_digest, kind, response_json, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(operationId, commandDigest, kind,
    canonicalJsonSchedulingV1(response), at);
  return { ok: true, ...response, exactReplay: false };
}

function advanceRevisions(db, current, { schedule, projection, at }) {
  if (current.schedule_revision > MAX_SAFE - schedule
    || current.projection_revision > MAX_SAFE - projection) return null;
  const next = {
    scheduleRevision: current.schedule_revision + schedule,
    projectionRevision: current.projection_revision + projection,
  };
  const changed = db.prepare(`UPDATE revision_counters
    SET schedule_revision = ?, projection_revision = ?, updated_at = ?
    WHERE id = 1 AND schedule_revision = ? AND projection_revision = ?`).run(
    next.scheduleRevision, next.projectionRevision, at,
    current.schedule_revision, current.projection_revision,
  ).changes;
  return changed === 1 ? next : null;
}

/** Internal-only canonical admin commands. Projection refresh is an injected same-transaction port. */
export function createSqliteSchedulingAdminStoreV1({ db, now, refreshProjections } = {}) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function'
    || typeof now !== 'function') throw new TypeError('SQLite db and injected clock required');

  function trusted(actor) {
    return isSchedulingIdentifierV1(actor) && actor !== 'system:scheduling-invalidation-v1';
  }

  function refresh(next, at) {
    if (typeof refreshProjections !== 'function') throw new Error('SCHEDULING_PROJECTION_NOT_CONFIGURED');
    refreshProjections({ db, projectionRevision: next.projectionRevision,
      scheduleRevision: next.scheduleRevision, updatedAt: at });
  }

  function resourceCommand(input, actor, replace) {
    const admitted = replace ? normalizeReplaceSchedulingResourceV1(input)
      : normalizeRegisterSchedulingResourceV1(input);
    if (!admitted.ok) return admitted;
    if (!trusted(actor)) return denied('TRUSTED_ADMIN_REQUIRED');
    if (typeof refreshProjections !== 'function') return denied('SCHEDULING_PROJECTION_NOT_CONFIGURED');
    const { command, commandDigest } = admitted;
    return transaction(db, () => {
      const prior = replay(db, command.operationId, commandDigest);
      if (prior) return prior;
      const current = counters(db);
      if (!current || current.schedule_revision !== command.expectedScheduleRevision
        || current.projection_revision !== command.expectedProjectionRevision) {
        return denied('SCHEDULING_REVISION_CONFLICT');
      }
      const existing = db.prepare(`SELECT resource_id, v1_display_place, status,
        capability_json, capability_digest FROM scheduling_resources
        WHERE resource_id = ?`).get(command.resource.resourceId);
      if ((replace && !existing) || (!replace && existing)) {
        return denied(replace ? 'RESOURCE_NOT_FOUND' : 'RESOURCE_ALREADY_EXISTS');
      }
      const labelOwner = db.prepare(`SELECT resource_id FROM scheduling_resources
        WHERE v1_display_place = ?`).get(command.resource.v1DisplayPlace);
      if (labelOwner && labelOwner.resource_id !== command.resource.resourceId) {
        return denied('RESOURCE_DISPLAY_PLACE_DUPLICATE');
      }
      const capabilityJson = canonicalJsonSchedulingV1(command.resource.capabilityJson);
      const changedCapacity = !existing || existing.status !== command.resource.status
        || existing.capability_digest !== command.resource.capabilityDigest;
      const changedLabel = !existing || existing.v1_display_place !== command.resource.v1DisplayPlace;
      if (replace && !changedCapacity && !changedLabel) {
        return saveOperation(db, { operationId: command.operationId, commandDigest,
          kind: 'replaceResource', response: { resourceId: command.resource.resourceId,
            scheduleRevision: current.schedule_revision,
            projectionRevision: current.projection_revision, noOp: true,
          }, at: now().toISOString(),
        });
      }
      const at = now().toISOString();
      if (replace) {
        db.prepare(`UPDATE scheduling_resources SET v1_display_place = ?, status = ?,
          capability_json = ?, capability_digest = ?, updated_at = ?, source_operation_id = ?
          WHERE resource_id = ?`).run(command.resource.v1DisplayPlace, command.resource.status,
          capabilityJson, command.resource.capabilityDigest, at, command.operationId,
          command.resource.resourceId);
      } else {
        db.prepare(`INSERT INTO scheduling_resources
          (resource_id, v1_display_place, status, capability_json, capability_digest,
           created_at, updated_at, source_operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          command.resource.resourceId, command.resource.v1DisplayPlace, command.resource.status,
          capabilityJson, command.resource.capabilityDigest, at, at, command.operationId,
        );
      }
      const next = advanceRevisions(db, current, {
        schedule: changedCapacity ? 1 : 0, projection: 1, at,
      });
      if (!next) throw new Error('SCHEDULING_REVISION_ADVANCE_FAILED');
      staleDraftProposalsInTransactionV1({ db, triggerOperationId: command.operationId,
        reasonCode: 'RESOURCE_CHANGED', now,
        resourceId: changedCapacity ? null : command.resource.resourceId,
      });
      refresh(next, at);
      return saveOperation(db, { operationId: command.operationId, commandDigest,
        kind: replace ? 'replaceResource' : 'registerResource',
        response: { resourceId: command.resource.resourceId,
          scheduleRevision: next.scheduleRevision,
          projectionRevision: next.projectionRevision, noOp: false,
        }, at,
      });
    });
  }

  return Object.freeze({
    registerResource(input, actor) { return resourceCommand(input, actor, false); },
    replaceResource(input, actor) { return resourceCommand(input, actor, true); },

    setRequestRequirements(input, actor) {
      const admitted = admitRequestRequirements(input);
      if (!admitted.ok) return admitted;
      if (!trusted(actor)) return denied('TRUSTED_ADMIN_REQUIRED');
      if (typeof refreshProjections !== 'function') return denied('SCHEDULING_PROJECTION_NOT_CONFIGURED');
      const { command, commandDigest } = admitted;
      return transaction(db, () => {
        const prior = replay(db, command.operationId, commandDigest);
        if (prior) return prior;
        const current = counters(db);
        if (!current || current.schedule_revision !== command.expectedScheduleRevision
          || current.projection_revision !== command.expectedProjectionRevision) {
          return denied('SCHEDULING_REVISION_CONFLICT');
        }
        if (!db.prepare(`SELECT 1 FROM requests_v2 WHERE id = ?`).get(command.requestId)) {
          return denied('REQUEST_NOT_FOUND');
        }
        const capabilityJson = canonicalJsonSchedulingV1(command.requiredCapabilityIds);
        const durationJson = command.durationEstimate === null ? null
          : canonicalJsonSchedulingV1(command.durationEstimate);
        const existing = db.prepare(`SELECT required_capability_ids_json, duration_estimate_json
          FROM scheduling_request_requirements WHERE request_id = ?`).get(command.requestId);
        const at = now().toISOString();
        if (existing?.required_capability_ids_json === capabilityJson
          && existing?.duration_estimate_json === durationJson) {
          return saveOperation(db, { operationId: command.operationId, commandDigest,
            kind: 'setRequestRequirements', response: { requestId: command.requestId,
              scheduleRevision: current.schedule_revision,
              projectionRevision: current.projection_revision, noOp: true,
            }, at,
          });
        }
        db.prepare(`INSERT INTO scheduling_request_requirements
          (request_id, required_capability_ids_json, duration_estimate_json,
           updated_at, source_operation_id) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(request_id) DO UPDATE SET
            required_capability_ids_json = excluded.required_capability_ids_json,
            duration_estimate_json = excluded.duration_estimate_json,
            updated_at = excluded.updated_at,
            source_operation_id = excluded.source_operation_id`).run(
              command.requestId, capabilityJson, durationJson, at, command.operationId,
            );
        const next = advanceRevisions(db, current, { schedule: 1, projection: 1, at });
        if (!next) throw new Error('SCHEDULING_REVISION_ADVANCE_FAILED');
        staleDraftProposalsInTransactionV1({ db, triggerOperationId: command.operationId,
          reasonCode: 'REQUEST_FACTS_CHANGED', now });
        refresh(next, at);
        return saveOperation(db, { operationId: command.operationId, commandDigest,
          kind: 'setRequestRequirements', response: { requestId: command.requestId,
            scheduleRevision: next.scheduleRevision,
            projectionRevision: next.projectionRevision, noOp: false,
          }, at,
        });
      });
    },

    publishConfig(input, actor) {
      const admitted = normalizePublishSchedulingConfigV1(input);
      if (!admitted.ok) return admitted;
      if (!trusted(actor)) return denied('TRUSTED_ADMIN_REQUIRED');
      const { command, commandDigest } = admitted;
      return transaction(db, () => {
        const prior = replay(db, command.operationId, commandDigest);
        if (prior) return prior;
        if (db.prepare(`SELECT 1 FROM scheduling_config_versions
          WHERE config_version = ?`).get(command.configVersion)) return denied('CONFIG_VERSION_EXISTS');
        for (const calendar of command.configJson.resourceCalendars) {
          const resource = db.prepare(`SELECT capability_digest FROM scheduling_resources
            WHERE resource_id = ?`).get(calendar.resourceId);
          if (!resource || resource.capability_digest !== calendar.capabilityDigest) {
            return denied('RESOURCE_CONFIG_MISMATCH');
          }
        }
        const at = now().toISOString();
        db.prepare(`INSERT INTO scheduling_config_versions
          (config_version, schema_version, algorithm_version, calendar_compiler_version,
           estimate_policy_version, config_json, config_digest, published_by, published_at,
           publish_operation_id) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            command.configVersion, command.algorithmVersion, command.calendarCompilerVersion,
            command.estimatePolicyVersion, canonicalJsonSchedulingV1(command.configJson),
            command.configDigest, actor, at, command.operationId,
          );
        return saveOperation(db, { operationId: command.operationId, commandDigest,
          kind: 'publishConfig', response: { configVersion: command.configVersion,
            configDigest: command.configDigest,
          }, at,
        });
      });
    },

    activateConfig(input, actor) {
      const admitted = normalizeActivateSchedulingConfigV1(input);
      if (!admitted.ok) return admitted;
      if (!trusted(actor)) return denied('TRUSTED_ADMIN_REQUIRED');
      if (typeof refreshProjections !== 'function') return denied('SCHEDULING_PROJECTION_NOT_CONFIGURED');
      const { command, commandDigest } = admitted;
      return transaction(db, () => {
        const prior = replay(db, command.operationId, commandDigest);
        if (prior) return prior;
        const current = counters(db);
        if (!current || current.projection_revision !== command.expectedProjectionRevision) {
          return denied('SCHEDULING_REVISION_CONFLICT');
        }
        if (!db.prepare(`SELECT 1 FROM scheduling_config_versions
          WHERE config_version = ?`).get(command.configVersion)) return denied('CONFIG_VERSION_NOT_FOUND');
        const previous = db.prepare(`SELECT config_version FROM scheduling_active_config
          WHERE id = 1`).get()?.config_version ?? null;
        if (previous === command.configVersion) return denied('CONFIG_ALREADY_ACTIVE');
        const at = now().toISOString();
        const next = advanceRevisions(db, current, { schedule: 0, projection: 1, at });
        if (!next) throw new Error('SCHEDULING_REVISION_ADVANCE_FAILED');
        db.prepare(`INSERT INTO scheduling_active_config
          (id, config_version, activated_at, activation_operation_id, projection_revision)
          VALUES (1, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET config_version = excluded.config_version,
            activated_at = excluded.activated_at,
            activation_operation_id = excluded.activation_operation_id,
            projection_revision = excluded.projection_revision`).run(
              command.configVersion, at, command.operationId, next.projectionRevision,
            );
        db.prepare(`INSERT INTO scheduling_config_activations
          (operation_id, command_digest, previous_config_version, config_version,
           projection_revision, activated_at, activated_by) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
             command.operationId, commandDigest, previous, command.configVersion,
             next.projectionRevision, at, actor,
           );
        staleDraftProposalsInTransactionV1({ db, triggerOperationId: command.operationId,
          reasonCode: 'SCHEDULING_CONFIG_CHANGED', now });
        refresh(next, at);
        return saveOperation(db, { operationId: command.operationId, commandDigest,
          kind: 'activateConfig', response: { configVersion: command.configVersion,
            scheduleRevision: next.scheduleRevision,
            projectionRevision: next.projectionRevision,
          }, at,
        });
      });
    },
  });
}
