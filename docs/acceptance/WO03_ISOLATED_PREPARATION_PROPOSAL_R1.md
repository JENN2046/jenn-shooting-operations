# WO03 isolated preparation proposal R1

Status: **LOCAL SYNTHETIC PREPARATION ONLY / EXTERNAL SETUP NOT AUTHORIZED /
REAL_DEVICE_ACCEPTANCE AND OFFLINE_REPLAY_RESULT NOT RUN**.
Read alongside the frozen WO03 matrix and PROD11 deployment contract; it does not
reduce their requirements. Exact local facts are in the release evidence JSON.

## Local deliverables and bindings

`fixtures/wo03-preparation-r1/{single,grouped}.v1.json` contain only synthetic
requests. `prepare-wo03-local-fixtures.mjs` accepts only these WO03 namespaces,
creates a new directory, builds an empty synthetic V1 DB, and uses the existing
canonical migration-plan/materialization path. It never copies a production DB,
edits an existing output, creates a listener or credential, or enrolls a device.
Single and grouped cases are separate disposable databases, so the grouped item
cannot compete with the single item as current.

| Binding | Local fixture / proposed isolated scope |
| --- | --- |
| Runtime | exact candidate image/revision in `jso-candidate-release-evidence.r1.json` |
| Trusted service context | `WO03_ISOLATED_ACCEPTANCE` (mandatory at later server setup) |
| Logical device/subject | `KIOSK-WO03-LOCAL-01`, operator |
| Resource scope | exactly `[STUDIO-WO03-LOCAL-01]` |
| Single | `ITEM-WO03-SINGLE-01` → `REQ-WO03-SINGLE-01` |
| Grouped | `ITEM-WO03-GROUPED-01`, `grouped_unallocated`, two bound requests |
| Time zone | `Asia/Shanghai` |
| Synthetic fixture window | 2026-10-15 09:00–11:00 Shanghai; not a live acceptance window |
| Endpoint proposal | Linux loopback `http://127.0.0.1:<reserved-port>/kiosk?resourceId=STUDIO-WO03-LOCAL-01`; port unresolved, no persistent listener |
| Device-reachable endpoint | unresolved; needs separately approved test-only HTTPS route/network topology |
| Credential | absent; later test-only provisioning authority required; no production role/Kiosk credential |

The candidate executes the read-only preparation harness and its own schema/current
reader against these disposable DBs. Canonical row digests cover all request/item/task
binding fields; file hashes and observed device/inode identities identify the local
files at preparation time. The current-read check uses an explicitly synthetic clock,
not a physical browser or actual wall-clock acceptance. Local file identities are not
external WO03 database identities. Normalized/imported grouped facts are genuine test
rows, not a fabricated per-task allocation.

Raw template digests are reproducible. Materialized row/file digests may change on
a newly bound execution window or future setup; regenerate and freeze the entire
packet before requesting PROD11, never silently edit the prepared DB. The local
template is insufficient to close external setup or real-device gates.

## Separately bounded external setup proposal

Proposed identifier `WO03-ISOLATED-SETUP-R1` is not an authorized action. Before its
approval, bind an exact host/endpoint/TLS identity, loopback/device reachability,
reserved port, container name/ID, candidate digest/revision, isolated volume/database
path/device/inode, test-only auth scope and secret location, exact fresh single and
grouped windows, input/normalized/file digests, reset baselines and every device target.
Setup must complete before PROD11 can be requested. The WO03 matrix itself remains
post-PROD11-authorization, before production Kiosk activation.

Proposed effects are limited to a new disposable test namespace, separate DB/upload
root and test-only identity. A later approved server must run the candidate by digest,
set `KIOSK_SERVICE_CONTEXT=WO03_ISOLATED_ACCEPTANCE`, reject production identities and
all production smoke variables, and have no production mounts, credentials, routes,
providers or external adapter delivery. Default-deny provider egress and omit worker
delivery wiring; record outbox facts without dispatch. Do not treat test provider
success as real-provider integration evidence.

Use one immutable clean baseline per scenario (single vs grouped, offline, conflict,
review, cache, expiry, handoff). Reconstruct only its disposable test DB/profile after
recording outcome and queue/run/revision evidence. Never reset production facts or
acceptance smoke ownership. The current basic-v1 identity has no inherent expiry
timer: expiry tests must bind a reviewed test-only config revocation/rotation and
same-image lifecycle, plus fresh browser challenge/session clearing. Do not pretend
the candidate implements identity expiration that it does not implement.

## Device and execution matrix — all targets pending confirmation

User explicitly deferred exact hardware/system/browser versions. No device setup
or physical tests occurred. Before real acceptance, record exact inventory:

| Target | Required inputs and evidence |
| --- | --- |
| Desktop 1440×900 | test device/OS/Chromium build/profile; keyboard, focus, dialog return, wrapping |
| On-site tablet landscape 1024×768 / portrait 768×1024 | model/asset label, OS, browser build, profile; rotation, soft keyboard, locks, weak network |
| Safari | exact Apple device, OS/Safari/WebKit version; Web Locks and forced lease fallback evidence |
| Mobile 390×844 | exact device/OS/browser/profile; safe-area, 200% zoom, controls and announcements |
| Accessibility | exact screen reader/version/settings, external keyboard model/layout, touch and studio-lighting context |

QLL-6 / Windows 11 / Chrome 153.0.8010.53 is a historical production-target binding,
not proof of an isolated test profile or current software version. A separate WO03
test profile on that device needs later setup approval. Its production profile remains
uncreated by this task.

Run every original viewport and on-site checklist item, including absent identity,
auto-lock/reconnect, two tabs/rapid taps/concurrent start, offline strict
start→block→resume→complete, blocked-complete denial, 409/202 queue-head stop,
cache clearing, grouped all-task rendering, logout/revocation/handoff and assistive
checks. Each row records image/revision, exact endpoint/DB/fixture/profile, device
inventory, timestamp, steps, expected/actual outcome and event/receipt/queue evidence.
Freshly revalidate bindings before execution; drift invalidates affected evidence.

WO03 PASS requires every row plus offline replay and identity/accessibility gates.
Static Node tests, synthetic-clock reads and production smoke never substitute.
Until setup, target binding and later authorized matrix execution close, external
WO03 preparation and acceptance remain blocked, and production Kiosk stays disabled.
