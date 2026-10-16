-- A living card may explicitly resume shared public reference work after a
-- definite credit refusal, independent of the original physical submission.
-- Prior requests, responses, retry intents and guards remain immutable.
CREATE OR REPLACE FUNCTION atlas_manual_connected.retry_variant_labels(
 p_actor uuid, p_retry_id uuid, p_card uuid, p_job_key text, p_source_hash text,
 p_identity_revision integer, p_identity_hash text, p_catalog_hash text,
 p_failed_attempt_key text, p_failed_response_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
DECLARE c atlas_manual.card; j atlas_manual_connected.variant_job;
 d atlas_manual_connected.variant_catalog_cache; p atlas_manual_connected.variant_catalog_cache;
 old_intent atlas_manual_connected.variant_catalog_cache;
 body jsonb; dispatch jsonb; response jsonb; envelope jsonb; saved text; key_base text;
 intent_key text:='variant-label-retry:v1:'||p_retry_id::text;
 next_key text:='variant-label-retry-next:v1:'||p_failed_attempt_key;
BEGIN
 IF p_actor IS NULL OR p_retry_id IS NULL OR p_card IS NULL OR p_identity_revision IS NULL OR p_identity_revision<1
 OR NOT COALESCE(p_job_key ~ '^[a-f0-9]{64}$' AND p_source_hash ~ '^[a-f0-9]{64}$'
 AND p_identity_hash ~ '^[a-f0-9]{64}$' AND p_catalog_hash ~ '^[a-f0-9]{64}$'
 AND p_failed_response_hash ~ '^[a-f0-9]{64}$'
 AND p_failed_attempt_key ~ '^variant-label-(source:v1:[a-f0-9]{64}|attempt:v1:[a-f0-9-]{36})$',false)
 THEN RAISE EXCEPTION 'VARIANT_LABEL_RETRY_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-variant-preparation:'||p_card::text,721931));
 SELECT * INTO c FROM atlas_manual.card WHERE id=p_card FOR UPDATE;
 IF c.id IS NULL OR NOT(p_actor=c.owner_id OR p_actor=ANY(c.editors))
 OR NOT EXISTS(SELECT 1 FROM atlas_staff."StaffIdentity" s WHERE s.id=p_actor AND s.role='REVIEWER' AND s."revokedAt" IS NULL)
 OR EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card WHERE card_id=p_card)
 THEN RAISE EXCEPTION 'VARIANT_LABEL_RETRY_ACCESS_DENIED'; END IF;
 -- Historical acknowledgement never transitions a job again.
 IF (SELECT count(*) FROM atlas_manual_connected.variant_catalog_cache WHERE key=intent_key)>1 THEN RAISE EXCEPTION 'VARIANT_LABEL_RETRY_CONFLICT'; END IF;
 SELECT * INTO old_intent FROM atlas_manual_connected.variant_catalog_cache WHERE key=intent_key;
 IF old_intent.key IS NOT NULL THEN
  envelope:=old_intent.snapshot::jsonb;
  IF envelope->>'actorId' IS DISTINCT FROM p_actor::text OR envelope->>'cardId' IS DISTINCT FROM p_card::text
   OR envelope->>'jobKey' IS DISTINCT FROM p_job_key OR envelope->>'sourceHash' IS DISTINCT FROM p_source_hash
   OR (envelope->>'identityRevision')::integer IS DISTINCT FROM p_identity_revision OR envelope->>'identityHash' IS DISTINCT FROM p_identity_hash
   OR envelope->>'catalogHash' IS DISTINCT FROM p_catalog_hash OR envelope->>'failedRequestKey' IS DISTINCT FROM p_failed_attempt_key
   OR envelope->>'failedResponseHash' IS DISTINCT FROM p_failed_response_hash
   OR NOT EXISTS(SELECT 1 FROM atlas_manual_connected.variant_catalog_cache WHERE key=next_key AND snapshot=old_intent.snapshot AND snapshot_hash=old_intent.snapshot_hash)
  THEN RAISE EXCEPTION 'VARIANT_LABEL_RETRY_CONFLICT'; END IF;
  RETURN envelope;
 END IF;
 SELECT * INTO j FROM atlas_manual_connected.variant_job WHERE key=p_job_key AND card_id=p_card FOR UPDATE;
 IF j.key IS NULL OR j.state<>'FAILED' OR j.catalog IS NULL OR j.result IS NOT NULL OR j.response IS NOT NULL OR j.dispatch_id IS NOT NULL
 OR j.source_hash<>p_source_hash OR j.identity_revision<>p_identity_revision OR j.identity_hash<>p_identity_hash OR j.catalog_hash<>p_catalog_hash
 OR c.owner_id<>j.actor_id OR NOT atlas_manual_connected.display_owner_current(j.actor_id,j.access_version)
 OR c.content::jsonb->'source'->>'sourceHash' IS DISTINCT FROM p_source_hash
 OR (c.content::jsonb->>'identityRevision')::integer IS DISTINCT FROM p_identity_revision
 OR encode(sha256(convert_to(atlas_customer.commerce_canonical(c.content::jsonb->'identity'),'UTF8')),'hex') IS DISTINCT FROM p_identity_hash
 OR j.catalog::jsonb->>'snapshotHash' IS DISTINCT FROM p_catalog_hash
 OR j.catalog::jsonb->'problems' ? 'REFERENCE_ACQUISITION_PENDING'
 OR EXISTS(SELECT 1 FROM atlas_manual_connected.variant_job v WHERE v.card_id=p_card AND v.source_hash=j.source_hash AND v.identity_revision=j.identity_revision AND (v.created_at,v.key)>(j.created_at,j.key))
 THEN RAISE EXCEPTION 'VARIANT_LABEL_RETRY_UNAVAILABLE'; END IF;
 -- Serialize with the worker's immutable request journal before reserving a successor.
 IF (SELECT count(*) FROM atlas_manual_connected.variant_catalog_cache WHERE key='variant-label-dispatch:v1:'||p_failed_attempt_key)<>1
 OR (SELECT count(*) FROM atlas_manual_connected.variant_catalog_cache WHERE key='variant-label-response:v1:'||p_failed_attempt_key)<>1
 THEN RAISE EXCEPTION 'VARIANT_LABEL_RETRY_EVIDENCE_INVALID'; END IF;
 SELECT * INTO d FROM atlas_manual_connected.variant_catalog_cache WHERE key='variant-label-dispatch:v1:'||p_failed_attempt_key;
 SELECT * INTO p FROM atlas_manual_connected.variant_catalog_cache WHERE key='variant-label-response:v1:'||p_failed_attempt_key;
 dispatch:=d.snapshot::jsonb; response:=p.snapshot::jsonb; key_base:=dispatch->'request'->>'requestKey';
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-listing-source:'||key_base,721930));
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-listing-source:'||p_failed_attempt_key,721930));
 body:=(response->>'bodyText')::jsonb;
 IF NOT COALESCE(p.snapshot_hash=p_failed_response_hash AND response->>'schemaVersion'='variant-label-response/v1'
 AND response->>'reservationHash'=d.snapshot_hash AND response->'httpStatus'='429'::jsonb
 AND jsonb_typeof(body)='object' AND body-ARRAY['error']='{}'::jsonb AND jsonb_typeof(body->'error')='object'
 AND body->'error'->>'code'='credit_balance_exhausted'
 AND dispatch->>'schemaVersion'='variant-label-dispatch/v1'
 AND COALESCE(dispatch->>'attemptKey',key_base)=p_failed_attempt_key
 AND key_base='variant-label-source:v1:'||encode(sha256(convert_to(atlas_customer.commerce_canonical((dispatch->'request')-'requestKey'),'UTF8')),'hex')
 AND response->>'version'=dispatch->'evidence'->>'policy'
 AND response->'requestEvidence'=dispatch->'evidence'
 AND dispatch->'evidence'->>'policy'='atlas-slab-label-association-v1'
 AND dispatch->'request'->>'policy'='atlas-slab-label-association-v1'
 AND dispatch->'evidence'->>'model'='gpt-6-astra' AND dispatch->'request'->>'model'='gpt-6-astra'
 AND dispatch->'evidence'->'request'=dispatch->'request'
 AND dispatch->'evidence'->>'requestSha256' ~ '^[a-f0-9]{64}$'
 AND jsonb_array_length(dispatch->'request'->'photos') BETWEEN 1 AND 8
 -- The complete historical packet can have different catalog choices or
 -- additional public photos. At least one current saved photo must reference
 -- its original immutable shared reservation; arbitrary foreign failures are
 -- not retry authority. The worker reproduces the exact retained request SHA.
 AND ((dispatch->>'jobKey'=p_job_key AND dispatch->'catalog'->'demandKey'=j.catalog::jsonb->'demandKey'
   AND dispatch->'catalog'->'candidates'=j.catalog::jsonb->'candidates'
   AND (j.catalog::jsonb->'referencePhotos') @> (dispatch->'catalog'->'referencePhotos'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(j.catalog::jsonb->'referencePhotos') current_photo
   JOIN jsonb_array_elements(dispatch->'request'->'photos') prior_photo ON current_photo->>'sha256'=prior_photo->>'sha256'
   JOIN atlas_manual_connected.variant_catalog_cache shared ON shared.key='atlas-codex-reservation:v1:atlas-codex-reading:v1:'||
     encode(sha256(convert_to(atlas_customer.commerce_canonical(jsonb_build_object('policy',dispatch->'request'->>'policy',
       'model',dispatch->'request'->>'model','sha256',prior_photo->>'sha256')),'UTF8')),'hex')
     AND shared.snapshot::jsonb->>'schemaVersion'='atlas-codex-reservation/v1'
     AND shared.snapshot::jsonb->>'requestKey'=key_base)),false)
 THEN RAISE EXCEPTION 'VARIANT_LABEL_RETRY_EVIDENCE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM atlas_manual_connected.variant_catalog_cache WHERE key=next_key OR key IN(
 'variant-label-dispatch:v1:variant-label-attempt:v1:'||p_retry_id::text,
 'variant-label-response:v1:variant-label-attempt:v1:'||p_retry_id::text))
 THEN RAISE EXCEPTION 'VARIANT_LABEL_RETRY_CONFLICT'; END IF;
 envelope:=jsonb_build_object('schemaVersion','variant-label-retry/v1','requestId',p_retry_id,'jobKey',p_job_key,'cardId',p_card,'actorId',p_actor,
 'sourceHash',p_source_hash,'identityRevision',p_identity_revision,'identityHash',p_identity_hash,'catalogHash',p_catalog_hash,
 'failedRequestKey',p_failed_attempt_key,'failedResponseHash',p_failed_response_hash,'attemptKey','variant-label-attempt:v1:'||p_retry_id::text,'requestKey',key_base);
 saved:=atlas_customer.commerce_canonical(envelope);
 INSERT INTO atlas_manual_connected.variant_catalog_cache(key,snapshot,snapshot_hash,expires_at)
 SELECT k,saved,encode(sha256(convert_to(saved,'UTF8')),'hex'),'2000-01-01'::timestamptz FROM unnest(ARRAY[intent_key,next_key]) k;
 UPDATE atlas_manual_connected.variant_job SET state='QUEUED',code='VARIANT_LABEL_RETRY_REQUESTED',available_at=clock_timestamp(),updated_at=clock_timestamp(),
 audit=audit||jsonb_build_array(jsonb_build_object('event','LABEL_RETRY_REQUESTED','requestId',p_retry_id,'failedRequestKey',p_failed_attempt_key,
 'failedResponseHash',p_failed_response_hash,'attemptKey',envelope->>'attemptKey','catalogHash',p_catalog_hash)) WHERE key=p_job_key;
 RETURN envelope;
END $function$;
REVOKE ALL ON FUNCTION atlas_manual_connected.retry_variant_labels(uuid,uuid,uuid,text,text,integer,text,text,text,text) FROM PUBLIC;

