# G3 Two-File Custody & Origin Signer Authority Design Review R1

**Status: FROZEN DESIGN REVIEW CANDIDATE / NOT EXECUTABLE / NO PRODUCTION AUTHORITY**

- Work order: `G3_TWO_FILE_CUSTODY_AND_ORIGIN_SIGNER_AUTHORITY_DESIGN_REVIEW_R1`, under Issue #55 and Draft PR #56.
- Source review head: `6cd9f232bac0283cd97f1b1f6a9f06eab88dd38b`; then-current canonical authority: `371bf8982b0cd0df579b0e981964b27f9d0319fc`. Recheck before any future target freeze.
- This freezes **design requirements and rejection predicates only**. It does **not** approve who to trust, select an operational signer, modify database/file permissions, install a custody lock, sign evidence, authorize forward adoption, merge, or release writers/service/G4.
- Historic G3 physical outcome `COMMITTED` with governance `RECONCILIATION_REQUIRED`; consumed rollback outcome `UNKNOWN`. All original receipts and replay identities remain immutable.

## 1. Source-backed current physical/security boundary

At the latest **read-only** production inventory (2026-10-08 04:45–04:49 UTC), the two physical DBs and the consumed rollback attempt retained their historical SHA256 identities. Both reside on shared, writable ext4 `/dev/vdb`. The active Schema11 inode is `64784:2229903`, mode 0600, owned by UID 1000; preserved Schema10 inode is `64784:1835048`, mode 0644, owned by UID 1000; both have one hard link. No ext4 immutable `i` flag was observed. Their parent directory entries and ownership must be re-proved at the future execution boundary.

A bounded live scan observed **168 processes, 1704 file-descriptor checks, 17 mount namespaces** with no known matching open DB FD/memory mapping or target DB mounts. One FD stat probe failed. Six Docker containers were enumerated, none with the target DB mounts. No JSO-named systemd/cron helper was identified in the bounded inventory. These are *current observations*, NOT durable capability revocation.

Docker's local JSO named volume still exists; Docker daemon, socket and containerd are active/enabled. Host `ubuntu` (UID 1000) is in `sudo`, `docker`, `lxd`; the Docker socket is root:docker 0660. **This actor is effectively privileged for the target threat model**, even if it cannot directly traverse the root-owned volume ancestors as an ordinary POSIX user. Parent permissions and group membership do not prove irrevocable write exclusion. Four unrelated Compose projects share the Docker host; `/dev/vdb` was reported ~98% full. Never apply a whole-filesystem read-only remount or stop all Docker as a shortcut.

## 2. Trust-model decision, explicitly NOT chosen

| Model | Who must be trusted | Feasibility |
| --- | --- | --- |
| `TRUSTED_HOST_ADMIN` | Linux kernel, physical/cloud storage, actual production root, Docker daemon and every principal with sudo/docker/lxd/other root-equivalent capability (currently includes ubuntu), plus an **independent external custody verifier/signer** for attestation | A *conditional candidate*, only if a separately authorized human explicitly accepts this trusted computing base and confirms it is exhaustive. Controls are durable **against unprivileged/unauthorized writers**, not against a malicious trusted administrator. |
| `ADVERSARIAL_HOST_ADMIN` | Production root/Docker admins are not trusted | **BLOCKED on current live-host file-only design**. No self-applied Linux DAC, `flock`, `chattr +i`, readonly bind mount, local ledger or off-host signature alone can enforce continual protection against that adversary. Require an independently enforced storage/provider/host-level denial for **both live inodes and their name/replacement paths**, with externally verifiable recovery/immutability evidence. No such mechanism has been proven or selected. |

**Default:** `TRUST_PROFILE_UNDECIDED` and `FAIL_CLOSED`. No user acceptance of root/admin trust is inferred from this review. A trusted-root design must state explicitly that privileged admins are in the TCB, not silently reinterpret “all writers revoked.”

Grounding: Docker documents the `docker` group as root-level privilege and describes the daemon's powerful host-mount surface; Linux `chattr +i` prevents ordinary inode write/rename/unlink but may be cleared by sufficiently privileged administrators.
References: https://docs.docker.com/engine/install/linux-postinstall ; https://docs.docker.com/engine/security/ ; https://man7.org/linux/man-pages/man1/chattr.1.html .

