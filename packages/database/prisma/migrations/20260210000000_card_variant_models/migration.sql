-- Card Variant taxonomy + reference library + decisions

CREATE TABLE IF NOT EXISTS "CardVariant" (
  "id" TEXT PRIMARY KEY,
  "setId" TEXT NOT NULL,
  "cardNumber" TEXT NOT NULL,
  "parallelId" TEXT NOT NULL,
  "parallelFamily" TEXT,
  "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "CardVariant_setId_cardNumber_parallelId_key"
  ON "CardVariant" ("setId", "cardNumber", "parallelId");
CREATE INDEX IF NOT EXISTS "CardVariant_setId_cardNumber_idx"
  ON "CardVariant" ("setId", "cardNumber");

CREATE TABLE IF NOT EXISTS "CardVariantReferenceImage" (
  "id" TEXT PRIMARY KEY,
  "setId" TEXT NOT NULL,
  "parallelId" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "rawImageUrl" TEXT NOT NULL,
  "cropUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "cropEmbeddings" JSONB,
  "qualityScore" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "CardVariantReferenceImage_setId_parallelId_idx"
  ON "CardVariantReferenceImage" ("setId", "parallelId");

CREATE TABLE IF NOT EXISTS "CardVariantDecision" (
  "id" TEXT PRIMARY KEY,
  "cardAssetId" TEXT NOT NULL,
  "candidatesJson" JSONB NOT NULL,
  "selectedParallelId" TEXT,
  "confidence" DOUBLE PRECISION,
  "humanOverride" BOOLEAN NOT NULL DEFAULT false,
  "humanNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CardVariantDecision_cardAssetId_fkey"
    FOREIGN KEY ("cardAssetId") REFERENCES "CardAsset"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CardVariantDecision_cardAssetId_idx"
  ON "CardVariantDecision" ("cardAssetId");

ALTER TABLE "CardAsset"
  ADD COLUMN IF NOT EXISTS "variantId" TEXT,
  ADD COLUMN IF NOT EXISTS "variantConfidence" DOUBLE PRECISION;
