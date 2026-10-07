BEGIN;
SET LOCAL search_path=pg_catalog,atlas_staff;

-- One supervised seven-day SMS allowance: $5 staff + $5 customer. These are
-- conservative reservations, never an assertion of an invoice or delivery.
-- Only the migration/provisioning owner may configure this table. Serving
-- roles, including the Astra runner, receive no grants on either new table.
CREATE TABLE atlas_staff."SmsPilotControl" (
  application text PRIMARY KEY CHECK (application IN ('STAFF','CUSTOMER')),
  enabled boolean NOT NULL DEFAULT false,
  "pilotId" uuid,
  "allowedPhoneHash" varchar(64) CHECK ("allowedPhoneHash" ~ '^[a-f0-9]{64}$'),
  -- Customer SQL receives a caller-supplied HMAC and the destination. An
  -- independent, per-application digest binds that destination without
  -- exposing the phone key or storing the owner's raw number in this policy.
  "allowedDestinationHash" varchar(64) CHECK ("allowedDestinationHash" ~ '^[a-f0-9]{64}$'),
  "accountSid" varchar(34) CHECK ("accountSid" ~ '^AC[0-9a-fA-F]{32}$'),
  "serviceSid" varchar(34) UNIQUE CHECK ("serviceSid" ~ '^VA[0-9a-fA-F]{32}$'),
  "feeEvidenceHash" varchar(64) CHECK ("feeEvidenceHash" ~ '^[a-f0-9]{64}$'),
  binding jsonb,
  "maxClaims" integer NOT NULL DEFAULT 10 CHECK ("maxClaims"=10),
  "reservationMicroUsd" bigint NOT NULL DEFAULT 500000 CHECK ("reservationMicroUsd"=500000),
  "maxReservedMicroUsd" bigint NOT NULL DEFAULT 5000000 CHECK ("maxReservedMicroUsd"=5000000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  "activatedAt" timestamptz,
  "expiresAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (binding IS NULL OR (jsonb_typeof(binding)='object'
    AND binding ?& ARRAY['mode','origin','deploymentId','releaseSha','configHash']
    AND binding-ARRAY['mode','origin','deploymentId','releaseSha','configHash']='{}'::jsonb
    AND binding->>'mode'='PRODUCTION' AND binding->>'origin'='https://atlasgrading.com'
    AND jsonb_typeof(binding->'deploymentId')='string'
    AND length(binding->>'deploymentId') BETWEEN 1 AND 253
    AND binding->>'releaseSha' ~ '^[a-f0-9]{40}$'
    AND binding->>'releaseSha'<>repeat('0',40)
    AND binding->>'configHash' ~ '^[a-f0-9]{64}$') IS TRUE),
  CHECK (("activatedAt" IS NULL AND "expiresAt" IS NULL AND NOT enabled)
    OR ("activatedAt" IS NOT NULL AND "expiresAt"="activatedAt"+interval '168 hours'
      AND "pilotId" IS NOT NULL AND "allowedPhoneHash" IS NOT NULL AND "allowedDestinationHash" IS NOT NULL
      AND "accountSid" IS NOT NULL AND "serviceSid" IS NOT NULL
      AND "feeEvidenceHash" IS NOT NULL AND binding IS NOT NULL))
);
INSERT INTO atlas_staff."SmsPilotControl"(application) VALUES ('STAFF'),('CUSTOMER');

-- Exposure is the count/sum of immutable reservations. It cannot be refunded,
-- reset by a release/config revision, or erased when a challenge expires.
CREATE TABLE atlas_staff."SmsPilotReservation" (
  application text NOT NULL REFERENCES atlas_staff."SmsPilotControl"(application),
  "sendClaimId" uuid NOT NULL,
  "challengeId" varchar(43) NOT NULL CHECK ("challengeId" ~ '^[A-Za-z0-9_-]{43}$'),
  "browserHash" varchar(64) NOT NULL CHECK ("browserHash" ~ '^[a-f0-9]{64}$'),
  -- Staff accepts bounded opaque identifiers; customer uses UUIDs. Preserve
  -- either app's exact existing idempotency identity without reinterpreting it.
  "requestId" varchar(80) NOT NULL CHECK ("requestId" ~ '^[A-Za-z0-9_-]{8,80}$'),
  "pilotId" uuid NOT NULL,
  "policyRevision" integer NOT NULL CHECK ("policyRevision">0),
  "controlRevision" integer NOT NULL CHECK ("controlRevision">0),
  "phoneHash" varchar(64) NOT NULL CHECK ("phoneHash" ~ '^[a-f0-9]{64}$'),
  "accountSid" varchar(34) NOT NULL,
  "serviceSid" varchar(34) NOT NULL,
  "feeEvidenceHash" varchar(64) NOT NULL,
  binding jsonb NOT NULL,
  "reservedMicroUsd" bigint NOT NULL CHECK ("reservedMicroUsd"=500000),
  "recordedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(application,"sendClaimId"),
  UNIQUE(application,"challengeId")
);

