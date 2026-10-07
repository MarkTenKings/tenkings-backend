BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;

CREATE TABLE "StaffWorkspaceSourceAdmission" (
  "requestId" uuid PRIMARY KEY REFERENCES "StaffWorkspaceOperation"(id) ON DELETE RESTRICT,
  "cardId" uuid NOT NULL UNIQUE REFERENCES "StaffWorkspaceCard"(id) ON DELETE RESTRICT,
  "specimenId" uuid NOT NULL UNIQUE REFERENCES "StaffSpecimen"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  "sourceType" text NOT NULL,"sourceId" varchar(128) NOT NULL,"sourceOwnerId" varchar(128) NOT NULL,
  "sourceRevision" varchar(80) NOT NULL,"sourceHash" varchar(64) NOT NULL,
  "evidenceCanonical" text NOT NULL,"evidenceHash" varchar(64) NOT NULL,
  "admissionCanonical" text NOT NULL,"admissionHash" varchar(64) NOT NULL,"sourceConfigHash" varchar(64) NOT NULL,
  "actorKind" text NOT NULL,"actorId" uuid NOT NULL REFERENCES "StaffIdentity"(id) ON DELETE RESTRICT,
  "sessionHash" varchar(64) REFERENCES "StaffSession"("tokenHash") ON DELETE RESTRICT,"accessVersion" integer NOT NULL,
  "createdAt" timestamp(3) NOT NULL,
  CHECK (("cardId"="specimenId" AND "sourceType" IN ('LOCAL_FIXTURE','SPEEDSTER') AND "accessVersion">0
    AND "sourceId"='atlas-'||"cardId"::text AND "sourceHash" ~ '^[a-f0-9]{64}$' AND "sourceConfigHash" ~ '^[a-f0-9]{64}$'
    AND octet_length("evidenceCanonical")<=131072 AND jsonb_typeof("evidenceCanonical"::jsonb)='object'
    AND "evidenceHash"=encode(sha256(convert_to("evidenceCanonical",'UTF8')),'hex')
    AND octet_length("admissionCanonical")<=16384 AND jsonb_typeof("admissionCanonical"::jsonb)='object'
    AND "admissionHash"=encode(sha256(convert_to("admissionCanonical",'UTF8')),'hex')
    AND ("actorKind"='HUMAN' AND "sessionHash" ~ '^[a-f0-9]{64}$' OR "actorKind"='MACHINE' AND "sessionHash" IS NULL)) IS TRUE)
);
CREATE TRIGGER "StaffWorkspaceSourceAdmission_no_update" BEFORE UPDATE ON "StaffWorkspaceSourceAdmission"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffWorkspaceSourceAdmission_no_delete" BEFORE DELETE ON "StaffWorkspaceSourceAdmission"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffWorkspaceSourceAdmission_no_truncate" BEFORE TRUNCATE ON "StaffWorkspaceSourceAdmission"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();
REVOKE ALL ON "StaffWorkspaceSourceAdmission" FROM PUBLIC;
CREATE FUNCTION atlas_staff.workspace_source_admitted(request_id uuid,workspace_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceAdmission" a
    JOIN atlas_staff."StaffWorkspaceCard" w ON w.id=a."cardId"
    WHERE a."requestId"=request_id AND a."cardId"=workspace_id AND a."specimenId"=w."specimenId");
$$;
REVOKE ALL ON FUNCTION atlas_staff.workspace_source_admitted(uuid,uuid) FROM PUBLIC;

