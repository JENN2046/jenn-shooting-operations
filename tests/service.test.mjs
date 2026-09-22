import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOperationsServer } from '../src/server.mjs';
import { ScheduleStore } from '../src/store.mjs';

const tokens = {
  viewer: 'viewer-token-000000000001',
  submitter: 'submitter-token-00000001',
  scheduler: 'scheduler-token-00000001',
  administrator: 'administrator-token-0001',
};
let origin;
let service;

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

before(async () => {
  let sequence = 0;
  service = createOperationsServer({
    databasePath: ':memory:',
    tokens,
    clock: () => new Date('2026-09-22T08:00:00.000Z'),
    idFactory: () => `fixed-request-id-${++sequence}`,
  });
  service.server.listen(0, '127.0.0.1');
  await once(service.server, 'listening');
  const address = service.server.address();
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  service.server.close();
  await once(service.server, 'close');
});

test('health and read-only board snapshot are public', async () => {
  const health = await fetch(`${origin}/healthz`);
  assert.equal(health.status, 200);
  const snapshot = await fetch(`${origin}/api/v1/snapshot`);
  assert.equal(snapshot.status, 200);
  const submitPage = await fetch(`${origin}/submit/print`);
  assert.equal(submitPage.status, 200);
  assert.match(submitPage.headers.get('content-security-policy'), /img-src 'self' data: blob:/);
});

test('public users cannot modify the schedule snapshot', async () => {
  const read = await fetch(`${origin}/api/v1/snapshot`);
  const { snapshot } = await read.json();
  const write = await fetch(`${origin}/api/v1/snapshot`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': String(snapshot.revision), 'Idempotency-Key': 'public-write-0001' },
    body: JSON.stringify(snapshot),
  });
  assert.equal(write.status, 401);
});

test('public request submission rejects invalid content rather than requiring a token', async () => {
  const write = await fetch(`${origin}/api/v1/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(write.status, 422);
});

test('flat and video request attributes cannot be mixed', async () => {
  const base = {
    schemaVersion: 1,
    operationId: 'web-operation-mixed-0001',
    productionType: '平面',
    sku: 'SKU-MIXED',
    name: '混合属性测试',
    kind: '待定',
    shootingSubtype: '人物展示',
    aspectRatio: '9:16',
    deliver: '不应通过',
    requestedBy: '测试提报人',
  };
  const flatWithVideoFields = await fetch(`${origin}/api/v1/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(base),
  });
  assert.equal(flatWithVideoFields.status, 422);

  const videoWithRemovedFields = await fetch(`${origin}/api/v1/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...base,
      operationId: 'web-operation-mixed-0002',
      productionType: '视频',
      shootingSubtype: '产品展示',
      deliverableCount: 3,
      durationSeconds: 30,
      audioRequirement: '配音',
    }),
  });
  assert.equal(videoWithRemovedFields.status, 422);
});

test('submission is append-only and idempotent', async () => {
  const payload = {
    schemaVersion: 1,
    operationId: 'web-operation-0001',
    productionType: '平面',
    shootingSubtype: '模特',
    deliverableCount: 8,
    aspectRatio: '3:4',
    sku: 'SKU-100',
    name: '测试产品',
    kind: '模特',
    deliver: '主图模特',
    requestedBy: '测试提报人',
  };
  const submit = () => fetch(`${origin}/api/v1/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const first = await submit();
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  const replay = await submit();
  assert.equal(replay.status, 201);
  const replayBody = await replay.json();
  assert.equal(replayBody.replayed, true);
  assert.equal(replayBody.taskId, firstBody.taskId);

  const read = await fetch(`${origin}/api/v1/snapshot`);
  const { snapshot } = await read.json();
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.revision, 1);
});

test('images upload first and become assets on the submitted task', async () => {
  const operationId = 'web-operation-upload-0001';
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const upload = await fetch(`${origin}/api/v1/uploads?operationId=${operationId}&kind=image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
      'X-File-Name': encodeURIComponent('产品图.png'),
    },
    body: png,
  });
  assert.equal(upload.status, 201);
  const uploadBody = await upload.json();
  assert.equal(uploadBody.upload.name, '产品图.png');

  const submit = await fetch(`${origin}/api/v1/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      operationId,
      productionType: '视频',
      shootingSubtype: '产品加人物展示',
      aspectRatio: '9:16',
      sku: 'SKU-UPLOAD',
      name: '带图产品',
      kind: '模特',
      deliver: '产品与人物展示',
      requestedBy: '测试提报人',
      uploadIds: [uploadBody.upload.id],
    }),
  });
  assert.equal(submit.status, 201);

  const read = await fetch(`${origin}/api/v1/snapshot`);
  const { snapshot } = await read.json();
  const task = snapshot.tasks.find(item => item.sku === 'SKU-UPLOAD');
  assert.equal(task.client, '待确认');
  assert.equal(task.request.productionType, '视频');
  assert.equal(task.request.shootingSubtype, '产品加人物展示');
  assert.equal(task.request.durationSeconds, undefined);
  assert.equal(task.request.audioRequirement, undefined);
  assert.equal(task.request.deliverableCount, undefined);
  assert.equal(task.assets.length, 1);
  assert.equal(task.assets[0].name, '产品图.png');
});

