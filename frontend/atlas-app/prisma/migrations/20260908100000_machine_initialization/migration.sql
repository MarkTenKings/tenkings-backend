BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;
CREATE TABLE "StaffMachineInitialization" (
  id uuid PRIMARY KEY,"specimenId" uuid NOT NULL REFERENCES "StaffSpecimen"(id) ON DELETE RESTRICT,
  "pilotId" uuid NOT NULL,"gradingOperationId" uuid NOT NULL UNIQUE,
  "runtimeHash" varchar(64) NOT NULL,"evidenceHash" varchar(64) NOT NULL,"operatorPolicyHash" varchar(64) NOT NULL,
  "bridgePolicyHash" varchar(64) NOT NULL,"gradingPolicyHash" varchar(64) NOT NULL,"sourceHash" varchar(64) NOT NULL,
  "sourceRevision" varchar(80) NOT NULL,"expectedAnalysisRevision" integer NOT NULL,"expectedReviewRevision" integer NOT NULL,
  "controlRevision" integer NOT NULL,"operatorRevision" integer NOT NULL,"bridgeRevision" integer NOT NULL,
  "admittedById" uuid NOT NULL REFERENCES "StaffIdentity"(id) ON DELETE RESTRICT,
  "admittedSessionHash" varchar(64) NOT NULL REFERENCES "StaffSession"("tokenHash") ON DELETE RESTRICT,
  "admittedAccessVersion" integer NOT NULL,"operationsGrantId" uuid NOT NULL REFERENCES "StaffOperationsGrant"(id) ON DELETE RESTRICT,
  "admissionReason" varchar(500) NOT NULL,"authorizationEvidenceHash" varchar(64) NOT NULL,
  "deadlineAt" timestamp(3) NOT NULL,"createdAt" timestamp(3) NOT NULL,"dispatchedAt" timestamp(3),"finishedAt" timestamp(3),
  state text NOT NULL,"failureCode" varchar(80),
  FOREIGN KEY ("gradingOperationId") REFERENCES "StaffGradingOperation"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (("expectedAnalysisRevision"=0 AND "expectedReviewRevision">0 AND "controlRevision">0 AND "operatorRevision">0
    AND "bridgeRevision">0 AND "admittedAccessVersion">0 AND length(trim("admissionReason"))>0
    AND "admittedSessionHash" ~ '^[a-f0-9]{64}$' AND "authorizationEvidenceHash" ~ '^[a-f0-9]{64}$'
    AND "runtimeHash" ~ '^[a-f0-9]{64}$' AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "operatorPolicyHash" ~ '^[a-f0-9]{64}$'
    AND "bridgePolicyHash" ~ '^[a-f0-9]{64}$' AND "gradingPolicyHash" ~ '^[a-f0-9]{64}$' AND "sourceHash" ~ '^[a-f0-9]{64}$'
    AND "deadlineAt">"createdAt" AND "deadlineAt"<="createdAt"+interval '5 minutes'
    AND ((state='QUEUED' AND "dispatchedAt" IS NULL AND "finishedAt" IS NULL AND "failureCode" IS NULL)
      OR (state='DISPATCHED' AND "dispatchedAt" IS NOT NULL AND "finishedAt" IS NULL AND "failureCode" IS NULL)
      OR (state='SUCCEEDED' AND "dispatchedAt" IS NOT NULL AND "finishedAt" IS NOT NULL AND "failureCode" IS NULL)
      OR (state IN ('UNKNOWN','FAILED') AND "finishedAt" IS NOT NULL AND "failureCode" IS NOT NULL))) IS TRUE)
);
CREATE INDEX "StaffMachineInitialization_specimen_state_idx" ON "StaffMachineInitialization"("specimenId",state);
ALTER TABLE "StaffOperatorRun" ADD COLUMN "initializationId" uuid UNIQUE REFERENCES "StaffMachineInitialization"(id) ON DELETE RESTRICT;
REVOKE ALL ON "StaffMachineInitialization" FROM PUBLIC;
CREATE TRIGGER "StaffMachineInitialization_no_delete" BEFORE DELETE ON "StaffMachineInitialization"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffMachineInitialization_no_truncate" BEFORE TRUNCATE ON "StaffMachineInitialization"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();

