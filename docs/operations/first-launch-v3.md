# Local first-launch candidate: structured classifications and owner actions

This candidate extends `9686aff` for the Owner-approved local implementation and synthetic acceptance. It grants no production deployment/migration, credentials, network changes, external delivery, push or merge authority. Earlier R2 classification merging was rejected and is not implemented.

## Business path

Use `/manage`. Jenn owns one `FLAT` resource shared by static product images, model and scene photography. New orders use `POST /api/v3/business/requests` and the existing canonical `requests_v2` model. No legacy-snapshot staging or GF15 request package is involved.

| Category (`kind`) | Stored shooting subtype | Display |
| --- | --- | --- |
| 静物 | 产品3D主图 | 静物 / 产品3D主图 |
| 静物 | 细节图 | 静物 / 细节图 |
| 静物 | 功能图 | 静物 / 功能图 |
| 模特 | 模特 | 模特 |
| 场景 | 场景 | 场景图 |
| historical 细节 | unchanged 细节 | 历史细节（未细分） |

Static subtypes remain distinct in canonical projections, request filters/counts, scheduling rules and run context snapshots. Old detail records are never inferred into a new subtype. No modeling/rendering functionality exists. Historical static detail estimates do not silently become subtype-specific estimates.

V3 retains the existing minimum submission requirements. Ratio may be 待定, reflectivity unknown, note empty, and uploads empty. Brief URL, shelf and hero are optional. Sample status/priority have no unknown enum; missing facts are not guessed. Explicit per-order duration is needed before first scheduling; unverified samples cannot be scheduled. UI attachment upload is deferred; service-level ownership checks preserve current-operation, unclaimed attachments and reject old assets. Fact edits preserve optional shelf/URL/hero omitted by the UI, do not replace attachments, and require an open unbound order with no run history.

Order writes bind actor, complete command and global schedule/projection revisions to an operation ID. Order, attachment claims, receipt, audit, counters and projections commit together. Administrator authority must cover the whole resource catalogue; receipts remain scoped. Idempotency is checked across existing operation families.

`POST /api/v3/business/run-events` accepts only eventId/runId/scheduleItemId/eventType/expectedRunRevision. Owner actions are `start` and `complete`. Actor comes from authenticated administrator identity; source is `owner-management-v3`; occurredAt is the server acceptance time, never a client-supplied historical time. A legal first start atomically provisions a scheduled run then applies the existing state machine. One resource cannot have two shooting/blocked runs. Complete requires shooting. Exact replay preserves the original time; history cannot be restarted or backdated. Existing event state transitions, immutable event ownership, counters, metrics and completion semantics are reused. Pause/resume and correction UI are deferred.

Manual forecast remains an estimate receipt, not an actual event. Preview and explicit confirmation preserve same-day resource/order constraints and revalidate facts/config/versions atomically. Begun/completed/locked scenes are not silently moved. No implicit cross-day move, cancellation or overtime authorization.

## Explicit version boundaries

- Schema12 is a new migration. Migrations 1–11 SQL/checksums remain identical. It rebuilds requests, projection/config version constraints and run-context version constraints under an FK-checked transaction, restoring FK enforcement on success/failure. Existing row values and historical immutable content are copied unchanged. Runtime startup still never auto-crosses the pre-cutover schema boundary.
- Submission/canonical snapshot protocol V3 adds category/subtype values and pairing validation. Legacy V1 writes/reads and V2 HTTP routes against a Schema12 domain return `CLIENT_PROTOCOL_UPGRADE_REQUIRED`; they do not coerce classifications, return stale cached snapshots or silently omit records. The business UI uses V3 routes. Schema11 routes and their tests remain explicit legacy coverage.
- Scheduling config V3 uses `calendar-compiler-v3`, input schema2 and `deterministic-scheduler-v2`, with distinct config/command digest domains. Prior config/input normalizers retain closed enums and digest behavior. The proposal/result envelope is reused where its shape does not change; it binds compiler/algorithm/config and complete normalized input. Run context snapshots use schema2 and a separate digest domain on V3 execution; historical schema1 snapshots are not rewritten. Legacy shadow evaluation does not automatically admit new context versions; retrospective extraction/reporting beyond the management subtype counts is not claimed.
- New V3 configs explicitly bind `externalNotifications: disabled`. New first scheduling writes a scoped `business.notificationPolicy.v3` operation/audit receipt keyed to its decision. Actual-event receipts also state `NOT_ENQUEUED_EXTERNAL_DELIVERY_DISABLED`. No external notification is queued on these paths. Old paths still queue; existing pending/leased notifications still block modification. No queue is cleared or marked sent. Future enabling/backfill is outside this candidate.

## New-domain preparation and acceptance

`create-greenfield-domain.mjs` creates a nonexistent directory exclusively, Schema12 structure, empty legacy seed and disabled cleanup control, returning exact file identities/hash and `initialized:false`. An explicit Schema11 parameter is retained for legacy fixture regression. `--approved-new-root` does not confer authority, and the tool does not create volumes or start services.

The existing empty-domain initializer now recognizes a separate exact Schema12 migration digest. Old Schema10/11 packets cannot initialize Schema12. The new R4 acceptance contract has `version:4`, `purpose:CORE_SCHEMA12_PROSPECTIVE_ACCEPTANCE` and baseline schema12; R3 schema11 remains unchanged and cannot admit schema12. Identity/hash/source/owner-material/custody checks remain in force. Schema12 initialization/current-state verification expects the V3 projection and exact Schema12 initialization binding.

This is a **fresh-domain** startup candidate. A historical Schema11→12 data-preservation migration test does not authorize reopening an existing production domain with old acceptance/initialization records. Such a transition needs its own prospective approval/design; do not reinitialize a nonempty domain or forge a new initial receipt. Neither R4 nor this source is installed in production.

Synthetic acceptance copies the application to a temp root, replaces custody/UID only in that copy and uses clearly SYNTHETIC identities/approval/backup placeholders. It exercises new-domain creation, the real initializer, PREPARED read-only gating, ACTIVE configuration, five orders via authenticated in-process HTTP, explicit durations, first adoption, start/forecast/atomic adjustment/complete, close and independent process read-back. It is not a real root custody, backup/restore, image or production acceptance proof.

UI tests execute shipped handlers with a synthetic DOM and real in-process HTTP. They are not browser/rendering/socket tests. Existing listener EPERM is respected. Earlier eight baseline-failing files and eight listener-excluded files are recorded separately and never counted as passing.
