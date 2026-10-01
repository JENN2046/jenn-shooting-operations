# Empty-domain maintenance implementation contract R1

This implementation depends on the unmerged PR40 planning packet. It supplies an
explicit local synthetic maintenance runner and an internal transaction service;
it does not authorize production bootstrap. No ordinary startup or HTTP route
invokes it. A production adapter with independently verified host, volume, runtime,
owner and writer/cleanup fence remains a separate reviewed execution prerequisite.

The minimum packet binds schema10 and its complete migration digest, canonical DB
and empty uploads paths with device/inode, preserved disabled-cleanup namespace and
marker digest, source revision, immutable image identity,
business timezone, an operation ID and expected schedule/projection revisions.
Each packet is independently admitted by a separate local authorization record
binding its digest, actor, approval reference and disabled admission/cleanup/Kiosk
state. This record is an explicit synthetic test trust port, not authentication or
a production permission grant. The CLI accepts only a newly allocated
`/tmp/jso-empty-maintenance-*` root; it refuses production paths and env-based DB
defaults. Filesystem exclusivity and the absence of other processes are required
operator preconditions; SQLite BEGIN IMMEDIATE serializes concurrent commands and
rejects any existing GF15 scheduling lease. It does not fence an uncooperative
process or establish production ownership from a caller assertion.

`initialize` accepts only the schema-only empty state produced by disabled startup:
one exact empty legacy snapshot, no normalized counter/projections and zero rows in
every other business/control/receipt/audit/outbox table. Deleted audit sequence
history also prevents reclassification as fresh. Uploads must contain only the
existing empty `.cleanup` staging directory; the disabled startup cleanup marker
must be valid, unchanged and have no active runs or transition. The
transaction writes counter0, both empty projections, a singleton immutable bootstrap
receipt and audit. Exact packet replay returns the original sealed result, even
after later supported configuration facts; altered target/runtime/actor/packet or
another bootstrap ID fails. It never treats replay as renewed initialization.

Only `registerResource`, `publishConfig` and `activateConfig` are allowed afterward.
Each is a separate packet; publication does not imply activation. The service
requires the same bootstrap target/runtime/timezone, exact current revisions and
no business/GF15/smoke/provider facts, invokes the existing scheduling admin service
within one outer transaction, and seals its own immutable packet receipt plus
audit in that transaction. Rejections and faults roll back all effects.
Publication/configuration records are reconciled field by field against sealed
commands, including compiler/algorithm/estimate policy, content/digest, owner,
publication operation and execution timestamp. Receipts seal the actual admin
timestamp and, for activation, the preceding active version. Every activation
history row is checked against its own sealed receipt, including previous/current
versions, command digest, projection revision, actor and timestamp; matching row
counts are insufficient. SQL replacement drift is refused without repair or new
facts. Earlier receipt formats without those sealed fields are not silently
ratified; runtime/target bindings must still match and new mutations with uncertain
history fail closed. Repeated IDs with differing actor, bindings or command fail;
exact replay never changes
counters, configuration, budget or ownership. This entry does not prepare requests,
requirements, schedules, GF15, identity budgets, Kiosk or normal operation.

Migration10 adds only two immutable maintenance receipt tables and their guards;
migration1–9 bodies/checksums remain unchanged. Startup creates those empty tables,
but still does not initialize normalized counters or config. Prior schema9 image
fd8a2fb and source37ee97d remain historical artifacts, cannot open schema10 and are
not a compatible fallback for a new schema10 DB. A new candidate must bind exact
implementation source and image. Any receipt/config/audit is a new control fact;
retained-old fallback then needs explicit continuity/reconciliation rather than a
claim of lossless return. New-data backup/recovery, physical/external acceptance,
production creation/cutover/release and frozen GF15/PROD11 gates remain unresolved.

Validation must cover bootstrap/config success, disabled ordinary writes, reopen
and exact replay, nonempty/no-loss rejection, wrong paths/schema/packet, independent
authorization mismatch, concurrency, atomic fault rollback and process interruption
followed by reopen. All data is synthetic; no production connection is needed.

## Review and reproduction

The implementation PR is stacked on PR40's preparation branch at
6e66850f3669b46c544b732aa85e32e7a094047d, so its diff contains only this
implementation and keeps historical planning receipts intact. Architecture authority
was freshly verified as259506955b6fe41bb008de65a305691f9e2810ee. Merge/rebase order
must be reviewed later; neither PR is merged by this preparation task.

`src/empty-db-maintenance-v1.mjs` exports the synthetic target binder, schema digest,
packet digest and explicit executor. Packet exact keys are `schemaVersion` (1),
`operationId`, `kind`, `actor`, `approvalRef`, `target`, `runtime`, `schemaDigest`,
`businessTimeZone` (Asia/Shanghai), `expected` and `command`. Target contains root,
DB/uploads device+inode and cleanup device+inode+marker digest; runtime contains
full sourceRevision and imageId. Expected contains nonnegative scheduleRevision and
projectionRevision; initialization requires both0 and command null. Config commands
retain the existing strict scheduling admin contracts and the same operation ID.
The independent synthetic authorization keys are scope (LOCAL_SYNTHETIC), actor,
approvalRef, packetDigest, disabled writeAdmission/cleanup/kiosk and writersStopped
(true). These values are assertions at a local test port, not remote owner evidence.
An external observer supplies runtime facts from Docker inspection; the local CLI
compares them to the packet, but does not authenticate that observer.

Focused test: `node --test tests/empty-db-maintenance-v1.test.mjs` on Node24.21.
Full validation: `npm run check`. The image-only probes are
`node scripts/verify-local-candidate-startup.mjs` and
`node scripts/verify-local-empty-db-maintenance.mjs <observed-full-source-revision> <observed-image-id>`.
Run them in disposable no-network containers with private tmpfs and no port
publication. The latter allocates entirely new synthetic storage and invokes
`node scripts/local-empty-db-maintenance.mjs --local-synthetic packet.json authorization.json observed-runtime.json`
for each independently admitted packet. Packet files live outside the guarded DB
root. It verifies publication without activation, explicit activation, disabled
reopen, unchanged DB identity/logical digest and four receipt-exact replays, then
removes only its own disposable paths. No raw seed SQL is used for its positive path.

Actual final source/image/build/test/CI receipts belong to the PR description and
local evidence handoff. Do not create a new receipt-only source commit after
freezing that image. Prior Alpine timestamp test failures remain historical and
must be separately reported if reproduced by the new image; a Debian CI pass is
not an Alpine runtime full-suite pass.
