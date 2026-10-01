// Append-only migration10: no business initialization at startup.
export const EMPTY_DB_MAINTENANCE_SCHEMA_SQL = `
  CREATE TABLE empty_db_initialization (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    operation_id TEXT NOT NULL UNIQUE,
    packet_digest TEXT NOT NULL,
    binding_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    response_digest TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE empty_db_maintenance_operations (
    operation_id TEXT PRIMARY KEY,
    initialization_id INTEGER NOT NULL REFERENCES empty_db_initialization(id) ON DELETE RESTRICT CHECK (initialization_id = 1),
    packet_digest TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('registerResource', 'publishConfig', 'activateConfig')),
    response_json TEXT NOT NULL,
    response_digest TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TRIGGER empty_db_initialization_no_update BEFORE UPDATE ON empty_db_initialization
  BEGIN SELECT RAISE(ABORT, 'empty DB initialization is immutable'); END;
  CREATE TRIGGER empty_db_initialization_no_delete BEFORE DELETE ON empty_db_initialization
  BEGIN SELECT RAISE(ABORT, 'empty DB initialization cannot be deleted'); END;
  CREATE TRIGGER empty_db_initialization_no_replace BEFORE INSERT ON empty_db_initialization
  WHEN EXISTS (SELECT 1 FROM empty_db_initialization)
  BEGIN SELECT RAISE(ABORT, 'empty DB initialization already sealed'); END;
  CREATE TRIGGER empty_db_maintenance_no_update BEFORE UPDATE ON empty_db_maintenance_operations
  BEGIN SELECT RAISE(ABORT, 'empty DB maintenance receipts are immutable'); END;
  CREATE TRIGGER empty_db_maintenance_no_delete BEFORE DELETE ON empty_db_maintenance_operations
  BEGIN SELECT RAISE(ABORT, 'empty DB maintenance receipts cannot be deleted'); END;
  CREATE TRIGGER empty_db_maintenance_no_replace BEFORE INSERT ON empty_db_maintenance_operations
  WHEN EXISTS (SELECT 1 FROM empty_db_maintenance_operations WHERE operation_id = NEW.operation_id)
  BEGIN SELECT RAISE(ABORT, 'empty DB maintenance operation already sealed'); END;
`;
