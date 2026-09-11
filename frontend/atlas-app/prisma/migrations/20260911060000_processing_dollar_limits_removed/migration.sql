-- Dollar limits are optional enforcement; all original accounting remains.
-- Absence preserves the historical policy. Only the exact admitted literal
-- ACCOUNTING_ONLY disables monetary comparisons. Null/unknown modes fail closed.
BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;

CREATE FUNCTION atlas_staff.pilot_dollar_limits_allow(policy jsonb,total numeric,card numeric,reserve numeric,overrun boolean,hard_total numeric DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
  IF policy IS NULL OR jsonb_typeof(policy)<>'object'
    OR (policy ? 'budgetEnforcement' AND policy->'budgetEnforcement' IS DISTINCT FROM '"ACCOUNTING_ONLY"'::jsonb) THEN
    RAISE EXCEPTION 'ATLAS dollar enforcement mode invalid'; END IF;
  IF total IS NULL OR card IS NULL OR reserve IS NULL OR overrun IS NULL
    OR total<0 OR card<0 OR reserve<0 OR total<>trunc(total) OR card<>trunc(card) OR reserve<>trunc(reserve)
    OR total IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    OR card IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    OR reserve IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    OR (hard_total IS NOT NULL AND (hard_total<=0 OR hard_total<>trunc(hard_total)
      OR hard_total IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)))
    OR jsonb_typeof(policy->'maxTotalMicroUsd') IS DISTINCT FROM 'number'
    OR jsonb_typeof(policy->'maxCardMicroUsd') IS DISTINCT FROM 'number'
    OR (policy->>'maxTotalMicroUsd')::numeric NOT BETWEEN 1 AND 1000000000000
    OR (policy->>'maxCardMicroUsd')::numeric NOT BETWEEN 1 AND 1000000000000
    OR (policy->>'maxTotalMicroUsd')::numeric<>trunc((policy->>'maxTotalMicroUsd')::numeric)
    OR (policy->>'maxCardMicroUsd')::numeric<>trunc((policy->>'maxCardMicroUsd')::numeric) THEN
    RAISE EXCEPTION 'ATLAS dollar accounting input invalid'; END IF;
  IF policy->>'budgetEnforcement'='ACCOUNTING_ONLY' THEN RETURN true; END IF;
  RETURN NOT overrun AND total+reserve<=least((policy->>'maxTotalMicroUsd')::numeric,hard_total)
    AND card+reserve<=(policy->>'maxCardMicroUsd')::numeric;
END $$;
REVOKE ALL ON FUNCTION atlas_staff.pilot_dollar_limits_allow(jsonb,numeric,numeric,numeric,boolean,numeric) FROM PUBLIC;

ALTER TABLE "StaffGradingBridgeControl" ADD CONSTRAINT "StaffGradingBridgeControl_budget_enforcement"
  CHECK ((NOT ("policyCanonical"::jsonb ? 'budgetEnforcement')
    OR "policyCanonical"::jsonb->'budgetEnforcement'='"ACCOUNTING_ONLY"'::jsonb) IS TRUE);


-- Keep StaffWorkspaceSourceControl amount types and all non-dollar invariants.
ALTER TABLE "StaffWorkspaceSourceControl" DROP CONSTRAINT "StaffWorkspaceSourceControl_check";
ALTER TABLE "StaffWorkspaceSourceControl" ADD CONSTRAINT "StaffWorkspaceSourceControl_check" CHECK (id='active' AND revision>0 AND mode IN ('PRODUCTION','LOCAL_FIXTURE')
    AND "releaseSha" ~ '^[a-f0-9]{40}$' AND "sourceReleaseSha" ~ '^[a-f0-9]{40}$'
    AND "configHash" ~ '^[a-f0-9]{64}$' AND "sourceConfigHash" ~ '^[a-f0-9]{64}$'
    AND "sourceDeploymentId" ~ '^[a-zA-Z0-9._-]{1,120}$'
    AND "physicalReserveMicroUsd" >=1 AND "preparationReserveMicroUsd" >=1
    AND "registrationReserveMicroUsd" >=0 AND "infrastructureReserveMicroUsd" >=0);

-- Keep StaffWorkspaceInfrastructureReservation amount types and all non-dollar invariants.
ALTER TABLE "StaffWorkspaceInfrastructureReservation" DROP CONSTRAINT "StaffWorkspaceInfrastructureReservation_check";
ALTER TABLE "StaffWorkspaceInfrastructureReservation" ADD CONSTRAINT "StaffWorkspaceInfrastructureReservation_check" CHECK ("sourceConfigHash" ~ '^[a-f0-9]{64}$' AND "reservedMicroUsd" >=0
    AND "expiresAt">"createdAt" AND (("actualMicroUsd" IS NULL AND "costEvidenceHash" IS NULL)
      OR "actualMicroUsd">=0 AND "costEvidenceHash" ~ '^[a-f0-9]{64}$'));

