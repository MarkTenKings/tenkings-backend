-- M13: independent human identity correction with preserved original grading evidence.
-- M13 requires M2..M12. No grants, activation, source UPDATE definer or worker.
-- JS pure classifier + original preparation/map authority remain private-owner
-- prerequisites. SQL checks its exact preserved proof, never reimplements JS ICU
-- normalization or asserts fresh detector execution from a correction.
BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;
CREATE TABLE "StaffIdentityCorrectionControl" (
  id text PRIMARY KEY DEFAULT 'active',enabled boolean NOT NULL DEFAULT false,mode text NOT NULL,origin text NOT NULL,
  "deploymentId" varchar(120) NOT NULL,"releaseSha" varchar(40) NOT NULL,"configHash" varchar(64) NOT NULL,
  "clientKeyHash" varchar(64) NOT NULL,"gradingPolicyHash" varchar(64) NOT NULL,"phoneAllowlistHash" varchar(64) NOT NULL,
  revision integer NOT NULL DEFAULT 1,"updatedAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CHECK ((id='active' AND revision>0 AND length(trim("deploymentId"))>0 AND origin ~ '^https://[a-z0-9.-]+(:[0-9]+)?$'
    AND "releaseSha" ~ '^[a-f0-9]{40}$' AND "configHash" ~ '^[a-f0-9]{64}$' AND "clientKeyHash" ~ '^[a-f0-9]{64}$'
    AND "gradingPolicyHash" ~ '^[a-f0-9]{64}$' AND "phoneAllowlistHash" ~ '^[a-f0-9]{64}$'
    AND ((mode='PRODUCTION' AND "releaseSha"<>repeat('0',40)) OR (mode='LOCAL_FIXTURE' AND "releaseSha"=repeat('0',40)))) IS TRUE)
);
CREATE TRIGGER "StaffIdentityCorrectionControl_revision" BEFORE UPDATE ON "StaffIdentityCorrectionControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_control_guard();
CREATE FUNCTION atlas_staff.identity_correction_control_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE binding text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  binding:=atlas_staff.learning_fixed_object(jsonb_build_object('purpose','atlas-identity-correction-v1','mode',NEW.mode,
    'origin',NEW.origin,'deploymentId',NEW."deploymentId",'releaseSha',NEW."releaseSha",'clientKeyHash',NEW."clientKeyHash",
    'gradingPolicyHash',NEW."gradingPolicyHash",'phoneAllowlistHash',NEW."phoneAllowlistHash"));
  IF NEW."configHash"<>encode(sha256(convert_to(binding,'UTF8')),'hex') OR EXISTS(
    SELECT 1 FROM (SELECT "clientKeyHash" FROM atlas_staff."StaffGradingBridgeControl" UNION ALL
      SELECT "clientKeyHash" FROM atlas_staff."StaffIntakeControl" UNION ALL SELECT "clientKeyHash" FROM atlas_staff."StaffOperatorImageControl" UNION ALL
      SELECT "clientKeyHash" FROM atlas_staff."PublicMediaControl" UNION ALL SELECT "clientKeyHash" FROM atlas_staff."StaffLearningControl") k
    WHERE k."clientKeyHash"=NEW."clientKeyHash") THEN RAISE EXCEPTION 'ATLAS correction requires exact distinct-key configuration'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffIdentityCorrectionControl_binding" BEFORE INSERT OR UPDATE ON "StaffIdentityCorrectionControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.identity_correction_control_guard();

