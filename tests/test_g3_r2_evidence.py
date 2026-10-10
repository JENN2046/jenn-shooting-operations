"""R2 synthetic unit acceptance. These fixtures carry no production authority."""
import copy
import base64
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import g3_r2_bootstrap as bootstrap
import g3_r2_common as c
import g3_r2_acceptance as a
import g3_r2_collector as col
import g3_r2_snapshot as snapshot
import g3_r2_custody as cust
import g3_r2_endpoint as endpoint
from g3_r2_transport import run_bounded
from test_g3_forward_adoption_witness import fixture


def writer_fixture(approved):
    """Labelled synthetic manager records, never live or production observations."""
    writers = []
    for name, role in [('runtime', 'runtimeWriter'), ('helper', 'legacyHelper')]:
        w = {'id': name, 'kind': 'systemd', 'role': role, 'target': 'jso-unit-' + name + '.service',
             'sides': list(c.SIDES), 'probeSha256': '9' * 64, 'entrypointPath': '/opt/jso/lab-' + name,
             'entrypointSha256': 'c' * 64}
        w['unitSha256'] = c.sha(cust.unit_bytes(w)); writers.append(w)
    controls = [{'role': role, 'path': '/opt/jso/lab-' + role, 'sha256': '8' * 64}
                for role in ('windowResponsibility', 'runtimeDisabled')]
    controls.append({'role': 'legacyHelper', 'path': writers[1]['entrypointPath'], 'sha256': writers[1]['entrypointSha256']})
    window = {'notBefore': 0, 'notAfter': 9999999999, 'responsibilitySha256': '8' * 64, 'controls': controls,
              'writers': writers, 'aliases': []}
    approved['window'] = window
    projection = {'version': 1, 'host': approved['host'], 'files': {
        side: {'path': approved['files'][side]['path'], 'sha256': approved['files'][side]['identity']['sha256']}
        for side in c.SIDES}, 'responsibilitySha256': window['responsibilitySha256'], 'writers': writers}
    controls.append({'role': 'writerInventory', 'path': '/opt/jso/inventory.json', 'sha256': c.sha(c.canonical(projection))})
    evidence = {}
    for w in writers:
        state = dict(zip(cust.SYSTEMD_PROPERTIES, (w['target'], 'masked', 'inactive', 'dead', '0', '0', '[not set]',
                         'masked-runtime', '/run/systemd/system/' + w['target'], '', 'no', 'no', '')))
        out = ''.join(k + '=' + v + '\n' for k, v in state.items())
        guard = {'unitSha256': w['unitSha256'], 'entrypointSha256': w['entrypointSha256'],
                 'maskIdentity': [1, 2, 0, 0, 41471, 3], 'maskParents': [[1, 2, 0, 0, 16877]] * 4,
                 'cgroupAbsent': True, 'cgroupPath': '/sys/fs/cgroup/system.slice/' + w['target'], 'cgroupFilesystem': 'cgroup2'}
        evidence[w['id']] = {'argv': cust.writer_argv(w), 'environment': dict(cust.PROBE_ENV),
                             'probeSha256': w['probeSha256'], 'exit': 0, 'limited': False, 'stdout': out, 'stderr': '',
                             'stdoutSha256': c.sha(out.encode()), 'stderrSha256': c.sha(b''), 'guard': guard, 'state': state}
    return evidence


def observation(root):
    w = c.load_r1()
    pre, active = root / 'pre.sqlite', root / 'active.sqlite'
    fixture(pre); fixture(active, additional=True)
    db = sqlite3.connect(pre);db.execute('PRAGMA journal_mode=WAL');db.close()
    views = {s: snapshot.inspect_copy(p) for s,p in [('prestate',pre),('active',active)]}
    files = {}
    for side,path in [('prestate',pre),('active',active)]:
        fd=w.open_pinned(str(path))
        try: _,identity=w.sample_snapshot(fd)
        finally:os.close(fd)
        files[side]={'path':str(path),'identity':identity,'parents':[[1,2,0,0,16877]],'mount':'ext4 /dev/vda1 /'}
    approved={'purpose':'ISOLATED_VALIDATION_ONLY','methodSha256':c.METHOD,'contractSha256':'1'*64,
              'exceptionSha256':'2'*64,'referenceEvidenceSha256':'3'*64,'reference':dict(c.REF_PINS),
              'code':{'fixture':'4'*64},'runtime':c.runtime(),'host':{'instance':'lab','boot':'lab-boot'},
              'scope':'SYNTHETIC_ONLY_NOT_PRODUCTION','files':files}
    custody={s:{k:t[k] for k in ('identity','parents','mount')}|{'flags':16} for s,t in files.items()}
    _,legacy=w.prove(views['prestate'],views['active'],'synthetic')
    record={'version':2,'domain':'G3_ISOLATED_EVIDENCE_R2','status':'R2_OBSERVATION_REQUIRES_LOCAL_ACCEPTANCE',
            'challenge':'a'*64,'methodSha256':c.METHOD,'approvalManifestSha256':'b'*64,
            **{k:approved[k] for k in ('contractSha256','exceptionSha256','referenceEvidenceSha256','reference','code','runtime','host','scope')},
            'custodyBefore':custody,'custodyAfter':copy.deepcopy(custody),**views,'comparedLegacyTables':len(legacy),
            'historicalWalCompleteness':'NOT_PROVEN','historicalWriterCoverage':'NOT_PROVEN',
            'sampling':'PINNED_ORIGINAL_FDS_PRIVATE_TMPFS_RO_IMMUTABLE_COPIES',
            'checks':dict.fromkeys(a.CHECK_KEYS,True),'problems':[],**c.DENY}
    record['writersBefore'] = writer_fixture(approved)
    record['writersAfter'] = copy.deepcopy(record['writersBefore'])
    return approved,record


