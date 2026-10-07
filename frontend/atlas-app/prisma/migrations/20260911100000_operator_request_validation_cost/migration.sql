-- Keep every dispatch/immutability/accounting check while avoiding repeated
-- JSON decoding of the same image-bearing request inside a 10-second transaction.
BEGIN;
SET LOCAL search_path=atlas_staff,pg_catalog;

CREATE OR REPLACE FUNCTION atlas_staff.operator_attempt_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,atlas_staff AS $$
DECLARE r atlas_staff."StaffOperatorRun"%ROWTYPE; c atlas_staff."StaffOperatorControl"%ROWTYPE; receipt atlas_staff."StaffOperatorReceipt"%ROWTYPE;
  now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC'; body jsonb; ap jsonb; input_tokens bigint; output_tokens bigint; expected bigint;
BEGIN
  SELECT * INTO r FROM atlas_staff."StaffOperatorRun" WHERE id=NEW."runId";
  IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.state='RESERVED' AND NEW.state='DISPATCHED') THEN
    -- Parse the image-bearing request once for this dispatch-scope check.
    body:=NEW."requestCanonical"::jsonb;
    SELECT * INTO c FROM atlas_staff."StaffOperatorControl" WHERE id='active' FOR SHARE;
    IF (r.state='RUNNING' AND r."leaseMode"='WORK' AND r."leaseExpiresAt">now_at AND r."deadlineAt">now_at
      AND c.enabled AND r."policyHash"=c."policyHash" AND r."runtimeHash"=c."configHash" AND NEW."providerBindingHash"=c."providerBindingHash"
      AND NEW."runRevision"=r.revision AND NEW."leaseFence"=r."leaseFence"
      AND body->'input'=r."inputCanonical"::jsonb
      AND body->>'model'='gpt-6-astra'
      AND body->>'store'='false') IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS current dispatch scope required'; END IF;
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
  IF OLD.state IN ('DISPATCHED','UNKNOWN') AND NEW.state='ABANDONED' THEN
    IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') OR NOT EXISTS(
      SELECT 1 FROM atlas_staff."StaffOperatorAttemptAbandonment" g
      WHERE g."attemptId"=NEW.id AND g."runId"=r.id AND g."runRevision"=r.revision AND g."leaseFence"=r."leaseFence"
        AND g."controlRevision"=r."controlRevision"+1 AND g.xmin::text=pg_current_xact_id()::text
        AND g.canonical::jsonb#>>'{binding,run,inputHash}'=r."inputHash"
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(g.canonical::jsonb#>'{binding,attempts}') x
          WHERE x=(to_jsonb(OLD)-'requestCanonical'))
        AND NOT EXISTS(SELECT 1 FROM atlas_staff."StaffOperatorStep" WHERE "attemptId"=NEW.id)) THEN
      RAISE EXCEPTION 'ASTRA_ABANDONMENT_EXACT_PROOF_REQUIRED'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.state='ABANDONED' AND (NEW.state<>'ABANDONED' OR NEW."finishedAt" IS DISTINCT FROM OLD."finishedAt") THEN
    RAISE EXCEPTION 'ASTRA_ABANDONED_EXECUTION_IMMUTABLE'; END IF;
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

COMMIT;
