BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;

-- Read-only admission projection through the existing staff control RPC.
-- No roster, private control, run or provider body is returned to the client.
-- The existing enqueue and dispatch functions retain all authoritative checks.
CREATE FUNCTION atlas_staff.workspace_capture_readiness(workspace_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE w atlas_staff."StaffWorkspaceCard"%ROWTYPE; c atlas_staff."StaffWorkspaceControl"%ROWTYPE;
  staff atlas_staff."StaffControl"%ROWTYPE; b atlas_staff."StaffGradingBridgeControl"%ROWTYPE;
  op atlas_staff."StaffOperatorControl"%ROWTYPE; policy jsonb; budget jsonb; n jsonb;
  unavailable jsonb:=jsonb_build_object('ready',false,'code','WORKSPACE_ASTRA_NOT_READY');
BEGIN
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=workspace_id;
  SELECT * INTO c FROM atlas_staff."StaffWorkspaceControl" WHERE id='active';
  SELECT * INTO staff FROM atlas_staff."StaffControl" WHERE id='active';
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active';
  SELECT * INTO op FROM atlas_staff."StaffOperatorControl" WHERE id='active';
  n:=w.canonical::jsonb;policy:=op."policyCanonical"::jsonb;budget:=b."policyCanonical"::jsonb;
  IF (w.id IS NOT NULL AND c."cohortId"=w."cohortId" AND w.state='WAITING' AND n->'claim'='null'::jsonb
    AND w."specimenId" IS NULL AND budget->>'version'='atlas-workspace-bridge-policy-v1') IS NOT TRUE THEN RETURN unavailable; END IF;
  IF (budget->'workspaceCardIds' ? w.id::text) IS NOT TRUE THEN
    RETURN jsonb_build_object('ready',false,'code','WORKSPACE_ASTRA_NOT_ADMITTED'); END IF;
  IF (staff.enabled AND c.enabled AND c."claimsEnabled" AND c."astraEnabled" AND op.enabled AND b.enabled
    AND staff.mode=c.mode AND b.mode=c.mode AND op.mode=c.mode AND c."releaseSha"=staff."releaseSha"
    AND staff."gradingPolicyHash"=b."gradingPolicyHash"
    AND c."expiresAt">clock_timestamp() AT TIME ZONE 'UTC'
    AND atlas_staff.workspace_photos_verified(w.id) AND atlas_staff.workspace_identity_ready(w.id)
    AND budget->>'pilotId'=policy->>'pilotId'
    AND atlas_staff.operator_workspace_count((policy->>'pilotId')::uuid)=jsonb_array_length(budget->'workspaceCardIds')
    AND (policy->>'expiresAt')::timestamptz>clock_timestamp() AND (budget->>'expiresAt')::timestamptz>clock_timestamp()
    AND policy->'astra'->>'model'='gpt-6-astra' AND policy->'astra'->>'returnedModel'='gpt-6-astra'
    AND policy->'captureTools' @> '["read_original_photos","propose_capture_identity","propose_physical_boundary","submit_capture_preparation"]'::jsonb
    AND (n->>'startedAt' IS NOT NULL OR (SELECT count(*) FROM atlas_staff."StaffWorkspaceCard"
      WHERE "cohortId"=c."cohortId" AND canonical::jsonb->>'startedAt' IS NOT NULL)<c."processingLimit")
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceCard" other WHERE other.id<>w.id AND other."cohortId"=c."cohortId"
      AND other.state IN ('IN_PROGRESS','NEEDS_ATTENTION') AND other.canonical::jsonb#>>'{claim,kind}'='ASTRA')) IS NOT TRUE THEN RETURN unavailable; END IF;
  RETURN jsonb_build_object('ready',true,'code',NULL);
EXCEPTION WHEN OTHERS THEN RETURN unavailable;
END $$;
REVOKE ALL ON FUNCTION atlas_staff.workspace_capture_readiness(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION atlas_staff.read_workspace_operator_control(workspace_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE w atlas_staff."StaffWorkspaceCard"%ROWTYPE; r atlas_staff."StaffOperatorRun"%ROWTYPE;
  pending integer:=0; held boolean:=false; active boolean; displayed text; awaiting_projection boolean:=false; candidate jsonb; unconfirmed jsonb;
BEGIN
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=workspace_id;
  IF FOUND THEN
    SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE "workspaceCardId"=w.id OR "specimenId"=w."specimenId" ORDER BY "createdAt" DESC,id DESC LIMIT 1;
  END IF;
  IF r.id IS NULL THEN RETURN jsonb_build_object('runId',NULL,'state','UNAVAILABLE','mode','CONTINUOUS',
    'captureReadiness',atlas_staff.workspace_capture_readiness(workspace_id),'timingHistory',atlas_staff.workspace_timing_history(workspace_id),'pending',0,'settled',true,'canPause',false,'canResume',false,'canStep',false,'canTakeOver',false,'canRecover',false,'canAbandon',false,'attemptRecovery',NULL,'unconfirmedCost',jsonb_build_object('attempts',0,'reservedMicroUsd','0'),'extraTimingEvents','[]'::jsonb); END IF;
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
  displayed:=CASE WHEN r."controlState"='TAKEN_OVER' THEN 'TAKEN_OVER' WHEN r.state IN ('UNKNOWN','FAILED','NEEDS_RECAPTURE','NEEDS_EXPERT') THEN 'NEEDS_ATTENTION' WHEN r.state='READY_FOR_HUMAN' THEN 'WAITING_REVIEW' WHEN NOT active THEN 'COMPLETED'
    WHEN r."controlState"='RUNNING' AND r.state='QUEUED' THEN 'QUEUED' ELSE r."controlState" END;
  candidate:=atlas_staff.operator_abandonable_attempt(r.id);
  SELECT jsonb_build_object('attempts',count(*)::integer,'reservedMicroUsd',coalesce(sum(a."reservedMicroUsd"),0)::text)
    INTO unconfirmed FROM atlas_staff."StaffOperatorAttempt" a JOIN atlas_staff."StaffOperatorRun" history ON history.id=a."runId"
    WHERE history."workspaceCardId"=workspace_id AND a.state='ABANDONED' AND a."actualMicroUsd" IS NULL AND a."usageCeilingMicroUsd" IS NULL;
  RETURN jsonb_build_object('runId',r.id,'runState',r.state,'state',displayed,'mode',r."executionMode",
    'failureCode',r."failureCode",'lastUpdatedAt',r."updatedAt" AT TIME ZONE 'UTC','leaseExpiresAt',r."leaseExpiresAt" AT TIME ZONE 'UTC','timingHistory',atlas_staff.workspace_timing_history(workspace_id),
    'canRecover',atlas_staff.operator_recoverable_attempt(r.id) IS NOT NULL,
    'canAbandon',candidate IS NOT NULL,'attemptRecovery',candidate,'unconfirmedCost',unconfirmed,
    'extraTimingEvents',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind','PAUSE','at',g.canonical::jsonb->'oldUpdatedAt',
      'reason','NEEDS_ATTENTION','order',9) ORDER BY g."createdAt",g.ordinal),'[]'::jsonb)
      FROM atlas_staff."StaffOperatorRecovery" g JOIN atlas_staff."StaffOperatorRun" history ON history.id=g."runId"
      WHERE history."workspaceCardId"=workspace_id)
      ||(SELECT coalesce(jsonb_agg(jsonb_build_object('kind','PAUSE','at',g.canonical::jsonb->'oldUpdatedAt',
        'reason','NEEDS_ATTENTION','order',9) ORDER BY g."createdAt",g.id),'[]'::jsonb)
        FROM atlas_staff."StaffOperatorAttemptAbandonment" g JOIN atlas_staff."StaffOperatorRun" history ON history.id=g."runId"
        WHERE history."workspaceCardId"=workspace_id),
    'controlRevision',r."controlRevision",'stepBudget',r."stepBudget",'pending',pending,'settled',NOT held,
    'canPause',active AND r."controlState"='RUNNING','canResume',active AND r."controlState"='PAUSED' AND pending=0 AND NOT held,
    'canStep',active AND r."controlState"='PAUSED' AND pending=0 AND NOT held,
    'canTakeOver',active AND r."controlState"<>'TAKEN_OVER' AND NOT held);
END $$;

COMMIT;
