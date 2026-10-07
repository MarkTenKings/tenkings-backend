BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;

CREATE TABLE "StaffWorkspaceSourceControl" (
  id text PRIMARY KEY DEFAULT 'active', enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL, "releaseSha" varchar(40) NOT NULL, "configHash" varchar(64) NOT NULL,
  "sourceConfigHash" varchar(64) NOT NULL,"sourceDeploymentId" varchar(120) NOT NULL,"sourceReleaseSha" varchar(40) NOT NULL,
  "cohortId" uuid NOT NULL,"pilotId" uuid NOT NULL,"physicalReserveMicroUsd" bigint NOT NULL,
  "preparationReserveMicroUsd" bigint NOT NULL,"registrationReserveMicroUsd" bigint NOT NULL DEFAULT 0,"infrastructureReserveMicroUsd" bigint NOT NULL,
  "expiresAt" timestamp(3) NOT NULL,revision integer NOT NULL DEFAULT 1,"updatedAt" timestamp(3) NOT NULL,
  CHECK (id='active' AND revision>0 AND mode IN ('PRODUCTION','LOCAL_FIXTURE')
    AND "releaseSha" ~ '^[a-f0-9]{40}$' AND "sourceReleaseSha" ~ '^[a-f0-9]{40}$'
    AND "configHash" ~ '^[a-f0-9]{64}$' AND "sourceConfigHash" ~ '^[a-f0-9]{64}$'
    AND "sourceDeploymentId" ~ '^[a-zA-Z0-9._-]{1,120}$'
    AND "physicalReserveMicroUsd" BETWEEN 1 AND 90000000 AND "preparationReserveMicroUsd" BETWEEN 1 AND 90000000
    AND "registrationReserveMicroUsd" BETWEEN 0 AND 90000000 AND "infrastructureReserveMicroUsd" BETWEEN 0 AND 90000000)
);
CREATE TABLE "StaffWorkspaceInfrastructureReservation" (
  id uuid PRIMARY KEY,"pilotId" uuid NOT NULL,"sourceConfigHash" varchar(64) NOT NULL,
  "reservedMicroUsd" bigint NOT NULL,"actualMicroUsd" bigint,"costEvidenceHash" varchar(64),
  "createdAt" timestamp(3) NOT NULL,"expiresAt" timestamp(3) NOT NULL,
  UNIQUE ("pilotId","sourceConfigHash"),
  CHECK ("sourceConfigHash" ~ '^[a-f0-9]{64}$' AND "reservedMicroUsd" BETWEEN 0 AND 90000000
    AND "expiresAt">"createdAt" AND (("actualMicroUsd" IS NULL AND "costEvidenceHash" IS NULL)
      OR "actualMicroUsd">=0 AND "costEvidenceHash" ~ '^[a-f0-9]{64}$'))
);
CREATE TABLE "StaffWorkspaceSourceOperation" (
  id uuid PRIMARY KEY,"requestId" uuid NOT NULL REFERENCES "StaffWorkspaceOperation"(id) ON DELETE RESTRICT,
  "cardId" uuid NOT NULL REFERENCES "StaffWorkspaceCard"(id) ON DELETE RESTRICT,"cohortId" uuid NOT NULL,"pilotId" uuid NOT NULL,
  purpose text NOT NULL,side text NOT NULL,"sourceConfigHash" varchar(64) NOT NULL,"sourceControlRevision" integer NOT NULL,
  "bindingCanonical" text NOT NULL,"bindingHash" varchar(64) NOT NULL,"requestCanonical" text NOT NULL,"requestHash" varchar(64) NOT NULL,
  "runId" uuid REFERENCES "StaffOperatorRun"(id) ON DELETE RESTRICT,"runControlRevision" integer,
  "gradingExecutionId" uuid REFERENCES "StaffGradingExecution"("operationId") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  state text NOT NULL,"reservedMicroUsd" bigint NOT NULL,"actualMicroUsd" bigint,"costEvidenceHash" varchar(64),
  "resultCanonical" text,"resultHash" varchar(64),"failureCode" varchar(80),
  "createdAt" timestamp(3) NOT NULL,"dispatchedAt" timestamp(3),"finishedAt" timestamp(3),
  UNIQUE ("requestId",purpose,side),
  CHECK ((purpose IN ('PHYSICAL_GEOMETRY','PREPARATION','MAP_REGISTRATION','INITIALIZE_REPORT')
    AND (purpose='INITIALIZE_REPORT' AND side='PAIR' AND "reservedMicroUsd"=0
      OR purpose<>'INITIALIZE_REPORT' AND side IN ('FRONT','BACK') AND "reservedMicroUsd" BETWEEN 1 AND 90000000)
    AND "sourceConfigHash" ~ '^[a-f0-9]{64}$' AND "sourceControlRevision">0
    AND octet_length("bindingCanonical")<=65536 AND jsonb_typeof("bindingCanonical"::jsonb)='object'
    AND "bindingHash"=encode(sha256(convert_to("bindingCanonical",'UTF8')),'hex')
    AND octet_length("requestCanonical")<=524288 AND jsonb_typeof("requestCanonical"::jsonb)='object'
    AND "requestHash"=encode(sha256(convert_to("requestCanonical",'UTF8')),'hex')
    AND (("resultCanonical" IS NULL AND "resultHash" IS NULL)
      OR octet_length("resultCanonical")<=2097152 AND jsonb_typeof("resultCanonical"::jsonb)='object'
        AND "resultHash"=encode(sha256(convert_to("resultCanonical",'UTF8')),'hex'))
    AND (("actualMicroUsd" IS NULL AND "costEvidenceHash" IS NULL)
      OR "actualMicroUsd">=0 AND "costEvidenceHash" ~ '^[a-f0-9]{64}$')
    AND (("runId" IS NULL AND "runControlRevision" IS NULL) OR "runId" IS NOT NULL AND "runControlRevision">0)
    AND ((state='RESERVED' AND "dispatchedAt" IS NULL AND "finishedAt" IS NULL AND "resultCanonical" IS NULL AND "failureCode" IS NULL)
      OR state='DISPATCHED' AND "dispatchedAt" IS NOT NULL AND "finishedAt" IS NULL AND "resultCanonical" IS NULL AND "failureCode" IS NULL
      OR state='SUCCEEDED' AND "dispatchedAt" IS NOT NULL AND "finishedAt" IS NOT NULL AND "resultCanonical" IS NOT NULL AND "failureCode" IS NULL
      OR state IN ('FAILED','UNKNOWN') AND "finishedAt" IS NOT NULL AND "failureCode" IS NOT NULL)) IS TRUE)
);
CREATE TABLE "StaffWorkspaceSourceActionPermit" (
  "requestId" uuid PRIMARY KEY REFERENCES "StaffWorkspaceOperation"(id) ON DELETE RESTRICT,
  "cardId" uuid NOT NULL REFERENCES "StaffWorkspaceCard"(id) ON DELETE RESTRICT,
  "runId" uuid NOT NULL REFERENCES "StaffOperatorRun"(id) ON DELETE RESTRICT,
  "runRevision" integer NOT NULL,"runControlRevision" integer NOT NULL,"claimFence" integer NOT NULL,
  "captureHash" varchar(64) NOT NULL,"selectionStepId" uuid NOT NULL REFERENCES "StaffOperatorStep"(id) ON DELETE RESTRICT,
  "selectionResultHash" varchar(64) NOT NULL,mode text NOT NULL,state text NOT NULL,
  "createdAt" timestamp(3) NOT NULL,"finishedAt" timestamp(3),
  CHECK ("runRevision">1 AND "runControlRevision">0 AND "claimFence">0
    AND "captureHash" ~ '^[a-f0-9]{64}$' AND "selectionResultHash" ~ '^[a-f0-9]{64}$'
    AND mode IN ('STEP','CONTINUOUS') AND (state='ACTIVE' AND "finishedAt" IS NULL
      OR state IN ('SUCCEEDED','FAILED','UNKNOWN') AND "finishedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "StaffWorkspaceSourceActionPermit_active_run" ON "StaffWorkspaceSourceActionPermit"("runId")
  WHERE state IN ('ACTIVE','UNKNOWN');
CREATE INDEX "StaffWorkspaceSourceOperation_pilot_card" ON "StaffWorkspaceSourceOperation"("pilotId","cardId");
CREATE INDEX "StaffWorkspaceSourceOperation_run_state" ON "StaffWorkspaceSourceOperation"("runId",state);

CREATE TRIGGER "StaffWorkspaceSourceControl_change" BEFORE UPDATE ON "StaffWorkspaceSourceControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_control_guard();
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['StaffWorkspaceSourceControl','StaffWorkspaceInfrastructureReservation','StaffWorkspaceSourceOperation','StaffWorkspaceSourceActionPermit'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON atlas_staff.%I FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable()',name||'_no_delete',name);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON atlas_staff.%I FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable()',name||'_no_truncate',name);
  END LOOP;
END $$;
REVOKE ALL ON "StaffWorkspaceSourceControl","StaffWorkspaceInfrastructureReservation","StaffWorkspaceSourceOperation","StaffWorkspaceSourceActionPermit" FROM PUBLIC;

-- Every worker phase and every model phase charges the original pilot. Old
-- unlinked specimens and infrastructure remain in the total after a rotation.
CREATE FUNCTION atlas_staff.workspace_pilot_costs(pilot uuid)
RETURNS TABLE(workspace uuid,specimen uuid,cost numeric,overrun boolean,kind text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT w.id,o."specimenId",coalesce(e."actualMicroUsd",e."reservedMicroUsd")::numeric,
    coalesce(e."actualMicroUsd">e."reservedMicroUsd",false),'GRADING'
  FROM atlas_staff."StaffGradingExecution" e JOIN atlas_staff."StaffGradingOperation" o ON o.id=e."operationId"
    LEFT JOIN atlas_staff."StaffWorkspaceCard" w ON w."specimenId"=o."specimenId" WHERE e."pilotId"=pilot
  UNION ALL
  SELECT coalesce(r."workspaceCardId",w.id),r."specimenId",
    CASE WHEN a.state='FAILED' AND a."dispatchedAt" IS NULL THEN 0 ELSE coalesce(a."actualMicroUsd",a."usageCeilingMicroUsd",a."reservedMicroUsd") END,
    a."usageEnvelopeExceeded" OR coalesce(a."usageCeilingMicroUsd">a."reservedMicroUsd",false)
      OR coalesce(a."actualMicroUsd">coalesce(a."usageCeilingMicroUsd",a."reservedMicroUsd"),false),'ASTRA'
  FROM atlas_staff."StaffOperatorAttempt" a JOIN atlas_staff."StaffOperatorRun" r ON r.id=a."runId"
    LEFT JOIN atlas_staff."StaffWorkspaceCard" w ON w."specimenId"=r."specimenId" WHERE r."pilotId"=pilot
  UNION ALL
  SELECT s."cardId",w."specimenId",CASE WHEN s.state='FAILED' AND s."dispatchedAt" IS NULL THEN 0
    ELSE coalesce(s."actualMicroUsd",s."reservedMicroUsd") END,coalesce(s."actualMicroUsd">s."reservedMicroUsd",false),'SOURCE'
  FROM atlas_staff."StaffWorkspaceSourceOperation" s JOIN atlas_staff."StaffWorkspaceCard" w ON w.id=s."cardId"
    WHERE s."pilotId"=pilot AND s.purpose<>'INITIALIZE_REPORT'
  UNION ALL
  SELECT NULL::uuid,NULL::uuid,coalesce(i."actualMicroUsd",i."reservedMicroUsd"),
    coalesce(i."actualMicroUsd">i."reservedMicroUsd",false),'INFRASTRUCTURE'
  FROM atlas_staff."StaffWorkspaceInfrastructureReservation" i WHERE i."pilotId"=pilot;
$$;
CREATE OR REPLACE FUNCTION atlas_staff.workspace_pilot_budget_usage(pilot uuid,workspace uuid)
RETURNS TABLE(total text,card text,operations integer,attempts integer,overrun boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT coalesce(sum(c.cost),0)::text,coalesce(sum(c.cost) FILTER(WHERE c.workspace=workspace_pilot_budget_usage.workspace),0)::text,
    count(*) FILTER(WHERE c.workspace=workspace_pilot_budget_usage.workspace AND c.kind='GRADING')::integer,
    count(*) FILTER(WHERE c.workspace=workspace_pilot_budget_usage.workspace AND c.kind='ASTRA')::integer,
    coalesce(bool_or(c.overrun),false) FROM atlas_staff.workspace_pilot_costs(pilot) c;
$$;
CREATE OR REPLACE FUNCTION atlas_staff.pilot_budget_usage(pilot uuid,specimen uuid)
RETURNS TABLE(total text,card text,operations integer,attempts integer,overrun boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT coalesce(sum(c.cost),0)::text,coalesce(sum(c.cost) FILTER(WHERE c.specimen=pilot_budget_usage.specimen),0)::text,
    count(*) FILTER(WHERE c.specimen=pilot_budget_usage.specimen AND c.kind='GRADING')::integer,
    count(*) FILTER(WHERE c.specimen=pilot_budget_usage.specimen AND c.kind='ASTRA')::integer,
    coalesce(bool_or(c.overrun),false) FROM atlas_staff.workspace_pilot_costs(pilot) c;
$$;

CREATE FUNCTION atlas_staff.workspace_source_operation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE s atlas_staff."StaffWorkspaceSourceControl"%ROWTYPE;c atlas_staff."StaffWorkspaceControl"%ROWTYPE;
  w atlas_staff."StaffWorkspaceCard"%ROWTYPE;b atlas_staff."StaffGradingBridgeControl"%ROWTYPE;
  o atlas_staff."StaffWorkspaceOperation"%ROWTYPE;r atlas_staff."StaffOperatorRun"%ROWTYPE;permit atlas_staff."StaffWorkspaceSourceActionPermit"%ROWTYPE;
  p jsonb;n jsonb;q jsonb;u record;reserve bigint;at_time timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['state','dispatchedAt','finishedAt','resultCanonical','resultHash','failureCode','actualMicroUsd','costEvidenceHash','gradingExecutionId'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','dispatchedAt','finishedAt','resultCanonical','resultHash','failureCode','actualMicroUsd','costEvidenceHash','gradingExecutionId'])
      OR OLD."gradingExecutionId" IS NOT NULL AND NEW."gradingExecutionId" IS DISTINCT FROM OLD."gradingExecutionId"
      OR OLD."dispatchedAt" IS NOT NULL AND NEW."dispatchedAt" IS DISTINCT FROM OLD."dispatchedAt"
      OR OLD."actualMicroUsd" IS NOT NULL AND (NEW."actualMicroUsd",NEW."costEvidenceHash") IS DISTINCT FROM (OLD."actualMicroUsd",OLD."costEvidenceHash") THEN
      RAISE EXCEPTION 'ATLAS source request and observed cost are immutable'; END IF;
    IF (to_jsonb(NEW)-ARRAY['actualMicroUsd','costEvidenceHash']) IS NOT DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['actualMicroUsd','costEvidenceHash']) THEN RETURN NEW; END IF;
    IF NOT (OLD.state='RESERVED' AND NEW.state IN ('DISPATCHED','FAILED')
      OR OLD.state='DISPATCHED' AND NEW.state IN ('SUCCEEDED','FAILED','UNKNOWN')) THEN
      RAISE EXCEPTION 'ATLAS source work cannot redispatch'; END IF;
    -- Record a late outcome even if access was revoked. Its reservation and
    -- original result remain held; only source persistence uses current proof.
    IF OLD.state='DISPATCHED' THEN RETURN NEW; END IF;
    IF NEW.state='FAILED' THEN RETURN NEW; END IF;
  ELSIF NEW.state<>'RESERVED' OR NEW."actualMicroUsd" IS NOT NULL OR NEW."gradingExecutionId" IS NOT NULL THEN
    RAISE EXCEPTION 'ATLAS source work requires a fresh reservation';
  END IF;
  SELECT * INTO s FROM atlas_staff."StaffWorkspaceSourceControl" WHERE id='active' FOR SHARE;
  SELECT * INTO c FROM atlas_staff."StaffWorkspaceControl" WHERE id='active' FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE;
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=NEW."cardId" FOR SHARE;
  SELECT * INTO o FROM atlas_staff."StaffWorkspaceOperation" WHERE id=NEW."requestId" FOR SHARE;
  n:=w.canonical::jsonb;p:=b."policyCanonical"::jsonb;q:=o.canonical::jsonb->'result';
  reserve:=CASE NEW.purpose WHEN 'PHYSICAL_GEOMETRY' THEN s."physicalReserveMicroUsd"
    WHEN 'PREPARATION' THEN s."preparationReserveMicroUsd" WHEN 'MAP_REGISTRATION' THEN s."registrationReserveMicroUsd" ELSE 0 END;
  IF (s.enabled AND c.enabled AND c."preparationEnabled" AND b.enabled AND s.mode=c.mode AND b.mode=c.mode
    AND s."releaseSha"=c."releaseSha" AND s."configHash"=c."configHash" AND NEW."sourceConfigHash"=s."sourceConfigHash"
    AND NEW."sourceControlRevision"=s.revision AND NEW."cohortId"=w."cohortId" AND w."cohortId"=c."cohortId" AND s."cohortId"=c."cohortId"
    AND NEW."pilotId"=s."pilotId" AND p->>'pilotId'=s."pilotId"::text AND p->>'version'='atlas-workspace-bridge-policy-v1'
    AND p->'workspaceCardIds' ? w.id::text AND atlas_staff.operator_workspace_count(s."pilotId")=10
    AND s."expiresAt">at_time AND c."expiresAt">at_time AND (p->>'expiresAt')::timestamptz>clock_timestamp()
    AND NEW."reservedMicroUsd"=reserve AND o."cardId"=w.id AND o.action IN ('MANUAL_ACTION','MACHINE_SOURCE_ACTION')
    AND q->>'phase'='REQUESTED' AND q->>'requestId'=NEW."requestId"::text
    AND q->'binding'=NEW."bindingCanonical"::jsonb
    AND q->'binding'->>'captureHash'=n->>'captureHash' AND q->'binding'->>'captureRevision'=n->>'captureRevision'
    AND q->'binding'->>'claimFence'=n->>'claimFence' AND n->'claim'->>'fence'=n->>'claimFence'
    AND ((NEW.purpose='INITIALIZE_REPORT' AND q->>'action'='INITIALIZE_REPORT')
      OR NEW.purpose IN ('PHYSICAL_GEOMETRY','PREPARATION') AND q->>'action'='PREPARE_SIDE' AND q->'payload'->>'side'=NEW.side
      OR NEW.purpose='MAP_REGISTRATION' AND reserve>0
        AND (o.action='MANUAL_ACTION' AND q->>'action'='REGISTER_MAP' OR o.action='MACHINE_SOURCE_ACTION' AND q->>'action'='INITIALIZE_REPORT'))
    AND EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceInfrastructureReservation" i WHERE i."pilotId"=NEW."pilotId"
      AND i."sourceConfigHash"=s."sourceConfigHash" AND i."reservedMicroUsd"=s."infrastructureReserveMicroUsd" AND i."expiresAt">at_time)) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS source work requires its current immutable workspace request'; END IF;
  IF o.action='MACHINE_SOURCE_ACTION' THEN
    SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=NEW."runId" FOR SHARE;
    SELECT * INTO permit FROM atlas_staff."StaffWorkspaceSourceActionPermit" WHERE "requestId"=NEW."requestId" FOR SHARE;
    IF (c."astraEnabled" AND r.phase='CAPTURE_REVIEW' AND r.state='PREPARATION_READY' AND r."workspaceCardId"=w.id
      AND n->'claim'->>'kind'='ASTRA' AND n->'claim'->>'runId'=r.id::text AND atlas_staff.operator_capture_current(r.id)
      AND permit."runId"=r.id AND permit."cardId"=w.id AND permit."runRevision"=r.revision AND permit.state='ACTIVE'
      AND NEW."runControlRevision"=permit."runControlRevision" AND r."controlState" IN ('RUNNING','PAUSE_REQUESTED')
      AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=r.id AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN'))
      AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceOperation" x WHERE x."runId"=r.id AND x.id<>NEW.id
        AND x.state IN ('RESERVED','DISPATCHED','UNKNOWN'))) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS source machine permit unavailable'; END IF;
  ELSIF NEW."runId" IS NOT NULL OR n->'claim'->>'kind' IS DISTINCT FROM 'HUMAN' OR n->'claim'->>'actorId' IS DISTINCT FROM o."actorId"::text THEN
    RAISE EXCEPTION 'ATLAS source human claim changed';
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT * INTO u FROM atlas_staff.workspace_pilot_budget_usage(NEW."pilotId",NEW."cardId");
    IF (NOT u.overrun AND u.total::numeric+reserve<=least(90000000,(p->>'maxTotalMicroUsd')::numeric)
      AND u.card::numeric+reserve<=(p->>'maxCardMicroUsd')::numeric) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS source shared pilot budget denied'; END IF;
  ELSIF NEW.purpose='INITIALIZE_REPORT' AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffGradingExecution" e
    JOIN atlas_staff."StaffGradingOperation" g ON g.id=e."operationId"
    WHERE e."operationId"=NEW."gradingExecutionId" AND e."pilotId"=NEW."pilotId" AND e.state='RUNNING'
      AND g."specimenId"=w."specimenId" AND g.state='DISPATCHED' AND g."expectedAnalysisRevision"=0
      AND e."reservedMicroUsd"=(p->>'reservationPerOperationMicroUsd')::bigint) THEN
    RAISE EXCEPTION 'ATLAS initialization requires its original grading reservation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffWorkspaceSourceOperation_guard" BEFORE INSERT OR UPDATE ON "StaffWorkspaceSourceOperation"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.workspace_source_operation_guard();

CREATE FUNCTION atlas_staff.workspace_infrastructure_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE b atlas_staff."StaffGradingBridgeControl"%ROWTYPE;u record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['actualMicroUsd','costEvidenceHash']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['actualMicroUsd','costEvidenceHash'])
      OR OLD."actualMicroUsd" IS NOT NULL AND (NEW."actualMicroUsd",NEW."costEvidenceHash") IS DISTINCT FROM (OLD."actualMicroUsd",OLD."costEvidenceHash") THEN
      RAISE EXCEPTION 'ATLAS infrastructure reservation and observed cost are immutable'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE;
  SELECT * INTO u FROM atlas_staff.pilot_budget_usage(NEW."pilotId",NULL);
  IF (NEW."actualMicroUsd" IS NULL AND b."policyCanonical"::jsonb->>'pilotId'=NEW."pilotId"::text
    AND (NEW."expiresAt" AT TIME ZONE 'UTC')<=(b."policyCanonical"::jsonb->>'expiresAt')::timestamptz AND NOT u.overrun
    AND u.total::numeric+NEW."reservedMicroUsd"<=least(90000000,(b."policyCanonical"::jsonb->>'maxTotalMicroUsd')::numeric)) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS infrastructure must fit the original pilot budget'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffWorkspaceInfrastructureReservation_guard" BEFORE INSERT OR UPDATE ON "StaffWorkspaceInfrastructureReservation"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.workspace_infrastructure_guard();

CREATE FUNCTION atlas_staff.workspace_source_permit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperatorRun"%ROWTYPE;o atlas_staff."StaffWorkspaceOperation"%ROWTYPE;
  w atlas_staff."StaffWorkspaceCard"%ROWTYPE;s atlas_staff."StaffOperatorStep"%ROWTYPE;p jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['state','finishedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','finishedAt'])
      OR OLD.state<>'ACTIVE' OR NEW.state NOT IN ('SUCCEEDED','FAILED','UNKNOWN') THEN
      RAISE EXCEPTION 'ATLAS source action permit is immutable'; END IF;
    IF EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceOperation" x WHERE x."requestId"=NEW."requestId" AND (x.state IN ('RESERVED','DISPATCHED') OR NEW.state<>'UNKNOWN' AND x.state='UNKNOWN'))
      OR NEW.state='SUCCEEDED' AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceOperation" x
        WHERE x."requestId"=NEW."requestId" AND x.purpose IN ('PREPARATION','INITIALIZE_REPORT') AND x.state='SUCCEEDED') THEN
      RAISE EXCEPTION 'ATLAS source action must settle its recorded worker requests'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=NEW."runId" FOR UPDATE;
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=NEW."cardId" FOR SHARE;
  SELECT * INTO o FROM atlas_staff."StaffWorkspaceOperation" WHERE id=NEW."requestId" FOR SHARE;
  SELECT * INTO s FROM atlas_staff."StaffOperatorStep" WHERE id=NEW."selectionStepId";
  p:=o.canonical::jsonb->'result';
  IF (NEW.state='ACTIVE' AND r.phase='CAPTURE_REVIEW' AND r.state='PREPARATION_READY' AND r."workspaceCardId"=w.id
    AND r.revision=NEW."runRevision" AND r."controlRevision"=NEW."runControlRevision" AND r."controlState"='RUNNING'
    AND r."executionMode"=NEW.mode AND (NEW.mode='CONTINUOUS' OR r."stepBudget"=1)
    AND atlas_staff.operator_capture_current(r.id) AND r."deadlineAt">clock_timestamp() AT TIME ZONE 'UTC'
    AND NEW."captureHash"=r."evidenceHash" AND NEW."claimFence"::text=w.canonical::jsonb->>'claimFence'
    AND o."cardId"=w.id AND o.action='MACHINE_SOURCE_ACTION' AND p->>'phase'='REQUESTED'
    AND p->>'requestId'=NEW."requestId"::text AND p->'binding'->>'captureHash'=NEW."captureHash"
    AND p->'binding'->>'claimFence'=NEW."claimFence"::text AND p->'payload'->'machine'->>'runId'=r.id::text
    AND p->'payload'->'machine'->>'selectionStepId'=s.id::text
    AND p->'payload'->'machine'->>'selectionResultHash'=s."resultHash" AND s."resultHash"=NEW."selectionResultHash"
    AND s."runId"=r.id AND s.revision=r.revision AND s."toolName"='submit_capture_preparation'
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=r.id AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN'))
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit" WHERE "runId"=r.id AND state IN ('ACTIVE','UNKNOWN')))
      IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS source action requires one current terminal capture permit'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffWorkspaceSourceActionPermit_guard" BEFORE INSERT OR UPDATE ON "StaffWorkspaceSourceActionPermit"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.workspace_source_permit_guard();

CREATE FUNCTION atlas_staff.claim_workspace_source_permit(request_id uuid)
RETURNS SETOF atlas_staff."StaffWorkspaceSourceActionPermit" LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE o atlas_staff."StaffWorkspaceOperation"%ROWTYPE;r atlas_staff."StaffOperatorRun"%ROWTYPE;p jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  IF EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit" WHERE "requestId"=request_id) THEN
    RETURN QUERY SELECT * FROM atlas_staff."StaffWorkspaceSourceActionPermit" WHERE "requestId"=request_id;RETURN; END IF;
  SELECT * INTO o FROM atlas_staff."StaffWorkspaceOperation" WHERE id=request_id;
  p:=o.canonical::jsonb->'result';
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=(p->'payload'->'machine'->>'runId')::uuid FOR UPDATE;
  INSERT INTO atlas_staff."StaffWorkspaceSourceActionPermit"
    ("requestId","cardId","runId","runRevision","runControlRevision","claimFence","captureHash","selectionStepId","selectionResultHash",mode,state,"createdAt")
    VALUES(request_id,o."cardId",r.id,r.revision,r."controlRevision",(p->'binding'->>'claimFence')::integer,p->'binding'->>'captureHash',
      (p->'payload'->'machine'->>'selectionStepId')::uuid,p->'payload'->'machine'->>'selectionResultHash',r."executionMode",'ACTIVE',clock_timestamp() AT TIME ZONE 'UTC');
  IF r."executionMode"='STEP' THEN
    UPDATE atlas_staff."StaffOperatorRun" SET "stepBudget"=0,"controlRevision"="controlRevision"+1,
      "updatedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=r.id;
  END IF;
  RETURN QUERY SELECT * FROM atlas_staff."StaffWorkspaceSourceActionPermit" WHERE "requestId"=request_id;
END $$;

CREATE FUNCTION atlas_staff.workspace_source_permit_commit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperatorRun"%ROWTYPE;
BEGIN
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=NEW."runId";
  IF TG_OP='INSERT' AND NEW.mode='STEP' AND (r.state<>'PREPARATION_READY' OR r."stepBudget"<>0
    OR r."controlRevision"<>NEW."runControlRevision"+1) THEN RAISE EXCEPTION 'ATLAS source permit must consume its exact human step'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "StaffWorkspaceSourceActionPermit_atomic" AFTER INSERT ON "StaffWorkspaceSourceActionPermit"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.workspace_source_permit_commit_guard();

CREATE OR REPLACE FUNCTION atlas_staff.workspace_operator_control_transition_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
BEGIN
  IF (NEW."controlState",NEW."executionMode",NEW."stepBudget",NEW."controlRevision") IS NOT DISTINCT FROM
    (OLD."controlState",OLD."executionMode",OLD."stepBudget",OLD."controlRevision") THEN RETURN NULL; END IF;
  -- The machine may consume one previously authorized step in the same
  -- transaction as the one exact dispatch. It cannot grant itself another.
  IF NEW."controlState"=OLD."controlState" AND NEW."controlState"='RUNNING'
    AND NEW."executionMode"=OLD."executionMode" AND NEW."executionMode"='STEP'
    AND OLD."stepBudget"=1 AND NEW."stepBudget"=0 AND NEW.revision=OLD.revision
    AND NEW."controlRevision"=OLD."controlRevision"+1
    AND EXISTS (SELECT 1 FROM atlas_staff."StaffOperatorAttempt" a WHERE a."runId"=NEW.id
      AND a.state='DISPATCHED' AND a."runRevision"=OLD.revision AND a."leaseFence"=OLD."leaseFence"
      AND a.xmin::text=pg_current_xact_id()::text) THEN RETURN NULL; END IF;
  -- A completed action may honor a previously requested pause or stop after
  -- the one step. The existing deferred commit proof still owns application.
  IF OLD."controlState" IN ('RUNNING','PAUSE_REQUESTED') AND NEW."controlState"='PAUSED'
    AND (OLD."controlState"='PAUSE_REQUESTED' OR OLD."executionMode"='STEP' AND OLD."stepBudget"=0)
    AND NEW."executionMode"=OLD."executionMode" AND NEW."stepBudget"=0
    AND NEW.revision=OLD.revision+1 AND NEW."controlRevision"=OLD."controlRevision"+1
    AND EXISTS (SELECT 1 FROM atlas_staff."StaffOperatorStep" s WHERE s."runId"=NEW.id
      AND s.revision=NEW.revision AND s.xmin::text=pg_current_xact_id()::text) THEN RETURN NULL; END IF;
  -- One workflow request consumes one permit, including its two bounded
  -- preparation workers. It cannot fund a second request or provider attempt.
  IF OLD.state='PREPARATION_READY' AND NEW.state=OLD.state AND NEW.revision=OLD.revision
    AND NEW."executionMode"=OLD."executionMode" AND NEW."controlRevision"=OLD."controlRevision"+1 THEN
    IF OLD."controlState"='RUNNING' AND NEW."controlState"='RUNNING' AND OLD."executionMode"='STEP'
      AND OLD."stepBudget"=1 AND NEW."stepBudget"=0 AND EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit" p
        WHERE p."runId"=NEW.id AND p."runRevision"=OLD.revision AND p."runControlRevision"=OLD."controlRevision"
          AND p.mode='STEP' AND p.state='ACTIVE' AND p.xmin::text=pg_current_xact_id()::text) THEN RETURN NULL; END IF;
    IF OLD."controlState" IN ('RUNNING','PAUSE_REQUESTED') AND NEW."controlState"='PAUSED'
      AND (OLD."controlState"='PAUSE_REQUESTED' OR OLD."executionMode"='STEP' AND OLD."stepBudget"=0)
      AND NEW."stepBudget"=0 AND EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit" p
        WHERE p."runId"=NEW.id AND p."runRevision"=OLD.revision AND p.state IN ('SUCCEEDED','FAILED')
          AND (p.xmin::text=pg_current_xact_id()::text OR OLD."controlState"='PAUSE_REQUESTED' AND EXISTS(
            SELECT 1 FROM atlas_staff."StaffWorkspaceOperation" result
            JOIN atlas_staff."StaffWorkspaceOperation" intent ON intent.id=p."requestId"
            JOIN atlas_staff."StaffWorkspaceCard" w ON w.id=p."cardId"
            WHERE result."cardId"=w.id AND result."actorId"=intent."actorId" AND result.action='MACHINE_SOURCE_RESULT'
              AND result."operationId"='source-result_'||p."requestId"::text AND result.xmin::text=pg_current_xact_id()::text
              AND result.canonical::jsonb#>>'{result,actor}'='MACHINE' AND result.canonical::jsonb#>>'{result,runId}'=NEW.id::text
              AND result.canonical::jsonb#>>'{result,requestId}'=p."requestId"::text AND result.canonical::jsonb#>>'{result,state}'=p.state
              AND result.canonical::jsonb#>>'{result,action}'=intent.canonical::jsonb#>>'{result,action}'
              AND result.canonical::jsonb#>'{result,side}' IS NOT DISTINCT FROM intent.canonical::jsonb#>'{result,payload,side}'
              AND result.canonical::jsonb#>>'{result,captureHash}'=p."captureHash"
              AND result.canonical::jsonb#>>'{result,claimFence}'=p."claimFence"::text
              AND result.canonical::jsonb#>>'{result,selectionStepId}'=p."selectionStepId"::text
              AND result.canonical::jsonb#>>'{result,selectionResultHash}'=p."selectionResultHash"
              AND result.canonical::jsonb#>>'{result,revision}'=w.revision::text
              AND w.canonical::jsonb#>'{workspace,pending}' IS NULL AND w.canonical::jsonb#>>'{claim,kind}'='ASTRA'
              AND w.canonical::jsonb#>>'{claim,runId}'=NEW.id::text AND w.canonical::jsonb#>>'{claim,actorId}'=intent."actorId"::text
              AND w.canonical::jsonb->>'claimFence'=p."claimFence"::text AND w.canonical::jsonb->>'captureHash'=p."captureHash"
              AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit" other
                WHERE other."runId"=NEW.id AND other.state IN ('ACTIVE','UNKNOWN'))
              AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceOperation" operation
                WHERE operation."runId"=NEW.id AND operation.state IN ('RESERVED','DISPATCHED','UNKNOWN'))
              AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" attempt
                WHERE attempt."runId"=NEW.id AND attempt.state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN'))))) THEN RETURN NULL; END IF;
  END IF;
  -- Every other control transition comes from the current human RPC and its
  -- immutable workspace action. A stolen runner credential cannot resume work.
  IF EXISTS (SELECT 1 FROM atlas_staff."StaffAudit" a WHERE a.event='WORKSPACE_OPERATOR_CONTROL'
    AND a.details::jsonb->>'runId'=NEW.id::text
    AND a.details::jsonb->>'previousControlRevision'=OLD."controlRevision"::text
    AND a.details::jsonb->>'controlRevision'=NEW."controlRevision"::text
    AND a.xmin::text=pg_current_xact_id()::text) THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'ATLAS operator control requires an exact human action or settled step';