-- The source host supplies the unchanged original evidence projections. This
-- definer binds them to one retained initialization request and physical pair;
-- the website never receives INSERT on specimens, assignments or admission.
CREATE FUNCTION atlas_staff.admit_workspace_source(request_id uuid,session_hash text,packet_canonical text)
RETURNS SETOF atlas_staff."StaffWorkspaceSourceAdmission" LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE w atlas_staff."StaffWorkspaceCard"%ROWTYPE;o atlas_staff."StaffWorkspaceOperation"%ROWTYPE;
  c atlas_staff."StaffWorkspaceControl"%ROWTYPE;s atlas_staff."StaffWorkspaceSourceControl"%ROWTYPE;
  staff atlas_staff."StaffControl"%ROWTYPE;i atlas_staff."StaffIdentity"%ROWTYPE;
  se atlas_staff."StaffSession"%ROWTYPE;br atlas_staff."StaffBrowser"%ROWTYPE;existing atlas_staff."StaffWorkspaceSourceAdmission"%ROWTYPE;
  p jsonb:=packet_canonical::jsonb;n jsonb;q jsonb;e jsonb;ad jsonb;draft jsonb;next_workspace jsonb;v jsonb;side text;
  at_time timestamp:=clock_timestamp() AT TIME ZONE 'UTC';actor_kind text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO o FROM atlas_staff."StaffWorkspaceOperation" WHERE id=request_id FOR SHARE;
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=o."cardId" FOR UPDATE;
  SELECT * INTO c FROM atlas_staff."StaffWorkspaceControl" WHERE id='active' FOR SHARE;
  SELECT * INTO s FROM atlas_staff."StaffWorkspaceSourceControl" WHERE id='active' FOR SHARE;
  SELECT * INTO staff FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=o."actorId" FOR SHARE;
  n:=w.canonical::jsonb;q:=o.canonical::jsonb->'result';e:=(p->>'evidenceCanonical')::jsonb;
  ad:=(p->>'admissionCanonical')::jsonb;draft:=(p->>'reviewCanonical')::jsonb;next_workspace:=(p->>'workspaceCanonical')::jsonb;
  actor_kind:=CASE o.action WHEN 'MANUAL_ACTION' THEN 'HUMAN' WHEN 'MACHINE_SOURCE_ACTION' THEN 'MACHINE' END;
  IF (octet_length(packet_canonical)<=524288 AND staff.enabled AND c.enabled AND s.enabled AND c."preparationEnabled"
    AND c.mode=staff.mode AND s.mode=c.mode AND c."releaseSha"=staff."releaseSha" AND s."releaseSha"=c."releaseSha"
    AND s."configHash"=c."configHash" AND s."sourceConfigHash"=p->>'sourceConfigHash'
    AND s."cohortId"=c."cohortId" AND w."cohortId"=c."cohortId" AND c."expiresAt">at_time AND s."expiresAt">at_time
    AND i.id IS NOT NULL AND i.role='REVIEWER' AND i."revokedAt" IS NULL
    AND w.state IN ('IN_PROGRESS','NEEDS_ATTENTION') AND n->'claim'->>'actorId'=i.id::text
    AND n->'claim'->>'kind'=CASE actor_kind WHEN 'HUMAN' THEN 'HUMAN' ELSE 'ASTRA' END
    AND q->>'action'='INITIALIZE_REPORT' AND q->>'phase'='REQUESTED' AND q->>'requestId'=request_id::text
    AND n->'workspace'->'pending'->>'requestId'=request_id::text AND n->'workspace'->'pending'->'binding'=q->'binding'
    AND q->'binding'->>'captureHash'=n->>'captureHash' AND q->'binding'->>'claimFence'=n->>'claimFence'
    AND q->'binding'->>'captureRevision'=n->>'captureRevision' AND atlas_staff.workspace_photos_verified(w.id)
    AND atlas_staff.operator_workspace_count(s."pilotId")=10
    AND e->>'sourceId'=n->'source'->>'sourceId' AND e->>'sourceOwnerId'=n->'source'->>'sourceOwnerId'
    AND e->>'sourceRevision'=p->>'sourceRevision' AND p->>'sourceHash' ~ '^[a-f0-9]{64}$'
    AND p->>'evidenceHash'=encode(sha256(convert_to(p->>'evidenceCanonical','UTF8')),'hex')
    AND p->>'admissionHash'=encode(sha256(convert_to(p->>'admissionCanonical','UTF8')),'hex')
    AND ad->>'version'='atlas-workspace-source-admission-v1' AND ad->>'requestId'=request_id::text
    AND ad->>'workspaceCardId'=w.id::text AND ad->>'actorKind'=actor_kind
    AND ad->>'captureHash'=n->>'captureHash' AND ad->>'claimFence'=n->>'claimFence'
    AND ad->>'sourceRevision'=p->>'sourceRevision' AND ad->>'sourceHash'=p->>'sourceHash'
    AND ad->>'evidenceHash'=p->>'evidenceHash' AND ad->>'sourceConfigHash'=s."sourceConfigHash"
    AND ad->>'gradingPolicyHash'=staff."gradingPolicyHash"
    AND length(trim(p->>'title')) BETWEEN 1 AND 200 AND length(trim(p->>'subtitle')) BETWEEN 1 AND 300
    AND jsonb_typeof(ad->'preparation'->'preparationRelease')='object'
    AND ad->'preparation'->>'frontAuthorityHash' ~ '^[a-f0-9]{64}$' AND ad->'preparation'->>'backAuthorityHash' ~ '^[a-f0-9]{64}$') IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS report admission requires its exact fresh-photo source'; END IF;
  IF actor_kind='HUMAN' THEN
    SELECT * INTO se FROM atlas_staff."StaffSession" WHERE "tokenHash"=session_hash FOR SHARE;
    SELECT * INTO br FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=se."browserHash" FOR SHARE;
    IF (se."identityId"=i.id AND se."revokedAt" IS NULL AND se."accessVersion"=i."accessVersion" AND se."controlRevision"=staff.revision
      AND se."expiresAt">at_time AND br."controlRevision"=staff.revision AND br."expiresAt">at_time) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS human report admission requires current staff access'; END IF;
  ELSIF actor_kind IS DISTINCT FROM 'MACHINE' OR session_hash IS NOT NULL OR NOT EXISTS(
    SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit" permit JOIN atlas_staff."StaffOperatorRun" run ON run.id=permit."runId"
    WHERE permit."requestId"=request_id AND permit."cardId"=w.id AND permit.state='ACTIVE'
      AND run.state='PREPARATION_READY' AND run."controlState" IN ('RUNNING','PAUSE_REQUESTED') AND atlas_staff.operator_capture_current(run.id)) THEN
    RAISE EXCEPTION 'ATLAS machine report admission requires its current recorded capture permit';
  END IF;
  IF c.mode='PRODUCTION' THEN
    IF NOT atlas_staff.operator_source_matches(n->'source'->>'sourceId',n->'source'->>'sourceOwnerId',p->>'sourceRevision') THEN
      RAISE EXCEPTION 'ATLAS original source changed before report admission'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public."AiGraderV2Session" original WHERE original.id=n->'source'->>'sourceId'
      AND original."createdByUserId"=n->'source'->>'sourceOwnerId' AND original."workflowState"='CAPTURED'
      AND original."reviewedDefects"='[]'::jsonb AND (original."gradeReport" IS NULL OR original."gradeReport"='{}'::jsonb)) THEN
      RAISE EXCEPTION 'ATLAS report must start with fresh original detector work'; END IF;
  END IF;
  FOREACH side IN ARRAY ARRAY['FRONT','BACK'] LOOP
    SELECT canonical::jsonb->'result'->'verification' INTO v FROM atlas_staff."StaffWorkspaceOperation"
      WHERE id::text=n->'sides'->side->>'verificationId' AND "cardId"=w.id;
    IF (e->'originals'->side->>'uploadedOriginalSha256'=v->>'sha256'
      AND e->'sides'->side->>'sha256' ~ '^[a-f0-9]{64}$' AND e->'originals'->side->>'sha256' ~ '^[a-f0-9]{64}$'
      AND e->'sides'->side->>'contentType'='image/webp' AND (e->'sides'->side->>'byteCount')::integer>0
      AND e->'sides'->side->>'width'='1270' AND e->'sides'->side->>'height'='1778') IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS report evidence must retain both newly uploaded original hashes'; END IF;
  END LOOP;
  SELECT * INTO existing FROM atlas_staff."StaffWorkspaceSourceAdmission" WHERE "requestId"=request_id;
  IF FOUND THEN
    IF existing."evidenceCanonical" IS DISTINCT FROM p->>'evidenceCanonical' OR existing."admissionCanonical" IS DISTINCT FROM p->>'admissionCanonical'
      OR existing."actorId"<>i.id OR existing."actorKind"<>actor_kind THEN RAISE EXCEPTION 'ATLAS source admission replay changed'; END IF;
    RETURN NEXT existing;RETURN;
  END IF;
  IF w."specimenId" IS NOT NULL OR EXISTS(SELECT 1 FROM atlas_staff."StaffSpecimen" WHERE id=w.id
    OR "sourceType"=n->'source'->>'sourceType' AND "sourceId"=n->'source'->>'sourceId') THEN
    RAISE EXCEPTION 'ATLAS original source was already admitted'; END IF;
  IF (draft=jsonb_build_object('revision',1,'evidenceRevision',1,'evidenceHash',p->>'evidenceHash',
      'observations',jsonb_build_object('FRONT','','BACK',''),'reviewedSides','[]'::jsonb,'identityReviewed',false,
      'disposition','IN_REVIEW','savedAt',NULL,'savedBy',NULL)
    AND next_workspace=n||jsonb_build_object('specimenId',w.id::text,'revision',w.revision+1,'updatedAt',next_workspace->>'updatedAt')
    AND (next_workspace->>'updatedAt')::timestamptz>=(w."updatedAt" AT TIME ZONE 'UTC')) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS report admission cannot alter the saved workflow or imply human review'; END IF;
  INSERT INTO atlas_staff."StaffWorkspaceSourceAdmission"
    ("requestId","cardId","specimenId","sourceType","sourceId","sourceOwnerId","sourceRevision","sourceHash",
      "evidenceCanonical","evidenceHash","admissionCanonical","admissionHash","sourceConfigHash","actorKind","actorId","sessionHash","accessVersion","createdAt")
    VALUES(request_id,w.id,w.id,n->'source'->>'sourceType',n->'source'->>'sourceId',n->'source'->>'sourceOwnerId',p->>'sourceRevision',p->>'sourceHash',
      p->>'evidenceCanonical',p->>'evidenceHash',p->>'admissionCanonical',p->>'admissionHash',s."sourceConfigHash",actor_kind,i.id,session_hash,i."accessVersion",at_time);
  INSERT INTO atlas_staff."StaffSpecimen"
    (id,"sourceType","sourceId","sourceOwnerId",title,subtitle,"evidenceCanonical","evidenceHash","evidenceRevision","draftRevision","analysisRevision","createdAt")
    VALUES(w.id,n->'source'->>'sourceType',n->'source'->>'sourceId',n->'source'->>'sourceOwnerId',p->>'title',p->>'subtitle',p->>'evidenceCanonical',p->>'evidenceHash',1,1,0,at_time);
  INSERT INTO atlas_staff."StaffReviewRevision"("specimenId",revision,"evidenceRevision","evidenceHash","contentHash","analysisRevision",canonical,"savedById","savedAt")
    VALUES(w.id,1,1,p->>'evidenceHash',encode(sha256(convert_to(p->>'reviewCanonical','UTF8')),'hex'),0,p->>'reviewCanonical',
      CASE actor_kind WHEN 'HUMAN' THEN i.id ELSE NULL END,at_time);
  INSERT INTO atlas_staff."StaffAssignment"("specimenId","identityId",fence,"canReview","expiresAt") VALUES(w.id,i.id,1,true,c."expiresAt");
  UPDATE atlas_staff."StaffWorkspaceCard" SET "specimenId"=w.id,revision=w.revision+1,canonical=p->>'workspaceCanonical',
    "contentHash"=encode(sha256(convert_to(p->>'workspaceCanonical','UTF8')),'hex'),"updatedAt"=(next_workspace->>'updatedAt')::timestamptz AT TIME ZONE 'UTC' WHERE id=w.id;
  INSERT INTO atlas_staff."StaffAudit"(id,event,"subjectId","actorId",details,"createdAt") VALUES(gen_random_uuid(),'WORKSPACE_SOURCE_ADMITTED',w.id::text,i.id,
    jsonb_build_object('requestId',request_id,'specimenId',w.id,'actorKind',actor_kind,'evidenceHash',p->>'evidenceHash',
      'admissionHash',p->>'admissionHash','sourceConfigHash',s."sourceConfigHash",'accessVersion',i."accessVersion")::text,at_time);
  RETURN QUERY SELECT * FROM atlas_staff."StaffWorkspaceSourceAdmission" WHERE "requestId"=request_id;
