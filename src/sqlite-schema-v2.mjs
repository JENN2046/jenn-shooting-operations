import { createHash } from 'node:crypto';
import { SCHEDULING_SCHEMA_SQL } from './sqlite-scheduling-schema-v1.mjs';
import { RUN_CONTEXT_CAPTURE_SCHEMA_SQL } from './sqlite-run-context-capture-schema-v1.mjs';

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

export const V1_SCHEMA_SQL = `
  CREATE TABLE schedule_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    snapshot_json TEXT NOT NULL
  );
  CREATE TABLE operations (
    operation_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    role TEXT NOT NULL,
    entity_id TEXT,
    revision INTEGER NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE uploads (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    original_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    stored_name TEXT,
    claimed_task_id TEXT,
    created_at TEXT NOT NULL
  );
`;

const V2_CORE_SQL = `
  CREATE TABLE migration_batches (
    id TEXT PRIMARY KEY,
    identity_digest TEXT NOT NULL UNIQUE,
    migration_version TEXT NOT NULL,
    mapping_version TEXT NOT NULL,
    source_schema_version INTEGER NOT NULL CHECK (source_schema_version > 0),
    source_revision INTEGER NOT NULL CHECK (source_revision BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
    source_schema_digest TEXT NOT NULL,
    source_structural_digest TEXT NOT NULL,
    configuration_digest TEXT NOT NULL,
    resource_map_version TEXT,
    resource_map_digest TEXT,
    business_time_zone TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('applying', 'completed', 'failed')),
    started_at TEXT NOT NULL,
    completed_at TEXT
  ) STRICT;

  CREATE TABLE revision_counters (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    projection_revision INTEGER NOT NULL CHECK (projection_revision BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
    schedule_revision INTEGER NOT NULL CHECK (schedule_revision BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE product_catalog_entries (
    id TEXT PRIMARY KEY,
    display_order INTEGER NOT NULL UNIQUE CHECK (display_order >= 0),
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('migration', 'domain_command')),
    migration_batch_id TEXT REFERENCES migration_batches(id) ON DELETE RESTRICT,
    imported_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE requests_v2 (
    id TEXT PRIMARY KEY,
    source_ordinal INTEGER NOT NULL UNIQUE CHECK (source_ordinal >= 0),
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    client TEXT NOT NULL,
    legacy_deliver_text TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('模特', '细节', '场景', '待定')),
    legacy_v1_status TEXT CHECK (legacy_v1_status IN ('pending', 'scheduled', 'completed', 'cancelled')),
    v1_status_mode TEXT NOT NULL CHECK (v1_status_mode IN ('legacy_exact', 'legacy_omitted', 'canonical')),
    request_lifecycle TEXT CHECK (request_lifecycle IN ('open', 'fulfilled', 'cancelled')),
    lifecycle_provenance TEXT NOT NULL CHECK (lifecycle_provenance IN ('legacy_snapshot', 'domain_command')),
    source TEXT NOT NULL CHECK (source IN ('workbench', 'submission', 'import')),
    business_created_at TEXT,
    business_updated_at TEXT,
    imported_at TEXT NOT NULL,
    v1_assets_present INTEGER NOT NULL CHECK (v1_assets_present IN (0, 1)),
    v1_request_present INTEGER NOT NULL CHECK (v1_request_present IN (0, 1)),
    production_type TEXT CHECK (production_type IN ('平面', '视频')),
    shooting_subtype TEXT,
    deliverable_count INTEGER CHECK (deliverable_count BETWEEN 1 AND 999),
    aspect_ratio TEXT CHECK (aspect_ratio IN ('待定', '1:1', '3:4', '4:5', '9:16', '16:9')),
    duration_seconds INTEGER CHECK (duration_seconds BETWEEN 1 AND 3600),
    audio_requirement TEXT CHECK (audio_requirement IN ('待定', '原声', '配音', '音乐', '无声')),
    requested_by TEXT,
    desired_date TEXT,
    note TEXT,
    source_operation_id TEXT UNIQUE REFERENCES operations(operation_id) ON DELETE RESTRICT,
    core_brief_summary TEXT,
    brief_url TEXT,
    hero_asset_id TEXT REFERENCES uploads(id) ON DELETE RESTRICT,
    sample_status TEXT CHECK (sample_status IN ('arrivedVerified', 'inTransit', 'unavailable')),
    sample_shelf_id TEXT,
    lighting_preset TEXT NOT NULL,
    reflectivity TEXT NOT NULL CHECK (reflectivity IN ('unknown', 'low', 'medium', 'high')),
    priority TEXT CHECK (priority IN ('p0', 'p1', 'p2')),
    migration_batch_id TEXT REFERENCES migration_batches(id) ON DELETE RESTRICT,
    CHECK (
      (v1_status_mode = 'legacy_exact' AND legacy_v1_status IS NOT NULL
        AND request_lifecycle IS NOT NULL AND lifecycle_provenance = 'legacy_snapshot' AND (
        (legacy_v1_status IN ('pending', 'scheduled') AND request_lifecycle = 'open') OR
        (legacy_v1_status = 'completed' AND request_lifecycle = 'fulfilled') OR
        (legacy_v1_status = 'cancelled' AND request_lifecycle = 'cancelled')
      )) OR
      (v1_status_mode = 'legacy_omitted' AND legacy_v1_status IS NULL
        AND request_lifecycle IS NULL AND lifecycle_provenance = 'legacy_snapshot') OR
      (v1_status_mode = 'canonical' AND request_lifecycle IS NOT NULL
        AND lifecycle_provenance = 'domain_command')
    ),
    CHECK (
      (production_type IS NULL AND shooting_subtype IS NULL AND aspect_ratio IS NULL
        AND deliverable_count IS NULL AND duration_seconds IS NULL AND audio_requirement IS NULL) OR
      (production_type = '平面' AND shooting_subtype IS NOT NULL
        AND shooting_subtype IN ('模特', '细节', '场景', '待定')
        AND aspect_ratio IS NOT NULL AND deliverable_count IS NOT NULL
        AND duration_seconds IS NULL AND audio_requirement IS NULL) OR
      (production_type = '视频' AND shooting_subtype IS NOT NULL
        AND shooting_subtype IN ('产品展示', '人物展示', '产品加人物展示', '口播', '剧情短片', '场景视频')
        AND aspect_ratio IS NOT NULL AND deliverable_count IS NULL
        AND duration_seconds IS NOT NULL AND audio_requirement IS NOT NULL)
    )
  ) STRICT;

  CREATE INDEX requests_v2_lifecycle_idx ON requests_v2(request_lifecycle);
  CREATE INDEX requests_v2_desired_date_idx ON requests_v2(desired_date);

  CREATE TABLE schedule_items (
    id TEXT PRIMARY KEY,
    source_ordinal INTEGER NOT NULL UNIQUE CHECK (source_ordinal >= 0),
    resource_id TEXT,
    resource_resolution_status TEXT NOT NULL CHECK (resource_resolution_status IN ('resolved', 'unresolved')),
    resource_mapping_version TEXT,
    legacy_place_text TEXT,
    planned_start TEXT NOT NULL,
    planned_end TEXT NOT NULL,
    buffer_after_minutes INTEGER CHECK (buffer_after_minutes BETWEEN 0 AND 1440),
    buffer_source TEXT NOT NULL,
    schedule_status TEXT NOT NULL CHECK (schedule_status IN ('draft', 'confirmed', 'cancelled')),
    schedule_status_provenance TEXT NOT NULL CHECK (schedule_status_provenance IN ('legacy_snapshot', 'domain_command')),
    lock_status TEXT CHECK (lock_status IN ('unlocked', 'locked')),
    lock_status_provenance TEXT NOT NULL CHECK (lock_status_provenance IN ('legacy_unknown', 'domain_command')),
    note TEXT NOT NULL,
    allocation_mode TEXT NOT NULL CHECK (allocation_mode IN ('single', 'grouped_unallocated')),
    source TEXT NOT NULL CHECK (source IN ('human', 'agent_proposal', 'migration')),
    source_ref TEXT,
    business_created_at TEXT,
    business_updated_at TEXT,
    imported_at TEXT NOT NULL,
    migration_batch_id TEXT REFERENCES migration_batches(id) ON DELETE RESTRICT,
    CHECK (
      (resource_resolution_status = 'resolved' AND resource_id IS NOT NULL) OR
      (resource_resolution_status = 'unresolved' AND resource_id IS NULL)
    ),
    CHECK (source <> 'migration' OR (
      source_ref IS NOT NULL AND legacy_place_text IS NOT NULL AND migration_batch_id IS NOT NULL
    ))
  ) STRICT;

  CREATE INDEX schedule_items_status_resource_time_idx
    ON schedule_items(schedule_status, resource_id, planned_start, planned_end);
  CREATE INDEX schedule_items_confirmed_resource_time_idx
    ON schedule_items(resource_id, planned_start, planned_end)
    WHERE schedule_status = 'confirmed';

  CREATE TABLE schedule_item_tasks (
    schedule_item_id TEXT NOT NULL REFERENCES schedule_items(id) ON DELETE RESTRICT,
    task_id TEXT NOT NULL REFERENCES requests_v2(id) ON DELETE RESTRICT,
    display_order INTEGER NOT NULL CHECK (display_order >= 0),
    created_at TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    PRIMARY KEY (schedule_item_id, task_id),
    UNIQUE (schedule_item_id, display_order)
  ) STRICT;

  CREATE INDEX schedule_item_tasks_task_idx ON schedule_item_tasks(task_id, schedule_item_id);

  CREATE TABLE legacy_asset_entries (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES requests_v2(id) ON DELETE RESTRICT,
    display_order INTEGER NOT NULL CHECK (display_order >= 0),
    name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'attachment')),
    size INTEGER NOT NULL CHECK (size >= 0),
    sha256 TEXT NOT NULL,
    source TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    migration_batch_id TEXT NOT NULL REFERENCES migration_batches(id) ON DELETE RESTRICT,
    UNIQUE (request_id, display_order)
  ) STRICT;

  CREATE TABLE legacy_compat_fragments (
    id INTEGER PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('root', 'task', 'session', 'request', 'asset')),
    entity_id TEXT,
    json_pointer TEXT NOT NULL,
    value_json TEXT NOT NULL CHECK (json_valid(value_json)),
    value_digest TEXT NOT NULL,
    violation_code TEXT NOT NULL,
    classification TEXT NOT NULL CHECK (classification = 'L1_GRANDFATHERED_OPAQUE'),
    mapping_version TEXT NOT NULL,
    source_ordinal INTEGER NOT NULL UNIQUE CHECK (source_ordinal >= 0),
    migration_batch_id TEXT NOT NULL REFERENCES migration_batches(id) ON DELETE RESTRICT,
    CHECK (
      (entity_type = 'root' AND entity_id IS NULL) OR
      (entity_type <> 'root' AND entity_id IS NOT NULL)
    )
  ) STRICT;

  CREATE UNIQUE INDEX legacy_compat_fragments_identity_uq
    ON legacy_compat_fragments(entity_type, COALESCE(entity_id, ''), json_pointer);

  CREATE TABLE production_runs (
    id TEXT PRIMARY KEY,
    schedule_item_id TEXT NOT NULL REFERENCES schedule_items(id) ON DELETE RESTRICT,
    scope TEXT NOT NULL CHECK (scope IN ('task', 'block')),
    task_id TEXT REFERENCES requests_v2(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('scheduled', 'shooting', 'blocked', 'completed', 'cancelled')),
    run_revision INTEGER NOT NULL CHECK (run_revision BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
    started_at TEXT,
    completed_at TEXT,
    active_block_started_at TEXT,
    gross_duration_ms INTEGER CHECK (gross_duration_ms >= 0),
    blocked_duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (blocked_duration_ms >= 0),
    net_duration_ms INTEGER CHECK (net_duration_ms >= 0),
    metrics_algorithm_version TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (scope = 'task' AND task_id IS NOT NULL) OR
      (scope = 'block' AND task_id IS NULL)
    )
  ) STRICT;

  CREATE INDEX production_runs_schedule_item_idx ON production_runs(schedule_item_id, created_at);
  CREATE INDEX production_runs_task_idx ON production_runs(task_id, created_at) WHERE task_id IS NOT NULL;
  CREATE UNIQUE INDEX production_runs_one_active_per_item_uq
    ON production_runs(schedule_item_id)
    WHERE status IN ('scheduled', 'shooting', 'blocked');

  CREATE TABLE production_events (
    event_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES production_runs(id) ON DELETE RESTRICT,
    command_digest TEXT NOT NULL,
    response_digest TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('start', 'block', 'resume', 'complete', 'cancel')),
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    device_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    reason_code TEXT,
    note TEXT,
    previous_state TEXT NOT NULL CHECK (previous_state IN ('scheduled', 'shooting', 'blocked', 'completed', 'cancelled')),
    resulting_state TEXT NOT NULL CHECK (resulting_state IN ('scheduled', 'shooting', 'blocked', 'completed', 'cancelled')),
    resulting_run_revision INTEGER NOT NULL CHECK (resulting_run_revision BETWEEN 1 AND ${MAX_SAFE_INTEGER}),
    resulting_projection_revision INTEGER NOT NULL CHECK (resulting_projection_revision BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
    resulting_schedule_revision INTEGER NOT NULL CHECK (resulting_schedule_revision BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
    UNIQUE (run_id, resulting_run_revision)
  ) STRICT;

  CREATE INDEX production_events_run_occurred_idx ON production_events(run_id, occurred_at);

  CREATE TRIGGER production_events_no_update
  BEFORE UPDATE ON production_events
  BEGIN
    SELECT RAISE(ABORT, 'production_events are append-only');
  END;

  CREATE TRIGGER production_events_no_delete
  BEFORE DELETE ON production_events
  BEGIN
    SELECT RAISE(ABORT, 'production_events are append-only');
  END;

  CREATE TABLE snapshot_projections (
    projection_name TEXT PRIMARY KEY CHECK (projection_name IN ('schedule-v1-compat', 'schedule-v2')),
    schema_version INTEGER NOT NULL CHECK (schema_version IN (1, 2)),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
    schedule_revision INTEGER CHECK (schedule_revision BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
    updated_at TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    source_schema_version INTEGER NOT NULL CHECK (source_schema_version > 0),
    CHECK (
      (projection_name = 'schedule-v1-compat' AND schema_version = 1 AND schedule_revision IS NULL) OR
      (projection_name = 'schedule-v2' AND schema_version = 2 AND schedule_revision IS NOT NULL)
    )
  ) STRICT;

  CREATE TRIGGER revision_counters_no_decrease
  BEFORE UPDATE ON revision_counters
  WHEN NEW.projection_revision < OLD.projection_revision
    OR NEW.schedule_revision < OLD.schedule_revision
  BEGIN
    SELECT RAISE(ABORT, 'revision counters cannot decrease');
  END;
`;

