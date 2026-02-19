ALTER TABLE "CardVariantReferenceImage"
  ADD COLUMN IF NOT EXISTS "listingTitle" TEXT,
  ADD COLUMN IF NOT EXISTS "qualityGateScore" INTEGER,
  ADD COLUMN IF NOT EXISTS "qualityGateStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "qualityGateReasonsJson" JSONB;

CREATE INDEX IF NOT EXISTS "CardVariantReferenceImage_setId_parallelId_qualityGateStatus_idx"
  ON "CardVariantReferenceImage" ("setId", "parallelId", "qualityGateStatus");
