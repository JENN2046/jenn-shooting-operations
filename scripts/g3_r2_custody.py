"""E1 adapter: preflight/protect/verify original FDs; never removes protection."""
import array
import fcntl
import os
import json
import re
import stat
from pathlib import Path
import subprocess
import time

from g3_r2_common import bounded, canonical, exact, host_identity, load_r1, need, sha, SHA, SIDES

GET_FLAGS = 0x80086601
SET_FLAGS = 0x40086602
IMMUTABLE = 16


def flags(fd):
    value = array.array('L', [0])
    fcntl.ioctl(fd, GET_FLAGS, value, True)
    return value[0]


PROBE_ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}
SYSTEMD_PROPERTIES = ('Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlPID',
                      'TasksCurrent', 'UnitFileState', 'FragmentPath', 'DropInPaths', 'Restart', 'NeedDaemonReload', 'ControlGroup')
DOCKER_FORMAT = ('{"id":{{json .Id}},"status":{{json .State.Status}},"running":{{json .State.Running}},'
                 '"paused":{{json .State.Paused}},"restarting":{{json .State.Restarting}},'
                 '"dead":{{json .State.Dead}},"pid":{{json .State.Pid}},"error":{{json .State.Error}},'
                 '"restartPolicy":{{json .HostConfig.RestartPolicy}},"configuration":'
                 '{"image":{{json .Image}},"path":{{json .Path}},"args":{{json .Args}},"mounts":{{json .Mounts}}}}')


def unit_bytes(writer):
    # Deliberately one supported managed-entry profile; no general systemd parser.
    return ('[Unit]\nDescription=JSO approved evidence-window writer\n[Service]\nType=simple\nExecStart=' +
            writer['entrypointPath'] + '\nRestart=no\nKillMode=control-group\n').encode()


def writer_inventory(approval):
    window = approval['window']
    exact(window, ('notBefore', 'notAfter', 'responsibilitySha256', 'controls', 'writers', 'aliases'))
    writers = window['writers']
    need(type(writers) is list and 1 <= len(writers) <= 16, 'WRITER_INVENTORY_REQUIRED')
    controls = window['controls']
    need(type(controls) is list, 'CONTROLS_MISSING')
    roles = {}
    for control in controls:
        exact(control, ('role', 'path', 'sha256'))
        need(control['role'] not in roles, 'DUPLICATE_CONTROL')
        roles[control['role']] = control
    need({'windowResponsibility', 'runtimeDisabled', 'legacyHelper', 'writerInventory'} <= set(roles), 'WRITER_CONTROL_BINDING')
    need(roles['windowResponsibility']['sha256'] == window['responsibilitySha256'], 'RESPONSIBILITY_BINDING')
    projection = {'version': 1, 'host': approval['host'], 'files': {
        side: {'path': approval['files'][side]['path'], 'sha256': approval['files'][side]['identity']['sha256']}
        for side in SIDES}, 'responsibilitySha256': window['responsibilitySha256'], 'writers': writers}
    need(roles['writerInventory']['sha256'] == sha(canonical(projection)), 'WRITER_INVENTORY_BINDING')
    ids, targets, covered, seen_roles = set(), set(), set(), set()
    for w in writers:
        need(type(w) is dict and w.get('kind') in ('systemd', 'docker'), 'BLOCKED_UNSUPPORTED_WRITER_CONTROL')
        fields = ('id', 'kind', 'role', 'target', 'sides', 'probeSha256')
        fields += ('entrypointPath', 'entrypointSha256', 'unitSha256') if w['kind'] == 'systemd' else ('configurationSha256',)
        exact(w, fields)
        need(type(w['id']) is str and re.fullmatch('[A-Za-z0-9_-]{1,64}', w['id']) and w['id'] not in ids, 'WRITER_ID')
        ids.add(w['id'])
        need(w['role'] in ('runtimeWriter', 'legacyHelper'), 'WRITER_ROLE')
        seen_roles.add(w['role'])
        need(type(w['sides']) is list and w['sides'] and all(s in SIDES for s in w['sides']) and
             len(set(w['sides'])) == len(w['sides']), 'WRITER_FILE_SCOPE')
        covered.update(w['sides'])
        need(type(w['target']) is str and (w['kind'], w['target']) not in targets, 'WRITER_TARGET')
        targets.add((w['kind'], w['target']))
        need(type(w['probeSha256']) is str and SHA.fullmatch(w['probeSha256']), 'PROBE_PIN_REQUIRED')
        if w['kind'] == 'systemd':
            need(re.fullmatch('[A-Za-z0-9_-]+[.]service', w['target']), 'EXACT_SERVICE_UNIT_REQUIRED')
            path = w['entrypointPath']
            need(type(path) is str and re.fullmatch('/[A-Za-z0-9_./-]+', path) and '..' not in Path(path).parts,
                 'EXACT_MANAGED_ENTRYPOINT_REQUIRED')
            need(type(w['entrypointSha256']) is str and SHA.fullmatch(w['entrypointSha256']) and
                 w['unitSha256'] == sha(unit_bytes(w)), 'MANAGED_UNIT_CONFIGURATION')
            if w['role'] == 'legacyHelper':
                need(path == roles['legacyHelper']['path'] and w['entrypointSha256'] == roles['legacyHelper']['sha256'],
                     'HELPER_ENTRYPOINT_BINDING')
        else:
            need(w['role'] != 'legacyHelper', 'BLOCKED_UNSUPPORTED_HELPER_CONTROL')
            need(re.fullmatch('[a-f0-9]{64}', w['target']) and type(w['configurationSha256']) is str and
                 SHA.fullmatch(w['configurationSha256']), 'EXACT_CONTAINER_ID_AND_CONFIGURATION')
    need(seen_roles == {'runtimeWriter', 'legacyHelper'} and covered == set(SIDES), 'INCOMPLETE_WRITER_COVERAGE')
    return writers