CREATE TABLE "StaffIdentityCorrection" (
  id uuid PRIMARY KEY,"specimenId" uuid NOT NULL REFERENCES "StaffSpecimen"(id) ON DELETE RESTRICT,
  "actorId" uuid NOT NULL REFERENCES "StaffIdentity"(id) ON DELETE RESTRICT,"operationId" uuid NOT NULL,
  "sessionHash" varchar(64) NOT NULL REFERENCES "StaffSession"("tokenHash") ON DELETE RESTRICT,
  "browserHash" varchar(64) NOT NULL REFERENCES "StaffBrowser"("tokenHash") ON DELETE RESTRICT,
  "accessVersion" integer NOT NULL,"assignmentFence" integer NOT NULL,"controlRevision" integer NOT NULL,"correctionControlRevision" integer NOT NULL,
  "gradingPolicyHash" varchar(64) NOT NULL,"bridgeConfigHash" varchar(64) NOT NULL,
  "requestCanonical" text NOT NULL,"inputHash" varchar(64) NOT NULL,
  "sourceType" text NOT NULL,"sourceId" varchar(128) NOT NULL,"sourceOwnerId" varchar(128) NOT NULL,
  "expectedAnalysisRevision" integer NOT NULL,"expectedReviewRevision" integer NOT NULL,"expectedEvidenceRevision" integer NOT NULL,
  "resultAnalysisRevision" integer NOT NULL,"resultReviewRevision" integer NOT NULL,"resultEvidenceRevision" integer NOT NULL,
  "oldSourceRevision" varchar(80) NOT NULL,"newSourceRevision" varchar(80) NOT NULL,
  "oldSourceHash" varchar(64) NOT NULL,"newSourceHash" varchar(64) NOT NULL,
  "oldEvidenceHash" varchar(64) NOT NULL,"newEvidenceHash" varchar(64) NOT NULL,
  "oldReportHash" varchar(64) NOT NULL,"newReportHash" varchar(64) NOT NULL,
  "oldReviewHash" varchar(64) NOT NULL,"newReviewHash" varchar(64) NOT NULL,"oldAdmissionHash" varchar(64) NOT NULL,
  "oldIdentityCanonical" text NOT NULL,"newIdentityCanonical" text NOT NULL,
  "oldEvidenceCanonical" text NOT NULL,"newEvidenceCanonical" text NOT NULL,
  "rawSourceCanonical" text NOT NULL,"rawSourceHash" varchar(64) NOT NULL,
  "nextRawSourceCanonical" text NOT NULL,"nextRawSourceHash" varchar(64) NOT NULL,
  "proofCanonical" text NOT NULL,"proofHash" varchar(64) NOT NULL,
  "priorApprovalId" uuid,"createdAt" timestamp(3) NOT NULL,
  UNIQUE("actorId","operationId"), UNIQUE(id,"specimenId"), UNIQUE("specimenId","expectedAnalysisRevision"),
  FOREIGN KEY ("priorApprovalId","specimenId") REFERENCES "StaffReportApproval"(id,"specimenId") ON DELETE RESTRICT,
  FOREIGN KEY ("specimenId","expectedAnalysisRevision") REFERENCES "StaffAnalysisRevision"("specimenId",revision) ON DELETE RESTRICT,
  FOREIGN KEY ("specimenId","expectedReviewRevision") REFERENCES "StaffReviewRevision"("specimenId",revision) ON DELETE RESTRICT,
  CHECK (("accessVersion">0 AND "assignmentFence">0 AND "controlRevision">0 AND "correctionControlRevision">0
    AND "expectedAnalysisRevision">0 AND "expectedReviewRevision">0 AND "expectedEvidenceRevision">0
    AND "resultAnalysisRevision"="expectedAnalysisRevision"+1 AND "resultReviewRevision"="expectedReviewRevision"+1
    AND "resultEvidenceRevision"="expectedEvidenceRevision"+1 AND "sourceType" IN ('LOCAL_FIXTURE','SPEEDSTER')
    AND length("sourceId")>0 AND length("sourceOwnerId")>0 AND "sourceId"!~'[[:cntrl:]]' AND "sourceOwnerId"!~'[[:cntrl:]]'
    AND "oldSourceRevision" ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'
    AND "newSourceRevision" ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'
    AND "newSourceRevision"::timestamptz>"oldSourceRevision"::timestamptz
    AND "oldSourceHash"<>"newSourceHash" AND "oldEvidenceHash"<>"newEvidenceHash"
    AND octet_length("requestCanonical") BETWEEN 2 AND 16384 AND octet_length("proofCanonical") BETWEEN 2 AND 4194304
    AND octet_length("oldIdentityCanonical") BETWEEN 2 AND 8192 AND octet_length("newIdentityCanonical") BETWEEN 2 AND 8192
    AND octet_length("oldEvidenceCanonical") BETWEEN 2 AND 131072 AND octet_length("newEvidenceCanonical") BETWEEN 2 AND 131072
    AND octet_length("rawSourceCanonical") BETWEEN 2 AND 33554432 AND octet_length("nextRawSourceCanonical") BETWEEN 2 AND 33554432
    AND "inputHash"=encode(sha256(convert_to("requestCanonical",'UTF8')),'hex')
    AND "proofHash"=encode(sha256(convert_to("proofCanonical",'UTF8')),'hex')
    AND "oldEvidenceHash"=encode(sha256(convert_to("oldEvidenceCanonical",'UTF8')),'hex')
    AND "newEvidenceHash"=encode(sha256(convert_to("newEvidenceCanonical",'UTF8')),'hex')
    AND "rawSourceHash"=encode(sha256(convert_to("rawSourceCanonical",'UTF8')),'hex')
    AND "nextRawSourceHash"=encode(sha256(convert_to("nextRawSourceCanonical",'UTF8')),'hex')) IS TRUE)
);
CREATE INDEX "StaffIdentityCorrection_source_idx" ON "StaffIdentityCorrection"("sourceId","sourceOwnerId","createdAt");
ALTER TABLE "StaffAnalysisRevision" ADD COLUMN "identityCorrectionId" uuid UNIQUE;
ALTER TABLE "StaffAnalysisRevision" ADD CONSTRAINT "StaffAnalysisRevision_correction_fkey"
  FOREIGN KEY ("identityCorrectionId","specimenId") REFERENCES "StaffIdentityCorrection"(id,"specimenId") ON DELETE RESTRICT;
-- Replacement 1: ordinary M3 checks unchanged; production requires exactly one
-- provenance. Historical LOCAL_FIXTURE rows with neither remain accepted.
ALTER TABLE "StaffAnalysisRevision" DROP CONSTRAINT "StaffAnalysisRevision_shape";
ALTER TABLE "StaffAnalysisRevision" ADD CONSTRAINT "StaffAnalysisRevision_shape" CHECK ((
  revision>0 AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND mode IN ('LOCAL_FIXTURE','PRODUCTION')
  AND num_nonnulls("operationId","identityCorrectionId")<=1
  AND (mode='LOCAL_FIXTURE' OR num_nonnulls("operationId","identityCorrectionId")=1)
  AND octet_length("sourceCanonical")<=33554432 AND jsonb_typeof("sourceCanonical"::jsonb)='object'
  AND octet_length("reportCanonical")<=33554432 AND "reportCanonical"::jsonb->>'version'='atlas-graded-report-v1'
  AND octet_length("admissionCanonical")<=131072 AND jsonb_typeof("admissionCanonical"::jsonb)='object'
  AND "sourceHash"=encode(sha256(convert_to("sourceCanonical",'UTF8')),'hex')
  AND "reportHash"=encode(sha256(convert_to("reportCanonical",'UTF8')),'hex')
  AND "admissionHash"=encode(sha256(convert_to("admissionCanonical",'UTF8')),'hex')) IS TRUE);