END $$;

CREATE OR REPLACE FUNCTION atlas_staff.read_workspace_operator_control(workspace_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE w atlas_staff."StaffWorkspaceCard"%ROWTYPE; r atlas_staff."StaffOperatorRun"%ROWTYPE;
  pending integer:=0; held boolean:=false; active boolean; displayed text; awaiting_projection boolean:=false;
BEGIN
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=workspace_id;
  IF FOUND THEN
    SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE "workspaceCardId"=w.id OR "specimenId"=w."specimenId" ORDER BY "createdAt" DESC,id DESC LIMIT 1;
  END IF;
  IF r.id IS NULL THEN RETURN jsonb_build_object('runId',NULL,'state','UNAVAILABLE','mode','CONTINUOUS',
    'pending',0,'settled',true,'canPause',false,'canResume',false,'canStep',false,'canTakeOver',false); END IF;
  SELECT count(*)::integer,coalesce(bool_or(state IN ('DISPATCHED','RECEIVED','UNKNOWN')),false)
    INTO pending,held FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=r.id AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN');
  pending:=pending+(SELECT count(*)::integer FROM atlas_staff."StaffWorkspaceSourceActionPermit"
    WHERE "runId"=r.id AND state IN ('ACTIVE','UNKNOWN'));
  held:=held OR r.state='UNKNOWN' OR EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit"
    WHERE "runId"=r.id AND state IN ('ACTIVE','UNKNOWN'));
  -- A worker permit can settle before its reply reaches the coordinator. The
  -- exact retained request still owns the claim until its immutable result and
  -- projection commit. Initialization also retains ownership until the report
  -- successor clears pending, even if that request's result is already saved.
  SELECT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceOperation" intent
    WHERE w.canonical::jsonb#>>'{claim,kind}'='ASTRA' AND w.canonical::jsonb#>>'{claim,runId}'=r.id::text
      AND intent.id::text=w.canonical::jsonb#>>'{workspace,pending,requestId}' AND intent."cardId"=w.id
      AND intent.action='MACHINE_SOURCE_ACTION' AND intent.canonical::jsonb#>>'{result,payload,machine,runId}'=r.id::text
      AND (intent.canonical::jsonb#>>'{result,action}'='INITIALIZE_REPORT' OR NOT EXISTS(
        SELECT 1 FROM atlas_staff."StaffWorkspaceOperation" result
        WHERE result."cardId"=w.id AND result."actorId"=intent."actorId" AND result.action='MACHINE_SOURCE_RESULT'
          AND result."operationId"='source-result_'||intent.id::text
          AND result.canonical::jsonb#>>'{result,actor}'='MACHINE' AND result.canonical::jsonb#>>'{result,runId}'=r.id::text
          AND result.canonical::jsonb#>>'{result,requestId}'=intent.id::text
          AND result.canonical::jsonb#>>'{result,state}' IN ('SUCCEEDED','FAILED')
          AND result.canonical::jsonb#>>'{result,action}'=intent.canonical::jsonb#>>'{result,action}'
          AND result.canonical::jsonb#>>'{result,action}'=w.canonical::jsonb#>>'{workspace,pending,action}'
          AND result.canonical::jsonb#>'{result,side}' IS NOT DISTINCT FROM intent.canonical::jsonb#>'{result,payload,side}'
          AND result.canonical::jsonb#>>'{result,captureHash}'=intent.canonical::jsonb#>>'{result,binding,captureHash}'
          AND result.canonical::jsonb#>>'{result,claimFence}'=intent.canonical::jsonb#>>'{result,binding,claimFence}'
          AND result.canonical::jsonb#>>'{result,selectionStepId}'=intent.canonical::jsonb#>>'{result,payload,machine,selectionStepId}'
          AND result.canonical::jsonb#>>'{result,selectionResultHash}'=intent.canonical::jsonb#>>'{result,payload,machine,selectionResultHash}'
          AND intent.canonical::jsonb#>'{result,binding}'=w.canonical::jsonb#>'{workspace,pending,binding}'
          AND intent."operationId"=w.canonical::jsonb#>>'{workspace,pending,operationId}')))
    INTO awaiting_projection;
  IF awaiting_projection THEN
    IF NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit"
      WHERE "requestId"::text=w.canonical::jsonb#>>'{workspace,pending,requestId}' AND "runId"=r.id AND state IN ('ACTIVE','UNKNOWN')) THEN
      pending:=pending+1;
    END IF;
    held:=true;
  END IF;
  active:=r.state IN ('QUEUED','RUNNING','WAITING_TOOL','UNKNOWN','PREPARATION_READY');
  displayed:=CASE WHEN r."controlState"='TAKEN_OVER' THEN 'TAKEN_OVER' WHEN NOT active THEN 'COMPLETED'
    WHEN r."controlState"='RUNNING' AND r.state='QUEUED' THEN 'QUEUED' ELSE r."controlState" END;
  RETURN jsonb_build_object('runId',r.id,'runState',r.state,'state',displayed,'mode',r."executionMode",
    'controlRevision',r."controlRevision",'stepBudget',r."stepBudget",'pending',pending,'settled',NOT held,
    'canPause',active AND r."controlState"='RUNNING','canResume',active AND r."controlState"='PAUSED' AND pending=0 AND NOT held,
    'canStep',active AND r."controlState"='PAUSED' AND pending=0 AND NOT held,
    'canTakeOver',active AND r."controlState"<>'TAKEN_OVER' AND NOT held);
END $$;

CREATE FUNCTION atlas_staff.finish_workspace_source_permit(request_id uuid,outcome text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE p atlas_staff."StaffWorkspaceSourceActionPermit"%ROWTYPE;r atlas_staff."StaffOperatorRun"%ROWTYPE;
  current_control jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO p FROM atlas_staff."StaffWorkspaceSourceActionPermit" WHERE "requestId"=request_id FOR UPDATE;
  IF p."requestId" IS NULL OR outcome NOT IN ('SUCCEEDED','FAILED','UNKNOWN') THEN RAISE EXCEPTION 'ATLAS source permit result invalid'; END IF;
  IF p.state<>'ACTIVE' THEN
    IF p.state<>outcome THEN RAISE EXCEPTION 'ATLAS source permit result immutable'; END IF;
  ELSE
    UPDATE atlas_staff."StaffWorkspaceSourceActionPermit" SET state=outcome,"finishedAt"=clock_timestamp() AT TIME ZONE 'UTC'
      WHERE "requestId"=request_id;
  END IF;
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=p."runId" FOR UPDATE;
  IF p.state<>'ACTIVE' THEN
    -- A pause can arrive after worker settlement but before coordinator
    -- projection. Replay preserves the terminal permit and settles only that
    -- pending pause, once the exact workspace has no unresolved work left.
    current_control:=atlas_staff.read_workspace_operator_control(p."cardId");
    IF (r."controlState"='PAUSE_REQUESTED' AND current_control->>'runId'=r.id::text
      AND (current_control->>'pending')::integer=0 AND (current_control->>'settled')::boolean) IS NOT TRUE THEN RETURN; END IF;
  END IF;
  IF outcome IN ('SUCCEEDED','FAILED') AND r.state='PREPARATION_READY'
    AND (r."controlState"='PAUSE_REQUESTED' OR r."controlState"='RUNNING' AND r."executionMode"='STEP' AND r."stepBudget"=0) THEN
    UPDATE atlas_staff."StaffOperatorRun" SET "controlState"='PAUSED',"controlRevision"="controlRevision"+1,
      "leaseOwner"=NULL,"leaseMode"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=r.id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION atlas_staff.workspace_pilot_costs(uuid),atlas_staff.workspace_source_operation_guard(),atlas_staff.workspace_infrastructure_guard(),
  atlas_staff.workspace_source_permit_guard(),atlas_staff.claim_workspace_source_permit(uuid),atlas_staff.workspace_source_permit_commit_guard(),atlas_staff.finish_workspace_source_permit(uuid,text) FROM PUBLIC;
COMMIT;
