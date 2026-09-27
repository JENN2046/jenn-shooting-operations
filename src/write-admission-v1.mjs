const MODES = new Set(['enabled', 'disabled']);

export function normalizeWriteAdmissionMode(value = 'enabled') {
  const mode = String(value || 'enabled').trim().toLowerCase();
  if (!MODES.has(mode)) {
    throw new TypeError('write admission mode must be enabled or disabled');
  }
  return mode;
}

export function writeAdmissionFailure() {
  return Object.freeze({
    ok: false,
    status: 503,
    code: 'WRITE_ADMISSION_DISABLED',
  });
}

export function createWriteAdmissionControl({ initialMode = 'enabled' } = {}) {
  let mode = normalizeWriteAdmissionMode(initialMode);
  let transitionCount = 0;

  const status = () => Object.freeze({
    mode,
    enabled: mode === 'enabled',
    transitionCount,
  });

  return Object.freeze({
    status,
    isEnabled: () => mode === 'enabled',
    isDisabled: () => mode === 'disabled',
    enable: () => {
      if (mode === 'enabled') {
        return Object.freeze({
          ok: true,
          code: 'WRITE_ADMISSION_ALREADY_ENABLED',
          ...status(),
        });
      }
      mode = 'enabled';
      transitionCount += 1;
      return Object.freeze({
        ok: true,
        code: 'WRITE_ADMISSION_ENABLED',
        ...status(),
      });
    },
  });
}
