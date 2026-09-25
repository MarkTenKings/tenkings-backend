-- Durable, bounded successors for a proven provider rate-limit refusal only.
-- Existing jobs retain their original action and all immutable provider history.
BEGIN;
ALTER TABLE atlas_manual_connected.batch_grading
  ADD COLUMN analysis_attempt integer NOT NULL DEFAULT 0 CHECK (analysis_attempt BETWEEN 0 AND 3);

CREATE INDEX batch_grading_due ON atlas_manual_connected.batch_grading(available_at,created_at,key)
  WHERE state IN ('QUEUED','RUNNING','NEEDS_ATTENTION');

CREATE FUNCTION atlas_manual_connected.guard_batch_analysis_successor() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE action_hash text; expected_action uuid;
BEGIN
  IF NEW.analysis_action_id=OLD.analysis_action_id AND NEW.analysis_attempt=OLD.analysis_attempt THEN RETURN NEW; END IF;
  IF OLD.state<>'RUNNING' OR OLD.stage<>'ANALYZE' OR OLD.claim_id IS NULL
    OR OLD.lease_until<=clock_timestamp() OR NEW.state<>'QUEUED' OR NEW.stage<>'ANALYZE'
    OR NEW.claim_id IS NOT NULL OR NEW.lease_until IS NOT NULL OR NEW.analysis_reserved
    OR NEW.analysis_attempt<>OLD.analysis_attempt+1 OR NEW.analysis_attempt>3
    OR NEW.key<>OLD.key OR NEW.card_id<>OLD.card_id OR NEW.actor_id<>OLD.actor_id
    OR NEW.source_hash<>OLD.source_hash OR NEW.access_version<>OLD.access_version THEN
    RAISE EXCEPTION 'BATCH_RATE_LIMIT_RETRY_UNPROVEN';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.run r
    JOIN atlas_defect_analysis.receipt p ON p.analysis_id=r.id AND p.kind='RESPONSE'
    WHERE r.card_id=OLD.card_id AND r.action_id=OLD.analysis_action_id AND r.actor_id=OLD.actor_id
      AND p.evidence::jsonb->>'state'='REFUSED' AND p.evidence::jsonb->>'httpStatus'='429'
      AND p.evidence::jsonb->>'code'='DEFECT_ANALYSIS_PROVIDER_HTTP_ERROR'
      AND p.evidence::jsonb->>'responseId' IS NULL
      AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.provider_event e WHERE e.analysis_id=r.id AND e.kind='ACCEPTED')) THEN
    RAISE EXCEPTION 'BATCH_RATE_LIMIT_RETRY_UNPROVEN';
  END IF;
  action_hash:=encode(sha256(convert_to(array_to_json(ARRAY['atlas-astra-batch-v1',OLD.key,
    'ANALYZE_RETRY_'||NEW.analysis_attempt::text])::text,'UTF8')),'hex');
  expected_action:=(substr(action_hash,1,8)||'-'||substr(action_hash,9,4)||'-4'||substr(action_hash,14,3)
    ||'-a'||substr(action_hash,18,3)||'-'||substr(action_hash,21,12))::uuid;
  IF NEW.analysis_action_id<>expected_action
    OR NEW.evidence::jsonb->'analysisActions' IS DISTINCT FROM
      (COALESCE(OLD.evidence::jsonb->'analysisActions','[]'::jsonb)||to_jsonb(OLD.analysis_action_id::text))
    OR NEW.available_at<clock_timestamp()+interval '25 seconds' THEN
    RAISE EXCEPTION 'BATCH_RATE_LIMIT_RETRY_BINDING_INVALID';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION atlas_manual_connected.guard_batch_analysis_successor() FROM PUBLIC;
CREATE TRIGGER batch_analysis_successor BEFORE UPDATE OF analysis_action_id,analysis_attempt
  ON atlas_manual_connected.batch_grading FOR EACH ROW
  EXECUTE FUNCTION atlas_manual_connected.guard_batch_analysis_successor();
COMMIT;
