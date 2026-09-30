// Append-only migration v7. Historical migration checksums remain unchanged.
export const GF15_SCHEMA_SQL = `
  CREATE TABLE gf15_scheduling_leases (
    token TEXT PRIMARY KEY,
    lease_id TEXT NOT NULL UNIQUE,
    owner TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('forward', 'rollback')),
    acquired_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    released_at TEXT,
    CHECK (expires_at > acquired_at)
  ) STRICT;
  CREATE UNIQUE INDEX gf15_one_scheduling_lease ON gf15_scheduling_leases((1))
    WHERE released_at IS NULL;
  CREATE TABLE gf15_control_receipts (
    receipt_id TEXT PRIMARY KEY,
    receipt_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE gf15_command_packets (
    packet_id TEXT PRIMARY KEY,
    command_json TEXT NOT NULL,
    command_digest TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE gf15_outbox_isolation (
    outbox_id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    decision_id TEXT NOT NULL CHECK (decision_id = 'PRODGF15-DECISION-R1'),
    intent_type TEXT NOT NULL CHECK (intent_type = 'schedule.confirmed.v1'),
    payload_digest TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TRIGGER gf15_control_receipts_no_update BEFORE UPDATE ON gf15_control_receipts
  BEGIN SELECT RAISE(ABORT, 'GF15 control receipts are immutable'); END;
  CREATE TRIGGER gf15_control_receipts_no_delete BEFORE DELETE ON gf15_control_receipts
  BEGIN SELECT RAISE(ABORT, 'GF15 control receipts cannot be deleted'); END;
  CREATE TRIGGER gf15_command_packets_no_update BEFORE UPDATE ON gf15_command_packets
  BEGIN SELECT RAISE(ABORT, 'GF15 command packets are immutable'); END;
  CREATE TRIGGER gf15_command_packets_no_delete BEFORE DELETE ON gf15_command_packets
  BEGIN SELECT RAISE(ABORT, 'GF15 command packets cannot be deleted'); END;
  CREATE TRIGGER gf15_outbox_isolation_no_update BEFORE UPDATE ON gf15_outbox_isolation
  BEGIN SELECT RAISE(ABORT, 'GF15 isolation is permanent'); END;
  CREATE TRIGGER gf15_outbox_isolation_no_delete BEFORE DELETE ON gf15_outbox_isolation
  BEGIN SELECT RAISE(ABORT, 'GF15 isolation is permanent'); END;
  CREATE TRIGGER gf15_scheduling_leases_no_delete BEFORE DELETE ON gf15_scheduling_leases
  BEGIN SELECT RAISE(ABORT, 'GF15 leases cannot be deleted'); END;
  CREATE TRIGGER gf15_scheduling_leases_insert_guard BEFORE INSERT ON gf15_scheduling_leases
  WHEN EXISTS (SELECT 1 FROM gf15_scheduling_leases WHERE token = NEW.token OR lease_id = NEW.lease_id)
    OR (NEW.released_at IS NULL AND EXISTS (SELECT 1 FROM gf15_scheduling_leases WHERE released_at IS NULL))
  BEGIN SELECT RAISE(ABORT, 'GF15 lease cannot replace existing ownership'); END;
  CREATE TRIGGER gf15_control_receipts_insert_guard BEFORE INSERT ON gf15_control_receipts
  WHEN EXISTS (SELECT 1 FROM gf15_control_receipts WHERE receipt_id = NEW.receipt_id)
  BEGIN SELECT RAISE(ABORT, 'GF15 control receipts are immutable'); END;
  CREATE TRIGGER gf15_command_packets_insert_guard BEFORE INSERT ON gf15_command_packets
  WHEN EXISTS (SELECT 1 FROM gf15_command_packets WHERE packet_id = NEW.packet_id)
  BEGIN SELECT RAISE(ABORT, 'GF15 command packets are immutable'); END;
  CREATE TRIGGER gf15_outbox_isolation_insert_guard BEFORE INSERT ON gf15_outbox_isolation
  WHEN EXISTS (SELECT 1 FROM gf15_outbox_isolation WHERE outbox_id = NEW.outbox_id)
  BEGIN SELECT RAISE(ABORT, 'GF15 isolation is permanent'); END;
  CREATE TRIGGER gf15_scheduling_leases_release_only BEFORE UPDATE ON gf15_scheduling_leases
  WHEN OLD.released_at IS NOT NULL OR NEW.released_at IS NULL
    OR NEW.token IS NOT OLD.token OR NEW.lease_id IS NOT OLD.lease_id
    OR NEW.owner IS NOT OLD.owner OR NEW.purpose IS NOT OLD.purpose
    OR NEW.acquired_at IS NOT OLD.acquired_at OR NEW.expires_at IS NOT OLD.expires_at
  BEGIN SELECT RAISE(ABORT, 'GF15 lease identity is immutable'); END;
`;
