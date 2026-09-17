-- INACTIVE additive proposal. Requires published manual workspace/intake schemas.
-- Images, full provider JSON and proposal artifacts never enter these rows.
BEGIN;
CREATE SCHEMA atlas_defect_analysis;
REVOKE ALL ON SCHEMA atlas_defect_analysis FROM PUBLIC;
CREATE TABLE atlas_defect_analysis.run (
 id uuid PRIMARY KEY,
 card_id uuid NOT NULL REFERENCES atlas_manual.card(id),
 action_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 base_hash text NOT NULL CHECK(base_hash ~ '^[a-f0-9]{64}$'),
 binding text NOT NULL CHECK(octet_length(binding)<=32768 AND jsonb_typeof(binding::jsonb)='object'),
 binding_hash text NOT NULL CHECK(binding_hash=encode(sha256(convert_to(binding,'UTF8')),'hex')),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 request_ref text NOT NULL CHECK(octet_length(request_ref)<=8192 AND jsonb_typeof(request_ref::jsonb)='object'),
 request_evidence text NOT NULL CHECK(octet_length(request_evidence)<=32768 AND jsonb_typeof(request_evidence::jsonb)='object'),
 evidence_hash text NOT NULL CHECK(evidence_hash=encode(sha256(convert_to(request_evidence,'UTF8')),'hex')),
 state text NOT NULL CHECK(state IN ('PREPARED','DISPATCHED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 dispatched_at timestamptz,
 UNIQUE(card_id,action_id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes'),
 CHECK((state='PREPARED')=(dispatched_at IS NULL))
);
CREATE TABLE atlas_defect_analysis.receipt (
 analysis_id uuid NOT NULL REFERENCES atlas_defect_analysis.run(id),
 kind text NOT NULL CHECK(kind IN ('OUTCOME','RESPONSE')),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 evidence text NOT NULL CHECK(octet_length(evidence)<=32768 AND jsonb_typeof(evidence::jsonb)='object'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(analysis_id,kind)
);
-- A deterministic refusal before dispatch settles the exact browser command.
-- Existing prepared evidence is retained. No provider response or usage is made up.
CREATE TABLE atlas_defect_analysis.request_refusal (
 card_id uuid NOT NULL REFERENCES atlas_manual.card(id),
 action_id uuid NOT NULL,
 analysis_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 base_hash text NOT NULL CHECK(base_hash ~ '^[a-f0-9]{64}$'),
 code text NOT NULL CHECK(code IN ('DEFECT_ANALYSIS_STALE','DEFECT_ANALYSIS_REQUEST_EXPIRED','MANUAL_GEOMETRY_REVIEW_REQUIRED','MANUAL_DEFECT_PENDING')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(card_id,action_id), UNIQUE(card_id,analysis_id)
);
CREATE FUNCTION atlas_defect_analysis.run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Defect analysis history is retained'; END IF;
 PERFORM id FROM atlas_manual.card WHERE id=NEW.card_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM atlas_defect_analysis.request_refusal WHERE card_id=NEW.card_id AND action_id=NEW.action_id)
 THEN RAISE EXCEPTION 'Defect analysis request is retired before dispatch'; END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.state<>'PREPARED' OR NEW.dispatched_at IS NOT NULL THEN RAISE EXCEPTION 'Defect analysis must be prepared first'; END IF;
   RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.card_id,NEW.action_id,NEW.actor_id,NEW.base_hash,NEW.binding,NEW.binding_hash,NEW.request_hash,NEW.request_ref,
        NEW.request_evidence,NEW.evidence_hash,NEW.created_at,NEW.expires_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.card_id,OLD.action_id,OLD.actor_id,OLD.base_hash,OLD.binding,OLD.binding_hash,OLD.request_hash,OLD.request_ref,
        OLD.request_evidence,OLD.evidence_hash,OLD.created_at,OLD.expires_at)
    OR OLD.state<>'PREPARED' OR NEW.state<>'DISPATCHED' OR NEW.dispatched_at IS NULL
    OR NEW.dispatched_at>=NEW.expires_at
 THEN RAISE EXCEPTION 'Defect analysis dispatch or immutable evidence conflict'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER run_guard BEFORE INSERT OR UPDATE OR DELETE ON atlas_defect_analysis.run FOR EACH ROW EXECUTE FUNCTION atlas_defect_analysis.run_guard();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_defect_analysis.receipt FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE FUNCTION atlas_defect_analysis.refusal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior atlas_defect_analysis.run%ROWTYPE;
BEGIN
 PERFORM id FROM atlas_manual.card WHERE id=NEW.card_id FOR UPDATE;
 SELECT * INTO prior FROM atlas_defect_analysis.run WHERE card_id=NEW.card_id AND action_id=NEW.action_id FOR UPDATE;
 IF FOUND THEN
  IF prior.state<>'PREPARED' OR prior.id<>NEW.analysis_id OR prior.actor_id<>NEW.actor_id OR prior.base_hash<>NEW.base_hash
  THEN RAISE EXCEPTION 'A dispatched or different defect analysis cannot be retired'; END IF;
 ELSIF NEW.analysis_id<>NEW.action_id THEN RAISE EXCEPTION 'Absent analysis retirement must match its command';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER refusal_guard BEFORE INSERT ON atlas_defect_analysis.request_refusal FOR EACH ROW EXECUTE FUNCTION atlas_defect_analysis.refusal_guard();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_defect_analysis.request_refusal FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();

-- This narrow capability retains paid-result evidence after session expiry. It
-- cannot create a request, dispatch, change a card, confirm findings or approve.
CREATE FUNCTION atlas_defect_analysis.append_receipt(analysis uuid, request_sha text, receipt_kind text, receipt_text text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_defect_analysis AS $$
DECLARE prior atlas_defect_analysis.receipt%ROWTYPE; payload jsonb;
BEGIN
 IF analysis IS NULL OR request_sha IS NULL OR receipt_kind IS NULL OR receipt_text IS NULL
    OR receipt_kind NOT IN ('OUTCOME','RESPONSE') OR octet_length(receipt_text)>32768
    OR NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.run WHERE id=analysis AND request_hash=request_sha AND state='DISPATCHED')
 THEN RAISE EXCEPTION 'Exact dispatched defect analysis required'; END IF;
 payload:=receipt_text::jsonb;
 IF jsonb_typeof(payload)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(payload))<>9
    OR NOT (payload ?& ARRAY['state','responseRef','resultRef','responseHash','providerRequestId','responseId','httpStatus','usage','code'])
    OR (payload->>'state' IN ('READY','REFUSED','UNKNOWN')) IS NOT TRUE
    OR receipt_kind='OUTCOME' AND payload->>'state'<>'UNKNOWN'
    OR receipt_kind='RESPONSE' AND (jsonb_typeof(payload->'responseRef')<>'object' OR (payload->>'responseHash' ~ '^[a-f0-9]{64}$') IS NOT TRUE)
    OR payload->>'state'='READY' AND (jsonb_typeof(payload->'resultRef')<>'object' OR jsonb_typeof(payload->'responseRef')<>'object'
       OR payload->'code'<>'null'::jsonb OR payload->>'responseId' IS NULL)
    OR payload->>'state'<>'READY' AND (payload->'resultRef'<>'null'::jsonb OR payload->>'code' IS NULL)
 THEN RAISE EXCEPTION 'Invalid compact defect analysis receipt'; END IF;
 INSERT INTO atlas_defect_analysis.receipt(analysis_id,kind,request_hash,evidence)
 VALUES(analysis,receipt_kind,request_sha,receipt_text) ON CONFLICT DO NOTHING;
 SELECT * INTO prior FROM atlas_defect_analysis.receipt WHERE analysis_id=analysis AND kind=receipt_kind;
 IF prior.request_hash<>request_sha OR prior.evidence<>receipt_text THEN RAISE EXCEPTION 'Defect analysis receipt conflict'; END IF;
 RETURN true;
END; $$;
REVOKE ALL ON ALL TABLES IN SCHEMA atlas_defect_analysis FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_defect_analysis FROM PUBLIC;
COMMIT;
