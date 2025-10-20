-- Add optional image and details columns to Item
ALTER TABLE "Item"
  ADD COLUMN "imageUrl" TEXT,
  ADD COLUMN "thumbnailUrl" TEXT,
  ADD COLUMN "detailsJson" JSONB;
