-- Narrow research receipts for an existing presentation_market intent.
-- No catalog, inventory, financial or grading authority is introduced.
BEGIN;
CREATE TABLE atlas_manual.research_effect (
 card_id uuid NOT NULL, request_id uuid NOT NULL, sequence integer NOT NULL CHECK(sequence BETWEEN 0 AND 128),
 event text NOT NULL CHECK(event IN ('INIT','DISPATCH','RESPONSE','FAILURE','COMPLETE')),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 evidence text NOT NULL, evidence_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(card_id,request_id,sequence,event), UNIQUE(card_id,request_id,request_hash,event),
 FOREIGN KEY(card_id,request_id) REFERENCES atlas_manual.presentation_market(card_id,request_id),
 CHECK(octet_length(evidence)<=16384 AND evidence_hash=encode(sha256(convert_to(evidence,'UTF8')),'hex')),
 CHECK((event IN ('INIT','COMPLETE'))=(sequence=0))
);
CREATE FUNCTION atlas_manual.research_effect_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,atlas_manual AS $$
DECLARE parent atlas_manual.presentation_market; prior atlas_manual.research_effect;
BEGIN
 SELECT * INTO parent FROM atlas_manual.presentation_market WHERE card_id=NEW.card_id AND request_id=NEW.request_id FOR UPDATE;
 IF parent.card_id IS NULL THEN RAISE EXCEPTION 'Missing research intent'; END IF;
 IF NEW.event='INIT' THEN
  IF parent.state<>'STARTED' OR EXISTS(SELECT 1 FROM atlas_manual.research_effect WHERE card_id=NEW.card_id AND request_id=NEW.request_id) THEN RAISE EXCEPTION 'Research initialization conflict'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM atlas_manual.research_effect WHERE card_id=NEW.card_id AND request_id=NEW.request_id AND event='INIT') THEN RAISE EXCEPTION 'Research is not initialized'; END IF;
  IF NEW.event='DISPATCH' THEN
   IF parent.state<>'STARTED' OR EXISTS(SELECT 1 FROM atlas_manual.research_effect WHERE card_id=NEW.card_id AND request_id=NEW.request_id AND event='COMPLETE')
     OR NEW.sequence<>(SELECT COALESCE(MAX(sequence),0)+1 FROM atlas_manual.research_effect WHERE card_id=NEW.card_id AND request_id=NEW.request_id) THEN RAISE EXCEPTION 'Research dispatch order conflict'; END IF;
  ELSIF NEW.event IN ('RESPONSE','FAILURE') THEN
   SELECT * INTO prior FROM atlas_manual.research_effect WHERE card_id=NEW.card_id AND request_id=NEW.request_id AND sequence=NEW.sequence AND event='DISPATCH';
   IF prior.request_hash IS DISTINCT FROM NEW.request_hash THEN RAISE EXCEPTION 'Research response binding conflict'; END IF;
  ELSIF NEW.event='COMPLETE' AND (parent.state<>'STARTED' OR EXISTS(SELECT 1 FROM atlas_manual.research_effect d WHERE d.card_id=NEW.card_id AND d.request_id=NEW.request_id AND d.event='DISPATCH' AND NOT EXISTS(SELECT 1 FROM atlas_manual.research_effect r WHERE r.card_id=d.card_id AND r.request_id=d.request_id AND r.sequence=d.sequence AND r.event IN ('RESPONSE','FAILURE')))) THEN
   RAISE EXCEPTION 'Research completion has unsettled dispatch';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER research_effect_guard BEFORE INSERT ON atlas_manual.research_effect FOR EACH ROW EXECUTE FUNCTION atlas_manual.research_effect_guard();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual.research_effect FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual.research_effect FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();
-- A late actual response may be retained after staff-session expiry. This narrow
-- function can append receipts only for a previously admitted exact dispatch.
CREATE FUNCTION atlas_manual.append_research_receipt(c uuid,r uuid,s integer,e text,h text,v text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual AS $$
DECLARE prior atlas_manual.research_effect;
BEGIN
 IF e NOT IN ('RESPONSE','FAILURE') OR octet_length(v)>16384 OR h !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid research receipt'; END IF;
 SELECT * INTO prior FROM atlas_manual.research_effect WHERE card_id=c AND request_id=r AND sequence=s AND event='DISPATCH';
 IF prior.request_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'Unadmitted research receipt'; END IF;
 INSERT INTO atlas_manual.research_effect(card_id,request_id,sequence,event,request_hash,evidence,evidence_hash)
 VALUES(c,r,s,e,h,v,encode(sha256(convert_to(v,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM atlas_manual.research_effect WHERE card_id=c AND request_id=r AND sequence=s AND event=e AND request_hash=h AND evidence=v) THEN RAISE EXCEPTION 'Research receipt conflict'; END IF;
END; $$;
REVOKE ALL ON atlas_manual.research_effect FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_manual.research_effect_guard(),atlas_manual.append_research_receipt(uuid,uuid,integer,text,text,text) FROM PUBLIC;
COMMIT;