-- Keep StaffWorkspaceSourceOperation amount types and all non-dollar invariants.
ALTER TABLE "StaffWorkspaceSourceOperation" DROP CONSTRAINT "StaffWorkspaceSourceOperation_check";
ALTER TABLE "StaffWorkspaceSourceOperation" ADD CONSTRAINT "StaffWorkspaceSourceOperation_check" CHECK ((purpose IN ('PHYSICAL_GEOMETRY','PREPARATION','MAP_REGISTRATION','INITIALIZE_REPORT')
    AND (purpose='INITIALIZE_REPORT' AND side='PAIR' AND "reservedMicroUsd"=0
      OR purpose<>'INITIALIZE_REPORT' AND side IN ('FRONT','BACK') AND "reservedMicroUsd" >=1)
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
      OR state IN ('FAILED','UNKNOWN') AND "finishedAt" IS NOT NULL AND "failureCode" IS NOT NULL)) IS TRUE);

-- JSON reservation sums remain exactly representable as a JavaScript safe integer; this is not a spending allowance.
ALTER TABLE "StaffWorkspaceIdentificationControl" DROP CONSTRAINT "StaffWorkspaceIdentificationControl_check";
ALTER TABLE "StaffWorkspaceIdentificationControl" ADD CONSTRAINT "StaffWorkspaceIdentificationControl_check" CHECK ((id='active' AND revision>0 AND mode IN ('PRODUCTION','LOCAL_FIXTURE')
    AND "releaseSha" ~ '^[a-f0-9]{40}$' AND "configHash" ~ '^[a-f0-9]{64}$'
    AND octet_length("policyCanonical")<=8192 AND "policyHash"=encode(sha256(convert_to("policyCanonical",'UTF8')),'hex')
    AND "policyCanonical"::jsonb->>'version'='atlas-intake-identification-policy-v1'
    AND "policyCanonical"::jsonb->>'pilotId'="pilotId"::text
    AND "policyCanonical"::jsonb-ARRAY['version','pilotId','expiresAt','ocrReserveMicroUsd','modelReserveMicroUsd','costEvidenceHash']='{}'::jsonb
    AND "policyCanonical"::jsonb->>'costEvidenceHash' ~ '^[a-f0-9]{64}$'
    AND ("policyCanonical"::jsonb->>'ocrReserveMicroUsd')::bigint>0
    AND ("policyCanonical"::jsonb->>'modelReserveMicroUsd')::bigint>=589600
    AND ("policyCanonical"::jsonb->>'ocrReserveMicroUsd')::numeric+("policyCanonical"::jsonb->>'modelReserveMicroUsd')::numeric<=9007199254740991
    AND "expiresAt"<=("policyCanonical"::jsonb->>'expiresAt')::timestamptz AT TIME ZONE 'UTC') IS TRUE);

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
      AND (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p->'workspaceCardIds') x)=jsonb_array_length(p->'workspaceCardIds')
      AND atlas_staff.operator_workspace_count(pilot)=jsonb_array_length(p->'workspaceCardIds')
      AND atlas_staff.pilot_dollar_limits_allow(p,u.total::numeric,u.card::numeric,expected,u.overrun)
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
    AND atlas_staff.pilot_dollar_limits_allow(p,u.total::numeric,u.card::numeric,expected,u.overrun)
    AND (TG_TABLE_NAME<>'StaffGradingExecution' OR u.operations<(p->>'maxOperationsPerCard')::integer)
    AND (TG_TABLE_NAME<>'StaffOperatorAttempt' OR u.attempts<(c."policyCanonical"::jsonb->>'maxAttemptsPerCard')::integer)
  ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS shared pilot budget denied'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION atlas_staff.workspace_source_operation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
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
    AND p->'workspaceCardIds' ? w.id::text AND atlas_staff.operator_workspace_count(s."pilotId")=jsonb_array_length(p->'workspaceCardIds')
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
    IF (atlas_staff.pilot_dollar_limits_allow(p,u.total::numeric,u.card::numeric,reserve,u.overrun,90000000)) IS NOT TRUE THEN
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

