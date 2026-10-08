#!/usr/bin/env python3
"""Bounded, read-only G3 baseline observation. Never grants adoption authority."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import struct
import sys

DOMAIN = "G3_FORWARD_ADOPTION_OBSERVATION_R1"
MAX_DATABASE_BYTES = 64 * 1024 * 1024
MIGRATION11 = "sha256:13d9f5fc6e09be77742935d0b7e1478c500c69adf7b313eb3b8499c65f0f25e8"
EXPECTED = {
    "prestate": {
        "hash": "5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7",
        "schema": "c9dc6643560b4439f2a635bbc71107eca3b2130589f453dbeb472d2101117e39",
        "columns": "2af54e93c3ed07ca86aa43a2b1a4aad8a263fef2aaefc45c7867939d01b72bf2",
    },
    "active": {
        "hash": "0eae48b85f362cf1064f92e14511865fe7fd68dbc13a85d4c6efd6e656e736d9",
        "schema": "06a1e4b55b0f022bce9d8b2427bd844be6e8b7afe4afa0d6c49547c5ce0c753d",
        "columns": "eb832e1a61e67fda4327ba31dd4a162e9b9e8a965e1318a28f2d5a2041f9d204",
    },
}
NEW_TABLES = {"agent_grant_attempts", "schedule_reschedule_operations"}
HEADER_SAME = ("application_id", "user_version", "encoding", "page_size", "auto_vacuum")
HEADER_EXCLUDED = {
    "schema_version": "schema objects changed by Migration11",
    "page_count": "physical allocation is outside application semantic equivalence",
    "freelist_count": "free-page layout is outside application semantic equivalence",
    "cache_size": "connection-local, not persistent production state",
    "synchronous": "connection-local, controlled separately at admission",
    "data_version": "connection-local read counter",
    "journal_mode": "in-memory deserialize reports memory, not the source file's journal mode; source file header versions are checked separately",
}
NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def digest(value):
    return "sha256:" + hashlib.sha256(canonical(value)).hexdigest()


def ident(value):
    if not isinstance(value, str) or not NAME.fullmatch(value):
        raise ValueError("UNSAFE_OR_UNKNOWN_SQL_IDENTIFIER")
    return '"' + value + '"'


def typed(value):
    if value is None:
        return b"N"
    if isinstance(value, bytes):
        return b"B" + len(value).to_bytes(8, "big") + value
    if isinstance(value, str):
        b = value.encode("utf-8", "strict")
        return b"T" + len(b).to_bytes(8, "big") + b
    if isinstance(value, int):
        return b"I" + str(value).encode("ascii") + b";"
    if isinstance(value, float):
        return b"F" + struct.pack(">d", value)
    raise ValueError("UNSUPPORTED_SQLITE_VALUE_TYPE")


def row_digest(row):
    fields = [typed(value) for value in row]
    framed = b"".join(len(field).to_bytes(8, "big") + field for field in fields)
    return hashlib.sha256(b"G3_ROW_R1\x00" + framed).digest()


def rowset(conn, table, include_rowid):
    sql = "SELECT " + ("rowid, " if include_rowid else "") + "* FROM " + ident(table)
    cur = conn.execute(sql)
    columns = [x[0] for x in cur.description]
    items = []
    for row in cur:
        items.append(row_digest(row))
        if len(items) > 250000:
            raise ValueError("ROW_COUNT_BOUND_EXCEEDED")
    items.sort()
    h = hashlib.sha256(b"G3_ROWSET_R1\x00")
    for item in items:
        h.update(item)
    return {"columns": columns, "rowCount": len(items), "rowSetSha256": "sha256:" + h.hexdigest()}


def sample_snapshot(fd, expected_hash=None):
    before = os.fstat(fd)
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
        raise ValueError("NONREGULAR_OR_LINKED_DATABASE")
    if not 0 < before.st_size <= MAX_DATABASE_BYTES:
        raise ValueError("DATABASE_SIZE_BOUND")
    chunks = []
    h = hashlib.sha256()
    for offset in range(0, before.st_size, 1048576):
        data = os.pread(fd, min(1048576, before.st_size - offset), offset)
        if len(data) != min(1048576, before.st_size - offset):
            raise ValueError("SHORT_READ")
        chunks.append(data)
        h.update(data)
    blob = b"".join(chunks)
    if blob[:16] != b"SQLite format 3" + bytes([0]) or (blob[18], blob[19]) != (1, 1):
        raise ValueError("SQLITE_HEADER_OR_JOURNAL_FORMAT_INVALID")
    digest_hex = h.hexdigest()
    if expected_hash and digest_hex != expected_hash:
        raise ValueError("FILE_HASH_MISMATCH")
    after = os.fstat(fd)
    attrs = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns", "st_mode", "st_uid", "st_gid", "st_nlink")
    if any(getattr(before, k) != getattr(after, k) for k in attrs):
        raise ValueError("FILE_CHANGED_WHILE_OBSERVED")
    return b"".join(chunks), {
        "device": before.st_dev, "inode": before.st_ino, "size": before.st_size,
        "mode": stat.S_IMODE(before.st_mode), "uid": before.st_uid,
        "gid": before.st_gid, "nlink": before.st_nlink,
        "sha256": "sha256:" + digest_hex,
        "fileFormatRead": blob[19], "fileFormatWrite": blob[18],
        "headerPageSizeBytes": int.from_bytes(blob[16:18], "big") or 65536,
    }


def open_pinned(path):
    p = Path(path)
    if not p.is_absolute():
        raise ValueError("PATH_MUST_BE_ABSOLUTE")
    fd = os.open(str(p), os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
        os.close(fd)
        raise ValueError("NONREGULAR_OR_LINKED_DATABASE")
    path_stat = os.stat(str(p), follow_symlinks=False)
    if (path_stat.st_dev, path_stat.st_ino) != (st.st_dev, st.st_ino):
        os.close(fd)
        raise ValueError("PATH_INODE_RACE")
    for suffix in ("-wal", "-shm", "-journal"):
        if os.path.lexists(str(p) + suffix):
            os.close(fd)
            raise ValueError("DATABASE_SIDECAR_PRESENT")
    return fd


def inspect_database(blob):
    conn = sqlite3.connect(":memory:", isolation_level=None)
    try:
        conn.deserialize(blob)
        conn.execute("PRAGMA query_only=ON")
        schema = [list(r) for r in conn.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name,tbl_name,sql"
        )]
        schema_digest = "sha256:" + hashlib.sha256(
            json.dumps(schema, ensure_ascii=False, separators=(",", ":"), sort_keys=False).encode()
        ).hexdigest()
        tables = sorted(r[1] for r in schema if r[0] == "table")
        indexes = sorted(r[1] for r in schema if r[0] == "index")
        xinfo = {t: [list(x) for x in conn.execute("PRAGMA table_xinfo(" + ident(t) + ")")] for t in tables}
        columns_digest = "sha256:" + hashlib.sha256(
            json.dumps(xinfo, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
        ).hexdigest()
        index_meta = {i: [list(x) for x in conn.execute("PRAGMA index_xinfo(" + ident(i) + ")")] for i in indexes}
        foreign_keys = {t: [list(x) for x in conn.execute("PRAGMA foreign_key_list(" + ident(t) + ")")] for t in tables}
        table_meta = {t: [list(x) for x in conn.execute("PRAGMA index_list(" + ident(t) + ")")] for t in tables}
        # table_list is used solely to discriminate WITHOUT ROWID tables, never a row sample.
        table_list = {r[1]: list(r) for r in conn.execute("PRAGMA table_list") if r[1] in tables}
        if set(table_list) != set(tables):
            raise ValueError("TABLE_LIST_INCOMPLETE")
        all_rows = {
            t: rowset(conn, t, include_rowid=(table_list[t][4] == 0))
            for t in tables
        }
        headers = {p: conn.execute("PRAGMA " + p).fetchone()[0] for p in HEADER_SAME}
        integrity = [r[0] for r in conn.execute("PRAGMA integrity_check")]
        fk_count = sum(1 for _ in conn.execute("PRAGMA foreign_key_check"))
        markers = [list(r) for r in conn.execute(
            "SELECT version,name,checksum,applied_at FROM schema_migrations ORDER BY version"
        )]
        return {
            "schemaDigest": schema_digest, "columnsDigest": columns_digest,
            "indexXinfo": index_meta, "foreignKeys": foreign_keys,
            "indexList": table_meta, "tableList": table_list,
            "tables": all_rows, "header": headers, "markers": markers,
            "integrity": integrity, "foreignKeyViolations": fk_count,
            "schemaObjects": len(schema), "excludedHeaderFields": HEADER_EXCLUDED
        }
    finally:
        conn.close()


def prove(pre, active, profile):
    problems = []
    common = sorted(set(pre["tables"]) & set(active["tables"]))
    legacy = [t for t in common if t != "schema_migrations"]
    for t in legacy:
        if pre["tables"][t] != active["tables"][t]:
            problems.append("LEGACY_TABLE_ROWSET_MISMATCH:" + t)
    for t in set(pre["tables"]) - set(active["tables"]):
        problems.append("REMOVED_TABLE:" + t)
    for t in sorted(set(active["tables"]) - set(pre["tables"])):
        if profile == "g3" and t not in NEW_TABLES:
            problems.append("UNEXPECTED_ADDED_TABLE:" + t)
        if active["tables"][t]["rowCount"]:
            problems.append("ADDED_TABLE_NONEMPTY:" + t)
    if pre["markers"] != active["markers"][:len(pre["markers"])]:
        problems.append("HISTORICAL_MIGRATION_RECORD_CHANGED")
    if profile == "g3":
        if len(pre["markers"]) != 10 or len(active["markers"]) != 11:
            problems.append("UNEXPECTED_MIGRATION_MARKER_COUNT")
        else:
            m = active["markers"][-1]
            if m[:3] != [11, "business_calendar_and_reschedule", MIGRATION11]:
                problems.append("MIGRATION11_IDENTITY_INVALID")
            if not isinstance(m[3], str) or not re.fullmatch(
                r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", m[3]
            ):
                problems.append("MIGRATION11_TIMESTAMP_INVALID")
        for key, current in (("prestate", pre), ("active", active)):
            if current["schemaDigest"] != "sha256:" + EXPECTED[key]["schema"]:
                problems.append("SCHEMA_MANIFEST_DRIFT:" + key)
            if current["columnsDigest"] != "sha256:" + EXPECTED[key]["columns"]:
                problems.append("COLUMN_MANIFEST_DRIFT:" + key)
        if set(active["tables"]) - set(pre["tables"]) != NEW_TABLES:
            problems.append("NEW_TABLE_SET_INVALID")
        if len(legacy) != 38:
            problems.append("LEGACY_TABLE_COVERAGE_INVALID")
    for field in HEADER_SAME:
        if pre["header"][field] != active["header"][field]:
            problems.append("HEADER_DRIFT:" + field)
    if pre["integrity"] != ["ok"] or active["integrity"] != ["ok"]:
        problems.append("SQLITE_INTEGRITY_FAILED")
    if pre["foreignKeyViolations"] or active["foreignKeyViolations"]:
        problems.append("SQLITE_FOREIGN_KEYS_FAILED")
    for t in legacy:
        if pre["foreignKeys"][t] != active["foreignKeys"][t]:
            problems.append("FOREIGN_KEY_METADATA_DRIFT:" + t)
        # Changes to index definitions of the rebuilt table are assessed through
        # exact frozen schema digest, not silently accepted as equal by name.
        if t != "scheduling_config_versions":
            if pre["indexList"][t] != active["indexList"][t]:
                problems.append("INDEX_LIST_DRIFT:" + t)
            if pre["tableList"][t][3:] != active["tableList"][t][3:]:
                problems.append("TABLE_FLAGS_DRIFT:" + t)
    for idx in sorted(set(pre["indexXinfo"]) & set(active["indexXinfo"])):
        if idx.startswith("sqlite_autoindex_scheduling_config_versions"):
            continue  # Schema rebuilt; full schema digest pins exact definitions.
        if pre["indexXinfo"][idx] != active["indexXinfo"][idx]:
            problems.append("INDEX_METADATA_DRIFT:" + idx)
    return sorted(set(problems)), legacy


def capture(prestate_path, active_path, profile):
    fps = []
    try:
        for path in (prestate_path, active_path):
            fps.append(open_pinned(path))
        if os.fstat(fps[0]).st_dev == os.fstat(fps[1]).st_dev and os.fstat(fps[0]).st_ino == os.fstat(fps[1]).st_ino:
            raise ValueError("SAME_PHYSICAL_FILE")
        blobs = []
        identities = []
        for fd, name in zip(fps, ("prestate", "active")):
            expected_hash = EXPECTED[name]["hash"] if profile == "g3" else None
            blob, identity = sample_snapshot(fd, expected_hash)
            blobs.append(blob)
            identities.append(identity)
        pre, active = [inspect_database(blob) for blob in blobs]
        problems, legacy = prove(pre, active, profile)
        # Re-read the exact opened descriptors rather than path names; reject any changed
        # identity, path rebind or hash during the read-only SQLite analysis.
        for fd, path, original in zip(fps, (prestate_path, active_path), identities):
            _, after = sample_snapshot(fd, original["sha256"].removeprefix("sha256:"))
            if after != original:
                raise ValueError("FILE_IDENTITY_CHANGED_AFTER_PROOF")
            st = os.stat(path, follow_symlinks=False)
            if (st.st_dev, st.st_ino) != (original["device"], original["inode"]):
                raise ValueError("PATH_REBOUND_DURING_PROOF")
            for suffix in ("-wal", "-shm", "-journal"):
                if os.path.lexists(path + suffix):
                    raise ValueError("DATABASE_SIDECAR_CREATED_DURING_PROOF")
        artifact = {
            "domain": DOMAIN, "profile": profile,
            "verifierSha256": "sha256:" + hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "runtime": {"python": sys.version.split()[0], "sqlite": sqlite3.sqlite_version},
            "sampling": "PINNED_READONLY_FD_IN_MEMORY_SQLITE",
            "fileIdentities": dict(zip(("prestate", "active"), identities)),
            "prestate": {
                "schemaSha256": pre["schemaDigest"], "columnSha256": pre["columnsDigest"],
                "indexXinfoSha256": digest(pre["indexXinfo"]), "foreignKeysSha256": digest(pre["foreignKeys"]),
                "indexListSha256": digest(pre["indexList"]), "tableListSha256": digest(pre["tableList"]),
                "headers": pre["header"], "tables": pre["tables"],
            },
            "active": {
                "schemaSha256": active["schemaDigest"], "columnSha256": active["columnsDigest"],
                "indexXinfoSha256": digest(active["indexXinfo"]), "foreignKeysSha256": digest(active["foreignKeys"]),
                "indexListSha256": digest(active["indexList"]), "tableListSha256": digest(active["tableList"]),
                "headers": active["header"], "tables": active["tables"],
            },
            "comparedLegacyTables": len(legacy),
            "schemaMigrationPrefixSha256": digest(pre["markers"]),
            "excludedMetadata": HEADER_EXCLUDED,
            "problems": problems,
            "durableWriteCapabilityRevocation": "NOT_ATTESTED",
            "productionOriginSignature": "NOT_PRESENT",
            "historicalG3Governance": "RECONCILIATION_REQUIRED",
            "oldRollbackStatus": "UNKNOWN",
            "adoptionAuthorityAllowed": False,
            "writerReadmissionAllowed": False,
            "serviceStartAllowed": False,
            "g4Allowed": False,
        }
        artifact["captureDigest"] = digest(artifact)
        artifact["status"] = "READONLY_OBSERVATION_NOT_AUTHORITY" if not problems else "PARITY_REJECTED"
        return artifact
    finally:
        for fd in fps:
            os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prestate", required=True)
    parser.add_argument("--active", required=True)
    parser.add_argument("--profile", choices=("g3", "synthetic"), default="g3")
    args = parser.parse_args()
    try:
        record = capture(args.prestate, args.active, args.profile)
        print(canonical(record).decode())
        if record["status"] != "READONLY_OBSERVATION_NOT_AUTHORITY":
            return 2
    except (ValueError, OSError, sqlite3.Error, UnicodeError) as exc:
        print(canonical({"status": "WITNESS_FAIL_CLOSED", "code": str(exc), "adoptionAuthorityAllowed": False}).decode())
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
