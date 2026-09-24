-- Additive background-result custody. Existing runs, receipts and admission
-- windows remain unchanged. No provider request is made by this migration.
BEGIN;
ALTER TABLE atlas_defect_analysis.request_refusal DROP CONSTRAINT request_refusal_code_check;
ALTER TABLE atlas_defect_analysis.request_refusal ADD CONSTRAINT request_refusal_code_check CHECK(code IN
 ('DEFECT_ANALYSIS_STALE','DEFECT_ANALYSIS_REQUEST_EXPIRED','MANUAL_GEOMETRY_REVIEW_REQUIRED','MANUAL_DEFECT_PENDING',
  'DEFECT_ANALYSIS_PENDING','DEFECT_ANALYSIS_REPLACEMENT_INVALID'));
ALTER TABLE atlas_defect_analysis.run
 ADD COLUMN replaces_analysis_id uuid REFERENCES atlas_defect_analysis.run(id),
 ADD COLUMN replaces_outcome_hash text CHECK(replaces_outcome_hash ~ '^[a-f0-9]{64}$'),
 ADD CONSTRAINT background_replacement_complete CHECK((replaces_analysis_id IS NULL)=(replaces_outcome_hash IS NULL));
CREATE UNIQUE INDEX analysis_replacement_parent_unique ON atlas_defect_analysis.run(replaces_analysis_id)
 WHERE replaces_analysis_id IS NOT NULL;
