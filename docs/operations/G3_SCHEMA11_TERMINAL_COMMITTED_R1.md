# G3 Schema11 Cutover Terminal Classification R1

Status: **COMMITTED / WRITERS STILL DISABLED**

Authority target:

```text
operationId =
G3-SCHEMA11-OP-20261006-R1

packetId =
G3-SCHEMA11-CUTOVER-20261006-R1

authorityTargetDigest =
sha256:10ce21ebeb207afa556a48c215439077736af242cd312a49783b1136fe046ab5
```

## Execution result

The bounded executor completed the isolated Schema10→11 candidate migration and one same-filesystem
`renameat2(RENAME_EXCHANGE)` switch.

The durable one-shot attempt record is:

```text
/mnt/datadisk0/g3-schema11-cutover/attempts/
aa9c7a4c2ad48ed6e808a48c6e24790ff0c5d25883536ab2bfd27e0f6447b6c6.json

sha256 =
b398b83229bdece61032e7fa64f03d01594a3aa59abcc96954036871a8c4ed37
```

It binds the exact packet, operation and authority-target digest above. The exact 230-byte production ledger record is also archived as `g3-schema11-attempt-record.r1.json`; the terminal validator hashes those archived bytes and verifies the parsed record identity rather than trusting copied terminal-evidence fields.

## Independent terminal verification

Two independent post-exchange samples observed the same active database digest:

```text
active Schema11 sha256 =
0eae48b85f362cf1064f92e14511865fe7fd68dbc13a85d4c6efd6e656e736d9
```

The active database verifies:

```text
schemaVersion = 11
migrationCount = 11
migration11Count = 1
migration11Name = business_calendar_and_reschedule
migration11Checksum =
sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8
integrity_check = ok
foreign_key_check violations = 0
journal_mode = delete
WAL / SHM / journal = absent
```

The exchanged-out exact Schema10 pre-state remains preserved at:

```text
/mnt/datadisk0/g3-schema11-cutover/
G3-SCHEMA11-OP-20261006-R1/candidate.sqlite

sha256 =
5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7
```

Its Schema10 migration state, integrity and zero-FK status were independently re-read after the exchange.

## Containment at classification

Fresh post-state verification returned:

```text
hostname = VM-0-12-ubuntu
instanceId = ins-mi85f3my
running containers with production DB access = 0
lsof DB users = 0
fuser DB PIDs = 0
production service container = absent
normal writes = disabled
writer readmission = NOT AUTHORIZED
```

The frozen executor's own container mount-namespace and open-file containment checks passed against the
post-exchange active database.

## Terminal receipt

```text
receiptId =
G3R-SCHEMA11-COMMITTED-20261006-R1

outcome =
COMMITTED

schemaVerificationDigest =
sha256:e2da8bab2b70956463927b418738bd82f64e6733100ad5f063e8cd44658a52e4

postStateDigest =
sha256:ce80ae31d1bc38f15b90ae8dc77f026c8fb745cb217b5e2708a6d0db03ba4aea
```

The repository validator independently re-verifies the R2 Ed25519 approval, frozen packet/target,
attempt identity, detailed terminal evidence digests and the existing G2/G3 terminal receipt semantic contract.

## What this does not authorize

This terminal classification does **not** authorize:

- normal writer readmission;
- restarting the old production container;
- automatic retry;
- any unrelated Kiosk, VCP, DingTalk or business-data mutation.

G3 Schema11 cutover is committed, but production remains intentionally contained until a separately frozen
readmission/startup action is reviewed and authorized.
