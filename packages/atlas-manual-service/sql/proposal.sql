-- INACTIVE PROPOSAL. Apply only to an owned disposable database until reviewed.
-- No old card/operations/cohort records or serving role grants are changed.
BEGIN;
CREATE SCHEMA atlas_manual;
REVOKE ALL ON SCHEMA atlas_manual FROM PUBLIC;

CREATE TABLE atlas_manual.card (
  id uuid PRIMARY KEY,
  revision integer NOT NULL CHECK (revision > 0),
  content text NOT NULL CHECK (octet_length(content) <= 262144),
  content_hash text NOT NULL CHECK (content_hash = encode(sha256(convert_to(content, 'UTF8')), 'hex')),
  owner_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
  readers uuid[] NOT NULL DEFAULT '{}',
  editors uuid[] NOT NULL DEFAULT '{}',
  approvers uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (jsonb_typeof(content::jsonb) = 'object')
);
CREATE TABLE atlas_manual.action (
  card_id uuid NOT NULL REFERENCES atlas_manual.card(id),
  action_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
  expected_revision integer NOT NULL CHECK (expected_revision > 0),
  result_revision integer NOT NULL CHECK (result_revision = expected_revision + 1),
  request_hash text NOT NULL CHECK (request_hash = encode(sha256(convert_to(request, 'UTF8')), 'hex')),
  request text NOT NULL CHECK (octet_length(request) <= 65536),
  result text NOT NULL CHECK (octet_length(result) <= 524288),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (card_id, action_id),
  UNIQUE (card_id, result_revision)
);
CREATE TABLE atlas_manual.approval (
  card_id uuid NOT NULL,
  action_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
  source_revision integer NOT NULL CHECK (source_revision > 0),
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  report_hash text NOT NULL CHECK (report_hash = encode(sha256(convert_to(report, 'UTF8')), 'hex')),
  report text NOT NULL CHECK (octet_length(report) <= 262144 AND jsonb_typeof(report::jsonb) = 'object'),
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (card_id, action_id),
  FOREIGN KEY (card_id, action_id) REFERENCES atlas_manual.action(card_id, action_id)
);

CREATE FUNCTION atlas_manual.immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ATLAS manual history is immutable'; END;
$$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual.action FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual.approval FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE FUNCTION atlas_manual.card_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id OR NEW.created_at <> OLD.created_at
    OR NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'ATLAS manual revision conflict'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER card_revision BEFORE UPDATE ON atlas_manual.card FOR EACH ROW EXECUTE FUNCTION atlas_manual.card_revision();

-- Existing auth alone mints opaque handles. This restricted function rechecks
-- their exact session in the same transaction as a draft read/write. Row SHARE
-- locks allow independent cards/graders while fencing role/session revocation.
CREATE FUNCTION atlas_manual.authenticate(session_hash text, browser_hash text, expected jsonb, phones text[])
RETURNS TABLE (id uuid, name text, role text, certification_until timestamp, access_version integer, now_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, atlas_staff, atlas_manual AS $$
DECLARE
  c atlas_staff."StaffControl"%ROWTYPE;
  s atlas_staff."StaffSession"%ROWTYPE;
  b atlas_staff."StaffBrowser"%ROWTYPE;
  i atlas_staff."StaffIdentity"%ROWTYPE;
  observed timestamptz;
BEGIN
  SELECT * INTO c FROM atlas_staff."StaffControl" WHERE "StaffControl".id = 'active' FOR SHARE;
  SELECT * INTO s FROM atlas_staff."StaffSession" WHERE "tokenHash" = session_hash FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffBrowser" WHERE "tokenHash" = browser_hash FOR SHARE;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE "StaffIdentity".id = s."identityId" FOR SHARE;
  observed := clock_timestamp();
  IF (c.enabled AND c.mode = expected->>'mode' AND c.origin = expected->>'origin'
    AND c."deploymentId" = expected->>'deploymentId' AND c."releaseSha" = expected->>'releaseSha'
    AND c."configHash" = expected->>'configHash'
    AND s."revokedAt" IS NULL AND (s."expiresAt" AT TIME ZONE 'UTC') > observed AND s."browserHash" = browser_hash
    AND s."controlRevision" = c.revision AND b."controlRevision" = c.revision AND (b."expiresAt" AT TIME ZONE 'UTC') > observed
    AND i."revokedAt" IS NULL AND i."accessVersion" = s."accessVersion"
    AND i."phoneHash" = ANY(phones) AND i.role IN ('REVIEWER', 'OBSERVER')) IS NOT TRUE
    THEN RETURN; END IF;
  RETURN QUERY SELECT i.id, i.name::text, i.role::text, i."certificationUntil", i."accessVersion", observed;
END;
$$;
REVOKE ALL ON FUNCTION atlas_manual.authenticate(text,text,jsonb,text[]) FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA atlas_manual FROM PUBLIC;
COMMIT;
