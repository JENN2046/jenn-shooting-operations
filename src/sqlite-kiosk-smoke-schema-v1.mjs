// Append-only v8: these control facts cannot grant normal production authority.
const immutable = table => `
  CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
  BEGIN SELECT RAISE(ABORT, 'Kiosk smoke evidence is immutable'); END;
  CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
  BEGIN SELECT RAISE(ABORT, 'Kiosk smoke evidence is permanent'); END;
  CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table}
  WHEN EXISTS (SELECT 1 FROM ${table} WHERE id = NEW.id${table === 'kiosk_smoke_phases' ? ' OR event_id = NEW.event_id' : ''})
  BEGIN SELECT RAISE(ABORT, 'Kiosk smoke evidence cannot be replaced'); END;
`;
export const KIOSK_SMOKE_SCHEMA_SQL = `
  CREATE TABLE kiosk_smoke_binding (
    id INTEGER PRIMARY KEY CHECK (id = 1), binding_json TEXT NOT NULL
  ) STRICT;
  CREATE TABLE kiosk_smoke_phases (
    id INTEGER PRIMARY KEY CHECK (id IN (0, 1)),
    run_id TEXT NOT NULL, event_id TEXT NOT NULL UNIQUE,
    command_digest TEXT NOT NULL, command_json TEXT NOT NULL, received_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE kiosk_smoke_stop (
    id INTEGER PRIMARY KEY CHECK (id = 1), reason TEXT NOT NULL
  ) STRICT;
  CREATE TABLE kiosk_smoke_outbox_isolation (
    id TEXT PRIMARY KEY, intent_type TEXT NOT NULL
      CHECK (intent_type = 'production-run.completed.v1'),
    payload_digest TEXT NOT NULL
  ) STRICT;
  ${['kiosk_smoke_binding', 'kiosk_smoke_phases', 'kiosk_smoke_stop', 'kiosk_smoke_outbox_isolation'].map(immutable).join('\n')}
`;