-- Compare exact existing canonical JSON value text, including numeric lexemes;
-- never recompute hashes from JSONB's numeric serialization.
CREATE FUNCTION atlas_staff.correction_same_except(a text,b text,allowed text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
  SELECT json_typeof(a::json)='object' AND json_typeof(b::json)='object'
    AND (SELECT count(*)=count(DISTINCT key) FROM json_each(a::json))
    AND (SELECT count(*)=count(DISTINCT key) FROM json_each(b::json))
    AND NOT EXISTS(SELECT key FROM json_each(a::json) WHERE NOT key=ANY(allowed)
      UNION SELECT key FROM json_each(b::json) WHERE NOT key=ANY(allowed)
      EXCEPT SELECT x.key FROM json_each(a::json) x JOIN json_each(b::json) y ON x.key=y.key
      WHERE NOT x.key=ANY(allowed) AND x.value::text=y.value::text);
$$;
CREATE FUNCTION atlas_staff.correction_raw_projection(s public."AiGraderV2Session") RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('id',s.id,'createdByUserId',s."createdByUserId",'cardProfile',s."cardProfile",'workflowState',s."workflowState",
    'identity',s.identity,'capture',s.capture,'reviewedDefects',s."reviewedDefects",'gradeReport',s."gradeReport",
    'mapRevisionId',s."mapRevisionId",'mapFilterPolicyVersion',s."mapFilterPolicyVersion",'mapRegistration',s."mapRegistration",
    'updatedAt',to_char(s."updatedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$$;
CREATE FUNCTION atlas_staff.correction_scope_current(r atlas_staff."StaffIdentityCorrection") RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE co atlas_staff."StaffControl"%ROWTYPE; cc atlas_staff."StaffIdentityCorrectionControl"%ROWTYPE;
  i atlas_staff."StaffIdentity"%ROWTYPE; s atlas_staff."StaffSession"%ROWTYPE; b atlas_staff."StaffBrowser"%ROWTYPE;
  a atlas_staff."StaffAssignment"%ROWTYPE; c atlas_staff."StaffSpecimen"%ROWTYPE; now_at timestamp;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO cc FROM atlas_staff."StaffIdentityCorrectionControl" WHERE id='active' FOR SHARE;
  SELECT * INTO co FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=r."actorId" FOR SHARE;
  SELECT * INTO s FROM atlas_staff."StaffSession" WHERE "tokenHash"=r."sessionHash" FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=r."browserHash" FOR SHARE;
  SELECT * INTO a FROM atlas_staff."StaffAssignment" WHERE "specimenId"=r."specimenId" AND "identityId"=r."actorId" FOR SHARE;
  SELECT * INTO c FROM atlas_staff."StaffSpecimen" WHERE id=r."specimenId" FOR UPDATE;
  -- Original grading bridge pins are historical admission authority only; its
  -- enabled bit does not authorize this independent no-worker operation.
  PERFORM 1 FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE;
  -- Original source lock precedes final freshness clock. No public UPDATE grant.
  PERFORM 1 FROM public."AiGraderV2Session" WHERE id=r."sourceId" AND "createdByUserId"=r."sourceOwnerId" FOR UPDATE;
  now_at:=clock_timestamp() AT TIME ZONE 'UTC';
  RETURN (co.enabled AND cc.enabled AND co.mode=cc.mode AND co."gradingPolicyHash"=cc."gradingPolicyHash"
    AND co.revision=r."controlRevision" AND cc.revision=r."correctionControlRevision" AND cc."configHash"=r."bridgeConfigHash"
    AND cc."gradingPolicyHash"=r."gradingPolicyHash" AND i.role='REVIEWER' AND i."revokedAt" IS NULL AND i."accessVersion"=r."accessVersion"
    AND s."identityId"=i.id AND s."accessVersion"=i."accessVersion" AND s."revokedAt" IS NULL AND s."controlRevision"=co.revision
    AND s."createdAt"<=now_at AND s."createdAt">=now_at-interval '5 minutes' AND s."expiresAt">now_at
    AND b."tokenHash"=s."browserHash" AND b."controlRevision"=co.revision AND b."createdAt"<=s."createdAt" AND b."expiresAt">now_at
    AND a."canReview" AND a."revokedAt" IS NULL AND a."expiresAt">now_at AND a.fence=r."assignmentFence"
    AND c."sourceType"=r."sourceType" AND c."sourceId"=r."sourceId" AND c."sourceOwnerId"=r."sourceOwnerId"
    AND c."sourceType"=CASE co.mode WHEN 'PRODUCTION' THEN 'SPEEDSTER' ELSE 'LOCAL_FIXTURE' END
    AND (co.mode='LOCAL_FIXTURE' OR EXISTS(SELECT 1 FROM atlas_staff."StaffGradingBridgeControl" g
      JOIN atlas_staff."StaffAnalysisRevision" olda ON olda."specimenId"=r."specimenId" AND olda.revision=r."expectedAnalysisRevision"
      WHERE g.id='active' AND g.mode=co.mode AND g."gradingPolicyHash"=r."gradingPolicyHash"
        AND g."policyHash"=olda."admissionCanonical"::jsonb->>'bridgePolicyHash'
        AND g.revision=(olda."admissionCanonical"::jsonb->>'bridgeRevision')::int
        AND olda."admissionCanonical"::jsonb->'detectionPair' IS NOT NULL AND olda."admissionCanonical"::jsonb->'detectionPair'<>'null'::jsonb))
    AND r."createdAt">=s."createdAt" AND r."createdAt">now_at-interval '15 seconds' AND r."createdAt"<=now_at) IS TRUE;
END $$;
CREATE FUNCTION atlas_staff.correction_work_clear(r atlas_staff."StaffIdentityCorrection") RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
 SELECT NOT EXISTS(SELECT 1 FROM atlas_staff."StaffGradingOperation" WHERE "specimenId"=r."specimenId" AND state IN ('RESERVED','DISPATCHED','UNKNOWN'))
 AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffGradingExecution" e JOIN atlas_staff."StaffGradingOperation" o ON o.id=e."operationId"
   WHERE o."specimenId"=r."specimenId" AND e.state IN ('RUNNING','UNKNOWN'))
 AND atlas_staff.operator_work_pending(r."specimenId")=0
 AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" a JOIN atlas_staff."StaffOperatorRun" o ON o.id=a."runId"
   WHERE o."specimenId"=r."specimenId" AND a.state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN'))
 AND NOT EXISTS(SELECT 1 FROM atlas_staff.read_operator_proposals(r."specimenId") p WHERE p."evidenceHash"=r."oldEvidenceHash"
   AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffProposalDecision" d WHERE d."stepId"=p."stepId"
     AND d."analysisRevision"=r."expectedAnalysisRevision" AND d."evidenceHash"=r."oldEvidenceHash"))
 AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffNfcJob" j WHERE j."specimenId"=r."specimenId" AND j."expiresAt">clock_timestamp() AT TIME ZONE 'UTC')
 AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffPhysicalFinish" a WHERE a."specimenId"=r."specimenId" AND a.stage='ASSEMBLED'
   AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffPhysicalFinish" w WHERE w."assemblyId"=a.id AND w.stage='SONIC_WELDED'));
$$;

CREATE FUNCTION atlas_staff.identity_correction_insert_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE c atlas_staff."StaffSpecimen"%ROWTYPE; a atlas_staff."StaffAnalysisRevision"%ROWTYPE; v atlas_staff."StaffReviewRevision"%ROWTYPE;
  source public."AiGraderV2Session"%ROWTYPE; approval uuid; p jsonb; q jsonb; expected jsonb; k text;
BEGIN
  IF atlas_staff.correction_scope_current(NEW) IS NOT TRUE OR atlas_staff.correction_work_clear(NEW) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS correction requires fresh human authority and resolved work'; END IF;
  SELECT * INTO c FROM atlas_staff."StaffSpecimen" WHERE id=NEW."specimenId";
  SELECT * INTO a FROM atlas_staff."StaffAnalysisRevision" WHERE "specimenId"=c.id AND revision=c."analysisRevision";
  SELECT * INTO v FROM atlas_staff."StaffReviewRevision" WHERE "specimenId"=c.id AND revision=c."draftRevision";
  SELECT * INTO source FROM public."AiGraderV2Session" WHERE id=NEW."sourceId" AND "createdByUserId"=NEW."sourceOwnerId" FOR UPDATE;
  SELECT "currentApprovalId" INTO approval FROM atlas_staff."StaffPublicReport" WHERE "specimenId"=c.id FOR SHARE;
  p:=NEW."proofCanonical"::jsonb;q:=NEW."requestCanonical"::jsonb;
  IF atlas_staff.learning_exact_keys(NEW."requestCanonical"::json,ARRAY['version','specimenId','request']) IS NOT TRUE
    OR atlas_staff.learning_exact_keys((NEW."requestCanonical"::json)->'request',ARRAY['operationId','expectedAnalysisRevision','expectedReviewRevision',
      'expectedEvidenceRevision','analysisHash','reviewHash','evidenceHash','sourceRevision','next','reason']) IS NOT TRUE
    OR atlas_staff.learning_exact_keys((NEW."requestCanonical"::json)->'request'->'next',ARRAY['cardProfile','identity']) IS NOT TRUE
    OR atlas_staff.learning_exact_keys(NEW."rawSourceCanonical"::json,ARRAY['id','createdByUserId','cardProfile','workflowState','identity',
      'capture','reviewedDefects','gradeReport','mapRevisionId','mapFilterPolicyVersion','mapRegistration','updatedAt']) IS NOT TRUE
    OR atlas_staff.learning_exact_keys(NEW."nextRawSourceCanonical"::json,ARRAY['id','createdByUserId','cardProfile','workflowState','identity',
      'capture','reviewedDefects','gradeReport','mapRevisionId','mapFilterPolicyVersion','mapRegistration','updatedAt']) IS NOT TRUE
    OR atlas_staff.learning_exact_keys(NEW."proofCanonical"::json,ARRAY['purpose','classification','expected','sourceCanonical','evidenceCanonical',
      'admissionCanonical','rawFindingsHash','captureHash','gradeReportHash','reportHash','oldIdentityCanonical','nextIdentityCanonical','nextCardProfile',
      'oldKeys','nextKeys','changedFields','reasons','requiresCurrentAuthorityRevalidation']) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS correction requires exact bounded private shapes'; END IF;
  IF a.mode='PRODUCTION' AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffGradingBridgeControl" b
    WHERE b.id='active' AND b.mode=a.mode AND b."gradingPolicyHash"=NEW."gradingPolicyHash"
      AND b."policyHash"=a."admissionCanonical"::jsonb->>'bridgePolicyHash'
      AND b.revision=(a."admissionCanonical"::jsonb->>'bridgeRevision')::integer
      AND a."admissionCanonical"::jsonb->'detectionPair' IS NOT NULL
      AND a."admissionCanonical"::jsonb->'detectionPair'<>'null'::jsonb) THEN
    RAISE EXCEPTION 'ATLAS correction historical detection admission changed'; END IF;
  expected:=jsonb_build_object('sourceId',NEW."sourceId",'sourceOwnerId',NEW."sourceOwnerId",'sourceRevision',NEW."oldSourceRevision",
    'sourceHash',NEW."oldSourceHash",'evidenceHash',NEW."oldEvidenceHash",'gradingPolicyHash',NEW."gradingPolicyHash",
    'evidenceSourceRevision',NEW."oldEvidenceCanonical"::jsonb->>'sourceRevision');
  IF (c."analysisRevision"=NEW."expectedAnalysisRevision" AND c."draftRevision"=NEW."expectedReviewRevision"
    AND c."evidenceRevision"=NEW."expectedEvidenceRevision" AND c."evidenceHash"=NEW."oldEvidenceHash"
    AND c."evidenceCanonical"=NEW."oldEvidenceCanonical" AND a."sourceHash"=NEW."oldSourceHash"
    AND a."reportHash"=NEW."oldReportHash" AND a."admissionHash"=NEW."oldAdmissionHash" AND v."contentHash"=NEW."oldReviewHash"
    AND a."sourceRevision"=NEW."oldSourceRevision" AND a."evidenceHash"=c."evidenceHash"
    AND a."admissionCanonical"::jsonb->>'purpose'='atlas-analysis-admission-v1'
    AND a."admissionCanonical"::jsonb->>'policyHash'=NEW."gradingPolicyHash"
    AND a."admissionCanonical"::jsonb->>'sourceHash'=a."sourceHash"
    AND a."admissionCanonical"::jsonb->>'evidenceHash'=c."evidenceHash"
    AND approval IS NOT DISTINCT FROM NEW."priorApprovalId" AND source."workflowState"='CAPTURED'
    AND source."cardProfile" IN ('SPORTS','POKEMON') AND a."sourceCanonical"::jsonb->>'cardProfile'=source."cardProfile"
    AND a."reportCanonical"::jsonb->>'cardProfile'=source."cardProfile"
    AND atlas_staff.correction_raw_projection(source)=NEW."rawSourceCanonical"::jsonb
    AND NEW."rawSourceCanonical"::jsonb->>'updatedAt'=NEW."oldSourceRevision"
    AND NEW."nextRawSourceCanonical"::jsonb->>'updatedAt'=NEW."newSourceRevision"
    AND NEW."newSourceRevision"::timestamptz AT TIME ZONE 'UTC'>=NEW."createdAt"
    AND NEW."newSourceRevision"::timestamptz AT TIME ZONE 'UTC'<=NEW."createdAt"+interval '1 second'
    AND atlas_staff.correction_same_except(NEW."rawSourceCanonical",NEW."nextRawSourceCanonical",ARRAY['identity','updatedAt'])
    AND json_extract_path(NEW."rawSourceCanonical"::json,'identity')::text=NEW."oldIdentityCanonical"
    AND json_extract_path(NEW."nextRawSourceCanonical"::json,'identity')::text=NEW."newIdentityCanonical"
    AND json_extract_path(a."sourceCanonical"::json,'identity')::text=NEW."oldIdentityCanonical"
    AND NEW."oldIdentityCanonical"<>NEW."newIdentityCanonical"
    AND (NEW."oldIdentityCanonical"::jsonb->>'layoutType') IS NOT DISTINCT FROM (NEW."newIdentityCanonical"::jsonb->>'layoutType')
    AND p->>'purpose'='atlas-identity-correction-proposal-v1' AND p->>'classification'='COMPATIBLE' AND p->'expected'=expected
    AND p->>'sourceCanonical'=a."sourceCanonical" AND p->>'evidenceCanonical'=NEW."oldEvidenceCanonical"
    AND p->>'oldIdentityCanonical'=NEW."oldIdentityCanonical" AND p->>'nextIdentityCanonical'=NEW."newIdentityCanonical"
    AND p->'oldKeys'=p->'nextKeys' AND p->'oldKeys'->'exact'->>'category'=source."cardProfile"
    AND p->'oldKeys'->'family'->>'category'=source."cardProfile"
    AND p->'reasons'='[]'::jsonb AND jsonb_array_length(p->'changedFields')>0
    AND p->>'nextCardProfile'=source."cardProfile" AND p->>'requiresCurrentAuthorityRevalidation'='true'
    AND p->>'reportHash'=a."reportHash" AND p->>'rawFindingsHash'=encode(sha256(convert_to(json_extract_path(a."sourceCanonical"::json,'reviewedDefects')::text,'UTF8')),'hex')
    AND p->>'captureHash'=encode(sha256(convert_to(json_extract_path(a."sourceCanonical"::json,'capture')::text,'UTF8')),'hex')
    AND p->>'gradeReportHash'=encode(sha256(convert_to(json_extract_path(a."sourceCanonical"::json,'gradeReport')::text,'UTF8')),'hex')
    AND q->>'version'='atlas-identity-correction-request-v1' AND q->>'specimenId'=c.id::text
    AND q->'request'->>'operationId'=NEW."operationId"::text
    AND q->'request'->>'expectedAnalysisRevision'=NEW."expectedAnalysisRevision"::text
    AND q->'request'->>'expectedReviewRevision'=NEW."expectedReviewRevision"::text
    AND q->'request'->>'expectedEvidenceRevision'=NEW."expectedEvidenceRevision"::text
    AND q->'request'->>'analysisHash'=NEW."oldSourceHash" AND q->'request'->>'reviewHash'=NEW."oldReviewHash"
    AND q->'request'->>'evidenceHash'=NEW."oldEvidenceHash" AND q->'request'->>'sourceRevision'=NEW."oldSourceRevision"
    AND q->'request'->'next'->>'cardProfile'=source."cardProfile"
    AND q->'request'->'next'->'identity'=NEW."newIdentityCanonical"::jsonb
    AND length(trim(q->'request'->>'reason')) BETWEEN 1 AND 1000) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS correction preimage and compatible proof must match exact current source'; END IF;
  FOREACH k IN ARRAY ARRAY['sessionHash','browserHash','gradingPolicyHash','bridgeConfigHash','oldSourceHash','newSourceHash',
    'oldReportHash','newReportHash','oldReviewHash','newReviewHash','oldAdmissionHash'] LOOP
    IF (to_jsonb(NEW)->>k) !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'ATLAS correction hash required'; END IF;
  END LOOP;
  -- Original evidence differs only in source revision and identity hash. All
  -- private image descriptors, preparations, original images/maps are retained.
  IF (atlas_staff.correction_same_except(NEW."oldEvidenceCanonical",NEW."newEvidenceCanonical",ARRAY['sourceRevision','identityHash'])
    AND NEW."newEvidenceCanonical"::jsonb->>'sourceRevision'=NEW."newSourceRevision"
    AND NEW."newEvidenceCanonical"::jsonb->>'sourceId'=NEW."sourceId"
    AND NEW."newEvidenceCanonical"::jsonb->>'sourceOwnerId'=NEW."sourceOwnerId"
    AND NEW."newEvidenceCanonical"::jsonb->>'version'='atlas-speedster-evidence-v1'
    AND NEW."newEvidenceCanonical"::jsonb->>'identityHash'=encode(sha256(convert_to(
      '{"cardProfile":'||to_json(source."cardProfile")::text||',"identity":'||NEW."newIdentityCanonical"||'}','UTF8')),'hex')) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS correction cannot replace capture or evidence lineage'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffIdentityCorrection_preimage" BEFORE INSERT ON "StaffIdentityCorrection"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.identity_correction_insert_guard();

