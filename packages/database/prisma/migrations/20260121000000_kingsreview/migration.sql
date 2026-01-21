-- KingsReview stages and evidence items

DO $$
BEGIN
  CREATE TYPE "CardReviewStage" AS ENUM ('READY_FOR_HUMAN_REVIEW', 'ESCALATED_REVIEW', 'REVIEW_COMPLETE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "CardEvidenceKind" AS ENUM ('SEARCH_PAGE', 'SOLD_COMP', 'MARKET_COMP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "CardAsset"
  ADD COLUMN IF NOT EXISTS "reviewStage" "CardReviewStage",
  ADD COLUMN IF NOT EXISTS "reviewStageUpdatedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "CardEvidenceItem" (
  "id" TEXT PRIMARY KEY,
  "cardAssetId" TEXT NOT NULL,
  "kind" "CardEvidenceKind" NOT NULL DEFAULT 'SOLD_COMP',
  "source" TEXT NOT NULL,
  "title" TEXT,
  "url" TEXT NOT NULL,
  "screenshotUrl" TEXT,
  "price" TEXT,
  "soldDate" TEXT,
  "note" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CardEvidenceItem_cardAssetId_fkey"
    FOREIGN KEY ("cardAssetId") REFERENCES "CardAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CardEvidenceItem_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CardEvidenceItem_cardAssetId_kind_idx" ON "CardEvidenceItem" ("cardAssetId", "kind");
CREATE INDEX IF NOT EXISTS "CardEvidenceItem_createdById_idx" ON "CardEvidenceItem" ("createdById");
