-- INACTIVE candidate. Deploy only with reviewed dedicated-role grants and runtime flag.
BEGIN;
CREATE TABLE atlas_manual.presentation_upload (
 id uuid PRIMARY KEY, card_id uuid NOT NULL, approval_action_id uuid NOT NULL,
 request_id uuid NOT NULL, actor_id uuid NOT NULL, request text NOT NULL, request_hash text NOT NULL,
 plan text NOT NULL, plan_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(card_id,request_id), FOREIGN KEY(card_id,approval_action_id) REFERENCES atlas_manual.publication(card_id,action_id),
 CHECK(octet_length(request)<=4096 AND request_hash=encode(sha256(convert_to(request,'UTF8')),'hex')),
 CHECK(octet_length(plan)<=8192 AND plan_hash=encode(sha256(convert_to(plan,'UTF8')),'hex'))
);
CREATE TABLE atlas_manual.presentation (
 card_id uuid NOT NULL, approval_action_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 request_id uuid NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'), actor_id uuid NOT NULL,
 presentation text NOT NULL, presentation_hash text NOT NULL, media text, media_hash text, market_source text, market_source_hash text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(card_id,approval_action_id,revision), UNIQUE(card_id,request_id),
 FOREIGN KEY(card_id,approval_action_id) REFERENCES atlas_manual.publication(card_id,action_id),
 CHECK(octet_length(presentation)<=262144 AND presentation_hash=encode(sha256(convert_to(presentation,'UTF8')),'hex')),
 CHECK((media IS NULL AND media_hash IS NULL) OR (media IS NOT NULL AND media_hash IS NOT NULL AND octet_length(media)<=32768 AND media_hash=encode(sha256(convert_to(media,'UTF8')),'hex'))),
 CHECK((market_source IS NULL AND market_source_hash IS NULL) OR (market_source IS NOT NULL AND market_source_hash IS NOT NULL AND octet_length(market_source)<=32768 AND market_source_hash=encode(sha256(convert_to(market_source,'UTF8')),'hex')))
);
CREATE TABLE atlas_manual.presentation_market (
 card_id uuid NOT NULL, approval_action_id uuid NOT NULL, request_id uuid NOT NULL, actor_id uuid NOT NULL,
 request text NOT NULL, request_hash text NOT NULL, state text NOT NULL DEFAULT 'STARTED' CHECK(state IN ('STARTED','READY','UNAVAILABLE','UNKNOWN')),
 result text, result_hash text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(card_id,request_id), FOREIGN KEY(card_id,approval_action_id) REFERENCES atlas_manual.publication(card_id,action_id),
 CHECK(octet_length(request)<=4096 AND request_hash=encode(sha256(convert_to(request,'UTF8')),'hex')),
 CHECK((state='STARTED' AND result IS NULL AND result_hash IS NULL) OR (state<>'STARTED' AND result IS NOT NULL AND result_hash IS NOT NULL AND octet_length(result)<=8192 AND result_hash=encode(sha256(convert_to(result,'UTF8')),'hex')))
);
CREATE FUNCTION atlas_manual.presentation_market_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,atlas_manual AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'STARTED' THEN RAISE EXCEPTION 'Market request starts pending'; END IF;
 ELSIF OLD.state<>'STARTED' OR NEW.state='STARTED' OR (to_jsonb(NEW)-ARRAY['state','result','result_hash']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','result','result_hash']) THEN
  RAISE EXCEPTION 'Market request result is immutable';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER market_guard BEFORE INSERT OR UPDATE ON atlas_manual.presentation_market FOR EACH ROW EXECUTE FUNCTION atlas_manual.presentation_market_guard();
CREATE TRIGGER immutable BEFORE DELETE ON atlas_manual.presentation_market FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual.presentation_market FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual.presentation_upload FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual.presentation_upload FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual.presentation FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual.presentation FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();
REVOKE ALL ON atlas_manual.presentation,atlas_manual.presentation_upload,atlas_manual.presentation_market FROM PUBLIC;
COMMIT;
