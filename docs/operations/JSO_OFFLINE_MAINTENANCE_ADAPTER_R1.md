# Offline empty-domain maintenance adapter R1

Status: implementation and synthetic acceptance; production bindings and execution
approval pending. Base authority is 7c7e0945b6758462536d12ea78ed7a7b34d42f56.
This contract adds no GF15/PROD11 authority, release, cutover or startup bootstrap.

## Supported boundary

Only a local Linux Docker daemon, a plain `local` named volume (no driver options),
an already staged schema10 database and empty uploads, and an exact immutable
candidate are supported. No remote Docker context, bind-backed/plugin volume,
SQLite migration, storage creation, backup creation, provider call or HTTP surface
is supported. Operations remain initialize/registerResource/publishConfig/
activateConfig, separately approved. Publication does not activate.

The host coordinator independently reads its UID, machine/boot identity, Docker
daemon ID, volume creation/driver/mountpoint identity and image OCI revision.
The isolated helper observes filesystem device/inode, cleanup marker and Node
runtime. Caller-supplied values are expected bindings, never observations.
Mismatches and incomplete observation fail closed. Approval is an existing,
root-owned, protected on-host packet file, not a flag in the operation packet.
Root/daemon administrators and reviewed packaged code are the trust boundary;
this is not protection against a malicious administrator.

Continuous exclusion uses an existing protected host fence file and a kernel
exclusive flock retained for the entire helper lifetime. Every permitted runtime
must use the packaged shared-lock entry point; its exact image, command, read-only
fence mount and disabled runtime configuration are checked against an independently
read protected policy roster. Autorestart, unregistered containers, running users
of the volume, bind/volume aliases and changes before commit are refused. The
coordinator reobserves the daemon and storage while SQLite holds BEGIN IMMEDIATE,
then permits commit. Docker enumeration alone is not a fence. The operation owner
must establish that privileged host tools, orchestrators and other Docker clients
cannot bypass the reviewed shared-lock start protocol during the window. This
administrative prerequisite cannot be inferred from Docker inspection; absent a
separately approved and evidenced enforcement arrangement, production is blocked.
The adapter provides cooperative kernel exclusion, not a mandatory host-wide
storage security policy. No existing service is converted by this PR.

The helper has no network, published port, Docker socket, credentials or HTTP
server. Rootfs is read-only, capabilities are dropped and no-new-privileges is set.
Its single writable storage mount is the bound volume; transient /tmp is private.
Write admission, cleanup and Kiosk remain disabled. The transaction core retains
schema, emptiness, receipt/config reconciliation and quiescence checks. The helper
does not use application startup to open a production database.

## Packet and approval

The execution packet binds schemaVersion1, scope, observed host/storage/fence,
and the existing operation packet. Its operation target uses the fixed helper
root `/maintenance-data`, filename `shooting-operations.sqlite`, root/DB/uploads
device/inode and cleanup marker digest. Runtime is exact full sourceRevision and
immutable imageId. Actor must equal the observed host `uid:<uid>`.

Policy binds the same scope/host/storage/fence/runtime plus exact writer container
IDs. Approval binds scope, observed operator UID, approvalRef, canonical packet
digest, canonical policy digest, bounded validity window and recoveryRef. Production
approval/policy/fence files and ancestors must be root-owned and protected against
group/other writes; files must be single-link regular files without symlinks.
The CLI does not create any of these files or amend frozen action arrays.
RecoveryRef identifies a separately reviewed recovery plan; it is not proof that
a consistent backup exists. Production execution additionally requires separately
accepted new-data backup/recovery evidence and writer-start enforcement evidence.

Local acceptance uses explicit LOCAL_SYNTHETIC_ADAPTER scope, private
`/tmp/jso-adapter-test-*` approval storage and newly allocated, labelled
`jso-adapter-test-*` volumes. These self-authored fixture approvals are deliberately
not production authentication. Real production bindings may not substitute into
this scope. Production execution is not authorized by test success.

## Failure and recovery

A refusal before opening the helper writes no DB facts. Within a transaction, loss
of approval validity, storage identity, fence, observer, or permitted inventory
rolls back. Coordinator/helper crashes before commit are reconciled by reopening
the same DB with the same admitted packet. Lost output after commit is an unknown
outcome: preserve DB/WAL/SHM/uploads/control namespaces; repeat only the exact
packet after renewed independent observation and still-valid approval. A durable
receipt returns the sealed exact replay, never a second mutation. No absence of a
CLI response proves that nothing committed. No automatic cleanup/reset/restore or
writer start follows success or failure.

Initialization, configuration and audit receipts are control facts. Once any such
fact exists, returning to the retained old system is not lossless. Stop writers,
preserve the new data family and controls, and use separately approved reconciliation,
repair or consistent restore with declared data-loss bounds. Physical device,
external integration, GF15 fresh Asia/Shanghai window, PROD11 and post-smoke normal
operation remain separate gates. Historical candidate receipts remain unchanged.
