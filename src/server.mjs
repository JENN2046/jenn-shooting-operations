import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpApp } from './http-app.mjs';
import { authorizeCapability, validateTrustedPrincipal } from './authorization-v2.mjs';
import { createReadKioskCurrent } from './kiosk-current-use-case-v2.mjs';
import { createApplyKioskRunEvent } from './kiosk-run-event-use-case-v2.mjs';
import { createSqliteKioskCurrentStore } from './sqlite-kiosk-current-store-v2.mjs';
import { createSqliteKioskRunEventStore } from './sqlite-kiosk-run-event-store-v2.mjs';
import { refreshSqliteSnapshotProjectionsV2 } from './sqlite-run-event-store-v2.mjs';
import { assembleSchedulingInputFromSqliteV1 } from './sqlite-scheduling-input-assembler-v1.mjs';
import { createSqliteSchedulingProposalStoreV1 } from './sqlite-scheduling-proposal-store-v1.mjs';
import { ScheduleStore } from './store.mjs';

export function createKioskV2Application({
  store,
  authenticate,
  businessTimeZone,
  clock = () => new Date(),
  allowedBriefHosts = [],
} = {}) {
  if (!store?.db) throw new TypeError('ScheduleStore is required');
  if (typeof authenticate !== 'function') throw new TypeError('Kiosk authenticate port is required');
  if (typeof businessTimeZone !== 'string' || businessTimeZone.length === 0) {
    throw new TypeError('Kiosk businessTimeZone is required');
  }
  return Object.freeze({
    authenticate,
    readCurrent: createReadKioskCurrent({
      store: createSqliteKioskCurrentStore({ db: store.db }),
      clock,
    }),
    applyRunEvent: createApplyKioskRunEvent({
      store: createSqliteKioskRunEventStore({
        db: store.db,
        businessTimeZone,
        allowedBriefHosts,
      }),
      clock,
    }),
  });
}

export function createSchedulingV2Application({
  store,
  authenticate,
  clock = () => new Date(),
  allowedBriefHosts = [],
} = {}) {
  if (!store?.db) throw new TypeError('ScheduleStore is required');
  if (typeof authenticate !== 'function') {
    throw new TypeError('Scheduling authenticate port is required');
  }
  const proposalStore = createSqliteSchedulingProposalStoreV1({
    db: store.db,
    assembleInput: assembleSchedulingInputFromSqliteV1,
    now: clock,
    authorizeAcceptance: (principal, resourceIds) => (
      ['scheduler', 'administrator'].includes(principal?.role)
      && Array.isArray(resourceIds)
      && resourceIds.every(resourceId => principal.resourceIds?.includes(resourceId))
    ),
    refreshProjections: context => {
      const active = store.db.prepare(`SELECT version.config_json
        FROM scheduling_active_config AS active
        JOIN scheduling_config_versions AS version
          ON version.config_version = active.config_version
        WHERE active.id = 1`).get();
      let businessTimeZone = null;
      try {
        businessTimeZone = JSON.parse(active?.config_json ?? 'null')?.businessTimeZone ?? null;
      } catch {}
      if (typeof businessTimeZone !== 'string' || businessTimeZone.length === 0) {
        throw new Error('SCHEDULING_CONFIG_NOT_ACTIVE');
      }
      return refreshSqliteSnapshotProjectionsV2({
        ...context,
        businessTimeZone,
        allowedBriefHosts,
      });
    },
  });
  return Object.freeze({
    authenticate,
    decideProposal({ command, principal } = {}) {
      if (command?.decisionType !== 'reject') {
        return proposalStore.accept(command, principal);
      }
      if (!validateTrustedPrincipal(principal).ok
        || !['scheduler', 'administrator'].includes(principal.role)) {
        return Object.freeze({ ok: false, code: 'TRUSTED_SCHEDULER_REQUIRED' });
      }
      const found = proposalStore.read(command?.proposalId);
      if (!found.ok) return found;
      const authorized = found.proposal.resourceScope.every(resourceId => authorizeCapability({
        principal,
        capability: 'modifySchedule',
        resourceId,
      }).allowed);
      if (!authorized) {
        return Object.freeze({ ok: false, code: 'TRUSTED_SCHEDULER_REQUIRED' });
      }
      return proposalStore.reject(command, principal.subjectId);
    },
  });
}

