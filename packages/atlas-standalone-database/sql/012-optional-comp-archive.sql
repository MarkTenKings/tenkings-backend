-- 012: optional private evidence selection and durable post-grade archive search.
-- The registered migrator owns BEGIN/COMMIT, advisory locking and the ledger.
-- Exact qualified function bodies are retained from the separately reviewed
-- candidates. Full catalog/role/data preflight remains a release prerequisite.
-- No existing-row DML, new grants, pricing policy or feature activation.
SET LOCAL lock_timeout='1500ms';
SET LOCAL statement_timeout='3000ms';
LOCK TABLE atlas_manual.comp_curation IN SHARE ROW EXCLUSIVE MODE;

LOCK TABLE atlas_manual_connected.market_job IN SHARE ROW EXCLUSIVE MODE;
DO $market_precondition$
DECLARE f record; origin_constraint record;
BEGIN
 SELECT p.*,l.lanname INTO f FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
 WHERE p.oid='atlas_manual_connected.market_job_guard()'::regprocedure;
 SELECT k.*,pg_get_constraintdef(k.oid,false) AS definition INTO origin_constraint FROM pg_constraint k
 WHERE k.conrelid='atlas_manual_connected.market_job'::regclass AND k.conname='market_job_origin_check';
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM '509b133ce90e80f1e68eb2ec72e7db76f5f9413d9952fc3b04b0393af6e1e11d'
  OR f.prorettype IS DISTINCT FROM 'trigger'::regtype OR f.prosecdef OR f.proisstrict OR f.proleakproof
  OR f.provolatile IS DISTINCT FROM 'v' OR f.lanname IS DISTINCT FROM 'plpgsql' OR f.probin IS NOT NULL
  OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
  OR origin_constraint.definition IS DISTINCT FROM $expected$CHECK ((origin = ANY (ARRAY['APPROVAL'::text, 'REFRESH'::text, 'BACKFILL'::text])))$expected$
  OR origin_constraint.contype IS DISTINCT FROM 'c' OR origin_constraint.convalidated IS DISTINCT FROM true
  OR origin_constraint.condeferrable OR origin_constraint.condeferred
  OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='atlas_manual_connected.market_job'::regclass
    AND attname IN('archive_authority','archive_authority_hash') AND NOT attisdropped)
  OR to_regprocedure('atlas_manual_connected.market_archive_search_guard()') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='atlas_manual_connected.market_job'::regclass
    AND tgname='market_job_guard' AND NOT tgisinternal AND tgenabled='O' AND tgtype=31
    AND tgfoid='atlas_manual_connected.market_job_guard()'::regprocedure)
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
    WHERE oid='atlas_manual_connected.display_owner_current(uuid,integer)'::regprocedure)
    IS DISTINCT FROM '1985dc2286f2de55dada1c14055d0f1a88b275fb590a770c2700bdee9327604f'
 THEN RAISE EXCEPTION 'Archive search migration precondition failed'; END IF;
END $market_precondition$;
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

ALTER TABLE atlas_manual_connected.market_job
  ADD COLUMN archive_authority text,
  ADD COLUMN archive_authority_hash text;

ALTER TABLE atlas_manual_connected.market_job DROP CONSTRAINT market_job_origin_check;
ALTER TABLE atlas_manual_connected.market_job ADD CONSTRAINT market_job_origin_check
  CHECK (origin IN ('APPROVAL','REFRESH','BACKFILL','ARCHIVE_SEARCH_V1'));
ALTER TABLE atlas_manual_connected.market_job ADD CONSTRAINT market_job_archive_authority_check CHECK (
  CASE WHEN origin='ARCHIVE_SEARCH_V1' THEN
    archive_authority IS NOT NULL AND archive_authority_hash IS NOT NULL
    AND octet_length(archive_authority)<=4096 AND jsonb_typeof(archive_authority::jsonb)='object'
    AND archive_authority_hash=encode(sha256(convert_to(archive_authority,'UTF8')),'hex')
  ELSE archive_authority IS NULL AND archive_authority_hash IS NULL END);

