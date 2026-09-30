// Trusted startup input, never inferred from auth JSON, database state or smoke values.
const bindings = new WeakSet();
export const PROD11_RESOURCE = 'STUDIO-PROD-01';
export const PROD11_DEVICE = 'KIOSK-PROD-01';
export const PROD11_REQUEST = 'REQ-GF15-ACCEPT-PROD-01';
export function createKioskServiceBindingV1({ context, expectedItem, start, end } = {}) {
  if (!['PROD11_PRODUCTION', 'WO03_ISOLATED_ACCEPTANCE'].includes(context)) {
    throw new Error('KIOSK_SERVICE_CONTEXT_REQUIRED');
  }
  const smokeValues = [expectedItem, start, end];
  if (context === 'WO03_ISOLATED_ACCEPTANCE' && smokeValues.some(v => v !== undefined)) {
    throw new Error('KIOSK_CROSS_CONTEXT_BINDING');
  }
  if (context === 'PROD11_PRODUCTION' && smokeValues.some(v => v !== undefined)) {
    const instant = value => typeof value === 'string'
      && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
      && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
    if (typeof expectedItem !== 'string' || expectedItem.length > 160
      || !/^\S(?:[\s\S]*\S)?$/u.test(expectedItem)
      || !instant(start) || !instant(end) || start >= end) {
      throw new Error('KIOSK_SMOKE_BINDING_REQUIRED');
    }
  }
  const binding = Object.freeze({ context, expectedItem, start, end,
    mode: context === 'WO03_ISOLATED_ACCEPTANCE' ? 'WO03_ISOLATED_ACCEPTANCE'
      : expectedItem === undefined ? 'DISABLED' : 'PROD11_SMOKE_ONLY' });
  bindings.add(binding);
  return binding;
}
export function requireKioskServiceBindingV1(binding) {
  if (!bindings.has(binding)) throw new Error('KIOSK_SERVICE_CONTEXT_REQUIRED');
  return binding;
}
export function assertKioskContextIdentityV1(binding, { deviceId, resourceIds, businessTimeZone }) {
  requireKioskServiceBindingV1(binding);
  if (binding.context === 'PROD11_PRODUCTION') {
    if (binding.mode !== 'PROD11_SMOKE_ONLY' || deviceId !== PROD11_DEVICE
      || businessTimeZone !== 'Asia/Shanghai'
      || (resourceIds && (resourceIds.length !== 1 || resourceIds[0] !== PROD11_RESOURCE))) {
      throw new Error('KIOSK_PRODUCTION_IDENTITY_MISMATCH');
    }
  } else if (deviceId === PROD11_DEVICE || resourceIds?.includes(PROD11_RESOURCE)) {
    throw new Error('KIOSK_CROSS_CONTEXT_IDENTITY');
  }
}
