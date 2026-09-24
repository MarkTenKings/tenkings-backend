-- Additive reviewed-memory proposal. Requires the existing manual/intake chain.
-- Apply only to an owned disposable database until coordinated release review.
BEGIN;
CREATE TABLE atlas_manual.defect_memory_publication (
  revision integer PRIMARY KEY CHECK(revision>0),
  card_id uuid NOT NULL,
  action_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
  result_revision integer NOT NULL CHECK(result_revision>1),
  content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  design_key text NOT NULL CHECK(design_key ~ '^[a-f0-9]{64}$'),
  document text NOT NULL CHECK(octet_length(document)<=1048576 AND jsonb_typeof(document::jsonb)='object'),
  document_hash text NOT NULL CHECK(document_hash=encode(sha256(convert_to(document,'UTF8')),'hex')),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(card_id,action_id),
  FOREIGN KEY(card_id,action_id) REFERENCES atlas_manual.action(card_id,action_id)
);
CREATE INDEX defect_memory_design_revision ON atlas_manual.defect_memory_publication(design_key,revision DESC);
CREATE INDEX defect_memory_confirmation ON atlas_manual.action(card_id,result_revision DESC)
  WHERE request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS';

-- Mirrors the conservative normalized family contract; physical-copy identity
-- and card number never become a shared family key.
CREATE FUNCTION atlas_manual.defect_memory_design(identity jsonb, profile text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  WITH normalized AS (SELECT key, NULLIF(lower(trim(regexp_replace(normalize(value,NFKC),'\s+',' ','g'))),'') AS value
    FROM jsonb_each_text(identity))
  SELECT jsonb_build_object('version','atlas-defect-design-v1','category',profile,
    'year',(SELECT value FROM normalized WHERE key='year'),
    'manufacturer',CASE WHEN profile='SPORTS' THEN (SELECT value FROM normalized WHERE key='manufacturer') END,
    'productSet',(SELECT value FROM normalized WHERE key='productSet'),
    'parallel',(SELECT value FROM normalized WHERE key='parallel'),
    'insert',CASE WHEN profile='SPORTS' THEN (SELECT value FROM normalized WHERE key='insert') END,
    'layoutType',CASE WHEN profile='POKEMON' THEN (SELECT value FROM normalized WHERE key='layoutType') END);
$$;

CREATE FUNCTION atlas_manual.defect_memory_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,atlas_manual AS $$
DECLARE a atlas_manual.action%ROWTYPE; d jsonb; expected integer;
BEGIN
  PERFORM pg_advisory_xact_lock(719400621);
  SELECT COALESCE(MAX(revision),0)+1 INTO expected FROM atlas_manual.defect_memory_publication;
  SELECT * INTO a FROM atlas_manual.action WHERE card_id=NEW.card_id AND action_id=NEW.action_id;
  d:=NEW.document::jsonb;
  IF (NEW.revision=expected AND a.actor_id=NEW.actor_id AND a.result_revision=NEW.result_revision
    AND a.request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS'
    AND a.request::jsonb #>> '{action,reviewed}'='true'
    AND a.result::jsonb #>> '{receipt,actorKind}'='HUMAN'
    AND a.result::jsonb #>> '{card,contentHash}'=NEW.content_hash
    AND a.result::jsonb #>> '{card,draft,source,sourceHash}'=NEW.source_hash
    AND d->>'version'='atlas-reviewed-lessons-v1' AND jsonb_typeof(d->'lessons')='array'
    AND jsonb_array_length(d->'lessons')<=200
    AND (d->'design')-'cardNumber'=atlas_manual.defect_memory_design(a.result::jsonb #> '{card,draft,identity}',a.request::jsonb #>> '{action,base,FRONT,profile}')
    AND NOT EXISTS(SELECT 1 FROM atlas_manual.action newer WHERE newer.card_id=NEW.card_id
      AND newer.request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS' AND newer.result_revision>NEW.result_revision)
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'lessons') lesson WHERE (
      lesson #>> '{source,cardId}'=NEW.card_id::text AND lesson #>> '{source,actionId}'=NEW.action_id::text
      AND lesson #>> '{source,actorId}'=NEW.actor_id::text AND lesson #>> '{source,contentHash}'=NEW.content_hash
      AND lesson #>> '{source,resultRevision}'=NEW.result_revision::text
      AND lesson #>> '{source,nativeSourceHash}'=NEW.source_hash AND lesson->'design'=d->'design'
      AND lesson->>'side' IN ('FRONT','BACK')
      AND lesson #> '{source,frame}'=a.request::jsonb #> ARRAY['action','base',lesson->>'side','frame']) IS NOT TRUE)) IS NOT TRUE
  THEN RAISE EXCEPTION 'Exact committed human findings confirmation required'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER defect_memory_guard BEFORE INSERT ON atlas_manual.defect_memory_publication FOR EACH ROW EXECUTE FUNCTION atlas_manual.defect_memory_guard();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual.defect_memory_publication FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
REVOKE ALL ON atlas_manual.defect_memory_publication FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_manual.defect_memory_design(jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_manual.defect_memory_guard() FROM PUBLIC;
COMMIT;
