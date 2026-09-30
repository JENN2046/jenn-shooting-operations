# PROD-11 bounded Kiosk implementation R1

Implementation and isolated tests only. This document does not amend the frozen
PROD11 deployment contract or production Greenfield authority. Authorization stays
`FROZEN_NOT_REQUESTED`; requested, approved and requestable action arrays stay empty.
No production host, credential, data, provider, image or container was touched.

Base: `b9ba1052ea7cef62116df938b4849d4ed7597809`, the merge of PR #36 on
`codex/v2-1-architecture-freeze`. The saved cloud checkout initially contained
`ea09f5f2975e5ff0ae906a47a9ef9d7bee155d7f`; it was not the implementation base.
Only stale PR #34 was open at the initial/repeated alignment reads. No repository
AGENTS.md or .agents/skills files were present in the authority tree.

## Capability mapping

| Frozen capability | Implementation and evidence |
| --- | --- |
| KIOSK_EVENT_ATOMIC_PRODUCTION_CONTEXT_CAPABILITY | Inside the existing BEGIN IMMEDIATE, check the exact expected item, resource STUDIO-PROD-01, exact single GF15 request binding, confirmed single item covering the window, unique current candidate/active run and active Scheduling Asia/Shanghai timezone. A device GET is not write authority. |
| KIOSK_SMOKE_BOUNDED_WRITE_ADMISSION_CAPABILITY | Start sequence/revision 0, then complete sequence/revision 1. Both client occurredAt and trusted post-lock clock must lie inside the immutable inclusive window. Persist exact normalized commands, digests, run/event IDs and timestamps with canonical receipts. Validate previous phase receipts before continuing. Terminal authority cannot admit a third mutation. Exact accepted replay is a fact-free exception after terminal/expiry. |
| KIOSK_SMOKE_OUTBOX_ISOLATION_CAPABILITY | Enqueue the completion intent and its exact permanent payload-digest isolation in the same transaction. Outbox claim excludes it on all retry/lease paths, including after reopening the database. Unrelated intents remain deliverable. This is separate from GF15 schedule.confirmed.v1 isolation. |
| KIOSK_TRUSTED_SERVICE_CONTEXT_SIGNAL_CAPABILITY | Both environment entrypoint and programmatic server construction require an independently supplied immutable service binding. Production auth cannot select isolated admission. Missing/unknown context and incomplete smoke bindings fail before listen. |

Runtime startup inputs are `KIOSK_SERVICE_CONTEXT` and, only for production smoke,
`KIOSK_SMOKE_EXPECTED_SCHEDULE_ITEM_ID`, `KIOSK_SMOKE_ACCEPTANCE_RUN_START` and
`KIOSK_SMOKE_ACCEPTANCE_RUN_END`. Window values use canonical `Date.toISOString()`
UTC form. The deployment authority must copy the exact approved item/window into
these inputs; the code does not invent an authorization packet or derive authority
from a database current item. Auth JSON cannot supply any of these inputs.

`PROD11_PRODUCTION` without auth configuration keeps Kiosk disabled. With auth,
the frozen device/resource/timezone/realm/username and all smoke bindings are
mandatory. `WO03_ISOLATED_ACCEPTANCE` rejects the production device/resource and
all production smoke variables. Existing test fixtures explicitly declare isolated
context; there is no ordinary-production fallback. The browser continues to use
Web Crypto randomUUID for RUN and EVENT identifiers, with no predictable ID list.
Server UUID structure checks do not purport to prove client entropy.

Migration v8 adds only empty smoke binding, phase, stop and Outbox-isolation control
tables. The previous seven migrations are unchanged. Immutable triggers prevent
update/delete/replace of smoke control evidence. Deployment and image rollback
planning must account for v8; this implementation does not deploy or authorize a
schema upgrade on the production volume.

## Failure and recovery boundary

A denied admitted smoke attempt rolls back business, review, receipt, audit,
projection and notification changes. Only immutable binding/stop control evidence
may remain. Authenticated HTTP validation failures also stop the smoke. No new
phase can follow a durable stop, including after reopening the database; exact
accepted receipt replay remains available. A normal-operation or recovery/reset
API is intentionally absent.

If SQLite cannot enter or commit a transaction, no durable stop can be promised
while storage is unavailable. The current application instance latches interruption
and persists the stop at its next successful write boundary. After any such error,
the frozen operational failure rule still requires disabling/rolling back Kiosk
configuration; an unreviewed process restart is not recovery authority. Crash or
storage-loss recovery is not claimed by these tests and must not be used to resume
smoke under an old packet.

## Validation and review

All execution fixtures use disposable memory databases or mkdtemp directories.
Canonical GF15 preparation is simulated only inside these isolated fixtures; no
production GF15 or PROD11 action is executed. HTTP checks listen only on loopback.
No DingTalk/VCP provider network calls are made by the new tests.

Required commands, rerun against the final committed head before delivery:

- `node --test tests/kiosk-*.test.mjs tests/*outbox*.test.mjs tests/gf15-*.test.mjs`
- `npm run check` (contract, shadow, production manifest, Greenfield authority and full tests)
- `node scripts/verify-migration-recovery-acceptance.mjs`
- `node scripts/verify-external-readiness-boundaries.mjs`

The task's final report/PR records the exact commit, test counts and remote state.
The cloud runtime is Node 24.19.0, which meets package.json >=24.16.0; the repository
GitHub workflows pin 24.21.0, so local results do not claim a GitHub workflow run.

The separate call-path review covers startup -> HTTP -> application -> use-case ->
SQLite transaction -> Outbox repository, plus direct use-case composition. Repairs
from that review include transaction-time clock capture, prior-phase receipt
integrity, HTTP rejection stopping, required context for programmatic server
construction, and permanent claim exclusion. This is a local code-review pass,
not an independent human/GitHub Codex approval. GitHub Codex review was previously
quota-blocked; no older-head review or purchased credit is accepted as evidence.

## Gates deliberately still open

Implementation test PASS is not production acceptance, requestability or normal
Kiosk operating authority. The following remain separate:

- exact replacement image build/freeze and separately authorized deployment with
  Kiosk disabled, including storage/schema/rollback compatibility;
- separately authorized GF15 production scheduling preparation and fresh target packet;
- separately frozen and completed WO03 setup authority, endpoint/database/test
  identity, single/grouped fixture digests and exact device/browser/accessibility targets;
- real WO03 matrix execution after PROD11 authorization, on the same immutable
  replacement image, before production Kiosk activation;
- fresh whole-database brief-host evidence, seven PROD11 revalidation gates and
  current Greenfield authority explicitly admitting the exact action;
- separately frozen post-smoke normal-operation transition authority;
- exact-head independent review and any required CI before a separately approved merge.
