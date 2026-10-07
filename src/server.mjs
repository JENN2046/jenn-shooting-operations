import { createKioskServiceBindingV1, requireKioskServiceBindingV1, assertKioskContextIdentityV1 } from './kiosk-service-context-v1.mjs';
import { createServer } from 'node:http';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpApp } from './http-app.mjs';
import { authorizeCapability, validateTrustedPrincipal } from './authorization-v2.mjs';
import { loadKioskRuntimeAuthV1 } from './kiosk-runtime-auth-v1.mjs';
import { createReadKioskCurrent } from './kiosk-current-use-case-v2.mjs';
import { createApplyKioskRunEvent } from './kiosk-run-event-use-case-v2.mjs';
import { createSqliteKioskCurrentStore } from './sqlite-kiosk-current-store-v2.mjs';
import { createSqliteKioskRunEventStore } from './sqlite-kiosk-run-event-store-v2.mjs';
import { refreshSqliteSnapshotProjectionsV2 } from './sqlite-run-event-store-v2.mjs';
import { assembleSchedulingInputFromSqliteV1 } from './sqlite-scheduling-input-assembler-v1.mjs';
import { createSqliteSchedulingProposalStoreV1 } from './sqlite-scheduling-proposal-store-v1.mjs';
import { createAgentSchedulingServiceV1 } from './agent-scheduling-service-v1.mjs';
import { createBusinessSchedulingApplication } from './business-scheduling-application-v1.mjs';
import { createBusinessRuntimeOptionsFromEnv } from './business-runtime-auth-v1.mjs';
import { ScheduleStore } from './store.mjs';
import { createWriteAdmissionControl, normalizeWriteAdmissionMode } from './write-admission-v1.mjs';
import { assertG3AuthorityReconciliationStartupAllowed } from './g3-authority-reconciliation-startup-gate-v1.mjs';

export function createKioskV2Application({
  store,
  authenticate,
  authenticationChallenge,
  authorizeDeviceId,
  deviceId,
  businessTimeZone,
  serviceBinding,
  clock = () => new Date(),
  allowedBriefHosts = [],
} = {}) {
  if (!store?.db) throw new TypeError('ScheduleStore is required');
  const writeAdmissionControl = store.writeAdmissionControl;
  if (typeof writeAdmissionControl?.isDisabled !== 'function'
      || typeof writeAdmissionControl?.status !== 'function') {
    throw new TypeError('Kiosk ScheduleStore write admission control is required');
  }
  if (typeof authenticate !== 'function') throw new TypeError('Kiosk authenticate port is required');
  if (authenticationChallenge !== undefined
      && (typeof authenticationChallenge !== 'string' || authenticationChallenge.length === 0)) {
    throw new TypeError('Kiosk authentication challenge must be a non-empty string');
  }
  if (authorizeDeviceId !== undefined && typeof authorizeDeviceId !== 'function') {
    throw new TypeError('Kiosk device authorization port must be a function');
  }
  if ((authorizeDeviceId === undefined) !== (deviceId === undefined)) {
    throw new TypeError('Kiosk device identity and authorization port must be configured together');
  }
  if (deviceId !== undefined
      && (typeof deviceId !== 'string'
        || [...deviceId].length > 160
        || !/^\S(?:[\s\S]*\S)?$/u.test(deviceId))) {
    throw new TypeError('Kiosk device identity must be a valid identifier');
  }
  if (typeof businessTimeZone !== 'string' || businessTimeZone.length === 0) {
    throw new TypeError('Kiosk businessTimeZone is required');
  }
  assertKioskContextIdentityV1(serviceBinding, { deviceId, businessTimeZone });
  const readCurrent = createReadKioskCurrent({
    store: createSqliteKioskCurrentStore({ db: store.db }),
    clock,
  });
  const eventStore = createSqliteKioskRunEventStore({ db: store.db, businessTimeZone, allowedBriefHosts });
  const applyRunEvent = createApplyKioskRunEvent({ serviceBinding, store: eventStore, clock });
  return Object.freeze({
    authenticate,
    authenticationChallenge,
    authorizeDeviceId,
    deviceId,
    writeAdmissionControl,
    readCurrent,
    rejectRunEvent({ principal }) {
      if (writeAdmissionControl.isDisabled()) return;
      return applyRunEvent({ command: null, principal });
    },
    applyRunEvent(input) {
      if (writeAdmissionControl.isDisabled()) {
        return Object.freeze({ ok: false, code: 'WRITE_ADMISSION_DISABLED' });
      }
      return applyRunEvent(input);
    },
  });
}

