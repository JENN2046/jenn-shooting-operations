import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import {
  DuplicateCallbackJsonKeyError,
  parseCallbackJsonRejectingDuplicateKeysV1,
} from './callback-json-v1.mjs';

// A source admission limit, not a production-data or HTTP request limit.
export const PRODUCTION_MANIFEST_JSON_MAX_BYTES = 1024 * 1024;

function invalid(code) {
  return Object.freeze({
    ok: false,
    issues: Object.freeze([Object.freeze({ code, path: '/' })]),
  });
}

/**
 * Raw JSON ingress for the manifest and its schema. Do not pass a value that
 * has already gone through JSON.parse: lost duplicate members are unrecoverable.
 * Reuse the existing pure parser unchanged; despite its historical callback
 * name, it has no callback, provider, file, network or authorization dependency.
 */
export function parseProductionManifestJson(source) {
  let text;
  if (typeof source === 'string') {
    if (Buffer.byteLength(source, 'utf8') > PRODUCTION_MANIFEST_JSON_MAX_BYTES) {
      return invalid('MANIFEST_JSON_TOO_LARGE');
    }
    text = source;
  } else if (source instanceof Uint8Array) {
    if (source.byteLength > PRODUCTION_MANIFEST_JSON_MAX_BYTES) {
      return invalid('MANIFEST_JSON_TOO_LARGE');
    }
    try {
      // Retain a BOM so strict JSON rejects it; never silently repair bytes.
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source);
    } catch {
      return invalid('MANIFEST_JSON_INVALID');
    }
  } else {
    return invalid('MANIFEST_JSON_INVALID');
  }

  try {
    // Decoded keys are checked per object BEFORE assignment. Root, nested,
    // escaped-equivalent and equal-valued duplicate members all fail closed.
    const value = parseCallbackJsonRejectingDuplicateKeysV1(text);
    return Object.freeze({ ok: true, value });
  } catch (error) {
    // No key, input fragment, exception message, partial value or digest leaks.
    return invalid(error instanceof DuplicateCallbackJsonKeyError
      ? 'MANIFEST_JSON_DUPLICATE_KEY' : 'MANIFEST_JSON_INVALID');
  }
}
