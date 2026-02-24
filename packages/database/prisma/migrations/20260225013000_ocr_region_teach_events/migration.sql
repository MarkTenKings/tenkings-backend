-- CreateTable
CREATE TABLE "OcrRegionTeachEvent" (
    "id" TEXT NOT NULL,
    "cardAssetId" TEXT,
    "setId" TEXT,
    "setIdKey" TEXT NOT NULL DEFAULT '',
    "layoutClass" TEXT,
    "layoutClassKey" TEXT NOT NULL DEFAULT '',
    "photoSide" TEXT,
    "photoSideKey" TEXT NOT NULL DEFAULT '',
    "eventType" TEXT NOT NULL,
    "regionCount" INTEGER NOT NULL DEFAULT 0,
    "templatesUpdated" INTEGER NOT NULL DEFAULT 0,
    "snapshotStorageKey" TEXT,
    "snapshotImageUrl" TEXT,
    "debugPayloadJson" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrRegionTeachEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ocr_region_teach_event_created_idx" ON "OcrRegionTeachEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ocr_region_teach_event_type_created_idx" ON "OcrRegionTeachEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "ocr_region_teach_event_set_layout_idx" ON "OcrRegionTeachEvent"("setIdKey", "layoutClassKey", "createdAt");

-- CreateIndex
CREATE INDEX "ocr_region_teach_event_card_idx" ON "OcrRegionTeachEvent"("cardAssetId", "createdAt");

-- AddForeignKey
ALTER TABLE "OcrRegionTeachEvent" ADD CONSTRAINT "OcrRegionTeachEvent_cardAssetId_fkey" FOREIGN KEY ("cardAssetId") REFERENCES "CardAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrRegionTeachEvent" ADD CONSTRAINT "OcrRegionTeachEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