def raw(record):
    r=copy.deepcopy(record);r.pop('captureDigest',None);r['captureDigest']=c.sha(c.canonical(r));return c.canonical(r)


class R2Acceptance(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='jso-r2-unit-');self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.approval,self.record=observation(self.root)
    def validate(self,record=None):
        return a.validate_observation(raw(self.record if record is None else record),self.approval,'b'*64,'a'*64)
    def test_normal_supported_synthetic_observation(self):
        self.assertEqual(self.validate()['historicalWalCompleteness'],'NOT_PROVEN')
    def test_r1_remains_rejecting_2_2(self):
        with self.assertRaisesRegex(ValueError,'WAL_CHECKPOINT_COMPLETENESS_UNPROVEN'):
            c.load_r1().inspect_database((self.root/'pre.sqlite').read_bytes())
    def test_1_1_copy_checks_match_r1(self):
        path=self.root/'active.sqlite'
        self.assertEqual(snapshot.inspect_copy(path),c.load_r1().inspect_database(path.read_bytes()))
    def test_caller_cannot_choose_reference_digest(self):
        p=self.root/'reference.json';p.write_bytes(c.canonical({'fake':True}))
        with self.assertRaisesRegex(ValueError,'CALLER_CANNOT_SELECT'):
            c.reference(str(p),c.sha(p.read_bytes()),self.approval)
    def test_missing_or_wrong_reference_material_rejected(self):
        with self.assertRaises(FileNotFoundError):c.reference(str(self.root/'missing'), '3'*64,self.approval)
        p=self.root/'wrong';p.write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError,'REFERENCE_EVIDENCE_DIGEST'):c.reference(str(p),'3'*64,self.approval)
    def test_unknown_missing_or_boolean_fields_rejected(self):
        edits=[lambda r:r.update(extra=True),lambda r:r.pop('checks'),lambda r:r.update(version=True),
               lambda r:r['checks'].update(extra=True),lambda r:r['checks'].pop('integrity'),
               lambda r:r['prestate'].update(extra=True),lambda r:r['prestate']['tables']['records'].update(extra=True),
               lambda r:r['prestate']['header'].update(user_version=True),
               lambda r:r['custodyBefore']['prestate']['identity'].update(nlink=True)]
        for edit in edits:
            r=copy.deepcopy(self.record);edit(r)
            with self.subTest(edit=edit), self.assertRaises((ValueError,TypeError,KeyError)):self.validate(r)
    def test_forged_success_missing_checks_is_rejected(self):
        r=copy.deepcopy(self.record);r['checks']['fullTypedRowsets']=False
        with self.assertRaisesRegex(ValueError,'INCOMPLETE_CHECKS'):self.validate(r)
    def test_unequal_rowsets_multiplicity_types_and_migration_time(self):
        edits=[lambda r:r['active']['tables']['repeated'].update(rowCount=1),
               lambda r:r['active']['tables']['records'].update(rowSetSha256='sha256:'+'f'*64),
               lambda r:r['active']['markers'][0].__setitem__(3,'2026-10-02T00:00:00.000Z'),
               lambda r:r['active']['foreignKeys']['records'].append([0,0,'records','id','id','NO ACTION','NO ACTION','NONE']),
               lambda r:r['active'].update(foreignKeyViolations=1),
               lambda r:r['active'].update(integrity=['not ok'])]
        for edit in edits:
            r=copy.deepcopy(self.record);edit(r)
            with self.subTest(edit=edit),self.assertRaises(ValueError):self.validate(r)
    def test_bad_binding_and_scope_rejected(self):
        for field,value in [('challenge','c'*64),('approvalManifestSha256','c'*64),('contractSha256','c'*64),
                            ('domain','G3_PRODUCTION_EVIDENCE_R2'),('historicalWalCompleteness','PASS'),
                            ('adoptionAuthorityAllowed',True),('status','ACCEPTED')]:
            r=copy.deepcopy(self.record);r[field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):self.validate(r)
    def test_object_digest_inode_and_protection_drift(self):
        for edit in [lambda r:r['custodyAfter']['active']['identity'].update(inode=3),
                     lambda r:r['custodyBefore']['active'].update(flags=0)]:
            r=copy.deepcopy(self.record);edit(r)
            with self.assertRaises(ValueError):self.validate(r)
    def production_shape(self):
        # No production rows are available or loaded. Only the fixed historical-prefix hash
        # is mocked for this structural branch unit test; it is not evidence acceptance.
        w=c.load_r1();r=copy.deepcopy(self.record)
        r['domain']='G3_PRODUCTION_EVIDENCE_R2';r['scope']='G3_PRODUCTION_EVIDENCE_ONLY'
        self.approval['purpose']='PRODUCTION_WINDOW';self.approval['scope']=r['scope']
        for side in c.SIDES:
            v=r[side];v['schemaDigest']='sha256:'+w.EXPECTED[side]['schema']
            v['columnsDigest']='sha256:'+w.EXPECTED[side]['columns']
            names=list(a.G3_PRESTATE_TABLES)+(sorted(w.NEW_TABLES) if side=='active' else [])
            old=copy.deepcopy(v['tables']['repeated'])
            v['tables']={n:copy.deepcopy(old) for n in names}
            v['tables']['schema_migrations']['rowCount']=11 if side=='active' else 10
            for n in w.NEW_TABLES & set(names):v['tables'][n]['rowCount']=0
            v['foreignKeys']={n:[] for n in names};v['indexList']={n:[] for n in names}
            v['tableList']={n:['main',n,'table',2,0,0] for n in names};v['indexXinfo']={}
        r['active']['markers'][-1]=[11,'business_calendar_and_reschedule',w.MIGRATION11,'2026-10-08T00:00:00.000Z']
        r['comparedLegacyTables']=38
        return w,r
    def test_production_profile_roster_and_migrations_branch(self):
        w,r=self.production_shape()
        with patch.object(a,'load_r1',return_value=w),patch.object(w,'digest',return_value='sha256:20e76fece64d733d50e68f852c98a665d2dd77f0f258e9b05c0739f8003f1445'):
            self.validate(r)
            for edit in [lambda x:x['prestate']['tables']['schema_migrations'].update(rowCount=9),
                         lambda x:x['active']['tables']['agent_grant_attempts'].update(rowCount=1),
                         lambda x:x['active']['markers'][0].__setitem__(3,'changed'),
                         lambda x:x['active'].update(schemaDigest='sha256:'+'0'*64)]:
                v=copy.deepcopy(r);edit(v)
                with self.assertRaises(ValueError):self.validate(v)
            v=copy.deepcopy(r)
            for side in c.SIDES:
                for field in ('tables','foreignKeys','indexList','tableList'):
                    v[side][field]['wrong_same_count']=v[side][field].pop('uploads')
            with self.assertRaisesRegex(ValueError,'EXACT_TABLE_ROSTER'):self.validate(v)
        # Without the explicit unit-only mock the fabricated historical prefix is rejected.
        with self.assertRaisesRegex(ValueError,'ORIGINAL_MIGRATION_PREFIX'):self.validate(r)

    def test_noncanonical_duplicate_truncated_inputs(self):
        for b in [raw(self.record)+b' ',b'{"x":1,"x":2}',raw(self.record)[:-1],b'{"n":NaN}']:
            with self.subTest(b=b[:20]),self.assertRaises((ValueError,UnicodeError)):
                a.validate_observation(b,self.approval,'b'*64,'a'*64)
    def test_lossless_unicode_large_int_blob_duplicate_rows(self):
        p=self.root/'types.sqlite';db=sqlite3.connect(p)
        db.executescript('CREATE TABLE schema_migrations(version,name,checksum,applied_at); CREATE TABLE data(i,t,b);')
        values=(9223372036854775807,'中文🙂\x00尾',sqlite3.Binary(b'\0\xff'))
        db.executemany('INSERT INTO data VALUES(?,?,?)',[values,values]);db.commit();db.close()
        v=snapshot.inspect_copy(p);self.assertEqual(v['tables']['data']['rowCount'],2)
        db=sqlite3.connect(p);db.execute('DELETE FROM data WHERE rowid=1');db.commit();db.close()
        self.assertNotEqual(v['tables']['data']['rowSetSha256'],snapshot.inspect_copy(p)['tables']['data']['rowSetSha256'])
    def test_uninterpretable_text_rejected(self):
        p=self.root/'invalid.sqlite';db=sqlite3.connect(p)
        db.executescript("CREATE TABLE schema_migrations(version,name,checksum,applied_at); CREATE TABLE bad(t TEXT);INSERT INTO bad VALUES(CAST(X'ff' AS TEXT));")
        db.close()
        with self.assertRaises((sqlite3.Error,UnicodeError)):snapshot.inspect_copy(p)
    def test_copy_sidecar_even_dangling_rejected(self):
        p=self.root/'pre.sqlite';Path(str(p)+'-wal').symlink_to(self.root/'absent')
        with self.assertRaisesRegex(ValueError,'COPY_SIDECAR'):snapshot.inspect_copy(p)
    def test_copy_budget_before_creation(self):
        p=self.root/'large';p.write_bytes(b'x')
        with p.open('r+b') as f:f.truncate(c.COPY_BUDGET+1)
        fd=os.open(p,os.O_RDONLY);self.addCleanup(os.close,fd)
        copies=snapshot.PrivateCopies();copies.path=self.root/'not-created'
        with self.assertRaisesRegex(ValueError,'COPY_SIZE_BUDGET'):copies.create({'prestate':fd},{})
        self.assertFalse(copies.path.exists())
    def test_pinned_dependency_byte_drift_rejected(self):
        with patch.object(c,'bounded',return_value=b'bad'):
            with self.assertRaisesRegex(ValueError,'R1_DEPENDENCY_PIN'):c.load_r1()


