# G3 Schema 11 Exact Cutover Target Preparation R1

Status: **AWAITING_EXPLICIT_HUMAN_APPROVAL / EXECUTABLE PACKET NOT CREATED**

Canonical authority at preparation:

`codex/v2-1-architecture-freeze @ a4199fdb14808ebb866943148a222b0d4300d66e`

This record continues G3 preparation after the completed Schema 6→10 source-prefix alignment. It freezes the exact
Schema 10 production pre-state, recovery proof, writer containment, exact artifact and a bounded 10→11 execution
boundary. It does **not** authorize or execute Schema 11 and does not readmit normal writers.

## Exact production pre-state

Fresh read-only verification after source-prefix alignment and artifact staging confirmed:

```text
production service container = absent
production volume users      = 0
open DB file users           = 0
WAL / SHM                    = absent / absent

Schema                         = 10
migration count                = 10
migration 11 count             = 0
integrity_check                = ok
foreign_key_check violations   = 0

main DB sha256 =
5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7
```

The DB remained byte-identical across repeated samples. An unrelated historical
`jso-prod11-candidate-smoke` container is still running but mounts only a synthetic Kiosk auth file and has no access
to the production volume.

## Recovery binding

The verified Schema-10 recovery artifact remains:

```text
recovery artifact sha256 =
f2e643317a152600c8bf864648cec095ad57ba398c804feb35f9338a7073cfef

readback DB sha256 =
5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7

readback:
Schema 10
migration 11 = 0
integrity_check = ok
FK violations = 0
```

The content-family digest used by G3 is identical for the active pre-state and recovery source.

## Exact artifact

The same reviewed amd64 image is frozen:

```text
sourceCommit =
6334e2ae851247cb1558074fbd80cfee06b28c11

imageDigest =
sha256:581e9fa25e04b582aa39c2fdaa291f6db3e80fc3f3ac15a8a4afa06622442144

offline image archive sha256 =
7e6e707d11fab6c317851ad21fbc1a4ccdde0ff1dda4d6dba7535b3b37303dff
```

The exact archive was staged into the production Docker image store during preparation and re-verified by image ID,
architecture and OCI revision label. No container was started and the production DB hash remained unchanged.

## Bounded execution boundary

The proposed physical boundary is `G3_SCHEMA11_ATOMIC_EXCHANGE_R1`.

It deliberately does **not** migrate the active database:

1. require an exact approved packet plus a separately signed human-approval record; the approval payload is Ed25519-verified against the frozen signing public key and binds the computed authority-target digest, so caller-authored JSON cannot self-authorize execution;
2. require root execution, then revalidate hostname, Tencent instance-id metadata, `/dev/vdb`/ext4 binding, exact active DB inode/device/mode/uid/gid, and reject every running Docker container that either uses the named volume or bind-mounts the active DB path or any ancestor host directory; also require zero `lsof`/`fuser` DB users and absent WAL/SHM;
3. before consuming the one-shot claim, prove the exact migration UID/GID can write through the candidate-directory bind mount using the exact image; only then durably claim the one-shot attempt ledger before candidate mutation;
4. create the same-filesystem workdir as UID/GID 1000 with mode `0750`, copy the exact active DB there, and set the candidate file to UID/GID 1000 with mode `0600`;
5. give the exact image RW access only to that isolated candidate directory;
6. run migration 11 on the candidate with network disabled, read-only rootfs, all Linux capabilities dropped and
   `no-new-privileges`;
7. require Schema11 / exact migration checksum / `integrity_check=ok` / FK=0 / DELETE journal mode and no WAL/SHM/journal residue;
8. immediately before switch, repeat the exact physical-target, Schema10 hash, Docker-user, `lsof`, `fuser`, WAL/SHM and containment checks;
9. perform one `renameat2(RENAME_EXCHANGE)` syscall between the verified candidate and active DB path;
10. perform no further active-DB writes; terminal classification is a separate independent read-only verification.

Controller loss before the exchange leaves the active Schema10 file untouched. The final switch is one same-filesystem
atomic exchange. There is no automatic rollback and no automatic retry. If terminal state cannot be independently
classified, the result is UNKNOWN and writers remain blocked.

Exact executor:

```text
scripts/g3-schema11-cutover-executor.py
sha256:2c1a5d7baf52b165ed15d7efc4a7b9397e3908415ebb11866cc9df9e6ae43602
```

The rename-exchange helper and the pinned Ed25519 approval verifier both pass local self-tests. The exact candidate image independently migrated a disposable Schema10 DB to Schema11 with the frozen migration checksum, DELETE journal mode, integrity ok and FK=0. The approval signing private key is not stored in this repository or on the production host; only its public-key fingerprint is frozen into the execution boundary.

## Frozen digests

```text
targetBindingDigest =
sha256:30e6c937d5caddac4c575b49dac0d68139c5eff57b1d28c353d99e53c97e9a60

activeDatabaseFamilyDigest =
sha256:3df22ce713b686313f1c19bbb6fcf6b1af670f610ae46e884e890cb41fbe568e

recoveryReadbackProofDigest =
sha256:97b9fc0635056d1b0e172be337ac81de99667cc7b68703e6aed8815843873ad3

durableDisableReceiptDigest =
sha256:ded7530acd93b8997c08dbc68846f47d641c76e738a180b0a1d0267fc8103f7e

drainProofDigest =
sha256:7d4de65434606b1c4557536deee386ed25fc6f26c05919bc5e18f7bad1e7081f

executionBoundaryProofDigest =
sha256:df36498b6ee32430290582f4b5f5d30866b1d5796e3460aa1db3b5c194f11fea
```

## Exact human approval target

```text
operationId =
G3-SCHEMA11-OP-20261006-R1

proposed packetId =
G3-SCHEMA11-CUTOVER-20261006-R1

authorityTargetDigest =
sha256:ff621429caaf4a41f97ddc5925ee634ce43719adbaad5fd42dfb40932ee480d5
```

Current authority state remains:

```text
humanApproval = NOT_REQUESTED
executable G3 packet = NOT_CREATED
Schema11 cutover = NOT AUTHORIZED / NOT STARTED
normal writer readmission = NOT AUTHORIZED
```

Any change to the authority head, production target, Schema10 bytes, recovery evidence, containment evidence, image,
migration identity or execution boundary invalidates this target and requires a new digest and new approval.
