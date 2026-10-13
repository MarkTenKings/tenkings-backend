-- Append-only, explicit retry of one definitely rejected Astra label attempt.
-- The sealed standalone baseline and every original request/response remain unchanged.
CREATE FUNCTION atlas_manual_connected.retry_variant_labels(
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
 AND dispatch->>'schemaVersion'='variant-label-dispatch/v1' AND dispatch->>'jobKey'=p_job_key
 AND COALESCE(dispatch->>'attemptKey',key_base)=p_failed_attempt_key
 AND key_base='variant-label-source:v1:'||encode(sha256(convert_to(atlas_customer.commerce_canonical((dispatch->'request')-'requestKey'),'UTF8')),'hex')
 AND response->>'version'=dispatch->'evidence'->>'policy'
 AND response->'requestEvidence'=dispatch->'evidence'
 AND dispatch->'evidence'->>'policy'='atlas-slab-label-association-v1'
 AND dispatch->'request'->>'policy'='atlas-slab-label-association-v1'
 AND dispatch->'evidence'->>'model'='gpt-6-astra' AND dispatch->'request'->>'model'='gpt-6-astra'
 AND dispatch->'evidence'->'request'=dispatch->'request'
 AND dispatch->'evidence'->>'requestSha256' ~ '^[a-f0-9]{64}$'
 AND dispatch->'catalog'->'demandKey'=j.catalog::jsonb->'demandKey'
 AND dispatch->'catalog'->'candidates'=j.catalog::jsonb->'candidates'
 AND jsonb_array_length(dispatch->'request'->'photos') BETWEEN 1 AND 8
 AND (j.catalog::jsonb->'referencePhotos') @> (dispatch->'catalog'->'referencePhotos'),false)
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

-- INSERT-only cache privilege does not itself confer explicit retry authority.
CREATE FUNCTION atlas_manual_connected.variant_label_retry_journal_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF (NEW.key LIKE 'variant-label-retry:v1:%' OR NEW.key LIKE 'variant-label-retry-next:v1:%')
 AND current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='atlas_manual_connected.retry_variant_labels(uuid,uuid,uuid,text,text,integer,text,text,text,text)'::regprocedure))
 THEN RAISE EXCEPTION 'VARIANT_LABEL_RETRY_JOURNAL_FORBIDDEN'; END IF;
 RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION atlas_manual_connected.variant_label_retry_journal_guard() FROM PUBLIC;
CREATE TRIGGER variant_label_retry_journal BEFORE INSERT ON atlas_manual_connected.variant_catalog_cache
FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.variant_label_retry_journal_guard();

