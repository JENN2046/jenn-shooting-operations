# JSO × VCP × VChart local candidate

Base: `418a3adfdc2766ac17ceddc3432b2f81d987e67a`. No migration, production activation, ToolBox registration, provider call or automatic memory write.

## Reuse and engineering choices

- JSO remains authoritative. VCP owns cognition, intent selection and Tool Loop. This code exposes a dedicated business tool; it is not a replacement agent or generic HTTP bridge.
- Existing JEV-first `JennShootingOperations` in `JENN2046/VCPToolBox-JENN-Extensions` at `7ea5d49ca000a2298e012b9ff54ec229ebb59e96` uses isolated JSON stdio. Its `SemanticIntent` currently classifies read/write-like wording and pulls V1 snapshots; mutation intent returns a non-writing proposal. This is transport/intent packaging, not evidence that JEV is performing a semantic scheduling decision. Preserve VCP's current capability selection; do not duplicate it in JSO.
- Reuse the existing dedicated `/api/v2/agent/tools` envelope and server-constructed assistant identity. The path retains its API version while reading Schema12 facts. Its config normalization already dispatches to V3; the previous gap was absent order/progress facts, not V3 config parsing.
- `read_state` now includes scoped order classification and execution facts. Unassigned orders require coverage of the entire registered catalogue. Reference files, private notes and Owner credentials are not included. The management endpoint's administrator requirement is unchanged.
- `propose_reschedule` reuses the canonical reschedule store's actual validation and returns before/after plus the exact command digest before any mutation. Test runs with SQLite `query_only=ON`. Deterministic constraints stay in JSO, including revisions, config, time windows, buffers, occupancy and immutable runs.
- `confirmAgentReschedule` is an internal trusted Owner-side helper. It accepts an independently authenticated administrator covering the resource, checks a separate assistant subject and exact displayed digest, and constructs an expiring grant. It is not a model-callable approval endpoint. A real human UI/session binding is still an integration requirement; the tests use synthetic human confirmation.
- Execution uses existing durable grant-attempt claims, transaction-time checks, operation IDs and receipt verification. Once a dispatch is claimed, even an unknown result must be reconciled under the original operation ID. No automatic regrant/retry or new ID fallback.
- The native example uses the same isolated stdio contract as the existing plugin, with an injected fixed loopback endpoint and dedicated assistant token. Model arguments cannot choose URL, credentials, role, grant or approval. It is a repo-relative local example, not an installable Extensions release.

## Actual VChart contract

Pinned author `lioensky/VCPChat` commit: `92d09a303eee10ed1911cdeb36fb13a866557cd6`.

Read these actual files: `VCPDistributedServer/Plugin/ChartController/{plugin-manifest.json,ChartControllerService.js}`, `modules/services/chartService.js`, `Chartmodules/{README.md,chart.js,chart-runtime.js}`.

The candidate creates a persistent chart with `CreateChart` and updates its external data with `ReplaceData` plus `expectedDataRevision`. The plugin returns `content/details` and throws failures, rather than a `status:success` wrapper. ChartService emits `data-replaced` without the new data; the real `chart.js` consumer retrieves the snapshot and calls runtime `update({...change,data:snapshot.data})`. `runtime.js` returns `mount/update/resize/setTheme/destroy` methods and reads `context.data`.

`chart.mjs` uses that contract and text-only DOM construction. The chart shows Asia/Shanghai times, the observed timestamp and JSO revision. Refresh semantics are **explicit read → ReplaceData**. There is no automatic polling or JSO event subscription in this candidate. A stale chart data revision is rejected. ChartService revision and JSO schedule/projection revisions are separate values.

## Local verification

Run on Node 24 with the repository dependencies available:

```sh
node --test tests/jso-vcp-vchart-local.test.mjs
npm run check
```

The actual-author-source test is optional and skips without `JSO_VCHART_AUTHOR_SOURCE`. That directory must contain pinned, independently retrieved `chartService.js` and `ChartControllerService.js`; do not use a running installation or production AppData. Tests create and delete their own isolated Charts directory.

```sh
JSO_VCHART_AUTHOR_SOURCE=/absolute/pinned-source \
JSO_VCHART_SYNTHETIC_EVIDENCE=/absolute/evidence/synthetic-chart-data.json \
node --test tests/jso-vcp-vchart-local.test.mjs

node examples/vcp-vchart/verify-render.mjs /absolute/pinned-source \
  /absolute/evidence /absolute/playwright/index.mjs
```

The renderer verifier additionally needs pinned `chart-runtime.js` and local Chrome. It uses actual ChartService/Controller/Runtime and the source-verified event-to-snapshot handoff in an isolated browser harness. It does not run the complete Electron workbench, distributed plugin loader, real Agent Tool Loop or JEV selection. It writes before/after screenshots and `browser-result.json`.

The stdio test spawns the actual example entry point against a temporary authenticated loopback server with synthetic identities. Ordinary invocation input:

```json
{"command":"read_state","payload_json":"{\"resourceScope\":[\"JSO-BIZ-RESOURCE-001\"]}"}
```

Other actions remain governed by `src/jso-agent-api-v1.mjs`. The local environment binding names are `JSO_LOCAL_AGENT_ENDPOINT` (loopback only, exact Agent path) and `JSO_LOCAL_AGENT_TOKEN`. Do not supply credentials in model arguments or chart data. This example never reads existing runtime binding/credential files.

## Remaining integration boundary

No external repository was edited. Adapter ownership remains `JENN2046/VCPToolBox-JENN-Extensions`; any later integration needs a separately scoped candidate there, limited to `Plugin/JennShootingOperations` and its dedicated Agent transport/tests. Do not change ToolBox core for architectural symmetry. Do not copy this example over the current JEV entry point blindly: preserve current capability selection and read/propose semantics while adding the actual Schema12 boundary.

No approved live adapter identity or real native Tool Loop was exercised. The old PROD10 V1 result and its existing identity-pinned VCP integration test are not Schema12 proof. This delivery is local candidate evidence only, not `productionintegrationPASS` or permission to deploy.
