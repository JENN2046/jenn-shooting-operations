import { ScheduleStore } from '../../src/store.mjs';

const [databasePath, uploadRoot, now] = process.argv.slice(2);
const store = new ScheduleStore({
  filename: databasePath,
  uploadRoot,
  clock: () => new Date(now),
  idFactory: () => 'live-upload-new',
  orphanMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
});

process.send({ type: 'ready' });
process.once('message', message => {
  if (message?.type !== 'upload') return;
  try {
    const result = store.saveUpload({
      operationId: 'live-upload-operation-0001',
      originalName: 'live.txt',
      contentType: 'text/plain',
      kind: 'attachment',
      buffer: Buffer.from('identical attachment'),
    });
    process.send({ type: 'result', result });
  } catch (error) {
    process.send({ type: 'result', error: error.message });
  } finally {
    store.close();
    process.disconnect();
  }
});
