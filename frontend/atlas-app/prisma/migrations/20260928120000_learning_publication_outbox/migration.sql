-- Additive only. No existing confirmation/publication is rewritten. New
-- examples are candidates; the serving baseline is frozen at this migration.
BEGIN;
-- Keep candidate documents physically outside the legacy retrieval table.
-- A previous binary cannot accidentally serve newly prepared candidates.
CREATE TABLE atlas_manual.learning_publication (LIKE atlas_manual.defect_memory_publication INCLUDING ALL);
ALTER TABLE atlas_manual.learning_publication ADD FOREIGN KEY(actor_id) REFERENCES atlas_staff."StaffIdentity"(id);
ALTER TABLE atlas_manual.learning_publication ADD FOREIGN KEY(card_id,action_id) REFERENCES atlas_manual.action(card_id,action_id);
INSERT INTO atlas_manual.learning_publication SELECT * FROM atlas_manual.defect_memory_publication;
CREATE FUNCTION atlas_manual.learning_publication_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,atlas_manual AS $$
DECLARE a atlas_manual.action%ROWTYPE; d jsonb; expected integer;
BEGIN
  PERFORM pg_advisory_xact_lock(719400621);
  SELECT COALESCE(MAX(revision),0)+1 INTO expected FROM atlas_manual.learning_publication;
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
CREATE TRIGGER learning_publication_guard BEFORE INSERT ON atlas_manual.learning_publication
 FOR EACH ROW EXECUTE FUNCTION atlas_manual.learning_publication_guard();
