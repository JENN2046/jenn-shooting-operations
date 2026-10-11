// Shared legacy seed only. Normalized counters/projections are initialized separately.
export function seedEmptyLegacyState(db, now) {
  if (db.prepare('SELECT id FROM schedule_state WHERE id=1').get()) return;
  const at=now.toISOString();
  const snapshot={schemaVersion:1,revision:0,updatedAt:at,products:[],tasks:[],sessions:[]};
  db.prepare('INSERT INTO schedule_state (id,revision,updated_at,snapshot_json) VALUES (1,0,?,?)').run(at,JSON.stringify(snapshot));
}
