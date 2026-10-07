BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;
CREATE TABLE "StaffOperationsGrant" (
  id uuid PRIMARY KEY,"identityId" uuid NOT NULL REFERENCES "StaffIdentity"(id) ON DELETE RESTRICT,
  "accessVersion" integer NOT NULL,"controlRevision" integer NOT NULL,mode text NOT NULL,origin text NOT NULL,
  "deploymentId" text NOT NULL,"releaseSha" varchar(40) NOT NULL,"configHash" varchar(64) NOT NULL,
  "authorizationEvidenceHash" varchar(64) NOT NULL,"createdAt" timestamp(3) NOT NULL,
  "expiresAt" timestamp(3) NOT NULL,"revokedAt" timestamp(3),
  CHECK (("accessVersion">0 AND "controlRevision">0 AND mode IN ('PRODUCTION','LOCAL_FIXTURE')
    AND "releaseSha" ~ '^[a-f0-9]{40}$' AND "configHash" ~ '^[a-f0-9]{64}$'
    AND "authorizationEvidenceHash" ~ '^[a-f0-9]{64}$' AND "expiresAt">"createdAt"
    AND ("revokedAt" IS NULL OR "revokedAt">="createdAt")) IS TRUE)
);
CREATE INDEX "StaffOperationsGrant_identity_idx" ON "StaffOperationsGrant"("identityId");
CREATE FUNCTION atlas_staff.operations_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'revokedAt') IS DISTINCT FROM (to_jsonb(OLD)-'revokedAt')
    OR OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL THEN RAISE EXCEPTION 'ATLAS operations grant is immutable except one-way revocation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffOperationsGrant_guard" BEFORE UPDATE ON "StaffOperationsGrant"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operations_grant_guard();
CREATE FUNCTION atlas_staff.lock_operations_grants(identity_id uuid) RETURNS SETOF atlas_staff."StaffOperationsGrant"
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT * FROM atlas_staff."StaffOperationsGrant" WHERE "identityId"=identity_id FOR SHARE;
$$;
REVOKE ALL ON FUNCTION atlas_staff.lock_operations_grants(uuid) FROM PUBLIC;

