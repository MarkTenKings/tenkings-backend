BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;
CREATE TABLE "StaffOperatorImage" (
  "imageId" uuid PRIMARY KEY, "runId" uuid NOT NULL REFERENCES "StaffOperatorRun"(id) ON DELETE RESTRICT,
  "stepId" uuid NOT NULL REFERENCES "StaffOperatorStep"(id) ON DELETE RESTRICT,
  canonical text NOT NULL, hash varchar(64) NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT "StaffOperatorImage_shape" CHECK ((octet_length(canonical)<=16384 AND canonical::jsonb->>'version'='atlas-operator-image-v1'
    AND canonical::jsonb->>'imageId'="imageId"::text AND NOT canonical::jsonb ? 'bytesBase64'
    AND hash=encode(sha256(convert_to(canonical,'UTF8')),'hex')) IS TRUE)
);
CREATE TABLE "StaffOperatorImageDelivery" (
  "attemptId" uuid NOT NULL REFERENCES "StaffOperatorAttempt"(id) ON DELETE RESTRICT,
  "imageId" uuid NOT NULL REFERENCES "StaffOperatorImage"("imageId") ON DELETE RESTRICT,
  "requestHash" varchar(64) NOT NULL, "lineageHash" varchar(64) NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), PRIMARY KEY("attemptId","imageId")
);
CREATE TABLE "StaffOperatorImageControl" (
  id text PRIMARY KEY DEFAULT 'active', enabled boolean NOT NULL DEFAULT false, mode text NOT NULL,
  origin text NOT NULL, "deploymentId" text NOT NULL, "releaseSha" varchar(40) NOT NULL,
  "configHash" varchar(64) NOT NULL, "clientKeyHash" varchar(64) NOT NULL,
  revision integer NOT NULL DEFAULT 1, "updatedAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CHECK ((id='active' AND revision>0 AND mode IN ('PRODUCTION','LOCAL_FIXTURE') AND "releaseSha" ~ '^[a-f0-9]{40}$'
    AND "configHash" ~ '^[a-f0-9]{64}$' AND "clientKeyHash" ~ '^[a-f0-9]{64}$') IS TRUE)
);
CREATE TRIGGER "StaffOperatorImageControl_change" BEFORE UPDATE ON "StaffOperatorImageControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_control_guard();