CREATE OR REPLACE FUNCTION atlas_manual_connected.variant_job_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Variant history is immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'QUEUED' OR NEW.attempts<>0 OR NEW.catalog IS NOT NULL OR NEW.response IS NOT NULL OR NEW.result IS NOT NULL OR NEW.dispatch_id IS NOT NULL OR NEW.audit<>'[]'::jsonb
    OR NOT EXISTS(SELECT 1 FROM atlas_manual.card c WHERE c.id=NEW.card_id AND c.owner_id=NEW.actor_id AND c.content::jsonb->'source'->>'sourceHash'=NEW.source_hash AND (c.content::jsonb->>'identityRevision')::int=NEW.identity_revision)
  THEN RAISE EXCEPTION 'Variant job requires current immutable source'; END IF; RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['state','attempts','claim_id','lease_until','dispatch_id','catalog','catalog_hash','response','response_hash','result','result_hash','code','available_at','updated_at','audit']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','attempts','claim_id','lease_until','dispatch_id','catalog','catalog_hash','response','response_hash','result','result_hash','code','available_at','updated_at','audit'])
 OR NEW.attempts<OLD.attempts
 OR OLD.catalog IS NOT NULL AND ROW(NEW.catalog,NEW.catalog_hash) IS DISTINCT FROM ROW(OLD.catalog,OLD.catalog_hash) AND NOT COALESCE((
   OLD.state='RUNNING' AND NEW.state='RUNNING' AND NEW.claim_id IS NOT DISTINCT FROM OLD.claim_id AND OLD.lease_until>clock_timestamp()
   AND OLD.result IS NULL AND OLD.response IS NULL AND OLD.dispatch_id IS NULL AND NEW.catalog IS NOT NULL
   AND OLD.catalog::jsonb->'problems' ? 'REFERENCE_ACQUISITION_PENDING'
   AND NEW.catalog::jsonb->'demandKey' = OLD.catalog::jsonb->'demandKey'
   AND NEW.catalog::jsonb->'candidates' = OLD.catalog::jsonb->'candidates'
   AND coalesce(NEW.catalog::jsonb->'referencePhotos','[]'::jsonb) @> coalesce(OLD.catalog::jsonb->'referencePhotos','[]'::jsonb)
 ),false)
 OR OLD.response IS NOT NULL AND ROW(NEW.response,NEW.response_hash) IS DISTINCT FROM ROW(OLD.response,OLD.response_hash)
 OR OLD.dispatch_id IS NULL AND NEW.dispatch_id IS NOT NULL AND (NEW.state<>'REQUESTED' OR NEW.catalog IS NULL OR NEW.audit->-1->>'event'<>'DISPATCH' OR NEW.audit->-1->>'id'<>NEW.dispatch_id::text)
 OR OLD.dispatch_id IS NOT NULL AND NEW.dispatch_id IS DISTINCT FROM OLD.dispatch_id
 OR OLD.result IS NOT NULL AND ROW(NEW.result,NEW.result_hash) IS DISTINCT FROM ROW(OLD.result,OLD.result_hash)
 OR OLD.state IN('READY','FAILED','STALE') AND NEW.state IS DISTINCT FROM OLD.state AND NOT COALESCE((
   OLD.state='FAILED' AND NEW.state='QUEUED' AND NEW.code='VARIANT_LABEL_RETRY_REQUESTED'
   AND NEW.attempts=OLD.attempts AND NEW.claim_id IS NULL AND NEW.lease_until IS NULL
   AND current_user=pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='atlas_manual_connected.retry_variant_labels(uuid,uuid,uuid,text,text,integer,text,text,text,text)'::regprocedure))
   AND jsonb_array_length(NEW.audit)=jsonb_array_length(OLD.audit)+1
   AND NEW.audit->-1->>'event'='LABEL_RETRY_REQUESTED'
   AND EXISTS(SELECT 1 FROM atlas_manual_connected.variant_catalog_cache i
     JOIN atlas_manual_connected.variant_catalog_cache n ON n.key='variant-label-retry-next:v1:'||(i.snapshot::jsonb->>'failedRequestKey') AND n.snapshot=i.snapshot AND n.snapshot_hash=i.snapshot_hash
     WHERE i.key='variant-label-retry:v1:'||(NEW.audit->-1->>'requestId')
       AND i.snapshot::jsonb->>'jobKey'=OLD.key AND i.snapshot::jsonb->>'catalogHash'=OLD.catalog_hash
       AND NEW.audit->-1=jsonb_build_object('event','LABEL_RETRY_REQUESTED','requestId',i.snapshot::jsonb->>'requestId',
         'failedRequestKey',i.snapshot::jsonb->>'failedRequestKey','failedResponseHash',i.snapshot::jsonb->>'failedResponseHash',
         'attemptKey',i.snapshot::jsonb->>'attemptKey','catalogHash',i.snapshot::jsonb->>'catalogHash'))
 ),false)
 OR OLD.state='UNKNOWN' AND NEW.state NOT IN('UNKNOWN','STALE') AND NEW.response IS NULL
 OR jsonb_array_length(NEW.audit)<jsonb_array_length(OLD.audit)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.audit) WITH ORDINALITY a(value,n) WHERE NEW.audit->(a.n::int-1) IS DISTINCT FROM a.value)
 THEN RAISE EXCEPTION 'Variant evidence is immutable'; END IF;
 RETURN NEW;
END $function$;