def writer_argv(w):
    if w['kind'] == 'systemd':
        return ['/usr/bin/systemctl', '--no-pager', 'show', '--property=' + ','.join(SYSTEMD_PROPERTIES), '--', w['target']]
    return ['/usr/bin/docker', '--host=unix:///run/docker.sock', 'inspect', '--type=container', '--format', DOCKER_FORMAT, w['target']]


def stopped_state(w, result):
    need(type(result['exit']) is int and result['exit'] == 0 and result['limited'] is False and
         result['stderr'] == '', 'WRITER_PROBE_INCOMPLETE')
    out = result['stdout']
    need(type(out) is str and 0 < len(out.encode()) <= 8192, 'WRITER_PROBE_SIZE')
    if w['kind'] == 'systemd':
        state = {}
        for line in out.splitlines():
            key, sep, value = line.partition('=')
            need(sep and key not in state, 'WRITER_PROPERTY_PARSE')
            state[key] = value
        exact(state, SYSTEMD_PROPERTIES)
        need(state['Id'] == w['target'], 'WRITER_IDENTITY_MISMATCH')
        need(state['LoadState'] == 'masked' and state['UnitFileState'] == 'masked-runtime' and
             state['FragmentPath'] == '/run/systemd/system/' + w['target'] and state['DropInPaths'] == '' and
             state['ActiveState'] == 'inactive' and state['SubState'] == 'dead' and
             state['MainPID'] == state['ControlPID'] == '0' and state['TasksCurrent'] in ('0', '[not set]') and
             state['Restart'] == 'no' and state['NeedDaemonReload'] == 'no' and state['ControlGroup'] == '',
             'WRITER_NOT_STOPPED_AND_MASKED')
    else:
        def pairs(items):
            obj = {}
            for k, v in items:
                need(k not in obj, 'DUPLICATE_WRITER_PROPERTY')
                obj[k] = v
            return obj
        state = json.loads(out, object_pairs_hook=pairs, parse_constant=lambda _: need(False, 'NONFINITE_WRITER_PROPERTY'))
        exact(state, ('id', 'status', 'running', 'paused', 'restarting', 'dead', 'pid', 'error', 'restartPolicy', 'configuration'))
        need(state['id'] == w['target'], 'WRITER_IDENTITY_MISMATCH')
        need(state['status'] in ('created', 'exited') and all(state[k] is False for k in ('running', 'paused', 'restarting', 'dead'))
             and type(state['pid']) is int and state['pid'] == 0 and state['error'] == '', 'WRITER_NOT_STOPPED')
        exact(state['restartPolicy'], ('Name', 'MaximumRetryCount'))
        need(state['restartPolicy']['Name'] == 'no' and type(state['restartPolicy']['MaximumRetryCount']) is int and
             state['restartPolicy']['MaximumRetryCount'] == 0, 'WRITER_AUTORESTART_ENABLED')
        exact(state['configuration'], ('image', 'path', 'args', 'mounts'))
        need(sha(canonical(state['configuration'])) == w['configurationSha256'], 'WRITER_CONFIGURATION_DRIFT')
    return state


