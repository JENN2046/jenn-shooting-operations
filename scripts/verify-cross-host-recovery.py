"""Read-only verification of a detached JSO recovery snapshot; never restores it."""
import argparse
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3
import shutil
import tempfile


@contextmanager
def snapshot_connection(database):
    # mode=ro/query_only do not stop SQLite creating WAL/SHM files. Never open
    # the sealed database itself. Rebuild the WAL index in private scratch space;
    # immutable=1 on the original would silently ignore committed WAL contents.
    # This is a sealed, detached family, not a concurrent-writer backup API.
    def family():
        result = {}
        for suffix in ['', '-wal', '-shm', '-journal']:
            path = Path(str(database) + suffix)
            if path.exists():
                stat = path.lstat()
                if path.is_symlink() or not path.is_file():
                    raise ValueError('SNAPSHOT_FILE_TYPE')
                result[suffix] = (stat.st_dev, stat.st_ino, stat.st_size,
                                  stat.st_mtime_ns, stat.st_ctime_ns)
        return result

    before = family()
    with tempfile.TemporaryDirectory(prefix='jso-recovery-verify-') as temporary:
        copied = Path(temporary) / database.name
        for suffix in ['', '-wal', '-journal']:
            if suffix in before:
                shutil.copyfile(Path(str(database) + suffix), Path(str(copied) + suffix))
        if '' not in before:
            raise sqlite3.OperationalError('SNAPSHOT_DATABASE_MISSING')
        if family() != before:
            raise ValueError('SNAPSHOT_CHANGED_DURING_COPY')
        connection = sqlite3.connect(copied.as_uri() + '?mode=ro', uri=True)
        try:
            yield connection
        finally:
            connection.close()


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def verify(root, manifest_path):
    original_root = Path(root)
    root = original_root.resolve(strict=False)
    for live in ['/app/data', '/var/lib/docker/volumes', '/mnt/datadisk0/docker/volumes']:
        resolved_live = Path(live).resolve(strict=False)
        if root == resolved_live or resolved_live in root.parents:
            raise ValueError('DETACHED_SNAPSHOT_REQUIRED')
    if original_root.is_symlink():
        raise ValueError('SNAPSHOT_SYMLINK')
    root = root.resolve(strict=True)
    if any(p.is_symlink() for p in root.rglob('*')):
        raise ValueError('SNAPSHOT_SYMLINK')
    expected = json.loads(Path(manifest_path).read_text(encoding='utf-8'))['facts']
    database = root / 'shooting-operations.sqlite'
    with snapshot_connection(database) as connection:
        connection.execute('PRAGMA query_only=ON;')
        connection.execute('BEGIN')
        if connection.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise ValueError('INTEGRITY_FAILED')
        if connection.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('FOREIGN_KEY_FAILED')
        tables = {}
        for (name,) in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
            quoted = '"' + name.replace('"', '""') + '"'
            rows = connection.execute('SELECT * FROM ' + quoted).fetchall()
            lines = sorted(json.dumps(list(row), sort_keys=True, ensure_ascii=False,
                                      separators=(',', ':'),
                                      default=lambda b: {'blobSha256': hashlib.sha256(b).hexdigest()})
                           for row in rows)
            tables[name] = {'count': len(rows), 'sha256': hashlib.sha256('\n'.join(lines).encode()).hexdigest()}
        schema = connection.execute('SELECT max(version) FROM schema_migrations').fetchone()[0]
        revisions = connection.execute('SELECT schedule_revision,projection_revision FROM revision_counters WHERE id=1').fetchone()
        actual = {'tables': tables, 'schemaVersion': schema,
                  'scheduleRevision': revisions[0], 'projectionRevision': revisions[1]}
        if schema != 12 or actual != expected:
            raise ValueError('SNAPSHOT_FACTS_MISMATCH')
        attachments = 0
        for name, expected_sha in connection.execute('SELECT stored_name,sha256 FROM uploads WHERE stored_name IS NOT NULL'):
            if Path(name).name != name or '/' in name or '\\' in name or name in ['.', '..']:
                raise ValueError('ATTACHMENT_PATH_INVALID')
            if sha(root / 'uploads' / name) != expected_sha:
                raise ValueError('ATTACHMENT_DIGEST_MISMATCH')
            attachments += 1
        return {'ok': True, 'schemaVersion': schema, 'businessTables': len(tables),
                'scheduleRevision': revisions[0], 'projectionRevision': revisions[1],
                'verifiedAttachments': attachments, 'businessMutations': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot-root', required=True)
    parser.add_argument('--manifest', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.snapshot_root, args.manifest)))
    except Exception as error:
        # Never print rows, SQL payloads, credentials, or SQLite error contents.
        print(json.dumps({'ok': False, 'errorType': type(error).__name__}))
        raise SystemExit(1)
