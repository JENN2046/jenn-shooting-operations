import { randomUUID } from 'node:crypto';
import { renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [databasePath, storedPath, cleanupRoot] = process.argv.slice(2);
const db = new DatabaseSync(databasePath);
db.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;');
const stagedPath = join(cleanupRoot, `${basename(storedPath)}.cleanup-${randomUUID()}`);
renameSync(storedPath, stagedPath);
process.send({ type: 'staged', stagedPath });
setInterval(() => {}, 1000);