END $$;
REVOKE ALL ON FUNCTION atlas_staff.admit_workspace_source(uuid,text,text) FROM PUBLIC;

ALTER TABLE "StaffMachineInitialization" ADD COLUMN "workspaceSourceRequestId" uuid UNIQUE REFERENCES "StaffWorkspaceSourceAdmission"("requestId") ON DELETE RESTRICT,
  ADD COLUMN "admissionKind" text NOT NULL DEFAULT 'HUMAN_OPERATIONS',ALTER COLUMN "admittedSessionHash" DROP NOT NULL,
  ALTER COLUMN "operationsGrantId" DROP NOT NULL;
-- The historic CHECK still requires a session hash for old jobs. Replace only
-- that nullable field assertion for the explicit workspace admission variant.
DO $$ DECLARE expression text; BEGIN
  SELECT pg_get_constraintdef(oid) INTO expression FROM pg_constraint
    WHERE conrelid='atlas_staff."StaffMachineInitialization"'::regclass AND conname='StaffMachineInitialization_check';
  IF expression IS NULL THEN RAISE EXCEPTION 'ATLAS original machine admission shape missing'; END IF;
  IF length(expression)-length(replace(expression,'"admittedSessionHash"',''))<>length('"admittedSessionHash"') THEN
    RAISE EXCEPTION 'ATLAS original session assertion must occur exactly once'; END IF;
  expression:=replace(expression,'"admittedSessionHash"','coalesce("admittedSessionHash", repeat(''0'',64))');
  ALTER TABLE atlas_staff."StaffMachineInitialization" DROP CONSTRAINT "StaffMachineInitialization_check";
  EXECUTE 'ALTER TABLE atlas_staff."StaffMachineInitialization" ADD CONSTRAINT "StaffMachineInitialization_check" '||expression;
