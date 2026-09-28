-- Additive display-only queue/index. Existing source, grading and publication
-- records are untouched. Serving grants are explicitly applied by release tooling.
CREATE TABLE atlas_manual_connected.review_display (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 photo_hash text NOT NULL CHECK(photo_hash ~ '^[a-f0-9]{64}$'),
 variant text NOT NULL CHECK(variant ~ '^(context|full|inspection:[a-f0-9]{64})$'),
 policy text NOT NULL CHECK(policy='atlas-review-delivery-v1'),
 card_id uuid NOT NULL REFERENCES atlas_manual_intake.card(id),
 upload_id uuid NOT NULL REFERENCES atlas_manual_intake.upload(id),
 side text NOT NULL CHECK(side IN('FRONT','BACK')),
 owner_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 access_version integer NOT NULL CHECK(access_version>0),
 photo_source text NOT NULL CHECK(octet_length(photo_source)<=16384 AND jsonb_typeof(photo_source::jsonb)='object'
   AND photo_source::jsonb->'ref'->>'sha256'=photo_hash),
 prepared text CHECK(prepared IS NULL OR (octet_length(prepared)<=16384 AND jsonb_typeof(prepared::jsonb)='object'
   AND variant='inspection:'||(prepared::jsonb->'ref'->>'sha256'))),
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN('QUEUED','RUNNING','READY','FAILED','SUPERSEDED')),
 recovery integer NOT NULL DEFAULT 0 CHECK(recovery BETWEEN 0 AND 3),
 retry_of uuid UNIQUE REFERENCES atlas_manual_connected.review_display(id), retry_action uuid UNIQUE,
 CHECK((recovery=0)=(retry_of IS NULL AND retry_action IS NULL)),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), claim_id uuid, lease_until timestamptz,
 result text, result_hash text, source_image_hash text CHECK(source_image_hash ~ '^[a-f0-9]{64}$'),
 code text CHECK(code ~ '^[A-Z][A-Z0-9_]{0,100}$'),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(photo_hash,variant,policy,access_version,recovery),
 CHECK((variant LIKE 'inspection:%')=(prepared IS NOT NULL)),
 CHECK((state='RUNNING')=(claim_id IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(state='RUNNING' OR (claim_id IS NULL AND lease_until IS NULL)),
 CHECK((state='READY')=(result IS NOT NULL AND result_hash IS NOT NULL AND source_image_hash IS NOT NULL)),
 CHECK(result IS NULL OR (octet_length(result)<=32768 AND jsonb_typeof(result::jsonb)='object'
   AND result_hash=encode(sha256(convert_to(result,'UTF8')),'hex')))
);
CREATE INDEX review_display_pending ON atlas_manual_connected.review_display(available_at,upload_id) WHERE state IN('QUEUED','RUNNING');
CREATE INDEX review_display_source ON atlas_manual_connected.review_display(source_image_hash,policy) WHERE state='READY';
REVOKE ALL ON atlas_manual_connected.review_display FROM PUBLIC;

-- Narrow predicate avoids exposing StaffIdentity rows to the serving role.
CREATE FUNCTION atlas_manual_connected.display_owner_current(owner uuid,version integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM atlas_staff."StaffIdentity" a WHERE a.id=owner
   AND a."accessVersion"=version AND a."revokedAt" IS NULL AND a.role='REVIEWER');
$$;
REVOKE ALL ON FUNCTION atlas_manual_connected.display_owner_current(uuid,integer) FROM PUBLIC;

CREATE FUNCTION atlas_manual_connected.display_owner_version(owner uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT a."accessVersion" FROM atlas_staff."StaffIdentity" a WHERE a.id=owner
   AND a."revokedAt" IS NULL AND a.role='REVIEWER';
$$;
REVOKE ALL ON FUNCTION atlas_manual_connected.display_owner_version(uuid) FROM PUBLIC;

CREATE FUNCTION atlas_manual_connected.review_display_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Display history is retained'; END IF;
 IF ROW(NEW.id,NEW.recovery,NEW.retry_of,NEW.retry_action,NEW.photo_hash,NEW.variant,NEW.policy,NEW.card_id,NEW.upload_id,NEW.side,NEW.owner_id,NEW.access_version,NEW.photo_source,NEW.prepared,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.recovery,OLD.retry_of,OLD.retry_action,OLD.photo_hash,OLD.variant,OLD.policy,OLD.card_id,OLD.upload_id,OLD.side,OLD.owner_id,OLD.access_version,OLD.photo_source,OLD.prepared,OLD.created_at)
   OR NEW.attempts<OLD.attempts OR OLD.state='READY' AND NEW IS DISTINCT FROM OLD
 THEN RAISE EXCEPTION 'Display identity and ready evidence are immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER review_display_guard BEFORE UPDATE OR DELETE ON atlas_manual_connected.review_display
 FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.review_display_guard();
REVOKE ALL ON FUNCTION atlas_manual_connected.review_display_guard() FROM PUBLIC;

-- Historical published images have their own authority. A replaced intake
-- source is never re-authorized through this queue. Approved images/packets
-- remain byte-for-byte immutable; only a separate optional preview is indexed.
CREATE TABLE atlas_manual_connected.published_review_display (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 card_id uuid NOT NULL, action_id uuid NOT NULL, side text NOT NULL CHECK(side IN('FRONT','BACK')),
 mode text NOT NULL CHECK(mode IN('LOCAL_FIXTURE','PRODUCTION')),
 policy text NOT NULL CHECK(policy='atlas-review-delivery-v1'),
 manifest text NOT NULL, manifest_hash text NOT NULL,
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN('QUEUED','RUNNING','READY','FAILED','SUPERSEDED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), claim_id uuid, lease_until timestamptz,
 result text, result_hash text, source_image_hash text CHECK(source_image_hash ~ '^[a-f0-9]{64}$'),
 code text CHECK(code ~ '^[A-Z][A-Z0-9_]{0,100}$'),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(card_id,action_id) REFERENCES atlas_manual.publication(card_id,action_id),
 UNIQUE(card_id,action_id,side,policy),
 CHECK(octet_length(manifest)<=16384 AND jsonb_typeof(manifest::jsonb)='object'
   AND manifest_hash=encode(sha256(convert_to(manifest,'UTF8')),'hex')),
 CHECK((state='RUNNING')=(claim_id IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(state='RUNNING' OR (claim_id IS NULL AND lease_until IS NULL)),
 CHECK((state='READY')=(result IS NOT NULL AND result_hash IS NOT NULL AND source_image_hash IS NOT NULL)),
 CHECK(result IS NULL OR (octet_length(result)<=32768 AND jsonb_typeof(result::jsonb)='object'
   AND result_hash=encode(sha256(convert_to(result,'UTF8')),'hex')))
);
CREATE INDEX published_display_pending ON atlas_manual_connected.published_review_display(available_at,card_id) WHERE state IN('QUEUED','RUNNING');
CREATE INDEX published_display_source ON atlas_manual_connected.published_review_display(source_image_hash,policy) WHERE state='READY';
REVOKE ALL ON atlas_manual_connected.published_review_display FROM PUBLIC;
CREATE FUNCTION atlas_manual_connected.published_display_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Published display history is retained'; END IF;
 IF ROW(NEW.id,NEW.card_id,NEW.action_id,NEW.side,NEW.mode,NEW.policy,NEW.manifest,NEW.manifest_hash,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.card_id,OLD.action_id,OLD.side,OLD.mode,OLD.policy,OLD.manifest,OLD.manifest_hash,OLD.created_at)
   OR NEW.attempts<OLD.attempts OR OLD.state='READY' AND NEW IS DISTINCT FROM OLD
 THEN RAISE EXCEPTION 'Published display identity and ready evidence are immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER published_display_guard BEFORE UPDATE OR DELETE ON atlas_manual_connected.published_review_display
 FOR EACH ROW EXECUTE FUNCTION atlas_manual_connected.published_display_guard();
REVOKE ALL ON FUNCTION atlas_manual_connected.published_display_guard() FROM PUBLIC;
