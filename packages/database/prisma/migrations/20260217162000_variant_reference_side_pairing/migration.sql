ALTER TABLE "CardVariantReferenceImage"
  ADD COLUMN IF NOT EXISTS "refType" TEXT NOT NULL DEFAULT 'front',
  ADD COLUMN IF NOT EXISTS "pairKey" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceListingId" TEXT,
  ADD COLUMN IF NOT EXISTS "playerSeed" TEXT;

CREATE INDEX IF NOT EXISTS "CardVariantReferenceImage_setId_parallelId_refType_idx"
  ON "CardVariantReferenceImage"("setId", "parallelId", "refType");

CREATE INDEX IF NOT EXISTS "CardVariantReferenceImage_pairKey_idx"
  ON "CardVariantReferenceImage"("pairKey");

CREATE INDEX IF NOT EXISTS "CardVariantReferenceImage_sourceListingId_idx"
  ON "CardVariantReferenceImage"("sourceListingId");