CREATE FUNCTION atlas_staff.sms_pilot_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'ATLAS SMS pilot evidence is immutable'; END $$;
CREATE TRIGGER "SmsPilotControl_no_replace" BEFORE INSERT OR DELETE ON atlas_staff."SmsPilotControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.sms_pilot_immutable();
CREATE TRIGGER "SmsPilotControl_no_truncate" BEFORE TRUNCATE ON atlas_staff."SmsPilotControl"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.sms_pilot_immutable();
CREATE TRIGGER "SmsPilotReservation_immutable" BEFORE UPDATE OR DELETE ON atlas_staff."SmsPilotReservation"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.sms_pilot_immutable();
CREATE TRIGGER "SmsPilotReservation_no_truncate" BEFORE TRUNCATE ON atlas_staff."SmsPilotReservation"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.sms_pilot_immutable();

CREATE FUNCTION atlas_staff.sms_pilot_control_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE t timestamptz:=clock_timestamp();
BEGIN
  IF NEW.application IS DISTINCT FROM OLD.application OR NEW.revision<>OLD.revision+1
    OR (NEW."maxClaims",NEW."reservationMicroUsd",NEW."maxReservedMicroUsd",NEW."createdAt")
      IS DISTINCT FROM (OLD."maxClaims",OLD."reservationMicroUsd",OLD."maxReservedMicroUsd",OLD."createdAt") THEN
    RAISE EXCEPTION 'ATLAS SMS pilot revision required';
  END IF;
  IF (NEW."activatedAt",NEW."expiresAt") IS DISTINCT FROM (OLD."activatedAt",OLD."expiresAt") THEN
    RAISE EXCEPTION 'ATLAS SMS pilot window is immutable';
  END IF;
  IF OLD."activatedAt" IS NULL THEN
    IF NEW.enabled THEN
      NEW."activatedAt":=t;
      NEW."expiresAt":=t+interval '168 hours';
    END IF;
  ELSIF (NEW."pilotId",NEW."allowedPhoneHash",NEW."allowedDestinationHash",NEW."accountSid",NEW."serviceSid",NEW."feeEvidenceHash")
    IS DISTINCT FROM (OLD."pilotId",OLD."allowedPhoneHash",OLD."allowedDestinationHash",OLD."accountSid",OLD."serviceSid",OLD."feeEvidenceHash") THEN
    RAISE EXCEPTION 'ATLAS SMS pilot identity is immutable';
  END IF;
  IF NEW.enabled AND NEW."expiresAt"<=t THEN RAISE EXCEPTION 'ATLAS SMS pilot expired'; END IF;
  NEW."updatedAt":=t;
  RETURN NEW;
END $$;
CREATE TRIGGER "SmsPilotControl_revision" BEFORE UPDATE ON atlas_staff."SmsPilotControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.sms_pilot_control_guard();

CREATE FUNCTION atlas_staff.sms_pilot_claim_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE app text; active jsonb; current_binding jsonb; policy atlas_staff."SmsPilotControl";
  claims integer; exposure bigint; t timestamptz;