const V1_COMPATIBILITY_SQL = `
  ALTER TABLE uploads ADD COLUMN claimed_order INTEGER
    CHECK (claimed_order IS NULL OR claimed_order >= 0);
  ALTER TABLE operations ADD COLUMN request_digest TEXT;
  CREATE INDEX uploads_claimed_task_idx ON uploads(claimed_task_id);
  CREATE UNIQUE INDEX uploads_claimed_order_uq
    ON uploads(claimed_task_id, claimed_order)
    WHERE claimed_task_id IS NOT NULL AND claimed_order IS NOT NULL;
`;

const KIOSK_REVIEW_SQL = `
  CREATE TABLE run_event_id_owners (
    event_id TEXT PRIMARY KEY
      REFERENCES operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
    owner_kind TEXT NOT NULL CHECK (owner_kind IN ('accepted', 'review')),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE run_event_reviews (
    event_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    schedule_item_id TEXT NOT NULL REFERENCES schedule_items(id) ON DELETE RESTRICT,
    command_digest TEXT NOT NULL,
    response_digest TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('start', 'block', 'resume', 'complete')),
    expected_run_revision INTEGER NOT NULL
      CHECK (expected_run_revision BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    device_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_role TEXT NOT NULL CHECK (actor_role IN ('operator', 'scheduler', 'administrator')),
    reason_code TEXT CHECK (reason_code IN (
      'sampleWaiting', 'specConfirming', 'deviceIssue', 'talentWaiting', 'siteIssue', 'other'
    )),
    note TEXT,
    time_policy_version TEXT NOT NULL CHECK (time_policy_version = 'kiosk-event-time-local-v1'),
    review_reason TEXT NOT NULL CHECK (review_reason IN ('tooFarFuture', 'tooOld')),
    review_status TEXT NOT NULL CHECK (review_status = 'pending'),
    response_json TEXT NOT NULL CHECK (json_valid(response_json)),
    created_at TEXT NOT NULL,
    CHECK (
      (event_type = 'block' AND reason_code IS NOT NULL) OR
      (event_type <> 'block' AND reason_code IS NULL)
    ),
    CHECK (reason_code <> 'other' OR (note IS NOT NULL AND length(trim(note)) > 0))
  ) STRICT;

  CREATE INDEX run_event_reviews_run_created_idx
    ON run_event_reviews(run_id, created_at);
  CREATE INDEX run_event_reviews_pending_created_idx
    ON run_event_reviews(review_status, created_at);

  CREATE TRIGGER production_events_no_replace
  BEFORE INSERT ON production_events
  WHEN EXISTS (
    SELECT 1 FROM production_events
    WHERE event_id = NEW.event_id
       OR (run_id = NEW.run_id AND resulting_run_revision = NEW.resulting_run_revision)
  )
  BEGIN
    SELECT RAISE(ABORT, 'production_events are append-only');
  END;

  CREATE TRIGGER run_event_reviews_no_replace
  BEFORE INSERT ON run_event_reviews
  WHEN EXISTS (
    SELECT 1 FROM run_event_reviews WHERE event_id = NEW.event_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'run event reviews are append-only');
  END;

  CREATE TRIGGER run_event_id_owners_no_replace
  BEFORE INSERT ON run_event_id_owners
  WHEN EXISTS (
    SELECT 1 FROM run_event_id_owners WHERE event_id = NEW.event_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'run event id ownership is immutable');
  END;

  CREATE TRIGGER operations_no_replace_owned_run_event
  BEFORE INSERT ON operations
  WHEN EXISTS (
    SELECT 1 FROM run_event_id_owners WHERE event_id = NEW.operation_id
  ) AND EXISTS (
    SELECT 1 FROM operations WHERE operation_id = NEW.operation_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'run event operation is immutable');
  END;

  CREATE TRIGGER run_event_id_owners_validate_insert
  BEFORE INSERT ON run_event_id_owners
  BEGIN
    SELECT RAISE(ABORT, 'accepted event owner requires an accepted event')
    WHERE NEW.owner_kind = 'accepted'
      AND NOT EXISTS (SELECT 1 FROM production_events WHERE event_id = NEW.event_id);
    SELECT RAISE(ABORT, 'review owner requires a review fact')
    WHERE NEW.owner_kind = 'review'
      AND NOT EXISTS (SELECT 1 FROM run_event_reviews WHERE event_id = NEW.event_id);
    SELECT RAISE(ABORT, 'run event id ownership conflict')
    WHERE NEW.owner_kind = 'accepted' AND EXISTS (
      SELECT 1 FROM run_event_reviews WHERE event_id = NEW.event_id
    );
    SELECT RAISE(ABORT, 'run event id ownership conflict')
    WHERE NEW.owner_kind = 'review' AND EXISTS (
      SELECT 1 FROM production_events WHERE event_id = NEW.event_id
    );
    SELECT RAISE(ABORT, 'run event operation ownership conflict')
    WHERE NEW.owner_kind = 'accepted' AND EXISTS (
      SELECT 1 FROM operations
      WHERE operation_id = NEW.event_id
        AND kind <> 'production.run-event'
    );
    SELECT RAISE(ABORT, 'run event operation ownership conflict')
    WHERE NEW.owner_kind = 'review' AND EXISTS (
      SELECT 1 FROM operations
      WHERE operation_id = NEW.event_id
        AND kind <> 'production.run-event-review'
    );
  END;

  CREATE TRIGGER production_events_claim_event_id
  AFTER INSERT ON production_events
  BEGIN
    INSERT INTO run_event_id_owners (event_id, owner_kind, created_at)
    VALUES (NEW.event_id, 'accepted', NEW.received_at);
  END;

  CREATE TRIGGER run_event_reviews_claim_event_id
  AFTER INSERT ON run_event_reviews
  BEGIN
    INSERT INTO run_event_id_owners (event_id, owner_kind, created_at)
    VALUES (NEW.event_id, 'review', NEW.created_at);
  END;

  CREATE TRIGGER run_event_id_owners_no_update
  BEFORE UPDATE ON run_event_id_owners
  BEGIN
    SELECT RAISE(ABORT, 'run event id ownership is immutable');
  END;

  CREATE TRIGGER run_event_id_owners_no_delete
  BEFORE DELETE ON run_event_id_owners
  BEGIN
    SELECT RAISE(ABORT, 'run event id ownership is immutable');
  END;

  CREATE TRIGGER run_event_reviews_no_update
  BEFORE UPDATE ON run_event_reviews
  BEGIN
    SELECT RAISE(ABORT, 'run event reviews are append-only');
  END;

  CREATE TRIGGER run_event_reviews_no_delete
  BEFORE DELETE ON run_event_reviews
  BEGIN
    SELECT RAISE(ABORT, 'run event reviews are append-only');
  END;

  CREATE TRIGGER operations_validate_run_event_owner_insert
  BEFORE INSERT ON operations
  WHEN
    (NEW.kind = 'production.run-event' AND (
      NOT EXISTS (SELECT 1 FROM production_events WHERE event_id = NEW.operation_id) OR
      NOT EXISTS (
        SELECT 1 FROM run_event_id_owners
        WHERE event_id = NEW.operation_id AND owner_kind = 'accepted'
      )
    )) OR
    (NEW.kind = 'production.run-event-review' AND (
      NOT EXISTS (SELECT 1 FROM run_event_reviews WHERE event_id = NEW.operation_id) OR
      NOT EXISTS (
        SELECT 1 FROM run_event_id_owners
        WHERE event_id = NEW.operation_id AND owner_kind = 'review'
      )
    )) OR
    (NEW.kind NOT IN ('production.run-event', 'production.run-event-review') AND EXISTS (
      SELECT 1 FROM run_event_id_owners WHERE event_id = NEW.operation_id
    ))
  BEGIN
    SELECT RAISE(ABORT, 'run event operation ownership conflict');
  END;

  CREATE TRIGGER operations_protect_run_event_owner_update
  BEFORE UPDATE ON operations
  WHEN EXISTS (
    SELECT 1 FROM run_event_id_owners WHERE event_id = OLD.operation_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'run event operation is immutable');
  END;

  CREATE TRIGGER operations_validate_run_event_owner_update
  BEFORE UPDATE ON operations
  WHEN
    OLD.kind IN ('production.run-event', 'production.run-event-review') OR
    NEW.kind IN ('production.run-event', 'production.run-event-review') OR
    EXISTS (SELECT 1 FROM run_event_id_owners WHERE event_id = OLD.operation_id) OR
    EXISTS (SELECT 1 FROM run_event_id_owners WHERE event_id = NEW.operation_id)
  BEGIN
    SELECT RAISE(ABORT, 'run event operation ownership conflict');
  END;

  CREATE TRIGGER operations_protect_run_event_owner_delete
  BEFORE DELETE ON operations
  WHEN EXISTS (
    SELECT 1 FROM run_event_id_owners WHERE event_id = OLD.operation_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'run event operation ownership is immutable');
  END;

  INSERT INTO run_event_id_owners (event_id, owner_kind, created_at)
  SELECT event_id, 'accepted', received_at
  FROM production_events
  ORDER BY event_id;

  INSERT INTO run_event_id_owners (event_id, owner_kind, created_at)
  SELECT operation_id, 'accepted', created_at
  FROM operations
  WHERE kind = 'production.run-event'
    AND NOT EXISTS (
      SELECT 1 FROM run_event_id_owners AS owner
      WHERE owner.event_id = operations.operation_id
    );

  INSERT INTO run_event_id_owners (event_id, owner_kind, created_at)
  SELECT operation_id, 'review', created_at
  FROM operations
  WHERE kind = 'production.run-event-review'
    AND NOT EXISTS (
      SELECT 1 FROM run_event_id_owners AS owner
      WHERE owner.event_id = operations.operation_id
    );
`;

