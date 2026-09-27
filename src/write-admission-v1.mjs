const APPLY = Reflect.apply;
const STRING = String;
const STRING_TRIM = String.prototype.trim;
const STRING_TO_LOWER_CASE = String.prototype.toLowerCase;
const FREEZE = Object.freeze;

export function normalizeWriteAdmissionMode(value = 'enabled') {
  const coerced = STRING(value || 'enabled');
  const trimmed = APPLY(STRING_TRIM, coerced, []);
  const mode = APPLY(STRING_TO_LOWER_CASE, trimmed, []);
  if (mode !== 'enabled' && mode !== 'disabled') {
    throw new TypeError('write admission mode must be enabled or disabled');
  }
  return mode;
}

export function writeAdmissionFailure() {
  return FREEZE({
    ok: false,
    status: 503,
    code: 'WRITE_ADMISSION_DISABLED',
  });
}

export function createWriteAdmissionControl({ initialMode = 'enabled' } = {}) {
  let mode = normalizeWriteAdmissionMode(initialMode);
  let transitionCount = 0;

  const status = () => FREEZE({
    mode,
    enabled: mode === 'enabled',
    transitionCount,
  });

  const isEnabled = () => mode === 'enabled';
  const isDisabled = () => mode === 'disabled';
  const enable = () => {
    if (mode === 'enabled') {
      return FREEZE({
        ok: true,
        code: 'WRITE_ADMISSION_ALREADY_ENABLED',
        ...status(),
      });
    }
    mode = 'enabled';
    transitionCount += 1;
    return FREEZE({
      ok: true,
      code: 'WRITE_ADMISSION_ENABLED',
      ...status(),
    });
  };

  return FREEZE({
    status,
    isEnabled,
    isDisabled,
    enable,
  });
}
