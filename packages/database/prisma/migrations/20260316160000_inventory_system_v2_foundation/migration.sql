DO $$
BEGIN
  ALTER TYPE "CollectibleCategory" ADD VALUE IF NOT EXISTS 'ONE_PIECE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TYPE "PackTier" ADD VALUE IF NOT EXISTS 'TIER_250';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- CreateEnum
CREATE TYPE "InventoryBatchStage" AS ENUM ('ASSIGNED', 'SHIPPED', 'LOADED');

-- CreateEnum
CREATE TYPE "AutoFillSessionStatus" AS ENUM ('GENERATED', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PackRecipeItemType" AS ENUM ('PROMOTIONAL', 'MERCH', 'COUPON', 'OTHER');

-- AlterTable
ALTER TABLE "CardAsset"
ADD COLUMN     "category" "CollectibleCategory",
ADD COLUMN     "subCategory" TEXT;

-- AlterTable
ALTER TABLE "InventoryBatch"
ADD COLUMN     "stage" "InventoryBatchStage" NOT NULL DEFAULT 'ASSIGNED',
ADD COLUMN     "category" "CollectibleCategory",
ADD COLUMN     "tier" "PackTier",
ADD COLUMN     "stageChangedAt" TIMESTAMP(3),
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "loadedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PackCalculatorConfig" (
    "id" TEXT NOT NULL,
    "category" "CollectibleCategory",
    "discountRate" DOUBLE PRECISION NOT NULL DEFAULT 0.80,
    "packCost" INTEGER NOT NULL DEFAULT 60,
    "slabCost" INTEGER NOT NULL DEFAULT 50,
    "laborPackPerCard" INTEGER NOT NULL DEFAULT 25,
    "laborStockPerPack" INTEGER NOT NULL DEFAULT 15,
    "locationRevenueShare" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "merchantProcessingFee" DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    "lossRate" DOUBLE PRECISION NOT NULL DEFAULT 0.04,
    "bonusCardsPerPack" INTEGER NOT NULL DEFAULT 3,
    "bonusCardAvgCost" INTEGER NOT NULL DEFAULT 200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackCalculatorConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoFillProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "category" "CollectibleCategory",
    "hitRate" DOUBLE PRECISION NOT NULL DEFAULT 0.12,
    "solidRate" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "standardRate" DOUBLE PRECISION NOT NULL DEFAULT 0.63,
    "hitMultiplierMin" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "hitMultiplierMax" DOUBLE PRECISION NOT NULL DEFAULT 4.0,
    "solidRangeMin" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "solidRangeMax" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "standardRangeMin" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "standardRangeMax" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "bonusCardsPerPack" INTEGER NOT NULL DEFAULT 3,
    "bonusCardMaxValue" INTEGER NOT NULL DEFAULT 300,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoFillProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoFillSession" (
    "id" TEXT NOT NULL,
    "category" "CollectibleCategory" NOT NULL,
    "packTier" "PackTier" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "locationId" UUID NOT NULL,
    "targetMarginPercent" DOUBLE PRECISION NOT NULL,
    "calculatorResult" JSONB NOT NULL,
    "proposedGroupings" JSONB NOT NULL,
    "finalGroupings" JSONB,
    "status" "AutoFillSessionStatus" NOT NULL DEFAULT 'GENERATED',
    "inventoryBatchId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "AutoFillSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackRecipe" (
    "id" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "category" "CollectibleCategory" NOT NULL,
    "tier" "PackTier" NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "slabCardsPerPack" INTEGER NOT NULL DEFAULT 1,
    "bonusCardsPerPack" INTEGER NOT NULL DEFAULT 2,
    "bonusCardMaxValue" INTEGER NOT NULL DEFAULT 300,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "PackRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackRecipeItem" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "itemType" "PackRecipeItemType" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "costPerUnit" INTEGER NOT NULL DEFAULT 0,
    "isSeasonal" BOOLEAN NOT NULL DEFAULT false,
    "seasonStart" TIMESTAMP(3),
    "seasonEnd" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackRecipeItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardAsset_reviewStage_inventoryBatchId_idx" ON "CardAsset"("reviewStage", "inventoryBatchId");

-- CreateIndex
CREATE INDEX "CardAsset_category_reviewStage_inventoryBatchId_idx" ON "CardAsset"("category", "reviewStage", "inventoryBatchId");

-- CreateIndex
CREATE INDEX "CardAsset_valuationMinor_idx" ON "CardAsset"("valuationMinor");

-- CreateIndex
CREATE INDEX "CardAsset_inventoryAssignedAt_idx" ON "CardAsset"("inventoryAssignedAt");

-- CreateIndex
CREATE INDEX "InventoryBatch_locationId_stage_idx" ON "InventoryBatch"("locationId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "PackCalculatorConfig_category_key" ON "PackCalculatorConfig"("category");

-- CreateIndex
CREATE UNIQUE INDEX "AutoFillProfile_category_key" ON "AutoFillProfile"("category");

-- CreateIndex
CREATE INDEX "AutoFillSession_locationId_idx" ON "AutoFillSession"("locationId");

-- CreateIndex
CREATE INDEX "AutoFillSession_inventoryBatchId_idx" ON "AutoFillSession"("inventoryBatchId");

-- CreateIndex
CREATE INDEX "AutoFillSession_status_idx" ON "AutoFillSession"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PackRecipe_locationId_category_tier_key" ON "PackRecipe"("locationId", "category", "tier");

-- CreateIndex
CREATE INDEX "PackRecipe_locationId_idx" ON "PackRecipe"("locationId");

-- CreateIndex
CREATE INDEX "PackRecipe_isActive_idx" ON "PackRecipe"("isActive");

-- CreateIndex
CREATE INDEX "PackRecipeItem_recipeId_idx" ON "PackRecipeItem"("recipeId");

-- AddForeignKey
ALTER TABLE "AutoFillSession" ADD CONSTRAINT "AutoFillSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoFillSession" ADD CONSTRAINT "AutoFillSession_inventoryBatchId_fkey" FOREIGN KEY ("inventoryBatchId") REFERENCES "InventoryBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoFillSession" ADD CONSTRAINT "AutoFillSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackRecipe" ADD CONSTRAINT "PackRecipe_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackRecipe" ADD CONSTRAINT "PackRecipe_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackRecipeItem" ADD CONSTRAINT "PackRecipeItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "PackRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
