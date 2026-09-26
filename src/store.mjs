import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { extname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { validateSnapshot, validateSubmission } from './contract-validator.mjs';
import { initializeWritableSchema } from './sqlite-schema-v2.mjs';
import { createOrphanCleanupControl, normalizeOrphanCleanupMode } from './orphan-cleanup-control.mjs';

function isoNow(clock) {
  return clock().toISOString();
}

function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const IMAGE_TYPES = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'],
  ['image/gif', '.gif'], ['image/heic', '.heic'],
]);
const ATTACHMENT_TYPES = new Map([
  ['application/pdf', '.pdf'], ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['text/csv', '.csv'], ['text/plain', '.txt'], ['application/zip', '.zip'],
]);
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const DEFAULT_ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STAGED_CLEANUP_FILE = /^(?<storedName>[a-f0-9]{64}\.[a-z0-9]+)\.cleanup-[0-9a-f-]{36}$/;
const SQLITE_BUSY = 5;
const WAL_SETUP_TIMEOUT_MS = 5000;
const WAL_RETRY_WAIT = new Int32Array(new SharedArrayBuffer(4));

function enableWalWithBusyRetry(db) {
  // SQLite can return SQLITE_BUSY immediately for a concurrent journal-mode
  // transition even when this connection already has a busy_timeout.
  const deadline = Date.now() + WAL_SETUP_TIMEOUT_MS;
  while (true) {
    try {
      db.exec('PRAGMA journal_mode = WAL;');
      return;
    } catch (error) {
      if (error?.errcode !== SQLITE_BUSY || Date.now() >= deadline) throw error;
      Atomics.wait(WAL_RETRY_WAIT, 0, 0, 10);
    }
  }
}

function safeName(value) {
  const name = String(value || '').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim();
  return name.slice(0, 240) || 'attachment';
}