-- A later explicit operational-resolution migration may narrowly implement
-- cancellation. This release cannot turn an uncertain initialization into retry.
CREATE FUNCTION atlas_staff.machine_resolution_allowed(job_id uuid) RETURNS boolean LANGUAGE sql
SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$ SELECT false $$;
REVOKE ALL ON FUNCTION atlas_staff.machine_resolution_allowed(uuid) FROM PUBLIC;
CREATE FUNCTION atlas_staff.machine_initialization_guard() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'QUEUED' THEN RAISE EXCEPTION 'ATLAS machine initialization requires fresh admission'; END IF; RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['state','dispatchedAt','finishedAt','failureCode']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['state','dispatchedAt','finishedAt','failureCode'])
    OR OLD.state IN ('SUCCEEDED','FAILED') OR OLD.state=NEW.state
    OR OLD."dispatchedAt" IS NOT NULL AND NEW."dispatchedAt" IS DISTINCT FROM OLD."dispatchedAt" THEN
    RAISE EXCEPTION 'ATLAS machine initialization scope is immutable'; END IF;
  IF OLD.state='QUEUED' AND NEW.state='DISPATCHED' OR OLD.state='DISPATCHED' AND NEW.state IN ('SUCCEEDED','UNKNOWN')
    OR OLD.state IN ('QUEUED','UNKNOWN') AND NEW.state='FAILED' AND atlas_staff.machine_resolution_allowed(NEW.id) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'ATLAS machine initialization cannot redispatch';
END $$;
CREATE TRIGGER "StaffMachineInitialization_transition" BEFORE INSERT OR UPDATE ON "StaffMachineInitialization"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.machine_initialization_guard();

