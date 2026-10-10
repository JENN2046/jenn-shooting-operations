"""Jenn custody: durable one-use challenges and exact authenticated SSH transcripts."""
import os
from pathlib import Path
import re
import sqlite3
import time
import secrets

from g3_r2_common import (bounded, canonical, DENY, exact, fsync_dir, load_approval, local_custody_home,
                          need, parse, reference, runtime, save_new, sha, SHA)
from g3_r2_acceptance import validate_observation
from g3_r2_transport import run_bounded
from g3_r2_endpoint import ENDPOINT, PROFILE, decode_response, forward_once

SSH_EXECUTABLE = '/usr/bin/ssh'
SSH_ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}
TTL_NS = 300_000_000_000
def evidence_directory():
    return local_custody_home() / '.local/share/jso/g3-r2-evidence'


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def clock():
    return time.time_ns(), time.monotonic_ns()


def boot():
    return Path('/proc/sys/kernel/random/boot_id').read_text().strip()


def db_readonly(directory):
    p = directory / 'ledger.sqlite'
    need(p.is_file() and not p.is_symlink(), 'LEDGER_MISSING')
    return sqlite3.connect(p.as_uri() + '?mode=ro', uri=True, factory=ClosingConnection)


def connect(directory):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    st = directory.lstat()
    need(st.st_uid == os.getuid() and (st.st_mode & 0o777) == 0o700 and not directory.is_symlink(), 'EVIDENCE_CUSTODY')
    path = directory / 'ledger.sqlite'
    need(not path.is_symlink(), 'LEDGER_SYMLINK')
    d = sqlite3.connect(path, factory=ClosingConnection)
    os.chmod(path, 0o600)
    d.execute('PRAGMA synchronous=FULL')
    d.execute('PRAGMA journal_mode=DELETE')
    d.executescript('''
      CREATE TABLE IF NOT EXISTS issues(n TEXT PRIMARY KEY, wall INTEGER NOT NULL, mono INTEGER NOT NULL, boot TEXT NOT NULL, manifest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS consumed(n TEXT PRIMARY KEY, wall INTEGER NOT NULL, mono INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS terminal(n TEXT PRIMARY KEY, status TEXT NOT NULL, wall INTEGER NOT NULL, mono INTEGER NOT NULL, digest TEXT NOT NULL);
    ''')
    d.commit()
    fsync_dir(directory)
    return d


def issue(approval_sha, directory=None):
    directory = evidence_directory() if directory is None else directory
    n = secrets.token_hex(32)
    wall, mono = clock()
    with connect(directory) as d:
        d.execute('INSERT INTO issues VALUES(?,?,?,?,?)', (n, wall, mono, boot(), approval_sha))
    fsync_dir(directory)
    return n


def consume(n, approval_sha, directory):
    with connect(directory) as d:
        d.execute('BEGIN IMMEDIATE')
        row = d.execute('SELECT wall,mono,boot,manifest FROM issues WHERE n=?', (n,)).fetchone()
        need(row is not None and row[2] == boot() and row[3] == approval_sha, 'UNKNOWN_CHALLENGE_OR_BOOT')
        need(d.execute('SELECT n FROM consumed WHERE n=?', (n,)).fetchone() is None, 'REPLAY')
        wall, mono = clock()
        d.execute('INSERT INTO consumed VALUES(?,?,?)', (n, wall, mono))
    fsync_dir(directory)  # durable consumption precedes SSH creation
    return row[0], row[1], wall, mono


