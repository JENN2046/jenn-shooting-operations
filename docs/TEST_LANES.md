# Current development, compatibility and historical assurance

Phase 2: `PHASE_2_CURRENT_DEVELOPMENT_PATH_CONSOLIDATION_R1`.
The classification follows the accepted [Phase 1 audit and architect review](https://github.com/JENN2046/jenn-shooting-operations/issues/80),
at `4b4e145394ccb7c84f174f37a307c5ff8cdf4ed8`. Implementation is tracked in
[#81](https://github.com/JENN2046/jenn-shooting-operations/issues/81).

## Commands and coverage

| Command | What it runs |
|---|---|
| `npm run test:current` | Whole-file current tests, including mixed current/compat obligations |
| `npm run test:compat` | Migration, legacy protocol, readback/recovery and shared compatibility tests |
| `npm run test:historical` | G2/G3/production/shadow provenance plus retained unwired notification capability assurance |
| `npm run check:current` | `test:current`; current validators are exercised through the selected contract/schema/integration tests |
| `npm run check:compat` | Completeness guard, existing `validate:contract` (V1/V2/legacy parity), `test:compat` |
| `npm run check:historical` | Completeness guard, the existing eight shadow/production/G2/G3 validators, `test:historical` |
| `npm run validate:test-lanes` | Classification completeness only; does not execute product tests |
| `node scripts/test-lanes.mjs --list current` | Exact current selection; `compat` and `historical` also supported |
| `npm test` | **Unchanged** full `node --test tests/*.test.mjs` |
| `npm run check` | **Unchanged** nine-validator sequence followed by full `npm test` |

All three test commands validate the entire manifest before selecting files, and
return the Node test process failure status. Skips remain visible in the ordinary
Node reporter and are not converted into passes. No name-pattern exclusion or
test-body changes are used to speed up the current lane.

The initial selection is 76 current, 46 compat and 27 historical files, with a
125-file union: the original 124 files plus the guard regression test. Counts
overlap intentionally. Every current/compat mixed file is retained whole in both
lanes; this is conservative and is not a claim of mathematically minimal coverage.

Current retains persisted business truth and schema/FK/migration identity,
scheduling/config/proposals/preview/apply, actual events/context/time, admission,
identity/session/CSRF, operations/receipts/idempotency, V3 management/public board/
references, Kiosk/owner offline recovery, and current native VCP boundaries.
In particular, G3 startup/core acceptance, V1/V2-named shared contracts, the shared
Kiosk queue, durable quiescence and Outbox repository assertions stay in current.
The standalone V1/V2 contract validator does not cover V3; current relies on the
Schema12/classification/current integration tests instead of treating it as a V3 gate.

The six unresolved source modules from Phase 1 remain unchanged. Agent API/local
host confirmation tests retain current/compat membership. Unwired callback and
dispatcher/worker tests remain in historical as local capability assurance; that
placement does not retire the feature, declare it dead, or enable notifications.

## Adding or changing a test

`tests/test-lanes.json` lists each top-level `.test.mjs` file once, with one or more
lanes and a concrete protected invariant. Add or rename its entry with the test,
and explain the responsibility in review. Multiple lanes are appropriate when a
file protects shared behavior. Do not classify by a `g3` prefix or `-v1/-v2/-v3`
suffix, and do not move an entire mixed file out of current for timing alone.

The guard rejects unclassified additions, stale entries, repeated filenames,
empty/unknown/duplicate lanes, empty invariant descriptions, invalid paths and
malformed manifest structure. Nested `.test.mjs` files and symlinks under `tests/`
also fail: the preserved full glob would not reliably execute them. The guard's
own tests exercise both validation and the CLI in disposable fixtures, including
a skipped child test and a deliberately failing child test.

The union guard prevents accidental omissions. It does not prove an invariant's
semantics or authorize reclassification: membership and explanations remain
reviewable architecture decisions. Keep full `npm test` and `npm run check` for
release/integrated review while the lanes are being established. Changes touching
shared contracts, migrations, legacy behavior or historical evidence also require
the corresponding lane, even when current passes.

## CI and historical determinism

`.github/workflows/current.yml` runs `check:current` on pull requests and pushes to
`main`, using Ubuntu 24.04, Node 24.21.0 and Python 3.12.14. Manual dispatch also
runs compat and historical jobs in that environment; the historical job explicitly
uses process umask 0022. Existing five workflows and their full checks are retained.
No branch protection or required-check settings are changed.

The historical permission-change witness test now explicitly establishes 0755
before changing its synthetic directory to 0700. It asserts both modes and keeps
the original `PARENT_CHAIN_CHANGED` rejection assertion. This makes it test an
actual transition under either umask 0022 or 0077, without changing the production
comparator or weakening its failure conditions. The test touches only its own
temporary fixture. No runner changes the user's global umask or hides failures.

Cross-repository Extensions/adapter/author-source tests still need explicitly
supplied source/configuration. Local runs without them report skips. Neither a
passing current CI nor an optional skipped native integration is evidence of a
real production/client acceptance.

## Runtime boundary

This phase changes test selection, validation tooling, CI and documentation only.
`src/`, `public/`, `contracts/`, migration SQL/checksums, runtime composition and
production settings remain unchanged. Source/asset acceptance digests still cover
the same roots. There is no source deletion, archive move, notification wiring,
deployment or automatic merge.
