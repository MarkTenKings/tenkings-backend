-- Absolute lease/evidence instants must not depend on the connection time zone.
-- Isolated acquisition evidence. No approved SetOps/business rows are rewritten.
CREATE TABLE "SetCatalogDemandJob" (
  "demandKey" TEXT PRIMARY KEY CHECK ("demandKey" ~ '^[a-f0-9]{64}$'),
  "demandJson" JSONB NOT NULL CHECK (octet_length("demandJson"::text) <= 4096),
  state TEXT NOT NULL CHECK (state IN ('QUEUED','RUNNING','READY','UNAVAILABLE')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 3),
  "leaseToken" TEXT, "leaseUntil" TIMESTAMPTZ(3), "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resultHash" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((state = 'RUNNING') = ("leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL)),
  CHECK (state <> 'READY' OR "resultHash" IS NOT NULL)
);
CREATE TABLE "SetCatalogDemandResult" (
  "demandKey" TEXT NOT NULL REFERENCES "SetCatalogDemandJob"("demandKey") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "snapshotHash" TEXT NOT NULL CHECK ("snapshotHash" ~ '^[a-f0-9]{64}$'),
  "resultJson" JSONB NOT NULL CHECK (octet_length("resultJson"::text) <= 8388608),
  requests INTEGER NOT NULL CHECK (requests BETWEEN 0 AND 5), attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("demandKey","snapshotHash"), UNIQUE ("demandKey",attempt),
  CHECK ("resultJson"->>'demandKey' = "demandKey" AND "resultJson"->>'snapshotHash' = "snapshotHash"),
  CHECK ("resultJson"->>'state' IN ('READY','UNAVAILABLE'))
);
CREATE TABLE "SetCatalogDemandSource" (
  "demandKey" TEXT NOT NULL, "snapshotHash" TEXT NOT NULL, "sourceId" TEXT NOT NULL CHECK ("sourceId" ~ '^[a-f0-9]{64}$'),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'), "contentType" TEXT NOT NULL,
  bytes BYTEA NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 2097152),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("demandKey","snapshotHash","sourceId"),
  FOREIGN KEY ("demandKey","snapshotHash") REFERENCES "SetCatalogDemandResult"("demandKey","snapshotHash") ON DELETE RESTRICT ON UPDATE RESTRICT
);
ALTER TABLE "SetCatalogDemandJob" ADD CONSTRAINT "SetCatalogDemandJob_result_fk" FOREIGN KEY ("demandKey","resultHash")
  REFERENCES "SetCatalogDemandResult"("demandKey","snapshotHash") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "SetCatalogDemandJob_createdAt_idx" ON "SetCatalogDemandJob"("createdAt");
CREATE FUNCTION catalog_demand_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Catalog demand evidence is immutable'; END $$;
CREATE TRIGGER "SetCatalogDemandResult_immutable" BEFORE UPDATE OR DELETE ON "SetCatalogDemandResult" FOR EACH ROW EXECUTE FUNCTION catalog_demand_immutable();
CREATE TRIGGER "SetCatalogDemandSource_immutable" BEFORE UPDATE OR DELETE ON "SetCatalogDemandSource" FOR EACH ROW EXECUTE FUNCTION catalog_demand_immutable();
CREATE FUNCTION catalog_demand_job_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'DELETE' OR NEW."demandKey" IS DISTINCT FROM OLD."demandKey" OR NEW."demandJson" IS DISTINCT FROM OLD."demandJson"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW.attempt < OLD.attempt OR NEW.attempt > OLD.attempt + 1 THEN
    RAISE EXCEPTION 'Catalog demand identity and bounded attempt history are immutable';
  END IF; RETURN NEW; END $$;
CREATE TRIGGER "SetCatalogDemandJob_identity" BEFORE UPDATE OR DELETE ON "SetCatalogDemandJob" FOR EACH ROW EXECUTE FUNCTION catalog_demand_job_identity();

-- Explicit photo-sharing submissions remain pending human catalog review.
CREATE TABLE "SetCatalogReferenceSubmission" (
  "proposalId" TEXT PRIMARY KEY REFERENCES "SetCatalogObservationProposal"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "proposalSha256" TEXT NOT NULL CHECK ("proposalSha256" ~ '^[a-f0-9]{64}$'),
  "submissionSha256" TEXT NOT NULL CHECK ("submissionSha256" ~ '^[a-f0-9]{64}$'),
  "submissionJson" JSONB NOT NULL CHECK (octet_length("submissionJson"::text) <= 16384),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("submissionJson"->>'proposalSha256' = "proposalSha256" AND "submissionJson"->>'disposition' = 'requires_authorized_review')
);
CREATE TRIGGER "SetCatalogReferenceSubmission_immutable" BEFORE UPDATE OR DELETE ON "SetCatalogReferenceSubmission" FOR EACH ROW EXECUTE FUNCTION catalog_demand_immutable();
