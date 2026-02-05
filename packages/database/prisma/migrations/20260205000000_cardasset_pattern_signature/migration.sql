ALTER TABLE "CardAsset"
ADD COLUMN "patternSignatureJson" JSONB,
ADD COLUMN "patternSignatureUpdatedAt" TIMESTAMP(3);