const NOTIFICATION_OUTBOX_SQL = `
  CREATE TABLE notification_outbox (
    outbox_id TEXT PRIMARY KEY,
    channel TEXT NOT NULL CHECK (channel = 'dingtalk'),
    dedupe_key TEXT NOT NULL UNIQUE,
    intent_type TEXT NOT NULL CHECK (intent_type IN (
      'schedule.confirmed.v1', 'production-run.completed.v1'
    )),
    aggregate_type TEXT NOT NULL CHECK (aggregate_type IN (
      'schedule_item', 'production_run'
    )),
    aggregate_id TEXT NOT NULL,
    aggregate_revision_scope TEXT NOT NULL CHECK (aggregate_revision_scope IN ('schedule', 'run')),
    aggregate_revision INTEGER NOT NULL
      CHECK (aggregate_revision BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
    route_key TEXT NOT NULL,
    card_schema_version TEXT NOT NULL,
    delivery_policy_version TEXT NOT NULL CHECK (delivery_policy_version = 'outbox-dispatch-v1'),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    payload_digest TEXT NOT NULL CHECK (
      length(payload_digest) = 71
      AND substr(payload_digest, 1, 7) = 'sha256:'
      AND substr(payload_digest, 8) NOT GLOB '*[^0-9a-f]*'
    ),
    status TEXT NOT NULL CHECK (status IN (
      'pending', 'leased', 'sent', 'retryableFailed', 'deadLetter'
    )),
    attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 0 AND 5),
    available_at TEXT,
    lease_token TEXT,
    lease_owner TEXT,
    lease_expires_at TEXT,
    provider_ref TEXT CHECK (
      provider_ref IS NULL OR (
        length(provider_ref) BETWEEN 1 AND 512
        AND provider_ref NOT GLOB '*[^A-Za-z0-9._:/+=@-]*'
      )
    ),
    delivery_receipt_digest TEXT CHECK (
      delivery_receipt_digest IS NULL OR (
        length(delivery_receipt_digest) = 71
        AND substr(delivery_receipt_digest, 1, 7) = 'sha256:'
        AND substr(delivery_receipt_digest, 8) NOT GLOB '*[^0-9a-f]*'
      )
    ),
    last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code IN (
      'DINGTALK_TIMEOUT',
      'DINGTALK_RATE_LIMITED',
      'DINGTALK_UNAVAILABLE',
      'DINGTALK_TRANSPORT_ERROR',
      'DINGTALK_NOT_CONFIGURED',
      'DINGTALK_AUTH_REJECTED',
      'DINGTALK_REQUEST_REJECTED',
      'DINGTALK_RESPONSE_INVALID',
      'DINGTALK_ADAPTER_PROTOCOL_ERROR',
      'OUTBOX_DELIVERY_OUTCOME_UNKNOWN'
    )),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sent_at TEXT,
    CHECK (
      (intent_type = 'schedule.confirmed.v1'
        AND aggregate_type = 'schedule_item' AND aggregate_revision_scope = 'schedule')
      OR
      (intent_type = 'production-run.completed.v1'
        AND aggregate_type = 'production_run' AND aggregate_revision_scope = 'run')
    ),
    CHECK (
      (status = 'pending'
        AND attempt_count = 0
        AND available_at IS NOT NULL
        AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
        AND provider_ref IS NULL AND delivery_receipt_digest IS NULL
        AND last_error_code IS NULL AND sent_at IS NULL)
      OR
      (status = 'leased'
        AND attempt_count BETWEEN 1 AND 5
        AND available_at IS NULL
        AND lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL
        AND provider_ref IS NULL AND delivery_receipt_digest IS NULL
        AND last_error_code IS NULL AND sent_at IS NULL)
      OR
      (status = 'retryableFailed'
        AND attempt_count BETWEEN 1 AND 4
        AND available_at IS NOT NULL
        AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
        AND provider_ref IS NULL AND delivery_receipt_digest IS NULL AND sent_at IS NULL
        AND last_error_code IN (
          'DINGTALK_TIMEOUT', 'DINGTALK_RATE_LIMITED',
          'DINGTALK_UNAVAILABLE', 'DINGTALK_TRANSPORT_ERROR'
        ))
      OR
      (status = 'sent'
        AND attempt_count BETWEEN 1 AND 5
        AND available_at IS NULL
        AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
        AND provider_ref IS NOT NULL AND delivery_receipt_digest IS NOT NULL
        AND last_error_code IS NULL AND sent_at IS NOT NULL)
      OR
      (status = 'deadLetter'
        AND attempt_count BETWEEN 1 AND 5
        AND available_at IS NULL
        AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
        AND provider_ref IS NULL AND delivery_receipt_digest IS NULL
        AND last_error_code IS NOT NULL AND sent_at IS NULL)
    )
  ) STRICT;

  CREATE INDEX notification_outbox_dispatch_idx
    ON notification_outbox(status, available_at, created_at, outbox_id);
  CREATE INDEX notification_outbox_lease_idx
    ON notification_outbox(status, lease_expires_at);
  CREATE UNIQUE INDEX notification_outbox_provider_ref_uq
    ON notification_outbox(provider_ref) WHERE provider_ref IS NOT NULL;

  CREATE TRIGGER notification_outbox_insert_pending
  BEFORE INSERT ON notification_outbox
  WHEN NEW.status <> 'pending' OR NEW.attempt_count <> 0
  BEGIN
    SELECT RAISE(ABORT, 'notification outbox records must begin pending');
  END;

  CREATE TRIGGER notification_outbox_identity_immutable
  BEFORE UPDATE ON notification_outbox
  WHEN NEW.outbox_id IS NOT OLD.outbox_id
    OR NEW.channel IS NOT OLD.channel
    OR NEW.dedupe_key IS NOT OLD.dedupe_key
    OR NEW.intent_type IS NOT OLD.intent_type
    OR NEW.aggregate_type IS NOT OLD.aggregate_type
    OR NEW.aggregate_id IS NOT OLD.aggregate_id
    OR NEW.aggregate_revision_scope IS NOT OLD.aggregate_revision_scope
    OR NEW.aggregate_revision IS NOT OLD.aggregate_revision
    OR NEW.route_key IS NOT OLD.route_key
    OR NEW.card_schema_version IS NOT OLD.card_schema_version
    OR NEW.delivery_policy_version IS NOT OLD.delivery_policy_version
    OR NEW.payload_json IS NOT OLD.payload_json
    OR NEW.payload_digest IS NOT OLD.payload_digest
    OR NEW.created_at IS NOT OLD.created_at
  BEGIN
    SELECT RAISE(ABORT, 'notification outbox identity is immutable');
  END;

  CREATE TRIGGER notification_outbox_attempt_monotonic
  BEFORE UPDATE ON notification_outbox
  WHEN NEW.attempt_count < OLD.attempt_count
  BEGIN
    SELECT RAISE(ABORT, 'notification outbox attempt count cannot decrease');
  END;

  CREATE TRIGGER notification_outbox_transition_guard
  BEFORE UPDATE ON notification_outbox
  WHEN NOT (
    (OLD.status = 'pending' AND NEW.status = 'leased'
      AND OLD.attempt_count = 0 AND NEW.attempt_count = 1
      AND OLD.available_at <= NEW.updated_at)
    OR
    (OLD.status = 'retryableFailed' AND NEW.status = 'leased'
      AND OLD.attempt_count BETWEEN 1 AND 4
      AND NEW.attempt_count = OLD.attempt_count + 1
      AND OLD.available_at <= NEW.updated_at)
    OR
    (OLD.status = 'leased' AND NEW.status = 'leased'
      AND OLD.attempt_count BETWEEN 1 AND 4
      AND NEW.attempt_count = OLD.attempt_count + 1
      AND NEW.lease_token IS NOT OLD.lease_token
      AND OLD.lease_expires_at <= NEW.updated_at)
    OR
    (OLD.status = 'leased' AND NEW.status = 'sent'
      AND NEW.attempt_count = OLD.attempt_count)
    OR
    (OLD.status = 'leased' AND NEW.status = 'retryableFailed'
      AND OLD.attempt_count BETWEEN 1 AND 4
      AND NEW.attempt_count = OLD.attempt_count)
    OR
    (OLD.status = 'leased' AND NEW.status = 'deadLetter'
      AND NEW.attempt_count = OLD.attempt_count
      AND (
        NEW.last_error_code IN (
          'DINGTALK_NOT_CONFIGURED', 'DINGTALK_AUTH_REJECTED',
          'DINGTALK_REQUEST_REJECTED', 'DINGTALK_RESPONSE_INVALID',
          'DINGTALK_ADAPTER_PROTOCOL_ERROR'
        )
        OR (OLD.attempt_count = 5 AND NEW.last_error_code IN (
          'DINGTALK_TIMEOUT', 'DINGTALK_RATE_LIMITED',
          'DINGTALK_UNAVAILABLE', 'DINGTALK_TRANSPORT_ERROR'
        ))
        OR (OLD.attempt_count = 5
          AND NEW.last_error_code = 'OUTBOX_DELIVERY_OUTCOME_UNKNOWN'
          AND OLD.lease_expires_at <= NEW.updated_at)
      ))
  )
  BEGIN
    SELECT RAISE(ABORT, 'invalid notification outbox transition');
  END;

  CREATE TRIGGER notification_outbox_terminal_sealed
  BEFORE UPDATE ON notification_outbox
  WHEN OLD.status IN ('sent', 'deadLetter')
  BEGIN
    SELECT RAISE(ABORT, 'terminal notification outbox record is sealed');
  END;

  CREATE TRIGGER notification_outbox_no_delete
  BEFORE DELETE ON notification_outbox
  BEGIN
    SELECT RAISE(ABORT, 'notification outbox records cannot be deleted');
  END;
`;

function normalizeSchemaSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim().replace(/;$/, '');
}

function schemaDefinitions(sql, type) {
  const pattern = type === 'table'
    ? /\bCREATE\s+TABLE\s+([^\s(]+)[\s\S]*?\)\s*STRICT\s*;/gi
    : type === 'index'
      ? /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+([^\s(]+)[\s\S]*?;/gi
      : /\bCREATE\s+TRIGGER\s+([^\s]+)[\s\S]*?\bEND\s*;/gi;
  return Object.freeze(Object.fromEntries(
    [...sql.matchAll(pattern)].map(match => [match[1], normalizeSchemaSql(match[0])]),
  ));
}

const V2_INDEX_DEFINITIONS = schemaDefinitions(`${V2_CORE_SQL}\n${V1_COMPATIBILITY_SQL}`, 'index');
const V2_TRIGGER_DEFINITIONS = schemaDefinitions(V2_CORE_SQL, 'trigger');
const V2_TABLE_DEFINITIONS = schemaDefinitions(V2_CORE_SQL, 'table');
const KIOSK_REVIEW_INDEX_DEFINITIONS = schemaDefinitions(KIOSK_REVIEW_SQL, 'index');
const KIOSK_REVIEW_TRIGGER_DEFINITIONS = schemaDefinitions(KIOSK_REVIEW_SQL, 'trigger');
const KIOSK_REVIEW_TABLE_DEFINITIONS = schemaDefinitions(KIOSK_REVIEW_SQL, 'table');
const NOTIFICATION_OUTBOX_INDEX_DEFINITIONS = schemaDefinitions(NOTIFICATION_OUTBOX_SQL, 'index');
const NOTIFICATION_OUTBOX_TRIGGER_DEFINITIONS = schemaDefinitions(NOTIFICATION_OUTBOX_SQL, 'trigger');
const NOTIFICATION_OUTBOX_TABLE_DEFINITIONS = schemaDefinitions(NOTIFICATION_OUTBOX_SQL, 'table');
const SCHEDULING_TABLE_DEFINITIONS = schemaDefinitions(SCHEDULING_SCHEMA_SQL, 'table');
const SCHEDULING_INDEX_DEFINITIONS = schemaDefinitions(SCHEDULING_SCHEMA_SQL, 'index');
const SCHEDULING_TRIGGER_DEFINITIONS = schemaDefinitions(SCHEDULING_SCHEMA_SQL, 'trigger');
const RUN_CONTEXT_CAPTURE_TABLE_DEFINITIONS = schemaDefinitions(RUN_CONTEXT_CAPTURE_SCHEMA_SQL, 'table');
const RUN_CONTEXT_CAPTURE_TRIGGER_DEFINITIONS = schemaDefinitions(RUN_CONTEXT_CAPTURE_SCHEMA_SQL, 'trigger');
const V2_COMPAT_TABLE_DEFINITIONS = Object.freeze({
  uploads: normalizeSchemaSql(`
    CREATE TABLE uploads (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      kind TEXT NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      stored_name TEXT,
      claimed_task_id TEXT,
      created_at TEXT NOT NULL
    , claimed_order INTEGER
      CHECK (claimed_order IS NULL OR claimed_order >= 0))
  `),
  operations: normalizeSchemaSql(`
    CREATE TABLE operations (
      operation_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    , request_digest TEXT)
  `),
});

function checksum(sql) {
  return `sha256:${createHash('sha256').update(sql).digest('hex')}`;
}

export const MIGRATIONS = Object.freeze([
  Object.freeze({ version: 1, name: 'v2_normalized_core', sql: V2_CORE_SQL, checksum: checksum(V2_CORE_SQL) }),
  Object.freeze({ version: 2, name: 'v1_compatibility_columns', sql: V1_COMPATIBILITY_SQL, checksum: checksum(V1_COMPATIBILITY_SQL) }),
  Object.freeze({ version: 3, name: 'kiosk_run_event_review_ownership', sql: KIOSK_REVIEW_SQL, checksum: checksum(KIOSK_REVIEW_SQL) }),
  Object.freeze({ version: 4, name: 'notification_outbox', sql: NOTIFICATION_OUTBOX_SQL, checksum: checksum(NOTIFICATION_OUTBOX_SQL) }),
  Object.freeze({ version: 5, name: 'scheduling_proposals', sql: SCHEDULING_SCHEMA_SQL, checksum: checksum(SCHEDULING_SCHEMA_SQL) }),
  Object.freeze({ version: 6, name: 'scheduling_run_context_capture', sql: RUN_CONTEXT_CAPTURE_SCHEMA_SQL, checksum: checksum(RUN_CONTEXT_CAPTURE_SCHEMA_SQL) }),
]);

export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1).version;

