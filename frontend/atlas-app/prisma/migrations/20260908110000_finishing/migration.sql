BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;

-- Additive ATLAS finishing facts. Existing public approvals remain historical.
-- SQL checks exact persisted hashes, bindings and human authority; the hosted
-- protocol verifier alone proves signatures against the enrolled key allowlist.
CREATE TABLE "StaffNfcControl" (
  id text PRIMARY KEY DEFAULT 'active',enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL,origin text NOT NULL,"deploymentId" text NOT NULL,
  "releaseSha" varchar(40) NOT NULL,"configHash" varchar(64) NOT NULL,
  "signingKeyHash" varchar(64) NOT NULL,"trustHash" varchar(64) NOT NULL,
  revision integer NOT NULL DEFAULT 1,"updatedAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT "StaffNfcControl_shape" CHECK ((id='active' AND revision>0 AND length("deploymentId") BETWEEN 1 AND 200
    AND "releaseSha" ~ '^[a-f0-9]{40}$' AND "configHash" ~ '^[a-f0-9]{64}$'
    AND "signingKeyHash" ~ '^[a-f0-9]{64}$' AND "trustHash" ~ '^[a-f0-9]{64}$'
    AND ((mode='PRODUCTION' AND origin='https://app.atlasgrading.com')
      OR (mode='LOCAL_FIXTURE' AND origin='http://127.0.0.1:4318'))) IS TRUE)
);
CREATE TRIGGER "StaffNfcControl_revision" BEFORE UPDATE ON "StaffNfcControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_control_guard();
CREATE TRIGGER "StaffNfcControl_no_delete" BEFORE DELETE ON "StaffNfcControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffNfcControl_no_truncate" BEFORE TRUNCATE ON "StaffNfcControl"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE FUNCTION atlas_staff.lock_nfc_control() RETURNS SETOF atlas_staff."StaffNfcControl"
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT * FROM atlas_staff."StaffNfcControl" WHERE id='active' FOR SHARE;
$$;
REVOKE ALL ON FUNCTION atlas_staff.lock_nfc_control() FROM PUBLIC;
REVOKE ALL ON TABLE "StaffNfcControl" FROM PUBLIC;

