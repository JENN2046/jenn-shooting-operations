// Included only by the append-only Schema 11 migration.
export const AGENT_GRANT_ATTEMPT_SCHEMA_SQL = `
  CREATE TABLE agent_grant_attempts (
    attempt_key TEXT PRIMARY KEY
      CHECK (length(attempt_key) = 71 AND substr(attempt_key, 1, 7) = 'sha256:'),
    approval_ref TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('adopt_proposal', 'reschedule')),
    command_digest TEXT NOT NULL
      CHECK (length(command_digest) = 71 AND substr(command_digest, 1, 7) = 'sha256:'),
    attempted_at TEXT NOT NULL
  ) STRICT;
  CREATE UNIQUE INDEX agent_grant_attempt_identity_uq
    ON agent_grant_attempts(approval_ref, subject_id, action, command_digest);
  CREATE TRIGGER agent_grant_attempts_no_replace BEFORE INSERT ON agent_grant_attempts
  WHEN EXISTS (SELECT 1 FROM agent_grant_attempts WHERE attempt_key = NEW.attempt_key)
  BEGIN SELECT RAISE(ABORT, 'agent grant attempt immutable'); END;
  CREATE TRIGGER agent_grant_attempts_no_update BEFORE UPDATE ON agent_grant_attempts
  BEGIN SELECT RAISE(ABORT, 'agent grant attempt immutable'); END;
  CREATE TRIGGER agent_grant_attempts_no_delete BEFORE DELETE ON agent_grant_attempts
  BEGIN SELECT RAISE(ABORT, 'agent grant attempt immutable'); END;
`;
