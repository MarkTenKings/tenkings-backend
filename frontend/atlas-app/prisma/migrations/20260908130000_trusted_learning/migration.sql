-- Exact approved-source learning candidates and independent human decisions.
-- No activation, bank writer or learning application.
BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;

CREATE TABLE "StaffLearningControl" (
  id text PRIMARY KEY DEFAULT 'active',enabled boolean NOT NULL DEFAULT false,mode text NOT NULL,origin text NOT NULL,
  "deploymentId" varchar(120) NOT NULL,"releaseSha" varchar(40) NOT NULL,"configHash" varchar(64) NOT NULL,
  "clientKeyHash" varchar(64) NOT NULL,"gradingPolicyHash" varchar(64) NOT NULL,"phoneAllowlistHash" varchar(64) NOT NULL,
  revision integer NOT NULL DEFAULT 1,"updatedAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CHECK ((id='active' AND revision>0 AND length(trim("deploymentId"))>0 AND origin ~ '^https://[a-z0-9.-]+(:[0-9]+)?$'
    AND "releaseSha" ~ '^[a-f0-9]{40}$' AND "configHash" ~ '^[a-f0-9]{64}$' AND "clientKeyHash" ~ '^[a-f0-9]{64}$'
    AND "gradingPolicyHash" ~ '^[a-f0-9]{64}$' AND "phoneAllowlistHash" ~ '^[a-f0-9]{64}$'
    AND ((mode='PRODUCTION' AND "releaseSha"<>repeat('0',40)) OR (mode='LOCAL_FIXTURE' AND "releaseSha"=repeat('0',40)))) IS TRUE)
);
CREATE TRIGGER "StaffLearningControl_revision" BEFORE UPDATE ON "StaffLearningControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_control_guard();

CREATE TABLE "StaffLearningCandidates" (
  id uuid PRIMARY KEY,"actorId" uuid NOT NULL REFERENCES "StaffIdentity"(id) ON DELETE RESTRICT,
  "sessionHash" varchar(64) NOT NULL REFERENCES "StaffSession"("tokenHash") ON DELETE RESTRICT,
  "accessVersion" integer NOT NULL,"assignmentFence" integer NOT NULL,"controlRevision" integer NOT NULL,
  "specimenId" uuid NOT NULL REFERENCES "StaffSpecimen"(id) ON DELETE RESTRICT,"approvalId" uuid NOT NULL,
  "analysisRevision" integer NOT NULL,"reviewRevision" integer NOT NULL,"evidenceHash" varchar(64) NOT NULL,
  "analysisHash" varchar(64) NOT NULL,"reviewHash" varchar(64) NOT NULL,"sourceRevision" varchar(80) NOT NULL,
  "sourceType" text NOT NULL,"sourceId" varchar(128) NOT NULL,"sourceOwnerId" varchar(128) NOT NULL,
  "rawFindingsHash" varchar(64) NOT NULL,"generatorVersion" varchar(80) NOT NULL,"fingerprintVersion" varchar(160) NOT NULL,
  "gradingPolicyHash" varchar(64) NOT NULL,"bridgeConfigHash" varchar(64) NOT NULL,
  "candidateCanonical" text NOT NULL,"candidateHash" varchar(64) NOT NULL,"bundleHash" varchar(64) NOT NULL,
  "createdAt" timestamp(3) NOT NULL,"expiresAt" timestamp(3) NOT NULL,
  UNIQUE(id,"specimenId","approvalId"),
  FOREIGN KEY ("approvalId","specimenId") REFERENCES "StaffReportApproval"(id,"specimenId") ON DELETE RESTRICT,
  FOREIGN KEY ("specimenId","analysisRevision") REFERENCES "StaffAnalysisRevision"("specimenId",revision) ON DELETE RESTRICT,
  FOREIGN KEY ("specimenId","reviewRevision") REFERENCES "StaffReviewRevision"("specimenId",revision) ON DELETE RESTRICT,
  CHECK (("accessVersion">0 AND "assignmentFence">0 AND "controlRevision">0 AND "analysisRevision">0 AND "reviewRevision">0
    AND "sessionHash" ~ '^[a-f0-9]{64}$' AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "analysisHash" ~ '^[a-f0-9]{64}$'
    AND "reviewHash" ~ '^[a-f0-9]{64}$' AND "rawFindingsHash" ~ '^[a-f0-9]{64}$' AND "bundleHash" ~ '^[a-f0-9]{64}$'
    AND "gradingPolicyHash" ~ '^[a-f0-9]{64}$' AND "bridgeConfigHash" ~ '^[a-f0-9]{64}$'
    AND "sourceType" IN ('LOCAL_FIXTURE','SPEEDSTER') AND length("sourceId")>0 AND length("sourceOwnerId")>0 AND length("sourceRevision")>0
    AND "sourceId" !~ '[[:cntrl:]]' AND "sourceOwnerId" !~ '[[:cntrl:]]' AND length(trim("fingerprintVersion"))>0
    AND "generatorVersion"='speedster-learning-candidates-v1' AND octet_length("candidateCanonical") BETWEEN 2 AND 262144
    AND "candidateHash"=encode(sha256(convert_to("candidateCanonical",'UTF8')),'hex')
    AND json_typeof("candidateCanonical"::json)='object' AND "expiresAt">"createdAt"
    AND "expiresAt"<="createdAt"+interval '5 minutes') IS TRUE)
);
CREATE INDEX "StaffLearningCandidates_scope_idx" ON "StaffLearningCandidates"("actorId","sessionHash","specimenId","approvalId","createdAt");

