-- CreateTable
CREATE TABLE "InventoryBatch" (
    "id" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "label" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBatch_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "CardAsset" ADD COLUMN     "inventoryBatchId" TEXT,
ADD COLUMN     "inventoryAssignedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "InventoryBatch_locationId_idx" ON "InventoryBatch"("locationId");

-- CreateIndex
CREATE INDEX "InventoryBatch_createdById_idx" ON "InventoryBatch"("createdById");

-- CreateIndex
CREATE INDEX "CardAsset_inventoryBatchId_idx" ON "CardAsset"("inventoryBatchId");

-- AddForeignKey
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAsset" ADD CONSTRAINT "CardAsset_inventoryBatchId_fkey" FOREIGN KEY ("inventoryBatchId") REFERENCES "InventoryBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