-- A human explicitly resolves each machine proposal against a saved report.
-- A later analysis requires a new decision; old decisions remain audit history.
CREATE TABLE "StaffProposalDecision" (
  id uuid PRIMARY KEY, "specimenId" uuid NOT NULL REFERENCES "StaffSpecimen"(id) ON DELETE RESTRICT,
  "stepId" uuid NOT NULL REFERENCES "StaffOperatorStep"(id) ON DELETE RESTRICT,
  "analysisRevision" integer NOT NULL, "analysisHash" varchar(64) NOT NULL,
  "evidenceHash" varchar(64) NOT NULL, decision text NOT NULL, reason varchar(1000) NOT NULL,
  "actorId" uuid NOT NULL REFERENCES "StaffIdentity"(id) ON DELETE RESTRICT, "sessionHash" varchar(64) NOT NULL,
  "accessVersion" integer NOT NULL, "assignmentFence" integer NOT NULL, "controlRevision" integer NOT NULL,
  "operationId" uuid NOT NULL, "inputHash" varchar(64) NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  UNIQUE("stepId","analysisRevision"), UNIQUE("actorId","operationId"),
  CHECK (("analysisRevision">0 AND decision IN ('ACCEPTED','REJECTED','INSPECTED') AND length(trim(reason))>0
    AND "analysisHash" ~ '^[a-f0-9]{64}$' AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "inputHash" ~ '^[a-f0-9]{64}$') IS TRUE)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['StaffOperatorImage','StaffOperatorImageDelivery','StaffProposalDecision','StaffOperatorImageControl'] LOOP
    EXECUTE format('REVOKE ALL ON atlas_staff.%I FROM PUBLIC',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON atlas_staff.%I FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable()',t||'_no_delete',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON atlas_staff.%I FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable()',t||'_no_truncate',t);
    IF t<>'StaffOperatorImageControl' THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON atlas_staff.%I FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable()',t||'_immutable',t);
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION atlas_staff.operator_source_matches(source_id text, owner_id text, source_revision text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE source public."AiGraderV2Session"%ROWTYPE;
BEGIN
  -- Held until the dispatch/step transaction commits. A concurrent legacy
  -- source writer cannot slip between admission and this machine transition.
  SELECT * INTO source FROM public."AiGraderV2Session" WHERE id=source_id FOR SHARE;
  RETURN source.id IS NOT NULL AND source."createdByUserId"=owner_id AND source."workflowState"='CAPTURED'
    AND source."updatedAt"=(source_revision::timestamptz AT TIME ZONE 'UTC');
END $$;
REVOKE ALL ON FUNCTION atlas_staff.operator_source_matches(text,text,text) FROM PUBLIC;
CREATE FUNCTION atlas_staff.operator_source_current(run_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE expected record;
BEGIN
  SELECT s."sourceType",s."sourceId",s."sourceOwnerId",a."sourceRevision",c.mode INTO expected
  FROM atlas_staff."StaffOperatorRun" r JOIN atlas_staff."StaffSpecimen" s ON s.id=r."specimenId"
  JOIN atlas_staff."StaffAnalysisRevision" a ON a."specimenId"=s.id AND a.revision=r."expectedAnalysisRevision"
  JOIN atlas_staff."StaffOperatorControl" c ON c.id='active'
  WHERE r.id=run_id AND s."analysisRevision"=r."expectedAnalysisRevision" AND s."evidenceHash"=r."evidenceHash";
  IF expected IS NULL THEN RETURN false; END IF;
  IF expected."sourceType"='LOCAL_FIXTURE' THEN RETURN expected.mode='LOCAL_FIXTURE'; END IF;
  RETURN expected.mode='PRODUCTION' AND atlas_staff.operator_source_matches(expected."sourceId",expected."sourceOwnerId",expected."sourceRevision");
END;
$$;
REVOKE ALL ON FUNCTION atlas_staff.operator_source_current(uuid) FROM PUBLIC;
CREATE FUNCTION atlas_staff.operator_source_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
BEGIN
  IF atlas_staff.operator_source_current(NEW."runId") IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS original source changed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffOperatorStep_source" BEFORE INSERT ON "StaffOperatorStep" FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_source_guard();
CREATE TRIGGER "StaffOperatorAttempt_source" BEFORE INSERT ON "StaffOperatorAttempt" FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_source_guard();
CREATE TRIGGER "StaffOperatorAttempt_dispatch_source" BEFORE UPDATE ON "StaffOperatorAttempt"
  FOR EACH ROW WHEN(NEW.state='DISPATCHED' AND OLD.state='RESERVED') EXECUTE FUNCTION atlas_staff.operator_source_guard();

CREATE FUNCTION atlas_staff.operator_image_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE i atlas_staff."StaffOperatorImage"%ROWTYPE; s atlas_staff."StaffOperatorStep"%ROWTYPE;
  r atlas_staff."StaffOperatorRun"%ROWTYPE; a atlas_staff."StaffOperatorAttempt"%ROWTYPE; p jsonb; asset jsonb; req jsonb;
BEGIN
  IF TG_TABLE_NAME='StaffOperatorImage' THEN
    i:=NEW; SELECT * INTO s FROM atlas_staff."StaffOperatorStep" WHERE id=i."stepId";
    SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=i."runId";
    p:=i.canonical::jsonb; asset:=p->'asset'; req:=p->'request';
    IF (s."runId"=r.id AND s.revision=r.revision AND s."toolName" IN ('read_card_report','inspect_region')
      AND req->>'runId'=r.id::text AND req->>'evidenceHash'=r."evidenceHash" AND req->>'manifestHash'=r."manifestHash"
      AND (req->>'expectedRevision')::int=s.revision-1 AND p->>'decoder'='sharp-0.33.5/vips-8.15.3'
      AND p->>'contentType'='image/png' AND p->>'sha256' ~ '^[a-f0-9]{64}$'
      AND p->>'transformHash'=encode(sha256(convert_to(p->>'transformCanonical','UTF8')),'hex')
      AND (r."manifestCanonical"::jsonb->'assets') @> jsonb_build_array(asset)
      AND req->>'assetId'=asset->>'assetId' AND req->>'sourceSha256'=asset->>'sha256' AND req->>'side'=asset->>'side'
      AND (s."toolName"='read_card_report' AND req->>'purpose'='OVERVIEW' AND asset->>'view'='RECTIFIED'
        OR s."toolName"='inspect_region' AND req->>'purpose'='CROP' AND req-'purpose'=s."requestCanonical"::jsonb)
    ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS generated image lineage mismatch'; END IF;
  ELSE
    SELECT * INTO i FROM atlas_staff."StaffOperatorImage" WHERE "imageId"=NEW."imageId";
    SELECT * INTO s FROM atlas_staff."StaffOperatorStep" WHERE id=i."stepId";
    SELECT * INTO a FROM atlas_staff."StaffOperatorAttempt" WHERE id=NEW."attemptId";
    IF (a."runId"=i."runId" AND a."requestHash"=NEW."requestHash" AND i.hash=NEW."lineageHash"
      AND a."runRevision">=s.revision AND a.state IN ('RESERVED','DISPATCHED')) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS image delivery attempt mismatch'; END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "StaffOperatorImage_binding" AFTER INSERT ON "StaffOperatorImage" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_image_guard();
CREATE CONSTRAINT TRIGGER "StaffOperatorImageDelivery_binding" AFTER INSERT ON "StaffOperatorImageDelivery" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_image_guard();

CREATE FUNCTION atlas_staff.operator_delivery_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE item jsonb; part jsonb; previous jsonb; marker jsonb; found uuid[]:='{}'; i atlas_staff."StaffOperatorImage"%ROWTYPE;
  packet jsonb; transform jsonb; expected_marker jsonb;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(NEW."requestCanonical"::jsonb->'input') LOOP
    previous:=NULL;
    FOR part IN SELECT value FROM jsonb_array_elements(CASE WHEN item->>'type'='function_call_output' AND jsonb_typeof(item->'output')='array'
      THEN item->'output' WHEN jsonb_typeof(item->'content')='array' THEN item->'content' ELSE '[]'::jsonb END) LOOP
      IF part->>'type'='input_image' THEN
        marker:=(previous->>'text')::jsonb;
        SELECT * INTO i FROM atlas_staff."StaffOperatorImage" WHERE "imageId"=(marker->>'imageId')::uuid;
        packet:=i.canonical::jsonb; transform:=(packet->>'transformCanonical')::jsonb;
        expected_marker:=jsonb_build_object('kind','ATLAS_TOOL_IMAGE_EVIDENCE','imageId',i."imageId"::text,
          'sourceAssetId',packet->'asset'->>'assetId','side',packet->'asset'->>'side','sourceView',packet->'asset'->>'view',
          'sourceSha256',packet->'asset'->>'sha256','sha256',packet->>'sha256','byteCount',packet->'byteCount',
          'width',packet->'width','height',packet->'height','transformHash',packet->>'transformHash',
          'coordinateFrame',transform->'coordinateFrame','sourceRect',transform->'rect','purpose',packet->'request'->>'purpose','detail','auto');
        IF (item->>'type'='function_call_output' AND previous->>'type'='input_text' AND marker->>'kind'='ATLAS_TOOL_IMAGE_EVIDENCE'
          AND i."runId"=NEW."runId" AND NOT i."imageId"=ANY(found) AND part->>'detail'='auto'
          AND marker=expected_marker AND EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorStep" s WHERE s.id=i."stepId" AND s."callId"=item->>'call_id')
          AND left(part->>'image_url',22)='data:image/png;base64,'
          AND encode(sha256(decode(substr(part->>'image_url',23),'base64')),'hex')=i.canonical::jsonb->>'sha256'
          AND marker->>'sha256'=i.canonical::jsonb->>'sha256' AND marker->>'transformHash'=i.canonical::jsonb->>'transformHash'
          AND EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorImageDelivery" d WHERE d."attemptId"=NEW.id AND d."imageId"=i."imageId"
            AND d."lineageHash"=i.hash AND d."requestHash"=NEW."requestHash")
        ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS untracked or substituted request image'; END IF;
        found:=array_append(found,i."imageId");
      END IF;
      previous:=part;
    END LOOP;
  END LOOP;
  IF cardinality(found)<>(SELECT count(*) FROM atlas_staff."StaffOperatorImageDelivery" WHERE "attemptId"=NEW.id)
    OR cardinality(found)<>(SELECT count(*) FROM atlas_staff."StaffOperatorImage" image_row JOIN atlas_staff."StaffOperatorStep" step_row ON step_row.id=image_row."stepId"
      WHERE image_row."runId"=NEW."runId" AND step_row.revision<=NEW."runRevision") THEN RAISE EXCEPTION 'ATLAS request image roster incomplete'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "StaffOperatorAttempt_images" AFTER INSERT ON "StaffOperatorAttempt" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_delivery_guard();

-- Safe staff projection: excludes opaque reasoning, credentials, source keys,
-- input image bodies, and the private stored continuation.
CREATE FUNCTION atlas_staff.read_operator_proposals(specimen uuid)
RETURNS TABLE("stepId" uuid,"runId" uuid,"analysisRevision" integer,"evidenceHash" text,"toolName" text,request text,"createdAt" timestamp)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT s.id,r.id,r."expectedAnalysisRevision",r."evidenceHash"::text,s."toolName"::text,s."requestCanonical",s."createdAt"
  FROM atlas_staff."StaffOperatorRun" r JOIN atlas_staff."StaffOperatorStep" s ON s."runId"=r.id
  WHERE r."specimenId"=specimen AND s."toolName" IN ('propose_identity','propose_finding_change') ORDER BY s."createdAt",s.id;
$$;
CREATE FUNCTION atlas_staff.operator_proposals_pending(specimen uuid) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT count(*)::int FROM atlas_staff.read_operator_proposals(specimen) p JOIN atlas_staff."StaffSpecimen" c ON c.id=specimen
  WHERE p."evidenceHash"=c."evidenceHash" AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffProposalDecision" d
    WHERE d."stepId"=p."stepId" AND d."analysisRevision"=c."analysisRevision" AND d."evidenceHash"=c."evidenceHash");
$$;
REVOKE ALL ON FUNCTION atlas_staff.read_operator_proposals(uuid),atlas_staff.operator_proposals_pending(uuid) FROM PUBLIC;
CREATE FUNCTION atlas_staff.proposal_decision_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE c atlas_staff."StaffSpecimen"%ROWTYPE; i atlas_staff."StaffIdentity"%ROWTYPE; se atlas_staff."StaffSession"%ROWTYPE;
  co atlas_staff."StaffControl"%ROWTYPE; a atlas_staff."StaffAssignment"%ROWTYPE; r atlas_staff."StaffAnalysisRevision"%ROWTYPE;
  browser atlas_staff."StaffBrowser"%ROWTYPE;
  p record; args jsonb; f jsonb; now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO c FROM atlas_staff."StaffSpecimen" WHERE id=NEW."specimenId" FOR UPDATE;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=NEW."actorId" FOR SHARE;
  SELECT * INTO se FROM atlas_staff."StaffSession" WHERE "tokenHash"=NEW."sessionHash" FOR SHARE;
  SELECT * INTO browser FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=se."browserHash" FOR SHARE;
  SELECT * INTO co FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  SELECT * INTO a FROM atlas_staff."StaffAssignment" WHERE "specimenId"=c.id AND "identityId"=i.id FOR SHARE;
  SELECT * INTO r FROM atlas_staff."StaffAnalysisRevision" WHERE "specimenId"=c.id AND revision=c."analysisRevision";
  SELECT * INTO p FROM atlas_staff.read_operator_proposals(c.id) WHERE "stepId"=NEW."stepId";
  IF (co.enabled AND co.revision=NEW."controlRevision" AND i."revokedAt" IS NULL AND i.role='REVIEWER'
    AND i."accessVersion"=NEW."accessVersion" AND se."identityId"=i.id AND se."revokedAt" IS NULL
    AND se."controlRevision"=co.revision AND se."accessVersion"=i."accessVersion" AND se."expiresAt">now_at
    AND browser."controlRevision"=co.revision AND browser."expiresAt">now_at
    AND a."revokedAt" IS NULL AND a."canReview" AND a.fence=NEW."assignmentFence" AND a."expiresAt">now_at
    AND c."analysisRevision"=NEW."analysisRevision" AND c."evidenceHash"=NEW."evidenceHash"
    AND r."sourceHash"=NEW."analysisHash" AND p."evidenceHash"=c."evidenceHash"
    AND atlas_staff.operator_work_pending(c.id)=0) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS human proposal authority stale'; END IF;
  args:=p.request::jsonb;
  IF NEW.decision='INSPECTED' AND (p."toolName"<>'propose_finding_change' OR args->>'action'<>'INSPECT_MISSED_REGION') THEN
    RAISE EXCEPTION 'ATLAS proposal requires an explicit accepted or rejected decision'; END IF;
  IF NEW.decision='ACCEPTED' THEN
    IF p."toolName"='propose_identity' THEN
      FOR f IN SELECT value FROM jsonb_array_elements(args->'fields') LOOP
        IF coalesce(r."reportCanonical"::jsonb->'identity'->(f->>'field'),'null'::jsonb) IS DISTINCT FROM f->'value' THEN
          RAISE EXCEPTION 'ATLAS accepted identity must match the saved report'; END IF;
      END LOOP;
    ELSE
      SELECT value INTO f FROM jsonb_array_elements(r."reportCanonical"::jsonb->'findings') WHERE value->>'id'=args->>'findingId';
      IF (f IS NOT NULL AND (args->>'action'='REMOVE' AND f->>'reviewResult'='REMOVED'
        OR args->>'action'='RETAIN' AND f->>'reviewResult'<>'REMOVED'
        OR args->>'action'='RETYPE' AND f->>'reviewResult'<>'REMOVED' AND f->>'defectType'=args->>'defectType')) IS NOT TRUE THEN
          RAISE EXCEPTION 'ATLAS accepted finding proposal must match the saved report'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffProposalDecision_authority" BEFORE INSERT ON "StaffProposalDecision"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.proposal_decision_guard();
CREATE FUNCTION atlas_staff.proposal_approval_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
BEGIN
  IF atlas_staff.operator_proposals_pending(NEW."specimenId")>0 THEN RAISE EXCEPTION 'ATLAS machine proposals require human decisions'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffReportApproval_proposals" BEFORE INSERT ON "StaffReportApproval"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.proposal_approval_guard();
COMMIT;
