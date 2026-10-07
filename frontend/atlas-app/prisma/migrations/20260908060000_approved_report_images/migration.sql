BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;
CREATE TABLE "StaffApprovedImage" (
  "approvalId" uuid NOT NULL REFERENCES "StaffReportApproval"(id) ON DELETE RESTRICT,
  side text NOT NULL, "descriptorCanonical" text NOT NULL, "descriptorHash" varchar(64) NOT NULL,
  PRIMARY KEY ("approvalId",side),
  CONSTRAINT "StaffApprovedImage_shape" CHECK ((side IN ('FRONT','BACK') AND octet_length("descriptorCanonical")<=4096
    AND jsonb_typeof("descriptorCanonical"::jsonb)='object'
    AND "descriptorHash"=encode(sha256(convert_to("descriptorCanonical",'UTF8')),'hex')) IS TRUE)
);
CREATE TRIGGER "StaffApprovedImage_immutable" BEFORE UPDATE OR DELETE ON "StaffApprovedImage"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffApprovedImage_no_truncate" BEFORE TRUNCATE ON "StaffApprovedImage"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();

CREATE FUNCTION atlas_staff.staff_approved_image_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,atlas_staff AS $$
DECLARE approval atlas_staff."StaffReportApproval"%ROWTYPE; specimen atlas_staff."StaffSpecimen"%ROWTYPE;
  image atlas_staff."StaffApprovedImage"%ROWTYPE; side_name text; descriptor jsonb;
BEGIN
  IF TG_TABLE_NAME='StaffReportApproval' THEN approval:=NEW;
  ELSE SELECT * INTO approval FROM atlas_staff."StaffReportApproval" WHERE id=NEW."approvalId"; END IF;
  SELECT * INTO specimen FROM atlas_staff."StaffSpecimen" WHERE id=approval."specimenId";
  IF specimen."evidenceHash"<>approval."evidenceHash" OR approval."publicCanonical"::jsonb->'images' IS NULL THEN
    RAISE EXCEPTION 'ATLAS approved images require the exact approved evidence'; END IF;
  FOREACH side_name IN ARRAY ARRAY['FRONT','BACK'] LOOP
    SELECT * INTO image FROM atlas_staff."StaffApprovedImage" WHERE "approvalId"=approval.id AND side=side_name;
    descriptor:=image."descriptorCanonical"::jsonb;
    IF (image."approvalId" IS NOT NULL AND descriptor=specimen."evidenceCanonical"::jsonb->'sides'->side_name
      AND descriptor-'sourceRef'=approval."publicCanonical"::jsonb->'images'->side_name
      AND descriptor->>'sha256' ~ '^[a-f0-9]{64}$' AND (descriptor->>'byteCount')::bigint BETWEEN 1 AND 52428800
      AND (descriptor->>'width')::integer BETWEEN 1 AND 20000 AND (descriptor->>'height')::integer BETWEEN 1 AND 20000
      AND length(descriptor->>'sourceRef') BETWEEN 1 AND 2048
      AND ((approval."publicCanonical"::jsonb->>'mode'='LOCAL_FIXTURE' AND descriptor->>'contentType'='image/svg+xml')
        OR (approval."publicCanonical"::jsonb->>'mode'='PRODUCTION' AND descriptor->>'contentType' IN ('image/webp','image/png','image/jpeg')))
    ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS approved image must bind its preserved exact side'; END IF;
  END LOOP;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER "StaffApprovedImage_binding" AFTER INSERT ON "StaffApprovedImage" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_approved_image_guard();
CREATE CONSTRAINT TRIGGER "StaffReportApproval_images" AFTER INSERT ON "StaffReportApproval" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_approved_image_guard();

CREATE TABLE "PublicMediaControl" (
  id text PRIMARY KEY DEFAULT 'active', enabled boolean NOT NULL DEFAULT false, mode text NOT NULL,
  origin text NOT NULL, "deploymentId" text NOT NULL, "releaseSha" varchar(40) NOT NULL,
  "configHash" varchar(64) NOT NULL, "clientKeyHash" varchar(64) NOT NULL,
  revision integer NOT NULL DEFAULT 1, "updatedAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT "PublicMediaControl_shape" CHECK (id='active' AND revision>0 AND mode='PRODUCTION'
    AND origin ~ '^https://[a-z0-9.-]+$' AND "deploymentId" ~ '^[a-z0-9-]+\.vercel\.app$'
    AND "releaseSha" ~ '^[a-f0-9]{40}$' AND "configHash" ~ '^[a-f0-9]{64}$' AND "clientKeyHash" ~ '^[a-f0-9]{64}$')
);
CREATE TRIGGER "PublicMediaControl_guard" BEFORE UPDATE ON "PublicMediaControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.public_reader_control_guard();
CREATE TRIGGER "PublicMediaControl_immutable" BEFORE DELETE ON "PublicMediaControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "PublicMediaControl_no_truncate" BEFORE TRUNCATE ON "PublicMediaControl"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();
REVOKE ALL ON "StaffApprovedImage","PublicMediaControl" FROM PUBLIC;

