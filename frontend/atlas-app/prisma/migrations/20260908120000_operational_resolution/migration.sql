-- Additive exact human operational resolution with retained costs and evidence.
BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;
CREATE TABLE "StaffOperationalResolution" (
  id uuid PRIMARY KEY,kind text NOT NULL,"recordId" uuid NOT NULL,
  "specimenId" uuid NOT NULL REFERENCES "StaffSpecimen"(id) ON DELETE RESTRICT,"pilotId" uuid NOT NULL,
  "operationId" uuid NOT NULL,"actorId" uuid NOT NULL REFERENCES "StaffIdentity"(id) ON DELETE RESTRICT,
  "sessionHash" varchar(64) NOT NULL REFERENCES "StaffSession"("tokenHash") ON DELETE RESTRICT,
  "accessVersion" integer NOT NULL,"controlRevision" integer NOT NULL,
  "operationsGrantId" uuid NOT NULL REFERENCES "StaffOperationsGrant"(id) ON DELETE RESTRICT,
  "inputHash" varchar(64) NOT NULL,"bindingHash" varchar(64) NOT NULL,"sourceEvidenceHash" varchar(64) NOT NULL,
  "evidenceHash" varchar(64) NOT NULL,reason varchar(500) NOT NULL,"createdAt" timestamp(3) NOT NULL,
  UNIQUE("actorId","operationId"),UNIQUE(kind,"recordId"),
  CHECK ((kind IN ('INITIALIZATION','ASTRA','WORKER') AND "accessVersion">0 AND "controlRevision">0
    AND "sessionHash" ~ '^[a-f0-9]{64}$' AND "inputHash" ~ '^[a-f0-9]{64}$' AND "bindingHash" ~ '^[a-f0-9]{64}$'
    AND "sourceEvidenceHash" ~ '^[a-f0-9]{64}$' AND "evidenceHash" ~ '^[a-f0-9]{64}$'
    AND length(trim(reason)) BETWEEN 1 AND 500 AND reason !~ '[\x01-\x1f\x7f]') IS TRUE)
);
CREATE INDEX "StaffOperationalResolution_evidence_idx" ON "StaffOperationalResolution"("specimenId","sourceEvidenceHash");
REVOKE ALL ON "StaffOperationalResolution" FROM PUBLIC;
CREATE TRIGGER "StaffOperationalResolution_immutable" BEFORE UPDATE OR DELETE ON "StaffOperationalResolution"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffOperationalResolution_no_truncate" BEFORE TRUNCATE ON "StaffOperationalResolution"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();

-- Restricted canonicalization of server-derived binding/input/audit JSON. All
-- object keys are the fixed ASCII contract below; integers fit exact JS range.
CREATE FUNCTION atlas_staff.resolution_canonical(j jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE result text;
BEGIN
  IF jsonb_typeof(j)='object' THEN
    SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||atlas_staff.resolution_canonical(value),',' ORDER BY key COLLATE "C"),'')||'}'
      INTO result FROM jsonb_each(j); RETURN result;
  ELSIF jsonb_typeof(j)='array' THEN
    SELECT '['||coalesce(string_agg(atlas_staff.resolution_canonical(value),',' ORDER BY ord),'')||']'
      INTO result FROM jsonb_array_elements(j) WITH ORDINALITY AS a(value,ord); RETURN result;
  ELSE RETURN j::text; END IF;