def argv(approval, challenge, tunnel_directory=None):
    t = approval['transport']
    exact(t, ('host', 'user', 'port', 'keyPath', 'knownHostsPath', 'knownHostsSha256',
              'sshExecutablePath', 'sshExecutableSha256', 'profile', 'endpoint', 'endpointDeploymentSha256', 'endpointParents'))
    need(t['profile'] == PROFILE and t['endpoint'] == ENDPOINT, 'ENDPOINT_PROFILE_REQUIRED')
    need(type(t['endpointDeploymentSha256']) is str and SHA.fullmatch(t['endpointDeploymentSha256']), 'ENDPOINT_DEPLOYMENT_REQUIRED')
    directory = Path(tunnel_directory or '/tmp/jso-r2-tunnel-placeholder')
    need(str(directory.parent) == '/tmp' and re.fullmatch('jso-r2-tunnel-[a-z0-9_]+', directory.name), 'TUNNEL_PATH')
    need(t['sshExecutablePath'] == SSH_EXECUTABLE, 'FIXED_SSH_EXECUTABLE_REQUIRED')
    need(type(t['sshExecutableSha256']) is str and SHA.fullmatch(t['sshExecutableSha256']), 'SSH_EXECUTABLE_PIN_REQUIRED')
    # The fixed path and every parent must remain under root custody. The approved
    # bytes, not PATH lookup or a caller-provided version string, identify the client.
    need(sha(bounded(Path(SSH_EXECUTABLE), limit=16 * 1024 * 1024, trusted_uid=0)) ==
         t['sshExecutableSha256'], 'SSH_EXECUTABLE_DRIFT')
    need(re.fullmatch(r'[A-Za-z0-9_.-]+', t['host']) and re.fullmatch(r'[a-z_][a-z0-9_-]*', t['user']), 'SSH_TARGET')
    need(type(t['port']) is int and 1 <= t['port'] <= 65535, 'SSH_PORT')
    if approval['purpose'] == 'PRODUCTION_WINDOW':
        need(t['host'] == '159.75.139.246' and t['user'] == 'ubuntu' and t['port'] == 22, 'PRODUCTION_TARGET')
    else:
        need(t['host'] == '127.0.0.1', 'LAB_LOOPBACK_ONLY')
    need(sha(bounded(Path(t['knownHostsPath']))) == t['knownHostsSha256'], 'HOSTKEY_PIN')
    need(Path(t['keyPath']).is_absolute(), 'KEY_PATH')
    return [SSH_EXECUTABLE, '-F', '/dev/null', '-i', t['keyPath'], '-p', str(t['port']),
            '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
            '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'ForwardAgent=no',
            '-o', 'ClearAllForwardings=no', '-o', 'GlobalKnownHostsFile=/dev/null',
            '-o', 'UserKnownHostsFile="' + t['knownHostsPath'].replace('\\', '\\\\').replace('"', '\\"') + '"', '-o', 'ConnectTimeout=10',
            '-o', 'ExitOnForwardFailure=yes', '-o', 'StreamLocalBindUnlink=no',
            '-o', 'StreamLocalBindMask=0177', '-o', 'ControlPersist=no',
            '-M', '-S', str(directory / 'control.sock'), '-N', '-T', '-n',
            '-L', str(directory / 'data.sock') + ':' + ENDPOINT, t['user'] + '@' + t['host']]


def fresh(issued_wall, issued_mono, wall, mono):
    need(issued_wall <= wall < issued_wall + TTL_NS and issued_mono <= mono < issued_mono + TTL_NS, 'CHALLENGE_EXPIRED_OR_TIME_REVERSED')