CREATE TABLE atlas_defect_analysis.provider_event (
 analysis_id uuid NOT NULL REFERENCES atlas_defect_analysis.run(id),
 kind text NOT NULL CHECK(kind IN ('ACCEPTED','ACK_ARTIFACT')),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 provider_binding_hash text NOT NULL CHECK(provider_binding_hash ~ '^[a-f0-9]{64}$'),
 response_id text NOT NULL CHECK(response_id ~ '^resp_[A-Za-z0-9_-]{1,180}$'),
 evidence text NOT NULL CHECK(octet_length(evidence)<=16384 AND jsonb_typeof(evidence::jsonb)='object'),
 evidence_hash text NOT NULL CHECK(evidence_hash=encode(sha256(convert_to(evidence,'UTF8')),'hex')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(analysis_id,kind)
);
CREATE UNIQUE INDEX background_response_unique ON atlas_defect_analysis.provider_event(provider_binding_hash,response_id) WHERE kind='ACCEPTED';
CREATE INDEX background_pending ON atlas_defect_analysis.provider_event(provider_binding_hash,recorded_at,analysis_id) WHERE kind='ACCEPTED';
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_defect_analysis.provider_event FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
REVOKE ALL ON atlas_defect_analysis.provider_event FROM PUBLIC;

CREATE OR REPLACE FUNCTION atlas_defect_analysis.run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent atlas_defect_analysis.run%ROWTYPE; outcome atlas_defect_analysis.receipt%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Defect analysis history is retained'; END IF;
 PERFORM id FROM atlas_manual.card WHERE id=NEW.card_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM atlas_defect_analysis.request_refusal WHERE card_id=NEW.card_id AND action_id=NEW.action_id)
 THEN RAISE EXCEPTION 'Defect analysis request is retired before dispatch'; END IF;
 IF NEW.replaces_analysis_id IS NOT NULL THEN
   SELECT * INTO parent FROM atlas_defect_analysis.run WHERE id=NEW.replaces_analysis_id FOR UPDATE;
   IF NOT FOUND OR parent.card_id<>NEW.card_id OR parent.id=NEW.id OR parent.state<>'DISPATCHED'
     OR NEW.request_evidence::jsonb->>'version' IS DISTINCT FROM 'atlas-astra-defect-analysis-v2'
     OR EXISTS(SELECT 1 FROM atlas_defect_analysis.provider_event WHERE analysis_id=parent.id AND kind='ACCEPTED')
     OR EXISTS(SELECT 1 FROM atlas_defect_analysis.receipt WHERE analysis_id=parent.id AND kind='RESPONSE')
   THEN RAISE EXCEPTION 'Exact unknown analysis replacement required'; END IF;
   SELECT * INTO outcome FROM atlas_defect_analysis.receipt WHERE analysis_id=parent.id AND kind='OUTCOME';
   IF NOT FOUND OR outcome.request_hash<>parent.request_hash
     OR encode(sha256(convert_to(outcome.evidence,'UTF8')),'hex') IS DISTINCT FROM NEW.replaces_outcome_hash
     OR outcome.evidence::jsonb->>'state' IS DISTINCT FROM 'UNKNOWN'
     OR outcome.evidence::jsonb->>'code' IS DISTINCT FROM 'DEFECT_ANALYSIS_OUTCOME_UNKNOWN'
     OR outcome.evidence::jsonb->'responseId' IS DISTINCT FROM 'null'::jsonb
     OR outcome.evidence::jsonb->'responseRef' IS DISTINCT FROM 'null'::jsonb
     OR outcome.evidence::jsonb->'resultRef' IS DISTINCT FROM 'null'::jsonb
   THEN RAISE EXCEPTION 'Exact unknown analysis replacement outcome required'; END IF;
 END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.state<>'PREPARED' OR NEW.dispatched_at IS NOT NULL THEN RAISE EXCEPTION 'Defect analysis must be prepared first'; END IF;
   RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.card_id,NEW.action_id,NEW.actor_id,NEW.base_hash,NEW.binding,NEW.binding_hash,NEW.request_hash,NEW.request_ref,
        NEW.request_evidence,NEW.evidence_hash,NEW.created_at,NEW.expires_at,NEW.replaces_analysis_id,NEW.replaces_outcome_hash)
    IS DISTINCT FROM ROW(OLD.id,OLD.card_id,OLD.action_id,OLD.actor_id,OLD.base_hash,OLD.binding,OLD.binding_hash,OLD.request_hash,OLD.request_ref,
        OLD.request_evidence,OLD.evidence_hash,OLD.created_at,OLD.expires_at,OLD.replaces_analysis_id,OLD.replaces_outcome_hash)
    OR OLD.state<>'PREPARED' OR NEW.state<>'DISPATCHED' OR NEW.dispatched_at IS NULL OR NEW.dispatched_at>=NEW.expires_at
 THEN RAISE EXCEPTION 'Defect analysis dispatch or immutable evidence conflict'; END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION atlas_defect_analysis.append_provider_event(analysis uuid,request_sha text,provider_binding text,event_kind text,event_text text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_defect_analysis AS $$
DECLARE run_row atlas_defect_analysis.run%ROWTYPE; accepted atlas_defect_analysis.provider_event%ROWTYPE;
 prior atlas_defect_analysis.provider_event%ROWTYPE; payload jsonb; received timestamptz; until_time timestamptz;
BEGIN
 IF analysis IS NULL OR request_sha IS NULL OR event_kind IS NULL OR event_text IS NULL
 OR event_kind NOT IN ('ACCEPTED','ACK_ARTIFACT') OR octet_length(event_text)>16384
 THEN RAISE EXCEPTION 'Invalid background event'; END IF;
 SELECT * INTO run_row FROM atlas_defect_analysis.run WHERE id=analysis FOR UPDATE;
 IF NOT FOUND OR run_row.state<>'DISPATCHED' OR run_row.request_hash<>request_sha
 OR run_row.request_evidence::jsonb->>'version' IS DISTINCT FROM 'atlas-astra-defect-analysis-v2'
 THEN RAISE EXCEPTION 'Exact dispatched background analysis required'; END IF;
 payload:=event_text::jsonb;
 IF jsonb_typeof(payload)<>'object' OR (payload->>'responseId' ~ '^resp_[A-Za-z0-9_-]{1,180}$') IS NOT TRUE
 OR (payload->>'responseHash' ~ '^[a-f0-9]{64}$') IS NOT TRUE
 THEN RAISE EXCEPTION 'Invalid background response identity'; END IF;
 IF event_kind='ACCEPTED' THEN
   IF (SELECT count(*) FROM jsonb_object_keys(payload))<>8
   OR NOT(payload ?& ARRAY['responseId','providerRequestId','httpStatus','providerStatus','model','responseHash','receivedAt','pollUntil'])
   OR (payload->>'providerStatus' IN ('queued','in_progress','completed','failed','incomplete','cancelled')) IS NOT TRUE
   OR payload->>'model' IS DISTINCT FROM 'gpt-6-astra'
   OR payload->>'model' IS DISTINCT FROM run_row.request_evidence::jsonb->>'model'
   OR (jsonb_typeof(payload->'httpStatus')='number' AND (payload->>'httpStatus')::int BETWEEN 200 AND 299) IS NOT TRUE
   OR NOT(payload->'providerRequestId'='null'::jsonb OR payload->>'providerRequestId' ~ '^[A-Za-z0-9_-]{1,180}$')
   OR (provider_binding ~ '^[a-f0-9]{64}$') IS NOT TRUE
   OR provider_binding IS DISTINCT FROM run_row.request_evidence::jsonb->>'providerBindingHash'
   THEN RAISE EXCEPTION 'Invalid exact background acceptance'; END IF;
   received:=(payload->>'receivedAt')::timestamptz; until_time:=(payload->>'pollUntil')::timestamptz;
   IF received IS NULL OR until_time IS NULL OR received<run_row.dispatched_at-interval '30 seconds'
   OR received>clock_timestamp()+interval '30 seconds' OR until_time<=received OR until_time>received+interval '30 minutes'
   THEN RAISE EXCEPTION 'Invalid background retrieval window'; END IF;
 ELSE
   SELECT * INTO accepted FROM atlas_defect_analysis.provider_event WHERE analysis_id=analysis AND kind='ACCEPTED';
   IF NOT FOUND OR (SELECT count(*) FROM jsonb_object_keys(payload))<>3
   OR NOT(payload ?& ARRAY['responseId','responseRef','responseHash']) OR jsonb_typeof(payload->'responseRef')<>'object'
   OR payload->>'responseId'<>accepted.response_id OR payload->>'responseHash'<>accepted.evidence::jsonb->>'responseHash'
   THEN RAISE EXCEPTION 'Exact retained background acceptance required'; END IF;
   provider_binding:=accepted.provider_binding_hash;
 END IF;
 INSERT INTO atlas_defect_analysis.provider_event(analysis_id,kind,request_hash,provider_binding_hash,response_id,evidence,evidence_hash)
 VALUES(analysis,event_kind,request_sha,provider_binding,payload->>'responseId',event_text,encode(sha256(convert_to(event_text,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
 SELECT * INTO prior FROM atlas_defect_analysis.provider_event WHERE analysis_id=analysis AND kind=event_kind;
 IF NOT FOUND OR prior.request_hash<>request_sha OR prior.provider_binding_hash<>provider_binding OR prior.evidence<>event_text
 THEN RAISE EXCEPTION 'Background event conflict'; END IF;
 RETURN true;
END; $$;

-- Receipt-only machine enumeration returns exclusively IDs already accepted by
-- the exact provider binding. It cannot prepare, claim or dispatch new work.
CREATE FUNCTION atlas_defect_analysis.read_background(provider_binding text,analysis uuid,after_time timestamptz,after_id uuid,batch_size integer,read_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,atlas_defect_analysis AS $$
DECLARE result jsonb;
BEGIN
 IF (provider_binding ~ '^[a-f0-9]{64}$') IS NOT TRUE OR batch_size IS NULL OR batch_size<1 OR batch_size>11 OR read_at IS NULL
 OR ((after_time IS NULL)<>(after_id IS NULL)) THEN RAISE EXCEPTION 'Invalid bounded background read'; END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY recorded_at,id),'[]'::jsonb) INTO result FROM (
  SELECT jsonb_build_object('run',to_jsonb(r),'acceptance',to_jsonb(e)) value,e.recorded_at,r.id
  FROM atlas_defect_analysis.provider_event e JOIN atlas_defect_analysis.run r ON r.id=e.analysis_id
  WHERE e.kind='ACCEPTED' AND e.provider_binding_hash=provider_binding
    AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.receipt WHERE analysis_id=r.id AND kind='RESPONSE')
    AND (analysis IS NULL OR r.id=analysis)
    AND (after_time IS NULL OR (e.recorded_at,r.id)>(after_time,after_id))
    AND (analysis IS NOT NULL OR (
      ((e.evidence::jsonb->>'pollUntil')::timestamptz>read_at OR NOT EXISTS(
        SELECT 1 FROM atlas_defect_analysis.receipt WHERE analysis_id=r.id AND kind='OUTCOME'))))
  ORDER BY e.recorded_at,r.id LIMIT batch_size
 ) found;
 RETURN result;
END; $$;

CREATE FUNCTION atlas_defect_analysis.background_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE accepted atlas_defect_analysis.provider_event%ROWTYPE;
BEGIN
 IF NEW.kind='RESPONSE' THEN
  SELECT * INTO accepted FROM atlas_defect_analysis.provider_event WHERE analysis_id=NEW.analysis_id AND kind='ACCEPTED';
  IF FOUND AND (NEW.request_hash<>accepted.request_hash OR NEW.evidence::jsonb->>'responseId' IS DISTINCT FROM accepted.response_id)
  THEN RAISE EXCEPTION 'Terminal response differs from accepted background response'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER background_receipt_guard BEFORE INSERT ON atlas_defect_analysis.receipt
 FOR EACH ROW EXECUTE FUNCTION atlas_defect_analysis.background_receipt_guard();
REVOKE ALL ON FUNCTION atlas_defect_analysis.append_provider_event(uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_defect_analysis.read_background(text,uuid,timestamptz,uuid,integer,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_defect_analysis.background_receipt_guard() FROM PUBLIC;
COMMIT;