CREATE FUNCTION atlas_staff.assert_machine_initialization(job_id uuid) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE j atlas_staff."StaffMachineInitialization"%ROWTYPE;o atlas_staff."StaffGradingOperation"%ROWTYPE;
  e atlas_staff."StaffGradingExecution"%ROWTYPE;s atlas_staff."StaffSpecimen"%ROWTYPE;
  c atlas_staff."StaffControl"%ROWTYPE;b atlas_staff."StaffGradingBridgeControl"%ROWTYPE;p atlas_staff."StaffOperatorControl"%ROWTYPE;
  i atlas_staff."StaffIdentity"%ROWTYPE;ss atlas_staff."StaffSession"%ROWTYPE;br atlas_staff."StaffBrowser"%ROWTYPE;
  g atlas_staff."StaffOperationsGrant"%ROWTYPE;a atlas_staff."StaffAnalysisRevision"%ROWTYPE;r atlas_staff."StaffReviewRevision"%ROWTYPE;
  q jsonb;ad jsonb;pair jsonb;now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO j FROM atlas_staff."StaffMachineInitialization" WHERE id=job_id FOR SHARE;
  SELECT * INTO o FROM atlas_staff."StaffGradingOperation" WHERE id=j."gradingOperationId" FOR SHARE;
  SELECT * INTO e FROM atlas_staff."StaffGradingExecution" WHERE "operationId"=o.id FOR SHARE;
  SELECT * INTO s FROM atlas_staff."StaffSpecimen" WHERE id=j."specimenId" FOR SHARE;
  q:=o."requestCanonical"::jsonb;
  IF (j.id IS NOT NULL AND o.id IS NOT NULL AND s.id=j."specimenId" AND o."specimenId"=s.id
    AND o."actorKind"='ASTRA' AND o."actorId"='ASTRA_INITIALIZE:'||j.id::text AND o."operationId"=j.id::text
    AND o."sessionHash" IS NULL AND o."assignmentFence" IS NULL AND o."controlRevision"=j."controlRevision"
    AND o."evidenceHash"=j."evidenceHash" AND o."expectedAnalysisRevision"=0 AND o."expectedReviewRevision"=j."expectedReviewRevision"
    AND o."leaseFence"=1 AND o."leaseExpiresAt"=j."deadlineAt"
    AND q=jsonb_build_object('version','atlas-machine-initialize-operation-v1','jobId',j.id::text,'runtimeHash',j."runtimeHash",
      'policyHash',j."gradingPolicyHash",'operatorPolicyHash',j."operatorPolicyHash",'bridgePolicyHash',j."bridgePolicyHash",
      'sourceId',s."sourceId",'sourceOwnerId',s."sourceOwnerId",'sourceRevision',j."sourceRevision",'sourceHash',j."sourceHash",
      'request',jsonb_build_object('action',jsonb_build_object('type','INITIALIZE')))) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS machine operation must bind its exact admitted initialization'; END IF;
  IF j.state='FAILED' THEN
    IF NOT atlas_staff.machine_resolution_allowed(j.id) THEN RAISE EXCEPTION 'ATLAS machine cancellation requires explicit resolution'; END IF; RETURN;
  END IF;
  IF j.state='UNKNOWN' THEN
    IF (o.state='UNKNOWN' AND e.state='UNKNOWN' AND o."resultAnalysisRevision" IS NULL
      AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffAnalysisRevision" WHERE "operationId"=o.id)) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS uncertain initialization must preserve the unsettled claim'; END IF; RETURN;
  END IF;
  SELECT * INTO c FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE;
  SELECT * INTO p FROM atlas_staff."StaffOperatorControl" WHERE id='active' FOR SHARE;
  IF (c.enabled AND b.enabled AND p.enabled AND c.mode=b.mode AND c.mode=p.mode
    AND c.revision=j."controlRevision" AND b.revision=j."bridgeRevision" AND p.revision=j."operatorRevision"
    AND c."gradingPolicyHash"=j."gradingPolicyHash" AND b."gradingPolicyHash"=j."gradingPolicyHash"
    AND b."policyHash"=j."bridgePolicyHash" AND p."policyHash"=j."operatorPolicyHash" AND p."configHash"=j."runtimeHash"
    AND b."policyCanonical"::jsonb->>'pilotId'=j."pilotId"::text AND p."policyCanonical"::jsonb->>'pilotId'=j."pilotId"::text
    AND (b."policyCanonical"::jsonb->>'expiresAt')::timestamptz>clock_timestamp()
    AND (p."policyCanonical"::jsonb->>'expiresAt')::timestamptz>clock_timestamp()
    AND p."policyCanonical"::jsonb->'astra'->>'model'='gpt-6-astra'
    AND p."policyCanonical"::jsonb->'astra'->>'returnedModel'='gpt-6-astra'
    AND b."policyCanonical"::jsonb->'specimenIds' ? s.id::text AND j."deadlineAt">now_at
    AND j."deadlineAt"<=j."createdAt"+(b."policyCanonical"::jsonb->>'deadlineMs')::int*interval '1 millisecond'
    AND (SELECT count(*) FROM atlas_staff."StaffSpecimen" WHERE b."policyCanonical"::jsonb->'specimenIds' ? id::text
      AND "sourceType"=CASE c.mode WHEN 'PRODUCTION' THEN 'SPEEDSTER' ELSE 'LOCAL_FIXTURE' END)=10
    AND s."sourceType"=CASE c.mode WHEN 'PRODUCTION' THEN 'SPEEDSTER' ELSE 'LOCAL_FIXTURE' END AND s."evidenceHash"=j."evidenceHash"
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffGradingOperation" WHERE "specimenId"=s.id AND id<>o.id AND state IN ('RESERVED','DISPATCHED','UNKNOWN'))
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorRun" WHERE "specimenId"=s.id AND state IN ('QUEUED','RUNNING','WAITING_TOOL','UNKNOWN'))
  ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS initialization requires its current source policy and runtime'; END IF;
  IF j.state IN ('QUEUED','DISPATCHED') THEN
    IF (s."analysisRevision"=0 AND s."draftRevision"=j."expectedReviewRevision"
      AND (c.mode='LOCAL_FIXTURE' OR atlas_staff.operator_source_matches(s."sourceId",s."sourceOwnerId",j."sourceRevision"))
      AND (j.state='QUEUED' AND o.state='RESERVED' AND e."operationId" IS NULL
        OR j.state='DISPATCHED' AND o.state='DISPATCHED' AND e.state='RUNNING')) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS initialization must start without a previous analysis or claim'; END IF;
    IF c.mode='PRODUCTION' AND EXISTS(SELECT 1 FROM public."AiGraderV2InstrumentationEvent"
      WHERE "sessionId"=s."sourceId" AND "createdByUserId"=s."sourceOwnerId" AND category='DETECTOR_CHECKPOINT'
      AND "eventType"='DETECTOR_SIDE_RESULT_PRESERVED' AND details->>'sessionRevision'=j."sourceRevision") THEN
      RAISE EXCEPTION 'ATLAS initialization requires fresh detector work'; END IF;
  END IF;
  IF j.state='QUEUED' THEN
    SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=j."admittedById" FOR SHARE;
    SELECT * INTO ss FROM atlas_staff."StaffSession" WHERE "tokenHash"=j."admittedSessionHash" FOR SHARE;
    SELECT * INTO br FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=ss."browserHash" FOR SHARE;
    SELECT * INTO g FROM atlas_staff."StaffOperationsGrant" WHERE id=j."operationsGrantId" FOR SHARE;
    IF (i."revokedAt" IS NULL AND i.role IN ('REVIEWER','OBSERVER') AND i."accessVersion"=j."admittedAccessVersion"
      AND ss."identityId"=i.id AND ss."revokedAt" IS NULL AND ss."accessVersion"=i."accessVersion" AND ss."controlRevision"=c.revision
      AND ss."createdAt">=now_at-interval '5 minutes' AND ss."createdAt"<=now_at AND ss."expiresAt">now_at
      AND br."createdAt"<=ss."createdAt" AND br."expiresAt">now_at AND br."controlRevision"=c.revision
      AND g."identityId"=i.id AND g."accessVersion"=i."accessVersion" AND g."controlRevision"=c.revision
      AND g."revokedAt" IS NULL AND g."createdAt"<=now_at AND g."expiresAt">now_at
      AND g.mode=c.mode AND g.origin=c.origin AND g."deploymentId"=c."deploymentId" AND g."releaseSha"=c."releaseSha" AND g."configHash"=c."configHash"
      AND EXISTS(SELECT 1 FROM atlas_staff."StaffAudit" audit WHERE audit.event='MACHINE_INITIALIZATION_ADMITTED'
        AND audit."actorId"=i.id AND audit."subjectId"=s.id::text AND audit.xmin=(SELECT xmin FROM atlas_staff."StaffMachineInitialization" WHERE id=j.id)
        AND audit.details::jsonb @> jsonb_build_object('jobId',j.id::text,'operationId',o.id::text,'runtimeHash',j."runtimeHash",'evidenceHash',j."evidenceHash",
          'sessionHash',ss."tokenHash",'accessVersion',i."accessVersion",'controlRevision',c.revision,'operationsGrantId',g.id::text,
          'reason',j."admissionReason",'authorizationEvidenceHash',j."authorizationEvidenceHash"))) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS initialization admission requires a current human operations grant and exact audit'; END IF;
    RETURN;
  END IF;
  IF (e."pilotId"=j."pilotId" AND e."bridgeRevision"=j."bridgeRevision" AND e."sourceRevision"=j."sourceRevision"
    AND e."createdAt"<=now_at AND e."createdAt">=j."createdAt" AND e."reservedMicroUsd"=(b."policyCanonical"::jsonb->>'reservationPerOperationMicroUsd')::bigint)
    IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS machine execution must retain its exact claim'; END IF;
  IF j.state='DISPATCHED' THEN RETURN; END IF;
  SELECT * INTO a FROM atlas_staff."StaffAnalysisRevision" WHERE "operationId"=o.id;
  SELECT * INTO r FROM atlas_staff."StaffReviewRevision" WHERE "specimenId"=s.id AND revision=s."draftRevision";
  ad:=a."admissionCanonical"::jsonb;pair:=ad->'detectionPair';
  IF (j.state='SUCCEEDED' AND o.state='SUCCEEDED' AND e.state='COMMITTED' AND o."resultAnalysisRevision"=1
    AND a."specimenId"=s.id AND a.revision=1 AND a.mode=c.mode AND a."evidenceHash"=j."evidenceHash" AND s."analysisRevision"=1
    AND s."draftRevision"=j."expectedReviewRevision"+1 AND r."analysisRevision"=1 AND r."savedById" IS NULL
    AND r.canonical::jsonb->'reviewedSides'='[]'::jsonb AND r.canonical::jsonb->'identityReviewed'='false'::jsonb
    AND r.canonical::jsonb->>'disposition'='IN_REVIEW' AND r."evidenceHash"=s."evidenceHash"
    AND ad @> jsonb_build_object('purpose','atlas-analysis-admission-v1','mode',c.mode,'evidenceHash',j."evidenceHash",'sourceHash',a."sourceHash",
      'policyHash',j."gradingPolicyHash",'bridgePolicyHash',j."bridgePolicyHash",'sourceId',s."sourceId",'sourceOwnerId',s."sourceOwnerId",
      'operationId',o.id::text,'bridgeRevision',j."bridgeRevision",'machineInitialization',jsonb_build_object('jobId',j.id::text,
      'runtimeHash',j."runtimeHash",'operatorPolicyHash',j."operatorPolicyHash"))
    AND length(pair->>'operationId') BETWEEN 1 AND 128 AND pair->>'captureBindingSha256' ~ '^[a-f0-9]{64}$'
    AND pair->>'memorySnapshotSha256' ~ '^[a-f0-9]{64}$' AND pair->>'frontReceiptHmacSha256' ~ '^[a-f0-9]{64}$'
    AND pair->>'backReceiptHmacSha256' ~ '^[a-f0-9]{64}$'
    AND (c.mode='LOCAL_FIXTURE' OR atlas_staff.operator_source_matches(s."sourceId",s."sourceOwnerId",a."sourceRevision"))
    AND EXISTS(SELECT 1 FROM atlas_staff."StaffAudit" audit WHERE audit.event='MACHINE_INITIALIZATION_COMMITTED'
      AND audit."actorId" IS NULL AND audit."subjectId"=s.id::text AND audit.xmin=(SELECT xmin FROM atlas_staff."StaffAnalysisRevision" WHERE "operationId"=o.id)
      AND audit.details::jsonb @> jsonb_build_object('jobId',j.id::text,'operationId',o.id::text,'analysisRevision',1,
        'sourceHash',a."sourceHash",'reportHash',a."reportHash",'runtimeHash',j."runtimeHash"))) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS machine grading must commit original analysis reset review and provenance atomically'; END IF;
END $$;
REVOKE ALL ON FUNCTION atlas_staff.assert_machine_initialization(uuid) FROM PUBLIC;
CREATE FUNCTION atlas_staff.machine_initialization_commit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE job_id uuid;kind text;
BEGIN
  IF TG_TABLE_NAME='StaffMachineInitialization' THEN job_id:=NEW.id;
  ELSE
    IF TG_TABLE_NAME='StaffGradingOperation' THEN kind:=NEW."actorKind";job_id:=CASE WHEN kind='ASTRA' THEN NEW."operationId"::uuid ELSE NULL END;
    ELSE SELECT "actorKind",CASE WHEN "actorKind"='ASTRA' THEN "operationId"::uuid ELSE NULL END INTO kind,job_id
      FROM atlas_staff."StaffGradingOperation" WHERE id=NEW."operationId"; END IF;
    IF kind IS DISTINCT FROM 'ASTRA' THEN RETURN NULL; END IF;
  END IF;
  PERFORM atlas_staff.assert_machine_initialization(job_id);RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "StaffMachineInitialization_atomic" AFTER INSERT OR UPDATE ON "StaffMachineInitialization"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.machine_initialization_commit_guard();
CREATE CONSTRAINT TRIGGER "StaffGradingOperation_machine" AFTER INSERT OR UPDATE ON "StaffGradingOperation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.machine_initialization_commit_guard();
CREATE CONSTRAINT TRIGGER "StaffGradingExecution_machine_insert" AFTER INSERT ON "StaffGradingExecution"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.machine_initialization_commit_guard();
CREATE CONSTRAINT TRIGGER "StaffGradingExecution_machine_state" AFTER UPDATE ON "StaffGradingExecution"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.state IS DISTINCT FROM OLD.state)
  EXECUTE FUNCTION atlas_staff.machine_initialization_commit_guard();

-- Preserve the complete prior human guard; machine authority uses its own exact job.
CREATE OR REPLACE FUNCTION atlas_staff.staff_execution_commit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,atlas_staff AS $$
DECLARE o atlas_staff."StaffGradingOperation"%ROWTYPE; b atlas_staff."StaffGradingBridgeControl"%ROWTYPE;
  c atlas_staff."StaffControl"%ROWTYPE; i atlas_staff."StaffIdentity"%ROWTYPE; s atlas_staff."StaffSession"%ROWTYPE;
  a atlas_staff."StaffAssignment"%ROWTYPE; browser atlas_staff."StaffBrowser"%ROWTYPE;
  now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  SELECT * INTO o FROM atlas_staff."StaffGradingOperation" WHERE id=NEW."operationId";
  IF o."actorKind"='ASTRA' THEN
    PERFORM atlas_staff.assert_machine_initialization(o."operationId"::uuid);RETURN NULL;
  END IF;
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE;
  SELECT * INTO c FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=o."actorId"::uuid FOR SHARE;
  SELECT * INTO s FROM atlas_staff."StaffSession" WHERE "tokenHash"=o."sessionHash" FOR SHARE;
  SELECT * INTO browser FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=s."browserHash" FOR SHARE;
  SELECT * INTO a FROM atlas_staff.lock_assignment(o."specimenId",i.id);
  IF (o.state='SUCCEEDED' AND o."actorKind"='HUMAN' AND o."leaseExpiresAt">now_at
    AND b.enabled AND b.revision=NEW."bridgeRevision" AND c.enabled AND c.mode=b.mode
    AND c.revision=o."controlRevision" AND c."gradingPolicyHash"=b."gradingPolicyHash"
    AND o."requestCanonical"::jsonb->>'policyHash'=b."gradingPolicyHash"
    AND o."requestCanonical"::jsonb->>'bridgePolicyHash'=b."policyHash"
    AND (b."policyCanonical"::jsonb->>'expiresAt')::timestamptz>clock_timestamp()
    AND NEW."createdAt"+(b."policyCanonical"::jsonb->>'deadlineMs')::int*interval '1 millisecond'>now_at
    AND i.role='REVIEWER' AND i."revokedAt" IS NULL AND i."accessVersion"=(o."requestCanonical"::jsonb->>'accessVersion')::int
    AND s."identityId"=i.id AND s."revokedAt" IS NULL AND s."expiresAt">now_at AND s."accessVersion"=i."accessVersion"
    AND s."controlRevision"=c.revision AND browser."controlRevision"=c.revision AND browser."expiresAt">now_at
    AND a."canReview" AND a."revokedAt" IS NULL AND a."expiresAt">now_at AND a.fence=o."assignmentFence"
  ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS execution must commit current scoped authority'; END IF;
  RETURN NULL;
END; $$;
CREATE FUNCTION atlas_staff.operator_initialization_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
BEGIN
  IF NEW."initializationId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffMachineInitialization" j
    JOIN atlas_staff."StaffAnalysisRevision" a ON a."operationId"=j."gradingOperationId"
    WHERE j.id=NEW."initializationId" AND j.state='SUCCEEDED' AND j."specimenId"=NEW."specimenId"
    AND j."pilotId"=NEW."pilotId" AND j."runtimeHash"=NEW."runtimeHash" AND j."evidenceHash"=NEW."evidenceHash"
    AND a.revision=NEW."expectedAnalysisRevision" AND a.revision=1 AND a."evidenceHash"=NEW."evidenceHash"
    AND a."admissionCanonical"::jsonb->'machineInitialization'->>'jobId'=j.id::text) THEN
    RAISE EXCEPTION 'ATLAS operator must follow its exact committed machine initialization'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "StaffOperatorRun_machine_initialization" AFTER INSERT ON "StaffOperatorRun"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_initialization_guard();
COMMIT;
