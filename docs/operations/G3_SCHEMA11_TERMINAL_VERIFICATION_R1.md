# G3 Schema11 Terminal Verification R1

Status: **COMMITTED / WRITERS STILL CONTAINED**

Canonical authority at execution:

`codex/v2-1-architecture-freeze @ b9dd595eb52bd09f7a8e2115a48ac401389f5b73`

Approved exact target:

```text
operationId = G3-SCHEMA11-OP-20261006-R1
packetId = G3-SCHEMA11-CUTOVER-20261006-R1
authorityTargetDigest =
sha256:10ce21ebeb207afa556a48c215439077736af242cd312a49783b1136fe046ab5
```

The cutover executor produced an isolated Schema11 candidate, re-verified the
Schema10 prestate and writer containment, then completed one same-filesystem
`renameat2(RENAME_EXCHANGE)`. The executor did not classify the result itself;
independent read-only terminal verification did so afterward.

## Independent terminal evidence

Active production database after exchange:

```text
sha256 =
0eae48b85f362cf1064f92e14511865fe7fd68dbc13a85d4c6efd6e656e736d9

Schema = 11
migration count = 11
migration 11 =
business_calendar_and_reschedule
sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8

integrity_check = ok
foreign_key_check violations = 0
journal_mode = delete
WAL/SHM = absent
```

The active DB hash exactly equals the candidate Schema11 hash reported by the
executor before the exchange and remained identical across two independent
post-exchange samples.

The exact pre-cutover Schema10 database remains preserved at:

`/mnt/datadisk0/g3-schema11-cutover/G3-SCHEMA11-OP-20261006-R1/candidate.sqlite`

with original SHA256:

`5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7`

and verifies Schema10 / migration11 absent / integrity ok / FK=0.

## Attempt and writer authority

Exactly one durable attempt record exists:

```text
/mnt/datadisk0/g3-schema11-cutover/attempts/
aa9c7a4c2ad48ed6e808a48c6e24790ff0c5d25883536ab2bfd27e0f6447b6c6.json
```

It binds the exact packet, operation and authority target.

At terminal classification:

```text
production service container = absent
managed JSO systemd service = absent
open DB users = 0
fuser DB pids = 0
running containers with production DB access = 0
G3 executor processes = 0
migration-image containers = 0
normal writes = disabled
authoritative write capability = absent
```

No normal-writer readmission is authorized by this terminal result.

## Machine-verified terminal digests

The trusted semantic boundary reads two independent raw evidence artifacts rather
than trusting the classification record itself:

```text
production attempt file sha256 =
sha256:b398b83229bdece61032e7fa64f03d01594a3aa59abcc96954036871a8c4ed37

attemptEvidenceDigest =
sha256:8596a29034f0a73b6949e709edb108b29ae3027af6ba83fd1ed44972315e9158

production observation file sha256 =
sha256:2269ce7552057b89d72c81f204e39b0d0be584b840f90be2df1ccdb58cb65d25

productionObservationDigest =
sha256:0ee2a96becab19de15c190d6d76465bc535d7c5c894b0d3de52cb71d9b2e6ef6

approvalEvidenceDigest =
sha256:21c4a02bf69fbe2ab8cd6e1cc178b87e74900f9bb547cf1dd69809433332aa4b

schemaVerificationDigest =
sha256:4f9af7c05692edd370f7eb6e310c4dbd4416ec075de33e898e0475af32d4f340

postStateDigest =
sha256:7ecb73f4b9432073f8f3d87afd3cf488ce10858e2494d0109b235ab9dcdaaf2e
```

The terminal receipt validates through the G2 semantic boundary as:

```text
G3_SCHEMA11_TERMINAL_VERIFICATION_VALID
outcome = COMMITTED
```

## Current gate state

```text
G3 SCHEMA11_CUTOVER = COMMITTED
production Schema = 11
normal writer readmission = NOT AUTHORIZED
production service start = NOT AUTHORIZED
next gate = G4 PRODUCTION_V1_CLOSURE
```
