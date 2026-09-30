import { randomUUID } from 'node:crypto';
import { canonicalJsonSchedulingV1, digestCanonicalJsonSchedulingV1,
  isSchedulingIdentifierV1 } from './scheduling-contract-v1.mjs';

export function gf15Fail(code) { throw Object.assign(new Error(code), { code }); }

export function immediateGf15(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = work(); db.exec('COMMIT'); return value; }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}

function active(db) {
  return db.prepare('SELECT * FROM gf15_scheduling_leases WHERE released_at IS NULL').get();
}

/** Called inside the same transaction as each canonical mutation. Expiry never opens admission:
 * a crashed/expired holder must be explicitly recovered, then ownership revalidated. */
export function assertSchedulingQuiescenceV1({ db, lease = null, now = () => new Date() }) {
  if (!db.isTransaction) gf15Fail('SCHEDULING_TRANSACTION_REQUIRED');
  const held = active(db);
  if (!held && !lease) return;
  if (!held || !lease || held.token !== lease.token || held.owner !== lease.owner
    || held.lease_id !== lease.leaseId || held.purpose !== lease.purpose) {
    gf15Fail('SCHEDULING_QUIESCENCE_HELD');
  }
  if (held.expires_at <= now().toISOString()) gf15Fail('SCHEDULING_LEASE_EXPIRED');
}

export function readGf15Packet(db, id) {
  const row = db.prepare('SELECT command_json, command_digest FROM gf15_command_packets WHERE packet_id = ?').get(id);
  if (!row) return null;
  const command = JSON.parse(row.command_json);
  if (canonicalJsonSchedulingV1(command) !== row.command_json
    || digestCanonicalJsonSchedulingV1(command) !== row.command_digest) gf15Fail('GF15_PACKET_INVALID');
  return command;
}

// Reserved bounded commands cannot be submitted through ordinary canonical stores with a
// different command, even by the lease holder. Revisions are part of the persisted packet.
export function assertGf15CommandPacketV1(db, command, lease) {
  const id = command.operationId ?? command.decisionId;
  if (lease?.purpose === 'rollback' && !['PRODGF15-ROLLBACK-RESOURCE-R1',
    'PRODGF15-ROLLBACK-CONFIG-ACTIVATE-R1'].includes(id)) gf15Fail('GF15_FORWARD_LEASE_REQUIRED');
  if (typeof id !== 'string' || !id.startsWith('PRODGF15-')) {
    if (lease) gf15Fail('GF15_COMMAND_NOT_BOUND');
    return;
  }
  const baseline = readGf15Packet(db, 'baseline');
  const bound = readGf15Packet(db, id);
  if (!lease || !baseline || baseline.owner !== lease.owner || !bound
    || canonicalJsonSchedulingV1(bound) !== canonicalJsonSchedulingV1(command)) gf15Fail('GF15_COMMAND_NOT_BOUND');
}

export function bindGf15PacketInTransaction(db, id, command, at) {
  if (!db.isTransaction) gf15Fail('SCHEDULING_TRANSACTION_REQUIRED');
  const prior = readGf15Packet(db, id);
  if (prior) {
    if (canonicalJsonSchedulingV1(prior) !== canonicalJsonSchedulingV1(command)) gf15Fail('GF15_PACKET_REUSE');
    return prior;
  }
  db.prepare(`INSERT INTO gf15_command_packets VALUES (?, ?, ?, ?)`).run(id,
    canonicalJsonSchedulingV1(command), digestCanonicalJsonSchedulingV1(command), at);
  return command;
}

function receipt(db, id, body, at) {
  db.prepare('INSERT INTO gf15_control_receipts VALUES (?, ?, ?)').run(id, canonicalJsonSchedulingV1(body), at);
  return body;
}

export function createSqliteSchedulingQuiescenceV1({ db, now, tokenFactory = randomUUID }) {
  return Object.freeze({
    acquire({ leaseId, owner, purpose = 'forward', ttlMs = 300_000 } = {}) {
      if (!isSchedulingIdentifierV1(leaseId) || !isSchedulingIdentifierV1(owner)
        || !['forward', 'rollback'].includes(purpose)
        || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 900_000) gf15Fail('SCHEDULING_LEASE_INVALID');
      return immediateGf15(db, () => {
        const at = now().toISOString();
        const existing = db.prepare('SELECT * FROM gf15_scheduling_leases WHERE lease_id = ?').get(leaseId);
        if (existing) {
          if (existing.owner !== owner || existing.purpose !== purpose || existing.released_at
            || existing.expires_at <= at || Date.parse(existing.expires_at) - Date.parse(existing.acquired_at) !== ttlMs) {
            gf15Fail('SCHEDULING_LEASE_REUSE');
          }
          return JSON.parse(db.prepare('SELECT receipt_json FROM gf15_control_receipts WHERE receipt_id = ?')
            .get(`acquire:${existing.token}`).receipt_json);
        }
        const base = readGf15Packet(db, 'baseline');
        if (base && base.owner !== owner) gf15Fail('SCHEDULING_LEASE_OWNER_MISMATCH');
        const held = active(db);
        if (held && (held.expires_at > at || purpose !== 'rollback')) gf15Fail('SCHEDULING_QUIESCENCE_HELD');
        if (held) {
          db.prepare('UPDATE gf15_scheduling_leases SET released_at = ? WHERE token = ?').run(at, held.token);
          receipt(db, `expire:${held.token}`, { token: held.token, recoveredBy: leaseId, at }, at);
        }
        const token = tokenFactory();
        if (!isSchedulingIdentifierV1(token)) gf15Fail('SCHEDULING_LEASE_INVALID');
        const expiresAt = new Date(Date.parse(at) + ttlMs).toISOString();
        db.prepare(`INSERT INTO gf15_scheduling_leases VALUES (?, ?, ?, ?, ?, ?, NULL)`)
          .run(token, leaseId, owner, purpose, at, expiresAt);
        return receipt(db, `acquire:${token}`, { leaseId, owner, purpose, token, acquiredAt: at, expiresAt }, at);
      });
    },
    release(lease) {
      return immediateGf15(db, () => {
        const held = db.prepare('SELECT * FROM gf15_scheduling_leases WHERE token = ?').get(lease?.token);
        if (!held || held.owner !== lease?.owner || held.lease_id !== lease?.leaseId
          || held.purpose !== lease?.purpose) gf15Fail('SCHEDULING_LEASE_OWNER_MISMATCH');
        const prior = db.prepare('SELECT receipt_json FROM gf15_control_receipts WHERE receipt_id = ?').get(`release:${held.token}`);
        if (prior) return { ...JSON.parse(prior.receipt_json), exactReplay: true };
        assertSchedulingQuiescenceV1({ db, lease, now });
        const at = now().toISOString();
        db.prepare('UPDATE gf15_scheduling_leases SET released_at = ? WHERE token = ?').run(at, held.token);
        return receipt(db, `release:${held.token}`, { leaseId: held.lease_id, owner: held.owner,
          token: held.token, releasedAt: at, exactReplay: false }, at);
      });
    },
  });
}