-- Narrow scalar serializer for the protocol's flat objects (ASCII field names,
-- integer version, strings/bool/null only). This is not a general JSON canonical
-- implementation. Nested approved label content is compared to the immutable
-- approved packet, and the exact supplied canonical bytes are SHA256 checked.
CREATE FUNCTION atlas_staff.finishing_scalar_object(p jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,atlas_staff AS $$
DECLARE result text;
BEGIN
  IF jsonb_typeof(p)<>'object' OR EXISTS(SELECT 1 FROM jsonb_each(p) WHERE jsonb_typeof(value) NOT IN ('string','number','boolean','null')) THEN
    RAISE EXCEPTION 'ATLAS finishing scalar object required'; END IF;
  SELECT '{'||coalesce(string_agg(to_json(key)::text||':'||value::text,',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(p);
  RETURN result;
END $$;
CREATE FUNCTION atlas_staff.finishing_exact_keys(p jsonb,keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
  SELECT jsonb_typeof(p)='object' AND p ?& keys AND p-keys='{}'::jsonb;
$$;
REVOKE ALL ON FUNCTION atlas_staff.finishing_scalar_object(jsonb),atlas_staff.finishing_exact_keys(jsonb,text[]) FROM PUBLIC;

ALTER TABLE "StaffReportApproval" ADD CONSTRAINT "StaffReportApproval_id_specimen_key" UNIQUE(id,"specimenId");

CREATE TABLE "StaffLabelIssue" (
  id uuid PRIMARY KEY,"specimenId" uuid NOT NULL REFERENCES "StaffSpecimen"(id) ON DELETE RESTRICT,
  "approvalId" uuid NOT NULL,"actorId" uuid NOT NULL REFERENCES "StaffIdentity"(id) ON DELETE RESTRICT,
  "sessionHash" varchar(64) NOT NULL REFERENCES "StaffSession"("tokenHash") ON DELETE RESTRICT,
  "accessVersion" integer NOT NULL,"assignmentFence" integer NOT NULL,"controlRevision" integer NOT NULL,
  "operationId" varchar(80) NOT NULL,"inputHash" varchar(64) NOT NULL,"createdAt" timestamp(3) NOT NULL,
  "labelCanonical" text NOT NULL,"labelHash" varchar(64) NOT NULL,
  CHECK ((octet_length("labelCanonical") BETWEEN 2 AND 16384 AND jsonb_typeof("labelCanonical"::jsonb)='object'
    AND "labelHash"=encode(sha256(convert_to("labelCanonical",'UTF8')),'hex')) IS TRUE),
  UNIQUE(id,"specimenId","approvalId"),UNIQUE("actorId","operationId"),
  FOREIGN KEY ("approvalId","specimenId") REFERENCES "StaffReportApproval"(id,"specimenId") ON DELETE RESTRICT,
  CHECK (("accessVersion">0 AND "assignmentFence">0 AND "controlRevision">0
    AND "sessionHash" ~ '^[a-f0-9]{64}$' AND "operationId" ~ '^[A-Za-z0-9_-]{8,80}$'
    AND "inputHash" ~ '^[a-f0-9]{64}$') IS TRUE)
);
CREATE INDEX "StaffLabelIssue_specimen_created_idx" ON "StaffLabelIssue"("specimenId","createdAt",id);

CREATE TABLE "StaffNfcJob" (
  id uuid PRIMARY KEY,"specimenId" uuid NOT NULL REFERENCES "StaffSpecimen"(id) ON DELETE RESTRICT,
  "approvalId" uuid NOT NULL,"actorId" uuid NOT NULL REFERENCES "StaffIdentity"(id) ON DELETE RESTRICT,
  "sessionHash" varchar(64) NOT NULL REFERENCES "StaffSession"("tokenHash") ON DELETE RESTRICT,
  "accessVersion" integer NOT NULL,"assignmentFence" integer NOT NULL,"controlRevision" integer NOT NULL,
  "operationId" varchar(80) NOT NULL,"inputHash" varchar(64) NOT NULL,"createdAt" timestamp(3) NOT NULL,
  "labelIssueId" uuid NOT NULL,"jobCanonical" text NOT NULL,"jobHash" varchar(64) NOT NULL,
  "jobEnvelopeSha256" varchar(64) NOT NULL UNIQUE,"bindingHash" varchar(64) NOT NULL,"expiresAt" timestamp(3) NOT NULL,
  "nfcConfigHash" varchar(64) NOT NULL,"nfcControlRevision" integer NOT NULL,
  FOREIGN KEY ("labelIssueId","specimenId","approvalId") REFERENCES "StaffLabelIssue"(id,"specimenId","approvalId") ON DELETE RESTRICT,
  CHECK ((octet_length("jobCanonical") BETWEEN 2 AND 8192 AND jsonb_typeof("jobCanonical"::jsonb)='object'
    AND "jobHash"=encode(sha256(convert_to("jobCanonical",'UTF8')),'hex')
    AND "jobEnvelopeSha256" ~ '^[a-f0-9]{64}$' AND "bindingHash" ~ '^[a-f0-9]{64}$'
    AND "expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '15 minutes'
    AND "nfcConfigHash" ~ '^[a-f0-9]{64}$' AND "nfcControlRevision">0) IS TRUE),
  UNIQUE(id,"specimenId","approvalId"),UNIQUE("actorId","operationId"),
  FOREIGN KEY ("approvalId","specimenId") REFERENCES "StaffReportApproval"(id,"specimenId") ON DELETE RESTRICT,
  CHECK (("accessVersion">0 AND "assignmentFence">0 AND "controlRevision">0
    AND "sessionHash" ~ '^[a-f0-9]{64}$' AND "operationId" ~ '^[A-Za-z0-9_-]{8,80}$'
    AND "inputHash" ~ '^[a-f0-9]{64}$') IS TRUE)
);
CREATE INDEX "StaffNfcJob_specimen_created_idx" ON "StaffNfcJob"("specimenId","createdAt",id);

CREATE TABLE "StaffNfcVerification" (
  id uuid PRIMARY KEY,"specimenId" uuid NOT NULL REFERENCES "StaffSpecimen"(id) ON DELETE RESTRICT,
  "approvalId" uuid NOT NULL,"actorId" uuid NOT NULL REFERENCES "StaffIdentity"(id) ON DELETE RESTRICT,
  "sessionHash" varchar(64) NOT NULL REFERENCES "StaffSession"("tokenHash") ON DELETE RESTRICT,
  "accessVersion" integer NOT NULL,"assignmentFence" integer NOT NULL,"controlRevision" integer NOT NULL,
  "operationId" varchar(80) NOT NULL,"inputHash" varchar(64) NOT NULL,"createdAt" timestamp(3) NOT NULL,
  "jobId" uuid NOT NULL UNIQUE,"resultCanonical" text NOT NULL,"resultHash" varchar(64) NOT NULL UNIQUE,
  "readbackPayloadSha256" varchar(64) NOT NULL,"workstationKeyId" varchar(64) NOT NULL,"observedAt" timestamp(3) NOT NULL,
  "nfcConfigHash" varchar(64) NOT NULL,"nfcControlRevision" integer NOT NULL,
  FOREIGN KEY ("jobId","specimenId","approvalId") REFERENCES "StaffNfcJob"(id,"specimenId","approvalId") ON DELETE RESTRICT,
  CHECK ((octet_length("resultCanonical") BETWEEN 2 AND 8192 AND jsonb_typeof("resultCanonical"::jsonb)='object'
    AND "resultHash"=encode(sha256(convert_to("resultCanonical",'UTF8')),'hex')
    AND "readbackPayloadSha256" ~ '^[a-f0-9]{64}$' AND "workstationKeyId" ~ '^[a-f0-9]{64}$'
    AND "nfcConfigHash" ~ '^[a-f0-9]{64}$' AND "nfcControlRevision">0) IS TRUE),
  UNIQUE(id,"specimenId","approvalId"),UNIQUE("actorId","operationId"),
  FOREIGN KEY ("approvalId","specimenId") REFERENCES "StaffReportApproval"(id,"specimenId") ON DELETE RESTRICT,
  CHECK (("accessVersion">0 AND "assignmentFence">0 AND "controlRevision">0
    AND "sessionHash" ~ '^[a-f0-9]{64}$' AND "operationId" ~ '^[A-Za-z0-9_-]{8,80}$'
    AND "inputHash" ~ '^[a-f0-9]{64}$') IS TRUE)
);
CREATE INDEX "StaffNfcVerification_specimen_created_idx" ON "StaffNfcVerification"("specimenId","createdAt",id);

CREATE TABLE "StaffPhysicalFinish" (
  id uuid PRIMARY KEY,"specimenId" uuid NOT NULL REFERENCES "StaffSpecimen"(id) ON DELETE RESTRICT,
  "approvalId" uuid NOT NULL,"actorId" uuid NOT NULL REFERENCES "StaffIdentity"(id) ON DELETE RESTRICT,
  "sessionHash" varchar(64) NOT NULL REFERENCES "StaffSession"("tokenHash") ON DELETE RESTRICT,
  "accessVersion" integer NOT NULL,"assignmentFence" integer NOT NULL,"controlRevision" integer NOT NULL,
  "operationId" varchar(80) NOT NULL,"inputHash" varchar(64) NOT NULL,"createdAt" timestamp(3) NOT NULL,
  "labelIssueId" uuid NOT NULL,"verificationId" uuid NOT NULL,stage text NOT NULL,"assemblyId" uuid,"physicalConfirmedAt" timestamp(3) NOT NULL,
  FOREIGN KEY ("labelIssueId","specimenId","approvalId") REFERENCES "StaffLabelIssue"(id,"specimenId","approvalId") ON DELETE RESTRICT,
  FOREIGN KEY ("verificationId","specimenId","approvalId") REFERENCES "StaffNfcVerification"(id,"specimenId","approvalId") ON DELETE RESTRICT,
  UNIQUE("labelIssueId","verificationId",stage),
  UNIQUE(id,"specimenId","approvalId","labelIssueId","verificationId"),
  CHECK (((stage='ASSEMBLED' AND "assemblyId" IS NULL) OR (stage='SONIC_WELDED' AND "assemblyId" IS NOT NULL AND "assemblyId"<>id))
    AND "physicalConfirmedAt"="createdAt"),
  UNIQUE(id,"specimenId","approvalId"),UNIQUE("actorId","operationId"),
  FOREIGN KEY ("approvalId","specimenId") REFERENCES "StaffReportApproval"(id,"specimenId") ON DELETE RESTRICT,
  CHECK (("accessVersion">0 AND "assignmentFence">0 AND "controlRevision">0
    AND "sessionHash" ~ '^[a-f0-9]{64}$' AND "operationId" ~ '^[A-Za-z0-9_-]{8,80}$'
    AND "inputHash" ~ '^[a-f0-9]{64}$') IS TRUE)
);
CREATE INDEX "StaffPhysicalFinish_specimen_created_idx" ON "StaffPhysicalFinish"("specimenId","createdAt",id);
ALTER TABLE "StaffPhysicalFinish" ADD CONSTRAINT "StaffPhysicalFinish_exact_assembly_fkey"
  FOREIGN KEY ("assemblyId","specimenId","approvalId","labelIssueId","verificationId")
  REFERENCES "StaffPhysicalFinish"(id,"specimenId","approvalId","labelIssueId","verificationId") ON DELETE RESTRICT;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['StaffLabelIssue','StaffNfcJob','StaffNfcVerification','StaffPhysicalFinish'] LOOP
    EXECUTE format('REVOKE ALL ON atlas_staff.%I FROM PUBLIC',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON atlas_staff.%I FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable()',t||'_immutable',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON atlas_staff.%I FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable()',t||'_no_truncate',t);
  END LOOP;
END $$;

CREATE FUNCTION atlas_staff.finishing_insert_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE co atlas_staff."StaffControl"%ROWTYPE; nc atlas_staff."StaffNfcControl"%ROWTYPE;
  i atlas_staff."StaffIdentity"%ROWTYPE; se atlas_staff."StaffSession"%ROWTYPE; browser atlas_staff."StaffBrowser"%ROWTYPE;
  assignment atlas_staff."StaffAssignment"%ROWTYPE; c atlas_staff."StaffSpecimen"%ROWTYPE;
  ap atlas_staff."StaffReportApproval"%ROWTYPE; publication atlas_staff."StaffPublicReport"%ROWTYPE;
  analysis atlas_staff."StaffAnalysisRevision"%ROWTYPE; review atlas_staff."StaffReviewRevision"%ROWTYPE;
  label_row atlas_staff."StaffLabelIssue"%ROWTYPE; job_row atlas_staff."StaffNfcJob"%ROWTYPE;
  verified atlas_staff."StaffNfcVerification"%ROWTYPE; assembly atlas_staff."StaffPhysicalFinish"%ROWTYPE;
  packet jsonb; p jsonb; j jsonb; expected_binding jsonb; input jsonb; input_text text; kind text; envelope text; exact_url text;
  now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
  job_fields text[]:=ARRAY['schemaVersion','algorithm','signingKeyId','purpose','nonce','specimenId','approvalId','approvalVersion',
    'publicToken','publicHash','url','chipType','securityMode','programmingProfile','issuedAt','expiresAt'];
  result_fields text[]:=ARRAY['schemaVersion','algorithm','workstationKeyId','jobEnvelopeSha256','nonce','specimenId','approvalId','approvalVersion',
    'publicToken','publicHash','url','chipType','securityMode','programmingProfile','readerModel','adapterIdentity','adapterVersion',
    'readbackPayloadSha256','writeProtectionState','readerResultCode','helperCapability','observedAt','signature'];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO co FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=NEW."actorId" FOR SHARE;
  SELECT * INTO se FROM atlas_staff."StaffSession" WHERE "tokenHash"=NEW."sessionHash" FOR SHARE;
  SELECT * INTO browser FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=se."browserHash" FOR SHARE;
  SELECT * INTO assignment FROM atlas_staff."StaffAssignment" WHERE "specimenId"=NEW."specimenId" AND "identityId"=NEW."actorId" FOR SHARE;
  SELECT * INTO c FROM atlas_staff."StaffSpecimen" WHERE id=NEW."specimenId" FOR UPDATE;
  SELECT * INTO publication FROM atlas_staff."StaffPublicReport" WHERE "specimenId"=c.id FOR SHARE;
  SELECT * INTO ap FROM atlas_staff."StaffReportApproval" WHERE id=NEW."approvalId";
  SELECT * INTO analysis FROM atlas_staff."StaffAnalysisRevision" WHERE "specimenId"=c.id AND revision=c."analysisRevision";
  SELECT * INTO review FROM atlas_staff."StaffReviewRevision" WHERE "specimenId"=c.id AND revision=c."draftRevision";
  packet:=ap."publicCanonical"::jsonb;
  IF (co.enabled AND co.revision=NEW."controlRevision" AND i.id=NEW."actorId" AND i.role='REVIEWER'
    AND i."revokedAt" IS NULL AND i."certificationUntil">now_at AND i."accessVersion"=NEW."accessVersion"
    AND se."identityId"=i.id AND se."revokedAt" IS NULL AND se."expiresAt">now_at
    AND se."accessVersion"=i."accessVersion" AND se."controlRevision"=co.revision
    AND se."createdAt">now_at-interval '15 minutes' AND se."createdAt"<=now_at
    AND browser."controlRevision"=co.revision AND browser."createdAt"<=now_at AND browser."expiresAt">now_at
    AND assignment."canReview" AND assignment."revokedAt" IS NULL AND assignment."expiresAt">now_at
    AND assignment.fence=NEW."assignmentFence" AND publication."currentApprovalId"=ap.id AND ap."specimenId"=c.id
    AND ap."analysisRevision"=c."analysisRevision" AND ap."reviewRevision"=c."draftRevision" AND ap."evidenceHash"=c."evidenceHash"
    AND ap."analysisHash"=analysis."sourceHash" AND ap."reviewHash"=review."contentHash"
    AND analysis."evidenceHash"=c."evidenceHash" AND review."evidenceHash"=c."evidenceHash" AND review."analysisRevision"=analysis.revision
    AND analysis.mode=co.mode AND packet->>'mode'=co.mode
    AND analysis."admissionCanonical"::jsonb->>'policyHash'=co."gradingPolicyHash"
    AND analysis."admissionCanonical"::jsonb->>'purpose'='atlas-analysis-admission-v1'
    AND review.canonical::jsonb->>'disposition'='READY_FOR_HUMAN'
    AND packet->>'publicToken'=publication."publicToken" AND packet->>'reportNumber'=publication."reportNumber"
    AND packet->>'approvalVersion'=ap.version::text AND packet->>'analysisHash'=ap."analysisHash" AND packet->>'evidenceHash'=ap."evidenceHash"
    AND packet->>'approvedAt'=to_char(ap."approvedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    AND NEW."createdAt">now_at-interval '15 seconds' AND NEW."createdAt"<=now_at AND NEW."createdAt">=se."createdAt"
  ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS finishing requires a fresh trained human and exact current approval'; END IF;
  IF EXISTS(SELECT 1 FROM atlas_staff."StaffGradingOperation" WHERE "specimenId"=c.id AND state IN ('RESERVED','DISPATCHED','UNKNOWN'))
    OR atlas_staff.operator_work_pending(c.id)>0 OR atlas_staff.operator_proposals_pending(c.id)>0 THEN
    RAISE EXCEPTION 'ATLAS finishing requires resolved grading and operator work'; END IF;
  expected_binding:=jsonb_build_object('specimenId',c.id::text,'approvalId',ap.id::text,'approvalVersion',ap.version,
    'publicToken',publication."publicToken",'publicHash',ap."publicHash");
  exact_url:='https://atlasgrading.com/reports/'||publication."publicToken"||'?v='||ap.version;
  input:=jsonb_build_object('operationId',NEW."operationId",'approvalId',ap.id::text,'approvalVersion',ap.version,'publicHash',ap."publicHash");

  IF TG_TABLE_NAME IN ('StaffNfcJob','StaffNfcVerification') THEN
    SELECT * INTO nc FROM atlas_staff."StaffNfcControl" WHERE id='active' FOR SHARE;
    IF (nc.enabled AND nc.mode=co.mode AND nc.origin=co.origin AND nc."deploymentId"=co."deploymentId" AND nc."releaseSha"=co."releaseSha"
      AND nc.revision=NEW."nfcControlRevision" AND nc."configHash"=NEW."nfcConfigHash") IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS NFC requires its exact current enabled control'; END IF;
  END IF;

  IF TG_TABLE_NAME='StaffLabelIssue' THEN
    kind:='LABEL';p:=NEW."labelCanonical"::jsonb;
    IF p IS DISTINCT FROM expected_binding||jsonb_build_object('version','atlas-approved-slab-label-v1','labelIssueId',NEW.id::text,
      'mode',co.mode,'reportNumber',publication."reportNumber",'url',exact_url,'cardProfile',packet->'report'->'cardProfile',
      'identity',packet->'report'->'identity','grade',packet->'report'->'grade') THEN
      RAISE EXCEPTION 'ATLAS label must exactly copy the immutable approved report'; END IF;
  ELSIF TG_TABLE_NAME='StaffNfcJob' THEN
    kind:='NFC_JOB';j:=NEW."jobCanonical"::jsonb;
    IF EXISTS(SELECT 1 FROM jsonb_each(j) WHERE key<>'approvalVersion' AND jsonb_typeof(value)<>'string')
      OR jsonb_typeof(j->'approvalVersion') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'ATLAS NFC job field types are invalid'; END IF;
    SELECT * INTO label_row FROM atlas_staff."StaffLabelIssue" WHERE id=NEW."labelIssueId";
    IF (label_row."specimenId"=c.id AND label_row."approvalId"=ap.id AND label_row."createdAt"<=NEW."createdAt") IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS NFC job must use its exact prior label issue'; END IF;
    IF (atlas_staff.finishing_exact_keys(j,job_fields||ARRAY['signature']) AND NEW."jobCanonical"=atlas_staff.finishing_scalar_object(j)
      AND j->>'schemaVersion'='atlas-approved-report-nfc-job-v1' AND j->>'purpose'='atlas-program-approved-report-url-v1'
      AND j->>'signingKeyId'=nc."signingKeyHash" AND j @> expected_binding AND j->>'approvalVersion'=ap.version::text AND j->>'url'=exact_url
      AND j->>'algorithm'='ecdsa-p256-sha256-p1363' AND j->>'chipType'='FEIJU_F8215'
      AND j->>'securityMode'='static_url_v1' AND j->>'programmingProfile'='gototags_manual_start_v1'
      AND j->>'nonce' ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$' AND j->>'signature' ~ '^[A-Za-z0-9_-]{85}[AQgw]$'
      AND j->>'issuedAt'=to_char(NEW."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      AND j->>'expiresAt'=to_char(NEW."expiresAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AND NEW."expiresAt">now_at
      AND NEW."bindingHash"=encode(sha256(convert_to(atlas_staff.finishing_scalar_object(expected_binding),'UTF8')),'hex')) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS NFC job protocol or approved binding is invalid'; END IF;
    SELECT string_agg(j->>field,E'\n' ORDER BY ordinal) INTO envelope FROM unnest(job_fields) WITH ORDINALITY AS fields(field,ordinal);
    IF NEW."jobEnvelopeSha256"<>encode(sha256(convert_to(envelope||E'\n'||(j->>'signature'),'UTF8')),'hex') THEN
      RAISE EXCEPTION 'ATLAS NFC exact signed envelope hash does not match'; END IF;
    input:=input||jsonb_build_object('labelIssueId',NEW."labelIssueId"::text);
  ELSIF TG_TABLE_NAME='StaffNfcVerification' THEN
    kind:='NFC_VERIFIED';p:=NEW."resultCanonical"::jsonb;
    IF EXISTS(SELECT 1 FROM jsonb_each(p) WHERE key<>'approvalVersion' AND jsonb_typeof(value)<>'string')
      OR jsonb_typeof(p->'approvalVersion') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'ATLAS NFC result field types are invalid'; END IF;
    SELECT * INTO job_row FROM atlas_staff."StaffNfcJob" WHERE id=NEW."jobId";
    j:=job_row."jobCanonical"::jsonb;
    IF (job_row."specimenId"=c.id AND job_row."approvalId"=ap.id AND job_row."expiresAt">=now_at
      AND job_row."createdAt"<=NEW."observedAt" AND NEW."observedAt"<=job_row."expiresAt" AND NEW."observedAt"<=now_at+interval '30 seconds'
      AND atlas_staff.finishing_exact_keys(p,result_fields) AND NEW."resultCanonical"=atlas_staff.finishing_scalar_object(p)
      AND p->>'schemaVersion'='atlas-approved-report-nfc-result-v1' AND p @> expected_binding AND p->>'approvalVersion'=ap.version::text
      AND p->>'jobEnvelopeSha256'=job_row."jobEnvelopeSha256" AND p->>'nonce'=j->>'nonce' AND p->>'url'=exact_url
      AND p->>'algorithm'=j->>'algorithm' AND p->>'chipType'=j->>'chipType' AND p->>'securityMode'=j->>'securityMode'
      AND p->>'programmingProfile'=j->>'programmingProfile' AND p->>'workstationKeyId'=NEW."workstationKeyId"
      AND p->>'workstationKeyId'<>j->>'signingKeyId'
      AND p->>'readerModel'='ACS_ACR1552U' AND p->>'adapterIdentity'='gototags_desktop' AND p->>'adapterVersion'='4.37.0.1'
      AND p->>'writeProtectionState'='permanently_read_only_verified' AND p->>'readerResultCode'='write_locked_verified_gototags_readback'
      AND p->>'helperCapability'='atlas-approved-report-f8215-v1' AND p->>'signature' ~ '^[A-Za-z0-9_-]{85}[AQgw]$'
      AND p->>'observedAt'=to_char(NEW."observedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      AND p->>'readbackPayloadSha256'=NEW."readbackPayloadSha256" AND NEW."readbackPayloadSha256"=encode(sha256(convert_to(exact_url,'UTF8')),'hex')
    ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS NFC result must bind exact current job, readback and permanent lock'; END IF;
    -- Durable replay is SELECT of the existing immutable row; no late INSERT.
    input_text:='{"jobId":'||to_json(NEW."jobId"::text)::text||',"operationId":'||to_json(NEW."operationId")::text||',"result":'||NEW."resultCanonical"||'}';
  ELSE
    kind:='PHYSICAL';
    SELECT * INTO label_row FROM atlas_staff."StaffLabelIssue" WHERE id=NEW."labelIssueId";
    SELECT * INTO verified FROM atlas_staff."StaffNfcVerification" WHERE id=NEW."verificationId";
    SELECT * INTO job_row FROM atlas_staff."StaffNfcJob" WHERE id=verified."jobId";
    IF (label_row."specimenId"=c.id AND label_row."approvalId"=ap.id AND verified."specimenId"=c.id AND verified."approvalId"=ap.id
      AND job_row."specimenId"=c.id AND job_row."approvalId"=ap.id AND job_row."labelIssueId"=label_row.id
      AND verified."createdAt"<=NEW."physicalConfirmedAt") IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS physical fact requires its exact verified label and card'; END IF;
    IF NEW.stage='SONIC_WELDED' THEN
      SELECT * INTO assembly FROM atlas_staff."StaffPhysicalFinish" WHERE id=NEW."assemblyId";
      IF (assembly.stage='ASSEMBLED' AND assembly."specimenId"=c.id AND assembly."approvalId"=ap.id
        AND assembly."labelIssueId"=label_row.id AND assembly."verificationId"=verified.id
        AND assembly."physicalConfirmedAt"<=NEW."physicalConfirmedAt") IS NOT TRUE THEN
        RAISE EXCEPTION 'ATLAS sonic weld requires its exact prior human assembly'; END IF;
    END IF;
    input:=input||jsonb_build_object('labelIssueId',NEW."labelIssueId"::text,'verificationId',NEW."verificationId"::text,
      'stage',NEW.stage,'assemblyId',NEW."assemblyId"::text,'humanConfirmed',true);
  END IF;
  input_text:=coalesce(input_text,atlas_staff.finishing_scalar_object(input));
  IF NEW."inputHash"<>encode(sha256(convert_to('{"cardId":'||to_json(c.id::text)::text||',"input":'||input_text||',"kind":'||to_json(kind)::text||'}','UTF8')),'hex') THEN
    RAISE EXCEPTION 'ATLAS finishing operation hash must bind its exact immutable input'; END IF;
  RETURN NEW;
END $$;

-- A finishing audit cannot be orphaned or recycled from an older transaction.
-- Matching insertion xmin is stronger than a wall-clock window; facts and their
-- audit must be inserted in the same transaction/subtransaction. No UPDATE is
-- permitted to manufacture a fresh xmin on an old receipt.
CREATE UNIQUE INDEX "StaffAudit_finishing_record_key" ON "StaffAudit"((details::jsonb->>'recordId'))
  WHERE event IN ('ATLAS_LABEL_ISSUED','ATLAS_NFC_JOB_ISSUED','ATLAS_NFC_VERIFIED','ATLAS_ASSEMBLY_CONFIRMED','ATLAS_SONIC_WELD_CONFIRMED');
CREATE FUNCTION atlas_staff.finishing_audit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE table_name text; wanted text; record_id uuid; fact jsonb; fact_xmin xid; audit_xmin xid;
  audit atlas_staff."StaffAudit"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='StaffAudit' THEN
    wanted:=NEW.event;
    table_name:=CASE wanted WHEN 'ATLAS_LABEL_ISSUED' THEN 'StaffLabelIssue' WHEN 'ATLAS_NFC_JOB_ISSUED' THEN 'StaffNfcJob'
      WHEN 'ATLAS_NFC_VERIFIED' THEN 'StaffNfcVerification' WHEN 'ATLAS_ASSEMBLY_CONFIRMED' THEN 'StaffPhysicalFinish'
      WHEN 'ATLAS_SONIC_WELD_CONFIRMED' THEN 'StaffPhysicalFinish' END;
    IF table_name IS NULL THEN RETURN NULL; END IF;
    record_id:=(NEW.details::jsonb->>'recordId')::uuid;
    SELECT * INTO audit FROM atlas_staff."StaffAudit" WHERE id=NEW.id;
  ELSE
    table_name:=TG_TABLE_NAME;record_id:=NEW.id;
    wanted:=CASE table_name WHEN 'StaffLabelIssue' THEN 'ATLAS_LABEL_ISSUED' WHEN 'StaffNfcJob' THEN 'ATLAS_NFC_JOB_ISSUED'
      WHEN 'StaffNfcVerification' THEN 'ATLAS_NFC_VERIFIED' ELSE
        CASE WHEN to_jsonb(NEW)->>'stage'='ASSEMBLED' THEN 'ATLAS_ASSEMBLY_CONFIRMED' ELSE 'ATLAS_SONIC_WELD_CONFIRMED' END END;
    SELECT * INTO audit FROM atlas_staff."StaffAudit" WHERE event=wanted AND details::jsonb->>'recordId'=record_id::text;
  END IF;
  EXECUTE format('SELECT to_jsonb(f),f.xmin FROM atlas_staff.%I f WHERE id=$1',table_name) INTO fact,fact_xmin USING record_id;
  SELECT xmin INTO audit_xmin FROM atlas_staff."StaffAudit" WHERE id=audit.id;
  IF (fact IS NOT NULL AND audit.id IS NOT NULL AND fact_xmin=audit_xmin AND audit.event=wanted
    AND audit."subjectId"=fact->>'specimenId' AND audit."actorId"::text=fact->>'actorId'
    AND audit.details::jsonb=jsonb_build_object('recordId',fact->>'id','approvalId',fact->>'approvalId',
      'operationId',fact->>'operationId','inputHash',fact->>'inputHash','assignmentFence',(fact->>'assignmentFence')::int)
    AND (table_name<>'StaffPhysicalFinish' OR fact->>'stage'=CASE WHEN wanted='ATLAS_ASSEMBLY_CONFIRMED' THEN 'ASSEMBLED' ELSE 'SONIC_WELDED' END)
  ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS finishing requires its exact immutable audit in the same transaction'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION atlas_staff.finishing_insert_guard(),atlas_staff.finishing_audit_guard() FROM PUBLIC;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['StaffLabelIssue','StaffNfcJob','StaffNfcVerification','StaffPhysicalFinish'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON atlas_staff.%I FOR EACH ROW EXECUTE FUNCTION atlas_staff.finishing_insert_guard()',t||'_authority',t);
    EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT ON atlas_staff.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.finishing_insert_guard()',t||'_authority_commit',t);
    EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT ON atlas_staff.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.finishing_audit_guard()',t||'_audit_commit',t);
  END LOOP;
END $$;
CREATE CONSTRAINT TRIGGER "StaffAudit_finishing_commit" AFTER INSERT ON "StaffAudit" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.finishing_audit_guard();
COMMIT;