test('valid attachments upload and become assets on the submitted task', async () => {
  const operationId = 'web-operation-attachment-0001';
  const attachment = Buffer.from('shot,requirement\nA,white background\n');
  const upload = await fetch(`${origin}/api/v1/uploads?operationId=${operationId}&kind=attachment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/csv',
      'X-File-Name': encodeURIComponent('拍摄清单.csv'),
    },
    body: attachment,
  });
  assert.equal(upload.status, 201);
  const uploadBody = await upload.json();

  const submit = await fetch(`${origin}/api/v1/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      operationId,
      productionType: '平面',
      shootingSubtype: '细节',
      aspectRatio: '4:5',
      sku: 'SKU-ATTACHMENT',
      name: '附件测试产品',
      kind: '细节',
      deliver: '产品细节图',
      requestedBy: '测试提报人',
      uploadIds: [uploadBody.upload.id],
    }),
  });
  assert.equal(submit.status, 201);

  const read = await fetch(`${origin}/api/v1/snapshot`);
  const { snapshot } = await read.json();
  const task = snapshot.tasks.find(item => item.sku === 'SKU-ATTACHMENT');
  assert.equal(task.assets.length, 1);
  assert.equal(task.assets[0].name, '拍摄清单.csv');
  assert.equal(task.assets[0].kind, 'attachment');
  assert.equal(task.assets[0].contentType, 'text/csv');
  assert.equal(task.assets[0].size, attachment.length);
});

test('invalid submissions immediately discard their unclaimed uploads', async () => {
  const operationId = 'web-operation-invalid-cleanup-0001';
  const upload = await fetch(`${origin}/api/v1/uploads?operationId=${operationId}&kind=attachment`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'X-File-Name': 'orphan.txt' },
    body: Buffer.from('temporary upload'),
  });
  assert.equal(upload.status, 201);
  const uploadBody = await upload.json();

  const invalid = await fetch(`${origin}/api/v1/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schemaVersion: 1, operationId, uploadIds: [uploadBody.upload.id] }),
  });
  assert.equal(invalid.status, 422);

  const reuseDeletedUpload = await fetch(`${origin}/api/v1/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      operationId,
      productionType: '平面',
      shootingSubtype: '待定',
      aspectRatio: '待定',
      sku: 'SKU-CLEANUP',
      name: '清理验证',
      kind: '待定',
      deliver: '待定',
      requestedBy: '测试提报人',
      uploadIds: [uploadBody.upload.id],
    }),
  });
  assert.equal(reuseDeletedUpload.status, 422);
  assert.equal((await reuseDeletedUpload.json()).code, 'INVALID_UPLOAD_REFERENCE');
});