const V1_COLUMNS = Object.freeze({
  schedule_state: ['id', 'revision', 'updated_at', 'snapshot_json'],
  operations: ['operation_id', 'kind', 'response_json', 'created_at'],
  audit_log: ['id', 'action', 'role', 'entity_id', 'revision', 'result', 'created_at'],
  uploads: ['id', 'operation_id', 'original_name', 'content_type', 'kind', 'size', 'sha256', 'stored_name', 'claimed_task_id', 'created_at'],
});

const V2_COMPAT_COLUMN_SHAPES = Object.freeze({
  uploads: Object.freeze([
    ['id', 'TEXT', 0, 1, 0],
    ['operation_id', 'TEXT', 1, 0, 0],
    ['original_name', 'TEXT', 1, 0, 0],
    ['content_type', 'TEXT', 1, 0, 0],
    ['kind', 'TEXT', 1, 0, 0],
    ['size', 'INTEGER', 1, 0, 0],
    ['sha256', 'TEXT', 1, 0, 0],
    ['stored_name', 'TEXT', 0, 0, 0],
    ['claimed_task_id', 'TEXT', 0, 0, 0],
    ['created_at', 'TEXT', 1, 0, 0],
    ['claimed_order', 'INTEGER', 0, 0, 0],
  ]),
  operations: Object.freeze([
    ['operation_id', 'TEXT', 0, 1, 0],
    ['kind', 'TEXT', 1, 0, 0],
    ['response_json', 'TEXT', 1, 0, 0],
    ['created_at', 'TEXT', 1, 0, 0],
    ['request_digest', 'TEXT', 0, 0, 0],
  ]),
});

const V2_CORE_TABLES = Object.freeze([
  'migration_batches',
  'revision_counters',
  'product_catalog_entries',
  'requests_v2',
  'schedule_items',
  'schedule_item_tasks',
  'legacy_asset_entries',
  'legacy_compat_fragments',
  'production_runs',
  'production_events',
  'snapshot_projections',
]);

