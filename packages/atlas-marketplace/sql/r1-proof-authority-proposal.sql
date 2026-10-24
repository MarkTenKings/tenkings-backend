-- INERT SOURCE PREPARATION. NOT a migration, installed gateway or permission.
-- The first exception is intentional. Never remove it in application code.
-- Executable source tranche: closed claim/settle and two-phase logout with
-- exact transaction permits. Installation is still a separate root operation.
-- Empty installed policy/qualification/publisher binding and reviewer grants
-- keep admission disabled. Administrative access changes require their genuine
-- canonical human operations boundary; no hash-only replacement is accepted.
BEGIN;
DO $$ BEGIN RAISE EXCEPTION 'R1_PROOF_AUTHORITY_PROPOSAL_NOT_APPROVED'; END $$;

CREATE SCHEMA atlas_proof_authority;
REVOKE ALL ON SCHEMA atlas_proof_authority FROM PUBLIC;

CREATE TABLE atlas_proof_authority.control (
  id text PRIMARY KEY CHECK(id='active'),
  enabled boolean NOT NULL DEFAULT false,
  integration text NOT NULL DEFAULT 'CANONICAL_JOIN_REQUIRED' CHECK(integration IN ('CANONICAL_JOIN_REQUIRED','INSTALLED')),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 9007199254740991),
  max_open_stages integer NOT NULL DEFAULT 1 CHECK(max_open_stages=1),
  max_stages integer NOT NULL DEFAULT 4096 CHECK(max_stages BETWEEN 1 AND 4096),
  max_fences integer NOT NULL DEFAULT 16384 CHECK(max_fences BETWEEN 1 AND 16384),
  max_mutations integer NOT NULL DEFAULT 4096 CHECK(max_mutations BETWEEN 1 AND 4096),
  active_installation_id uuid,
  CHECK(NOT enabled OR integration='INSTALLED' AND active_installation_id IS NOT NULL)
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
  settled_at timestamptz, settlement_id uuid, settlement_hash text,
  claim jsonb NOT NULL, report jsonb NOT NULL,
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
  fence_ids uuid[] NOT NULL CHECK(cardinality(fence_ids) BETWEEN 0 AND 12),
  barrier_revision bigint NOT NULL CHECK(barrier_revision BETWEEN 1 AND 9007199254740991),
  state text NOT NULL CHECK(state IN ('DRAINING','SETTLED','APPLIED','UNKNOWN_HELD')),
  created_at timestamptz NOT NULL, applied_at timestamptz,
  request_hash text NOT NULL, publisher_session_id uuid NOT NULL, barrier_hash text
);

-- Empty until the canonical installer binds the accepted policy, exact source
-- closure, actual target qualification and already-open owned publisher. No
-- serving role has table or installer access. An enabled JSON document is not
-- an installation and cannot populate these rows.
CREATE TABLE atlas_proof_authority.installation (
  installation_id uuid PRIMARY KEY, publisher_session_id uuid NOT NULL UNIQUE,
  publisher_ledger_id uuid NOT NULL, session_binding jsonb NOT NULL,
  intake_binding jsonb NOT NULL, staff_binding jsonb NOT NULL, customer_binding jsonb NOT NULL,
  installed_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  CHECK(expires_at>installed_at), CHECK(octet_length(session_binding::text)<=4096)
);
CREATE TABLE atlas_proof_authority.reviewer_grant (
  identity_id uuid NOT NULL, installation_id uuid NOT NULL REFERENCES atlas_proof_authority.installation,
  access_version integer NOT NULL, policy_hash text NOT NULL CHECK(policy_hash ~ '^[a-f0-9]{64}$'),
  revoked_at timestamptz, PRIMARY KEY(identity_id,installation_id)
);
-- A permit is exact OLD/NEW row data, transaction/backend bound, and consumed
-- once by a fixed trigger. No session setting, role-name or owner shortcut.
CREATE TABLE atlas_proof_authority.write_permit (
  transaction_id xid8 NOT NULL, backend_id integer NOT NULL, relation_id oid NOT NULL,
  before_row jsonb NOT NULL, after_row jsonb NOT NULL, mutation_id uuid NOT NULL,
  PRIMARY KEY(transaction_id,backend_id,relation_id,mutation_id)
);
CREATE FUNCTION atlas_proof_authority.canonical_v1(v jsonb, depth integer DEFAULT 0) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE kind text; result text; number numeric;
BEGIN
  IF v IS NULL OR depth>16 OR depth<0 OR octet_length(v::text)>32768 THEN RAISE EXCEPTION 'PROOF_AUTHORITY_ENCODING'; END IF;
  kind:=jsonb_typeof(v);
  IF kind='object' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k !~ '^[A-Za-z0-9_]+$') THEN RAISE EXCEPTION 'PROOF_AUTHORITY_ENCODING'; END IF;
    SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||atlas_proof_authority.canonical_v1(value,depth+1),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(v);
  ELSIF kind='array' THEN
    SELECT '['||coalesce(string_agg(atlas_proof_authority.canonical_v1(value,depth+1),',' ORDER BY n),'')||']' INTO result FROM jsonb_array_elements(v) WITH ORDINALITY a(value,n);
  ELSIF kind='number' THEN
    number:=(v#>>'{}')::numeric;
    IF trunc(number)<>number OR abs(number)>9007199254740991 THEN RAISE EXCEPTION 'PROOF_AUTHORITY_ENCODING'; END IF;
    result:=number::bigint::text;
  ELSE result:=v::text; END IF;
  RETURN result;
END $$;
CREATE FUNCTION atlas_proof_authority.hash_v1(v jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(atlas_proof_authority.canonical_v1(v),'UTF8')),'hex')
$$;
CREATE FUNCTION atlas_proof_authority.fence_report_v1(f atlas_proof_authority.fence) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('fenceId',f.fence_id,'sourceKind',CASE
 WHEN f.source_kind LIKE '%SESSION' AND f.source_kind<>'PUBLISHER_SESSION' THEN 'SESSION'
 WHEN f.source_kind LIKE '%BROWSER' THEN 'BROWSER'
 WHEN f.source_kind IN ('STAFF_IDENTITY','CUSTOMER_ACCOUNT') THEN 'ACCESS'
 WHEN f.source_kind='PROOF_CONTROL' THEN 'POLICY'
 WHEN f.source_kind='PROOF_REVIEWER_GRANT' THEN 'STAFF'
 WHEN f.source_kind='PUBLISHER_SESSION' THEN 'PUBLISHER' ELSE 'CONTROL' END,
 'sourceKeyHash',f.source_key_hash,'sourceGenerationHash',f.source_generation_hash,'ordinal',f.ordinal,'revision',f.revision)