class TransportAndLedger(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='jso-r2-ledger-');self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.root.chmod(0o700)
    def test_real_process_stream_limit_and_reap(self):
        r=run_bounded([sys.executable,'-c','import sys;sys.stdout.buffer.write(b"x"*1100000)'])
        self.assertTrue(r['limited']);self.assertEqual(len(r['stdout']),1048576)
    def test_real_process_timeout_retains_partial_output(self):
        r=run_bounded([sys.executable,'-u','-c','import time;print("partial");time.sleep(10)'],timeout=.1)
        self.assertTrue(r['limited']);self.assertEqual(r['stdout'],b'partial\n');self.assertIsNotNone(r['exit'])
    def test_durable_nonce_replay_refused(self):
        n=col.issue('a'*64,self.root);col.consume(n,'a'*64,self.root)
        with self.assertRaisesRegex(ValueError,'REPLAY'):col.consume(n,'a'*64,self.root)
    def test_unknown_nonce_or_changed_manifest_refused(self):
        n=col.issue('a'*64,self.root)
        with self.assertRaisesRegex(ValueError,'UNKNOWN'):col.consume(n,'b'*64,self.root)
    def test_all_nonaccepted_or_missing_terminal_states_refused(self):
        n=col.issue('a'*64,self.root);_,_,cw,cm=col.consume(n,'a'*64,self.root)
        with self.assertRaisesRegex(ValueError,'INCOMPLETE'):col.replay(n,{},'a'*64,self.root)
        for status in ['ACCEPTED','UNKNOWN','REJECTED','made_up']:
            with col.connect(self.root) as d:d.execute('DELETE FROM terminal');d.execute('INSERT INTO terminal VALUES(?,?,?,?,?)',(n,status,cw,cm,'a'*64))
            with self.subTest(status=status),self.assertRaisesRegex(ValueError,'UNKNOWN_OR_UNACCEPTED'):col.replay(n,{},'a'*64,self.root)
    def test_deadline_includes_time_since_issue_and_both_clocks(self):
        for wall,mono in [(301,1),(1,301),(-1,1),(1,-1)]:
            with self.subTest(wall=wall,mono=mono),patch.object(col,'TTL_NS',300),self.assertRaises(ValueError):col.fresh(0,0,wall,mono)
    def test_delayed_terminal_commit_cannot_create_accepted_seal(self):
        n=col.issue('a'*64,self.root)
        original_connect=col.connect
        calls=0
        class DelayCommit:
            def __init__(self,conn):self.conn=conn
            def __enter__(self):return self.conn.__enter__()
            def __exit__(self,*args):
                result=self.conn.__exit__(*args)
                time.sleep(.03)
                return result
        def connect(directory):
            nonlocal calls
            calls+=1
            connection=original_connect(directory)
            return DelayCommit(connection) if calls==2 else connection
        with patch.object(col,'TTL_NS',20_000_000),patch.object(col,'connect',side_effect=connect),\
             patch.object(col,'argv',return_value=['synthetic']),\
             patch.object(col,'forward_once',return_value={'exit':0,'stdout':b'{}','stderr':b'','limited':False,'wire':b'{}','sshStdout':b'','sshStderr':b'','tunnel':{'argv':['synthetic']}}),\
             patch.object(col,'validate_transport',return_value={}):
            with self.assertRaisesRegex(ValueError,'CAPTURE_REJECTED'):col.collect(n,{},'a'*64,self.root)
        seal=c.parse((self.root/n/'acceptance.json').read_bytes());self.assertEqual(seal['status'],'REJECTED')
        with self.assertRaises(ValueError):col.replay(n,{},'a'*64,self.root)


