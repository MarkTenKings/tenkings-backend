-- CreateTable
CREATE TABLE "OcrFeedbackMemoryAggregate" (
    "id" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "valueKey" TEXT NOT NULL,
    "setId" TEXT,
    "setIdKey" TEXT NOT NULL DEFAULT '',
    "year" TEXT,
    "yearKey" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT,
    "manufacturerKey" TEXT NOT NULL DEFAULT '',
    "sport" TEXT,
    "sportKey" TEXT NOT NULL DEFAULT '',
    "cardNumber" TEXT,
    "cardNumberKey" TEXT NOT NULL DEFAULT '',
    "numbered" TEXT,
    "numberedKey" TEXT NOT NULL DEFAULT '',
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "confidencePrior" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aliasValuesJson" JSONB,
    "tokenAnchorsJson" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcrFeedbackMemoryAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ocr_mem_agg_ctx_value_uidx" ON "OcrFeedbackMemoryAggregate"("fieldName", "valueKey", "setIdKey", "yearKey", "manufacturerKey", "sportKey", "cardNumberKey", "numberedKey");

-- CreateIndex
CREATE INDEX "ocr_mem_agg_year_manu_sport_idx" ON "OcrFeedbackMemoryAggregate"("fieldName", "yearKey", "manufacturerKey", "sportKey", "lastSeenAt");

-- CreateIndex
CREATE INDEX "ocr_mem_agg_set_card_idx" ON "OcrFeedbackMemoryAggregate"("fieldName", "setIdKey", "cardNumberKey", "lastSeenAt");
