-- Each planned original has a durable server handoff before a signed PUT exists.
-- No photo bytes, original evidence, human decisions or historical jobs change.
BEGIN;
CREATE TABLE atlas_manual_intake.ingestion (
 upload_id uuid PRIMARY KEY REFERENCES atlas_manual_intake.upload(id),
 card_id uuid NOT NULL REFERENCES atlas_manual_intake.card(id),
 owner_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 access_version integer NOT NULL CHECK(access_version>0),
 stage text NOT NULL CHECK(stage IN ('VERIFY','PREPARE','ADMIT')),
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','COMPLETE','ATTENTION','SUPERSEDED')),
 claim_id uuid,
 lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 failures integer NOT NULL DEFAULT 0 CHECK(failures>=0),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_claimed_at timestamptz,
 code text CHECK(code ~ '^[A-Z][A-Z0-9_]{0,100}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(card_id,upload_id) REFERENCES atlas_manual_intake.upload(card_id,id),
 CHECK((state='RUNNING')=(claim_id IS NOT NULL)),
 CHECK((claim_id IS NULL)=(lease_until IS NULL))
);
CREATE INDEX intake_ingestion_due ON atlas_manual_intake.ingestion(stage,available_at,upload_id) WHERE state IN ('QUEUED','RUNNING');
CREATE INDEX intake_ingestion_owner_fairness ON atlas_manual_intake.ingestion(owner_id,last_claimed_at DESC NULLS LAST);
CREATE FUNCTION atlas_manual_intake.schedule_ingestion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_intake AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO atlas_manual_intake.ingestion(upload_id,card_id,owner_id,access_version,stage)
  SELECT NEW.id,NEW.card_id,c.owner_id,a."accessVersion",'VERIFY'
  FROM atlas_manual_intake.card c JOIN atlas_staff."StaffIdentity" a ON a.id=c.owner_id
  WHERE c.id=NEW.card_id;
 ELSIF (OLD.verification IS NULL AND NEW.verification IS NOT NULL) OR (OLD.source IS NULL AND NEW.source IS NOT NULL) THEN
  -- Active claim holders choose their next stage at the fenced finish. A browser
  -- completion only brings an unclaimed same-intent task forward.
  UPDATE atlas_manual_intake.ingestion SET
   stage=CASE WHEN NEW.source IS NOT NULL THEN 'ADMIT' ELSE 'PREPARE' END,
   available_at=clock_timestamp(),updated_at=clock_timestamp(),code=NULL,failures=0
  WHERE upload_id=NEW.id AND state='QUEUED';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER intake_schedule_ingestion AFTER INSERT OR UPDATE OF verification,source ON atlas_manual_intake.upload
 FOR EACH ROW EXECUTE FUNCTION atlas_manual_intake.schedule_ingestion();
CREATE FUNCTION atlas_manual_intake.ingestion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Intake ingestion history is retained'; END IF;
 IF ROW(NEW.upload_id,NEW.card_id,NEW.owner_id,NEW.access_version,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.upload_id,OLD.card_id,OLD.owner_id,OLD.access_version,OLD.created_at)
  OR NEW.attempts<OLD.attempts THEN RAISE EXCEPTION 'Intake ingestion identity is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER intake_ingestion_guard BEFORE UPDATE OR DELETE ON atlas_manual_intake.ingestion
 FOR EACH ROW EXECUTE FUNCTION atlas_manual_intake.ingestion_guard();
-- Reconcile selected historical plans once. Retired test cards remain retired.
INSERT INTO atlas_manual_intake.ingestion(upload_id,card_id,owner_id,access_version,stage)
SELECT u.id,c.id,c.owner_id,a."accessVersion",
 CASE WHEN u.source IS NOT NULL THEN 'ADMIT' WHEN u.verification IS NOT NULL THEN 'PREPARE' ELSE 'VERIFY' END
FROM atlas_manual_intake.card c JOIN atlas_manual_intake.upload u ON u.id IN(c.front_upload_id,c.back_upload_id)
JOIN atlas_staff."StaffIdentity" a ON a.id=c.owner_id
WHERE a."revokedAt" IS NULL AND a.role='REVIEWER'
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.owner_id=c.owner_id AND d.create_request_id=c.create_request_id);
REVOKE ALL ON atlas_manual_intake.ingestion FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_manual_intake.schedule_ingestion(),atlas_manual_intake.ingestion_guard() FROM PUBLIC;
COMMIT;