class SshExecutableBinding(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='jso-r2-ssh-pin-');self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.root.chmod(0o700)
        known=self.root/'known_hosts';known.write_bytes(b'non-network unit fixture\n')
        self.approval={'purpose':'ISOLATED_VALIDATION_ONLY','referenceEvidenceSha256':'3'*64,
          'collectorRuntime':c.runtime(),'transport':{'host':'127.0.0.1','user':'tester','port':22,
          'keyPath':str(self.root/'unused-key'),'knownHostsPath':str(known),'knownHostsSha256':c.sha(known.read_bytes()),
          'profile':endpoint.PROFILE,'endpoint':endpoint.ENDPOINT,'endpointDeploymentSha256':'d'*64,'endpointParents':[[1,2,0,0,16877]]*3,
          'sshExecutablePath':'/usr/bin/ssh','sshExecutableSha256':c.sha(c.bounded(Path('/usr/bin/ssh'),limit=16*1024*1024,trusted_uid=0))}}
    def test_absolute_approved_client_ignores_missing_caller_path(self):
        with patch.dict(os.environ,{'PATH':str(self.root/'no-programs')}):
            command=col.argv(self.approval,'a'*64)
            self.assertEqual(command[0],'/usr/bin/ssh')
            # Version-only invocation of the real approved binary; no server connection.
            r=run_bounded([command[0],'-V'],env=col.SSH_ENV)
        self.assertEqual(r['exit'],0);self.assertIn(b'OpenSSH',r['stderr'])
    def test_only_fixed_forward_and_no_remote_command(self):
        command=col.argv(self.approval,'a'*64,'/tmp/jso-r2-tunnel-fixture')
        self.assertIn('-N',command);self.assertIn('-T',command)
        self.assertEqual(command[-1],'tester@127.0.0.1')
        self.assertEqual(command[command.index('-L')+1],'/tmp/jso-r2-tunnel-fixture/data.sock:'+endpoint.ENDPOINT)
        self.assertNotIn('sudo',' '.join(command));self.assertNotIn('a'*64,' '.join(command))
        for field,value in [('profile','SHELL'),('endpoint','/home/tester/socket'),('endpointDeploymentSha256',None)]:
            approved=copy.deepcopy(self.approval);approved['transport'][field]=value
            with self.assertRaises(ValueError):col.argv(approved,'a'*64)
    def test_missing_wrong_path_or_byte_pin_refused(self):
        for edit in [lambda t:t.pop('sshExecutableSha256'),lambda t:t.pop('sshExecutablePath'),
                     lambda t:t.update(sshExecutablePath='ssh'),
                     lambda t:t.update(sshExecutablePath='/bin/ssh'),
                     lambda t:t.update(sshExecutableSha256='0'*64)]:
            a=copy.deepcopy(self.approval);edit(a['transport'])
            with self.assertRaises(ValueError):col.argv(a,'a'*64)
    def test_root_custody_failure_has_no_path_fallback(self):
        with patch.object(col,'bounded',side_effect=ValueError('UNTRUSTED_PARENT')) as read:
            with self.assertRaisesRegex(ValueError,'UNTRUSTED_PARENT'):col.argv(self.approval,'a'*64)
        read.assert_called_once_with(Path('/usr/bin/ssh'),limit=16*1024*1024,trusted_uid=0)
    def test_untrusted_filesystem_root_rejected_before_descending(self):
        from types import SimpleNamespace
        for uid,mode in [(65534,0o40755),(0,0o40777)]:
            with patch.object(c.os,'fstat',return_value=SimpleNamespace(st_uid=uid,st_mode=mode)),\
                 patch.object(c.os,'open',wraps=os.open) as opened:
                with self.assertRaisesRegex(ValueError,'UNTRUSTED_PARENT'):col.argv(self.approval,'a'*64)
            self.assertEqual(opened.call_count,1)
            self.assertEqual(opened.call_args.args[0],'/')
    def test_spawn_env_is_replaced_not_inherited(self):
        with patch.dict(os.environ,{'JSO_AMBIENT_TEST_ONLY':'must_not_inherit'}):
            r=run_bounded([sys.executable,'-c','import os,json;print(json.dumps(dict(os.environ)))'],env=col.SSH_ENV)
        env=json.loads(r['stdout']);self.assertNotIn('JSO_AMBIENT_TEST_ONLY',env)
        for key,value in col.SSH_ENV.items():self.assertEqual(env[key],value)
    def test_collector_binds_actual_launch_environment(self):
        n=col.issue('a'*64,self.root)
        with patch.object(col,'forward_once',return_value={'exit':7,'stdout':b'','stderr':b'fixture failure','limited':False,'wire':b'{}','sshStdout':b'','sshStderr':b'','tunnel':{'argv':['synthetic']}}) as run:
            with self.assertRaisesRegex(ValueError,'CAPTURE_REJECTED'):col.collect(n,self.approval,'a'*64,self.root)
        self.assertIs(run.call_args.args[0],col.argv)
        self.assertEqual(run.call_args.args[1],self.approval)
        meta=c.parse((self.root/n/'transport.json').read_bytes())
        self.assertEqual(meta['environment'],col.SSH_ENV)
        changed=copy.deepcopy(meta);changed['environment']['PATH']='/tmp'
        with self.assertRaisesRegex(ValueError,'SSH_ENVIRONMENT_BINDING'):
            col.validate_transport(changed,b'',b'fixture failure',self.approval,'a'*64,n)
        del changed['environment']
        with self.assertRaisesRegex(ValueError,'EXACT_FIELDS_REQUIRED'):
            col.validate_transport(changed,b'',b'fixture failure',self.approval,'a'*64,n)
    def test_changed_executable_refused_before_any_transport(self):
        a=copy.deepcopy(self.approval);a['transport']['sshExecutableSha256']='0'*64
        n=col.issue('a'*64,self.root)
        with patch.object(col,'forward_once') as run:
            with self.assertRaisesRegex(ValueError,'CAPTURE_UNKNOWN'):col.collect(n,a,'a'*64,self.root)
        run.assert_not_called()
        with self.assertRaisesRegex(ValueError,'REPLAY'):col.consume(n,'a'*64,self.root)