test('expired orphan cleanup deletes only files without remaining references', () => {
  const root = mkdtempSync(join(tmpdir(), 'jenn-shooting-uploads-'));
  const uploadRoot = join(root, 'uploads');
  const databasePath = join(root, 'operations.sqlite');
  let now = new Date('2026-09-22T08:00:00.000Z');
  let sequence = 0;
  let activeStore = new ScheduleStore({
    filename: databasePath,
    uploadRoot,
    clock: () => now,
    idFactory: () => `cleanup-${++sequence}`,
    orphanMaxAgeMs: 1000,
  });
  try {
    const store = activeStore;
    const sharedBuffer = Buffer.from('shared attachment');
    const claimed = store.saveUpload({
      operationId: 'cleanup-claimed-0001', originalName: 'claimed.txt', contentType: 'text/plain', kind: 'attachment', buffer: sharedBuffer,
    });
    const orphanSharingFile = store.saveUpload({
      operationId: 'cleanup-shared-0001', originalName: 'orphan.txt', contentType: 'text/plain', kind: 'attachment', buffer: sharedBuffer,
    });
    const orphanOnly = store.saveUpload({
      operationId: 'cleanup-orphan-0001', originalName: 'expired.txt', contentType: 'text/plain', kind: 'attachment', buffer: Buffer.from('expired attachment'),
    });
    const submitted = store.submitRequest({
      role: 'public-submitter',
      submission: {
        schemaVersion: 1,
        operationId: 'cleanup-claimed-0001',
        productionType: '平面',
        shootingSubtype: '待定',
        aspectRatio: '待定',
        sku: 'SKU-CLAIMED',
        name: '已绑定文件',
        kind: '待定',
        deliver: '待定',
        requestedBy: '测试提报人',
        uploadIds: [claimed.upload.id],
      },
    });
    assert.equal(submitted.status, 201);
    assert.equal(orphanSharingFile.status, 201);
    assert.equal(orphanOnly.status, 201);

    const sharedPath = join(uploadRoot, `${claimed.upload.sha256}.txt`);
    const orphanOnlyPath = join(uploadRoot, `${orphanOnly.upload.sha256}.txt`);
    assert.equal(existsSync(sharedPath), true);
    assert.equal(existsSync(orphanOnlyPath), true);

    now = new Date(now.getTime() + 1001);
    store.close();
    activeStore = null;
    const restarted = createOperationsServer({
      databasePath,
      uploadRoot,
      clock: () => now,
      orphanMaxAgeMs: 1000,
      cleanupIntervalMs: 0,
    });
    activeStore = restarted.store;
    assert.equal(existsSync(sharedPath), true);
    assert.equal(existsSync(orphanOnlyPath), false);
    assert.equal(restarted.store.cleanupOrphanUploads().deleted, 0);
  } finally {
    activeStore?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('upload rejects executable content and mismatched image signatures', async () => {
  const executable = await fetch(`${origin}/api/v1/uploads?operationId=web-operation-upload-0002&kind=attachment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-msdownload', 'X-File-Name': 'bad.exe' },
    body: Buffer.from('MZ'),
  });
  assert.equal(executable.status, 415);

  const fakeImage = await fetch(`${origin}/api/v1/uploads?operationId=web-operation-upload-0003&kind=image`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', 'X-File-Name': 'fake.png' },
    body: Buffer.from('not a png'),
  });
  assert.equal(fakeImage.status, 415);
  assert.equal((await fakeImage.json()).code, 'UPLOAD_SIGNATURE_MISMATCH');
});

test('scheduler writes with optimistic concurrency and stale writes fail', async () => {
  const read = await fetch(`${origin}/api/v1/snapshot`, { headers: auth(tokens.scheduler) });
  const { snapshot } = await read.json();
  const next = { ...snapshot, sessions: [] };
  const write = await fetch(`${origin}/api/v1/snapshot`, {
    method: 'PUT',
    headers: {
      ...auth(tokens.scheduler),
      'Content-Type': 'application/json',
      'If-Match': String(snapshot.revision),
      'Idempotency-Key': 'workbench-save-0001',
    },
    body: JSON.stringify(next),
  });
  assert.equal(write.status, 200);

  const stale = await fetch(`${origin}/api/v1/snapshot`, {
    method: 'PUT',
    headers: {
      ...auth(tokens.scheduler),
      'Content-Type': 'application/json',
      'If-Match': String(snapshot.revision),
      'Idempotency-Key': 'workbench-save-0002',
    },
    body: JSON.stringify(next),
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'REVISION_CONFLICT');
});

test('idempotency keys cannot be reused across operation types', async () => {
  const read = await fetch(`${origin}/api/v1/snapshot`, { headers: auth(tokens.scheduler) });
  const { snapshot } = await read.json();
  const response = await fetch(`${origin}/api/v1/snapshot`, {
    method: 'PUT',
    headers: {
      ...auth(tokens.scheduler),
      'Content-Type': 'application/json',
      'If-Match': String(snapshot.revision),
      'Idempotency-Key': 'web-operation-0001',
    },
    body: JSON.stringify(snapshot),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'IDEMPOTENCY_KEY_REUSE');
});

test('invalid snapshot fails closed', async () => {
  const read = await fetch(`${origin}/api/v1/snapshot`, { headers: auth(tokens.scheduler) });
  const { snapshot } = await read.json();
  snapshot.sessions.push({ id: 'bad', ids: ['missing'], date: 'bad', start: '12:00', end: '11:00', place: '', note: '' });
  const response = await fetch(`${origin}/api/v1/snapshot`, {
    method: 'PUT',
    headers: {
      ...auth(tokens.scheduler),
      'Content-Type': 'application/json',
      'If-Match': String(snapshot.revision),
      'Idempotency-Key': 'workbench-save-invalid',
    },
    body: JSON.stringify(snapshot),
  });
  assert.equal(response.status, 422);
});
