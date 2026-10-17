-- A failed, unprinted label gets a new generation. No historical source/artwork is rewritten.
DO $$ DECLARE c record; n integer:=0; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='atlas_manual_connected.label_item'::regclass
  AND contype='c' AND pg_get_constraintdef(oid) LIKE '%purpose%' LOOP
  EXECUTE format('ALTER TABLE atlas_manual_connected.label_item DROP CONSTRAINT %I',c.conname); n:=n+1;
 END LOOP;
 IF n<>2 THEN RAISE EXCEPTION 'unexpected label purpose constraints'; END IF;
END $$;
ALTER TABLE atlas_manual_connected.label_item
 ADD CONSTRAINT label_item_purpose_v2 CHECK(purpose IN ('ORIGINAL','REPRINT','LAYOUT_RETRY')),
 ADD CONSTRAINT label_item_purpose_binding_v2 CHECK(
  (purpose='ORIGINAL' AND original_item_id IS NULL AND request_id IS NULL AND request_hash IS NULL)
  OR (purpose IN ('REPRINT','LAYOUT_RETRY') AND original_item_id IS NOT NULL AND request_id IS NOT NULL AND request_hash IS NOT NULL AND request_hash ~ '^[a-f0-9]{64}$' AND length(reason) BETWEEN 1 AND 500)),
 ADD CONSTRAINT label_item_retry_target CHECK(purpose<>'LAYOUT_RETRY' OR
  (renderer_profile_hash IS NOT NULL AND renderer_profile_hash ~ '^[a-f0-9]{64}$' AND material_profile_id IS NOT NULL
   AND length(material_profile_id) BETWEEN 1 AND 200 AND jig_hash IS NOT NULL AND jig_hash ~ '^[a-f0-9]{64}$'));
CREATE UNIQUE INDEX label_item_layout_successor ON atlas_manual_connected.label_item(original_item_id) WHERE purpose='LAYOUT_RETRY';
CREATE OR REPLACE FUNCTION atlas_manual_connected.guard_label_item() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'label item immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','snapshot','snapshot_hash','print_svg','preview_svg','artwork_hash','renderer_profile_hash','material_profile_id','jig_hash','sheet_id','slot','previous_assignment','claim_id','lease_until','attempts','code','updated_at']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['state','snapshot','snapshot_hash','print_svg','preview_svg','artwork_hash','renderer_profile_hash','material_profile_id','jig_hash','sheet_id','slot','previous_assignment','claim_id','lease_until','attempts','code','updated_at']) THEN RAISE EXCEPTION 'label source immutable'; END IF;
 IF OLD.purpose='LAYOUT_RETRY' AND (NEW.renderer_profile_hash,NEW.material_profile_id,NEW.jig_hash) IS DISTINCT FROM
 (OLD.renderer_profile_hash,OLD.material_profile_id,OLD.jig_hash) THEN RAISE EXCEPTION 'label retry target immutable'; END IF;
 IF OLD.snapshot IS NOT NULL AND (NEW.snapshot,NEW.snapshot_hash,NEW.print_svg,NEW.preview_svg,NEW.artwork_hash,NEW.renderer_profile_hash,NEW.material_profile_id,NEW.jig_hash) IS DISTINCT FROM
 (OLD.snapshot,OLD.snapshot_hash,OLD.print_svg,OLD.preview_svg,OLD.artwork_hash,OLD.renderer_profile_hash,OLD.material_profile_id,OLD.jig_hash) THEN RAISE EXCEPTION 'label artwork immutable'; END IF;
 IF OLD.state='SUPERSEDED' OR (OLD.state='READY' AND NEW.state<>'SUPERSEDED') OR (OLD.state='NEEDS_LAYOUT' AND NEW.state<>'SUPERSEDED') THEN RAISE EXCEPTION 'label state immutable'; END IF;
 IF OLD.sheet_id IS NOT NULL AND (NEW.sheet_id,NEW.slot) IS DISTINCT FROM (OLD.sheet_id,OLD.slot) THEN
  IF NEW.state<>'SUPERSEDED' OR NEW.sheet_id IS NOT NULL OR NEW.previous_assignment IS DISTINCT FROM jsonb_build_object('sheetId',OLD.sheet_id,'slot',OLD.slot)
   OR NOT EXISTS(SELECT 1 FROM atlas_manual_connected.label_sheet WHERE id=OLD.sheet_id AND state='OPEN') THEN RAISE EXCEPTION 'label assignment immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION atlas_manual_connected.guard_label_layout_retry() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE predecessor atlas_manual_connected.label_item%ROWTYPE; ancestor atlas_manual_connected.label_item%ROWTYPE;
 seen uuid[]:=ARRAY[NEW.id]; depth integer:=0;
