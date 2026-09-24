# WO-06A Predeploy Evidence Baseline

- Authority base: `8d5747439ccdfb29dd78ae294c1df82cba6476a3`
- Branch: `codex/wo-06a-predeploy-evidence-baseline`
- Current result: `BASELINE_FIX_IN_PROGRESS`
- Deployment gate: `BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE`

## Frozen baseline assertions

### Local/runtime

Fresh CI must prove:

- Node host runtime is exactly `24.21.0`;
- `npm ci` succeeds from the checked-in lockfile;
- `npm run check` succeeds;
- no test converts the external VCP adapter skip into a false PASS.

### Container

Fresh CI must prove:

- Docker image builds from the checked-in Dockerfile;
- image user is non-root;
- image command does not add `--experimental-sqlite`;
- empty named volume can start the service;
- `/healthz` returns success;
- runtime uid is non-zero;
- SQLite database is created on the volume;
- the service can be removed and started again using the same volume;
- the second start is healthy.

Build registry access used by CI is infrastructure access, not authorization for application/provider network calls.

## Known evidence boundaries

### VCP

`tests/vcp-sync-integration.test.mjs` looks for:

`../../../runtime/VCPChat/modules/services/shootingPlannerSyncService.js`

When absent, it explicitly skips with:

`external VCP sync adapter is not present in this workspace`

Therefore WO-06A records VCP compatibility as `EXTERNAL_BLOCKED`, not PASS.

### Kiosk

`docs/acceptance/WO-03_KIOSK_BROWSER_AND_DEVICE_ACCEPTANCE.md` records:

`PASS_WITH_LIMITS / BROWSER_AND_DEVICE_NOT_RUN`

Therefore real browser/device acceptance remains for WO-06C.

### DingTalk

WO-04 records `PASS_WITH_LIMITS / LOCAL_ONLY`; real adapter/SDK/credential/callback integration remains unwired.

Therefore real DingTalk readiness remains for WO-06C.

### Migration and recovery

The repository contains migration, backup, restore, rollback and recovery contracts/tests, including WAL content/identity hardening. WO-06A records this as existing evidence only. WO-06B owns fresh migration/backup/restore/rollback acceptance.

## Result rules

If any local/container assertion fails:

```text
WO-06A_BLOCKED_LOCAL
BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

If all 06A assertions pass:

```text
WO-06A_PREDEPLOY_EVIDENCE_BASELINE_PASS
BLOCKED_BY_PRODUCTION_DEPLOYMENT_GATE
```

No 06A result may authorize deployment or close real external-integration gates.


## Baseline run history

### Run 1 — BLOCKED_LOCAL

- Head: `4a62c1adf307f9f389455401a14fd75da6e44c79`
- GitHub Actions run: `35973334636`
- Node host runtime: `24.21.0`
- `npm ci`: PASS
- `npm run check`: PASS
- Docker build: PASS
- image non-root contract: PASS
- no `--experimental-sqlite`: PASS
- empty-volume startup: FAIL

Failure evidence:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ajv'
imported from /app/src/kiosk-contract-validator-v2.mjs
```

Root cause: the image copied `package.json` and application sources but did not copy `package-lock.json` or install declared runtime dependencies.

Minimal correction on this branch:

- pin Docker base to `node:24.21.0-alpine`;
- copy `package.json + package-lock.json`;
- run `npm ci --omit=dev --ignore-scripts`;
- keep non-root user, data volume, healthcheck and application command unchanged.

Run 1 is not a PASS and is preserved as failure evidence. A fresh rerun is required.
