-- CreateTable
CREATE TABLE "OcrEvalCase" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cardAssetId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hintsJson" JSONB,
    "expectedJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcrEvalCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrEvalRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "trigger" TEXT NOT NULL,
    "thresholdsJson" JSONB,
    "summaryJson" JSONB,
    "totalsJson" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcrEvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrEvalResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "cardAssetId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "fieldScoresJson" JSONB,
    "expectedJson" JSONB,
    "predictedJson" JSONB,
    "auditJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrEvalResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OcrEvalCase_slug_key" ON "OcrEvalCase"("slug");

-- CreateIndex
CREATE INDEX "OcrEvalCase_enabled_updatedAt_idx" ON "OcrEvalCase"("enabled", "updatedAt");

-- CreateIndex
CREATE INDEX "OcrEvalCase_cardAssetId_idx" ON "OcrEvalCase"("cardAssetId");

-- CreateIndex
CREATE INDEX "OcrEvalRun_createdAt_idx" ON "OcrEvalRun"("createdAt");

-- CreateIndex
CREATE INDEX "OcrEvalRun_status_createdAt_idx" ON "OcrEvalRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ocr_eval_result_run_case_uidx" ON "OcrEvalResult"("runId", "caseId");

-- CreateIndex
CREATE INDEX "ocr_eval_result_run_pass_idx" ON "OcrEvalResult"("runId", "passed");

-- CreateIndex
CREATE INDEX "ocr_eval_result_case_created_idx" ON "OcrEvalResult"("caseId", "createdAt");

-- AddForeignKey
ALTER TABLE "OcrEvalResult" ADD CONSTRAINT "OcrEvalResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "OcrEvalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrEvalResult" ADD CONSTRAINT "OcrEvalResult_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "OcrEvalCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
