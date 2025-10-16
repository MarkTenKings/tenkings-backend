ALTER TABLE "CardAsset"
  ADD COLUMN "ebaySoldUrlVariant" TEXT,
  ADD COLUMN "ebaySoldUrlHighGrade" TEXT,
  ADD COLUMN "ebaySoldUrlPlayerComp" TEXT,
  ADD COLUMN "humanReviewedAt" TIMESTAMP(3),
  ADD COLUMN "humanReviewedById" TEXT;

ALTER TABLE "CardAsset"
  ADD CONSTRAINT "CardAsset_humanReviewedById_fkey"
  FOREIGN KEY ("humanReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
