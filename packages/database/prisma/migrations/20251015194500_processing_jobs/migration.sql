-- Processing jobs pipeline scaffolding

DO $$
BEGIN
  CREATE TYPE "ProcessingJobType" AS ENUM ('OCR', 'CLASSIFY', 'VALUATION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "ProcessingJobStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'COMPLETE', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "CardAsset"
  ADD COLUMN IF NOT EXISTS "processingStartedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "processingCompletedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ProcessingJob" (
  "id" TEXT PRIMARY KEY,
  "cardAssetId" TEXT NOT NULL,
  "type" "ProcessingJobType" NOT NULL,
  "status" "ProcessingJobStatus" NOT NULL DEFAULT 'QUEUED',
  "payload" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "lockedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcessingJob_cardAssetId_fkey"
    FOREIGN KEY ("cardAssetId") REFERENCES "CardAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProcessingJob_status_type_idx" ON "ProcessingJob" ("status", "type");
CREATE INDEX IF NOT EXISTS "ProcessingJob_cardAssetId_idx" ON "ProcessingJob" ("cardAssetId");

-- ensure updatedAt auto-maintains via trigger (fallback for manual updates)
CREATE OR REPLACE FUNCTION update_processing_job_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS processing_job_updated_at ON "ProcessingJob";
CREATE TRIGGER processing_job_updated_at
  BEFORE UPDATE ON "ProcessingJob"
  FOR EACH ROW
  EXECUTE FUNCTION update_processing_job_updated_at();