function matchesSignature(contentType, buffer) {
  if (contentType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (contentType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  if (contentType === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (contentType === 'image/heic') return buffer.subarray(4, 12).toString('ascii').startsWith('ftyphei');
  if (contentType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (contentType === 'application/zip' || contentType.includes('openxmlformats')) {
    return buffer[0] === 0x50 && buffer[1] === 0x4b;
  }
  return ['text/csv', 'text/plain', 'application/msword', 'application/vnd.ms-excel'].includes(contentType);
}

export class ScheduleStore {
  #orphanCleanupControl;

  constructor({
    filename,
    uploadRoot,
    clock = () => new Date(),
    idFactory = randomUUID,
    orphanMaxAgeMs = DEFAULT_ORPHAN_MAX_AGE_MS,
    readOnly = false,
    fileOperations = {},
    orphanCleanupMode = 'inherit',
    orphanCleanupEnableEpoch,
  }) {
    const cleanupMode = readOnly ? 'inherit' : normalizeOrphanCleanupMode(orphanCleanupMode);
    if (!readOnly && filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.uploadRoot = uploadRoot || (filename === ':memory:' ? null : join(dirname(filename), 'uploads'));
    this.cleanupRoot = this.uploadRoot ? join(this.uploadRoot, '.cleanup') : null;
    const cleanupControlNamespace = filename === ':memory:'
      ? null
      : createHash('sha256').update(resolve(filename)).digest('hex');
    this.cleanupControlRoot = cleanupControlNamespace === null
      ? null
      : join(dirname(filename), '.orphan-cleanup-control', cleanupControlNamespace);
    this.#orphanCleanupControl = createOrphanCleanupControl({
      controlRoot: this.cleanupControlRoot,
      clock,
      writable: !readOnly,
    });
    this.clock = clock;
    this.idFactory = idFactory;
    this.orphanMaxAgeMs = orphanMaxAgeMs;
    this.readOnly = readOnly;
    this.renameFile = fileOperations.rename || renameSync;

    if (!readOnly && cleanupMode === 'disabled') {
      const disabled = this.#orphanCleanupControl.disable({ reason: 'store-startup', waitForDrainMs: 0 });
      if (!disabled.ok) {
        const error = new Error(disabled.code || 'ORPHAN_CLEANUP_DISABLE_FAILED');
        error.code = disabled.code || 'ORPHAN_CLEANUP_DISABLE_FAILED';
        throw error;
      }
    }

    if (!readOnly && this.uploadRoot) mkdirSync(this.uploadRoot, { recursive: true });
    if (!readOnly && this.cleanupRoot) mkdirSync(this.cleanupRoot, { recursive: true });

    this.db = new DatabaseSync(filename, { readOnly });
    this.db.exec('PRAGMA busy_timeout = 5000;');
    if (readOnly) {
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA query_only = ON;');
    } else {
      enableWalWithBusyRetry(this.db);
      this.db.exec('PRAGMA foreign_keys = ON;');
    }
    if (readOnly) return;
    initializeWritableSchema(this.db, { now: this.clock });
    transaction(this.db, () => {
      const current = this.db.prepare('SELECT id FROM schedule_state WHERE id = 1').get();
      if (current) return;
      const now = isoNow(this.clock);
      const snapshot = { schemaVersion: 1, revision: 0, updatedAt: now, products: [], tasks: [], sessions: [] };
      this.db.prepare(`
        INSERT INTO schedule_state (id, revision, updated_at, snapshot_json)
        VALUES (1, 0, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(now, JSON.stringify(snapshot));
    });
    if (cleanupMode === 'enabled') {
      const enabled = this.#orphanCleanupControl.enable({ expectedEpoch: orphanCleanupEnableEpoch });
      if (!enabled.ok) {
        const error = new Error(enabled.code || 'ORPHAN_CLEANUP_ENABLE_FAILED');
        error.code = enabled.code || 'ORPHAN_CLEANUP_ENABLE_FAILED';
        try { this.db.close(); } catch {}
        throw error;
      }
    }
    this.recoverStagedUploadCleanup({ allowDelete: cleanupMode !== 'disabled' });
  }

  getOrphanCleanupControlStatus() {
    return this.#orphanCleanupControl.status();
  }

  disableOrphanCleanup(options) {
    return this.#orphanCleanupControl.disable(options);
  }

  enableOrphanCleanup(options) {
    return this.#orphanCleanupControl.enable(options);
  }

  close() {
    this.db.close();
  }

  recoverStagedUploadCleanup({ allowDelete = true } = {}) {
    if (this.readOnly || !this.uploadRoot || !this.cleanupRoot) {
      return { ok: true, restored: 0, removed: 0, restoreErrors: 0, cleanupErrors: 0, errors: 0 };
    }
    if (!allowDelete) {
      return transaction(this.db, () => this.#recoverStagedUploadCleanupLocked({ allowDelete: false }));
    }

    const admission = this.#orphanCleanupControl.beginRun();
    if (!admission.ok) {
      return transaction(this.db, () => this.#recoverStagedUploadCleanupLocked({ allowDelete: false }));
    }
    try {
      return transaction(this.db, () => this.#recoverStagedUploadCleanupLocked({ allowDelete: true }));
    } finally {
      this.#orphanCleanupControl.endRun(admission);
    }
  }

  #recoverStagedUploadCleanupLocked({ allowDelete = false } = {}) {
    if (!this.uploadRoot || !this.cleanupRoot || !existsSync(this.cleanupRoot)) {
      return { ok: true, restored: 0, removed: 0, restoreErrors: 0, cleanupErrors: 0, errors: 0 };
    }
    let restored = 0;
    let removed = 0;
    let restoreErrors = 0;
    let cleanupErrors = 0;
    const referenced = this.db.prepare('SELECT 1 FROM uploads WHERE stored_name = ? LIMIT 1');
    const entries = readdirSync(this.cleanupRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = STAGED_CLEANUP_FILE.exec(entry.name);
      if (!match) continue;
      const stagedPath = join(this.cleanupRoot, entry.name);
      const originalPath = join(this.uploadRoot, match.groups.storedName);
      const hasReference = Boolean(referenced.get(match.groups.storedName));
      try {
        if (!hasReference) {
          if (allowDelete) {
            unlinkSync(stagedPath);
            removed += 1;
          }
        } else if (existsSync(originalPath)) {
          if (allowDelete) {
            unlinkSync(stagedPath);
            removed += 1;
          }
        } else {
          this.renameFile(stagedPath, originalPath);
          restored += 1;
        }
      } catch {
        if (hasReference && !existsSync(originalPath)) restoreErrors += 1;
        else cleanupErrors += 1;
      }
    }
    return {
      ok: restoreErrors === 0,
      restored,
      removed,
      restoreErrors,
      cleanupErrors,
      errors: restoreErrors + cleanupErrors,
    };
  }

  getSnapshot() {
    const row = this.db.prepare('SELECT snapshot_json FROM schedule_state WHERE id = 1').get();
    return JSON.parse(row.snapshot_json);
  }

  getOperation(operationId, expectedKind) {
    if (!operationId) return null;
    const row = this.db.prepare('SELECT kind, response_json FROM operations WHERE operation_id = ?').get(operationId);
    if (!row) return null;
    if (row.kind !== expectedKind) {
      return { ok: false, status: 409, code: 'IDEMPOTENCY_KEY_REUSE' };
    }
    return JSON.parse(row.response_json);
  }

  replaceSnapshot({ expectedRevision, snapshot, operationId, role }) {
    const validationErrors = validateSnapshot(snapshot);
    if (validationErrors.length) return { ok: false, status: 422, code: 'INVALID_SNAPSHOT', errors: validationErrors };
    const cached = this.getOperation(operationId, 'snapshot.replace');
    if (cached) return { ...cached, replayed: true };

    return transaction(this.db, () => {
      const current = this.getSnapshot();
      if (current.revision !== expectedRevision) {
        return { ok: false, status: 409, code: 'REVISION_CONFLICT', revision: current.revision };
      }
      const now = isoNow(this.clock);
      const next = {
        schemaVersion: 1,
        revision: current.revision + 1,
        updatedAt: now,
        products: snapshot.products,
        tasks: snapshot.tasks,
        sessions: snapshot.sessions,
      };
      const response = { ok: true, status: 200, revision: next.revision, updatedAt: now };
      this.db.prepare('UPDATE schedule_state SET revision = ?, updated_at = ?, snapshot_json = ? WHERE id = 1')
        .run(next.revision, now, JSON.stringify(next));
      this.recordOperation(operationId, 'snapshot.replace', response, now);
      this.recordAudit('snapshot.replace', role, null, next.revision, 'success', now);
      return response;
    });
  }

  submitRequest({ submission, role }) {
    const validationErrors = validateSubmission(submission);
    if (validationErrors.length) {
      if (OPERATION_ID.test(submission?.operationId || '')) {
        this.cleanupOrphanUploads({ operationId: submission.operationId });
      }
      return { ok: false, status: 422, code: 'INVALID_SUBMISSION', errors: validationErrors };
    }
    const cached = this.getOperation(submission.operationId, 'request.submit');
    if (cached) return { ...cached, replayed: true };

    try {
      const result = transaction(this.db, () => {
        const recovery = this.#recoverStagedUploadCleanupLocked({ allowDelete: false });
        if (!recovery.ok) {
          return { ok: false, status: 503, code: 'UPLOAD_RECOVERY_FAILED' };
        }
        const current = this.getSnapshot();
        const now = isoNow(this.clock);
        const taskId = `REQ-${this.idFactory()}`;
        const uploadIds = submission.uploadIds || [];
        const assets = uploadIds.map(id => {
          const row = this.db.prepare(`
            SELECT id, operation_id, original_name, content_type, kind, size, sha256, claimed_task_id
            FROM uploads WHERE id = ?
          `).get(id);
          if (!row || row.operation_id !== submission.operationId || row.claimed_task_id) {
            const error = new Error(`upload ${id} is unavailable`);
            error.code = 'INVALID_UPLOAD_REFERENCE';
            throw error;
          }
          return {
            id: row.id,
            name: row.original_name,
            contentType: row.content_type,
            kind: row.kind,
            size: row.size,
            sha256: row.sha256,
          };
        });
        const task = {
          id: taskId,
          sku: submission.sku.trim(),
          name: submission.name.trim(),
          client: '待确认',
          deliver: submission.deliver.trim(),
          kind: submission.kind,
          status: 'pending',
          source: 'submission',
          createdAt: now,
          updatedAt: now,
          assets,
          request: {
            productionType: submission.productionType,
            shootingSubtype: submission.shootingSubtype,
            aspectRatio: submission.aspectRatio,
            ...(submission.deliverableCount === undefined ? {} : { deliverableCount: submission.deliverableCount }),
            requestedBy: submission.requestedBy.trim(),
            desiredDate: submission.desiredDate || '',
            note: submission.note?.trim() || '',
          },
        };
        const next = {
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          products: current.products.some(([sku]) => sku === task.sku)
            ? current.products
            : [...current.products, [task.sku, task.name]],
          tasks: [...current.tasks, task],
        };
        const response = { ok: true, status: 201, taskId, revision: next.revision, updatedAt: now };
        this.db.prepare('UPDATE schedule_state SET revision = ?, updated_at = ?, snapshot_json = ? WHERE id = 1')
          .run(next.revision, now, JSON.stringify(next));
        if (uploadIds.length) {
          const claim = this.db.prepare('UPDATE uploads SET claimed_task_id = ? WHERE id = ?');
          uploadIds.forEach(id => claim.run(taskId, id));
        }
        this.recordOperation(submission.operationId, 'request.submit', response, now);
        this.recordAudit('request.submit', role, taskId, next.revision, 'success', now);
        return response;
      });
      if (!result.ok) return result;
      this.cleanupOrphanUploads({ operationId: submission.operationId });
      return result;
    } catch (error) {
      if (error.code === 'INVALID_UPLOAD_REFERENCE') {
        this.cleanupOrphanUploads({ operationId: submission.operationId });
        return { ok: false, status: 422, code: error.code };
      }
      throw error;
    }
  }

  saveUpload({ operationId, originalName, contentType, kind, buffer, role = 'submitter' }) {
    if (typeof operationId !== 'string' || !OPERATION_ID.test(operationId)) {
      return { ok: false, status: 422, code: 'INVALID_OPERATION_ID' };
    }
    this.cleanupOrphanUploads({ recoverStaged: false });
    const allowed = kind === 'image' ? IMAGE_TYPES : kind === 'attachment' ? ATTACHMENT_TYPES : null;
    if (!allowed?.has(contentType)) return { ok: false, status: 415, code: 'UNSUPPORTED_UPLOAD_TYPE' };
    const maxBytes = kind === 'image' ? 12 * 1024 * 1024 : 20 * 1024 * 1024;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > maxBytes) {
      return { ok: false, status: 413, code: 'UPLOAD_SIZE_INVALID' };
    }
    if (!matchesSignature(contentType, buffer)) {
      return { ok: false, status: 415, code: 'UPLOAD_SIGNATURE_MISMATCH' };
    }
    return transaction(this.db, () => {
      const count = this.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM uploads WHERE operation_id = ?')
        .get(operationId);
      if (count.count >= 10 || count.bytes + buffer.length > 40 * 1024 * 1024) {
        return { ok: false, status: 413, code: 'UPLOAD_BATCH_LIMIT' };
      }
      const now = isoNow(this.clock);
      const id = `UP-${this.idFactory()}`;
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      const suffix = allowed.get(contentType) || extname(originalName).toLowerCase();
      const storedName = `${sha256}${suffix}`;
      let createdPath = null;
      try {
        if (this.uploadRoot) {
          const path = join(this.uploadRoot, storedName);
          try {
            writeFileSync(path, buffer, { flag: 'wx' });
            createdPath = path;
          } catch (error) {
            if (error.code !== 'EEXIST') throw error;
          }
        }
        this.db.prepare(`
          INSERT INTO uploads (id, operation_id, original_name, content_type, kind, size, sha256, stored_name, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, operationId, safeName(originalName), contentType, kind, buffer.length, sha256, this.uploadRoot ? storedName : null, now);
        this.recordAudit('upload.create', role, id, this.getSnapshot().revision, 'success', now);
        return { ok: true, status: 201, upload: { id, name: safeName(originalName), contentType, kind, size: buffer.length, sha256 } };
      } catch (error) {
        if (createdPath) {
          try { unlinkSync(createdPath); } catch {}
        }
        throw error;
      }
    });
  }

  cleanupOrphanUploads(options = {}) {
    const normalizedOptions = Object.freeze({
      olderThanMs: options?.olderThanMs,
      operationId: options?.operationId,
      dryRun: Boolean(options?.dryRun),
      recoverStaged: options?.recoverStaged,
    });
    if (normalizedOptions.dryRun) return this.#cleanupOrphanUploadsUnchecked(normalizedOptions);
    if (this.readOnly) return this.#cleanupOrphanUploadsUnchecked(normalizedOptions);

    const admission = this.#orphanCleanupControl.beginRun();
    if (!admission.ok) {
      return {
        ok: true,
        dryRun: false,
        skipped: true,
        code: admission.code,
        controlEpoch: admission.control?.epoch ?? null,
        candidates: 0,
        deleted: 0,
        filesDeleted: 0,
        fileErrors: 0,
        recoveryRestored: 0,
        recoveryRemoved: 0,
        recoveryErrors: 0,
      };
    }

    try {
      return this.#cleanupOrphanUploadsUnchecked(normalizedOptions);
    } finally {
      this.#orphanCleanupControl.endRun(admission);
    }
  }

  #cleanupOrphanUploadsUnchecked({ olderThanMs = this.orphanMaxAgeMs, operationId, dryRun = false, recoverStaged = true } = {}) {
    const now = isoNow(this.clock);
    const selectCandidates = () => operationId
      ? this.db.prepare(`
          SELECT id, stored_name FROM uploads
          WHERE operation_id = ? AND claimed_task_id IS NULL
        `).all(operationId)
      : this.db.prepare(`
          SELECT id, stored_name FROM uploads
          WHERE claimed_task_id IS NULL AND created_at <= ?
        `).all(new Date(this.clock().getTime() - Math.max(0, olderThanMs)).toISOString());
    if (dryRun) {
      const rows = selectCandidates();
      return { ok: true, dryRun: true, candidates: rows.length, deleted: 0, filesDeleted: 0, fileErrors: 0 };
    }
    if (this.readOnly) throw new Error('read-only store cannot delete orphan uploads');
    let candidates = 0;
    let deleted = 0;
    let filesDeleted = 0;
    let fileErrors = 0;
    let recoveryRestored = 0;
    let recoveryRemoved = 0;
    let recoveryErrors = 0;
    const stagedFiles = [];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (recoverStaged) {
        const recovery = this.#recoverStagedUploadCleanupLocked({ allowDelete: true });
        recoveryRestored = recovery.restored;
        recoveryRemoved = recovery.removed;
        recoveryErrors = recovery.errors;
        fileErrors += recovery.errors;
      }
      const rows = selectCandidates();
      candidates = rows.length;
      if (rows.length) {
        const candidateIds = new Set(rows.map(row => row.id));
        const failedStoredNames = new Set();
        if (this.uploadRoot) {
          const storedNames = [...new Set(rows.map(row => row.stored_name).filter(Boolean))];
          const references = this.db.prepare('SELECT id FROM uploads WHERE stored_name = ?');
          for (const storedName of storedNames) {
            const hasRemainingReference = references.all(storedName)
              .some(row => !candidateIds.has(row.id));
            if (hasRemainingReference) continue;
            const originalPath = join(this.uploadRoot, storedName);
            const stagedPath = join(this.cleanupRoot, `${storedName}.cleanup-${randomUUID()}`);
            try {
              this.renameFile(originalPath, stagedPath);
              stagedFiles.push({ originalPath, stagedPath });
            } catch (error) {
              if (error.code !== 'ENOENT') {
                failedStoredNames.add(storedName);
                fileErrors += 1;
              }
            }
          }
        }

        const remove = this.db.prepare('DELETE FROM uploads WHERE id = ? AND claimed_task_id IS NULL');
        rows.forEach(row => {
          if (row.stored_name && failedStoredNames.has(row.stored_name)) return;
          deleted += remove.run(row.id).changes;
        });
        if (deleted) {
          this.recordAudit('upload.cleanup', 'system', operationId || null, this.getSnapshot().revision, `deleted:${deleted}`, now);
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      for (const { originalPath, stagedPath } of stagedFiles.toReversed()) {
        try {
          if (existsSync(stagedPath) && !existsSync(originalPath)) this.renameFile(stagedPath, originalPath);
        } catch {}
      }
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    for (const { stagedPath } of stagedFiles) {
      try {
        unlinkSync(stagedPath);
        filesDeleted += 1;
      } catch (error) {
        if (error.code !== 'ENOENT') fileErrors += 1;
      }
    }
    return {
      ok: fileErrors === 0,
      dryRun: false,
      candidates,
      deleted,
      filesDeleted,
      fileErrors,
      recoveryRestored,
      recoveryRemoved,
      recoveryErrors,
    };
  }

  recordOperation(operationId, kind, response, now) {
    if (!operationId) return;
    this.db.prepare('INSERT INTO operations (operation_id, kind, response_json, created_at) VALUES (?, ?, ?, ?)')
      .run(operationId, kind, JSON.stringify(response), now);
  }

  recordAudit(action, role, entityId, revision, result, now) {
    this.db.prepare('INSERT INTO audit_log (action, role, entity_id, revision, result, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(action, role, entityId, revision, result, now);
  }
}
