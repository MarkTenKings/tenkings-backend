-- Additive V4 label work. No grading, publication, NFC or historical rows change.
CREATE TABLE atlas_manual_connected.label_sheet (
 id uuid PRIMARY KEY, number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 actor_id uuid NOT NULL, access_version integer NOT NULL CHECK(access_version>0),
 pool_hash text NOT NULL CHECK(pool_hash ~ '^[a-f0-9]{64}$'),
 material_profile_id text NOT NULL, renderer_profile_hash text NOT NULL, jig_hash text NOT NULL,
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','SEALED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 manifest text, manifest_hash text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), sealed_at timestamptz,
 CHECK((state='OPEN' AND manifest IS NULL AND manifest_hash IS NULL AND sealed_at IS NULL)
 OR (state='SEALED' AND manifest IS NOT NULL AND manifest_hash ~ '^[a-f0-9]{64}$' AND sealed_at IS NOT NULL))
);
CREATE UNIQUE INDEX label_sheet_open_pool ON atlas_manual_connected.label_sheet(actor_id,pool_hash) WHERE state='OPEN';
CREATE TABLE atlas_manual_connected.label_item (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL, access_version integer NOT NULL CHECK(access_version>0),
 card_id uuid NOT NULL, action_id uuid NOT NULL, approval_version integer NOT NULL,
 source_revision integer NOT NULL, source_hash text NOT NULL, report_hash text NOT NULL, public_hash text NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('ORIGINAL','REPRINT')), original_item_id uuid REFERENCES atlas_manual_connected.label_item(id),
 request_id uuid, request_hash text, reason text,
 state text NOT NULL DEFAULT 'PENDING_RENDER' CHECK(state IN ('PENDING_RENDER','NEEDS_LAYOUT','READY','SUPERSEDED')),
 snapshot text, snapshot_hash text, print_svg text, preview_svg text, artwork_hash text,
 renderer_profile_hash text, material_profile_id text, jig_hash text,
 sheet_id uuid REFERENCES atlas_manual_connected.label_sheet(id), slot integer CHECK(slot BETWEEN 1 AND 50), previous_assignment jsonb,
 claim_id uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5), code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(card_id,action_id) REFERENCES atlas_manual.approval(card_id,action_id),
 CHECK((sheet_id IS NULL)=(slot IS NULL)), CHECK((claim_id IS NULL)=(lease_until IS NULL)),
 CHECK((purpose='ORIGINAL' AND original_item_id IS NULL AND request_id IS NULL AND request_hash IS NULL)
 OR (purpose='REPRINT' AND original_item_id IS NOT NULL AND request_id IS NOT NULL AND request_hash IS NOT NULL AND length(reason) BETWEEN 1 AND 500)),
 CHECK(state<>'READY' OR (snapshot IS NOT NULL AND snapshot_hash IS NOT NULL AND print_svg IS NOT NULL AND preview_svg IS NOT NULL AND artwork_hash IS NOT NULL AND sheet_id IS NOT NULL)),
 UNIQUE(sheet_id,slot), UNIQUE(actor_id,request_id)
);
CREATE UNIQUE INDEX label_item_original ON atlas_manual_connected.label_item(card_id,action_id) WHERE purpose='ORIGINAL';
CREATE INDEX label_item_pending ON atlas_manual_connected.label_item(created_at) WHERE state='PENDING_RENDER';
CREATE TABLE atlas_manual_connected.label_export (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL, access_version integer NOT NULL CHECK(access_version>0),
 kind text NOT NULL CHECK(kind IN ('SHEET','SINGLE')), sheet_id uuid REFERENCES atlas_manual_connected.label_sheet(id),
 item_id uuid REFERENCES atlas_manual_connected.label_item(id), sheet_revision integer,
 profile_id text NOT NULL, request_id uuid NOT NULL, request_hash text NOT NULL,
 manifest text NOT NULL, manifest_hash text NOT NULL,
 state text NOT NULL DEFAULT 'PREPARING' CHECK(state IN ('PREPARING','READY','FAILED')),
 object_ref text, sha256 text, byte_count integer, mapping text, content_type text,
 claim_id uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 51), attempt_base integer NOT NULL DEFAULT 0 CHECK(attempt_base>=0 AND attempt_base<=attempts),
 retry_requests jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(retry_requests)='array' AND jsonb_array_length(retry_requests)<=16), code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), ready_at timestamptz,
 CHECK((kind='SHEET' AND sheet_id IS NOT NULL AND item_id IS NULL AND sheet_revision IS NOT NULL) OR (kind='SINGLE' AND sheet_id IS NULL AND item_id IS NOT NULL AND sheet_revision IS NULL)),
 CHECK((claim_id IS NULL)=(lease_until IS NULL)),
 CHECK(state<>'READY' OR (object_ref IS NOT NULL AND sha256 ~ '^[a-f0-9]{64}$' AND byte_count>0 AND mapping IS NOT NULL AND content_type='image/png' AND ready_at IS NOT NULL)),
 UNIQUE(actor_id,request_id), UNIQUE(sheet_id,sheet_revision,profile_id), UNIQUE(item_id,profile_id)
);
CREATE INDEX label_export_pending ON atlas_manual_connected.label_export(created_at) WHERE state='PREPARING';
CREATE TABLE atlas_manual_connected.label_print_event (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL, request_id uuid NOT NULL, request_hash text NOT NULL,
 export_id uuid NOT NULL REFERENCES atlas_manual_connected.label_export(id), export_sha256 text NOT NULL, manifest_hash text NOT NULL,
 successful_slots integer[] NOT NULL, failed_slots integer[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(actor_id,request_id),
 CHECK(cardinality(successful_slots)>0 AND cardinality(successful_slots)<=50 AND cardinality(failed_slots)<=50)
);
CREATE FUNCTION atlas_manual_connected.guard_label_sheet() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'label sheet immutable'; END IF;
 IF OLD.state='SEALED' OR (to_jsonb(NEW)-ARRAY['state','revision','manifest','manifest_hash','sealed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','manifest','manifest_hash','sealed_at'])
 OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'label sheet immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER label_sheet_guard BEFORE UPDATE OR DELETE ON atlas_manual_connected.label_sheet FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.guard_label_sheet();
CREATE FUNCTION atlas_manual_connected.guard_label_item() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'label item immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','snapshot','snapshot_hash','print_svg','preview_svg','artwork_hash','renderer_profile_hash','material_profile_id','jig_hash','sheet_id','slot','previous_assignment','claim_id','lease_until','attempts','code','updated_at']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['state','snapshot','snapshot_hash','print_svg','preview_svg','artwork_hash','renderer_profile_hash','material_profile_id','jig_hash','sheet_id','slot','previous_assignment','claim_id','lease_until','attempts','code','updated_at']) THEN RAISE EXCEPTION 'label source immutable'; END IF;
 IF OLD.snapshot IS NOT NULL AND (NEW.snapshot,NEW.snapshot_hash,NEW.print_svg,NEW.preview_svg,NEW.artwork_hash,NEW.renderer_profile_hash,NEW.material_profile_id,NEW.jig_hash) IS DISTINCT FROM
 (OLD.snapshot,OLD.snapshot_hash,OLD.print_svg,OLD.preview_svg,OLD.artwork_hash,OLD.renderer_profile_hash,OLD.material_profile_id,OLD.jig_hash) THEN RAISE EXCEPTION 'label artwork immutable'; END IF;
 IF OLD.state='SUPERSEDED' OR (OLD.state='READY' AND NEW.state<>'SUPERSEDED') OR (OLD.state='NEEDS_LAYOUT' AND NEW.state<>'SUPERSEDED') THEN RAISE EXCEPTION 'label state immutable'; END IF;
 IF OLD.sheet_id IS NOT NULL AND (NEW.sheet_id,NEW.slot) IS DISTINCT FROM (OLD.sheet_id,OLD.slot) THEN
  IF NEW.state<>'SUPERSEDED' OR NEW.sheet_id IS NOT NULL OR NEW.previous_assignment IS DISTINCT FROM jsonb_build_object('sheetId',OLD.sheet_id,'slot',OLD.slot)
   OR NOT EXISTS(SELECT 1 FROM atlas_manual_connected.label_sheet WHERE id=OLD.sheet_id AND state='OPEN') THEN RAISE EXCEPTION 'label assignment immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER label_item_guard BEFORE UPDATE OR DELETE ON atlas_manual_connected.label_item FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.guard_label_item();
