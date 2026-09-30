import { validateV2Submission } from './contract-validator.mjs';
import { authorizeCapability } from './authorization-v2.mjs';
import { digestCanonicalJsonSchedulingV1, canonicalJsonSchedulingV1 } from './scheduling-contract-v1.mjs';
import { GF15_REQUEST, GF15_IDS, gf15Equal, assertGf15FutureDate } from './gf15-contract-v1.mjs';
import { assertSchedulingQuiescenceV1, gf15Fail, immediateGf15, readGf15Packet } from './sqlite-scheduling-quiescence-v1.mjs';

/** Bounded domain command. The only request INSERT is here, under the canonical transaction,
 * operation receipt, revision, projection refresh and audit. No raw-SQL orchestration port. */
export function createSqliteGf15RequestStoreV1({ db, now, refreshProjections, schedulingLease }) {
  return Object.freeze({
    materialize({ command, commandDigest, desiredDate, expectedProjectionRevision }, principal) {
      if (!schedulingLease || principal?.subjectId !== schedulingLease.owner
        || !authorizeCapability({ principal, capability: 'submitRequest' }).allowed) gf15Fail('GF15_PRINCIPAL_REQUIRED');
      const expected = { schemaVersion: 2, ...GF15_REQUEST.commandContract.fixedFields, desiredDate };
      if (!validateV2Submission(command).ok || !gf15Equal(command, expected)
        || commandDigest !== digestCanonicalJsonSchedulingV1(command)) gf15Fail('GF15_REQUEST_BINDING_MISMATCH');
      return immediateGf15(db, () => {
        assertSchedulingQuiescenceV1({ db, now, lease: schedulingLease });
        if (schedulingLease.purpose !== 'forward') gf15Fail('GF15_FORWARD_LEASE_REQUIRED');
        const baseline = readGf15Packet(db, 'baseline');
        if (!baseline || !gf15Equal(baseline.binding.requestCommand, command)
          || baseline.owner !== schedulingLease.owner) gf15Fail('GF15_BASELINE_REQUIRED');
        const prior = db.prepare('SELECT * FROM operations WHERE operation_id = ?').get(command.operationId);
        if (prior) {
          if (prior.kind !== 'gf15.request.materialize' || prior.request_digest !== commandDigest) gf15Fail('IDEMPOTENCY_KEY_REUSE');
          const response = JSON.parse(prior.response_json);
          const row = db.prepare('SELECT * FROM requests_v2 WHERE id = ?').get(GF15_IDS.request);
          if (!row || !gf15Equal({ ...row }, response.row)) gf15Fail('GF15_REQUEST_ROW_MISMATCH');
          return { ...response, exactReplay: true };
        }
        if (db.prepare('SELECT 1 FROM requests_v2 WHERE id = ?').get(GF15_IDS.request)) gf15Fail('GF15_REQUEST_EXISTS');
        if (db.prepare("SELECT 1 FROM scheduling_proposals WHERE status = 'draft' LIMIT 1").get()) gf15Fail('GF15_DRAFT_GATE_FAILED');
        assertGf15FutureDate(desiredDate, now);
        const current = db.prepare('SELECT * FROM revision_counters WHERE id = 1').get();
        if (!current || current.projection_revision !== expectedProjectionRevision) gf15Fail('SCHEDULING_REVISION_CONFLICT');
        const sourceOrdinal = (db.prepare('SELECT max(source_ordinal) AS value FROM requests_v2').get().value ?? -1) + 1;
        if (!Number.isSafeInteger(sourceOrdinal) || current.projection_revision >= Number.MAX_SAFE_INTEGER) gf15Fail('GF15_REVISION_EXHAUSTED');
        const at = now().toISOString();
        const row = { ...GF15_REQUEST.fixedPersistedFields, source_ordinal: sourceOrdinal,
          business_created_at: at, business_updated_at: at, imported_at: at, desired_date: desiredDate };
        if (Object.keys(row).length !== 36) gf15Fail('GF15_REQUEST_COLUMN_CONTRACT');
        const response = { ok: true, requestId: GF15_IDS.request, row,
          projectionRevision: current.projection_revision + 1, scheduleRevision: current.schedule_revision, createdAt: at };
        db.prepare(`INSERT INTO operations (operation_id, kind, response_json, created_at, request_digest)
          VALUES (?, 'gf15.request.materialize', ?, ?, ?)`).run(command.operationId, canonicalJsonSchedulingV1(response), at, commandDigest);
        const columns = GF15_REQUEST.completePersistedColumns;
        db.prepare(`INSERT INTO requests_v2 (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
          .run(...columns.map(column => row[column]));
        db.prepare('UPDATE revision_counters SET projection_revision = ?, updated_at = ? WHERE id = 1')
          .run(response.projectionRevision, at);
        refreshProjections({ db, projectionRevision: response.projectionRevision,
          scheduleRevision: response.scheduleRevision, updatedAt: at });
        db.prepare(`INSERT INTO audit_log (action, role, entity_id, revision, result, created_at)
          VALUES ('gf15.request.materialize', ?, ?, ?, 'created', ?)`).run(principal.role, GF15_IDS.request, response.projectionRevision, at);
        return { ...response, exactReplay: false };
      });
    },
  });
}
