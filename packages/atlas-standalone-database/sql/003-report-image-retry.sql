-- Explicit, current-upload recovery of one definite Images API rejection.
-- Keep the original source, recipe, monotonically increasing attempts and audit.
-- The former six-attempt/20-event checks were lifetime limits. Retain every
-- event across human-authorized retries; the worker bounds each allowance.
ALTER TABLE atlas_manual_connected.report_image_job DROP CONSTRAINT report_image_job_attempts_check;
ALTER TABLE atlas_manual_connected.report_image_job ADD CONSTRAINT report_image_job_attempts_check CHECK(attempts>=0);
ALTER TABLE atlas_manual_connected.report_image_job DROP CONSTRAINT report_image_job_audit_check;
ALTER TABLE atlas_manual_connected.report_image_job ADD CONSTRAINT report_image_job_audit_check CHECK(jsonb_typeof(audit)='array');
CREATE FUNCTION atlas_manual_connected.retry_report_image(
 p_actor uuid,p_access integer,p_retry uuid,p_card uuid,p_upload uuid,p_side text,
 p_job text,p_failed uuid,p_recipe text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
DECLARE c atlas_manual_intake.card; j atlas_manual_connected.report_image_job;
 prior jsonb; failure jsonb; response jsonb; request jsonb; receipt jsonb; envelope jsonb;
BEGIN
 IF p_actor IS NULL OR p_access IS NULL OR p_retry IS NULL OR p_card IS NULL OR p_upload IS NULL OR p_failed IS NULL
 OR NOT COALESCE(p_side IN('FRONT','BACK') AND p_job ~ '^[a-f0-9]{64}$' AND p_recipe ~ '^[a-f0-9]{64}$',false)
 THEN RAISE EXCEPTION 'REPORT_IMAGE_RETRY_INVALID'; END IF;
 SELECT * INTO c FROM atlas_manual_intake.card WHERE id=p_card FOR UPDATE;
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
 FOR UPDATE OF j0;
 IF j.key IS NULL THEN RAISE EXCEPTION 'REPORT_IMAGE_RETRY_UNAVAILABLE'; END IF;
 -- Repeating the exact command only acknowledges its retained intent. It
 -- cannot reset work already dispatched, completed or rejected again.
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
 IF j.state<>'FAILED' OR j.code IS DISTINCT FROM 'REPORT_IMAGE_REQUEST_REJECTED' OR j.result IS NOT NULL OR j.result_hash IS NOT NULL
 OR j.claim_id IS NOT NULL OR j.lease_until IS NOT NULL
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(j.audit) e(value) WHERE e.value->>'event'='RETRY_REQUESTED' AND e.value->>'failedRequestId'=p_failed::text)
 THEN RAISE EXCEPTION 'REPORT_IMAGE_RETRY_UNAVAILABLE'; END IF;
 failure:=j.audit->-1;
 SELECT e.value INTO request FROM jsonb_array_elements(j.audit) WITH ORDINALITY e(value,n)
 WHERE e.value->>'event'='REQUESTED' ORDER BY e.n DESC LIMIT 1;
 IF (SELECT count(*) FROM jsonb_array_elements(j.audit) e(value) WHERE e.value->>'event'='REQUESTED' AND e.value->>'requestId'=p_failed::text)<>1
 OR (SELECT count(*) FROM jsonb_array_elements(j.audit) e(value) WHERE e.value->>'event'='RESPONSE' AND e.value->>'requestId'=p_failed::text)<>1
 THEN RAISE EXCEPTION 'REPORT_IMAGE_RETRY_EVIDENCE_INVALID'; END IF;
 SELECT e.value INTO response FROM jsonb_array_elements(j.audit) e(value)
 WHERE e.value->>'event'='RESPONSE' AND e.value->>'requestId'=p_failed::text;
 receipt:=response->'receipt';
 IF NOT COALESCE(request->>'requestId'=p_failed::text AND failure->>'event'='FAILED' AND failure->>'requestId'=p_failed::text
 AND failure->>'code'='REPORT_IMAGE_REQUEST_REJECTED' AND failure->'receipt'=receipt
 AND receipt->'status'='400'::jsonb AND receipt->>'clientRequestId'=p_failed::text
 AND receipt->>'sourceSha256'=j.source_hash AND receipt->>'recipeHash'=j.recipe_hash
 AND receipt->>'execution'='OPENAI_IMAGES_API' AND receipt->>'execution'=j.recipe::jsonb->>'execution'
 AND receipt->>'model'=j.recipe::jsonb->>'model' AND receipt->>'promptVersion'=j.recipe::jsonb->>'promptVersion'
 AND receipt->>'promptSha256'=encode(sha256(convert_to(j.recipe::jsonb->>'prompt','UTF8')),'hex')
 AND NOT(receipt ?| ARRAY['outputSha256','byteCount','usage']),false)
 THEN RAISE EXCEPTION 'REPORT_IMAGE_RETRY_EVIDENCE_INVALID'; END IF;
 envelope:=jsonb_build_object('event','RETRY_REQUESTED','schemaVersion','atlas-report-image-retry-v1',
 'actorId',p_actor,'requestId',p_retry,'cardId',p_card,'uploadId',p_upload,'side',p_side,'jobKey',p_job,
 'failedRequestId',p_failed,'sourceSha256',j.source_hash,'recipeHash',j.recipe_hash,'attemptBase',j.attempts,
 'failedReceiptHash',encode(sha256(convert_to(atlas_customer.commerce_canonical(receipt),'UTF8')),'hex'));
 UPDATE atlas_manual_connected.report_image_job SET state='QUEUED',code='REPORT_IMAGE_RETRY_REQUESTED',available_at=clock_timestamp(),
 updated_at=clock_timestamp(),audit=audit||jsonb_build_array(envelope) WHERE key=p_job;
 RETURN envelope;
