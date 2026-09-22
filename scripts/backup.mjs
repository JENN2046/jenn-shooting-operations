import { mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const source = resolve(process.env.DATABASE_PATH || './data/shooting-operations.sqlite');
const backupDirectory = resolve(process.env.BACKUP_DIRECTORY || './data/backups');
mkdirSync(backupDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = resolve(backupDirectory, `${basename(source, '.sqlite')}-${stamp}.sqlite`);
const escaped = destination.replaceAll("'", "''");
const db = new DatabaseSync(source, { readOnly: false });
try {
  db.exec(`VACUUM INTO '${escaped}'`);
  console.log(`Backup created in ${dirname(destination)}`);
} finally {
  db.close();
}
