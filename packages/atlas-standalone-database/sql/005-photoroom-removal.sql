-- Photoroom Plus cutover. Preserve all image rows, receipts and bindings.
-- This migration changes admission only; it neither reprocesses old images nor
-- adopts late OpenAI output. The successor runtime terminalizes unfinished old
-- jobs and retains late receipts, selecting the existing per-side originals.
CREATE OR REPLACE FUNCTION atlas_manual_connected.retry_report_image(
 p_actor uuid,p_access integer,p_retry uuid,p_card uuid,p_upload uuid,p_side text,
 p_job text,p_failed uuid,p_recipe text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
DECLARE c atlas_manual_intake.card; j atlas_manual_connected.report_image_job;
 prior jsonb;
BEGIN
 IF p_actor IS NULL OR p_access IS NULL OR p_retry IS NULL OR p_card IS NULL OR p_upload IS NULL OR p_failed IS NULL
 OR NOT COALESCE(p_side IN('FRONT','BACK') AND p_job ~ '^[a-f0-9]{64}$' AND p_recipe ~ '^[a-f0-9]{64}$',false)
 THEN RAISE EXCEPTION 'REPORT_IMAGE_RETRY_INVALID'; END IF;
 SELECT * INTO c FROM atlas_manual_intake.card WHERE id=p_card;
 IF c.id IS NULL OR c.owner_id<>p_actor
 OR NOT EXISTS(SELECT 1 FROM atlas_staff."StaffIdentity" s WHERE s.id=p_actor AND s.role='REVIEWER' AND s."revokedAt" IS NULL AND s."accessVersion"=p_access)
 OR EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=p_card)
 THEN RAISE EXCEPTION 'REPORT_IMAGE_RETRY_ACCESS_DENIED'; END IF;
 SELECT j0.* INTO j FROM atlas_manual_connected.report_image_job j0
 JOIN atlas_manual_connected.card_image_binding b ON b.job_key=j0.key AND b.card_id=p_card AND b.upload_id=p_upload AND b.side=p_side
 JOIN atlas_manual_connected.card_image_intent i ON i.upload_id=b.upload_id AND i.card_id=b.card_id AND i.mode=j0.mode
 JOIN atlas_manual_intake.upload u ON u.id=b.upload_id AND u.card_id=b.card_id AND u.side=b.side
 WHERE j0.key=p_job AND j0.source_card_id=p_card AND j0.recipe_hash=p_recipe AND u.source IS NOT NULL
 AND p_upload=CASE p_side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND b.original_sha256=u.plan::jsonb->'expected'->>'sha256'
 AND j0.source_media::jsonb->'original'->>'uploadId'=p_upload::text
 AND j0.source_media::jsonb->'original'->'binding'->>'cardId'=p_card::text
 AND j0.source_media::jsonb->'original'->'binding'->>'side'=p_side
 AND j0.source_media::jsonb->'frame'->'raster'->'content'->>'sha256'=j0.source_hash
 AND encode(sha256(convert_to(j0.source_media,'UTF8')),'hex')=j0.source_media_hash
 AND encode(sha256(convert_to(j0.recipe,'UTF8')),'hex')=j0.recipe_hash
;
 IF j.key IS NULL THEN RAISE EXCEPTION 'REPORT_IMAGE_RETRY_UNAVAILABLE'; END IF;
 -- Historical compatibility is receipt-only. No new retry intent or dispatch
 -- is available, including to callers holding the former function grant.
 SELECT e.value INTO prior FROM jsonb_array_elements(j.audit) e(value)
 WHERE e.value->>'event'='RETRY_REQUESTED' AND e.value->>'requestId'=p_retry::text;
 IF prior IS NOT NULL THEN
  IF prior->>'actorId' IS DISTINCT FROM p_actor::text OR prior->>'cardId' IS DISTINCT FROM p_card::text
   OR prior->>'uploadId' IS DISTINCT FROM p_upload::text OR prior->>'side' IS DISTINCT FROM p_side
   OR prior->>'jobKey' IS DISTINCT FROM p_job OR prior->>'failedRequestId' IS DISTINCT FROM p_failed::text
   OR prior->>'recipeHash' IS DISTINCT FROM p_recipe
  THEN RAISE EXCEPTION 'REPORT_IMAGE_RETRY_CONFLICT'; END IF;
  RETURN prior;
 END IF;
 RAISE EXCEPTION 'REPORT_IMAGE_RETRY_UNAVAILABLE';
END $function$;
REVOKE ALL ON FUNCTION atlas_manual_connected.retry_report_image(uuid,integer,uuid,uuid,uuid,text,text,uuid,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION atlas_manual_connected.report_image_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Presentation image audit is retained'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.recipe::jsonb->>'execution' IS DISTINCT FROM 'PHOTOROOM_PLUS_API'
   OR NEW.state<>'QUEUED' OR NEW.attempts<>0 OR NEW.result IS NOT NULL OR NEW.result_hash IS NOT NULL
   OR NEW.claim_id IS NOT NULL OR NEW.lease_until IS NOT NULL OR NEW.audit<>'[]'::jsonb
  THEN RAISE EXCEPTION 'REPORT_IMAGE_PROVIDER_RETIRED_OR_ADMISSION_INVALID'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.key,NEW.source_hash,NEW.recipe_hash,NEW.recipe,NEW.mode,NEW.source_card_id,NEW.source_media,NEW.source_media_hash,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.key,OLD.source_hash,OLD.recipe_hash,OLD.recipe,OLD.mode,OLD.source_card_id,OLD.source_media,OLD.source_media_hash,OLD.created_at)
  OR NEW.attempts<OLD.attempts
  OR OLD.state IN('READY','FAILED','UNKNOWN')
    AND (to_jsonb(NEW)-ARRAY['audit','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['audit','updated_at'])
  OR jsonb_array_length(NEW.audit)<jsonb_array_length(OLD.audit)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.audit) WITH ORDINALITY a(value,n) WHERE NEW.audit->(a.n::integer-1) IS DISTINCT FROM a.value)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.audit) WITH ORDINALITY a(value,n)
    WHERE a.n>jsonb_array_length(OLD.audit) AND a.value->>'event'='RETRY_REQUESTED')
 THEN RAISE EXCEPTION 'Presentation image identity and receipts are immutable'; END IF;
 -- Old jobs may retain a response and become a terminal original fallback;
 -- they cannot acquire a claim, dispatch again, or publish a late result.
 IF OLD.recipe::jsonb->>'execution' IS DISTINCT FROM 'PHOTOROOM_PLUS_API' AND (
  NEW.result IS DISTINCT FROM OLD.result OR NEW.result_hash IS DISTINCT FROM OLD.result_hash
  OR NEW.attempts<>OLD.attempts
  OR NEW.state NOT IN('FAILED','UNKNOWN')
    AND (to_jsonb(NEW)-ARRAY['audit','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['audit','updated_at'])
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.audit) WITH ORDINALITY a(value,n)
    WHERE a.n>jsonb_array_length(OLD.audit) AND a.value->>'event' IN('REQUESTED','READY'))
 ) THEN RAISE EXCEPTION 'REPORT_IMAGE_PROVIDER_RETIRED'; END IF;
 RETURN NEW;
END $function$;

CREATE TRIGGER report_image_provider_admission BEFORE INSERT ON atlas_manual_connected.report_image_job
 FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.report_image_guard();
REVOKE ALL ON FUNCTION atlas_manual_connected.report_image_guard() FROM PUBLIC;
