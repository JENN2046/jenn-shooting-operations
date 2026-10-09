"""G3-03 bounded regression tests; all database bytes are disposable synthetic data."""
import os
import json
import subprocess
import sys
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from test_g3_forward_adoption_witness import fixture, w


class Compatibility(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='g3-03-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.data = self.root / 'data'
        self.data.mkdir()
        self.pre, self.active = self.data/'pre.sqlite', self.data/'active.sqlite'
        fixture(self.pre)
        fixture(self.active, additional=True)

    def capture(self):
        return w.capture(str(self.pre), str(self.active), 'synthetic')

    def wal(self):
        for p in (self.pre, self.active):
            db = sqlite3.connect(p)
            self.assertEqual(db.execute('PRAGMA journal_mode=WAL').fetchone()[0], 'wal')
            db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            db.close()
            self.assertEqual(p.read_bytes()[18:20], b'\x02\x02')
            self.assertFalse(Path(str(p)+'-wal').exists())

    def test_checkpointed_wal_without_bound_evidence_is_rejected_unchanged(self):
        self.wal()
        for p in (self.pre, self.active):os.utime(p, ns=(1000000000,2000000000))
        before = [p.stat() for p in (self.pre, self.active)]
        with patch.object(w.sqlite3, 'connect', side_effect=AssertionError('SQLite must not open')):
            with self.assertRaisesRegex(ValueError, '^WAL_CHECKPOINT_COMPLETENESS_UNPROVEN$'):
                self.capture()
        self.assertEqual(before, [p.stat() for p in (self.pre, self.active)])

    def test_wal_header_rejected_before_sqlite_interpretation(self):
        # A main-file header is not evidence of checkpoint completion, regardless
        # of the remaining bytes. This test does not manufacture a lost-WAL case.
        blob = self.pre.read_bytes()
        blob = blob[:18] + b'\x02\x02' + blob[20:]
        with patch.object(w.sqlite3, 'connect', side_effect=AssertionError('SQLite must not open')):
            with self.assertRaisesRegex(ValueError, '^WAL_CHECKPOINT_COMPLETENESS_UNPROVEN$'):
                w.inspect_database(blob)

    def test_active_only_wal_cli_emits_failure_not_observation(self):
        db = sqlite3.connect(self.active)
        try:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        finally:
            db.close()
        self.assertFalse(Path(str(self.active)+'-wal').exists())
        result = subprocess.run([sys.executable, w.__file__, '--prestate', str(self.pre),
                                 '--active', str(self.active), '--profile', 'synthetic'],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 2)
        record = json.loads(result.stdout)
        self.assertEqual(record, {'status': 'WITNESS_FAIL_CLOSED',
                                 'code': 'WAL_CHECKPOINT_COMPLETENESS_UNPROVEN',
                                 'adoptionAuthorityAllowed': False})

    def test_mixed_and_unknown_formats(self):
        raw=self.pre.read_bytes()
        for header in (b'\x01\x02',b'\x02\x01',b'\x03\x03'):
            with self.subTest(header=header):
                self.pre.write_bytes(raw[:18]+header+raw[20:])
                with self.assertRaisesRegex(ValueError,'FORMAT_INVALID'):self.capture()

    def test_all_sidecars_including_dangling_links(self):
        for suffix in ('-wal','-shm','-journal'):
            for link in (False,True):
                with self.subTest(suffix=suffix,link=link):
                    p=Path(str(self.pre)+suffix)
                    if link:p.symlink_to(self.root/'missing')
                    else:p.write_bytes(b'')
                    try:
                        with self.assertRaisesRegex(ValueError,'SIDECAR_PRESENT'):self.capture()
                    finally:p.unlink()

    def test_noatime_unavailable(self):
        with patch.object(w.os,'O_NOATIME',None):
            with self.assertRaisesRegex(ValueError,'O_NOATIME_UNAVAILABLE'):self.capture()

    def test_noatime_permission_denied_no_fallback(self):
        original=os.open;attempts=[]
        def denied(path,flags,*a,**kw):
            if flags & os.O_NOATIME:
                attempts.append(flags);raise PermissionError('fixture noatime denied')
            return original(path,flags,*a,**kw)
        with patch.object(w.os,'open',denied):
            with self.assertRaises(PermissionError):self.capture()
        self.assertEqual(len(attempts),1)

    def during_inspection(self,change,expected):
        original=w.inspect_database;done=False
        def wrapped(blob):
            nonlocal done
            result=original(blob)
            if not done:change();done=True
            return result
        with patch.object(w,'inspect_database',wrapped):
            with self.assertRaisesRegex((ValueError,OSError),expected):self.capture()

    def test_parent_symlink(self):
        alias=self.root/'alias';alias.symlink_to(self.data,target_is_directory=True)
        with self.assertRaises(OSError):w.capture(str(alias/'pre.sqlite'),str(self.active),'synthetic')

    def test_parent_permission_drift(self):
        self.during_inspection(lambda:os.chmod(self.data,0o700),'PARENT_CHAIN_CHANGED')

    def test_ancestor_inode_replacement_same_leaf(self):
        # Replace ancestor while retaining the original child directory and leaf inodes.
        outer=self.root/'outer';outer.mkdir();self.data.rename(outer/'data')
        self.data=outer/'data';self.pre=self.data/'pre.sqlite';self.active=self.data/'active.sqlite'
        def replace():
            outer.rename(self.root/'old');outer.mkdir();(self.root/'old/data').rename(outer/'data')
        self.during_inspection(replace,'PARENT_CHAIN_CHANGED')

    def test_leaf_replacement(self):
        def replace():
            self.pre.rename(self.data/'old.sqlite');fixture(self.pre)
        self.during_inspection(replace,'PATH_REBOUND')

    def test_sidecar_appears_during_proof(self):
        self.during_inspection(lambda:Path(str(self.active)+'-shm').write_bytes(b''),'SIDECAR_PRESENT')

    def test_atime_drift_during_proof(self):
        self.during_inspection(lambda:os.utime(self.pre,ns=(1,self.pre.stat().st_mtime_ns)),'METADATA_CHANGED')

    def test_delete_format_still_rejects_semantic_drift(self):
        self.active.unlink();fixture(self.active,additional=True,changed_type=True)
        self.assertIn('LEGACY_TABLE_ROWSET_MISMATCH:repeated',self.capture()['problems'])

if __name__=='__main__':unittest.main()
