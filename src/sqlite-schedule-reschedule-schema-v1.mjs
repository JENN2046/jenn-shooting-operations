// Included only by the append-only schema 11 migration.
export const SCHEDULE_RESCHEDULE_SCHEMA_SQL = `
  CREATE TABLE schedule_reschedule_operations (
    operation_id TEXT PRIMARY KEY,
    schedule_item_id TEXT NOT NULL REFERENCES schedule_items(id) ON DELETE RESTRICT,
    resource_id TEXT NOT NULL REFERENCES scheduling_resources(resource_id) ON DELETE RESTRICT,
    actor_id TEXT NOT NULL,
    command_digest TEXT NOT NULL CHECK (length(command_digest) = 71 AND substr(command_digest, 1, 7) = 'sha256:'),
    command_json TEXT NOT NULL CHECK (json_valid(command_json)),
    receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
    receipt_digest TEXT NOT NULL CHECK (length(receipt_digest) = 71 AND substr(receipt_digest, 1, 7) = 'sha256:'),
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TRIGGER schedule_reschedule_operations_no_replace BEFORE INSERT ON schedule_reschedule_operations
  WHEN EXISTS (SELECT 1 FROM schedule_reschedule_operations WHERE operation_id = NEW.operation_id)
  BEGIN SELECT RAISE(ABORT, 'reschedule receipt immutable'); END;
  CREATE TRIGGER schedule_reschedule_operations_no_update BEFORE UPDATE ON schedule_reschedule_operations
  BEGIN SELECT RAISE(ABORT, 'reschedule receipt immutable'); END;
  CREATE TRIGGER schedule_reschedule_operations_no_delete BEFORE DELETE ON schedule_reschedule_operations
  BEGIN SELECT RAISE(ABORT, 'reschedule receipt immutable'); END;
`;
