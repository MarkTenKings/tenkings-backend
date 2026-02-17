-- CreateTable
CREATE TABLE "OcrFeedbackEvent" (
    "id" TEXT NOT NULL,
    "cardAssetId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "modelValue" TEXT,
    "humanValue" TEXT,
    "wasCorrect" BOOLEAN NOT NULL,
    "setId" TEXT,
    "year" TEXT,
    "manufacturer" TEXT,
    "sport" TEXT,
    "cardNumber" TEXT,
    "numbered" TEXT,
    "tokenRefsJson" JSONB,
    "modelVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrFeedbackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OcrFeedbackEvent_cardAssetId_createdAt_idx" ON "OcrFeedbackEvent"("cardAssetId", "createdAt");

-- CreateIndex
CREATE INDEX "OcrFeedbackEvent_fieldName_wasCorrect_createdAt_idx" ON "OcrFeedbackEvent"("fieldName", "wasCorrect", "createdAt");

-- CreateIndex
CREATE INDEX "OcrFeedbackEvent_setId_year_manufacturer_idx" ON "OcrFeedbackEvent"("setId", "year", "manufacturer");

-- AddForeignKey
ALTER TABLE "OcrFeedbackEvent" ADD CONSTRAINT "OcrFeedbackEvent_cardAssetId_fkey" FOREIGN KEY ("cardAssetId") REFERENCES "CardAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
