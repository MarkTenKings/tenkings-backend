ALTER TABLE "CardVariantReferenceImage"
  ADD COLUMN IF NOT EXISTS "cardNumber" TEXT;

-- Backfill from playerSeed format: "Player Name::CardNumber"
UPDATE "CardVariantReferenceImage"
SET "cardNumber" = NULLIF(split_part(COALESCE("playerSeed", ''), '::', 2), '')
WHERE "cardNumber" IS NULL
  AND COALESCE("playerSeed", '') <> '';

CREATE INDEX IF NOT EXISTS "CardVariantReferenceImage_setId_cardNumber_parallelId_idx"
  ON "CardVariantReferenceImage"("setId", "cardNumber", "parallelId");

CREATE INDEX IF NOT EXISTS "CardVariantReferenceImage_setId_cardNumber_parallelId_refType_idx"
  ON "CardVariantReferenceImage"("setId", "cardNumber", "parallelId", "refType");
