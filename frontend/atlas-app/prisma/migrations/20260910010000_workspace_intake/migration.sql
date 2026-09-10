BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;

CREATE TABLE "StaffWorkspaceControl" (
  id text PRIMARY KEY DEFAULT 'active', enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL, "releaseSha" varchar(40) NOT NULL, "configHash" varchar(64) NOT NULL,
  "cohortId" uuid NOT NULL, "maxCards" integer NOT NULL DEFAULT 10,
  "intakeEnabled" boolean NOT NULL DEFAULT false, "claimsEnabled" boolean NOT NULL DEFAULT false,
  "preparationEnabled" boolean NOT NULL DEFAULT false,
  "astraEnabled" boolean NOT NULL DEFAULT false, "processingLimit" integer NOT NULL DEFAULT 1,
  "expiresAt" timestamp(3) NOT NULL, revision integer NOT NULL DEFAULT 1,
  "updatedAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT "StaffWorkspaceControl_shape" CHECK (id='active' AND mode IN ('PRODUCTION','LOCAL_FIXTURE')
    AND "releaseSha" ~ '^[a-f0-9]{40}$' AND "configHash" ~ '^[a-f0-9]{64}$'
    AND "maxCards"=10 AND "processingLimit" IN (1,10) AND revision>0)
);
CREATE TRIGGER "StaffWorkspaceControl_change" BEFORE UPDATE ON "StaffWorkspaceControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_control_guard();

CREATE TABLE "StaffWorkspaceCard" (
  id uuid PRIMARY KEY, "creatorId" uuid NOT NULL REFERENCES "StaffIdentity"(id) ON DELETE RESTRICT,
  "cohortId" uuid NOT NULL, revision integer NOT NULL, state text NOT NULL, stage text NOT NULL,
  "specimenId" uuid UNIQUE REFERENCES "StaffSpecimen"(id) ON DELETE RESTRICT,
  canonical text NOT NULL, "contentHash" varchar(64) NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  "updatedAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT "StaffWorkspaceCard_shape" CHECK ((revision>0 AND octet_length(canonical)<=262144
    AND state IN ('DRAFT','WAITING','IN_PROGRESS','NEEDS_ATTENTION','HUMAN_REVIEW','APPROVED')
    AND stage IN ('PHOTOS','IDENTITY','PREPARATION','CENTERING','INSPECTION','REPORT','REVIEW','FINISHING')
    AND "contentHash"=encode(sha256(convert_to(canonical,'UTF8')),'hex')
    AND jsonb_typeof(canonical::jsonb)='object'
    AND canonical::jsonb->>'id'=id::text AND canonical::jsonb->>'creatorId'="creatorId"::text
    AND canonical::jsonb->>'cohortId'="cohortId"::text AND (canonical::jsonb->>'revision')::integer=revision
    AND canonical::jsonb->>'state'=state AND canonical::jsonb->>'stage'=stage
    AND (canonical::jsonb->>'specimenId') IS NOT DISTINCT FROM "specimenId"::text
    AND jsonb_typeof(canonical::jsonb->'sides')='object'
    AND canonical::jsonb->'source'->>'sourceId'='atlas-'||id::text
    AND canonical::jsonb->'source'->>'sourceOwnerId'='atlas-staff-'||"creatorId"::text
    AND canonical::jsonb->'source'->>'sourceType' IN ('SPEEDSTER','LOCAL_FIXTURE')
    AND (canonical::jsonb->>'claimFence')::integer>=0 AND (canonical::jsonb->>'captureRevision')::integer>=0
    AND "updatedAt">="createdAt") IS TRUE)
);
CREATE INDEX "StaffWorkspaceCard_cohortId_state_createdAt_idx" ON "StaffWorkspaceCard"("cohortId",state,"createdAt");

CREATE TABLE "StaffWorkspaceOperation" (
  id uuid PRIMARY KEY, "actorId" uuid NOT NULL REFERENCES "StaffIdentity"(id) ON DELETE RESTRICT,
  "operationId" varchar(80) NOT NULL, "cardId" uuid NOT NULL REFERENCES "StaffWorkspaceCard"(id) ON DELETE RESTRICT,
  action varchar(80) NOT NULL, "inputHash" varchar(64) NOT NULL,
  canonical text NOT NULL, "contentHash" varchar(64) NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  UNIQUE("actorId","operationId"),
  CONSTRAINT "StaffWorkspaceOperation_shape" CHECK (("operationId" ~ '^[a-zA-Z0-9_-]{8,80}$'
    AND "inputHash" ~ '^[a-f0-9]{64}$' AND octet_length(canonical)<=524288
    AND "contentHash"=encode(sha256(convert_to(canonical,'UTF8')),'hex')
    AND jsonb_typeof(canonical::jsonb)='object'
    AND canonical::jsonb->>'id'=id::text AND canonical::jsonb->>'actorId'="actorId"::text
    AND canonical::jsonb->>'operationId'="operationId" AND canonical::jsonb->>'cardId'="cardId"::text
    AND canonical::jsonb->>'action'=action AND canonical::jsonb->>'inputHash'="inputHash") IS TRUE)
);
CREATE INDEX "StaffWorkspaceOperation_cardId_createdAt_idx" ON "StaffWorkspaceOperation"("cardId","createdAt");

