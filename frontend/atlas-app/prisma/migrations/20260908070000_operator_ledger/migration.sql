BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;
CREATE TABLE "StaffOperatorControl" (
  id text PRIMARY KEY DEFAULT 'active', enabled boolean NOT NULL DEFAULT false, mode text NOT NULL,
  "releaseSha" varchar(40) NOT NULL, "buildHash" varchar(64) NOT NULL, "configHash" varchar(64) NOT NULL,
  "providerBindingHash" varchar(64) NOT NULL, "policyCanonical" text NOT NULL, "policyHash" varchar(64) NOT NULL,
  revision integer NOT NULL DEFAULT 1, "updatedAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT "StaffOperatorControl_shape" CHECK ((id='active' AND revision>0 AND mode IN ('LOCAL_FIXTURE','PRODUCTION')
    AND "releaseSha" ~ '^[a-f0-9]{40}$' AND "buildHash" ~ '^[a-f0-9]{64}$' AND "configHash" ~ '^[a-f0-9]{64}$'
    AND "providerBindingHash" ~ '^[a-f0-9]{64}$' AND octet_length("policyCanonical")<=65536
    AND "policyCanonical"::jsonb->>'version'='atlas-operator-control-policy-v1'
    AND "policyHash"=encode(sha256(convert_to("policyCanonical",'UTF8')),'hex')) IS TRUE)
);
CREATE TRIGGER "StaffOperatorControl_change" BEFORE UPDATE ON "StaffOperatorControl"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_control_guard();

CREATE TABLE "StaffOperatorRun" (
  id uuid PRIMARY KEY, "specimenId" uuid NOT NULL REFERENCES "StaffSpecimen"(id) ON DELETE RESTRICT,
  "pilotId" uuid NOT NULL, "evidenceHash" varchar(64) NOT NULL, "policyHash" varchar(64) NOT NULL,
  "policyCanonical" text NOT NULL, "runtimeHash" varchar(64) NOT NULL,
  "gradingPolicyHash" varchar(64) NOT NULL, "manifestCanonical" text NOT NULL, "manifestHash" varchar(64) NOT NULL,
  "expectedAnalysisRevision" integer NOT NULL, "expectedReviewRevision" integer NOT NULL,
  revision integer NOT NULL DEFAULT 1, state text NOT NULL DEFAULT 'QUEUED', "inputCanonical" text NOT NULL, "inputHash" varchar(64) NOT NULL,
  "leaseOwner" uuid, "leaseFence" integer NOT NULL DEFAULT 0, "leaseMode" text, "leaseExpiresAt" timestamp(3),
  summary varchar(1000), "failureCode" varchar(80), "deadlineAt" timestamp(3) NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  "updatedAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CONSTRAINT "StaffOperatorRun_shape" CHECK ((revision>0 AND "expectedAnalysisRevision">=0 AND "expectedReviewRevision">0
    AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "gradingPolicyHash" ~ '^[a-f0-9]{64}$' AND "runtimeHash" ~ '^[a-f0-9]{64}$'
    AND octet_length("policyCanonical")<=65536 AND "policyCanonical"::jsonb->>'version'='atlas-operator-control-policy-v1'
    AND "policyHash"=encode(sha256(convert_to("policyCanonical",'UTF8')),'hex')
    AND octet_length("manifestCanonical")<=131072 AND jsonb_typeof("manifestCanonical"::jsonb)='object'
    AND "manifestHash"=encode(sha256(convert_to("manifestCanonical",'UTF8')),'hex')
    AND octet_length("inputCanonical")<=12582912 AND jsonb_typeof("inputCanonical"::jsonb)='array'
    AND "inputHash"=encode(sha256(convert_to("inputCanonical",'UTF8')),'hex')
    AND state IN ('QUEUED','RUNNING','WAITING_TOOL','READY_FOR_HUMAN','NEEDS_RECAPTURE','NEEDS_EXPERT','UNKNOWN','FAILED')
    AND (("leaseOwner" IS NULL AND "leaseMode" IS NULL AND "leaseExpiresAt" IS NULL)
      OR ("leaseOwner" IS NOT NULL AND "leaseMode" IN ('WORK','RECONCILE_ONLY') AND "leaseExpiresAt" IS NOT NULL))
    AND "leaseFence">=0 AND "deadlineAt">"createdAt") IS TRUE)
);
CREATE INDEX "StaffOperatorRun_pilotId_state_idx" ON "StaffOperatorRun"("pilotId",state);
CREATE UNIQUE INDEX "StaffOperatorRun_active_specimen" ON "StaffOperatorRun"("specimenId")
  WHERE state IN ('QUEUED','RUNNING','WAITING_TOOL','UNKNOWN');

