"""Jenn custody: durable one-use challenges and exact authenticated SSH transcripts."""
import os
from pathlib import Path
import re
import shlex
import sqlite3
import time
import secrets

from g3_r2_common import (bounded, canonical, DENY, exact, fsync_dir, load_approval, LOCAL_STORE,
                          need, parse, reference, runtime, save_new, sha)
from g3_r2_acceptance import validate_observation
from g3_r2_transport import run_bounded

TTL_NS = 300_000_000_000
EVIDENCE = Path.home() / '.local/share/jso/g3-r2-evidence'


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


def issue(approval_sha, directory=EVIDENCE):
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


def argv(approval, challenge):
    t = approval['transport']
    exact(t, ('host', 'user', 'port', 'keyPath', 'knownHostsPath', 'knownHostsSha256'))
    need(re.fullmatch(r'[A-Za-z0-9_.-]+', t['host']) and re.fullmatch(r'[a-z_][a-z0-9_-]*', t['user']), 'SSH_TARGET')
    need(type(t['port']) is int and 1 <= t['port'] <= 65535, 'SSH_PORT')
    if approval['purpose'] == 'PRODUCTION_WINDOW':
        need(t['host'] == '159.75.139.246' and t['user'] == 'ubuntu' and t['port'] == 22, 'PRODUCTION_TARGET')
    else:
        need(t['host'] == '127.0.0.1', 'LAB_LOOPBACK_ONLY')
    need(sha(bounded(Path(t['knownHostsPath']))) == t['knownHostsSha256'], 'HOSTKEY_PIN')
    need(Path(t['keyPath']).is_absolute(), 'KEY_PATH')
    remote = ['sudo', '-n', '/usr/bin/python3', '-E', '-s',
              '/opt/jso/g3-r2/g3-forward-adoption-readonly-witness-r2.py', 'capture',
              '--reference-evidence', '/etc/jso/g3-r2/reference.json',
              '--expected-reference-evidence-sha256', approval['referenceEvidenceSha256'], '--challenge', challenge]
    return ['ssh', '-F', '/dev/null', '-i', t['keyPath'], '-p', str(t['port']),
            '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
            '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'ForwardAgent=no',
            '-o', 'ClearAllForwardings=yes', '-o', 'GlobalKnownHostsFile=/dev/null',
            '-o', 'UserKnownHostsFile="' + t['knownHostsPath'].replace('\\', '\\\\').replace('"', '\\"') + '"', '-o', 'ConnectTimeout=10',
            t['user'] + '@' + t['host'], shlex.join(remote)]


def fresh(issued_wall, issued_mono, wall, mono):
    need(issued_wall <= wall < issued_wall + TTL_NS and issued_mono <= mono < issued_mono + TTL_NS, 'CHALLENGE_EXPIRED_OR_TIME_REVERSED')


def collect(n, approval, approval_sha, directory=EVIDENCE):
    need(re.fullmatch('[a-f0-9]{64}', n), 'CHALLENGE')
    iw, im, cw, cm = consume(n, approval_sha, directory)
    target = directory / n
    target.mkdir(mode=0o700)
    fsync_dir(directory)
    command = []
    status = 'REJECTED'
    result = {'exit': None, 'stdout': b'', 'stderr': b'', 'limited': False}
    sw, sm = clock()
    reason = 'PRETRANSPORT_REJECTED'
    try:
        fresh(iw, im, cw, cm)
        fresh(iw, im, sw, sm)
        command = argv(approval, n)
        result = run_bounded(command, timeout=120)
        reason = 'TRANSPORT_COMPLETE'
    except (ValueError, OSError):
        pass
    ew, em = clock()
    # Preserve exact outputs first, fsync them and their directory, then calculate/bind digests.
    save_new(target / 'stdout', result['stdout'])
    save_new(target / 'stderr', result['stderr'])
    meta = {'version': 2, 'challenge': n, 'argv': command, 'manifest': approval_sha,
            'issuedWall': iw, 'issuedMono': im, 'consumedWall': cw, 'consumedMono': cm,
            'startedWall': sw, 'startedMono': sm, 'finishedWall': ew, 'finishedMono': em,
            'collectorBoot': boot(), 'collectorRuntime': runtime(), 'exit': result['exit'], 'limited': result['limited'], 'transportState': reason,
            'stdoutSha256': sha(result['stdout']), 'stderrSha256': sha(result['stderr']),
            'stdoutBytes': len(result['stdout']), 'stderrBytes': len(result['stderr'])}
    save_new(target / 'transport.json', canonical(meta))
    try:
        validate_transport(meta, result['stdout'], result['stderr'], approval, approval_sha, n)
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


