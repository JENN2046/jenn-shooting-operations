# JSO Core Canonical R1

Status: **G1 CORE_CANONICAL CANDIDATE / LOCAL VALIDATED / NOT DEPLOYED**

Base authority commit:

`b781fef9e4717263d42ec0d5d14d1249b8603723`

Candidate branch:

`codex/jso-core-canonical-r1`

This document is a source-scope and ownership reset. It does not authorize production deployment,
Schema 11 cutover, Kiosk release, VCP extension installation, 115 access, or any production write.

## 1. Decision

Jenn Shooting Operations remains the owner of shooting-operation facts and business behavior:

- request intake;
- scheduling and proposal generation;
- business calendar rules;
- single-session rescheduling;
- management UI and business authentication;
- Kiosk/run-event domain behavior already present in the base;
- JSO-side Agent read/preview/adopt/reschedule service and exact server-side grant enforcement;
- SQLite schemas, revisions, receipts, audit and projections.

The following are **not** JSO Core:

- VCPToolBox transport, stdio plugin or native tool registration;
- generic browser tooling;
- generic process/FD lifecycle, custody, owner/parent supervision or launch proof frameworks;
- synthetic local backup transport implementation;
- historical production-control experiments and evidence directories.

Unknown production state is never reconstructed from repository history. Live production facts require a fresh
authoritative observation before a production action.

## 2. Three active workstreams

### A. Product Core Canonicalization

Bring the reviewed business-development implementation onto one reviewable Git line. No C01/custody/orchestrator
stack is admitted as a prerequisite.

### B. Minimal Schema 11 Release

A future release contract is limited to:

1. durably disable normal writers;
2. bind one exact Schema 11 artifact;
3. establish usable pre-state and recovery evidence;
4. run one bounded migration/configuration transaction;
5. classify the result as COMMITTED, ROLLED_BACK or UNKNOWN;
6. keep writes blocked on UNKNOWN until explicit reconciliation and re-admission.

Safety must not depend on an owner/helper process remaining alive indefinitely.

Ordinary JSO runtime bootstrap is pinned to the pre-cutover Schema 10 prefix. It may validate and open an
already-migrated Schema 11 database, but it cannot perform the 10 → 11 transition. Before cutover, the new
business and Agent surfaces return `BUSINESS_SCHEMA11_REQUIRED` instead of manufacturing Schema 11.

### C. Production V1 Closure

After Schema 11 cutover, close the real business loop:

`Submit → Schedule → Agent proposal → Human accept → Kiosk → Run event → Current truth → Backup/readback`.

No additional production framework is created merely because a finding appears.

## 3. Gate ceiling

Only these gates are valid for this closure:

- **G0 SCOPE_RESET**: historical local surfaces classified and removed from the active prerequisite graph.
- **G1 CORE_CANONICAL**: this candidate is clean, tested, reviewable and becomes canonical Git truth.
- **G2 MINIMAL_RELEASE_CONTRACT**: the six release invariants above are frozen.
- **G3 SCHEMA11_CUTOVER**: one bounded production cutover with fail-closed reconciliation.
- **G4 PRODUCTION_V1_CLOSURE**: real business loop plus backup/readback accepted.

A P0/P1 finding blocks and is repaired inside its current gate. It does not create a new gate family.
P2/P3 findings go to backlog unless they invalidate a current gate invariant.

## 4. Original 44-surface audit

The source worktree had 44 Git-status surfaces: 18 tracked modifications and 26 untracked entries.
One grouped entry, `tools/`, contains two owners and was expanded before admission.

### 4.1 Admit to JSO Core

| Surface | Reason |
| --- | --- |
| `public/board.html` | exposes the management workbench |
| `src/deterministic-scheduler-v1.mjs` | explicit calendar-v1/v2 compatibility |
| `src/http-app.mjs` | JSO business routes and management assets |
| `src/run-context-capture-v1.mjs` | reads active v1/v2 calendar safely |
| `src/scheduling-contract-v1.mjs` | versioned compiler admission without broadening v1 API |
| `src/scheduling-proposal-contract-v1.mjs` | proposal verification across supported compiler versions |
| `src/server.mjs` | business application composition and internal Agent service injection |
| `src/sqlite-scheduling-admin-store-v1.mjs` | v2 config publication/activation guard |
| `src/sqlite-scheduling-input-assembler-v1.mjs` | v2 calendar/compiler input assembly |
| `src/sqlite-scheduling-proposal-store-v1.mjs` | pure preview and atomic exact-preview adoption |
| `src/sqlite-schema-v2.mjs` | Schema 11 business migration |
| `tests/gf15-schema-v1.test.mjs` | regression against the new latest schema |
| `tests/kiosk-review-schema-v2.test.mjs` | regression against the new latest schema |
| `tests/kiosk-smoke-schema-v1.test.mjs` | regression against the new latest schema |
| `tests/schema-migrations.test.mjs` | Schema 11 migration/rollback evidence |
| `public/manage.css` | business workbench |
| `public/manage.html` | business workbench |
| `public/manage.js` | business workbench |
| `scripts/verify-local-business-ui.mjs` | reproducible browser acceptance for the workbench |
| `src/agent-scheduling-service-v1.mjs` | JSO-owned Agent domain facade |
| `src/business-defaults-v1.mjs` | explicit initial business calendar/resource defaults |
| `src/business-http-v1.mjs` | business HTTP routing/result surface |
| `src/business-runtime-auth-v1.mjs` | opt-in server-side business identity binding |
| `src/business-scheduling-application-v1.mjs` | management/calendar/reschedule application boundary |
| `src/jso-agent-host-v1.mjs` | JSO-side Agent boundary composition |
| `src/scheduling-admin-contract-v2.mjs` | calendar v2 contract/compiler |
| `src/scheduling-contract-compat.mjs` | explicit v1/v2 compatibility dispatch |
| `src/sqlite-schedule-reschedule-schema-v1.mjs` | immutable reschedule receipt schema |
| `src/sqlite-schedule-reschedule-store-v1.mjs` | canonical single-session reschedule transaction |
| `src/sqlite-scheduling-calendar-schema-v2.mjs` | Schema 11 calendar storage definition |
| `tests/agent-scheduling-service-v1.test.mjs` | Agent domain boundary regression |
| `tests/business-management-v1.test.mjs` | management HTTP/application regression |
| `tests/scheduling-admin-contract-v2.test.mjs` | calendar v2/migration regression |
| `tests/sqlite-schedule-reschedule-store-v1.test.mjs` | reschedule transaction regression |