CREATE TABLE "StaffOperatorAttempt" (
  id uuid PRIMARY KEY, "runId" uuid NOT NULL REFERENCES "StaffOperatorRun"(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL, "runRevision" integer NOT NULL, "leaseFence" integer NOT NULL, "dispatchClaimId" uuid NOT NULL UNIQUE,
  "requestCanonical" text NOT NULL, "requestHash" varchar(64) NOT NULL, "providerBindingHash" varchar(64) NOT NULL,
  "reservedMicroUsd" bigint NOT NULL, "usageCeilingMicroUsd" bigint, "usageEnvelopeExceeded" boolean NOT NULL DEFAULT false,
  "actualMicroUsd" bigint, "costEvidenceHash" varchar(64),
  state text NOT NULL DEFAULT 'RESERVED', "resultReceiptId" uuid UNIQUE,
  "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), "dispatchedAt" timestamp(3), "finishedAt" timestamp(3),
  UNIQUE("runId",ordinal),
  CONSTRAINT "StaffOperatorAttempt_shape" CHECK ((ordinal>0 AND "runRevision">0 AND "leaseFence">0
    AND "providerBindingHash" ~ '^[a-f0-9]{64}$' AND octet_length("requestCanonical")<=12582912
    AND jsonb_typeof("requestCanonical"::jsonb)='object'
    AND "requestHash"=encode(sha256(convert_to("requestCanonical",'UTF8')),'hex')
    AND "reservedMicroUsd" BETWEEN 1 AND 1000000000000 AND ("usageCeilingMicroUsd" IS NULL OR "usageCeilingMicroUsd" BETWEEN 0 AND 1000000000000)
    AND (("actualMicroUsd" IS NULL AND "costEvidenceHash" IS NULL)
      OR ("actualMicroUsd" BETWEEN 0 AND 1000000000000 AND "costEvidenceHash" ~ '^[a-f0-9]{64}$'))
    AND state IN ('RESERVED','DISPATCHED','RECEIVED','APPLIED','UNKNOWN','FAILED')
    AND ((state='RESERVED' AND "dispatchedAt" IS NULL AND "finishedAt" IS NULL)
      OR (state='DISPATCHED' AND "dispatchedAt" IS NOT NULL AND "finishedAt" IS NULL)
      OR (state IN ('RECEIVED','APPLIED') AND "dispatchedAt" IS NOT NULL AND "finishedAt" IS NOT NULL AND "resultReceiptId" IS NOT NULL)
      OR (state IN ('UNKNOWN','FAILED') AND "finishedAt" IS NOT NULL))) IS TRUE)
);
CREATE TABLE "StaffOperatorReceipt" (
  id uuid PRIMARY KEY, "attemptId" uuid NOT NULL REFERENCES "StaffOperatorAttempt"(id) ON DELETE RESTRICT,
  canonical text NOT NULL, hash varchar(64) NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  UNIQUE("attemptId",hash),
  CONSTRAINT "StaffOperatorReceipt_shape" CHECK ((octet_length(canonical)<=2162688 AND jsonb_typeof(canonical::jsonb)='object'
    AND hash=encode(sha256(convert_to(canonical,'UTF8')),'hex')) IS TRUE)
);
ALTER TABLE "StaffOperatorAttempt" ADD CONSTRAINT "StaffOperatorAttempt_receipt_fkey" FOREIGN KEY("resultReceiptId")
  REFERENCES "StaffOperatorReceipt"(id) ON DELETE RESTRICT;
CREATE TABLE "StaffOperatorStep" (
  id uuid PRIMARY KEY, "runId" uuid NOT NULL REFERENCES "StaffOperatorRun"(id) ON DELETE RESTRICT,
  "attemptId" uuid NOT NULL UNIQUE REFERENCES "StaffOperatorAttempt"(id) ON DELETE RESTRICT, revision integer NOT NULL,
  "callId" varchar(160) NOT NULL, "toolName" varchar(80) NOT NULL,
  "requestCanonical" text NOT NULL, "requestHash" varchar(64) NOT NULL,
  "resultCanonical" text NOT NULL, "resultHash" varchar(64) NOT NULL, "nextInputHash" varchar(64) NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), UNIQUE("runId",revision), UNIQUE("runId","callId"),
  CONSTRAINT "StaffOperatorStep_shape" CHECK ((revision>1 AND length("callId")>0
    AND "toolName" IN ('read_card_report','inspect_region','propose_identity','propose_finding_change','submit_for_human_review')
    AND octet_length("requestCanonical")<=65536 AND octet_length("resultCanonical")<=12582912
    AND "requestHash"=encode(sha256(convert_to("requestCanonical",'UTF8')),'hex')
    AND "resultHash"=encode(sha256(convert_to("resultCanonical",'UTF8')),'hex') AND "nextInputHash" ~ '^[a-f0-9]{64}$') IS TRUE)
);
CREATE TABLE "StaffOperatorOutbox" (
  id uuid PRIMARY KEY, "runId" uuid NOT NULL REFERENCES "StaffOperatorRun"(id) ON DELETE RESTRICT,
  revision integer NOT NULL, type text NOT NULL, payload text NOT NULL, "payloadHash" varchar(64) NOT NULL,
  state text NOT NULL DEFAULT 'PENDING', "claimOwner" uuid, "claimFence" integer NOT NULL DEFAULT 0,
  "claimUntil" timestamp(3), "deliveredAt" timestamp(3), "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  UNIQUE("runId",revision,type),
  CONSTRAINT "StaffOperatorOutbox_shape" CHECK ((revision>0 AND type IN ('HUMAN_REVIEW_READY','OPERATOR_ATTENTION_REQUIRED')
    AND octet_length(payload)<=8192 AND jsonb_typeof(payload::jsonb)='object'
    AND "payloadHash"=encode(sha256(convert_to(payload,'UTF8')),'hex') AND state IN ('PENDING','CLAIMED','DELIVERED')
    AND "claimFence">=0 AND ((state='PENDING' AND "claimOwner" IS NULL AND "claimUntil" IS NULL AND "deliveredAt" IS NULL)
      OR (state='CLAIMED' AND "claimOwner" IS NOT NULL AND "claimUntil" IS NOT NULL AND "deliveredAt" IS NULL)
      OR (state='DELIVERED' AND "claimOwner" IS NOT NULL AND "claimUntil" IS NOT NULL AND "deliveredAt" IS NOT NULL))) IS TRUE)
);

DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['StaffOperatorControl','StaffOperatorRun','StaffOperatorAttempt','StaffOperatorReceipt','StaffOperatorStep','StaffOperatorOutbox'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON atlas_staff.%I FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable()',name||'_no_delete',name);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON atlas_staff.%I FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable()',name||'_no_truncate',name);
    EXECUTE format('REVOKE ALL ON atlas_staff.%I FROM PUBLIC',name);
  END LOOP;
  FOREACH name IN ARRAY ARRAY['StaffOperatorReceipt','StaffOperatorStep'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON atlas_staff.%I FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable()',name||'_immutable',name);
  END LOOP;
END $$;

-- One accounting gate for the existing worker and the new Astra transport.
-- A verified usage ceiling is conservative accounting, not an invoice claim.
CREATE FUNCTION atlas_staff.pilot_budget_usage(pilot uuid, specimen uuid)
RETURNS TABLE(total text, card text, operations integer, attempts integer, overrun boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  WITH costs AS (
    SELECT o."specimenId" AS specimen, coalesce(e."actualMicroUsd",e."reservedMicroUsd") AS cost,
      coalesce(e."actualMicroUsd">e."reservedMicroUsd",false) AS overrun, true AS worker
    FROM atlas_staff."StaffGradingExecution" e JOIN atlas_staff."StaffGradingOperation" o ON o.id=e."operationId"
    WHERE e."pilotId"=pilot
    UNION ALL
    SELECT r."specimenId", CASE WHEN a.state='FAILED' AND a."dispatchedAt" IS NULL THEN 0
      ELSE coalesce(a."actualMicroUsd",a."usageCeilingMicroUsd",a."reservedMicroUsd") END,
      a."usageEnvelopeExceeded" OR coalesce(a."usageCeilingMicroUsd">a."reservedMicroUsd",false)
        OR coalesce(a."actualMicroUsd">coalesce(a."usageCeilingMicroUsd",a."reservedMicroUsd"),false), false
    FROM atlas_staff."StaffOperatorAttempt" a JOIN atlas_staff."StaffOperatorRun" r ON r.id=a."runId" WHERE r."pilotId"=pilot
  ) SELECT coalesce(sum(cost),0)::text, coalesce(sum(cost) FILTER(WHERE costs.specimen=pilot_budget_usage.specimen),0)::text,
    count(*) FILTER(WHERE costs.specimen=pilot_budget_usage.specimen AND worker)::integer,
    count(*) FILTER(WHERE costs.specimen=pilot_budget_usage.specimen AND NOT worker)::integer,
    coalesce(bool_or(costs.overrun),false) FROM costs;
$$;
CREATE FUNCTION atlas_staff.operator_budget_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE b atlas_staff."StaffGradingBridgeControl"%ROWTYPE; p jsonb; specimen uuid; pilot uuid; u record;
  r atlas_staff."StaffOperatorRun"%ROWTYPE; c atlas_staff."StaffOperatorControl"%ROWTYPE; ap jsonb; expected bigint;
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
CREATE TRIGGER "StaffGradingExecution_shared_budget" BEFORE INSERT ON "StaffGradingExecution"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_budget_guard();
CREATE TRIGGER "StaffOperatorAttempt_shared_budget" BEFORE INSERT ON "StaffOperatorAttempt"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_budget_guard();

CREATE FUNCTION atlas_staff.operator_run_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'QUEUED' OR NEW.revision<>1 OR NEW."leaseFence"<>0 OR NEW."leaseOwner" IS NOT NULL THEN
      RAISE EXCEPTION 'ATLAS operator requires a fresh queue entry'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['revision','state','inputCanonical','inputHash','leaseOwner','leaseFence','leaseMode','leaseExpiresAt','summary','failureCode','updatedAt'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision','state','inputCanonical','inputHash','leaseOwner','leaseFence','leaseMode','leaseExpiresAt','summary','failureCode','updatedAt'])
    OR NEW.revision NOT IN (OLD.revision,OLD.revision+1)
    OR (NEW.revision=OLD.revision AND (NEW."inputCanonical",NEW."inputHash") IS DISTINCT FROM (OLD."inputCanonical",OLD."inputHash"))
    OR OLD.state IN ('READY_FOR_HUMAN','NEEDS_RECAPTURE','NEEDS_EXPERT','FAILED') THEN
      RAISE EXCEPTION 'ATLAS operator scope or completed run is immutable'; END IF;
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
CREATE TRIGGER "StaffOperatorRun_guard" BEFORE INSERT OR UPDATE ON "StaffOperatorRun"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_run_guard();

CREATE FUNCTION atlas_staff.operator_attempt_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperatorRun"%ROWTYPE; c atlas_staff."StaffOperatorControl"%ROWTYPE; receipt atlas_staff."StaffOperatorReceipt"%ROWTYPE;
  now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC'; body jsonb; ap jsonb; input_tokens bigint; output_tokens bigint; expected bigint;
BEGIN
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=NEW."runId";
  IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.state='RESERVED' AND NEW.state='DISPATCHED') THEN
    SELECT * INTO c FROM atlas_staff."StaffOperatorControl" WHERE id='active' FOR SHARE;
    IF (r.state='RUNNING' AND r."leaseMode"='WORK' AND r."leaseExpiresAt">now_at AND r."deadlineAt">now_at
      AND c.enabled AND r."policyHash"=c."policyHash" AND r."runtimeHash"=c."configHash" AND NEW."providerBindingHash"=c."providerBindingHash"
      AND NEW."runRevision"=r.revision AND NEW."leaseFence"=r."leaseFence"
      AND NEW."requestCanonical"::jsonb->'input'=r."inputCanonical"::jsonb
      AND NEW."requestCanonical"::jsonb->>'model'='gpt-6-astra'
      AND NEW."requestCanonical"::jsonb->>'store'='false') IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS current dispatch scope required'; END IF;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'RESERVED' OR NEW."actualMicroUsd" IS NOT NULL OR NEW."usageCeilingMicroUsd" IS NOT NULL OR NEW."usageEnvelopeExceeded"
      OR EXISTS (SELECT 1 FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=r.id AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN')) THEN
      RAISE EXCEPTION 'ATLAS operator already has unresolved work'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['state','usageCeilingMicroUsd','usageEnvelopeExceeded','actualMicroUsd','costEvidenceHash','resultReceiptId','dispatchedAt','finishedAt'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','usageCeilingMicroUsd','usageEnvelopeExceeded','actualMicroUsd','costEvidenceHash','resultReceiptId','dispatchedAt','finishedAt'])
    OR (OLD."actualMicroUsd" IS NOT NULL AND (NEW."actualMicroUsd",NEW."costEvidenceHash") IS DISTINCT FROM (OLD."actualMicroUsd",OLD."costEvidenceHash"))
    OR (OLD."usageCeilingMicroUsd" IS NOT NULL AND NEW."usageCeilingMicroUsd" IS DISTINCT FROM OLD."usageCeilingMicroUsd")
    OR (OLD."usageEnvelopeExceeded" AND NOT NEW."usageEnvelopeExceeded")
    OR (OLD."resultReceiptId" IS NOT NULL AND NEW."resultReceiptId" IS DISTINCT FROM OLD."resultReceiptId")
    OR (OLD."dispatchedAt" IS NOT NULL AND NEW."dispatchedAt" IS DISTINCT FROM OLD."dispatchedAt")
    OR (OLD."finishedAt" IS NOT NULL AND NEW."finishedAt" IS DISTINCT FROM OLD."finishedAt") THEN
      RAISE EXCEPTION 'ATLAS operator execution and observed cost are immutable'; END IF;
  IF NEW.state<>OLD.state AND NOT ((OLD.state='RESERVED' AND NEW.state IN ('DISPATCHED','FAILED'))
    OR (OLD.state='DISPATCHED' AND NEW.state IN ('RECEIVED','UNKNOWN')) OR (OLD.state='UNKNOWN' AND NEW.state='RECEIVED')
    OR (OLD.state='RECEIVED' AND NEW.state='APPLIED')) THEN RAISE EXCEPTION 'ATLAS operator cannot redispatch'; END IF;
  IF NEW."resultReceiptId" IS NOT NULL THEN
    SELECT * INTO receipt FROM atlas_staff."StaffOperatorReceipt" WHERE id=NEW."resultReceiptId";
    IF receipt."attemptId" IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'ATLAS receipt belongs to another attempt'; END IF;
  END IF;
  IF NEW."usageCeilingMicroUsd" IS NOT NULL THEN
    body:=receipt.canonical::jsonb->'body'; ap:=r."policyCanonical"::jsonb->'astra';
    input_tokens:=(body->'usage'->>'input_tokens')::bigint; output_tokens:=(body->'usage'->>'output_tokens')::bigint;
    expected:=ceil((input_tokens::numeric*(ap->>'inputNanoUsdPerToken')::bigint
      +output_tokens::numeric*(ap->>'outputNanoUsdPerToken')::bigint)/1000)::bigint;
    IF (receipt.canonical::jsonb->>'state'='RECEIVED' AND receipt.canonical::jsonb->>'httpStatus'='200'
      AND body->>'model'=ap->>'returnedModel' AND body->>'service_tier'='default'
      AND input_tokens>=0 AND output_tokens>=0 AND (body->'usage'->>'total_tokens')::bigint=input_tokens+output_tokens
      AND NEW."usageCeilingMicroUsd"=expected
      AND NEW."usageEnvelopeExceeded"=(input_tokens>922000 OR output_tokens>(ap->>'maxOutputTokens')::bigint)) IS NOT TRUE THEN
        RAISE EXCEPTION 'ATLAS usage accounting requires its immutable provider receipt'; END IF;
  ELSIF NEW."usageEnvelopeExceeded" THEN RAISE EXCEPTION 'ATLAS usage overrun requires observed usage'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffOperatorAttempt_guard" BEFORE INSERT OR UPDATE ON "StaffOperatorAttempt"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_attempt_guard();

CREATE FUNCTION atlas_staff.operator_commit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperatorRun"%ROWTYPE; s atlas_staff."StaffSpecimen"%ROWTYPE; c atlas_staff."StaffOperatorControl"%ROWTYPE;
  b atlas_staff."StaffGradingBridgeControl"%ROWTYPE; sc atlas_staff."StaffControl"%ROWTYPE; step atlas_staff."StaffOperatorStep"%ROWTYPE;
  a atlas_staff."StaffOperatorAttempt"%ROWTYPE; receipt jsonb; p jsonb; run_id uuid;
BEGIN
  IF TG_TABLE_NAME='StaffOperatorRun' THEN run_id:=NEW.id; ELSE run_id:=NEW."runId"; END IF;
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=run_id;
  SELECT * INTO s FROM atlas_staff."StaffSpecimen" WHERE id=r."specimenId";
  SELECT * INTO c FROM atlas_staff."StaffOperatorControl" WHERE id='active' FOR SHARE;
  SELECT * INTO b FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE;
  SELECT * INTO sc FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  p:=c."policyCanonical"::jsonb;
  IF (c.enabled AND b.enabled AND sc.enabled AND c.mode=b.mode AND c.mode=sc.mode
    AND r."policyHash"=c."policyHash" AND r."runtimeHash"=c."configHash"
    AND r."gradingPolicyHash"=b."gradingPolicyHash" AND r."gradingPolicyHash"=sc."gradingPolicyHash"
    AND p->>'pilotId'=r."pilotId"::text AND b."policyCanonical"::jsonb->>'pilotId'=r."pilotId"::text
    AND b."policyCanonical"::jsonb->'specimenIds' ? s.id::text
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
CREATE CONSTRAINT TRIGGER "StaffOperatorRun_admission" AFTER INSERT ON "StaffOperatorRun" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_commit_guard();
CREATE CONSTRAINT TRIGGER "StaffOperatorRun_transition" AFTER UPDATE ON "StaffOperatorRun" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN(NEW.revision<>OLD.revision) EXECUTE FUNCTION atlas_staff.operator_commit_guard();
CREATE CONSTRAINT TRIGGER "StaffOperatorAttempt_applied" AFTER UPDATE ON "StaffOperatorAttempt" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN(NEW.state='APPLIED' AND OLD.state<>NEW.state) EXECUTE FUNCTION atlas_staff.operator_commit_guard();
CREATE CONSTRAINT TRIGGER "StaffOperatorStep_atomic" AFTER INSERT ON "StaffOperatorStep" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_commit_guard();
CREATE CONSTRAINT TRIGGER "StaffOperatorOutbox_atomic" AFTER INSERT ON "StaffOperatorOutbox" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_commit_guard();

CREATE FUNCTION atlas_staff.operator_outbox_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'PENDING' OR NEW."claimFence"<>0 THEN RAISE EXCEPTION 'ATLAS outbox starts pending'; END IF; RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['state','claimOwner','claimFence','claimUntil','deliveredAt'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','claimOwner','claimFence','claimUntil','deliveredAt']) OR OLD.state='DELIVERED'
    OR NOT ((NEW.state='CLAIMED' AND NEW."claimFence"=OLD."claimFence"+1
      AND (OLD.state='PENDING' OR OLD."claimUntil"<=clock_timestamp() AT TIME ZONE 'UTC')
      AND NEW."claimUntil">clock_timestamp() AT TIME ZONE 'UTC' AND NEW."claimUntil"<=(clock_timestamp() AT TIME ZONE 'UTC')+interval '60 seconds')
      OR (OLD.state='CLAIMED' AND NEW.state='DELIVERED' AND NEW."claimOwner"=OLD."claimOwner" AND NEW."claimFence"=OLD."claimFence"
        AND NEW."claimUntil"=OLD."claimUntil" AND OLD."claimUntil">clock_timestamp() AT TIME ZONE 'UTC')) THEN
    RAISE EXCEPTION 'ATLAS outbox claim is stale or immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffOperatorOutbox_guard" BEFORE INSERT OR UPDATE ON "StaffOperatorOutbox"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_outbox_guard();

CREATE FUNCTION atlas_staff.lock_operator_control() RETURNS SETOF atlas_staff."StaffOperatorControl"
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$ SELECT * FROM atlas_staff."StaffOperatorControl" WHERE id='active' FOR SHARE $$;
CREATE FUNCTION atlas_staff.lock_operator_bridge_control() RETURNS SETOF atlas_staff."StaffGradingBridgeControl"
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$ SELECT * FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE $$;
CREATE FUNCTION atlas_staff.lock_operator_specimen(specimen uuid) RETURNS SETOF atlas_staff."StaffSpecimen"
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$ SELECT * FROM atlas_staff."StaffSpecimen" WHERE id=specimen FOR SHARE $$;
REVOKE ALL ON FUNCTION atlas_staff.pilot_budget_usage(uuid,uuid), atlas_staff.lock_operator_control(),
  atlas_staff.lock_operator_bridge_control(),atlas_staff.lock_operator_specimen(uuid) FROM PUBLIC;

CREATE FUNCTION atlas_staff.operator_work_pending(specimen uuid) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_staff AS $$
  SELECT count(*)::integer FROM atlas_staff."StaffOperatorRun" WHERE "specimenId"=specimen AND state IN ('QUEUED','RUNNING','WAITING_TOOL','UNKNOWN');
$$;
REVOKE ALL ON FUNCTION atlas_staff.operator_work_pending(uuid) FROM PUBLIC;
CREATE FUNCTION atlas_staff.operator_human_interlock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE specimen uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0));
  IF TG_TABLE_NAME='StaffSpecimen' THEN
    specimen:=NEW.id;
    IF (NEW."analysisRevision",NEW."draftRevision") IS NOT DISTINCT FROM (OLD."analysisRevision",OLD."draftRevision") THEN RETURN NEW; END IF;
  ELSE specimen:=NEW."specimenId"; END IF;
  IF atlas_staff.operator_work_pending(specimen)>0 THEN RAISE EXCEPTION 'ATLAS operator work is unresolved'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StaffSpecimen_operator_interlock" BEFORE UPDATE ON "StaffSpecimen"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_human_interlock();
CREATE TRIGGER "StaffReportApproval_operator_interlock" BEFORE INSERT ON "StaffReportApproval"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_human_interlock();
CREATE TRIGGER "StaffGradingOperation_operator_interlock" BEFORE INSERT ON "StaffGradingOperation"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.operator_human_interlock();
COMMIT;
