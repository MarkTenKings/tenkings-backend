-- Inactive additive proposal. Apply only through the reviewed ATLAS release.
BEGIN;
CREATE TABLE atlas_manual_connected.batch_request (
 actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 action_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,action_id)
);
CREATE TABLE atlas_manual_connected.batch_grading (
 key text PRIMARY KEY CHECK(key ~ '^[a-f0-9]{64}$'),
 card_id uuid NOT NULL REFERENCES atlas_manual_intake.card(id),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 access_version integer NOT NULL CHECK(access_version>0),
 analysis_action_id uuid NOT NULL UNIQUE,
 analysis_reserved boolean NOT NULL DEFAULT false,
 input text NOT NULL CHECK(octet_length(input)<=8192 AND jsonb_typeof(input::jsonb)='object'),
 input_hash text NOT NULL CHECK(input_hash=encode(sha256(convert_to(input,'UTF8')),'hex')),
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','REVIEW','NEEDS_ATTENTION','SUPERSEDED','APPROVED')),
 stage text NOT NULL DEFAULT 'PREPARE' CHECK(stage IN ('PREPARE','ANALYZE','REPORT')),
 evidence text NOT NULL DEFAULT '{}' CHECK(octet_length(evidence)<=65536 AND jsonb_typeof(evidence::jsonb)='object'),
 code text CHECK(code IS NULL OR code ~ '^[A-Z][A-Z0-9_]{0,100}$'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 claim_id uuid, lease_until timestamptz,
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(card_id,source_hash),
 CHECK((state='RUNNING')=(claim_id IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(state='RUNNING' OR (claim_id IS NULL AND lease_until IS NULL))
);
CREATE INDEX batch_grading_pending ON atlas_manual_connected.batch_grading(actor_id,created_at,key) WHERE state IN ('QUEUED','RUNNING');
REVOKE ALL ON atlas_manual_connected.batch_request,atlas_manual_connected.batch_grading FROM PUBLIC;
CREATE TABLE atlas_manual_connected.batch_review (
 job_key text PRIMARY KEY REFERENCES atlas_manual_connected.batch_grading(key),
 actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 input text NOT NULL CHECK(octet_length(input)<=4096 AND jsonb_typeof(input::jsonb)='object'),
 input_hash text NOT NULL CHECK(input_hash=encode(sha256(convert_to(input,'UTF8')),'hex')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual_connected.batch_review
 FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
REVOKE ALL ON atlas_manual_connected.batch_review FROM PUBLIC;
COMMIT;