The original mixed `src/jso-agent-adapter-v1.mjs` is **not admitted**. Its JSO-owned subset was re-admitted
as `src/jso-agent-api-v1.mjs`: strict API envelope, identity/grant authority, exact command digest,
unknown-result handling and the dedicated HTTP handler only.

The original mixed `tests/jso-agent-adapter-v1.test.mjs` is **not admitted**. JSO-side guarantees are covered
by `tests/jso-agent-api-v1.test.mjs`; VCP transport/plugin tests move with their external owner.

### 4.2 Release-only compatibility

These are included only because adding Schema 11 must not silently broaden or break the existing
Schema-10 empty-database maintenance contract:

| Surface | Boundary |
| --- | --- |
| `src/empty-db-maintenance-v1.mjs` | pins maintenance to migrations 1-10 |
| `tests/empty-db-maintenance-v1.test.mjs` | proves Schema 11 remains refused by that contract |
| `tests/support/empty-db-maintenance-fixture.mjs` | compatibility fixture |

The following local backup surfaces are **release-only but not admitted to this Core candidate**:

- `tests/local-business-backup.test.mjs`
- `tools/local-backup/family-verifier.mjs`

They remain useful evidence for G2/G3 design but are not a production backup adapter.

### 4.3 Owner-transfer

The original mixed VCP adapter surfaces do not belong to the JSO repository owner boundary:

- `src/jso-agent-adapter-v1.mjs`: rejected as a mixed surface; JSO server half was re-admitted as
  `jso-agent-api-v1.mjs`, VCP transport/plugin half transfers out.
- `tests/jso-agent-adapter-v1.test.mjs`: VCP transport/plugin cases transfer with that owner.
- `tools/agent-vcp-r1/`: stdio and disabled plugin manifest transfer to
  `JENN2046/VCPToolBox-JENN-Extensions` for independent review and installation decisions.

No transfer is treated as deployed merely because the source exists.

### 4.4 Evidence-only

These local design/delivery notes do not enter the canonical product tree:

- `docs/architecture/migration/SCHEDULE_RESCHEDULE_V1_LOCAL_PROPOSAL.txt`
- `docs/development/`
- `docs/proposals/`

Their validated conclusions are represented by source, tests and this bounded canonical record.

### 4.5 Grouped tools surface

The original Git-status entry `tools/` was not semantically atomic:

- `tools/agent-vcp-r1/` → **OWNER-TRANSFER**
- `tools/local-backup/` → **RELEASE-ONLY**

The directory itself is therefore not copied wholesale.

## 5. Historical production-control status

Frozen production manifest/authority documents from the base are preserved for provenance and validation.
They may still report historical values such as `nextActionId=PROD-GF-15-PREPARE-DEVICE-ACCEPTANCE-SCHEDULE`.

Those values are **not the current JSO roadmap after the Scope Reset**. They cannot create a new active gate,
authorize production, or override G0-G4. A future G2/G3 packet must be rebuilt from fresh facts.

The last retained production read-only observation ended fail-closed with `STOP_PRESERVE / SAMPLE_CHANGED`.
It is evidence of an unresolved historical observation, not current production truth.

## 6. Validation of this candidate

Fresh validation on Node 24.21.0 / Debian:

- P1/narrow targeted tests: **148 / 148 PASS**;
- repository validators: **PASS**;
- full suite: **1024 total, 1023 PASS, 0 FAIL, 1 existing conditional skip**;
- conditional skip: external VCPToolBox/JENN-Extensions adapter package identity not supplied;
- fresh real-Chrome local business UI acceptance: **10 / 10 PASS**.

The browser test uses a disposable loopback server and synthetic database. It is not production acceptance.

## 7. Explicit exclusions

This candidate does not import any active prerequisite from:

- C01 FD/custody evolution;
- release-orchestrator R1-R5;
- proof/binding/site-control/control-service stacks;
- native-lane/loader/finalization/failure-completion stacks;
- launch-custody proposals;
- the 193-directory local experiment graph.

Those materials remain historical evidence or generic-infrastructure research. They cannot block G1.

## 8. G1 exit condition

G1 is complete only when:

1. this candidate receives source review with no unresolved P0/P1 Core finding;
2. exact-head CI passes;
3. the canonical Git branch is updated through a reviewed PR;
4. stale open PRs/default-branch routing are reconciled separately without changing product scope;
5. no excluded historical control stack is reintroduced as a prerequisite.

Until then this branch is a **canonical candidate**, not canonical production truth.
