-- Reviewed additive candidate. Root integrates migration numbering and grants.
BEGIN;
CREATE TABLE atlas_manual.public_report_identity (
  card_id uuid PRIMARY KEY REFERENCES atlas_manual.card(id),
  public_token text NOT NULL UNIQUE CHECK(public_token ~ '^ar_[A-Za-z0-9_-]{24}$'),
  report_number text NOT NULL UNIQUE CHECK(report_number ~ '^ATLAS-[A-F0-9]{12}$')
);
CREATE TABLE atlas_manual.publication (
  card_id uuid NOT NULL, action_id uuid NOT NULL,
  version integer NOT NULL CHECK(version > 0), mode text NOT NULL CHECK(mode IN ('PRODUCTION','LOCAL_FIXTURE')),
  state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','PUBLISHED')),
  manifest text, manifest_hash text, public_hash text, published_at timestamptz,
  PRIMARY KEY(card_id,action_id), UNIQUE(card_id,version),
  FOREIGN KEY(card_id,action_id) REFERENCES atlas_manual.approval(card_id,action_id),
  FOREIGN KEY(card_id) REFERENCES atlas_manual.public_report_identity(card_id),
  CHECK((state='PENDING' AND manifest IS NULL AND manifest_hash IS NULL AND public_hash IS NULL AND published_at IS NULL)
    OR (state='PUBLISHED' AND manifest IS NOT NULL AND manifest_hash IS NOT NULL AND public_hash IS NOT NULL AND octet_length(manifest)<=16384 AND jsonb_typeof(manifest::jsonb)='object'
      AND manifest_hash=encode(sha256(convert_to(manifest,'UTF8')),'hex') AND public_hash ~ '^[a-f0-9]{64}$' AND published_at IS NOT NULL))
);
CREATE FUNCTION atlas_manual.publication_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,atlas_manual AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'PENDING' THEN RAISE EXCEPTION 'Publication starts pending'; END IF;
  ELSIF OLD.state<>'PENDING' OR NEW.state<>'PUBLISHED'
    OR (to_jsonb(NEW)-ARRAY['state','manifest','manifest_hash','public_hash','published_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','manifest','manifest_hash','public_hash','published_at']) THEN
    RAISE EXCEPTION 'Published report is immutable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER publication_guard BEFORE INSERT OR UPDATE ON atlas_manual.publication FOR EACH ROW EXECUTE FUNCTION atlas_manual.publication_guard();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_manual.public_report_identity FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable_delete BEFORE DELETE ON atlas_manual.publication FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual.publication FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_manual.public_report_identity FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual.immutable();

-- Random identifiers follow existing ATLAS conventions, with collision refusal
-- against existing legacy issuance. No legacy row or identity is modified.
CREATE FUNCTION atlas_manual.public_identity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual,atlas_staff AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM atlas_staff."StaffPublicReport" WHERE "publicToken"=NEW.public_token OR "reportNumber"=NEW.report_number)
    THEN RAISE EXCEPTION 'Public report identity collision'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER public_identity_guard BEFORE INSERT ON atlas_manual.public_report_identity FOR EACH ROW EXECUTE FUNCTION atlas_manual.public_identity_guard();
REVOKE ALL ON FUNCTION atlas_manual.public_identity_guard() FROM PUBLIC;

-- Native dedicated signed reader only. Public web keeps its existing three
-- legacy database ports; it never receives storage credentials or these refs.
CREATE FUNCTION atlas_manual.read_publication(token text, requested_version integer, deployment text, release text, configuration text)
RETURNS TABLE(card_id uuid, action_id uuid, version integer, mode text, public_hash text, manifest text, manifest_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual,atlas_staff AS $$
DECLARE control atlas_staff."PublicReaderControl"%ROWTYPE;
BEGIN
  SELECT * INTO control FROM atlas_staff."PublicReaderControl" WHERE id='active' FOR SHARE;
  IF (control.enabled AND control."deploymentId"=deployment AND control."releaseSha"=release AND control."configHash"=configuration) IS NOT TRUE
    THEN RAISE EXCEPTION 'Public reader binding unavailable'; END IF;
  IF token IS NULL OR token !~ '^ar_[A-Za-z0-9_-]{24}$' OR requested_version<1 THEN RETURN; END IF;
  RETURN QUERY SELECT p.card_id,p.action_id,p.version,p.mode,p.public_hash,p.manifest,p.manifest_hash
    FROM atlas_manual.publication p JOIN atlas_manual.public_report_identity i USING(card_id)
    WHERE i.public_token=token AND p.state='PUBLISHED' AND p.mode=control.mode
      AND (p.version=requested_version OR (requested_version IS NULL AND p.version=(SELECT MAX(p2.version) FROM atlas_manual.publication p2 WHERE p2.card_id=p.card_id AND p2.state='PUBLISHED')));
END; $$;
REVOKE ALL ON FUNCTION atlas_manual.read_publication(text,integer,text,text,text) FROM PUBLIC;
REVOKE ALL ON atlas_manual.public_report_identity,atlas_manual.publication FROM PUBLIC;
COMMIT;
