import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('rebuild', REPO/'scripts/g3-bounded-reconstruction.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def archive(folder, path, order):
    with tarfile.open(path, 'w:gz') as tf:
        root = tarfile.TarInfo('.'); root.type = tarfile.DIRTYPE; tf.addfile(root)
        for name in order:
            b = (folder/name).read_bytes(); info = tarfile.TarInfo('./'+name); info.size = len(b); tf.addfile(info, io.BytesIO(b))
    return {'path': str(path), 'size': path.stat().st_size, 'sha256': m.digest(path.read_bytes()),
            'members': ['.']+['./'+n for n in order], 'files': {n:[(folder/n).stat().st_size,m.digest((folder/n).read_bytes())] for n in order}}


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        (self.root/m.DB).write_bytes(b'synthetic')
        self.s = archive(self.root,self.root/'a.tgz',[m.DB])
    def tearDown(self):self.temp.cleanup()
    def test_accept_pinned_bytes(self):self.assertEqual(m.verify_archive(self.s)[m.DB],b'synthetic')
    def test_archive_drift(self):
        self.s['sha256']='0'*64
        with self.assertRaises(ValueError):m.verify_archive(self.s)
    def test_member_digest(self):
        self.s['files'][m.DB][1]='0'*64
        with self.assertRaises(ValueError):m.verify_archive(self.s)
    def test_roster(self):
        self.s['members'].append('./unexpected')
        with self.assertRaises(ValueError):m.verify_archive(self.s)
    def test_symlink_input(self):
        link=self.root/'link';link.symlink_to(self.s['path']);self.s['path']=str(link)
        with self.assertRaises(OSError):m.verify_archive(self.s)
    def test_symlink_member(self):
        p=self.root/'a.tgz'
        with tarfile.open(p,'w:gz') as tf:
            d=tarfile.TarInfo('.');d.type=tarfile.DIRTYPE;tf.addfile(d)
            x=tarfile.TarInfo('./'+m.DB);x.type=tarfile.SYMTYPE;x.linkname='/etc/passwd';tf.addfile(x)
        self.s.update(size=p.stat().st_size,sha256=m.digest(p.read_bytes()))
        with self.assertRaises(ValueError):m.verify_archive(self.s)
    def test_expansion_bound(self):
        with patch.object(m,'MAX_TAR',16):
            with self.assertRaises(ValueError):m.verify_archive(self.s)
    def test_mount_scope(self):
        c=m.docker_command(self.root,self.root/'tool.mjs','synthetic-only')
        self.assertNotIn('/var/run/docker.sock',' '.join(c));self.assertIn('--no-healthcheck',c)
        self.assertIn('none',c);self.assertNotIn('run',c);self.assertEqual(c.count('--mount'),2)


@unittest.skipUnless(os.environ.get('JSO_RECONSTRUCTION_DOCKER_TEST')=='1','explicit local synthetic Docker validation')
class DockerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='jso-rebuild-fixtures-');cls.root=Path(cls.temp.name);cls.root.chmod(0o755)
        cls.fixtures=cls.root/'fixtures';cls.fixtures.mkdir(mode=0o777);cls.fixtures.chmod(0o777)
        tool=REPO/'tests/fixtures/g3-reconstruction-fixture.mjs'
        cmd=['docker','--context','default','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','1000:1000','--no-healthcheck','--tmpfs','/app/data:rw,uid=1000,gid=1000,mode=0700','--mount',f'type=bind,src={cls.fixtures},dst=/work','--mount',f'type=bind,src={tool},dst=/fixture.mjs,readonly','--entrypoint','node',m.IMAGE,'/fixture.mjs']
        r=subprocess.run(cmd,capture_output=True,timeout=60);assert r.returncode==0,r.stderr
        cls.a=archive(cls.fixtures/'six',cls.root/'six.tgz',[m.DB+'-wal',m.DB,m.DB+'-shm'])
        cls.b=archive(cls.fixtures/'ten',cls.root/'ten.tgz',[m.DB])
    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()
    def run_case(self,a=None,b=None,timeout=120,runner=None):
        root=self.root/('scratch-'+self.id().split('.')[-1]);self.scratch=root
        return m.run([a or self.a,b or self.b],root,runner or REPO/'scripts/g3-bounded-reconstruction.mjs',timeout)
    def test_real_wal_replay(self):
        out=self.run_case();self.assertEqual(out['status'],'LIMITED_RECONSTRUCTION_EVIDENCE')
        self.assertFalse(out['productionAdmission']);self.assertFalse(out['historicalCoverageProven']);self.assertTrue(out['explicitCloseAndReopen'])
        self.assertEqual(len(out['declaredTimestampDifferences']),4);self.assertFalse(self.scratch.exists())
        self.assertNotIn('9007199254740993',json.dumps(out));self.assertNotIn('00ff0102',json.dumps(out))
    def test_wrong_source_version(self):
        with self.assertRaises(ValueError):self.run_case(a=self.b)
        self.assertFalse(self.scratch.exists())
    def test_timeout_cleanup(self):
        with self.assertRaises(subprocess.TimeoutExpired):self.run_case(timeout=0.0001)
        self.assertFalse(self.scratch.exists())
    def test_reference_business_drift(self):
        import sqlite3
        d=self.root/'changed';d.mkdir();shutil.copyfile(self.fixtures/'ten'/m.DB,d/m.DB)
        c=sqlite3.connect(d/m.DB);c.execute('UPDATE schedule_state SET revision=9007199254740992');c.commit();c.close()
        changed=archive(d,self.root/'changed.tgz',[m.DB])
        with self.assertRaises(ValueError):self.run_case(b=changed)
        self.assertFalse(self.scratch.exists())
    def text_case(self, left, right):
        import sqlite3
        specs=[]
        for version,value in [('six',left),('ten',right)]:
            d=self.root/(self.id().split('.')[-1]+'-'+version)
            shutil.copytree(self.fixtures/version,d)
            c=sqlite3.connect(d/m.DB)
            c.execute('UPDATE schedule_state SET snapshot_json=CAST(? AS TEXT)',(value,));c.commit();c.close()
            specs.append(archive(d,d.with_suffix('.tgz'),[m.DB]))
        return self.run_case(a=specs[0],b=specs[1])
    def test_unicode_nul_text(self):
        value='合成\x00é'.encode()
        self.assertEqual(self.text_case(value,value)['status'],'LIMITED_RECONSTRUCTION_EVIDENCE')
    def test_invalid_text_same_bytes(self):
        self.assertEqual(self.text_case(b'\x80',b'\x80')['status'],'LIMITED_RECONSTRUCTION_EVIDENCE')
    def test_invalid_text_different_bytes(self):
        with self.assertRaises(ValueError):self.text_case(b'\x80',b'\x81')
    def test_workspace_limit(self):
        runner=self.root/'fill.mjs'
        runner.write_text("import fs from 'node:fs'; const f=fs.openSync('/work/fill','w');for(let i=0;i<40;i++)fs.writeSync(f,Buffer.alloc(1024*1024));")
        with self.assertRaises(ValueError):self.run_case(runner=runner)
        self.assertFalse(self.scratch.exists())
    def test_output_limit(self):
        runner=self.root/'output.mjs';runner.write_text("for(let i=0;i<100;i++)console.log('x'.repeat(65536));")
        with self.assertRaises(ValueError):self.run_case(runner=runner)
        self.assertFalse(self.scratch.exists())
    def test_legacy_timestamp_drift(self):
        import sqlite3
        d=self.root/'legacy';d.mkdir();shutil.copyfile(self.fixtures/'ten'/m.DB,d/m.DB)
        c=sqlite3.connect(d/m.DB)
        triggers=c.execute("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='schema_migrations'").fetchall()
        for name,sql in triggers:c.execute('DROP TRIGGER "'+name.replace('"','""')+'"')
        c.execute("UPDATE schema_migrations SET applied_at='2019-01-01T00:00:00.000Z' WHERE version=1")
        for name,sql in triggers:c.execute(sql)
        c.commit();c.close()
        changed=archive(d,self.root/'legacy.tgz',[m.DB])
        with self.assertRaises(ValueError):self.run_case(b=changed)

if __name__=='__main__':unittest.main()
