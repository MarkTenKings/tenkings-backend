ALTER TABLE "CardAsset"
  ADD COLUMN "cdnHdUrl" TEXT,
  ADD COLUMN "cdnThumbUrl" TEXT;

ALTER TABLE "CardPhoto"
  ADD COLUMN "cdnHdUrl" TEXT,
  ADD COLUMN "cdnThumbUrl" TEXT;

ALTER TABLE "Item"
  ADD COLUMN "cdnHdUrl" TEXT,
  ADD COLUMN "cdnThumbUrl" TEXT;
