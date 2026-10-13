BEGIN;
-- Reference metadata is bounded by bytes, not by an arbitrary number of
-- official printings. Retain all catalog choices and their saved photo pool.
DO $$
DECLARE target record; constraint_row record; found_count integer;
BEGIN
 FOR target IN SELECT * FROM (VALUES
   ('variant_job','catalog',1048576,4194304),
   ('variant_job','result',2097152,8388608),
   ('variant_contribution','payload',2097152,8388608)
 ) AS limits(table_name,column_name,old_limit,new_limit) LOOP
   found_count:=0;
   FOR constraint_row IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid=format('atlas_manual_connected.%I',target.table_name)::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%octet_length('||target.column_name||')%' LOOP
     IF position(target.old_limit::text IN constraint_row.definition)=0 THEN RAISE EXCEPTION 'Unexpected variant packet bound'; END IF;
     EXECUTE format('ALTER TABLE atlas_manual_connected.%I DROP CONSTRAINT %I',target.table_name,constraint_row.conname);
     EXECUTE format('ALTER TABLE atlas_manual_connected.%I ADD CONSTRAINT %I %s',target.table_name,constraint_row.conname,
       replace(constraint_row.definition,target.old_limit::text,target.new_limit::text));
     found_count:=found_count+1;
   END LOOP;
   IF found_count<>1 THEN RAISE EXCEPTION 'Missing or ambiguous variant packet constraint'; END IF;
 END LOOP;
END $$;
-- Catalog identity and choices freeze at the first checkpoint. Only acquired
-- photos may be appended while this live job is still acquiring references.
-- Removing the pending marker closes the checkpoint phase permanently.
CREATE OR REPLACE FUNCTION atlas_manual_connected.variant_job_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
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
 OR OLD.state IN('READY','FAILED','STALE') AND NEW.state IS DISTINCT FROM OLD.state
 OR OLD.state='UNKNOWN' AND NEW.state NOT IN('UNKNOWN','STALE') AND NEW.response IS NULL
 OR jsonb_array_length(NEW.audit)<jsonb_array_length(OLD.audit)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.audit) WITH ORDINALITY a(value,n) WHERE NEW.audit->(a.n::int-1) IS DISTINCT FROM a.value)
 THEN RAISE EXCEPTION 'Variant evidence is immutable'; END IF;
 RETURN NEW;
END $$;
COMMIT;
