-- INERT SOURCE PREPARATION. NOT a migration, installed gateway or permission.
-- The first exception is intentional. Never remove it in application code.
-- Canonical source: d8a4496300dfb204a4dbcaed7d4d6fb313ce4463.
-- Complete 15-source review pins: c0-proof-authority-lane/proposal-02-pins.json.
--
-- Implemented here: finite schema, closed gateway entry shapes, actual canonical
-- row-lock/expiry checks, exact absent lookup and fail-closed legacy DML guard.
-- NOT implemented: genuine request/policy/roster producer, stage admission,
-- positive settlement, two-phase logout/admin apply, writer trigger installation,
-- marketplace protected-map gateway or publisher barriers. Those are REQUIRED
-- R1 integration, not an enabled flag. Every mutation returns UNAVAILABLE.
-- No SQL setting, inserted JSON, control row or serving role can enable a stage.
BEGIN;
DO $$ BEGIN RAISE EXCEPTION 'R1_PROOF_AUTHORITY_PROPOSAL_NOT_APPROVED'; END $$;

CREATE SCHEMA atlas_proof_authority;
REVOKE ALL ON SCHEMA atlas_proof_authority FROM PUBLIC;

CREATE TABLE atlas_proof_authority.control (
  id text PRIMARY KEY CHECK(id='active'),
  enabled boolean NOT NULL DEFAULT false CHECK(enabled=false),
  integration text NOT NULL DEFAULT 'CANONICAL_JOIN_REQUIRED' CHECK(integration='CANONICAL_JOIN_REQUIRED'),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 9007199254740991),
  max_open_stages integer NOT NULL DEFAULT 1 CHECK(max_open_stages=1),
  max_stages integer NOT NULL DEFAULT 4096 CHECK(max_stages BETWEEN 1 AND 4096),
  max_fences integer NOT NULL DEFAULT 16384 CHECK(max_fences BETWEEN 1 AND 16384),
  max_mutations integer NOT NULL DEFAULT 4096 CHECK(max_mutations BETWEEN 1 AND 4096)
);
INSERT INTO atlas_proof_authority.control(id) VALUES('active');

