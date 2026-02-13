ALTER TABLE "CardAsset"
  ADD COLUMN "backgroundRemovedAt" TIMESTAMP(3);

ALTER TABLE "CardPhoto"
  ADD COLUMN "backgroundRemovedAt" TIMESTAMP(3);
