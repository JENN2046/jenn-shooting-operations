import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export function sqliteFilenamePath(databasePath) {
  if (!databasePath.startsWith('file:')) return databasePath;

  let encodedPath = databasePath.slice('file:'.length);
  const suffixIndex = encodedPath.search(/[?#]/u);
  if (suffixIndex >= 0) encodedPath = encodedPath.slice(0, suffixIndex);

  if (encodedPath.startsWith('//localhost/')) {
    encodedPath = encodedPath.slice('//localhost'.length);
  } else if (encodedPath.startsWith('//') && !encodedPath.startsWith('///')) {
    throw new Error('G3_AUTHORITY_RECONCILIATION_DATABASE_URI_INVALID');
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    throw new Error('G3_AUTHORITY_RECONCILIATION_DATABASE_URI_INVALID');
  }
  if (decodedPath.includes('\0')) {
    throw new Error('G3_AUTHORITY_RECONCILIATION_DATABASE_URI_INVALID');
  }
  return decodedPath;
}

export function fileIdentity(path) {
  try {
    const realpath = realpathSync(resolve(path));
    const metadata = statSync(realpath);
    if (!metadata.isFile()) return null;
    return Object.freeze({
      realpath,
      device: metadata.dev,
      inode: metadata.ino,
    });
  } catch {
    return null;
  }
}

export function pathsReferToSameFile(left, right) {
  const leftIdentity = fileIdentity(left);
  const rightIdentity = fileIdentity(right);
  if (!leftIdentity || !rightIdentity) return false;
  return leftIdentity.realpath === rightIdentity.realpath
    || (leftIdentity.device === rightIdentity.device
      && leftIdentity.inode === rightIdentity.inode);
}