-- Approved descriptors are a server port, never an HTTP response. The public
-- serving role still has no table privileges and cannot select other columns.
CREATE FUNCTION atlas_staff.read_approved_image(token text, requested_version integer, requested_side text, deployment text, release text, configuration text)
  RETURNS TABLE(canonical text,digest text,public_hash text,mode text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE packet record;
BEGIN
  SELECT * INTO packet FROM atlas_staff.read_approved_report(token,requested_version,deployment,release,configuration);
  IF packet.canonical IS NULL OR requested_version IS NULL OR requested_side NOT IN ('FRONT','BACK') THEN RETURN; END IF;
  RETURN QUERY SELECT i."descriptorCanonical",i."descriptorHash"::text,a."publicHash"::text,a."publicCanonical"::jsonb->>'mode'
    FROM atlas_staff."StaffPublicReport" p JOIN atlas_staff."StaffReportApproval" a ON a."specimenId"=p."specimenId"
    JOIN atlas_staff."StaffApprovedImage" i ON i."approvalId"=a.id
    WHERE p."publicToken"=token AND a.version=requested_version AND i.side=requested_side AND a."publicHash"=packet.digest;
END; $$;
REVOKE ALL ON FUNCTION atlas_staff.read_approved_image(text,integer,text,text,text,text) FROM PUBLIC;

CREATE FUNCTION atlas_staff.read_approved_trace(token text, requested_version integer, finding_id text, deployment text, release text, configuration text)
  RETURNS TABLE(trace text,public_hash text,side text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE packet record;
BEGIN
  SELECT * INTO packet FROM atlas_staff.read_approved_report(token,requested_version,deployment,release,configuration);
  IF packet.canonical IS NULL OR requested_version IS NULL OR finding_id IS NULL OR length(finding_id) NOT BETWEEN 1 AND 180 THEN RETURN; END IF;
  RETURN QUERY SELECT (finding->'finalTrace')::text,a."publicHash"::text,finding->>'side'
    FROM atlas_staff."StaffPublicReport" p JOIN atlas_staff."StaffReportApproval" a ON a."specimenId"=p."specimenId"
    JOIN atlas_staff."StaffAnalysisRevision" analysis ON analysis."specimenId"=a."specimenId" AND analysis.revision=a."analysisRevision"
    CROSS JOIN LATERAL jsonb_array_elements(analysis."sourceCanonical"::jsonb->'reviewedDefects') finding
    WHERE p."publicToken"=token AND a.version=requested_version AND a."publicHash"=packet.digest AND analysis."sourceHash"=a."analysisHash"
      AND finding->>'id'=finding_id AND jsonb_typeof(finding->'finalTrace')='object'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(packet.canonical::jsonb->'report'->'findings') approved
        WHERE approved->>'id'=finding_id AND approved->>'side'=finding->>'side'
          AND approved->>'traceSha256'=finding->'finalTrace'->>'sha256'
          AND approved->>'reviewResult' IN ('ACCEPTED','SMART_MARKED','TYPE_CORRECTED'));
END; $$;
REVOKE ALL ON FUNCTION atlas_staff.read_approved_trace(text,integer,text,text,text,text) FROM PUBLIC;
COMMIT;
