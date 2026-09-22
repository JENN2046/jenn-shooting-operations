import { randomUUID } from 'node:crypto';
import { renameSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const [databasePath, storedPath] = process.argv.slice(2);
const db = new DatabaseSync(databasePath);
db.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;');
const stagedPath = `${storedPath}.cleanup-${randomUUID()}`;
renameSync(storedPath, stagedPath);
process.send({ type: 'staged', stagedPath });
setInterval(() => {}, 1000);
