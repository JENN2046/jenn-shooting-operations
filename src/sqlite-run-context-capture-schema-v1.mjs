export const RUN_CONTEXT_CAPTURE_SCHEMA_SQL = `
  CREATE TABLE scheduling_run_context_snapshots (
    run_id TEXT PRIMARY KEY REFERENCES production_runs(id) ON DELETE RESTRICT,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    context_status TEXT NOT NULL CHECK (context_status IN ('complete', 'ineligible')),
    snapshot_json TEXT NOT NULL,
    snapshot_digest TEXT NOT NULL,
    captured_at TEXT NOT NULL
  ) STRICT;

  CREATE TRIGGER scheduling_run_context_snapshots_no_update
  BEFORE UPDATE ON scheduling_run_context_snapshots
  BEGIN
    SELECT RAISE(ABORT, 'scheduling run context snapshots are immutable');
  END;

  CREATE TRIGGER scheduling_run_context_snapshots_no_delete
  BEFORE DELETE ON scheduling_run_context_snapshots
  BEGIN
    SELECT RAISE(ABORT, 'scheduling run context snapshots cannot be deleted');
  END;
`;