CREATE TABLE "StaffIntakeControl" (
  id text PRIMARY KEY DEFAULT 'active',enabled boolean NOT NULL DEFAULT false,mode text NOT NULL,origin text NOT NULL,
  "deploymentId" text NOT NULL,"releaseSha" varchar(40) NOT NULL,"configHash" varchar(64) NOT NULL,
  "clientKeyHash" varchar(64) NOT NULL,"gradingPolicyHash" varchar(64) NOT NULL,revision integer NOT NULL DEFAULT 1,
  "updatedAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CHECK ((id='active' AND revision>0 AND mode IN ('PRODUCTION','LOCAL_FIXTURE') AND "releaseSha" ~ '^[a-f0-9]{40}$'
    AND "configHash" ~ '^[a-f0-9]{64}$' AND "clientKeyHash" ~ '^[a-f0-9]{64}$' AND "gradingPolicyHash" ~ '^[a-f0-9]{64}$') IS TRUE)
);
CREATE TRIGGER "StaffIntakeControl_change" BEFORE UPDATE ON "StaffIntakeControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_control_guard();
CREATE TABLE "StaffSourceAdmission" (
  id uuid PRIMARY KEY,"actorId" uuid NOT NULL REFERENCES "StaffIdentity"(id) ON DELETE RESTRICT,
  "sessionHash" varchar(64) NOT NULL REFERENCES "StaffSession"("tokenHash") ON DELETE RESTRICT,
  "operationsGrantId" uuid NOT NULL REFERENCES "StaffOperationsGrant"(id) ON DELETE RESTRICT,"controlRevision" integer NOT NULL,
  "sourceType" text NOT NULL,"sourceId" varchar(128) NOT NULL,"sourceOwnerId" varchar(128) NOT NULL,
  "sourceRevision" varchar(80) NOT NULL,title varchar(200) NOT NULL,subtitle varchar(300) NOT NULL,
  "evidenceCanonical" text NOT NULL,"evidenceHash" varchar(64) NOT NULL,"admissionCanonical" text NOT NULL,"admissionHash" varchar(64) NOT NULL,
  "gradingPolicyHash" varchar(64) NOT NULL,"bridgeConfigHash" varchar(64) NOT NULL,"createdAt" timestamp(3) NOT NULL,"expiresAt" timestamp(3) NOT NULL,
  CHECK (("controlRevision">0 AND "sourceType" IN ('SPEEDSTER','LOCAL_FIXTURE') AND length(title)>0
    AND octet_length("evidenceCanonical")<=131072 AND octet_length("admissionCanonical")<=8192
    AND "evidenceHash"=encode(sha256(convert_to("evidenceCanonical",'UTF8')),'hex')
    AND "admissionHash"=encode(sha256(convert_to("admissionCanonical",'UTF8')),'hex')
    AND "gradingPolicyHash" ~ '^[a-f0-9]{64}$' AND "bridgeConfigHash" ~ '^[a-f0-9]{64}$'
    AND "expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '5 minutes') IS TRUE)
);
CREATE INDEX "StaffSourceAdmission_scope_idx" ON "StaffSourceAdmission"("actorId","sessionHash","operationsGrantId","sourceType","sourceId","sourceOwnerId","createdAt");
CREATE FUNCTION atlas_staff.lock_source_admissions(actor_id uuid,session_hash text,grant_id uuid,source_type text,source_id text,owner_id text)
RETURNS SETOF atlas_staff."StaffSourceAdmission" LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE a atlas_staff."StaffSourceAdmission"%ROWTYPE;c atlas_staff."StaffControl"%ROWTYPE; ic atlas_staff."StaffIntakeControl"%ROWTYPE;
  now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  SELECT * INTO c FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  SELECT * INTO ic FROM atlas_staff."StaffIntakeControl" WHERE id='active' FOR SHARE;
  IF (c.enabled AND ic.enabled AND c.mode=ic.mode AND c."gradingPolicyHash"=ic."gradingPolicyHash") IS NOT TRUE THEN RETURN; END IF;
  FOR a IN SELECT * FROM atlas_staff."StaffSourceAdmission" WHERE "actorId"=actor_id AND "sessionHash"=session_hash
    AND "operationsGrantId"=grant_id AND "sourceType"=source_type AND "sourceId"=source_id AND "sourceOwnerId"=owner_id
    AND "controlRevision"=c.revision AND "gradingPolicyHash"=c."gradingPolicyHash" AND "bridgeConfigHash"=ic."configHash"
    AND "createdAt"<=now_at AND "expiresAt">now_at ORDER BY "createdAt" DESC,id DESC FOR SHARE LOOP
    IF a."sourceType"='LOCAL_FIXTURE' AND c.mode='LOCAL_FIXTURE'
      OR a."sourceType"='SPEEDSTER' AND c.mode='PRODUCTION' AND atlas_staff.operator_source_matches(a."sourceId",a."sourceOwnerId",a."sourceRevision") THEN
      RETURN NEXT a;RETURN;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION atlas_staff.lock_source_admissions(uuid,text,uuid,text,text,text) FROM PUBLIC;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['StaffOperationsGrant','StaffIntakeControl','StaffSourceAdmission'] LOOP
    EXECUTE format('REVOKE ALL ON atlas_staff.%I FROM PUBLIC',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON atlas_staff.%I FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable()',t||'_no_delete',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON atlas_staff.%I FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable()',t||'_no_truncate',t);
  END LOOP;
END $$;
CREATE TRIGGER "StaffSourceAdmission_immutable" BEFORE UPDATE ON "StaffSourceAdmission"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();

CREATE FUNCTION atlas_staff.operations_audit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE d jsonb:=NEW.details::jsonb;g atlas_staff."StaffOperationsGrant"%ROWTYPE;i atlas_staff."StaffIdentity"%ROWTYPE;
  s atlas_staff."StaffSession"%ROWTYPE;b atlas_staff."StaffBrowser"%ROWTYPE;c atlas_staff."StaffControl"%ROWTYPE;
  now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF NEW.event NOT IN ('SPECIMEN_INTAKE_ADMITTED','STAFF_ROSTER_UPDATED','STAFF_ASSIGNMENT_UPDATED','TEN_CARD_PILOT_PREPARED','INVOICE_COST_RECONCILED') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO g FROM atlas_staff."StaffOperationsGrant" WHERE id=(d->>'operationsGrantId')::uuid FOR SHARE;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=NEW."actorId" FOR SHARE;
  SELECT * INTO s FROM atlas_staff."StaffSession" WHERE "tokenHash"=d->>'sessionHash' FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=s."browserHash" FOR SHARE;
  SELECT * INTO c FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  IF (c.enabled AND g."identityId"=i.id AND g."revokedAt" IS NULL AND g."createdAt"<=now_at AND g."expiresAt">now_at
    AND g."accessVersion"=i."accessVersion" AND g."controlRevision"=c.revision AND g.mode=c.mode AND g.origin=c.origin
    AND g."deploymentId"=c."deploymentId" AND g."releaseSha"=c."releaseSha" AND g."configHash"=c."configHash"
    AND i."revokedAt" IS NULL AND s."identityId"=i.id AND s."revokedAt" IS NULL AND s."expiresAt">now_at
    AND s."createdAt">=now_at-interval '5 minutes' AND s."createdAt"<=now_at AND s."accessVersion"=i."accessVersion"
    AND s."controlRevision"=c.revision AND b."controlRevision"=c.revision AND b."expiresAt">now_at
    AND (d->>'accessVersion')::int=i."accessVersion" AND (d->>'controlRevision')::int=c.revision
    AND d->>'version'='atlas-human-operations-v1' AND d->>'inputHash' ~ '^[a-f0-9]{64}$'
    AND d->>'authorizationEvidenceHash' ~ '^[a-f0-9]{64}$' AND length(trim(d->>'reason'))>0
  ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS operations audit requires current human capability'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffAudit_operations_authority" BEFORE INSERT ON "StaffAudit"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operations_audit_guard();

-- The restricted operations credential cannot perform an unaudited direct
-- write. Each changed row must match its fresh immutable human receipt in the
-- same transaction. Offline owner provisioning remains a separate authority.
CREATE FUNCTION atlas_staff.operations_change_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE audit atlas_staff."StaffAudit"%ROWTYPE;d jsonb;p jsonb:=to_jsonb(NEW);wanted text;subject text;
  admitted atlas_staff."StaffSourceAdmission"%ROWTYPE; matched boolean:=false;
BEGIN
  IF session_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='atlas_staff."StaffOperationsGrant"'::regclass)
    OR NOT has_table_privilege(session_user,'atlas_staff."StaffOperationsGrant"','SELECT') THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='StaffIdentity' THEN wanted:='STAFF_ROSTER_UPDATED';subject:=p->>'id';
  ELSIF TG_TABLE_NAME='StaffAssignment' THEN wanted:='STAFF_ASSIGNMENT_UPDATED';subject:=p->>'specimenId';
  ELSIF TG_TABLE_NAME='StaffSpecimen' THEN wanted:='SPECIMEN_INTAKE_ADMITTED';subject:=NULL;
  ELSE
    IF (p->'actualMicroUsd',p->'costEvidenceHash') IS NOT DISTINCT FROM (to_jsonb(OLD)->'actualMicroUsd',to_jsonb(OLD)->'costEvidenceHash') THEN RETURN NULL; END IF;
    wanted:='INVOICE_COST_RECONCILED';subject:=coalesce(p->>'operationId',p->>'id');
  END IF;
  FOR audit IN SELECT * FROM atlas_staff."StaffAudit" WHERE event=wanted AND (subject IS NULL OR "subjectId"=subject)
    AND "createdAt">=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') LOOP
    d:=audit.details::jsonb;
    IF TG_TABLE_NAME='StaffIdentity' THEN
      matched:=d->'receipt'->>'identityId'=p->>'id' AND (d->'receipt'->>'accessVersion')::int=NEW."accessVersion"
        AND d->'after'->>'role'=NEW.role AND (d->'after'->>'revoked')::boolean=(NEW."revokedAt" IS NOT NULL)
        AND ((d->'after'->>'certificationUntil')::timestamptz AT TIME ZONE 'UTC') IS NOT DISTINCT FROM NEW."certificationUntil"
        AND ((d->'after'->>'trustedLearningUntil')::timestamptz AT TIME ZONE 'UTC') IS NOT DISTINCT FROM NEW."trustedLearningUntil";
    ELSIF TG_TABLE_NAME='StaffAssignment' THEN
      matched:=d->'receipt'->>'specimenId'=NEW."specimenId"::text AND d->'receipt'->>'identityId'=NEW."identityId"::text
        AND (d->'receipt'->>'fence')::int=NEW.fence AND (d->'assignment'->>'canReview')::boolean=NEW."canReview"
        AND (d->'assignment'->>'revoked')::boolean=(NEW."revokedAt" IS NOT NULL)
        AND (d->'assignment'->>'expiresAt')::timestamptz AT TIME ZONE 'UTC'=NEW."expiresAt";
    ELSIF TG_TABLE_NAME='StaffSpecimen' THEN
      SELECT * INTO admitted FROM atlas_staff.lock_source_admissions(audit."actorId",d->>'sessionHash',(d->>'operationsGrantId')::uuid,
        NEW."sourceType",NEW."sourceId",NEW."sourceOwnerId");
      matched:=d->'receipt'->>'specimenId'=NEW.id::text AND d->'receipt'->>'evidenceHash'=NEW."evidenceHash"
        AND admitted.id IS NOT NULL AND admitted."evidenceCanonical"=NEW."evidenceCanonical" AND admitted."evidenceHash"=NEW."evidenceHash"
        AND admitted.title=NEW.title AND admitted.subtitle=NEW.subtitle AND admitted."admissionCanonical"=d->>'admissionCanonical'
        AND NEW."evidenceRevision"=1 AND NEW."draftRevision"=1 AND NEW."analysisRevision"=0;
    ELSE
      matched:=d->'receipt'->>'recordId'=subject AND d->'receipt'->>'actualMicroUsd'=p->>'actualMicroUsd'
        AND d->'receipt'->>'costEvidenceHash'=p->>'costEvidenceHash'
        AND encode(sha256(convert_to(d->>'costEvidence','UTF8')),'hex')=p->>'costEvidenceHash'
        AND d->'receipt'->>'kind'=CASE WHEN TG_TABLE_NAME='StaffGradingExecution' THEN 'WORKER' ELSE 'ASTRA' END;
    END IF;
    IF matched IS TRUE THEN RETURN NULL; END IF;
  END LOOP;
  RAISE EXCEPTION 'ATLAS operations change requires its exact current human audit';
END $$;
CREATE CONSTRAINT TRIGGER "StaffIdentity_operations_audit" AFTER UPDATE ON "StaffIdentity" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operations_change_guard();
CREATE CONSTRAINT TRIGGER "StaffAssignment_operations_audit" AFTER INSERT OR UPDATE ON "StaffAssignment" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operations_change_guard();
CREATE CONSTRAINT TRIGGER "StaffSpecimen_operations_audit" AFTER INSERT ON "StaffSpecimen" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operations_change_guard();
CREATE CONSTRAINT TRIGGER "StaffGradingExecution_operations_audit" AFTER UPDATE ON "StaffGradingExecution" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operations_change_guard();
CREATE CONSTRAINT TRIGGER "StaffOperatorAttempt_operations_audit" AFTER UPDATE ON "StaffOperatorAttempt" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operations_change_guard();
COMMIT;