## 3. Exact two-inode file-custody design, NOT installed

**Preferred conditional candidate for `TRUSTED_HOST_ADMIN`:** an authority-controlled, audited protective transition affecting **both existing database files**, with ext4 `immutable` inode flags as one possible physical enforcement layer. Flag installation/removal are **separately authorized production mutations**, not part of this review. Root and processes with `CAP_LINUX_IMMUTABLE` may set/clear inode immutability; Docker admin and privilege-elevation routes remain inside the explicitly accepted TCB. If they are adversarial, this design must fail rather than claim a stronger guarantee.

The future custody mechanism must meet **all** of these independent predicates:

1. **Target identity:** bind exact canonical path, device/inode, size, SHA256, owner/mode/link count, parent-chain identities, mountpoint and alternate reachable path aliases for *both* active Schema11 and preserved Schema10. Refuse stale identity, unexpected link, sidecar, renamed parent, writable replacement or ambiguous namespace.
2. **Pre-fence drain:** identify, stop/deny and independently prove absence of every *untrusted* preexisting FD, helper, container, mount and automatic restart capable of writing either inode or replacing its directory entry. `lsof/fuser=0` is not sufficient. Enumerate and explicitly classify all privileged actors, including sudo/docker/lxd and Docker daemon/socket.
3. **Durable fence:** a candidate ext4 immutable flag must be applied to **both exact original inodes**, with ordered durable evidence and reboot/crash-consistent independent readback. A pinned file must not be open in write mode; its path/parent replacement and Docker recreate paths must be assessed. A file mode bit or readonly SQLite connection alone is not a fence. If one file protects and the other fails, terminal state is **PARTIAL / UNKNOWN / BLOCKED**, not PASS, and no automatic fallback/rollback/unlock.
4. **Narrow scope:** preserve unrelated applications, attachments and shared `/dev/vdb`; don't mark a broad shared directory immutable without an explicit impact proof, don't stop the shared Docker service, don't apply whole-disk read-only changes. A witnessed capacity and fault check is required, especially on the nearly full disk.
5. **Continuous admission boundary:** before any future claim, independently verify both flags/host custody state and actual persisted revocation against a fresh namespace/alias/process inventory, then use pinned descriptors with `fstat` and before/after hashes during the bounded read-only witness. No application writer, helper or capability re-admission between fence and claim. Any change/uncertainty/restart/host admin boundary breach ⇒ `BLOCKED`; don't resume by guessing.
6. **Later release:** if Schema11 must resume normal writing in the future, release of any protective flag is a **new, signed, separately human-authorized** bounded operation. Forward baseline adoption **alone** must not unfreeze either file. A crash or owner loss must leave writes blocked.

**Rejected shortcuts:**
- `flock`, a suspended owner process, a locally updated admission boolean, empty process list, read-only mount in one namespace, or a root-written “signed” report are not durable proof.
- `fs-verity` is **not** the default for the live active Schema11 file: verity makes that inode permanently read-only, incompatible with future writes to that exact inode. It does not itself prevent rename/delete/replacement and needs separate path custody. It may be considered for a *separate immutable reference copy* only after another review. Source: https://docs.kernel.org/filesystems/fsverity.html .
- A cloud snapshot or immutable off-host copy can authenticate reference bytes, but **does not fence the writable active live path by itself**.

A disposable ext4 fixture acceptance test plus independent failure/restart/partial-protection simulation must precede any proposal to change the real inodes. **No flag changes, permission changes or installation were performed.**

## 4. Independent external signer contract, NOT provisioned

**Two independent roles:** (a) human Owner approves future authority targets and any live custody/unlock action; (b) external Origin Signer attests witnessed *facts*. They must use different keys and trust decisions. A valid Origin signature is **not** the human Owner's approval, and it cannot retroactively authorize the original G3 cutover.

**Signer location and origin boundary:** signer's Ed25519 private key resides **outside the production VM, Docker, repository and agent workspace**, in independently controlled secret custody. The trust anchor is the SHA256 of the signer public SPKI DER, independently approved/versioned on an authority surface; never accept a public key carried solely by the claimed witness. Current public key pin, signer key custody and production instance identity are **NOT_BOUND**. The host currently reports `VM-0-12-ubuntu` as short hostname and `localhost.localdomain` as FQDN, neither an origin trust anchor.