def validate_writer_evidence(evidence, approval):
    writers = writer_inventory(approval)
    exact(evidence, [w['id'] for w in writers])
    for w in writers:
        item = evidence[w['id']]
        exact(item, ('argv', 'environment', 'probeSha256', 'exit', 'limited', 'stdout', 'stderr', 'stdoutSha256', 'stderrSha256', 'guard', 'state'))
        need(item['argv'] == writer_argv(w) and item['environment'] == PROBE_ENV and item['probeSha256'] == w['probeSha256'],
             'WRITER_PROBE_BINDING')
        need(type(item['stdout']) is str and type(item['stderr']) is str and
             sha(item['stdout'].encode()) == item['stdoutSha256'] and sha(item['stderr'].encode()) == item['stderrSha256'],
             'WRITER_RAW_DIGEST')
        validate_writer_guard(w, item['guard'])
        need(item['state'] == stopped_state(w, item), 'WRITER_STATE_REPARSE')
        if w['kind'] == 'docker':
            config = item['state']['configuration']
            need(type(config['image']) is str and re.fullmatch('sha256:[a-f0-9]{64}', config['image']) and
                 type(config['path']) is str and bool(config['path']) and type(config['args']) is list and
                 all(type(x) is str for x in config['args']) and type(config['mounts']) is list, 'CONTAINER_CONFIGURATION_SHAPE')
            for side in w['sides']:
                db = Path(approval['files'][side]['path'])
                need(any(type(m) is dict and type(m.get('Source')) is str and Path(m['Source']).is_absolute() and
                         '..' not in Path(m['Source']).parts and db.is_relative_to(Path(m['Source']))
                         for m in config['mounts']), 'CONTAINER_DATABASE_MOUNT_BINDING')
    return evidence


def validate_writer_guard(w, guard):
    if w['kind'] == 'docker':
        exact(guard, ('socket', 'uid', 'type'))
        need(guard == {'socket': '/run/docker.sock', 'uid': 0, 'type': 'socket'}, 'DOCKER_LOCAL_SOCKET_REQUIRED')
        return
    exact(guard, ('unitSha256', 'entrypointSha256', 'maskIdentity', 'maskParents', 'cgroupAbsent', 'cgroupPath', 'cgroupFilesystem'))
    need(guard['unitSha256'] == w['unitSha256'] and guard['entrypointSha256'] == w['entrypointSha256'], 'WRITER_CONFIGURATION_BINDING')
    pins = guard['maskParents']
    need(type(pins) is list and len(pins) == 4 and all(type(row) is list and len(row) == 5 and
         all(type(x) is int for x in row) and row[2] == 0 and not row[4] & 0o022 and stat.S_ISDIR(row[4]) for row in pins), 'MASK_PARENT_CUSTODY')
    m = guard['maskIdentity']
    need(type(m) is list and len(m) == 6 and all(type(x) is int for x in m) and m[2] == 0 and stat.S_ISLNK(m[4]), 'MASK_IDENTITY')
    need(guard['cgroupAbsent'] is True and guard['cgroupPath'] == '/sys/fs/cgroup/system.slice/' + w['target'] and
         guard['cgroupFilesystem'] == 'cgroup2', 'WRITER_TASKS_NOT_PROVEN_ABSENT')


def trusted_parent(path):
    fd, pins = load_r1().parent_chain(path)
    try:
        need(all(row[2] == 0 and not row[4] & 0o022 for row in pins), 'WRITER_PARENT_CUSTODY')
        return fd, pins
    except BaseException:
        os.close(fd)
        raise


