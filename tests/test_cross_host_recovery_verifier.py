import importlib.util
import hashlib
import json
from pathlib import Path
import sqlite3
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

    def seal(self):
        d = sqlite3.connect(self.database)
        tables = {}
        for (n,) in d.execute("SELECT name FROM sqlite_master WHERE type='table'"):
            rows = d.execute('SELECT * FROM "'+n+'"').fetchall()
            lines = sorted(json.dumps(list(r),sort_keys=True,ensure_ascii=False,separators=(',',':')) for r in rows)
            tables[n] = {'count':len(rows),'sha256':hashlib.sha256('\n'.join(lines).encode()).hexdigest()}
        d.close()
        self.manifest.write_text(json.dumps({'facts':{'tables':tables,'schemaVersion':12,'scheduleRevision':15,'projectionRevision':26}}))

    def test_verified_snapshot_does_not_change_bytes_or_create_sidefiles(self):
        before = self.database.read_bytes()
        result = verifier.verify(self.root,self.manifest)
        self.assertTrue(result['ok'])
        self.assertEqual(result['verifiedAttachments'],1)
        self.assertEqual(before,self.database.read_bytes())
        self.assertFalse(Path(str(self.database)+'-wal').exists())

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
