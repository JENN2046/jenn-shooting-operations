import hashlib
from contextlib import ExitStack, redirect_stdout
from types import SimpleNamespace
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
        with patch.object(m, 'docker_runtime'):
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



class DockerIdentityTests(unittest.TestCase):
    def test_fixed_command_and_environment(self):
        with patch.object(m, 'docker_runtime') as check, patch.dict(os.environ, {'PATH': '/synthetic-only', 'DOCKER_HOST': 'synthetic-only'}):
            args = m.docker_args('inspect', 'synthetic')
            self.assertEqual(args, ['/usr/bin/docker', '--config', m.DOCKER_CONFIG, '--host', 'unix:///run/docker.sock', 'inspect', 'synthetic'])
            check.assert_called_once()
            self.assertNotIn('DOCKER_HOST', m.DOCKER_ENV)
            self.assertEqual(m.DOCKER_ENV['PATH'], '/usr/bin:/bin')

    def test_missing_runtime_approval_stops_before_process(self):
        with patch.object(m, 'read_pinned', side_effect=FileNotFoundError), patch.object(m.subprocess, 'Popen') as start:
            with self.assertRaises(FileNotFoundError):
                m.bounded_start('synthetic', 1)
            start.assert_not_called()

    def test_digest_mismatch_stops_before_process(self):
        approval = json.dumps({'version':1, 'path':m.DOCKER_EXECUTABLE, 'sha256':'0'*64}).encode()
        with patch.object(m, 'read_pinned', side_effect=[approval, b'synthetic-runtime']) as read, patch.object(m.subprocess, 'Popen') as start:
            with self.assertRaisesRegex(ValueError, 'DOCKER_EXECUTABLE_DRIFT'):
                m.bounded_start('synthetic', 1)
            self.assertTrue(all(call.kwargs.get('trusted_uid') == 0 for call in read.call_args_list))
            start.assert_not_called()

    def test_untrusted_runtime_parent_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'inert'; path.write_bytes(b'inert')
            with self.assertRaisesRegex(ValueError, 'RUNTIME_CUSTODY'):
                m.read_pinned(str(path), 4096, trusted_uid=0)