class RemoteEndpointBoundary(unittest.TestCase):
    def setUp(self):
        self.parents = [[1, 2, 0, 0, 16877]] * 3
        self.frame = {'version': 1, 'profile': endpoint.PROFILE, 'manifest': 'a'*64,
                      'challenge': 'b'*64, 'exit': 0, 'limited': False, 'stdout': 'b2s=',
                      'stderr': '', 'endpointRemoved': True, 'endpointParents': self.parents}
    def decode(self, raw=None):
        return endpoint.decode_response(c.canonical(self.frame) if raw is None else raw,
                                        'a'*64, 'b'*64, self.parents)
    def test_complete_wire_preserves_streams_and_witness_status(self):
        self.assertEqual(self.decode(), {'stdout': b'ok', 'stderr': b'', 'exit': 0, 'limited': False})
        self.frame['exit'] = 7
        self.assertEqual(self.decode()['exit'], 7)  # not converted to SSH success
    def test_unknown_missing_noncanonical_or_truncated_frame_rejected(self):
        for edit in [lambda r:r.update(extra=True), lambda r:r.pop('exit'), lambda r:r.update(version=True),
                     lambda r:r.update(endpointRemoved=False), lambda r:r.update(exit=None),
                     lambda r:r.update(manifest='c'*64), lambda r:r.update(challenge='c'*64)]:
            frame=copy.deepcopy(self.frame);edit(frame)
            with self.assertRaises(ValueError):self.decode(c.canonical(frame))
        for value in [b'',c.canonical(self.frame)[:-1],c.canonical(self.frame)+b' ',b'x'*(endpoint.MAX_FRAME+1)]:
            with self.assertRaises(ValueError):self.decode(value)
    def test_approved_parent_identity_drift_rejected(self):
        frame=copy.deepcopy(self.frame);frame['endpointParents'][0][1]+=1
        with self.assertRaisesRegex(ValueError,'FRAME_BINDING'):self.decode(c.canonical(frame))
    def test_invalid_or_oversized_encoded_stream_rejected(self):
        for value in ['???',base64.b64encode(b'x'*(c.MAX_OUTPUT+1)).decode()]:
            self.frame['stdout']=value
            with self.assertRaises(ValueError):self.decode()
    def test_no_arbitrary_request_authority(self):
        self.assertEqual(c.parse(endpoint.request('a'*64,'b'*64)),
                         {'version':1,'manifest':'a'*64,'challenge':'b'*64})
        for manifest,challenge in [('x','b'*64),('a'*64,'not-a-challenge')]:
            with self.assertRaises(ValueError):endpoint.request(manifest,challenge)
    def test_unprivileged_listener_rejected_before_creating_socket(self):
        with patch.object(endpoint.os,'getuid',return_value=1000),patch.object(endpoint.socket,'socket') as opened:
            with self.assertRaisesRegex(ValueError,'ENDPOINT_ROOT_REQUIRED'):endpoint.serve_once({},'a'*64)
            opened.assert_not_called()
    def test_cleanup_failure_keeps_partial_bytes_and_residual_identity(self):
        import io
        from unittest.mock import Mock
        pipes=[]
        for raw in [b'partial tunnel output',b'failure detail']:
            rd,wr=os.pipe();os.write(wr,raw);os.close(wr)
            pipes.append(os.fdopen(rd,'rb',buffering=0))
        proc=Mock(stdout=pipes[0],stderr=pipes[1],pid=99999999)
        proc.poll.return_value=None;proc.kill.side_effect=OSError('synthetic cleanup refusal')
        with patch.object(endpoint.subprocess,'Popen',return_value=proc):
            result=endpoint.forward_once(lambda *args:['unit-only'],{},'a'*64,'b'*64,timeout=.03)
        self.assertTrue(result['limited']);self.assertFalse(result['tunnel']['localCleanupConfirmed'])
        self.assertEqual(result['tunnel']['residualPid'],99999999)
        self.assertEqual(result['sshStdout'],b'partial tunnel output')
        self.assertEqual(result['sshStderr'],b'failure detail')