def collect(n, approval, approval_sha, directory=None):
    directory = evidence_directory() if directory is None else directory
    need(re.fullmatch('[a-f0-9]{64}', n), 'CHALLENGE')
    iw, im, cw, cm = consume(n, approval_sha, directory)
    target = directory / n
    target.mkdir(mode=0o700)
    fsync_dir(directory)
    command = []
    status = 'REJECTED'
    result = {'exit': None, 'stdout': b'', 'stderr': b'', 'limited': False,
              'wire': b'', 'sshStdout': b'', 'sshStderr': b'', 'tunnel': {}}
    sw, sm = clock()
    reason = 'PRETRANSPORT_REJECTED'
    try:
        fresh(iw, im, cw, cm)
        fresh(iw, im, sw, sm)
        command = argv(approval, n)
        result = forward_once(argv, approval, approval_sha, n)
        command = result['tunnel']['argv']
        reason = 'TRANSPORT_COMPLETE'
    except (ValueError, OSError):
        pass
    ew, em = clock()
    # Preserve exact outputs first, fsync them and their directory, then calculate/bind digests.
    save_new(target / 'stdout', result['stdout'])
    save_new(target / 'stderr', result['stderr'])
    for key in ('wire', 'sshStdout', 'sshStderr'):
        save_new(target / key, result[key])
    meta = {'version': 2, 'challenge': n, 'argv': command, 'environment': dict(SSH_ENV), 'manifest': approval_sha,
            'issuedWall': iw, 'issuedMono': im, 'consumedWall': cw, 'consumedMono': cm,
            'startedWall': sw, 'startedMono': sm, 'finishedWall': ew, 'finishedMono': em,
            'collectorBoot': boot(), 'collectorRuntime': runtime(), 'exit': result['exit'], 'limited': result['limited'], 'transportState': reason,
            'stdoutSha256': sha(result['stdout']), 'stderrSha256': sha(result['stderr']),
            'stdoutBytes': len(result['stdout']), 'stderrBytes': len(result['stderr']),
            'tunnel': result['tunnel'], 'endpointProfile': PROFILE,
            'wireSha256': sha(result['wire']), 'wireBytes': len(result['wire']),
            'sshStdoutSha256': sha(result['sshStdout']), 'sshStdoutBytes': len(result['sshStdout']),
            'sshStderrSha256': sha(result['sshStderr']), 'sshStderrBytes': len(result['sshStderr'])}
    save_new(target / 'transport.json', canonical(meta))
    try:
        validate_transport(meta, result['stdout'], result['stderr'], approval, approval_sha, n,
                           result['wire'], result['sshStdout'], result['sshStderr'])
        aw, am = clock()
        fresh(iw, im, aw, am)
        status = 'ACCEPTED'
    except (ValueError, KeyError, TypeError, UnicodeError):
        status = 'UNKNOWN' if result['limited'] or result['exit'] is None else 'REJECTED'
    tw, tm = clock()
    if status == 'ACCEPTED':
        try:
            fresh(iw, im, tw, tm)
        except ValueError:
            status = 'REJECTED'
    with connect(directory) as d:
        d.execute('INSERT INTO terminal VALUES(?,?,?,?,?)', (n, 'PENDING_FINAL_ACCEPTANCE' if status == 'ACCEPTED' else status, tw, tm, sha(canonical(meta))))
    fsync_dir(directory)
    # Decide only AFTER the terminal candidate is durable. A stalled commit must never
    # leave an independently acceptable ACCEPTED row with a pre-commit timestamp.
    dw, dm = clock()
    try:
        fresh(iw, im, dw, dm)
    except ValueError:
        status = 'REJECTED'
    save_new(target / 'acceptance.json', canonical({'version': 2, 'status': status,
             'terminalDigest': sha(canonical(meta)), 'durableTerminalObservedWall': dw,
             'durableTerminalObservedMono': dm, 'collectorBoot': boot()}))
    need(status == 'ACCEPTED', 'CAPTURE_' + status)
    return replay(n, approval, approval_sha, directory, require_fresh=True)