-- The existing market_job_guard stays byte-identical. Its immutable-column
-- comparison already includes both new columns; its original state/response/
-- dispatch/audit rules continue to govern every origin.
CREATE FUNCTION atlas_manual_connected.market_archive_search_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $function$
DECLARE expected jsonb;
BEGIN
 IF NEW.origin<>'ARCHIVE_SEARCH_V1' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.archive_authority IS DISTINCT FROM OLD.archive_authority
    OR NEW.archive_authority_hash IS DISTINCT FROM OLD.archive_authority_hash
    OR NEW.public_hash IS NOT NULL AND NEW.public_hash IS DISTINCT FROM (NEW.archive_authority::jsonb->>'publicHash')
  THEN RAISE EXCEPTION 'Archive market authority is immutable'; END IF;
  RETURN NEW;
 END IF;
 SELECT jsonb_build_object('version','atlas-market-archive-search-authority-v1',
   'requestId',NEW.request_id::text,'cardId',NEW.card_id::text,'approvalActionId',NEW.approval_action_id::text,
   'actorId',NEW.actor_id::text,'accessVersion',NEW.access_version,'mode',NEW.mode,'sourceRevision',a.source_revision,
   'sourceHash',a.source_hash,'reportHash',a.report_hash,'publicToken',r.public_token,'publicVersion',p.version,
   'publicHash',p.public_hash,'manifestHash',p.manifest_hash,'requestHash',m.request_hash)
 INTO expected FROM atlas_manual.publication p JOIN atlas_manual.approval a USING(card_id,action_id)
 JOIN atlas_manual.public_report_identity r USING(card_id) JOIN atlas_manual.card c ON c.id=p.card_id
 JOIN atlas_manual_intake.card i ON i.id=c.id
 JOIN atlas_manual.presentation_market m ON m.card_id=p.card_id AND m.request_id=NEW.request_id
 WHERE p.card_id=NEW.card_id AND p.action_id=NEW.approval_action_id AND p.mode=NEW.mode AND p.state='PUBLISHED'
   AND a.source_hash=NEW.source_hash AND a.report_hash=NEW.report_hash
   AND m.approval_action_id=p.action_id AND m.actor_id=NEW.actor_id AND m.state='STARTED'
   AND m.request_hash=encode(sha256(convert_to(m.request,'UTF8')),'hex')
   AND m.request::jsonb->>'requestId'=NEW.request_id::text AND m.request::jsonb->>'approvalActionId'=NEW.approval_action_id::text
   AND atlas_manual_connected.display_owner_current(NEW.actor_id,NEW.access_version)
   AND (c.owner_id=NEW.actor_id OR NEW.actor_id=ANY(c.approvers) OR NEW.actor_id=ANY(c.editors) OR NEW.actor_id=ANY(c.readers))
   AND NOT EXISTS(SELECT 1 FROM atlas_manual.publication newer WHERE newer.card_id=p.card_id AND newer.version>p.version)
   AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=i.id OR (d.owner_id=i.owner_id AND d.create_request_id=i.create_request_id));
 IF expected IS NULL OR NEW.archive_authority::jsonb IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'Archive search requires exact current published authority';
 END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION atlas_manual_connected.market_archive_search_guard() FROM PUBLIC;
CREATE TRIGGER market_archive_search_guard BEFORE INSERT OR UPDATE ON atlas_manual_connected.market_job
FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.market_archive_search_guard();

-- Existing table-level SELECT/INSERT and column-scoped job progress grants are
-- sufficient; neither authority column receives UPDATE. No new write privilege
-- to approval, publication, presentation or staff identity is granted here.


DO $market_postcondition$
BEGIN
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
     WHERE oid='atlas_manual_connected.market_archive_search_guard()'::regprocedure)
    IS DISTINCT FROM '68e34910409967fc0fd54b6f802b48e7f4442da866e2e3267f82ff77501cfe2c'
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
     WHERE oid='atlas_manual_connected.market_job_guard()'::regprocedure)
    IS DISTINCT FROM '509b133ce90e80f1e68eb2ec72e7db76f5f9413d9952fc3b04b0393af6e1e11d'
  OR (SELECT count(*) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='atlas_manual_connected.market_job'::regclass AND a.attname IN('archive_authority','archive_authority_hash')
      AND NOT a.attisdropped AND a.atttypid='text'::regtype AND NOT a.attnotnull
      AND a.attidentity='' AND a.attgenerated='' AND d.oid IS NULL)<>2
  OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='atlas_manual_connected.market_job'::regclass
    AND conname='market_job_archive_authority_check' AND contype='c' AND convalidated AND NOT condeferrable)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='atlas_manual_connected.market_job'::regclass
    AND tgname='market_archive_search_guard' AND NOT tgisinternal AND tgenabled='O' AND tgtype=23
    AND tgfoid='atlas_manual_connected.market_archive_search_guard()'::regprocedure)
 THEN RAISE EXCEPTION 'Archive search migration postcondition failed'; END IF;
END $market_postcondition$;