class ExactApprovalBinding(unittest.TestCase):
    """Fabricated approvals exercise validation only; no live store is installed."""
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='jso-r2-approval-');self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.approval={'version':2,'purpose':'PRODUCTION_WINDOW','methodSha256':c.METHOD,
          'contractSha256':'1'*64,'code':{'fixture':'2'*64},
          'release':dict(zip(('prHead','baseHead','postMergeCanonicalHead','sourceTree'),[x*40 for x in 'abcd'])),
          'host':{'instance':'test','boot':'test'},'files':{'synthetic':'bound'},'window':{'notAfter':2},
          'transport':{'host':'159.75.139.246'},'runtime':c.runtime(),'collectorRuntime':c.runtime(),
          'referenceEvidenceSha256':'3'*64,'sourceIndexSha256':'4'*64,
          'mergeRecordSha256':None,'executionApprovalSha256':None}
        self.material={}
        for field,file,flag in [('mergeRecordSha256','merge-record.json','exactMergeVerified'),
                                ('executionApprovalSha256','execution-approval.json','productionExecutionApproved')]:
            r={k:self.approval[k] for k in ('methodSha256','contractSha256','code','release')}
            r.update(version=2,**{flag:True})
            if flag=='productionExecutionApproved':r['executionBindingSha256']=c.execution_binding(self.approval)
            self.material[file]=c.canonical(r);self.approval[field]=c.sha(self.material[file])
    def verify(self,approval):
        # Isolate approval matching from the separately tested fixed-store permission layer.
        with patch.object(c,'bounded',side_effect=lambda p,**kw:self.material[p.name]):
            c.production_approvals(approval,self.root,os.getuid())
    def test_exact_production_approval_projection(self):self.verify(self.approval)
    def test_any_execution_fact_drift_rejected(self):
        for field in ('host','files','window','transport','runtime','collectorRuntime','sourceIndexSha256','referenceEvidenceSha256'):
            r=copy.deepcopy(self.approval);r[field]={'changed':True} if type(r[field]) is dict else '5'*64
            with self.subTest(field=field),self.assertRaisesRegex(ValueError,'EXACT_EXECUTION_SCOPE_DRIFT'):self.verify(r)
    def test_unknown_missing_or_unmerged_canonical_rejected(self):
        for edit in [lambda r:r.update(release=None),lambda r:r['release'].pop('sourceTree'),
                     lambda r:r['release'].update(postMergeCanonicalHead='a'*40),
                     lambda r:r['release'].update(sourceTree='e'*40),
                     lambda r:r.update(executionApprovalSha256=None)]:
            r=copy.deepcopy(self.approval);edit(r)
            with self.assertRaises(ValueError):self.verify(r)