export function createOperationsServer({
  databasePath,
  uploadRoot,
  tokens,
  clock,
  idFactory,
  orphanMaxAgeMs,
  cleanupIntervalMs = 60 * 60 * 1000,
  orphanCleanupMode = 'inherit',
  orphanCleanupEnableEpoch,
  kioskAuthenticate,
  kioskBusinessTimeZone,
  kioskAllowedBriefHosts = [],
  schedulingAuthenticate,
  schedulingAllowedBriefHosts = [],
}) {
  const effectiveClock = clock ?? (() => new Date());
  const store = new ScheduleStore({
    filename: databasePath,
    uploadRoot,
    clock: effectiveClock,
    idFactory,
    orphanMaxAgeMs,
    orphanCleanupMode,
    orphanCleanupEnableEpoch,
  });
  store.cleanupOrphanUploads();
  const kiosk = kioskAuthenticate === undefined
    ? null
    : createKioskV2Application({
        store,
        authenticate: kioskAuthenticate,
        businessTimeZone: kioskBusinessTimeZone,
        clock: effectiveClock,
        allowedBriefHosts: kioskAllowedBriefHosts,
      });
  const scheduling = schedulingAuthenticate === undefined
    ? null
    : createSchedulingV2Application({
        store,
        authenticate: schedulingAuthenticate,
        clock: effectiveClock,
        allowedBriefHosts: schedulingAllowedBriefHosts,
      });
  const server = createServer(createHttpApp({ store, tokens, kiosk, scheduling }));
  let cleanupTimer = null;

  const stopCleanupTimer = () => {
    if (!cleanupTimer) return;
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  };

  const startCleanupTimer = () => {
    if (cleanupTimer || cleanupIntervalMs <= 0 || !store.getOrphanCleanupControlStatus().enabled) return;
    cleanupTimer = setInterval(() => {
      try {
        const result = store.cleanupOrphanUploads();
        if (result?.skipped && result.code === 'ORPHAN_CLEANUP_DISABLED') stopCleanupTimer();
      } catch {
        console.error('Orphan upload cleanup failed; it will retry on the next interval.');
      }
    }, cleanupIntervalMs);
    cleanupTimer.unref();
  };

  const orphanCleanupControl = Object.freeze({
    status: () => store.getOrphanCleanupControlStatus(),
    disable(options) {
      stopCleanupTimer();
      return store.disableOrphanCleanup(options);
    },
    enable(options) {
      const result = store.enableOrphanCleanup(options);
      if (result.ok) startCleanupTimer();
      return result;
    },
  });

  startCleanupTimer();
  server.on('close', () => {
    stopCleanupTimer();
    store.close();
  });
  return { server, store, orphanCleanupControl };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3800);
  const databasePath = resolve(process.env.DATABASE_PATH || './data/shooting-operations.sqlite');
  const uploadRoot = resolve(process.env.UPLOAD_ROOT || './data/uploads');
  const tokens = {
    viewer: process.env.VIEWER_TOKEN,
    submitter: process.env.SUBMITTER_TOKEN,
    scheduler: process.env.SCHEDULER_TOKEN,
    administrator: process.env.ADMIN_TOKEN,
  };
  const orphanCleanupMode = process.env.ORPHAN_CLEANUP_MODE || 'inherit';
  const orphanCleanupEnableEpoch = process.env.ORPHAN_CLEANUP_ENABLE_EPOCH || undefined;
  const { server } = createOperationsServer({
    databasePath,
    uploadRoot,
    tokens,
    orphanCleanupMode,
    orphanCleanupEnableEpoch,
  });
  server.listen(port, host, () => {
    console.log(`Jenn Shooting Operations listening on ${host}:${port}`);
  });
}
