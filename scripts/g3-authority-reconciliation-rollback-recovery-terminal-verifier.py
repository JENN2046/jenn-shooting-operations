#!/usr/bin/env python3
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import sqlite3
import stat
import subprocess
import tempfile
import urllib.request

ACTIVE_DB = Path("/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data/shooting-operations.sqlite")
EXCHANGED_OUT_SCHEMA11 = Path("/mnt/datadisk0/g3-schema11-cutover/G3-SCHEMA11-OP-20261006-R1/candidate.sqlite")
VOLUME_NAME = "jenn-shooting-operations_shooting_data"
EXPECTED_VOLUME_MOUNTPOINT = Path("/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data")
CONTROL_ROOT = Path("/mnt/datadisk0/g3-authority-binding-reconciliation/rollback")
EXPECTED_HOSTNAME = "VM-0-12-ubuntu"
EXPECTED_INSTANCE_ID = "ins-mi85f3my"
INSTANCE_ID_URL = "http://169.254.0.23/latest/meta-data/instance-id"
EXPECTED_FILESYSTEM_SOURCE = "/dev/vdb"
EXPECTED_FILESYSTEM_TYPE = "ext4"

CANONICAL_BRANCH = "codex/v2-1-architecture-freeze"

TARGET_ID = "G3-AUTH-RECON-ROLLBACK-RECOVERY-TARGET-20261007-R1"
ACTION_ID = "G3_AUTHORITY_BINDING_RECONCILIATION_ROLLBACK_UNKNOWN_RECOVERY_TO_10"
OPERATION_ID = "G3-AUTH-RECON-ROLLBACK-RECOVERY-20261007-R1"
PACKET_ID = "G3-AUTH-RECON-ROLLBACK-RECOVERY-PACKET-20261007-R1"
CONTRACT_ID = "G3_AUTHORITY_BINDING_RECONCILIATION_ROLLBACK_RECOVERY_V1"

PRIOR_UNKNOWN_OPERATION_ID = "G3-AUTH-RECON-ROLLBACK-20261007-R1"
PRIOR_UNKNOWN_PACKET_ID = "G3-AUTH-RECON-ROLLBACK-PACKET-20261007-R1"
PRIOR_UNKNOWN_TARGET_DIGEST = "sha256:b71d4853f47c8f2404b331c8a9e810747ba211a867353607819ee70ff15bf509"
PRIOR_UNKNOWN_ATTEMPT = CONTROL_ROOT / "attempts" / "9840b86cf035c61b2f804305a97a98f98771103cb33f799b22e0fdf698190912.json"
PRIOR_UNKNOWN_ATTEMPT_SHA256 = "sha256:bfd40da521d2a3871ffcf4b4913de260d51c368eeca0ca775c4bda6b25b5645a"
PRIOR_UNKNOWN_TERMINAL_EVIDENCE_DIGEST = "sha256:7e04e137efa425361bf0a400017bf4452bc45cf2e9daae6c6b49c767f341ebb1"

SCHEMA11_SHA256 = "sha256:0eae48b85f362cf1064f92e14511865fe7fd68dbc13a85d4c6efd6e656e736d9"
SCHEMA11_SIZE = 540672
SCHEMA11_DEVICE = 64784
SCHEMA11_INODE = 2229903
SCHEMA11_MODE = 0o600
SCHEMA11_UID = 1000
SCHEMA11_GID = 1000

SCHEMA10_SHA256 = "sha256:5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7"
SCHEMA10_SIZE = 512000
SCHEMA10_DEVICE = 64784
SCHEMA10_INODE = 1835048
SCHEMA10_MODE = 0o644
SCHEMA10_UID = 1000
SCHEMA10_GID = 1000

MIGRATION11_NAME = "business_calendar_and_reschedule"
MIGRATION11_CHECKSUM = "sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8"

