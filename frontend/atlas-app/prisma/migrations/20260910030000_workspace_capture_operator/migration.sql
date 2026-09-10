BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;
ALTER TABLE "StaffGradingBridgeControl" DROP CONSTRAINT "StaffGradingBridgeControl_shape";
ALTER TABLE "StaffGradingBridgeControl" ADD CONSTRAINT "StaffGradingBridgeControl_shape" CHECK ((id='active' AND revision>0
  AND mode IN ('LOCAL_FIXTURE','PRODUCTION') AND "releaseSha" ~ '^[a-f0-9]{40}$'
  AND "configHash" ~ '^[a-f0-9]{64}$' AND "clientKeyHash" ~ '^[a-f0-9]{64}$' AND "gradingPolicyHash" ~ '^[a-f0-9]{64}$'
  AND octet_length("policyCanonical")<=16384
  AND (("policyCanonical"::jsonb->>'version'='atlas-grading-bridge-policy-v1'
      AND jsonb_array_length("policyCanonical"::jsonb->'specimenIds')=10)
    OR ("policyCanonical"::jsonb->>'version'='atlas-workspace-bridge-policy-v1'
      AND jsonb_array_length("policyCanonical"::jsonb->'workspaceCardIds')=10))
  AND "policyHash"=encode(sha256(convert_to("policyCanonical",'UTF8')),'hex')) IS TRUE);
ALTER TABLE "StaffOperatorRun" ADD COLUMN phase text NOT NULL DEFAULT 'REPORT_REVIEW',
  ADD COLUMN "workspaceCardId" uuid REFERENCES "StaffWorkspaceCard"(id) ON DELETE RESTRICT,
  ADD COLUMN "captureRunId" uuid UNIQUE REFERENCES "StaffOperatorRun"(id) ON DELETE RESTRICT,
  ALTER COLUMN "specimenId" DROP NOT NULL;
ALTER TABLE "StaffOperatorRun" DROP CONSTRAINT "StaffOperatorRun_shape";
ALTER TABLE "StaffOperatorRun" ADD CONSTRAINT "StaffOperatorRun_shape" CHECK ((revision>0
  AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "gradingPolicyHash" ~ '^[a-f0-9]{64}$' AND "runtimeHash" ~ '^[a-f0-9]{64}$'
  AND octet_length("policyCanonical")<=65536 AND "policyCanonical"::jsonb->>'version'='atlas-operator-control-policy-v1'
  AND "policyHash"=encode(sha256(convert_to("policyCanonical",'UTF8')),'hex')
  AND octet_length("manifestCanonical")<=131072 AND jsonb_typeof("manifestCanonical"::jsonb)='object'
  AND "manifestHash"=encode(sha256(convert_to("manifestCanonical",'UTF8')),'hex')
  AND octet_length("inputCanonical")<=12582912 AND jsonb_typeof("inputCanonical"::jsonb)='array'
  AND "inputHash"=encode(sha256(convert_to("inputCanonical",'UTF8')),'hex')
  AND state IN ('QUEUED','RUNNING','WAITING_TOOL','READY_FOR_HUMAN','PREPARATION_READY','NEEDS_RECAPTURE','NEEDS_EXPERT','UNKNOWN','FAILED')
  AND (("leaseOwner" IS NULL AND "leaseMode" IS NULL AND "leaseExpiresAt" IS NULL)
    OR ("leaseOwner" IS NOT NULL AND "leaseMode" IN ('WORK','RECONCILE_ONLY') AND "leaseExpiresAt" IS NOT NULL))
  AND "leaseFence">=0 AND "deadlineAt">"createdAt"
  AND ((phase='REPORT_REVIEW' AND "specimenId" IS NOT NULL AND "expectedAnalysisRevision">0 AND "expectedReviewRevision">0
      AND state<>'PREPARATION_READY')
    OR (phase='CAPTURE_REVIEW' AND "workspaceCardId" IS NOT NULL AND "specimenId" IS NULL
      AND "expectedAnalysisRevision"=0 AND "expectedReviewRevision"=0 AND "initializationId" IS NULL AND "captureRunId" IS NULL
      AND state<>'READY_FOR_HUMAN' AND "manifestCanonical"::jsonb->>'version'='atlas-operator-capture-manifest-v1'
      AND "manifestCanonical"::jsonb->>'phase'='CAPTURE_REVIEW'
      AND "manifestCanonical"::jsonb->>'workspaceCardId'="workspaceCardId"::text))) IS TRUE);
CREATE UNIQUE INDEX "StaffOperatorRun_active_workspace" ON "StaffOperatorRun"("workspaceCardId")
  WHERE state IN ('QUEUED','RUNNING','WAITING_TOOL','UNKNOWN');
ALTER TABLE "StaffOperatorStep" DROP CONSTRAINT "StaffOperatorStep_shape";
ALTER TABLE "StaffOperatorStep" ADD CONSTRAINT "StaffOperatorStep_shape" CHECK ((revision>1 AND length("callId")>0
  AND "toolName" IN ('read_card_report','inspect_region','inspect_card_geometry','measure_centering','inspect_finding',
    'propose_identity','propose_finding_change','submit_for_human_review',
    'read_original_photos','propose_capture_identity','propose_physical_boundary','submit_capture_preparation')
  AND octet_length("requestCanonical")<=65536 AND octet_length("resultCanonical")<=12582912
  AND "requestHash"=encode(sha256(convert_to("requestCanonical",'UTF8')),'hex')
  AND "resultHash"=encode(sha256(convert_to("resultCanonical",'UTF8')),'hex') AND "nextInputHash" ~ '^[a-f0-9]{64}$') IS TRUE);

-- A machine receives one exact current workspace through this named read port.
-- It has no workspace, staff-session, original-source or storage table grant.
CREATE FUNCTION atlas_staff.lock_operator_workspace(workspace_id uuid,run_id uuid)
RETURNS SETOF atlas_staff."StaffWorkspaceCard" LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT w.* FROM atlas_staff."StaffWorkspaceCard" w JOIN atlas_staff."StaffWorkspaceControl" c ON c."cohortId"=w."cohortId"
    JOIN atlas_staff."StaffControl" s ON s.id='active'
  WHERE w.id=workspace_id AND c.id='active' AND c.enabled AND c."astraEnabled" AND s.enabled AND c.mode=s.mode
    AND c."releaseSha"=s."releaseSha" AND c."expiresAt">clock_timestamp() AT TIME ZONE 'UTC'
    AND w.state IN ('IN_PROGRESS','NEEDS_ATTENTION') AND w.canonical::jsonb->'claim'->>'kind'='ASTRA'
    AND w.canonical::jsonb->'claim'->>'runId'=run_id::text
    AND w.canonical::jsonb->'claim'->>'captureHash'=w.canonical::jsonb->>'captureHash'
    AND w.canonical::jsonb->'claim'->>'captureRevision'=w.canonical::jsonb->>'captureRevision'
    AND w.canonical::jsonb->'claim'->>'fence'=w.canonical::jsonb->>'claimFence'
  FOR SHARE OF w,c,s;