$$;
CREATE FUNCTION atlas_proof_authority.record_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_RETAINED_HISTORY'; END IF;
 IF TG_TABLE_NAME IN ('installation','reviewer_grant') AND TG_OP='UPDATE' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_INSTALLATION_IMMUTABLE'; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='fence' THEN
   IF (to_jsonb(OLD)-ARRAY['state','drain_id','revoked_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['state','drain_id','revoked_at'])
     OR NOT ((OLD.state='ACTIVE' AND NEW.state IN ('DRAINING','UNKNOWN_HELD')) OR (OLD.state='DRAINING' AND NEW.state IN ('REVOKED','UNKNOWN_HELD')))
   THEN RAISE EXCEPTION 'PROOF_AUTHORITY_FENCE_TRANSITION'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='stage' THEN
   IF (to_jsonb(OLD)-ARRAY['state','outcome_hash','settled_at','settlement_id','settlement_hash','report']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['state','outcome_hash','settled_at','settlement_id','settlement_hash','report'])
     OR OLD.state<>'OUTSTANDING' OR NEW.state NOT IN ('SETTLED_COMPLETE','SETTLED_NO_EFFECT','UNKNOWN_HELD')
     OR (OLD.report-'state') IS DISTINCT FROM (NEW.report-'state') OR NEW.report->>'state' IS DISTINCT FROM NEW.state
   THEN RAISE EXCEPTION 'PROOF_AUTHORITY_STAGE_TRANSITION'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='mutation' THEN
   IF (to_jsonb(OLD)-ARRAY['state','applied_at','barrier_hash']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['state','applied_at','barrier_hash'])
     OR NOT ((OLD.state='DRAINING' AND NEW.state IN ('SETTLED','UNKNOWN_HELD')) OR (OLD.state='SETTLED' AND NEW.state IN ('APPLIED','UNKNOWN_HELD')))
   THEN RAISE EXCEPTION 'PROOF_AUTHORITY_MUTATION_TRANSITION'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['installation','reviewer_grant','fence','stage','mutation'] LOOP
  EXECUTE format('CREATE TRIGGER authority_history BEFORE UPDATE OR DELETE ON atlas_proof_authority.%I FOR EACH ROW EXECUTE FUNCTION atlas_proof_authority.record_guard_v1()',name);
  EXECUTE format('CREATE TRIGGER authority_no_truncate BEFORE TRUNCATE ON atlas_proof_authority.%I FOR EACH STATEMENT EXECUTE FUNCTION atlas_proof_authority.record_guard_v1()',name);
 END LOOP;
END $$;

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
-- helper DOES NOT authorize anything. The claim function must additionally
-- bind the installed policy/grants and the live canonical request producer.
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
<<proof_claim>>
DECLARE ctl atlas_proof_authority.control; ins atlas_proof_authority.installation;
 prior atlas_proof_authority.stage; existing atlas_proof_authority.stage;
 f atlas_proof_authority.fence; grant_row atlas_proof_authority.reviewer_grant;
 rows jsonb; source_row jsonb; session_row jsonb; actor jsonb; browser_row jsonb; service_row jsonb;
 source_kind text; source_key text; key_hash text; generation_hash text; k text; ids uuid[]:='{}'; fences jsonb:='[]';
 x jsonb:=d->'stageInput'; claim_hash text; actor_hash text; stage_binding jsonb; report jsonb; operation jsonb; operation_id uuid;
 stage_name text:=d->>'stage'; next_revision bigint; t timestamptz; deadline_ms bigint; access_until bigint; boot text; boot_deadline text;
 common_keys constant text[]:=ARRAY['uploadId','proofId','orderId','orderHash','originalRequestHash','intakeBindingHash','originalSha256','originalByteCount','validationAttemptId','decoderRequestId'];
 expected text[];
BEGIN
 PERFORM atlas_proof_authority.exact_object_v1(d,ARRAY['schema','installationId','requestId','requestBindingHash','source','sessionHash','browserHash','configBinding','originalRequestDeadlineAt','stageId','stage','priorStageId','stageInput']);
 IF d->>'schema'<>'atlas-proof-stage-claim-v1' OR stage_name NOT IN ('DECODE','PUBLISH','RETAIN') THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PROTOCOL_INVALID'; END IF;
 expected:=common_keys||CASE stage_name
 WHEN 'DECODE' THEN ARRAY['declaredType','originalBootId','deadlineBootNs','preparedReportHash']
 WHEN 'PUBLISH' THEN ARRAY['publicationOperationId','objectKey','manifestHash','decoderCompletionHash','publicationIntentHash']
 ELSE ARRAY['operationId','objectKey','manifestHash','publicationLedgerId','publicationSessionId','publicationOperationId','publicationRevision','publicationEvidenceHash','qualificationSessionId','expectedUploadHash'] END;
 PERFORM atlas_proof_authority.exact_object_v1(x,expected);
 claim_hash:=atlas_proof_authority.hash_v1(d);
 PERFORM atlas_proof_authority.lock_canonical_rows_v1(d);
 SELECT * INTO STRICT ctl FROM atlas_proof_authority.control WHERE id='active' FOR UPDATE;
 IF NOT ctl.enabled OR ctl.integration<>'INSTALLED' THEN RETURN atlas_proof_authority.observation_v1(false); END IF;
 SELECT * INTO ins FROM atlas_proof_authority.installation WHERE installation_id=(d->>'installationId')::uuid FOR SHARE;
 t:=clock_timestamp();
 IF ins.installation_id IS NULL OR ins.installation_id IS DISTINCT FROM ctl.active_installation_id OR ins.installed_at>t OR ins.expires_at<=t
  OR ins.session_binding->>'installationId'<>ins.installation_id::text
  OR ins.session_binding->>'intakeBindingHash'<>atlas_proof_authority.hash_v1(ins.intake_binding)
  OR ins.session_binding->'policyHash' IS DISTINCT FROM ins.intake_binding->'policyHash'
  OR x->>'intakeBindingHash'<>ins.session_binding->>'intakeBindingHash'
  OR d->'configBinding' IS DISTINCT FROM (CASE WHEN d->>'source'='STAFF' THEN ins.staff_binding ELSE ins.customer_binding END)
 THEN RAISE EXCEPTION 'PROOF_AUTHORITY_INSTALLATION_REQUIRED'; END IF;
 SELECT * INTO existing FROM atlas_proof_authority.stage WHERE stage_id=(d->>'stageId')::uuid FOR UPDATE;
 IF FOUND THEN
  IF existing.claim_hash<>claim_hash THEN RAISE EXCEPTION 'PROOF_AUTHORITY_ID_CONFLICT'; END IF;
  RETURN existing.report;
 END IF;
 IF (SELECT count(*) FROM atlas_proof_authority.stage)>=ctl.max_stages
  OR EXISTS(SELECT 1 FROM atlas_proof_authority.stage WHERE publisher_session_id=ins.publisher_session_id AND state IN ('OUTSTANDING','UNKNOWN_HELD'))
 THEN RAISE EXCEPTION 'PROOF_AUTHORITY_CAPACITY_HOLD'; END IF;
 IF d->>'source'='STAFF' THEN
  SELECT to_jsonb(s) INTO session_row FROM atlas_staff."StaffSession" s WHERE "tokenHash"=d->>'sessionHash';
  SELECT to_jsonb(a)-ARRAY['phone','phoneHash','lastLoginAt','updatedAt','createdAt'] INTO actor FROM atlas_staff."StaffIdentity" a WHERE id=(session_row->>'identityId')::uuid;
  SELECT to_jsonb(b) INTO browser_row FROM atlas_staff."StaffBrowser" b WHERE "tokenHash"=d->>'browserHash';
  SELECT to_jsonb(c) INTO source_row FROM atlas_staff."StaffControl" c WHERE id='active';
  SELECT * INTO grant_row FROM atlas_proof_authority.reviewer_grant WHERE identity_id=(actor->>'id')::uuid AND installation_id=ins.installation_id FOR SHARE;
  IF grant_row.identity_id IS NULL OR grant_row.revoked_at IS NOT NULL OR grant_row.access_version<>(actor->>'accessVersion')::integer OR grant_row.policy_hash<>ins.session_binding->>'policyHash' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_REVIEWER_GRANT_REQUIRED'; END IF;
  access_until:=floor(extract(epoch FROM least((session_row->>'expiresAt')::timestamp AT TIME ZONE 'UTC',(browser_row->>'expiresAt')::timestamp AT TIME ZONE 'UTC'))*1000);
  rows:=jsonb_build_object('STAFF_CONTROL',source_row,'STAFF_IDENTITY',actor,'STAFF_SESSION',session_row,'STAFF_BROWSER',browser_row,'PROOF_REVIEWER_GRANT',to_jsonb(grant_row));
 ELSE
  SELECT to_jsonb(s) INTO session_row FROM atlas_customer."CustomerSession" s WHERE "tokenHash"=d->>'sessionHash';
  SELECT to_jsonb(a)-ARRAY['phone','phoneHash','profile','lastLoginAt','createdAt'] INTO actor FROM atlas_customer."CustomerAccount" a WHERE id=(session_row->>'accountId')::uuid;
  SELECT to_jsonb(b) INTO browser_row FROM atlas_customer."CustomerBrowser" b WHERE "tokenHash"=d->>'browserHash';
  SELECT to_jsonb(c) INTO source_row FROM atlas_customer."CustomerControl" c WHERE id='active';
  SELECT to_jsonb(c) INTO service_row FROM atlas_customer."CustomerServiceControl" c WHERE id='active';
  IF service_row->'enabled' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'PROOF_AUTHORITY_CANONICAL_ACCESS_REFUSED'; END IF;
  access_until:=floor(extract(epoch FROM least((session_row->>'expiresAt')::timestamptz,(browser_row->>'expiresAt')::timestamptz))*1000);
  rows:=jsonb_build_object('CUSTOMER_CONTROL',source_row,'CUSTOMER_ACCOUNT',actor,'CUSTOMER_SESSION',session_row,'CUSTOMER_BROWSER',browser_row,'CUSTOMER_SERVICE_CONTROL',service_row);
 END IF;
 actor_hash:=atlas_proof_authority.hash_v1(jsonb_build_object('schema','atlas-proof-actor-access-v1','source',d->'source','actor',actor,'session',session_row,'browser',browser_row,'control',source_row,'service',service_row,'reviewerGrant',CASE WHEN d->>'source'='STAFF' THEN to_jsonb(grant_row) ELSE NULL END,'installation',ins.session_binding,'requestId',d->'requestId','requestBindingHash',d->'requestBindingHash','config',d->'configBinding'));
 deadline_ms:=least((d->>'originalRequestDeadlineAt')::bigint,access_until,floor(extract(epoch FROM ins.expires_at)*1000)::bigint);
 IF deadline_ms<=floor(extract(epoch FROM t)*1000) OR deadline_ms>floor(extract(epoch FROM t+interval '60 seconds')*1000) THEN RAISE EXCEPTION 'PROOF_AUTHORITY_REQUEST_EXPIRED'; END IF;
 IF stage_name='DECODE' THEN
  IF d->'priorStageId'<>'null'::jsonb THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PREDECESSOR'; END IF;
  boot:=x->>'originalBootId';boot_deadline:=x->>'deadlineBootNs';operation_id:=(x->>'decoderRequestId')::uuid;
 ELSE
  SELECT * INTO prior FROM atlas_proof_authority.stage WHERE stage_id=(d->>'priorStageId')::uuid FOR UPDATE;
  IF prior.stage_id IS NULL OR prior.state<>'SETTLED_COMPLETE' OR prior.stage<>(CASE WHEN stage_name='PUBLISH' THEN 'DECODE' ELSE 'PUBLISH' END)
   OR prior.publisher_session_id<>ins.publisher_session_id OR prior.claim->'requestId' IS DISTINCT FROM d->'requestId'
   OR prior.claim->'requestBindingHash' IS DISTINCT FROM d->'requestBindingHash' OR prior.claim->'sessionHash' IS DISTINCT FROM d->'sessionHash'
   OR prior.report->'stageBinding'->>'actorAccessBindingHash'<>actor_hash
  THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PREDECESSOR'; END IF;
  FOREACH k IN ARRAY common_keys LOOP
   IF prior.claim->'stageInput'->k IS DISTINCT FROM x->k THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PREDECESSOR'; END IF;
  END LOOP;
  boot:=prior.report->'stageBinding'->>'bootId';boot_deadline:=prior.report->'stageBinding'->>'deadlineBootNs';
  operation_id:=CASE WHEN stage_name='RETAIN' THEN (x->>'operationId')::uuid ELSE (x->>'publicationOperationId')::uuid END;
 END IF;
 next_revision:=ctl.revision+1;
 UPDATE atlas_proof_authority.control SET revision=next_revision WHERE id='active';
 rows:=rows||jsonb_build_object('PROOF_CONTROL',ins.session_binding,'PUBLISHER_SESSION',jsonb_build_object('sessionId',ins.publisher_session_id));
 FOR source_kind,source_row IN SELECT key,value FROM jsonb_each(rows) ORDER BY key COLLATE "C" LOOP
  source_key:=CASE WHEN source_kind LIKE '%SESSION' THEN coalesce(source_row->>'tokenHash',source_row->>'sessionId') WHEN source_kind LIKE '%BROWSER' THEN source_row->>'tokenHash' WHEN source_kind IN ('STAFF_IDENTITY','CUSTOMER_ACCOUNT') THEN actor->>'id' WHEN source_kind='PROOF_REVIEWER_GRANT' THEN actor->>'id' ELSE 'active' END;
  key_hash:=atlas_proof_authority.hash_v1(jsonb_build_object('kind',source_kind,'key',source_key));generation_hash:=atlas_proof_authority.hash_v1(source_row);
  SELECT * INTO f FROM atlas_proof_authority.fence f1 WHERE f1.source_kind=proof_claim.source_kind AND f1.source_key_hash=key_hash AND f1.source_generation_hash=generation_hash FOR UPDATE;
  IF FOUND THEN
   IF f.state<>'ACTIVE' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_DRAIN_REQUIRED'; END IF;
  ELSE
   IF (SELECT count(*) FROM atlas_proof_authority.fence)>=ctl.max_fences THEN RAISE EXCEPTION 'PROOF_AUTHORITY_CAPACITY_HOLD'; END IF;
   INSERT INTO atlas_proof_authority.fence VALUES(gen_random_uuid(),source_kind,key_hash,generation_hash,coalesce((SELECT max(ordinal)+1 FROM atlas_proof_authority.fence f0 WHERE f0.source_kind=proof_claim.source_kind AND f0.source_key_hash=key_hash),1),next_revision,'ACTIVE',NULL,t,NULL) RETURNING * INTO f;
  END IF;
  ids:=array_append(ids,f.fence_id);fences:=fences||jsonb_build_array(atlas_proof_authority.fence_report_v1(f));
 END LOOP;
 SELECT jsonb_agg(value ORDER BY value->>'fenceId') INTO fences FROM jsonb_array_elements(fences);
 operation:=x;
 IF stage_name='RETAIN' THEN
  IF x->>'publicationLedgerId'<>ins.publisher_ledger_id::text OR x->>'publicationSessionId'<>ins.publisher_session_id::text
   OR x->>'qualificationSessionId'<>ins.session_binding->>'qualificationSessionId' OR x->'publicationOperationId' IS DISTINCT FROM prior.claim->'stageInput'->'publicationOperationId'
   OR x->'objectKey' IS DISTINCT FROM prior.claim->'stageInput'->'objectKey' OR x->'manifestHash' IS DISTINCT FROM prior.claim->'stageInput'->'manifestHash'
  THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PUBLICATION_BINDING'; END IF;
  operation:=x||jsonb_build_object('schema','atlas-proof-retention-operation-v1','actorId',actor->'id','actorRole',CASE WHEN d->>'source'='STAFF' THEN 'STAFF' ELSE 'BUYER' END,'actorAccessBindingHash',actor_hash,'policyHash',ins.session_binding->'policyHash','retentionFenceRevision',next_revision);
 END IF;
 stage_binding:=ins.session_binding||jsonb_build_object('stageId',d->'stageId','stageRevision',next_revision,'requestId',d->'requestId','requestBindingHash',d->'requestBindingHash','actorAccessBindingHash',actor_hash,'operationHash',atlas_proof_authority.hash_v1(operation),'bootId',boot,'deadlineBootNs',boot_deadline,'fences',fences);
 report:=jsonb_build_object('schema','atlas-proof-stage-report-v1','classification','UNQUALIFIED','authority',false,'requestHash',claim_hash,'stage',stage_name,'state','OUTSTANDING','stageBinding',stage_binding,'operationId',operation_id,'retentionOperation',CASE WHEN stage_name='RETAIN' THEN operation ELSE NULL END,'intakeBinding',ins.intake_binding,'publisherSessionId',ins.publisher_session_id,'deadlineAt',deadline_ms,'observedAt',floor(extract(epoch FROM t)*1000)::bigint);
 INSERT INTO atlas_proof_authority.stage(stage_id,claim_hash,operation_id,operation_hash,stage,publisher_session_id,stage_revision,prior_stage_id,identity,fence_ids,state,created_at,deadline_at,claim,report)
 VALUES((d->>'stageId')::uuid,claim_hash,operation_id,stage_binding->>'operationHash',stage_name,ins.publisher_session_id,next_revision,(d->>'priorStageId')::uuid,jsonb_build_object('actorId',actor->'id','actorAccessBindingHash',actor_hash),ids,'OUTSTANDING',t,to_timestamp(deadline_ms/1000.0),d,report);
 IF floor(extract(epoch FROM clock_timestamp())*1000)>=deadline_ms THEN RAISE EXCEPTION 'PROOF_AUTHORITY_REQUEST_EXPIRED'; END IF;
 RETURN report;
END $$;
CREATE FUNCTION atlas_proof_authority.lookup_stage_v1(id uuid,h text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r atlas_proof_authority.stage;
BEGIN
 SELECT * INTO r FROM atlas_proof_authority.stage WHERE stage_id=id;
 IF r.stage_id IS NULL THEN RETURN atlas_proof_authority.observation_v1(true); END IF;
 IF r.operation_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'PROOF_AUTHORITY_ID_CONFLICT'; END IF;
 RETURN r.report;
END $$;
CREATE FUNCTION atlas_proof_authority.lookup_claim_v1(id uuid,h text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r atlas_proof_authority.stage;
BEGIN
 SELECT * INTO r FROM atlas_proof_authority.stage WHERE stage_id=id;
 IF r.stage_id IS NULL THEN RETURN atlas_proof_authority.observation_v1(true); END IF;
 IF r.claim_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'PROOF_AUTHORITY_ID_CONFLICT'; END IF;
 RETURN r.report;
END $$;
CREATE FUNCTION atlas_proof_authority.settle_stage_v1(d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r atlas_proof_authority.stage; h text; next_state text;
BEGIN
 PERFORM atlas_proof_authority.exact_object_v1(d,ARRAY['schema','installationId','stageId','operationHash','settlementId','disposition','outcomeHash','publisherBarrierId','publisherBarrierRevision']);
 IF d->>'schema'<>'atlas-proof-stage-settle-v1' OR d->>'disposition' NOT IN ('COMPLETE','NO_EFFECT','UNKNOWN_HELD') OR d->>'outcomeHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PROTOCOL_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-proof-authority-v1',0));
 SELECT * INTO r FROM atlas_proof_authority.stage WHERE stage_id=(d->>'stageId')::uuid FOR UPDATE;
 IF r.stage_id IS NULL THEN RETURN atlas_proof_authority.observation_v1(true); END IF;
 IF r.operation_hash<>d->>'operationHash' OR r.claim->'installationId' IS DISTINCT FROM d->'installationId' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_ID_CONFLICT'; END IF;
 h:=atlas_proof_authority.hash_v1(d);
 IF r.settlement_hash IS NOT NULL THEN
  IF r.settlement_hash<>h THEN RAISE EXCEPTION 'PROOF_AUTHORITY_UNKNOWN_HOLD'; END IF;
  RETURN r.report||jsonb_build_object('requestHash',h);
 END IF;
 IF r.state<>'OUTSTANDING' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_UNKNOWN_HOLD'; END IF;
 IF d->'publisherBarrierId'<>'null'::jsonb AND ((d->>'publisherBarrierRevision')::bigint<=r.stage_revision OR (d->>'publisherBarrierId')::uuid IS NULL) THEN RAISE EXCEPTION 'PROOF_AUTHORITY_BARRIER_REQUIRED'; END IF;
 next_state:=CASE d->>'disposition' WHEN 'COMPLETE' THEN 'SETTLED_COMPLETE' WHEN 'NO_EFFECT' THEN 'SETTLED_NO_EFFECT' ELSE 'UNKNOWN_HELD' END;
 UPDATE atlas_proof_authority.stage SET state=next_state,outcome_hash=d->>'outcomeHash',settled_at=clock_timestamp(),settlement_id=(d->>'settlementId')::uuid,settlement_hash=h,report=jsonb_set(report,'{state}',to_jsonb(next_state)) WHERE stage_id=r.stage_id RETURNING * INTO r;
 RETURN r.report||jsonb_build_object('requestHash',h);
END $$;
CREATE FUNCTION atlas_proof_authority.read_drain_v1(id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m atlas_proof_authority.mutation; scopes jsonb; outstanding jsonb;
BEGIN
 SELECT * INTO m FROM atlas_proof_authority.mutation WHERE mutation_id=id;
 IF m.mutation_id IS NULL THEN RETURN atlas_proof_authority.observation_v1(true); END IF;
 SELECT coalesce(jsonb_agg(atlas_proof_authority.fence_report_v1(f) ORDER BY f.fence_id),'[]') INTO scopes FROM atlas_proof_authority.fence f WHERE fence_id=ANY(m.fence_ids);
 SELECT coalesce(jsonb_agg(report ORDER BY stage_id),'[]') INTO outstanding FROM atlas_proof_authority.stage WHERE fence_ids&&m.fence_ids AND state IN ('OUTSTANDING','UNKNOWN_HELD');
 IF jsonb_array_length(outstanding)>1 THEN RAISE EXCEPTION 'PROOF_AUTHORITY_DRAIN_BOUND'; END IF;
 RETURN jsonb_build_object('schema','atlas-proof-drain-report-v1','classification','UNQUALIFIED','authority',false,'requestHash',m.request_hash,'mutationId',m.mutation_id,'mutationHash',m.mutation_hash,'state',m.state,'barrierRevision',m.barrier_revision,'publisherSessionId',m.publisher_session_id,'fences',scopes,'outstandingStages',outstanding,'barrierHash',m.barrier_hash);
END $$;
CREATE FUNCTION atlas_proof_authority.begin_logout_v1(d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctl atlas_proof_authority.control; ins atlas_proof_authority.installation; m atlas_proof_authority.mutation;
 before_row jsonb; after_row jsonb; request_hash text; kind text; ids uuid[]; t timestamptz; h text;
BEGIN
 PERFORM atlas_proof_authority.exact_object_v1(d,ARRAY['schema','requestId','requestBindingHash','source','sessionHash','browserHash','configBinding','mutationId']);
 IF d->>'schema'<>'atlas-proof-logout-begin-v1' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PROTOCOL_INVALID'; END IF;
 request_hash:=atlas_proof_authority.hash_v1(d);
 -- Exact duplicate recovery is available without reauthorizing expired access.
 -- It cannot change a frozen subject, timestamp, request or mutation payload.
 SELECT * INTO m FROM atlas_proof_authority.mutation WHERE mutation_id=(d->>'mutationId')::uuid;
 IF FOUND THEN
  IF m.request_hash<>request_hash THEN RAISE EXCEPTION 'PROOF_AUTHORITY_ID_CONFLICT'; END IF;
  RETURN atlas_proof_authority.read_drain_v1(m.mutation_id);
 END IF;
 PERFORM atlas_proof_authority.lock_canonical_rows_v1(d);
 SELECT * INTO STRICT ctl FROM atlas_proof_authority.control WHERE id='active' FOR UPDATE;
 IF NOT ctl.enabled OR ctl.integration<>'INSTALLED' THEN RETURN atlas_proof_authority.observation_v1(false); END IF;
 SELECT * INTO STRICT ins FROM atlas_proof_authority.installation WHERE installation_id=ctl.active_installation_id FOR SHARE;
 IF (SELECT count(*) FROM atlas_proof_authority.mutation)>=ctl.max_mutations THEN RAISE EXCEPTION 'PROOF_AUTHORITY_CAPACITY_HOLD'; END IF;
 t:=clock_timestamp();kind:=CASE WHEN d->>'source'='STAFF' THEN 'STAFF_SESSION' ELSE 'CUSTOMER_SESSION' END;
 IF d->>'source'='STAFF' THEN
  SELECT to_jsonb(s) INTO STRICT before_row FROM atlas_staff."StaffSession" s WHERE "tokenHash"=d->>'sessionHash' FOR UPDATE;
  after_row:=jsonb_set(before_row,'{revokedAt}',to_jsonb(t AT TIME ZONE 'UTC'));
 ELSE
  SELECT to_jsonb(s) INTO STRICT before_row FROM atlas_customer."CustomerSession" s WHERE "tokenHash"=d->>'sessionHash' FOR UPDATE;
  after_row:=jsonb_set(before_row,'{revokedAt}',to_jsonb(t));
 END IF;
 h:=atlas_proof_authority.hash_v1(jsonb_build_object('kind',kind,'key',d->'sessionHash'));
 PERFORM 1 FROM atlas_proof_authority.fence WHERE source_kind=kind AND source_key_hash=h ORDER BY fence_id FOR UPDATE;
 SELECT coalesce(array_agg(fence_id ORDER BY fence_id),'{}') INTO ids FROM atlas_proof_authority.fence WHERE source_kind=kind AND source_key_hash=h AND state='ACTIVE';
 IF EXISTS(SELECT 1 FROM atlas_proof_authority.fence WHERE source_kind=kind AND source_key_hash=h AND state IN ('DRAINING','UNKNOWN_HELD')) THEN RAISE EXCEPTION 'PROOF_AUTHORITY_DRAIN_REQUIRED'; END IF;
 UPDATE atlas_proof_authority.control SET revision=revision+1 WHERE id='active' RETURNING * INTO ctl;
 h:=atlas_proof_authority.hash_v1(jsonb_build_object('requestHash',request_hash,'before',before_row,'after',after_row,'barrierRevision',ctl.revision));
 INSERT INTO atlas_proof_authority.mutation(mutation_id,mutation_hash,kind,subject_hash,before_projection,after_projection,fence_ids,barrier_revision,state,created_at,request_hash,publisher_session_id)
 VALUES((d->>'mutationId')::uuid,h,CASE WHEN d->>'source'='STAFF' THEN 'STAFF_LOGOUT' ELSE 'CUSTOMER_LOGOUT' END,d->>'sessionHash',before_row,after_row,ids,ctl.revision,'DRAINING',t,request_hash,ins.publisher_session_id);
 UPDATE atlas_proof_authority.fence SET state='DRAINING',drain_id=(d->>'mutationId')::uuid WHERE fence_id=ANY(ids);
 RETURN atlas_proof_authority.read_drain_v1((d->>'mutationId')::uuid);
END $$;
CREATE FUNCTION atlas_proof_authority.settle_drain_v1(d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m atlas_proof_authority.mutation;
BEGIN
 PERFORM atlas_proof_authority.exact_object_v1(d,ARRAY['schema','mutationId','mutationHash','barrierHash']);
 IF d->>'schema'<>'atlas-proof-drain-settle-v1' OR d->>'barrierHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_PROTOCOL_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-proof-authority-v1',0));
 SELECT * INTO m FROM atlas_proof_authority.mutation WHERE mutation_id=(d->>'mutationId')::uuid FOR UPDATE;
 IF m.mutation_id IS NULL THEN RETURN atlas_proof_authority.observation_v1(true); END IF;
 IF m.mutation_hash<>d->>'mutationHash' OR m.state='UNKNOWN_HELD' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_UNKNOWN_HOLD'; END IF;
 IF m.state IN ('SETTLED','APPLIED') THEN
  IF m.barrier_hash<>d->>'barrierHash' THEN RAISE EXCEPTION 'PROOF_AUTHORITY_ID_CONFLICT'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM atlas_proof_authority.stage WHERE fence_ids&&m.fence_ids AND state IN ('OUTSTANDING','UNKNOWN_HELD')) THEN RAISE EXCEPTION 'PROOF_AUTHORITY_DRAIN_REQUIRED'; END IF;
  UPDATE atlas_proof_authority.mutation SET state='SETTLED',barrier_hash=d->>'barrierHash' WHERE mutation_id=m.mutation_id;
 END IF;
 RETURN atlas_proof_authority.read_drain_v1(m.mutation_id)||jsonb_build_object('requestHash',atlas_proof_authority.hash_v1(d));
END $$;
CREATE FUNCTION atlas_proof_authority.apply_mutation_v1(id uuid,h text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m atlas_proof_authority.mutation; actual jsonb; relation oid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-access-v1',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-proof-authority-v1',0));
 PERFORM 1 FROM atlas_proof_authority.control c WHERE c.id='active' FOR UPDATE;
 SELECT * INTO m FROM atlas_proof_authority.mutation WHERE mutation_id=id FOR UPDATE;
 IF m.mutation_id IS NULL THEN RETURN atlas_proof_authority.observation_v1(true); END IF;
 IF m.mutation_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'PROOF_AUTHORITY_ID_CONFLICT'; END IF;
 IF m.state='APPLIED' THEN RETURN atlas_proof_authority.read_drain_v1(id); END IF;
 IF m.state<>'SETTLED' OR m.barrier_hash IS NULL OR EXISTS(SELECT 1 FROM atlas_proof_authority.stage WHERE fence_ids&&m.fence_ids AND state IN ('OUTSTANDING','UNKNOWN_HELD')) THEN RAISE EXCEPTION 'PROOF_AUTHORITY_DRAIN_REQUIRED'; END IF;
 IF m.kind='STAFF_LOGOUT' THEN
  SELECT to_jsonb(s) INTO actual FROM atlas_staff."StaffSession" s WHERE "tokenHash"=m.subject_hash FOR UPDATE;
  relation:='atlas_staff."StaffSession"'::regclass;
 ELSIF m.kind='CUSTOMER_LOGOUT' THEN
  SELECT to_jsonb(s) INTO actual FROM atlas_customer."CustomerSession" s WHERE "tokenHash"=m.subject_hash FOR UPDATE;
  relation:='atlas_customer."CustomerSession"'::regclass;
 ELSE RAISE EXCEPTION 'PROOF_AUTHORITY_OPERATOR_BOUNDARY_REQUIRED'; END IF;
 IF actual IS DISTINCT FROM m.before_projection THEN RAISE EXCEPTION 'PROOF_AUTHORITY_MUTATION_PRECONDITION'; END IF;
 INSERT INTO atlas_proof_authority.write_permit VALUES(pg_current_xact_id(),pg_backend_pid(),relation,m.before_projection,m.after_projection,id);
 IF m.kind='STAFF_LOGOUT' THEN
  UPDATE atlas_staff."StaffSession" SET "revokedAt"=(m.after_projection->>'revokedAt')::timestamp WHERE "tokenHash"=m.subject_hash;
  INSERT INTO atlas_staff."StaffAudit"(id,event,"subjectId","actorId",details,"createdAt") VALUES(gen_random_uuid(),'STAFF_SESSION_REVOKED',m.before_projection->>'challengeId',(m.before_projection->>'identityId')::uuid,'{}',clock_timestamp() AT TIME ZONE 'UTC');
 ELSE
  UPDATE atlas_customer."CustomerSession" SET "revokedAt"=(m.after_projection->>'revokedAt')::timestamptz WHERE "tokenHash"=m.subject_hash;
 END IF;
 IF EXISTS(SELECT 1 FROM atlas_proof_authority.write_permit WHERE transaction_id=pg_current_xact_id() AND backend_id=pg_backend_pid() AND mutation_id=id) THEN RAISE EXCEPTION 'PROOF_AUTHORITY_TRIGGER_REQUIRED'; END IF;
 UPDATE atlas_proof_authority.fence SET state='REVOKED',revoked_at=clock_timestamp() WHERE fence_id=ANY(m.fence_ids) AND state='DRAINING' AND drain_id=id;
 UPDATE atlas_proof_authority.mutation SET state='APPLIED',applied_at=clock_timestamp() WHERE mutation_id=id;
 RETURN atlas_proof_authority.read_drain_v1(id);
END $$;
-- Human access/control changes keep their existing operations-grant/audit
-- boundary. A digest supplied to this role cannot impersonate that boundary.
CREATE FUNCTION atlas_proof_authority.begin_mutation_v1(d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM atlas_proof_authority.exact_object_v1(d,ARRAY['schema','mutationId','kind','subjectId','expectedBeforeHash','change','operatorAuthorityRef']);
 RAISE EXCEPTION 'PROOF_AUTHORITY_OPERATOR_BOUNDARY_REQUIRED';
END $$;
CREATE FUNCTION atlas_proof_authority.reject_unjoined_authority_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
<<proof_guard>>
DECLARE before_row jsonb; after_row jsonb; source_kind text:=TG_ARGV[0]; key text; ignored text[]; permitted uuid;
BEGIN
 IF TG_OP IN ('TRUNCATE','DELETE') THEN RAISE EXCEPTION 'PROOF_AUTHORITY_RETAINED_HISTORY'; END IF;
 before_row:=to_jsonb(OLD);after_row:=CASE WHEN TG_OP='DELETE' THEN 'null'::jsonb ELSE to_jsonb(NEW) END;
 DELETE FROM atlas_proof_authority.write_permit p WHERE p.transaction_id=pg_current_xact_id() AND p.backend_id=pg_backend_pid()
  AND p.relation_id=TG_RELID AND p.before_row=proof_guard.before_row AND p.after_row=proof_guard.after_row RETURNING mutation_id INTO permitted;
 IF permitted IS NOT NULL THEN RETURN NEW; END IF;
 -- Session/browser keys and original lifetime cannot be rewritten after a
 -- completed revocation to manufacture a fresh generation for an old cookie.
 IF source_kind IN ('STAFF_SESSION','CUSTOMER_SESSION') AND ((before_row-'revokedAt') IS DISTINCT FROM (after_row-'revokedAt') OR before_row->'revokedAt'<>'null'::jsonb AND before_row->'revokedAt' IS DISTINCT FROM after_row->'revokedAt')
  OR source_kind IN ('STAFF_BROWSER','CUSTOMER_BROWSER') AND before_row IS DISTINCT FROM after_row
  OR source_kind NOT IN ('STAFF_SESSION','CUSTOMER_SESSION','STAFF_BROWSER','CUSTOMER_BROWSER') AND before_row->'id' IS DISTINCT FROM after_row->'id'
 THEN RAISE EXCEPTION 'PROOF_AUTHORITY_SOURCE_IMMUTABLE'; END IF;
 ignored:=CASE source_kind WHEN 'CUSTOMER_ACCOUNT' THEN ARRAY['profile','lastLoginAt','createdAt'] WHEN 'STAFF_IDENTITY' THEN ARRAY['lastLoginAt','updatedAt','createdAt'] WHEN 'PROOF_CONTROL' THEN ARRAY['revision'] ELSE '{}'::text[] END;
 IF TG_OP='UPDATE' AND before_row-ignored=after_row-ignored THEN RETURN NEW; END IF;
 key:=CASE WHEN source_kind LIKE '%SESSION' OR source_kind LIKE '%BROWSER' THEN before_row->>'tokenHash' WHEN source_kind IN ('STAFF_IDENTITY','CUSTOMER_ACCOUNT') THEN before_row->>'id' ELSE 'active' END;
 -- This trigger never takes an upstream advisory/canonical lock. The DML row
 -- lock already excludes a concurrent claim's FOR SHARE on this source row.
 IF EXISTS(SELECT 1 FROM atlas_proof_authority.fence f WHERE f.source_kind=proof_guard.source_kind AND f.source_key_hash=atlas_proof_authority.hash_v1(jsonb_build_object('kind',proof_guard.source_kind,'key',key)) AND f.state<>'REVOKED') THEN RAISE EXCEPTION 'PROOF_AUTHORITY_DRAIN_REQUIRED'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END $$;
DO $$ DECLARE item text[]; BEGIN
 FOREACH item SLICE 1 IN ARRAY ARRAY[
  ['atlas_staff','StaffControl','STAFF_CONTROL'],['atlas_staff','StaffIdentity','STAFF_IDENTITY'],['atlas_staff','StaffSession','STAFF_SESSION'],['atlas_staff','StaffBrowser','STAFF_BROWSER'],
  ['atlas_customer','CustomerControl','CUSTOMER_CONTROL'],['atlas_customer','CustomerAccount','CUSTOMER_ACCOUNT'],['atlas_customer','CustomerSession','CUSTOMER_SESSION'],['atlas_customer','CustomerBrowser','CUSTOMER_BROWSER'],['atlas_customer','CustomerServiceControl','CUSTOMER_SERVICE_CONTROL']
 ] LOOP
  EXECUTE format('CREATE TRIGGER proof_authority_drain BEFORE UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION atlas_proof_authority.reject_unjoined_authority_write(%L)',item[1],item[2],item[3]);
  EXECUTE format('CREATE TRIGGER proof_authority_no_truncate BEFORE TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION atlas_proof_authority.reject_unjoined_authority_write(%L)',item[1],item[2],item[3]);
 END LOOP;
END $$;
CREATE TRIGGER proof_authority_control_drain BEFORE UPDATE OR DELETE ON atlas_proof_authority.control FOR EACH ROW EXECUTE FUNCTION atlas_proof_authority.reject_unjoined_authority_write('PROOF_CONTROL');
CREATE TRIGGER proof_authority_control_no_truncate BEFORE TRUNCATE ON atlas_proof_authority.control FOR EACH STATEMENT EXECUTE FUNCTION atlas_proof_authority.reject_unjoined_authority_write('PROOF_CONTROL');
REVOKE ALL ON ALL TABLES IN SCHEMA atlas_proof_authority FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_proof_authority FROM PUBLIC;
COMMIT;