BEGIN
  IF TG_TABLE_SCHEMA='atlas_staff' AND TG_TABLE_NAME='StaffChallenge' THEN
    app:='STAFF';
    SELECT to_jsonb(c) INTO active FROM atlas_staff."StaffControl" c WHERE id='active' FOR SHARE;
  ELSIF TG_TABLE_SCHEMA='atlas_customer' AND TG_TABLE_NAME='CustomerChallenge' THEN
    app:='CUSTOMER';
    SELECT to_jsonb(c) INTO active FROM atlas_customer."CustomerControl" c WHERE id='active' FOR SHARE;
  ELSE RAISE EXCEPTION 'ATLAS SMS pilot unavailable';
  END IF;
  IF (active->>'enabled')::boolean IS DISTINCT FROM true
    OR NEW."controlRevision" IS DISTINCT FROM (active->>'revision')::integer THEN
    RAISE EXCEPTION 'ATLAS SMS pilot unavailable';
  END IF;
  -- The exemption is an operator-owned fixture control, never an address or
  -- phone prefix. A production request using a test number still needs a hold.
  IF active->>'mode'='LOCAL_FIXTURE' AND active->>'origin'='http://127.0.0.1:4318'
    AND active->>'releaseSha'=repeat('0',40) THEN RETURN NEW; END IF;
  -- Row locking serializes claims, but a repeatable-read snapshot could still
  -- omit reservations committed by the preceding holder. Production claims
  -- require the normal fresh-statement snapshots used by both auth adapters.
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'ATLAS SMS pilot unavailable';
  END IF;
  current_binding:=jsonb_build_object('mode',active->>'mode','origin',active->>'origin',
    'deploymentId',active->>'deploymentId','releaseSha',active->>'releaseSha','configHash',active->>'configHash');
  SELECT * INTO policy FROM atlas_staff."SmsPilotControl" WHERE application=app FOR UPDATE;
  -- Read time after the lock: waiting cannot make an expired allowance valid.
  t:=clock_timestamp();
  IF (active->>'mode'='PRODUCTION' AND active->>'origin'='https://atlasgrading.com'
    AND policy.enabled AND policy."activatedAt"<=t AND policy."expiresAt">t
    AND policy.binding=current_binding AND policy."allowedPhoneHash"=NEW."phoneHash"
    AND policy."accountSid"=NEW."accountSid" AND policy."serviceSid"=NEW."serviceSid"
    AND NEW.state='SENDING' AND NEW.attempts=0 AND NEW."verificationSid" IS NULL
    AND NEW."checkClaimId" IS NULL) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS SMS pilot unavailable';
  END IF;
  IF app='CUSTOMER' THEN
    IF policy."allowedDestinationHash" IS DISTINCT FROM
      encode(sha256(convert_to('atlas-sms-pilot-v1:CUSTOMER:'||NEW.phone,'UTF8')),'hex') THEN
      RAISE EXCEPTION 'ATLAS SMS pilot unavailable';
    END IF;
  END IF;
  SELECT count(*)::integer,coalesce(sum("reservedMicroUsd"),0)::bigint INTO claims,exposure
    FROM atlas_staff."SmsPilotReservation" WHERE application=app;
  IF claims>=policy."maxClaims" OR exposure+policy."reservationMicroUsd">policy."maxReservedMicroUsd" THEN
    RAISE EXCEPTION 'ATLAS SMS pilot unavailable';
  END IF;
  INSERT INTO atlas_staff."SmsPilotReservation"(application,"sendClaimId","challengeId","browserHash","requestId",
    "pilotId","policyRevision","controlRevision","phoneHash","accountSid","serviceSid","feeEvidenceHash",binding,"reservedMicroUsd","recordedAt")
  VALUES(app,NEW."sendClaimId",NEW.id,NEW."browserHash",NEW."requestId"::text,policy."pilotId",policy.revision,
    NEW."controlRevision",NEW."phoneHash",NEW."accountSid",NEW."serviceSid",policy."feeEvidenceHash",
    current_binding,policy."reservationMicroUsd",t);
  RETURN NEW;
END $$;
-- Immediate AFTER INSERT keeps INSERT ... ON CONFLICT DO NOTHING from spending
-- a claim. The reservation commits atomically before auth calls the provider.
CREATE TRIGGER "StaffChallenge_sms_pilot" AFTER INSERT ON atlas_staff."StaffChallenge"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.sms_pilot_claim_guard();
CREATE TRIGGER "CustomerChallenge_sms_pilot" AFTER INSERT ON atlas_customer."CustomerChallenge"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.sms_pilot_claim_guard();

REVOKE ALL ON TABLE atlas_staff."SmsPilotControl",atlas_staff."SmsPilotReservation" FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_staff.sms_pilot_immutable(),atlas_staff.sms_pilot_control_guard(),atlas_staff.sms_pilot_claim_guard() FROM PUBLIC;
-- Remove inherited default ACL grants on these new controls/evidence, without
-- changing permissions on any existing table or role. Only their owner keeps
-- authority; application privilege audits continue to require zero access.
DO $$
DECLARE grant_row record;
BEGIN
  FOR grant_row IN
    SELECT DISTINCT c.oid,c.relname,r.rolname FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      JOIN pg_roles r ON r.oid=a.grantee
      WHERE n.nspname='atlas_staff' AND c.relname IN ('SmsPilotControl','SmsPilotReservation')
        AND a.grantee<>c.relowner
  LOOP EXECUTE format('REVOKE ALL ON TABLE atlas_staff.%I FROM %I',grant_row.relname,grant_row.rolname); END LOOP;
END $$;
COMMIT;