$$;
CREATE FUNCTION atlas_staff.workspace_photos_verified(workspace_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT (w.canonical::jsonb->>'captureHash' ~ '^[a-f0-9]{64}$' AND w.canonical::jsonb->>'pairConfirmedAt' IS NOT NULL
    AND (SELECT count(*) FROM unnest(ARRAY['FRONT','BACK']) side
      JOIN atlas_staff."StaffWorkspaceOperation" p ON p.id::text=w.canonical::jsonb->'sides'->side->>'uploadId'
      JOIN atlas_staff."StaffWorkspaceOperation" v ON v.id::text=w.canonical::jsonb->'sides'->side->>'verificationId'
      WHERE p."cardId"=w.id AND p.action='upload-plan' AND v."cardId"=w.id AND v.action='upload-complete'
        AND p.canonical::jsonb->'result'->'upload'->>'side'=side
        AND v.canonical::jsonb->'result'->>'uploadId'=p.id::text
        AND v.canonical::jsonb->'result'->'verification'->>'sha256'=p.canonical::jsonb->'result'->'upload'->>'sha256'
        AND v.canonical::jsonb->'result'->'verification'->>'objectRef'=p.canonical::jsonb->'result'->'upload'->>'objectRef')=2) IS TRUE
  FROM atlas_staff."StaffWorkspaceCard" w WHERE w.id=workspace_id;
$$;
CREATE FUNCTION atlas_staff.operator_workspace_count(pilot_id uuid) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT count(*)::integer FROM atlas_staff."StaffWorkspaceCard" w
    JOIN atlas_staff."StaffWorkspaceControl" c ON c."cohortId"=w."cohortId" AND c.id='active'
    JOIN atlas_staff."StaffGradingBridgeControl" b ON b.id='active'
  WHERE c.enabled AND b.enabled AND c.mode=b.mode AND b."policyCanonical"::jsonb->>'pilotId'=pilot_id::text
    AND b."policyCanonical"::jsonb->>'version'='atlas-workspace-bridge-policy-v1'
    AND b."policyCanonical"::jsonb->'workspaceCardIds' ? w.id::text
    AND c."expiresAt">clock_timestamp() AT TIME ZONE 'UTC' AND atlas_staff.workspace_photos_verified(w.id);
$$;
CREATE FUNCTION atlas_staff.workspace_pilot_budget_usage(pilot uuid,workspace uuid)
RETURNS TABLE(total text, card text, operations integer, attempts integer, overrun boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  WITH costs AS (
    SELECT w.id AS workspace,coalesce(e."actualMicroUsd",e."reservedMicroUsd") AS cost,
      coalesce(e."actualMicroUsd">e."reservedMicroUsd",false) AS overrun,true AS worker
    FROM atlas_staff."StaffGradingExecution" e JOIN atlas_staff."StaffGradingOperation" o ON o.id=e."operationId"
      LEFT JOIN atlas_staff."StaffWorkspaceCard" w ON w."specimenId"=o."specimenId" WHERE e."pilotId"=pilot
    UNION ALL
    SELECT coalesce(r."workspaceCardId",w.id),CASE WHEN a.state='FAILED' AND a."dispatchedAt" IS NULL THEN 0
      ELSE coalesce(a."actualMicroUsd",a."usageCeilingMicroUsd",a."reservedMicroUsd") END,
      a."usageEnvelopeExceeded" OR coalesce(a."usageCeilingMicroUsd">a."reservedMicroUsd",false)
        OR coalesce(a."actualMicroUsd">coalesce(a."usageCeilingMicroUsd",a."reservedMicroUsd"),false),false
    FROM atlas_staff."StaffOperatorAttempt" a JOIN atlas_staff."StaffOperatorRun" r ON r.id=a."runId"
      LEFT JOIN atlas_staff."StaffWorkspaceCard" w ON w."specimenId"=r."specimenId" WHERE r."pilotId"=pilot
  ) SELECT coalesce(sum(cost),0)::text,coalesce(sum(cost) FILTER(WHERE costs.workspace=workspace_pilot_budget_usage.workspace),0)::text,
    count(*) FILTER(WHERE costs.workspace=workspace_pilot_budget_usage.workspace AND worker)::integer,
    count(*) FILTER(WHERE costs.workspace=workspace_pilot_budget_usage.workspace AND NOT worker)::integer,
    coalesce(bool_or(costs.overrun),false) FROM costs;
$$;
CREATE FUNCTION atlas_staff.workspace_pilot_subject(pilot uuid,specimen uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT w.id FROM atlas_staff."StaffWorkspaceCard" w JOIN atlas_staff."StaffWorkspaceControl" c ON c."cohortId"=w."cohortId"
    JOIN atlas_staff."StaffGradingBridgeControl" b ON b.id='active'
  WHERE w."specimenId"=specimen AND c.id='active' AND c.enabled AND b.enabled AND c.mode=b.mode
    AND b."policyCanonical"::jsonb->>'pilotId'=pilot::text AND b."policyCanonical"::jsonb->'workspaceCardIds' ? w.id::text
    AND c."expiresAt">clock_timestamp() AT TIME ZONE 'UTC' AND atlas_staff.workspace_photos_verified(w.id);
$$;

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
  IF OLD.state='PREPARATION_READY' THEN
    IF NEW.revision<>OLD.revision OR NEW."leaseFence"<>OLD."leaseFence"
      OR NEW."leaseOwner" IS NOT NULL AND (NEW."leaseOwner",NEW."leaseMode",NEW."leaseExpiresAt")
        IS DISTINCT FROM (OLD."leaseOwner",OLD."leaseMode",OLD."leaseExpiresAt")
      OR NEW.summary IS DISTINCT FROM OLD.summary THEN
      RAISE EXCEPTION 'ATLAS settled capture cannot execute another model action'; END IF;
    IF NEW.state='PREPARATION_READY' AND NEW."failureCode" IS NOT DISTINCT FROM OLD."failureCode" THEN RETURN NEW; END IF;
    IF NEW.state='FAILED' AND NEW."controlState"='TAKEN_OVER' AND NEW."failureCode"='ASTRA_HUMAN_TAKEOVER'
      AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=NEW.id
        AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN')) THEN RETURN NEW; END IF;
    IF NEW.state='UNKNOWN' AND NEW."failureCode"='ASTRA_CONFLICTING_RECEIPT'
      AND EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorReceipt" receipt
        JOIN atlas_staff."StaffOperatorAttempt" attempt ON attempt.id=receipt."attemptId"
        WHERE attempt."runId"=NEW.id AND attempt.state='APPLIED' AND receipt.id<>attempt."resultReceiptId"
          AND receipt.xmin::text=pg_current_xact_id()::text) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'ATLAS settled capture requires a recorded human control or conflicting receipt';
  END IF;
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
  IF NEW.state IN ('READY_FOR_HUMAN','PREPARATION_READY','NEEDS_RECAPTURE','NEEDS_EXPERT') AND NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'ATLAS handoff requires an immutable step'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION atlas_staff.operator_budget_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE b atlas_staff."StaffGradingBridgeControl"%ROWTYPE; p jsonb; specimen uuid; pilot uuid; u record;
  r atlas_staff."StaffOperatorRun"%ROWTYPE; c atlas_staff."StaffOperatorControl"%ROWTYPE; ap jsonb; expected bigint; workspace_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE;
  p:=b."policyCanonical"::jsonb;
  IF TG_TABLE_NAME='StaffGradingExecution' THEN
    SELECT "specimenId" INTO specimen FROM atlas_staff."StaffGradingOperation" WHERE id=NEW."operationId";
    pilot:=NEW."pilotId"; expected:=(p->>'reservationPerOperationMicroUsd')::bigint;
  ELSE
    SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=NEW."runId";
    SELECT * INTO c FROM atlas_staff."StaffOperatorControl" WHERE id='active' FOR SHARE;
    ap:=c."policyCanonical"::jsonb->'astra'; specimen:=r."specimenId"; pilot:=r."pilotId";
    expected:=ceil((922000::numeric*(ap->>'inputNanoUsdPerToken')::bigint
      +(ap->>'maxOutputTokens')::bigint*(ap->>'outputNanoUsdPerToken')::bigint)/1000)::bigint;
    IF (c.enabled AND r."policyHash"=c."policyHash" AND r."runtimeHash"=c."configHash" AND r."gradingPolicyHash"=b."gradingPolicyHash"
      AND NEW."providerBindingHash"=c."providerBindingHash") IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS operator not admitted'; END IF;
  END IF;
  IF p->>'version'='atlas-workspace-bridge-policy-v1' THEN
    IF TG_TABLE_NAME='StaffOperatorAttempt' THEN workspace_id:=r."workspaceCardId";
    ELSE workspace_id:=atlas_staff.workspace_pilot_subject(pilot,specimen); END IF;
    SELECT * INTO u FROM atlas_staff.workspace_pilot_budget_usage(pilot,workspace_id);
    IF (b.enabled AND p->>'pilotId'=pilot::text AND (p->>'expiresAt')::timestamptz>clock_timestamp()
      AND p->'workspaceCardIds' ? workspace_id::text AND NEW."reservedMicroUsd"=expected
      AND (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p->'workspaceCardIds') x)=10
      AND atlas_staff.operator_workspace_count(pilot)=10 AND NOT u.overrun
      AND u.total::numeric+expected<=(p->>'maxTotalMicroUsd')::numeric
      AND u.card::numeric+expected<=(p->>'maxCardMicroUsd')::numeric
      AND (TG_TABLE_NAME<>'StaffGradingExecution' OR u.operations<(p->>'maxOperationsPerCard')::integer)
      AND (TG_TABLE_NAME<>'StaffOperatorAttempt' OR u.attempts<(c."policyCanonical"::jsonb->>'maxAttemptsPerCard')::integer)) IS NOT TRUE THEN
        RAISE EXCEPTION 'ATLAS shared workspace pilot budget denied'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO u FROM atlas_staff.pilot_budget_usage(pilot,specimen);
  IF (b.enabled AND p->>'pilotId'=pilot::text AND (p->>'expiresAt')::timestamptz>clock_timestamp()
    AND p->'specimenIds' ? specimen::text AND NEW."reservedMicroUsd"=expected
    AND (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p->'specimenIds') x)=10
    AND (SELECT count(*) FROM atlas_staff."StaffSpecimen" s WHERE p->'specimenIds' ? s.id::text
      AND s."sourceType"=CASE b.mode WHEN 'PRODUCTION' THEN 'SPEEDSTER' ELSE 'LOCAL_FIXTURE' END)=10
    AND NOT u.overrun AND u.total::numeric+expected<=(p->>'maxTotalMicroUsd')::numeric
    AND u.card::numeric+expected<=(p->>'maxCardMicroUsd')::numeric
    AND (TG_TABLE_NAME<>'StaffGradingExecution' OR u.operations<(p->>'maxOperationsPerCard')::integer)
    AND (TG_TABLE_NAME<>'StaffOperatorAttempt' OR u.attempts<(c."policyCanonical"::jsonb->>'maxAttemptsPerCard')::integer)
  ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS shared pilot budget denied'; END IF;
  RETURN NEW;
END $$;

-- Further phase guards are appended by the same candidate build.

ALTER TABLE "StaffOperatorOutbox" DROP CONSTRAINT "StaffOperatorOutbox_shape";
ALTER TABLE "StaffOperatorOutbox" ADD CONSTRAINT "StaffOperatorOutbox_shape" CHECK ((revision>0
  AND type IN ('HUMAN_REVIEW_READY','OPERATOR_ATTENTION_REQUIRED','CAPTURE_PREPARATION_READY')
  AND octet_length(payload)<=8192 AND jsonb_typeof(payload::jsonb)='object'
  AND "payloadHash"=encode(sha256(convert_to(payload,'UTF8')),'hex') AND state IN ('PENDING','CLAIMED','DELIVERED')
  AND "claimFence">=0 AND ((state='PENDING' AND "claimOwner" IS NULL AND "claimUntil" IS NULL AND "deliveredAt" IS NULL)
    OR (state='CLAIMED' AND "claimOwner" IS NOT NULL AND "claimUntil" IS NOT NULL AND "deliveredAt" IS NULL)
    OR (state='DELIVERED' AND "claimOwner" IS NOT NULL AND "claimUntil" IS NOT NULL AND "deliveredAt" IS NOT NULL))) IS TRUE);

CREATE FUNCTION atlas_staff.operator_capture_current(run_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperatorRun"%ROWTYPE; w atlas_staff."StaffWorkspaceCard"%ROWTYPE; m jsonb; a jsonb; p jsonb; v jsonb;
BEGIN
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=run_id;
  IF r.phase<>'CAPTURE_REVIEW' THEN RETURN false; END IF;
  SELECT * INTO w FROM atlas_staff.lock_operator_workspace(r."workspaceCardId",r.id);
  m:=r."manifestCanonical"::jsonb;
  IF (w.id=r."workspaceCardId" AND atlas_staff.workspace_photos_verified(w.id)
    AND w.canonical::jsonb->>'captureHash'=r."evidenceHash" AND m->>'runId'=r.id::text
    AND m->>'workspaceCardId'=w.id::text AND m->>'evidenceHash'=r."evidenceHash"
    AND m->>'claimId'=w.canonical::jsonb->'claim'->>'id'
    AND m->>'claimFence'=w.canonical::jsonb->>'claimFence'
    AND m->>'captureRevision'=w.canonical::jsonb->>'captureRevision'
    AND m->>'workflowRevision'=w.canonical::jsonb->'claim'->>'workflowRevision'
    AND (m->>'workflowRevision')::integer<=w.revision
    AND m->'identity'=coalesce(w.canonical::jsonb#>'{workspace,identity}',w.canonical::jsonb->'identity')
    AND m->'cornerShape'=coalesce(w.canonical::jsonb#>'{workspace,cornerShape}','null'::jsonb)
    AND m->'identity'->>'category' IN ('SPORTS','POKEMON')
    AND (m->'cornerShape'='null'::jsonb OR m->>'cornerShape' IN ('SQUARE','ROUNDED_3_18_MM'))
    AND m-ARRAY['version','phase','runId','workspaceCardId','claimId','claimFence','captureRevision','workflowRevision',
      'evidenceHash','identity','cornerShape','assets']='{}'::jsonb
    AND jsonb_array_length(m->'assets')=2
    AND (SELECT count(DISTINCT x->>'side') FROM jsonb_array_elements(m->'assets') x)=2
    AND (SELECT count(DISTINCT x->>'assetId') FROM jsonb_array_elements(m->'assets') x)=2
    AND (SELECT count(DISTINCT x->>'sha256') FROM jsonb_array_elements(m->'assets') x)=2) IS NOT TRUE THEN RETURN false; END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(m->'assets') LOOP
    SELECT canonical::jsonb->'result'->'upload' INTO p FROM atlas_staff."StaffWorkspaceOperation"
      WHERE id::text=w.canonical::jsonb->'sides'->(a->>'side')->>'uploadId' AND "cardId"=w.id AND action='upload-plan';
    SELECT canonical::jsonb->'result'->'verification' INTO v FROM atlas_staff."StaffWorkspaceOperation"
      WHERE id::text=w.canonical::jsonb->'sides'->(a->>'side')->>'verificationId' AND "cardId"=w.id AND action='upload-complete';
    IF (a->>'view'='ORIGINAL' AND a->>'side' IN ('FRONT','BACK') AND a->>'assetId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
      AND a->>'sha256'=v->>'sha256' AND a->>'byteCount'=v->>'byteCount' AND a->>'width'=v->>'width'
      AND a->>'height'=v->>'height' AND a->>'contentType'=v->>'contentType'
      AND p->>'sourceId'=w.canonical::jsonb->'source'->>'sourceId'
      AND p->>'sourceOwnerId'=w.canonical::jsonb->'source'->>'sourceOwnerId'
      AND p->>'sha256'=v->>'sha256' AND p->>'objectRef'=v->>'objectRef') IS NOT TRUE THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

CREATE FUNCTION atlas_staff.assert_capture_operator_commit(run_id uuid,event_table text,event_id uuid,is_admission boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperatorRun"%ROWTYPE; c atlas_staff."StaffOperatorControl"%ROWTYPE;
  b atlas_staff."StaffGradingBridgeControl"%ROWTYPE; sc atlas_staff."StaffControl"%ROWTYPE;
  step atlas_staff."StaffOperatorStep"%ROWTYPE; a atlas_staff."StaffOperatorAttempt"%ROWTYPE;
  outbox atlas_staff."StaffOperatorOutbox"%ROWTYPE; receipt jsonb; p jsonb; m jsonb; selected jsonb; ref jsonb; proposed atlas_staff."StaffOperatorStep"%ROWTYPE;
  request_json jsonb; field_json jsonb; evidence_refs jsonb:='[]'::jsonb; asset_ref jsonb;
  expected_identity jsonb; expected_boundaries jsonb:='[]'::jsonb; identity_ref jsonb:='null'::jsonb;
  proposed_request jsonb; expected_ref jsonb; expected_result jsonb; selected_boundary jsonb;
  xs numeric[]; ys numeric[]; point_json jsonb; idx integer; next_idx integer; after_idx integer; double_area numeric;
BEGIN
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=run_id;
  SELECT * INTO c FROM atlas_staff."StaffOperatorControl" WHERE id='active' FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE;
  SELECT * INTO sc FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  p:=c."policyCanonical"::jsonb; m:=r."manifestCanonical"::jsonb;
  IF (c.enabled AND b.enabled AND sc.enabled AND c.mode=b.mode AND c.mode=sc.mode
    AND r."policyHash"=c."policyHash" AND r."runtimeHash"=c."configHash"
    AND r."gradingPolicyHash"=b."gradingPolicyHash" AND r."gradingPolicyHash"=sc."gradingPolicyHash"
    AND p->>'pilotId'=r."pilotId"::text AND b."policyCanonical"::jsonb->>'pilotId'=r."pilotId"::text
    AND b."policyCanonical"::jsonb->>'version'='atlas-workspace-bridge-policy-v1'
    AND b."policyCanonical"::jsonb->'workspaceCardIds' ? r."workspaceCardId"::text
    AND jsonb_typeof(p->'captureTools')='array' AND jsonb_array_length(p->'captureTools')>0
    AND jsonb_array_length(p->'captureTools')<=5
    AND (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p->'captureTools'))=jsonb_array_length(p->'captureTools')
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p->'captureTools') t WHERE t NOT IN
      ('read_original_photos','inspect_region','propose_capture_identity','propose_physical_boundary','submit_capture_preparation'))
    AND (p->>'expiresAt')::timestamptz>clock_timestamp() AND (b."policyCanonical"::jsonb->>'expiresAt')::timestamptz>clock_timestamp()
    AND r."deadlineAt">clock_timestamp() AT TIME ZONE 'UTC' AND atlas_staff.operator_workspace_count(r."pilotId")=10
    AND atlas_staff.operator_capture_current(r.id)) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS capture operator requires current fresh-photo authority'; END IF;
  IF is_admission THEN
    IF r.state<>'QUEUED' OR r.revision<>1 OR r."expectedAnalysisRevision"<>0 OR r."expectedReviewRevision"<>0 THEN
      RAISE EXCEPTION 'ATLAS capture operator starts without a report'; END IF;
    RETURN;
  END IF;
  IF event_table='StaffOperatorStep' THEN SELECT * INTO step FROM atlas_staff."StaffOperatorStep" WHERE id=event_id;
  ELSIF event_table='StaffOperatorAttempt' THEN SELECT * INTO step FROM atlas_staff."StaffOperatorStep" WHERE "attemptId"=event_id;
  ELSE SELECT * INTO step FROM atlas_staff."StaffOperatorStep" WHERE "runId"=r.id AND revision=r.revision; END IF;
  SELECT * INTO a FROM atlas_staff."StaffOperatorAttempt" WHERE id=step."attemptId";
  SELECT canonical::jsonb INTO receipt FROM atlas_staff."StaffOperatorReceipt" WHERE id=a."resultReceiptId";
  IF (step.id IS NOT NULL AND a.state='APPLIED' AND a."runId"=r.id AND a."runRevision"+1=step.revision AND r.revision=step.revision
    AND step."nextInputHash"=r."inputHash" AND a."leaseFence"=r."leaseFence" AND r."leaseMode"='WORK'
    AND r."leaseExpiresAt">clock_timestamp() AT TIME ZONE 'UTC' AND a."usageCeilingMicroUsd" IS NOT NULL AND NOT a."usageEnvelopeExceeded"
    AND receipt->>'state'='RECEIVED' AND receipt->>'httpStatus'='200' AND receipt->'body'->>'status'='completed'
    AND receipt->'body'->>'model'='gpt-6-astra' AND receipt->'body'->>'service_tier'='default'
    AND p->'captureTools' ? step."toolName"
    AND step."toolName" IN ('read_original_photos','inspect_region','propose_capture_identity','propose_physical_boundary','submit_capture_preparation')
    AND (SELECT count(*) FROM jsonb_array_elements(receipt->'body'->'output') call WHERE call->>'type'='function_call')=1
    AND step."requestCanonical"::jsonb->>'runId'=r.id::text AND step."requestCanonical"::jsonb->>'manifestHash'=r."manifestHash"
    AND step."requestCanonical"::jsonb->>'evidenceHash'=r."evidenceHash"
    AND (step."requestCanonical"::jsonb->>'expectedRevision')::integer=a."runRevision"
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'body'->'output') call
      WHERE call->>'type'='function_call' AND call->>'call_id'=step."callId" AND call->>'name'=step."toolName"
        AND (call->>'arguments')::jsonb=step."requestCanonical"::jsonb)) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS capture tool and its original provider receipt must commit atomically'; END IF;
  request_json:=step."requestCanonical"::jsonb;
  selected:=step."resultCanonical"::jsonb->'result';
  IF (step."resultCanonical"::jsonb->'binding'=jsonb_build_object('runId',r.id,'evidenceHash',r."evidenceHash",
    'manifestHash',r."manifestHash",'expectedRevision',step.revision)
    AND step."resultCanonical"::jsonb-ARRAY['binding','result']='{}'::jsonb) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS capture result binding changed'; END IF;
  IF step."toolName"='read_original_photos' THEN
    IF (request_json-ARRAY['runId','evidenceHash','manifestHash','expectedRevision']='{}'::jsonb
      AND selected=jsonb_build_object('actor','MACHINE','phase','CAPTURE_REVIEW','identity',m->'identity',
        'cornerShape',m->'cornerShape','assets',m->'assets','status','ORIGINAL_PHOTOS_DELIVERED','preparation','NOT_STARTED')
      AND (SELECT count(*) FROM atlas_staff."StaffOperatorImage" WHERE "stepId"=step.id AND "runId"=r.id)=2
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m->'assets') asset WHERE NOT EXISTS
        (SELECT 1 FROM atlas_staff."StaffOperatorImage" i WHERE i."stepId"=step.id AND i."runId"=r.id
          AND i.canonical::jsonb->'asset'=asset AND i.canonical::jsonb->'request'->>'purpose'='OVERVIEW'))) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS capture original read requires both actual recorded images'; END IF;
  ELSIF step."toolName"='inspect_region' THEN
    IF (request_json-ARRAY['runId','evidenceHash','manifestHash','expectedRevision','assetId','sourceSha256','side','rect']='{}'::jsonb
      AND selected=jsonb_build_object('assetId',request_json->'assetId','rect',request_json->'rect')
      AND (SELECT count(*) FROM atlas_staff."StaffOperatorImage" WHERE "stepId"=step.id AND "runId"=r.id)=1
      AND EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorImage" i WHERE i."stepId"=step.id AND i."runId"=r.id
        AND i.canonical::jsonb->'request'=request_json||jsonb_build_object('purpose','CROP'))) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS capture region inspection requires its actual recorded crop'; END IF;
  ELSIF step."toolName" IN ('propose_capture_identity','propose_physical_boundary') THEN
    IF (selected=jsonb_build_object('actor','MACHINE','status','PROPOSED_FOR_PREPARATION',
        'proposal',jsonb_build_object('stepId',step.id,'requestHash',step."requestHash"))
      AND jsonb_typeof(request_json->'summary')='string' AND length(request_json->>'summary') BETWEEN 1 AND 500) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS capture proposal provenance changed'; END IF;
    IF step."toolName"='propose_capture_identity' THEN
      IF (request_json-ARRAY['runId','evidenceHash','manifestHash','expectedRevision','fields','summary']='{}'::jsonb
        AND jsonb_typeof(request_json->'fields')='array' AND jsonb_array_length(request_json->'fields') BETWEEN 1 AND 9
        AND (SELECT count(DISTINCT f->>'field') FROM jsonb_array_elements(request_json->'fields') f)=jsonb_array_length(request_json->'fields')) IS NOT TRUE THEN
        RAISE EXCEPTION 'ATLAS capture identity proposal fields changed'; END IF;
      FOR field_json IN SELECT value FROM jsonb_array_elements(request_json->'fields') LOOP
        IF (field_json-ARRAY['field','value','evidence']='{}'::jsonb AND field_json ? 'value'
          AND (field_json->'value'='null'::jsonb OR jsonb_typeof(field_json->'value')='string' AND length(field_json->>'value') BETWEEN 1 AND 160)
          AND (m->'identity'->>'category'='SPORTS' AND field_json->>'field' IN ('playerName','year','manufacturer','productSet','parallel','insert','cardNumber')
            OR m->'identity'->>'category'='POKEMON' AND field_json->>'field' IN ('cardName','year','productSet','parallel','cardNumber','layoutType'))
          AND (field_json->>'field'<>'layoutType' OR field_json->'value'='null'::jsonb OR field_json->>'value' IN ('POKEMON','TRAINER','ENERGY'))
          AND jsonb_typeof(field_json->'evidence')='array' AND jsonb_array_length(field_json->'evidence') BETWEEN 1 AND 12) IS NOT TRUE THEN
          RAISE EXCEPTION 'ATLAS capture identity category or evidence changed'; END IF;
        evidence_refs:=evidence_refs||(field_json->'evidence');
      END LOOP;
    ELSE
      IF (request_json-ARRAY['runId','evidenceHash','manifestHash','expectedRevision','side','corners','matColor','evidence','summary']='{}'::jsonb
        AND request_json->>'side' IN ('FRONT','BACK') AND request_json->>'matColor' IN ('BLACK','WHITE','MAGENTA')
        AND jsonb_typeof(request_json->'corners')='array' AND jsonb_array_length(request_json->'corners')=4
        AND jsonb_typeof(request_json->'evidence')='array' AND jsonb_array_length(request_json->'evidence') BETWEEN 1 AND 12) IS NOT TRUE THEN
        RAISE EXCEPTION 'ATLAS capture physical proposal shape changed'; END IF;
      xs:='{}';ys:='{}';double_area:=0;
      FOR point_json IN SELECT value FROM jsonb_array_elements(request_json->'corners') LOOP
        IF (point_json-ARRAY['x','y']='{}'::jsonb AND jsonb_typeof(point_json->'x')='number' AND jsonb_typeof(point_json->'y')='number'
          AND (point_json->>'x')::numeric BETWEEN 0 AND 1 AND (point_json->>'y')::numeric BETWEEN 0 AND 1) IS NOT TRUE THEN
          RAISE EXCEPTION 'ATLAS capture physical proposal point invalid'; END IF;
        xs:=array_append(xs,(point_json->>'x')::numeric);ys:=array_append(ys,(point_json->>'y')::numeric);
      END LOOP;
      FOR idx IN 1..4 LOOP
        next_idx:=idx%4+1;after_idx:=next_idx%4+1;
        double_area:=double_area+xs[idx]*ys[next_idx]-ys[idx]*xs[next_idx];
        IF (xs[next_idx]-xs[idx])*(ys[after_idx]-ys[next_idx])-(ys[next_idx]-ys[idx])*(xs[after_idx]-xs[next_idx])<=0 THEN
          RAISE EXCEPTION 'ATLAS capture physical proposal must be convex'; END IF;
      END LOOP;
      IF NOT (ys[1]<ys[4] AND ys[2]<ys[3] AND xs[1]<xs[2] AND xs[4]<xs[3] AND double_area>0.02) THEN
        RAISE EXCEPTION 'ATLAS capture physical proposal corner order invalid'; END IF;
      evidence_refs:=request_json->'evidence';
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(evidence_refs) e WHERE e->>'side' IS DISTINCT FROM request_json->>'side') THEN
        RAISE EXCEPTION 'ATLAS capture physical proposal side changed'; END IF;
    END IF;
    FOR asset_ref IN SELECT value FROM jsonb_array_elements(evidence_refs) LOOP
      IF (asset_ref-ARRAY['assetId','sha256','side']='{}'::jsonb
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(m->'assets') asset WHERE asset->>'assetId'=asset_ref->>'assetId'
          AND asset->>'sha256'=asset_ref->>'sha256' AND asset->>'side'=asset_ref->>'side')
        AND EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorImageDelivery" d JOIN atlas_staff."StaffOperatorImage" i ON i."imageId"=d."imageId"
          WHERE d."attemptId"=a.id AND d."requestHash"=a."requestHash" AND d."lineageHash"=i.hash AND i."runId"=r.id
            AND i.canonical::jsonb->'asset'->>'assetId'=asset_ref->>'assetId'
            AND i.canonical::jsonb->'asset'->>'sha256'=asset_ref->>'sha256' AND i.canonical::jsonb->'asset'->>'side'=asset_ref->>'side')) IS NOT TRUE THEN
        RAISE EXCEPTION 'ATLAS capture proposal requires its actual delivered original evidence'; END IF;
    END LOOP;
  END IF;
  IF r.state IN ('PREPARATION_READY','NEEDS_RECAPTURE','NEEDS_EXPERT') THEN
    SELECT * INTO outbox FROM atlas_staff."StaffOperatorOutbox" WHERE "runId"=r.id AND revision=r.revision;
    IF (step."toolName"='submit_capture_preparation' AND outbox.id IS NOT NULL
      AND outbox.type=CASE r.state WHEN 'PREPARATION_READY' THEN 'CAPTURE_PREPARATION_READY' ELSE 'OPERATOR_ATTENTION_REQUIRED' END
      AND outbox.payload::jsonb->>'version'='atlas-operator-capture-handoff-v1' AND outbox.payload::jsonb->>'actor'='MACHINE'
      AND outbox.payload::jsonb->>'runId'=r.id::text AND outbox.payload::jsonb->>'workspaceCardId'=r."workspaceCardId"::text
      AND outbox.payload::jsonb->>'captureHash'=r."evidenceHash" AND outbox.payload::jsonb->>'claimFence'=m->>'claimFence'
      AND outbox.payload::jsonb->>'captureRevision'=m->>'captureRevision' AND (outbox.payload::jsonb->>'revision')::integer=r.revision
      AND outbox.payload::jsonb->>'selectionStepId'=step.id::text AND outbox.payload::jsonb->>'selectionResultHash'=step."resultHash"
      AND outbox.payload::jsonb->>'disposition'=r.state AND outbox.payload::jsonb->>'summary'=r.summary
      AND request_json->>'summary'=r.summary
      AND r.state=CASE request_json->>'disposition' WHEN 'READY_FOR_PREPARATION' THEN 'PREPARATION_READY'
        WHEN 'NEEDS_RECAPTURE' THEN 'NEEDS_RECAPTURE' WHEN 'NEEDS_EXPERT' THEN 'NEEDS_EXPERT' END
      AND request_json-ARRAY['runId','evidenceHash','manifestHash','expectedRevision','disposition','identityProposal','boundaries','summary']='{}'::jsonb
      AND jsonb_typeof(request_json->'summary')='string' AND length(request_json->>'summary') BETWEEN 1 AND 500) IS NOT TRUE THEN
        RAISE EXCEPTION 'ATLAS capture handoff must bind its exact machine selection'; END IF;
    IF r.state='PREPARATION_READY' THEN
      IF (jsonb_typeof(request_json->'boundaries')='array' AND jsonb_array_length(request_json->'boundaries')=2
        AND (SELECT count(DISTINCT boundary->>'side') FROM jsonb_array_elements(request_json->'boundaries') boundary)=2
        AND request_json ? 'identityProposal' AND m->>'cornerShape' IN ('SQUARE','ROUNDED_3_18_MM')
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m->'assets') asset WHERE NOT EXISTS
          (SELECT 1 FROM atlas_staff."StaffOperatorImageDelivery" d JOIN atlas_staff."StaffOperatorImage" i ON i."imageId"=d."imageId"
            WHERE d."attemptId"=a.id AND d."requestHash"=a."requestHash" AND d."lineageHash"=i.hash
              AND i."runId"=r.id AND i.canonical::jsonb->'asset'=asset))) IS NOT TRUE THEN
        RAISE EXCEPTION 'ATLAS capture selection needs both boundaries and delivered originals'; END IF;
      expected_identity:=m->'identity';
      IF request_json->'identityProposal'<>'null'::jsonb THEN
        ref:=request_json->'identityProposal';
        SELECT * INTO proposed FROM atlas_staff."StaffOperatorStep" WHERE id::text=ref->>'stepId' AND "runId"=r.id
          AND "toolName"='propose_capture_identity' AND revision<step.revision AND "requestHash"=ref->>'requestHash';
        IF (proposed.id IS NOT NULL AND ref=jsonb_build_object('stepId',proposed.id,'requestHash',proposed."requestHash")
          AND proposed."resultCanonical"::jsonb->'result'=jsonb_build_object('actor','MACHINE','status','PROPOSED_FOR_PREPARATION','proposal',ref)) IS NOT TRUE THEN
          RAISE EXCEPTION 'ATLAS capture selection identity proposal changed'; END IF;
        FOR field_json IN SELECT value FROM jsonb_array_elements(proposed."requestCanonical"::jsonb->'fields') LOOP
          expected_identity:=jsonb_set(expected_identity,ARRAY[field_json->>'field'],field_json->'value',true);
        END LOOP;
        identity_ref:=ref||jsonb_build_object('resultHash',proposed."resultHash");
      END IF;
      FOR selected_boundary IN SELECT value FROM jsonb_array_elements(request_json->'boundaries') LOOP
        ref:=selected_boundary->'proposal';
        SELECT * INTO proposed FROM atlas_staff."StaffOperatorStep" WHERE id::text=ref->>'stepId' AND "runId"=r.id
          AND "toolName"='propose_physical_boundary' AND revision<step.revision AND "requestHash"=ref->>'requestHash';
        proposed_request:=proposed."requestCanonical"::jsonb;
        IF (selected_boundary-ARRAY['side','proposal']='{}'::jsonb AND selected_boundary->>'side' IN ('FRONT','BACK')
          AND proposed.id IS NOT NULL AND ref=jsonb_build_object('stepId',proposed.id,'requestHash',proposed."requestHash")
          AND proposed_request->>'side'=selected_boundary->>'side'
          AND proposed."resultCanonical"::jsonb->'result'=jsonb_build_object('actor','MACHINE','status','PROPOSED_FOR_PREPARATION','proposal',ref)) IS NOT TRUE THEN
          RAISE EXCEPTION 'ATLAS capture selection physical proposal changed'; END IF;
        expected_boundaries:=expected_boundaries||jsonb_build_array(jsonb_build_object('side',selected_boundary->'side',
          'corners',proposed_request->'corners','matColor',proposed_request->'matColor',
          'proposal',ref||jsonb_build_object('resultHash',proposed."resultHash")));
      END LOOP;
      expected_result:=jsonb_build_object('version','atlas-machine-capture-selection-v1','actor','MACHINE','runId',r.id,
        'workspaceCardId',r."workspaceCardId",'captureHash',r."evidenceHash",'captureRevision',m->'captureRevision',
        'claimId',m->'claimId','claimFence',m->'claimFence','workflowRevision',m->'workflowRevision',
        'manifestHash',r."manifestHash",'identity',expected_identity,'identityProposal',identity_ref,'cornerShape',m->'cornerShape',
        'boundaries',expected_boundaries,'printedFrameSelection','REQUIRE_VALIDATED_WORKER_PROPOSAL','status','PENDING_ORIGINAL_PREPARATION');
      IF selected IS DISTINCT FROM expected_result THEN RAISE EXCEPTION 'ATLAS capture selection must equal its exact recorded machine proposals'; END IF;
    ELSIF selected IS DISTINCT FROM jsonb_build_object('actor','MACHINE','status','PREPARATION_ATTENTION_REQUIRED','disposition',request_json->'disposition') THEN
      RAISE EXCEPTION 'ATLAS capture attention cannot claim successful preparation';
    END IF;
  END IF;
  IF event_table='StaffOperatorOutbox' AND outbox.id IS DISTINCT FROM event_id THEN
    RAISE EXCEPTION 'ATLAS capture outbox cannot invent a handoff'; END IF;
