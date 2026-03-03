-- AlterTable
ALTER TABLE "SetCard"
  ADD COLUMN "team" TEXT,
  ADD COLUMN "isRookie" BOOLEAN,
  ADD COLUMN "metadataJson" JSONB;

-- AlterTable
ALTER TABLE "SetParallel"
  ADD COLUMN "visualCuesJson" JSONB;

-- AlterTable
ALTER TABLE "SetOddsByFormat"
  ADD COLUMN "oddsNumeric" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "SetCard_setId_team_idx" ON "SetCard"("setId", "team");
