#!/usr/bin/env python3
"""One-shot bounded archive replay. No production DB mount or admission capability."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import socket
import selectors
import time
import stat
import subprocess
import tarfile
import uuid

IMAGE = 'sha256:581e9fa25e04b582aa39c2fdaa291f6db3e80fc3f3ac15a8a4afa06622442144'
BASE = '/home/ubuntu/G3-PREP-SOURCE-ALIGN-6-TO-10-20261006-01'
DB = 'shooting-operations.sqlite'
SPECS = [
    {'path': BASE + '/recovery-family.tgz', 'sha256': '5c7e9a17d9762e8fb31d534e03ea2285182e44a82ddbaf6863f10b655989b103', 'size': 30153,
     'files': {DB: [4096, '97e8d54f8a7255106f66cf1b213c4a4d7b558d21310b1c2bfedc3d0d526dddda'], DB+'-wal': [609792, 'a4556b355fc70efd346d41ab7ed11deefca46d3fe18901d3c615e92327bd6d2b'], DB+'-shm': [32768, 'f455743a63a919802676039b97c4b10053b5566d670b0c0cceccbadb9cb2d7d5']},
     'members': ['.', './'+DB+'-wal', './'+DB, './'+DB+'-shm']},
    {'path': BASE + '/schema10-prestate/recovery-family.tgz', 'sha256': 'f2e643317a152600c8bf864648cec095ad57ba398c804feb35f9338a7073cfef', 'size': 19385,
     'files': {DB: [512000, '5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7']}, 'members': ['.', './'+DB]},
]
MAX_ARCHIVE = 8 * 1024 * 1024
MAX_TAR = 16 * 1024 * 1024
ATTEMPT = {}


def require(value, code):
    if not value:
        raise ValueError(code)


def digest(b):
    return hashlib.sha256(b).hexdigest()


def read_pinned(path, limit):
    p = Path(path)
    require(p.is_absolute() and '..' not in p.parts, 'ABSOLUTE_PATH_REQUIRED')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    parents = []
    identity = lambda st: (st.st_dev, st.st_ino, st.st_mode, st.st_uid, st.st_gid)
    try:
        for part in p.parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            parents.append((fd, part, identity(os.fstat(child))))
            fd = child
        leaf = os.open(p.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME, dir_fd=fd)
        try:
            before = os.fstat(leaf)
            require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= limit, 'INPUT_TYPE_OR_SIZE')
            chunks = []
            while True:
                chunk = os.read(leaf, min(65536, limit + 1 - sum(map(len, chunks))))
                if not chunk:
                    break
                chunks.append(chunk)
                require(sum(map(len, chunks)) <= limit, 'INPUT_TOO_LARGE')
            after = os.fstat(leaf)
            same = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_atime_ns)
            require(same(before) == same(after), 'INPUT_CHANGED')
            link = os.stat(p.name, dir_fd=fd, follow_symlinks=False)
            require((link.st_dev, link.st_ino) == (after.st_dev, after.st_ino), 'INPUT_REPLACED')
            for parent, name, expected in parents:
                require(identity(os.stat(name, dir_fd=parent, follow_symlinks=False)) == expected, 'PARENT_CHANGED')
            return b''.join(chunks)
        finally:
            os.close(leaf)
    finally:
        os.close(fd)
        for parent, _, _ in reversed(parents):
            os.close(parent)


def verify_archive(spec):
    raw = read_pinned(spec['path'], MAX_ARCHIVE)
    require(len(raw) == spec['size'] and digest(raw) == spec['sha256'], 'ARCHIVE_BINDING')
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as gz:
        tarbytes = gz.read(MAX_TAR + 1)
    require(len(tarbytes) <= MAX_TAR, 'EXPANSION_LIMIT')
    files = {}
    with tarfile.open(fileobj=io.BytesIO(tarbytes), mode='r:') as tf:
        members = tf.getmembers()
        require([m.name for m in members] == spec['members'], 'MEMBER_ROSTER')
        require(len(set(m.name for m in members)) == len(members), 'DUPLICATE_MEMBER')
        for m in members:
            require(not m.pax_headers, 'EXTENDED_METADATA')
            if m.name == '.':
                require(m.isdir() and m.size == 0, 'ROOT_MEMBER')
                continue
            require(m.name.startswith('./') and m.name[2:] in spec['files'] and m.isreg(), 'MEMBER_TYPE')
            name = m.name[2:]
            require('/' not in name and m.size == spec['files'][name][0], 'MEMBER_SIZE')
            data = tf.extractfile(m).read(MAX_TAR + 1)
            require(len(data) == m.size and digest(data) == spec['files'][name][1], 'MEMBER_DIGEST')
            files[name] = data
    require(set(files) == set(spec['files']), 'MEMBER_MISSING')
    return files


def docker_command(root, runner, name):
    return ['docker', '--context', 'default', 'create', '--name', name, '--label', 'jso.reconstruction='+name,
            '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--user', '1000:1000', '--pids-limit', '64', '--memory', '256m', '--memory-swap', '256m', '--cpus', '1',
            '--restart', 'no', '--no-healthcheck', '--log-driver', 'none', '--ulimit', 'core=0',
            '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=16m', '--tmpfs', '/app/data:rw,uid=1000,gid=1000,mode=0700,size=1m',
            '--tmpfs', '/work:rw,uid=1000,gid=1000,mode=0700,nosuid,nodev,noexec,size=32m',
            '--mount', 'type=bind,src='+str(root / 'work')+',dst=/inputs,readonly',
            '--mount', 'type=bind,src='+str(runner)+',dst=/tool/replay.mjs,readonly',
            '--entrypoint', 'node', IMAGE, '--max-old-space-size=128', '/tool/replay.mjs']


def bounded_start(name, timeout, limit=1024 * 1024):
    command = ['docker', '--context', 'default', 'start', '-a', name]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    streams = selectors.DefaultSelector()
    buffers = {process.stdout: bytearray(), process.stderr: bytearray()}
    deadline = time.monotonic() + timeout
    try:
        for stream in buffers:
            streams.register(stream, selectors.EVENT_READ)
        while streams.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(command, timeout)
            for key, _ in streams.select(min(remaining, 0.1)):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    streams.unregister(key.fileobj)
                    continue
                buffers[key.fileobj].extend(chunk)
                require(len(buffers[key.fileobj]) <= limit, 'OUTPUT_LIMIT')
        code = process.wait(timeout=max(0.001, deadline - time.monotonic()))
        return subprocess.CompletedProcess(command, code, bytes(buffers[process.stdout]), bytes(buffers[process.stderr]))
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
        streams.close()
        for stream in buffers:
            stream.close()


def run(specs, root, runner, timeout=120):
    # All archives verified before creating any directory or opening SQLite.
    inputs = [verify_archive(s) for s in specs]
    require(len(inputs) == 2, 'PAIR_REQUIRED')
    require(root.is_absolute() and root.parent.resolve() == root.parent, 'SCRATCH_PARENT')
    require(not os.path.lexists(root), 'SCRATCH_EXISTS')
    space = os.statvfs(root.parent)
    require(space.f_bavail * space.f_frsize >= 1024**3, 'SPACE')
    context = json.loads(subprocess.check_output(['docker', 'context', 'inspect', 'default'], timeout=15))[0]
    require(context['Endpoints']['docker']['Host'] == 'unix:///var/run/docker.sock', 'LOCAL_DOCKER_REQUIRED')
    image = subprocess.run(['docker', '--context', 'default', 'image', 'inspect', IMAGE], capture_output=True, text=True, timeout=15)
    require(image.returncode == 0 and json.loads(image.stdout)[0]['Id'] == IMAGE and json.loads(image.stdout)[0]['Architecture'] == 'amd64', 'IMAGE_UNAVAILABLE')
    runner_bytes = read_pinned(str(runner), 128 * 1024)
    root.mkdir(mode=0o700)
    root_identity = (root.stat().st_dev, root.stat().st_ino)
    name = 'jso-reconstruct-' + uuid.uuid4().hex
    ATTEMPT.update(container=name, scratch=str(root))
    started = False
    cleanup_ok = False
    try:
        work = root / 'work'; work.mkdir(mode=0o700); os.chown(work, 1000, 1000)
        for i, group in enumerate(inputs):
            rawdir = root / ('input-'+str(i)); rawdir.mkdir(mode=0o700)
            dest = work / ('source' if i == 0 else 'reference'); dest.mkdir(mode=0o700); os.chown(dest, 1000, 1000)
            for n, data in group.items():
                raw = rawdir / n; raw.write_bytes(data); raw.chmod(0o400)
                # Preserve original SHM as evidence; SQLite regenerates only the working index.
                if n.endswith('-shm'):
                    continue
                f = dest / n; f.write_bytes(data); f.chmod(0o600); os.chown(f, 1000, 1000)
        # Read-only, root-owned tool copy prevents the caller pathname changing the mounted code.
        tool = root / 'replay.mjs'; tool.write_bytes(runner_bytes); tool.chmod(0o444)
        command = docker_command(root, tool, name)
        started = True
        created = subprocess.run(command, capture_output=True, timeout=20)
        require(created.returncode == 0, 'CONTAINER_CREATE')
        result = bounded_start(name, timeout)
        require(result.returncode == 0 and len(result.stdout) <= 1024 * 1024, 'RUNTIME_REJECTED')
        record = json.loads(result.stdout)
        require(record.get('status') == 'LIMITED_RECONSTRUCTION_EVIDENCE' and record.get('productionAdmission') is False, 'RECEIPT_REJECTED')
        state = json.loads(subprocess.check_output(['docker', '--context', 'default', 'inspect', name], timeout=15))[0]
        require(state['State']['Status'] == 'exited' and state['State']['ExitCode'] == 0 and not state['State']['OOMKilled'], 'CONTAINER_TERMINAL')
        require(not any(state['HostConfig']['PortBindings'] or {}) and state['HostConfig']['NetworkMode'] == 'none', 'ISOLATION_DRIFT')
        for spec in specs:
            verify_archive(spec)
        record['archivePostcheck'] = True
        record['container'] = name
        record['archiveSha256'] = [s['sha256'] for s in specs]
        record['runnerSha256'] = digest(runner_bytes)
        record['image'] = IMAGE
        return record
    finally:
        if started:
            probe = subprocess.run(['docker', '--context', 'default', 'inspect', name], capture_output=True, timeout=15)
            if probe.returncode == 0:
                state = json.loads(probe.stdout)[0]
                require(state['Config']['Labels'].get('jso.reconstruction') == name, 'CLEANUP_OWNER')
                subprocess.run(['docker', '--context', 'default', 'rm', '-f', name], capture_output=True, check=True, timeout=20)
            else:
                require(b'No such' in probe.stderr, 'CLEANUP_UNCONFIRMED')
        require((root.stat().st_dev, root.stat().st_ino) == root_identity, 'SCRATCH_IDENTITY_CHANGED')
        shutil.rmtree(root)
        cleanup_ok = not root.exists()
        require(cleanup_ok, 'CLEANUP_FAILED')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute-approved', action='store_true')
    args = parser.parse_args()
    require(args.execute_approved, 'EXPLICIT_EXECUTION_REQUIRED')
    require(os.geteuid() == 0 and socket.gethostname() == 'VM-0-12-ubuntu', 'HOST_SCOPE')
    require(os.stat('/var/tmp').st_dev != os.stat('/mnt/datadisk0').st_dev, 'SCRATCH_FILESYSTEM')
    root = Path('/var/tmp/jso-g305-reconstruction-7328bc2-r1')
    record = run(SPECS, root, Path(__file__).resolve().with_suffix('.mjs'))
    record['scratchRemoved'] = True
    print(json.dumps(record, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Only our fixed all-caps validation codes can be disclosed.
        code = 'TIMEOUT' if isinstance(error, subprocess.TimeoutExpired) else 'TOOL_FAILURE'
        if isinstance(error, ValueError) and len(error.args) == 1:
            candidate = error.args[0]
            if isinstance(candidate, str) and 3 <= len(candidate) <= 64 and all(c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_' for c in candidate):
                code = candidate
        # Never print SQL, business rows, credentials or exception text from a child.
        print(json.dumps({'status': 'RECONSTRUCTION_REJECTED', 'productionAdmission': False,
                          'cleanupMustBeIndependentlyVerified': True, 'reason': code, 'attempt': ATTEMPT}))
        raise SystemExit(2)