const V2_COLUMNS = Object.freeze({
  migration_batches: [
    'id', 'identity_digest', 'migration_version', 'mapping_version', 'source_schema_version',
    'source_revision', 'source_schema_digest', 'source_structural_digest', 'configuration_digest',
    'resource_map_version', 'resource_map_digest', 'business_time_zone', 'status', 'started_at', 'completed_at',
  ],
  revision_counters: ['id', 'projection_revision', 'schedule_revision', 'updated_at'],
  product_catalog_entries: ['id', 'display_order', 'sku', 'name', 'source', 'migration_batch_id', 'imported_at'],
  requests_v2: [
    'id', 'source_ordinal', 'sku', 'name', 'client', 'legacy_deliver_text', 'kind', 'legacy_v1_status',
    'v1_status_mode', 'request_lifecycle', 'lifecycle_provenance', 'source', 'business_created_at',
    'business_updated_at', 'imported_at', 'v1_assets_present', 'v1_request_present', 'production_type',
    'shooting_subtype', 'deliverable_count', 'aspect_ratio', 'duration_seconds', 'audio_requirement',
    'requested_by', 'desired_date', 'note', 'source_operation_id', 'core_brief_summary', 'brief_url',
    'hero_asset_id', 'sample_status', 'sample_shelf_id', 'lighting_preset', 'reflectivity', 'priority',
    'migration_batch_id',
  ],
  schedule_items: [
    'id', 'source_ordinal', 'resource_id', 'resource_resolution_status', 'resource_mapping_version',
    'legacy_place_text', 'planned_start', 'planned_end', 'buffer_after_minutes', 'buffer_source',
    'schedule_status', 'schedule_status_provenance', 'lock_status', 'lock_status_provenance', 'note',
    'allocation_mode', 'source', 'source_ref', 'business_created_at', 'business_updated_at', 'imported_at',
    'migration_batch_id',
  ],
  schedule_item_tasks: ['schedule_item_id', 'task_id', 'display_order', 'created_at', 'imported_at'],
  legacy_asset_entries: [
    'id', 'request_id', 'display_order', 'name', 'content_type', 'kind', 'size', 'sha256', 'source',
    'imported_at', 'migration_batch_id',
  ],
  legacy_compat_fragments: [
    'id', 'entity_type', 'entity_id', 'json_pointer', 'value_json', 'value_digest', 'violation_code',
    'classification', 'mapping_version', 'source_ordinal', 'migration_batch_id',
  ],
  production_runs: [
    'id', 'schedule_item_id', 'scope', 'task_id', 'status', 'run_revision', 'started_at', 'completed_at',
    'active_block_started_at', 'gross_duration_ms', 'blocked_duration_ms', 'net_duration_ms',
    'metrics_algorithm_version', 'created_at', 'updated_at',
  ],
  production_events: [
    'event_id', 'run_id', 'command_digest', 'response_digest', 'event_type', 'occurred_at', 'received_at',
    'device_id', 'actor_id', 'reason_code', 'note', 'previous_state', 'resulting_state',
    'resulting_run_revision', 'resulting_projection_revision', 'resulting_schedule_revision',
  ],
  snapshot_projections: [
    'projection_name', 'schema_version', 'revision', 'schedule_revision', 'updated_at', 'payload_json',
    'source_schema_version',
  ],
});

const V2_INDEXES = Object.freeze([
  'requests_v2_lifecycle_idx',
  'requests_v2_desired_date_idx',
  'schedule_items_status_resource_time_idx',
  'schedule_items_confirmed_resource_time_idx',
  'schedule_item_tasks_task_idx',
  'legacy_compat_fragments_identity_uq',
  'production_runs_schedule_item_idx',
  'production_runs_task_idx',
  'production_runs_one_active_per_item_uq',
  'production_events_run_occurred_idx',
]);

const KIOSK_REVIEW_TABLES = Object.freeze([
  'run_event_id_owners',
  'run_event_reviews',
]);

const KIOSK_REVIEW_COLUMNS = Object.freeze({
  run_event_id_owners: ['event_id', 'owner_kind', 'created_at'],
  run_event_reviews: [
    'event_id', 'run_id', 'schedule_item_id', 'command_digest', 'response_digest', 'event_type',
    'expected_run_revision', 'occurred_at', 'received_at', 'device_id', 'actor_id', 'actor_role',
    'reason_code', 'note', 'time_policy_version', 'review_reason', 'review_status', 'response_json',
    'created_at',
  ],
});

const KIOSK_REVIEW_INDEXES = Object.freeze([
  'run_event_reviews_run_created_idx',
  'run_event_reviews_pending_created_idx',
]);

const NOTIFICATION_OUTBOX_TABLES = Object.freeze([
  'notification_outbox',
]);

const NOTIFICATION_OUTBOX_COLUMNS = Object.freeze({
  notification_outbox: [
    'outbox_id', 'channel', 'dedupe_key', 'intent_type', 'aggregate_type', 'aggregate_id',
    'aggregate_revision_scope', 'aggregate_revision', 'route_key', 'card_schema_version',
    'delivery_policy_version', 'payload_json', 'payload_digest', 'status', 'attempt_count',
    'available_at', 'lease_token', 'lease_owner', 'lease_expires_at', 'provider_ref',
    'delivery_receipt_digest', 'last_error_code', 'created_at', 'updated_at', 'sent_at',
  ],
});

const NOTIFICATION_OUTBOX_INDEXES = Object.freeze([
  'notification_outbox_dispatch_idx',
  'notification_outbox_lease_idx',
  'notification_outbox_provider_ref_uq',
]);

const SCHEDULING_TABLES = Object.freeze(Object.keys(SCHEDULING_TABLE_DEFINITIONS));
const SCHEDULING_INDEXES = Object.freeze(Object.keys(SCHEDULING_INDEX_DEFINITIONS));
const SCHEDULING_TRIGGERS = Object.freeze(Object.keys(SCHEDULING_TRIGGER_DEFINITIONS));
const RUN_CONTEXT_CAPTURE_TABLES = Object.freeze(Object.keys(RUN_CONTEXT_CAPTURE_TABLE_DEFINITIONS));
const RUN_CONTEXT_CAPTURE_TRIGGERS = Object.freeze(Object.keys(RUN_CONTEXT_CAPTURE_TRIGGER_DEFINITIONS));
const RUN_CONTEXT_CAPTURE_COLUMNS = Object.freeze({
  scheduling_run_context_snapshots: [
    'run_id', 'schema_version', 'context_status', 'snapshot_json', 'snapshot_digest', 'captured_at',
  ],
});

function schemaError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function objectExists(db, type, name) {
  return Boolean(db.prepare('SELECT 1 FROM sqlite_schema WHERE type = ? AND name = ?').get(type, name));
}

function assertObjectDefinition(db, type, name, expectedSql, errorCode = 'SCHEMA_STRUCTURE_MISMATCH') {
  const row = db.prepare('SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?').get(type, name);
  if (!row) throw schemaError(errorCode, `missing ${type}: ${name}`);
  if (!expectedSql || normalizeSchemaSql(row.sql) !== expectedSql) {
    throw schemaError(errorCode, `unexpected ${type} definition: ${name}`);
  }
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map(column => column.name);
}

function assertExactColumnShape(db, table, expectedShape) {
  const actualShape = db.prepare(`PRAGMA table_xinfo(${JSON.stringify(table)})`).all()
    .map(column => [column.name, column.type, column.notnull, column.pk, column.hidden]);
  if (JSON.stringify(actualShape) !== JSON.stringify(expectedShape)) {
    throw schemaError('SCHEMA_STRUCTURE_MISMATCH', `unexpected column shape in ${table}`);
  }
}

function assertColumns(db, table, requiredColumns) {
  if (!objectExists(db, 'table', table)) throw schemaError('SCHEMA_STRUCTURE_MISMATCH', `missing table: ${table}`);
  const actual = new Set(tableColumns(db, table));
  const missing = requiredColumns.filter(column => !actual.has(column));
  if (missing.length) {
    throw schemaError('SCHEMA_STRUCTURE_MISMATCH', `missing columns in ${table}: ${missing.join(', ')}`);
  }
}

