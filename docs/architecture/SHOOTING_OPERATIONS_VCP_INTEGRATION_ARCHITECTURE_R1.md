# SHOOTING_OPERATIONS_VCP_INTEGRATION_ARCHITECTURE_R1

Status: **FROZEN ARCHITECTURE / NON-AUTHORIZING**

Repository authority: `JENN2046/jenn-shooting-operations`

This document freezes the ownership and runtime architecture for integrating VCP agents with Jenn Shooting Operations. It does not authorize, install, enable, configure, or execute `PROD-10-ENABLE-VCP-REMOTE-SYNC`.

## 1. Decision

The integration is owned at the VCPToolBox runtime layer, not at the VCPChat UI/client layer.

```text
Jenn
  ↓ natural-language intent
VCP Agent surface
  ↓
VCPToolBox
  ↓
Jenn-specific Shooting Operations adapter
  ↓
Jenn Shooting Operations production API
  ↓
Jenn Shooting Operations database / files
```

The ownership split is:

| Concern | Owner |
| --- | --- |
| Current shooting-operation truth | Jenn Shooting Operations |
| Production API and revision semantics | Jenn Shooting Operations |
| VCP integration runtime | VCPToolBox |
| Jenn-specific adapter source | `JENN2046/VCPToolBox-JENN-Extensions` |
| Agent reasoning and tool selection | VCP agent runtime |
| Optional desktop/chat presentation | VCPChat |
| Long-term preferences and reusable experience | VCP Memory, subject to its own authority |
| Production secret custody | Integration runtime secret storage, never the agent prompt or memory |

This architecture supersedes any inference that the presence of a VCPChat-side compatibility path makes VCPChat the production integration owner.

## 2. Scope

R1 defines:

- source-of-truth ownership;
- runtime ownership;
- adapter ownership;
- agent consumption boundaries;
- read and guarded-write flows;
- capability and authorization boundaries;
- secret handling;
- current-truth versus memory separation;
- conflict, timeout, replay, and uncertain-outcome semantics;
- configuration rollback semantics;
- the minimum evidence required before PROD-10 can be considered requestable.

R1 does not:

- implement the adapter;
- install anything into the live VCPToolBox runtime;
- select a permanent public tool name or schema;
- read or install a production scheduler token;
- perform a real production pull or push;
- change Kiosk or DingTalk;
- grant standing write authority to any agent;
- change existing Jenn Shooting Operations business data;
- merge or authorize any repository change by itself.

## 3. System of Record

Jenn Shooting Operations is the **System of Record** for current shooting-operation facts.

Examples include:

- current revision;
- products;
- tasks;
- sessions;
- scheduling state;
- operational receipts;
- current project progress represented by the production service.

A VCP agent MUST obtain current operational truth from Jenn Shooting Operations when the answer or action depends on live project state.

VCP Memory, conversation history, cached snapshots, prior tool results, or agent recollection MUST NOT be promoted to current operational truth merely because they were previously accurate.

A cached or remembered shooting fact is historical context unless it is freshly reconciled with Jenn Shooting Operations.

## 4. Runtime ownership

### 4.1 VCPToolBox

VCPToolBox is the integration runtime owner.

The production adapter is expected to execute as a VCPToolBox-owned capability through a supported extension/plugin/tool registration mechanism.

VCPToolBox owns:

- adapter lifecycle;
- adapter registration;
- secret reference resolution;
- endpoint binding;
- capability admission;
- bounded tool invocation;
- low-disclosure integration errors;
- disable-only integration rollback.

### 4.2 VCPToolBox-JENN-Extensions

`JENN2046/VCPToolBox-JENN-Extensions` is the source owner for the Jenn-specific Shooting Operations adapter unless a later architecture revision explicitly supersedes it.

This keeps Jenn-specific business integration out of upstream VCPToolBox core while reusing the established Jenn extension/package boundary.

The extension repository may contain:

- adapter implementation;
- adapter manifest/profile;
- tool contract;
- contract tests;
- no-secret fixtures;
- installation/registration metadata;
- rollback metadata.

Publishing source there does not itself activate the adapter in production.

### 4.3 VCPChat

VCPChat is an optional consumer/presentation surface.

VCPChat MAY:

- host or display an agent;
- invoke VCPToolBox capabilities;
- show read results;
- show proposed changes;
- present write outcomes.

VCPChat MUST NOT be treated as:

- the production integration runtime owner;
- the canonical adapter source;
- the production scheduler-secret custodian;
- the source of current Jenn Shooting Operations truth.

A desktop client lifecycle must not determine whether the production integration exists.

## 5. Agent-facing abstraction

Agents consume Jenn Shooting Operations through a VCPToolBox tool/capability abstraction, not by directly constructing production HTTP requests.

The agent-facing capability layer SHOULD expose three semantic classes:

1. **Read current state**
   - no business mutation;
   - retrieves current authoritative state or an intentionally bounded projection.

