-- UNREGISTERED CANDIDATE: reviewed deployment coordination is required.
-- Prerequisites: separately compare the full old curation schema pin a1bbdf297ec7c426358a9f6dee0fd90fb23a109bb92007f0b2ccfa5b3b842ff7,
-- exact role rights and preserved data. The guard below does not replace that
-- full-catalog preflight. Qualified new schema is 5eed11b83e4ad6a8e1afab7a3d4ff1b79288dee5193a9b0a1026891bd88f5ab1.
-- No ledger registration, new grants, feature flags or existing-row DML.
-- Unknown COMMIT outcomes require inspection; this file never auto-replays.
BEGIN;
SET LOCAL lock_timeout='1500ms';
SET LOCAL statement_timeout='3000ms';
LOCK TABLE atlas_manual.comp_curation IN SHARE ROW EXCLUSIVE MODE;
DO $precondition$
DECLARE f record;
BEGIN
 SELECT p.*,l.lanname INTO f FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
 WHERE p.oid='atlas_manual.comp_curation_guard()'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM '81f9eb9b687a761d3d9777eb1d65c6351ed218cfff38e07701040d1c33273cfb'
  OR f.prorettype IS DISTINCT FROM 'trigger'::regtype OR f.prosecdef OR f.proisstrict OR f.proleakproof
  OR f.provolatile IS DISTINCT FROM 'v' OR f.lanname IS DISTINCT FROM 'plpgsql' OR f.probin IS NOT NULL
  OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, atlas_manual']::text[] THEN
  RAISE EXCEPTION 'Comp evidence migration precondition failed'; END IF;
