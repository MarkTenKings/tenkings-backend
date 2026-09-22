-- Private append-only staff comparison decisions. No inventory, price, catalog,
-- accounting, provider or original research-result mutation is introduced.
BEGIN;
CREATE TABLE "StaffInventoryResearchReviewV2" (
  "requestId" text PRIMARY KEY CHECK ("requestId" ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'),
  "jobId" text NOT NULL REFERENCES "StaffInventoryResearchJobV2"("id") ON DELETE RESTRICT,
  "unitId" text NOT NULL CHECK (length("unitId") BETWEEN 1 AND 200 AND btrim("unitId") = "unitId" AND "unitId" !~ '[[:cntrl:]]'),
  "descriptionEventId" text NOT NULL REFERENCES "InventoryWorkflowEventV2"("id") ON DELETE RESTRICT,
  "inputHash" text NOT NULL CHECK ("inputHash" ~ '^[a-f0-9]{64}$'),
  "resultHash" text NOT NULL CHECK ("resultHash" ~ '^[a-f0-9]{64}$'),
  "expectedRevision" integer NOT NULL CHECK ("expectedRevision" BETWEEN 0 AND 2147483645),
  "revision" integer NOT NULL CHECK ("revision" = "expectedRevision" + 1 AND "revision" BETWEEN 1 AND 2147483646),
  "candidateId" text NOT NULL CHECK ("candidateId" ~ '^ebay:[0-9]{6,20}$'),
  "decision" text NOT NULL CHECK ("decision" IN ('confirmed', 'excluded')),
  "actorId" text NOT NULL CHECK (length("actorId") BETWEEN 1 AND 200 AND btrim("actorId") = "actorId" AND "actorId" !~ '[[:cntrl:]]'),
  "reviewedAt" timestamptz(3) NOT NULL,
  "request" text NOT NULL CHECK (octet_length("request") <= 4096),
  "requestHash" text NOT NULL CHECK ("requestHash" = encode(sha256(convert_to("request", 'UTF8')), 'hex')),
  "content" text NOT NULL CHECK (octet_length("content") <= 1024),
  "contentHash" text NOT NULL CHECK ("contentHash" = encode(sha256(convert_to("content", 'UTF8')), 'hex')),
  CONSTRAINT "StaffInventoryResearchReviewV2_job_revision_key" UNIQUE ("jobId", "revision"),
  CHECK (("request"::jsonb = jsonb_build_object('actor', "actorId", 'command', jsonb_build_object(
    'requestId', "requestId", 'jobId', "jobId", 'unitId', "unitId", 'descriptionEventId', "descriptionEventId", 'inputHash', "inputHash", 'resultHash', "resultHash",
    'expectedRevision', "expectedRevision", 'candidateId', "candidateId", 'decision', "decision"))) IS TRUE),
  CHECK (("content"::jsonb = jsonb_build_object('request_hash', "requestHash", 'revision', "revision", 'reviewed_at', to_char("reviewedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) IS TRUE)
);
CREATE INDEX "StaffInventoryResearchReviewV2_latest_candidate_idx" ON "StaffInventoryResearchReviewV2"("jobId", "candidateId", "revision" DESC);

CREATE FUNCTION "staffInventoryResearchReviewV2Insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job "StaffInventoryResearchJobV2"%ROWTYPE; head integer; last_time timestamptz; candidate jsonb;
BEGIN
  SELECT * INTO job FROM "StaffInventoryResearchJobV2" WHERE "id" = NEW."jobId" FOR UPDATE;
  IF NOT FOUND OR job."status" <> 'complete' OR job."unitId" <> NEW."unitId" OR job."descriptionEventId" <> NEW."descriptionEventId"
    OR job."inputHash" <> NEW."inputHash" OR job."resultHash" IS DISTINCT FROM NEW."resultHash" THEN RAISE EXCEPTION 'Review must bind current completed research'; END IF;
  IF NOT ((job."result"::jsonb -> 'estimate' ->> 'status' = 'estimated') IS TRUE)
    OR NOT ((job."result"::jsonb -> 'selected_candidate_ids') @> jsonb_build_array(NEW."candidateId")) THEN RAISE EXCEPTION 'Review cannot promote an unselected comparison'; END IF;
  SELECT value INTO candidate FROM jsonb_array_elements(job."result"::jsonb -> 'candidates') WHERE value ->> 'id' = NEW."candidateId";
  IF NOT ((candidate ->> 'source_eligible' = 'true' AND candidate ->> 'sold_price_cents' IS NOT NULL AND candidate -> 'image' ->> 'sha256' IS NOT NULL) IS TRUE) THEN RAISE EXCEPTION 'Review requires eligible sale evidence'; END IF;
  SELECT COALESCE(MAX("revision"), 0), MAX("reviewedAt") INTO head, last_time FROM "StaffInventoryResearchReviewV2" WHERE "jobId" = NEW."jobId";
  IF NEW."expectedRevision" <> head OR NEW."revision" <> head + 1 THEN RAISE EXCEPTION 'Review revision changed'; END IF;
  IF NEW."reviewedAt" > clock_timestamp() + interval '1 second' OR NEW."reviewedAt" < job."completedAt" OR NEW."reviewedAt" < last_time THEN RAISE EXCEPTION 'Review timestamp is invalid'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "StaffInventoryResearchReviewV2_insert" BEFORE INSERT ON "StaffInventoryResearchReviewV2" FOR EACH ROW EXECUTE FUNCTION "staffInventoryResearchReviewV2Insert"();
CREATE FUNCTION "staffInventoryResearchReviewV2Immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Staff research review events are append-only'; END;
$$;
CREATE TRIGGER "StaffInventoryResearchReviewV2_preserve" BEFORE UPDATE OR DELETE ON "StaffInventoryResearchReviewV2" FOR EACH ROW EXECUTE FUNCTION "staffInventoryResearchReviewV2Immutable"();
CREATE TRIGGER "StaffInventoryResearchReviewV2_no_truncate" BEFORE TRUNCATE ON "StaffInventoryResearchReviewV2" FOR EACH STATEMENT EXECUTE FUNCTION "staffInventoryResearchReviewV2Immutable"();

CREATE FUNCTION "staffInventoryResearchReviewedResultV2Immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD."result", OLD."resultHash") IS DISTINCT FROM ROW(NEW."result", NEW."resultHash")
    AND EXISTS (SELECT 1 FROM "StaffInventoryResearchReviewV2" WHERE "jobId" = OLD."id") THEN RAISE EXCEPTION 'Reviewed research result is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "StaffInventoryResearchJobV2_reviewed_result" BEFORE UPDATE ON "StaffInventoryResearchJobV2" FOR EACH ROW EXECUTE FUNCTION "staffInventoryResearchReviewedResultV2Immutable"();
COMMIT;
