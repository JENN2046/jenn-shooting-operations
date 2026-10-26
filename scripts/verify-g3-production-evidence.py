#!/usr/bin/env python3
"""Independent process, read-only ledger replay. Historical replay grants no fresh admission."""
import argparse
import sys
from pathlib import Path
if __name__ == '__main__':
    # Bootstrap is read as source; its bytes and every dependency are checked before imports.
    _boot = {'__file__': str(Path(__file__).resolve().parent / 'g3_r2_bootstrap.py')}
    try:
        _root = Path(__file__).resolve().parent
        exec(compile((_root / 'g3_r2_bootstrap.py').read_bytes(), _boot['__file__'], 'exec'), _boot)
        _boot['bootstrap'](_root, local=True)
    except Exception:
        print('{"status":"R2_BOOTSTRAP_BLOCKED","adoptionAuthorityAllowed":false}')
        raise SystemExit(2)
    

from g3_r2_common import canonical, DENY, load_approval
from g3_r2_collector import replay


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--challenge', required=True)
    p.add_argument('--require-fresh', action='store_true')
    args = p.parse_args()
    try:
        approval, pin = load_approval(local=True)
        print(canonical(replay(args.challenge, approval, pin, require_fresh=args.require_fresh)).decode())
        return 0
    except Exception:
        print(canonical({'status': 'R2_INDEPENDENT_REPLAY_REJECTED', **DENY}).decode())
        return 2


if __name__ == '__main__':
    sys.exit(main())
