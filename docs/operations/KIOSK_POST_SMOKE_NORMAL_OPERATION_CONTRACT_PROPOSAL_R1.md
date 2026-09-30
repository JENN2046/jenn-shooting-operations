# Post-smoke normal-operation transition contract proposal R1

Status: **DESIGN FROZEN FOR REVIEW / NOT RATIFIED / NOT IMPLEMENTED OR AUTHORIZED**.
Proposed action identifier: `PROD-KIOSK-NORMAL-TRANSITION-R1`; rollback proposal:
`ROLLBACK-KIOSK-NORMAL-DISABLE-R1`. Neither is an admitted Greenfield action.
This document supplies a concrete proposal for the unresolved pre-request contract;
it does not close the authority gate by itself or add normal mode to the candidate.

## State and ordering contract

```text
replacement deployed, Kiosk disabled
→ separately prepared WO03 bindings and setup complete
→ separately authorized GF15 fresh schedule/window and all PROD11 request gates
→ explicit PROD11 authorization
→ isolated WO03 matrix PASS on exact candidate, before production config
→ exact production smoke activation; START(0), COMPLETE(1)
→ terminal smoke: no new production Kiosk events; exact receipt replay only
→ same-image Kiosk-disable containment, preserve all smoke/control/outbox evidence
→ independently reviewed normal-mode implementation/image and explicit transition approval
→ normal-mode deployment + bounded validation + operation-release receipt
→ ordinary scoped production Kiosk use
```

The terminal smoke does not signal normal-mode authority. It requires exactly two
accepted event facts, completed/runRevision=2, receipt-bound secure run/event IDs,
the approved item, zero-based sequences and no pending review. Interrupted/denied
smoke, durable stop, replay-only owner or any discrepancy transitions to disabled
containment and a separately frozen recovery decision; no automatic retry/reset.

## Explicit normal authority and required future implementation

The current candidate recognizes only disabled production, bounded smoke and WO03.
Removing smoke env while retaining production auth fails closed; rotating an item,
setting an unrecognized mode or relabeling production as WO03 is forbidden.

A future reviewed runtime must add an explicit immutable startup normal-authority
mode while preserving `KIOSK_SERVICE_CONTEXT=PROD11_PRODUCTION`. Proposed selector
`KIOSK_PRODUCTION_AUTHORITY_MODE=NORMAL_OPERATION_V1` requires an independently
approved startup packet and canonical digest, separate from auth JSON and database
state. Unknown/missing/cross-mode inputs fail before listen. The packet binds exact
host, normal image/revision, device `KIOSK-PROD-01`, operator subject, resource scope
`[STUDIO-PROD-01]`, Asia/Shanghai timezone, approved allowlist, reviewed token/config
reference, permitted actions and effective lifecycle. No normal default or mutable
per-item authority channel is allowed. These proposed inputs are not supported by
this candidate and must not be deployed as if they were.

Normal authority permits start/block/resume/complete only within that fixed identity
and resource scope on valid confirmed scheduling facts. Current selection is a domain
predicate, never the source of authority: inside each write transaction revalidate
unique admissible current item/active run, exact task/group scope, active timezone,
expected revision, canonical command/secure ID, local sequence, time policy and
receipt-exact replay. Conflict/reviewRequired stops the local queue head; no skip or
automatic rebase. Grouped completion remains block-scoped, with no invented task
labor allocation or automatic fulfillment. No schedule/admin capability is granted.

Keep the exact smoke item and runtime owner as immutable historical evidence.
Normal mode cannot mutate/replay a smoke command into a new fact, transfer/reset
the owner, delete migration records or release either GF15 or smoke notification
isolation. Smoke receipt replay remains fact-free. Test racing selection/timezone,
scope drift, offline order, restart, transaction failures and outbox claim paths
before freezing the normal image. Its migration prefix must remain compatible with
v9 and any appended versions; freeze its own image/DB rollback compatibility.

## Transition effects and acceptance

Before transition approval, fresh-pass completed WO03 and terminal-smoke receipts,
same candidate binding used for them, production schema/control facts, all seven
deployment checks, VCP continuity, no pending test/smoke queue, brief-host compatibility,
normal image tests and rollback readiness. Authority review must separately ratify
this contract before PROD11 requestability; implementation and transition execution
remain separate later work. No current action array or nextAction changes here.

Explicit transition approval must bind source/digest, exact startup/config/profile
packet, allowed lifecycle, any image change and separately bounded validation write
budget. This cannot be performed under PROD11's same-image config-only permission.
The candidate cannot become normal by an environment-only recreation.

Drain/retain local smoke delivery evidence; make the dedicated profile's queued
smoke commands unable to become normal commands. Bind queue/device-identity cleanup
and fresh normal profile initialization in the approved action, preserving server
history. Change only the approved application image/startup authority and Kiosk
profile bindings. Preserve storage/topology/role credentials and existing VCP state;
DingTalk/provider enablement remains separate. Record fresh health, startup-mode,
identity/scope and disabled/unapproved-route denials before any validation write.

Validation uses an independently approved fresh single item/run window and secure
client IDs with an explicit finite event sequence/budget; never reuse the smoke
item or infer this permission from current data. Require persisted command/receipt
and business/outbox revision evidence, then an explicit operation-release receipt
for ongoing scoped use. A failed check denies release, preserves all facts and
invokes only the approved normal-disable rollback.

## Rollback and user handoff

Normal-disable rollback removes only the normal Kiosk startup/profile authority on
the exact compatible normal image, preserving schema, receipts, permanent smoke
isolations, volume and unrelated configuration. It does not resurrect smoke authority
or return to an old v6 image. Any image/DB rollback belongs to its own reviewed
deployment/recovery contract. No accepted shooting fact is deleted or rewritten.

Operators may begin normal use only after the release receipt identifies the exact
normal mode/image/device/scope. Handoff explains logout/revocation, offline pending
vs confirmed facts, conflict/review escalation, and how to request disabled containment.
Until then, the operational outcome is **Kiosk disabled / no ongoing production use**,
even if WO03 and the bounded smoke eventually pass.