def validate_transport(meta, out, err, approval, approval_sha, n):
    exact(meta, ('version', 'challenge', 'argv', 'manifest', 'issuedWall', 'issuedMono', 'consumedWall', 'consumedMono',
                 'startedWall', 'startedMono', 'finishedWall', 'finishedMono', 'collectorBoot', 'exit', 'limited',
                 'transportState', 'collectorRuntime', 'stdoutSha256', 'stderrSha256', 'stdoutBytes', 'stderrBytes'))
    need(meta['collectorRuntime'] == approval['collectorRuntime'], 'COLLECTOR_RUNTIME_BINDING')
    need(meta['version'] == 2 and meta['challenge'] == n and meta['manifest'] == approval_sha, 'TRANSPORT_BINDING')
    need(type(meta['exit']) is int and meta['exit'] == 0 and meta['limited'] is False and meta['transportState'] == 'TRANSPORT_COMPLETE', 'INCOMPLETE_TRANSPORT')
    need(meta['argv'] == argv(approval, n), 'EXACT_SSH_COMMAND')
    need(len(out) == meta['stdoutBytes'] and len(err) == meta['stderrBytes'] and sha(out) == meta['stdoutSha256'] and sha(err) == meta['stderrSha256'], 'RAW_TRANSCRIPT_DIGEST')
    need(err == ('JSO_R2_COMPLETE:' + n + '\n').encode(), 'COMPLETE_STDERR_REQUIRED')
    for suffix in ('Wall', 'Mono'):
        ts = [meta[k + suffix] for k in ('issued', 'consumed', 'started', 'finished')]
        need(all(type(t) is int for t in ts) and ts == sorted(ts), 'TRANSPORT_TIME_ORDER')
    fresh(meta['issuedWall'], meta['issuedMono'], meta['finishedWall'], meta['finishedMono'])
    return validate_observation(out, approval, approval_sha, n)


def read_raw(path, size):
    # Raw stderr may be empty on a rejected attempt; accepted R2 always has its exact marker.
    need(type(size) is int and 0 <= size <= 1024 * 1024, 'RAW_SIZE')
    if size:
        return bounded(path)
    need(path.is_file() and not path.is_symlink() and path.stat().st_size == 0, 'EMPTY_RAW_FILE')
    return b''


def replay(n, approval, approval_sha, directory=EVIDENCE, require_fresh=False):
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
                       read_raw(target / 'stderr', meta['stderrBytes']), approval, approval_sha, n)
    if require_fresh:
        need(issue_row[2] == boot(), 'COLLECTOR_BOOT_CHANGED')
        wall, mono = clock()
        fresh(issue_row[0], issue_row[1], wall, mono)
    return {'version': 2, 'status': 'INDEPENDENT_R2_ACCEPTED_AT_CAPTURE' if approval['purpose'] == 'PRODUCTION_WINDOW' else 'ISOLATED_R2_ACCEPTED_NOT_PRODUCTION',
            'challenge': n, 'manifest': approval_sha, 'transportDigest': terminal[3],
            'freshAtThisVerification': bool(require_fresh), 'historicalWalCompleteness': 'NOT_PROVEN', **DENY}
