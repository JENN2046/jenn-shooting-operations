#!/usr/bin/env python3
"""Trusted-admin-launched, bounded single capture. No installation or restart."""
import os
from pathlib import Path
import signal
import sys

if __name__ == '__main__':
    try:
        if len(sys.argv) != 1 or os.getuid() != 0 or os.geteuid() != 0:
            raise ValueError('ROOT_NO_ARGUMENTS_REQUIRED')
        os.chdir('/')
        signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError('ENDPOINT_DEADLINE')))
        signal.alarm(260)
        root = Path(__file__).resolve().parent
        boot = {'__file__': str(root / 'g3_r2_bootstrap.py')}
        exec(compile((root / 'g3_r2_bootstrap.py').read_bytes(), boot['__file__'], 'exec'), boot)
        boot['bootstrap'](root, local=False)
        from g3_r2_common import load_approval
        from g3_r2_endpoint import serve_once
        approval, pin = load_approval()
        serve_once(approval, pin)
    except BaseException:
        sys.stderr.write('R2_ENDPOINT_BLOCKED_NO_RETRY\n')
        sys.exit(2)