-- Only a transaction already holding its own immutable receipt opts into this
-- guard. Existing original-service writes without a correction receipt retain
-- their own semantics. This is not a general staff-role source write capability.
CREATE FUNCTION atlas_staff.identity_correction_source_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffIdentityCorrection"%ROWTYPE;
BEGIN
  SELECT * INTO r FROM atlas_staff."StaffIdentityCorrection" WHERE "sourceId"=OLD.id AND "sourceOwnerId"=OLD."createdByUserId"
    AND xmin::text=(pg_current_xact_id()::text::numeric%4294967296)::text;
  IF r.id IS NULL THEN RETURN NEW; END IF;
  IF (atlas_staff.correction_raw_projection(OLD)=r."rawSourceCanonical"::jsonb
    AND atlas_staff.correction_raw_projection(NEW)=r."nextRawSourceCanonical"::jsonb
    AND (to_jsonb(OLD)-ARRAY['identity','updatedAt'])=(to_jsonb(NEW)-ARRAY['identity','updatedAt'])
    AND OLD.identity IS DISTINCT FROM NEW.identity AND NEW."updatedAt">OLD."updatedAt") IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS correction source CAS changes identity and revision only'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AiGraderV2Session_atlas_identity_correction" BEFORE UPDATE ON public."AiGraderV2Session"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.identity_correction_source_guard();
