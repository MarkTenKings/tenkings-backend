BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;
ALTER TABLE "StaffOperatorRun"
 ADD COLUMN "controlState" text NOT NULL DEFAULT 'RUNNING',
 ADD COLUMN "controlRevision" integer NOT NULL DEFAULT 1,
 ADD COLUMN "executionMode" text NOT NULL DEFAULT 'CONTINUOUS',
 ADD COLUMN "stepBudget" integer NOT NULL DEFAULT 0,
 ADD CONSTRAINT "StaffOperatorRun_workspace_control" CHECK ("controlState" IN ('RUNNING','PAUSE_REQUESTED','PAUSED','TAKEN_OVER')
   AND "controlRevision">0 AND "executionMode" IN ('CONTINUOUS','STEP') AND "stepBudget" IN (0,1));

ALTER TABLE "StaffOperatorStep" DROP CONSTRAINT "StaffOperatorStep_shape";
ALTER TABLE "StaffOperatorStep" ADD CONSTRAINT "StaffOperatorStep_shape" CHECK ((revision>1 AND length("callId")>0
  AND "toolName" IN ('read_card_report','inspect_region','inspect_card_geometry','measure_centering','inspect_finding',
    'propose_identity','propose_finding_change','submit_for_human_review')
  AND octet_length("requestCanonical")<=65536 AND octet_length("resultCanonical")<=12582912
  AND "requestHash"=encode(sha256(convert_to("requestCanonical",'UTF8')),'hex')
  AND "resultHash"=encode(sha256(convert_to("resultCanonical",'UTF8')),'hex') AND "nextInputHash" ~ '^[a-f0-9]{64}$') IS TRUE);

