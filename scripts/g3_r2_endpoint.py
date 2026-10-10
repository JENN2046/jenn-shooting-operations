"""One capture through a root-custodied Unix endpoint; never a remote shell."""
import base64
import os
from pathlib import Path
import pwd
import re
import selectors
import socket
import stat
import struct
import subprocess
import tempfile
import time

from g3_r2_common import bounded, canonical, exact, MAX_OUTPUT, need, parse, sha
from g3_r2_transport import run_bounded

ENDPOINT = '/run/jso-g3-r2/capture.sock'
PROFILE = 'ROOT_UNIX_ONESHOT_SSH_FORWARD_R1'
MAX_FRAME = 3 * MAX_OUTPUT
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}


def request(manifest, challenge):
    need(re.fullmatch('[a-f0-9]{64}', manifest) and re.fullmatch('[a-f0-9]{64}', challenge), 'ENDPOINT_REQUEST')
    return canonical({'version': 1, 'manifest': manifest, 'challenge': challenge})


def decode_response(raw, manifest, challenge, parents):
    # The wire is bounded separately; the existing JSON parser has a 1 MiB limit.
    need(0 < len(raw) <= MAX_FRAME, 'ENDPOINT_FRAME_SIZE')
    import json
    obj = json.loads(raw.decode('utf-8', 'strict'))
    need(canonical(obj) == raw, 'ENDPOINT_CANONICAL_FRAME')
    exact(obj, ('version', 'profile', 'manifest', 'challenge', 'exit', 'limited', 'stdout', 'stderr', 'endpointRemoved', 'endpointParents'))
    need(type(obj['version']) is int and obj['version'] == 1 and obj['profile'] == PROFILE and
         obj['manifest'] == manifest and obj['challenge'] == challenge and obj['endpointParents'] == parents, 'ENDPOINT_FRAME_BINDING')
    need(type(obj['exit']) is int and type(obj['limited']) is bool and obj['endpointRemoved'] is True, 'ENDPOINT_TERMINAL')
    streams = {}
    for name in ('stdout', 'stderr'):
        need(type(obj[name]) is str, 'ENDPOINT_STREAM_TYPE')
        streams[name] = base64.b64decode(obj[name], validate=True)
        need(len(streams[name]) <= MAX_OUTPUT and base64.b64encode(streams[name]).decode() == obj[name], 'ENDPOINT_STREAM_BOUND')
    return {**streams, 'exit': obj['exit'], 'limited': obj['limited']}


def endpoint_parents():
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    facts = []
    try:
        for part in ('', 'run', 'jso-g3-r2'):
            if part:
                nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = nxt
            s = os.fstat(fd)
            need(s.st_uid == 0 and not s.st_mode & 0o022, 'ENDPOINT_PARENT_CUSTODY')
            facts.append([s.st_dev, s.st_ino, s.st_uid, s.st_gid, s.st_mode])
        return fd, facts
    except BaseException:
        os.close(fd)
        raise


