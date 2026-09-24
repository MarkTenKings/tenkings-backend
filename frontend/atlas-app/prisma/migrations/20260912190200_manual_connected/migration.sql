-- INACTIVE additive proposal. Apply after manual and manual-intake proposals.
-- No old application tables, history, controls or roles are modified.
BEGIN;
CREATE SCHEMA atlas_manual_connected;
REVOKE ALL ON SCHEMA atlas_manual_connected FROM PUBLIC;
CREATE TABLE atlas_manual_connected.details (
 card_id uuid PRIMARY KEY REFERENCES atlas_manual_intake.card(id),
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
 content text NOT NULL CHECK(octet_length(content) <= 16384 AND jsonb_typeof(content::jsonb)='object'),
 content_hash text NOT NULL CHECK(content_hash=encode(sha256(convert_to(content,'UTF8')),'hex'))
);
CREATE TABLE atlas_manual_connected.details_action (
 card_id uuid NOT NULL REFERENCES atlas_manual_connected.details(card_id), action_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id), request_hash text NOT NULL,
 result text NOT NULL CHECK(octet_length(result)<=32768), PRIMARY KEY(card_id,action_id)
);
CREATE TABLE atlas_manual_connected.identification (
 id uuid PRIMARY KEY, card_id uuid NOT NULL REFERENCES atlas_manual_intake.card(id),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 state text NOT NULL CHECK(state IN ('RUNNING','COMPLETE','FAILED','UNKNOWN','STALE')),
 input text NOT NULL CHECK(octet_length(input)<=16384), result text CHECK(octet_length(result)<=16384),
 error text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
 UNIQUE(card_id,source_hash)
);
CREATE TABLE atlas_manual_connected.effect (
 attempt_id uuid NOT NULL REFERENCES atlas_manual_connected.identification(id),
 stage text NOT NULL CHECK(stage IN ('OCR_FRONT','OCR_BACK','MODEL')),
 event text NOT NULL CHECK(event IN ('DISPATCH','RESPONSE','FAILURE')),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 evidence text NOT NULL CHECK(octet_length(evidence)<=16384),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(attempt_id,stage,event)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual_connected.effect FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual_connected.details_action FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE FUNCTION atlas_manual_connected.revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.card_id<>OLD.card_id OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Manual details revision conflict'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER revision_guard BEFORE UPDATE ON atlas_manual_connected.details FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.revision_guard();
CREATE FUNCTION atlas_manual_connected.identification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.card_id<>OLD.card_id OR NEW.source_hash<>OLD.source_hash OR NEW.actor_id<>OLD.actor_id
 OR NEW.input<>OLD.input OR NEW.created_at<>OLD.created_at OR OLD.state<>'RUNNING' OR NEW.state='RUNNING'
 OR NEW.finished_at IS NULL THEN RAISE EXCEPTION 'Manual identification is immutable after completion'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER identification_guard BEFORE UPDATE ON atlas_manual_connected.identification FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.identification_guard();
REVOKE ALL ON ALL TABLES IN SCHEMA atlas_manual_connected FROM PUBLIC;
-- Accounting-only late responses can be retained after the initiating human's
-- session expires. This cannot dispatch, change identity or approve a report.
CREATE FUNCTION atlas_manual_connected.append_receipt(attempt uuid, phase text, outcome text, request_sha text, receipt text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
DECLARE prior atlas_manual_connected.effect%ROWTYPE;
BEGIN
 IF outcome NOT IN ('RESPONSE','FAILURE') OR octet_length(receipt)>16384 OR jsonb_typeof(receipt::jsonb)<>'object'
 OR NOT EXISTS(SELECT 1 FROM atlas_manual_connected.effect WHERE attempt_id=attempt AND stage=phase AND event='DISPATCH' AND request_hash=request_sha)
 THEN RAISE EXCEPTION 'Exact dispatched identification effect required'; END IF;
 INSERT INTO atlas_manual_connected.effect(attempt_id,stage,event,request_hash,evidence)
 VALUES(attempt,phase,outcome,request_sha,receipt) ON CONFLICT DO NOTHING;
 SELECT * INTO prior FROM atlas_manual_connected.effect WHERE attempt_id=attempt AND stage=phase AND event=outcome;
 IF prior.request_hash<>request_sha OR prior.evidence<>receipt THEN RAISE EXCEPTION 'Identification receipt conflict'; END IF;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION atlas_manual_connected.append_receipt(uuid,text,text,text,text) FROM PUBLIC;
COMMIT;
