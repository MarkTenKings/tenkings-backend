-- Additive, optional presentation only. No mutation of originals or reports.
-- Runtime remains disabled until the release owner applies narrow serving grants.
CREATE TABLE atlas_manual_connected.report_image_job (
 key text PRIMARY KEY CHECK(key ~ '^[a-f0-9]{64}$'),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 recipe_hash text NOT NULL CHECK(recipe_hash ~ '^[a-f0-9]{64}$'), recipe text NOT NULL,
 mode text NOT NULL CHECK(mode IN('LOCAL_FIXTURE','PRODUCTION')),
 source_card_id uuid NOT NULL REFERENCES atlas_manual_intake.card(id), source_media text NOT NULL, source_media_hash text NOT NULL,
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN('QUEUED','RUNNING','REQUESTED','READY','FAILED','UNKNOWN')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 6), claim_id uuid, lease_until timestamptz,
 result text, result_hash text, code text CHECK(code ~ '^[A-Z][A-Z0-9_]{0,100}$'),
 audit jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(audit)='array' AND jsonb_array_length(audit)<=20 AND octet_length(audit::text)<=65536),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(source_hash,recipe_hash),
 CHECK(octet_length(recipe)<=8192 AND jsonb_typeof(recipe::jsonb)='object' AND recipe_hash=encode(sha256(convert_to(recipe,'UTF8')),'hex')),
 CHECK(octet_length(source_media)<=32768 AND jsonb_typeof(source_media::jsonb)='object' AND source_media_hash=encode(sha256(convert_to(source_media,'UTF8')),'hex')
   AND source_media::jsonb->'descriptor'->'raster'->'content'->>'sha256'=source_hash),
 CHECK((state IN('RUNNING','REQUESTED'))=(claim_id IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(state IN('RUNNING','REQUESTED') OR (claim_id IS NULL AND lease_until IS NULL)),
 CHECK((state='READY')=(result IS NOT NULL AND result_hash IS NOT NULL)),
 CHECK(result IS NULL OR (octet_length(result)<=65536 AND jsonb_typeof(result::jsonb)='object' AND result_hash=encode(sha256(convert_to(result,'UTF8')),'hex')))
);
CREATE INDEX report_image_pending ON atlas_manual_connected.report_image_job(available_at,key) WHERE state IN('QUEUED','RUNNING','REQUESTED');
CREATE TABLE atlas_manual_connected.report_image_binding (
 card_id uuid NOT NULL,action_id uuid NOT NULL,side text NOT NULL CHECK(side IN('FRONT','BACK')),
 manifest_hash text NOT NULL CHECK(manifest_hash ~ '^[a-f0-9]{64}$'),job_key text NOT NULL REFERENCES atlas_manual_connected.report_image_job(key),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(card_id,action_id,side),
 FOREIGN KEY(card_id,action_id) REFERENCES atlas_manual.publication(card_id,action_id)
);
CREATE INDEX report_image_binding_job ON atlas_manual_connected.report_image_binding(job_key);
REVOKE ALL ON atlas_manual_connected.report_image_job,atlas_manual_connected.report_image_binding FROM PUBLIC;
CREATE FUNCTION atlas_manual_connected.report_image_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Presentation image audit is retained'; END IF;
 IF ROW(NEW.key,NEW.source_hash,NEW.recipe_hash,NEW.recipe,NEW.mode,NEW.source_card_id,NEW.source_media,NEW.source_media_hash,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.key,OLD.source_hash,OLD.recipe_hash,OLD.recipe,OLD.mode,OLD.source_card_id,OLD.source_media,OLD.source_media_hash,OLD.created_at)
  OR NEW.attempts<OLD.attempts OR OLD.state IN('READY','FAILED','UNKNOWN')
    AND (to_jsonb(NEW)-ARRAY['audit','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['audit','updated_at'])
  OR jsonb_array_length(NEW.audit)<jsonb_array_length(OLD.audit)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.audit) WITH ORDINALITY a(value,n) WHERE NEW.audit->(a.n::integer-1) IS DISTINCT FROM a.value)
 THEN RAISE EXCEPTION 'Presentation image identity and receipts are immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER report_image_guard BEFORE UPDATE OR DELETE ON atlas_manual_connected.report_image_job FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.report_image_guard();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual_connected.report_image_binding FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual_connected.report_image_job FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual_connected.report_image_binding FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();
REVOKE ALL ON FUNCTION atlas_manual_connected.report_image_guard() FROM PUBLIC;
