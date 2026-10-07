#!/usr/bin/env python3
import argparse
import base64
import ctypes
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
PRESERVED_SCHEMA10 = Path("/mnt/datadisk0/g3-schema11-cutover/G3-SCHEMA11-OP-20261006-R1/candidate.sqlite")
VOLUME_NAME = "jenn-shooting-operations_shooting_data"
EXPECTED_VOLUME_MOUNTPOINT = Path("/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data")
CONTROL_ROOT = Path("/mnt/datadisk0/g3-authority-binding-reconciliation/rollback")
EXPECTED_HOSTNAME = "VM-0-12-ubuntu"
EXPECTED_INSTANCE_ID = "ins-mi85f3my"
INSTANCE_ID_URL = "http://169.254.0.23/latest/meta-data/instance-id"
EXPECTED_FILESYSTEM_SOURCE = "/dev/vdb"
EXPECTED_FILESYSTEM_TYPE = "ext4"
CANONICAL_BRANCH = "codex/v2-1-architecture-freeze"
CANONICAL_REPO_URL = "https://github.com/JENN2046/jenn-shooting-operations.git"

EXPECTED_ACTIVE_SCHEMA11_SHA256 = "0eae48b85f362cf1064f92e14511865fe7fd68dbc13a85d4c6efd6e656e736d9"
EXPECTED_ACTIVE_SIZE = 540672
EXPECTED_ACTIVE_DEVICE = 64784
EXPECTED_ACTIVE_INODE = 2229903
EXPECTED_ACTIVE_MODE = 0o600
EXPECTED_ACTIVE_UID = 1000
EXPECTED_ACTIVE_GID = 1000

EXPECTED_SCHEMA10_SHA256 = "5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7"
EXPECTED_SCHEMA10_SIZE = 512000
EXPECTED_SCHEMA10_DEVICE = 64784
EXPECTED_SCHEMA10_INODE = 1835048
EXPECTED_SCHEMA10_MODE = 0o644
EXPECTED_SCHEMA10_UID = 1000
EXPECTED_SCHEMA10_GID = 1000

MIGRATION11_NAME = "business_calendar_and_reschedule"
MIGRATION11_CHECKSUM = "sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8"

ACTION_ID = "G3_AUTHORITY_BINDING_RECONCILIATION_ROLLBACK_TO_10"
OPERATION_ID = "G3-AUTH-RECON-ROLLBACK-20261007-R1"
PACKET_ID = "G3-AUTH-RECON-ROLLBACK-PACKET-20261007-R1"
CONTRACT_ID = "G3_AUTHORITY_BINDING_RECONCILIATION_ROLLBACK_V1"