export function createSchedulingV2Application({
  store,
  authenticate,
  clock = () => new Date(),
  allowedBriefHosts = [],
} = {}) {
  if (!store?.db) throw new TypeError('ScheduleStore is required');
  const writeAdmissionControl = store.writeAdmissionControl;
  if (typeof writeAdmissionControl?.isDisabled !== 'function'
      || typeof writeAdmissionControl?.status !== 'function') {
    throw new TypeError('Scheduling ScheduleStore write admission control is required');
  }
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
  const business = createBusinessSchedulingApplication({ db: store.db, writeAdmissionControl, clock, proposalStore,
    refreshProjections: context => {
      const row=store.db.prepare(`SELECT v.config_json FROM scheduling_active_config a JOIN scheduling_config_versions v
        ON v.config_version=a.config_version WHERE a.id=1`).get();
      const businessTimeZone=row ? JSON.parse(row.config_json).businessTimeZone : 'Asia/Shanghai';
      return refreshSqliteSnapshotProjectionsV2({ ...context, businessTimeZone, allowedBriefHosts });
    } });
  return Object.freeze({
    ...business,
    // Injection port only. No route or identity is enabled by constructing this facade.
    agentService: createAgentSchedulingServiceV1({ db: store.db, proposalStore,
      application: business, writeAdmissionControl }),
    authenticate,
    writeAdmissionControl,
    decideProposal({ command, principal } = {}) {
      if (writeAdmissionControl.isDisabled()) {
        return Object.freeze({ ok: false, code: 'WRITE_ADMISSION_DISABLED' });
      }
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
  orphanCleanupDomain,
  kioskAuthenticate,
  kioskAuthenticationChallenge,
  kioskAuthorizeDeviceId,
  kioskDeviceId,
  kioskBusinessTimeZone,
  kioskServiceBinding,
  kioskAllowedBriefHosts = [],
  schedulingAuthenticate,
  schedulingAllowedBriefHosts = [],
  writeAdmissionMode = 'enabled',
}) {
  assertG3AuthorityReconciliationStartupAllowed({ databasePath });
  requireKioskServiceBindingV1(kioskServiceBinding);
  if (kioskAuthenticate === undefined && kioskServiceBinding.mode === 'PROD11_SMOKE_ONLY') {
    throw new Error('KIOSK_SMOKE_CONFIG_REQUIRED');
  }
  const initialWriteAdmissionMode = normalizeWriteAdmissionMode(writeAdmissionMode);
  if (initialWriteAdmissionMode === 'disabled'
      && String(orphanCleanupMode || 'inherit').trim().toLowerCase() !== 'disabled') {
    throw new TypeError('disabled write admission requires disabled orphan cleanup');
  }
  const writeAdmissionControl = createWriteAdmissionControl({
    initialMode: initialWriteAdmissionMode,
  });
  const effectiveClock = clock ?? (() => new Date());
  const store = new ScheduleStore({
    filename: databasePath,
    uploadRoot,
    clock: effectiveClock,
    idFactory,
    orphanMaxAgeMs,
    orphanCleanupMode,
    orphanCleanupEnableEpoch,
    orphanCleanupDomain,
    writeAdmissionControl,
  });
  store.cleanupOrphanUploads();
  const kiosk = kioskAuthenticate === undefined
    ? null
    : createKioskV2Application({
        store,
        authenticate: kioskAuthenticate,
        authenticationChallenge: kioskAuthenticationChallenge,
        authorizeDeviceId: kioskAuthorizeDeviceId,
        deviceId: kioskDeviceId,
        businessTimeZone: kioskBusinessTimeZone,
        serviceBinding: kioskServiceBinding,
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
  const server = createServer(createHttpApp({
    store,
    tokens,
    kiosk,
    scheduling,
    writeAdmissionControl,
  }));
  const cleanupTimer = cleanupIntervalMs > 0
    ? setInterval(() => {
        try {
          store.cleanupOrphanUploads();
        } catch {
          console.error('Orphan upload cleanup failed; it will retry on the next interval.');
        }
      }, cleanupIntervalMs)
    : null;
  cleanupTimer?.unref();

  const orphanCleanupControl = Object.freeze({
    status: () => store.getOrphanCleanupControlStatus(),
    disable: options => store.disableOrphanCleanup(options),
    enable: options => store.enableOrphanCleanup(options),
  });

  server.on('close', () => {
    if (cleanupTimer) clearInterval(cleanupTimer);
    store.close();
  });
  return {
    server,
    store,
    orphanCleanupControl,
    writeAdmissionControl,
  };
}

export function createKioskRuntimeOptionsFromEnv(env = process.env) {
  const serviceBinding = createKioskServiceBindingV1({
    context: env.KIOSK_SERVICE_CONTEXT,
    expectedItem: env.KIOSK_SMOKE_EXPECTED_SCHEDULE_ITEM_ID,
    start: env.KIOSK_SMOKE_ACCEPTANCE_RUN_START,
    end: env.KIOSK_SMOKE_ACCEPTANCE_RUN_END,
  });
  const configPath = typeof env.KIOSK_AUTH_CONFIG_PATH === 'string'
    ? env.KIOSK_AUTH_CONFIG_PATH.trim()
    : '';
  if (configPath === '') {
    if (serviceBinding.mode === 'PROD11_SMOKE_ONLY') throw new Error('KIOSK_SMOKE_CONFIG_REQUIRED');
    return Object.freeze({ kioskServiceBinding: serviceBinding });
  }
  if (!isAbsolute(configPath)) throw new Error('KIOSK_AUTH_CONFIG_PATH_NOT_ABSOLUTE');
  const forbiddenCredentialValues = [
    env.VIEWER_TOKEN,
    env.SUBMITTER_TOKEN,
    env.SCHEDULER_TOKEN,
    env.ADMIN_TOKEN,
  ].filter(value => typeof value === 'string' && value.length > 0);
  const runtime = loadKioskRuntimeAuthV1({
    configPath,
    forbiddenCredentialValues,
  });
  if (serviceBinding.context === 'PROD11_PRODUCTION'
    && (runtime.realm !== 'Jenn Shooting Operations Kiosk' || runtime.username !== 'jso-kiosk-prod-01')) {
    throw new Error('KIOSK_PRODUCTION_IDENTITY_MISMATCH');
  }
  assertKioskContextIdentityV1(serviceBinding, runtime.principal ? {
    deviceId: runtime.deviceId, resourceIds: runtime.principal.resourceIds, businessTimeZone: runtime.businessTimeZone,
  } : {});
  return Object.freeze({
    kioskServiceBinding: serviceBinding,
    kioskAuthenticate: runtime.authenticate,
    kioskAuthenticationChallenge: runtime.authenticationChallenge,
    kioskAuthorizeDeviceId: runtime.authorizeDeviceId,
    kioskDeviceId: runtime.deviceId,
    kioskBusinessTimeZone: runtime.businessTimeZone,
    kioskAllowedBriefHosts: runtime.allowedBriefHosts,
  });
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3800);
  const databasePath = resolve(process.env.DATABASE_PATH || './data/shooting-operations.sqlite');
  assertG3AuthorityReconciliationStartupAllowed({ databasePath });
  const uploadRoot = resolve(process.env.UPLOAD_ROOT || './data/uploads');
  const tokens = {
    viewer: process.env.VIEWER_TOKEN,
    submitter: process.env.SUBMITTER_TOKEN,
    scheduler: process.env.SCHEDULER_TOKEN,
    administrator: process.env.ADMIN_TOKEN,
  };
  const orphanCleanupMode = process.env.ORPHAN_CLEANUP_MODE || 'inherit';
  const orphanCleanupEnableEpoch = process.env.ORPHAN_CLEANUP_ENABLE_EPOCH || undefined;
  const orphanCleanupDomain = process.env.ORPHAN_CLEANUP_DOMAIN || undefined;
  const writeAdmissionMode = process.env.WRITE_ADMISSION_MODE || 'enabled';
  const kioskRuntimeOptions = createKioskRuntimeOptionsFromEnv(process.env);
  const { server, writeAdmissionControl } = createOperationsServer({
    databasePath,
    uploadRoot,
    tokens,
    orphanCleanupMode,
    orphanCleanupEnableEpoch,
    orphanCleanupDomain,
    writeAdmissionMode,
    ...kioskRuntimeOptions,
    ...createBusinessRuntimeOptionsFromEnv(process.env),
  });

  const enableWriteAdmission = () => {
    const result = writeAdmissionControl.enable();
    console.log(JSON.stringify({
      event: result.code,
      writeAdmission: result.mode,
      transitionCount: result.transitionCount,
    }));
  };
  if (writeAdmissionControl.isDisabled()) {
    process.on('SIGUSR2', enableWriteAdmission);
    server.on('close', () => process.off('SIGUSR2', enableWriteAdmission));
  }

  server.listen(port, host, () => {
    console.log(`Jenn Shooting Operations listening on ${host}:${port}`);
  });
}