2. **Plan/propose change**
   - pure planning;
   - produces a candidate mutation;
   - does not write to production.

3. **Apply guarded change**
   - write-capable;
   - requires the applicable authority/capability;
   - performs revision-guarded, idempotent mutation;
   - verifies the result after write.

R1 does not freeze final public tool identifiers. Tool naming and JSON schemas are frozen separately from this ownership architecture.

## 6. Current HTTP compatibility contract

The currently validated Jenn Shooting Operations V1 compatibility surface is:

```text
GET /api/v1/snapshot

PUT /api/v1/snapshot
Authorization: Bearer <scheduler credential>
If-Match: <expected revision>
Idempotency-Key: <operation id>
```

The HTTP surface is an adapter implementation detail, not the agent-facing tool contract.

For the current V1 surface:

- pull is read-only;
- guarded push requires the scheduler principal;
- `If-Match` carries optimistic concurrency;
- `Idempotency-Key` carries operation identity;
- a committed write advances the revision;
- revision conflict is a normal fail-closed outcome.

Future API evolution may replace this transport without changing the ownership model in this architecture.

## 7. Read flow

Canonical read flow:

```text
Agent intent
  ↓
VCPToolBox tool/capability admission
  ↓
Jenn extension adapter
  ↓
Jenn Shooting Operations current-state read
  ↓
Adapter validates response
  ↓
Bounded structured result
  ↓
Agent reasoning
```

Rules:

- a read MUST NOT silently perform a write probe;
- scheduler credentials SHOULD NOT be attached to an endpoint that does not require them;
- invalid or malformed responses fail closed;
- secrets and raw private transport details are not returned to the agent;
- the returned operational revision must remain identifiable when needed for later guarded mutation.

## 8. Guarded write flow

Canonical write flow:

```text
1. pull current authoritative state
2. capture current revision
3. construct proposed mutation
4. verify agent/tool write authority for the exact operation
5. issue one guarded write with expected revision + idempotency identity
6. inspect bounded write result
7. perform verification pull
8. confirm the intended production fact exists at the resulting revision
9. report committed result or fail closed
```

A write-capable adapter MUST NOT:

- perform blind overwrite;
- omit revision protection;
- silently change the operation identity and retry;
- convert a conflict into an automatic overwrite;
- claim success before verification;
- erase already committed production facts as a configuration rollback.

## 9. Conflict and uncertain-outcome semantics

### 9.1 Revision conflict

A revision mismatch is not an adapter failure to be hidden.

Expected handling:

```text
409 REVISION_CONFLICT
  ↓
do not overwrite
  ↓
fresh pull
  ↓
re-evaluate the proposed change against the new truth
```

Whether the re-planned operation may proceed automatically is governed by the applicable agent authority policy. This architecture grants no such standing permission.

### 9.2 Timeout or transport uncertainty

If the adapter cannot determine whether a write committed:

- it MUST NOT automatically retry with a new operation identity;
- it SHOULD reconcile using the same operation identity or current authoritative state where supported;
- it MUST treat the outcome as uncertain until reconciled;
- uncertainty MUST be surfaced without leaking credentials or private transport bodies.

### 9.3 Idempotent replay

A replay using the same valid operation identity may be used only according to the Jenn Shooting Operations idempotency contract.

A replay response is evidence of the same operation, not permission to widen the mutation.

## 10. Capability and human-authority boundary

Tool availability is not write authorization.

The architecture separates:

```text
tool exists
≠
adapter installed
≠
integration enabled
≠
agent may write
≠
human authorized this production action
```

For PROD-10:

- `PROD-10-ENABLE-VCP-REMOTE-SYNC` remains the exact production action;
- production enablement requires its own explicit authority;
- the real guarded push performed for acceptance may create durable production facts;
- those facts are not automatically removed when VCP configuration is later disabled.

After PROD-10, any standing or per-operation agent write policy must be governed by a separate explicit authority/capability contract. R1 does not invent blanket agent write permission.

## 11. Secret boundary

The scheduler credential is a runtime secret.

It MUST NOT appear in:

- Git;
- pull-request bodies;
- committed fixtures;
- chat messages;
- agent prompts;
- VCP Hot Memory;
- VCP Cold Knowledge;
- Jenn Shooting Operations business records;
- ordinary logs;
- low-disclosure acceptance evidence.

The agent receives capability, not the raw credential.

The adapter resolves the credential from approved runtime secret storage only at the integration boundary.

Secret rotation MUST NOT require changing business data or agent memory.

## 12. Memory boundary

Jenn Shooting Operations and VCP Memory have different jobs.

### Jenn Shooting Operations

Holds current operational truth:

```text
what exists now
what is scheduled now
what revision is current
what production facts have committed
```

### VCP Memory

May hold durable context such as:

```text
Jenn's confirmed long-term working preferences
reusable planning heuristics
stable collaboration conventions
validated lessons
historical project continuity
```

