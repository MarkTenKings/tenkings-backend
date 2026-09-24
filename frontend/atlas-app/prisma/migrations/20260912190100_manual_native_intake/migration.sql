-- INACTIVE ADDITIVE PROPOSAL. Owned disposable tests only until release review.
-- Reuses atlas_manual.authenticate and ordinary staff identities, not pilot rows.
BEGIN;
CREATE SCHEMA atlas_manual_intake;
REVOKE ALL ON SCHEMA atlas_manual_intake FROM PUBLIC;
CREATE TABLE atlas_manual_intake.card (
  id uuid PRIMARY KEY,
  pair_id uuid NOT NULL UNIQUE,
  owner_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
  create_request_id uuid NOT NULL,
  create_request_hash text NOT NULL CHECK (create_request_hash ~ '^[a-f0-9]{64}$'),
  label text NOT NULL CHECK (char_length(label) <= 120),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  front_version integer NOT NULL DEFAULT 0 CHECK (front_version >= 0),
  back_version integer NOT NULL DEFAULT 0 CHECK (back_version >= 0),
  front_upload_id uuid,
  back_upload_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(owner_id,create_request_id),
  CHECK ((front_upload_id IS NULL) = (front_version=0)),
  CHECK ((back_upload_id IS NULL) = (back_version=0))
);
CREATE TABLE atlas_manual_intake.upload (
  id uuid PRIMARY KEY,
  card_id uuid NOT NULL REFERENCES atlas_manual_intake.card(id),
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
  request text NOT NULL CHECK (octet_length(request) <= 4096),
  request_hash text NOT NULL CHECK (request_hash=encode(sha256(convert_to(request,'UTF8')),'hex')),
  side text NOT NULL CHECK (side IN ('FRONT','BACK')),
  version integer NOT NULL CHECK (version > 0),
  plan text NOT NULL CHECK (octet_length(plan) <= 8192),
  plan_hash text NOT NULL CHECK (plan_hash=encode(sha256(convert_to(plan,'UTF8')),'hex')),
  verification text CHECK (octet_length(verification) <= 8192),
  verification_hash text CHECK (verification_hash=encode(sha256(convert_to(verification,'UTF8')),'hex')),
  source text CHECK (octet_length(source) <= 8192),
  source_hash text CHECK (source_hash=encode(sha256(convert_to(source,'UTF8')),'hex')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(card_id,id), UNIQUE(card_id,request_id), UNIQUE(card_id,side,version),
  CHECK ((verification IS NULL) = (verification_hash IS NULL)),
  CHECK ((source IS NULL) = (source_hash IS NULL)),
  CHECK (source IS NULL OR verification IS NOT NULL)
);
ALTER TABLE atlas_manual_intake.card ADD FOREIGN KEY (id,front_upload_id) REFERENCES atlas_manual_intake.upload(card_id,id);
ALTER TABLE atlas_manual_intake.card ADD FOREIGN KEY (id,back_upload_id) REFERENCES atlas_manual_intake.upload(card_id,id);
CREATE INDEX intake_owner_created ON atlas_manual_intake.card(owner_id,created_at DESC,id DESC);
CREATE FUNCTION atlas_manual_intake.card_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p atlas_manual_intake.upload%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Intake card history is retained'; END IF;
  IF NEW.id<>OLD.id OR NEW.pair_id<>OLD.pair_id OR NEW.owner_id<>OLD.owner_id
    OR NEW.create_request_id<>OLD.create_request_id OR NEW.create_request_hash<>OLD.create_request_hash
    OR NEW.label<>OLD.label OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
    THEN RAISE EXCEPTION 'Intake immutable card identity or revision'; END IF;
  IF NEW.front_upload_id IS DISTINCT FROM OLD.front_upload_id THEN
    SELECT * INTO p FROM atlas_manual_intake.upload WHERE id=NEW.front_upload_id;
    IF (p.card_id=NEW.id AND p.side='FRONT' AND p.version=OLD.front_version+1 AND NEW.front_version=p.version) IS NOT TRUE
      THEN RAISE EXCEPTION 'Intake front version conflict'; END IF;
  ELSIF NEW.front_version<>OLD.front_version THEN RAISE EXCEPTION 'Intake front version conflict'; END IF;
  IF NEW.back_upload_id IS DISTINCT FROM OLD.back_upload_id THEN
    SELECT * INTO p FROM atlas_manual_intake.upload WHERE id=NEW.back_upload_id;
    IF (p.card_id=NEW.id AND p.side='BACK' AND p.version=OLD.back_version+1 AND NEW.back_version=p.version) IS NOT TRUE
      THEN RAISE EXCEPTION 'Intake back version conflict'; END IF;
  ELSIF NEW.back_version<>OLD.back_version THEN RAISE EXCEPTION 'Intake back version conflict'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER intake_card_guard BEFORE UPDATE OR DELETE ON atlas_manual_intake.card FOR EACH ROW EXECUTE FUNCTION atlas_manual_intake.card_guard();
CREATE FUNCTION atlas_manual_intake.upload_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Intake upload history is retained'; END IF;
  IF ROW(NEW.id,NEW.card_id,NEW.request_id,NEW.actor_id,NEW.request,NEW.request_hash,NEW.side,NEW.version,NEW.plan,NEW.plan_hash,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.card_id,OLD.request_id,OLD.actor_id,OLD.request,OLD.request_hash,OLD.side,OLD.version,OLD.plan,OLD.plan_hash,OLD.created_at)
    OR OLD.verification IS NOT NULL AND ROW(NEW.verification,NEW.verification_hash) IS DISTINCT FROM ROW(OLD.verification,OLD.verification_hash)
    OR OLD.source IS NOT NULL AND ROW(NEW.source,NEW.source_hash) IS DISTINCT FROM ROW(OLD.source,OLD.source_hash)
    THEN RAISE EXCEPTION 'Intake upload evidence is immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER intake_upload_guard BEFORE UPDATE OR DELETE ON atlas_manual_intake.upload FOR EACH ROW EXECUTE FUNCTION atlas_manual_intake.upload_guard();
REVOKE ALL ON ALL TABLES IN SCHEMA atlas_manual_intake FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_manual_intake FROM PUBLIC;
COMMIT;
