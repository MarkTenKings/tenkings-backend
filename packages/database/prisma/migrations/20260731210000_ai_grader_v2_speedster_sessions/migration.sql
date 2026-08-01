CREATE TABLE "AiGraderV2Session" (
  "id" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "cardProfile" TEXT NOT NULL,
  "workflowState" TEXT NOT NULL DEFAULT 'DRAFT',
  "ruleVersion" TEXT NOT NULL,
  "publicReportSlug" TEXT,
  "identity" JSONB NOT NULL,
  "capture" JSONB NOT NULL,
  "reviewedDefects" JSONB NOT NULL,
  "gradeReport" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiGraderV2Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiGraderV2Session_publicReportSlug_key"
ON "AiGraderV2Session"("publicReportSlug");
