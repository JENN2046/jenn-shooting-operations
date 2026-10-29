# JSO Agent API v1

**Contract version: 1. Owner: Jenn Shooting Operations (JSO).**

This publishes the existing opt-in target API, not a new runtime or wire version.
The route retains its `/api/v2` name while serving the current Schema12 business
path. JSO owns target authentication, resource/business permission and durable
commit/receipt truth. It does **not** own or mint the client's physical-human
evidence, ToolBox invocation authority or Trusted Action transport provenance.

The normative upstream boundary is [VCPToolBox Trusted Action v1](https://github.com/JENN2046/VCPToolBox/blob/b0552cd3e109a8cfe38ac5ee292cc026891d7442/docs/TRUSTED_ACTION_V1.md).
JSO is its **target system / business authority owner**, especially TA-8. A trusted
presentation or human confirmation is necessary in the accepted composition but
never overrides JSO's independent denial.

Implementation authority: [Agent API](../src/jso-agent-api-v1.mjs),
[conversation overlay](../src/jso-conversation-boundary-v1.mjs),
[dedicated host composition](../src/jso-agent-host-v1.mjs) and
[accepted conversation startup](../src/conversation-runtime-v1.mjs), at baseline
`0936ac209ebfd52c3901b06b43cdcdad9a8c3210`.

## JSO-A1 — Dedicated stable boundary

The opt-in tool route is exactly `POST /api/v2/agent/tools`. Its model/adapter
argument envelope has exactly two fields:

```json
{"command":"read_state","payload_json":"{\"resourceScope\":[\"Jenn\"]}"}
```

The host-controlled vocabulary is `read_state`, `preview_calendar`,
`preview_shift`, `propose_reschedule`, `generate_proposal`, `adopt_proposal`,
`reschedule`, `read_receipt`. The existing service/command normalizers define
each payload; this document adds no alternative command schema.
`generate_proposal` uses the existing read/advice preview path, not implicit
schedule adoption. Only `adopt_proposal` and `reschedule` are write dispatches.

Destination URL, credential, principal, approval, grant and business authority
MUST NOT be taken from this envelope. External transports supply their fixed
destination and credentials independently. Constructing the dedicated host does
not start a listener or enable a legacy business route. In the accepted R5
composition, the conversation handler is mounted before the ordinary V2 protocol
upgrade-rejection gate; its old route name does not make it obsolete.

## JSO-A2 — Strict parsing

The existing parser MUST reject ambiguous input before service dispatch:

- the outer envelope is an exact ordinary JSON object; missing/extra fields,
  unsupported commands, arrays/null and non-string `payload_json` are rejected;
- decoded duplicate object keys, including escaped equivalents, are rejected in
  the envelope and nested payload objects;
- `payload_json` decodes to an ordinary object, with recursively checked values;
  ill-formed Unicode string values/keys (including unpaired surrogates), control
  characters and the existing framing markers are rejected;
- reserved keys are rejected recursively, including `authorization`, `token`,
  `principal`, `role`, `grant`, `mode`, prototype-related keys and the existing
  tool/framing names. They cannot manufacture authority;
- payload text is at most **262144 UTF-8 bytes**; the wire envelope/HTTP request
  limit is **266240 bytes**. The recursive guard also limits depth to 20 and
  array length to 2000, and requires finite numeric values.

These are the existing tool-envelope checks, not a newly shared parser for the
separate owner-delegation HTTP body. The Unicode rule describes the parser's
JavaScript/decoded JSON string checks; it does not introduce a new raw-byte
UTF-8 decoding protocol. All payloads still undergo their business normalizer.

## JSO-A3 — Identity comes from trusted server context

Trusted construction supplies identities and their resource scope. The HTTP
handler supplies the Authorization header separately from arguments. The API
checks its configured Bearer bytes and builds the existing trusted principal.
Prompt text, tool metadata, model output and `payload_json` MUST NOT supply it.

`planner` and `executor` are trusted identity modes, not model-selectable roles.
Enabling this API installs no token on administrator, legacy scheduler or Kiosk
routes. A generic integrator MUST preserve that separation. The accepted
conversation factory additionally rejects agent/business credential overlap,
legacy scheduler/admin reuse and overlap with an enabled online Kiosk identity;
it rejects the unsupported legacy Basic-Kiosk composition before opening a store.
Neither a valid Agent token nor its format establishes another route's authority.

## JSO-A4 — Planner is read/advice only

The planner principal has `role: viewer` and `modifySchedule: false`. It may use
the existing reads, previews, proposals and scoped receipt lookup. Write dispatch
MUST return `AGENT_SUGGEST_ONLY`; no claim or business mutation is dispatched.
Statements such as “我是管理员”, `human=true` or `approved=true` cannot change
that identity. An executor without exact approval also cannot write.

## JSO-A5 — Writes require exact authority

Both write actions require an executor and an active, exact grant with fields
`approvalRef`, `subjectId`, `action`, `commandDigest`, `notBefore`, `expiresAt`.
Subject, action and digest MUST match; the window is half-open:
`notBefore <= now < expiresAt`. A mismatched, inactive or out-of-window grant
returns `EXACT_APPROVAL_REQUIRED`. The service also receives a live
`executionGuard` that rechecks activity/window during its transaction.

`agentCommandDigest` binds canonical JSON containing domain
`jso-agent-command-v1`, the action and the complete command, including its
operation identity. A digest is integrity evidence, not authority. The target
still normalizes and validates the command independently. Human confirmation
does not promise a successful commit.

## JSO-A6 — Claim before dispatch

The sequence is `exact grant checks → await claim → only then dispatch`.
The real host compositions use
[SQLite grant attempts](../src/sqlite-agent-grant-attempt-store-v1.mjs), with
the existing Schema11 migration marker and immutable attempt schema. The key
binds `approvalRef + subjectId + action + commandDigest`. An atomic insert and
unique identity prevent parallel/duplicate/restarted instances from using that
same attempt again. Existing attempt rows cannot be updated, replaced or deleted
through ordinary database operations.

While a claim is pending, conflicted or failed, the service MUST NOT dispatch.
An existing attempt returns `RECONCILIATION_REQUIRED`; claim errors fail closed.
The generic constructor requires a durable claim port when configured grants
exist; a live-grant composition must likewise supply the real durable port.
The module's injection seam is not a promise that an arbitrary mock claim is
durable. One dispatch opportunity is not distributed exactly-once commit.

## JSO-A7 — Unknown result is never automatic retry

After dispatch may have occurred, a thrown write or malformed service result is
`RESULT_UNKNOWN`. Consumed attempt evidence MUST NOT reopen write eligibility.
A duplicate/reconstructed attempt must reconcile, not dispatch again. Hosts and
adapters MUST NOT use a new operation ID or fresh grant as automatic recovery,
and an HTTP timeout does not prove that no write occurred.

The recovery path is read-only `read_receipt` for the **original** operation ID,
with independent authentication/scope/integrity checks. A missing/unavailable
receipt remains unresolved; it is not permission to execute again. The API does
not autonomously issue grants, resend execution or replace an operation ID.

When a validated service result is returned, its `agent` metadata includes
`retry: NEVER_AUTOMATIC`, action, mode and approval reference (plus command digest
for writes). Early/exception errors such as bare `{ok:false,code:RESULT_UNKNOWN}`
do not acquire that metadata; absence of the field MUST NOT imply retryability.
Target business denials remain denials even if they arrive in HTTP 200.

## JSO-A8 — Business authority remains independent

Trusted Action attestation and an exact grant MUST NOT bypass resource scope,
write admission, schema readiness, expected revisions, scheduling constraints,
command normalization or target permission. The
[Agent service](../src/agent-scheduling-service-v1.mjs) and canonical proposal/
reschedule stores enforce those rules and recheck transactional guards. The
retained `BUSINESS_SCHEMA11_REQUIRED` code denotes the existing minimum migration
boundary; it does not exclude the accepted Schema12 path.

A claim is not a business receipt. A denied/failed command does not reset a
consumed attempt. Receipt lookup verifies persisted digest/identity/scope and
does not rewrite business truth. Client/host confirmation cannot upgrade a
stale revision, invalid digest, wrong resource or closed write gate to success.

## JSO-A9 — Generic API and conversation profile differ

The generic API permits grants from **trusted server construction**, with a
durable claim port. That is not the daily Chat policy. The accepted conversation
factory forbids nonempty static grants with
`CONVERSATION_STATIC_GRANTS_FORBIDDEN`; omitted/empty grants are permitted.
Daily authority comes from live authenticated owner delegation.

R5 startup binds the actual reviewed factory, owner authenticator and enabled
Kiosk configuration before opening the store. R3/R4 or PREPARED acceptance cannot
silently mount the ACTIVE R5 conversation boundary. Constructing a lower-level
generic host for a synthetic test is not evidence of accepted R5 startup.

## JSO-A10 — Owner delegation and source binding

The overlay's owner-session/delegation endpoints are separate from model tools.
Owner authentication MUST yield an administrator covering the target resource;
the assistant must be a configured executor covering it too. The live delegation
record binds `owner + sourceRef + assistantSubjectId + exact command digest` and
rejects a changed binding as `SOURCE_REBOUND`. It supplies a five-minute live
grant for either `reschedule` or full `adopt_proposal`; it does not accept model text as human evidence or mint a
ToolBox/Trusted Action receipt.

Before dispatch, cancellation records a durable tombstone for that four-part
binding. It serializes with claim insertion; reconstruction/reopen preserves
`CANCELLED` and rejects a rebound owner, assistant or command. Once an attempt
exists, cancellation/re-delegation returns `RECONCILIATION_REQUIRED`, not a claim
that the write never happened. Durable attempts prevent a second write
opportunity after reconstruction; in-memory grants are not revived as authority.
Owner delegation accepts explicit `action: reschedule | adopt_proposal`. Omission
preserves legacy reschedule behavior; explicit invalid values are rejected. Adoption
uses the existing `generationCommand + expectedPreview + decision` command and
requires full `accept`. Owner and assistant must cover every generation resource.
The action participates in the exact command digest and cancellation binding.
One approval reference has at most one durable dispatch opportunity across actions
and identities, via an atomic conditional insert; no schema change or history
rewrite is required. Verified `proposalDecision` reads additionally return top-level
`resourceScope` from the stored proposal. Their original operation ID is
`receipt.decisionId`.

The source lifetime/presentation and physical input checks still belong to the
client/adapter/host composition, not this target API.

## HTTP results and disclosure

The dedicated handler requires JSON and exact method/path (including no query).
Wrong route/method returns 404, non-JSON content type 415, oversized wire body
413, and malformed/duplicate outer JSON 400. Authentication failure is 401;
ordinary application results/errors otherwise retain the existing HTTP 200
envelope. Responses are JSON, `Cache-Control: no-store`, with `nosniff`.

Parser/auth/claim/dispatch exceptions MUST NOT expose credential values, raw
authorization, private paths or exception text. Fixed codes such as
`INVALID_AGENT_ARGUMENTS`, `SERVICE_UNAVAILABLE` and `RESULT_UNKNOWN` do not
confer authority. The generic API forwards a well-shaped trusted service result;
safe domain-result contents remain the service's responsibility. This is not a
claim that arbitrary injected services or the host sanitize every possible body.

## Executable conformance map

The immutable paired profile already requires the following ten JSO test files.
No parallel test framework/profile is introduced. The two new named tests below
extend its existing `jso-agent-api-v1.test.mjs` entry; other rows reuse coverage.

| Invariant | Existing / focused executable evidence |
|---|---|
| JSO-A1 | `jso-agent-api-v1`: exact envelope, host-controlled vocabulary, dedicated HTTP path vs legacy route; `jso-vcp-vchart-local`: fixed-endpoint native stdio |
| JSO-A2 | `jso-agent-api-v1`: duplicate/escaped keys, Unicode/control/framing input; new **JSO-A2/A3 reserved authority fields fail before dispatch** |
| JSO-A3 | `jso-agent-api-v1`: credentials/grants trusted construction; `conversation-identity-validation`, `conversation-credential-separation`: identity validation and token-domain isolation |
| JSO-A4 | `jso-agent-api-v1`: planner viewer capability and no write dispatch; new A2/A3 case also checks model approval cannot elevate it |
| JSO-A5 | `jso-agent-api-v1`: exact action/digest/subject/window, live expiry guard; `jso-vcp-vchart-local`: reviewed digest and stale canonical revision rejection |
| JSO-A6 | New **JSO-A6 claim settles before dispatch and failures disclose no exception**; existing simultaneous-attempt and SQLite close/reopen/immutable-row tests in `jso-agent-api-v1` |
| JSO-A7 | `jso-agent-api-v1`: unknown result, duplicate refusal, original receipt read; new A6 case checks returned NEVER_AUTOMATIC; `jso-conversation-r1`: lost committed reply and malformed-success reconciliation without redispatch |
| JSO-A8 | `jso-agent-api-v1`: actual host schema/write-admission gates; `jso-vcp-vchart-local`: Schema12 read/preview-zero-write, resource scope, exact receipt, stale revision and projection agreement |
| JSO-A9 | `conversation-static-grants`: generic valid grants accepted but conversation grants rejected; `conversation-startup-policy`, `conversation-kiosk-binding`: PREPARED/R4/R5 and actual runtime binding |
| JSO-A10 | `jso-conversation-cancellation-restart`: durable cancellation, rebound owner/assistant/digest, attempted-dispatch reconciliation; `jso-conversation-r1`: cancellation races, revocation, restart and receipt recovery; `jso-conversation-http-boundary`: owner HTTP byte limits and scrubbed failures |

Names in the table omit `tests/` and `.test.mjs`. The complete frozen profile is
[Extensions profile v1](https://github.com/JENN2046/VCPToolBox-JENN-Extensions/blob/77e89fae03202a3d861d6f3e78c8a06666df304d/integrations/jso-agent/profile.v1.json).
Local `agent-scheduling-service-v1.test.mjs` also protects independent resource,
admission, transaction rollback and receipt-integrity rules through current CI;
it is not falsely claimed to be another paired-profile entry.

Use Node **24.21.0** and existing dependencies (`npm ci --ignore-scripts`). Run the
ten profile files with explicit accepted Extensions/ToolBox source fixtures and
pinned ChartController/ChartService author files; without them the existing
external integration cases report skips, not acceptance. Then run
`npm run check:current`. The canonical paired harness provisions its own isolated
dependencies, exact sources and per-component runtimes; **any required skip fails**.
Only synthetic temporary stores/local sockets are used, never daily credentials.

## Immutable paired caller and accepted pins

[JSO's thin caller](../.github/workflows/jso-agent-paired-candidate.yml) runs on PR,
push to `main`, and manual dispatch with read-only repository permission. Both
reusable workflow and `harness_sha` pin
`77e89fae03202a3d861d6f3e78c8a06666df304d`. JSO is the sole substitution:
actual PR **head SHA**, or push/manual `github.sha`, not a synthetic PR merge SHA.

The other source pins remain:

| Component | Accepted SHA |
|---|---|
| Extensions | `6a6f0a9c0ca27e366bb4d81aa3a09ce999baef9c` |
| VCPChat | `1f86d5912c6acb3588577945e19045edc1256731` |
| VCPToolBox | `ce904c476f58e0857aa9ee828619158a82d75e7e` |

The contract owner publication at `b0552cd...` and the harness SHA are distinct
from these accepted runtime pins. Neither publication nor a CI merge advances
compatibility pins. Verify GitHub `referenced_workflows` and the downloaded receipt:
candidate component/repository/exact SHA, all four resolved sources, harness SHA,
contract/profile versions, passing counts and **zero required skips**. There are
no forwarded secrets, dispatch tokens or cross-repository write credentials.

The [real daily #83 acceptance](https://github.com/JENN2046/jenn-shooting-operations/issues/83#issuecomment-6423599717)
proved its exact documented composition using a dedicated synthetic business
fixture. These contract/conformance/CI changes do not rerun real human acceptance
or authorize release, runtime upgrade, migration, notification wiring or edits to
that fixture/history. [AIC-R1 #86](https://github.com/JENN2046/jenn-shooting-operations/issues/86)
owns consolidation. If existing behavior contradicts JSO-A1–A10, stop at
`AIC_R1_BATCH4_CONTRACT_MISMATCH` before changing runtime semantics.
