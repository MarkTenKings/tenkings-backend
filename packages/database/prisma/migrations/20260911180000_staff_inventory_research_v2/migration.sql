-- Additive private proposals only. Existing inventory/financial journals are unchanged.
BEGIN;
CREATE TABLE "StaffInventoryResearchJobV2" (
  "id" text PRIMARY KEY,
  "unitId" text NOT NULL CHECK (length("unitId") BETWEEN 1 AND 200),
  "descriptionEventId" text NOT NULL REFERENCES "InventoryWorkflowEventV2"("id") ON DELETE RESTRICT,
  "descriptionHash" text NOT NULL CHECK ("descriptionHash" ~ '^[a-f0-9]{64}$'),
  "inputHash" text NOT NULL CHECK ("inputHash" ~ '^[a-f0-9]{64}$'),
  "input" text NOT NULL CHECK (octet_length("input") <= 16384),
  "status" text NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued','running','complete','failed','superseded')),
  "attemptCount" integer NOT NULL DEFAULT 0,
  "maxAttempts" integer NOT NULL DEFAULT 3,
  "leaseToken" text,
  "leaseExpiresAt" timestamptz(3),
  "nextAttemptAt" timestamptz(3) NOT NULL,
  "createdAt" timestamptz(3) NOT NULL,
  "updatedAt" timestamptz(3) NOT NULL,
  "startedAt" timestamptz(3),
  "completedAt" timestamptz(3),
  "errorCode" text,
  "errorMessage" text,
  "result" text CHECK (octet_length("result") <= 524288),
  "resultHash" text,
  "attempts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "retries" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "startRequestId" text UNIQUE,
  "requestedBy" text CHECK (length("requestedBy") BETWEEN 1 AND 200),
  CHECK (("startRequestId" IS NULL) = ("requestedBy" IS NULL)),
  CHECK ("attemptCount" BETWEEN 0 AND "maxAttempts" AND "maxAttempts" BETWEEN 1 AND 9),
  CHECK (("status" = 'running') = ("leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)),
  CHECK (("leaseToken" IS NULL) = ("leaseExpiresAt" IS NULL)),
  CHECK ("leaseToken" IS NULL OR ("startedAt" IS NOT NULL AND "leaseExpiresAt" > "startedAt" AND "leaseExpiresAt" <= "startedAt" + interval '5 minutes')),
  CHECK (("errorCode" IS NULL) = ("errorMessage" IS NULL)),
  CHECK ("errorCode" ~ '^[A-Z][A-Z0-9_]{0,63}$' AND length("errorMessage") <= 400 OR "errorCode" IS NULL),
  CHECK ("inputHash" = encode(sha256(convert_to("input", 'UTF8')), 'hex')),
  CHECK (("input"::jsonb ->> 'schema_version' = '1' AND "input"::jsonb ->> 'unit_id' = "unitId" AND "input"::jsonb ->> 'description_event_id' = "descriptionEventId" AND "input"::jsonb ->> 'description_hash' = "descriptionHash") IS TRUE),
  CHECK (("result" IS NULL) = ("resultHash" IS NULL)),
  CHECK ("result" IS NULL OR ("resultHash" = encode(sha256(convert_to("result", 'UTF8')), 'hex') AND "result"::jsonb ->> 'schema_version' = '1' AND "result"::jsonb ->> 'unit_id' = "unitId" AND "result"::jsonb ->> 'description_event_id' = "descriptionEventId" AND "result"::jsonb ->> 'description_hash' = "descriptionHash") IS TRUE),
  CHECK ("status" <> 'complete' OR "result" IS NOT NULL),
  CHECK (jsonb_typeof("attempts") = 'array' AND jsonb_array_length("attempts") <= 9 AND octet_length("attempts"::text) <= 5242880),
  CHECK (jsonb_typeof("retries") = 'array' AND jsonb_array_length("retries") <= 2),
  CONSTRAINT "StaffInventoryResearchJobV2_revision_key" UNIQUE ("unitId", "descriptionEventId", "inputHash")
);
CREATE UNIQUE INDEX "StaffInventoryResearchJobV2_current_unit" ON "StaffInventoryResearchJobV2"("unitId") WHERE "status" <> 'superseded';
CREATE INDEX "StaffInventoryResearchJobV2_status_nextAttemptAt_idx" ON "StaffInventoryResearchJobV2"("status", "nextAttemptAt");
CREATE INDEX "StaffInventoryResearchJobV2_unitId_createdAt_idx" ON "StaffInventoryResearchJobV2"("unitId", "createdAt");

CREATE FUNCTION "staffInventoryResearchV2PreserveEvidence"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i integer;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'Staff research evidence cannot be deleted'; END IF;
  IF ROW(OLD."id", OLD."unitId", OLD."descriptionEventId", OLD."descriptionHash", OLD."inputHash", OLD."input", OLD."createdAt", OLD."startRequestId", OLD."requestedBy")
     IS DISTINCT FROM ROW(NEW."id", NEW."unitId", NEW."descriptionEventId", NEW."descriptionHash", NEW."inputHash", NEW."input", NEW."createdAt", NEW."startRequestId", NEW."requestedBy") THEN
    RAISE EXCEPTION 'Staff research input revision is immutable';
  END IF;
  IF NEW."attemptCount" < OLD."attemptCount" OR NEW."maxAttempts" < OLD."maxAttempts" THEN RAISE EXCEPTION 'Staff research attempt bounds cannot decrease'; END IF;
  IF OLD."status" = 'superseded' AND NEW."status" = 'running' THEN RAISE EXCEPTION 'Superseded research must be revalidated before a fresh claim'; END IF;
  IF jsonb_array_length(NEW."attempts") < jsonb_array_length(OLD."attempts") OR jsonb_array_length(NEW."retries") < jsonb_array_length(OLD."retries") THEN RAISE EXCEPTION 'Staff research history is append-only'; END IF;
  FOR i IN 0..jsonb_array_length(OLD."attempts") - 1 LOOP
    IF NEW."attempts" -> i IS DISTINCT FROM OLD."attempts" -> i THEN RAISE EXCEPTION 'Staff research attempts are immutable'; END IF;
  END LOOP;
  FOR i IN 0..jsonb_array_length(OLD."retries") - 1 LOOP
    IF NEW."retries" -> i IS DISTINCT FROM OLD."retries" -> i THEN RAISE EXCEPTION 'Staff research retry authority is immutable'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "StaffInventoryResearchJobV2_preserve" BEFORE UPDATE OR DELETE ON "StaffInventoryResearchJobV2" FOR EACH ROW EXECUTE FUNCTION "staffInventoryResearchV2PreserveEvidence"();
CREATE TRIGGER "StaffInventoryResearchJobV2_no_truncate" BEFORE TRUNCATE ON "StaffInventoryResearchJobV2" FOR EACH STATEMENT EXECUTE FUNCTION "staffInventoryResearchV2PreserveEvidence"();

CREATE TABLE "StaffInventoryIntakeLeaseV2" (
  "id" text PRIMARY KEY,
  "createdAt" timestamptz(3) NOT NULL,
  "expiresAt" timestamptz(3) NOT NULL,
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '2 minutes')
);
CREATE INDEX "StaffInventoryIntakeLeaseV2_expiresAt_idx" ON "StaffInventoryIntakeLeaseV2"("expiresAt");
COMMIT;
