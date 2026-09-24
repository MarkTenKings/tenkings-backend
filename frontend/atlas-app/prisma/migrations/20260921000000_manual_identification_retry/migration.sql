-- Explicit human-requested recovery retains the original attempt and receipts.
-- No existing application row, control, role or receipt is updated or deleted.
BEGIN;
ALTER TABLE atlas_manual_connected.identification
 ADD COLUMN retry_of uuid REFERENCES atlas_manual_connected.identification(id),
 ADD COLUMN retry_action_id uuid,
 ADD COLUMN evidence_attempt_id uuid REFERENCES atlas_manual_connected.identification(id),
 ADD CONSTRAINT identification_retry_lineage_complete CHECK (
   (retry_of IS NULL AND retry_action_id IS NULL AND evidence_attempt_id IS NULL)
   OR (retry_of IS NOT NULL AND retry_action_id IS NOT NULL AND evidence_attempt_id IS NOT NULL)
 );
ALTER TABLE atlas_manual_connected.identification
 DROP CONSTRAINT identification_card_id_source_hash_key;
CREATE UNIQUE INDEX identification_root_source_unique
 ON atlas_manual_connected.identification(card_id,source_hash) WHERE retry_of IS NULL;
CREATE UNIQUE INDEX identification_retry_parent_unique
 ON atlas_manual_connected.identification(retry_of) WHERE retry_of IS NOT NULL;
CREATE UNIQUE INDEX identification_retry_action_unique
 ON atlas_manual_connected.identification(card_id,retry_action_id) WHERE retry_action_id IS NOT NULL;

CREATE FUNCTION atlas_manual_connected.identification_retry_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,atlas_manual_connected AS $$
DECLARE parent atlas_manual_connected.identification%ROWTYPE;
BEGIN
 IF NEW.retry_of IS NULL THEN RETURN NEW; END IF;
 -- The immutable parent remains UNKNOWN. Its row lock and unique child index
 -- serialize concurrent claims without resetting or replacing any history.
 SELECT * INTO parent FROM atlas_manual_connected.identification WHERE id=NEW.retry_of FOR UPDATE;
 IF NOT FOUND OR parent.id=NEW.id OR parent.state<>'UNKNOWN' OR parent.finished_at IS NULL OR parent.result IS NOT NULL
 OR NEW.state<>'RUNNING' OR NEW.result IS NOT NULL OR NEW.error IS NOT NULL OR NEW.finished_at IS NOT NULL
 OR NEW.card_id IS DISTINCT FROM parent.card_id OR NEW.source_hash IS DISTINCT FROM parent.source_hash
 OR NEW.input IS DISTINCT FROM parent.input
 OR NEW.evidence_attempt_id IS DISTINCT FROM coalesce(parent.evidence_attempt_id,parent.id)
 OR NOT EXISTS (SELECT 1 FROM atlas_manual_connected.identification root
   WHERE root.id=NEW.evidence_attempt_id AND root.retry_of IS NULL AND root.retry_action_id IS NULL
     AND root.evidence_attempt_id IS NULL AND root.card_id=NEW.card_id
     AND root.source_hash=NEW.source_hash AND root.input=NEW.input)
 OR NOT EXISTS (SELECT 1 FROM atlas_manual_connected.effect dispatch
   JOIN atlas_manual_connected.effect response ON response.attempt_id=dispatch.attempt_id
     AND response.stage=dispatch.stage AND response.request_hash=dispatch.request_hash AND response.event='RESPONSE'
   WHERE dispatch.attempt_id=parent.id AND dispatch.stage='MODEL' AND dispatch.event='DISPATCH')
 THEN RAISE EXCEPTION 'Exact terminal identification and retained model receipts required'; END IF;
 -- The application verifies the exact retained response artifact is the
 -- allowlisted credit-balance rejection before claiming this successor.
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION atlas_manual_connected.identification_retry_guard() FROM PUBLIC;
CREATE TRIGGER identification_retry_guard BEFORE INSERT ON atlas_manual_connected.identification
 FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.identification_retry_guard();

CREATE OR REPLACE FUNCTION atlas_manual_connected.identification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.card_id<>OLD.card_id OR NEW.source_hash<>OLD.source_hash OR NEW.actor_id<>OLD.actor_id
 OR NEW.input<>OLD.input OR NEW.created_at<>OLD.created_at OR OLD.state<>'RUNNING' OR NEW.state='RUNNING'
 OR NEW.retry_of IS DISTINCT FROM OLD.retry_of OR NEW.retry_action_id IS DISTINCT FROM OLD.retry_action_id
 OR NEW.evidence_attempt_id IS DISTINCT FROM OLD.evidence_attempt_id
 OR NEW.finished_at IS NULL THEN RAISE EXCEPTION 'Manual identification is immutable after completion'; END IF;
 RETURN NEW;
END; $$;
COMMIT;
