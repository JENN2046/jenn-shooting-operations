import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScheduleStore } from '../src/store.mjs';

const DEFAULT_MAX_AGE_HOURS = 24;

function usage() {
  return [
    'Usage: npm run uploads:cleanup -- [--apply] [--max-age-hours <hours>]',
    '',
    'Defaults to a read-only dry-run. Pass --apply to delete eligible orphan uploads.',
  ].join('\n');
}

export function parseCleanupArgs(args) {
  let apply = false;
  let maxAgeHours = Number(process.env.ORPHAN_MAX_AGE_HOURS || DEFAULT_MAX_AGE_HOURS);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--apply') {
      apply = true;
    } else if (argument === '--max-age-hours') {
      maxAgeHours = Number(args[index + 1]);
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      return { help: true };
    } else {
      throw new TypeError(`unknown argument: ${argument}`);
    }
  }
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new TypeError('--max-age-hours must be a positive number');
  }
  return { apply, maxAgeHours };
}

export function runCleanup({
  args = process.argv.slice(2),
  databasePath = resolve(process.env.DATABASE_PATH || './data/shooting-operations.sqlite'),
  uploadRoot = resolve(process.env.UPLOAD_ROOT || './data/uploads'),
  orphanCleanupDomain = process.env.ORPHAN_CLEANUP_DOMAIN || undefined,
  clock,
} = {}) {
  const options = parseCleanupArgs(args);
  if (options.help) return { help: usage() };
  if (!existsSync(databasePath)) {
    throw new Error(`database does not exist: ${databasePath}`);
  }

  const store = new ScheduleStore({
    filename: databasePath,
    uploadRoot,
    clock,
    readOnly: !options.apply,
    orphanCleanupDomain,
  });
  try {
    const result = store.cleanupOrphanUploads({
      olderThanMs: options.maxAgeHours * 60 * 60 * 1000,
      dryRun: !options.apply,
    });
    return {
      mode: options.apply ? 'apply' : 'dry-run',
      maxAgeHours: options.maxAgeHours,
      ...result,
    };
  } finally {
    store.close();
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const result = runCleanup();
    if (result.help) console.log(result.help);
    else console.log(JSON.stringify(result));
    if (result.fileErrors || (result.mode === 'apply' && result.skipped)) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 1;
  }
}
