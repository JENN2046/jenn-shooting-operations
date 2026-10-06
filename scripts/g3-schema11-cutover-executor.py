#!/usr/bin/env python3
import argparse
import ctypes
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
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

def verify_no_running_volume_users():
    ids = subprocess.check_output(["docker", "ps", "-q"], text=True).split()
    users = []
    for cid in ids:
        mounts = json.loads(docker_json(["inspect", cid, "--format", "{{json .Mounts}}"]))
        if any(m.get("Name") == VOLUME_NAME for m in mounts):
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

def migrate_isolated_candidate(workdir: Path):
    candidate = workdir / "candidate.sqlite"
    shutil.copy2(ACTIVE_DB, candidate)
    fsync_file(candidate)
    fsync_dir(workdir)
    if sha256_file(candidate) != EXPECTED_SCHEMA10_SHA256:
        raise RuntimeError("G3_CANDIDATE_COPY_MISMATCH")
    subprocess.run([
        "docker", "run", "--rm", "--network", "none", "--read-only",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
        "--pids-limit", "64", "--memory", "256m", "--cpus", "1",
        "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m",
        "--user", "1000:1000",
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

def execute(authority_target_digest: str):
    exchanged = False
    verify_active_prestate()
    verify_image()
    if os.stat(ACTIVE_DB).st_dev != os.stat(ACTIVE_DB.parent).st_dev:
        raise RuntimeError("G3_ACTIVE_DB_DEVICE_MISMATCH")
    attempt = claim_attempt(authority_target_digest)
    workdir = CONTROL_ROOT / OPERATION_ID
    if workdir.exists():
        raise RuntimeError("RECONCILIATION_REQUIRED")
    workdir.mkdir(parents=True, mode=0o700)
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
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--authority-target-digest")
    args = parser.parse_args()
    if args.self_test_exchange:
        if args.execute or args.authority_target_digest is not None:
            raise SystemExit("self-test must be isolated")
        self_test_exchange()
        return
    if not args.execute or not args.authority_target_digest:
        raise SystemExit("G3 executable mode requires --execute and --authority-target-digest")
    execute(args.authority_target_digest)

if __name__ == "__main__":
    main()
