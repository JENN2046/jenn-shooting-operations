import importlib.util
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3
import shutil
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('recovery_verifier', Path(__file__).parents[1] / 'scripts/verify-cross-host-recovery.py')
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class RecoveryVerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.database = self.root / 'shooting-operations.sqlite'
        self.manifest = self.root / 'snapshot-manifest.json'
        (self.root / 'uploads').mkdir()
        (self.root / 'uploads/synthetic.bin').write_bytes(b'synthetic')
        d = sqlite3.connect(self.database)
        d.executescript('CREATE TABLE schema_migrations(version INTEGER); INSERT INTO schema_migrations VALUES(12);'
                        'CREATE TABLE revision_counters(id INTEGER, schedule_revision INTEGER, projection_revision INTEGER);'
                        'INSERT INTO revision_counters VALUES(1,15,26);'
                        'CREATE TABLE uploads(stored_name TEXT,sha256 TEXT);')
        d.execute('INSERT INTO uploads VALUES(?,?)', ('synthetic.bin', hashlib.sha256(b'synthetic').hexdigest()))
        d.commit();d.close()
        self.seal()

    def tearDown(self):
        self.temp.cleanup()

    def seal(self, connection=None):
        d = connection if connection is not None else sqlite3.connect(self.database)
        tables = {}
        for (n,) in d.execute("SELECT name FROM sqlite_master WHERE type='table'"):
            rows = d.execute('SELECT * FROM "'+n+'"').fetchall()
            lines = sorted(json.dumps(list(r),sort_keys=True,ensure_ascii=False,separators=(',',':')) for r in rows)
            tables[n] = {'count':len(rows),'sha256':hashlib.sha256('\n'.join(lines).encode()).hexdigest()}
        revisions = d.execute('SELECT schedule_revision,projection_revision FROM revision_counters WHERE id=1').fetchone()
        if connection is None:
            d.close()
        self.manifest.write_text(json.dumps({'facts':{'tables':tables,'schemaVersion':12,'scheduleRevision':revisions[0],'projectionRevision':revisions[1]}}))

    @contextmanager
    def sealed_readonly(self, root):
        paths = [root, *root.rglob('*')]
        modes = {p: p.stat().st_mode & 0o777 for p in paths}
        try:
            for p in paths:
                p.chmod(0o555 if p.is_dir() else 0o444)
            yield
        finally:
            # Allow fixture cleanup even when a regression creates sidecars.
            for p in paths:
                p.chmod(modes[p])

    def file_state(self, root):
        return {str(p.relative_to(root)): (p.stat().st_mtime_ns,
                p.stat().st_mode & 0o777, p.read_bytes() if p.is_file() else None)
                for p in [root, *root.rglob('*')]}

    def test_verified_snapshot_does_not_change_bytes_or_create_sidefiles(self):
        before = self.database.read_bytes()
        result = verifier.verify(self.root,self.manifest)
        self.assertTrue(result['ok'])
        self.assertEqual(result['verifiedAttachments'],1)
        self.assertEqual(before,self.database.read_bytes())
        self.assertFalse(Path(str(self.database)+'-wal').exists())

    def test_closed_wal_database_on_readonly_storage_creates_no_snapshot_sidefiles(self):
        d = sqlite3.connect(self.database)
        self.assertEqual(d.execute('PRAGMA journal_mode=WAL').fetchone()[0], 'wal')
        d.close()
        self.assertEqual(self.database.read_bytes()[18:20], b'\x02\x02')
        self.assertFalse(Path(str(self.database)+'-wal').exists())
        self.assertFalse(Path(str(self.database)+'-shm').exists())
        with self.sealed_readonly(self.root):
            before = self.file_state(self.root)
            self.assertTrue(verifier.verify(self.root, self.manifest)['ok'])
            self.assertEqual(self.file_state(self.root), before)

    def test_committed_wal_is_verified_without_touching_sealed_family(self):
        writer = sqlite3.connect(self.database)
        try:
            self.assertEqual(writer.execute('PRAGMA journal_mode=WAL').fetchone()[0], 'wal')
            writer.execute('PRAGMA wal_autocheckpoint=0')
            main_before = self.database.read_bytes()
            writer.execute('UPDATE revision_counters SET schedule_revision=16')
            writer.commit()
            # The committed update is only in WAL. Copying/reading just main
            # would incorrectly verify revision 15 instead of revision 16.
            self.assertEqual(self.database.read_bytes(), main_before)
            self.assertGreater(Path(str(self.database)+'-wal').stat().st_size, 0)
            self.seal(writer)
            for include_shm in [False, True]:
                with self.subTest(include_shm=include_shm), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    for suffix in ['', '-wal', *(['-shm'] if include_shm else [])]:
                        shutil.copyfile(Path(str(self.database)+suffix), root/(self.database.name+suffix))
                    shutil.copytree(self.root/'uploads', root/'uploads')
                    manifest = root/self.manifest.name
                    shutil.copyfile(self.manifest, manifest)
                    with self.sealed_readonly(root):
                        before = self.file_state(root)
                        result = verifier.verify(root, manifest)
                        self.assertTrue(result['ok'])
                        self.assertEqual(result['scheduleRevision'], 16)
                        self.assertEqual(self.file_state(root), before)
        finally:
            writer.close()

    def test_changed_facts_are_not_accepted_as_the_sealed_snapshot(self):
        d=sqlite3.connect(self.database);d.execute('UPDATE revision_counters SET schedule_revision=16');d.commit();d.close()
        before=self.database.read_bytes()
        with self.assertRaisesRegex(ValueError,'SNAPSHOT_FACTS_MISMATCH'):verifier.verify(self.root,self.manifest)
        self.assertEqual(before,self.database.read_bytes())

    def test_attachment_corruption_is_detected_without_repair(self):
        (self.root/'uploads/synthetic.bin').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'ATTACHMENT_DIGEST_MISMATCH'):verifier.verify(self.root,self.manifest)
        self.assertEqual((self.root/'uploads/synthetic.bin').read_bytes(),b'changed')

    def test_missing_database_is_not_created(self):
        self.database.unlink()
        with self.assertRaises(sqlite3.OperationalError):verifier.verify(self.root,self.manifest)
        self.assertFalse(self.database.exists())

    def test_live_volume_cannot_be_used_as_a_detached_snapshot(self):
        with self.assertRaisesRegex(ValueError,'DETACHED_SNAPSHOT_REQUIRED'):
            verifier.verify('/app/data',self.manifest)


if __name__=='__main__':unittest.main()
