BEGIN;
SET search_path=atlas_staff,pg_catalog;
CREATE TABLE "StaffGradingBridgeControl" (
  id text PRIMARY KEY DEFAULT 'active', enabled boolean NOT NULL DEFAULT false, mode text NOT NULL,
  origin text NOT NULL, "deploymentId" text NOT NULL, "releaseSha" varchar(40) NOT NULL,
  "configHash" varchar(64) NOT NULL, "clientKeyHash" varchar(64) NOT NULL, "gradingPolicyHash" varchar(64) NOT NULL,
  "policyCanonical" text NOT NULL, "policyHash" varchar(64) NOT NULL,
  revision integer NOT NULL DEFAULT 1, "updatedAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT "StaffGradingBridgeControl_shape" CHECK ((id='active' AND revision>0 AND mode IN ('LOCAL_FIXTURE','PRODUCTION')
    AND "releaseSha" ~ '^[a-f0-9]{40}$' AND "configHash" ~ '^[a-f0-9]{64}$' AND "clientKeyHash" ~ '^[a-f0-9]{64}$' AND "gradingPolicyHash" ~ '^[a-f0-9]{64}$'
    AND octet_length("policyCanonical")<=16384 AND "policyCanonical"::jsonb->>'version'='atlas-grading-bridge-policy-v1'
    AND jsonb_array_length("policyCanonical"::jsonb->'specimenIds')=10
    AND "policyHash"=encode(sha256(convert_to("policyCanonical",'UTF8')),'hex')) IS TRUE)
);
CREATE TABLE "StaffGradingExecution" (
  "operationId" uuid PRIMARY KEY REFERENCES "StaffGradingOperation"(id) ON DELETE RESTRICT,
  "claimId" uuid NOT NULL UNIQUE, "pilotId" uuid NOT NULL, "bridgeRevision" integer NOT NULL,
  "sourceRevision" varchar(80) NOT NULL, "reservedMicroUsd" bigint NOT NULL,
  "actualMicroUsd" bigint, "costEvidenceHash" varchar(64), state text NOT NULL, "failureCode" varchar(80),
  "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), "finishedAt" timestamp(3),
  CONSTRAINT "StaffGradingExecution_shape" CHECK (("bridgeRevision">0 AND "reservedMicroUsd">0 AND "reservedMicroUsd"<=1000000000000
    AND (("actualMicroUsd" IS NULL AND "costEvidenceHash" IS NULL)
      OR ("actualMicroUsd">=0 AND "actualMicroUsd"<=1000000000000 AND "costEvidenceHash" ~ '^[a-f0-9]{64}$'))
    AND ((state='RUNNING' AND "finishedAt" IS NULL AND "failureCode" IS NULL)
      OR (state='COMMITTED' AND "finishedAt" IS NOT NULL AND "failureCode" IS NULL)
      OR (state IN ('FAILED','UNKNOWN') AND "finishedAt" IS NOT NULL AND "failureCode" IS NOT NULL))) IS TRUE)
);
CREATE INDEX "StaffGradingExecution_pilotId_idx" ON "StaffGradingExecution"("pilotId");
CREATE TRIGGER "StaffGradingBridgeControl_change" BEFORE UPDATE ON "StaffGradingBridgeControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_control_guard();
CREATE TRIGGER "StaffGradingBridgeControl_no_delete" BEFORE DELETE ON "StaffGradingBridgeControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffGradingExecution_no_delete" BEFORE DELETE ON "StaffGradingExecution"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffGradingBridgeControl_no_truncate" BEFORE TRUNCATE ON "StaffGradingBridgeControl"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffGradingExecution_no_truncate" BEFORE TRUNCATE ON "StaffGradingExecution"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE FUNCTION atlas_staff.staff_execution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'RUNNING' OR NEW."actualMicroUsd" IS NOT NULL THEN RAISE EXCEPTION 'ATLAS execution requires an unsettled claim'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['state','failureCode','finishedAt','actualMicroUsd','costEvidenceHash'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','failureCode','finishedAt','actualMicroUsd','costEvidenceHash']) THEN
    RAISE EXCEPTION 'ATLAS execution scope is immutable'; END IF;
  IF (NEW.state,NEW."failureCode",NEW."finishedAt") IS DISTINCT FROM (OLD.state,OLD."failureCode",OLD."finishedAt")
    AND NOT (OLD.state='RUNNING' AND NEW.state IN ('COMMITTED','FAILED','UNKNOWN')) THEN
    RAISE EXCEPTION 'ATLAS execution cannot be dispatched twice'; END IF;
  IF OLD."actualMicroUsd" IS NOT NULL AND (NEW."actualMicroUsd",NEW."costEvidenceHash") IS DISTINCT FROM (OLD."actualMicroUsd",OLD."costEvidenceHash") THEN
    RAISE EXCEPTION 'ATLAS observed cost evidence is immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "StaffGradingExecution_guard" BEFORE INSERT OR UPDATE ON "StaffGradingExecution"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_execution_guard();
CREATE FUNCTION atlas_staff.staff_execution_commit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,atlas_staff AS $$
DECLARE o atlas_staff."StaffGradingOperation"%ROWTYPE; b atlas_staff."StaffGradingBridgeControl"%ROWTYPE;
  c atlas_staff."StaffControl"%ROWTYPE; i atlas_staff."StaffIdentity"%ROWTYPE; s atlas_staff."StaffSession"%ROWTYPE;
  a atlas_staff."StaffAssignment"%ROWTYPE; browser atlas_staff."StaffBrowser"%ROWTYPE;
  now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  SELECT * INTO o FROM atlas_staff."StaffGradingOperation" WHERE id=NEW."operationId";
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE;
  SELECT * INTO c FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=o."actorId"::uuid FOR SHARE;
  SELECT * INTO s FROM atlas_staff."StaffSession" WHERE "tokenHash"=o."sessionHash" FOR SHARE;
  SELECT * INTO browser FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=s."browserHash" FOR SHARE;
  SELECT * INTO a FROM atlas_staff.lock_assignment(o."specimenId",i.id);
  IF (o.state='SUCCEEDED' AND o."actorKind"='HUMAN' AND o."leaseExpiresAt">now_at
    AND b.enabled AND b.revision=NEW."bridgeRevision" AND c.enabled AND c.mode=b.mode
    AND c.revision=o."controlRevision" AND c."gradingPolicyHash"=b."gradingPolicyHash"
    AND o."requestCanonical"::jsonb->>'policyHash'=b."gradingPolicyHash"
    AND o."requestCanonical"::jsonb->>'bridgePolicyHash'=b."policyHash"
    AND (b."policyCanonical"::jsonb->>'expiresAt')::timestamptz>clock_timestamp()
    AND NEW."createdAt"+(b."policyCanonical"::jsonb->>'deadlineMs')::int*interval '1 millisecond'>now_at
    AND i.role='REVIEWER' AND i."revokedAt" IS NULL AND i."accessVersion"=(o."requestCanonical"::jsonb->>'accessVersion')::int
    AND s."identityId"=i.id AND s."revokedAt" IS NULL AND s."expiresAt">now_at AND s."accessVersion"=i."accessVersion"
    AND s."controlRevision"=c.revision AND browser."controlRevision"=c.revision AND browser."expiresAt">now_at
    AND a."canReview" AND a."revokedAt" IS NULL AND a."expiresAt">now_at AND a.fence=o."assignmentFence"
  ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS execution must commit current scoped authority'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER "StaffGradingExecution_commit" AFTER UPDATE ON "StaffGradingExecution" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.state='COMMITTED')
  EXECUTE FUNCTION atlas_staff.staff_execution_commit_guard();
REVOKE ALL ON "StaffGradingBridgeControl","StaffGradingExecution" FROM PUBLIC;
COMMIT;
