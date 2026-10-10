"""Source-only fixed R2 dependency loader; ignores all Python bytecode caches."""
import hashlib
import importlib.abc
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys

CODE_FILES = frozenset(('g3_r2_bootstrap.py', 'g3_r2_common.py', 'g3_r2_custody.py', 'g3_r2_transport.py',
                        'g3_r2_snapshot.py', 'g3_r2_acceptance.py', 'g3_r2_collector.py',
                        'g3-forward-adoption-readonly-witness.py', 'g3-forward-adoption-readonly-witness-r2.py',
                        'g3-collect-production-evidence.py', 'verify-g3-production-evidence.py',
                        'g3_r2_endpoint.py', 'g3-r2-serve-once.py'))


def bootstrap(root, *, local):
    store = Path.home() / '.local/share/jso/g3-r2' if local else Path('/etc/jso/g3-r2')
    uid = os.getuid() if local else 0
    # No existing module may bypass the verified source loader through sys.modules.
    if any(Path(name).stem in sys.modules for name in CODE_FILES if name.startswith('g3_r2_')):
        raise ValueError('PRELOADED_R2_DEPENDENCY')
    parent = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in store.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
            fact = os.fstat(parent)
            if fact.st_uid not in (0, uid) or fact.st_mode & 0o022:
                raise ValueError('UNTRUSTED_APPROVAL_PARENT')
    finally:
        os.close(parent)
    s = store.lstat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != uid or s.st_mode & 0o777 != 0o700:
        raise ValueError('TRUST_STORE_CUSTODY')
    fd = os.open(store / 'approved.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_uid != uid or s.st_nlink != 1 or s.st_mode & 0o022 or not 0 < s.st_size <= 1048576:
            raise ValueError('TRUST_FILE_CUSTODY')
        approval = json.loads(os.pread(fd, s.st_size, 0))
    finally:
        os.close(fd)
    pins = approval['code']
    if set(pins) != CODE_FILES:
        raise ValueError('REQUIRED_CODE_SET')
    verified = {}
    for name in CODE_FILES:
        path = root / name
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            s = os.fstat(fd)
            if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or not 0 < s.st_size <= 1048576:
                raise ValueError('CODE_CUSTODY')
            raw = os.pread(fd, s.st_size, 0)
        finally:
            os.close(fd)
        if hashlib.sha256(raw).hexdigest() != pins[name]:
            raise ValueError('CODE_PIN_BEFORE_IMPORT')
        verified[name] = raw
    class SourceOnly(importlib.abc.MetaPathFinder, importlib.abc.Loader):
        def find_spec(self, fullname, path=None, target=None):
            name = fullname + '.py'
            if name in CODE_FILES:
                return importlib.util.spec_from_loader(fullname, self, origin=str(root / name))
            return None
        def create_module(self, spec):
            return None
        def exec_module(self, module):
            name = module.__name__ + '.py'
            module.__file__ = str(root / name)
            module.__source_sha256__ = pins[name]
            exec(compile(verified[name], str(root / name), 'exec'), module.__dict__)
    sys.dont_write_bytecode = True
    sys.meta_path.insert(0, SourceOnly())
