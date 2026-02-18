ALTER TABLE "CardVariantReferenceImage"
  ADD COLUMN IF NOT EXISTS "qaStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "ownedStatus" TEXT NOT NULL DEFAULT 'external',
  ADD COLUMN IF NOT EXISTS "promotedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "CardVariantReferenceImage_qaStatus_ownedStatus_idx"
  ON "CardVariantReferenceImage"("qaStatus", "ownedStatus");
