import { createHash } from 'node:crypto';
import { canonicalJsonSchedulingV1 } from './scheduling-contract-v1.mjs';

const denied = code => Object.freeze({ ok: false, code });
const ACTIONS = new Set(['adopt_proposal', 'reschedule']);
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function agentGrantAttemptKeyV1(input) {
  if (!exact(input, ['approvalRef', 'subjectId', 'action', 'commandDigest'])
    || typeof input.approvalRef !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(input.approvalRef)
    || typeof input.subjectId !== 'string' || input.subjectId.length < 1 || input.subjectId.length > 160
    || !ACTIONS.has(input.action)
    || typeof input.commandDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(input.commandDigest)) {
    throw new TypeError('Invalid agent grant attempt');
  }
  return `sha256:${createHash('sha256').update(canonicalJsonSchedulingV1({
    domain: 'jso-agent-grant-attempt-v1', ...input,
  })).digest('hex')}`;
}

export function createSqliteAgentGrantAttemptStoreV1({ db, now = () => new Date() } = {}) {
  if (!db || typeof now !== 'function') throw new TypeError('database and clock required');
  return Object.freeze({
    claim(input) {
      let attemptKey;
      try { attemptKey = agentGrantAttemptKeyV1(input); }
      catch { return denied('INVALID_AGENT_GRANT'); }
      const admitted = db.prepare(`SELECT 1 FROM schema_migrations
        WHERE version = 11 AND name = 'business_calendar_and_reschedule'`).get();
      if (!admitted) return denied('BUSINESS_SCHEMA11_REQUIRED');
      const attemptedAt = now().toISOString();
      try {
        db.prepare(`INSERT INTO agent_grant_attempts
          (attempt_key, approval_ref, subject_id, action, command_digest, attempted_at)
          VALUES (?, ?, ?, ?, ?, ?)`).run(
          attemptKey, input.approvalRef, input.subjectId, input.action, input.commandDigest, attemptedAt,
        );
        return Object.freeze({ ok: true, attemptKey, attemptedAt });
      } catch (error) {
        if (error?.code === 'WRITE_ADMISSION_DISABLED') return denied('WRITE_ADMISSION_DISABLED');
        const prior = db.prepare(`SELECT 1 FROM agent_grant_attempts
          WHERE attempt_key = ? OR
            (approval_ref = ? AND subject_id = ? AND action = ? AND command_digest = ?)`).get(
          attemptKey, input.approvalRef, input.subjectId, input.action, input.commandDigest,
        );
        if (prior) return denied('RECONCILIATION_REQUIRED');
        throw error;
      }
    },
  });
}
