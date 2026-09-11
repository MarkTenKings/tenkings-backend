BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;

-- Fast intake identification has its own admitted configuration and immutable
-- request/result events. It never changes the MAX grading operator policy.
CREATE TABLE "StaffWorkspaceIdentificationControl" (
  id text PRIMARY KEY DEFAULT 'active', enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL,"releaseSha" varchar(40) NOT NULL,"configHash" varchar(64) NOT NULL,
  "cohortId" uuid NOT NULL,"pilotId" uuid NOT NULL,"policyCanonical" text NOT NULL,"policyHash" varchar(64) NOT NULL,
  "expiresAt" timestamp(3) NOT NULL,revision integer NOT NULL DEFAULT 1,"updatedAt" timestamp(3) NOT NULL,
  CHECK ((id='active' AND revision>0 AND mode IN ('PRODUCTION','LOCAL_FIXTURE')
    AND "releaseSha" ~ '^[a-f0-9]{40}$' AND "configHash" ~ '^[a-f0-9]{64}$'
    AND octet_length("policyCanonical")<=8192 AND "policyHash"=encode(sha256(convert_to("policyCanonical",'UTF8')),'hex')
    AND "policyCanonical"::jsonb->>'version'='atlas-intake-identification-policy-v1'
    AND "policyCanonical"::jsonb->>'pilotId'="pilotId"::text
    AND "policyCanonical"::jsonb-ARRAY['version','pilotId','expiresAt','ocrReserveMicroUsd','modelReserveMicroUsd','costEvidenceHash']='{}'::jsonb
    AND "policyCanonical"::jsonb->>'costEvidenceHash' ~ '^[a-f0-9]{64}$'
    AND ("policyCanonical"::jsonb->>'ocrReserveMicroUsd')::bigint>0
    AND ("policyCanonical"::jsonb->>'modelReserveMicroUsd')::bigint>=589600
    AND ("policyCanonical"::jsonb->>'ocrReserveMicroUsd')::bigint+("policyCanonical"::jsonb->>'modelReserveMicroUsd')::bigint<=5000000
    AND "expiresAt"<=("policyCanonical"::jsonb->>'expiresAt')::timestamptz AT TIME ZONE 'UTC') IS TRUE)
);
CREATE TRIGGER "StaffWorkspaceIdentificationControl_change" BEFORE UPDATE ON "StaffWorkspaceIdentificationControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_control_guard();
CREATE TRIGGER "StaffWorkspaceIdentificationControl_no_delete" BEFORE DELETE ON "StaffWorkspaceIdentificationControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffWorkspaceIdentificationControl_no_truncate" BEFORE TRUNCATE ON "StaffWorkspaceIdentificationControl"
  FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable();
REVOKE ALL ON "StaffWorkspaceIdentificationControl" FROM PUBLIC;

CREATE FUNCTION atlas_staff.lock_workspace_identification_control() RETURNS SETOF atlas_staff."StaffWorkspaceIdentificationControl"
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT * FROM atlas_staff."StaffWorkspaceIdentificationControl" WHERE id='active' FOR SHARE;
$$;

