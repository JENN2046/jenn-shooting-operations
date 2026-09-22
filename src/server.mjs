import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpApp } from './http-app.mjs';
import { ScheduleStore } from './store.mjs';

export function createOperationsServer({
  databasePath,
  uploadRoot,
  tokens,
  clock,
  idFactory,
  orphanMaxAgeMs,
  cleanupIntervalMs = 60 * 60 * 1000,
}) {
  const store = new ScheduleStore({ filename: databasePath, uploadRoot, clock, idFactory, orphanMaxAgeMs });
  store.cleanupOrphanUploads();
  const server = createServer(createHttpApp({ store, tokens }));
  const cleanupTimer = cleanupIntervalMs > 0
    ? setInterval(() => {
        try {
          store.cleanupOrphanUploads();
        } catch {
          console.error('Orphan upload cleanup failed; it will retry on the next interval.');
        }
      }, cleanupIntervalMs)
    : null;
  cleanupTimer?.unref();
  server.on('close', () => {
    if (cleanupTimer) clearInterval(cleanupTimer);
    store.close();
  });
  return { server, store };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3800);
  const databasePath = resolve(process.env.DATABASE_PATH || './data/shooting-operations.sqlite');
  const uploadRoot = resolve(process.env.UPLOAD_ROOT || './data/uploads');
  const tokens = {
    viewer: process.env.VIEWER_TOKEN,
    submitter: process.env.SUBMITTER_TOKEN,
    scheduler: process.env.SCHEDULER_TOKEN,
    administrator: process.env.ADMIN_TOKEN,
  };
  const { server } = createOperationsServer({ databasePath, uploadRoot, tokens });
  server.listen(port, host, () => {
    console.log(`Jenn Shooting Operations listening on ${host}:${port}`);
  });
}
