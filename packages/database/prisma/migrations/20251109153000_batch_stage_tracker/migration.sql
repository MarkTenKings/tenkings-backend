-- Create enum for batch stages
CREATE TYPE "BatchStage" AS ENUM (
  'INVENTORY_READY',
  'PACKING',
  'PACKED',
  'SHIPPING_READY',
  'SHIPPING_SHIPPED',
  'SHIPPING_RECEIVED',
  'LOADED'
);

-- Extend card batches with stage metadata
ALTER TABLE "CardBatch"
  ADD COLUMN "stage" "BatchStage" NOT NULL DEFAULT 'INVENTORY_READY',
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "stageChangedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

UPDATE "CardBatch"
SET "stage" = 'INVENTORY_READY',
    "stageChangedAt" = COALESCE("stageChangedAt", NOW());

-- Create batch stage history table
CREATE TABLE "BatchStageEvent" (
  "id" TEXT NOT NULL DEFAULT uuid_generate_v4(),
  "batchId" TEXT NOT NULL,
  "stage" "BatchStage" NOT NULL,
  "note" TEXT,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BatchStageEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BatchStageEvent_batchId_idx" ON "BatchStageEvent"("batchId");
CREATE INDEX "BatchStageEvent_stage_idx" ON "BatchStageEvent"("stage");

ALTER TABLE "BatchStageEvent"
  ADD CONSTRAINT "BatchStageEvent_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "CardBatch"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BatchStageEvent"
  ADD CONSTRAINT "BatchStageEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Create location restock confirmations
CREATE TABLE "LocationRestock" (
  "id" TEXT NOT NULL DEFAULT uuid_generate_v4(),
  "locationId" TEXT NOT NULL,
  "operatorId" TEXT,
  "countsJson" JSONB,
  "photoUrl" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LocationRestock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LocationRestock_locationId_idx" ON "LocationRestock"("locationId");
CREATE INDEX "LocationRestock_createdAt_idx" ON "LocationRestock"("createdAt");

ALTER TABLE "LocationRestock"
  ADD CONSTRAINT "LocationRestock_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LocationRestock"
  ADD CONSTRAINT "LocationRestock_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
