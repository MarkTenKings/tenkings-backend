-- CreateEnum
CREATE TYPE "SetReplaceJobStatus" AS ENUM (
  'QUEUED',
  'VALIDATING_PREVIEW',
  'DELETING_SET',
  'CREATING_DRAFT',
  'APPROVING_DRAFT',
  'SEEDING_SET',
  'COMPLETE',
  'FAILED',
  'CANCELLED'
);

-- CreateTable
CREATE TABLE "SetReplaceJob" (
  "id" TEXT NOT NULL,
  "setId" TEXT NOT NULL,
  "datasetType" "SetDatasetType" NOT NULL,
  "status" "SetReplaceJobStatus" NOT NULL DEFAULT 'QUEUED',
  "previewHash" TEXT NOT NULL,
  "runArgsJson" JSONB,
  "progressJson" JSONB,
  "resultJson" JSONB,
  "logsJson" JSONB,
  "errorMessage" TEXT,
  "reason" TEXT,
  "requestedById" TEXT,
  "ingestionJobId" TEXT,
  "draftId" TEXT,
  "draftVersionId" TEXT,
  "approvalId" TEXT,
  "seedJobId" TEXT,
  "activeSetLock" TEXT,
  "cancelRequestedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SetReplaceJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SetReplaceJob_activeSetLock_key" ON "SetReplaceJob"("activeSetLock");

-- CreateIndex
CREATE INDEX "SetReplaceJob_setId_createdAt_idx" ON "SetReplaceJob"("setId", "createdAt");

-- CreateIndex
CREATE INDEX "SetReplaceJob_status_createdAt_idx" ON "SetReplaceJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SetReplaceJob_requestedById_createdAt_idx" ON "SetReplaceJob"("requestedById", "createdAt");
