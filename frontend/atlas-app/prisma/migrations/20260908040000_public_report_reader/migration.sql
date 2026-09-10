BEGIN;
SET LOCAL search_path TO atlas_staff,pg_catalog;
CREATE TABLE "PublicReaderControl" (
  id text PRIMARY KEY DEFAULT 'active', enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL, origin text NOT NULL, "deploymentId" text NOT NULL,
  "releaseSha" varchar(40) NOT NULL, "configHash" varchar(64) NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  "updatedAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT "PublicReaderControl_shape" CHECK ((id='active' AND revision>0
    AND "releaseSha" ~ '^[a-f0-9]{40}$' AND "configHash" ~ '^[a-f0-9]{64}$'
    AND ((mode='PRODUCTION' AND origin='https://atlasgrading.com' AND "deploymentId" ~ '^[a-z0-9-]+\.vercel\.app$')
      OR (mode='LOCAL_FIXTURE' AND origin='http://127.0.0.1:4319' AND "deploymentId"='local-public-fixture'))
  ) IS TRUE)
);
CREATE FUNCTION atlas_staff.public_reader_control_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'ATLAS public activation changes must advance their revision'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "PublicReaderControl_revision" BEFORE UPDATE ON "PublicReaderControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.public_reader_control_guard();
CREATE TRIGGER "PublicReaderControl_no_delete" BEFORE DELETE ON "PublicReaderControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "PublicReaderControl_no_truncate" BEFORE TRUNCATE ON "PublicReaderControl"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();
REVOKE ALL ON TABLE "PublicReaderControl" FROM PUBLIC;

-- This is the entire public database port. No private draft, media key, identity,
-- assignment, auth session, learning material, legacy card or write is exposed.
CREATE FUNCTION atlas_staff.read_approved_report(token text, requested_version integer, deployment text, release text, configuration text)
  RETURNS TABLE(canonical text, digest text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE control atlas_staff."PublicReaderControl"%ROWTYPE;
BEGIN
  SELECT * INTO control FROM atlas_staff."PublicReaderControl" WHERE id='active' FOR SHARE;
  IF (control.enabled AND control."deploymentId"=deployment AND control."releaseSha"=release
    AND control."configHash"=configuration) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS public reports are not enabled'; END IF;
  IF token IS NULL OR token !~ '^ar_[A-Za-z0-9_-]{24}$' OR requested_version<1 THEN RETURN; END IF;
  RETURN QUERY SELECT a."publicCanonical",a."publicHash"::text
    FROM atlas_staff."StaffPublicReport" p JOIN atlas_staff."StaffReportApproval" a ON a."specimenId"=p."specimenId"
    WHERE p."publicToken"=token AND ((requested_version IS NULL AND a.id=p."currentApprovalId") OR a.version=requested_version)
      AND a."publicCanonical"::jsonb->>'mode'=control.mode
      AND a."publicCanonical"::jsonb->>'publicToken'=p."publicToken"
      AND a."publicCanonical"::jsonb->>'reportNumber'=p."reportNumber"
      AND (a."publicCanonical"::jsonb->>'approvalVersion')::integer=a.version;
END; $$;
REVOKE ALL ON FUNCTION atlas_staff.read_approved_report(text,integer,text,text,text) FROM PUBLIC;
COMMIT;
