BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;

-- A human may authorize one bounded application of a known saved response.
-- Dispatch requests, paid reservations, provider receipts and their old fences
-- remain immutable. There is no retry of an uncertain provider POST.
CREATE TABLE "StaffOperatorRecovery" (
  id uuid PRIMARY KEY,
  "runId" uuid NOT NULL REFERENCES "StaffOperatorRun"(id) ON DELETE RESTRICT,
  "attemptId" uuid NOT NULL REFERENCES "StaffOperatorAttempt"(id) ON DELETE RESTRICT,
  "receiptId" uuid NOT NULL REFERENCES "StaffOperatorReceipt"(id) ON DELETE RESTRICT,
  "commandId" uuid NOT NULL UNIQUE REFERENCES "StaffWorkspaceOperation"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 3),
  "runRevision" integer NOT NULL CHECK("runRevision">0),
  "leaseFence" integer NOT NULL CHECK("leaseFence">0),
  canonical text NOT NULL, hash varchar(64) NOT NULL,
  "createdAt" timestamp(3) NOT NULL,
  UNIQUE("runId",ordinal), UNIQUE("runId","leaseFence"),
  CHECK ((octet_length(canonical)<=16384 AND canonical::jsonb->>'version'='atlas-operator-recovery-v1'
    AND canonical::jsonb->>'id'=id::text AND canonical::jsonb->>'runId'="runId"::text
    AND canonical::jsonb->>'attemptId'="attemptId"::text AND canonical::jsonb->>'receiptId'="receiptId"::text
    AND canonical::jsonb->>'commandId'="commandId"::text AND canonical::jsonb->>'ordinal'=ordinal::text
    AND canonical::jsonb->>'runRevision'="runRevision"::text AND canonical::jsonb->>'leaseFence'="leaseFence"::text
    AND hash=encode(sha256(convert_to(canonical,'UTF8')),'hex')) IS TRUE)
);
CREATE TRIGGER "StaffOperatorRecovery_no_update" BEFORE UPDATE ON "StaffOperatorRecovery"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffOperatorRecovery_no_delete" BEFORE DELETE ON "StaffOperatorRecovery"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffOperatorRecovery_no_truncate" BEFORE TRUNCATE ON "StaffOperatorRecovery"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();
REVOKE ALL ON "StaffOperatorRecovery" FROM PUBLIC;

-- Shared exact proof used by deferred step guards and the private image port.
-- A recovery does not make any other attempt's old dispatch fence current.
CREATE FUNCTION atlas_staff.operator_attempt_fence_matches(run_id uuid,attempt_id uuid,lease_fence integer) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT (a."runId"=r.id AND r."leaseFence"=lease_fence AND
    (a."leaseFence"=lease_fence OR EXISTS(
      SELECT 1 FROM atlas_staff."StaffOperatorRecovery" g
      JOIN atlas_staff."StaffOperatorReceipt" receipt ON receipt.id=g."receiptId"
      WHERE g."runId"=r.id AND g."attemptId"=a.id AND g."leaseFence"=lease_fence
        AND g."runRevision"=a."runRevision" AND r.revision IN (a."runRevision",a."runRevision"+1)
        AND g.canonical::jsonb->>'attemptLeaseFence'=a."leaseFence"::text
        AND g.canonical::jsonb->>'requestHash'=a."requestHash"
        AND g.canonical::jsonb->>'receiptHash'=receipt.hash AND receipt."attemptId"=a.id AND a."resultReceiptId"=receipt.id
        AND g.canonical::jsonb->>'providerBindingHash'=a."providerBindingHash"
        AND g.canonical::jsonb->>'newRuntimeHash'=r."runtimeHash"
        AND g.canonical::jsonb->>'policyHash'=r."policyHash" AND g.canonical::jsonb->>'evidenceHash'=r."evidenceHash"
        AND g.canonical::jsonb->>'manifestHash'=r."manifestHash"
        AND g.canonical::jsonb->>'gradingPolicyHash'=r."gradingPolicyHash"
        AND (g.canonical::jsonb->>'newDeadlineAt')::timestamptz=r."deadlineAt" AT TIME ZONE 'UTC'
        AND (SELECT count(*) FROM atlas_staff."StaffOperatorReceipt" x WHERE x."attemptId"=a.id)=1))) IS TRUE
  FROM atlas_staff."StaffOperatorRun" r JOIN atlas_staff."StaffOperatorAttempt" a ON a.id=attempt_id WHERE r.id=run_id;
$$;
REVOKE ALL ON FUNCTION atlas_staff.operator_attempt_fence_matches(uuid,uuid,integer) FROM PUBLIC;

