# WO-05E Post-Merge Independent Verification

- Authority branch: `codex/v2-1-architecture-freeze`
- Authority HEAD reviewed: `4485d3e0fa603ff3147a1b276d72121f99746a2d`
- Authority merge lineage:
  - WO-05E-A PR #6 merge: `bd806886a328c380a46d56dcc387bf79d65ea026`
  - WO-05E-B PR #7 merge: `2965dfadf179e459bba924e4662ad0daa90f4af5`
  - WO-05E-C PR #8 merge: `4485d3e0fa603ff3147a1b276d72121f99746a2d`
- Verification scope: WO-05E-A future run-context capture, WO-05E-B checked-in fixture/offline replay, WO-05E-C aggregate low-disclosure report integration
- Independent code/evidence result: `PASS_WITH_VERIFICATION_FIX`
- Fresh repository runtime result: `NOT_RUN_ENVIRONMENT_LIMIT`
- Real shadow-data gate: `BLOCKED_DATA`

## 1. Runtime evidence boundary

The authority commit has:

- no GitHub Actions workflow run associated with the commit;
- no commit status/check contexts;
- no repository CI evidence that can be treated as a fresh `npm check` result.

A fresh isolated checkout was attempted for runtime execution. The verification container has Node.js 22.16.0 and npm 10.9.2, but outbound DNS/network access to GitHub is unavailable, so the exact authority checkout could not be cloned into the execution container.

Therefore this verification does **not** claim a fresh `npm check` PASS.

This limitation does not alter the code/evidence conclusions below, but it remains an explicit implementation evidence gate.

## 2. WO-05E-A: Future Run-Context Capture

Result: `CODE_EVIDENCE_PASS`.

Verified on the authority HEAD:

- migration v6 adds `scheduling_run_context_snapshots`;
- the table has one row per run by primary key;
- update and delete are blocked by immutable triggers;
- both Kiosk and generic run-event paths determine capture from the actual `scheduled -> shooting` transition;
- Kiosk run provisioning and context capture are separate decisions, so pre-provisioned scheduled runs are captured on their actual first start;
- exact event replay is resolved before capture;
- capture is performed inside the caller's existing `BEGIN IMMEDIATE` transaction;
- capture does not introduce an additional schedule, run, or projection revision;
- grouped runs are recorded as ineligible with `GROUPED_UNALLOCATED`;
- missing config/rule facts are captured as ineligible rather than guessed;
- scheduling-valid duration `sourceVersion` values that cannot be represented by the frozen evaluation token grammar degrade to `RULE_FACT_MISSING` instead of blocking the production start;
- historical runs are not backfilled.

Regression evidence exists for:

- first-start capture for newly provisioned Kiosk runs;
- pre-provisioned Kiosk runs;
- pre-provisioned generic runs;
- exact replay preserving one snapshot;
- grouped ineligible capture;
- valid wide/non-ASCII duration source versions remaining non-blocking;
- migration-v6 immutability.

No post-merge code finding remains open for 05E-A.

## 3. WO-05E-B: Checked-in Fixture Dataset + Offline Replay

Result: `CODE_EVIDENCE_PASS`.

Verified on the authority HEAD:

- the checked-in fixture is explicitly `synthetic`;
- it contains two completed task-level cases;
- expected qualification is Level A = 2, Level B = 1, Level C = 0;
- no synthetic fixture is presented as approved low-disclosure data;
- replay validates manifest admission, per-case classifier output and aggregate evaluator output;
- fixture/expected input is recursively snapshotted through own data descriptors;
- accessors, symbols, non-enumerables, hostile proxies, sparse arrays and unsafe object keys fail closed;
- falsy but valid JSON values cannot silently bypass replay;
- nested proxy getter spoofing cannot change the canonical comparison;
- the synthetic evaluator result remains `BLOCKED_DATA`;
- all Agent shadow metrics remain `NOT_ENOUGH_DATA + value:null`;
- only the Level-B retrospective duration baseline has a denominator.

### Independent digest recomputation

The verification did not trust the checked-in expected digests alone.

A separate canonical JSON implementation and an independent SHA-256 implementation were used to recompute:

1. CASE-A event-chain evidence digest;
2. CASE-A metrics evidence digest;
3. CASE-B event-chain evidence digest;
4. CASE-B metrics evidence digest;
5. CASE-B run-context snapshot digest;
6. dataset digest;
7. aggregate report result digest.

Result: `7 / 7 exact matches`.

This independently confirms the checked-in fixture digest chain at authority HEAD `4485d3e0...`.

No post-merge code finding remains open for 05E-B.

## 4. WO-05E-C: Low-Disclosure Report Integration

Initial authority result: `CODE_EVIDENCE_PASS_WITH_ONE_POST_MERGE_FINDING`.

Verified on the authority HEAD:

- aggregate report root/nested structures are exact allowlists;
- report output has no slots for per-case `sampleId`, `requestId`, `scheduleItemId`, `runId`, per-case classification, Brief/note/raw events/provider/credential data;
- `gateStatus` is fixed to `BLOCKED_DATA`;
- synthetic reports cannot carry approval context;
- approved-low-disclosure reports require trusted expected approval digest and trusted expected dataset digest;
- eligibility counts enforce `levelC <= levelB <= levelA` and `levelA + ineligible = total`;
- Level-C duration/P90/human-override metrics bind to the Level-C denominator;
- hard-conflict, when available, must cover the full Level-C cohort;
- Level-B retrospective metrics bind to the Level-B denominator;
- zero-denominator metrics use only `NOT_ENOUGH_DATA + value:null + numerator:null + denominator:0`;
- P90 uses integer milliseconds;
- median precision is limited to integer or half-millisecond values, with odd cohorts requiring integer medians;
- RFC3339 calendar dates are validated before normalization;
- `resultDigest` is recomputed from the aggregate fact body;
- `generatedAt` remains outside that fact digest;
- `validate:shadow` reports an explicit synthetic implementation validation and `gateStatus=BLOCKED_DATA`, not an unqualified shadow-acceptance PASS;
- `npm check` includes `validate:shadow`.

### Post-merge finding: aggregate exclusion/cohort binding

Independent review found one additional consistency gap not closed by PR #8:

- Level-A-disqualifying exclusions had been tied to `eligibilityCounts.ineligible`;
- however Level-B snapshot exclusions were not yet tied to the `levelA - levelB` cohort shortfall;
- Level-C shadow-evidence exclusions were not yet tied to the `levelB - levelC` cohort shortfall;
- `EVENT_AFTER_CUTOFF` was not explicitly constrained as a subset of `EVENT_OUTSIDE_DATASET_WINDOW`.

Without these relations, an aggregate report could have a valid recomputed result digest while describing a combination the frozen classifier/evaluator could not produce.

The verification branch corrects this by requiring:

- Level-B snapshot exclusion total >= `levelA - levelB`;
- Level-B snapshot exclusion total <= `total - levelB`;
- each Level-C exclusion count <= `total - levelC`;
- aggregate Level-C exclusion evidence >= `levelB - levelC`;
- mutually exclusive outcome-exclusion total <= `total - levelC`;
- `EVENT_AFTER_CUTOFF <= EVENT_OUTSIDE_DATASET_WINDOW`.

Focused regressions were added using recomputed result digests so the tests exercise semantic admission rather than stale-digest rejection.

After this verification fix is merged, no known code/evidence finding remains open for WO-05E-C.

### PR #9 closure-review refinements

Codex review of the verification branch found two additional correctness details and one documentation inconsistency:

- snapshot/shadow/outcome exclusion upper bounds must use the processed cohort `total - EVENT_OUTSIDE_DATASET_WINDOW`, because outside-window cases are skipped before classification and cannot contribute those exclusions;
- the positive Level-C regression must decrement the shadow-evidence/outcome exclusions for the promoted case, otherwise the test itself describes an impossible evaluator output;
- the WO-05E-B status header must match its already verified code/evidence state and retain `FRESH_RUNTIME_PENDING`.

The verification branch now applies these refinements and adds isolated processed-cohort regressions for both Level B and Level C/outcome bounds.

## 5. Scope and authority audit

Comparing the pre-WO-05E authority point `f344e7ec830457605b98bc043c279ee48b9bc1f1` to the reviewed HEAD shows WO-05E changes are confined to:

- run-context capture schema/builders and the two run-event application/store paths;
- schema migration v6;
- evaluation fixtures and fixture replay;
- aggregate low-disclosure report admission and verifier scripts;
- related tests;
- package validation scripts;
- WO/ADP/acceptance documentation.

No WO-05E change introduces:

- Agent/LLM automatic proposal acceptance;
- production authentication or credential mapping;
- production database access;
- external provider/network delivery;
- deployment/release/public exposure;
- threshold changes;
- permission expansion from evaluation output.

## 6. Data gate

The checked-in dataset is synthetic and contains:

```text
Level A = 2
Level B = 1
Level C = 0
```

Approved/real Level C dataset count remains `0`.

Therefore the real shadow-acceptance gate remains:

```text
BLOCKED_DATA
```

The retrospective Level-B baseline may be evaluated, but it cannot be relabeled as an Agent shadow metric.

## 7. Independent conclusion

At authority HEAD `4485d3e0...`:

- WO-05E-A: `CODE_EVIDENCE_PASS`
- WO-05E-B: `CODE_EVIDENCE_PASS`
- WO-05E-C: `CODE_EVIDENCE_PASS_WITH_VERIFICATION_FIX`

The verification branch closes the one newly found aggregate exclusion/cohort consistency gap.

The strongest honest implementation state after that fix is merged is:

```text
POST_MERGE_CODE_EVIDENCE_VERIFIED
FRESH_RUNTIME_PENDING
BLOCKED_DATA
```

It is **not yet honest** to publish `SHADOW_EVALUATOR_PASS_WITH_BLOCKED_DATA` as a fully closed implementation state until a fresh exact-head `npm check` is executed successfully.

A future fresh runtime execution may close that remaining implementation-evidence gate without changing the real-data result: real shadow acceptance remains `BLOCKED_DATA` until a separately approved dataset supplies enough qualified Level C evidence and thresholds are frozen by authority.