-- This fingerprint binds verified uploads independently of captureRevision,
-- which advances when the same pair enters the queue.
CREATE FUNCTION atlas_staff.workspace_identification_pair(workspace_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  WITH sides AS (
    SELECT side,p.id,"sha256" FROM atlas_staff."StaffWorkspaceCard" w
    CROSS JOIN unnest(ARRAY['FRONT','BACK']) side
    JOIN atlas_staff."StaffWorkspaceOperation" p ON p.id::text=w.canonical::jsonb#>>ARRAY['sides',side,'uploadId']
    JOIN atlas_staff."StaffWorkspaceOperation" v ON v.id::text=w.canonical::jsonb#>>ARRAY['sides',side,'verificationId']
    CROSS JOIN LATERAL (SELECT p.canonical::jsonb#>>'{result,upload,sha256}' AS "sha256") h
    WHERE w.id=workspace_id AND p."cardId"=w.id AND p.action='upload-plan' AND v."cardId"=w.id AND v.action='upload-complete'
      AND p.canonical::jsonb#>>'{result,upload,side}'=side AND v.canonical::jsonb#>>'{result,uploadId}'=p.id::text
      AND v.canonical::jsonb#>>'{result,verification,sha256}'="sha256"
      AND v.canonical::jsonb#>>'{result,verification,objectRef}'=p.canonical::jsonb#>>'{result,upload,objectRef}'
  ) SELECT CASE WHEN count(*)=2 AND count(DISTINCT id)=2 AND count(DISTINCT "sha256")=2 THEN
    jsonb_object_agg(side,jsonb_build_object('uploadId',id::text,'sha256',"sha256")) ELSE NULL END FROM sides;
$$;
CREATE FUNCTION atlas_staff.workspace_identity_ready(workspace_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT (n#>>'{identity,category}' IN ('SPORTS','POKEMON') AND
    (NOT(n ? 'identityReview') OR n#>>'{identityReview,status}'='READY'
      AND n#>'{identityReview,photos}'=pair
      AND n#>>'{identityReview,pairHash}'=encode(sha256(convert_to('FRONT:'||(pair#>>'{FRONT,uploadId}')||':'||(pair#>>'{FRONT,sha256}')
        ||'|BACK:'||(pair#>>'{BACK,uploadId}')||':'||(pair#>>'{BACK,sha256}'),'UTF8')),'hex'))) IS TRUE
  FROM (SELECT canonical::jsonb n,atlas_staff.workspace_identification_pair(id) pair FROM atlas_staff."StaffWorkspaceCard" WHERE id=workspace_id) w;
$$;

-- One retained request per exact pair across all staff and deployments, and
-- one terminal result per request. The record cannot be deleted or refunded by
-- a timeout, browser cancellation, human edit, retake or capture→report handoff.
CREATE UNIQUE INDEX "StaffWorkspaceIdentification_pair" ON "StaffWorkspaceOperation"
  ("cardId",(canonical::jsonb#>>'{result,pairHash}')) WHERE action='IDENTIFICATION_REQUEST';
CREATE UNIQUE INDEX "StaffWorkspaceIdentification_result" ON "StaffWorkspaceOperation"
  ((canonical::jsonb#>>'{result,requestId}')) WHERE action='IDENTIFICATION_RESULT';

CREATE OR REPLACE FUNCTION atlas_staff.workspace_pilot_costs(pilot uuid)
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
  FROM atlas_staff."StaffWorkspaceInfrastructureReservation" i WHERE i."pilotId"=pilot
  UNION ALL
  SELECT q."cardId",w."specimenId",
    greatest((q.canonical::jsonb#>>'{result,reservedMicroUsd}')::numeric,coalesce((r.canonical::jsonb#>>'{result,usageCeilingMicroUsd}')::numeric,0)),
    coalesce((r.canonical::jsonb#>>'{result,usageEnvelopeExceeded}')::boolean,false)
      OR coalesce((r.canonical::jsonb#>>'{result,usageCeilingMicroUsd}')::numeric>(q.canonical::jsonb#>>'{result,reservedMicroUsd}')::numeric,false),'IDENTIFICATION'
  FROM atlas_staff."StaffWorkspaceOperation" q JOIN atlas_staff."StaffWorkspaceCard" w ON w.id=q."cardId"
    LEFT JOIN atlas_staff."StaffWorkspaceOperation" r ON r.action='IDENTIFICATION_RESULT' AND r.canonical::jsonb#>>'{result,requestId}'=q.id::text
  WHERE q.action='IDENTIFICATION_REQUEST' AND q.canonical::jsonb#>>'{result,pilotId}'=pilot::text;
$$;

CREATE FUNCTION atlas_staff.workspace_identification_operation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
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
  IF (NOT u.overrun AND u.total::numeric+reserve<=least(90000000,(budget->>'maxTotalMicroUsd')::numeric)
    AND u.card::numeric+reserve<=(budget->>'maxCardMicroUsd')::numeric) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATLAS identification shared pilot budget denied'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffWorkspaceIdentification_guard" BEFORE INSERT ON "StaffWorkspaceOperation"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.workspace_identification_operation_guard();

-- MAX may fill unresolved capture details, but cannot replace accepted intake
-- values or a deliberate human clear. Preserve the existing manifest/receipt
-- format; the immutable, claim-fenced workspace retains field authority.
CREATE FUNCTION atlas_staff.workspace_capture_identity_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperatorRun";w jsonb;m jsonb;authority jsonb;f jsonb;k text;
  request_json jsonb:=NEW."requestCanonical"::jsonb;selected jsonb;
BEGIN
  IF NEW."toolName" NOT IN ('propose_capture_identity','submit_capture_preparation') THEN RETURN NEW; END IF;
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=NEW."runId";
  IF r.phase IS DISTINCT FROM 'CAPTURE_REVIEW' THEN RETURN NEW; END IF;
  SELECT canonical::jsonb INTO w FROM atlas_staff."StaffWorkspaceCard" WHERE id=r."workspaceCardId" FOR SHARE;
  m:=r."manifestCanonical"::jsonb;
  authority:=coalesce(w#>'{workspace,identityAuthority}',w->'identityAuthority','{}'::jsonb);
  IF NEW."toolName"='propose_capture_identity' THEN
    FOR f IN SELECT value FROM jsonb_array_elements(request_json->'fields') LOOP
      k:=f->>'field';
      IF (length(btrim(m->'identity'->>k))>0 OR authority->k->>'actor'='HUMAN')
        AND f->'value' IS DISTINCT FROM m->'identity'->k THEN
        RAISE EXCEPTION 'ASTRA_CAPTURE_IDENTITY_CONFLICT';
      END IF;
    END LOOP;
  ELSIF request_json->>'disposition'='READY_FOR_PREPARATION' THEN
    selected:=NEW."resultCanonical"::jsonb#>'{result,identity}';
    FOR k IN SELECT jsonb_object_keys(m->'identity') UNION SELECT jsonb_object_keys(authority) LOOP
      IF (length(btrim(m->'identity'->>k))>0 OR authority->k->>'actor'='HUMAN')
        AND selected->k IS DISTINCT FROM m->'identity'->k THEN
        RAISE EXCEPTION 'ASTRA_CAPTURE_IDENTITY_CONFLICT';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffWorkspaceCaptureIdentity_guard" BEFORE INSERT ON "StaffOperatorStep"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.workspace_capture_identity_guard();
REVOKE ALL ON FUNCTION atlas_staff.lock_workspace_identification_control(),atlas_staff.workspace_identification_pair(uuid),
  atlas_staff.workspace_identity_ready(uuid),atlas_staff.workspace_identification_operation_guard(),
  atlas_staff.workspace_capture_identity_guard() FROM PUBLIC;
COMMIT;
