"""R2 bounded parsing and pre-provisioned trust. No trust-store writer or approval CLI."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
from g3_r2_bootstrap import local_custody_home

ROOT = Path(__file__).resolve().parent
METHOD = 'e1acba51102404d87e756b0e6a502c6a9cd92bbe4a2136c0f6d8c41b19b6ffd0'
R1_SHA = '95ca51db7174eaffc8ce9cee8f85f0440ec1253fb8a2e00dc89b42649775ccfc'
REMOTE_STORE = Path('/etc/jso/g3-r2')
MAX_OUTPUT = 1024 * 1024
COPY_BUDGET = 8 * 1024 * 1024
SHA = re.compile(r'^[a-f0-9]{64}$')
SIDES = ('active', 'prestate')
DENY = {k: False for k in ('adoptionAuthorityAllowed', 'writerReadmissionAllowed', 'serviceStartAllowed', 'g4Allowed')}
REF_PINS = {
    'schema6Archive': '5c7e9a17d9762e8fb31d534e03ea2285182e44a82ddbaf6863f10b655989b103',
    'schema10Archive': 'f2e643317a152600c8bf864648cec095ad57ba398c804feb35f9338a7073cfef',
    'schema10Main': '5d65282b197350c2d6175fef2ccfa641c40908ecd9c053e296182f65e7bfede7',
    'reconstructionReceipt': 'e9eb3b6a6e78f554b9c77bad78af165c09e0d642a1d52a301f7043222eee4e56',
    'independentAcceptance': '6c6e312092107839ab7711bbad3ee32031a9e3ccbd84e2795ccf673aaf83d0f4',
}


def need(ok, code):
    if not ok:
        raise ValueError(code)


def exact(obj, keys):
    need(type(obj) is dict and set(obj) == set(keys), 'EXACT_FIELDS_REQUIRED')


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def parse(raw):
    need(0 < len(raw) <= MAX_OUTPUT, 'JSON_SIZE_BOUND')
    def pairs(items):
        result = {}
        for k, v in items:
            need(k not in result, 'DUPLICATE_JSON_KEY')
            result[k] = v
        return result
    def nonfinite(_):
        raise ValueError('NONFINITE_JSON')
    obj = json.loads(raw.decode('utf-8', 'strict'), object_pairs_hook=pairs, parse_constant=nonfinite)
    need(canonical(obj) == raw, 'NONCANONICAL_JSON')
    return obj


def bounded(path, limit=MAX_OUTPUT, trusted_uid=None):
    """No symlinks in any component; no FIFO blocking; exact bytes, stable FD."""
    path = Path(path)
    need(path.is_absolute() and '..' not in path.parts, 'ABSOLUTE_PATH_REQUIRED')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        root = os.fstat(fd)
        if trusted_uid is not None:
            need(root.st_uid in (0, trusted_uid) and not root.st_mode & 0o022, 'UNTRUSTED_PARENT')
        for part in path.parts[1:-1]:
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
            s = os.fstat(fd)
            if trusted_uid is not None:
                need(s.st_uid in (0, trusted_uid) and not s.st_mode & 0o022, 'UNTRUSTED_PARENT')
        leaf = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            before = os.fstat(leaf)
            need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= limit, 'INPUT_SIZE_OR_TYPE')
            if trusted_uid is not None:
                need(before.st_uid == trusted_uid and not before.st_mode & 0o022, 'UNTRUSTED_FILE')
            raw = os.pread(leaf, before.st_size + 1, 0)
            after = os.fstat(leaf)
            fields = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
            need(len(raw) == before.st_size and all(getattr(before, k) == getattr(after, k) for k in fields), 'INPUT_DRIFT')
            current = os.stat(path.name, dir_fd=fd, follow_symlinks=False)
            need((current.st_dev, current.st_ino) == (before.st_dev, before.st_ino), 'INPUT_REBOUND')
            return raw
        finally:
            os.close(leaf)
    finally:
        os.close(fd)


def load_r1():
    path = ROOT / 'g3-forward-adoption-readonly-witness.py'
    raw = bounded(path)
    need(sha(raw) == R1_SHA, 'R1_DEPENDENCY_PIN')
    # Execute the verified bytes themselves: a second loader read could race a replacement.
    spec = importlib.util.spec_from_loader('g3_pinned_r1', loader=None, origin=str(path))
    module = importlib.util.module_from_spec(spec)
    module.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def host_identity():
    return {'instance': Path('/sys/class/dmi/id/product_uuid').read_text().strip().lower(),
            'boot': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}


def runtime():
    import sqlite3, _sqlite3
    libraries = {line.split()[-1] for line in Path('/proc/self/maps').read_text().splitlines()
                 if '/libsqlite3.so' in line}
    need(len(libraries) == 1, 'SQLITE_LIBRARY_IDENTITY')
    return {'python': sys.version.split()[0], 'sqlite': sqlite3.sqlite_version,
            'executableSha256': sha(Path(sys.executable).resolve().read_bytes()),
            'sqliteExtensionSha256': sha(Path(_sqlite3.__file__).read_bytes()),
            'sqliteLibrarySha256': sha(Path(next(iter(libraries))).read_bytes())}


def execution_binding(approval):
    # Bind every execution fact, excluding only the two record digests to avoid a cycle.
    return sha(canonical({k: v for k, v in approval.items()
                          if k not in ('mergeRecordSha256', 'executionApprovalSha256')}))


def production_approvals(approval, store, uid):
    release = approval['release']
    exact(release, ('prHead', 'baseHead', 'postMergeCanonicalHead', 'sourceTree'))
    need(all(type(x) is str and re.fullmatch('[a-f0-9]{40}', x) for x in release.values()), 'CANONICAL_RELEASE_REQUIRED')
    need(release['postMergeCanonicalHead'] not in (release['prHead'], release['baseHead'],
         '358a713d7d7969544466bb85c971ef7c19c5bf2b'), 'POST_MERGE_COMMIT_REQUIRED')
    for key, filename, flag in [('mergeRecordSha256', 'merge-record.json', 'exactMergeVerified'),
                               ('executionApprovalSha256', 'execution-approval.json', 'productionExecutionApproved')]:
        need(type(approval[key]) is str and SHA.fullmatch(approval[key]), 'PRODUCTION_APPROVAL_ABSENT')
        material = bounded(store / filename, trusted_uid=uid)
        need(sha(material) == approval[key], 'PRODUCTION_APPROVAL_PIN')
        record = parse(material)
        fields = ('version', flag, 'methodSha256', 'contractSha256', 'code', 'release')
        exact(record, fields + (('executionBindingSha256',) if key == 'executionApprovalSha256' else ()))
        need(type(record['version']) is int and record['version'] == 2 and record[flag] is True and
             record['methodSha256'] == METHOD and record['contractSha256'] == approval['contractSha256'] and
             record['code'] == approval['code'] and record['release'] == release, 'PRODUCTION_APPROVAL_BINDING')
        if key == 'executionApprovalSha256':
            need(record['executionBindingSha256'] == execution_binding(approval), 'EXACT_EXECUTION_SCOPE_DRIFT')


def load_approval(*, local=False):
    """Only this fixed custody location is authoritative; no CLI/environment override."""
    store = local_custody_home() / '.local/share/jso/g3-r2' if local else REMOTE_STORE
    uid = os.getuid() if local else 0
    st = store.lstat()
    need(stat.S_ISDIR(st.st_mode) and st.st_uid == uid and stat.S_IMODE(st.st_mode) == 0o700, 'TRUST_STORE_CUSTODY')
    raw = bounded(store / 'approved.json', trusted_uid=uid)
    approval = parse(raw)
    exact(approval, ('version', 'purpose', 'methodSha256', 'ownerApprovalSha256', 'contractSha256',
                     'exceptionSha256', 'referenceEvidenceSha256', 'sourceIndexSha256', 'reference', 'code', 'runtime', 'collectorRuntime', 'release', 'host',
                     'files', 'window', 'transport', 'scope', 'mergeRecordSha256', 'executionApprovalSha256'))
    need(approval['version'] == 2 and type(approval['version']) is int and approval['methodSha256'] == METHOD, 'METHOD_NOT_APPROVED')
    need(approval['purpose'] in ('ISOLATED_VALIDATION_ONLY', 'PRODUCTION_WINDOW'), 'PURPOSE')
    for k in ('ownerApprovalSha256', 'contractSha256', 'exceptionSha256', 'referenceEvidenceSha256'):
        need(type(approval[k]) is str and SHA.fullmatch(approval[k]), 'TRUST_PIN_REQUIRED')
    for label, filename in [('ownerApprovalSha256', 'owner-approval.json'), ('contractSha256', 'contract.json'),
                            ('exceptionSha256', 'exception.json')]:
        need(sha(bounded(store / filename, trusted_uid=uid)) == approval[label], 'TRUST_CHAIN_PIN')
    owner = json.loads(bounded(store / 'owner-approval.json', trusted_uid=uid))
    need(owner.get('methodSha256') == METHOD and owner.get('methodApproved') is True, 'METHOD_OWNER_RECORD')
    contract = json.loads(bounded(store / 'contract.json', trusted_uid=uid))
    need(contract.get('schemaVersion') == 2 and contract.get('methodSha256') == METHOD, 'CONTRACT_VERSION')
    need(contract.get('code') == approval['code'], 'CONTRACT_CODE_BINDING')
    exception = json.loads(bounded(store / 'exception.json', trusted_uid=uid))
    need(exception.get('schemaVersion') == 2 and exception.get('evidenceContractSha256') == approval['contractSha256']
         and exception.get('methodSha256') == METHOD, 'EXCEPTION_CHAIN')
    from g3_r2_bootstrap import CODE_FILES
    need(type(approval['code']) is dict and set(approval['code']) == CODE_FILES, 'CODE_SET')
    for name, pin in approval['code'].items():
        need(Path(name).name == name and SHA.fullmatch(pin), 'CODE_PIN')
        need(sha(bounded(ROOT / name)) == pin, 'CODE_DRIFT')
        loaded = sys.modules.get(Path(name).stem)
        if loaded is not None:
            need(hasattr(loaded, '__source_sha256__'), 'UNVERIFIED_PRELOADED_CODE')
            need(loaded.__source_sha256__ == pin, 'EXECUTED_CODE_BINDING')
    exact(approval['files'], SIDES)
    exact(approval['host'], ('instance', 'boot'))
    exact(approval['runtime'], ('python', 'sqlite', 'executableSha256', 'sqliteExtensionSha256', 'sqliteLibrarySha256'))
    exact(approval['collectorRuntime'], tuple(approval['runtime']))
    if local:
        need(runtime() == approval['collectorRuntime'], 'COLLECTOR_RUNTIME_BINDING')
    exact(approval['reference'], tuple(REF_PINS))
    if approval['purpose'] == 'PRODUCTION_WINDOW':
        need(approval['reference'] == REF_PINS, 'FIXED_REFERENCE_ONLY')
        need(approval['files']['prestate']['identity']['sha256'] == 'sha256:' + REF_PINS['schema10Main'], 'PRESERVED_REFERENCE_PIN')
        production_approvals(approval, store, uid)
        need(approval['scope'] == 'G3_PRODUCTION_EVIDENCE_ONLY', 'PRODUCTION_SCOPE')
    else:
        need(approval['mergeRecordSha256'] is None and approval['executionApprovalSha256'] is None and approval['release'] is None and
             approval['scope'] == 'SYNTHETIC_ONLY_NOT_PRODUCTION', 'LAB_SCOPE')
    if local:
        from g3_r2_acceptance import verify_sources
        verify_sources(approval, store, uid)
        # This is a separately reviewed installation record anchored in Jenn's
        # approved store, never an observation fetched through the capture session.
        from g3_r2_endpoint import ENDPOINT, PROFILE
        transport = approval['transport']
        need(transport['profile'] == PROFILE and transport['endpoint'] == ENDPOINT, 'ENDPOINT_PROFILE')
        deployment_raw = bounded(store / 'endpoint-deployment.json', trusted_uid=uid)
        need(sha(deployment_raw) == transport['endpointDeploymentSha256'], 'ENDPOINT_DEPLOYMENT_PIN')
        deployment = parse(deployment_raw)
        exact(deployment, ('version', 'profile', 'endpoint', 'host', 'code', 'runtime', 'parents', 'sourceEvidenceSha256'))
        need(type(deployment['version']) is int and deployment['version'] == 1 and
             deployment['profile'] == PROFILE and deployment['endpoint'] == ENDPOINT and
             all(deployment[k] == approval[k] for k in ('host', 'code', 'runtime')), 'ENDPOINT_DEPLOYMENT_BINDING')
        parents = deployment['parents']
        need(parents == transport['endpointParents'], 'ENDPOINT_DEPLOYMENT_PARENT_BINDING')
        need(type(parents) is list and len(parents) == 3 and all(type(p) is list and len(p) == 5 and
             all(type(v) is int for v in p) and p[2] == 0 and stat.S_ISDIR(p[4]) and not p[4] & 0o022
             for p in parents), 'ENDPOINT_DEPLOYMENT_CUSTODY')
        need(sha(bounded(store / 'endpoint-deployment-source', trusted_uid=uid)) == deployment['sourceEvidenceSha256'],
             'ENDPOINT_INDEPENDENT_DEPLOYMENT_SOURCE')
    return approval, sha(raw)


def reference(path, expected_sha, approval):
    need(expected_sha == approval['referenceEvidenceSha256'], 'CALLER_CANNOT_SELECT_REFERENCE_PIN')
    raw = bounded(Path(path))
    need(sha(raw) == expected_sha, 'REFERENCE_EVIDENCE_DIGEST')
    obj = parse(raw)
    exact(obj, ('version', 'methodSha256', 'reference', 'historicalWalCompleteness', 'historicalWriterCoverage', 'scope'))
    need(obj == {'version': 2, 'methodSha256': METHOD, 'reference': approval['reference'],
                 'historicalWalCompleteness': 'NOT_PROVEN', 'historicalWriterCoverage': 'NOT_PROVEN',
                 'scope': approval['scope']}, 'REFERENCE_CHAIN_MISMATCH')
    return obj


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save_new(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as f:
            f.write(raw)
            f.flush()
            os.fsync(fd)
        os.fchmod(fd, 0o400)
        os.fsync(fd)
    finally:
        os.close(fd)
    fsync_dir(Path(path).parent)