APPROVAL_SOURCE = "EXPLICIT_HUMAN_CHAT_AUTHORIZATION"
APPROVAL_SIGNATURE_ALGORITHM = "Ed25519"
APPROVAL_SIGNING_KEY_ID = "sha256:0d9c964a35c05842b5aafbe261fb5e020427ad5c635357e6955201da56100bae"
APPROVAL_PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAO6+9DSKWYrwyEC20zFe1GPdeTEYggybpXBrxDib5Koo=
-----END PUBLIC KEY-----
"""

DIGEST_RE = re.compile(r"^sha256:[a-f0-9]{64}$")
COMMIT_RE = re.compile(r"^[a-f0-9]{40}$")


def canonical_json(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        if isinstance(value, float) and not (value == value and abs(value) != float("inf")):
            raise RuntimeError("TERMINAL_CANONICAL_JSON_INVALID")
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        if any(not isinstance(key, str) or key in {"__proto__", "constructor", "prototype"} for key in value):
            raise RuntimeError("TERMINAL_CANONICAL_JSON_INVALID")
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False) + ":" + canonical_json(value[key])
            for key in sorted(value)
        ) + "}"
    raise RuntimeError("TERMINAL_CANONICAL_JSON_INVALID")


def canonical_digest(value):
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def rollback_target_digest(target):
    return canonical_digest({
        "domain": "g3-authority-binding-reconciliation-rollback-recovery-target-v1",
        "rollbackTarget": target,
    })


def exact_keys(value, expected, code):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise RuntimeError(code)
    return value


def sha256_file(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def load_json_file(path: Path, code):
    try:
        metadata = path.lstat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise RuntimeError(code)
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(code) from exc
def verify_approval_signature(message: bytes, signature_b64: str):
    try:
        signature = base64.b64decode(signature_b64, validate=True)
    except Exception as exc:
        raise RuntimeError("TERMINAL_APPROVAL_SIGNATURE_INVALID") from exc
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        public_key = root / "approval-public.pem"
        signature_path = root / "approval.sig"
        message_path = root / "approval.msg"
        public_key.write_text(APPROVAL_PUBLIC_KEY_PEM, encoding="ascii")
        signature_path.write_bytes(signature)
        message_path.write_bytes(message)
        try:
            result = subprocess.run([
                "openssl", "pkeyutl", "-verify", "-rawin", "-pubin",
                "-inkey", str(public_key), "-sigfile", str(signature_path),
                "-in", str(message_path),
            ], text=True, capture_output=True)
        except FileNotFoundError as exc:
            raise RuntimeError("TERMINAL_APPROVAL_SIGNATURE_VERIFIER_UNAVAILABLE") from exc
    if result.returncode != 0:
        raise RuntimeError("TERMINAL_APPROVAL_SIGNATURE_NOT_TRUSTED")


def verifier_sha256():
    return sha256_file(Path(__file__).resolve())


def verify_authority_inputs(target_path: Path, packet_path: Path, approval_path: Path, executor_path: Path):
    target_record = load_json_file(target_path, "TERMINAL_TARGET_RECORD_INVALID")
    packet = load_json_file(packet_path, "TERMINAL_APPROVED_PACKET_INVALID")
    approval = load_json_file(approval_path, "TERMINAL_APPROVAL_RECORD_INVALID")

    try:
        executor_metadata = executor_path.lstat()
    except OSError as exc:
        raise RuntimeError("TERMINAL_EXECUTOR_UNAVAILABLE") from exc
    if not stat.S_ISREG(executor_metadata.st_mode) or executor_metadata.st_nlink != 1:
        raise RuntimeError("TERMINAL_EXECUTOR_IDENTITY_INVALID")

    exact_keys(target_record, {
        "schemaVersion", "targetId", "status", "rollbackTarget",
        "rollbackTargetDigest", "replay",
    }, "TERMINAL_TARGET_RECORD_KEYS_INVALID")
    if (target_record.get("schemaVersion") != 1
            or target_record.get("targetId") != TARGET_ID
            or target_record.get("status") != "FROZEN_AWAITING_EXPLICIT_HUMAN_APPROVAL"):
        raise RuntimeError("TERMINAL_TARGET_RECORD_STATE_INVALID")

    target = target_record["rollbackTarget"]
    exact_keys(target, {
        "canonicalBranch", "authorityHead", "actionId", "operationId",
        "executorSha256", "terminalVerifierSha256", "priorUnknownAttempt",
        "activeSchema11", "preservedSchema10", "containment", "execution",
    }, "TERMINAL_TARGET_KEYS_INVALID")

    computed = rollback_target_digest(target)
    if target_record.get("rollbackTargetDigest") != computed:
        raise RuntimeError("TERMINAL_ROLLBACK_TARGET_DIGEST_MISMATCH")
    if (target.get("canonicalBranch") != CANONICAL_BRANCH
            or not COMMIT_RE.fullmatch(str(target.get("authorityHead", "")))
            or target.get("actionId") != ACTION_ID
            or target.get("operationId") != OPERATION_ID
            or not DIGEST_RE.fullmatch(str(target.get("executorSha256", "")))
            or target.get("terminalVerifierSha256") != verifier_sha256()):
        raise RuntimeError("TERMINAL_TARGET_IDENTITY_MISMATCH")
    if sha256_file(executor_path) != target["executorSha256"]:
        raise RuntimeError("TERMINAL_EXECUTOR_SHA_MISMATCH")

    expected_prior_unknown = {
        "operationId": PRIOR_UNKNOWN_OPERATION_ID,
        "packetId": PRIOR_UNKNOWN_PACKET_ID,
        "rollbackTargetDigest": PRIOR_UNKNOWN_TARGET_DIGEST,
        "attemptRecordPath": str(PRIOR_UNKNOWN_ATTEMPT),
        "attemptRecordSha256": PRIOR_UNKNOWN_ATTEMPT_SHA256,
        "terminalOutcome": "UNKNOWN",
        "terminalEvidenceDigest": PRIOR_UNKNOWN_TERMINAL_EVIDENCE_DIGEST,
        "exchangeObserved": False,
        "automaticRetryAllowed": False,
        "replayIdentityReusable": False,
        "humanReconciliationRequired": True,
    }
    expected_active = {
        "path": str(ACTIVE_DB),
        "sha256": SCHEMA11_SHA256,
        "size": SCHEMA11_SIZE,
        "device": SCHEMA11_DEVICE,
        "inode": SCHEMA11_INODE,
        "mode": "0600",
        "uid": SCHEMA11_UID,
        "gid": SCHEMA11_GID,
        "schemaVersion": 11,
        "migration11Name": MIGRATION11_NAME,
        "migration11Checksum": MIGRATION11_CHECKSUM,
    }
    expected_preserved = {
        "path": str(EXCHANGED_OUT_SCHEMA11),
        "sha256": SCHEMA10_SHA256,
        "size": SCHEMA10_SIZE,
        "device": SCHEMA10_DEVICE,
        "inode": SCHEMA10_INODE,
        "mode": "0644",
        "uid": SCHEMA10_UID,
        "gid": SCHEMA10_GID,
        "schemaVersion": 10,
        "migration11Count": 0,
    }
    expected_containment = {
        "productionServiceContainerPresent": False,
        "openDatabaseFileUsers": 0,
        "fuserDatabasePids": 0,
        "walPresent": False,
        "shmPresent": False,
        "journalPresent": False,
        "freshLiveReadOnlyVerificationRequiredImmediatelyBeforeExecution": True,
        "repositoryEvidenceMaySubstituteForLiveVerification": False,
    }
    expected_execution = {
        "entrypointId": ACTION_ID,
        "syscall": "renameat2",
        "flag": "RENAME_EXCHANGE",
        "sameFilesystemRequired": True,
        "durableOneShotRequired": True,
        "replayIdentity": "operationId+rollbackTargetDigest",
        "automaticRetryAllowed": False,
        "writerReadmissionAllowed": False,
        "productionServiceStartAllowed": False,
        "independentTerminalVerificationRequired": True,
        "authorityAdmissionBoundary": "DURABLE_ONE_SHOT_CLAIM",
        "canonicalHeadMustMatchApprovedTargetImmediatelyBeforeClaim": True,
        "freshCanonicalHeadVerificationRequiredImmediatelyBeforeClaim": True,
        "postCanonicalPreClaimLocalRevalidationRequired": True,
        "postCanonicalExternalDependencyAllowed": False,
        "postClaimCanonicalVerificationAllowed": False,
        "postClaimNetworkDependencyAllowed": False,
    }
    if (target.get("priorUnknownAttempt") != expected_prior_unknown
            or target.get("activeSchema11") != expected_active
            or target.get("preservedSchema10") != expected_preserved
            or target.get("containment") != expected_containment
            or target.get("execution") != expected_execution):
        raise RuntimeError("TERMINAL_TARGET_SCOPE_MISMATCH")

    exact_keys(target_record["replay"], {
        "operationId", "identity", "packetIdPartitionsReplayIdentity", "automaticRetryAllowed",
    }, "TERMINAL_REPLAY_KEYS_INVALID")
    if target_record["replay"] != {
        "operationId": OPERATION_ID,
        "identity": "operationId+rollbackTargetDigest",
        "packetIdPartitionsReplayIdentity": False,
        "automaticRetryAllowed": False,
    }:
        raise RuntimeError("TERMINAL_REPLAY_CONTRACT_MISMATCH")

    exact_keys(packet, {
        "schemaVersion", "packetId", "contractId", "rollbackTarget",
        "rollbackTargetDigest", "authorization",
    }, "TERMINAL_PACKET_KEYS_INVALID")
    if (packet.get("schemaVersion") != 1
            or packet.get("packetId") != PACKET_ID
            or packet.get("contractId") != CONTRACT_ID
            or packet.get("rollbackTarget") != target
            or packet.get("rollbackTargetDigest") != computed):
        raise RuntimeError("TERMINAL_PACKET_TARGET_MISMATCH")
    authorization = packet.get("authorization")
    exact_keys(authorization, {
        "status", "humanApprovalRequired", "approvalRef",
        "approvedRollbackTargetDigest", "approvalEvidenceDigest",
    }, "TERMINAL_PACKET_AUTHORIZATION_KEYS_INVALID")
    if (authorization.get("status") != "APPROVED"
            or authorization.get("humanApprovalRequired") is not True
            or authorization.get("approvedRollbackTargetDigest") != computed
            or not isinstance(authorization.get("approvalRef"), str)
            or not authorization.get("approvalRef")
            or not DIGEST_RE.fullmatch(str(authorization.get("approvalEvidenceDigest", "")))):
        raise RuntimeError("TERMINAL_PACKET_NOT_APPROVED")

    exact_keys(approval, {
        "schemaVersion", "approvalId", "approvalSource", "approvalRef",
        "approvedActionId", "approvedRollbackTargetDigest", "approvalEvidenceDigest",
        "authorizationReceivedBeforeExecution", "rollbackAuthorized",
        "writerReadmissionAuthorized", "productionServiceStartAuthorized",
        "signatureAlgorithm", "signingKeyId", "signatureBase64",
    }, "TERMINAL_APPROVAL_KEYS_INVALID")
    if (approval.get("schemaVersion") != 1
            or approval.get("approvalSource") != APPROVAL_SOURCE
            or approval.get("approvalRef") != authorization.get("approvalRef")
            or approval.get("approvedActionId") != ACTION_ID
            or approval.get("approvedRollbackTargetDigest") != computed
            or approval.get("authorizationReceivedBeforeExecution") is not True
            or approval.get("rollbackAuthorized") is not True
            or approval.get("writerReadmissionAuthorized") is not False
            or approval.get("productionServiceStartAuthorized") is not False
            or approval.get("signatureAlgorithm") != APPROVAL_SIGNATURE_ALGORITHM
            or approval.get("signingKeyId") != APPROVAL_SIGNING_KEY_ID
            or not isinstance(approval.get("signatureBase64"), str)):
        raise RuntimeError("TERMINAL_APPROVAL_RECORD_NOT_TRUSTED")

    approval_core = {
        "schemaVersion": approval["schemaVersion"],
        "approvalId": approval["approvalId"],
        "approvalSource": approval["approvalSource"],
        "approvalRef": approval["approvalRef"],
        "approvedActionId": approval["approvedActionId"],
        "approvedRollbackTargetDigest": approval["approvedRollbackTargetDigest"],
        "authorizationReceivedBeforeExecution": approval["authorizationReceivedBeforeExecution"],
        "rollbackAuthorized": approval["rollbackAuthorized"],
        "writerReadmissionAuthorized": approval["writerReadmissionAuthorized"],
        "productionServiceStartAuthorized": approval["productionServiceStartAuthorized"],
        "signatureAlgorithm": approval["signatureAlgorithm"],
        "signingKeyId": approval["signingKeyId"],
    }
    payload = canonical_json({
        "domain": "g3-authority-binding-reconciliation-rollback-recovery-approval-v1",
        "approval": approval_core,
    }).encode("utf-8")
    evidence_digest = "sha256:" + hashlib.sha256(payload).hexdigest()
    if (approval.get("approvalEvidenceDigest") != evidence_digest
            or authorization.get("approvalEvidenceDigest") != evidence_digest):
        raise RuntimeError("TERMINAL_APPROVAL_EVIDENCE_DIGEST_MISMATCH")
    verify_approval_signature(payload, approval["signatureBase64"])
    return target, packet, approval, computed


def read_instance_id():
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(INSTANCE_ID_URL, timeout=2) as response:
            value = response.read(256).decode("utf-8").strip()
    except Exception as exc:
        raise RuntimeError("TERMINAL_INSTANCE_METADATA_UNAVAILABLE") from exc
    if value != EXPECTED_INSTANCE_ID:
        raise RuntimeError("TERMINAL_INSTANCE_ID_MISMATCH")
    return value


def docker_json(args):
    return subprocess.check_output(["docker", *args], text=True).strip()


def verify_physical_target():
    if os.geteuid() != 0:
        raise RuntimeError("TERMINAL_ROOT_EXECUTION_REQUIRED")
    if socket.gethostname() != EXPECTED_HOSTNAME:
        raise RuntimeError("TERMINAL_HOSTNAME_MISMATCH")
    read_instance_id()
    mountpoint = docker_json(["volume", "inspect", VOLUME_NAME, "--format", "{{.Mountpoint}}"])
    if Path(mountpoint) != EXPECTED_VOLUME_MOUNTPOINT:
        raise RuntimeError("TERMINAL_VOLUME_MOUNTPOINT_MISMATCH")
    fs = subprocess.check_output(
        ["findmnt", "-n", "-o", "SOURCE,FSTYPE", "-T", str(ACTIVE_DB)],
        text=True,
    ).split()
    if fs[:2] != [EXPECTED_FILESYSTEM_SOURCE, EXPECTED_FILESYSTEM_TYPE]:
        raise RuntimeError("TERMINAL_FILESYSTEM_BINDING_MISMATCH")


def verify_production_service_absent():
    result = subprocess.run(
        ["docker", "inspect", "jenn-shooting-operations-prod"],
        text=True, capture_output=True,
    )
    if result.returncode == 0:
        raise RuntimeError("TERMINAL_PRODUCTION_SERVICE_CONTAINER_PRESENT")
    units = subprocess.check_output(
        ["systemctl", "list-unit-files", "--type=service", "--no-legend"],
        text=True,
    ).lower()
    if "jenn-shooting" in units or "shooting-operations" in units:
        raise RuntimeError("TERMINAL_PRODUCTION_SERVICE_UNIT_PRESENT")
def _mountinfo_unescape(value):
    return re.sub(r"\\([0-7]{3})", lambda match: chr(int(match.group(1), 8)), value)


def parse_mountinfo(text):
    entries = []
    for raw in text.splitlines():
        if not raw.strip():
            continue
        fields = raw.split()
        try:
            separator = fields.index("-")
        except ValueError as exc:
            raise RuntimeError("TERMINAL_MOUNTINFO_INVALID") from exc
        if separator < 6:
            raise RuntimeError("TERMINAL_MOUNTINFO_INVALID")
        root = Path(_mountinfo_unescape(fields[3]))
        mountpoint = Path(_mountinfo_unescape(fields[4]))
        if not mountpoint.is_absolute():
            raise RuntimeError("TERMINAL_MOUNTINFO_INVALID")
        if not root.is_absolute():
            continue
        entries.append({
            "majorMinor": fields[2],
            "root": root,
            "mountpoint": mountpoint,
        })
    if not entries:
        raise RuntimeError("TERMINAL_MOUNTINFO_EMPTY")
    return entries


def _path_within(path, parent):
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def mount_identity_for_path(path, mountinfo_text):
    resolved = Path(path).resolve(strict=False)
    candidates = [
        entry for entry in parse_mountinfo(mountinfo_text)
        if _path_within(resolved, entry["mountpoint"])
    ]
    if not candidates:
        raise RuntimeError("TERMINAL_MOUNTINFO_PATH_UNMAPPED")
    entry = max(candidates, key=lambda item: len(item["mountpoint"].parts))
    relative = resolved.relative_to(entry["mountpoint"])
    return entry["majorMinor"], entry["root"].joinpath(relative)


def docker_daemon_mountinfo_text():
    pids = subprocess.check_output(["pgrep", "-x", "dockerd"], text=True).split()
    if len(pids) != 1 or not pids[0].isdigit():
        raise RuntimeError("TERMINAL_DOCKER_DAEMON_IDENTITY_UNAVAILABLE")
    try:
        return Path(f"/proc/{pids[0]}/mountinfo").read_text()
    except OSError as exc:
        raise RuntimeError("TERMINAL_DOCKER_MOUNTINFO_UNAVAILABLE") from exc


def mountinfo_can_access_filesystem_path(mountinfo_text, db_device, db_fs_path):
    for entry in parse_mountinfo(mountinfo_text):
        if entry["majorMinor"] == db_device           and (entry["root"] == db_fs_path or entry["root"] in db_fs_path.parents):
            return True
    return False


def verify_no_running_volume_users():
    ids = subprocess.check_output(["docker", "ps", "-q"], text=True).split()
    daemon_mountinfo = docker_daemon_mountinfo_text()
    db_device, db_fs_path = mount_identity_for_path(ACTIVE_DB, daemon_mountinfo)
    users = []
    for cid in ids:
        mounts = json.loads(docker_json(["inspect", cid, "--format", "{{json .Mounts}}"]))
        if any(mount.get("Name") == VOLUME_NAME for mount in mounts):
            users.append(cid)
            continue
        pid = docker_json(["inspect", cid, "--format", "{{.State.Pid}}"])
        if not pid.isdigit() or int(pid) <= 0:
            raise RuntimeError("TERMINAL_DOCKER_CONTAINER_PID_INVALID")
        try:
            container_mountinfo = Path(f"/proc/{pid}/mountinfo").read_text()
        except OSError as exc:
            raise RuntimeError("TERMINAL_DOCKER_CONTAINER_MOUNTINFO_UNAVAILABLE") from exc
        if mountinfo_can_access_filesystem_path(container_mountinfo, db_device, db_fs_path):
            users.append(cid)
    if users:
        raise RuntimeError("TERMINAL_RUNNING_VOLUME_USERS:" + ",".join(users))


def verify_no_open_db_users(allowed_pids=None):
    if shutil.which("lsof") is None or shutil.which("fuser") is None:
        raise RuntimeError("TERMINAL_OPEN_USER_VERIFIER_UNAVAILABLE")
    allowed = set(allowed_pids or ())
    for path in (ACTIVE_DB, EXCHANGED_OUT_SCHEMA11):
        lsof = subprocess.run(["lsof", "-t", "--", str(path)], text=True, capture_output=True)
        if lsof.returncode not in (0, 1):
            raise RuntimeError("TERMINAL_LSOF_FAILED")
        lsof_pids = {int(value) for value in lsof.stdout.split() if value.isdigit()}
        if lsof_pids - allowed:
            raise RuntimeError("TERMINAL_OPEN_DATABASE_USERS")

        fuser = subprocess.run(["fuser", str(path)], text=True, capture_output=True)
        if fuser.returncode not in (0, 1):
            raise RuntimeError("TERMINAL_FUSER_FAILED")
        # procps fuser emits the PID list on stdout and filename labels on
        # stderr. Parse stdout only: our database paths contain numeric date
        # components that must never be mistaken for PIDs.
        fuser_pids = {
            int(value) for value in re.findall(r"(?<![A-Za-z0-9_])(\d+)(?![A-Za-z0-9_])",
                                               fuser.stdout)
        }
        if fuser_pids - allowed:
            raise RuntimeError("TERMINAL_FUSER_DATABASE_USERS")

def verify_no_sidecars(path):
    for suffix in ("-wal", "-shm", "-journal"):
        if path.with_name(path.name + suffix).exists():
            raise RuntimeError("TERMINAL_SQLITE_SIDECAR_PRESENT")


def open_pinned_regular_file(path, code):
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise RuntimeError(code) from exc
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise RuntimeError(code)
        return fd
    except Exception:
        os.close(fd)
        raise


def sha256_fd(fd):
    digest = hashlib.sha256()
    dup = os.dup(fd)
    try:
        os.lseek(dup, 0, os.SEEK_SET)
        while True:
            chunk = os.read(dup, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    finally:
        os.close(dup)
    return "sha256:" + digest.hexdigest()


def file_identity_fd(fd, path):
    metadata = os.fstat(fd)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise RuntimeError("TERMINAL_FILE_IDENTITY_INVALID")
    return {
        "path": str(path),
        "sha256": sha256_fd(fd),
        "size": metadata.st_size,
        "device": metadata.st_dev,
        "inode": metadata.st_ino,
        "mode": format(stat.S_IMODE(metadata.st_mode), "04o"),
        "uid": metadata.st_uid,
        "gid": metadata.st_gid,
    }


def inspect_db_fd(fd):
    proc_path = f"/proc/self/fd/{fd}"
    con = sqlite3.connect(f"file:{proc_path}?mode=ro&immutable=1", uri=True)
    try:
        rows = con.execute("SELECT version,name,checksum FROM schema_migrations ORDER BY version").fetchall()
        integrity = con.execute("PRAGMA integrity_check").fetchall()
        fk = con.execute("PRAGMA foreign_key_check").fetchall()
        journal = con.execute("PRAGMA journal_mode").fetchone()[0]
        return {
            "count": len(rows),
            "maxVersion": max(row[0] for row in rows),
            "migration11Count": sum(1 for row in rows if row[0] == 11),
            "last": list(rows[-1]),
            "integrity": integrity[0][0] if len(integrity) == 1 else None,
            "fkViolations": len(fk),
            "journalMode": journal,
        }
    finally:
        con.close()


def revalidate_pinned_path(path, fd, expected_identity):
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        current_fd = os.open(path, flags)
    except OSError as exc:
        raise RuntimeError("TERMINAL_SNAPSHOT_UNSTABLE") from exc
    try:
        pinned = os.fstat(fd)
        current = os.fstat(current_fd)
        if not stat.S_ISREG(current.st_mode) or current.st_nlink != 1:
            raise RuntimeError("TERMINAL_SNAPSHOT_UNSTABLE")
        if (current.st_dev, current.st_ino) != (pinned.st_dev, pinned.st_ino):
            raise RuntimeError("TERMINAL_SNAPSHOT_UNSTABLE")
        if file_identity_fd(fd, path) != expected_identity:
            raise RuntimeError("TERMINAL_SNAPSHOT_UNSTABLE")
        if sha256_fd(current_fd) != expected_identity["sha256"]:
            raise RuntimeError("TERMINAL_SNAPSHOT_UNSTABLE")
    finally:
        os.close(current_fd)


def inspect_db(path):
    fd = open_pinned_regular_file(path, "TERMINAL_FILE_IDENTITY_INVALID")
    try:
        return inspect_db_fd(fd)
    finally:
        os.close(fd)

def expected_attempt_path(target_digest):
    replay = hashlib.sha256(f"{OPERATION_ID}\n{target_digest}".encode("utf-8")).hexdigest()
    return CONTROL_ROOT / "attempts" / f"{replay}.json"


def verify_root_controlled_directory(path):
    metadata = path.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or path.is_symlink():
        raise RuntimeError("TERMINAL_ATTEMPT_DIRECTORY_IDENTITY_INVALID")
    if metadata.st_uid != 0 or metadata.st_gid != 0 or stat.S_IMODE(metadata.st_mode) & 0o022:
        raise RuntimeError("TERMINAL_ATTEMPT_DIRECTORY_NOT_ROOT_CONTROLLED")
    return metadata


def verify_attempt_record(target_digest, authority_head):
    path = expected_attempt_path(target_digest)
    chain = [
        Path("/mnt/datadisk0"),
        CONTROL_ROOT.parent,
        CONTROL_ROOT,
        CONTROL_ROOT / "attempts",
    ]
    for directory in chain:
        verify_root_controlled_directory(directory)

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except FileNotFoundError as exc:
        raise RuntimeError("TERMINAL_ATTEMPT_NOT_FOUND") from exc
    except OSError as exc:
        raise RuntimeError("TERMINAL_ATTEMPT_RECORD_IDENTITY_INVALID") from exc
    try:
        metadata = os.fstat(fd)
        if (not stat.S_ISREG(metadata.st_mode)
                or metadata.st_nlink != 1
                or metadata.st_uid != 0
                or metadata.st_gid != 0
                or stat.S_IMODE(metadata.st_mode) != 0o600):
            raise RuntimeError("TERMINAL_ATTEMPT_RECORD_IDENTITY_INVALID")
        chunks = []
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        raw = b"".join(chunks)
        try:
            record = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("TERMINAL_ATTEMPT_RECORD_INVALID") from exc
        exact_keys(record, {
            "packetId", "operationId", "rollbackTargetDigest",
            "authorityHeadAtAdmission", "claimedAt",
        }, "TERMINAL_ATTEMPT_RECORD_KEYS_INVALID")
        if (record.get("packetId") != PACKET_ID
                or record.get("operationId") != OPERATION_ID
                or record.get("rollbackTargetDigest") != target_digest
                or record.get("authorityHeadAtAdmission") != authority_head
                or not isinstance(record.get("claimedAt"), str)):
            raise RuntimeError("TERMINAL_ATTEMPT_RECORD_MISMATCH")
        try:
            datetime.fromisoformat(record["claimedAt"].replace("Z", "+00:00"))
        except ValueError as exc:
            raise RuntimeError("TERMINAL_ATTEMPT_RECORD_MISMATCH") from exc
        return {
            "path": str(path),
            "sha256": "sha256:" + hashlib.sha256(raw).hexdigest(),
            "size": metadata.st_size,
            "mode": "0600",
            "uid": metadata.st_uid,
            "gid": metadata.st_gid,
            "record": record,
        }
    finally:
        os.close(fd)


def verify_terminal_containment(allowed_pids):
    verify_production_service_absent()
    verify_no_sidecars(ACTIVE_DB)
    verify_no_sidecars(EXCHANGED_OUT_SCHEMA11)
    verify_no_running_volume_users()
    verify_no_open_db_users(allowed_pids=allowed_pids)


def observe_terminal_snapshot(attempt, active_fd, exchanged_fd, target):
    verify_physical_target()

    allowed_pids = {os.getpid()}
    verify_terminal_containment(allowed_pids)

    active = file_identity_fd(active_fd, ACTIVE_DB)
    exchanged = file_identity_fd(exchanged_fd, EXCHANGED_OUT_SCHEMA11)
    if active["device"] != exchanged["device"]:
        raise RuntimeError("TERMINAL_NOT_SAME_FILESYSTEM")
    active_db = inspect_db_fd(active_fd)
    exchanged_db = inspect_db_fd(exchanged_fd)

    # Independent second sample, still through pinned descriptors.
    verify_terminal_containment(allowed_pids)
    revalidate_pinned_path(ACTIVE_DB, active_fd, active)
    revalidate_pinned_path(EXCHANGED_OUT_SCHEMA11, exchanged_fd, exchanged)
    active_second = file_identity_fd(active_fd, ACTIVE_DB)
    exchanged_second = file_identity_fd(exchanged_fd, EXCHANGED_OUT_SCHEMA11)
    active_db_second = inspect_db_fd(active_fd)
    exchanged_db_second = inspect_db_fd(exchanged_fd)
    if (active_second != active or exchanged_second != exchanged
            or active_db_second != active_db or exchanged_db_second != exchanged_db):
        raise RuntimeError("TERMINAL_SNAPSHOT_UNSTABLE")

    # One final local containment/path/hash pass closes the classification
    # window without introducing a remote authority dependency after admission.
    verify_terminal_containment(allowed_pids)
    revalidate_pinned_path(ACTIVE_DB, active_fd, active)
    revalidate_pinned_path(EXCHANGED_OUT_SCHEMA11, exchanged_fd, exchanged)

    snapshot = {
        "stableAcrossIndependentSamples": True,
        "authorityAdmission": {
            "branch": target["canonicalBranch"],
            "head": target["authorityHead"],
            "claimedAt": attempt["record"]["claimedAt"],
            "source": "DURABLE_RECOVERY_CLAIM",
        },
        "host": {
            "hostname": socket.gethostname(),
            "instanceId": EXPECTED_INSTANCE_ID,
            "filesystemSource": EXPECTED_FILESYSTEM_SOURCE,
            "filesystemType": EXPECTED_FILESYSTEM_TYPE,
        },
        "activeDatabase": {
            **active,
            "schema": active_db,
            "walPresent": False,
            "shmPresent": False,
            "journalPresent": False,
        },
        "exchangedOutDatabase": {
            **exchanged,
            "schema": exchanged_db,
            "walPresent": False,
            "shmPresent": False,
            "journalPresent": False,
        },
        "attempt": attempt,
        "containment": {
            "productionServiceContainerPresent": False,
            "runningContainersWithDatabaseAccess": 0,
            "openDatabaseFileUsers": 0,
            "fuserDatabasePids": 0,
            "normalWritesDisabledAtClassification": True,
            "authoritativeWriteCapabilityAbsent": True,
            "writerReadmissionAuthorized": False,
            "productionServiceStartAuthorized": False,
            "automaticRetryAllowed": False,
        },
    }
    return snapshot


def rolled_back_snapshot_matches(snapshot):
    active = snapshot["activeDatabase"]
    exchanged = snapshot["exchangedOutDatabase"]
    a_schema = active["schema"]
    e_schema = exchanged["schema"]

    active_expected = {
        "path": str(ACTIVE_DB),
        "sha256": SCHEMA10_SHA256,
        "size": SCHEMA10_SIZE,
        "device": SCHEMA10_DEVICE,
        "inode": SCHEMA10_INODE,
        "mode": "0644",
        "uid": SCHEMA10_UID,
        "gid": SCHEMA10_GID,
    }
    exchanged_expected = {
        "path": str(EXCHANGED_OUT_SCHEMA11),
        "sha256": SCHEMA11_SHA256,
        "size": SCHEMA11_SIZE,
        "device": SCHEMA11_DEVICE,
        "inode": SCHEMA11_INODE,
        "mode": "0600",
        "uid": SCHEMA11_UID,
        "gid": SCHEMA11_GID,
    }
    active_identity = {key: active[key] for key in active_expected}
    exchanged_identity = {key: exchanged[key] for key in exchanged_expected}
    if active_identity != active_expected or exchanged_identity != exchanged_expected:
        return False

    if not (
        a_schema["count"] == 10
        and a_schema["maxVersion"] == 10
        and a_schema["migration11Count"] == 0
        and a_schema["integrity"] == "ok"
        and a_schema["fkViolations"] == 0
        and a_schema["journalMode"] == "delete"
    ):
        return False
    if not (
        e_schema["count"] == 11
        and e_schema["maxVersion"] == 11
        and e_schema["migration11Count"] == 1
        and e_schema["last"][1] == MIGRATION11_NAME
        and e_schema["last"][2] == MIGRATION11_CHECKSUM
        and e_schema["integrity"] == "ok"
        and e_schema["fkViolations"] == 0
        and e_schema["journalMode"] == "delete"
    ):
        return False
    return True
def build_terminal_result(snapshot, classified_at, target_digest):
    evidence_digest = canonical_digest({
        "domain": "g3-authority-binding-reconciliation-rollback-recovery-terminal-evidence-v1",
        "terminalEvidence": snapshot,
    })
    if rolled_back_snapshot_matches(snapshot):
        outcome = "ROLLED_BACK"
        evidence = {
            "restoredPrestateDigest": SCHEMA10_SHA256,
            "restorationVerificationDigest": evidence_digest,
            "integrityCheck": "ok",
            "foreignKeyViolationCount": 0,
            "authoritativeWriteCapabilityAbsent": True,
            "normalWritesDisabledAtClassification": True,
        }
    else:
        outcome = "UNKNOWN"
        evidence = {
            "ambiguityEvidenceDigest": evidence_digest,
            "authoritativeWriteCapabilityAbsent": True,
            "normalWritesDisabledAtClassification": True,
            "reconciliationRequired": True,
            "freshReadmissionEvidenceRequired": True,
            "automaticRetryAllowed": False,
        }

    receipt = {
        "schemaVersion": 1,
        "receiptId": "G3R-AUTH-RECON-ROLLBACK-RECOVERY-20261007-R1",
        "contractId": CONTRACT_ID,
        "packetId": PACKET_ID,
        "operationId": OPERATION_ID,
        "rollbackTargetDigest": target_digest,
        "classifiedAt": classified_at,
        "outcome": outcome,
        "evidence": evidence,
    }
    return {
        "status": "G3_AUTH_RECON_ROLLBACK_RECOVERY_TERMINAL_VERIFICATION_COMPLETE",
        "outcome": outcome,
        "terminalEvidenceDigest": evidence_digest,
        "terminalEvidence": snapshot,
        "receipt": receipt,
        "writerReadmissionAuthorized": False,
        "productionServiceStartAuthorized": False,
        "automaticRetryAllowed": False,
    }


def verify(target_record, approved_packet, approval_record, executor):
    target, _, _, target_digest = verify_authority_inputs(
        target_record, approved_packet, approval_record, executor,
    )
    attempt = verify_attempt_record(target_digest, target["authorityHead"])

    active_fd = open_pinned_regular_file(
        ACTIVE_DB, "TERMINAL_ACTIVE_DATABASE_PIN_FAILED",
    )
    try:
        exchanged_fd = open_pinned_regular_file(
            EXCHANGED_OUT_SCHEMA11, "TERMINAL_EXCHANGED_DATABASE_PIN_FAILED",
        )
    except Exception:
        os.close(active_fd)
        raise

    try:
        try:
            snapshot = observe_terminal_snapshot(attempt, active_fd, exchanged_fd, target)
        except Exception as exc:
            return {
                "status": "G3_AUTH_RECON_ROLLBACK_RECOVERY_TERMINAL_EVIDENCE_UNAVAILABLE",
                "outcome": "UNKNOWN",
                "receiptGenerated": False,
                "reconciliationRequired": True,
                "freshReadmissionEvidenceRequired": True,
                "automaticRetryAllowed": False,
                "writerReadmissionAuthorized": False,
                "productionServiceStartAuthorized": False,
                "errorClass": type(exc).__name__,
                "error": str(exc),
            }

        # Keep both immutable evidence descriptors pinned until classification
        # and receipt assembly are complete.
        classified_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        return build_terminal_result(snapshot, classified_at, target_digest)
    finally:
        os.close(exchanged_fd)
        os.close(active_fd)


def self_test_classification():
    base = {
        "stableAcrossIndependentSamples": True,
        "canonicalAuthority": {"branch": CANONICAL_BRANCH, "head": "a" * 40},
        "host": {
            "hostname": EXPECTED_HOSTNAME,
            "instanceId": EXPECTED_INSTANCE_ID,
            "filesystemSource": EXPECTED_FILESYSTEM_SOURCE,
            "filesystemType": EXPECTED_FILESYSTEM_TYPE,
        },
        "activeDatabase": {
            "path": str(ACTIVE_DB), "sha256": SCHEMA10_SHA256, "size": SCHEMA10_SIZE,
            "device": SCHEMA10_DEVICE, "inode": SCHEMA10_INODE, "mode": "0644",
            "uid": SCHEMA10_UID, "gid": SCHEMA10_GID,
            "schema": {
                "count": 10, "maxVersion": 10, "migration11Count": 0,
                "last": [10, "empty_db_maintenance_receipts",
                         "sha256:992f3dee7f23780f407b5f1445413e3d801dcab0bafe8fdac29ee4730e3243aa"],
                "integrity": "ok", "fkViolations": 0, "journalMode": "delete",
            },
            "walPresent": False, "shmPresent": False, "journalPresent": False,
        },
        "exchangedOutDatabase": {
            "path": str(EXCHANGED_OUT_SCHEMA11), "sha256": SCHEMA11_SHA256, "size": SCHEMA11_SIZE,
            "device": SCHEMA11_DEVICE, "inode": SCHEMA11_INODE, "mode": "0600",
            "uid": SCHEMA11_UID, "gid": SCHEMA11_GID,
            "schema": {
                "count": 11, "maxVersion": 11, "migration11Count": 1,
                "last": [11, MIGRATION11_NAME, MIGRATION11_CHECKSUM],
                "integrity": "ok", "fkViolations": 0, "journalMode": "delete",
            },
            "walPresent": False, "shmPresent": False, "journalPresent": False,
        },
        "attempt": {
            "path": str(expected_attempt_path("sha256:" + "a" * 64)),
            "sha256": "sha256:" + "a" * 64,
            "size": 256,
            "mode": "0600",
            "record": {
                "packetId": PACKET_ID,
                "operationId": OPERATION_ID,
                "rollbackTargetDigest": "sha256:" + "a" * 64,
            },
        },
        "containment": {
            "productionServiceContainerPresent": False,
            "runningContainersWithDatabaseAccess": 0,
            "openDatabaseFileUsers": 0,
            "fuserDatabasePids": 0,
            "normalWritesDisabledAtClassification": True,
            "authoritativeWriteCapabilityAbsent": True,
            "writerReadmissionAuthorized": False,
            "productionServiceStartAuthorized": False,
            "automaticRetryAllowed": False,
        },
    }
    rolled = build_terminal_result(base, "2026-10-07T12:00:00Z", "sha256:" + "a" * 64)
    if rolled["outcome"] != "ROLLED_BACK":
        raise RuntimeError("TERMINAL_CLASSIFICATION_SELF_TEST_FAILED")

    changed = json.loads(json.dumps(base))
    changed["activeDatabase"]["sha256"] = SCHEMA11_SHA256
    unknown = build_terminal_result(changed, "2026-10-07T12:00:00Z", "sha256:" + "a" * 64)
    if unknown["outcome"] != "UNKNOWN"       or unknown["receipt"]["evidence"]["automaticRetryAllowed"] is not False:
        raise RuntimeError("TERMINAL_CLASSIFICATION_SELF_TEST_FAILED")
    print(json.dumps({"status": "G3_AUTH_RECON_ROLLBACK_RECOVERY_TERMINAL_CLASSIFICATION_SELF_TEST_PASS"}))


def self_test_approval_signature():
    message = b"G3_APPROVAL_SIGNATURE_SELF_TEST_V1\n"
    signature = "9jiqxI3bnc4FPzxhipF4NCqNGE+tbaA6hGfMzSTW+sOqNOKD32s8VwSnlaG+Y/HwVs7/adS2ceTK1QOfYpuZCA=="
    verify_approval_signature(message, signature)
    print(json.dumps({
        "status": "G3_AUTH_RECON_ROLLBACK_RECOVERY_TERMINAL_APPROVAL_SELF_TEST_PASS",
        "signingKeyId": APPROVAL_SIGNING_KEY_ID,
    }, sort_keys=True))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--target-record")
    parser.add_argument("--approved-packet")
    parser.add_argument("--approval-record")
    parser.add_argument("--executor")
    parser.add_argument("--self-test-classification", action="store_true")
    parser.add_argument("--self-test-approval-signature", action="store_true")
    args = parser.parse_args()

    self_tests = [args.self_test_classification, args.self_test_approval_signature]
    if any(self_tests):
        if args.verify or args.target_record or args.approved_packet or args.approval_record or args.executor           or sum(bool(value) for value in self_tests) != 1:
            raise SystemExit("self-test must be isolated")
        if args.self_test_classification:
            self_test_classification()
        else:
            self_test_approval_signature()
        return

    if not args.verify:
        raise SystemExit("--verify required")
    missing = [
        name for name, value in (
            ("--target-record", args.target_record),
            ("--approved-packet", args.approved_packet),
            ("--approval-record", args.approval_record),
            ("--executor", args.executor),
        ) if not value
    ]
    if missing:
        raise SystemExit("missing required arguments: " + ", ".join(missing))

    try:
        result = verify(
            Path(args.target_record),
            Path(args.approved_packet),
            Path(args.approval_record),
            Path(args.executor),
        )
        print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    except Exception as exc:
        error = str(exc)
        if error == "TERMINAL_ATTEMPT_NOT_FOUND":
            print(json.dumps({
                "status": "G3_AUTH_RECON_ROLLBACK_RECOVERY_TERMINAL_NOT_STARTED",
                "rollbackAttemptStarted": False,
                "receiptGenerated": False,
                "error": error,
            }, sort_keys=True, separators=(",", ":")))
        else:
            print(json.dumps({
                "status": "G3_AUTH_RECON_ROLLBACK_RECOVERY_TERMINAL_INPUT_VALIDATION_FAILED_CLOSED",
                "receiptGenerated": False,
                "reconciliationRequired": True,
                "automaticRetryAllowed": False,
                "writerReadmissionAuthorized": False,
                "productionServiceStartAuthorized": False,
                "errorClass": type(exc).__name__,
                "error": error,
            }, sort_keys=True, separators=(",", ":")))
        raise


if __name__ == "__main__":
    main()
