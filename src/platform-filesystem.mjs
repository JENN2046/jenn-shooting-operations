import { resolve } from 'node:path';

export const IS_WINDOWS = process.platform === 'win32';

export function pathsEqual(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return IS_WINDOWS
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

export function hasExactPermissions(metadata, expected) {
  return IS_WINDOWS || (metadata.mode & 0o777n) === expected;
}

export function supportsDirectoryFsync() {
  return !IS_WINDOWS;
}
