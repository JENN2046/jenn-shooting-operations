import { PROD11_RESOURCE, PROD11_REQUEST, PROD11_DEVICE, requireKioskServiceBindingV1 } from './kiosk-service-context-v1.mjs';

const uuid = prefix => new RegExp(`^${prefix}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, 'u');
const denied = () => ({ ok: false, code: 'RUN_PREPARATION_REQUIRED' });

export function stopKioskSmokeInTransactionV1({ db, binding, principal }) {
  requireKioskServiceBindingV1(binding);
  if (!db.isTransaction) throw new Error('KIOSK_SMOKE_TRANSACTION_REQUIRED');
  if (binding.mode !== 'PROD11_SMOKE_ONLY' || principal?.role !== 'operator'
    || principal.subjectId !== PROD11_DEVICE || principal.resourceIds?.length !== 1
    || principal.resourceIds[0] !== PROD11_RESOURCE) return;
  const persisted = db.prepare('SELECT binding_json FROM kiosk_smoke_binding WHERE id = 1').get();
  const value = JSON.stringify(binding);
  if (persisted && persisted.binding_json !== value) return;
  if (!persisted) db.prepare('INSERT INTO kiosk_smoke_binding VALUES (1, ?)').run(value);
  if (!db.prepare('SELECT id FROM kiosk_smoke_stop WHERE id = 1').get()) {
    db.prepare("INSERT INTO kiosk_smoke_stop VALUES (1, 'SMOKE_HARD_STOP')").run();
  }
}

// Called only inside the event's BEGIN IMMEDIATE. A SAVEPOINT keeps denied smoke
// attempts free of business/review/receipt/audit writes; the irreversible stop is
// control evidence, and survives restart without expanding the mutation budget.
export function withKioskSmokeAdmissionV1({ db, binding, command, digest, principal, clock, apply, validateReceipt }) {
  requireKioskServiceBindingV1(binding);
  if (!db.isTransaction) throw new Error('KIOSK_SMOKE_TRANSACTION_REQUIRED');
  if (binding.mode === 'DISABLED') return denied();
  if (binding.mode === 'WO03_ISOLATED_ACCEPTANCE') {
    if (db.prepare('SELECT id FROM kiosk_smoke_binding WHERE id = 1').get()
      || principal.subjectId === PROD11_DEVICE || principal.resourceIds.includes(PROD11_RESOURCE)
      || command.deviceId === PROD11_DEVICE) return denied();
    return apply(clock().toISOString());
  }
  if (principal.role !== 'operator' || principal.subjectId !== PROD11_DEVICE
    || principal.resourceIds.length !== 1 || principal.resourceIds[0] !== PROD11_RESOURCE
    || command.deviceId !== PROD11_DEVICE) return { ok: false, code: 'FORBIDDEN' };
  const bindingJson = JSON.stringify(binding);
  const persisted = db.prepare('SELECT binding_json FROM kiosk_smoke_binding WHERE id = 1').get();
  if (persisted && persisted.binding_json !== bindingJson) return denied();
  if (!persisted) db.prepare('INSERT INTO kiosk_smoke_binding VALUES (1, ?)').run(bindingJson);
  const stop = () => {
    if (!db.prepare('SELECT id FROM kiosk_smoke_stop WHERE id = 1').get()) {
      db.prepare("INSERT INTO kiosk_smoke_stop VALUES (1, 'SMOKE_HARD_STOP')").run();
    }
    return denied();
  };
  const phases = db.prepare('SELECT * FROM kiosk_smoke_phases ORDER BY id').all();
  if (phases.some((p, i) => p.id !== i || p.run_id !== phases[0].run_id)) return stop();
  for (const phase of phases) {
    let boundCommand;
    try { boundCommand = JSON.parse(phase.command_json); } catch { return stop(); }
    const receipt = validateReceipt(boundCommand, phase.command_digest);
    if (!receipt?.ok || !receipt.replayed || receipt.runRevision !== phase.id + 1
      || receipt.resultingState !== (phase.id === 0 ? 'shooting' : 'completed')
      || boundCommand.scheduleItemId !== binding.expectedItem
      || boundCommand.runId !== phase.run_id || boundCommand.eventId !== phase.event_id
      || boundCommand.localSequence !== phase.id) return stop();
  }
  const replay = phases.find(p => p.event_id === command.eventId);
  if (replay) {
    if (replay.run_id !== command.runId || replay.command_digest !== digest) return stop();
    // Existing immutable receipts authorize no new fact, even after expiry/terminal.
    db.exec('SAVEPOINT kiosk_smoke_event');
    let response;
    try { response = apply(replay.received_at); } catch {
      db.exec('ROLLBACK TO kiosk_smoke_event; RELEASE kiosk_smoke_event');
      return stop();
    }
    if (!response?.ok || response.replayed !== true || response.runRevision !== replay.id + 1) {
      db.exec('ROLLBACK TO kiosk_smoke_event; RELEASE kiosk_smoke_event');
      return stop();
    }
    db.exec('RELEASE kiosk_smoke_event');
    return response;
  }
  if (db.prepare('SELECT id FROM kiosk_smoke_stop WHERE id = 1').get() || phases.length === 2) return denied();
  let now;
  try { now = clock().toISOString(); } catch { return stop(); } // after acquiring the write boundary
  if (!Number.isFinite(Date.parse(now)) || now < binding.start || now > binding.end
    || Date.parse(command.occurredAt) < Date.parse(binding.start)
    || Date.parse(command.occurredAt) > Date.parse(binding.end)
    || command.scheduleItemId !== binding.expectedItem
    || !uuid('RUN').test(command.runId) || !uuid('EVENT').test(command.eventId)
    || command.localSequence !== phases.length || command.expectedRunRevision !== phases.length
    || command.eventType !== (phases.length === 0 ? 'start' : 'complete')
    || (phases.length === 1 && command.runId !== phases[0].run_id)) return stop();
  const config = db.prepare(`SELECT v.config_json FROM scheduling_active_config a
    JOIN scheduling_config_versions v ON v.config_version = a.config_version WHERE a.id = 1`).get();
  let timeZone;
  try { timeZone = JSON.parse(config?.config_json)?.businessTimeZone; } catch {}
  if (timeZone !== 'Asia/Shanghai') return stop();
  const item = db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(binding.expectedItem);
  const tasks = db.prepare('SELECT task_id FROM schedule_item_tasks WHERE schedule_item_id = ?').all(binding.expectedItem);
  const runs = db.prepare(`SELECT r.* FROM production_runs r JOIN schedule_items s ON s.id = r.schedule_item_id
    WHERE s.resource_id = ?`).all(PROD11_RESOURCE);
  const active = runs.filter(r => ['scheduled', 'shooting', 'blocked'].includes(r.status));
  const candidates = db.prepare(`SELECT s.id FROM schedule_items s WHERE s.resource_id = ?
    AND s.schedule_status = 'confirmed' AND s.planned_start <= ? AND s.planned_end > ?
    AND NOT EXISTS (SELECT 1 FROM production_runs r WHERE r.schedule_item_id = s.id)`).all(PROD11_RESOURCE, now, now);
  const ownRuns = runs.filter(r => r.schedule_item_id === binding.expectedItem);
  if (!item || item.resource_id !== PROD11_RESOURCE || item.schedule_status !== 'confirmed'
    || item.resource_resolution_status !== 'resolved' || item.allocation_mode !== 'single'
    || !(Date.parse(item.planned_start) <= Date.parse(binding.start))
    || !(Date.parse(item.planned_end) >= Date.parse(binding.end))
    || tasks.length !== 1 || tasks[0].task_id !== PROD11_REQUEST
    || (phases.length === 0 && (ownRuns.length !== 0 || active.length !== 0
      || candidates.length !== 1 || candidates[0].id !== binding.expectedItem))
    || (phases.length === 1 && (ownRuns.length !== 1 || active.length !== 1 || candidates.length !== 0
      || active[0].id !== phases[0].run_id || active[0].status !== 'shooting' || active[0].run_revision !== 1))) return stop();
  // No orphaned/pre-existing history may be adopted as smoke authority.
  const reviews = db.prepare('SELECT COUNT(*) n FROM run_event_reviews WHERE schedule_item_id = ? OR run_id = ?')
    .get(binding.expectedItem, command.runId).n;
  const events = db.prepare('SELECT event_id FROM production_events WHERE run_id = ? ORDER BY resulting_run_revision').all(command.runId);
  if (reviews || events.length !== phases.length || events.some((e, i) => e.event_id !== phases[i].event_id)) return stop();
  db.exec('SAVEPOINT kiosk_smoke_event');
  let response;
  try { response = apply(now); } catch {
    db.exec('ROLLBACK TO kiosk_smoke_event; RELEASE kiosk_smoke_event');
    return stop();
  }
  if (!response?.ok || response.code !== 'RUN_EVENT_APPLIED' || response.replayed
    || response.runRevision !== phases.length + 1
    || response.resultingState !== (phases.length === 0 ? 'shooting' : 'completed')) {
    db.exec('ROLLBACK TO kiosk_smoke_event; RELEASE kiosk_smoke_event');
    return stop();
  }
  try {
    db.prepare('INSERT INTO kiosk_smoke_phases VALUES (?, ?, ?, ?, ?, ?)')
      .run(phases.length, command.runId, command.eventId, digest, JSON.stringify(command), now);
  } catch {
    db.exec('ROLLBACK TO kiosk_smoke_event; RELEASE kiosk_smoke_event');
    return stop();
  }
  db.exec('RELEASE kiosk_smoke_event');
  return response;
}
