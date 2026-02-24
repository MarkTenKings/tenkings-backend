-- CreateTable
CREATE TABLE "OcrRegionTemplate" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "setIdKey" TEXT NOT NULL DEFAULT '',
    "layoutClass" TEXT NOT NULL,
    "layoutClassKey" TEXT NOT NULL DEFAULT '',
    "photoSide" TEXT NOT NULL,
    "photoSideKey" TEXT NOT NULL DEFAULT '',
    "regionsJson" JSONB NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcrRegionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ocr_region_template_scope_uidx"
ON "OcrRegionTemplate"("setIdKey", "layoutClassKey", "photoSideKey");

-- CreateIndex
CREATE INDEX "ocr_region_template_set_layout_idx"
ON "OcrRegionTemplate"("setIdKey", "layoutClassKey");

-- CreateIndex
CREATE INDEX "ocr_region_template_side_idx"
ON "OcrRegionTemplate"("photoSideKey");

-- AddForeignKey
ALTER TABLE "OcrRegionTemplate"
ADD CONSTRAINT "OcrRegionTemplate_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
