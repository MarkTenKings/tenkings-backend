-- INERT ADDITIVE PROPOSAL ONLY: not registered or executed.
-- Requires separate owned-PostgreSQL qualification and coordinated release.
-- Replaces only the SQL011 INSERT guard; no table, receipt, grant, role,
-- ledger or runtime setting is changed by this proposal file's existence.
-- Existing pricing-policy receipt branch and all approval/source/revision
-- checks are retained. Runtime selectionPolicy remains explicit and default-off.
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
