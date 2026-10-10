"""Bounded child I/O; retain partial bytes on failure and always reap the child."""
import os
import selectors
import signal
import subprocess
import time
from g3_r2_common import MAX_OUTPUT


def run_bounded(argv, timeout=120, *, env=None):
    proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            start_new_session=True, env=env)
    streams = {'stdout': bytearray(), 'stderr': bytearray()}
    limited = False
    code = None
    started = time.monotonic()
    sel = selectors.DefaultSelector()
    def kill():
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        for name in streams:
            pipe = getattr(proc, name)
            os.set_blocking(pipe.fileno(), False)
            sel.register(pipe, selectors.EVENT_READ, name)
        while sel.get_map():
            if time.monotonic() - started >= timeout:
                limited = True
            if limited:
                kill()
            for key, _ in sel.select(.05):
                remaining = MAX_OUTPUT - len(streams[key.data])
                chunk = os.read(key.fileobj.fileno(), min(65536, remaining + 1))
                if not chunk:
                    sel.unregister(key.fileobj)
                    key.fileobj.close()
                    continue
                streams[key.data].extend(chunk[:remaining])
                if len(chunk) > remaining:
                    limited = True
                    sel.unregister(key.fileobj)
                    key.fileobj.close()
            if time.monotonic() - started > timeout + 2:
                limited = True
                break
    except (OSError, ValueError):
        limited = True
    finally:
        if limited:
            kill()
        for pipe in (proc.stdout, proc.stderr):
            if not pipe.closed:
                pipe.close()
        sel.close()
        try:
            code = proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            limited = True
            kill()
            code = proc.wait(timeout=2)
    return {'exit': code, 'stdout': bytes(streams['stdout']), 'stderr': bytes(streams['stderr']), 'limited': limited}