CREATE TABLE "StaffTrustedLearningDecision" (
  id uuid PRIMARY KEY,"specimenId" uuid NOT NULL REFERENCES "StaffSpecimen"(id) ON DELETE RESTRICT,"approvalId" uuid NOT NULL,
  "candidatesId" uuid NOT NULL,"bundleHash" varchar(64) NOT NULL,"rawFindingsHash" varchar(64) NOT NULL,
  "analysisRevision" integer NOT NULL,"reviewRevision" integer NOT NULL,"evidenceHash" varchar(64) NOT NULL,
  "analysisHash" varchar(64) NOT NULL,"reviewHash" varchar(64) NOT NULL,"sourceRevision" varchar(80) NOT NULL,
  "actorId" uuid NOT NULL REFERENCES "StaffIdentity"(id) ON DELETE RESTRICT,
  "sessionHash" varchar(64) NOT NULL REFERENCES "StaffSession"("tokenHash") ON DELETE RESTRICT,
  "accessVersion" integer NOT NULL,"assignmentFence" integer NOT NULL,"controlRevision" integer NOT NULL,
  "operationId" varchar(80) NOT NULL,"inputHash" varchar(64) NOT NULL,"decisionCanonical" text NOT NULL,"decisionHash" varchar(64) NOT NULL,
  status text NOT NULL,"createdAt" timestamp(3) NOT NULL,
  UNIQUE("actorId","operationId"),
  FOREIGN KEY ("candidatesId","specimenId","approvalId") REFERENCES "StaffLearningCandidates"(id,"specimenId","approvalId") ON DELETE RESTRICT,
  CHECK (("accessVersion">0 AND "assignmentFence">0 AND "controlRevision">0 AND "analysisRevision">0 AND "reviewRevision">0
    AND "sessionHash" ~ '^[a-f0-9]{64}$' AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "analysisHash" ~ '^[a-f0-9]{64}$'
    AND "reviewHash" ~ '^[a-f0-9]{64}$' AND "rawFindingsHash" ~ '^[a-f0-9]{64}$' AND "bundleHash" ~ '^[a-f0-9]{64}$'
    AND "inputHash" ~ '^[a-f0-9]{64}$' AND "operationId" ~ '^[A-Za-z0-9_-]{8,80}$'
    AND status IN ('APPROVED_PENDING_APPLICATION','REJECTED') AND length("sourceRevision")>0
    AND octet_length("decisionCanonical") BETWEEN 2 AND 65536 AND json_typeof("decisionCanonical"::json)='object'
    AND "decisionHash"=encode(sha256(convert_to("decisionCanonical",'UTF8')),'hex')) IS TRUE)
);
CREATE INDEX "StaffTrustedLearningDecision_specimen_created_idx" ON "StaffTrustedLearningDecision"("specimenId","createdAt",id);