-- Revisit every update event at commit as well: a private writer cannot change
-- hidden/raw fields earlier in the same transaction, insert a receipt later,
-- and evade the identity-only OLD/NEW check by changing statement order.
CREATE CONSTRAINT TRIGGER "AiGraderV2Session_atlas_identity_correction_commit" AFTER UPDATE ON public."AiGraderV2Session"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.identity_correction_source_guard();

CREATE FUNCTION atlas_staff.assert_identity_correction_commit(correction_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffIdentityCorrection"%ROWTYPE; c atlas_staff."StaffSpecimen"%ROWTYPE;
  olda atlas_staff."StaffAnalysisRevision"%ROWTYPE; newa atlas_staff."StaffAnalysisRevision"%ROWTYPE;
  oldv atlas_staff."StaffReviewRevision"%ROWTYPE; newv atlas_staff."StaffReviewRevision"%ROWTYPE;
  source public."AiGraderV2Session"%ROWTYPE; audit atlas_staff."StaffAudit"%ROWTYPE; approval uuid; admission jsonb;
  xid_text text:=(pg_current_xact_id()::text::numeric%4294967296)::text; valid boolean;
BEGIN
  SELECT * INTO r FROM atlas_staff."StaffIdentityCorrection" WHERE id=correction_id AND xmin::text=xid_text;
  IF r.id IS NULL OR atlas_staff.correction_scope_current(r) IS NOT TRUE OR atlas_staff.correction_work_clear(r) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS correction requires same-transaction fresh scoped receipt'; END IF;
  SELECT * INTO c FROM atlas_staff."StaffSpecimen" WHERE id=r."specimenId" AND xmin::text=xid_text;
  SELECT * INTO olda FROM atlas_staff."StaffAnalysisRevision" WHERE "specimenId"=r."specimenId" AND revision=r."expectedAnalysisRevision";
  SELECT * INTO oldv FROM atlas_staff."StaffReviewRevision" WHERE "specimenId"=r."specimenId" AND revision=r."expectedReviewRevision";
  SELECT * INTO newa FROM atlas_staff."StaffAnalysisRevision" WHERE "identityCorrectionId"=r.id AND xmin::text=xid_text;
  SELECT * INTO newv FROM atlas_staff."StaffReviewRevision" WHERE "specimenId"=r."specimenId" AND revision=r."resultReviewRevision" AND xmin::text=xid_text;
  SELECT * INTO source FROM public."AiGraderV2Session" WHERE id=r."sourceId" AND "createdByUserId"=r."sourceOwnerId" AND xmin::text=xid_text FOR UPDATE;
  SELECT * INTO audit FROM atlas_staff."StaffAudit" WHERE id=r.id AND xmin::text=xid_text;
  SELECT "currentApprovalId" INTO approval FROM atlas_staff."StaffPublicReport" WHERE "specimenId"=r."specimenId";
  admission:=newa."admissionCanonical"::jsonb;
  IF (atlas_staff.learning_exact_keys(newa."admissionCanonical"::json,ARRAY['purpose','mode','policyHash','sourceId','sourceOwnerId','sourceHash','evidenceHash',
    'provenance','identityCorrectionId','previousAnalysisRevision','previousAdmissionHash','previousSourceHash','previousEvidenceHash','proofHash']
    || CASE WHEN olda."admissionCanonical"::jsonb ? 'bridgePolicyHash' THEN ARRAY['bridgePolicyHash'] ELSE ARRAY[]::text[] END
    || CASE WHEN olda."admissionCanonical"::jsonb ? 'bridgeRevision' THEN ARRAY['bridgeRevision'] ELSE ARRAY[]::text[] END
    || CASE WHEN olda."admissionCanonical"::jsonb ? 'detectionPair' THEN ARRAY['detectionPair'] ELSE ARRAY[]::text[] END)) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS correction cannot invent admission fields'; END IF;
  valid:=(c.id=r."specimenId" AND c."analysisRevision"=r."resultAnalysisRevision" AND c."draftRevision"=r."resultReviewRevision"
    AND c."evidenceRevision"=r."resultEvidenceRevision" AND c."evidenceHash"=r."newEvidenceHash" AND c."evidenceCanonical"=r."newEvidenceCanonical"
    AND newa."specimenId"=c.id AND newa.revision=r."resultAnalysisRevision" AND newa."operationId" IS NULL
    AND newa.mode=olda.mode AND newa."sourceRevision"=r."newSourceRevision" AND newa."sourceHash"=r."newSourceHash"
    AND newa."evidenceHash"=r."newEvidenceHash" AND newa."reportHash"=r."newReportHash"
    AND newa."createdAt"=r."createdAt" AND atlas_staff.correction_same_except(olda."sourceCanonical",newa."sourceCanonical",ARRAY['identity'])
    AND json_extract_path(newa."sourceCanonical"::json,'identity')::text=r."newIdentityCanonical"
    AND atlas_staff.correction_same_except(olda."reportCanonical",newa."reportCanonical",ARRAY['identity'])
    AND json_extract_path(newa."reportCanonical"::json,'identity')::text=r."newIdentityCanonical"
    AND admission->>'purpose'='atlas-analysis-admission-v1' AND admission->>'mode'=newa.mode
    AND admission->>'policyHash'=r."gradingPolicyHash" AND admission->>'sourceHash'=r."newSourceHash"
    AND admission->>'evidenceHash'=r."newEvidenceHash" AND admission->>'sourceId'=r."sourceId" AND admission->>'sourceOwnerId'=r."sourceOwnerId"
    AND admission->>'provenance'='IDENTITY_CORRECTION' AND admission->>'identityCorrectionId'=r.id::text
    AND NOT admission ? 'operationId' AND admission->>'previousAnalysisRevision'=r."expectedAnalysisRevision"::text
    AND admission->>'previousAdmissionHash'=r."oldAdmissionHash" AND admission->>'previousSourceHash'=r."oldSourceHash"
    AND admission->>'previousEvidenceHash'=r."oldEvidenceHash" AND admission->>'proofHash'=r."proofHash"
    AND json_extract_path(newa."admissionCanonical"::json,'detectionPair')::text IS NOT DISTINCT FROM json_extract_path(olda."admissionCanonical"::json,'detectionPair')::text
    AND json_extract_path(newa."admissionCanonical"::json,'bridgeRevision')::text IS NOT DISTINCT FROM json_extract_path(olda."admissionCanonical"::json,'bridgeRevision')::text
    AND json_extract_path(newa."admissionCanonical"::json,'bridgePolicyHash')::text IS NOT DISTINCT FROM json_extract_path(olda."admissionCanonical"::json,'bridgePolicyHash')::text
    AND newv."analysisRevision"=newa.revision AND newv."evidenceRevision"=c."evidenceRevision" AND newv."evidenceHash"=c."evidenceHash"
    AND newv."contentHash"=r."newReviewHash" AND newv."savedById"=r."actorId" AND newv."savedAt"=r."createdAt"
    AND atlas_staff.correction_same_except(oldv.canonical,newv.canonical,ARRAY['revision','evidenceRevision','evidenceHash','reviewedSides','identityReviewed','disposition','savedAt','savedBy'])
    AND newv.canonical::jsonb->>'revision'=r."resultReviewRevision"::text
    AND newv.canonical::jsonb->>'evidenceRevision'=r."resultEvidenceRevision"::text AND newv.canonical::jsonb->>'evidenceHash'=r."newEvidenceHash"
    AND newv.canonical::jsonb->'reviewedSides'='[]'::jsonb AND newv.canonical::jsonb->'identityReviewed'='false'::jsonb
    AND newv.canonical::jsonb->>'disposition'='IN_REVIEW' AND newv.canonical::jsonb->>'savedAt'=to_char(r."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    AND newv.canonical::jsonb->>'savedBy'=(SELECT name FROM atlas_staff."StaffIdentity" WHERE id=r."actorId")
    AND source."workflowState"='CAPTURED' AND atlas_staff.correction_raw_projection(source)=r."nextRawSourceCanonical"::jsonb
    AND approval IS NOT DISTINCT FROM r."priorApprovalId" AND audit.event='IDENTITY_CORRECTED' AND audit."subjectId"=c.id::text AND audit."actorId"=r."actorId"
    AND audit."createdAt"=r."createdAt" AND audit.details::jsonb=jsonb_build_object('identityCorrectionId',r.id::text,'operationId',r."operationId"::text,
      'inputHash',r."inputHash",'proofHash',r."proofHash",'assignmentFence',r."assignmentFence"));
  IF valid IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS correction must atomically preserve source and history, reset checklist and advance exact heads'; END IF;
END $$;
CREATE FUNCTION atlas_staff.identity_correction_commit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
BEGIN
  IF TG_TABLE_NAME='StaffIdentityCorrection' THEN PERFORM atlas_staff.assert_identity_correction_commit(NEW.id);
  ELSIF TG_TABLE_NAME='StaffAudit' AND NEW.event='IDENTITY_CORRECTED' THEN PERFORM atlas_staff.assert_identity_correction_commit(NEW.id); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "StaffIdentityCorrection_atomic" AFTER INSERT ON "StaffIdentityCorrection" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.identity_correction_commit_guard();
CREATE CONSTRAINT TRIGGER "StaffAudit_identity_correction" AFTER INSERT ON "StaffAudit" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN(NEW.event='IDENTITY_CORRECTED') EXECUTE FUNCTION atlas_staff.identity_correction_commit_guard();

-- Replacement 2: the M3 ordinary result body is unchanged below the new
-- alternative-provenance branch, including existing LOCAL_FIXTURE bypass.
CREATE OR REPLACE FUNCTION atlas_staff.staff_grading_result_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,atlas_staff AS $$
DECLARE op atlas_staff."StaffGradingOperation"%ROWTYPE; a atlas_staff."StaffAnalysisRevision"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='StaffAnalysisRevision' THEN
    IF NEW."identityCorrectionId" IS NOT NULL THEN
      IF NEW."operationId" IS NOT NULL THEN RAISE EXCEPTION 'ATLAS correction cannot fabricate grading operation'; END IF;
      PERFORM atlas_staff.assert_identity_correction_commit(NEW."identityCorrectionId"); RETURN NULL;
    END IF;
    IF NEW."operationId" IS NULL AND NEW.mode='LOCAL_FIXTURE' THEN RETURN NULL; END IF;
    SELECT * INTO op FROM atlas_staff."StaffGradingOperation" WHERE id=NEW."operationId";
  ELSE SELECT * INTO op FROM atlas_staff."StaffGradingOperation" WHERE id=NEW.id; END IF;
  SELECT * INTO a FROM atlas_staff."StaffAnalysisRevision" WHERE "operationId"=op.id;
  IF op.state<>'SUCCEEDED' AND a."specimenId" IS NULL THEN RETURN NULL; END IF;
  IF op.id IS NULL OR a."specimenId" IS NULL OR op.state<>'SUCCEEDED' OR a."specimenId"<>op."specimenId"
    OR a.revision<>op."expectedAnalysisRevision"+1 OR a.revision<>op."resultAnalysisRevision" OR a."evidenceHash"<>op."evidenceHash" THEN
    RAISE EXCEPTION 'ATLAS analysis must commit with its exact successful grading operation'; END IF;
  RETURN NULL;
END; $$;

-- Safe serving lost-reply recovery. No source lookup, old-head check, proof or
-- historical correction-control gate; current HUMAN access is mandatory. The
-- service computes input_hash from the exact validated canonical request body
-- and calls only inside its opaque withStaff/assignment transaction.
CREATE FUNCTION atlas_staff.read_identity_correction_receipt(specimen uuid,actor uuid,operation uuid,input_hash text,
  session_hash text,browser_hash text,access_version integer,assignment_fence integer,control_revision integer)
RETURNS TABLE("receiptId" uuid,"operationId" uuid,"analysisRevision" integer,"reviewRevision" integer,"evidenceRevision" integer,
  "evidenceHash" text,"sourceHash" text,"reviewHash" text,"createdAt" timestamp)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE co atlas_staff."StaffControl"%ROWTYPE; i atlas_staff."StaffIdentity"%ROWTYPE;
  se atlas_staff."StaffSession"%ROWTYPE; b atlas_staff."StaffBrowser"%ROWTYPE; a atlas_staff."StaffAssignment"%ROWTYPE;
  c atlas_staff."StaffSpecimen"%ROWTYPE; r atlas_staff."StaffIdentityCorrection"%ROWTYPE; now_at timestamp;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO co FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=actor FOR SHARE;
  SELECT * INTO se FROM atlas_staff."StaffSession" WHERE "tokenHash"=session_hash FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=browser_hash FOR SHARE;
  SELECT * INTO a FROM atlas_staff."StaffAssignment" WHERE "specimenId"=specimen AND "identityId"=actor FOR SHARE;
  SELECT * INTO c FROM atlas_staff."StaffSpecimen" WHERE id=specimen FOR SHARE;
  now_at:=clock_timestamp() AT TIME ZONE 'UTC';
  IF (input_hash ~ '^[a-f0-9]{64}$' AND session_hash ~ '^[a-f0-9]{64}$' AND browser_hash ~ '^[a-f0-9]{64}$'
    AND co.enabled AND co.revision=control_revision AND i.id=actor AND i.role='REVIEWER' AND i."revokedAt" IS NULL
    AND i."accessVersion"=access_version AND se."identityId"=i.id AND se."accessVersion"=i."accessVersion"
    AND se."revokedAt" IS NULL AND se."controlRevision"=co.revision AND se."createdAt"<=now_at
    AND se."createdAt">=now_at-interval '5 minutes' AND se."expiresAt">now_at AND b."tokenHash"=se."browserHash"
    AND b."controlRevision"=co.revision AND b."createdAt"<=se."createdAt" AND b."expiresAt">now_at
    AND a.fence=assignment_fence AND a."canReview" AND a."revokedAt" IS NULL AND a."expiresAt">now_at
    AND c.id=specimen) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS correction receipt requires fresh assigned human access'; END IF;
  SELECT stored.* INTO r FROM atlas_staff."StaffIdentityCorrection" AS stored
    WHERE stored."actorId"=actor AND stored."operationId"=operation FOR SHARE;
  -- A missing/foreign-actor operation reveals no existence or contents.
  IF r.id IS NULL THEN RETURN; END IF;
  IF r."specimenId"<>specimen OR r."inputHash"<>input_hash THEN RAISE EXCEPTION 'ATLAS correction receipt request conflict'; END IF;
  RETURN QUERY SELECT r.id,r."operationId",r."resultAnalysisRevision",r."resultReviewRevision",r."resultEvidenceRevision",
    r."newEvidenceHash"::text,r."newSourceHash"::text,r."newReviewHash"::text,r."createdAt";
END $$;
REVOKE ALL ON FUNCTION atlas_staff.read_identity_correction_receipt(uuid,uuid,uuid,text,text,text,integer,integer,integer) FROM PUBLIC;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['StaffIdentityCorrectionControl','StaffIdentityCorrection'] LOOP
    EXECUTE format('REVOKE ALL ON atlas_staff.%I FROM PUBLIC',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON atlas_staff.%I FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable()',t||'_no_delete',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON atlas_staff.%I FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable()',t||'_no_truncate',t);
  END LOOP;
END $$;
CREATE TRIGGER "StaffIdentityCorrection_immutable" BEFORE UPDATE ON "StaffIdentityCorrection"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
REVOKE ALL ON FUNCTION atlas_staff.identity_correction_control_guard(),atlas_staff.correction_same_except(text,text,text[]),
  atlas_staff.correction_raw_projection(public."AiGraderV2Session"),atlas_staff.correction_scope_current(atlas_staff."StaffIdentityCorrection"),
  atlas_staff.correction_work_clear(atlas_staff."StaffIdentityCorrection"),atlas_staff.identity_correction_insert_guard(),
  atlas_staff.identity_correction_source_guard(),atlas_staff.assert_identity_correction_commit(uuid),atlas_staff.identity_correction_commit_guard() FROM PUBLIC;
-- Lead grants no INSERT/UPDATE/DELETE on receipt, analysis or source to serving,
-- operations, runner or public roles. Original private owner performs CAS. A
-- fresh opaque HUMAN serving accessor receives only projected receipt fields.
-- Add ONLY read_identity_correction_receipt(uuid,uuid,uuid,text,text,text,integer,integer,integer)
-- to the serving FUNCTION allowlist/grant generator, never the receipt/control
-- tables to STAFF_GRANTS. Grant no internal helper execute to restricted roles.
-- Do not expose proof, raw snapshots, source identifiers or private evidence.
COMMIT;
