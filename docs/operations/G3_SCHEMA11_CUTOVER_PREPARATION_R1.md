# G3 Schema 11 Cutover Preparation R1

Status: **BLOCKED_SOURCE_SCHEMA_MISMATCH / NO PRODUCTION AUTHORITY**

Authority base:

`codex/v2-1-architecture-freeze @ 6334e2ae851247cb1558074fbd80cfee06b28c11`

This preparation is evidence assembly only. It did not disable writers, restart or replace the production container, mutate SQLite, create a recovery artifact, upload the candidate image, or execute Schema 11.

## Fresh production facts

Fresh read-only observation on 2026-10-06 confirmed the historical target locator still resolves to the same production identity:

- instance: `ins-mi85f3my` / `VM-0-12-ubuntu`;
- container: `jenn-shooting-operations-prod`;
- live container ID: `b29798598ac043794420599c23f735c19038744a76f1b490b3e8c5a58e28e6be`;
- live image: `sha256:c305de265b480160e24d0ad4ce75b7c4617a7f49a5a8497ef6ba71d99d9aa545`;
- live image revision: `92b7137211bf807f178901e878a8c3d6e335cec4`;
- loopback bind: `127.0.0.1:3800`;
- volume: `jenn-shooting-operations_shooting_data`;
- database: `/app/data/shooting-operations.sqlite`;
- `/healthz`: `200`, container health `healthy`;
- write admission: **enabled**;
- orphan cleanup: **enabled**.

The live SQLite database is healthy but is **Schema 6**, not Schema 10:

```text
schemaVersion = 6
latestMigration = scheduling_run_context_capture
journalMode = wal
integrity_check = ok
foreign_key_check violations = 0
```

DB/WAL/SHM hashes and inode/size facts were identical across two read-only samples ending `2026-10-06T08:43:35Z`. That is useful observation evidence, but it is **not** authoritative pre-state because normal writers are still enabled.

## Exact candidate artifact

A local amd64 candidate image was built from the current canonical authority without uploading or loading it on production:

```text
sourceCommit = 6334e2ae851247cb1558074fbd80cfee06b28c11
imageDigest  = sha256:581e9fa25e04b582aa39c2fdaa291f6db3e80fc3f3ac15a8a4afa06622442144
```

A disposable local Schema-6 database was opened through the candidate image's real `ScheduleStore`. The ordinary runtime bootstrap advanced only migrations 7-10:

```text
before = 6
after  = 10
migration 11 rows = 0
```

This proves the candidate respects the G2 boundary: ordinary runtime may finish the pre-cutover prefix, but it cannot perform 10→11.

## Blocking fact

The frozen G2 transition is exactly:

```text
source = 10
target = 11
```

Production currently reports:

```text
source = 6
```

Therefore an executable G3 packet **must not be created**. Writing `source=10` into a packet would be false authority.

## Required in-gate prerequisite action

The next possible action is not a new Gate. It is a bounded prerequisite inside G3 Preparation:

`G3_PREP_SOURCE_PREFIX_ALIGNMENT_6_TO_10`

It would be a production mutation and is currently **NOT AUTHORIZED**.

Its future authority must bind the exact candidate artifact and production target, permit only migrations 7-10, prove migration 11 remains absent, and leave the system fail-closed for the subsequent 10→11 preparation. Because current normal writers and orphan cleanup are enabled, that action also requires its own fresh containment/recovery plan before execution.

No part of this document grants that authority.

## Readiness

```text
exact artifact prepared                 = yes
fresh target observed                   = yes
source schema = 10                      = no
durable writer containment verified     = no
zero in-flight writers proven           = no
verified recovery artifact available    = no
authoritative pre-state captured         = no
execution boundary verified             = no
human approval                          = NOT_REQUESTED
executable G3 packet                    = NOT_CREATED
```

Verdict:

**G3 Preparation is validly BLOCKED. DO NOT EXECUTE Schema 11.**