END $$;


CREATE OR REPLACE FUNCTION atlas_staff.operator_source_current(run_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE expected record;
BEGIN
  IF EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorRun" WHERE id=run_id AND phase='CAPTURE_REVIEW') THEN
    RETURN atlas_staff.operator_capture_current(run_id);
  END IF;
  SELECT s."sourceType",s."sourceId",s."sourceOwnerId",a."sourceRevision",c.mode INTO expected
  FROM atlas_staff."StaffOperatorRun" r JOIN atlas_staff."StaffSpecimen" s ON s.id=r."specimenId"
  JOIN atlas_staff."StaffAnalysisRevision" a ON a."specimenId"=s.id AND a.revision=r."expectedAnalysisRevision"
  JOIN atlas_staff."StaffOperatorControl" c ON c.id='active'
  WHERE r.id=run_id AND s."analysisRevision"=r."expectedAnalysisRevision" AND s."evidenceHash"=r."evidenceHash";
  IF expected IS NULL THEN RETURN false; END IF;
  IF expected."sourceType"='LOCAL_FIXTURE' THEN RETURN expected.mode='LOCAL_FIXTURE'; END IF;
  RETURN expected.mode='PRODUCTION' AND atlas_staff.operator_source_matches(expected."sourceId",expected."sourceOwnerId",expected."sourceRevision");
END;
$$;

CREATE OR REPLACE FUNCTION atlas_staff.operator_commit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperatorRun"%ROWTYPE; s atlas_staff."StaffSpecimen"%ROWTYPE; c atlas_staff."StaffOperatorControl"%ROWTYPE;
  b atlas_staff."StaffGradingBridgeControl"%ROWTYPE; sc atlas_staff."StaffControl"%ROWTYPE; step atlas_staff."StaffOperatorStep"%ROWTYPE;
  a atlas_staff."StaffOperatorAttempt"%ROWTYPE; receipt jsonb; p jsonb; run_id uuid;
BEGIN
  IF TG_TABLE_NAME='StaffOperatorRun' THEN run_id:=NEW.id; ELSE run_id:=NEW."runId"; END IF;
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=run_id;
  IF r.phase='CAPTURE_REVIEW' THEN
    PERFORM atlas_staff.assert_capture_operator_commit(run_id,TG_TABLE_NAME,NEW.id,TG_TABLE_NAME='StaffOperatorRun' AND TG_OP='INSERT');
    RETURN NULL;
  END IF;
  SELECT * INTO s FROM atlas_staff."StaffSpecimen" WHERE id=r."specimenId";
  SELECT * INTO c FROM atlas_staff."StaffOperatorControl" WHERE id='active' FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE;
  SELECT * INTO sc FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  p:=c."policyCanonical"::jsonb;
  IF (c.enabled AND b.enabled AND sc.enabled AND c.mode=b.mode AND c.mode=sc.mode
    AND r."policyHash"=c."policyHash" AND r."runtimeHash"=c."configHash"
    AND r."gradingPolicyHash"=b."gradingPolicyHash" AND r."gradingPolicyHash"=sc."gradingPolicyHash"
    AND p->>'pilotId'=r."pilotId"::text AND b."policyCanonical"::jsonb->>'pilotId'=r."pilotId"::text
    AND (b."policyCanonical"::jsonb->'specimenIds' ? s.id::text OR
      (b."policyCanonical"::jsonb->>'version'='atlas-workspace-bridge-policy-v1'
        AND atlas_staff.workspace_pilot_subject(r."pilotId",s.id)=r."workspaceCardId"))
    AND (p->>'expiresAt')::timestamptz>clock_timestamp() AND (b."policyCanonical"::jsonb->>'expiresAt')::timestamptz>clock_timestamp()
    AND r."deadlineAt">clock_timestamp() AT TIME ZONE 'UTC'
    AND s."evidenceHash"=r."evidenceHash" AND s."analysisRevision"=r."expectedAnalysisRevision"
    AND s."draftRevision"=r."expectedReviewRevision" AND r."expectedAnalysisRevision">0
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffGradingOperation" WHERE "specimenId"=s.id AND state IN ('RESERVED','DISPATCHED','UNKNOWN'))
  ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS operator must commit current evidence and authority'; END IF;
  IF TG_TABLE_NAME='StaffOperatorRun' AND TG_OP='INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM atlas_staff."StaffAnalysisRevision" ar
      JOIN atlas_staff."StaffGradingOperation" o ON o.id=ar."operationId"
      JOIN atlas_staff."StaffGradingExecution" e ON e."operationId"=o.id
      WHERE ar."specimenId"=s.id AND ar.revision=r."expectedAnalysisRevision" AND o.state='SUCCEEDED'
      AND o."requestCanonical"::jsonb->'request'->'action'->>'type'='INITIALIZE' AND e.state='COMMITTED' AND e."pilotId"=r."pilotId") THEN
        RAISE EXCEPTION 'ATLAS operator requires fresh admitted initial grading'; END IF;
  ELSIF TG_TABLE_NAME='StaffOperatorRun' THEN
    SELECT * INTO step FROM atlas_staff."StaffOperatorStep" WHERE "runId"=r.id AND revision=r.revision;
    IF step."nextInputHash" IS DISTINCT FROM r."inputHash" THEN RAISE EXCEPTION 'ATLAS operator transition requires matching step'; END IF;
  ELSIF TG_TABLE_NAME='StaffOperatorAttempt' THEN
    SELECT * INTO step FROM atlas_staff."StaffOperatorStep" WHERE "attemptId"=NEW.id;
    IF NEW.state='APPLIED' AND step.id IS NULL THEN RAISE EXCEPTION 'ATLAS applied attempt requires a step'; END IF;
  ELSIF TG_TABLE_NAME='StaffOperatorStep' THEN
    SELECT * INTO step FROM atlas_staff."StaffOperatorStep" WHERE id=NEW.id;
  ELSE
    SELECT * INTO step FROM atlas_staff."StaffOperatorStep" WHERE "runId"=r.id AND revision=r.revision;
    IF (NEW.revision=r.revision AND NEW.payload::jsonb->>'runId'=r.id::text
      AND NEW.payload::jsonb->>'specimenId'=r."specimenId"::text AND NEW.payload::jsonb->>'evidenceHash'=r."evidenceHash"
      AND NEW.payload::jsonb->>'reportHash'=r."manifestCanonical"::jsonb->>'reportHash'
      AND NEW.payload::jsonb->>'disposition'=r.state AND NEW.payload::jsonb->>'summary'=r.summary
      AND NEW.type=CASE r.state WHEN 'READY_FOR_HUMAN' THEN 'HUMAN_REVIEW_READY' ELSE 'OPERATOR_ATTENTION_REQUIRED' END
      AND r.state IN ('READY_FOR_HUMAN','NEEDS_RECAPTURE','NEEDS_EXPERT') AND step."toolName"='submit_for_human_review') IS NOT TRUE THEN
        RAISE EXCEPTION 'ATLAS outbox must bind the exact handoff'; END IF;
  END IF;
  IF step.id IS NOT NULL THEN
    SELECT * INTO a FROM atlas_staff."StaffOperatorAttempt" WHERE id=step."attemptId";
    SELECT canonical::jsonb INTO receipt FROM atlas_staff."StaffOperatorReceipt" WHERE id=a."resultReceiptId";
    IF (a.state='APPLIED' AND a."runId"=r.id AND a."runRevision"+1=step.revision AND r.revision=step.revision
      AND step."nextInputHash"=r."inputHash"
      AND a."leaseFence"=r."leaseFence" AND r."leaseMode"='WORK' AND r."leaseExpiresAt">clock_timestamp() AT TIME ZONE 'UTC'
      AND a."usageCeilingMicroUsd" IS NOT NULL AND NOT a."usageEnvelopeExceeded"
      AND receipt->>'state'='RECEIVED' AND receipt->>'httpStatus'='200' AND receipt->'body'->>'status'='completed'
      AND receipt->'body'->>'model'='gpt-6-astra' AND receipt->'body'->>'service_tier'='default'
      AND step."requestCanonical"::jsonb->>'runId'=r.id::text
      AND step."requestCanonical"::jsonb->>'manifestHash'=r."manifestHash"
      AND step."requestCanonical"::jsonb->>'evidenceHash'=r."evidenceHash"
      AND (step."requestCanonical"::jsonb->>'expectedRevision')::int=a."runRevision"
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'body'->'output') call
        WHERE call->>'type'='function_call' AND call->>'call_id'=step."callId" AND call->>'name'=step."toolName"
          AND (call->>'arguments')::jsonb=step."requestCanonical"::jsonb)
      AND (r.state NOT IN ('READY_FOR_HUMAN','NEEDS_RECAPTURE','NEEDS_EXPERT') OR (step."toolName"='submit_for_human_review'
        AND step."requestCanonical"::jsonb->>'reportHash'=r."manifestCanonical"::jsonb->>'reportHash'
        AND r.state=CASE step."requestCanonical"::jsonb->>'disposition' WHEN 'READY_FOR_REVIEW' THEN 'READY_FOR_HUMAN'
          WHEN 'NEEDS_RECAPTURE' THEN 'NEEDS_RECAPTURE' WHEN 'NEEDS_EXPERT' THEN 'NEEDS_EXPERT' END
        AND EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorOutbox" WHERE "runId"=r.id AND revision=r.revision)))
    ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS operator tool and handoff must commit atomically'; END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION atlas_staff.operator_image_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE i atlas_staff."StaffOperatorImage"%ROWTYPE; s atlas_staff."StaffOperatorStep"%ROWTYPE;
  r atlas_staff."StaffOperatorRun"%ROWTYPE; a atlas_staff."StaffOperatorAttempt"%ROWTYPE; p jsonb; asset jsonb; req jsonb;
BEGIN
  IF TG_TABLE_NAME='StaffOperatorImage' THEN
    i:=NEW; SELECT * INTO s FROM atlas_staff."StaffOperatorStep" WHERE id=i."stepId";
    SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=i."runId";
    p:=i.canonical::jsonb; asset:=p->'asset'; req:=p->'request';
    IF (s."runId"=r.id AND s.revision=r.revision AND s."toolName" IN ('read_card_report','read_original_photos','inspect_region')
      AND req->>'runId'=r.id::text AND req->>'evidenceHash'=r."evidenceHash" AND req->>'manifestHash'=r."manifestHash"
      AND (req->>'expectedRevision')::int=s.revision-1 AND p->>'decoder'='sharp-0.33.5/vips-8.15.3'
      AND p->>'contentType'='image/png' AND p->>'sha256' ~ '^[a-f0-9]{64}$'
      AND p->>'transformHash'=encode(sha256(convert_to(p->>'transformCanonical','UTF8')),'hex')
      AND (r."manifestCanonical"::jsonb->'assets') @> jsonb_build_array(asset)
      AND req->>'assetId'=asset->>'assetId' AND req->>'sourceSha256'=asset->>'sha256' AND req->>'side'=asset->>'side'
      AND (s."toolName"='read_card_report' AND req->>'purpose'='OVERVIEW' AND asset->>'view'='RECTIFIED'
        OR s."toolName"='read_original_photos' AND req->>'purpose'='OVERVIEW' AND asset->>'view'='ORIGINAL'
        OR s."toolName"='inspect_region' AND req->>'purpose'='CROP' AND req-'purpose'=s."requestCanonical"::jsonb)
    ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS generated image lineage mismatch'; END IF;
  ELSE
    SELECT * INTO i FROM atlas_staff."StaffOperatorImage" WHERE "imageId"=NEW."imageId";
    SELECT * INTO s FROM atlas_staff."StaffOperatorStep" WHERE id=i."stepId";
    SELECT * INTO a FROM atlas_staff."StaffOperatorAttempt" WHERE id=NEW."attemptId";
    IF (a."runId"=i."runId" AND a."requestHash"=NEW."requestHash" AND i.hash=NEW."lineageHash"
      AND a."runRevision">=s.revision AND a.state IN ('RESERVED','DISPATCHED')) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS image delivery attempt mismatch'; END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION atlas_staff.workspace_operator_execution_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
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
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=r."workspaceCardId" OR "specimenId"=r."specimenId";
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

CREATE OR REPLACE FUNCTION atlas_staff.read_workspace_operator_control(workspace_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE w atlas_staff."StaffWorkspaceCard"%ROWTYPE; r atlas_staff."StaffOperatorRun"%ROWTYPE;
  pending integer:=0; held boolean:=false; active boolean; displayed text;
BEGIN
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=workspace_id;
  IF FOUND THEN
    SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE "workspaceCardId"=w.id OR "specimenId"=w."specimenId" ORDER BY "createdAt" DESC,id DESC LIMIT 1;
  END IF;
  IF r.id IS NULL THEN RETURN jsonb_build_object('runId',NULL,'state','UNAVAILABLE','mode','CONTINUOUS',
    'pending',0,'settled',true,'canPause',false,'canResume',false,'canStep',false,'canTakeOver',false); END IF;
  SELECT count(*)::integer,coalesce(bool_or(state IN ('DISPATCHED','RECEIVED','UNKNOWN')),false)
    INTO pending,held FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=r.id AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN');
  held:=held OR r.state='UNKNOWN';
  active:=r.state IN ('QUEUED','RUNNING','WAITING_TOOL','UNKNOWN','PREPARATION_READY');
  displayed:=CASE WHEN r."controlState"='TAKEN_OVER' THEN 'TAKEN_OVER' WHEN NOT active THEN 'COMPLETED'
    WHEN r."controlState"='RUNNING' AND r.state='QUEUED' THEN 'QUEUED' ELSE r."controlState" END;
  RETURN jsonb_build_object('runId',r.id,'runState',r.state,'state',displayed,'mode',r."executionMode",
    'controlRevision',r."controlRevision",'stepBudget',r."stepBudget",'pending',pending,'settled',NOT held,
    'canPause',active AND r."controlState"='RUNNING','canResume',active AND r."controlState"='PAUSED' AND pending=0 AND NOT held,
    'canStep',active AND r."controlState"='PAUSED' AND pending=0 AND NOT held,
    'canTakeOver',active AND r."controlState"<>'TAKEN_OVER' AND NOT held);
END $$;

CREATE OR REPLACE FUNCTION atlas_staff.control_workspace_operator(workspace_id uuid,claim_fence integer,action text,
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
    AND ("workspaceCardId"=w.id OR "specimenId"=w."specimenId") FOR UPDATE;
  IF r.id IS NULL OR r.state NOT IN ('QUEUED','RUNNING','WAITING_TOOL','UNKNOWN','PREPARATION_READY') OR r."controlState"='TAKEN_OVER' THEN
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

CREATE OR REPLACE FUNCTION atlas_staff.read_workspace_operator_activity(workspace_id uuid,limit_count integer)
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
    FROM atlas_staff."StaffWorkspaceCard" w JOIN atlas_staff."StaffOperatorRun" r ON r."workspaceCardId"=w.id OR r."specimenId"=w."specimenId"
      JOIN atlas_staff."StaffOperatorStep" s ON s."runId"=r.id
    WHERE w.id=workspace_id AND limit_count BETWEEN 1 AND 100
    ORDER BY s."createdAt" DESC,s.id DESC LIMIT least(greatest(limit_count,0),100)) s
  ORDER BY s."createdAt",s.id;
$$;

CREATE FUNCTION atlas_staff.operator_capture_successor_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE prior atlas_staff."StaffOperatorRun"%ROWTYPE; w atlas_staff."StaffWorkspaceCard"%ROWTYPE;
BEGIN
  IF NEW."captureRunId" IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO prior FROM atlas_staff."StaffOperatorRun" WHERE id=NEW."captureRunId";
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=NEW."workspaceCardId";
  IF (NEW.phase='REPORT_REVIEW' AND prior.phase='CAPTURE_REVIEW' AND prior.state='PREPARATION_READY'
    AND prior."workspaceCardId"=NEW."workspaceCardId" AND prior."pilotId"=NEW."pilotId"
    AND prior."evidenceHash"=w.canonical::jsonb->>'captureHash' AND w."specimenId"=NEW."specimenId"
    AND w.canonical::jsonb->'claim'->>'kind'='ASTRA' AND w.canonical::jsonb->'claim'->>'runId'=NEW.id::text
    AND w.canonical::jsonb->'claim'->>'fence'=prior."manifestCanonical"::jsonb->>'claimFence'
    AND NEW."manifestCanonical"::jsonb->>'captureRunId'=prior.id::text
    AND NEW."manifestCanonical"::jsonb->>'workspaceCardId'=w.id::text
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=prior.id
      AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN'))) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS report successor requires its settled exact capture run'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "StaffOperatorRun_capture_successor" AFTER INSERT ON "StaffOperatorRun"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_capture_successor_guard();
REVOKE ALL ON FUNCTION atlas_staff.lock_operator_workspace(uuid,uuid),atlas_staff.workspace_photos_verified(uuid),
  atlas_staff.operator_workspace_count(uuid),atlas_staff.workspace_pilot_budget_usage(uuid,uuid),
  atlas_staff.workspace_pilot_subject(uuid,uuid),atlas_staff.operator_capture_current(uuid),
  atlas_staff.assert_capture_operator_commit(uuid,text,uuid,boolean),atlas_staff.operator_capture_successor_guard() FROM PUBLIC;
COMMIT;
