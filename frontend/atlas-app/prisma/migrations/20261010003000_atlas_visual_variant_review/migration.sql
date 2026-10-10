BEGIN;
CREATE TABLE atlas_manual_connected.variant_job (
 key text PRIMARY KEY CHECK(key ~ '^[a-f0-9]{64}$'), card_id uuid NOT NULL REFERENCES atlas_manual.card(id),actor_id uuid NOT NULL,
 access_version integer NOT NULL CHECK(access_version>0),policy text NOT NULL,generation uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),identity_revision integer NOT NULL CHECK(identity_revision>0),identity_hash text NOT NULL CHECK(identity_hash ~ '^[a-f0-9]{64}$'),
 input text NOT NULL CHECK(octet_length(input)<=16384 AND jsonb_typeof(input::jsonb)='object'), input_hash text NOT NULL CHECK(input_hash=encode(sha256(convert_to(input,'UTF8')),'hex')),
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN('QUEUED','RUNNING','REQUESTED','READY','FAILED','UNKNOWN','STALE')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 6),claim_id uuid,lease_until timestamptz,dispatch_id uuid,
 catalog text,catalog_hash text,response text,response_hash text,result text,result_hash text,code text,
 audit jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(audit)='array' AND octet_length(audit::text)<=65536),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(card_id,source_hash,identity_revision,policy,generation),
 CHECK((state IN('RUNNING','REQUESTED'))=(claim_id IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(state IN('RUNNING','REQUESTED') OR (claim_id IS NULL AND lease_until IS NULL)),
 CHECK((catalog IS NULL)=(catalog_hash IS NULL)),CHECK(catalog IS NULL OR octet_length(catalog)<=1048576 AND jsonb_typeof(catalog::jsonb)='object' AND catalog_hash ~ '^[a-f0-9]{64}$'),
 CHECK((response IS NULL)=(response_hash IS NULL)),CHECK(response IS NULL OR dispatch_id IS NOT NULL AND octet_length(response)<=8388608 AND jsonb_typeof(response::jsonb)='object' AND response_hash=encode(sha256(convert_to(response,'UTF8')),'hex')),
 CHECK((result IS NULL)=(result_hash IS NULL)),CHECK(result IS NULL OR octet_length(result)<=2097152 AND jsonb_typeof(result::jsonb)='object' AND result_hash=encode(sha256(convert_to(result,'UTF8')),'hex')),
 CHECK(state<>'READY' OR result IS NOT NULL),CHECK(state<>'REQUESTED' OR dispatch_id IS NOT NULL),CHECK(code IS NULL OR code ~ '^[A-Z][A-Z0-9_]{0,100}$')
);
CREATE INDEX variant_job_pending ON atlas_manual_connected.variant_job(available_at,created_at,key) WHERE state IN('QUEUED','RUNNING','REQUESTED','UNKNOWN');
CREATE TABLE atlas_manual_connected.variant_catalog_cache (
 key text NOT NULL,snapshot text NOT NULL CHECK(octet_length(snapshot)<=8388608 AND jsonb_typeof(snapshot::jsonb)='object'),snapshot_hash text NOT NULL CHECK(snapshot_hash=encode(sha256(convert_to(snapshot,'UTF8')),'hex')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL, PRIMARY KEY(key,snapshot_hash)
);
CREATE INDEX variant_catalog_cache_latest ON atlas_manual_connected.variant_catalog_cache(key,created_at DESC);
CREATE TABLE atlas_manual_connected.variant_confirmation (
 card_id uuid NOT NULL,action_id uuid PRIMARY KEY,actor_id uuid NOT NULL,source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),identity_revision integer NOT NULL CHECK(identity_revision>0),identity_hash text NOT NULL CHECK(identity_hash ~ '^[a-f0-9]{64}$'),
 job_key text REFERENCES atlas_manual_connected.variant_job(key),result_hash text,catalog_hash text,candidate_id text,
 decision text NOT NULL CHECK(decision IN('SELECTED','MANUAL','UNRESOLVED')),observed_features text,
 reprocess_required boolean NOT NULL,analysis_action_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(card_id,action_id) REFERENCES atlas_manual.action(card_id,action_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK(decision<>'SELECTED' OR job_key IS NOT NULL AND result_hash IS NOT NULL AND catalog_hash IS NOT NULL AND candidate_id IS NOT NULL),
 CHECK(decision<>'MANUAL' OR length(btrim(observed_features)) BETWEEN 1 AND 1000)
);
CREATE INDEX variant_confirmation_current ON atlas_manual_connected.variant_confirmation(card_id,source_hash,identity_revision,identity_hash,created_at DESC);
CREATE TABLE atlas_manual_connected.variant_contribution (
 action_id uuid PRIMARY KEY REFERENCES atlas_manual_connected.variant_confirmation(action_id),card_id uuid NOT NULL REFERENCES atlas_manual.card(id),actor_id uuid NOT NULL,access_version integer NOT NULL CHECK(access_version>0),
 payload text NOT NULL CHECK(octet_length(payload)<=2097152 AND jsonb_typeof(payload::jsonb)='object'),payload_hash text NOT NULL CHECK(payload_hash=encode(sha256(convert_to(payload,'UTF8')),'hex')),
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN('QUEUED','RUNNING','READY','FAILED')),attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 6),claim_id uuid,lease_until timestamptz,
 receipt text,receipt_hash text,reference_packet text,reference_packet_hash text,code text,available_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((state='RUNNING')=(claim_id IS NOT NULL AND lease_until IS NOT NULL)),CHECK(state='RUNNING' OR claim_id IS NULL AND lease_until IS NULL),
 CHECK((reference_packet IS NULL)=(reference_packet_hash IS NULL)),CHECK(reference_packet IS NULL OR octet_length(reference_packet)<=16384 AND jsonb_typeof(reference_packet::jsonb)='object' AND reference_packet_hash=encode(sha256(convert_to(reference_packet,'UTF8')),'hex')),
 CHECK((receipt IS NULL)=(receipt_hash IS NULL)),CHECK(receipt IS NULL OR octet_length(receipt)<=65536 AND receipt_hash=encode(sha256(convert_to(receipt,'UTF8')),'hex')),CHECK(state<>'READY' OR receipt IS NOT NULL)
);
CREATE FUNCTION atlas_manual_connected.variant_contribution_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Variant contribution history is immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'QUEUED' OR NEW.attempts<>0 OR NEW.receipt IS NOT NULL OR NEW.reference_packet IS NOT NULL OR NOT EXISTS(SELECT 1 FROM atlas_manual_connected.variant_confirmation v WHERE v.action_id=NEW.action_id AND v.card_id=NEW.card_id AND v.actor_id=NEW.actor_id AND v.decision IN('SELECTED','MANUAL') AND v.source_hash=NEW.payload::jsonb->>'sourceHash' AND v.identity_hash=NEW.payload::jsonb->>'identityHash') THEN RAISE EXCEPTION 'Variant contribution requires human confirmation'; END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['state','attempts','claim_id','lease_until','receipt','receipt_hash','reference_packet','reference_packet_hash','code','available_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','attempts','claim_id','lease_until','receipt','receipt_hash','reference_packet','reference_packet_hash','code','available_at']) OR NEW.attempts<OLD.attempts
 OR OLD.reference_packet IS NULL AND NEW.reference_packet IS NOT NULL AND (OLD.state<>'RUNNING' OR NEW.state<>'RUNNING' OR NEW.claim_id IS DISTINCT FROM OLD.claim_id OR OLD.lease_until<=clock_timestamp() OR COALESCE(jsonb_typeof(OLD.payload::jsonb->'referencePermission'),'null')<>'object')
 OR OLD.reference_packet IS NOT NULL AND ROW(NEW.reference_packet,NEW.reference_packet_hash) IS DISTINCT FROM ROW(OLD.reference_packet,OLD.reference_packet_hash)
 OR OLD.receipt IS NOT NULL AND ROW(NEW.receipt,NEW.receipt_hash) IS DISTINCT FROM ROW(OLD.receipt,OLD.receipt_hash) OR OLD.state IN('READY','FAILED') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Variant contribution evidence is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER variant_contribution_guard BEFORE INSERT OR UPDATE OR DELETE ON atlas_manual_connected.variant_contribution FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.variant_contribution_guard();
