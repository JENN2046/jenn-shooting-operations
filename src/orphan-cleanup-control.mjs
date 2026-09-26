import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DISABLED_FILE = 'disabled.json';
const RUNS_DIR = 'runs';
const TRANSITION_LOCK_FILE = 'transition.lock';
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
  writable = true,
} = {}) {
  let memoryEnabled = true;
  let memoryTransitionToken = null;
  const memoryRuns = new Set();
  const disabledMarker = controlRoot ? join(controlRoot, DISABLED_FILE) : null;
  const runsRoot = controlRoot ? join(controlRoot, RUNS_DIR) : null;
  const transitionLock = controlRoot ? join(controlRoot, TRANSITION_LOCK_FILE) : null;

  if (controlRoot && writable) {
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

  function transitionIsLocked() {
    if (!transitionLock) return memoryTransitionToken !== null;
    return existsSync(transitionLock);
  }

  function acquireTransition() {
    const token = randomUUID();
    if (!transitionLock) {
      if (memoryTransitionToken !== null) {
        return { ok: false, code: 'ORPHAN_CLEANUP_TRANSITION_BUSY' };
      }
      memoryTransitionToken = token;
      return { ok: true, token };
    }

    try {
      writeFileSync(transitionLock, token + '\n', { flag: 'wx' });
      return { ok: true, token };
    } catch (error) {
      if (error.code === 'EEXIST') {
        return { ok: false, code: 'ORPHAN_CLEANUP_TRANSITION_BUSY' };
      }
      throw error;
    }
  }

  function releaseTransition(admission) {
    if (!admission?.ok) return;
    if (!transitionLock) {
      if (memoryTransitionToken === admission.token) memoryTransitionToken = null;
      return;
    }

    try {
      const owner = readFileSync(transitionLock, 'utf8').trim();
      if (owner === admission.token) unlinkSync(transitionLock);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
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

  function snapshot({ ignoreTransition = false } = {}) {
    const marker = readMarker();
    const active = activeRunIds();
    const transitionLocked = ignoreTransition ? false : transitionIsLocked();
    const enabled = marker === null && !transitionLocked;
    return Object.freeze({
      enabled,
      state: marker !== null ? 'disabled' : transitionLocked ? 'transition' : 'enabled',
      epoch: marker?.epoch ?? null,
      markerValid: marker?.valid ?? true,
      reason: marker?.reason ?? null,
      disabledAt: marker?.disabledAt ?? null,
      transitionLocked,
      activeRuns: active.length,
      activeRunIds: Object.freeze(active),
    });
  }

  function status() {
    return snapshot();
  }

  function markerOwnershipStatus(expectedEpoch) {
    const current = snapshot({ ignoreTransition: true });
    if (!current.markerValid) {
      return { ok: false, code: 'ORPHAN_CLEANUP_CONTROL_INVALID', current };
    }
    if (current.enabled || current.epoch !== expectedEpoch) {
      return { ok: false, code: 'ORPHAN_CLEANUP_MARKER_OWNERSHIP_LOST', current };
    }
    return { ok: true, current };
  }

  function disable({ reason = 'runtime-control', waitForDrainMs = 5000 } = {}) {
    if (!writable) return Object.freeze({ ok: false, code: 'ORPHAN_CLEANUP_CONTROL_READ_ONLY', ...status() });
    if (!Number.isFinite(waitForDrainMs) || waitForDrainMs < 0) {
      throw new TypeError('waitForDrainMs must be a non-negative number');
    }

    const transition = acquireTransition();
    if (!transition.ok) {
      return Object.freeze({ ok: false, code: transition.code, ...status() });
    }

    try {
      let marker = readMarker();
      if (marker && !marker.valid) {
        return Object.freeze({ ok: false, code: 'ORPHAN_CLEANUP_CONTROL_INVALID', ...snapshot({ ignoreTransition: true }) });
      }

      let ownedEpoch;
      if (!disabledMarker) {
        memoryEnabled = false;
        ownedEpoch = 'memory';
      } else if (marker) {
        ownedEpoch = marker.epoch;
      } else {
        ownedEpoch = randomUUID();
        const next = {
          state: 'disabled',
          epoch: ownedEpoch,
          reason: String(reason || 'runtime-control'),
          disabledAt: clock().toISOString(),
        };
        try {
          writeFileSync(disabledMarker, JSON.stringify(next) + '\n', { flag: 'wx' });
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
        marker = readMarker();
        if (!marker?.valid || marker.epoch !== ownedEpoch) {
          return Object.freeze({
            ok: false,
            code: 'ORPHAN_CLEANUP_MARKER_OWNERSHIP_LOST',
            ...snapshot({ ignoreTransition: true }),
          });
        }
      }

      const deadline = Date.now() + waitForDrainMs;
      let ownership = markerOwnershipStatus(ownedEpoch);
      if (!ownership.ok) {
        return Object.freeze({ ok: false, code: ownership.code, ...ownership.current });
      }
      let current = ownership.current;

      while (current.activeRuns > 0 && Date.now() < deadline) {
        Atomics.wait(WAIT, 0, 0, POLL_MS);
        ownership = markerOwnershipStatus(ownedEpoch);
        if (!ownership.ok) {
          return Object.freeze({ ok: false, code: ownership.code, ...ownership.current });
        }
        current = ownership.current;
      }

      ownership = markerOwnershipStatus(ownedEpoch);
      if (!ownership.ok) {
        return Object.freeze({ ok: false, code: ownership.code, ...ownership.current });
      }
      current = ownership.current;
      if (current.activeRuns > 0) {
        return Object.freeze({ ok: false, code: 'ORPHAN_CLEANUP_DRAIN_TIMEOUT', ...current });
      }
      return Object.freeze({ ok: true, ...current });
    } finally {
      releaseTransition(transition);
    }
  }

  function enable({ expectedEpoch } = {}) {
    if (!writable) return Object.freeze({ ok: false, code: 'ORPHAN_CLEANUP_CONTROL_READ_ONLY', ...status() });

    const transition = acquireTransition();
    if (!transition.ok) {
      return Object.freeze({ ok: false, code: transition.code, ...status() });
    }

    try {
      let current = snapshot({ ignoreTransition: true });
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

      const validatedEpoch = current.epoch;
      const marker = readMarker();
      if (!marker?.valid || marker.epoch !== validatedEpoch) {
        return Object.freeze({
          ok: false,
          code: 'ORPHAN_CLEANUP_MARKER_OWNERSHIP_LOST',
          ...snapshot({ ignoreTransition: true }),
        });
      }

      if (disabledMarker) {
        unlinkSync(disabledMarker);
      } else {
        memoryEnabled = true;
      }

      current = snapshot({ ignoreTransition: true });
      if (!current.enabled) {
        return Object.freeze({
          ok: false,
          code: 'ORPHAN_CLEANUP_ENABLE_NOT_COMMITTED',
          ...current,
        });
      }
      return Object.freeze({ ok: true, ...current });
    } finally {
      releaseTransition(transition);
    }
  }

  function beginRun() {
    if (!writable) return Object.freeze({ ok: false, code: 'ORPHAN_CLEANUP_CONTROL_READ_ONLY', control: status() });
    const before = status();
    if (!before.enabled) {
      return Object.freeze({
        ok: false,
        code: before.transitionLocked ? 'ORPHAN_CLEANUP_TRANSITION_BUSY' : 'ORPHAN_CLEANUP_DISABLED',
        control: before,
      });
    }

    const runId = randomUUID();
    if (!runsRoot) {
      memoryRuns.add(runId);
      const after = status();
      if (!after.enabled) {
        memoryRuns.delete(runId);
        return Object.freeze({
          ok: false,
          code: after.transitionLocked ? 'ORPHAN_CLEANUP_TRANSITION_BUSY' : 'ORPHAN_CLEANUP_DISABLED',
          control: after,
        });
      }
      return Object.freeze({ ok: true, runId, markerPath: null });
    }

    const markerPath = join(runsRoot, runId + '.json');
    writeFileSync(markerPath, JSON.stringify({ runId, startedAt: clock().toISOString() }) + '\n', { flag: 'wx' });

    const after = status();
    if (!after.enabled) {
      try { unlinkSync(markerPath); } catch {}
      return Object.freeze({
        ok: false,
        code: after.transitionLocked ? 'ORPHAN_CLEANUP_TRANSITION_BUSY' : 'ORPHAN_CLEANUP_DISABLED',
        control: after,
      });
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
