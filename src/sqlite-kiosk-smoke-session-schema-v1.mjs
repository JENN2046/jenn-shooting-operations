// Append-only v9. A committed runtime owner is never transferred on restart.
export const KIOSK_SMOKE_SESSION_SCHEMA_SQL = `
  CREATE TABLE kiosk_smoke_runtime_session (
    id INTEGER PRIMARY KEY CHECK (id = 1), session_id TEXT NOT NULL
  ) STRICT;
  CREATE TRIGGER kiosk_smoke_runtime_session_no_update BEFORE UPDATE ON kiosk_smoke_runtime_session
  BEGIN SELECT RAISE(ABORT, 'Kiosk smoke runtime ownership is immutable'); END;
  CREATE TRIGGER kiosk_smoke_runtime_session_no_delete BEFORE DELETE ON kiosk_smoke_runtime_session
  BEGIN SELECT RAISE(ABORT, 'Kiosk smoke runtime ownership is permanent'); END;
  CREATE TRIGGER kiosk_smoke_runtime_session_no_replace BEFORE INSERT ON kiosk_smoke_runtime_session
  WHEN EXISTS (SELECT 1 FROM kiosk_smoke_runtime_session WHERE id = NEW.id)
  BEGIN SELECT RAISE(ABORT, 'Kiosk smoke runtime ownership cannot be replaced'); END;
`;
