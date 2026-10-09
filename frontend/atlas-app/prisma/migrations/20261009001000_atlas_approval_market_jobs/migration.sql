-- One approval-bound durable job, with optional explicit refresh attempts.
-- No existing report, approval, market preview or customer record is rewritten.
BEGIN;
CREATE TABLE atlas_manual_connected.market_job (
 request_id uuid PRIMARY KEY, card_id uuid NOT NULL, approval_action_id uuid NOT NULL,
 actor_id uuid NOT NULL, access_version integer NOT NULL CHECK(access_version>0),
 mode text NOT NULL CHECK(mode IN('LOCAL_FIXTURE','PRODUCTION')),
 origin text NOT NULL CHECK(origin IN('APPROVAL','REFRESH','BACKFILL')),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 report_hash text NOT NULL CHECK(report_hash ~ '^[a-f0-9]{64}$'),
 public_hash text CHECK(public_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN('QUEUED','RUNNING','REQUESTED','READY','FAILED','UNKNOWN','UNAVAILABLE')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 6), recoveries integer NOT NULL DEFAULT 0 CHECK(recoveries>=0),
 claim_id uuid, lease_until timestamptz, dispatch_id uuid,
 response text, response_hash text, code text CHECK(code ~ '^[A-Z][A-Z0-9_]{0,100}$'),
 audit jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(audit)='array' AND jsonb_array_length(audit)<=2048 AND octet_length(audit::text)<=262144),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(card_id,request_id) REFERENCES atlas_manual.presentation_market(card_id,request_id),
 FOREIGN KEY(card_id,approval_action_id) REFERENCES atlas_manual.approval(card_id,action_id),
 CHECK((state IN('RUNNING','REQUESTED'))=(claim_id IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(state IN('RUNNING','REQUESTED') OR (claim_id IS NULL AND lease_until IS NULL)),
 CHECK(state<>'REQUESTED' OR (dispatch_id=claim_id AND public_hash IS NOT NULL)),
 CHECK(state<>'READY' OR response IS NOT NULL),
 CHECK((response IS NULL)=(response_hash IS NULL)),
 CHECK(response IS NULL OR (dispatch_id IS NOT NULL AND octet_length(response)<=524288
   AND jsonb_typeof(response::jsonb)='object' AND response_hash=encode(sha256(convert_to(response,'UTF8')),'hex')))
);
CREATE UNIQUE INDEX market_job_one_approval ON atlas_manual_connected.market_job(card_id,approval_action_id) WHERE origin IN('APPROVAL','BACKFILL');
CREATE INDEX market_job_pending ON atlas_manual_connected.market_job(available_at,created_at,request_id) WHERE state IN('QUEUED','RUNNING','REQUESTED','UNKNOWN');
CREATE INDEX market_job_latest ON atlas_manual_connected.market_job(card_id,approval_action_id,created_at DESC);
CREATE FUNCTION atlas_manual_connected.market_job_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'QUEUED' OR NEW.attempts<>0 OR NEW.recoveries<>0 OR NEW.public_hash IS NOT NULL OR NEW.response IS NOT NULL OR NEW.dispatch_id IS NOT NULL OR NEW.audit<>'[]'::jsonb
   OR NOT EXISTS(SELECT 1 FROM atlas_manual.approval a JOIN atlas_manual.publication p USING(card_id,action_id)
    JOIN atlas_manual.presentation_market m ON m.card_id=a.card_id AND m.approval_action_id=a.action_id
    WHERE a.card_id=NEW.card_id AND a.action_id=NEW.approval_action_id AND a.source_hash=NEW.source_hash AND a.report_hash=NEW.report_hash
    AND p.mode=NEW.mode AND m.request_id=NEW.request_id AND m.actor_id=NEW.actor_id AND m.state='STARTED')
  THEN RAISE EXCEPTION 'Market job requires exact approval reservation'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Market job history is retained'; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','attempts','recoveries','claim_id','lease_until','dispatch_id','public_hash','response','response_hash','code','available_at','updated_at','audit'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','attempts','recoveries','claim_id','lease_until','dispatch_id','public_hash','response','response_hash','code','available_at','updated_at','audit'])
  OR (NEW.attempts<OLD.attempts OR NEW.recoveries<>OLD.recoveries)
    AND NOT(OLD.state='FAILED' AND NEW.state='QUEUED' AND OLD.response IS NOT NULL AND NEW.attempts=0 AND NEW.recoveries=OLD.recoveries+1
      AND NEW.audit->-1->>'event'='RECOVERY' AND jsonb_array_length(NEW.audit)=jsonb_array_length(OLD.audit)+1)
  OR OLD.public_hash IS NOT NULL AND NEW.public_hash IS DISTINCT FROM OLD.public_hash
  OR OLD.response IS NOT NULL AND ROW(NEW.response,NEW.response_hash,NEW.dispatch_id) IS DISTINCT FROM ROW(OLD.response,OLD.response_hash,OLD.dispatch_id)
  OR OLD.state IN('READY','FAILED','UNAVAILABLE')
    AND NOT(OLD.state='FAILED' AND NEW.state='QUEUED' AND OLD.response IS NOT NULL AND NEW.attempts=0 AND NEW.recoveries=OLD.recoveries+1
      AND NEW.audit->-1->>'event'='RECOVERY' AND jsonb_array_length(NEW.audit)=jsonb_array_length(OLD.audit)+1) AND (to_jsonb(NEW)-ARRAY['response','response_hash','updated_at','audit']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['response','response_hash','updated_at','audit'])
  OR jsonb_array_length(NEW.audit)<jsonb_array_length(OLD.audit)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.audit) WITH ORDINALITY a(value,n) WHERE NEW.audit->(a.n::integer-1) IS DISTINCT FROM a.value)
  OR OLD.state='UNKNOWN' AND NEW.state NOT IN('UNKNOWN','QUEUED','FAILED')
  OR OLD.state='UNKNOWN' AND NEW.state<>'UNKNOWN' AND NEW.response IS NULL
 THEN RAISE EXCEPTION 'Market approval binding and response are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER market_job_guard BEFORE INSERT OR UPDATE OR DELETE ON atlas_manual_connected.market_job FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.market_job_guard();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual_connected.market_job FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();
REVOKE ALL ON atlas_manual_connected.market_job FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_manual_connected.market_job_guard() FROM PUBLIC;
COMMIT;
