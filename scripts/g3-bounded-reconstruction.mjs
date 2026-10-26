// Runs only on disposable archive copies; never a production admission verifier.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { initializeRuntimeWritableSchema, assertKnownSchema, MIGRATIONS } from '/app/src/sqlite-schema-v2.mjs';
const ROOT = '/work';
const fail = () => { throw new Error('RECONSTRUCTION_REJECTED'); };
const must = x => { if (!x) fail(); };
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const digest = x => hash(JSON.stringify(x));
const qi = x => '"' + x.replaceAll('"', '""') + '"';
function rows(db, sql) {
  const s = db.prepare(sql); s.setReadBigInts(true); s.setReturnArrays(true); return s.all();
}
function typed(x) {
  if (x === null) return ['null'];
  if (typeof x === 'bigint') return ['integer', x.toString()];
  if (typeof x === 'number') { must(Number.isFinite(x)); const b = Buffer.alloc(8); b.writeDoubleBE(x); return ['real', b.toString('hex')]; }
  if (typeof x === 'string') return ['text', x];
  if (x instanceof Uint8Array) return ['blob', Buffer.from(x).toString('hex')];
  fail();
}
const encoded = rs => rs.map(r => JSON.stringify(r.map(typed))).sort();
function markers(db) {
  const m = rows(db, 'SELECT version,name,checksum,applied_at FROM schema_migrations ORDER BY version');
  must(m.length === 10);
  m.forEach((r, i) => {
    must(r[0] === BigInt(i + 1) && r[1] === MIGRATIONS[i].name && r[2] === MIGRATIONS[i].checksum);
    must(typeof r[3] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r[3]));
    must(Number.isFinite(Date.parse(r[3])) && new Date(r[3]).toISOString() === r[3]);
  });
  return m;
}
function snapshot(db) {
  must(assertKnownSchema(db).version === 10);
  must(rows(db, 'PRAGMA integrity_check').map(r => r[0]).join() === 'ok');
  must(rows(db, 'PRAGMA foreign_key_check').length === 0);
  for (const r of rows(db, 'SELECT CAST(type AS BLOB),CAST(name AS BLOB),CAST(tbl_name AS BLOB),CAST(sql AS BLOB) FROM sqlite_schema')) {
    for (const v of r) if (v !== null) must(Buffer.from(Buffer.from(v).toString('utf8')).equals(Buffer.from(v)));
  }
  const schema = rows(db, 'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name,tbl_name,sql');
  const list = rows(db, 'PRAGMA table_list');
  const tables = {};
  for (const [, name] of schema.filter(r => r[0] === 'table')) {
    const columns = rows(db, `PRAGMA table_xinfo(${qi(name)})`);
    const row = list.find(r => r[1] === name); must(row);
    let fields = columns.map(c => qi(c[1]));
    if (row[4] === 0n) {
      const names = columns.map(c => c[1].toLowerCase());
      const alias = ['_rowid_', 'rowid', 'oid'].find(n => !names.includes(n)); must(alias); fields = [qi(alias), ...fields];
    }
    // TEXT is read as SQLite bytes, preserving invalid UTF-8 and embedded NUL.
    const projection = fields.flatMap(f => [`typeof(${f})`, `CASE WHEN typeof(${f})='text' THEN CAST(${f} AS BLOB) ELSE ${f} END`]);
    let data = rows(db, `SELECT ${projection.join(',')} FROM ${qi(name)}`);
    if (name === 'schema_migrations') {
      const offset = row[4] === 0n ? 1 : 0;
      const vi = 2 * (columns.findIndex(c => c[1] === 'version') + offset) + 1;
      const ti = 2 * (columns.findIndex(c => c[1] === 'applied_at') + offset) + 1;
      data = data.map(r => r.map((v, i) => i === ti && r[vi] >= 7n && r[vi] <= 10n ? 'DECLARED_REPLAY_TIMESTAMP' : v));
    }
    tables[name] = { columns: digest(columns.map(r => r.map(typed))), foreignKeys: digest(encoded(rows(db, `PRAGMA foreign_key_list(${qi(name)})`))), indexes: digest(encoded(rows(db, `PRAGMA index_list(${qi(name)})`))), count: data.length, rows: digest(encoded(data)) };
  }
  const indexes = {};
  for (const [, name] of schema.filter(r => r[0] === 'index')) indexes[name] = digest(encoded(rows(db, `PRAGMA index_xinfo(${qi(name)})`)));
  const properties = {};
  for (const p of ['application_id', 'user_version', 'encoding', 'page_size', 'auto_vacuum']) properties[p] = digest(encoded(rows(db, `PRAGMA ${p}`)));
  return { schema: digest(encoded(schema)), tables, indexes, properties };
}
let opened = [];
try {
  must(process.argv.length === 2 && process.version === 'v24.21.0' && process.versions.sqlite === '3.53.4');
  fs.cpSync('/inputs', ROOT, { recursive: true });
  const before = [ROOT + '/source/shooting-operations.sqlite', ROOT + '/reference/shooting-operations.sqlite'].map(p => hash(fs.readFileSync(p)));
  const db = new DatabaseSync(ROOT + '/source/shooting-operations.sqlite'); opened.push(db);
  db.exec('PRAGMA foreign_keys=ON'); must(assertKnownSchema(db).version === 6);
  const prefix = digest(encoded(rows(db, 'SELECT * FROM schema_migrations ORDER BY version')));
  const start = Date.now();
  initializeRuntimeWritableSchema(db);
  must(assertKnownSchema(db).version === 10);
  const rebuiltMarkers = markers(db);
  must(digest(encoded(rows(db, 'SELECT * FROM schema_migrations WHERE version<=6 ORDER BY version'))) === prefix);
  db.close(); opened = []; const end = Date.now();
  for (const r of rebuiltMarkers.slice(6)) must(Date.parse(r[3]) >= start && Date.parse(r[3]) <= end);
  // A fresh connection after explicit close establishes this replay's close boundary.
  const left = new DatabaseSync(ROOT + '/source/shooting-operations.sqlite', { readOnly: true }); opened.push(left);
  const right = new DatabaseSync(ROOT + '/reference/shooting-operations.sqlite'); opened.push(right);
  const referenceMarkers = markers(right);
  const a = snapshot(left), b = snapshot(right);
  must(JSON.stringify(a) === JSON.stringify(b));
  const timestamps = rebuiltMarkers.slice(6).map((r, i) => ({ version: i + 7, replaySha256: digest(r[3]), referenceSha256: digest(referenceMarkers[i + 6][3]), equal: r[3] === referenceMarkers[i + 6][3] }));
  for (const d of opened) d.close(); opened = [];
  console.log(JSON.stringify({ status: 'LIMITED_RECONSTRUCTION_EVIDENCE', productionAdmission: false, historicalCoverageProven: false, livePreservedBound: false, originalHeaderChangedByTool: false, migration11Count: 0, explicitCloseAndReopen: true, inputMainSha256: before, comparisonSha256: digest(a), tables: Object.values(a.tables).map(t => ({ count: t.count, rowsSha256: t.rows })), declaredTimestampDifferences: timestamps, runtime: { node: process.version, sqlite: process.versions.sqlite }, replayWindow: { start, end } }));
} catch {
  for (const d of opened) { try { d.close(); } catch {} }
  console.log(JSON.stringify({ status: 'RECONSTRUCTION_REJECTED', productionAdmission: false })); process.exitCode = 2;
}