END $precondition$;
CREATE OR REPLACE FUNCTION atlas_manual.comp_curation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,atlas_manual AS $$
DECLARE p record; m atlas_manual.presentation_market; b jsonb; s jsonb; d jsonb; r jsonb; prior integer;
BEGIN
 -- Same card lock/order as approval/presentation. Concurrent revision claims
 -- serialize; no mutable head or updates to old receipts are needed.
 PERFORM 1 FROM atlas_manual.card WHERE id=NEW.card_id FOR UPDATE;
 SELECT COALESCE(MAX(revision),0) INTO prior FROM atlas_manual.comp_curation WHERE card_id=NEW.card_id AND approval_action_id=NEW.approval_action_id;
 IF NEW.revision<>prior+1 THEN RAISE EXCEPTION 'Curation revision conflict'; END IF;
 b:=NEW.binding::jsonb; s:=NEW.source::jsonb; d:=NEW.request::jsonb; r:=NEW.receipt::jsonb;
 SELECT pub.*,a.source_revision,a.source_hash,a.report_hash,i.public_token INTO p
 FROM atlas_manual.publication pub JOIN atlas_manual.approval a USING(card_id,action_id)
 JOIN atlas_manual.public_report_identity i USING(card_id)
 WHERE pub.card_id=NEW.card_id ORDER BY pub.version DESC LIMIT 1;
 IF p.state IS DISTINCT FROM 'PUBLISHED' OR p.action_id IS DISTINCT FROM NEW.approval_action_id OR b IS DISTINCT FROM jsonb_build_object(
  'cardId',NEW.card_id,'approvalActionId',p.action_id,'sourceRevision',p.source_revision,'sourceHash',p.source_hash,
  'reportHash',p.report_hash,'publicToken',p.public_token,'publicVersion',p.version,'publicHash',p.public_hash,'mode',p.mode) THEN
  RAISE EXCEPTION 'Curation approval mismatch'; END IF;
 IF d->>'requestId' IS DISTINCT FROM NEW.request_id::text OR d->>'approvalActionId' IS DISTINCT FROM NEW.approval_action_id::text
  OR (d->>'expectedSelectionRevision')::integer IS DISTINCT FROM prior OR r->>'schema' IS DISTINCT FROM 'atlas-comp-curation-receipt-v1'
  OR r->>'status' IS DISTINCT FROM 'LOCAL_PROPOSAL' OR r->>'visibility' IS DISTINCT FROM 'PRIVATE_INTERNAL'
  OR r->>'actorId' IS DISTINCT FROM NEW.actor_id::text OR r->>'requestId' IS DISTINCT FROM NEW.request_id::text
  OR (r->>'revision')::integer IS DISTINCT FROM NEW.revision OR r->'binding' IS DISTINCT FROM b
  OR r->'source' IS DISTINCT FROM COALESCE(s,'null'::jsonb) OR r->'selected' IS DISTINCT FROM NEW.selected_facts::jsonb
  OR r->>'outcome' IS DISTINCT FROM d->>'outcome' OR r->>'selectedFactsHash' IS DISTINCT FROM NEW.selected_facts_hash
  OR r->>'reportSnapshotUnaffected' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Curation receipt mismatch'; END IF;
 IF s IS NOT NULL THEN
  SELECT * INTO m FROM atlas_manual.presentation_market WHERE card_id=NEW.card_id AND request_id=(s->>'previewId')::uuid;
  IF m.state IS DISTINCT FROM 'READY' OR m.approval_action_id IS DISTINCT FROM NEW.approval_action_id
   OR s->>'requestHash' IS DISTINCT FROM m.request_hash OR s->>'resultHash' IS DISTINCT FROM m.result_hash
   OR s->>'artifactHash' IS DISTINCT FROM (m.result::jsonb->>'artifactHash')
   OR s->>'previewHash' IS DISTINCT FROM (m.result::jsonb->>'sourceHash')
   OR d->>'previewId' IS DISTINCT FROM s->>'previewId' OR d->>'expectedPreviewHash' IS DISTINCT FROM s->>'previewHash' THEN
   RAISE EXCEPTION 'Curation saved source mismatch'; END IF;
 ELSE
  IF d->>'previewId' IS NOT NULL OR d->>'expectedPreviewHash' IS NOT NULL THEN RAISE EXCEPTION 'Curation source missing'; END IF;
 END IF;
 IF d->>'outcome'='SELECTED' AND r->'policy'->>'version'='atlas-comp-evidence-selection-policy-v1' THEN
  -- A separate evidence-only branch; the prior priced branch below is retained
  -- verbatim. No existing receipt is updated or reinterpreted.
  IF s IS NULL OR jsonb_array_length(NEW.selected_facts::jsonb) NOT BETWEEN 1 AND 5
   OR r->'guidance' IS DISTINCT FROM 'null'::jsonb
   OR r->'policy' IS DISTINCT FROM '{"version":"atlas-comp-evidence-selection-policy-v1","status":"LOCAL_PROPOSAL","method":"private-saved-sold-evidence-v1","recencyDays":null,"rightsStatus":"UNRESOLVED"}'::jsonb
   OR r->>'policyHash' IS DISTINCT FROM encode(sha256(convert_to('{"method":"private-saved-sold-evidence-v1","recencyDays":null,"rightsStatus":"UNRESOLVED","status":"LOCAL_PROPOSAL","version":"atlas-comp-evidence-selection-policy-v1"}','UTF8')),'hex')
   OR r->>'policyHash' IS DISTINCT FROM d->>'expectedPolicyHash'
   OR (SELECT jsonb_agg(v->>'id' ORDER BY v->>'id') FROM jsonb_array_elements(NEW.selected_facts::jsonb) v) IS DISTINCT FROM d->'selectedIds'
   OR d->'selectedIds' IS DISTINCT FROM d->'reviewedIds'
   OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.selected_facts::jsonb) v WHERE v->'eligible' IS DISTINCT FROM 'true'::jsonb OR v->'reasonCodes' IS DISTINCT FROM '[]'::jsonb)
   THEN RAISE EXCEPTION 'Curation evidence selection invalid'; END IF;
 ELSIF d->>'outcome'='SELECTED' THEN
  IF s IS NULL OR jsonb_array_length(NEW.selected_facts::jsonb) NOT BETWEEN 1 AND 5 OR r->'guidance'='null'::jsonb
   OR r->'policy'->>'status' IS DISTINCT FROM 'LOCAL_PROPOSAL' OR r->'policy'->>'rightsStatus' IS DISTINCT FROM 'UNRESOLVED'
   OR r->>'policyHash' IS DISTINCT FROM d->>'expectedPolicyHash'
   OR r->'guidance'->>'status' IS DISTINCT FROM 'LOCAL_PROPOSAL' OR r->'guidance'->>'visibility' IS DISTINCT FROM 'PRIVATE_INTERNAL'
   OR r->'guidance'->'askingPriceMinor' IS DISTINCT FROM 'null'::jsonb OR r->'guidance'->'listingPrice' IS DISTINCT FROM 'null'::jsonb
   OR (SELECT jsonb_agg(v->>'id' ORDER BY v->>'id') FROM jsonb_array_elements(NEW.selected_facts::jsonb) v) IS DISTINCT FROM d->'selectedIds'
   OR d->'selectedIds' IS DISTINCT FROM d->'reviewedIds' THEN RAISE EXCEPTION 'Curation selection invalid'; END IF;
 ELSIF d->>'outcome' IN ('SKIP','NO_SUITABLE_COMPS') THEN
  IF NEW.selected_facts::jsonb<>'[]'::jsonb OR d->'selectedIds'<>'[]'::jsonb OR d->'reviewedIds'<>'[]'::jsonb
   OR r->'guidance' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Curation empty outcome invalid'; END IF;
 ELSE RAISE EXCEPTION 'Curation outcome invalid'; END IF;
 RETURN NEW;
END $$;

DO $postcondition$
BEGIN
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
     WHERE oid='atlas_manual.comp_curation_guard()'::regprocedure)
  IS DISTINCT FROM '8d2b7e0da7e1309334cce43a3c7382fdb4c63e48d771b95971aa23833a410e51' THEN
  RAISE EXCEPTION 'Comp evidence migration postcondition failed'; END IF;
END $postcondition$;
COMMIT;
