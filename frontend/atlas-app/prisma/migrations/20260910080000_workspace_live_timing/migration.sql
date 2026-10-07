BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;

-- A private, read-only projection of existing durable records. No provider
-- message, image payload, private path or account secret crosses this boundary.
CREATE FUNCTION atlas_staff.workspace_timing_history(workspace_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
WITH runs AS MATERIALIZED (
  SELECT r.* FROM atlas_staff."StaffOperatorRun" r WHERE r."workspaceCardId"=workspace_id
), operations AS MATERIALIZED (
  SELECT o.id,o."createdAt",o.action,o.canonical::jsonb->'result' AS result
  FROM atlas_staff."StaffWorkspaceOperation" o WHERE o."cardId"=workspace_id
), events AS (
  SELECT "createdAt" AS at,0 AS ordering,id::text AS tie,
    jsonb_build_object('kind','STAGE','stage',CASE WHEN result#>>'{claim,kind}'='ASTRA' THEN 'PHOTOS' ELSE 'IDENTITY' END,'active',true) AS body
  FROM operations WHERE action='claim'
  UNION ALL
  SELECT s."createdAt",1,s.id::text,jsonb_build_object('kind','STAGE','stage',
    CASE s."toolName" WHEN 'read_original_photos' THEN 'IDENTITY' WHEN 'propose_capture_identity' THEN 'PREPARATION'
      WHEN 'propose_physical_boundary' THEN 'PREPARATION' WHEN 'submit_capture_preparation' THEN 'PREPARATION'
      WHEN 'read_card_report' THEN 'INSPECTION' WHEN 'inspect_card_geometry' THEN 'CENTERING' WHEN 'measure_centering' THEN 'INSPECTION'
      WHEN 'inspect_finding' THEN 'INSPECTION' WHEN 'propose_finding_change' THEN 'INSPECTION'
      WHEN 'propose_identity' THEN 'IDENTITY' WHEN 'submit_for_human_review' THEN 'REVIEW'
      ELSE CASE WHEN r.phase='CAPTURE_REVIEW' THEN 'IDENTITY' ELSE 'INSPECTION' END END,
    'active',s."toolName"<>'submit_for_human_review',
    'reason',CASE WHEN s."toolName"='submit_for_human_review' THEN
      CASE WHEN s."requestCanonical"::jsonb->>'disposition'='READY_FOR_REVIEW' THEN 'HUMAN_REVIEW' ELSE 'NEEDS_ATTENTION' END ELSE NULL END)
  FROM runs r JOIN atlas_staff."StaffOperatorStep" s ON s."runId"=r.id
  UNION ALL
  SELECT s."createdAt",2,s.id::text||'-step-pause',jsonb_build_object('kind','PAUSE','reason','PAUSED')
  FROM runs r JOIN atlas_staff."StaffOperatorStep" s ON s."runId"=r.id
  WHERE s."toolName" NOT IN ('submit_for_human_review','submit_capture_preparation') AND
    (SELECT CASE WHEN o.action='claim' THEN o.result#>>'{claim,mode}' ELSE o.result#>>'{control,mode}' END
     FROM operations o WHERE o."createdAt"<=s."createdAt" AND
       (o.action='claim' AND o.result#>>'{claim,runId}'=r.id::text OR o.action='OPERATOR_CONTROL'
        AND o.result->>'runId'=r.id::text AND o.result->>'action' IN ('RESUME','STEP','RECOVER'))
     ORDER BY o."createdAt" DESC,o.id DESC LIMIT 1)='STEP'
  UNION ALL
  -- Attribute the final report request to Report once its outcome is recorded.
  SELECT a."createdAt",0,s.id::text||'-report',jsonb_build_object('kind','STAGE','stage','REPORT','active',true)
  FROM runs r JOIN atlas_staff."StaffOperatorStep" s ON s."runId"=r.id
    JOIN atlas_staff."StaffOperatorAttempt" a ON a.id=s."attemptId"
  WHERE s."toolName"='submit_for_human_review'
  UNION ALL
  SELECT CASE WHEN o.result->>'action'='PAUSE' AND o.result#>>'{control,state}'='PAUSE_REQUESTED'
      THEN settled.at ELSE o."createdAt" END,2,o.id::text,
    jsonb_build_object('kind',CASE WHEN o.result->>'action'='PAUSE' THEN 'PAUSE' ELSE 'RESUME' END,
      'reason',CASE WHEN o.result->>'action'='PAUSE' THEN 'PAUSED' ELSE NULL END)
  FROM operations o LEFT JOIN LATERAL (
    SELECT min(s."createdAt") AS at FROM atlas_staff."StaffOperatorStep" s
    WHERE s."runId"::text=o.result->>'runId' AND s."createdAt">=o."createdAt"
      AND NOT EXISTS(SELECT 1 FROM operations newer WHERE newer.action='OPERATOR_CONTROL'
        AND newer.result->>'runId'=o.result->>'runId' AND newer.result->>'action' IN ('RESUME','STEP','RECOVER')
        AND newer."createdAt">o."createdAt" AND newer."createdAt"<s."createdAt")
  ) settled ON true
  WHERE o.action='OPERATOR_CONTROL' AND o.result->>'action' IN ('PAUSE','RESUME','STEP','RECOVER')
    AND (o.result->>'action'<>'PAUSE' OR o.result#>>'{control,state}'<>'PAUSE_REQUESTED' OR settled.at IS NOT NULL)
  UNION ALL
  SELECT "createdAt",2,id::text,jsonb_build_object('kind','STAGE','stage','REVIEW','active',result->>'action'='START',
    'reason',CASE WHEN result->>'action'='START' THEN NULL ELSE 'PAUSED' END)
  FROM operations WHERE action='REVIEW_SESSION' AND result->>'action' IN ('START','PAUSE')
  UNION ALL
  SELECT "createdAt",1,id::text,jsonb_build_object('kind','STAGE','stage',
    CASE WHEN result->>'action' IN ('INITIALIZE_REPORT','RESOLVE_MAP','REGISTER_MAP','CONTINUE_WITHOUT_MAP') THEN 'INSPECTION'
      WHEN result->>'action'='SAVE_CENTERING' THEN 'CENTERING' WHEN result->>'action'='SAVE_IDENTITY' THEN 'IDENTITY'
      ELSE 'PREPARATION' END,'active',true)
  FROM operations WHERE action IN ('MANUAL_ACTION','MACHINE_SOURCE_ACTION')
  UNION ALL
  SELECT "createdAt",1,id::text,jsonb_build_object('kind','STAGE','stage','INSPECTION','active',true)
  FROM operations WHERE action='MACHINE_REPORT_SUCCESSOR'
  UNION ALL
  SELECT r."updatedAt",9,r.id::text,jsonb_build_object('kind','PAUSE','reason',
    CASE WHEN r.state='READY_FOR_HUMAN' THEN 'HUMAN_REVIEW'
      WHEN r.state IN ('UNKNOWN','FAILED','NEEDS_EXPERT','NEEDS_RECAPTURE') THEN 'NEEDS_ATTENTION' ELSE 'PAUSED' END)
  FROM runs r WHERE r.state IN ('UNKNOWN','FAILED','NEEDS_EXPERT','NEEDS_RECAPTURE','READY_FOR_HUMAN') OR r."controlState"='PAUSED'
  UNION ALL
  SELECT a."approvedAt",10,a.id::text,jsonb_build_object('kind','STAGE','stage','FINISHING','active',false,'reason','COMPLETED')
  FROM atlas_staff."StaffWorkspaceCard" w JOIN atlas_staff."StaffPublicReport" p ON p."specimenId"=w."specimenId"
    JOIN atlas_staff."StaffReportApproval" a ON a.id=p."currentApprovalId" WHERE w.id=workspace_id
), bounded AS (
  SELECT * FROM events ORDER BY at,ordering,tie LIMIT 1025
)
SELECT jsonb_build_object('asOf',clock_timestamp(),'events',coalesce(jsonb_agg(body||jsonb_build_object('at',at AT TIME ZONE 'UTC','order',ordering) ORDER BY at,ordering,tie),'[]'::jsonb)) FROM bounded;
$$;
REVOKE ALL ON FUNCTION atlas_staff.workspace_timing_history(uuid) FROM PUBLIC;

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
    'timingHistory',atlas_staff.workspace_timing_history(workspace_id),'pending',0,'settled',true,'canPause',false,'canResume',false,'canStep',false,'canTakeOver',false); END IF;
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
  RETURN jsonb_build_object('runId',r.id,'runState',r.state,'state',displayed,'mode',r."executionMode",
    'failureCode',r."failureCode",'lastUpdatedAt',r."updatedAt" AT TIME ZONE 'UTC','leaseExpiresAt',r."leaseExpiresAt" AT TIME ZONE 'UTC','timingHistory',atlas_staff.workspace_timing_history(workspace_id),
    'controlRevision',r."controlRevision",'stepBudget',r."stepBudget",'pending',pending,'settled',NOT held,
    'canPause',active AND r."controlState"='RUNNING','canResume',active AND r."controlState"='PAUSED' AND pending=0 AND NOT held,
    'canStep',active AND r."controlState"='PAUSED' AND pending=0 AND NOT held,
    'canTakeOver',active AND r."controlState"<>'TAKEN_OVER' AND NOT held);
END $$;

COMMIT;