CREATE FUNCTION atlas_staff.operator_recoverable_attempt(run_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperatorRun"%ROWTYPE; w atlas_staff."StaffWorkspaceCard"%ROWTYPE;
  c atlas_staff."StaffOperatorControl"%ROWTYPE; b atlas_staff."StaffGradingBridgeControl"%ROWTYPE;
  sc atlas_staff."StaffControl"%ROWTYPE; wc atlas_staff."StaffWorkspaceControl"%ROWTYPE;
  i atlas_staff."StaffIdentity"%ROWTYPE; a atlas_staff."StaffOperatorAttempt"%ROWTYPE;
  receipt atlas_staff."StaffOperatorReceipt"%ROWTYPE; value jsonb; call jsonb; args jsonb; usage record;
BEGIN
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=run_id;
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=r."workspaceCardId";
  SELECT * INTO c FROM atlas_staff."StaffOperatorControl" WHERE id='active';
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active';
  SELECT * INTO sc FROM atlas_staff."StaffControl" WHERE id='active';
  SELECT * INTO wc FROM atlas_staff."StaffWorkspaceControl" WHERE id='active';
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=(w.canonical::jsonb#>>'{claim,actorId}')::uuid;
  IF (r.state IN ('UNKNOWN','WAITING_TOOL') AND r."controlState"<>'TAKEN_OVER'
    AND (r."leaseOwner" IS NULL OR r."leaseExpiresAt"<=clock_timestamp() AT TIME ZONE 'UTC')
    AND c.enabled AND b.enabled AND sc.enabled AND wc.enabled AND wc."astraEnabled" AND wc."claimsEnabled" AND wc."preparationEnabled"
    AND c.mode=b.mode AND c.mode=sc.mode AND c.mode=wc.mode AND c."releaseSha"=sc."releaseSha" AND c."releaseSha"=wc."releaseSha"
    AND r."policyHash"=c."policyHash" AND r."policyCanonical"=c."policyCanonical"
    AND r."gradingPolicyHash"=b."gradingPolicyHash" AND r."gradingPolicyHash"=sc."gradingPolicyHash"
    AND r."pilotId"::text=c."policyCanonical"::jsonb->>'pilotId' AND r."pilotId"::text=b."policyCanonical"::jsonb->>'pilotId'
    AND b."policyCanonical"::jsonb->>'version'='atlas-workspace-bridge-policy-v1'
    AND b."policyCanonical"::jsonb->'workspaceCardIds' ? w.id::text
    AND (c."policyCanonical"::jsonb->>'expiresAt')::timestamptz>clock_timestamp()
    AND (b."policyCanonical"::jsonb->>'expiresAt')::timestamptz>clock_timestamp() AND wc."expiresAt">clock_timestamp() AT TIME ZONE 'UTC'
    AND w."cohortId"=wc."cohortId" AND w.state IN ('IN_PROGRESS','NEEDS_ATTENTION')
    AND w.canonical::jsonb#>>'{claim,kind}'='ASTRA' AND w.canonical::jsonb#>>'{claim,runId}'=r.id::text
    AND w.canonical::jsonb#>>'{claim,fence}'=w.canonical::jsonb->>'claimFence'
    AND w.canonical::jsonb#>>'{claim,captureHash}'=w.canonical::jsonb->>'captureHash'
    AND w.canonical::jsonb#>>'{claim,captureRevision}'=w.canonical::jsonb->>'captureRevision'
    AND w.canonical::jsonb#>'{workspace,pending}' IS NULL
    AND i.role='REVIEWER' AND i."revokedAt" IS NULL AND w.canonical::jsonb#>>'{claim,accessVersion}'=i."accessVersion"::text
    AND (SELECT count(*) FROM atlas_staff."StaffOperatorRecovery" WHERE "runId"=r.id)<3
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorRecovery" g WHERE g."runId"=r.id
      AND g."leaseFence"=r."leaseFence"+1 AND g.canonical::jsonb->>'controlRevision'=r."controlRevision"::text)
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorRun" other WHERE other."pilotId"=r."pilotId" AND other.id<>r.id
      AND other."leaseOwner" IS NOT NULL AND other."leaseExpiresAt">clock_timestamp() AT TIME ZONE 'UTC')
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit" p WHERE p."runId"=r.id AND p.state IN ('ACTIVE','UNKNOWN'))
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceOperation" o WHERE o."runId"=r.id AND o.state IN ('RESERVED','DISPATCHED','UNKNOWN'))
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffMachineInitialization" j WHERE j."specimenId"=w.id AND j.state NOT IN ('SUCCEEDED','FAILED'))
    AND (SELECT count(*) FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=r.id AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN'))=1
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=r.id AND "providerBindingHash"<>c."providerBindingHash")) IS NOT TRUE THEN RETURN NULL; END IF;
  IF r.phase='CAPTURE_REVIEW' THEN
    IF NOT atlas_staff.operator_capture_current(r.id) OR EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceOperation" WHERE "runId"=r.id)
      OR EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit" WHERE "runId"=r.id)
      OR r."initializationId" IS NOT NULL THEN RETURN NULL; END IF;
  ELSIF r.phase='REPORT_REVIEW' THEN
    IF r."runtimeHash"<>c."configHash" OR NOT atlas_staff.operator_source_current(r.id)
      OR EXISTS(SELECT 1 FROM atlas_staff."StaffGradingOperation" WHERE "specimenId"=r."specimenId" AND state IN ('RESERVED','DISPATCHED','UNKNOWN')) THEN RETURN NULL; END IF;
    -- Match the dispatcher's retained successor proof. A report recovery does
    -- not rebind an older capture/initialization to another runtime release.
    IF NOT EXISTS(SELECT 1 FROM atlas_staff."StaffMachineInitialization" j
      JOIN atlas_staff."StaffOperatorRun" prior ON prior.id=r."captureRunId"
      JOIN atlas_staff."StaffWorkspaceSourceAdmission" admission ON admission."requestId"=j.id
      JOIN atlas_staff."StaffWorkspaceSourceActionPermit" permit ON permit."requestId"=j.id
      JOIN atlas_staff."StaffWorkspaceSourceOperation" source ON source."requestId"=j.id AND source.purpose='INITIALIZE_REPORT' AND source.side='PAIR'
      JOIN atlas_staff."StaffSpecimen" specimen ON specimen.id=r."specimenId"
      JOIN atlas_staff."StaffWorkspaceOperation" event ON event."actorId"=i.id AND event."operationId"='machine-report-'||j.id::text
      WHERE j.id=r."initializationId" AND j.state='SUCCEEDED' AND j."admissionKind"='WORKSPACE_CAPTURE' AND j."workspaceSourceRequestId"=j.id
        AND j."specimenId"=w.id AND w."specimenId"=w.id AND j."runtimeHash"=r."runtimeHash" AND j."pilotId"=r."pilotId"
        AND j."evidenceHash"=r."evidenceHash" AND j."admittedById"=i.id AND j."admittedAccessVersion"=i."accessVersion"
        AND admission."actorKind"='MACHINE' AND admission."sessionHash" IS NULL AND admission."cardId"=w.id AND admission."specimenId"=w.id
        AND admission."evidenceHash"=j."evidenceHash" AND admission."admissionHash"=j."authorizationEvidenceHash"
        AND admission."actorId"=i.id AND admission."accessVersion"=i."accessVersion"
        AND admission."admissionHash"=encode(sha256(convert_to(admission."admissionCanonical",'UTF8')),'hex')
        AND permit.state='SUCCEEDED' AND permit."cardId"=w.id AND permit."runId"=prior.id AND permit."runRevision"=prior.revision
        AND permit."claimFence"::text=w.canonical::jsonb->>'claimFence' AND permit."captureHash"=w.canonical::jsonb->>'captureHash'
        AND source.state='SUCCEEDED' AND source."cardId"=w.id AND source."runId"=prior.id AND source."gradingExecutionId"=j."gradingOperationId"
        AND source."resultHash"=encode(sha256(convert_to(source."resultCanonical",'UTF8')),'hex')
        AND prior.phase='CAPTURE_REVIEW' AND prior.state='PREPARATION_READY' AND prior."workspaceCardId"=w.id
        AND prior."runtimeHash"=r."runtimeHash" AND prior."pilotId"=r."pilotId" AND prior."policyHash"=r."policyHash"
        AND prior."gradingPolicyHash"=r."gradingPolicyHash" AND prior."evidenceHash"=w.canonical::jsonb->>'captureHash'
        AND specimen."evidenceHash"=r."evidenceHash" AND specimen."analysisRevision"=r."expectedAnalysisRevision"
        AND specimen."draftRevision"=r."expectedReviewRevision"
        AND event.action='MACHINE_REPORT_SUCCESSOR' AND event."cardId"=w.id
        AND event.canonical::jsonb#>>'{result,actor}'='MACHINE' AND event.canonical::jsonb#>>'{result,sourceRequestId}'=j.id::text
        AND event.canonical::jsonb#>>'{result,captureRunId}'=prior.id::text AND event.canonical::jsonb#>>'{result,reportRunId}'=r.id::text
        AND event.canonical::jsonb#>>'{result,claimFence}'=w.canonical::jsonb->>'claimFence'
        AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" x WHERE x."runId"=prior.id AND x.state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN'))
        AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit" x WHERE x."runId"=prior.id AND x.state IN ('ACTIVE','UNKNOWN'))
        AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceOperation" x WHERE x."runId"=prior.id AND x.state IN ('RESERVED','DISPATCHED','UNKNOWN')))
      THEN RETURN NULL; END IF;
  ELSE RETURN NULL; END IF;
  SELECT * INTO usage FROM atlas_staff.workspace_pilot_budget_usage(r."pilotId",w.id);
  IF usage.overrun OR usage.total::numeric>(b."policyCanonical"::jsonb->>'maxTotalMicroUsd')::numeric
    OR usage.card::numeric>(b."policyCanonical"::jsonb->>'maxCardMicroUsd')::numeric THEN RETURN NULL; END IF;
  SELECT * INTO a FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=r.id AND state='RECEIVED';
  SELECT * INTO receipt FROM atlas_staff."StaffOperatorReceipt" WHERE id=a."resultReceiptId";
  value:=receipt.canonical::jsonb;
  IF (a.id IS NOT NULL AND a."runRevision"=r.revision AND a."dispatchedAt" IS NOT NULL
    AND a."usageCeilingMicroUsd" IS NOT NULL AND NOT a."usageEnvelopeExceeded"
    AND a."providerBindingHash"=c."providerBindingHash" AND receipt."attemptId"=a.id
    AND receipt.hash=encode(sha256(convert_to(receipt.canonical,'UTF8')),'hex')
    AND value->>'attemptId'=a.id::text AND value->>'state'='RECEIVED' AND value->>'httpStatus'='200'
    AND value->'body'->>'status'='completed' AND value->'body'->>'model'=c."policyCanonical"::jsonb#>>'{astra,returnedModel}'
    AND value->'body'->>'service_tier'='default'
    -- bodyHash identifies the original wire bytes, including provider JSON
    -- ordering/whitespace. The immutable receipt hash binds the saved parsed
    -- body; reserializing it cannot reproduce the transport byte hash.
    AND value->>'bodyHash' ~ '^[a-f0-9]{64}$'
    AND a."requestHash"=encode(sha256(convert_to(a."requestCanonical",'UTF8')),'hex')
    AND (SELECT count(*) FROM atlas_staff."StaffOperatorReceipt" WHERE "attemptId"=a.id)=1
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorStep" WHERE "attemptId"=a.id)
    AND (SELECT count(*) FROM jsonb_array_elements(value->'body'->'output') x WHERE x->>'type'='function_call')=1) IS NOT TRUE THEN RETURN NULL; END IF;
  SELECT x INTO call FROM jsonb_array_elements(value->'body'->'output') x WHERE x->>'type'='function_call';
  args:=(call->>'arguments')::jsonb;
  IF (call->>'call_id' ~ '^[A-Za-z0-9_-]{1,160}$'
    AND (c."policyCanonical"::jsonb->(CASE WHEN r.phase='CAPTURE_REVIEW' THEN 'captureTools' ELSE 'tools' END)) ? (call->>'name')
    AND args->>'runId'=r.id::text AND args->>'expectedRevision'=r.revision::text
    AND args->>'evidenceHash'=r."evidenceHash" AND args->>'manifestHash'=r."manifestHash"
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorStep" WHERE "runId"=r.id AND "callId"=call->>'call_id')) IS NOT TRUE THEN RETURN NULL; END IF;
  RETURN a.id;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION atlas_staff.operator_recoverable_attempt(uuid) FROM PUBLIC;

CREATE FUNCTION atlas_staff.recover_workspace_operator(workspace_id uuid,claim_fence integer,actor_id uuid,
  session_hash text,expected_revision integer,command_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE w atlas_staff."StaffWorkspaceCard"%ROWTYPE; r atlas_staff."StaffOperatorRun"%ROWTYPE;
  sc atlas_staff."StaffControl"%ROWTYPE; i atlas_staff."StaffIdentity"%ROWTYPE;
  se atlas_staff."StaffSession"%ROWTYPE; browser atlas_staff."StaffBrowser"%ROWTYPE;
  c atlas_staff."StaffOperatorControl"%ROWTYPE; b atlas_staff."StaffGradingBridgeControl"%ROWTYPE;
  a atlas_staff."StaffOperatorAttempt"%ROWTYPE; receipt atlas_staff."StaffOperatorReceipt"%ROWTYPE;
  recovery_id uuid:=gen_random_uuid(); attempt_id uuid; recovered_claim jsonb; grant_value jsonb; grant_text text;
  at_time timestamp(3):=clock_timestamp() AT TIME ZONE 'UTC'; new_deadline timestamp(3); episode integer; response jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  PERFORM atlas_staff.lock_workspace_private_controls();
  SELECT * INTO sc FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  SELECT * INTO c FROM atlas_staff."StaffOperatorControl" WHERE id='active' FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=actor_id FOR SHARE;
  SELECT * INTO se FROM atlas_staff."StaffSession" WHERE "tokenHash"=session_hash FOR SHARE;
  SELECT * INTO browser FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=se."browserHash" FOR SHARE;
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=workspace_id FOR UPDATE;
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=(w.canonical::jsonb#>>'{claim,runId}')::uuid FOR UPDATE;
  IF (sc.enabled AND i.role='REVIEWER' AND i."revokedAt" IS NULL AND se."identityId"=i.id AND se."revokedAt" IS NULL
    AND se."accessVersion"=i."accessVersion" AND se."controlRevision"=sc.revision AND se."expiresAt">at_time
    AND browser."controlRevision"=sc.revision AND browser."expiresAt">at_time
    AND w.revision=expected_revision AND w.canonical::jsonb->>'claimFence'=claim_fence::text
    AND w.canonical::jsonb#>>'{claim,actorId}'=i.id::text AND w.canonical::jsonb#>>'{claim,accessVersion}'=i."accessVersion"::text
    AND r."workspaceCardId"=w.id AND command_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceOperation" WHERE id=command_id)) IS NOT TRUE THEN
    RAISE EXCEPTION 'ASTRA_RECOVERY_AUTHORITY_REQUIRED'; END IF;
  attempt_id:=atlas_staff.operator_recoverable_attempt(r.id);
  IF attempt_id IS NULL THEN RAISE EXCEPTION 'ASTRA_RECOVERY_NOT_AVAILABLE'; END IF;
  SELECT * INTO a FROM atlas_staff."StaffOperatorAttempt" WHERE id=attempt_id FOR UPDATE;
  SELECT * INTO receipt FROM atlas_staff."StaffOperatorReceipt" WHERE id=a."resultReceiptId" FOR SHARE;
  SELECT count(*)::integer+1 INTO episode FROM atlas_staff."StaffOperatorRecovery" WHERE "runId"=r.id;
  new_deadline:=CASE WHEN r."deadlineAt">at_time THEN r."deadlineAt" ELSE LEAST(
    at_time+LEAST(3600000,(c."policyCanonical"::jsonb->>'maxRunMs')::integer)*interval '1 millisecond',
    (c."policyCanonical"::jsonb->>'expiresAt')::timestamptz AT TIME ZONE 'UTC',
    (b."policyCanonical"::jsonb->>'expiresAt')::timestamptz AT TIME ZONE 'UTC') END;
  recovered_claim:=(w.canonical::jsonb->'claim')||jsonb_build_object('controlRevision',sc.revision,'mode','CONTINUOUS');
  grant_value:=jsonb_build_object('version','atlas-operator-recovery-v1','id',recovery_id,'runId',r.id,'workspaceId',w.id,
    'commandId',command_id,'actorId',actor_id,'ordinal',episode,'runRevision',r.revision,'controlRevision',r."controlRevision"+1,
    'leaseFence',r."leaseFence"+1,'oldLeaseFence',r."leaseFence",'attemptLeaseFence',a."leaseFence",
    'attemptId',a.id,'requestHash',a."requestHash",'receiptId',receipt.id,'receiptHash',receipt.hash,
    'providerBindingHash',a."providerBindingHash",'policyHash',r."policyHash",'gradingPolicyHash',r."gradingPolicyHash",
    'evidenceHash',r."evidenceHash",'manifestHash',r."manifestHash",'inputHash',r."inputHash",
    'oldRuntimeHash',r."runtimeHash",'newRuntimeHash',c."configHash",'oldDeadlineAt',r."deadlineAt" AT TIME ZONE 'UTC',
    'newDeadlineAt',new_deadline AT TIME ZONE 'UTC','oldUpdatedAt',r."updatedAt" AT TIME ZONE 'UTC',
    'workspaceRevision',w.revision,'originalClaim',w.canonical::jsonb->'claim','recoveredClaim',recovered_claim,'createdAt',at_time AT TIME ZONE 'UTC');
  grant_text:=atlas_staff.workspace_manifest_canonical(grant_value);
  INSERT INTO atlas_staff."StaffOperatorRecovery"(id,"runId","attemptId","receiptId","commandId",ordinal,"runRevision","leaseFence",canonical,hash,"createdAt")
    VALUES(recovery_id,r.id,a.id,receipt.id,command_id,episode,r.revision,r."leaseFence"+1,grant_text,
      encode(sha256(convert_to(grant_text,'UTF8')),'hex'),at_time);
  UPDATE atlas_staff."StaffOperatorRun" SET state='WAITING_TOOL',"runtimeHash"=c."configHash","deadlineAt"=new_deadline,
    "controlState"='RUNNING',"controlRevision"="controlRevision"+1,"executionMode"='CONTINUOUS',"stepBudget"=0,
    "leaseOwner"=NULL,"leaseMode"=NULL,"leaseExpiresAt"=NULL,"failureCode"=NULL,"updatedAt"=at_time WHERE id=r.id;
  response:=atlas_staff.read_workspace_operator_control(workspace_id);
  INSERT INTO atlas_staff."StaffAudit"(id,event,"subjectId","actorId",details,"createdAt") VALUES
    (gen_random_uuid(),'WORKSPACE_OPERATOR_CONTROL',w.id::text,actor_id,jsonb_build_object('workspaceId',w.id,'runId',r.id,
      'action','RECOVER','claimFence',claim_fence,'runRevision',r.revision,'priorClaim',recovered_claim,
      'originalClaim',w.canonical::jsonb->'claim','recoveryId',recovery_id,'commandId',command_id,'control',response,
      'revision',expected_revision+1,'previousControlRevision',r."controlRevision",'controlRevision',r."controlRevision"+1)::text,at_time);
  RETURN response||jsonb_build_object('runRevision',r.revision,'recoveryId',recovery_id,'recoveredClaim',recovered_claim);
END $$;
REVOKE ALL ON FUNCTION atlas_staff.recover_workspace_operator(uuid,integer,uuid,text,integer,uuid) FROM PUBLIC;

-- A crop rejected by source geometry has a complete deterministic outcome.
-- It does not assert image delivery, silently clip the request, or convert a
-- network/decoder error into permission to continue.
CREATE FUNCTION atlas_staff.operator_outside_crop_matches(run_id uuid,step_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperatorRun"%ROWTYPE; s atlas_staff."StaffOperatorStep"%ROWTYPE;
  request_json jsonb; asset jsonb; rect jsonb; result_json jsonb;
BEGIN
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=run_id;
  SELECT * INTO s FROM atlas_staff."StaffOperatorStep" WHERE id=step_id AND "runId"=r.id;
  request_json:=s."requestCanonical"::jsonb; rect:=request_json->'rect'; result_json:=s."resultCanonical"::jsonb;
  SELECT x INTO asset FROM jsonb_array_elements(r."manifestCanonical"::jsonb->'assets') x
    WHERE x->>'assetId'=request_json->>'assetId';
  RETURN (s."toolName"='inspect_region' AND asset IS NOT NULL
    AND request_json-ARRAY['runId','evidenceHash','manifestHash','expectedRevision','assetId','sourceSha256','side','rect']='{}'::jsonb
    AND request_json->>'runId'=r.id::text AND request_json->>'evidenceHash'=r."evidenceHash"
    AND request_json->>'manifestHash'=r."manifestHash" AND request_json->>'expectedRevision'=(s.revision-1)::text
    AND request_json->>'sourceSha256'=asset->>'sha256' AND request_json->>'side'=asset->>'side'
    AND rect-ARRAY['x','y','width','height']='{}'::jsonb
    AND jsonb_typeof(rect->'x')='number' AND jsonb_typeof(rect->'y')='number'
    AND jsonb_typeof(rect->'width')='number' AND jsonb_typeof(rect->'height')='number'
    AND rect->>'x' ~ '^(0|[1-9][0-9]{0,4})$' AND (rect->>'x')::integer<20000
    AND rect->>'y' ~ '^(0|[1-9][0-9]{0,4})$' AND (rect->>'y')::integer<20000
    AND rect->>'width' ~ '^[1-9][0-9]{0,4}$' AND (rect->>'width')::integer<=20000
    AND rect->>'height' ~ '^[1-9][0-9]{0,4}$' AND (rect->>'height')::integer<=20000
    AND (asset->>'width')::integer BETWEEN 1 AND 20000 AND (asset->>'height')::integer BETWEEN 1 AND 20000
    AND ((rect->>'x')::integer+(rect->>'width')::integer>(asset->>'width')::integer
      OR (rect->>'y')::integer+(rect->>'height')::integer>(asset->>'height')::integer)
    AND result_json=jsonb_build_object('binding',jsonb_build_object('runId',r.id,'evidenceHash',r."evidenceHash",
      'manifestHash',r."manifestHash",'expectedRevision',s.revision),'result',jsonb_build_object(
      'status','REGION_NOT_AVAILABLE','code','ASTRA_CROP_OUTSIDE_SOURCE','assetId',request_json->'assetId',
      'rect',rect,'sourceWidth',asset->'width','sourceHeight',asset->'height'))
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorImage" WHERE "stepId"=s.id)) IS TRUE;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION atlas_staff.operator_outside_crop_matches(uuid,uuid) FROM PUBLIC;

-- The grant, owner command, card claim and audit must all commit together.
CREATE FUNCTION atlas_staff.operator_recovery_commit_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE g jsonb:=NEW.canonical::jsonb; r atlas_staff."StaffOperatorRun"%ROWTYPE;
  w atlas_staff."StaffWorkspaceCard"%ROWTYPE; o atlas_staff."StaffWorkspaceOperation"%ROWTYPE;
BEGIN
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=NEW."runId";
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=r."workspaceCardId";
  SELECT * INTO o FROM atlas_staff."StaffWorkspaceOperation" WHERE id=NEW."commandId";
  IF (r.state='WAITING_TOOL' AND r.revision=NEW."runRevision" AND r."controlRevision"=(g->>'controlRevision')::integer
    AND r."leaseFence"=NEW."leaseFence"-1 AND r."leaseOwner" IS NULL AND r."leaseMode" IS NULL AND r."leaseExpiresAt" IS NULL
    AND r."controlState"='RUNNING' AND r."executionMode"='CONTINUOUS' AND r."stepBudget"=0 AND r."failureCode" IS NULL
    AND r."runtimeHash"=g->>'newRuntimeHash' AND r."inputHash"=g->>'inputHash'
    AND r."deadlineAt" AT TIME ZONE 'UTC'=(g->>'newDeadlineAt')::timestamptz
    AND r."updatedAt"=NEW."createdAt" AND w.id::text=g->>'workspaceId'
    AND w.revision=(g->>'workspaceRevision')::integer+1 AND w.canonical::jsonb->'claim'=g->'recoveredClaim'
    AND o."cardId"=w.id AND o."actorId"::text=g->>'actorId' AND o.action='OPERATOR_CONTROL'
    AND o.canonical::jsonb#>>'{result,action}'='RECOVER' AND o.canonical::jsonb#>>'{result,recoveryId}'=NEW.id::text
    AND o.canonical::jsonb#>>'{result,runId}'=r.id::text AND o.canonical::jsonb#>>'{result,runRevision}'=r.revision::text
    AND o.canonical::jsonb#>>'{result,runControlRevision}'=r."controlRevision"::text
    AND o.canonical::jsonb#>'{result,priorClaim}'=g->'recoveredClaim'
    AND o.canonical::jsonb#>'{result,originalClaim}'=g->'originalClaim'
    AND EXISTS(SELECT 1 FROM atlas_staff."StaffAudit" a WHERE a.event='WORKSPACE_OPERATOR_CONTROL'
      AND a."subjectId"=w.id::text AND a."actorId"=o."actorId" AND a.details::jsonb->>'recoveryId'=NEW.id::text
      AND a.details::jsonb->>'commandId'=o.id::text AND a.details::jsonb->>'action'='RECOVER'
      AND a.details::jsonb->'originalClaim'=g->'originalClaim' AND a.details::jsonb->'priorClaim'=g->'recoveredClaim'
      AND atlas_staff.workspace_command_audit_matches(o.canonical::jsonb,a.details::jsonb)
      AND a.xmin::text=pg_current_xact_id()::text)
    AND EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorRun" x WHERE x.id=r.id AND x.xmin::text=pg_current_xact_id()::text)
    AND EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceCard" x WHERE x.id=w.id AND x.xmin::text=pg_current_xact_id()::text)
    AND EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceOperation" x WHERE x.id=o.id AND x.xmin::text=pg_current_xact_id()::text)) IS NOT TRUE THEN
    RAISE EXCEPTION 'ASTRA_RECOVERY_COMMAND_NOT_COMMITTED'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "StaffOperatorRecovery_command_commit" AFTER INSERT ON "StaffOperatorRecovery"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_recovery_commit_guard();
REVOKE ALL ON FUNCTION atlas_staff.operator_recovery_commit_guard() FROM PUBLIC;
-- The existing run invariants remain intact outside the exact recovery grant.
CREATE OR REPLACE FUNCTION atlas_staff.operator_run_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC'; g jsonb;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'QUEUED' OR NEW.revision<>1 OR NEW."leaseFence"<>0 OR NEW."leaseOwner" IS NOT NULL THEN
      RAISE EXCEPTION 'ATLAS operator requires a fresh queue entry'; END IF;
    RETURN NEW;
  END IF;
  -- Only the scoped RPC can insert this grant. The same-transaction
  -- deferred proof requires its owner command and updated card claim.
  IF OLD.state IN ('UNKNOWN','WAITING_TOOL') AND NEW.state='WAITING_TOOL'
    AND NEW."controlRevision"=OLD."controlRevision"+1 THEN
    SELECT canonical::jsonb INTO g FROM atlas_staff."StaffOperatorRecovery"
      WHERE "runId"=NEW.id AND "runRevision"=OLD.revision AND "leaseFence"=OLD."leaseFence"+1
        AND canonical::jsonb->>'controlRevision'=NEW."controlRevision"::text
        AND xmin::text=pg_current_xact_id()::text;
    IF g IS NOT NULL THEN
      IF ((to_jsonb(NEW)-ARRAY['state','runtimeHash','deadlineAt','controlState','controlRevision','executionMode','stepBudget',
          'leaseOwner','leaseMode','leaseExpiresAt','failureCode','updatedAt'])
        = (to_jsonb(OLD)-ARRAY['state','runtimeHash','deadlineAt','controlState','controlRevision','executionMode','stepBudget',
          'leaseOwner','leaseMode','leaseExpiresAt','failureCode','updatedAt'])
        AND (OLD."leaseOwner" IS NULL OR OLD."leaseExpiresAt"<=now_at) AND OLD."controlState"<>'TAKEN_OVER'
        AND NEW."leaseOwner" IS NULL AND NEW."leaseMode" IS NULL AND NEW."leaseExpiresAt" IS NULL
        AND NEW."controlState"='RUNNING' AND NEW."executionMode"='CONTINUOUS' AND NEW."stepBudget"=0 AND NEW."failureCode" IS NULL
        AND g->>'oldRuntimeHash'=OLD."runtimeHash" AND g->>'newRuntimeHash'=NEW."runtimeHash"
        AND (g->>'oldDeadlineAt')::timestamptz=OLD."deadlineAt" AT TIME ZONE 'UTC'
        AND (g->>'newDeadlineAt')::timestamptz=NEW."deadlineAt" AT TIME ZONE 'UTC'
        AND (g->>'oldUpdatedAt')::timestamptz=OLD."updatedAt" AT TIME ZONE 'UTC'
        AND (g->>'createdAt')::timestamptz=NEW."updatedAt" AT TIME ZONE 'UTC'
        AND g->>'inputHash'=OLD."inputHash" AND g->>'evidenceHash'=OLD."evidenceHash"
        AND g->>'manifestHash'=OLD."manifestHash" AND g->>'policyHash'=OLD."policyHash"
        AND g->>'gradingPolicyHash'=OLD."gradingPolicyHash" AND NEW."deadlineAt">now_at) IS NOT TRUE THEN
        RAISE EXCEPTION 'ASTRA_RECOVERY_GENERATION_CHANGED'; END IF;
      RETURN NEW;
    END IF;
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

CREATE OR REPLACE FUNCTION atlas_staff.assert_capture_operator_commit(run_id uuid,event_table text,event_id uuid,is_admission boolean)
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
    AND r."deadlineAt">clock_timestamp() AT TIME ZONE 'UTC' AND atlas_staff.operator_workspace_count(r."pilotId")=jsonb_array_length(b."policyCanonical"::jsonb->'workspaceCardIds')
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
    AND step."nextInputHash"=r."inputHash" AND atlas_staff.operator_attempt_fence_matches(r.id,a.id,r."leaseFence") AND r."leaseMode"='WORK'
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
    IF NOT atlas_staff.operator_outside_crop_matches(r.id,step.id) AND (request_json-ARRAY['runId','evidenceHash','manifestHash','expectedRevision','assetId','sourceSha256','side','rect']='{}'::jsonb
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
      AND atlas_staff.operator_attempt_fence_matches(r.id,a.id,r."leaseFence") AND r."leaseMode"='WORK' AND r."leaseExpiresAt">clock_timestamp() AT TIME ZONE 'UTC'
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
    IF step."toolName"='inspect_region' AND step."resultCanonical"::jsonb#>>'{result,status}'='REGION_NOT_AVAILABLE'
      AND NOT atlas_staff.operator_outside_crop_matches(r.id,step.id) THEN
      RAISE EXCEPTION 'ATLAS rejected crop requires its exact source bounds'; END IF;
  END IF;
  RETURN NULL;
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
    'timingHistory',atlas_staff.workspace_timing_history(workspace_id),'pending',0,'settled',true,'canPause',false,'canResume',false,'canStep',false,'canTakeOver',false,'canRecover',false,'extraTimingEvents','[]'::jsonb); END IF;
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
    'canRecover',atlas_staff.operator_recoverable_attempt(r.id) IS NOT NULL,
    'extraTimingEvents',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind','PAUSE','at',g.canonical::jsonb->'oldUpdatedAt',
      'reason','NEEDS_ATTENTION','order',9) ORDER BY g."createdAt",g.ordinal),'[]'::jsonb)
      FROM atlas_staff."StaffOperatorRecovery" g JOIN atlas_staff."StaffOperatorRun" history ON history.id=g."runId"
      WHERE history."workspaceCardId"=workspace_id),
    'controlRevision',r."controlRevision",'stepBudget',r."stepBudget",'pending',pending,'settled',NOT held,
    'canPause',active AND r."controlState"='RUNNING','canResume',active AND r."controlState"='PAUSED' AND pending=0 AND NOT held,
    'canStep',active AND r."controlState"='PAUSED' AND pending=0 AND NOT held,
    'canTakeOver',active AND r."controlState"<>'TAKEN_OVER' AND NOT held);
END $$;

CREATE OR REPLACE FUNCTION atlas_staff.workspace_command_audit_matches(operation jsonb,details jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,atlas_staff AS $$
  SELECT (operation->>'action'='OPERATOR_CONTROL'
    AND operation#>>'{result,action}'=details->>'action'
    AND operation#>>'{result,runId}'=details->>'runId'
    AND operation#>>'{result,runRevision}'=details->>'runRevision'
    AND operation#>>'{result,runControlRevision}'=details->>'controlRevision'
    AND operation#>>'{result,revision}'=details->>'revision'
    AND operation#>'{result,priorClaim}'=details->'priorClaim'
    AND (operation#>>'{result,claimFence}')::integer=(details->>'claimFence')::integer
      +CASE WHEN details->>'action'='TAKE_OVER' THEN 1 ELSE 0 END
    AND (operation#>'{result,control}')-ARRAY['canRecover','failureCode','lastUpdatedAt']=jsonb_build_object(
      'state',details#>'{control,state}','mode',details#>'{control,mode}','pending',details#>'{control,pending}',
      'canPause',details#>'{control,canPause}','canResume',details#>'{control,canResume}',
      'canStep',details#>'{control,canStep}','canTakeOver',details#>'{control,canTakeOver}')
    AND (NOT (operation#>'{result,control}') ? 'canRecover' OR operation#>'{result,control,canRecover}'='false'::jsonb
      OR operation#>'{result,control,canRecover}'='true'::jsonb AND details#>'{control,canRecover}'='true'::jsonb)
    AND CASE WHEN details#>>'{control,failureCode}' ~ '^(ASTRA|WORKSPACE)_[A-Z0-9_]{1,69}$'
      THEN operation#>'{result,control,failureCode}'=details#>'{control,failureCode}'
      ELSE NOT (operation#>'{result,control}') ? 'failureCode' END
    AND CASE WHEN details#>>'{control,lastUpdatedAt}' IS NOT NULL
      THEN (operation#>>'{result,control,lastUpdatedAt}')::timestamptz=(details#>>'{control,lastUpdatedAt}')::timestamptz
      ELSE NOT (operation#>'{result,control}') ? 'lastUpdatedAt' END
    AND (details->>'action'<>'RECOVER' OR operation#>'{result,originalClaim}'=details->'originalClaim'
      AND operation#>'{result,recoveryId}'=details->'recoveryId' AND operation->>'id'=details->>'commandId')) IS TRUE;
$$;

COMMIT;