def writer_guard(w):
    if w['kind'] == 'docker':
        fd, _ = trusted_parent('/run/docker.sock')
        try:
            st = os.stat('docker.sock', dir_fd=fd, follow_symlinks=False)
            need(st.st_uid == 0 and stat.S_ISSOCK(st.st_mode), 'DOCKER_LOCAL_SOCKET_REQUIRED')
        finally:
            os.close(fd)
        return {'socket': '/run/docker.sock', 'uid': 0, 'type': 'socket'}
    # Runtime mask takes priority over this fixed vendor-style profile. No other
    # higher-priority configuration, generator, transient unit, or drop-in is accepted.
    for directory in ('/etc/systemd/system.control', '/run/systemd/system.control', '/run/systemd/transient',
                      '/run/systemd/generator.early', '/etc/systemd/system'):
        try:
            os.lstat(directory + '/' + w['target'])
        except FileNotFoundError:
            pass
        else:
            raise ValueError('UNSUPPORTED_UNIT_OVERRIDE')
    need(bounded(Path('/usr/local/lib/systemd/system') / w['target'], trusted_uid=0) == unit_bytes(w), 'MANAGED_UNIT_DRIFT')
    need(sha(bounded(Path(w['entrypointPath']), trusted_uid=0)) == w['entrypointSha256'], 'MANAGED_ENTRYPOINT_DRIFT')
    path = '/run/systemd/system/' + w['target']
    fd, pins = trusted_parent(path)
    attrs = ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_ctime_ns')
    try:
        before = os.stat(w['target'], dir_fd=fd, follow_symlinks=False)
        need(before.st_uid == 0 and stat.S_ISLNK(before.st_mode) and os.readlink(w['target'], dir_fd=fd) == '/dev/null', 'MANAGED_UNIT_NOT_RUNTIME_MASKED')
        after = os.stat(w['target'], dir_fd=fd, follow_symlinks=False)
        identity = [getattr(before, k) for k in attrs]
        need(identity == [getattr(after, k) for k in attrs], 'MASK_DRIFT')
    finally:
        os.close(fd)
    fd, after_pins = trusted_parent(path)
    os.close(fd)
    need(pins == after_pins, 'MASK_PARENT_DRIFT')
    # A missing canonical cgroup in the host's v2 hierarchy is independent evidence
    # of no residual unit tasks; TasksCurrent=[not set] alone is not sufficient.
    mounts = Path('/proc/self/mountinfo').read_text().splitlines()
    need(any(line.split()[4] == '/sys/fs/cgroup' and line.split(' - ')[1].split()[0] == 'cgroup2' for line in mounts), 'CGROUP_V2_REQUIRED')
    cg = '/sys/fs/cgroup/system.slice/' + w['target']
    fd, _ = trusted_parent(cg)
    try:
        try:
            os.stat(w['target'], dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise ValueError('WRITER_CGROUP_STILL_PRESENT')
    finally:
        os.close(fd)
    guard = {'unitSha256': w['unitSha256'], 'entrypointSha256': w['entrypointSha256'],
             'maskIdentity': identity, 'maskParents': [list(row) for row in pins],
             'cgroupAbsent': True, 'cgroupPath': cg, 'cgroupFilesystem': 'cgroup2'}
    validate_writer_guard(w, guard)
    return guard


def probe_writers(approval):
    from g3_r2_transport import run_bounded
    evidence = {}
    for w in writer_inventory(approval):
        argv = writer_argv(w)
        need(sha(bounded(Path(argv[0]), limit=16 * 1024 * 1024, trusted_uid=0)) == w['probeSha256'], 'WRITER_PROBE_EXECUTABLE_DRIFT')
        guard = writer_guard(w)
        result = run_bounded(argv, timeout=10, env=PROBE_ENV)
        item = {k: result[k] for k in ('exit', 'limited')}
        for stream in ('stdout', 'stderr'):
            need(len(result[stream]) <= 8192, 'WRITER_PROBE_SIZE')
            item[stream] = result[stream].decode('utf-8', 'strict')
            item[stream + 'Sha256'] = sha(result[stream])
        need(writer_guard(w) == guard, 'WRITER_MANAGER_CUSTODY_DRIFT')
        item.update(argv=argv, environment=dict(PROBE_ENV), probeSha256=w['probeSha256'], guard=guard)
        item['state'] = stopped_state(w, item)
        evidence[w['id']] = item
    return validate_writer_evidence(evidence, approval)


def controls(approval):
    window = approval['window']
    exact(window, ('notBefore', 'notAfter', 'responsibilitySha256', 'controls', 'writers', 'aliases'))
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
    return probe_writers(approval)


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
        self.writer_evidence = controls(self.approval)
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
