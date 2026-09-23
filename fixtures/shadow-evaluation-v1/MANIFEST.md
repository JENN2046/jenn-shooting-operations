# WO-05E-B Synthetic Shadow-Evaluation Fixture

This directory is checked-in, synthetic evidence for deterministic offline replay.

- `synthetic-level-a-b.v1.json` contains one Level A case and one Level B case.
- It intentionally contains **zero Level C cases**.
- It contains no client, requestedBy, Brief, note, URL, attachment, actor/device, provider, credential, or production-database content.
- The expected report is pinned by dataset/result digests.
- Agent shadow metrics therefore remain `NOT_ENOUGH_DATA`; only the Level B retrospective duration baseline has a denominator.
- The fixture can validate implementation determinism, but it **cannot** close the real shadow acceptance gate.

Replay with:

```sh
npm run evaluate:shadow:fixtures
```

The runner reads only this checked-in fixture and invokes the frozen classifier/evaluator with no network, provider, environment credential, or production database access.