BEGIN
 IF NEW.purpose<>'LAYOUT_RETRY' THEN RETURN NEW; END IF;
 SELECT * INTO predecessor FROM atlas_manual_connected.label_item WHERE id=NEW.original_item_id FOR UPDATE;
 IF NOT FOUND OR predecessor.state<>'NEEDS_LAYOUT' OR predecessor.purpose NOT IN ('ORIGINAL','LAYOUT_RETRY')
  OR (NEW.actor_id,NEW.card_id,NEW.action_id,NEW.approval_version,NEW.source_revision,NEW.source_hash,NEW.report_hash,NEW.public_hash)
   IS DISTINCT FROM (predecessor.actor_id,predecessor.card_id,predecessor.action_id,predecessor.approval_version,predecessor.source_revision,predecessor.source_hash,predecessor.report_hash,predecessor.public_hash)
  OR predecessor.snapshot_hash IS DISTINCT FROM (CASE WHEN predecessor.snapshot IS NULL THEN NULL ELSE encode(sha256(convert_to(predecessor.snapshot,'UTF8')),'hex') END)
  OR predecessor.print_svg IS NOT NULL OR predecessor.preview_svg IS NOT NULL OR predecessor.artwork_hash IS NOT NULL
  OR predecessor.sheet_id IS NOT NULL OR predecessor.slot IS NOT NULL OR predecessor.previous_assignment IS NOT NULL
  OR predecessor.claim_id IS NOT NULL OR predecessor.lease_until IS NOT NULL
  OR EXISTS(SELECT 1 FROM atlas_manual_connected.label_export WHERE item_id=predecessor.id)
  OR NEW.state<>'PENDING_RENDER' OR NEW.attempts<>0 OR NEW.snapshot IS NOT NULL OR NEW.snapshot_hash IS NOT NULL
  OR NEW.print_svg IS NOT NULL OR NEW.preview_svg IS NOT NULL OR NEW.artwork_hash IS NOT NULL
  OR NEW.sheet_id IS NOT NULL OR NEW.slot IS NOT NULL OR NEW.previous_assignment IS NOT NULL
  OR NEW.claim_id IS NOT NULL OR NEW.lease_until IS NOT NULL OR NEW.code IS NOT NULL
 THEN RAISE EXCEPTION 'label layout retry source invalid'; END IF;
 ancestor:=predecessor;
 LOOP
  IF ancestor.id=ANY(seen) OR depth>=16 THEN RAISE EXCEPTION 'label layout retry chain invalid'; END IF;
  seen:=array_append(seen,ancestor.id); depth:=depth+1;
  EXIT WHEN ancestor.purpose='ORIGINAL';
  IF ancestor.purpose<>'LAYOUT_RETRY' THEN RAISE EXCEPTION 'label layout retry chain invalid'; END IF;
  SELECT * INTO ancestor FROM atlas_manual_connected.label_item WHERE id=ancestor.original_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'label layout retry chain invalid'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER label_layout_retry_guard BEFORE INSERT ON atlas_manual_connected.label_item FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.guard_label_layout_retry();
REVOKE ALL ON FUNCTION atlas_manual_connected.guard_label_layout_retry() FROM PUBLIC;
