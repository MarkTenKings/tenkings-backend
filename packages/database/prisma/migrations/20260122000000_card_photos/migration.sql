-- Card photo storage

DO $$
BEGIN
  CREATE TYPE "CardPhotoKind" AS ENUM (
    'FRONT',
    'BACK',
    'TILT',
    'CLOSEUP_SERIAL',
    'CLOSEUP_CARD_NUMBER',
    'CLOSEUP_LOGO_TEXT',
    'CLOSEUP_FOIL_STAMP',
    'AUTOGRAPH',
    'PATCH',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "CardPhoto" (
  "id" TEXT PRIMARY KEY,
  "cardAssetId" TEXT NOT NULL,
  "kind" "CardPhotoKind" NOT NULL DEFAULT 'FRONT',
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "mimeType" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CardPhoto_cardAssetId_fkey"
    FOREIGN KEY ("cardAssetId") REFERENCES "CardAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CardPhoto_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CardPhoto_cardAssetId_kind_idx" ON "CardPhoto" ("cardAssetId", "kind");
CREATE INDEX IF NOT EXISTS "CardPhoto_createdById_idx" ON "CardPhoto" ("createdById");
