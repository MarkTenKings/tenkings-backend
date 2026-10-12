-- Extend the existing bounded successor guard to definite transient HTTP refusals.
-- Preserve all prior actions/receipts, the three-retry budget and lease/backoff guards.
-- No rows, grants, trigger bindings or attempt counters are rewritten.
BEGIN;
CREATE OR REPLACE FUNCTION atlas_manual_connected.guard_batch_analysis_successor() RETURNS trigger
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
      AND p.evidence::jsonb->>'state'='REFUSED' AND p.evidence::jsonb->>'httpStatus' IN ('429','500','502','503','504')
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
COMMIT;