END $$;
CREATE FUNCTION atlas_staff.resolution_pick(j jsonb,keys text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog AS $$ SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(j) WHERE key=ANY(keys) $$;

-- Read and lock immutable retained records. Mutable outcomes/receipt/usage/
-- actual-cost fields are deliberately absent, so a late receipt does not alter
-- the human's retained ledger binding. Costs are never written by this module.
CREATE FUNCTION atlas_staff.resolution_binding(kind text,record_id uuid,pilot uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE s atlas_staff."StaffSpecimen"%ROWTYPE;r atlas_staff."StaffOperatorRun"%ROWTYPE;
  o atlas_staff."StaffGradingOperation"%ROWTYPE;e atlas_staff."StaffGradingExecution"%ROWTYPE;
  j atlas_staff."StaffMachineInitialization"%ROWTYPE;a atlas_staff."StaffOperatorAttempt"%ROWTYPE;
  result jsonb;attempts jsonb:='[]';q jsonb;job jsonb:='null';execution jsonb:='null';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  IF kind='ASTRA' THEN
    SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=record_id FOR UPDATE;
    SELECT * INTO s FROM atlas_staff."StaffSpecimen" WHERE id=r."specimenId" FOR SHARE;
    IF (r.id IS NOT NULL AND r."pilotId"=pilot AND r."evidenceHash"=s."evidenceHash"
      AND r."policyCanonical"::jsonb->>'pilotId'=pilot::text
      AND r."manifestCanonical"::jsonb->>'version'='atlas-operator-manifest-v1'
      AND r."manifestCanonical"::jsonb->>'runId'=r.id::text AND r."manifestCanonical"::jsonb->>'specimenId'=s.id::text
      AND r."manifestCanonical"::jsonb->>'evidenceHash'=s."evidenceHash"
      AND (r."manifestCanonical"::jsonb->>'analysisRevision')::int=r."expectedAnalysisRevision"
      AND (r."manifestCanonical"::jsonb->>'reviewRevision')::int=r."expectedReviewRevision") IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS resolution retained run binding invalid'; END IF;
    FOR a IN SELECT * FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=r.id ORDER BY ordinal FOR UPDATE LOOP
      attempts:=attempts||jsonb_build_array(atlas_staff.resolution_pick(to_jsonb(a),ARRAY['id','ordinal','runRevision','leaseFence','dispatchClaimId','requestHash','providerBindingHash'])
        ||jsonb_build_object('reservedMicroUsd',a."reservedMicroUsd"::text));
      IF jsonb_array_length(attempts)>100 THEN RAISE EXCEPTION 'ATLAS resolution attempt bound exceeded'; END IF;
    END LOOP;
    result:=jsonb_build_object('run',atlas_staff.resolution_pick(to_jsonb(r),ARRAY['id','evidenceHash','policyHash','runtimeHash','gradingPolicyHash','manifestHash',
      'expectedAnalysisRevision','expectedReviewRevision','revision','inputHash']),'attempts',attempts);
  ELSIF kind IN ('INITIALIZATION','WORKER') THEN
    IF kind='INITIALIZATION' THEN
      SELECT * INTO j FROM atlas_staff."StaffMachineInitialization" WHERE id=record_id FOR UPDATE;
      SELECT * INTO o FROM atlas_staff."StaffGradingOperation" WHERE id=j."gradingOperationId" FOR UPDATE;
    ELSE
      SELECT * INTO o FROM atlas_staff."StaffGradingOperation" WHERE id=record_id FOR UPDATE;
      SELECT * INTO j FROM atlas_staff."StaffMachineInitialization" WHERE "gradingOperationId"=o.id FOR UPDATE;
    END IF;
    SELECT * INTO e FROM atlas_staff."StaffGradingExecution" WHERE "operationId"=o.id FOR UPDATE;
    SELECT * INTO s FROM atlas_staff."StaffSpecimen" WHERE id=o."specimenId" FOR SHARE;q:=o."requestCanonical"::jsonb;
    IF (o.id IS NOT NULL AND s.id IS NOT NULL AND o."evidenceHash"=s."evidenceHash"
      AND q->>'sourceId'=s."sourceId" AND q->>'sourceOwnerId'=s."sourceOwnerId"
      AND (kind='INITIALIZATION' AND j."pilotId"=pilot OR kind='WORKER' AND e."pilotId"=pilot)
      AND (e."operationId" IS NULL OR e."pilotId"=pilot AND e."sourceRevision"=q->>'sourceRevision')
      AND (j.id IS NULL OR j."specimenId"=s.id AND j."pilotId"=pilot AND j."evidenceHash"=s."evidenceHash"
        AND j."sourceRevision"=q->>'sourceRevision' AND o."actorKind"='ASTRA' AND o."actorId"='ASTRA_INITIALIZE:'||j.id::text
        AND o."operationId"=j.id::text AND o."sessionHash" IS NULL AND o."assignmentFence" IS NULL)) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS resolution retained worker binding invalid'; END IF;
    IF j.id IS NOT NULL THEN
      job:=atlas_staff.resolution_pick(to_jsonb(j),ARRAY['id','specimenId','pilotId','gradingOperationId','runtimeHash','evidenceHash',
        'operatorPolicyHash','bridgePolicyHash','gradingPolicyHash','sourceHash','sourceRevision','expectedAnalysisRevision',
        'expectedReviewRevision','controlRevision','operatorRevision','bridgeRevision','admittedById','admittedSessionHash',
        'admittedAccessVersion','operationsGrantId','admissionReason','authorizationEvidenceHash'])
        ||jsonb_build_object('deadlineAt',to_char(j."deadlineAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    END IF;
    IF e."operationId" IS NOT NULL THEN
      execution:=atlas_staff.resolution_pick(to_jsonb(e),ARRAY['operationId','claimId','pilotId','bridgeRevision','sourceRevision'])
        ||jsonb_build_object('reservedMicroUsd',e."reservedMicroUsd"::text);
    END IF;
    result:=jsonb_build_object('operation',atlas_staff.resolution_pick(to_jsonb(o),ARRAY['id','specimenId','operationId','actorKind','actorId',
      'sessionHash','assignmentFence','controlRevision','evidenceHash','expectedAnalysisRevision','expectedReviewRevision','inputHash','dispatchClaimId','leaseFence'])
      ||jsonb_build_object('leaseExpiresAt',to_char(o."leaseExpiresAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'execution',execution,'initialization',job);
  ELSE RAISE EXCEPTION 'ATLAS resolution kind invalid'; END IF;
  RETURN result||jsonb_build_object('version','atlas-operational-resolution-binding-v1','kind',kind,'recordId',record_id::text,
    'specimenId',s.id::text,'pilotId',pilot::text,'source',atlas_staff.resolution_pick(to_jsonb(s),ARRAY['id','sourceType','sourceId','sourceOwnerId','evidenceHash']));
END $$;

CREATE FUNCTION atlas_staff.assert_resolution_proof(resolution_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperationalResolution"%ROWTYPE;a atlas_staff."StaffAudit"%ROWTYPE;
  g atlas_staff."StaffOperationsGrant"%ROWTYPE;i atlas_staff."StaffIdentity"%ROWTYPE;
  s atlas_staff."StaffSession"%ROWTYPE;b atlas_staff."StaffBrowser"%ROWTYPE;c atlas_staff."StaffControl"%ROWTYPE;
  binding jsonb;expected_audit jsonb;expected_input jsonb;id_hash text;now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
  xid_text text:=(pg_current_xact_id()::text::numeric%4294967296)::text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO r FROM atlas_staff."StaffOperationalResolution" WHERE id=resolution_id AND xmin::text=xid_text FOR SHARE;
  SELECT * INTO a FROM atlas_staff."StaffAudit" WHERE id=resolution_id AND xmin::text=xid_text FOR SHARE;
  SELECT * INTO g FROM atlas_staff."StaffOperationsGrant" WHERE id=r."operationsGrantId" FOR SHARE;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=r."actorId" FOR SHARE;
  SELECT * INTO s FROM atlas_staff."StaffSession" WHERE "tokenHash"=r."sessionHash" FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=s."browserHash" FOR SHARE;
  SELECT * INTO c FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  IF (r.id IS NOT NULL AND a.id=r.id AND a.event='OPERATIONAL_RESOLUTION_RECORDED' AND a."subjectId"=r."recordId"::text
    AND a."actorId"=r."actorId" AND a."createdAt"=r."createdAt" AND r."createdAt">=now_at-interval '5 minutes' AND r."createdAt"<=now_at
    AND c.enabled AND c.revision=r."controlRevision" AND i.role IN ('REVIEWER','OBSERVER') AND i."revokedAt" IS NULL
    AND i."accessVersion"=r."accessVersion" AND s."identityId"=i.id AND s."revokedAt" IS NULL
    AND s."createdAt">=now_at-interval '5 minutes' AND s."createdAt"<=now_at AND s."expiresAt">now_at
    AND s."accessVersion"=i."accessVersion" AND s."controlRevision"=c.revision
    AND b."controlRevision"=c.revision AND b."createdAt"<=s."createdAt" AND b."expiresAt">now_at
    AND g."identityId"=i.id AND g."revokedAt" IS NULL AND g."createdAt"<=now_at AND g."expiresAt">now_at
    AND g."accessVersion"=i."accessVersion" AND g."controlRevision"=c.revision AND g.mode=c.mode AND g.origin=c.origin
    AND g."deploymentId"=c."deploymentId" AND g."releaseSha"=c."releaseSha" AND g."configHash"=c."configHash") IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS resolution requires exact same-transaction audit and fresh human operations authority'; END IF;
  expected_audit:=jsonb_build_object('version','atlas-operational-resolution-audit-v1','resolutionId',r.id::text,'kind',r.kind,
    'recordId',r."recordId"::text,'specimenId',r."specimenId"::text,'pilotId',r."pilotId"::text,'inputHash',r."inputHash",
    'bindingHash',r."bindingHash",'sourceEvidenceHash',r."sourceEvidenceHash",'evidenceHash',r."evidenceHash",'reason',r.reason);
  expected_input:=jsonb_build_object('version','atlas-operational-resolution-input-v1','kind',r.kind,'operationId',r."operationId"::text,
    'recordId',r."recordId"::text,'pilotId',r."pilotId"::text,'expectedBindingHash',r."bindingHash",'evidenceHash',r."evidenceHash",'reason',r.reason);
  id_hash:=encode(sha256(convert_to(atlas_staff.resolution_canonical(jsonb_build_object('purpose','atlas-operational-resolution-id-v1',
    'actorId',r."actorId"::text,'operationId',r."operationId"::text)),'UTF8')),'hex');
  binding:=atlas_staff.resolution_binding(r.kind,r."recordId",r."pilotId");
  IF (a.details=atlas_staff.resolution_canonical(expected_audit)
    AND r.id::text=substr(id_hash,1,8)||'-'||substr(id_hash,9,4)||'-4'||substr(id_hash,14,3)||'-8'||substr(id_hash,18,3)||'-'||substr(id_hash,21,12)
    AND r."inputHash"=encode(sha256(convert_to(atlas_staff.resolution_canonical(expected_input),'UTF8')),'hex')
    AND r."bindingHash"=encode(sha256(convert_to(atlas_staff.resolution_canonical(binding),'UTF8')),'hex')
    AND binding->>'specimenId'=r."specimenId"::text AND binding->'source'->>'evidenceHash'=r."sourceEvidenceHash"
    AND binding->'source'->>'sourceType'=CASE c.mode WHEN 'PRODUCTION' THEN 'SPEEDSTER' ELSE 'LOCAL_FIXTURE' END) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS resolution immutable input or retained binding mismatch'; END IF;
END $$;

-- Internal proof helpers are never EXECUTE-granted to operations or runners.
CREATE FUNCTION atlas_staff.resolution_for_target(kind text,record_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE id uuid;
BEGIN
  SELECT r.id INTO id FROM atlas_staff."StaffOperationalResolution" r WHERE r.kind=resolution_for_target.kind AND r."recordId"=record_id;
  IF id IS NULL THEN RAISE EXCEPTION 'ATLAS exact human resolution required'; END IF;
  PERFORM atlas_staff.assert_resolution_proof(id);RETURN id;
END $$;
CREATE OR REPLACE FUNCTION atlas_staff.machine_resolution_allowed(job_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE id uuid;
BEGIN
  SELECT r.id INTO id FROM atlas_staff."StaffOperationalResolution" r JOIN atlas_staff."StaffMachineInitialization" j ON j.id=job_id
    WHERE r.kind='INITIALIZATION' AND r."recordId"=j.id OR r.kind='WORKER' AND r."recordId"=j."gradingOperationId";
  IF id IS NULL THEN RETURN false; END IF;PERFORM atlas_staff.assert_resolution_proof(id);RETURN true;
END $$;

CREATE FUNCTION atlas_staff.apply_operational_resolution(resolution_id uuid) RETURNS TABLE(state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperationalResolution"%ROWTYPE;o atlas_staff."StaffGradingOperation"%ROWTYPE;
  j atlas_staff."StaffMachineInitialization"%ROWTYPE;e atlas_staff."StaffGradingExecution"%ROWTYPE;
  failure text;
BEGIN
  PERFORM atlas_staff.assert_resolution_proof(resolution_id);
  SELECT * INTO r FROM atlas_staff."StaffOperationalResolution" WHERE id=resolution_id;
  failure:=CASE r.kind WHEN 'INITIALIZATION' THEN 'HUMAN_CANCELLED_UNDISPATCHED' ELSE 'HUMAN_ABANDONED_UNAPPLIED' END;
  IF r.kind='ASTRA' THEN
    IF NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorRun" WHERE "StaffOperatorRun".id=r."recordId" AND "StaffOperatorRun".state='UNKNOWN') THEN
      RAISE EXCEPTION 'ATLAS resolution requires an unknown unapplied run'; END IF;
    UPDATE atlas_staff."StaffOperatorRun" SET state='FAILED',"failureCode"=failure,
      summary='Human abandoned unapplied automation; inspection or recapture required.',
      "leaseOwner"=NULL,"leaseMode"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=r."createdAt" WHERE id=r."recordId";
  ELSE
    IF r.kind='INITIALIZATION' THEN
      SELECT * INTO j FROM atlas_staff."StaffMachineInitialization" WHERE id=r."recordId";
      SELECT * INTO o FROM atlas_staff."StaffGradingOperation" WHERE id=j."gradingOperationId";
    ELSE
      SELECT * INTO o FROM atlas_staff."StaffGradingOperation" WHERE id=r."recordId";
      SELECT * INTO j FROM atlas_staff."StaffMachineInitialization" WHERE "gradingOperationId"=o.id;
    END IF;
    SELECT * INTO e FROM atlas_staff."StaffGradingExecution" WHERE "operationId"=o.id;
    IF o."resultAnalysisRevision" IS NOT NULL OR EXISTS(SELECT 1 FROM atlas_staff."StaffAnalysisRevision" WHERE "operationId"=o.id)
      OR (CASE r.kind WHEN 'INITIALIZATION' THEN j.state='QUEUED' AND o.state='RESERVED' AND j."dispatchedAt" IS NULL
        AND o."dispatchedAt" IS NULL AND e."operationId" IS NULL AND j."expectedAnalysisRevision"=0
        AND EXISTS(SELECT 1 FROM atlas_staff."StaffSpecimen" WHERE id=j."specimenId" AND "analysisRevision"=0)
        ELSE o.state='UNKNOWN' AND e.state='UNKNOWN' AND (j.id IS NULL OR j.state='UNKNOWN') END) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS resolution requires never-dispatched initialization or unknown uncommitted worker'; END IF;
    UPDATE atlas_staff."StaffGradingOperation" SET state='FAILED',"failureCode"=failure,"finishedAt"=coalesce("finishedAt",r."createdAt") WHERE id=o.id;
    IF j.id IS NOT NULL THEN
      UPDATE atlas_staff."StaffMachineInitialization" SET state='FAILED',"failureCode"=failure,"finishedAt"=coalesce("finishedAt",r."createdAt") WHERE id=j.id;
    END IF;
  END IF;
  RETURN QUERY SELECT 'FAILED'::text;
END $$;

-- Deferred proof rejects inserting an audit/fact without completing the exact
-- transition and rechecks authority if it was revoked later in this transaction.
CREATE FUNCTION atlas_staff.resolution_commit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperationalResolution"%ROWTYPE;j atlas_staff."StaffMachineInitialization"%ROWTYPE;
  o atlas_staff."StaffGradingOperation"%ROWTYPE;valid boolean:=false;
BEGIN
  PERFORM atlas_staff.assert_resolution_proof(NEW.id);r:=NEW;
  IF r.kind='ASTRA' THEN
    SELECT state='FAILED' AND "failureCode"='HUMAN_ABANDONED_UNAPPLIED'
      AND xmin::text=(pg_current_xact_id()::text::numeric%4294967296)::text INTO valid FROM atlas_staff."StaffOperatorRun" WHERE id=r."recordId";
  ELSE
    IF r.kind='INITIALIZATION' THEN
      SELECT * INTO j FROM atlas_staff."StaffMachineInitialization" WHERE id=r."recordId";
      SELECT * INTO o FROM atlas_staff."StaffGradingOperation" WHERE id=j."gradingOperationId";
    ELSE
      SELECT * INTO o FROM atlas_staff."StaffGradingOperation" WHERE id=r."recordId";
      SELECT * INTO j FROM atlas_staff."StaffMachineInitialization" WHERE "gradingOperationId"=o.id;
    END IF;
    valid:=o.state='FAILED' AND o."failureCode"=CASE r.kind WHEN 'INITIALIZATION' THEN 'HUMAN_CANCELLED_UNDISPATCHED' ELSE 'HUMAN_ABANDONED_UNAPPLIED' END
      AND EXISTS(SELECT 1 FROM atlas_staff."StaffGradingOperation" WHERE id=o.id AND xmin::text=(pg_current_xact_id()::text::numeric%4294967296)::text)
      AND o."resultAnalysisRevision" IS NULL AND (j.id IS NULL OR j.state='FAILED')
      AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffAnalysisRevision" WHERE "operationId"=o.id)
      AND CASE r.kind WHEN 'INITIALIZATION' THEN o."dispatchedAt" IS NULL AND j."dispatchedAt" IS NULL
        AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffGradingExecution" WHERE "operationId"=o.id)
        ELSE EXISTS(SELECT 1 FROM atlas_staff."StaffGradingExecution" WHERE "operationId"=o.id AND state='UNKNOWN') END;
  END IF;
  IF valid IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS resolution must atomically discard only unapplied parent work'; END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "StaffOperationalResolution_atomic" AFTER INSERT ON "StaffOperationalResolution"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.resolution_commit_guard();

-- M3 had a generic UNKNOWN -> FAILED path; require the new exact proof here.
CREATE FUNCTION atlas_staff.grading_resolution_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE id uuid;
BEGIN
  IF OLD.state='UNKNOWN' AND NEW.state='FAILED' THEN id:=atlas_staff.resolution_for_target('WORKER',NEW.id);
  ELSIF OLD.state='RESERVED' AND NEW.state='FAILED' AND NEW."actorKind"='ASTRA' THEN
    SELECT r.id INTO id FROM atlas_staff."StaffOperationalResolution" r JOIN atlas_staff."StaffMachineInitialization" j ON j.id=r."recordId"
      WHERE r.kind='INITIALIZATION' AND j."gradingOperationId"=NEW.id;
    PERFORM atlas_staff.assert_resolution_proof(id);
  ELSE RETURN NEW; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','failureCode','finishedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','failureCode','finishedAt'])
    OR NEW."resultAnalysisRevision" IS NOT NULL OR NEW."finishedAt" IS NULL
    OR NEW."failureCode"<>(CASE OLD.state WHEN 'RESERVED' THEN 'HUMAN_CANCELLED_UNDISPATCHED' ELSE 'HUMAN_ABANDONED_UNAPPLIED' END)
    OR EXISTS(SELECT 1 FROM atlas_staff."StaffAnalysisRevision" WHERE "operationId"=NEW.id)
    OR OLD.state='UNKNOWN' AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffGradingExecution" WHERE "operationId"=NEW.id AND state='UNKNOWN')
    OR OLD.state='RESERVED' AND (OLD."dispatchedAt" IS NOT NULL OR EXISTS(SELECT 1 FROM atlas_staff."StaffGradingExecution" WHERE "operationId"=NEW.id)) THEN
    RAISE EXCEPTION 'ATLAS worker resolution must retain exact unapplied execution'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffGradingOperation_resolution" BEFORE UPDATE ON "StaffGradingOperation"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.grading_resolution_guard();

-- No implicit same-evidence retry, even across a new pilot/runtime/analysis.
-- A future separately reviewed inspection/recapture admission may supersede
-- this; this release has no bypass GUC, mutable cleared flag or runner escape.
CREATE FUNCTION atlas_staff.resolved_evidence_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  IF EXISTS(SELECT 1 FROM atlas_staff."StaffOperationalResolution" r WHERE r."specimenId"=NEW."specimenId"
    AND r."sourceEvidenceHash"=NEW."evidenceHash") THEN RAISE EXCEPTION 'ATLAS resolved evidence requires separate human inspection or recapture'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffOperatorRun_resolved_evidence" BEFORE INSERT ON "StaffOperatorRun"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.resolved_evidence_guard();
CREATE TRIGGER "StaffGradingOperation_resolved_evidence" BEFORE INSERT ON "StaffGradingOperation"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.resolved_evidence_guard();
CREATE TRIGGER "StaffMachineInitialization_resolved_evidence" BEFORE INSERT ON "StaffMachineInitialization"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.resolved_evidence_guard();

-- Also close insert-before-resolution ordering within a single transaction.
CREATE CONSTRAINT TRIGGER "StaffOperatorRun_resolved_evidence_commit" AFTER INSERT ON "StaffOperatorRun"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.resolved_evidence_guard();
CREATE CONSTRAINT TRIGGER "StaffGradingOperation_resolved_evidence_commit" AFTER INSERT ON "StaffGradingOperation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.resolved_evidence_guard();
CREATE CONSTRAINT TRIGGER "StaffMachineInitialization_resolved_evidence_commit" AFTER INSERT ON "StaffMachineInitialization"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.resolved_evidence_guard();

-- Full M6 guard retained verbatim except the single proof-gated branch.
CREATE OR REPLACE FUNCTION atlas_staff.operator_run_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'QUEUED' OR NEW.revision<>1 OR NEW."leaseFence"<>0 OR NEW."leaseOwner" IS NOT NULL THEN
      RAISE EXCEPTION 'ATLAS operator requires a fresh queue entry'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['revision','state','inputCanonical','inputHash','leaseOwner','leaseFence','leaseMode','leaseExpiresAt','summary','failureCode','updatedAt'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision','state','inputCanonical','inputHash','leaseOwner','leaseFence','leaseMode','leaseExpiresAt','summary','failureCode','updatedAt'])
    OR NEW.revision NOT IN (OLD.revision,OLD.revision+1)
    OR (NEW.revision=OLD.revision AND (NEW."inputCanonical",NEW."inputHash") IS DISTINCT FROM (OLD."inputCanonical",OLD."inputHash"))
    OR OLD.state IN ('READY_FOR_HUMAN','NEEDS_RECAPTURE','NEEDS_EXPERT','FAILED') THEN
      RAISE EXCEPTION 'ATLAS operator scope or completed run is immutable'; END IF;
  -- Sole new exception: same revision/fence/input and an exact current human
  -- resolution, written with its audit in this transaction. Attempts stay held.
  IF OLD.state='UNKNOWN' AND NEW.state='FAILED' THEN
    PERFORM atlas_staff.resolution_for_target('ASTRA',NEW.id);
    IF (to_jsonb(NEW)-ARRAY['state','leaseOwner','leaseMode','leaseExpiresAt','summary','failureCode','updatedAt'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','leaseOwner','leaseMode','leaseExpiresAt','summary','failureCode','updatedAt'])
      OR NEW."leaseOwner" IS NOT NULL OR NEW."leaseMode" IS NOT NULL OR NEW."leaseExpiresAt" IS NOT NULL
      OR NEW."failureCode" IS DISTINCT FROM 'HUMAN_ABANDONED_UNAPPLIED'
      OR NEW.summary IS DISTINCT FROM 'Human abandoned unapplied automation; inspection or recapture required.' THEN
      RAISE EXCEPTION 'ATLAS abandoned run must retain its exact unapplied ledger'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.state='UNKNOWN' AND NEW.state<>'UNKNOWN' THEN RAISE EXCEPTION 'ATLAS uncertain work requires separate reconciliation'; END IF;
  IF NEW.state='FAILED' AND EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=NEW.id
    AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN')) THEN RAISE EXCEPTION 'ATLAS unresolved attempt cannot be discarded'; END IF;
  IF NEW."leaseOwner" IS NOT NULL AND (NEW."leaseExpiresAt">now_at+interval '60 seconds'
    OR NEW."leaseExpiresAt">NEW."deadlineAt") THEN RAISE EXCEPTION 'ATLAS operator lease is unbounded'; END IF;
  IF NEW."leaseFence"=OLD."leaseFence"+1 THEN
    IF OLD."leaseExpiresAt">now_at OR NEW."leaseOwner" IS NULL OR NEW."leaseExpiresAt"<=now_at OR NEW.revision<>OLD.revision
      OR (OLD.state='UNKNOWN' AND NEW."leaseMode"<>'RECONCILE_ONLY') THEN RAISE EXCEPTION 'ATLAS operator lease cannot be stolen'; END IF;
  ELSIF NEW."leaseFence"=OLD."leaseFence" THEN
    IF NEW."leaseOwner" IS NOT NULL AND (NEW."leaseOwner",NEW."leaseMode") IS DISTINCT FROM (OLD."leaseOwner",OLD."leaseMode") THEN
      RAISE EXCEPTION 'ATLAS operator lease fence required'; END IF;
    IF NEW."leaseExpiresAt" IS DISTINCT FROM OLD."leaseExpiresAt" AND NEW."leaseExpiresAt" IS NOT NULL AND OLD."leaseExpiresAt"<=now_at THEN
      RAISE EXCEPTION 'ATLAS expired lease cannot be renewed'; END IF;
    IF NEW.revision>OLD.revision AND (OLD."leaseExpiresAt"<=now_at OR OLD."leaseMode"<>'WORK') THEN
      RAISE EXCEPTION 'ATLAS stale lease cannot apply work'; END IF;
  ELSE RAISE EXCEPTION 'ATLAS operator lease fence invalid'; END IF;
  IF NEW.state IN ('READY_FOR_HUMAN','NEEDS_RECAPTURE','NEEDS_EXPERT') AND NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'ATLAS handoff requires an immutable step'; END IF;
  RETURN NEW;
END $$;

-- Sole public composition entry point is apply_operational_resolution(uuid),
-- explicitly granted ONLY to the exact restricted Operations role by the lead.
-- These revocations also prevent an ops caller invoking a proof helper directly.
REVOKE ALL ON FUNCTION atlas_staff.resolution_canonical(jsonb),atlas_staff.resolution_pick(jsonb,text[]),
  atlas_staff.resolution_binding(text,uuid,uuid),atlas_staff.assert_resolution_proof(uuid),
  atlas_staff.resolution_for_target(text,uuid),atlas_staff.machine_resolution_allowed(uuid),
  atlas_staff.apply_operational_resolution(uuid) FROM PUBLIC;
COMMIT;