CREATE OR REPLACE FUNCTION atlas_staff.workspace_infrastructure_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
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
    AND (NEW."expiresAt" AT TIME ZONE 'UTC')<=(b."policyCanonical"::jsonb->>'expiresAt')::timestamptz
    AND atlas_staff.pilot_dollar_limits_allow(b."policyCanonical"::jsonb,u.total::numeric+NEW."reservedMicroUsd",0,0,u.overrun,90000000)) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS infrastructure must fit the original pilot budget'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION atlas_staff.workspace_identification_operation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE c atlas_staff."StaffWorkspaceIdentificationControl"%ROWTYPE;wc atlas_staff."StaffWorkspaceControl"%ROWTYPE;
  sc atlas_staff."StaffControl"%ROWTYPE;b atlas_staff."StaffGradingBridgeControl"%ROWTYPE;
  actor atlas_staff."StaffIdentity"%ROWTYPE;s atlas_staff."StaffSession"%ROWTYPE;br atlas_staff."StaffBrowser"%ROWTYPE;
  w atlas_staff."StaffWorkspaceCard"%ROWTYPE;q atlas_staff."StaffWorkspaceOperation"%ROWTYPE;
  n jsonb:=NEW.canonical::jsonb->'result';p jsonb;budget jsonb;pair jsonb;pair_hash text;u record;reserve bigint;
  now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF NEW.action NOT IN ('IDENTIFICATION_REQUEST','IDENTIFICATION_RESULT') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=NEW."cardId" FOR UPDATE;
  SELECT * INTO actor FROM atlas_staff."StaffIdentity" WHERE id=NEW."actorId" FOR SHARE;
  IF (actor.role='REVIEWER' AND actor."revokedAt" IS NULL AND w.id IS NOT NULL) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS identification staff denied'; END IF;
  IF NEW.action='IDENTIFICATION_RESULT' THEN
    SELECT * INTO q FROM atlas_staff."StaffWorkspaceOperation" WHERE id::text=n->>'requestId' AND action='IDENTIFICATION_REQUEST';
    IF (q."cardId"=NEW."cardId" AND q."actorId"=NEW."actorId" AND NEW."createdAt">=q."createdAt"
      AND n#>>'{identification,status}' IN ('SUCCEEDED','UNKNOWN')
      AND n#>'{identification,photos}'=q.canonical::jsonb#>'{result,photos}'
      AND n#>>'{identification,pairHash}'=q.canonical::jsonb#>>'{result,pairHash}'
      AND jsonb_typeof(n->'usageEnvelopeExceeded')='boolean'
      AND (n->'usageCeilingMicroUsd'='null'::jsonb OR (n->>'usageCeilingMicroUsd')::numeric>=0)) IS NOT TRUE THEN
      RAISE EXCEPTION 'ATLAS identification receipt binding denied'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO c FROM atlas_staff."StaffWorkspaceIdentificationControl" WHERE id='active' FOR SHARE;
  SELECT * INTO wc FROM atlas_staff."StaffWorkspaceControl" WHERE id='active' FOR SHARE;
  SELECT * INTO sc FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE;
  SELECT * INTO s FROM atlas_staff."StaffSession" WHERE "tokenHash"=n->>'sessionHash' FOR SHARE;
  SELECT * INTO br FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=s."browserHash" FOR SHARE;
  p:=c."policyCanonical"::jsonb;budget:=b."policyCanonical"::jsonb;
  reserve:=(p->>'ocrReserveMicroUsd')::bigint+(p->>'modelReserveMicroUsd')::bigint;
  pair:=atlas_staff.workspace_identification_pair(w.id);
  pair_hash:=encode(sha256(convert_to('FRONT:'||(pair#>>'{FRONT,uploadId}')||':'||(pair#>>'{FRONT,sha256}')
    ||'|BACK:'||(pair#>>'{BACK,uploadId}')||':'||(pair#>>'{BACK,sha256}'),'UTF8')),'hex');
  IF (c.enabled AND wc.enabled AND wc."intakeEnabled" AND sc.enabled AND b.enabled
    AND c.mode=sc.mode AND wc.mode=sc.mode AND b.mode=sc.mode AND c."releaseSha"=sc."releaseSha" AND wc."releaseSha"=sc."releaseSha"
    AND c."cohortId"=wc."cohortId" AND w."cohortId"=wc."cohortId" AND w.state IN ('DRAFT','NEEDS_ATTENTION')
    AND w."specimenId" IS NULL AND w.canonical::jsonb->'claim'='null'::jsonb
    AND s."identityId"=actor.id AND s."revokedAt" IS NULL AND s."accessVersion"=actor."accessVersion"
    AND s."controlRevision"=sc.revision AND br."controlRevision"=sc.revision AND s."expiresAt">now_at AND br."expiresAt">now_at
    AND (n->>'accessVersion')::integer=actor."accessVersion" AND (n->>'staffControlRevision')::integer=sc.revision
    AND c."expiresAt">now_at AND wc."expiresAt">now_at AND c."expiresAt"<=wc."expiresAt"
    AND c."expiresAt"<=(budget->>'expiresAt')::timestamptz AT TIME ZONE 'UTC' AND (p->>'expiresAt')::timestamptz<= (budget->>'expiresAt')::timestamptz
    AND budget->>'version'='atlas-workspace-bridge-policy-v1' AND budget->>'pilotId'=c."pilotId"::text
    AND n->>'pilotId'=c."pilotId"::text AND n->>'configHash'=c."configHash" AND n->>'policyHash'=c."policyHash"
    AND (n->>'controlRevision')::integer=c.revision AND n->>'phase'='INTAKE_IDENTIFICATION'
    AND n->>'model'='gpt-6-astra' AND n->>'reasoningEffort'='low' AND n->>'serviceTier'='default' AND (n->>'maxOutputTokens')::integer=2400
    AND n->'photos'=pair AND n->>'pairHash'=pair_hash AND n->'identity'=w.canonical::jsonb->'identity'
    AND (n->>'reservedMicroUsd')::bigint=reserve AND n->>'ocrReserveMicroUsd'=p->>'ocrReserveMicroUsd'
    AND n->>'modelReserveMicroUsd'=p->>'modelReserveMicroUsd' AND n->>'costEvidenceHash'=p->>'costEvidenceHash'
    AND NEW."createdAt" BETWEEN now_at-interval '1 minute' AND now_at+interval '1 second') IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS identification admission denied'; END IF;
  SELECT * INTO u FROM atlas_staff.workspace_pilot_budget_usage(c."pilotId",w.id);
  IF (atlas_staff.pilot_dollar_limits_allow(budget,u.total::numeric,u.card::numeric,reserve,u.overrun,90000000)) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS identification shared pilot budget denied'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION atlas_staff.operator_recoverable_attempt(run_id uuid) RETURNS uuid
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
  IF NOT atlas_staff.pilot_dollar_limits_allow(b."policyCanonical"::jsonb,usage.total::numeric,usage.card::numeric,0,usage.overrun) THEN RETURN NULL; END IF;
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


CREATE OR REPLACE FUNCTION atlas_staff.operator_abandonable_attempt(run_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperatorRun"%ROWTYPE; w atlas_staff."StaffWorkspaceCard"%ROWTYPE;
  c atlas_staff."StaffOperatorControl"%ROWTYPE; b atlas_staff."StaffGradingBridgeControl"%ROWTYPE;
  sc atlas_staff."StaffControl"%ROWTYPE; wc atlas_staff."StaffWorkspaceControl"%ROWTYPE;
  i atlas_staff."StaffIdentity"%ROWTYPE; a atlas_staff."StaffOperatorAttempt"%ROWTYPE; usage record; binding jsonb;
BEGIN
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=run_id;
  SELECT * INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=r."workspaceCardId";
  SELECT * INTO c FROM atlas_staff."StaffOperatorControl" WHERE id='active';
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active';
  SELECT * INTO sc FROM atlas_staff."StaffControl" WHERE id='active';
  SELECT * INTO wc FROM atlas_staff."StaffWorkspaceControl" WHERE id='active';
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id::text=w.canonical::jsonb#>>'{claim,actorId}';
  IF (r.phase='CAPTURE_REVIEW' AND r.state IN ('UNKNOWN','RUNNING','WAITING_TOOL') AND r."controlState"<>'TAKEN_OVER'
    AND r."initializationId" IS NULL AND r."specimenId" IS NULL
    AND (r."leaseOwner" IS NULL OR r."leaseExpiresAt"<=clock_timestamp() AT TIME ZONE 'UTC')
    AND c.enabled AND b.enabled AND sc.enabled AND wc.enabled AND wc."astraEnabled" AND wc."claimsEnabled" AND wc."preparationEnabled"
    AND c.mode=b.mode AND c.mode=sc.mode AND c.mode=wc.mode AND c."releaseSha"=sc."releaseSha" AND c."releaseSha"=wc."releaseSha"
    AND r."policyHash"=c."policyHash" AND r."policyCanonical"=c."policyCanonical"
    AND r."gradingPolicyHash"=b."gradingPolicyHash" AND r."gradingPolicyHash"=sc."gradingPolicyHash"
    AND r."pilotId"::text=c."policyCanonical"::jsonb->>'pilotId' AND r."pilotId"::text=b."policyCanonical"::jsonb->>'pilotId'
    AND b."policyCanonical"::jsonb->>'version'='atlas-workspace-bridge-policy-v1'
    AND b."policyCanonical"::jsonb->'workspaceCardIds' ? w.id::text
    AND atlas_staff.operator_workspace_count(r."pilotId")=jsonb_array_length(b."policyCanonical"::jsonb->'workspaceCardIds')
    AND (c."policyCanonical"::jsonb->>'expiresAt')::timestamptz>clock_timestamp()
    AND (b."policyCanonical"::jsonb->>'expiresAt')::timestamptz>clock_timestamp() AND wc."expiresAt">clock_timestamp() AT TIME ZONE 'UTC'
    AND r.revision<=(c."policyCanonical"::jsonb->>'maxStepsPerRun')::integer
    AND (SELECT count(*) FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=r.id)<(c."policyCanonical"::jsonb->>'maxAttemptsPerCard')::integer
    AND w."cohortId"=wc."cohortId" AND w.state IN ('IN_PROGRESS','NEEDS_ATTENTION') AND w."specimenId" IS NULL
    AND w.canonical::jsonb#>>'{claim,kind}'='ASTRA' AND w.canonical::jsonb#>>'{claim,runId}'=r.id::text
    AND w.canonical::jsonb#>>'{claim,fence}'=w.canonical::jsonb->>'claimFence'
    AND w.canonical::jsonb#>>'{claim,captureHash}'=w.canonical::jsonb->>'captureHash'
    AND w.canonical::jsonb#>>'{claim,captureRevision}'=w.canonical::jsonb->>'captureRevision'
    AND w.canonical::jsonb#>'{workspace,pending}' IS NULL AND w.canonical::jsonb->>'startedAt' IS NOT NULL
    AND i.role='REVIEWER' AND i."revokedAt" IS NULL AND w.canonical::jsonb#>>'{claim,accessVersion}'=i."accessVersion"::text
    AND r."inputHash"=encode(sha256(convert_to(r."inputCanonical",'UTF8')),'hex')
    AND r."manifestHash"=encode(sha256(convert_to(r."manifestCanonical",'UTF8')),'hex')
    AND r."policyHash"=encode(sha256(convert_to(r."policyCanonical",'UTF8')),'hex')
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorRun" other WHERE other."pilotId"=r."pilotId" AND other.id<>r.id
      AND other."leaseOwner" IS NOT NULL AND other."leaseExpiresAt">clock_timestamp() AT TIME ZONE 'UTC')
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceOperation" WHERE "runId"=r.id OR "cardId"=w.id)
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceActionPermit" WHERE "runId"=r.id OR "cardId"=w.id)
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffMachineInitialization" WHERE "specimenId"=w.id)
    AND (SELECT count(*) FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=r.id AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN'))=1
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=r.id AND "providerBindingHash"<>c."providerBindingHash")) IS NOT TRUE
    THEN RETURN NULL; END IF;
  IF NOT atlas_staff.operator_capture_current(r.id) THEN RETURN NULL; END IF;
  SELECT * INTO a FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=r.id AND state IN ('DISPATCHED','UNKNOWN');
  IF (a.id IS NOT NULL AND a."runRevision"=r.revision AND a."leaseFence"<=r."leaseFence" AND a."dispatchedAt" IS NOT NULL
    AND a."resultReceiptId" IS NULL AND a."providerBindingHash"=c."providerBindingHash"
    AND a.ordinal=(SELECT max(ordinal) FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=r.id)
    AND a."requestHash"=encode(sha256(convert_to(a."requestCanonical",'UTF8')),'hex')
    AND a."requestCanonical"::jsonb->'input'=r."inputCanonical"::jsonb
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorStep" WHERE "attemptId"=a.id)
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorReceipt" WHERE "attemptId"=a.id AND canonical::jsonb->>'state'='RECEIVED')
    AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorAttemptAbandonment" WHERE "attemptId"=a.id)) IS NOT TRUE
    THEN RETURN NULL; END IF;
  SELECT * INTO usage FROM atlas_staff.workspace_pilot_budget_usage(r."pilotId",w.id);
  IF NOT atlas_staff.pilot_dollar_limits_allow(b."policyCanonical"::jsonb,usage.total::numeric,usage.card::numeric,0,usage.overrun) THEN RETURN NULL; END IF;
  binding:=atlas_staff.operator_attempt_abandonment_binding(r.id);
  RETURN jsonb_build_object('attemptId',a.id,'reviewHash',encode(sha256(convert_to(atlas_staff.workspace_manifest_canonical(binding),'UTF8')),'hex'),
    'reservedMicroUsd',a."reservedMicroUsd"::text,'dispatchedAt',to_char(a."dispatchedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

COMMIT;