Rapidly changing operational state is not automatically a persistence candidate.

A successful integration write MUST NOT automatically cause a VCP Hot Memory write.

## 13. Rollback semantics

The PROD-10 configuration rollback remains:

`ROLLBACK-09-DISABLE-VCP-CONFIG`

Its scope is configuration, not business-history reversal.

Rollback MUST:

- disable only the VCP integration configuration introduced by PROD-10;
- remove or disable the bound VCP endpoint/adapter activation;
- stop further VCP-originated synchronization;
- leave Kiosk unchanged;
- leave DingTalk unchanged;
- preserve Jenn Shooting Operations production storage;
- preserve already committed production facts;
- avoid logging secret values.

Rollback MUST NOT:

- delete a task merely because VCP created it;
- decrement a revision;
- restore a stale snapshot over newer production truth;
- disable unrelated integrations.

If business compensation is ever required, that is a new domain operation under its own authority, not configuration rollback.

## 14. Runtime lifecycle

A deployable adapter is not proven by source code existing in any repository.

Before runtime wiring can be accepted, evidence must bind:

- exact Jenn extension source revision;
- exact built/package identity where applicable;
- exact VCPToolBox runtime/release identity;
- exact registration mechanism;
- exact enabled/disabled configuration surface;
- exact Jenn Shooting Operations endpoint;
- exact principal scope;
- secret-storage reference without secret value;
- exact rollback target;
- no unintended Kiosk or DingTalk change.

Installing the adapter by directly editing an arbitrary live release directory is not the default architecture. The supported VCPToolBox extension/package lifecycle is preferred. Any exception requires its own reviewed lifecycle and rollback evidence.

## 15. Legacy VCPChat compatibility assumption

The existing Jenn Shooting Operations compatibility test historically resolves:

`runtime/VCPChat/modules/services/shootingPlannerSyncService.js`

That path is a historical compatibility assumption.

Under R1:

- it does not establish VCPChat as production runtime owner;
- it does not establish VCPChat as adapter source owner;
- a passing test at that path is not `VCP_RUNTIME_WIRING_PROOF`;
- a skipped test at that path does not prove that VCPToolBox lacks every possible adapter;
- the test should be refactored or supplemented so acceptance can bind an identified VCPToolBox/JENN-Extensions adapter revision without depending on a desktop-client ownership assumption.

Historical WO-06C evidence remains historical and is not rewritten by this architecture.

## 16. PROD-10 readiness mapping

Before `PROD-10-ENABLE-VCP-REMOTE-SYNC` becomes requestable, the following architecture evidence must exist.

### Repository / package evidence

- Jenn-specific adapter exists in the approved extension source;
- exact adapter revision is recorded;
- adapter contract tests pass;
- pull, guarded push, verification pull semantics are covered;
- conflict and no-blind-retry semantics are covered;
- secret non-disclosure is covered;
- rollback configuration surface is defined.

### Live runtime readiness evidence

Before the real write portion of PROD-10:

- exact live VCPToolBox runtime identity is known;
- adapter is installed/registered through the approved runtime mechanism;
- exact production endpoint is bound;
- scheduler principal scope is bound without exposing the credential;
- disable-only rollback is ready;
- no Kiosk or DingTalk enablement is implied;
- current Jenn Shooting Operations target identity and health are freshly revalidated.

### Authorized PROD-10 acceptance evidence

Only after exact PROD-10 authorization:

```text
real pull
  ↓
one bounded guarded push
  ↓
verification pull
```

Acceptance must record low-disclosure evidence for:

- VCP runtime wiring;
- adapter revision;
- service endpoint;
- principal scope;
- pull/push/verify result;
- resulting revision/fact identity sufficient to verify the write;
- deployment-chain completion;
- secret values not recorded.

## 17. Non-coupling invariants

The following are frozen R1 invariants:

1. Jenn Shooting Operations remains authoritative for current shooting-operation state.
2. VCPToolBox owns the production integration runtime.
3. Jenn-specific integration source lives outside VCPToolBox core by default.
4. VCPChat is not the production integration owner.
5. Agents receive capabilities, not production credentials.
6. Reads and writes are distinct capabilities.
7. Writes are revision-guarded and idempotency-bound.
8. Uncertain writes are reconciled, not blindly retried.
9. Configuration rollback does not erase committed business facts.
10. VCP integration enablement does not enable Kiosk or DingTalk.
11. Current operational truth is not automatically copied into VCP Memory.
12. Architecture or source presence alone never authorizes PROD-10.

## 18. Change control

A change that moves any of these ownership boundaries requires a new architecture revision:

- System of Record;
- integration runtime owner;
- Jenn-specific adapter owner;
- secret custodian;
- write-authority owner;
- rollback owner.

Implementation details such as internal module layout, transport helper functions, or public tool names may evolve without R2 only if all R1 ownership, authority, failure, and rollback invariants remain true.

Any later architecture revision must explicitly state which R1 decisions it supersedes.
