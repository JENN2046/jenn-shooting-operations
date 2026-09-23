# WO-05D Post-Merge Independent Verification

- Target branch: `codex/v2-1-architecture-freeze`
- Target commit: `ba16abe6262f7fd8646da9438431026568c27fd7`
- Review date: 2026-09-23
- Review scope: canonical Proposal acceptance transaction, staleness/idempotency, revision/projection coupling, trusted-principal enforcement, Outbox atomicity, rollback behavior
- Gate result: `PASS_TO_HTTP_WIRING`
- Fresh runtime re-execution in this reviewer environment: `NOT_RUN_ENVIRONMENT_LIMIT`

## 1. Runtime evidence boundary

The merged PR records a Windows local validation result of `470 passed / 0 failed / 3 skipped`.
This independent verification did not re-run that suite because the reviewer execution container cannot resolve or clone GitHub.
The recorded PR result is therefore treated as existing implementation evidence, not as a fresh independent runtime result.

No production database, credential, external network, DingTalk delivery, deployment, Switch, or release action was performed.

## 2. Independent code verification

### Transaction and revision boundary

PASS.

- Acceptance enters one caller-owned `BEGIN IMMEDIATE` transaction.
- The canonical schedule kernel does not open a second connection or nested transaction.
- A successful full or partial decision increments `scheduleRevision` and `projectionRevision` exactly once.
- V1/V2 projection refresh executes before commit inside the same transaction.
- Decision receipt, operation receipt, audit row, proposal terminal CAS, and competing-draft stale receipts remain in the same transaction.

### Hard revalidation and stale path

PASS.

- Current schedule revision, active config version/digest, compatible algorithm, complete scheduling input digest, and deterministic result digest are rechecked at adoption time.
- Revision/config/input drift creates only a deterministic stale terminal receipt and caller-operation receipt.
- Drift does not create schedule facts, projection revision changes, or schedule-confirmed Outbox intents.
- Transient/invalid input assembly failures return without sealing a still-valid draft.

### Idempotency and one-shot decision

PASS.

- The shared `operations` namespace is checked before schedule mutation.
- Exact acceptance replay returns the stored receipt without repeating schedule/projection/Outbox effects.
- Caller decision IDs used by stale acceptance are mapped through the shared operation receipt, preserving exact retry.
- Conflicting ID reuse returns `IDEMPOTENCY_KEY_REUSE`.
- Proposal lifecycle uses one-shot draft CAS and remains sealed after terminal decision.

### Resource and authorization boundary

PASS.

- Acceptance requires a structurally valid trusted principal.
- The local application port must explicitly authorize acceptance.
- Every selected resource is independently checked through `modifySchedule` capability and principal resource scope.
- Proposal items must reference active canonical resources and open requests.
- The handler does not trust actor/role/subject identity supplied by a command body.

### Canonical schedule and Outbox atomicity

PASS.

- Proposal acceptance does not use V1 whole-snapshot PUT and does not write schedule SQL from an HTTP/Proposal handler.
- The canonical schedule kernel creates one confirmed Schedule Item per selected Proposal item with one request binding.
- `buffer_source` records the actual Proposal config version.
- Resource overlap/unknown occupancy, request binding collision, revision collision, projection failure, and Outbox construction/enqueue failure abort the transaction.
- One `schedule.confirmed.v1` intent is created per accepted Schedule Item and shares the resulting schedule revision.
- The notification dispatcher is not started by acceptance.

## 3. Earlier review findings

The earlier PR review raised P2 findings around stale acceptance retry idempotency, global operation-key collision, transient input assembly handling, and buffer provenance.

The merged `ba16abe` state contains explicit fixes and regression coverage for those findings. They are not reproduced as open findings in this verification.

## 4. Remaining boundary after this gate

The local canonical acceptance path is suitable for HTTP adapter wiring, but this gate does **not** authorize or prove:

- production authentication or credential delivery;
- automatic Agent/LLM/background-worker acceptance;
- real production database access;
- real DingTalk delivery;
- deployment, release, public exposure, DNS, certificate, or security-group changes;
- WO-05E real shadow metric closure.

The next allowed implementation step is a local, injected, fail-closed trusted scheduler/administrator HTTP principal adapter for `POST /api/v2/proposals/:id/decisions`.
