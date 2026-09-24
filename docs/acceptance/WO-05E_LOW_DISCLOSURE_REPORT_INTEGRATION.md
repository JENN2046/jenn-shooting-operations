# WO-05E Low-Disclosure Report Integration Closure

- Authority branch: `codex/v2-1-architecture-freeze`
- Integration base commit: `2965dfadf179e459bba924e4662ad0daa90f4af5`
- Review date: 2026-09-23
- Scope: future run-context capture + checked-in fixture replay + aggregate low-disclosure report admission and main-check integration
- Implementation gate: `LOCAL_REPORT_INTEGRATION_IMPLEMENTED / REVIEW_REQUIRED`
- Real shadow-data gate: `BLOCKED_DATA`
- Fresh runtime re-execution in this reviewer environment: `NOT_RUN_ENVIRONMENT_LIMIT`

## 1. Integration chain

The local WO-05E implementation chain is:

```text
canonical scheduled → shooting
        ↓
immutable run-context snapshot
        ↓
Level A/B/C classifier
        ↓
checked-in synthetic fixture replay
        ↓
shadow-metrics-v1 aggregate report
        ↓
low-disclosure report admission
        ↓
report-only CLI / validate:shadow / npm check
```

WO-05E-A and WO-05E-B are merged into the authority branch. WO-05E-C does not introduce a second evaluator or a second metric formula. It validates and constrains the aggregate report produced by the existing frozen evaluator.

## 2. Low-disclosure boundary

The integration report root is exact and aggregate-only. It permits:

- dataset digest and dataset class;
- approved-low-disclosure approval digest when applicable;
- algorithm/config/metric-definition versions and config digest;
- aggregate eligibility counts;
- stable exclusion-code counts;
- aggregate metrics with status/value/numerator/denominator;
- generated timestamp;
- result digest.

The report boundary does not permit per-case or operational identifiers such as `sampleId`, `requestId`, `scheduleItemId`, `runId`, or per-case classifications. It also has no slots for client/requester identity, Brief, note, URL, attachment, actor/device, raw event, provider, credential, or production database content.

Root and nested records are admitted through exact own-data keys. Metric objects, exclusion objects, eligibility counts and the metric-name map are all closed structures; schema widening fails closed.

## 3. Metric and digest integrity

The low-disclosure admission verifies:

- `gateStatus = BLOCKED_DATA`;
- synthetic vs approved-low-disclosure approval matrix; approved reports additionally require trusted `expectedApprovalDigest` and `expectedDatasetDigest` from a previously verified dataset context;
- Level count relation `levelC <= levelB <= levelA`, with duration/human-override denominators exactly bound to Level C and retrospective baseline denominators exactly bound to Level B;
- `levelA + ineligible = total`;
- stable exclusion-code allowlist, order, uniqueness and dataset-count bounds; Level-A-disqualifying exclusion counts are additionally bounded by `eligibilityCounts.ineligible`, and a positive ineligible cohort must have aggregate disqualifying-exclusion evidence;
- zero denominator only as `NOT_ENOUGH_DATA + value:null + numerator:null + denominator:0`; Level C / Level B cohorts force the metrics that the frozen evaluator always computes to be `OK` with the exact cohort denominator;
- metric-specific statistic/rate/count numerator-denominator relations for `OK` metrics, including integer-millisecond P90 values and median precision limited to integer or `.5ms` where cohort parity permits;
- `resultDigest` recomputation from the fact body;
- `generatedAt` normalization while remaining outside the fact digest.

Changing `generatedAt` alone does not change the result digest. Changing report facts without recomputing the digest is rejected.

## 4. Integrated local commands

```sh
npm run evaluate:shadow:fixtures
npm run evaluate:shadow:report
npm run validate:shadow
npm check
```

`evaluate:shadow:fixtures` is a local diagnostic surface and may include per-case classifications for fixture tests.

`evaluate:shadow:report` is the low-disclosure integration surface and outputs only the aggregate admitted report.

`validate:shadow` replays the checked-in synthetic fixture and validates the aggregate report. `npm check` includes this gate before the full test suite.

## 5. Synthetic fixture boundary

The checked-in synthetic dataset intentionally contains:

- Level A: 2
- Level B: 1
- Level C: 0

It may demonstrate deterministic classifier/evaluator behavior and a Level B retrospective duration baseline. It cannot close the real Agent shadow-acceptance gate.

All Agent shadow metrics with no qualified Level C denominator remain `NOT_ENOUGH_DATA + value:null`.

The approved/real Level C dataset count remains 0.

## 6. Evidence still required before implementation closure

Before WO-05E implementation closure can be reported as `SHADOW_EVALUATOR_PASS_WITH_BLOCKED_DATA`, the latest branch still requires:

- fresh runtime `npm check`;
- independent PR review of the final head;
- post-merge verification against the authority branch.

These gates close implementation quality only. They do not close the real data/threshold gate.

## 7. Explicit non-claims

This closure does not prove or authorize:

- sufficient real Level C sample count;
- real shadow metric threshold attainment;
- any production database read;
- provider/network/credential access;
- historical run-context backfill;
- automated Agent acceptance or schedule writes;
- deployment, release, DNS, certificate, security-group, or public exposure;
- permission expansion from metric results.

The real shadow acceptance gate remains `BLOCKED_DATA` until a separately approved low-disclosure real dataset contains enough qualified Level C evidence and thresholds are frozen by a later authority decision.
