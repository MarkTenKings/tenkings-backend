export interface Migration { version: number; name: string; sql: string }

export const LOCAL_SCHEMA_VERSION = 1;

export const MIGRATIONS: readonly Migration[] = [{
  version: 1,
  name: "vault_local_authority_v1",
  sql: `
CREATE TABLE machine_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  machine_id TEXT NOT NULL,
  app_version TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  active_config_version INTEGER,
  pending_config_version INTEGER,
  last_cloud_success_at TEXT,
  last_trusted_wall_at TEXT,
  last_trusted_monotonic_ms INTEGER,
  public_state_version INTEGER NOT NULL DEFAULT 1,
  service_locked INTEGER NOT NULL DEFAULT 0 CHECK (service_locked IN (0,1)),
  automation_halted INTEGER NOT NULL DEFAULT 0 CHECK (automation_halted IN (0,1)),
  recovery_required INTEGER NOT NULL DEFAULT 0 CHECK (recovery_required IN (0,1)),
  last_public_activity_at TEXT
);

CREATE TABLE config_snapshot (
  version INTEGER PRIMARY KEY,
  digest TEXT NOT NULL UNIQUE CHECK(length(digest)=64),
  key_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  signed_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  activated_at TEXT,
  rejected_reason TEXT
);

CREATE TABLE door (
  door_id TEXT PRIMARY KEY,
  controller_channel INTEGER NOT NULL UNIQUE,
  mapping_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('EMPTY','AVAILABLE','RESERVED','COMMITTED_SOLD','SERVICE_HOLD','DISABLED','EXCEPTION')),
  product_id TEXT,
  planned_product_id TEXT,
  owning_sale_id TEXT,
  owning_restock_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  last_event_id TEXT
);

CREATE TABLE cart_item (
  door_id TEXT PRIMARY KEY REFERENCES door(door_id),
  product_id TEXT NOT NULL,
  selected_at TEXT NOT NULL
);

CREATE TABLE sale (
  sale_id TEXT PRIMARY KEY,
  support_reference TEXT NOT NULL UNIQUE,
  checkout_idempotency_key TEXT NOT NULL UNIQUE,
  checkout_request_digest TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('PRODUCTION','CERTIFICATION')),
  state TEXT NOT NULL,
  state_version INTEGER NOT NULL DEFAULT 1,
  config_version INTEGER NOT NULL REFERENCES config_snapshot(version),
  config_digest TEXT NOT NULL,
  timezone TEXT NOT NULL,
  city TEXT NOT NULL,
  state_region TEXT NOT NULL,
  tax_rate_basis_points INTEGER NOT NULL,
  tax_calculation_version TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
  payment_state TEXT NOT NULL,
  payment_intent_key TEXT UNIQUE,
  payment_request_digest TEXT,
  provider_session_id TEXT UNIQUE,
  provider_transaction_id TEXT UNIQUE,
  provider_sequence INTEGER NOT NULL DEFAULT -1,
  retry_used_at TEXT,
  presentation_started_at TEXT,
  presentation_expires_at TEXT,
  presentation_done_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  recovered_at TEXT
);

CREATE TABLE sale_item (
  line_id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sale(sale_id),
  door_id TEXT NOT NULL REFERENCES door(door_id),
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  photo_url TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  tax_class TEXT NOT NULL,
  controller_channel INTEGER NOT NULL,
  mapping_version TEXT NOT NULL,
  allocation_state TEXT NOT NULL,
  fulfillment_state TEXT NOT NULL,
  support_reason TEXT,
  UNIQUE(sale_id, door_id)
);

CREATE TABLE payment_callback (
  callback_id TEXT PRIMARY KEY,
  payload_digest TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES sale(sale_id),
  provider_session_id TEXT NOT NULL,
  provider_transaction_id TEXT,
  sequence INTEGER NOT NULL,
  state TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  disposition TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE TABLE command_intent (
  command_id TEXT PRIMARY KEY,
  sale_id TEXT REFERENCES sale(sale_id),
  sale_item_id TEXT REFERENCES sale_item(line_id),
  restock_session_id TEXT,
  certification_session_id TEXT,
  door_id TEXT NOT NULL REFERENCES door(door_id),
  controller_channel INTEGER NOT NULL,
  mapping_version TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK(attempt IN (1,2)),
  authority TEXT NOT NULL CHECK(authority IN ('PAID_SALE','RESTOCK','CERTIFICATION')),
  state TEXT NOT NULL,
  controller_sequence INTEGER,
  observed_door_id TEXT,
  evidence_code TEXT,
  created_at TEXT NOT NULL,
  dispatched_at TEXT,
  completed_at TEXT,
  UNIQUE(sale_item_id, attempt)
);

CREATE TABLE machine_event (
  event_id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL DEFAULT 1,
  machine_id TEXT NOT NULL,
  type TEXT NOT NULL,
  mode TEXT NOT NULL,
  correlation_id TEXT,
  causation_id TEXT,
  actor TEXT,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_digest TEXT NOT NULL
);

CREATE TABLE outbox (
  event_id TEXT PRIMARY KEY REFERENCES machine_event(event_id),
  sequence INTEGER NOT NULL UNIQUE,
  payload_digest TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_response TEXT,
  acknowledged_at TEXT,
  archived_at TEXT
);

CREATE TABLE idempotency_record (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(scope, idempotency_key)
);

CREATE TABLE kiosk_session (
  session_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE staff_grant (
  grant_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  role TEXT NOT NULL,
  verifier_version INTEGER NOT NULL,
  verifier TEXT NOT NULL,
  hash_algorithm TEXT NOT NULL,
  hash_parameters_json TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(user_id, verifier_version)
);

CREATE TABLE staff_auth_state (
  user_id TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  blocked_until TEXT,
  last_failure_at TEXT
);

CREATE TABLE staff_session (
  session_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES staff_grant(grant_id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  locked_at TEXT,
  ended_at TEXT
);

CREATE TABLE restock_session (
  session_id TEXT PRIMARY KEY,
  actor_session_id TEXT NOT NULL REFERENCES staff_session(session_id),
  config_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  expected_door_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  physical_close_confirmed_at TEXT,
  finalized_at TEXT
);

CREATE TABLE restock_item (
  session_id TEXT NOT NULL REFERENCES restock_session(session_id),
  door_id TEXT NOT NULL REFERENCES door(door_id),
  planned_product_id TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN ('UNREVIEWED','FILLED','LEFT_EMPTY','EXCEPTION')),
  notes TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(session_id, door_id)
);

CREATE TABLE certification_session (
  session_id TEXT PRIMARY KEY,
  actor_session_id TEXT NOT NULL REFERENCES staff_session(session_id),
  config_version INTEGER NOT NULL,
  adapter_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  app_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  controller_identity_json TEXT NOT NULL,
  payment_identity_json TEXT NOT NULL,
  retention_policy TEXT NOT NULL,
  service_life_ended_at TEXT,
  purge_eligible_at TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  approved_by TEXT,
  approved_at TEXT
);

CREATE TABLE certification_evidence (
  evidence_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES certification_session(session_id),
  command_id TEXT NOT NULL UNIQUE REFERENCES command_intent(command_id),
  door_id TEXT,
  evidence_class TEXT NOT NULL,
  outcome TEXT NOT NULL,
  expected_door_ids_json TEXT NOT NULL,
  observed_door_ids_json TEXT NOT NULL,
  notes TEXT NOT NULL,
  artifact_digest TEXT NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE TABLE backup_metadata (
  backup_id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  ciphertext_digest TEXT NOT NULL,
  plaintext_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  restored_at TEXT,
  removed_at TEXT
);

CREATE INDEX sale_nonterminal_idx ON sale(state, created_at);
CREATE INDEX command_pending_idx ON command_intent(state, created_at);
CREATE INDEX callback_sale_sequence_idx ON payment_callback(sale_id, sequence);
CREATE INDEX outbox_pending_idx ON outbox(acknowledged_at, sequence);
CREATE INDEX evidence_door_idx ON certification_evidence(door_id, outcome);
`,
}];
