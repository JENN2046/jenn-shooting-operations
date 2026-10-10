#!/usr/bin/env python3
"""R2 preparation entry: governed custody and exact copies. Never governance admission."""
import argparse
import os
from pathlib import Path
import resource
import signal
import sys

if __name__ == '__main__':
    # Bootstrap is read as source; its bytes and every dependency are checked before imports.
    _boot = {'__file__': str(Path(__file__).resolve().parent / 'g3_r2_bootstrap.py')}
    try:
        _root = Path(__file__).resolve().parent
        exec(compile((_root / 'g3_r2_bootstrap.py').read_bytes(), _boot['__file__'], 'exec'), _boot)
        _boot['bootstrap'](_root, local=False)
    except Exception:
        print('{"status":"R2_BOOTSTRAP_BLOCKED","adoptionAuthorityAllowed":false}')
        raise SystemExit(2)
    

from g3_r2_common import (canonical, DENY, host_identity, load_approval, MAX_OUTPUT, METHOD,
                          need, reference, runtime, sha)
from g3_r2_custody import PinnedPair
from g3_r2_snapshot import PrivateCopies, inspect_copy


def capture(approval, approval_sha, evidence_path, expected_evidence_sha, challenge):
    import re
    need(re.fullmatch('[a-f0-9]{64}', challenge) is not None, 'CHALLENGE')
    reference(evidence_path, expected_evidence_sha, approval)
    need(runtime() == approval['runtime'], 'RUNTIME_BINDING')
    with PinnedPair(approval) as pair:
        before = pair.recheck()
        writers_before = pair.writer_evidence
        # Check both originals' header and hash before any SQLite interpretation.
        for side, fmt in (('prestate', b'\x02\x02'), ('active', b'\x01\x01')):
            need(os.pread(pair.fds[side], 2, 18) == fmt, 'R2_FORMAT_COMBINATION')
        copy = PrivateCopies()
        with copy:
            paths = copy.create(pair.fds, {k: v['identity'] for k, v in approval['files'].items()})
            views = {k: inspect_copy(p) for k, p in paths.items()}
            profile = 'g3' if approval['purpose'] == 'PRODUCTION_WINDOW' else 'synthetic'
            problems, legacy = pair.w.prove(views['prestate'], views['active'], profile)
            need(not problems, 'SEMANTIC_COMPARISON_REJECTED')
            for side, path in paths.items():
                need('sha256:' + sha(path.read_bytes()) == approval['files'][side]['identity']['sha256'], 'COPY_DRIFT')
            after = pair.recheck()
            need(before == after, 'CUSTODY_DRIFT')
        need(copy.cleanup_confirmed, 'CLEANUP_NOT_CONFIRMED')
        # Cleanup itself must not weaken any original or parent custody.
        need(pair.recheck() == before, 'POST_CLEANUP_CUSTODY_DRIFT')
        writers_after = pair.writer_evidence
        need(writers_before == writers_after, 'WRITER_EVIDENCE_DRIFT')
        record = {'version': 2, 'domain': 'G3_PRODUCTION_EVIDENCE_R2' if profile == 'g3' else 'G3_ISOLATED_EVIDENCE_R2',
                  'status': 'R2_OBSERVATION_REQUIRES_LOCAL_ACCEPTANCE', 'challenge': challenge,
                  'methodSha256': METHOD, 'approvalManifestSha256': approval_sha,
                  'contractSha256': approval['contractSha256'], 'exceptionSha256': approval['exceptionSha256'],
                  'referenceEvidenceSha256': expected_evidence_sha, 'reference': approval['reference'],
                  'code': approval['code'], 'runtime': runtime(), 'host': host_identity(),
                  'scope': approval['scope'], 'custodyBefore': before, 'custodyAfter': after,
                  'writersBefore': writers_before, 'writersAfter': writers_after,
                  'prestate': views['prestate'], 'active': views['active'], 'comparedLegacyTables': len(legacy),
                  'historicalWalCompleteness': 'NOT_PROVEN', 'historicalWriterCoverage': 'NOT_PROVEN',
                  'sampling': 'PINNED_ORIGINAL_FDS_PRIVATE_TMPFS_RO_IMMUTABLE_COPIES',
                  'checks': {'integrity': True, 'foreignKeys': True, 'migrationPrefix': True, 'fullTypedRowsets': True,
                             'structureAndIndexes': True, 'originalsStable': True, 'privateMount': True,
                             'copyHashes': True, 'noSidecars': True, 'cleanupConfirmed': True},
                  'problems': [], **DENY}
        record['captureDigest'] = sha(canonical(record))
        return record


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode', choices=('preflight', 'protect', 'verify', 'capture'))
    p.add_argument('--reference-evidence')
    p.add_argument('--expected-reference-evidence-sha256')
    p.add_argument('--challenge')
    args = p.parse_args()
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (60, 60))
    def timeout(*_):
        raise TimeoutError('REMOTE_WALL_TIME_LIMIT')
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(120)
    try:
        approval, approval_sha = load_approval()
        if args.mode == 'capture':
            need(args.reference_evidence is not None and args.expected_reference_evidence_sha256 is not None, 'REFERENCE_REQUIRED')
            record = capture(approval, approval_sha, args.reference_evidence, args.expected_reference_evidence_sha256, args.challenge or '')
        else:
            need(args.reference_evidence is None and args.expected_reference_evidence_sha256 is None and args.challenge is None, 'UNEXPECTED_ARGUMENTS')
            with PinnedPair(approval) as pair:
                files = pair.protect() if args.mode == 'protect' else pair.recheck(require_protected=args.mode == 'verify')
                record = {'version': 2, 'mode': args.mode, 'status': 'E1_' + args.mode.upper() + '_COMPLETE',
                          'files': files, 'writers': pair.writer_evidence, 'approvalManifestSha256': approval_sha, **DENY}
        raw = canonical(record)
        need(len(raw) <= MAX_OUTPUT, 'OUTPUT_SIZE_LIMIT')
        sys.stdout.buffer.write(raw)
        sys.stdout.buffer.flush()
        if args.mode == 'capture':
            sys.stderr.write('JSO_R2_COMPLETE:' + args.challenge + '\n')
        return 0
    except BaseException as exc:
        if isinstance(exc, KeyboardInterrupt):
            code = 'INTERRUPTED'
        elif isinstance(exc, ValueError) and str(exc).replace('_', '').isalnum():
            code = str(exc)
        else:
            code = type(exc).__name__
        raw = canonical({'version': 2, 'status': 'R2_FAIL_CLOSED', 'code': code,
                         'protectionMayRemain': True, 'automaticRetryAllowed': False, **DENY})
        sys.stdout.buffer.write(raw)
        return 2
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    sys.exit(main())