def validate_transport(meta, out, err, approval, approval_sha, n, wire=b'', ssh_out=b'', ssh_err=b''):
    exact(meta, ('version', 'challenge', 'argv', 'environment', 'manifest', 'issuedWall', 'issuedMono', 'consumedWall', 'consumedMono',
                 'startedWall', 'startedMono', 'finishedWall', 'finishedMono', 'collectorBoot', 'exit', 'limited',
                 'transportState', 'collectorRuntime', 'stdoutSha256', 'stderrSha256', 'stdoutBytes', 'stderrBytes',
                 'tunnel', 'endpointProfile', 'wireSha256', 'wireBytes', 'sshStdoutSha256', 'sshStdoutBytes',
                 'sshStderrSha256', 'sshStderrBytes'))
    need(meta['environment'] == SSH_ENV, 'SSH_ENVIRONMENT_BINDING')
    need(meta['collectorRuntime'] == approval['collectorRuntime'], 'COLLECTOR_RUNTIME_BINDING')
    need(meta['version'] == 2 and meta['challenge'] == n and meta['manifest'] == approval_sha, 'TRANSPORT_BINDING')
    need(type(meta['exit']) is int and meta['exit'] == 0 and meta['limited'] is False and meta['transportState'] == 'TRANSPORT_COMPLETE', 'INCOMPLETE_TRANSPORT')
    tunnel = meta['tunnel']
    exact(tunnel, ('argv', 'shutdownArgv', 'sshExit', 'shutdownExit', 'shutdownStdout', 'shutdownStderr', 'localCleanupConfirmed', 'residualPid', 'cleanupError'))
    need(type(tunnel['argv']) is list and '-S' in tunnel['argv'], 'TUNNEL_ARGV')
    directory = str(Path(tunnel['argv'][tunnel['argv'].index('-S') + 1]).parent)
    expected = argv(approval, n, directory)
    need(meta['endpointProfile'] == PROFILE and meta['argv'] == tunnel['argv'] == expected, 'EXACT_SSH_COMMAND')
    need(tunnel['shutdownArgv'] == [SSH_EXECUTABLE, '-F', '/dev/null', '-S', directory + '/control.sock', '-O', 'exit',
         approval['transport']['user'] + '@' + approval['transport']['host']], 'EXACT_TUNNEL_SHUTDOWN')
    need(type(tunnel['sshExit']) is int and tunnel['sshExit'] == 0 and
         type(tunnel['shutdownExit']) is int and tunnel['shutdownExit'] == 0 and
         tunnel['shutdownStdout'] == '' and tunnel['shutdownStderr'] == 'Exit request sent.\r\n' and
         tunnel['localCleanupConfirmed'] is True and tunnel['residualPid'] is None and tunnel['cleanupError'] is None, 'TUNNEL_TERMINAL_OR_CLEANUP')
    for prefix, raw in [('wire', wire), ('sshStdout', ssh_out), ('sshStderr', ssh_err)]:
        need(type(meta[prefix + 'Bytes']) is int and meta[prefix + 'Bytes'] == len(raw) and
             meta[prefix + 'Sha256'] == sha(raw), 'TUNNEL_RAW_BINDING')
    need(not ssh_out and not ssh_err, 'SSH_TUNNEL_STREAMS')
    decoded = decode_response(wire, approval_sha, n, approval['transport']['endpointParents'])
    need(decoded == {'stdout': out, 'stderr': err, 'exit': meta['exit'], 'limited': meta['limited']}, 'WITNESS_FRAME_BINDING')
    need(len(out) == meta['stdoutBytes'] and len(err) == meta['stderrBytes'] and sha(out) == meta['stdoutSha256'] and sha(err) == meta['stderrSha256'], 'RAW_TRANSCRIPT_DIGEST')
    need(err == ('JSO_R2_COMPLETE:' + n + '\n').encode(), 'COMPLETE_STDERR_REQUIRED')
    for suffix in ('Wall', 'Mono'):
        ts = [meta[k + suffix] for k in ('issued', 'consumed', 'started', 'finished')]
        need(all(type(t) is int for t in ts) and ts == sorted(ts), 'TRANSPORT_TIME_ORDER')
    fresh(meta['issuedWall'], meta['issuedMono'], meta['finishedWall'], meta['finishedMono'])
    return validate_observation(out, approval, approval_sha, n)