-- Preserve the latest operational-resolution guard and all existing immutable
-- source, lease, unknown-result and deferred commit checks. Only four control
-- fields gain a separately fenced mutable contract.
CREATE OR REPLACE FUNCTION atlas_staff.operator_run_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'QUEUED' OR NEW.revision<>1 OR NEW."leaseFence"<>0 OR NEW."leaseOwner" IS NOT NULL THEN
      RAISE EXCEPTION 'ATLAS operator requires a fresh queue entry'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['revision','state','inputCanonical','inputHash','leaseOwner','leaseFence','leaseMode','leaseExpiresAt','summary','failureCode','updatedAt','controlState','controlRevision','executionMode','stepBudget'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision','state','inputCanonical','inputHash','leaseOwner','leaseFence','leaseMode','leaseExpiresAt','summary','failureCode','updatedAt','controlState','controlRevision','executionMode','stepBudget'])
    OR NEW.revision NOT IN (OLD.revision,OLD.revision+1)
    OR (NEW.revision=OLD.revision AND (NEW."inputCanonical",NEW."inputHash") IS DISTINCT FROM (OLD."inputCanonical",OLD."inputHash"))
    OR OLD.state IN ('READY_FOR_HUMAN','NEEDS_RECAPTURE','NEEDS_EXPERT','FAILED') THEN
      RAISE EXCEPTION 'ATLAS operator scope or completed run is immutable'; END IF;
  IF NEW."controlRevision" NOT IN (OLD."controlRevision",OLD."controlRevision"+1)
    OR (NEW."controlRevision"=OLD."controlRevision" AND
      (NEW."controlState",NEW."executionMode",NEW."stepBudget") IS DISTINCT FROM
      (OLD."controlState",OLD."executionMode",OLD."stepBudget")) THEN
    RAISE EXCEPTION 'ATLAS operator control revision required'; END IF;
  -- Sole new exception: same revision/fence/input and an exact current human
  -- resolution, written with its audit in this transaction. Attempts stay held.
  IF OLD.state='UNKNOWN' AND NEW.state='FAILED' THEN
    PERFORM atlas_staff.resolution_for_target('ASTRA',NEW.id);
    IF (to_jsonb(NEW)-ARRAY['state','leaseOwner','leaseMode','leaseExpiresAt','summary','failureCode','updatedAt'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','leaseOwner','leaseMode','leaseExpiresAt','summary','failureCode','updatedAt'])
      OR NEW."leaseOwner" IS NOT NULL OR NEW."leaseMode" IS NOT NULL OR NEW."leaseExpiresAt" IS NOT NULL
      OR NEW."failureCode" IS DISTINCT FROM 'HUMAN_ABANDONED_UNAPPLIED'
      OR NEW.summary IS DISTINCT FROM 'Human abandoned unapplied automation; inspection or recapture required.' THEN
      RAISE EXCEPTION 'ATLAS abandoned run must retain its exact unapplied ledger'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.state='UNKNOWN' AND NEW.state<>'UNKNOWN' THEN RAISE EXCEPTION 'ATLAS uncertain work requires separate reconciliation'; END IF;
  IF NEW.state='FAILED' AND EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=NEW.id
    AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN')) THEN RAISE EXCEPTION 'ATLAS unresolved attempt cannot be discarded'; END IF;
  IF NEW."leaseOwner" IS NOT NULL AND (NEW."leaseExpiresAt">now_at+interval '60 seconds'
    OR NEW."leaseExpiresAt">NEW."deadlineAt") THEN RAISE EXCEPTION 'ATLAS operator lease is unbounded'; END IF;
  IF NEW."leaseFence"=OLD."leaseFence"+1 THEN
    IF OLD."leaseExpiresAt">now_at OR NEW."leaseOwner" IS NULL OR NEW."leaseExpiresAt"<=now_at OR NEW.revision<>OLD.revision
      OR (OLD.state='UNKNOWN' AND NEW."leaseMode"<>'RECONCILE_ONLY') THEN RAISE EXCEPTION 'ATLAS operator lease cannot be stolen'; END IF;
  ELSIF NEW."leaseFence"=OLD."leaseFence" THEN
    IF NEW."leaseOwner" IS NOT NULL AND (NEW."leaseOwner",NEW."leaseMode") IS DISTINCT FROM (OLD."leaseOwner",OLD."leaseMode") THEN
      RAISE EXCEPTION 'ATLAS operator lease fence required'; END IF;
    IF NEW."leaseExpiresAt" IS DISTINCT FROM OLD."leaseExpiresAt" AND NEW."leaseExpiresAt" IS NOT NULL AND OLD."leaseExpiresAt"<=now_at THEN
      RAISE EXCEPTION 'ATLAS expired lease cannot be renewed'; END IF;
    IF NEW.revision>OLD.revision AND (OLD."leaseExpiresAt"<=now_at OR OLD."leaseMode"<>'WORK') THEN
      RAISE EXCEPTION 'ATLAS stale lease cannot apply work'; END IF;
  ELSE RAISE EXCEPTION 'ATLAS operator lease fence invalid'; END IF;
  IF NEW.state IN ('READY_FOR_HUMAN','NEEDS_RECAPTURE','NEEDS_EXPERT') AND NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'ATLAS handoff requires an immutable step'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION atlas_staff.workspace_operator_control_transition_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
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
  -- Every other control transition comes from the current human RPC and its
  -- immutable workspace action. A stolen runner credential cannot resume work.
  IF EXISTS (SELECT 1 FROM atlas_staff."StaffAudit" a WHERE a.event='WORKSPACE_OPERATOR_CONTROL'
    AND a.details::jsonb->>'runId'=NEW.id::text
    AND a.details::jsonb->>'previousControlRevision'=OLD."controlRevision"::text
    AND a.details::jsonb->>'controlRevision'=NEW."controlRevision"::text
    AND a.xmin::text=pg_current_xact_id()::text) THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'ATLAS operator control requires an exact human action or settled step';
END $$;
CREATE CONSTRAINT TRIGGER "StaffOperatorRun_workspace_control_transition" AFTER UPDATE ON "StaffOperatorRun"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.workspace_operator_control_transition_guard();

CREATE FUNCTION atlas_staff.workspace_operator_execution_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperatorRun"%ROWTYPE; w atlas_staff."StaffWorkspaceCard"%ROWTYPE; claim jsonb;
BEGIN
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=NEW."runId" FOR UPDATE;
  IF TG_TABLE_NAME='StaffOperatorAttempt' THEN
    IF TG_OP='UPDATE' AND NOT (OLD.state='RESERVED' AND NEW.state='DISPATCHED') THEN RETURN NEW; END IF;
    IF (r."controlState"='RUNNING' AND (r."executionMode"='CONTINUOUS' OR r."stepBudget"=1)) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS operator dispatch paused'; END IF;
  ELSIF r."controlState" NOT IN ('RUNNING','PAUSE_REQUESTED') THEN
    RAISE EXCEPTION 'ATLAS operator action paused or taken over';
  END IF;
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE "specimenId"=r."specimenId";
  IF FOUND THEN
    claim:=w.canonical::jsonb->'claim';
    IF (claim->>'kind'='ASTRA' AND claim->>'runId'=r.id::text
      AND claim->>'captureHash'=w.canonical::jsonb->>'captureHash'
      AND claim->>'captureRevision'=w.canonical::jsonb->>'captureRevision'
      AND claim->>'fence'=w.canonical::jsonb->>'claimFence') IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS workspace machine claim changed'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffOperatorAttempt_workspace_control" BEFORE INSERT OR UPDATE ON "StaffOperatorAttempt"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.workspace_operator_execution_guard();
CREATE TRIGGER "StaffOperatorStep_workspace_control" BEFORE INSERT ON "StaffOperatorStep"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.workspace_operator_execution_guard();

CREATE FUNCTION atlas_staff.read_workspace_operator_control(workspace_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE w atlas_staff."StaffWorkspaceCard"%ROWTYPE; r atlas_staff."StaffOperatorRun"%ROWTYPE;
  pending integer:=0; held boolean:=false; active boolean; displayed text;
BEGIN
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=workspace_id;
  IF FOUND AND w."specimenId" IS NOT NULL THEN
    SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE "specimenId"=w."specimenId" ORDER BY "createdAt" DESC,id DESC LIMIT 1;
  END IF;
  IF r.id IS NULL THEN RETURN jsonb_build_object('runId',NULL,'state','UNAVAILABLE','mode','CONTINUOUS',
    'pending',0,'settled',true,'canPause',false,'canResume',false,'canStep',false,'canTakeOver',false); END IF;
  SELECT count(*)::integer,coalesce(bool_or(state IN ('DISPATCHED','RECEIVED','UNKNOWN')),false)
    INTO pending,held FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=r.id AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN');
  held:=held OR r.state='UNKNOWN';
  active:=r.state IN ('QUEUED','RUNNING','WAITING_TOOL','UNKNOWN');
  displayed:=CASE WHEN r."controlState"='TAKEN_OVER' THEN 'TAKEN_OVER' WHEN NOT active THEN 'COMPLETED'
    WHEN r."controlState"='RUNNING' AND r.state='QUEUED' THEN 'QUEUED' ELSE r."controlState" END;
  RETURN jsonb_build_object('runId',r.id,'runState',r.state,'state',displayed,'mode',r."executionMode",
    'controlRevision',r."controlRevision",'stepBudget',r."stepBudget",'pending',pending,'settled',NOT held,
    'canPause',active AND r."controlState"='RUNNING','canResume',active AND r."controlState"='PAUSED' AND pending=0 AND NOT held,
    'canStep',active AND r."controlState"='PAUSED' AND pending=0 AND NOT held,
    'canTakeOver',active AND r."controlState"<>'TAKEN_OVER' AND NOT held);
END $$;

CREATE FUNCTION atlas_staff.control_workspace_operator(workspace_id uuid,claim_fence integer,action text,
  actor_id uuid,session_hash text,expected_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE w atlas_staff."StaffWorkspaceCard"%ROWTYPE; r atlas_staff."StaffOperatorRun"%ROWTYPE;
  c atlas_staff."StaffWorkspaceControl"%ROWTYPE; current_control jsonb; at_time timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
  staff_control atlas_staff."StaffControl"%ROWTYPE; i atlas_staff."StaffIdentity"%ROWTYPE;
  se atlas_staff."StaffSession"%ROWTYPE; b atlas_staff."StaffBrowser"%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO staff_control FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=actor_id FOR SHARE;
  SELECT * INTO se FROM atlas_staff."StaffSession" WHERE "tokenHash"=session_hash FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=se."browserHash" FOR SHARE;
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=workspace_id FOR UPDATE;
  SELECT * INTO c FROM atlas_staff."StaffWorkspaceControl" WHERE id='active' FOR SHARE;
  IF (staff_control.enabled AND c.enabled AND c.mode=staff_control.mode AND c."releaseSha"=staff_control."releaseSha"
    AND i.role='REVIEWER' AND i."revokedAt" IS NULL AND se."identityId"=i.id AND se."revokedAt" IS NULL
    AND se."accessVersion"=i."accessVersion" AND se."controlRevision"=staff_control.revision AND se."expiresAt">at_time
    AND b."controlRevision"=staff_control.revision AND b."expiresAt">at_time
    AND w.revision=expected_revision AND w."cohortId"=c."cohortId" AND w.state IN ('IN_PROGRESS','NEEDS_ATTENTION')
    AND w.canonical::jsonb->'claim'->>'kind'='ASTRA' AND (w.canonical::jsonb->>'claimFence')::integer=claim_fence
    AND w.canonical::jsonb->'claim'->>'fence'=claim_fence::text AND action IN ('PAUSE','RESUME','STEP','TAKE_OVER')) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS workspace operator control unavailable'; END IF;
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=(w.canonical::jsonb->'claim'->>'runId')::uuid
    AND "specimenId"=w."specimenId" FOR UPDATE;
  IF r.id IS NULL OR r.state NOT IN ('QUEUED','RUNNING','WAITING_TOOL','UNKNOWN') OR r."controlState"='TAKEN_OVER' THEN
    RAISE EXCEPTION 'ATLAS workspace operator is not active'; END IF;
  current_control:=atlas_staff.read_workspace_operator_control(workspace_id);
  IF action IN ('RESUME','STEP') THEN
    IF (c."astraEnabled" AND c."expiresAt">at_time AND r."deadlineAt">at_time
      AND r."controlState"='PAUSED' AND (current_control->>'pending')::integer=0
      AND (current_control->>'settled')::boolean) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS workspace operator cannot resume'; END IF;
    UPDATE atlas_staff."StaffOperatorRun" SET "controlState"='RUNNING',"controlRevision"="controlRevision"+1,
      "executionMode"=CASE action WHEN 'STEP' THEN 'STEP' ELSE 'CONTINUOUS' END,
      "stepBudget"=CASE action WHEN 'STEP' THEN 1 ELSE 0 END,
      "leaseOwner"=NULL,"leaseMode"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=at_time WHERE id=r.id;
  ELSE
    IF action='TAKE_OVER' AND (current_control->>'settled')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS unresolved work prevents takeover'; END IF;
    -- A RESERVED attempt has never crossed dispatch. Preserve its exact request
    -- and reservation record; do not erase or replay any dispatched attempt.
    UPDATE atlas_staff."StaffOperatorAttempt" SET state='FAILED',"finishedAt"=at_time
      WHERE "runId"=r.id AND state='RESERVED' AND "dispatchedAt" IS NULL;
    IF action='TAKE_OVER' THEN
      UPDATE atlas_staff."StaffOperatorRun" SET state='FAILED',"controlState"='TAKEN_OVER',"controlRevision"="controlRevision"+1,
        "stepBudget"=0,"failureCode"='ASTRA_HUMAN_TAKEOVER',"leaseOwner"=NULL,"leaseMode"=NULL,"leaseExpiresAt"=NULL,
        "updatedAt"=at_time WHERE id=r.id;
    ELSIF (current_control->>'settled')::boolean THEN
      UPDATE atlas_staff."StaffOperatorRun" SET "controlState"='PAUSED',"controlRevision"="controlRevision"+1,
        "stepBudget"=0,"leaseOwner"=NULL,"leaseMode"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=at_time WHERE id=r.id;
    ELSE
      UPDATE atlas_staff."StaffOperatorRun" SET "controlState"='PAUSE_REQUESTED',"controlRevision"="controlRevision"+1,
        "stepBudget"=0,"updatedAt"=at_time WHERE id=r.id;
    END IF;
  END IF;
  INSERT INTO atlas_staff."StaffAudit" (id,event,"subjectId","actorId",details,"createdAt")
    VALUES (gen_random_uuid(),'WORKSPACE_OPERATOR_CONTROL',w.id::text,actor_id,
      jsonb_build_object('workspaceId',w.id,'runId',r.id,'action',action,'claimFence',claim_fence,
        'revision',expected_revision+1,'previousControlRevision',r."controlRevision",
        'controlRevision',r."controlRevision"+1)::text,at_time);
  RETURN atlas_staff.read_workspace_operator_control(workspace_id);
END $$;

CREATE FUNCTION atlas_staff.workspace_operator_control_commit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
BEGIN
  IF NEW.event<>'WORKSPACE_OPERATOR_CONTROL' THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM atlas_staff."StaffWorkspaceOperation" o
    JOIN atlas_staff."StaffWorkspaceCard" w ON w.id=o."cardId"
    WHERE o."actorId"=NEW."actorId" AND o."cardId"::text=NEW."subjectId" AND o.action='OPERATOR_CONTROL'
      AND o.canonical::jsonb->'result'->>'action'=NEW.details::jsonb->>'action'
      AND o.canonical::jsonb->'result'->>'revision'=NEW.details::jsonb->>'revision'
      AND o.canonical::jsonb->'result'->'priorClaim'->>'runId'=NEW.details::jsonb->>'runId'
      AND w.revision=(NEW.details::jsonb->>'revision')::integer
      AND o.xmin::text=pg_current_xact_id()::text AND w.xmin::text=pg_current_xact_id()::text) THEN
    RAISE EXCEPTION 'ATLAS workspace operator control requires its immutable human action'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "StaffAudit_workspace_operator_control_commit" AFTER INSERT ON "StaffAudit"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.workspace_operator_control_commit_guard();

CREATE FUNCTION atlas_staff.read_workspace_operator_activity(workspace_id uuid,limit_count integer)
RETURNS TABLE(id uuid,"runId" uuid,revision integer,"toolName" varchar(80),"requestCanonical" text,"requestHash" varchar(64),
  "resultCanonical" text,"resultHash" varchar(64),"createdAt" timestamp(3),decision jsonb,"unavailableReason" text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT s.id,s."runId",s.revision,s."toolName",
    CASE WHEN s.bounded THEN s."requestCanonical" END,s."requestHash",
    CASE WHEN s.bounded THEN s."resultCanonical" END,s."resultHash",s."createdAt",
    (SELECT jsonb_build_object('decision',d.decision,'reason',d.reason,'analysisRevision',d."analysisRevision")
      FROM atlas_staff."StaffProposalDecision" d WHERE d."stepId"=s.id ORDER BY d."createdAt" DESC LIMIT 1),
    CASE WHEN NOT s.bounded THEN 'OVERSIZED_RECORDED_STEP' END
  FROM (SELECT s.*,octet_length(s."requestCanonical")<=65536 AND octet_length(s."resultCanonical")<=2097152 AS bounded
    FROM atlas_staff."StaffWorkspaceCard" w JOIN atlas_staff."StaffOperatorRun" r ON r."specimenId"=w."specimenId"
      JOIN atlas_staff."StaffOperatorStep" s ON s."runId"=r.id
    WHERE w.id=workspace_id AND limit_count BETWEEN 1 AND 100
    ORDER BY s."createdAt" DESC,s.id DESC LIMIT least(greatest(limit_count,0),100)) s
  ORDER BY s."createdAt",s.id;
$$;
REVOKE ALL ON FUNCTION atlas_staff.workspace_operator_execution_guard(),
  atlas_staff.workspace_operator_control_commit_guard(),atlas_staff.workspace_operator_control_transition_guard(),
  atlas_staff.read_workspace_operator_control(uuid),atlas_staff.control_workspace_operator(uuid,integer,text,uuid,text,integer),
  atlas_staff.read_workspace_operator_activity(uuid,integer) FROM PUBLIC;
COMMIT;