function assertExactColumns(db, table, expectedColumns) {
  assertColumns(db, table, expectedColumns);
  const actual = tableColumns(db, table);
  if (actual.length !== expectedColumns.length || actual.some((column, index) => column !== expectedColumns[index])) {
    throw schemaError('SCHEMA_STRUCTURE_MISMATCH', `unexpected column shape in ${table}`);
  }
}

function assertV1Schema(db) {
  for (const [table, columns] of Object.entries(V1_COLUMNS)) assertColumns(db, table, columns);
}

function ensureV1Schema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = Object.keys(V1_COLUMNS).filter(table => objectExists(db, 'table', table));
    if (existing.length === 0) {
      db.exec(V1_SCHEMA_SQL);
    }
    if (existing.length !== 0 && existing.length !== Object.keys(V1_COLUMNS).length) {
      throw schemaError('V1_SCHEMA_PARTIAL', 'the V1 schema is only partially present');
    }
    assertV1Schema(db);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    if (error?.code?.startsWith?.('SCHEMA_') || error?.code === 'V1_SCHEMA_PARTIAL') throw error;
    throw schemaError('V1_SCHEMA_INITIALIZATION_FAILED', 'could not initialize the V1 schema', error);
  }
}

const MARKER_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    name TEXT NOT NULL UNIQUE,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;
`;

const MARKER_TRIGGERS_SQL = `
  CREATE TRIGGER schema_migrations_no_update
  BEFORE UPDATE ON schema_migrations
  BEGIN
    SELECT RAISE(ABORT, 'schema migration markers are immutable');
  END;
  CREATE TRIGGER schema_migrations_no_delete
  BEFORE DELETE ON schema_migrations
  BEGIN
    SELECT RAISE(ABORT, 'schema migration markers are immutable');
  END;
