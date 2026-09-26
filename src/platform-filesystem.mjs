import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';

export const IS_WINDOWS = process.platform === 'win32';

function toggledCasePath(path) {
  const characters = [...path];
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index];
    const lower = character.toLowerCase();
    const upper = character.toUpperCase();
    if (lower === upper) continue;
    characters[index] = character === lower ? upper : lower;
    return characters.join('');
  }
  return null;
}

export function filesystemPathIsCaseInsensitive(existingPath) {
  if (IS_WINDOWS) return true;

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

export function filesystemPathComparisonKey(path, existingAnchorPath = path) {
  const normalized = resolve(path);
  return filesystemPathIsCaseInsensitive(existingAnchorPath)
    ? normalized.toLowerCase()
    : normalized;
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