class SourceBootstrap(unittest.TestCase):
    def test_exact_source_loader_parent_custody_and_no_preloaded_modules(self):
        import g3_r2_bootstrap as b
        root=Path(c.__file__).parent
        with tempfile.TemporaryDirectory(prefix='jso-r2-bootstrap-',dir=Path(__file__).resolve().parents[1]) as name:
            home=Path(name);store=home/'.local/share/jso/g3-r2';store.mkdir(parents=True,mode=0o700)
            for p in (home/'.local',home/'.local/share',home/'.local/share/jso'):p.chmod(0o700)
            pins={n:c.sha((root/n).read_bytes()) for n in b.CODE_FILES}
            def run(pins,preload=False):
                (store/'approved.json').write_bytes(c.canonical({'code':pins}));(store/'approved.json').chmod(0o600)
                code='import pathlib,sys,types,os;ns={};exec(compile(pathlib.Path(sys.argv[1]).read_bytes(),sys.argv[1],"exec"),ns);'
                # Synthetic account database for this loader unit only; no CLI HOME override.
                code+='ns["pwd"].getpwnam=lambda name:types.SimpleNamespace(pw_uid=os.getuid(),pw_dir=os.environ["HOME"]);'
                if preload:code+='sys.modules["g3_r2_common"]=types.ModuleType("g3_r2_common");'
                code+='ns["bootstrap"](pathlib.Path(sys.argv[1]).parent,local=True)'
                return subprocess.run([sys.executable,'-c',code,str(root/'g3_r2_bootstrap.py')],env={**os.environ,'HOME':str(home)},capture_output=True)
            result=run(pins);self.assertEqual(result.returncode,0,result.stderr.decode())
            self.assertIn(b'PRELOADED_R2_DEPENDENCY',run(pins,True).stderr)
            missing=dict(pins);missing.pop('g3_r2_acceptance.py')
            self.assertIn(b'REQUIRED_CODE_SET',run(missing).stderr)
            wrong=dict(pins);wrong['g3_r2_common.py']='0'*64
            self.assertIn(b'CODE_PIN_BEFORE_IMPORT',run(wrong).stderr)
            (home/'.local').chmod(0o770)
            self.assertIn(b'UNTRUSTED_APPROVAL_PARENT',run(pins).stderr)