def read_raw(path, size, limit=1024 * 1024):
    # Raw stderr may be empty on a rejected attempt; accepted R2 always has its exact marker.
    need(type(size) is int and 0 <= size <= limit, 'RAW_SIZE')
    if size:
        return bounded(path, limit=limit)
    need(path.is_file() and not path.is_symlink() and path.stat().st_size == 0, 'EMPTY_RAW_FILE')
    return b''


def replay(n, approval, approval_sha, directory=None, require_fresh=False):
    directory = evidence_directory() if directory is None else directory
    need(re.fullmatch('[a-f0-9]{64}', n), 'CHALLENGE')
    with db_readonly(directory) as d:
        need(d.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'LEDGER_INTEGRITY')
        issue_row = d.execute('SELECT wall,mono,boot,manifest FROM issues WHERE n=?', (n,)).fetchone()
        consumed_row = d.execute('SELECT wall,mono FROM consumed WHERE n=?', (n,)).fetchone()
        terminal = d.execute('SELECT status,wall,mono,digest FROM terminal WHERE n=?', (n,)).fetchone()
    need(issue_row and consumed_row and terminal, 'INCOMPLETE_LEDGER_TERMINAL')
    need(terminal[0] == 'PENDING_FINAL_ACCEPTANCE', 'UNKNOWN_OR_UNACCEPTED_TERMINAL')
    target = directory / n
    raw = bounded(target / 'transport.json')
    need(sha(raw) == terminal[3], 'LEDGER_RECEIPT_DIGEST')
    meta = parse(raw)
    need(tuple(meta[k] for k in ('issuedWall', 'issuedMono', 'collectorBoot', 'manifest')) == issue_row and
         tuple(meta[k] for k in ('consumedWall', 'consumedMono')) == consumed_row, 'LEDGER_TRANSPORT_BINDING')
    need(meta['finishedWall'] <= terminal[1] and meta['finishedMono'] <= terminal[2], 'TERMINAL_TIME_ORDER')
    fresh(issue_row[0], issue_row[1], terminal[1], terminal[2])
    acceptance = parse(bounded(target / 'acceptance.json'))
    exact(acceptance, ('version', 'status', 'terminalDigest', 'durableTerminalObservedWall', 'durableTerminalObservedMono', 'collectorBoot'))
    need(acceptance['version'] == 2 and acceptance['status'] == 'ACCEPTED' and acceptance['terminalDigest'] == terminal[3]
         and acceptance['collectorBoot'] == issue_row[2], 'ACCEPTANCE_SEAL_REQUIRED')
    need(terminal[1] <= acceptance['durableTerminalObservedWall'] and terminal[2] <= acceptance['durableTerminalObservedMono'], 'DURABLE_TERMINAL_ORDER')
    fresh(issue_row[0], issue_row[1], acceptance['durableTerminalObservedWall'], acceptance['durableTerminalObservedMono'])
    validate_transport(meta, read_raw(target / 'stdout', meta['stdoutBytes']),
                       read_raw(target / 'stderr', meta['stderrBytes']), approval, approval_sha, n,
                       read_raw(target / 'wire', meta['wireBytes'], 3 * 1024 * 1024),
                       read_raw(target / 'sshStdout', meta['sshStdoutBytes']),
                       read_raw(target / 'sshStderr', meta['sshStderrBytes']))
    if require_fresh:
        need(issue_row[2] == boot(), 'COLLECTOR_BOOT_CHANGED')
        wall, mono = clock()
        fresh(issue_row[0], issue_row[1], wall, mono)
    return {'version': 2, 'status': 'INDEPENDENT_R2_ACCEPTED_AT_CAPTURE' if approval['purpose'] == 'PRODUCTION_WINDOW' else 'ISOLATED_R2_ACCEPTED_NOT_PRODUCTION',
            'challenge': n, 'manifest': approval_sha, 'transportDigest': terminal[3],
            'freshAtThisVerification': bool(require_fresh), 'historicalWalCompleteness': 'NOT_PROVEN', **DENY}
