"""Independent synthetic witness negatives. Never use or copy production bytes."""
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/g3-forward-adoption-readonly-witness.py"
spec = importlib.util.spec_from_file_location("g3_witness", SCRIPT)
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


def fixture(path, *, reverse=False, additional=False, duplicate=False, changed_type=False,
            changed_rowid=False, index_desc=False, malformed=False, application_id=12):
    db = sqlite3.connect(str(path))
    try:
        db.execute("PRAGMA journal_mode=DELETE")
        db.execute("PRAGMA application_id=" + str(application_id))
        db.executescript("""
          CREATE TABLE schema_migrations
            (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
          CREATE TABLE records (id INTEGER PRIMARY KEY AUTOINCREMENT, txt TEXT, blob BLOB, nullable TEXT, amount REAL);
          CREATE TABLE repeated (entry TEXT, raw BLOB);
          CREATE INDEX records_amount_idx ON records(amount);
        """)
        for i in range(1, 11):
            db.execute("INSERT INTO schema_migrations VALUES (?,?,?,?)",
                       (i, "migration_" + str(i), "sha256:" + ("b" * 64), "2026-10-01T00:00:00.000Z"))
        for i in ([2, 1] if reverse else [1, 2]):
            db.execute("INSERT INTO records VALUES(?,?,?,?,?)", (i, "same", sqlite3.Binary(b"\x00\xff"), None, float(i)))
        db.execute("INSERT INTO repeated VALUES (?,?)", ("duplicate", sqlite3.Binary(b"z")))
        db.execute("INSERT INTO repeated VALUES (?,?)", ("duplicate", sqlite3.Binary(b"z")))
        if duplicate:
            db.execute("INSERT INTO repeated VALUES (?,?)", ("duplicate", sqlite3.Binary(b"z")))
        if changed_type:
            db.execute("UPDATE repeated SET raw=3 WHERE rowid=1")
        if changed_rowid:
            db.execute("DELETE FROM repeated WHERE rowid=1")
            db.execute("INSERT INTO repeated VALUES (?,?)", ("duplicate", sqlite3.Binary(b"z")))
        if index_desc:
            db.executescript("DROP INDEX records_amount_idx; CREATE INDEX records_amount_idx ON records(amount DESC);")
        if malformed:
            db.executescript('CREATE TABLE "bad;name" (value TEXT);')
        if additional:
            db.execute("INSERT INTO schema_migrations VALUES(?,?,?,?)",
                       (11, "test_migration_11", "sha256:" + ("c" * 64), "2026-10-08T00:00:00.000Z"))
            db.execute("CREATE TABLE additional_control (id TEXT)")
        db.commit()
    finally:
        db.close()


class WitnessFixtures(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory(prefix="jso-g3-witness-tests-")
        self.addCleanup(self.root.cleanup)
        self.pre = Path(self.root.name) / "pre.sqlite"
        self.active = Path(self.root.name) / "active.sqlite"

    def create(self, **kw):
        fixture(self.pre)
        fixture(self.active, additional=True, **kw)

    def capture(self):
        return w.capture(str(self.pre), str(self.active), "synthetic")

    def test_complete_rows_with_reordered_inserts_and_blob_null(self):
        self.create(reverse=True)
        record = self.capture()
        self.assertEqual(record["status"], "READONLY_OBSERVATION_NOT_AUTHORITY")
        self.assertEqual(record["problems"], [])
        self.assertFalse(record["adoptionAuthorityAllowed"])
        self.assertEqual(record["durableWriteCapabilityRevocation"], "NOT_ATTESTED")
        self.assertEqual(record["productionOriginSignature"], "NOT_PRESENT")
        self.assertEqual(record["fileIdentities"]["active"]["fileFormatWrite"], 1)
        self.assertIn("indexXinfoSha256", record["active"])
        self.assertIn("page_count", record["excludedMetadata"])

    def test_duplicate_row_is_not_discarded(self):
        self.create(duplicate=True)
        self.assertIn("LEGACY_TABLE_ROWSET_MISMATCH:repeated", self.capture()["problems"])

    def test_sqlite_type_distinction_rejected(self):
        self.create(changed_type=True)
        self.assertIn("LEGACY_TABLE_ROWSET_MISMATCH:repeated", self.capture()["problems"])

    def test_rowid_change_is_visible(self):
        self.create(changed_rowid=True)
        self.assertIn("LEGACY_TABLE_ROWSET_MISMATCH:repeated", self.capture()["problems"])

    def test_index_xinfo_change_rejected(self):
        self.create(index_desc=True)
        self.assertIn("INDEX_METADATA_DRIFT:records_amount_idx", self.capture()["problems"])

    def test_header_application_id_change_rejected(self):
        self.create(application_id=13)
        self.assertIn("HEADER_DRIFT:application_id", self.capture()["problems"])

    def test_unexpected_nonempty_table_rejected(self):
        self.create()
        db=sqlite3.connect(str(self.active))
        try:
            db.execute("INSERT INTO additional_control VALUES ('unexpected')")
            db.commit()
        finally:
            db.close()
        self.assertIn("ADDED_TABLE_NONEMPTY:additional_control", self.capture()["problems"])

    def test_unsafe_identifier_rejected(self):
        self.create(malformed=True)
        with self.assertRaisesRegex(ValueError, "UNSAFE_OR_UNKNOWN_SQL_IDENTIFIER"):
            self.capture()

    def test_open_symlink_is_rejected(self):
        self.create()
        link = Path(self.root.name) / "link.sqlite"
        link.symlink_to(self.active)
        with self.assertRaises(OSError):
            w.capture(str(self.pre), str(link), "synthetic")

    def test_sidecar_is_rejected(self):
        self.create()
        Path(str(self.active) + "-wal").write_bytes(b"x")
        with self.assertRaisesRegex(ValueError, "DATABASE_SIDECAR_PRESENT"):
            self.capture()

    def test_same_file_alias_rejected(self):
        fixture(self.pre)
        with self.assertRaisesRegex(ValueError, "SAME_PHYSICAL_FILE"):
            w.capture(str(self.pre), str(self.pre), "synthetic")

    def test_bad_expected_digest_fails_closed(self):
        self.create()
        with w.os.fdopen(w.open_pinned(str(self.active)), "rb", closefd=True) as handle:
            with self.assertRaisesRegex(ValueError, "FILE_HASH_MISMATCH"):
                w.sample_snapshot(handle.fileno(), "0" * 64)


if __name__ == "__main__":
    unittest.main()
