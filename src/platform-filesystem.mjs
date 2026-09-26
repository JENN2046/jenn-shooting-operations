import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';

export const IS_WINDOWS = process.platform === 'win32';

const REFLECT_APPLY = Reflect.apply;
const STRING_TO_LOWER = String.prototype.toLowerCase;
const STRING_TO_UPPER = String.prototype.toUpperCase;
const STRING_NORMALIZE = String.prototype.normalize;
const STRING_SLICE = String.prototype.slice;

function lower(value) {
  return REFLECT_APPLY(STRING_TO_LOWER, value, []);
}

function upper(value) {
  return REFLECT_APPLY(STRING_TO_UPPER, value, []);
}

function normalizeUnicode(value, form) {
  return REFLECT_APPLY(STRING_NORMALIZE, value, [form]);
}

function slice(value, start, end) {
  return REFLECT_APPLY(STRING_SLICE, value, [start, end]);
}

function toggledCasePath(path) {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const character = path[index];
    const lowerCharacter = lower(character);
    const upperCharacter = upper(character);
    if (lowerCharacter === upperCharacter) continue;
    const toggled = character === lowerCharacter ? upperCharacter : lowerCharacter;
    return `${slice(path, 0, index)}${toggled}${slice(path, index + 1)}`;
  }
  return null;
}

export function filesystemPathIsCaseInsensitive(existingPath) {
  const normalized = resolve(existingPath);
  const alternate = toggledCasePath(normalized);
  if (!alternate || alternate === normalized) {
    return process.platform === 'darwin';
  }

  let original;
  let toggled;
  try {
    original = lstatSync(normalized, { bigint: true });
    toggled = lstatSync(alternate, { bigint: true });
  } catch {
    return false;
  }
  return original.dev === toggled.dev && original.ino === toggled.ino;
}

export function filesystemPathUsesCanonicalEquivalence(existingPath) {
  const resolved = resolve(existingPath);
  const nfc = normalizeUnicode(resolved, 'NFC');
  const nfd = normalizeUnicode(resolved, 'NFD');
  if (nfc === nfd) return false;

  let composed;
  let decomposed;
  try {
    composed = lstatSync(nfc, { bigint: true });
    decomposed = lstatSync(nfd, { bigint: true });
  } catch {
    return false;
  }
  return composed.dev === decomposed.dev && composed.ino === decomposed.ino;
}

export function filesystemPathComparisonKey(
  path,
  existingAnchorPath = path,
  {
    caseInsensitive = filesystemPathIsCaseInsensitive(existingAnchorPath),
    canonicalEquivalent = filesystemPathUsesCanonicalEquivalence(existingAnchorPath),
  } = {},
) {
  let key = resolve(path);
  if (canonicalEquivalent) key = normalizeUnicode(key, 'NFD');
  if (caseInsensitive) key = upper(key);
  if (canonicalEquivalent) key = normalizeUnicode(key, 'NFD');
  return key;
}

export function pathsEqual(left, right, existingAnchorPath = left) {
  return filesystemPathComparisonKey(left, existingAnchorPath)
    === filesystemPathComparisonKey(right, existingAnchorPath);
}

export function hasExactPermissions(metadata, expected) {
  return IS_WINDOWS || (metadata.mode & 0o777n) === expected;
}

export function supportsDirectoryFsync() {
  return !IS_WINDOWS;
}