class DockerControlFlowTests(unittest.TestCase):
    """Exercise orchestration and real pipe draining; never launch a child process."""

    def exercise(self, failure_at=None):
        runtime_bytes = b'inert approved runtime identity'
        approval = {'version': 1, 'path': '/usr/bin/docker',
                    'sha256': hashlib.sha256(runtime_bytes).hexdigest()}
        prefix = ['/usr/bin/docker', '--config', '/etc/jso/g3-reconstruction-docker',
                  '--host', 'unix:///run/docker.sock']
        environment = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'HOME': '/nonexistent'}
        name = 'jso-reconstruct-' + '1' * 32
        calls, reads, stats = [], [], []
        runtime_checks = 0
        state = [{'State': {'Status': 'exited', 'ExitCode': 0, 'OOMKilled': False},
                  'HostConfig': {'PortBindings': {}, 'NetworkMode': 'none'},
                  'Config': {'Labels': {'jso.reconstruction': name}}}]
        receipt = {'status': 'LIMITED_RECONSTRUCTION_EVIDENCE', 'productionAdmission': False}
        original_lstat, original_iterdir = os.lstat, Path.iterdir
        directories = ('/', '/etc', '/etc/jso', m.DOCKER_CONFIG, '/run')

        def read(path, limit, *, trusted_uid=None):
            nonlocal runtime_checks
            reads.append((str(path), trusted_uid))
            if str(path) == m.DOCKER_APPROVAL:
                runtime_checks += 1
                return json.dumps(approval).encode()
            if str(path) == m.DOCKER_EXECUTABLE:
                # A persistent ordinary identity-check error, not executable input.
                if failure_at is not None and runtime_checks >= failure_at:
                    raise ValueError('DOCKER_EXECUTABLE_DRIFT')
                return runtime_bytes
            self.assertEqual(str(path), str(runner))
            return b'inert runner bytes'

        def lstat(path, *args, **kwargs):
            if str(path) in (*directories, '/run/docker.sock'):
                stats.append(str(path))
                return SimpleNamespace(st_uid=0, st_mode=(0o140660 if str(path) == '/run/docker.sock' else 0o40755))
            return original_lstat(path, *args, **kwargs)

        def iterdir(path):
            return iter(()) if str(path) == m.DOCKER_CONFIG else original_iterdir(path)

        def boundary(kind, argv, **kwargs):
            self.assertEqual(argv[:5], prefix)
            self.assertEqual(kwargs.get('env'), environment)
            self.assertNotIn('shell', kwargs)
            action = argv[5]
            self.assertIn(action, ('image', 'create', 'start', 'inspect', 'rm'))
            calls.append((kind, action))
            if kind == 'Popen':
                self.assertEqual(argv[5:], ['start', '-a', name])
                streams = []
                for payload in (json.dumps(receipt).encode(), b''):
                    rd, wr = os.pipe()
                    try:
                        os.write(wr, payload)
                    finally:
                        os.close(wr)
                    stream = os.fdopen(rd, 'rb')
                    self.addCleanup(stream.close)
                    streams.append(stream)
                return SimpleNamespace(stdout=streams[0], stderr=streams[1],
                                       poll=lambda: 0, wait=lambda **kw: 0,
                                       kill=lambda: self.fail('unexpected kill on completed inert process'))
            if action == 'image':
                out = json.dumps([{'Id': m.IMAGE, 'Architecture': 'amd64'}])
            elif action == 'inspect':
                self.assertEqual(argv[6:], [name])
                out = json.dumps(state)
            else:
                if action == 'rm':
                    self.assertEqual(argv[6:], ['-f', name])
                out = ''
            if kind == 'check_output':
                return out.encode()
            return subprocess.CompletedProcess(argv, 0, out if kwargs.get('text') else out.encode(), b'')

        with tempfile.TemporaryDirectory() as folder, ExitStack() as stack:
            root = Path(folder) / 'scratch'
            runner = Path(folder) / 'runner.mjs'
            specs = [{'sha256': '1' * 64}, {'sha256': '2' * 64}]
            stack.enter_context(patch.object(m, 'verify_archive', return_value={m.DB: b'inert synthetic data'}))
            stack.enter_context(patch.object(m, 'read_pinned', side_effect=read))
            stack.enter_context(patch.object(m.os, 'lstat', side_effect=lstat))
            stack.enter_context(patch.object(Path, 'iterdir', iterdir))
            stack.enter_context(patch.object(m.os, 'chown'))
            stack.enter_context(patch.object(m.os, 'statvfs', return_value=SimpleNamespace(f_bavail=2**20, f_frsize=4096)))
            stack.enter_context(patch.object(m.uuid, 'uuid4', return_value=SimpleNamespace(hex='1' * 32)))
            stack.enter_context(patch.dict(m.ATTEMPT, {}, clear=True))
            stack.enter_context(patch.dict(os.environ, {'PATH': '/inert', 'DOCKER_HOST': 'inert', 'DOCKER_CONFIG': '/inert'}))
            for kind in ('run', 'check_output', 'Popen'):
                stack.enter_context(patch.object(m.subprocess, kind,
                    side_effect=lambda argv, _kind=kind, **kw: boundary(_kind, argv, **kw)))
            output = io.StringIO()
            with redirect_stdout(output):
                if failure_at is None:
                    result = m.run(specs, root, runner)
                    self.assertEqual(result['dockerRuntime'], {**approval, 'environment': environment,
                        'endpoint': 'unix:///run/docker.sock', 'config': m.DOCKER_CONFIG})
                    self.assertTrue(result['archivePostcheck'])
                    self.assertFalse(root.exists())
                else:
                    with self.assertRaisesRegex(ValueError, '^DOCKER_EXECUTABLE_DRIFT$'):
                        m.run(specs, root, runner)
                    # Refusal during finally must suppress any pending success return.
                    self.assertTrue(root.is_dir())
                    self.assertTrue((root / 'replay.mjs').exists())
                    self.assertEqual(m.ATTEMPT, {'container': name, 'scratch': str(root)})
            self.assertEqual(output.getvalue(), '')
        self.assertTrue(all(uid == 0 for path, uid in reads if path in (m.DOCKER_APPROVAL, m.DOCKER_EXECUTABLE)))
        return calls, runtime_checks, stats

    def test_all_process_boundaries_and_positive_runtime_checks(self):
        calls, checks, stats = self.exercise()
        self.assertEqual(calls, [('run', 'image'), ('run', 'create'), ('Popen', 'start'),
                                ('check_output', 'inspect'), ('run', 'inspect'), ('run', 'rm')])
        self.assertEqual(checks, 8)
        for path in ('/', '/etc', '/etc/jso', m.DOCKER_CONFIG, '/run', '/run/docker.sock'):
            self.assertEqual(stats.count(path), checks)

    def test_terminal_and_cleanup_identity_errors_stop_without_success(self):
        normal = [('run', 'image'), ('run', 'create'), ('Popen', 'start'),
                  ('check_output', 'inspect'), ('run', 'inspect')]
        # Checks 5/7/8 precede terminal inspect, cleanup inspect, and cleanup rm.
        for check, allowed in ((5, 3), (7, 4), (8, 5)):
            with self.subTest(identity_check=check):
                calls, checks, _ = self.exercise(failure_at=check)
                self.assertEqual(calls, normal[:allowed])
                self.assertGreaterEqual(checks, check)


if __name__ == "__main__":
    unittest.main()
