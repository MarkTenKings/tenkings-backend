-- AlterTable
ALTER TABLE "CardAsset"
  ADD COLUMN "classificationSourcesJson" JSONB,
  ADD COLUMN "ebaySoldUrlAiGrade" TEXT,
  ADD COLUMN "aiGradingJson" JSONB,
  ADD COLUMN "aiGradeFinal" DOUBLE PRECISION,
  ADD COLUMN "aiGradeLabel" TEXT,
  ADD COLUMN "aiGradePsaEquivalent" INTEGER,
  ADD COLUMN "aiGradeRangeLow" INTEGER,
  ADD COLUMN "aiGradeRangeHigh" INTEGER,
  ADD COLUMN "aiGradeGeneratedAt" TIMESTAMP(3);