CREATE TABLE atlas_proof_authority.fence (
  fence_id uuid PRIMARY KEY,
  source_kind text NOT NULL CHECK(source_kind IN ('STAFF_CONTROL','STAFF_IDENTITY','STAFF_SESSION','STAFF_BROWSER',
    'CUSTOMER_CONTROL','CUSTOMER_ACCOUNT','CUSTOMER_SESSION','CUSTOMER_BROWSER','CUSTOMER_SERVICE_CONTROL',
    'PROOF_CONTROL','PROOF_REVIEWER_GRANT','PUBLISHER_SESSION')),
  source_key_hash text NOT NULL CHECK(source_key_hash ~ '^[a-f0-9]{64}$'),
  source_generation_hash text NOT NULL CHECK(source_generation_hash ~ '^[a-f0-9]{64}$'),
  ordinal bigint NOT NULL CHECK(ordinal BETWEEN 1 AND 9007199254740991),
  revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  state text NOT NULL CHECK(state IN ('ACTIVE','DRAINING','REVOKED','UNKNOWN_HELD')),
  drain_id uuid, created_at timestamptz NOT NULL, revoked_at timestamptz,
  UNIQUE(source_kind,source_key_hash,source_generation_hash)
);
CREATE TABLE atlas_proof_authority.stage (
  stage_id uuid PRIMARY KEY, claim_hash text NOT NULL CHECK(claim_hash ~ '^[a-f0-9]{64}$'),
  operation_id uuid NOT NULL UNIQUE, operation_hash text NOT NULL CHECK(operation_hash ~ '^[a-f0-9]{64}$'),
  stage text NOT NULL CHECK(stage IN ('DECODE','PUBLISH','RETAIN')),
  publisher_session_id uuid NOT NULL, stage_revision bigint NOT NULL CHECK(stage_revision BETWEEN 1 AND 9007199254740991),
  prior_stage_id uuid REFERENCES atlas_proof_authority.stage(stage_id),
  identity jsonb NOT NULL CHECK(jsonb_typeof(identity)='object' AND octet_length(identity::text)<=16384),
  fence_ids uuid[] NOT NULL CHECK(cardinality(fence_ids) BETWEEN 1 AND 12),
  state text NOT NULL CHECK(state IN ('OUTSTANDING','SETTLED_COMPLETE','SETTLED_NO_EFFECT','UNKNOWN_HELD')),
  outcome_hash text CHECK(outcome_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL, deadline_at timestamptz NOT NULL CHECK(deadline_at>created_at AND deadline_at<=created_at+interval '60 seconds'),
  settled_at timestamptz,
  CHECK((stage='DECODE')=(prior_stage_id IS NULL))
);
CREATE UNIQUE INDEX one_unresolved_stage_per_publisher ON atlas_proof_authority.stage(publisher_session_id)
  WHERE state IN ('OUTSTANDING','UNKNOWN_HELD');
CREATE TABLE atlas_proof_authority.mutation (
  mutation_id uuid PRIMARY KEY, mutation_hash text NOT NULL CHECK(mutation_hash ~ '^[a-f0-9]{64}$'),
  kind text NOT NULL CHECK(kind IN ('STAFF_LOGOUT','CUSTOMER_LOGOUT','STAFF_IDENTITY_ACCESS','CUSTOMER_ACCOUNT_ACCESS',
    'STAFF_CONTROL_CHANGE','CUSTOMER_CONTROL_CHANGE','CUSTOMER_SERVICE_CONTROL_CHANGE','PROOF_CONTROL_CHANGE','PROOF_REVIEWER_REVOKE','PUBLISHER_SESSION_REVOKE')),
  subject_hash text NOT NULL CHECK(subject_hash ~ '^[a-f0-9]{64}$'),
  before_projection jsonb NOT NULL CHECK(jsonb_typeof(before_projection)='object' AND octet_length(before_projection::text)<=4096),
  after_projection jsonb NOT NULL CHECK(jsonb_typeof(after_projection)='object' AND octet_length(after_projection::text)<=4096),
  fence_ids uuid[] NOT NULL CHECK(cardinality(fence_ids) BETWEEN 1 AND 12),
  barrier_revision bigint NOT NULL CHECK(barrier_revision BETWEEN 1 AND 9007199254740991),
  state text NOT NULL CHECK(state IN ('DRAINING','SETTLED','APPLIED','UNKNOWN_HELD')),
  created_at timestamptz NOT NULL, applied_at timestamptz
);

-- Storage is frozen in this preparation tranche. Future transition functions
-- must replace this guard only with reviewed exact immutable-field/state rules.
-- In particular, no caller can seed ACTIVE stages to bypass the missing join.
CREATE FUNCTION atlas_proof_authority.reject_record_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'PROOF_AUTHORITY_CANONICAL_JOIN_REQUIRED'; END $$;
CREATE TRIGGER fence_frozen BEFORE INSERT OR UPDATE OR DELETE ON atlas_proof_authority.fence
  FOR EACH ROW EXECUTE FUNCTION atlas_proof_authority.reject_record_change();
CREATE TRIGGER stage_frozen BEFORE INSERT OR UPDATE OR DELETE ON atlas_proof_authority.stage
  FOR EACH ROW EXECUTE FUNCTION atlas_proof_authority.reject_record_change();
CREATE TRIGGER mutation_frozen BEFORE INSERT OR UPDATE OR DELETE ON atlas_proof_authority.mutation
  FOR EACH ROW EXECUTE FUNCTION atlas_proof_authority.reject_record_change();
CREATE TRIGGER control_frozen BEFORE INSERT OR UPDATE OR DELETE ON atlas_proof_authority.control
  FOR EACH ROW EXECUTE FUNCTION atlas_proof_authority.reject_record_change();

CREATE FUNCTION atlas_proof_authority.observation_v1(missing boolean) RETURNS jsonb
LANGUAGE sql SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('schema','atlas-proof-authority-observation-v1','classification','UNQUALIFIED','authority',false,
    'status',CASE WHEN missing THEN 'ABSENT_HOLD' ELSE 'UNAVAILABLE' END,
    'reason',CASE WHEN missing THEN 'NO_ORIGINAL_RECORD' ELSE 'CANONICAL_JOIN_REQUIRED' END,'requestHash',NULL)
$$;
CREATE FUNCTION atlas_proof_authority.exact_object_v1(d jsonb,keys text[]) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>16384
    OR d-keys<>'{}'::jsonb OR NOT d ?& keys
  THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PROTOCOL_INVALID'; END IF;
END $$;

-- Real canonical locks only, never caller-reported rows. Returning from this
-- helper DOES NOT authorize anything: the registry mapping, genuine proof grant
-- and request producer are deliberately still missing. No phone list argument.
CREATE FUNCTION atlas_proof_authority.lock_canonical_rows_v1(d jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c record;s record;b record;i record;t timestamptz;cfg jsonb:=d->'configBinding';
BEGIN
  PERFORM atlas_proof_authority.exact_object_v1(cfg,ARRAY['mode','origin','deploymentId','releaseSha','configHash']);
  IF d->>'source' NOT IN ('STAFF','CUSTOMER') OR jsonb_typeof(d->'source') IS DISTINCT FROM 'string'
    OR jsonb_typeof(d->'sessionHash') IS DISTINCT FROM 'string' OR (d->>'sessionHash') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(d->'browserHash') IS DISTINCT FROM 'string' OR (d->>'browserHash') !~ '^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PROTOCOL_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-access-v1',0));
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-proof-authority-v1',0));
  PERFORM 1 FROM atlas_proof_authority.control WHERE id='active' FOR SHARE;
  IF d->>'source'='STAFF' THEN
    SELECT * INTO c FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
    SELECT * INTO s FROM atlas_staff."StaffSession" WHERE "tokenHash"=d->>'sessionHash' FOR SHARE;
    SELECT * INTO b FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=d->>'browserHash' FOR SHARE;
    SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=s."identityId" FOR SHARE;
  ELSE
    SELECT * INTO c FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
    SELECT * INTO s FROM atlas_customer."CustomerSession" WHERE "tokenHash"=d->>'sessionHash' FOR SHARE;
    SELECT * INTO b FROM atlas_customer."CustomerBrowser" WHERE "tokenHash"=d->>'browserHash' FOR SHARE;
    SELECT * INTO i FROM atlas_customer."CustomerAccount" WHERE id=s."accountId" FOR SHARE;
    PERFORM 1 FROM atlas_customer."CustomerServiceControl" WHERE id='active' FOR SHARE;
  END IF;
  t:=clock_timestamp();
  IF c.id IS NULL OR s."tokenHash" IS NULL OR b."tokenHash" IS NULL OR i.id IS NULL
    OR c.enabled IS DISTINCT FROM true
    OR (cfg->>'mode',cfg->>'origin',cfg->>'deploymentId',cfg->>'releaseSha',cfg->>'configHash') IS DISTINCT FROM
       (c.mode,c.origin,c."deploymentId",c."releaseSha",c."configHash")
    OR s."browserHash" IS DISTINCT FROM b."tokenHash" OR s."revokedAt" IS NOT NULL OR i."revokedAt" IS NOT NULL
    OR s."accessVersion" IS DISTINCT FROM i."accessVersion" OR s."controlRevision" IS DISTINCT FROM c.revision OR b."controlRevision" IS DISTINCT FROM c.revision
  THEN RAISE EXCEPTION 'PROOF_AUTHORITY_CANONICAL_ACCESS_REFUSED'; END IF;
  -- Staff timestamps are timestamp without time zone storing UTC. Do not use
  -- the session TimeZone to silently extend their expiry.
  IF d->>'source'='STAFF' THEN
    IF i.role IS DISTINCT FROM 'REVIEWER' OR s."createdAt">(t AT TIME ZONE 'UTC') OR b."createdAt">(t AT TIME ZONE 'UTC')
      OR s."expiresAt"<=(t AT TIME ZONE 'UTC') OR b."expiresAt"<=(t AT TIME ZONE 'UTC')
    THEN RAISE EXCEPTION 'PROOF_AUTHORITY_CANONICAL_ACCESS_REFUSED'; END IF;
  ELSE
    IF s."createdAt">t OR b."createdAt">t OR s."expiresAt"<=t OR b."expiresAt"<=t
    THEN RAISE EXCEPTION 'PROOF_AUTHORITY_CANONICAL_ACCESS_REFUSED'; END IF;
  END IF;
