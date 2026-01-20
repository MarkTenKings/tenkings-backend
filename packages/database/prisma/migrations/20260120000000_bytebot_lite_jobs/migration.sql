-- Bytebot-lite job queue

DO $$
BEGIN
  CREATE TYPE "BytebotLiteJobStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'COMPLETE', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "BytebotLiteJob" (
  "id" TEXT PRIMARY KEY,
  "cardAssetId" TEXT,
  "status" "BytebotLiteJobStatus" NOT NULL DEFAULT 'QUEUED',
  "searchQuery" TEXT NOT NULL,
  "sources" TEXT[] NOT NULL,
  "maxComps" INTEGER NOT NULL DEFAULT 5,
  "maxAgeDays" INTEGER NOT NULL DEFAULT 730,
  "payload" JSONB,
  "result" JSONB,
  "errorMessage" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BytebotLiteJob_cardAssetId_fkey"
    FOREIGN KEY ("cardAssetId") REFERENCES "CardAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "BytebotLiteJob_status_createdAt_idx" ON "BytebotLiteJob" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "BytebotLiteJob_cardAssetId_idx" ON "BytebotLiteJob" ("cardAssetId");

-- ensure updatedAt auto-maintains via trigger (fallback for manual updates)
CREATE OR REPLACE FUNCTION update_bytebot_lite_job_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bytebot_lite_job_updated_at ON "BytebotLiteJob";
CREATE TRIGGER bytebot_lite_job_updated_at
  BEFORE UPDATE ON "BytebotLiteJob"
  FOR EACH ROW
  EXECUTE FUNCTION update_bytebot_lite_job_updated_at();