CREATE FUNCTION atlas_staff.lock_workspace_control() RETURNS SETOF atlas_staff."StaffWorkspaceControl"
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT * FROM atlas_staff."StaffWorkspaceControl" WHERE id='active' FOR SHARE;
$$;

CREATE FUNCTION atlas_staff.workspace_card_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE c atlas_staff."StaffWorkspaceControl"%ROWTYPE; n jsonb:=NEW.canonical::jsonb; o jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO c FROM atlas_staff."StaffWorkspaceControl" WHERE id='active' FOR SHARE;
  IF (c.enabled AND c."cohortId"=NEW."cohortId") IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS workspace not admitted'; END IF;
  IF TG_OP='INSERT' THEN
    IF (c."intakeEnabled" AND c."expiresAt">clock_timestamp() AT TIME ZONE 'UTC'
      AND NEW.revision=1 AND NEW.state='DRAFT' AND NEW.stage='PHOTOS' AND NEW."specimenId" IS NULL
      AND (n->>'claimFence')::integer=0 AND (n->>'captureRevision')::integer=0
      AND n->'claim'='null'::jsonb
      AND (SELECT count(*) FROM atlas_staff."StaffWorkspaceCard" WHERE "cohortId"=NEW."cohortId")<c."maxCards") IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS fresh photo cohort admission denied'; END IF;
    RETURN NEW;
  END IF;
  o:=OLD.canonical::jsonb;
  IF NEW.revision<>OLD.revision+1 OR (NEW.id,NEW."creatorId",NEW."cohortId",NEW."createdAt")
      IS DISTINCT FROM (OLD.id,OLD."creatorId",OLD."cohortId",OLD."createdAt")
    OR n->'source' IS DISTINCT FROM o->'source'
    OR ((o->>'startedAt') IS NOT NULL AND n->>'startedAt' IS DISTINCT FROM o->>'startedAt')
    OR (n->>'captureRevision')::integer NOT IN ((o->>'captureRevision')::integer,(o->>'captureRevision')::integer+1)
    OR (n->>'claimFence')::integer NOT IN ((o->>'claimFence')::integer,(o->>'claimFence')::integer+1)
    OR (OLD."specimenId" IS NOT NULL AND NEW."specimenId" IS DISTINCT FROM OLD."specimenId") THEN
    RAISE EXCEPTION 'ATLAS workspace revision or immutable source changed'; END IF;
  IF o->>'startedAt' IS NULL AND n->>'startedAt' IS NOT NULL THEN
    IF (c."claimsEnabled" AND c."expiresAt">clock_timestamp() AT TIME ZONE 'UTC'
      AND (SELECT count(*) FROM atlas_staff."StaffWorkspaceCard" WHERE "cohortId"=NEW."cohortId"
        AND canonical::jsonb->>'startedAt' IS NOT NULL)<c."processingLimit") IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS first card processing gate'; END IF;
  END IF;
  IF n->'claim'<>'null'::jsonb AND ((n->'claim'->>'fence')::integer<>(n->>'claimFence')::integer
    OR (n->'claim'->>'captureRevision')::integer<>(n->>'captureRevision')::integer
    OR n->'claim'->>'captureHash' IS DISTINCT FROM n->>'captureHash') THEN
    RAISE EXCEPTION 'ATLAS workspace claim evidence changed'; END IF;
  IF NEW.state='APPROVED' AND NOT EXISTS (SELECT 1 FROM atlas_staff."StaffPublicReport" p
    JOIN atlas_staff."StaffReportApproval" a ON a.id=p."currentApprovalId"
    JOIN atlas_staff."StaffSpecimen" s ON s.id=p."specimenId"
    WHERE s.id=NEW."specimenId" AND a."analysisRevision"=s."analysisRevision"
      AND a."reviewRevision"=s."draftRevision" AND a."evidenceHash"=s."evidenceHash") THEN
    RAISE EXCEPTION 'ATLAS exact human approval required'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffWorkspaceCard_guard" BEFORE INSERT OR UPDATE ON "StaffWorkspaceCard"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.workspace_card_guard();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['StaffWorkspaceControl','StaffWorkspaceCard','StaffWorkspaceOperation'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON atlas_staff.%I FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable()',t||'_no_delete',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON atlas_staff.%I FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable()',t||'_no_truncate',t);
    EXECUTE format('REVOKE ALL ON atlas_staff.%I FROM PUBLIC',t);
  END LOOP;
END $$;
CREATE TRIGGER "StaffWorkspaceOperation_immutable" BEFORE UPDATE ON "StaffWorkspaceOperation"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
REVOKE ALL ON FUNCTION atlas_staff.lock_workspace_control(),atlas_staff.workspace_card_guard() FROM PUBLIC;
COMMIT;
