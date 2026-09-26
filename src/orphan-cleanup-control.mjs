import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DISABLED_FILE = 'disabled.json';
const RUNS_DIR = 'runs';
const POLL_MS = 10;
const WAIT = new Int32Array(new SharedArrayBuffer(4));
const MODES = new Set(['inherit', 'disabled', 'enabled']);

export function normalizeOrphanCleanupMode(value = 'inherit') {
  const mode = String(value || 'inherit').trim().toLowerCase();
  if (!MODES.has(mode)) {
    throw new TypeError('orphan cleanup mode must be inherit, disabled, or enabled');
  }
  return mode;
}

export function createOrphanCleanupControl({
  controlRoot,
  clock = () => new Date(),
} = {}) {
  let memoryEnabled = true;
  const memoryRuns = new Set();
  const disabledMarker = controlRoot ? join(controlRoot, DISABLED_FILE) : null;
  const runsRoot = controlRoot ? join(controlRoot, RUNS_DIR) : null;

  if (controlRoot) {
    mkdirSync(controlRoot, { recursive: true });
    mkdirSync(runsRoot, { recursive: true });
  }

  function readMarker() {
    if (!disabledMarker) {
      return memoryEnabled
        ? null
        : { state: 'disabled', epoch: 'memory', reason: 'memory-control', valid: true };
    }
    if (!existsSync(disabledMarker)) return null;
    try {
      const parsed = JSON.parse(readFileSync(disabledMarker, 'utf8'));
      if (parsed?.state !== 'disabled' || typeof parsed.epoch !== 'string' || parsed.epoch.length === 0) {
        return { state: 'disabled', epoch: null, reason: 'invalid-control-marker', valid: false };
      }
      return {
        state: 'disabled',
        epoch: parsed.epoch,
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'unspecified',
        disabledAt: typeof parsed.disabledAt === 'string' ? parsed.disabledAt : null,
        valid: true,
      };
    } catch {
      return { state: 'disabled', epoch: null, reason: 'invalid-control-marker', valid: false };
    }
  }

  function activeRunIds() {
    if (!runsRoot) return [...memoryRuns].sort();
    if (!existsSync(runsRoot)) return [];
    return readdirSync(runsRoot, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
      .sort();
  }

  function status() {
    const marker = readMarker();
    const active = activeRunIds();
    return Object.freeze({
      enabled: marker === null,
      state: marker === null ? 'enabled' : 'disabled',
      epoch: marker?.epoch ?? null,
      markerValid: marker?.valid ?? true,
      reason: marker?.reason ?? null,
      disabledAt: marker?.disabledAt ?? null,
      activeRuns: active.length,
      activeRunIds: Object.freeze(active),
    });
  }

  function disable({ reason = 'runtime-control', waitForDrainMs = 5000 } = {}) {
    if (!Number.isFinite(waitForDrainMs) || waitForDrainMs < 0) {
      throw new TypeError('waitForDrainMs must be a non-negative number');
    }

    if (!disabledMarker) {
      memoryEnabled = false;
    } else if (!existsSync(disabledMarker)) {
      const marker = {
        state: 'disabled',
        epoch: randomUUID(),
        reason: String(reason || 'runtime-control'),
        disabledAt: clock().toISOString(),
      };
      try {
        writeFileSync(disabledMarker, JSON.stringify(marker) + '\n', { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }

    const deadline = Date.now() + waitForDrainMs;
    let current = status();
    while (current.activeRuns > 0 && Date.now() < deadline) {
      Atomics.wait(WAIT, 0, 0, POLL_MS);
      current = status();
    }
    if (!current.markerValid) {
      return Object.freeze({ ok: false, code: 'ORPHAN_CLEANUP_CONTROL_INVALID', ...current });
    }
    if (current.activeRuns > 0) {
      return Object.freeze({ ok: false, code: 'ORPHAN_CLEANUP_DRAIN_TIMEOUT', ...current });
    }
    return Object.freeze({ ok: true, ...current });
  }

  function enable({ expectedEpoch } = {}) {
    const current = status();
    if (current.enabled) return Object.freeze({ ok: true, ...current });
    if (!current.markerValid || !current.epoch) {
      return Object.freeze({ ok: false, code: 'ORPHAN_CLEANUP_CONTROL_INVALID', ...current });
    }
    if (current.activeRuns > 0) {
      return Object.freeze({ ok: false, code: 'ORPHAN_CLEANUP_DRAIN_REQUIRED', ...current });
    }
    if (current.epoch !== 'memory' && expectedEpoch !== current.epoch) {
      return Object.freeze({ ok: false, code: 'ORPHAN_CLEANUP_EPOCH_MISMATCH', ...current });
    }

    if (disabledMarker) {
      try {
        unlinkSync(disabledMarker);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    } else {
      memoryEnabled = true;
    }
    return Object.freeze({ ok: true, ...status() });
  }

  function beginRun() {
    const before = status();
    if (!before.enabled) {
      return Object.freeze({ ok: false, code: 'ORPHAN_CLEANUP_DISABLED', control: before });
    }

    const runId = randomUUID();
    if (!runsRoot) {
      memoryRuns.add(runId);
      if (!memoryEnabled) {
        memoryRuns.delete(runId);
        return Object.freeze({ ok: false, code: 'ORPHAN_CLEANUP_DISABLED', control: status() });
      }
      return Object.freeze({ ok: true, runId, markerPath: null });
    }

    const markerPath = join(runsRoot, runId + '.json');
    writeFileSync(markerPath, JSON.stringify({ runId, startedAt: clock().toISOString() }) + '\n', { flag: 'wx' });

    const after = status();
    if (!after.enabled) {
      try { unlinkSync(markerPath); } catch {}
      return Object.freeze({ ok: false, code: 'ORPHAN_CLEANUP_DISABLED', control: after });
    }
    return Object.freeze({ ok: true, runId, markerPath });
  }

  function endRun(admission) {
    if (!admission?.ok) return;
    if (admission.markerPath) {
      try { unlinkSync(admission.markerPath); } catch {}
    } else if (admission.runId) {
      memoryRuns.delete(admission.runId);
    }
  }

  return Object.freeze({ status, disable, enable, beginRun, endRun });
}
