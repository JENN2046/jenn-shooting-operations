"""E1 adapter: preflight/protect/verify original FDs; never removes protection."""
import array
import fcntl
import os
from pathlib import Path
import subprocess
import time

from g3_r2_common import bounded, exact, host_identity, load_r1, need, sha, SIDES

GET_FLAGS = 0x80086601
SET_FLAGS = 0x40086602
IMMUTABLE = 16


def flags(fd):
    value = array.array('L', [0])
    fcntl.ioctl(fd, GET_FLAGS, value, True)
    return value[0]


def controls(approval):
    window = approval['window']
    exact(window, ('notBefore', 'notAfter', 'responsibilitySha256', 'controls', 'readonlyChecks', 'aliases'))
    need(type(window['notBefore']) in (int, float) and type(window['notAfter']) in (int, float) and
         window['notBefore'] <= time.time() < window['notAfter'], 'WINDOW_EXPIRED')
    need(host_identity() == approval['host'], 'HOST_OR_BOOT_CHANGED')
    # Fixed, audited responsibility text and helpers/configs are pinned, never inferred from disabled alone.
    need(type(window['controls']) is list and len(window['controls']) > 0, 'CONTROLS_MISSING')
    roles = set()
    for control in window['controls']:
        exact(control, ('role', 'path', 'sha256'))
        need(control['role'] not in roles, 'DUPLICATE_CONTROL')
        roles.add(control['role'])
        need(sha(bounded(Path(control['path']))) == control['sha256'], 'CONTROL_DRIFT')
        if control['role'] == 'windowResponsibility':
            need(control['sha256'] == window['responsibilitySha256'], 'RESPONSIBILITY_BINDING')
    need({'windowResponsibility', 'runtimeDisabled', 'legacyHelper'} <= roles, 'RESPONSIBILITY_OR_HELPER_MISSING')
    # Commands are fixed by the independently installed execution manifest, never from the remote response.
    need(type(window['readonlyChecks']) is list and len(window['readonlyChecks']) > 0, 'ACTUAL_WRITER_CHECKS_MISSING')
    for check in window['readonlyChecks']:
        exact(check, ('argv', 'exit', 'stdoutSha256', 'stderrSha256'))
        argv = check['argv']
        need(type(argv) is list and all(type(x) is str for x in argv) and len(argv) > 1, 'WRITER_CHECK_ARGV')
        allowed = (argv[0] == '/usr/bin/docker' and argv[1] == 'inspect') or (
            argv[0] == '/usr/bin/systemctl' and argv[1] in ('is-active', 'show')) or (
            argv[0] == '/usr/bin/pgrep' and argv[1] == '-f')
        need(allowed, 'ONLY_REVIEWED_READONLY_WRITER_CHECKS')
        # Reuse bounded transport reader. No shell, no container start, no mutable Docker command.
        from g3_r2_transport import run_bounded
        result = run_bounded(argv, timeout=10)
        need(not result['limited'] and result['exit'] == check['exit'] and
             sha(result['stdout']) == check['stdoutSha256'] and sha(result['stderr']) == check['stderrSha256'], 'WRITER_STATE_CHANGED')


class PinnedPair:
    def __init__(self, approval):
        self.approval = approval
        self.w = load_r1()
        self.w.MAX_DATABASE_BYTES = 8 * 1024 * 1024
        self.fds = {}
        self.meta = {}
        self.initial_flags = {}

    def __enter__(self):
        try:
            controls(self.approval)
            for side in SIDES:
                target = self.approval['files'][side]
                exact(target, ('path', 'identity', 'parents', 'mount'))
                path = target['path']
                pins = tuple(tuple(x) for x in target['parents'])
                fd = self.w.open_pinned(path, pins)
                self.fds[side] = fd
                self.initial_flags[side] = flags(fd)
                mount = subprocess.run(['/usr/bin/findmnt', '-n', '-o', 'FSTYPE,SOURCE,TARGET', '-T', path],
                                       capture_output=True, check=True, timeout=5).stdout.decode().strip()
                need(mount == target['mount'] and mount.split()[0] == 'ext4', 'MOUNT_BINDING')
                _, identity = self.w.sample_snapshot(fd, target['identity']['sha256'].removeprefix('sha256:'))
                need(identity == target['identity'], 'EXACT_ORIGINAL_IDENTITY')
                s = os.fstat(fd)
                self.meta[side] = tuple(getattr(s, k) for k in ('st_atime_ns', 'st_mtime_ns', 'st_ctime_ns'))
            a, b = (os.fstat(self.fds[k]) for k in SIDES)
            need((a.st_dev, a.st_ino) != (b.st_dev, b.st_ino), 'DISTINCT_INODES_REQUIRED')
            self.recheck(require_protected=False)
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def recheck(self, *, require_protected=True, changed_flags=False):
        controls(self.approval)
        result = {}
        for side in SIDES:
            fd = self.fds[side]
            target = self.approval['files'][side]
            mount = subprocess.run(['/usr/bin/findmnt', '-n', '-o', 'FSTYPE,SOURCE,TARGET', '-T', target['path']],
                                   capture_output=True, check=True, timeout=5).stdout.decode().strip()
            need(mount == target['mount'], 'MOUNT_DRIFT')
            self.w.check_path(target['path'], fd, tuple(tuple(x) for x in target['parents']))
            _, actual = self.w.sample_snapshot(fd, target['identity']['sha256'].removeprefix('sha256:'))
            need(actual == target['identity'], 'ORIGINAL_DRIFT')
            s = os.fstat(fd)
            meta = tuple(getattr(s, k) for k in ('st_atime_ns', 'st_mtime_ns', 'st_ctime_ns'))
            need(meta[:2] == self.meta[side][:2] and (changed_flags or meta == self.meta[side]), 'ORIGINAL_METADATA_DRIFT')
            current = flags(fd)
            need(not require_protected or current & IMMUTABLE, 'PROTECTION_INCOMPLETE')
            need(current == self.initial_flags[side] or (changed_flags and current == (self.initial_flags[side] | IMMUTABLE)), 'FLAGS_DRIFT')
            result[side] = {'identity': actual, 'parents': target['parents'], 'mount': mount, 'flags': current}
        aliases = self.approval['window']['aliases']
        need(type(aliases) is list, 'ALIASES_REQUIRED')
        for alias in aliases:
            exact(alias, ('path', 'side'))
            need(alias['side'] in SIDES, 'ALIAS_SIDE')
            fd = self.w.open_pinned(alias['path'])
            try:
                a, b = os.fstat(fd), os.fstat(self.fds[alias['side']])
                need((a.st_dev, a.st_ino) == (b.st_dev, b.st_ino), 'ALIAS_DRIFT')
            finally:
                os.close(fd)
        return result

    def protect(self):
        for side in SIDES:  # Active first. Any later failure leaves installed flags intact.
            self.recheck(require_protected=False, changed_flags=True)
            fd = self.fds[side]
            value = array.array('L', [flags(fd) | IMMUTABLE])
            fcntl.ioctl(fd, SET_FLAGS, value, True)
            need(flags(fd) & IMMUTABLE, 'PROTECTION_INSTALL_FAILED')
            self.recheck(require_protected=False, changed_flags=True)
        return self.recheck(changed_flags=True)

    def __exit__(self, *_):
        for fd in self.fds.values():
            os.close(fd)
        self.fds.clear()
