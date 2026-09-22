-- Additive bounded recovery on the existing job. Existing result, attempt,
-- manual retry and staff review evidence is untouched.
BEGIN;
ALTER TABLE "StaffInventoryResearchJobV2"
  ADD COLUMN "recoveryState" text,
  ADD COLUMN "recoveryStateHash" text,
  ADD COLUMN "recoveryNextCheckAt" timestamptz(3) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "recoveryLeaseToken" text,
  ADD COLUMN "recoveryLeaseExpiresAt" timestamptz(3),
  ADD CONSTRAINT "StaffInventoryResearchRecoveryV2_hash" CHECK (("recoveryState" IS NULL) = ("recoveryStateHash" IS NULL) AND ("recoveryState" IS NULL OR
    (octet_length("recoveryState") <= 524288 AND "recoveryStateHash" = encode(sha256(convert_to("recoveryState", 'UTF8')), 'hex')))),
  ADD CONSTRAINT "StaffInventoryResearchRecoveryV2_state" CHECK ("recoveryState" IS NULL OR (
    "recoveryState"::jsonb ->> 'schema_version' = '1' AND "recoveryState"::jsonb ->> 'status' IN ('pending','checking_details','waiting_catalog_evidence','needs_staff_review','waiting_new_evidence','research_queued','resolved','limit_reached')
    AND jsonb_typeof("recoveryState"::jsonb -> 'photo_attempts') = 'array' AND jsonb_array_length("recoveryState"::jsonb -> 'photo_attempts') <= 2
    AND jsonb_typeof("recoveryState"::jsonb -> 'source_attempts') = 'array' AND jsonb_array_length("recoveryState"::jsonb -> 'source_attempts') <= 1
    AND jsonb_typeof("recoveryState"::jsonb -> 'scope_attempts') = 'array' AND jsonb_array_length("recoveryState"::jsonb -> 'scope_attempts') <= 2
    AND jsonb_typeof("recoveryState"::jsonb -> 'refreshes') = 'array' AND jsonb_array_length("recoveryState"::jsonb -> 'refreshes') <= 3
  ) IS TRUE),
  ADD CONSTRAINT "StaffInventoryResearchRecoveryV2_lease" CHECK (("recoveryLeaseToken" IS NULL) = ("recoveryLeaseExpiresAt" IS NULL)
    AND ("recoveryLeaseToken" IS NULL OR ("status" IN ('queued','complete','failed') AND "recoveryState"::jsonb ->> 'status' = 'checking_details'
      AND "recoveryLeaseToken" ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')));
CREATE INDEX "StaffInventoryResearchRecoveryV2_due" ON "StaffInventoryResearchJobV2" ("recoveryNextCheckAt", "id") WHERE "status" IN ('queued','complete','failed');
CREATE INDEX "StaffInventoryResearchRecoveryV2_source_demand" ON "StaffInventoryResearchJobV2" USING GIN (("recoveryState"::jsonb -> 'source_attempts') jsonb_path_ops);
CREATE FUNCTION "staffInventoryResearchRecoveryV2Preserve"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior jsonb; next_state jsonb; entry jsonb; i integer; history_key text;
BEGIN
  IF OLD."recoveryState" IS NOT NULL THEN
    IF NEW."recoveryState" IS NULL THEN RAISE EXCEPTION 'Recovery evidence cannot be removed'; END IF;
    prior := OLD."recoveryState"::jsonb; next_state := NEW."recoveryState"::jsonb;
    FOREACH history_key IN ARRAY ARRAY['photo_attempts', 'scope_attempts', 'source_attempts', 'refreshes'] LOOP
      IF jsonb_array_length(next_state -> history_key) < jsonb_array_length(prior -> history_key) THEN RAISE EXCEPTION 'Recovery history is append-only'; END IF;
      FOR i IN 0..jsonb_array_length(prior -> history_key) - 1 LOOP
        IF next_state -> history_key -> i IS DISTINCT FROM prior -> history_key -> i THEN RAISE EXCEPTION 'Recovery authority is immutable'; END IF;
      END LOOP;
    END LOOP;
    IF prior #> '{assessment,recognition,evidence}' IS NOT NULL AND prior #> '{assessment,recognition,evidence}' <> 'null'::jsonb
      AND next_state #> '{assessment,recognition,evidence}' IS DISTINCT FROM prior #> '{assessment,recognition,evidence}' THEN RAISE EXCEPTION 'Original-photo recognition receipt is immutable'; END IF;
    IF prior #> '{assessment,source_discovery}' IS NOT NULL AND next_state #> '{assessment,source_discovery}' IS DISTINCT FROM prior #> '{assessment,source_discovery}' THEN RAISE EXCEPTION 'Source discovery receipt is immutable'; END IF;
  END IF;
  IF NEW."recoveryState" IS NOT NULL THEN
    next_state := NEW."recoveryState"::jsonb;
    FOR entry IN SELECT value FROM jsonb_array_elements(next_state -> 'refreshes') LOOP
      IF NOT ((entry -> 'assessment' ->> 'source_input_sha256' = NEW."inputHash" AND entry -> 'assessment' ->> 'description_event_id' = NEW."descriptionEventId"
        AND entry -> 'assessment' ->> 'description_hash' = NEW."descriptionHash" AND entry ->> 'evidence_sha256' = entry -> 'assessment' ->> 'evidence_sha256'
        AND entry -> 'assessment' ->> 'ready_for_research' = 'true' AND (entry ->> 'attempt_count')::integer BETWEEN 0 AND 8) IS TRUE) THEN RAISE EXCEPTION 'Recovery refresh must bind exact supported evidence'; END IF;
    END LOOP;
    IF (SELECT count(*) <> count(DISTINCT value ->> 'evidence_sha256') FROM jsonb_array_elements(next_state -> 'refreshes')) THEN RAISE EXCEPTION 'Recovery evidence may authorize only one refresh'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "StaffInventoryResearchRecoveryV2_preserve" BEFORE UPDATE ON "StaffInventoryResearchJobV2" FOR EACH ROW EXECUTE FUNCTION "staffInventoryResearchRecoveryV2Preserve"();
COMMIT;