CREATE TRIGGER learning_publication_immutable BEFORE UPDATE OR DELETE ON atlas_manual.learning_publication
 FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TABLE atlas_manual.learning_publication_job (
 card_id uuid NOT NULL, action_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 access_version integer CHECK(access_version>0),
 design_family jsonb NOT NULL,
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','PREPARED','HELD','SUPERSEDED')),
 claim_id uuid, lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 failures integer NOT NULL DEFAULT 0 CHECK(failures>=0),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 code text CHECK(code ~ '^[A-Z][A-Z0-9_]{0,100}$'),
 feedback text, feedback_hash text CHECK(feedback_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(card_id,action_id),
 FOREIGN KEY(card_id,action_id) REFERENCES atlas_manual.action(card_id,action_id),
 CHECK((state='RUNNING')=(claim_id IS NOT NULL)),
 CHECK((claim_id IS NULL)=(lease_until IS NULL)),
 CHECK((feedback IS NULL)=(feedback_hash IS NULL)),
 CHECK(feedback IS NULL OR encode(sha256(convert_to(feedback,'UTF8')),'hex')=feedback_hash),
 CHECK(access_version IS NOT NULL OR state='HELD')
);
CREATE INDEX learning_publication_due ON atlas_manual.learning_publication_job(available_at,card_id,action_id)
 WHERE state IN ('QUEUED','RUNNING');
CREATE INDEX learning_publication_family ON atlas_manual.learning_publication_job(design_family,card_id);
CREATE FUNCTION atlas_manual.schedule_learning_publication() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual AS $$
BEGIN
 IF NEW.request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS'
  AND NEW.request::jsonb #>> '{action,reviewed}'='true'
  AND NEW.result::jsonb #>> '{receipt,actorKind}'='HUMAN' THEN
  INSERT INTO atlas_manual.learning_publication_job(card_id,action_id,actor_id,access_version,design_family)
   SELECT NEW.card_id,NEW.action_id,NEW.actor_id,s."accessVersion",
    atlas_manual.defect_memory_design(NEW.result::jsonb #> '{card,draft,identity}',NEW.request::jsonb #>> '{action,base,FRONT,profile}')
   FROM atlas_staff."StaffIdentity" s WHERE s.id=NEW.actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Learning confirmation authority missing'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER schedule_learning_publication AFTER INSERT ON atlas_manual.action
 FOR EACH ROW EXECUTE FUNCTION atlas_manual.schedule_learning_publication();
CREATE FUNCTION atlas_manual.learning_job_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Learning history is retained'; END IF;
 IF ROW(NEW.card_id,NEW.action_id,NEW.actor_id,NEW.access_version,NEW.created_at,NEW.design_family)
  IS DISTINCT FROM ROW(OLD.card_id,OLD.action_id,OLD.actor_id,OLD.access_version,OLD.created_at,OLD.design_family)
  OR NEW.attempts<OLD.attempts OR (OLD.feedback IS NOT NULL AND
   ROW(NEW.feedback,NEW.feedback_hash) IS DISTINCT FROM ROW(OLD.feedback,OLD.feedback_hash))
 THEN RAISE EXCEPTION 'Learning confirmation identity and captured feedback are immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER learning_job_guard BEFORE UPDATE OR DELETE ON atlas_manual.learning_publication_job
 FOR EACH ROW EXECUTE FUNCTION atlas_manual.learning_job_guard();
-- Historical missing publications have no captured access version. Surface a
-- hold; never invent a fresh authorization from today's staff record.
INSERT INTO atlas_manual.learning_publication_job(card_id,action_id,actor_id,access_version,design_family,state,code)
 SELECT a.card_id,a.action_id,a.actor_id,NULL,
 atlas_manual.defect_memory_design(a.result::jsonb #> '{card,draft,identity}',a.request::jsonb #>> '{action,base,FRONT,profile}'),
 'HELD','MEMORY_HISTORICAL_AUTHORITY_REQUIRED'
 FROM atlas_manual.action a WHERE a.request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS'
 AND NOT EXISTS(SELECT 1 FROM atlas_manual.defect_memory_publication p WHERE p.card_id=a.card_id AND p.action_id=a.action_id);

CREATE TABLE atlas_manual.learning_release (
 id text PRIMARY KEY CHECK(id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$'),
 manifest text NOT NULL, manifest_hash text NOT NULL CHECK(manifest_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(encode(sha256(convert_to(manifest,'UTF8')),'hex')=manifest_hash)
);
CREATE TABLE atlas_manual.learning_release_member (
 release_id text NOT NULL REFERENCES atlas_manual.learning_release(id),
 publication_revision bigint NOT NULL REFERENCES atlas_manual.learning_publication(revision),
 PRIMARY KEY(release_id,publication_revision)
);
CREATE TABLE atlas_manual.learning_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 active_release_id text NOT NULL REFERENCES atlas_manual.learning_release(id)
);
CREATE TABLE atlas_manual.learning_withdrawal (
 publication_revision bigint PRIMARY KEY REFERENCES atlas_manual.learning_publication(revision),
 actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE atlas_manual.learning_activation_history (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 previous_release_id text REFERENCES atlas_manual.learning_release(id),
 active_release_id text NOT NULL REFERENCES atlas_manual.learning_release(id),
 database_actor text NOT NULL, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION atlas_manual.learning_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Learning release and withdrawal history is append-only'; END; $$;
CREATE TRIGGER learning_release_immutable BEFORE UPDATE OR DELETE ON atlas_manual.learning_release
 FOR EACH ROW EXECUTE FUNCTION atlas_manual.learning_append_only();
CREATE TRIGGER learning_member_immutable BEFORE UPDATE OR DELETE ON atlas_manual.learning_release_member
 FOR EACH ROW EXECUTE FUNCTION atlas_manual.learning_append_only();
CREATE TRIGGER learning_withdrawal_immutable BEFORE UPDATE OR DELETE ON atlas_manual.learning_withdrawal
 FOR EACH ROW EXECUTE FUNCTION atlas_manual.learning_append_only();
CREATE TRIGGER learning_activation_immutable BEFORE UPDATE OR DELETE ON atlas_manual.learning_activation_history
 FOR EACH ROW EXECUTE FUNCTION atlas_manual.learning_append_only();
CREATE FUNCTION atlas_manual.learning_member_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM atlas_manual.learning_release r
  CROSS JOIN LATERAL jsonb_array_elements(r.manifest::jsonb->'publications') e
  JOIN atlas_manual.learning_publication p ON p.revision=(e->>'revision')::bigint
  WHERE r.id=NEW.release_id AND p.revision=NEW.publication_revision AND p.document_hash=e->>'sha256')
 THEN RAISE EXCEPTION 'Learning release membership does not match manifest'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER learning_member_guard BEFORE INSERT ON atlas_manual.learning_release_member
 FOR EACH ROW EXECUTE FUNCTION atlas_manual.learning_member_guard();
CREATE FUNCTION atlas_manual.learning_activation_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual AS $$
DECLARE expected integer; actual integer; why text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Active learning release cannot be deleted'; END IF;
 SELECT jsonb_array_length(manifest::jsonb->'publications') INTO expected
  FROM atlas_manual.learning_release WHERE id=NEW.active_release_id;
 SELECT count(*) INTO actual FROM atlas_manual.learning_release_member WHERE release_id=NEW.active_release_id;
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Incomplete learning release'; END IF;
 why=COALESCE(NULLIF(current_setting('atlas.learning_change_reason',true),''),'Migration baseline');
 IF TG_OP='UPDATE' AND why='Migration baseline' THEN RAISE EXCEPTION 'Learning activation or rollback needs a recorded reason'; END IF;
 INSERT INTO atlas_manual.learning_activation_history(previous_release_id,active_release_id,database_actor,reason)
 VALUES(CASE WHEN TG_OP='UPDATE' THEN OLD.active_release_id ELSE NULL END,NEW.active_release_id,session_user,why);
 RETURN NEW;
END; $$;
CREATE TRIGGER learning_activation_guard BEFORE INSERT OR UPDATE OR DELETE ON atlas_manual.learning_control
 FOR EACH ROW EXECUTE FUNCTION atlas_manual.learning_activation_guard();
-- Capture exactly the eligible published set at installation, including its
-- hashes. This is a reproducibility baseline, not a claim of expert validation.
WITH eligible AS (
 SELECT p.revision,p.document_hash FROM atlas_manual.defect_memory_publication p
 WHERE NOT EXISTS(SELECT 1 FROM atlas_manual.action a WHERE a.card_id=p.card_id
  AND a.request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS' AND a.result_revision>p.result_revision)
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=p.card_id)
), baseline AS (
 SELECT jsonb_build_object('version','atlas-learning-release-v1','kind','FROZEN_EXISTING_BASELINE',
  'evaluation',NULL,'policy','legacy-defect-family-v1','publications',COALESCE(jsonb_agg(
   jsonb_build_object('revision',revision,'sha256',document_hash) ORDER BY revision),'[]'::jsonb))::text AS document FROM eligible
) INSERT INTO atlas_manual.learning_release(id,manifest,manifest_hash)
 SELECT 'baseline-20260928',document,encode(sha256(convert_to(document,'UTF8')),'hex') FROM baseline;
INSERT INTO atlas_manual.learning_release_member(release_id,publication_revision)
 SELECT r.id,(p->>'revision')::bigint FROM atlas_manual.learning_release r,
 LATERAL jsonb_array_elements(r.manifest::jsonb->'publications') p WHERE r.id='baseline-20260928';
INSERT INTO atlas_manual.learning_control(singleton,active_release_id) VALUES(true,'baseline-20260928');
CREATE INDEX learning_confirmations_card_revision ON atlas_manual.action(card_id,result_revision DESC)
 WHERE request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS';
REVOKE ALL ON atlas_manual.learning_publication,atlas_manual.learning_publication_job,atlas_manual.learning_release,
 atlas_manual.learning_release_member,atlas_manual.learning_control,atlas_manual.learning_withdrawal,
 atlas_manual.learning_activation_history FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_manual.learning_publication_guard(),atlas_manual.schedule_learning_publication(),atlas_manual.learning_job_guard(),atlas_manual.learning_append_only(),
 atlas_manual.learning_member_guard(),atlas_manual.learning_activation_guard() FROM PUBLIC;
COMMIT;