CREATE TRIGGER variant_contribution_truncate BEFORE TRUNCATE ON atlas_manual_connected.variant_contribution FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();
CREATE FUNCTION atlas_manual_connected.variant_job_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Variant history is immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'QUEUED' OR NEW.attempts<>0 OR NEW.catalog IS NOT NULL OR NEW.response IS NOT NULL OR NEW.result IS NOT NULL OR NEW.dispatch_id IS NOT NULL OR NEW.audit<>'[]'::jsonb
    OR NOT EXISTS(SELECT 1 FROM atlas_manual.card c WHERE c.id=NEW.card_id AND c.owner_id=NEW.actor_id AND c.content::jsonb->'source'->>'sourceHash'=NEW.source_hash AND (c.content::jsonb->>'identityRevision')::int=NEW.identity_revision)
  THEN RAISE EXCEPTION 'Variant job requires current immutable source'; END IF; RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['state','attempts','claim_id','lease_until','dispatch_id','catalog','catalog_hash','response','response_hash','result','result_hash','code','available_at','updated_at','audit']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','attempts','claim_id','lease_until','dispatch_id','catalog','catalog_hash','response','response_hash','result','result_hash','code','available_at','updated_at','audit'])
 OR NEW.attempts<OLD.attempts
 OR OLD.catalog IS NOT NULL AND ROW(NEW.catalog,NEW.catalog_hash) IS DISTINCT FROM ROW(OLD.catalog,OLD.catalog_hash)
 OR OLD.response IS NOT NULL AND ROW(NEW.response,NEW.response_hash) IS DISTINCT FROM ROW(OLD.response,OLD.response_hash)
 OR OLD.dispatch_id IS NULL AND NEW.dispatch_id IS NOT NULL AND (NEW.state<>'REQUESTED' OR NEW.catalog IS NULL OR NEW.audit->-1->>'event'<>'DISPATCH' OR NEW.audit->-1->>'id'<>NEW.dispatch_id::text)
 OR OLD.dispatch_id IS NOT NULL AND NEW.dispatch_id IS DISTINCT FROM OLD.dispatch_id
 OR OLD.result IS NOT NULL AND ROW(NEW.result,NEW.result_hash) IS DISTINCT FROM ROW(OLD.result,OLD.result_hash)
 OR OLD.state IN('READY','FAILED','STALE') AND NEW.state IS DISTINCT FROM OLD.state
 OR OLD.state='UNKNOWN' AND NEW.state NOT IN('UNKNOWN','STALE') AND NEW.response IS NULL
 OR jsonb_array_length(NEW.audit)<jsonb_array_length(OLD.audit)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.audit) WITH ORDINALITY a(value,n) WHERE NEW.audit->(a.n::int-1) IS DISTINCT FROM a.value)
 THEN RAISE EXCEPTION 'Variant evidence is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER variant_job_guard BEFORE INSERT OR UPDATE OR DELETE ON atlas_manual_connected.variant_job FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.variant_job_guard();