-- Scalars and selected-ID arrays only. Never serialize candidate numeric vectors
-- through JSONB to establish their hashes; json extraction retains exact bytes.
CREATE FUNCTION atlas_staff.learning_fixed_object(p jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE answer text;
BEGIN
  IF jsonb_typeof(p)<>'object' OR EXISTS(SELECT 1 FROM jsonb_each(p) e
    WHERE jsonb_typeof(e.value) NOT IN ('string','number','boolean','null')
    AND NOT (e.key='candidateIds' AND jsonb_typeof(e.value)='array')) THEN
    RAISE EXCEPTION 'ATLAS learning fixed scalar object required'; END IF;
  IF p ? 'candidateIds' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p->'candidateIds') v WHERE jsonb_typeof(v)<>'string') THEN
    RAISE EXCEPTION 'ATLAS learning candidate IDs must be strings'; END IF;
  SELECT '{'||coalesce(string_agg(to_json(e.key)::text||':'||CASE WHEN e.key='candidateIds' THEN
      (SELECT '['||coalesce(string_agg(v::text,',' ORDER BY ord),'')||']' FROM jsonb_array_elements(e.value) WITH ORDINALITY a(v,ord))
      ELSE e.value::text END,',' ORDER BY e.key COLLATE "C"),'')||'}' INTO answer FROM jsonb_each(p) e;
  RETURN answer;