def serve_once(approval, manifest):
    """Started independently by the trusted administrator, never by the collector."""
    need(os.getuid() == os.geteuid() == 0, 'ENDPOINT_ROOT_REQUIRED')
    need(approval['transport']['profile'] == PROFILE and approval['transport']['endpoint'] == ENDPOINT, 'ENDPOINT_PROFILE')
    account = pwd.getpwnam(approval['transport']['user'])
    need(account.pw_uid != 0, 'ENDPOINT_PEER_IDENTITY')
    for name, pin in approval['code'].items():
        need(sha(bounded(Path('/opt/jso/g3-r2') / name, trusted_uid=0)) == pin, 'ENDPOINT_CODE_CUSTODY')
    parent, parents = endpoint_parents()
    if parents != approval['transport']['endpointParents']:
        os.close(parent)
        raise ValueError('ENDPOINT_APPROVED_PARENT_DRIFT')
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    identity = None
    peer = None
    try:
        # bind refuses any existing object; never unlink someone else's endpoint.
        os.umask(0o077)
        listener.bind(ENDPOINT)
        s = os.stat('capture.sock', dir_fd=parent, follow_symlinks=False)
        identity = (s.st_dev, s.st_ino)
        os.chown('capture.sock', 0, account.pw_gid, dir_fd=parent, follow_symlinks=False)
        os.chmod('capture.sock', 0o660, dir_fd=parent, follow_symlinks=False)
        listener.listen(1)
        listener.settimeout(120)
        peer, _ = listener.accept()
        listener.close()  # exactly one request, including malformed requests
        _, uid, _ = struct.unpack('3i', peer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        need(uid == account.pw_uid, 'ENDPOINT_PEER_IDENTITY')
        peer.settimeout(10)
        data = bytearray()
        while True:
            part = peer.recv(1025 - len(data))
            if not part:
                break
            data.extend(part)
            need(len(data) <= 1024, 'ENDPOINT_REQUEST_SIZE')
        obj = parse(bytes(data))
        exact(obj, ('version', 'manifest', 'challenge'))
        need(type(obj['version']) is int and obj['version'] == 1 and
             bytes(data) == request(manifest, obj['challenge']), 'ENDPOINT_REQUEST_BINDING')
        current, facts = endpoint_parents()
        os.close(current)
        need(facts == parents, 'ENDPOINT_PARENT_DRIFT')
        # The root program executes an absolute argv without a shell or caller environment.
        result = run_bounded(['/usr/bin/python3', '-E', '-s',
            '/opt/jso/g3-r2/g3-forward-adoption-readonly-witness-r2.py', 'capture',
            '--reference-evidence', '/etc/jso/g3-r2/reference.json',
            '--expected-reference-evidence-sha256', approval['referenceEvidenceSha256'],
            '--challenge', obj['challenge']], timeout=120, env=ENV)
        current, facts = endpoint_parents()
        os.close(current)
        need(facts == parents, 'ENDPOINT_PARENT_DRIFT')
        s = os.stat('capture.sock', dir_fd=parent, follow_symlinks=False)
        need(stat.S_ISSOCK(s.st_mode) and s.st_uid == 0 and (s.st_dev, s.st_ino) == identity, 'ENDPOINT_REBOUND')
        os.unlink('capture.sock', dir_fd=parent)
        os.fsync(parent)
        identity = None
        frame = canonical({'version': 1, 'profile': PROFILE, 'manifest': manifest,
            'challenge': obj['challenge'], 'exit': result['exit'], 'limited': result['limited'],
            'stdout': base64.b64encode(result['stdout']).decode(),
            'stderr': base64.b64encode(result['stderr']).decode(), 'endpointRemoved': True, 'endpointParents': parents})
        need(len(frame) <= MAX_FRAME, 'ENDPOINT_FRAME_SIZE')
        peer.settimeout(10)
        peer.sendall(frame)
    finally:
        if peer is not None:
            peer.close()
        listener.close()
        if identity is not None:
            s = os.stat('capture.sock', dir_fd=parent, follow_symlinks=False)
            need((s.st_dev, s.st_ino) == identity, 'ENDPOINT_CLEANUP_REBOUND')
            os.unlink('capture.sock', dir_fd=parent)
            os.fsync(parent)
        os.close(parent)


def forward_once(argv_factory, approval, manifest, challenge, *, timeout=120):
    """Own a private local tunnel, preserve raw bytes, close via local SSH control."""
    result = {'exit': None, 'limited': True, 'stdout': b'', 'stderr': b''}
    wire = bytearray()
    streams = {'sshStdout': bytearray(), 'sshStderr': bytearray()}
    details = {'argv': [], 'shutdownArgv': [], 'sshExit': None, 'shutdownExit': None,
               'shutdownStdout': '', 'shutdownStderr': '', 'localCleanupConfirmed': False, 'residualPid': None, 'cleanupError': None}
    proc = None
    conn = None
    sel = selectors.DefaultSelector()
    directory = Path(tempfile.mkdtemp(prefix='jso-r2-tunnel-', dir='/tmp'))
    local_socket, control = directory / 'data.sock', directory / 'control.sock'
    deadline = time.monotonic() + timeout
    def drain(wait):
        need(time.monotonic() < deadline, 'ENDPOINT_TIMEOUT')
        for key, _ in sel.select(wait):
            chunk = os.read(key.fileobj.fileno(), min(65536, MAX_OUTPUT + 1 - len(streams[key.data])))
            if not chunk:
                sel.unregister(key.fileobj)
            else:
                streams[key.data].extend(chunk)
                need(len(streams[key.data]) <= MAX_OUTPUT, 'SSH_OUTPUT_LIMIT')
    try:
        details['argv'] = argv_factory(approval, challenge, str(directory))
        proc = subprocess.Popen(details['argv'], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, env=ENV, start_new_session=True)
        for name, pipe in [('sshStdout', proc.stdout), ('sshStderr', proc.stderr)]:
            os.set_blocking(pipe.fileno(), False)
            sel.register(pipe, selectors.EVENT_READ, name)
        while not local_socket.exists() or not control.exists():
            need(proc.poll() is None, 'SSH_TUNNEL_EXITED')
            drain(.02)
        need(stat.S_ISSOCK(local_socket.lstat().st_mode) and not local_socket.is_symlink(), 'LOCAL_SOCKET_TYPE')
        conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        conn.settimeout(min(10, max(.001, deadline - time.monotonic())))
        conn.connect(str(local_socket))
        conn.sendall(request(manifest, challenge))
        conn.shutdown(socket.SHUT_WR)
        conn.settimeout(.05)
        while True:
            drain(0)
            need(proc.poll() is None, 'SSH_TUNNEL_EXITED')
            try:
                chunk = conn.recv(min(65536, MAX_FRAME + 1 - len(wire)))
            except socket.timeout:
                continue
            if not chunk:
                break
            wire.extend(chunk)
            need(len(wire) <= MAX_FRAME, 'ENDPOINT_FRAME_SIZE')
        result = decode_response(bytes(wire), manifest, challenge, approval['transport']['endpointParents'])
        details['shutdownArgv'] = [details['argv'][0], '-F', '/dev/null', '-S', str(control), '-O', 'exit',
                                   approval['transport']['user'] + '@' + approval['transport']['host']]
        stopped = run_bounded(details['shutdownArgv'], timeout=5, env=ENV)
        details.update(shutdownExit=stopped['exit'], shutdownStdout=stopped['stdout'].decode('utf-8', 'strict'),
                       shutdownStderr=stopped['stderr'].decode('utf-8', 'strict'))
        need(stopped['exit'] == 0 and not stopped['limited'], 'SSH_SHUTDOWN_FAILED')
        proc.wait(timeout=5)
        while sel.get_map():
            drain(.01)
        need(proc.returncode == 0 and not streams['sshStdout'] and not streams['sshStderr'], 'SSH_TUNNEL_TERMINAL')
    except (ValueError, OSError, KeyError, TypeError, UnicodeError, subprocess.TimeoutExpired):
        result['limited'] = True
    finally:
        if conn is not None:
            conn.close()
        if proc is not None:
            try:
                if proc.poll() is None:
                    proc.kill()
                proc.wait(timeout=5)
                details['sshExit'] = proc.returncode
            except (OSError, subprocess.TimeoutExpired):
                details['cleanupError'] = 'SSH_PROCESS_CLEANUP_UNCONFIRMED'
                details['residualPid'] = proc.pid
                result['limited'] = True
            for name, pipe in [('sshStdout', proc.stdout), ('sshStderr', proc.stderr)]:
                try:
                    remaining = pipe.read(MAX_OUTPUT + 1 - len(streams[name])) or b''
                    streams[name].extend(remaining)
                    if len(streams[name]) > MAX_OUTPUT:
                        result['limited'] = True
                    pipe.close()
                except (OSError, ValueError):
                    details['cleanupError'] = 'SSH_PIPE_CLEANUP_UNCONFIRMED'
                    result['limited'] = True
        sel.close()
        try:
            for p in (local_socket, control):
                if p.exists():
                    need(stat.S_ISSOCK(p.lstat().st_mode) and not p.is_symlink(), 'LOCAL_CLEANUP_OBJECT')
                    p.unlink()
            directory.rmdir()
            details['localCleanupConfirmed'] = details['cleanupError'] is None
        except (OSError, ValueError):
            details['cleanupError'] = 'LOCAL_SOCKET_CLEANUP_UNCONFIRMED'
            result['limited'] = True
    return {**result, 'wire': bytes(wire), 'tunnel': details,
            **{k: bytes(v[:MAX_OUTPUT]) for k, v in streams.items()}}
