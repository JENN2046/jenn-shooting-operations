// Append-only migration v5. No historical migration body is changed by this file.
export const SCHEDULING_SCHEMA_SQL = `
  CREATE TABLE scheduling_resources (
    resource_id TEXT PRIMARY KEY,
    v1_display_place TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    capability_json TEXT NOT NULL,
    capability_digest TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_operation_id TEXT NOT NULL UNIQUE
  ) STRICT;

  CREATE TABLE scheduling_admin_operations (
    operation_id TEXT PRIMARY KEY,
    command_digest TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('registerResource', 'replaceResource',
      'publishConfig', 'activateConfig', 'setRequestRequirements')),
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE scheduling_request_requirements (
    request_id TEXT PRIMARY KEY REFERENCES requests_v2(id) ON DELETE RESTRICT,
    required_capability_ids_json TEXT NOT NULL,
    duration_estimate_json TEXT,
    updated_at TEXT NOT NULL,
    source_operation_id TEXT NOT NULL UNIQUE
  ) STRICT;

  CREATE TABLE scheduling_config_versions (
    config_version TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    algorithm_version TEXT NOT NULL,
    calendar_compiler_version TEXT NOT NULL,
    estimate_policy_version TEXT NOT NULL,
    config_json TEXT NOT NULL,
    config_digest TEXT NOT NULL,
    published_by TEXT NOT NULL,
    published_at TEXT NOT NULL,
    publish_operation_id TEXT NOT NULL UNIQUE
  ) STRICT;

  CREATE TABLE scheduling_active_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    config_version TEXT NOT NULL REFERENCES scheduling_config_versions(config_version) ON DELETE RESTRICT,
    activated_at TEXT NOT NULL,
    activation_operation_id TEXT NOT NULL,
    projection_revision INTEGER NOT NULL CHECK (projection_revision >= 0)
  ) STRICT;

  CREATE TABLE scheduling_config_activations (
    operation_id TEXT PRIMARY KEY,
    command_digest TEXT NOT NULL,
    previous_config_version TEXT REFERENCES scheduling_config_versions(config_version) ON DELETE RESTRICT,
    config_version TEXT NOT NULL REFERENCES scheduling_config_versions(config_version) ON DELETE RESTRICT,
    projection_revision INTEGER NOT NULL CHECK (projection_revision >= 0),
    activated_at TEXT NOT NULL,
    activated_by TEXT NOT NULL
  ) STRICT;

  CREATE TABLE scheduling_proposals (
    proposal_id TEXT PRIMARY KEY,
    proposal_json TEXT NOT NULL,
    generation_operation_id TEXT NOT NULL UNIQUE,
    generation_command_digest TEXT NOT NULL,
    input_digest TEXT NOT NULL,
    result_digest TEXT NOT NULL,
    base_schedule_revision INTEGER NOT NULL CHECK (base_schedule_revision >= 0),
    config_version TEXT NOT NULL REFERENCES scheduling_config_versions(config_version) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('draft', 'accepted', 'partiallyAccepted', 'rejected', 'stale')),
    terminal_decision_id TEXT UNIQUE,
    created_at TEXT NOT NULL,
    lifecycle_updated_at TEXT NOT NULL,
    CHECK ((status = 'draft') = (terminal_decision_id IS NULL))
  ) STRICT;

  CREATE INDEX scheduling_proposals_status_created_idx
    ON scheduling_proposals(status, created_at, proposal_id);

  CREATE TABLE scheduling_proposal_decisions (
    decision_id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL UNIQUE REFERENCES scheduling_proposals(proposal_id) ON DELETE RESTRICT,
    decision_command_digest TEXT NOT NULL,
    decision_type TEXT NOT NULL CHECK (decision_type IN ('accept', 'partiallyAccept', 'reject', 'stale')),
    receipt_json TEXT NOT NULL,
    receipt_digest TEXT NOT NULL,
    decided_at TEXT NOT NULL
  ) STRICT;

  CREATE TRIGGER scheduling_resources_no_delete BEFORE DELETE ON scheduling_resources
  BEGIN SELECT RAISE(ABORT, 'scheduling resources cannot be deleted'); END;
  CREATE TRIGGER scheduling_admin_operations_no_update BEFORE UPDATE ON scheduling_admin_operations
  BEGIN SELECT RAISE(ABORT, 'scheduling admin operations are immutable'); END;
  CREATE TRIGGER scheduling_admin_operations_no_delete BEFORE DELETE ON scheduling_admin_operations
  BEGIN SELECT RAISE(ABORT, 'scheduling admin operations cannot be deleted'); END;

  CREATE TRIGGER scheduling_config_versions_no_update BEFORE UPDATE ON scheduling_config_versions
  BEGIN SELECT RAISE(ABORT, 'scheduling config versions are immutable'); END;
  CREATE TRIGGER scheduling_config_versions_no_delete BEFORE DELETE ON scheduling_config_versions
  BEGIN SELECT RAISE(ABORT, 'scheduling config versions cannot be deleted'); END;
  CREATE TRIGGER scheduling_active_config_no_delete BEFORE DELETE ON scheduling_active_config
  BEGIN SELECT RAISE(ABORT, 'active scheduling config cannot be deleted'); END;
  CREATE TRIGGER scheduling_config_activations_no_update BEFORE UPDATE ON scheduling_config_activations
  BEGIN SELECT RAISE(ABORT, 'scheduling config activations are immutable'); END;
  CREATE TRIGGER scheduling_config_activations_no_delete BEFORE DELETE ON scheduling_config_activations
  BEGIN SELECT RAISE(ABORT, 'scheduling config activations cannot be deleted'); END;

  CREATE TRIGGER scheduling_proposals_content_immutable
  BEFORE UPDATE OF proposal_json, generation_operation_id, generation_command_digest,
    input_digest, result_digest, base_schedule_revision, config_version, created_at
  ON scheduling_proposals
  BEGIN SELECT RAISE(ABORT, 'scheduling proposal content is immutable'); END;
  CREATE TRIGGER scheduling_proposals_terminal_sealed BEFORE UPDATE ON scheduling_proposals
  WHEN OLD.status <> 'draft'
  BEGIN SELECT RAISE(ABORT, 'terminal scheduling proposal is sealed'); END;
  CREATE TRIGGER scheduling_proposals_transition_guard BEFORE UPDATE ON scheduling_proposals
  WHEN NEW.status = 'draft' OR NEW.terminal_decision_id IS NULL
    OR NEW.lifecycle_updated_at < OLD.lifecycle_updated_at
    OR NOT EXISTS (
      SELECT 1 FROM scheduling_proposal_decisions AS decision
      WHERE decision.decision_id = NEW.terminal_decision_id
        AND decision.proposal_id = OLD.proposal_id
        AND ((decision.decision_type = 'accept' AND NEW.status = 'accepted')
          OR (decision.decision_type = 'partiallyAccept' AND NEW.status = 'partiallyAccepted')
          OR (decision.decision_type = 'reject' AND NEW.status = 'rejected')
          OR (decision.decision_type = 'stale' AND NEW.status = 'stale'))
    )
  BEGIN SELECT RAISE(ABORT, 'invalid scheduling proposal transition'); END;
  CREATE TRIGGER scheduling_proposals_no_delete BEFORE DELETE ON scheduling_proposals
  BEGIN SELECT RAISE(ABORT, 'scheduling proposals cannot be deleted'); END;
  CREATE TRIGGER scheduling_proposal_decisions_no_update BEFORE UPDATE ON scheduling_proposal_decisions
  BEGIN SELECT RAISE(ABORT, 'scheduling decisions are immutable'); END;
  CREATE TRIGGER scheduling_proposal_decisions_no_delete BEFORE DELETE ON scheduling_proposal_decisions
  BEGIN SELECT RAISE(ABORT, 'scheduling decisions cannot be deleted'); END;
`;