END $$;
CREATE FUNCTION atlas_staff.learning_exact_keys(p json, wanted text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
  SELECT json_typeof(p)='object' AND p::jsonb ?& wanted AND p::jsonb-wanted='{}'::jsonb
    AND (SELECT count(*) FROM json_object_keys(p))=cardinality(wanted);
$$;
CREATE FUNCTION atlas_staff.learning_control_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE binding text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  binding:=atlas_staff.learning_fixed_object(jsonb_build_object('purpose','atlas-trusted-learning-candidates-v1','mode',NEW.mode,
    'origin',NEW.origin,'deploymentId',NEW."deploymentId",'releaseSha',NEW."releaseSha",'clientKeyHash',NEW."clientKeyHash",
    'gradingPolicyHash',NEW."gradingPolicyHash",'phoneAllowlistHash',NEW."phoneAllowlistHash",'generatorVersion','speedster-learning-candidates-v1'));
  IF NEW."configHash"<>encode(sha256(convert_to(binding,'UTF8')),'hex') OR EXISTS(
    SELECT 1 FROM (SELECT "clientKeyHash" FROM atlas_staff."StaffGradingBridgeControl" UNION ALL
      SELECT "clientKeyHash" FROM atlas_staff."StaffIntakeControl" UNION ALL SELECT "clientKeyHash" FROM atlas_staff."StaffOperatorImageControl" UNION ALL
      SELECT "clientKeyHash" FROM atlas_staff."PublicMediaControl") k WHERE k."clientKeyHash"=NEW."clientKeyHash") THEN
    RAISE EXCEPTION 'ATLAS learning requires its exact distinct-key configuration'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffLearningControl_binding" BEFORE INSERT OR UPDATE ON "StaffLearningControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.learning_control_guard();

-- Internal checker called only by definers. Locks all live authority through
-- commit. No operations grant, certificationUntil or report actor equality.
CREATE FUNCTION atlas_staff.learning_scope_current(r atlas_staff."StaffLearningCandidates") RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE co atlas_staff."StaffControl"%ROWTYPE; lc atlas_staff."StaffLearningControl"%ROWTYPE;
  i atlas_staff."StaffIdentity"%ROWTYPE; se atlas_staff."StaffSession"%ROWTYPE; b atlas_staff."StaffBrowser"%ROWTYPE;
  a atlas_staff."StaffAssignment"%ROWTYPE; c atlas_staff."StaffSpecimen"%ROWTYPE; ap atlas_staff."StaffReportApproval"%ROWTYPE;
  p atlas_staff."StaffPublicReport"%ROWTYPE; analysis atlas_staff."StaffAnalysisRevision"%ROWTYPE; review atlas_staff."StaffReviewRevision"%ROWTYPE;
  now_at timestamp; admission jsonb; raw_findings text; source_matches boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO co FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  SELECT * INTO lc FROM atlas_staff."StaffLearningControl" WHERE id='active' FOR SHARE;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=r."actorId" FOR SHARE;
  SELECT * INTO se FROM atlas_staff."StaffSession" WHERE "tokenHash"=r."sessionHash" FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=se."browserHash" FOR SHARE;
  SELECT * INTO a FROM atlas_staff."StaffAssignment" WHERE "specimenId"=r."specimenId" AND "identityId"=r."actorId" FOR SHARE;
  SELECT * INTO c FROM atlas_staff."StaffSpecimen" WHERE id=r."specimenId" FOR SHARE;
  SELECT * INTO p FROM atlas_staff."StaffPublicReport" WHERE "specimenId"=c.id FOR SHARE;
  SELECT * INTO ap FROM atlas_staff."StaffReportApproval" WHERE id=r."approvalId" FOR SHARE;
  SELECT * INTO analysis FROM atlas_staff."StaffAnalysisRevision" WHERE "specimenId"=c.id AND revision=c."analysisRevision" FOR SHARE;
  SELECT * INTO review FROM atlas_staff."StaffReviewRevision" WHERE "specimenId"=c.id AND revision=c."draftRevision" FOR SHARE;
  admission:=analysis."admissionCanonical"::jsonb;
  raw_findings:=json_extract_path(analysis."sourceCanonical"::json,'reviewedDefects')::text;
  -- Take the public row lock before reading the final authority clock. A wait
  -- behind a legacy source writer must not preserve a stale freshness check.
  source_matches:=atlas_staff.operator_source_matches(r."sourceId",r."sourceOwnerId",r."sourceRevision");
  now_at:=clock_timestamp() AT TIME ZONE 'UTC';
  IF (co.enabled AND lc.enabled AND co.mode=lc.mode AND co."gradingPolicyHash"=lc."gradingPolicyHash"
    AND r."bridgeConfigHash"=lc."configHash" AND r."gradingPolicyHash"=lc."gradingPolicyHash" AND r."controlRevision"=co.revision
    AND i.id=r."actorId" AND i.role='REVIEWER' AND i."revokedAt" IS NULL AND i."accessVersion"=r."accessVersion"
    AND i."trustedLearningUntil">now_at AND se."identityId"=i.id AND se."accessVersion"=i."accessVersion" AND se."revokedAt" IS NULL
    AND se."controlRevision"=co.revision AND se."createdAt"<=now_at AND se."createdAt">=now_at-interval '5 minutes' AND se."expiresAt">now_at
    AND b."tokenHash"=se."browserHash" AND b."controlRevision"=co.revision AND b."createdAt"<=se."createdAt" AND b."expiresAt">now_at
    AND a."canReview" AND a."revokedAt" IS NULL AND a."expiresAt">now_at AND a.fence=r."assignmentFence"
    AND c.id=r."specimenId" AND c."sourceType"=r."sourceType" AND c."sourceId"=r."sourceId" AND c."sourceOwnerId"=r."sourceOwnerId"
    AND ((c."sourceType"='LOCAL_FIXTURE' AND co.mode='LOCAL_FIXTURE') OR (c."sourceType"='SPEEDSTER' AND co.mode='PRODUCTION'))
    AND c."evidenceHash"=r."evidenceHash" AND c."analysisRevision"=r."analysisRevision" AND c."draftRevision"=r."reviewRevision"
    AND p."currentApprovalId"=ap.id AND ap.id=r."approvalId" AND ap."specimenId"=c.id AND ap."evidenceHash"=r."evidenceHash"
    AND ap."analysisRevision"=r."analysisRevision" AND ap."reviewRevision"=r."reviewRevision" AND ap."analysisHash"=r."analysisHash" AND ap."reviewHash"=r."reviewHash"
    AND analysis."sourceHash"=r."analysisHash" AND analysis."sourceRevision"=r."sourceRevision" AND analysis."evidenceHash"=r."evidenceHash" AND analysis.mode=co.mode
    AND review."contentHash"=r."reviewHash" AND review."evidenceHash"=r."evidenceHash" AND review."analysisRevision"=analysis.revision
    AND analysis."sourceHash"=encode(sha256(convert_to(analysis."sourceCanonical",'UTF8')),'hex')
    AND c."evidenceHash"=encode(sha256(convert_to(c."evidenceCanonical",'UTF8')),'hex')
    AND analysis."admissionHash"=encode(sha256(convert_to(analysis."admissionCanonical",'UTF8')),'hex')
    AND admission->>'purpose'='atlas-analysis-admission-v1' AND admission->>'sourceHash'=r."analysisHash"
    AND admission->>'evidenceHash'=r."evidenceHash" AND admission->>'policyHash'=lc."gradingPolicyHash" AND admission->>'mode'=co.mode
    AND json_typeof(raw_findings::json)='array' AND r."rawFindingsHash"=encode(sha256(convert_to(raw_findings,'UTF8')),'hex')
    AND r."createdAt"<=now_at AND r."expiresAt">now_at AND r."expiresAt"<=r."createdAt"+interval '5 minutes'
    AND r."expiresAt"<=least(se."createdAt"+interval '5 minutes',se."expiresAt",b."expiresAt",i."trustedLearningUntil",a."expiresAt")
  ) IS NOT TRUE THEN RETURN false; END IF;
  -- Every learning receipt, including explicit LOCAL_FIXTURE source ports, has
  -- an actual captured original row. No synthetic-mode bypass of source locks.
  RETURN source_matches IS TRUE;
END $$;

CREATE FUNCTION atlas_staff.learning_candidates_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE packet json:=NEW."candidateCanonical"::json; entry json; lesson json; finding json; raw_findings json;
  analysis atlas_staff."StaffAnalysisRevision"%ROWTYPE; bundle text; candidate_text text; order_n integer; ids text[]:='{}';
BEGIN
  IF atlas_staff.learning_scope_current(NEW) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS learning requires fresh trained human and exact approved source'; END IF;
  SELECT * INTO analysis FROM atlas_staff."StaffAnalysisRevision" WHERE "specimenId"=NEW."specimenId" AND revision=NEW."analysisRevision";
  raw_findings:=json_extract_path(analysis."sourceCanonical"::json,'reviewedDefects');
  bundle:=atlas_staff.learning_fixed_object(jsonb_build_object('version','atlas-trusted-learning-bundle-v1','specimenId',NEW."specimenId",'approvalId',NEW."approvalId",
    'analysisRevision',NEW."analysisRevision",'reviewRevision',NEW."reviewRevision",'evidenceHash',NEW."evidenceHash",'analysisHash',NEW."analysisHash",'reviewHash',NEW."reviewHash",
    'sourceRevision',NEW."sourceRevision",'sourceType',NEW."sourceType",'sourceId',NEW."sourceId",'sourceOwnerId',NEW."sourceOwnerId",'rawFindingsHash',NEW."rawFindingsHash",
    'candidateHash',NEW."candidateHash",'generatorVersion',NEW."generatorVersion",'fingerprintVersion',NEW."fingerprintVersion",
    'gradingPolicyHash',NEW."gradingPolicyHash",'bridgeConfigHash',NEW."bridgeConfigHash"));
  IF (NEW."bundleHash"=encode(sha256(convert_to(bundle,'UTF8')),'hex')
    AND atlas_staff.learning_exact_keys(packet,ARRAY['version','candidates']) AND packet->>'version'='atlas-trusted-learning-candidates-v1'
    AND json_typeof(packet->'candidates')='array' AND json_array_length(packet->'candidates')<=256) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS learning candidate bundle is not exact'; END IF;
  FOR entry IN SELECT value FROM json_array_elements(packet->'candidates') LOOP
    lesson:=entry->'lesson';
    IF (atlas_staff.learning_exact_keys(entry,ARRAY['candidateId','findingId','rawFindingHash','lesson'])
      AND json_typeof(entry->'candidateId')='string' AND json_typeof(entry->'findingId')='string' AND json_typeof(entry->'rawFindingHash')='string'
      AND entry->>'candidateId' ~ '^[a-f0-9]{64}$' AND entry->>'rawFindingHash' ~ '^[a-f0-9]{64}$'
      AND length(trim(entry->>'findingId')) BETWEEN 1 AND 180 AND entry->>'findingId' !~ '[[:cntrl:]]'
      AND NOT (entry->>'candidateId'=ANY(ids)) AND atlas_staff.learning_exact_keys(lesson,
        CASE WHEN lesson::jsonb ? 'lessonOrder' THEN ARRAY['defectType','polarity','fingerprint','provenance','sourceViewId','proposalOrder','lessonOrder']
        ELSE ARRAY['defectType','polarity','fingerprint','provenance','sourceViewId','proposalOrder'] END)
      AND json_typeof(lesson->'proposalOrder')='number' AND lesson->>'proposalOrder' ~ '^(0|[1-9][0-9]{0,8})$'
      AND (NOT (lesson::jsonb ? 'lessonOrder') OR (json_typeof(lesson->'lessonOrder')='number' AND lesson->>'lessonOrder' ~ '^(0|[1-9][0-9]{0,8})$'))
      AND lesson->>'polarity' IN ('POSITIVE','NEGATIVE') AND json_typeof(lesson->'defectType')='string'
      AND length(trim(lesson->>'defectType')) BETWEEN 1 AND 80 AND lesson->>'defectType' !~ '[[:cntrl:]]'
      AND lesson->>'provenance' IN ('DETECTOR_REMOVED','DETECTOR_RELABELED_NEGATIVE','DETECTOR_RELABELED_POSITIVE','HUMAN_TRACE_CORRECTION_POSITIVE','SMART_MARK_POSITIVE','UNTOUCHED_ACCEPTED_POSITIVE')
      AND lesson->>'sourceViewId' IN ('ORIGINAL','NORMALIZED','MICRO_DEFECT','DIRECTIONAL')
      AND json_typeof(lesson->'fingerprint')='array' AND json_array_length(lesson->'fingerprint')=32
      AND NOT EXISTS(SELECT 1 FROM json_array_elements(lesson->'fingerprint') v WHERE json_typeof(v)<>'number')
    ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS learning candidate structure is invalid'; END IF;
    order_n:=(lesson->>'proposalOrder')::integer;finding:=raw_findings->order_n;
    IF (finding->>'id'=entry->>'findingId' AND entry->>'rawFindingHash'=encode(sha256(convert_to(finding::text,'UTF8')),'hex')
      AND (SELECT count(*) FROM json_array_elements(raw_findings) f WHERE f->>'id'=entry->>'findingId')=1) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS learning candidate must identify exact retained raw finding'; END IF;
    -- All scalar fields are original strings; lesson is the exact canonical
    -- substring, never jsonb::text. This validates identity, not generator math.
    SELECT '{'||string_agg(to_json(k)::text||':'||v,',' ORDER BY k COLLATE "C")||'}' INTO candidate_text FROM (VALUES
      ('analysisHash',to_json(NEW."analysisHash")::text),('approvalId',to_json(NEW."approvalId")::text),('evidenceHash',to_json(NEW."evidenceHash")::text),
      ('findingId',to_json(entry->>'findingId')::text),('fingerprintVersion',to_json(NEW."fingerprintVersion")::text),('generatorVersion',to_json(NEW."generatorVersion")::text),
      ('lesson',lesson::text),('purpose',to_json('atlas-trusted-learning-candidate-v1'::text)::text),('rawFindingHash',to_json(entry->>'rawFindingHash')::text),
      ('sourceRevision',to_json(NEW."sourceRevision")::text)) q(k,v);
    IF entry->>'candidateId'<>encode(sha256(convert_to(candidate_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'ATLAS learning candidate identity changed'; END IF;
    ids:=array_append(ids,entry->>'candidateId');
  END LOOP;
  RETURN NEW;
END $$;

CREATE FUNCTION atlas_staff.lock_learning_candidates(actor_id uuid,session_hash text,specimen_id uuid,approval_id uuid,candidates_id uuid)
RETURNS SETOF atlas_staff."StaffLearningCandidates" LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffLearningCandidates"%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO r FROM atlas_staff."StaffLearningCandidates" WHERE id=candidates_id AND "actorId"=actor_id AND "sessionHash"=session_hash
    AND "specimenId"=specimen_id AND "approvalId"=approval_id FOR SHARE;
  IF r.id IS NOT NULL AND atlas_staff.learning_scope_current(r) IS TRUE THEN RETURN NEXT r; END IF;
END $$;

CREATE FUNCTION atlas_staff.learning_decision_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffLearningCandidates"%ROWTYPE; p json:=NEW."decisionCanonical"::json; j jsonb:=p::jsonb;
  expected jsonb; i atlas_staff."StaffIdentity"%ROWTYPE; se atlas_staff."StaffSession"%ROWTYPE; input text; chosen text[]; available text[];
  now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  SELECT * INTO r FROM atlas_staff.lock_learning_candidates(NEW."actorId",NEW."sessionHash",NEW."specimenId",NEW."approvalId",NEW."candidatesId");
  IF r.id IS NULL THEN RAISE EXCEPTION 'ATLAS learning decision requires fresh trained human and exact approved source'; END IF;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=NEW."actorId";
  SELECT * INTO se FROM atlas_staff."StaffSession" WHERE "tokenHash"=NEW."sessionHash";
  IF ((NEW."bundleHash",NEW."rawFindingsHash",NEW."analysisRevision",NEW."reviewRevision",NEW."evidenceHash",NEW."analysisHash",NEW."reviewHash",NEW."sourceRevision",
        NEW."accessVersion",NEW."assignmentFence",NEW."controlRevision") IS NOT DISTINCT FROM
      (r."bundleHash",r."rawFindingsHash",r."analysisRevision",r."reviewRevision",r."evidenceHash",r."analysisHash",r."reviewHash",r."sourceRevision",
        r."accessVersion",r."assignmentFence",r."controlRevision")
    AND NEW."createdAt">=r."createdAt" AND NEW."createdAt"<=now_at AND NEW."createdAt">=now_at-interval '5 minutes'
    AND json_typeof(p->'candidateIds')='array' AND json_array_length(p->'candidateIds') BETWEEN 1 AND 256
    AND NOT EXISTS(SELECT 1 FROM json_array_elements(p->'candidateIds') v WHERE json_typeof(v)<>'string' OR v::text !~ '^"[a-f0-9]{64}"$')
    AND json_typeof(p->'reason')='string' AND length(trim(p->>'reason')) BETWEEN 1 AND 1000 AND p->>'reason' !~ '[[:cntrl:]]'
  ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS learning decision binding or selection is invalid'; END IF;
  SELECT array_agg(v) INTO chosen FROM json_array_elements_text(p->'candidateIds') v;
  SELECT array_agg(v->>'candidateId') INTO available FROM json_array_elements(r."candidateCanonical"::json->'candidates') v;
  IF cardinality(chosen)<>(SELECT count(DISTINCT v) FROM unnest(chosen) v) OR NOT chosen<@coalesce(available,'{}'::text[]) THEN
    RAISE EXCEPTION 'ATLAS learning selection must identify unique exact candidates'; END IF;
  expected:=jsonb_build_object('version','atlas-trusted-learning-decision-v1','purpose','TRUSTED_LEARNING','status',NEW.status,'specimenId',NEW."specimenId",
    'approvalId',NEW."approvalId",'candidatesId',r.id,'bundleHash',r."bundleHash",'rawFindingsHash',r."rawFindingsHash",'candidateHash',r."candidateHash",
    'generatorVersion',r."generatorVersion",'fingerprintVersion',r."fingerprintVersion",'gradingPolicyHash',r."gradingPolicyHash",'bridgeConfigHash',r."bridgeConfigHash",
    'sourceType',r."sourceType",'sourceId',r."sourceId",'sourceOwnerId',r."sourceOwnerId",'sourceRevision',r."sourceRevision",
    'analysisRevision',r."analysisRevision",'reviewRevision',r."reviewRevision",'evidenceHash',r."evidenceHash",'analysisHash',r."analysisHash",'reviewHash',r."reviewHash",
    'candidateIds',j->'candidateIds','reason',j->>'reason','actorId',NEW."actorId",'sessionHash',NEW."sessionHash",'browserHash',se."browserHash",
    'accessVersion',NEW."accessVersion",'assignmentFence',NEW."assignmentFence",'controlRevision',NEW."controlRevision",
    'trustedLearningUntil',to_char(i."trustedLearningUntil",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'operationId',NEW."operationId",'inputHash',NEW."inputHash",
    'createdAt',to_char(NEW."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  input:='{"input":'||atlas_staff.learning_fixed_object(jsonb_build_object('operationId',NEW."operationId",'approvalId',NEW."approvalId",'candidatesId',r.id,
    'bundleHash',r."bundleHash",'candidateIds',j->'candidateIds','decision',CASE NEW.status WHEN 'APPROVED_PENDING_APPLICATION' THEN 'APPROVE' ELSE 'REJECT' END,
    'reason',j->>'reason'))||',"specimenId":'||to_json(NEW."specimenId")::text||'}';
  IF (j=expected AND NEW."decisionCanonical"=atlas_staff.learning_fixed_object(expected)
    AND NEW."inputHash"=encode(sha256(convert_to(input,'UTF8')),'hex')) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS learning decision must retain exact canonical input and authority'; END IF;
  RETURN NEW;
END $$;

CREATE UNIQUE INDEX "StaffAudit_learning_decision_key" ON "StaffAudit"((details::jsonb->>'decisionId')) WHERE event='ATLAS_TRUSTED_LEARNING_DECIDED';
CREATE FUNCTION atlas_staff.learning_audit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE fact atlas_staff."StaffTrustedLearningDecision"%ROWTYPE; audit atlas_staff."StaffAudit"%ROWTYPE; fact_xmin xid; audit_xmin xid; wanted uuid;
BEGIN
  IF TG_TABLE_NAME='StaffAudit' THEN
    IF NEW.event<>'ATLAS_TRUSTED_LEARNING_DECIDED' THEN RETURN NULL; END IF;
    wanted:=(NEW.details::jsonb->>'decisionId')::uuid;
    SELECT * INTO audit FROM atlas_staff."StaffAudit" WHERE id=NEW.id;
  ELSE
    wanted:=NEW.id;
    SELECT * INTO audit FROM atlas_staff."StaffAudit" WHERE event='ATLAS_TRUSTED_LEARNING_DECIDED' AND details::jsonb->>'decisionId'=wanted::text;
  END IF;
  SELECT * INTO fact FROM atlas_staff."StaffTrustedLearningDecision" WHERE id=wanted;
  SELECT xmin INTO fact_xmin FROM atlas_staff."StaffTrustedLearningDecision" WHERE id=wanted;
  SELECT xmin INTO audit_xmin FROM atlas_staff."StaffAudit" WHERE id=audit.id;
  IF (fact.id IS NOT NULL AND audit.id IS NOT NULL AND fact_xmin=audit_xmin AND audit.event='ATLAS_TRUSTED_LEARNING_DECIDED'
    AND audit."subjectId"=fact."specimenId"::text AND audit."actorId"=fact."actorId"
    AND audit.details::jsonb=jsonb_build_object('decisionId',fact.id,'decisionHash',fact."decisionHash",'bundleHash',fact."bundleHash",'status',fact.status,
      'operationId',fact."operationId",'inputHash',fact."inputHash")) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS learning requires exact decision and audit in the same transaction'; END IF;
  RETURN NULL;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['StaffLearningControl','StaffLearningCandidates','StaffTrustedLearningDecision'] LOOP
    EXECUTE format('REVOKE ALL ON atlas_staff.%I FROM PUBLIC',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON atlas_staff.%I FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable()',t||'_no_delete',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON atlas_staff.%I FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable()',t||'_no_truncate',t);
    IF t<>'StaffLearningControl' THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON atlas_staff.%I FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable()',t||'_immutable',t);
    END IF;
  END LOOP;
END $$;
CREATE TRIGGER "StaffLearningCandidates_authority" BEFORE INSERT ON "StaffLearningCandidates" FOR EACH ROW EXECUTE FUNCTION atlas_staff.learning_candidates_guard();
CREATE CONSTRAINT TRIGGER "StaffLearningCandidates_authority_commit" AFTER INSERT ON "StaffLearningCandidates" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.learning_candidates_guard();
CREATE TRIGGER "StaffTrustedLearningDecision_authority" BEFORE INSERT ON "StaffTrustedLearningDecision" FOR EACH ROW EXECUTE FUNCTION atlas_staff.learning_decision_guard();
CREATE CONSTRAINT TRIGGER "StaffTrustedLearningDecision_authority_commit" AFTER INSERT ON "StaffTrustedLearningDecision" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.learning_decision_guard();
CREATE CONSTRAINT TRIGGER "StaffTrustedLearningDecision_audit_commit" AFTER INSERT ON "StaffTrustedLearningDecision" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.learning_audit_guard();
CREATE CONSTRAINT TRIGGER "StaffAudit_learning_commit" AFTER INSERT ON "StaffAudit" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.learning_audit_guard();
REVOKE ALL ON FUNCTION atlas_staff.learning_fixed_object(jsonb),atlas_staff.learning_exact_keys(json,text[]),atlas_staff.learning_control_guard(),
  atlas_staff.learning_scope_current(atlas_staff."StaffLearningCandidates"),atlas_staff.learning_candidates_guard(),
  atlas_staff.lock_learning_candidates(uuid,text,uuid,uuid,uuid),atlas_staff.learning_decision_guard(),atlas_staff.learning_audit_guard() FROM PUBLIC;
COMMIT;
