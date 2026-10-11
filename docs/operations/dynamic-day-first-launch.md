# Manual same-day adjustment (local candidate, not deployment authority)

Jenn's initial template is Asia/Shanghai, Mon–Sat 09:00–12:00 and 13:30–18:00, Sunday off, no alternating Saturday. Set the agreed initial effective date **2026-10-12** explicitly in the configuration; it is not an immutable runtime constant. Duration defaults start empty. Buffer starts at 20 minutes and remains configurable.

The management UI supports ordinary weekly/alternating Saturday configuration, optional type duration defaults, configuration buffer editing, and an administrator's explicit per-request minutes. The persisted `细节` subtype remains compatible; its user-facing still-life label includes product 3D main images, detail and function images. Detailed deliverable prose distinguishes these; there is no new 3D modeling/rendering capability or independent subtype statistics.

## Day adjustment

Choose a same-day anchor, proposed start/end (future plan) or estimated end (current execution), and this anchor's buffer. Preview the original/new times and unresolved constraints. Confirming recomputes the preview under one write transaction; stale state rejects the whole operation. No partial batch, reordered jobs, automatic cancellation, overtime or next-day movement. Completed/run/locked facts are not rewritten. Other saved buffers/defaults do not change when one anchor buffer changes.

Forecast mode requires exactly one existing shooting/blocked run. The page shows available actual state separately, and does not create start/complete events. Without an execution record, it does not guess that an expired plan has finished. A forecast over lunch is shown as an out-of-default-window estimate, not authorization for overtime; subsequent work must still fit the calendar. Unknown or fixed constraints block saving. Known actual completion extends the protected release boundary where needed.

Configuration changes and date exceptions retain their existing preview/publish/activate path. They do not silently rewrite old plans. Duration/buffer defaults take effect upon configuration activation (no scheduled future default activation); calendar rules have effective dates. A day exception and batch movement are not silently combined into a new workflow. If their prerequisites conflict, show unresolved and stop.

API: `POST /api/v2/business/day-adjustment/preview` takes `{scheduleItemId,resourceId,mode,plannedStart,endAt,bufferAfterMinutes}`; forecast uses null plannedStart. `POST .../apply` takes `{operationId,input,previewDigest}`. Both require an administrator for the resource; confirmation obeys write admission and maintenance exclusion. Reconcile via existing business operations GET. Batch v2 receipts share the immutable reschedule table with old v1 single-move receipts; schema stays 11.

## Greenfield tool

`node scripts/create-greenfield-domain.mjs --synthetic-new-root /tmp/jso-empty-maintenance-<unique>` creates a new private schema-only test directory. Any existing target is refused. It seeds only the shared empty legacy row, never counters/projections/initialization receipts. Existing initialization follows separately. A partial failure is retained for diagnosis; there is no overwrite/reset/retry option.

`--approved-new-root` uses the production filename but **does not verify or grant approval**. This candidate is not authorized for production. A prospective production operation still needs frozen exact target, trusted executor, volume/permission/fence observations, backups and separate initialization/acceptance approval. No production volume or acceptance is created by this script.

## Delivery limitations

- Existing ordinary submissions write legacy schedule_state, not canonical requests_v2. Sample readiness/priority intake is also not wired through this change. Do not claim ordinary new-order submission through first scheduling is complete. Tests that seed canonical requests prove the duration/proposal/adjustment path only.
- Actual run events remain separate existing functionality. This UI has no manual start/complete entry and does not enable Kiosk or external integration.
- Local listener EPERM was respected. Shipped UI handlers were tested with a synthetic DOM and in-process HTTP, not a browser or socket. Production, pushing, merging and P2 legacy snapshot work are outside this candidate.
