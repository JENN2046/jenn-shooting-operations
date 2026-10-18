# Optional administrator browser session and personal field view

Local candidate; disabled by default. No dependency, schema, credential, Agent
Bearer or shared Kiosk identity change. Management `/manage` exchanges an existing
administrator credential for an opaque `__Host-jso-session` Cookie; the input is
cleared and the credential is not persisted by the browser. The same principal
opens management and personal field views. Shared terminals still use `/kiosk`
and their existing restricted operator/device credential.

## Configuration and lifetime

Explicitly set `JSO_BROWSER_SESSION_RUNTIME=enabled` and `JSO_BROWSER_ORIGIN` to
one exact HTTPS origin (no path or trailing slash). TLS termination must preserve
Cookie/Origin headers. `JSO_BROWSER_SESSION_TTL_MS` defaults to 28800000 (8 h,
maximum 24 h); `JSO_BROWSER_SESSION_IDLE_MS` defaults to 1800000 (30 min).
Session/Origin/CSRF-validated write activity resets idle time; reads do not. Production enablement
requires a newly accepted source/runtime binding through the existing release
process; copying files or adding environment settings to an old acceptance does
not authorize startup. Disabled/unset preserves prior runtime digest semantics.

Cookies are host-only, Secure, HttpOnly, SameSite=Strict, Path=/. Writes require
the configured Origin and a session CSRF token. Login additionally requires JSON.
Mixed Authorization and Cookie authentication is refused for browser management;
Agent and Kiosk routes retain their own authentication. Session IDs/CSRF values
are random and never logged by this implementation. Sessions are kept only in
server memory: process restart requires authentication again. Absolute/idle
expiry, changed credential/configuration, logout and revocation fail closed.

`POST /api/v3/session/logout` revokes this session; `POST /api/v3/session/revoke`
revokes all sessions of this administrator (both require Origin/CSRF). Removing or
changing the existing administrator credential invalidates existing sessions on
subsequent requests. This is not an external identity provider or a durable
multi-instance session service. A request already committed before logout cannot
be undone; recovery reads its original receipt.

## Personal offline data and recovery

Only a previously authenticated, loaded personal view records offline actions.
Initial login, cold offline app loading and offline reload are not supplied by a
service worker. After network return, reload/reopen recovers the session and queue;
after expiry/restart, authenticate as the original administrator first.

The existing durable queue, replay, storage and control-lock engines are reused.
Personal records use protocol 4 and `jso.field.owner.v1:` storage; operator protocol
3 and historical protocol 2 remain separate. A nonsecret browser device ID survives
reload. It is a logical queue binding, not physical-device attestation or authority.
The server binds it with actual subject/resource at login; each field request
requires an exact binding. Changing identity/device/resource never transfers an
old queue. Nonsecret login/logout notices lock other open windows.

Original event/run IDs, occurrence time and expected schedule/run revisions are
retained. Replay reads the original receipt before sending the original command.
Unknown replies remain pending; conflict/time rejection remains for review and is
never silently rebased. Facts are created only by the shared existing transaction,
authorization, write-admission, time and resource/CAS checks. The actor remains
`Jenn` (administrator); receipt source is `owner-device-declared-v1`, operation kind
`business.owner-device.run.v1`, prefix `owner-device:`. The original management
run endpoint continues to record server time and rejects device-time fields.

Logout retains queues. Offline logout locks locally and sets a nonsecret pending
logout marker; reconnect/reload revokes the old session before restoring a view.
It cannot revoke a remote session until connectivity returns. Do not clear browser
site data before resolving pending records. Older application versions cannot
replay personal protocol 4; reverting code must preserve both the latest server
data and browser queues, then restore support to reconcile original receipts.
No data restore or queue conversion belongs to a code rollback.