class WriterStoppedSemantics(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='jso-writer-unit-'); self.addCleanup(self.tmp.cleanup)
        self.approval, self.record = observation(Path(self.tmp.name))
    def validate(self):
        return a.validate_observation(raw(self.record), self.approval, 'b'*64, 'a'*64)
    def repin_inventory(self):
        x=self.approval;w=x['window']
        value={'version':1,'host':x['host'],'files':{s:{'path':x['files'][s]['path'],'sha256':x['files'][s]['identity']['sha256']} for s in c.SIDES},'responsibilitySha256':w['responsibilitySha256'],'writers':w['writers']}
        next(x for x in w['controls'] if x['role']=='writerInventory')['sha256']=c.sha(c.canonical(value))
    def test_fixed_managed_stopped_state_accepted(self):
        self.validate()
    def test_old_arbitrary_checks_and_unmanaged_helpers_rejected(self):
        self.approval['window']['readonlyChecks']=[{'argv':['/usr/bin/pgrep','-f','unrelated']}]
        with self.assertRaises(ValueError): self.validate()
        del self.approval['window']['readonlyChecks']
        self.approval['window']['writers'][1]['kind']='pgrep';self.repin_inventory()
        with self.assertRaisesRegex(ValueError,'UNSUPPORTED_WRITER'): self.validate()
    def test_inventory_object_host_or_target_drift_rejected(self):
        for edit in [lambda x:x['host'].update(boot='other'),lambda x:x['files']['active'].update(path='/other'),
                     lambda x:x['window']['writers'][0].update(target='other.service')]:
            saved=copy.deepcopy(self.approval);edit(self.approval)
            with self.assertRaisesRegex(ValueError,'BINDING'): cust.writer_inventory(self.approval)
            self.approval=saved
    def test_missing_duplicate_or_unrelated_helper_rejected(self):
        for edit in [lambda w:w.pop(),lambda w:w.append(copy.deepcopy(w[0])),lambda w:w[1].update(entrypointPath='/unrelated')]:
            saved=copy.deepcopy(self.approval);edit(self.approval['window']['writers']);self.repin_inventory()
            with self.assertRaises(ValueError): self.validate()
            self.approval=saved
    def test_missing_writer_evidence_or_extra_item_rejected(self):
        for value in [{}, {**self.record['writersBefore'],'extra':{}}]:
            with self.assertRaises(ValueError): cust.validate_writer_evidence(value,self.approval)
    def test_active_unknown_stale_or_residual_tasks_rejected(self):
        w=self.approval['window']['writers'][0];base=self.record['writersBefore']['runtime']
        for key,value in [('Id','unrelated.service'),('ActiveState','active'),('LoadState','not-found'),('MainPID','42'),
                          ('ControlPID','4'),('TasksCurrent','1'),('UnitFileState','enabled'),('Restart','always'),
                          ('NeedDaemonReload','yes'),('ControlGroup','/system.slice/other.service'),('DropInPaths','/other.conf')]:
            item=copy.deepcopy(base);state=dict(item['state']);state[key]=value
            item['stdout']=''.join(k+'='+v+'\n' for k,v in state.items())
            with self.subTest(key=key),self.assertRaises(ValueError):cust.stopped_state(w,item)
    def test_nonzero_limited_stderr_and_duplicate_properties_rejected(self):
        w=self.approval['window']['writers'][0];base=self.record['writersBefore']['runtime']
        for change in [{'exit':1},{'exit':True},{'limited':True},{'stderr':'permission denied'},
                       {'stdout':base['stdout']+'Id=other.service\n'},{'stdout':'Id='+w['target']+'\n'}]:
            with self.assertRaises(ValueError):cust.stopped_state(w,{**base,**change})
    def test_cgroup_absence_and_mask_root_custody_required(self):
        w=self.approval['window']['writers'][0];base=self.record['writersBefore']['runtime']['guard']
        for edit in [lambda g:g.update(cgroupAbsent=False),lambda g:g.update(cgroupFilesystem='unknown'),
                     lambda g:g['maskParents'][0].__setitem__(2,1000),lambda g:g['maskParents'][3].__setitem__(4,16895),
                     lambda g:g['maskIdentity'].__setitem__(2,1000)]:
            guard=copy.deepcopy(base);edit(guard)
            with self.assertRaises(ValueError):cust.validate_writer_guard(w,guard)
    def test_replay_reparses_raw_and_rejects_command_environment_or_pin_change(self):
        for edit in [lambda x:x.update(state={}),lambda x:x['argv'].__setitem__(-1,'unrelated.service'),
                     lambda x:x['environment'].update(DOCKER_HOST='other'),lambda x:x.update(probeSha256='0'*64),
                     lambda x:x.update(stdoutSha256='0'*64)]:
            evidence=copy.deepcopy(self.record['writersBefore']);edit(evidence['runtime'])
            with self.assertRaises(ValueError):cust.validate_writer_evidence(evidence,self.approval)
    def test_container_stopped_identity_configuration_and_restart_semantics(self):
        config={'image':'sha256:'+'1'*64,'path':'/app/writer','args':[],'mounts':[{'Source':'/data'}]}
        w={'kind':'docker','target':'a'*64,'configurationSha256':c.sha(c.canonical(config))}
        state={'id':w['target'],'status':'exited','running':False,'paused':False,'restarting':False,'dead':False,
               'pid':0,'error':'','restartPolicy':{'Name':'no','MaximumRetryCount':0},'configuration':config}
        def check(x):return cust.stopped_state(w,{'exit':0,'limited':False,'stderr':'','stdout':json.dumps(x)})
        check(state)
        for edit in [lambda x:x.update(id='b'*64),lambda x:x.update(running=True),lambda x:x.update(status='running'),
                     lambda x:x.update(pid=True),lambda x:x['restartPolicy'].update(Name='always'),
                     lambda x:x['configuration'].update(path='/unrelated')]:
            value=copy.deepcopy(state);edit(value)
            with self.assertRaises(ValueError):check(value)
    def test_probe_failure_never_reaches_database_open(self):
        with patch.object(cust,'controls',side_effect=ValueError('WRITER_NOT_STOPPED')):
            with patch.object(cust,'load_r1') as loader:
                opened=loader.return_value.open_pinned
                with self.assertRaisesRegex(ValueError,'WRITER_NOT_STOPPED'):
                    with cust.PinnedPair(self.approval):pass
                opened.assert_not_called()




class LocalCustodyIdentityTests(unittest.TestCase):
    def identity(self):
        return patch.object(bootstrap.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=1000, pw_dir='/home/jenn'))

    def test_fixed_account_paths(self):
        with self.identity() as lookup, patch.object(bootstrap.os, 'getuid', return_value=1000), patch.object(bootstrap.os, 'geteuid', return_value=1000), patch.dict(os.environ, {'HOME': '/home/jenn'}):
            self.assertEqual(bootstrap.local_custody_home(), Path('/home/jenn'))
            self.assertEqual(col.evidence_directory(), Path('/home/jenn/.local/share/jso/g3-r2-evidence'))
            lookup.assert_called_with('jenn')

    def test_home_drift_rejected_before_store_io(self):
        with self.identity(), patch.object(bootstrap.os, 'getuid', return_value=1000), patch.object(bootstrap.os, 'geteuid', return_value=1000), patch.dict(os.environ, {'HOME': '/tmp/synthetic-home'}), patch.object(bootstrap.os, 'open') as opened:
            with self.assertRaisesRegex(ValueError, 'ENVIRONMENT_DRIFT'):
                bootstrap.bootstrap(Path('/synthetic-code'), local=True)
            opened.assert_not_called()
            with self.assertRaisesRegex(ValueError, 'ENVIRONMENT_DRIFT'):
                c.load_approval(local=True)
            with self.assertRaisesRegex(ValueError, 'ENVIRONMENT_DRIFT'):
                col.issue('0' * 64)

    def test_wrong_or_elevated_identity_rejected(self):
        for uid, euid in ((1001,1001), (1000,0), (0,0)):
            with self.subTest(uid=uid, euid=euid), self.identity(), patch.object(bootstrap.os, 'getuid', return_value=uid), patch.object(bootstrap.os, 'geteuid', return_value=euid):
                with self.assertRaisesRegex(ValueError, 'LOCAL_CUSTODY_IDENTITY'):
                    bootstrap.local_custody_home()

if __name__ == "__main__":
    unittest.main()
