BEGIN;
SET LOCAL search_path=pg_catalog,atlas_staff;

-- Owner authorization: retire only the staff/customer SMS test limits.
-- No rows are rewritten. Original reservations, policy dates and allocation
-- columns remain immutable history. Approved owner destination, current app
-- binding, provider service, ordinary auth/rate/security and replay rules stay.
CREATE OR REPLACE FUNCTION atlas_staff.sms_pilot_control_guard() RETURNS trigger
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
  NEW."updatedAt":=t;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION atlas_staff.sms_pilot_claim_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE app text; active jsonb; current_binding jsonb; policy atlas_staff."SmsPilotControl";
  t timestamptz;
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
  -- Preserve the fresh-statement isolation used by both auth adapters.
  -- SMS policy rows still serialize the exact current destination/binding.
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'ATLAS SMS pilot unavailable';
  END IF;
  current_binding:=jsonb_build_object('mode',active->>'mode','origin',active->>'origin',
    'deploymentId',active->>'deploymentId','releaseSha',active->>'releaseSha','configHash',active->>'configHash');
  SELECT * INTO policy FROM atlas_staff."SmsPilotControl" WHERE application=app FOR UPDATE;
  -- The original activation time remains evidence; the test expiry is retired.
  t:=clock_timestamp();
  IF (active->>'mode'='PRODUCTION' AND active->>'origin'='https://atlasgrading.com'
    AND policy.enabled AND policy."activatedAt"<=t
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
  -- The owner retired SMS test count, cost and seven-day limits. Keep the
  -- existing per-claim reservation as immutable accounting evidence; it no
  -- longer imposes a spend ceiling or implies delivery/invoice settlement.
  INSERT INTO atlas_staff."SmsPilotReservation"(application,"sendClaimId","challengeId","browserHash","requestId",
    "pilotId","policyRevision","controlRevision","phoneHash","accountSid","serviceSid","feeEvidenceHash",binding,"reservedMicroUsd","recordedAt")
  VALUES(app,NEW."sendClaimId",NEW.id,NEW."browserHash",NEW."requestId"::text,policy."pilotId",policy.revision,
    NEW."controlRevision",NEW."phoneHash",NEW."accountSid",NEW."serviceSid",policy."feeEvidenceHash",
    current_binding,policy."reservationMicroUsd",t);
  RETURN NEW;
END $$;

-- CREATE OR REPLACE preserves the existing function owners and ACLs. No new
-- function, grant, allocation, budget, expiry or provider authority is added.
COMMIT;