APPROVAL_SOURCE = "EXPLICIT_HUMAN_CHAT_AUTHORIZATION"
APPROVAL_SIGNATURE_ALGORITHM = "Ed25519"
APPROVAL_SIGNING_KEY_ID = "sha256:0d9c964a35c05842b5aafbe261fb5e020427ad5c635357e6955201da56100bae"
APPROVAL_PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAO6+9DSKWYrwyEC20zFe1GPdeTEYggybpXBrxDib5Koo=
-----END PUBLIC KEY-----
"""

DIGEST_RE = re.compile(r"^sha256:[a-f0-9]{64}$")
COMMIT_RE = re.compile(r"^[a-f0-9]{40}$")
RENAME_EXCHANGE = 2
AT_FDCWD = -100


def canonical_json(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        if isinstance(value, float) and not (value == value and abs(value) != float("inf")):
            raise RuntimeError("ROLLBACK_CANONICAL_JSON_INVALID")
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        if any(not isinstance(key, str) or key in {"__proto__", "constructor", "prototype"} for key in value):
            raise RuntimeError("ROLLBACK_CANONICAL_JSON_INVALID")
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False) + ":" + canonical_json(value[key])
            for key in sorted(value)
        ) + "}"
    raise RuntimeError("ROLLBACK_CANONICAL_JSON_INVALID")


def canonical_digest(value):
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def rollback_target_digest(target):
    return canonical_digest({
        "domain": "g3-authority-binding-reconciliation-rollback-target-v1",
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
    return digest.hexdigest()


def fsync_dir(path: Path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


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
        raise RuntimeError("ROLLBACK_APPROVAL_SIGNATURE_INVALID") from exc
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
            raise RuntimeError("ROLLBACK_APPROVAL_SIGNATURE_VERIFIER_UNAVAILABLE") from exc
    if result.returncode != 0:
        raise RuntimeError("ROLLBACK_APPROVAL_SIGNATURE_NOT_TRUSTED")


def executor_sha256():
    return "sha256:" + sha256_file(Path(__file__).resolve())


def verify_approved_authority(packet_path: Path, approval_path: Path, target_record_path: Path):
    target_record = load_json_file(target_record_path, "ROLLBACK_TARGET_RECORD_INVALID")
    packet = load_json_file(packet_path, "ROLLBACK_APPROVED_PACKET_INVALID")
    approval = load_json_file(approval_path, "ROLLBACK_APPROVAL_RECORD_INVALID")

    exact_keys(target_record, {
        "schemaVersion", "targetId", "status", "rollbackTarget",
        "rollbackTargetDigest", "replay",
    }, "ROLLBACK_TARGET_RECORD_KEYS_INVALID")
    if target_record.get("schemaVersion") != 1       or target_record.get("status") != "FROZEN_AWAITING_EXPLICIT_HUMAN_APPROVAL":
        raise RuntimeError("ROLLBACK_TARGET_RECORD_STATE_INVALID")

    target = target_record.get("rollbackTarget")
    computed = rollback_target_digest(target)
    if target_record.get("rollbackTargetDigest") != computed:
        raise RuntimeError("ROLLBACK_TARGET_DIGEST_MISMATCH")

    exact_keys(target, {
        "canonicalBranch", "authorityHead", "actionId", "operationId", "executorSha256",
        "activeSchema11", "preservedSchema10", "containment", "execution",
    }, "ROLLBACK_TARGET_KEYS_INVALID")
    if target.get("canonicalBranch") != CANONICAL_BRANCH \
      or not COMMIT_RE.fullmatch(str(target.get("authorityHead", ""))) \
      or target.get("actionId") != ACTION_ID \
      or target.get("operationId") != OPERATION_ID \
      or target.get("executorSha256") != executor_sha256():
        raise RuntimeError("ROLLBACK_TARGET_IDENTITY_MISMATCH")

    expected_active = {
        "path": str(ACTIVE_DB),
        "sha256": "sha256:" + EXPECTED_ACTIVE_SCHEMA11_SHA256,
        "size": EXPECTED_ACTIVE_SIZE,
        "device": EXPECTED_ACTIVE_DEVICE,
        "inode": EXPECTED_ACTIVE_INODE,
        "mode": "0600",
        "uid": EXPECTED_ACTIVE_UID,
        "gid": EXPECTED_ACTIVE_GID,
        "schemaVersion": 11,
        "migration11Name": MIGRATION11_NAME,
        "migration11Checksum": MIGRATION11_CHECKSUM,
    }
    expected_preserved = {
        "path": str(PRESERVED_SCHEMA10),
        "sha256": "sha256:" + EXPECTED_SCHEMA10_SHA256,
        "size": EXPECTED_SCHEMA10_SIZE,
        "device": EXPECTED_SCHEMA10_DEVICE,
        "inode": EXPECTED_SCHEMA10_INODE,
        "mode": "0644",
        "uid": EXPECTED_SCHEMA10_UID,
        "gid": EXPECTED_SCHEMA10_GID,
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
        "canonicalHeadMustRemainUnchangedThroughExecution": True,
        "freshCanonicalHeadVerificationRequiredImmediatelyBeforeExecution": True,
    }
    if target.get("activeSchema11") != expected_active       or target.get("preservedSchema10") != expected_preserved       or target.get("containment") != expected_containment       or target.get("execution") != expected_execution:
        raise RuntimeError("ROLLBACK_TARGET_SCOPE_MISMATCH")

    exact_keys(packet, {
        "schemaVersion", "packetId", "contractId", "rollbackTarget",
        "rollbackTargetDigest", "authorization",
    }, "ROLLBACK_PACKET_KEYS_INVALID")
    if packet.get("schemaVersion") != 1       or packet.get("packetId") != PACKET_ID       or packet.get("contractId") != CONTRACT_ID       or packet.get("rollbackTarget") != target       or packet.get("rollbackTargetDigest") != computed:
        raise RuntimeError("ROLLBACK_PACKET_TARGET_MISMATCH")

    authorization = packet.get("authorization")
    exact_keys(authorization, {
        "status", "humanApprovalRequired", "approvalRef",
        "approvedRollbackTargetDigest", "approvalEvidenceDigest",
    }, "ROLLBACK_PACKET_AUTHORIZATION_KEYS_INVALID")
    if authorization.get("status") != "APPROVED"       or authorization.get("humanApprovalRequired") is not True       or authorization.get("approvedRollbackTargetDigest") != computed       or not isinstance(authorization.get("approvalRef"), str)       or not authorization.get("approvalRef")       or not DIGEST_RE.fullmatch(str(authorization.get("approvalEvidenceDigest", ""))):
        raise RuntimeError("ROLLBACK_PACKET_NOT_APPROVED")

    exact_keys(approval, {
        "schemaVersion", "approvalId", "approvalSource", "approvalRef",
        "approvedActionId", "approvedRollbackTargetDigest", "approvalEvidenceDigest",
        "authorizationReceivedBeforeExecution", "rollbackAuthorized",
        "writerReadmissionAuthorized", "productionServiceStartAuthorized",
        "signatureAlgorithm", "signingKeyId", "signatureBase64",
    }, "ROLLBACK_APPROVAL_KEYS_INVALID")
    if approval.get("schemaVersion") != 1       or approval.get("approvalSource") != APPROVAL_SOURCE       or approval.get("approvalRef") != authorization.get("approvalRef")       or approval.get("approvedActionId") != ACTION_ID       or approval.get("approvedRollbackTargetDigest") != computed       or approval.get("authorizationReceivedBeforeExecution") is not True       or approval.get("rollbackAuthorized") is not True       or approval.get("writerReadmissionAuthorized") is not False       or approval.get("productionServiceStartAuthorized") is not False       or approval.get("signatureAlgorithm") != APPROVAL_SIGNATURE_ALGORITHM       or approval.get("signingKeyId") != APPROVAL_SIGNING_KEY_ID       or not isinstance(approval.get("signatureBase64"), str):
        raise RuntimeError("ROLLBACK_APPROVAL_RECORD_NOT_TRUSTED")

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
        "domain": "g3-authority-binding-reconciliation-rollback-approval-v1",
        "approval": approval_core,
    }).encode("utf-8")
    evidence_digest = "sha256:" + hashlib.sha256(payload).hexdigest()
    if approval.get("approvalEvidenceDigest") != evidence_digest       or authorization.get("approvalEvidenceDigest") != evidence_digest:
        raise RuntimeError("ROLLBACK_APPROVAL_EVIDENCE_DIGEST_MISMATCH")
    verify_approval_signature(payload, approval["signatureBase64"])

    replay = target_record.get("replay")
    exact_keys(replay, {
        "operationId", "identity", "packetIdPartitionsReplayIdentity",
        "automaticRetryAllowed",
    }, "ROLLBACK_REPLAY_KEYS_INVALID")
    if replay.get("operationId") != OPERATION_ID       or replay.get("identity") != "operationId+rollbackTargetDigest"       or replay.get("packetIdPartitionsReplayIdentity") is not False       or replay.get("automaticRetryAllowed") is not False:
        raise RuntimeError("ROLLBACK_REPLAY_CONTRACT_MISMATCH")

    return computed, target["authorityHead"]


def inspect_db(path: Path):
    con = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)
    try:
        rows = con.execute("SELECT version,name,checksum FROM schema_migrations ORDER BY version").fetchall()
        integrity = con.execute("PRAGMA integrity_check").fetchall()
        fk = con.execute("PRAGMA foreign_key_check").fetchall()
        return {
            "count": len(rows),
            "maxVersion": max(row[0] for row in rows),
            "migration11Count": sum(1 for row in rows if row[0] == 11),
            "last": rows[-1],
            "integrity": integrity[0][0] if len(integrity) == 1 else None,
            "fkViolations": len(fk),
        }
    finally:
        con.close()


def verify_file_identity(path, *, size, device, inode, mode, uid, gid, digest):
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("ROLLBACK_FILE_IDENTITY_INVALID")
    meta = path.stat()
    if meta.st_size != size or meta.st_dev != device or meta.st_ino != inode       or stat.S_IMODE(meta.st_mode) != mode or meta.st_uid != uid or meta.st_gid != gid       or meta.st_nlink != 1 or sha256_file(path) != digest:
        raise RuntimeError("ROLLBACK_FILE_IDENTITY_MISMATCH")


def verify_no_sidecars(path):
    for suffix in ("-wal", "-shm", "-journal"):
        if path.with_name(path.name + suffix).exists():
            raise RuntimeError("ROLLBACK_SQLITE_SIDECAR_PRESENT")


def docker_json(args):
    return subprocess.check_output(["docker", *args], text=True).strip()


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
            raise RuntimeError("ROLLBACK_MOUNTINFO_INVALID") from exc
        if separator < 6:
            raise RuntimeError("ROLLBACK_MOUNTINFO_INVALID")
        root = Path(_mountinfo_unescape(fields[3]))
        mountpoint = Path(_mountinfo_unescape(fields[4]))
        if not mountpoint.is_absolute():
            raise RuntimeError("ROLLBACK_MOUNTINFO_INVALID")
        if not root.is_absolute():
            continue
        entries.append({
            "majorMinor": fields[2],
            "root": root,
            "mountpoint": mountpoint,
        })
    if not entries:
        raise RuntimeError("ROLLBACK_MOUNTINFO_EMPTY")
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
        raise RuntimeError("ROLLBACK_MOUNTINFO_PATH_UNMAPPED")
    entry = max(candidates, key=lambda item: len(item["mountpoint"].parts))
    relative = resolved.relative_to(entry["mountpoint"])
    return entry["majorMinor"], entry["root"].joinpath(relative)


def docker_daemon_mountinfo_text():
    pids = subprocess.check_output(["pgrep", "-x", "dockerd"], text=True).split()
    if len(pids) != 1 or not pids[0].isdigit():
        raise RuntimeError("ROLLBACK_DOCKER_DAEMON_IDENTITY_UNAVAILABLE")
    try:
        return Path(f"/proc/{pids[0]}/mountinfo").read_text()
    except OSError as exc:
        raise RuntimeError("ROLLBACK_DOCKER_MOUNTINFO_UNAVAILABLE") from exc


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
            raise RuntimeError("ROLLBACK_DOCKER_CONTAINER_PID_INVALID")
        try:
            container_mountinfo = Path(f"/proc/{pid}/mountinfo").read_text()
        except OSError as exc:
            raise RuntimeError("ROLLBACK_DOCKER_CONTAINER_MOUNTINFO_UNAVAILABLE") from exc
        if mountinfo_can_access_filesystem_path(container_mountinfo, db_device, db_fs_path):
            users.append(cid)
    if users:
        raise RuntimeError("ROLLBACK_RUNNING_VOLUME_USERS:" + ",".join(users))


def verify_no_open_db_users():
    if shutil.which("lsof") is None or shutil.which("fuser") is None:
        raise RuntimeError("ROLLBACK_OPEN_USER_VERIFIER_UNAVAILABLE")
    for path in (ACTIVE_DB, PRESERVED_SCHEMA10):
        lsof = subprocess.run(["lsof", str(path)], text=True, capture_output=True)
        if lsof.returncode not in (0, 1):
            raise RuntimeError("ROLLBACK_LSOF_FAILED")
        if lsof.returncode == 0 and lsof.stdout.strip():
            raise RuntimeError("ROLLBACK_OPEN_DATABASE_USERS")
        fuser = subprocess.run(["fuser", str(path)], text=True, capture_output=True)
        if fuser.returncode not in (0, 1):
            raise RuntimeError("ROLLBACK_FUSER_FAILED")
        if fuser.returncode == 0 and (fuser.stdout.strip() or fuser.stderr.strip()):
            raise RuntimeError("ROLLBACK_FUSER_DATABASE_USERS")


def read_instance_id():
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(INSTANCE_ID_URL, timeout=2) as response:
            value = response.read(256).decode("utf-8").strip()
    except Exception as exc:
        raise RuntimeError("ROLLBACK_INSTANCE_METADATA_UNAVAILABLE") from exc
    if value != EXPECTED_INSTANCE_ID:
        raise RuntimeError("ROLLBACK_INSTANCE_ID_MISMATCH")
    return value


def verify_production_service_absent():
    result = subprocess.run(
        ["docker", "inspect", "jenn-shooting-operations-prod"],
        text=True, capture_output=True,
    )
    if result.returncode == 0:
        raise RuntimeError("ROLLBACK_PRODUCTION_SERVICE_CONTAINER_PRESENT")
    units = subprocess.check_output(
        ["systemctl", "list-unit-files", "--type=service", "--no-legend"],
        text=True,
    ).lower()
    if "jenn-shooting" in units or "shooting-operations" in units:
        raise RuntimeError("ROLLBACK_PRODUCTION_SERVICE_UNIT_PRESENT")


def parse_canonical_head_output(text):
    rows = [line.split() for line in text.splitlines() if line.strip()]
    if len(rows) != 1 or len(rows[0]) != 2 \
      or rows[0][1] != f"refs/heads/{CANONICAL_BRANCH}" \
      or not COMMIT_RE.fullmatch(rows[0][0]):
        raise RuntimeError("ROLLBACK_CANONICAL_AUTHORITY_INVALID")
    return rows[0][0]


def read_current_canonical_head():
    if shutil.which("git") is None:
        raise RuntimeError("ROLLBACK_CANONICAL_AUTHORITY_VERIFIER_UNAVAILABLE")
    try:
        result = subprocess.run(
            ["git", "ls-remote", CANONICAL_REPO_URL, f"refs/heads/{CANONICAL_BRANCH}"],
            text=True,
            capture_output=True,
            timeout=8,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("ROLLBACK_CANONICAL_AUTHORITY_UNAVAILABLE") from exc
    if result.returncode != 0:
        raise RuntimeError("ROLLBACK_CANONICAL_AUTHORITY_UNAVAILABLE")
    return parse_canonical_head_output(result.stdout)


def verify_canonical_authority_head(expected_head):
    observed = read_current_canonical_head()
    if observed != expected_head:
        raise RuntimeError("ROLLBACK_CANONICAL_AUTHORITY_HEAD_MISMATCH")
    return observed


def verify_physical_target():
    if os.geteuid() != 0:
        raise RuntimeError("ROLLBACK_ROOT_EXECUTION_REQUIRED")
    if socket.gethostname() != EXPECTED_HOSTNAME:
        raise RuntimeError("ROLLBACK_HOSTNAME_MISMATCH")
    read_instance_id()
    mountpoint = docker_json(["volume", "inspect", VOLUME_NAME, "--format", "{{.Mountpoint}}"])
    if Path(mountpoint) != EXPECTED_VOLUME_MOUNTPOINT:
        raise RuntimeError("ROLLBACK_VOLUME_MOUNTPOINT_MISMATCH")
    fs = subprocess.check_output(
        ["findmnt", "-n", "-o", "SOURCE,FSTYPE", "-T", str(ACTIVE_DB)],
        text=True,
    ).split()
    if fs[:2] != [EXPECTED_FILESYSTEM_SOURCE, EXPECTED_FILESYSTEM_TYPE]:
        raise RuntimeError("ROLLBACK_FILESYSTEM_BINDING_MISMATCH")


def verify_active_and_preserved_state(expected_authority_head):
    verify_canonical_authority_head(expected_authority_head)
    verify_physical_target()
    verify_production_service_absent()
    verify_file_identity(
        ACTIVE_DB,
        size=EXPECTED_ACTIVE_SIZE, device=EXPECTED_ACTIVE_DEVICE,
        inode=EXPECTED_ACTIVE_INODE, mode=EXPECTED_ACTIVE_MODE,
        uid=EXPECTED_ACTIVE_UID, gid=EXPECTED_ACTIVE_GID,
        digest=EXPECTED_ACTIVE_SCHEMA11_SHA256,
    )
    verify_file_identity(
        PRESERVED_SCHEMA10,
        size=EXPECTED_SCHEMA10_SIZE, device=EXPECTED_SCHEMA10_DEVICE,
        inode=EXPECTED_SCHEMA10_INODE, mode=EXPECTED_SCHEMA10_MODE,
        uid=EXPECTED_SCHEMA10_UID, gid=EXPECTED_SCHEMA10_GID,
        digest=EXPECTED_SCHEMA10_SHA256,
    )
    verify_no_sidecars(ACTIVE_DB)
    verify_no_sidecars(PRESERVED_SCHEMA10)
    active = inspect_db(ACTIVE_DB)
    preserved = inspect_db(PRESERVED_SCHEMA10)
    if active["count"] != 11 or active["maxVersion"] != 11       or active["migration11Count"] != 1       or active["last"][1] != MIGRATION11_NAME       or active["last"][2] != MIGRATION11_CHECKSUM       or active["integrity"] != "ok" or active["fkViolations"] != 0:
        raise RuntimeError("ROLLBACK_ACTIVE_SCHEMA11_INVALID")
    if preserved["count"] != 10 or preserved["maxVersion"] != 10       or preserved["migration11Count"] != 0       or preserved["integrity"] != "ok" or preserved["fkViolations"] != 0:
        raise RuntimeError("ROLLBACK_PRESERVED_SCHEMA10_INVALID")
    if ACTIVE_DB.stat().st_dev != PRESERVED_SCHEMA10.stat().st_dev:
        raise RuntimeError("ROLLBACK_NOT_SAME_FILESYSTEM")
    verify_no_running_volume_users()
    verify_no_open_db_users()


def claim_attempt(rollback_target_digest_value):
    attempts = CONTROL_ROOT / "attempts"
    attempts.mkdir(parents=True, exist_ok=True)
    replay = hashlib.sha256(
        f"{OPERATION_ID}\n{rollback_target_digest_value}".encode("utf-8")
    ).hexdigest()
    path = attempts / f"{replay}.json"
    body = json.dumps({
        "packetId": PACKET_ID,
        "operationId": OPERATION_ID,
        "rollbackTargetDigest": rollback_target_digest_value,
    }, sort_keys=True, separators=(",", ":")) + "\n"
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise RuntimeError("RECONCILIATION_REQUIRED") from exc
    with os.fdopen(fd, "w") as handle:
        handle.write(body)
        handle.flush()
        os.fsync(handle.fileno())
    fsync_dir(attempts)
    return path


def rename_exchange(left: Path, right: Path):
    libc = ctypes.CDLL(None, use_errno=True)
    fn = getattr(libc, "renameat2", None)
    if fn is None:
        raise RuntimeError("ROLLBACK_RENAMEAT2_UNAVAILABLE")
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    rc = fn(AT_FDCWD, os.fsencode(left), AT_FDCWD, os.fsencode(right), RENAME_EXCHANGE)
    if rc != 0:
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err))


def execute(packet_path, approval_path, target_record_path):
    claimed = False
    exchanged = False
    target_digest, expected_authority_head = verify_approved_authority(
        packet_path, approval_path, target_record_path
    )
    verify_active_and_preserved_state(expected_authority_head)
    attempt = claim_attempt(target_digest)
    claimed = True
    try:
        verify_active_and_preserved_state(expected_authority_head)
        rename_exchange(ACTIVE_DB, PRESERVED_SCHEMA10)
        exchanged = True
        fsync_dir(ACTIVE_DB.parent)
        fsync_dir(PRESERVED_SCHEMA10.parent)
        print(json.dumps({
            "status": "G3_AUTHORITY_RECONCILIATION_ROLLBACK_EXCHANGE_COMPLETE_UNCLASSIFIED",
            "operationId": OPERATION_ID,
            "packetId": PACKET_ID,
            "rollbackTargetDigest": target_digest,
            "attemptRecord": str(attempt),
            "expectedActiveSchema10Sha256": EXPECTED_SCHEMA10_SHA256,
            "exchangedOutSchema11Path": str(PRESERVED_SCHEMA10),
            "automaticRetryAllowed": False,
            "writerReadmissionAuthorized": False,
            "next": "INDEPENDENT_ROLLBACK_TERMINAL_VERIFICATION_REQUIRED",
        }, sort_keys=True))
    except Exception as exc:
        if claimed:
            print(json.dumps({
                "status": "UNKNOWN",
                "operationId": OPERATION_ID,
                "packetId": PACKET_ID,
                "rollbackTargetDigest": target_digest,
                "exchangeMayHaveOccurred": exchanged,
                "automaticRetryAllowed": False,
                "writerReadmissionAuthorized": False,
                "reconciliationRequired": True,
                "errorClass": type(exc).__name__,
            }, sort_keys=True))
        raise


def self_test_exchange():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        left = root / "left"
        right = root / "right"
        left.write_bytes(b"schema11")
        right.write_bytes(b"schema10")
        rename_exchange(left, right)
        if left.read_bytes() != b"schema10" or right.read_bytes() != b"schema11":
            raise RuntimeError("ROLLBACK_RENAME_EXCHANGE_SELF_TEST_FAILED")
    print(json.dumps({"status": "G3_RECONCILIATION_ROLLBACK_EXCHANGE_SELF_TEST_PASS"}))


def self_test_authority_head_parser():
    head = "a" * 40
    valid = f"{head}\trefs/heads/{CANONICAL_BRANCH}\n"
    if parse_canonical_head_output(valid) != head:
        raise RuntimeError("ROLLBACK_CANONICAL_AUTHORITY_SELF_TEST_FAILED")
    invalid = [
        "",
        f"{head}\trefs/heads/main\n",
        f"{head}\trefs/heads/{CANONICAL_BRANCH}\n{head}\trefs/heads/{CANONICAL_BRANCH}\n",
        f"not-a-commit\trefs/heads/{CANONICAL_BRANCH}\n",
    ]
    for value in invalid:
        try:
            parse_canonical_head_output(value)
        except RuntimeError as exc:
            if str(exc) != "ROLLBACK_CANONICAL_AUTHORITY_INVALID":
                raise
        else:
            raise RuntimeError("ROLLBACK_CANONICAL_AUTHORITY_SELF_TEST_FAILED")
    print(json.dumps({"status": "G3_RECONCILIATION_ROLLBACK_AUTHORITY_HEAD_SELF_TEST_PASS"}))


def self_test_approval_signature():
    message = b"G3_APPROVAL_SIGNATURE_SELF_TEST_V1\n"
    # Public self-test vector already frozen for this Ed25519 approval key.
    signature = "9jiqxI3bnc4FPzxhipF4NCqNGE+tbaA6hGfMzSTW+sOqNOKD32s8VwSnlaG+Y/HwVs7/adS2ceTK1QOfYpuZCA=="
    verify_approval_signature(message, signature)
    print(json.dumps({
        "status": "G3_RECONCILIATION_ROLLBACK_APPROVAL_SELF_TEST_PASS",
        "signingKeyId": APPROVAL_SIGNING_KEY_ID,
    }, sort_keys=True))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test-exchange", action="store_true")
    parser.add_argument("--self-test-approval-signature", action="store_true")
    parser.add_argument("--self-test-authority-head", action="store_true")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--approved-packet")
    parser.add_argument("--approval-record")
    parser.add_argument("--target-record")
    args = parser.parse_args()

    self_tests = [
        args.self_test_exchange,
        args.self_test_approval_signature,
        args.self_test_authority_head,
    ]
    if any(self_tests):
        if args.execute or args.approved_packet or args.approval_record or args.target_record \
          or sum(bool(value) for value in self_tests) != 1:
            raise SystemExit("self-test must be isolated")
        if args.self_test_exchange:
            self_test_exchange()
        elif args.self_test_approval_signature:
            self_test_approval_signature()
        else:
            self_test_authority_head_parser()
        return

    if not args.execute or not args.approved_packet or not args.approval_record or not args.target_record:
        raise SystemExit(
            "rollback executable mode requires --execute, --approved-packet, "
            "--approval-record and --target-record"
        )
    execute(Path(args.approved_packet), Path(args.approval_record), Path(args.target_record))


if __name__ == "__main__":
    main()
