const MODES = new Set(['enabled', 'disabled']);

export function normalizeWriteAdmissionMode(value = 'enabled') {
  const mode = String(value || 'enabled').trim().toLowerCase();
  if (!MODES.has(mode)) {
    throw new TypeError('write admission mode must be enabled or disabled');
  }
  return mode;
}

export function writeAdmissionDenied(mode) {
  return normalizeWriteAdmissionMode(mode) === 'disabled';
}

export function writeAdmissionFailure() {
  return Object.freeze({
    ok: false,
    status: 503,
    code: 'WRITE_ADMISSION_DISABLED',
  });
}
