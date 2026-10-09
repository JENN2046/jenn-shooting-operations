#!/usr/bin/env python3
"""Collect once using the pre-provisioned Jenn approval store. No automatic retries."""
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
from g3_r2_collector import collect, issue


def main():
    try:
        if len(sys.argv) != 1:
            raise ValueError('NO_CALLER_AUTHORITY_PARAMETERS')
        approval, pin = load_approval(local=True)
        nonce = issue(pin)
        result = collect(nonce, approval, pin)
        print(canonical(result).decode())
        return 0
    except Exception:
        print(canonical({'status': 'R2_COLLECTOR_BLOCKED_NO_RETRY', **DENY}).decode())
        return 2


if __name__ == '__main__':
    sys.exit(main())
