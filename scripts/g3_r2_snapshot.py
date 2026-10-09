"""Private 8 MiB tmpfs interpretation of exact approved bytes; originals never opened by SQLite."""
import ctypes
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
from urllib.parse import quote

from g3_r2_common import COPY_BUDGET, need, sha, load_r1

LIBC = ctypes.CDLL(None, use_errno=True)
CLONE_NEWNS = 0x00020000
MS_REC = 16384
MS_PRIVATE = 1 << 18


def syscall(name, *args):
    if getattr(LIBC, name)(*args) != 0:
        raise OSError(ctypes.get_errno(), name + '_FAILED')


class PrivateCopies:
    def __init__(self):
        self.path = None
        self.mounted = False
        self.cleanup_confirmed = False

    def __enter__(self):
        need(os.geteuid() == 0, 'ROOT_PRIVATE_NAMESPACE_REQUIRED')
        old = os.readlink('/proc/self/ns/mnt')
        syscall('unshare', CLONE_NEWNS)
        need(os.readlink('/proc/self/ns/mnt') != old, 'MOUNT_NAMESPACE_NOT_ISOLATED')
        syscall('mount', None, b'/', None, MS_REC | MS_PRIVATE, None)
        # No mount may still propagate to the original host namespace.
        for line in Path('/proc/self/mountinfo').read_text().splitlines():
            optional = line.split(' - ', 1)[0].split()[6:]
            need(not any(x.startswith(('shared:', 'master:', 'propagate_from:')) for x in optional), 'MOUNT_PROPAGATION_PRESENT')
        self.path = Path(tempfile.mkdtemp(prefix='jso-g3-r2-', dir='/run'))
        try:
            syscall('mount', b'tmpfs', os.fsencode(self.path), b'tmpfs', 2 | 4 | 8,
                    b'size=8388608,mode=0700,uid=0,gid=0')
            self.mounted = True
            need(os.stat(self.path).st_uid == 0 and (os.stat(self.path).st_mode & 0o777) == 0o700, 'TMPFS_CUSTODY')
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def create(self, originals, expected):
        sizes = [os.fstat(fd).st_size for fd in originals.values()]
        need(all(0 < n <= COPY_BUDGET for n in sizes) and sum(sizes) <= COPY_BUDGET, 'COPY_SIZE_BUDGET')
        paths = {}
        for side, source in originals.items():
            path = self.path / (side + '.sqlite')
            out = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
            import hashlib
            digest = hashlib.sha256()
            try:
                size = os.fstat(source).st_size
                for offset in range(0, size, 65536):
                    raw = os.pread(source, min(65536, size - offset), offset)
                    need(len(raw) == min(65536, size - offset), 'COPY_SHORT_READ')
                    digest.update(raw)
                    view = memoryview(raw)
                    while view:
                        written = os.write(out, view)
                        need(written > 0, 'COPY_SHORT_WRITE')
                        view = view[written:]
                os.fsync(out)
            finally:
                os.close(out)  # All writable handles are closed before any SQLite connection.
            need('sha256:' + digest.hexdigest() == expected[side]['sha256'], 'ORIGINAL_COPY_DIGEST')
            need('sha256:' + sha(path.read_bytes()) == expected[side]['sha256'], 'COPY_DIGEST')
            paths[side] = path
        need(set(x.name for x in self.path.iterdir()) == {'active.sqlite', 'prestate.sqlite'}, 'COPY_SIDECAR')
        return paths

    def __exit__(self, *_):
        # Only our two copies and our mount/directory. Unknown residue is not recursively deleted.
        if self.path is None:
            return
        if self.mounted:
            expected = {'active.sqlite', 'prestate.sqlite'}
            names = {p.name for p in self.path.iterdir()}
            residue = names - expected
            if residue:
                # Unmount discards only this private tmpfs; still reject unknown SQLite sidecars.
                syscall('umount2', os.fsencode(self.path), 0)
                self.mounted = False
                self.path.rmdir()
                self.cleanup_confirmed = True
                raise ValueError('COPY_SIDECAR_OR_UNEXPECTED_RESIDUE')
            for p in self.path.iterdir():
                need(p.is_file() and not p.is_symlink(), 'COPY_CLEANUP_OBJECT')
                p.unlink()
            syscall('umount2', os.fsencode(self.path), 0)
            self.mounted = False
        self.path.rmdir()
        self.cleanup_confirmed = not self.path.exists()
        need(self.cleanup_confirmed, 'CLEANUP_NOT_CONFIRMED')


def inspect_copy(path):
    need(path.is_file() and not path.is_symlink(), 'COPY_TYPE')
    for suffix in ('-wal', '-shm', '-journal'):
        need(not os.path.lexists(str(path) + suffix), 'COPY_SIDECAR')
    conn = sqlite3.connect('file:' + quote(str(path), safe='/') + '?mode=ro&immutable=1', uri=True, isolation_level=None)
    try:
        conn.execute('PRAGMA query_only=ON')
        return inspect_connection(conn)
    finally:
        conn.close()
        for suffix in ('-wal', '-shm', '-journal'):
            need(not os.path.lexists(str(path) + suffix), 'COPY_SIDECAR')


# Kept equivalent to the pinned R1 connection checks; tested against R1 on 1/1.
w = load_r1()
ident, rowset, HEADER_SAME, HEADER_EXCLUDED = w.ident, w.rowset, w.HEADER_SAME, w.HEADER_EXCLUDED
import hashlib
import json


def inspect_connection(conn):
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