END $function$;
REVOKE ALL ON FUNCTION atlas_manual_connected.retry_report_image(uuid,integer,uuid,uuid,uuid,text,text,uuid,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION atlas_manual_connected.report_image_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog'
AS $function$
DECLARE retry boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Presentation image audit is retained'; END IF;
 retry:=COALESCE(OLD.state='FAILED' AND OLD.code='REPORT_IMAGE_REQUEST_REJECTED' AND NEW.state='QUEUED' AND NEW.code='REPORT_IMAGE_RETRY_REQUESTED'
  AND current_user=pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='atlas_manual_connected.retry_report_image(uuid,integer,uuid,uuid,uuid,text,text,uuid,text)'::regprocedure))
  AND jsonb_array_length(NEW.audit)=jsonb_array_length(OLD.audit)+1
  AND NEW.audit->-1->>'event'='RETRY_REQUESTED' AND NEW.audit->-1->>'jobKey'=OLD.key
  AND NEW.audit->-1->>'failedRequestId'=OLD.audit->-1->>'requestId' AND NEW.audit->-1->'attemptBase'=to_jsonb(OLD.attempts)
  AND (to_jsonb(NEW)-ARRAY['state','code','available_at','updated_at','audit'])=(to_jsonb(OLD)-ARRAY['state','code','available_at','updated_at','audit']),false);
 IF ROW(NEW.key,NEW.source_hash,NEW.recipe_hash,NEW.recipe,NEW.mode,NEW.source_card_id,NEW.source_media,NEW.source_media_hash,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.key,OLD.source_hash,OLD.recipe_hash,OLD.recipe,OLD.mode,OLD.source_card_id,OLD.source_media,OLD.source_media_hash,OLD.created_at)
  OR NEW.attempts<OLD.attempts OR OLD.state IN('READY','FAILED','UNKNOWN') AND NOT retry
    AND (to_jsonb(NEW)-ARRAY['audit','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['audit','updated_at'])
  OR jsonb_array_length(NEW.audit)<jsonb_array_length(OLD.audit)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.audit) WITH ORDINALITY a(value,n) WHERE NEW.audit->(a.n::integer-1) IS DISTINCT FROM a.value)
  OR NOT retry AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.audit) WITH ORDINALITY a(value,n)
    WHERE a.n>jsonb_array_length(OLD.audit) AND a.value->>'event'='RETRY_REQUESTED')
 THEN RAISE EXCEPTION 'Presentation image identity and receipts are immutable'; END IF;
 RETURN NEW;
END $function$;