**Exact minimum future protocol (not an executable API):**

1. The external coordinator verifies an independently pinned production host SSH/public instance identity and the **then-current post-merge canonical authority head**; it creates a cryptographically random **32-byte, one-use nonce** with a candidate maximum **300-second window**. TTL is a design bound, not a scheduled operation. Nonce is durably consumed by the coordinator whether the witness is accepted, rejected or uncertain; no replay on response loss.
2. A separately authorized, pinned read-only witness runs on the identified production host under verified custody, observes **both opened original DB descriptors** and emits only bounded, canonical JSON data: both file identities/hashes, exact 40/42 table roster and typed row-set digests, original 10 migration prefix and marker11, SQLite metadata scope, timestamp/runtime, verifier SHA256 and `captureDigest`. No business rows, raw production DB bytes or production secrets leave the host.
3. A **separate independent custody attestation** binds the two-file protection state, the scope/limitations of privileged administrative trust, parent/mount namespace coverage, durable exclusion of untrusted writers, before/after opened FD/hash revalidation and the off-host nonce. A self-declared `NOT_ATTESTED` value is not proof.
4. External Origin Signer **directly validates** authenticated execution/provenance, exact witness bytes and code digest, signer trust and active nonce, pinned file hash/inodes, independent custody attestation and allowed time window. It then signs a distinct domain-separated attestation binding `captureDigest + custodyReceiptDigest + nonce + observedInstanceId + canonicalHead + observerSha256 + interval`. A signature over caller-supplied JSON alone cannot satisfy this requirement. Use the exact existing witness canonical-byte rules rather than introducing an unreviewed second JSON serializer.
5. An independent verifier checks the origin key pin, signature, challenge expiry/replay ledger, custody and data digests and relevant fresh live target identity. Key rotation/revocation requires a separately reviewed, signed trust-anchor change. Missing verification, stale root/key, unknown physical outcome or network ambiguity ⇒ `BLOCKED`.

The current PR #56 observation verifier emits **`SIGNED_READONLY_OBSERVATION_NOT_ADMISSION`** at best; it does not implement these outer custody/origin attestation and authorization transitions. This design **does not add an API or runtime implementation**. The attestation ledger should be controlled **off-host and append-only**, not by the same root administrator who is the subject of observation.

## 5. Authority compatibility and review/exit gates

- This is a **G3 reconciliation sub-action design**, not a new gate family under G2. The frozen `G2_I1..I6` are not modified, especially writer containment, exact artifact+human approval, prestate protection, one-shot claims, terminal `UNKNOWN`, and readmission block.
- History stays `G3 physical COMMITTED` / `G3 governance RECONCILIATION_REQUIRED` / `old rollback UNKNOWN`. No approval can be backdated, old operation identity replayed or historical terminal receipt rewritten.
- **To exit design review:** independent technical and security review must accept one explicit root/admin trust model; resolve exact two-inode protection feasibility on shared storage (including parent replacement and restart), confirm source-of-origin signer/key policy, failure modes and boundaries, with no P0/P1 in this *design*. This is **not** an acceptance of the *physical* P1/P2 production findings.
- **Before any real custody mutation or trusted capture:** a separate versioned approved governance exception, exact authorized target bound to the then-current canonical head, independent custody/execution boundary and explicit human approval are required. **Never use this document as approval**.
- Even a future accepted `RECONCILED_FORWARD_ONLY` production baseline does **not** automatically authorize writer readmission, service startup or G4. Releasing immutable flags or reviving normal writers requires fresh separate authorization.

```text
DESIGN_REVIEW_STATUS          = FROZEN_CANDIDATE_NOT_EXECUTABLE
TRUSTED_HOST_ADMIN_ACCEPTED  = false
ADVERSARIAL_ADMIN_FENCED     = false
CUSTODY_IMPLEMENTED          = false
BOTH_INODES_PROTECTED        = false
PRODUCTION_WITNESS_EXECUTED  = false
ORIGIN_SIGNER_KEY_PINNED     = false
ORIGIN_ATTESTATION_SIGNED    = false
HUMAN_ADOPTION_APPROVAL      = false
IN_PLACE_ADOPTION_ALLOWED    = false
WRITER/SERVICE/G4            = BLOCKED
ROLLBACK_EXECUTED            = false
```