END $$;
ALTER TABLE "StaffMachineInitialization" ADD CONSTRAINT "StaffMachineInitialization_admission_kind" CHECK(
  "admissionKind"='HUMAN_OPERATIONS' AND "workspaceSourceRequestId" IS NULL AND "admittedSessionHash" IS NOT NULL AND "operationsGrantId" IS NOT NULL
  OR "admissionKind"='WORKSPACE_CAPTURE' AND "workspaceSourceRequestId" IS NOT NULL AND "admittedSessionHash" IS NULL AND "operationsGrantId" IS NULL);

CREATE FUNCTION atlas_staff.assert_workspace_machine_admission(job_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE j atlas_staff."StaffMachineInitialization"%ROWTYPE;a atlas_staff."StaffWorkspaceSourceAdmission"%ROWTYPE;
  w atlas_staff."StaffWorkspaceCard"%ROWTYPE;p atlas_staff."StaffWorkspaceSourceActionPermit"%ROWTYPE;
  r atlas_staff."StaffOperatorRun"%ROWTYPE;i atlas_staff."StaffIdentity"%ROWTYPE;
BEGIN
  SELECT * INTO j FROM atlas_staff."StaffMachineInitialization" WHERE id=job_id;
  SELECT * INTO a FROM atlas_staff."StaffWorkspaceSourceAdmission" WHERE "requestId"=j."workspaceSourceRequestId";
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=a."cardId";
  SELECT * INTO p FROM atlas_staff."StaffWorkspaceSourceActionPermit" WHERE "requestId"=a."requestId";
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=p."runId";
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=a."actorId" FOR SHARE;
  IF (j."admissionKind"='WORKSPACE_CAPTURE' AND a."actorKind"='MACHINE' AND a."specimenId"=j."specimenId"
    AND a."evidenceHash"=j."evidenceHash" AND a."sourceRevision"=j."sourceRevision" AND a."sourceHash"=j."sourceHash"
    AND a."admissionHash"=j."authorizationEvidenceHash" AND a."actorId"=j."admittedById" AND a."accessVersion"=j."admittedAccessVersion"
    AND i."revokedAt" IS NULL AND i."accessVersion"=a."accessVersion" AND i.role='REVIEWER'
    AND w."specimenId"=j."specimenId" AND w.canonical::jsonb->'workspace'->'pending'->>'requestId'=a."requestId"::text
    AND r.phase='CAPTURE_REVIEW' AND r.state='PREPARATION_READY' AND r."workspaceCardId"=w.id
    AND p.state='ACTIVE' AND p."captureHash"=w.canonical::jsonb->>'captureHash' AND p."claimFence"::text=w.canonical::jsonb->>'claimFence'
    AND r."controlState" IN ('RUNNING','PAUSE_REQUESTED') AND atlas_staff.operator_capture_current(r.id)
    AND EXISTS(SELECT 1 FROM atlas_staff."StaffAudit" audit WHERE audit.event='WORKSPACE_MACHINE_INITIALIZATION_ADMITTED'
      AND audit."subjectId"=j."specimenId"::text AND audit."actorId"=a."actorId"
      AND audit.details::jsonb @> jsonb_build_object('jobId',j.id::text,'operationId',j."gradingOperationId"::text,
        'requestId',a."requestId"::text,'admissionHash',a."admissionHash",'runId',r.id::text,'runtimeHash',j."runtimeHash")
      AND (j.state<>'QUEUED' OR audit.xmin=(SELECT xmin FROM atlas_staff."StaffMachineInitialization" WHERE id=j.id)))) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS machine initialization requires its retained capture admission'; END IF;
END $$;
REVOKE ALL ON FUNCTION atlas_staff.assert_workspace_machine_admission(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION atlas_staff.assert_machine_initialization(job_id uuid) RETURNS void LANGUAGE plpgsql
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
    AND (b."policyCanonical"::jsonb->'specimenIds' ? s.id::text OR atlas_staff.workspace_pilot_subject(j."pilotId",s.id) IS NOT NULL) AND j."deadlineAt">now_at
    AND j."deadlineAt"<=j."createdAt"+(b."policyCanonical"::jsonb->>'deadlineMs')::int*interval '1 millisecond'
    AND ((b."policyCanonical"::jsonb->>'version'='atlas-grading-bridge-policy-v1' AND
      (SELECT count(*) FROM atlas_staff."StaffSpecimen" WHERE b."policyCanonical"::jsonb->'specimenIds' ? id::text
        AND "sourceType"=CASE c.mode WHEN 'PRODUCTION' THEN 'SPEEDSTER' ELSE 'LOCAL_FIXTURE' END)=10)
      OR (b."policyCanonical"::jsonb->>'version'='atlas-workspace-bridge-policy-v1' AND atlas_staff.operator_workspace_count(j."pilotId")=10))
    AND s."sourceType"=CASE c.mode WHEN 'PRODUCTION' THEN 'SPEEDSTER' ELSE 'LOCAL_FIXTURE' END AND s."evidenceHash"=j."evidenceHash"
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffGradingOperation" WHERE "specimenId"=s.id AND id<>o.id AND state IN ('RESERVED','DISPATCHED','UNKNOWN'))
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorRun" WHERE "specimenId"=s.id AND state IN ('QUEUED','RUNNING','WAITING_TOOL','UNKNOWN'))
  ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS initialization requires its current source policy and runtime'; END IF;
  IF j."admissionKind"='WORKSPACE_CAPTURE' THEN PERFORM atlas_staff.assert_workspace_machine_admission(j.id); END IF;
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
  IF j.state='QUEUED' AND j."admissionKind"='WORKSPACE_CAPTURE' THEN RETURN; END IF;
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

-- The report run is a continuation of its retained capture and original
-- initialization. A private writer cannot skip that handoff or restart a
-- paused/STEP run merely by inserting a valid report manifest.
CREATE OR REPLACE FUNCTION atlas_staff.operator_capture_successor_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE prior atlas_staff."StaffOperatorRun"%ROWTYPE; w atlas_staff."StaffWorkspaceCard"%ROWTYPE;
  job atlas_staff."StaffMachineInitialization"%ROWTYPE; admission atlas_staff."StaffWorkspaceSourceAdmission"%ROWTYPE;
  permit atlas_staff."StaffWorkspaceSourceActionPermit"%ROWTYPE; source atlas_staff."StaffWorkspaceSourceOperation"%ROWTYPE;
BEGIN
  IF NEW."captureRunId" IS NULL THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO prior FROM atlas_staff."StaffOperatorRun" WHERE id=NEW."captureRunId";
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=NEW."workspaceCardId";
  IF (NEW.phase='REPORT_REVIEW' AND prior.phase='CAPTURE_REVIEW' AND prior.state='PREPARATION_READY'
    AND prior."workspaceCardId"=NEW."workspaceCardId" AND prior."pilotId"=NEW."pilotId"
    AND prior."evidenceHash"=w.canonical::jsonb->>'captureHash' AND w."specimenId"=NEW."specimenId"
    AND w.canonical::jsonb->'claim'->>'kind'='ASTRA' AND w.canonical::jsonb->'claim'->>'runId'=NEW.id::text
    AND w.canonical::jsonb->'claim'->>'fence'=prior."manifestCanonical"::jsonb->>'claimFence'
    AND NEW."manifestCanonical"::jsonb->>'captureRunId'=prior.id::text
    AND NEW."manifestCanonical"::jsonb->>'workspaceCardId'=w.id::text
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=prior.id
      AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN'))) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS report successor requires its settled exact capture run'; END IF;
  SELECT * INTO job FROM atlas_staff."StaffMachineInitialization" WHERE id=NEW."initializationId";
  IF job."admissionKind" IS DISTINCT FROM 'WORKSPACE_CAPTURE' THEN RETURN NULL; END IF;
  SELECT * INTO admission FROM atlas_staff."StaffWorkspaceSourceAdmission" WHERE "requestId"=job."workspaceSourceRequestId";
  SELECT * INTO permit FROM atlas_staff."StaffWorkspaceSourceActionPermit" WHERE "requestId"=admission."requestId";
  SELECT * INTO source FROM atlas_staff."StaffWorkspaceSourceOperation" WHERE "requestId"=admission."requestId" AND purpose='INITIALIZE_REPORT' AND side='PAIR';
  IF (job.state='SUCCEEDED' AND job.id=admission."requestId" AND job."specimenId"=NEW."specimenId"
    AND job."pilotId"=NEW."pilotId" AND job."runtimeHash"=NEW."runtimeHash" AND job."runtimeHash"=prior."runtimeHash"
    AND admission."actorKind"='MACHINE' AND admission."sessionHash" IS NULL AND admission."cardId"=w.id
    AND admission."specimenId"=job."specimenId" AND admission."evidenceHash"=job."evidenceHash"
    AND admission."admissionHash"=job."authorizationEvidenceHash" AND admission."actorId"=job."admittedById"
    AND admission."accessVersion"=job."admittedAccessVersion"
    AND permit.state='SUCCEEDED' AND permit."cardId"=w.id AND permit."runId"=prior.id AND permit."runRevision"=prior.revision
    AND permit."claimFence"=(w.canonical::jsonb->>'claimFence')::integer AND permit."captureHash"=w.canonical::jsonb->>'captureHash'
    AND source.state='SUCCEEDED' AND source."cardId"=w.id AND source."runId"=prior.id AND source."pilotId"=job."pilotId"
    AND source."gradingExecutionId"=job."gradingOperationId"
    AND NEW."executionMode"=prior."executionMode" AND NEW."stepBudget"=0
    AND NEW."controlState"=CASE WHEN prior."controlState"='RUNNING' AND prior."executionMode"='CONTINUOUS' THEN 'RUNNING' ELSE 'PAUSED' END
    AND prior."controlState" IN ('RUNNING','PAUSED','PAUSE_REQUESTED')
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit" WHERE "runId"=prior.id AND state IN ('ACTIVE','UNKNOWN'))
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceOperation" WHERE "runId"=prior.id AND state IN ('RESERVED','DISPATCHED','UNKNOWN'))
    AND EXISTS(SELECT 1 FROM atlas_staff."StaffIdentity" i WHERE i.id=admission."actorId" AND i.role='REVIEWER'
      AND i."revokedAt" IS NULL AND i."accessVersion"=admission."accessVersion" AND i.id::text=w.canonical::jsonb->'claim'->>'actorId')
    AND EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceOperation" event WHERE event.action='MACHINE_REPORT_SUCCESSOR'
      AND event."actorId"=admission."actorId" AND event."cardId"=w.id AND event."operationId"='machine-report-'||admission."requestId"::text
      AND event.xmin=(SELECT xmin FROM atlas_staff."StaffOperatorRun" WHERE id=NEW.id)
      AND event.canonical::jsonb->'result'=jsonb_build_object('actor','MACHINE','sourceRequestId',admission."requestId"::text,
        'captureRunId',prior.id::text,'reportRunId',NEW.id::text,'claimFence',(w.canonical::jsonb->>'claimFence')::integer,'revision',w.revision))) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS report successor requires its exact completed source permit initialization and immutable handoff'; END IF;
  RETURN NULL;
END $$;
COMMIT;
