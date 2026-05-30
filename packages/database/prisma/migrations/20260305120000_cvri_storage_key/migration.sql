-- Ensure clean databases have the current CardVariantReferenceImage storage key column
-- before variant program identity backfills duplicate reference rows.

ALTER TABLE "CardVariantReferenceImage"
  ADD COLUMN IF NOT EXISTS "storageKey" TEXT;

CREATE INDEX IF NOT EXISTS "CardVariantReferenceImage_storageKey_idx"
  ON "CardVariantReferenceImage" ("storageKey");