`;

const MARKER_TRIGGER_DEFINITIONS = schemaDefinitions(MARKER_TRIGGERS_SQL, 'trigger');
const MARKER_TABLE_DEFINITION = normalizeSchemaSql(MARKER_SQL.replace(/\bIF\s+NOT\s+EXISTS\b/i, ''));

function ensureMigrationMarker(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const exists = objectExists(db, 'table', 'schema_migrations');
    if (!exists) {
      db.exec(MARKER_SQL);
      db.exec(MARKER_TRIGGERS_SQL);
    }
    assertMigrationMarker(db);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    if (error?.code?.startsWith?.('SCHEMA_')) throw error;
    throw schemaError('SCHEMA_MARKER_INITIALIZATION_FAILED', 'could not initialize schema_migrations', error);
  }
}

function assertMigrationMarker(db) {
  assertObjectDefinition(db, 'table', 'schema_migrations', MARKER_TABLE_DEFINITION, 'SCHEMA_MARKER_DRIFT');
  for (const trigger of ['schema_migrations_no_update', 'schema_migrations_no_delete']) {
    assertObjectDefinition(db, 'trigger', trigger, MARKER_TRIGGER_DEFINITIONS[trigger], 'SCHEMA_MARKER_DRIFT');
  }
}

function assertMigrationDefinitions(migrations) {
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw schemaError('SCHEMA_MIGRATION_DEFINITION_INVALID', `migration version ${expectedVersion} is missing`);
    }
    if (!migration.name || !migration.sql || migration.checksum !== checksum(migration.sql)) {
      throw schemaError('SCHEMA_MIGRATION_DEFINITION_INVALID', `migration ${migration.version} is invalid`);
    }
  });
}

function appliedMigrations(db) {
  return db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
}

function assertAppliedPrefix(applied, migrations) {
  const latest = migrations.at(-1)?.version ?? 0;
  if (applied.some(row => row.version > latest)) {
    throw schemaError('SCHEMA_VERSION_TOO_NEW', 'database schema version is newer than this application');
  }
  applied.forEach((row, index) => {
    const expected = migrations[index];
    if (!expected || row.version !== expected.version) {
      throw schemaError('SCHEMA_MIGRATION_HOLE', 'schema_migrations is not a continuous prefix');
    }
    if (row.name !== expected.name || row.checksum !== expected.checksum) {
      throw schemaError('SCHEMA_MIGRATION_DRIFT', `schema migration ${row.version} differs from the application`);
    }
  });
}

function assertCoreStructure(db) {
  for (const table of V2_CORE_TABLES) {
    assertExactColumns(db, table, V2_COLUMNS[table]);
    assertObjectDefinition(db, 'table', table, V2_TABLE_DEFINITIONS[table]);
  }
  for (const index of V2_INDEXES) {
    assertObjectDefinition(db, 'index', index, V2_INDEX_DEFINITIONS[index]);
  }
  for (const trigger of ['production_events_no_update', 'production_events_no_delete', 'revision_counters_no_decrease']) {
    assertObjectDefinition(db, 'trigger', trigger, V2_TRIGGER_DEFINITIONS[trigger]);
  }
}

function assertKioskReviewStructure(db) {
  for (const table of KIOSK_REVIEW_TABLES) {
    assertExactColumns(db, table, KIOSK_REVIEW_COLUMNS[table]);
    assertObjectDefinition(db, 'table', table, KIOSK_REVIEW_TABLE_DEFINITIONS[table]);
  }
  for (const index of KIOSK_REVIEW_INDEXES) {
    assertObjectDefinition(db, 'index', index, KIOSK_REVIEW_INDEX_DEFINITIONS[index]);
  }
  for (const trigger of Object.keys(KIOSK_REVIEW_TRIGGER_DEFINITIONS)) {
    assertObjectDefinition(db, 'trigger', trigger, KIOSK_REVIEW_TRIGGER_DEFINITIONS[trigger]);
  }
}

function assertNotificationOutboxStructure(db) {
  for (const table of NOTIFICATION_OUTBOX_TABLES) {
    assertExactColumns(db, table, NOTIFICATION_OUTBOX_COLUMNS[table]);
    assertObjectDefinition(db, 'table', table, NOTIFICATION_OUTBOX_TABLE_DEFINITIONS[table]);
  }
  for (const index of NOTIFICATION_OUTBOX_INDEXES) {
    assertObjectDefinition(db, 'index', index, NOTIFICATION_OUTBOX_INDEX_DEFINITIONS[index]);
  }
  for (const trigger of Object.keys(NOTIFICATION_OUTBOX_TRIGGER_DEFINITIONS)) {
    assertObjectDefinition(db, 'trigger', trigger, NOTIFICATION_OUTBOX_TRIGGER_DEFINITIONS[trigger]);
  }
}

function assertSchedulingStructure(db) {
  for (const table of SCHEDULING_TABLES) {
    assertObjectDefinition(db, 'table', table, SCHEDULING_TABLE_DEFINITIONS[table]);
  }
  for (const index of SCHEDULING_INDEXES) {
    assertObjectDefinition(db, 'index', index, SCHEDULING_INDEX_DEFINITIONS[index]);
  }
  for (const trigger of SCHEDULING_TRIGGERS) {
    assertObjectDefinition(db, 'trigger', trigger, SCHEDULING_TRIGGER_DEFINITIONS[trigger]);
  }
}

function assertRunContextCaptureStructure(db) {
  for (const table of RUN_CONTEXT_CAPTURE_TABLES) {
    assertExactColumns(db, table, RUN_CONTEXT_CAPTURE_COLUMNS[table]);
    assertObjectDefinition(db, 'table', table, RUN_CONTEXT_CAPTURE_TABLE_DEFINITIONS[table]);
  }
  for (const trigger of RUN_CONTEXT_CAPTURE_TRIGGERS) {
    assertObjectDefinition(db, 'trigger', trigger, RUN_CONTEXT_CAPTURE_TRIGGER_DEFINITIONS[trigger]);
  }
}

function assertNoUnknownSchemaObjects(db, version) {
  const allowed = new Set([
    ...Object.keys(V1_COLUMNS).map(name => `table:${name}`),
    'table:schema_migrations',
    'trigger:schema_migrations_no_update',
    'trigger:schema_migrations_no_delete',
  ]);
  if (version >= 1) {
    for (const name of V2_CORE_TABLES) allowed.add(`table:${name}`);
    for (const name of V2_INDEXES) allowed.add(`index:${name}`);
    for (const name of Object.keys(V2_TRIGGER_DEFINITIONS)) allowed.add(`trigger:${name}`);
  }
  if (version >= 2) {
    allowed.add('index:uploads_claimed_task_idx');
    allowed.add('index:uploads_claimed_order_uq');
  }
  if (version >= 3) {
    for (const name of KIOSK_REVIEW_TABLES) allowed.add(`table:${name}`);
    for (const name of KIOSK_REVIEW_INDEXES) allowed.add(`index:${name}`);
    for (const name of Object.keys(KIOSK_REVIEW_TRIGGER_DEFINITIONS)) allowed.add(`trigger:${name}`);
  }
  if (version >= 4) {
    for (const name of NOTIFICATION_OUTBOX_TABLES) allowed.add(`table:${name}`);
    for (const name of NOTIFICATION_OUTBOX_INDEXES) allowed.add(`index:${name}`);
    for (const name of Object.keys(NOTIFICATION_OUTBOX_TRIGGER_DEFINITIONS)) allowed.add(`trigger:${name}`);
  }
  if (version >= 5) {
    for (const name of SCHEDULING_TABLES) allowed.add(`table:${name}`);
    for (const name of SCHEDULING_INDEXES) allowed.add(`index:${name}`);
    for (const name of SCHEDULING_TRIGGERS) allowed.add(`trigger:${name}`);
  }
  if (version >= 6) {
    for (const name of RUN_CONTEXT_CAPTURE_TABLES) allowed.add(`table:${name}`);
    for (const name of RUN_CONTEXT_CAPTURE_TRIGGERS) allowed.add(`trigger:${name}`);
  }

  const unknown = db.prepare(`
    SELECT type, name
    FROM sqlite_schema
    WHERE type IN ('table', 'index', 'trigger', 'view')
      AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
      AND NOT (type = 'index' AND sql IS NULL)
    ORDER BY type, name
  `).all().find(row => !allowed.has(`${row.type}:${row.name}`));
  if (unknown) {
    throw schemaError('SCHEMA_UNKNOWN_OBJECT', `unknown ${unknown.type}: ${unknown.name}`);
  }
}

function assertCompatibilityStructure(db) {
  for (const table of ['uploads', 'operations']) {
    assertExactColumnShape(db, table, V2_COMPAT_COLUMN_SHAPES[table]);
    assertObjectDefinition(db, 'table', table, V2_COMPAT_TABLE_DEFINITIONS[table]);
  }
  for (const index of ['uploads_claimed_task_idx', 'uploads_claimed_order_uq']) {
    assertObjectDefinition(db, 'index', index, V2_INDEX_DEFINITIONS[index]);
  }
}

function assertStructureForVersion(db, version) {
  assertV1Schema(db);
  if (version >= 1) assertCoreStructure(db);
  if (version >= 2) assertCompatibilityStructure(db);
  if (version >= 3) assertKioskReviewStructure(db);
  if (version >= 4) assertNotificationOutboxStructure(db);
  if (version >= 5) assertSchedulingStructure(db);
  if (version >= 6) assertRunContextCaptureStructure(db);
}

function assertNoPendingArtifacts(db, nextVersion) {
  if (nextVersion === 1 && V2_CORE_TABLES.some(table => objectExists(db, 'table', table))) {
    throw schemaError('SCHEMA_PARTIAL_MIGRATION', 'unmarked V2 core schema objects are present');
  }
  if (nextVersion === 2) {
    const uploadColumns = new Set(tableColumns(db, 'uploads'));
    const operationColumns = new Set(tableColumns(db, 'operations'));
    if (
      uploadColumns.has('claimed_order')
      || operationColumns.has('request_digest')
      || objectExists(db, 'index', 'uploads_claimed_task_idx')
      || objectExists(db, 'index', 'uploads_claimed_order_uq')
    ) {
      throw schemaError('SCHEMA_PARTIAL_MIGRATION', 'unmarked V1 compatibility schema objects are present');
    }
  }
  if (nextVersion === 3 && (
    KIOSK_REVIEW_TABLES.some(table => objectExists(db, 'table', table))
    || KIOSK_REVIEW_INDEXES.some(index => objectExists(db, 'index', index))
    || Object.keys(KIOSK_REVIEW_TRIGGER_DEFINITIONS)
      .some(trigger => objectExists(db, 'trigger', trigger))
  )) {
    throw schemaError('SCHEMA_PARTIAL_MIGRATION', 'unmarked Kiosk review schema objects are present');
  }
  if (nextVersion === 4 && (
    NOTIFICATION_OUTBOX_TABLES.some(table => objectExists(db, 'table', table))
    || NOTIFICATION_OUTBOX_INDEXES.some(index => objectExists(db, 'index', index))
    || Object.keys(NOTIFICATION_OUTBOX_TRIGGER_DEFINITIONS)
      .some(trigger => objectExists(db, 'trigger', trigger))
  )) {
    throw schemaError('SCHEMA_PARTIAL_MIGRATION', 'unmarked notification Outbox schema objects are present');
  }
  if (nextVersion === 5 && (
    SCHEDULING_TABLES.some(table => objectExists(db, 'table', table))
    || SCHEDULING_INDEXES.some(index => objectExists(db, 'index', index))
    || SCHEDULING_TRIGGERS.some(trigger => objectExists(db, 'trigger', trigger))
  )) {
    throw schemaError('SCHEMA_PARTIAL_MIGRATION', 'unmarked scheduling schema objects are present');
  }
  if (nextVersion === 6 && (
    RUN_CONTEXT_CAPTURE_TABLES.some(table => objectExists(db, 'table', table))
    || RUN_CONTEXT_CAPTURE_TRIGGERS.some(trigger => objectExists(db, 'trigger', trigger))
  )) {
    throw schemaError('SCHEMA_PARTIAL_MIGRATION', 'unmarked run-context capture schema objects are present');
  }
}

export function assertKnownSchema(db, { migrations = MIGRATIONS } = {}) {
  assertMigrationDefinitions(migrations);
  assertV1Schema(db);
  assertMigrationMarker(db);
  const applied = appliedMigrations(db);
  assertAppliedPrefix(applied, migrations);
  assertStructureForVersion(db, applied.length);
  assertNoUnknownSchemaObjects(db, applied.length);
  return { version: applied.length, latestVersion: migrations.length };
}

export function applySchemaMigrations(db, { now = () => new Date(), migrations = MIGRATIONS } = {}) {
  assertMigrationDefinitions(migrations);
  ensureMigrationMarker(db);

  for (const migration of migrations) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const applied = appliedMigrations(db);
      assertAppliedPrefix(applied, migrations);
      assertStructureForVersion(db, applied.length);
      if (applied.length >= migration.version) {
        if (applied.length === migrations.length) {
          assertNoUnknownSchemaObjects(db, applied.length);
        }
        db.exec('COMMIT');
        continue;
      }
      if (applied.length !== migration.version - 1) {
        throw schemaError('SCHEMA_MIGRATION_HOLE', 'schema_migrations is not a continuous prefix');
      }
      assertNoPendingArtifacts(db, migration.version);
      assertNoUnknownSchemaObjects(db, applied.length);
      db.exec(migration.sql);
      assertStructureForVersion(db, migration.version);
      assertNoUnknownSchemaObjects(db, migration.version);
      const foreignKeyFailures = db.prepare('PRAGMA foreign_key_check').all();
      if (foreignKeyFailures.length) {
        throw schemaError('SCHEMA_FOREIGN_KEY_CHECK_FAILED', 'foreign key validation failed');
      }
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(migration.version, migration.name, migration.checksum, now().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      if (error?.code?.startsWith?.('SCHEMA_')) throw error;
      throw schemaError('SCHEMA_MIGRATION_FAILED', `schema migration ${migration.version} failed`, error);
    }
  }

  return assertKnownSchema(db, { migrations });
}

export function initializeWritableSchema(db, options = {}) {
  const foreignKeys = db.prepare('PRAGMA foreign_keys').get().foreign_keys;
  if (foreignKeys !== 1) throw schemaError('FOREIGN_KEYS_DISABLED', 'PRAGMA foreign_keys must be enabled');
  ensureV1Schema(db);
  return applySchemaMigrations(db, options);
}
