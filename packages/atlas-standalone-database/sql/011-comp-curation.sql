-- UNREGISTERED LOCAL PROPOSAL. No migration registry/runtime grants activate it.
-- Internal curation receipts only: report/presentation and paid market rows are
-- referenced, never changed. Service-owned saved artifact verification precedes
-- insertion; this table's hashes alone cannot establish source authority.
CREATE TABLE atlas_manual.comp_curation (
 card_id uuid NOT NULL, approval_action_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 request_id uuid NOT NULL, actor_id uuid NOT NULL, request text NOT NULL, request_hash text NOT NULL,
 binding text NOT NULL, binding_hash text NOT NULL, source text, source_hash text,
 selected_facts text NOT NULL, selected_facts_hash text NOT NULL,
 receipt text NOT NULL, receipt_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(card_id,approval_action_id,revision), UNIQUE(card_id,request_id),
 FOREIGN KEY(card_id,approval_action_id) REFERENCES atlas_manual.publication(card_id,action_id),
 CHECK(octet_length(request)<=4096 AND request_hash=encode(sha256(convert_to(request,'UTF8')),'hex')),
 CHECK(octet_length(binding)<=2048 AND binding_hash=encode(sha256(convert_to(binding,'UTF8')),'hex')),
 CHECK((source IS NULL AND source_hash IS NULL) OR (source IS NOT NULL AND source_hash IS NOT NULL AND octet_length(source)<=8192 AND source_hash=encode(sha256(convert_to(source,'UTF8')),'hex'))),
 CHECK(octet_length(selected_facts)<=32768 AND selected_facts_hash=encode(sha256(convert_to(selected_facts,'UTF8')),'hex') AND jsonb_typeof(selected_facts::jsonb)='array'),
 CHECK(octet_length(receipt)<=65536 AND receipt_hash=encode(sha256(convert_to(receipt,'UTF8')),'hex'))
);
CREATE FUNCTION atlas_manual.comp_curation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,atlas_manual AS $$
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
 IF d->>'outcome'='SELECTED' THEN
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
CREATE TRIGGER curation_guard BEFORE INSERT ON atlas_manual.comp_curation FOR EACH ROW EXECUTE FUNCTION atlas_manual.comp_curation_guard();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual.comp_curation FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual.comp_curation FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();
REVOKE ALL ON atlas_manual.comp_curation FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_manual.comp_curation_guard() FROM PUBLIC;