END $$;

CREATE FUNCTION atlas_proof_authority.claim_stage_v1(d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM atlas_proof_authority.exact_object_v1(d,ARRAY['schema','installationId','requestId','requestBindingHash','source','sessionHash','browserHash','configBinding','originalRequestDeadlineAt','stageId','stage','priorStageId','stageInput']);
  IF d->>'schema' IS DISTINCT FROM 'atlas-proof-stage-claim-v1' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PROTOCOL_INVALID'; END IF;
  PERFORM atlas_proof_authority.lock_canonical_rows_v1(d);
  -- Required future body: actual roster/policy/grant, fresh time/fences, immutable
  -- predecessor, DB-derived FULL C1 RETAIN identity/fence, same-tx stage insert.
  -- Neither the private producer nor all revocation writers exist in this SQL.
  RETURN atlas_proof_authority.observation_v1(false);
END $$;
CREATE FUNCTION atlas_proof_authority.begin_logout_v1(d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM atlas_proof_authority.exact_object_v1(d,ARRAY['schema','requestId','requestBindingHash','source','sessionHash','browserHash','configBinding','mutationId']);
  IF d->>'schema' IS DISTINCT FROM 'atlas-proof-logout-begin-v1' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PROTOCOL_INVALID'; END IF;
  PERFORM atlas_proof_authority.lock_canonical_rows_v1(d);
  -- Never acknowledge logout without the missing durable drain/owner/C1 join.
  RETURN atlas_proof_authority.observation_v1(false);
END $$;
CREATE FUNCTION atlas_proof_authority.lookup_stage_v1(id uuid,h text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r atlas_proof_authority.stage;
BEGIN
  IF id IS NULL OR h IS NULL OR h !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PROTOCOL_INVALID'; END IF;
  SELECT * INTO r FROM atlas_proof_authority.stage WHERE stage_id=id;
  IF r.stage_id IS NULL THEN RETURN atlas_proof_authority.observation_v1(true); END IF;
  IF r.operation_hash<>h THEN RAISE EXCEPTION 'PROOF_AUTHORITY_ID_CONFLICT'; END IF;
  RAISE EXCEPTION 'PROOF_AUTHORITY_EXISTING_RECORD_HOLD'; -- no JSON rebranding
END $$;
CREATE FUNCTION atlas_proof_authority.lookup_claim_v1(id uuid,h text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r atlas_proof_authority.stage;
BEGIN
  IF id IS NULL OR h IS NULL OR h !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PROTOCOL_INVALID'; END IF;
  SELECT * INTO r FROM atlas_proof_authority.stage WHERE stage_id=id;
  IF r.stage_id IS NULL THEN RETURN atlas_proof_authority.observation_v1(true); END IF;
  IF r.claim_hash<>h THEN RAISE EXCEPTION 'PROOF_AUTHORITY_ID_CONFLICT'; END IF;
  RAISE EXCEPTION 'PROOF_AUTHORITY_EXISTING_RECORD_HOLD';
END $$;
CREATE FUNCTION atlas_proof_authority.read_drain_v1(id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF id IS NULL THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PROTOCOL_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM atlas_proof_authority.mutation WHERE mutation_id=id) THEN RAISE EXCEPTION 'PROOF_AUTHORITY_EXISTING_RECORD_HOLD'; END IF;
  RETURN atlas_proof_authority.observation_v1(true);
END $$;
CREATE FUNCTION atlas_proof_authority.settle_stage_v1(d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM atlas_proof_authority.exact_object_v1(d,ARRAY['schema','installationId','stageId','operationHash','settlementId','disposition','outcomeHash','publisherBarrierId','publisherBarrierRevision']);
  IF d->>'schema' IS DISTINCT FROM 'atlas-proof-stage-settle-v1' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PROTOCOL_INVALID'; END IF;
  RETURN atlas_proof_authority.observation_v1(false); -- genuine owner producer missing
END $$;
CREATE FUNCTION atlas_proof_authority.begin_mutation_v1(d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM atlas_proof_authority.exact_object_v1(d,ARRAY['schema','mutationId','kind','subjectId','expectedBeforeHash','change','operatorAuthorityRef']);
  IF d->>'schema' IS DISTINCT FROM 'atlas-proof-mutation-begin-v1' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PROTOCOL_INVALID'; END IF;
  RETURN atlas_proof_authority.observation_v1(false); -- operator hash is not authority
END $$;
CREATE FUNCTION atlas_proof_authority.apply_mutation_v1(id uuid,h text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF id IS NULL OR h IS NULL OR h !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PROTOCOL_INVALID'; END IF;
  RETURN atlas_proof_authority.observation_v1(false); -- no logout/access mutation
END $$;

-- This rejection trigger is NOT attached to canonical tables in this tranche:
-- attaching an unconditional refusal would break the current logout/issuance
-- paths without providing their replacement. It is not a completed writer hook.
-- Integration must use exact OLD/NEW protected projections and a private
-- transaction/backend-bound permit created by reviewed apply_mutation, never a
-- caller GUC. Triggers must not acquire upstream locks after a DML row lock.
CREATE FUNCTION atlas_proof_authority.reject_unjoined_authority_write() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'PROOF_AUTHORITY_DRAIN_REQUIRED'; END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA atlas_proof_authority FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_proof_authority FROM PUBLIC;
COMMIT;