CREATE FUNCTION atlas_manual_connected.guard_label_export() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP<>'UPDATE' OR OLD.state='READY' THEN RAISE EXCEPTION 'label export immutable'; END IF;
 IF OLD.state='FAILED' THEN
  IF NEW.state<>'PREPARING' OR NEW.attempt_base<>OLD.attempts OR NEW.attempts<>OLD.attempts OR NEW.claim_id IS NOT NULL OR NEW.lease_until IS NOT NULL OR NEW.code IS NOT NULL
   OR jsonb_array_length(NEW.retry_requests)<>jsonb_array_length(OLD.retry_requests)+1
   OR COALESCE(NEW.retry_requests->-1->>'requestId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' OR COALESCE(NEW.retry_requests->-1->>'requestHash','') !~ '^[a-f0-9]{64}$'
   OR NEW.retry_requests->-1 IS DISTINCT FROM jsonb_build_object('requestId',NEW.retry_requests->-1->>'requestId','requestHash',NEW.retry_requests->-1->>'requestHash','attemptBase',OLD.attempts)
   OR NEW.retry_requests - (jsonb_array_length(NEW.retry_requests)-1) IS DISTINCT FROM OLD.retry_requests
   OR (to_jsonb(NEW)-ARRAY['state','attempt_base','retry_requests','code','claim_id','lease_until']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','attempt_base','retry_requests','code','claim_id','lease_until'])
   THEN RAISE EXCEPTION 'label retry intent invalid'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 THEN RAISE EXCEPTION 'label attempt invalid'; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','object_ref','sha256','byte_count','mapping','content_type','claim_id','lease_until','attempts','code','ready_at']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['state','object_ref','sha256','byte_count','mapping','content_type','claim_id','lease_until','attempts','code','ready_at']) THEN RAISE EXCEPTION 'label export binding immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER label_export_guard BEFORE UPDATE OR DELETE ON atlas_manual_connected.label_export FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.guard_label_export();
CREATE FUNCTION atlas_manual_connected.label_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'label history immutable'; END $$;
CREATE TRIGGER label_print_event_guard BEFORE UPDATE OR DELETE ON atlas_manual_connected.label_print_event FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.label_append_only();
CREATE TRIGGER label_sheet_no_truncate BEFORE TRUNCATE ON atlas_manual_connected.label_sheet FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual_connected.label_append_only();
CREATE TRIGGER label_item_no_truncate BEFORE TRUNCATE ON atlas_manual_connected.label_item FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual_connected.label_append_only();
CREATE TRIGGER label_export_no_truncate BEFORE TRUNCATE ON atlas_manual_connected.label_export FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual_connected.label_append_only();
CREATE TRIGGER label_print_event_no_truncate BEFORE TRUNCATE ON atlas_manual_connected.label_print_event FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual_connected.label_append_only();
REVOKE ALL ON FUNCTION atlas_manual_connected.guard_label_sheet(),atlas_manual_connected.guard_label_item(),atlas_manual_connected.guard_label_export(),atlas_manual_connected.label_append_only() FROM PUBLIC;