CREATE TRIGGER variant_job_truncate BEFORE TRUNCATE ON atlas_manual_connected.variant_job FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();
CREATE FUNCTION atlas_manual_connected.variant_confirmation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE a record;
BEGIN
 SELECT * INTO a FROM atlas_manual.action WHERE card_id=NEW.card_id AND action_id=NEW.action_id;
 IF a IS NULL OR a.actor_id<>NEW.actor_id OR a.request::jsonb->'action'->>'type'<>'VARIANT_CONFIRM' OR a.request::jsonb->'action'->>'decision'<>NEW.decision OR a.request::jsonb->'action'->>'sourceHash'<>NEW.source_hash OR (a.result::jsonb->'card'->'draft'->>'identityRevision')::int<>NEW.identity_revision
 OR (a.request::jsonb->'action'->>'candidateId') IS DISTINCT FROM NEW.candidate_id
 OR (a.request::jsonb->'action'->>'resultHash') IS DISTINCT FROM NEW.result_hash
 THEN RAISE EXCEPTION 'Variant confirmation requires exact human action'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER variant_confirmation_guard AFTER INSERT ON atlas_manual_connected.variant_confirmation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.variant_confirmation_guard();
CREATE TRIGGER variant_confirmation_immutable BEFORE UPDATE OR DELETE ON atlas_manual_connected.variant_confirmation FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER variant_confirmation_truncate BEFORE TRUNCATE ON atlas_manual_connected.variant_confirmation FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER variant_catalog_immutable BEFORE UPDATE OR DELETE ON atlas_manual_connected.variant_catalog_cache FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER variant_catalog_truncate BEFORE TRUNCATE ON atlas_manual_connected.variant_catalog_cache FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();
REVOKE ALL ON atlas_manual_connected.variant_contribution FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_manual_connected.variant_contribution_guard() FROM PUBLIC;
REVOKE ALL ON atlas_manual_connected.variant_job,atlas_manual_connected.variant_catalog_cache,atlas_manual_connected.variant_confirmation FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_manual_connected.variant_confirmation_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_manual_connected.variant_job_guard() FROM PUBLIC;
COMMIT;
