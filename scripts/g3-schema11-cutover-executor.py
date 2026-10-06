#!/usr/bin/env python3
import argparse
import base64
import ctypes
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import stat
import urllib.request
import sqlite3
import subprocess
import sys
import tempfile

ACTIVE_DB = Path("/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data/shooting-operations.sqlite")
VOLUME_NAME = "jenn-shooting-operations_shooting_data"
CONTROL_ROOT = Path("/mnt/datadisk0/g3-schema11-cutover")
IMAGE_DIGEST = "sha256:581e9fa25e04b582aa39c2fdaa291f6db3e80fc3f3ac15a8a4afa06622442144"
IMAGE_SOURCE_COMMIT = "6334e2ae851247cb1558074fbd80cfee06b28c11"
EXPECTED_SCHEMA10_SHA256 = "5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7"
MIGRATION_VERSION = 11
MIGRATION_NAME = "business_calendar_and_reschedule"
MIGRATION_CHECKSUM = "sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8"
OPERATION_ID = "G3-SCHEMA11-OP-20261006-R1"
PACKET_ID = "G3-SCHEMA11-CUTOVER-20261006-R1"
DIGEST_RE = re.compile(r"^sha256:[a-f0-9]{64}$")
RENAME_EXCHANGE = 2
AT_FDCWD = -100
EXPECTED_HOSTNAME = "VM-0-12-ubuntu"
EXPECTED_INSTANCE_ID = "ins-mi85f3my"
INSTANCE_ID_URL = "http://169.254.0.23/latest/meta-data/instance-id"
EXPECTED_VOLUME_MOUNTPOINT = Path("/mnt/datadisk0/docker/volumes/jenn-shooting-operations_shooting_data/_data")
EXPECTED_FILESYSTEM_SOURCE = "/dev/vdb"
EXPECTED_FILESYSTEM_TYPE = "ext4"
EXPECTED_ACTIVE_SIZE = 512000
EXPECTED_ACTIVE_DEVICE = 64784
EXPECTED_ACTIVE_INODE = 1835048
EXPECTED_ACTIVE_MODE = 0o644
EXPECTED_ACTIVE_UID = 1000
EXPECTED_ACTIVE_GID = 1000
EXPECTED_TARGET_BINDING_DIGEST = "sha256:30e6c937d5caddac4c575b49dac0d68139c5eff57b1d28c353d99e53c97e9a60"
EXPECTED_ACTIVE_DATABASE_FAMILY_DIGEST = "sha256:3df22ce713b686313f1c19bbb6fcf6b1af670f610ae46e884e890cb41fbe568e"
EXPECTED_RECOVERY_ARTIFACT_DIGEST = "sha256:f2e643317a152600c8bf864648cec095ad57ba398c804feb35f9338a7073cfef"
APPROVAL_SOURCE = "EXPLICIT_HUMAN_CHAT_AUTHORIZATION"
APPROVED_ACTION_ID = "G3_SCHEMA11_CUTOVER"
APPROVAL_SIGNATURE_ALGORITHM = "Ed25519"
APPROVAL_SIGNING_KEY_ID = "sha256:0d9c964a35c05842b5aafbe261fb5e020427ad5c635357e6955201da56100bae"
APPROVAL_PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAO6+9DSKWYrwyEC20zFe1GPdeTEYggybpXBrxDib5Koo=
-----END PUBLIC KEY-----
"""
APPROVAL_SIGNATURE_SELF_TEST_MESSAGE = b"G3_APPROVAL_SIGNATURE_SELF_TEST_V1\n"
APPROVAL_SIGNATURE_SELF_TEST_B64 = "9jiqxI3bnc4FPzxhipF4NCqNGE+tbaA6hGfMzSTW+sOqNOKD32s8VwSnlaG+Y/HwVs7/adS2ceTK1QOfYpuZCA=="
MIGRATION_UID = 1000
MIGRATION_GID = 1000

NODE_MIGRATE = r"""
import { DatabaseSync } from 'node:sqlite';
import { initializeWritableSchema, MIGRATIONS } from '/app/src/sqlite-schema-v2.mjs';
const expected = {
  version: 11,
  name: 'business_calendar_and_reschedule',
  checksum: 'sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8',
};
const migration = MIGRATIONS.find(item => item.version === expected.version);
if (!migration || migration.name !== expected.name || migration.checksum !== expected.checksum) {
  throw new Error('G3_MIGRATION_IDENTITY_MISMATCH');
}
const db = new DatabaseSync('/cutover/candidate.sqlite');
try {
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const before = db.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version').all();
  if (before.length !== 10 || Number(before.at(-1)?.version) !== 10) {
    throw new Error('G3_SOURCE_SCHEMA_NOT_10');
  }
  initializeWritableSchema(db, { migrations: MIGRATIONS.slice(0, 11) });
  const after = db.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version').all();
  const integrity = db.prepare('PRAGMA integrity_check').all();
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  const mode = String(db.prepare('PRAGMA journal_mode').get()?.journal_mode ?? '').toLowerCase();
  if (after.length !== 11 || Number(after.at(-1)?.version) !== 11
    || after.at(-1)?.name !== expected.name || after.at(-1)?.checksum !== expected.checksum
    || integrity.length !== 1 || integrity[0].integrity_check !== 'ok'
    || fk.length !== 0 || mode !== 'delete') {
    throw new Error('G3_CANDIDATE_VERIFICATION_FAILED');
  }
  console.log(JSON.stringify({status:'G3_CANDIDATE_SCHEMA11_READY',migrationCount:after.length,integrity:'ok',fkViolations:0,journalMode:mode}));
} finally {
  db.close();
}
"""

def canonical_json(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        if isinstance(value, float) and not (value == value and abs(value) != float("inf")):
            raise RuntimeError("G3_CANONICAL_JSON_INVALID")
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        if any(not isinstance(key, str) or key in {"__proto__", "constructor", "prototype"} for key in value):
            raise RuntimeError("G3_CANONICAL_JSON_INVALID")
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False) + ":" + canonical_json(value[key])
            for key in sorted(value)
        ) + "}"
    raise RuntimeError("G3_CANONICAL_JSON_INVALID")

def canonical_digest(value) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()

def exact_keys(value, expected, code):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise RuntimeError(code)
    return value

def verify_approval_signature(message: bytes, signature_b64: str):
    try:
        signature = base64.b64decode(signature_b64, validate=True)
    except Exception as exc:
        raise RuntimeError("G3_APPROVAL_SIGNATURE_INVALID") from exc
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
            raise RuntimeError("G3_APPROVAL_SIGNATURE_VERIFIER_UNAVAILABLE") from exc
    if result.returncode != 0:
        raise RuntimeError("G3_APPROVAL_SIGNATURE_NOT_TRUSTED")

def load_json_file(path: Path, code):
    try:
        metadata = path.lstat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise RuntimeError(code)
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(code) from exc

def verify_approved_authority(packet_path: Path, approval_path: Path, preparation_path: Path):
    preparation = load_json_file(preparation_path, "G3_PREPARATION_RECORD_INVALID")
    packet = load_json_file(packet_path, "G3_APPROVED_PACKET_INVALID")
    approval = load_json_file(approval_path, "G3_APPROVAL_RECORD_INVALID")

    exact_keys(packet, {
        "schemaVersion", "packetId", "contractId", "authorityTarget",
        "authorityTargetDigest", "authorization",
    }, "G3_APPROVED_PACKET_KEYS_INVALID")
    if packet.get("schemaVersion") != 1 or packet.get("packetId") != PACKET_ID       or packet.get("contractId") != "G2_MINIMAL_RELEASE_CONTRACT_V1":
        raise RuntimeError("G3_APPROVED_PACKET_IDENTITY_MISMATCH")

    authority_target = packet.get("authorityTarget")
    if authority_target != preparation.get("authorityTarget"):
        raise RuntimeError("G3_APPROVED_TARGET_NOT_FROZEN_PREPARATION")
    computed = canonical_digest({
        "domain": "g3-schema11-authority-target-v1",
        "authorityTarget": authority_target,
    })
    if packet.get("authorityTargetDigest") != computed       or preparation.get("authorityTargetDigest") != computed:
        raise RuntimeError("G3_APPROVED_TARGET_DIGEST_MISMATCH")

    target = authority_target.get("target", {})
    prestate = authority_target.get("prestate", {})
    execution = authority_target.get("execution", {})
    if target.get("targetBindingDigest") != EXPECTED_TARGET_BINDING_DIGEST       or target.get("activeDatabaseFamilyDigest") != EXPECTED_ACTIVE_DATABASE_FAMILY_DIGEST       or prestate.get("recoveryArtifactDigest") != EXPECTED_RECOVERY_ARTIFACT_DIGEST       or execution.get("operationId") != OPERATION_ID       or execution.get("entrypointId") != "G3_SCHEMA11_CUTOVER"       or execution.get("automaticRetryAllowed") is not False:
        raise RuntimeError("G3_APPROVED_TARGET_SCOPE_MISMATCH")

    boundary = preparation.get("executionBoundaryEvidence", {})
    executor_digest = "sha256:" + sha256_file(Path(__file__).resolve())
    if boundary.get("executorSha256") != executor_digest:
        raise RuntimeError("G3_EXECUTOR_DIGEST_MISMATCH")
    boundary_digest = canonical_digest({
        "domain": "g3-schema11-execution-boundary-v1",
        "executionBoundaryEvidence": boundary,
    })
    if authority_target.get("writerContainment", {}).get("executionBoundaryProofDigest") != boundary_digest:
        raise RuntimeError("G3_EXECUTION_BOUNDARY_DIGEST_MISMATCH")

    authorization = packet.get("authorization")
    exact_keys(authorization, {
        "status", "humanApprovalRequired", "approvalRef",
        "approvedAuthorityTargetDigest", "approvalEvidenceDigest",
    }, "G3_PACKET_AUTHORIZATION_KEYS_INVALID")
    if authorization.get("status") != "APPROVED"       or authorization.get("humanApprovalRequired") is not True       or authorization.get("approvedAuthorityTargetDigest") != computed       or not isinstance(authorization.get("approvalRef"), str)       or not authorization.get("approvalRef")       or not DIGEST_RE.fullmatch(str(authorization.get("approvalEvidenceDigest", ""))):
        raise RuntimeError("G3_PACKET_NOT_APPROVED")

    exact_keys(approval, {
        "schemaVersion", "approvalId", "approvalSource", "approvalRef",
        "approvedActionId", "approvedAuthorityTargetDigest", "approvalEvidenceDigest",
        "authorizationReceivedBeforeExecution", "schema11CutoverAuthorized",
        "normalWriterReadmissionAuthorized", "signatureAlgorithm",
        "signingKeyId", "signatureBase64",
    }, "G3_APPROVAL_RECORD_KEYS_INVALID")
    if approval.get("schemaVersion") != 1 \
      or approval.get("approvalSource") != APPROVAL_SOURCE \
      or approval.get("approvedActionId") != APPROVED_ACTION_ID \
      or approval.get("approvalRef") != authorization.get("approvalRef") \
      or approval.get("approvedAuthorityTargetDigest") != computed \
      or approval.get("authorizationReceivedBeforeExecution") is not True \
      or approval.get("schema11CutoverAuthorized") is not True \
      or approval.get("normalWriterReadmissionAuthorized") is not False \
      or approval.get("signatureAlgorithm") != APPROVAL_SIGNATURE_ALGORITHM \
      or approval.get("signingKeyId") != APPROVAL_SIGNING_KEY_ID \
      or not isinstance(approval.get("signatureBase64"), str):
        raise RuntimeError("G3_APPROVAL_RECORD_NOT_TRUSTED")

    approval_core = {
        "schemaVersion": approval["schemaVersion"],
        "approvalId": approval["approvalId"],
        "approvalSource": approval["approvalSource"],
        "approvalRef": approval["approvalRef"],
        "approvedActionId": approval["approvedActionId"],
        "approvedAuthorityTargetDigest": approval["approvedAuthorityTargetDigest"],
        "authorizationReceivedBeforeExecution": approval["authorizationReceivedBeforeExecution"],
        "schema11CutoverAuthorized": approval["schema11CutoverAuthorized"],
        "normalWriterReadmissionAuthorized": approval["normalWriterReadmissionAuthorized"],
        "signatureAlgorithm": approval["signatureAlgorithm"],
        "signingKeyId": approval["signingKeyId"],
    }
    approval_payload = canonical_json({
        "domain": "g3-schema11-human-approval-v1",
        "approval": approval_core,
    }).encode("utf-8")
    approval_evidence_digest = "sha256:" + hashlib.sha256(approval_payload).hexdigest()
    if approval.get("approvalEvidenceDigest") != approval_evidence_digest \
      or authorization.get("approvalEvidenceDigest") != approval_evidence_digest:
        raise RuntimeError("G3_APPROVAL_EVIDENCE_DIGEST_MISMATCH")
    verify_approval_signature(approval_payload, approval["signatureBase64"])

    return computed

def read_instance_id():
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(INSTANCE_ID_URL, timeout=2) as response:
            value = response.read(256).decode("utf-8").strip()
    except Exception as exc:
        raise RuntimeError("G3_INSTANCE_METADATA_UNAVAILABLE") from exc
    if value != EXPECTED_INSTANCE_ID:
        raise RuntimeError("G3_INSTANCE_ID_MISMATCH")
    return value

def verify_physical_target():
    if os.geteuid() != 0:
        raise RuntimeError("G3_ROOT_EXECUTION_REQUIRED")
    if socket.gethostname() != EXPECTED_HOSTNAME:
        raise RuntimeError("G3_HOSTNAME_MISMATCH")
    read_instance_id()
    try:
        mountpoint = docker_json(["volume", "inspect", VOLUME_NAME, "--format", "{{.Mountpoint}}"])
    except subprocess.CalledProcessError as exc:
        raise RuntimeError("G3_VOLUME_BINDING_UNAVAILABLE") from exc
    if Path(mountpoint) != EXPECTED_VOLUME_MOUNTPOINT:
        raise RuntimeError("G3_VOLUME_MOUNTPOINT_MISMATCH")
    try:
        fs = subprocess.check_output(
            ["findmnt", "-n", "-o", "SOURCE,FSTYPE", "-T", str(ACTIVE_DB)],
            text=True,
        ).strip().split()
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise RuntimeError("G3_FILESYSTEM_BINDING_UNAVAILABLE") from exc
    if fs != [EXPECTED_FILESYSTEM_SOURCE, EXPECTED_FILESYSTEM_TYPE]:
        raise RuntimeError("G3_FILESYSTEM_BINDING_MISMATCH")
    metadata = ACTIVE_DB.lstat()
    identity = (
        metadata.st_size, metadata.st_dev, metadata.st_ino,
        stat.S_IMODE(metadata.st_mode), metadata.st_uid, metadata.st_gid,
    )
    expected = (
        EXPECTED_ACTIVE_SIZE, EXPECTED_ACTIVE_DEVICE, EXPECTED_ACTIVE_INODE,
        EXPECTED_ACTIVE_MODE, EXPECTED_ACTIVE_UID, EXPECTED_ACTIVE_GID,
    )
    if identity != expected or metadata.st_nlink != 1:
        raise RuntimeError("G3_ACTIVE_DB_PHYSICAL_IDENTITY_MISMATCH")

def verify_no_open_db_users():
    paths = [
        ACTIVE_DB,
        ACTIVE_DB.with_name(ACTIVE_DB.name + "-wal"),
        ACTIVE_DB.with_name(ACTIVE_DB.name + "-shm"),
    ]
    existing = [str(path) for path in paths if path.exists()]
    if not existing:
        raise RuntimeError("G3_ACTIVE_DB_MISSING")
    try:
        lsof = subprocess.run(["lsof", "-t", *existing], text=True, capture_output=True)
    except FileNotFoundError as exc:
        raise RuntimeError("G3_LSOF_UNAVAILABLE") from exc
    if lsof.returncode == 0 and lsof.stdout.strip():
        raise RuntimeError("G3_OPEN_DATABASE_FILE_USERS:" + ",".join(lsof.stdout.split()))
    if lsof.returncode not in (0, 1):
        raise RuntimeError("G3_LSOF_CHECK_FAILED")
    try:
        fuser = subprocess.run(["fuser", *existing], text=True, capture_output=True)
    except FileNotFoundError as exc:
        raise RuntimeError("G3_FUSER_UNAVAILABLE") from exc
    pids = " ".join((fuser.stdout, fuser.stderr)).strip()
    if fuser.returncode == 0 and pids:
        raise RuntimeError("G3_FUSER_DATABASE_PIDS:" + " ".join(pids.split()))
    if fuser.returncode not in (0, 1):
        raise RuntimeError("G3_FUSER_CHECK_FAILED")

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def fsync_file(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

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
            "last": {"version": rows[-1][0], "name": rows[-1][1], "checksum": rows[-1][2]},
            "integrity": integrity[0][0] if len(integrity) == 1 else None,
            "fkViolations": len(fk),
        }
    finally:
        con.close()

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
            raise RuntimeError("G3_MOUNTINFO_INVALID") from exc
        if separator < 6:
            raise RuntimeError("G3_MOUNTINFO_INVALID")
        root = Path(_mountinfo_unescape(fields[3]))
        mountpoint = Path(_mountinfo_unescape(fields[4]))
        if not mountpoint.is_absolute():
            raise RuntimeError("G3_MOUNTINFO_INVALID")
        # Linux mountinfo can legitimately expose non-path roots for pseudo
        # filesystems, e.g. nsfs roots such as net:[4026532564]. Those entries
        # cannot map a host filesystem pathname and are irrelevant to the
        # production DB filesystem identity, so skip them without weakening
        # checks for path-addressable mounts such as the /dev/vdb ext4 volume.
        if not root.is_absolute():
            continue
        entries.append({
            "majorMinor": fields[2],
            "root": root,
            "mountpoint": mountpoint,
        })
    if not entries:
        raise RuntimeError("G3_MOUNTINFO_EMPTY")
    return entries

def _path_within(path, parent):
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False

def mount_identity_for_path(path, mountinfo_text):
    try:
        resolved = Path(path).resolve(strict=False)
    except OSError as exc:
        raise RuntimeError("G3_DOCKER_MOUNT_SOURCE_UNRESOLVABLE") from exc
    candidates = [
        entry for entry in parse_mountinfo(mountinfo_text)
        if _path_within(resolved, entry["mountpoint"])
    ]
    if not candidates:
        raise RuntimeError("G3_MOUNTINFO_PATH_UNMAPPED")
    entry = max(candidates, key=lambda item: len(item["mountpoint"].parts))
    relative = resolved.relative_to(entry["mountpoint"])
    filesystem_path = entry["root"].joinpath(relative)
    return entry["majorMinor"], filesystem_path

def docker_daemon_mountinfo_text():
    pids = subprocess.check_output(["pgrep", "-x", "dockerd"], text=True).split()
    if len(pids) != 1 or not pids[0].isdigit():
        raise RuntimeError("G3_DOCKER_DAEMON_IDENTITY_UNAVAILABLE")
    path = Path(f"/proc/{pids[0]}/mountinfo")
    try:
        return path.read_text()
    except OSError as exc:
        raise RuntimeError("G3_DOCKER_MOUNTINFO_UNAVAILABLE") from exc

def mount_source_can_access_active_db(source, mountinfo_text=None):
    if not isinstance(source, str) or not source.startswith("/"):
        return False
    try:
        resolved_source = Path(source).resolve(strict=False)
        resolved_db = ACTIVE_DB.resolve(strict=False)
    except OSError as exc:
        raise RuntimeError("G3_DOCKER_MOUNT_SOURCE_UNRESOLVABLE") from exc
    if resolved_source == resolved_db or resolved_source in resolved_db.parents:
        return True

    mountinfo = mountinfo_text if mountinfo_text is not None else docker_daemon_mountinfo_text()
    source_device, source_fs_path = mount_identity_for_path(resolved_source, mountinfo)
    db_device, db_fs_path = mount_identity_for_path(resolved_db, mountinfo)
    return source_device == db_device \
      and (source_fs_path == db_fs_path or source_fs_path in db_fs_path.parents)

def mountinfo_can_access_filesystem_path(mountinfo_text, db_device, db_fs_path):
    for entry in parse_mountinfo(mountinfo_text):
        if entry["majorMinor"] == db_device \
          and (entry["root"] == db_fs_path or entry["root"] in db_fs_path.parents):
            return True
    return False

def container_mount_namespace_can_access_active_db(cid, db_device, db_fs_path):
    pid_text = docker_json(["inspect", cid, "--format", "{{.State.Pid}}"])
    if not pid_text.isdigit() or int(pid_text) <= 0:
        raise RuntimeError("G3_DOCKER_CONTAINER_PID_INVALID")
    path = Path(f"/proc/{pid_text}/mountinfo")
    try:
        mountinfo = path.read_text()
    except OSError as exc:
        raise RuntimeError("G3_DOCKER_CONTAINER_MOUNTINFO_UNAVAILABLE") from exc
    return mountinfo_can_access_filesystem_path(mountinfo, db_device, db_fs_path)

def verify_no_running_volume_users():
    ids = subprocess.check_output(["docker", "ps", "-q"], text=True).split()
    users = []
    mountinfo = docker_daemon_mountinfo_text()
    db_device, db_fs_path = mount_identity_for_path(ACTIVE_DB, mountinfo)
    for cid in ids:
        mounts = json.loads(docker_json(["inspect", cid, "--format", "{{json .Mounts}}"]))
        direct_access = any(
            mount.get("Name") == VOLUME_NAME
            or mount_source_can_access_active_db(mount.get("Source"), mountinfo)
            for mount in mounts
        )
        if direct_access or container_mount_namespace_can_access_active_db(
          cid, db_device, db_fs_path
        ):
            users.append(cid)
    if users:
        raise RuntimeError("G3_RUNNING_VOLUME_USERS:" + ",".join(users))

def verify_image():
    try:
        image_id = docker_json(["image", "inspect", IMAGE_DIGEST, "--format", "{{.Id}}"])
        arch = docker_json(["image", "inspect", IMAGE_DIGEST, "--format", "{{.Architecture}}"])
        revision = docker_json(["image", "inspect", IMAGE_DIGEST, "--format", "{{index .Config.Labels \"org.opencontainers.image.revision\"}}"])
    except subprocess.CalledProcessError as exc:
        raise RuntimeError("G3_EXACT_IMAGE_NOT_STAGED") from exc
    if image_id != IMAGE_DIGEST or arch != "amd64" or revision != IMAGE_SOURCE_COMMIT:
        raise RuntimeError("G3_EXACT_IMAGE_MISMATCH")

def verify_active_prestate():
    verify_physical_target()
    if ACTIVE_DB.is_symlink() or not ACTIVE_DB.is_file():
        raise RuntimeError("G3_ACTIVE_DB_IDENTITY_INVALID")
    if ACTIVE_DB.with_name(ACTIVE_DB.name + "-wal").exists() or ACTIVE_DB.with_name(ACTIVE_DB.name + "-shm").exists():
        raise RuntimeError("G3_ACTIVE_DB_FAMILY_NOT_QUIESCENT")
    if sha256_file(ACTIVE_DB) != EXPECTED_SCHEMA10_SHA256:
        raise RuntimeError("G3_ACTIVE_DB_DIGEST_MISMATCH")
    meta = inspect_db(ACTIVE_DB)
    if meta["count"] != 10 or meta["maxVersion"] != 10 or meta["migration11Count"] != 0 or meta["integrity"] != "ok" or meta["fkViolations"] != 0:
        raise RuntimeError("G3_ACTIVE_DB_SCHEMA10_PRESTATE_INVALID")
    verify_no_running_volume_users()
    verify_no_open_db_users()

def claim_attempt(authority_target_digest: str):
    if not DIGEST_RE.fullmatch(authority_target_digest):
        raise RuntimeError("G3_AUTHORITY_TARGET_DIGEST_INVALID")
    attempts = CONTROL_ROOT / "attempts"
    attempts.mkdir(parents=True, exist_ok=True)
    replay = hashlib.sha256(f"{OPERATION_ID}\n{authority_target_digest}".encode()).hexdigest()
    path = attempts / f"{replay}.json"
    body = json.dumps({
        "packetId": PACKET_ID,
        "operationId": OPERATION_ID,
        "authorityTargetDigest": authority_target_digest,
        "claimedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
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

def verify_migration_user_workdir_access():
    CONTROL_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".uid1000-preflight-", dir=CONTROL_ROOT) as td:
        probe_dir = Path(td)
        os.chown(probe_dir, MIGRATION_UID, MIGRATION_GID)
        os.chmod(probe_dir, 0o750)
        subprocess.run([
            "docker", "run", "--rm", "--network", "none", "--read-only",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
            "--user", f"{MIGRATION_UID}:{MIGRATION_GID}",
            "-v", f"{probe_dir}:/cutover:rw",
            "--entrypoint", "node", IMAGE_DIGEST,
            "-e", "const fs=require('node:fs'); fs.writeFileSync('/cutover/.probe','ok'); fs.unlinkSync('/cutover/.probe');",
        ], check=True)

def migrate_isolated_candidate(workdir: Path):
    candidate = workdir / "candidate.sqlite"
    shutil.copy2(ACTIVE_DB, candidate)
    os.chown(candidate, MIGRATION_UID, MIGRATION_GID)
    os.chmod(candidate, 0o600)
    fsync_file(candidate)
    fsync_dir(workdir)
    if sha256_file(candidate) != EXPECTED_SCHEMA10_SHA256:
        raise RuntimeError("G3_CANDIDATE_COPY_MISMATCH")
    subprocess.run([
        "docker", "run", "--rm", "--network", "none", "--read-only",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
        "--pids-limit", "64", "--memory", "256m", "--cpus", "1",
        "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m",
        "--user", f"{MIGRATION_UID}:{MIGRATION_GID}",
        "-v", f"{workdir}:/cutover:rw",
        "--entrypoint", "node", IMAGE_DIGEST,
        "--input-type=module", "-e", NODE_MIGRATE,
    ], check=True)
    for suffix in ("-wal", "-shm", "-journal"):
        if candidate.with_name(candidate.name + suffix).exists():
            raise RuntimeError("G3_CANDIDATE_TRANSIENT_FILE_REMAINS")
    meta = inspect_db(candidate)
    if meta["count"] != 11 or meta["maxVersion"] != 11 or meta["migration11Count"] != 1 or meta["last"]["name"] != MIGRATION_NAME or meta["last"]["checksum"] != MIGRATION_CHECKSUM or meta["integrity"] != "ok" or meta["fkViolations"] != 0:
        raise RuntimeError("G3_CANDIDATE_SCHEMA11_INVALID")
    fsync_file(candidate)
    fsync_dir(workdir)
    return candidate, sha256_file(candidate)

def rename_exchange(left: Path, right: Path):
    libc = ctypes.CDLL(None, use_errno=True)
    fn = getattr(libc, "renameat2", None)
    if fn is None:
        raise RuntimeError("G3_RENAMEAT2_UNAVAILABLE")
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    rc = fn(AT_FDCWD, os.fsencode(left), AT_FDCWD, os.fsencode(right), RENAME_EXCHANGE)
    if rc != 0:
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err))

def execute(packet_path: Path, approval_path: Path, preparation_path: Path):
    exchanged = False
    authority_target_digest = verify_approved_authority(packet_path, approval_path, preparation_path)
    verify_active_prestate()
    verify_image()
    if os.stat(ACTIVE_DB).st_dev != os.stat(ACTIVE_DB.parent).st_dev:
        raise RuntimeError("G3_ACTIVE_DB_DEVICE_MISMATCH")
    verify_migration_user_workdir_access()
    attempt = claim_attempt(authority_target_digest)
    workdir = CONTROL_ROOT / OPERATION_ID
    if workdir.exists():
        raise RuntimeError("RECONCILIATION_REQUIRED")
    workdir.mkdir(parents=True, mode=0o750)
    os.chown(workdir, MIGRATION_UID, MIGRATION_GID)
    os.chmod(workdir, 0o750)
    fsync_dir(CONTROL_ROOT)
    try:
        candidate, candidate_sha = migrate_isolated_candidate(workdir)
        verify_active_prestate()
        if os.stat(candidate).st_dev != os.stat(ACTIVE_DB).st_dev:
            raise RuntimeError("G3_CANDIDATE_NOT_SAME_FILESYSTEM")
        rename_exchange(ACTIVE_DB, candidate)
        exchanged = True
        fsync_dir(ACTIVE_DB.parent)
        fsync_dir(workdir)
        print(json.dumps({
            "status": "G3_ATOMIC_EXCHANGE_COMPLETE_UNCLASSIFIED",
            "packetId": PACKET_ID,
            "operationId": OPERATION_ID,
            "authorityTargetDigest": authority_target_digest,
            "attemptRecord": str(attempt),
            "candidateSchema11Sha256": candidate_sha,
            "oldSchema10PathAfterExchange": str(candidate),
            "automaticRetryAllowed": False,
            "next": "INDEPENDENT_TERMINAL_VERIFICATION_REQUIRED",
        }, sort_keys=True))
    except Exception as exc:
        if exchanged:
            print(json.dumps({
                "status": "UNKNOWN",
                "packetId": PACKET_ID,
                "operationId": OPERATION_ID,
                "authorityTargetDigest": authority_target_digest,
                "automaticRetryAllowed": False,
                "reconciliationRequired": True,
                "errorClass": type(exc).__name__,
            }, sort_keys=True))
        raise

def self_test_mount_source():
    volume_root = "/docker/volumes/jenn-shooting-operations_shooting_data/_data"
    synthetic_mountinfo = "\n".join([
        "10 1 252:16 / /mnt/datadisk0 rw,relatime - ext4 /dev/vdb rw",
        f"11 1 252:16 {volume_root} /srv/db-alias rw,relatime - ext4 /dev/vdb rw",
        f"12 1 252:16 {volume_root}/shooting-operations.sqlite /srv/db-file rw,relatime - ext4 /dev/vdb rw",
        "13 1 252:16 /docker /srv/docker-alias rw,relatime - ext4 /dev/vdb rw",
        "14 1 252:16 /unrelated /srv/unrelated rw,relatime - ext4 /dev/vdb rw",
        "15 1 0:99 / /tmp rw,relatime - tmpfs tmpfs rw",
        "16 1 0:4 net:[4026532564] /run/docker/netns/example rw - nsfs nsfs rw",
    ])
    if not mount_source_can_access_active_db(str(EXPECTED_VOLUME_MOUNTPOINT), synthetic_mountinfo):
        raise RuntimeError("G3_MOUNT_SOURCE_SELF_TEST_PARENT_FAILED")
    if not mount_source_can_access_active_db(str(ACTIVE_DB), synthetic_mountinfo):
        raise RuntimeError("G3_MOUNT_SOURCE_SELF_TEST_FILE_FAILED")
    if not mount_source_can_access_active_db("/srv/db-alias", synthetic_mountinfo):
        raise RuntimeError("G3_MOUNT_SOURCE_SELF_TEST_ALIAS_DIR_FAILED")
    if not mount_source_can_access_active_db("/srv/db-file", synthetic_mountinfo):
        raise RuntimeError("G3_MOUNT_SOURCE_SELF_TEST_ALIAS_FILE_FAILED")
    if not mount_source_can_access_active_db(
      "/srv/docker-alias/volumes/jenn-shooting-operations_shooting_data/_data",
      synthetic_mountinfo,
    ):
        raise RuntimeError("G3_MOUNT_SOURCE_SELF_TEST_ALIAS_PARENT_FAILED")
    if mount_source_can_access_active_db(str(EXPECTED_VOLUME_MOUNTPOINT / "uploads"), synthetic_mountinfo):
        raise RuntimeError("G3_MOUNT_SOURCE_SELF_TEST_CHILD_FALSE_POSITIVE")
    if mount_source_can_access_active_db("/srv/unrelated", synthetic_mountinfo):
        raise RuntimeError("G3_MOUNT_SOURCE_SELF_TEST_SAME_FS_FALSE_POSITIVE")
    if mount_source_can_access_active_db("/tmp", synthetic_mountinfo):
        raise RuntimeError("G3_MOUNT_SOURCE_SELF_TEST_UNRELATED_FALSE_POSITIVE")

    db_device, db_fs_path = mount_identity_for_path(ACTIVE_DB, synthetic_mountinfo)
    recursive_container_mountinfo = "\n".join([
        "20 1 252:16 /shared /container/shared rw,relatime - ext4 /dev/vdb rw",
        f"21 20 252:16 {volume_root} /container/shared/prod rw,relatime - ext4 /dev/vdb rw",
        "22 1 0:99 / /proc rw,nosuid,nodev,noexec - proc proc rw",
    ])
    if not mountinfo_can_access_filesystem_path(
      recursive_container_mountinfo, db_device, db_fs_path
    ):
        raise RuntimeError("G3_MOUNT_SOURCE_SELF_TEST_RECURSIVE_SUBMOUNT_FAILED")
    unrelated_container_mountinfo = "\n".join([
        "30 1 252:16 /shared /container/shared rw,relatime - ext4 /dev/vdb rw",
        "31 1 252:16 /unrelated /container/unrelated rw,relatime - ext4 /dev/vdb rw",
    ])
    if mountinfo_can_access_filesystem_path(
      unrelated_container_mountinfo, db_device, db_fs_path
    ):
        raise RuntimeError("G3_MOUNT_SOURCE_SELF_TEST_RECURSIVE_FALSE_POSITIVE")
    print(json.dumps({"status": "G3_MOUNT_SOURCE_SELF_TEST_PASS"}))

def self_test_approval_signature():
    verify_approval_signature(
        APPROVAL_SIGNATURE_SELF_TEST_MESSAGE,
        APPROVAL_SIGNATURE_SELF_TEST_B64,
    )
    print(json.dumps({
        "status": "G3_APPROVAL_SIGNATURE_SELF_TEST_PASS",
        "signingKeyId": APPROVAL_SIGNING_KEY_ID,
    }, sort_keys=True))

def self_test_exchange():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        left = root / "left"
        right = root / "right"
        left.write_bytes(b"schema10")
        right.write_bytes(b"schema11")
        rename_exchange(left, right)
        if left.read_bytes() != b"schema11" or right.read_bytes() != b"schema10":
            raise RuntimeError("G3_RENAME_EXCHANGE_SELF_TEST_FAILED")
    print(json.dumps({"status":"G3_RENAME_EXCHANGE_SELF_TEST_PASS","automaticRetryAllowed":False}))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test-exchange", action="store_true")
    parser.add_argument("--self-test-approval-signature", action="store_true")
    parser.add_argument("--self-test-mount-source", action="store_true")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--approved-packet")
    parser.add_argument("--approval-record")
    parser.add_argument("--preparation-record")
    args = parser.parse_args()
    self_tests = [
        args.self_test_exchange,
        args.self_test_approval_signature,
        args.self_test_mount_source,
    ]
    if any(self_tests):
        if args.execute or args.approved_packet or args.approval_record or args.preparation_record \
          or sum(bool(value) for value in self_tests) != 1:
            raise SystemExit("self-test must be isolated")
        if args.self_test_exchange:
            self_test_exchange()
        elif args.self_test_approval_signature:
            self_test_approval_signature()
        else:
            self_test_mount_source()
        return
    if not args.execute or not args.approved_packet or not args.approval_record or not args.preparation_record:
        raise SystemExit(
            "G3 executable mode requires --execute, --approved-packet, "
            "--approval-record and --preparation-record"
        )
    execute(Path(args.approved_packet), Path(args.approval_record), Path(args.preparation_record))

if __name__ == "__main__":
    main()
