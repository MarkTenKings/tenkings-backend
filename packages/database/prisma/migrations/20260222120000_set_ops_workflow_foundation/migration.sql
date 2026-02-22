-- CreateEnum
CREATE TYPE "SetDatasetType" AS ENUM ('PARALLEL_DB', 'PLAYER_WORKSHEET');

-- CreateEnum
CREATE TYPE "SetIngestionJobStatus" AS ENUM ('QUEUED', 'PARSED', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "SetDraftStatus" AS ENUM ('DRAFT', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SetApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SetSeedJobStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'COMPLETE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SetAuditStatus" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateTable
CREATE TABLE "SetDraft" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "normalizedLabel" TEXT,
    "status" "SetDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "archivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetIngestionJob" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "draftId" TEXT,
    "datasetType" "SetDatasetType" NOT NULL,
    "sourceUrl" TEXT,
    "rawPayload" JSONB,
    "parserVersion" TEXT NOT NULL,
    "status" "SetIngestionJobStatus" NOT NULL DEFAULT 'QUEUED',
    "parseSummaryJson" JSONB,
    "errorMessage" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "parsedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "SetIngestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetDraftVersion" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "versionHash" TEXT NOT NULL,
    "dataJson" JSONB NOT NULL,
    "validationJson" JSONB,
    "sourceLinksJson" JSONB,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "blockingErrorCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetDraftVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetApproval" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "draftVersionId" TEXT NOT NULL,
    "decision" "SetApprovalDecision" NOT NULL,
    "reason" TEXT,
    "diffSummaryJson" JSONB,
    "versionHash" TEXT NOT NULL,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetSeedJob" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "draftVersionId" TEXT,
    "status" "SetSeedJobStatus" NOT NULL DEFAULT 'QUEUED',
    "runArgsJson" JSONB,
    "progressJson" JSONB,
    "resultJson" JSONB,
    "logsJson" JSONB,
    "queueCount" INTEGER,
    "errorMessage" TEXT,
    "requestedById" TEXT,
    "retryOfId" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetSeedJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetAuditEvent" (
    "id" TEXT NOT NULL,
    "setId" TEXT,
    "draftId" TEXT,
    "draftVersionId" TEXT,
    "ingestionJobId" TEXT,
    "approvalId" TEXT,
    "seedJobId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "status" "SetAuditStatus" NOT NULL DEFAULT 'SUCCESS',
    "reason" TEXT,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SetDraft_setId_key" ON "SetDraft"("setId");

-- CreateIndex
CREATE INDEX "SetDraft_status_idx" ON "SetDraft"("status");

-- CreateIndex
CREATE INDEX "SetDraft_archivedAt_idx" ON "SetDraft"("archivedAt");

-- CreateIndex
CREATE INDEX "SetIngestionJob_setId_status_idx" ON "SetIngestionJob"("setId", "status");

-- CreateIndex
CREATE INDEX "SetIngestionJob_datasetType_status_idx" ON "SetIngestionJob"("datasetType", "status");

-- CreateIndex
CREATE INDEX "SetIngestionJob_draftId_idx" ON "SetIngestionJob"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "SetDraftVersion_draftId_version_key" ON "SetDraftVersion"("draftId", "version");

-- CreateIndex
CREATE INDEX "SetDraftVersion_draftId_createdAt_idx" ON "SetDraftVersion"("draftId", "createdAt");

-- CreateIndex
CREATE INDEX "SetDraftVersion_versionHash_idx" ON "SetDraftVersion"("versionHash");

-- CreateIndex
CREATE INDEX "SetApproval_draftId_createdAt_idx" ON "SetApproval"("draftId", "createdAt");

-- CreateIndex
CREATE INDEX "SetApproval_draftVersionId_idx" ON "SetApproval"("draftVersionId");

-- CreateIndex
CREATE INDEX "SetApproval_decision_createdAt_idx" ON "SetApproval"("decision", "createdAt");

-- CreateIndex
CREATE INDEX "SetSeedJob_draftId_status_idx" ON "SetSeedJob"("draftId", "status");

-- CreateIndex
CREATE INDEX "SetSeedJob_status_createdAt_idx" ON "SetSeedJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SetSeedJob_draftVersionId_idx" ON "SetSeedJob"("draftVersionId");

-- CreateIndex
CREATE INDEX "SetAuditEvent_setId_createdAt_idx" ON "SetAuditEvent"("setId", "createdAt");

-- CreateIndex
CREATE INDEX "SetAuditEvent_draftId_createdAt_idx" ON "SetAuditEvent"("draftId", "createdAt");

-- CreateIndex
CREATE INDEX "SetAuditEvent_action_createdAt_idx" ON "SetAuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "SetAuditEvent_status_createdAt_idx" ON "SetAuditEvent"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "SetDraft" ADD CONSTRAINT "SetDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetDraft" ADD CONSTRAINT "SetDraft_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetIngestionJob" ADD CONSTRAINT "SetIngestionJob_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SetDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetIngestionJob" ADD CONSTRAINT "SetIngestionJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetDraftVersion" ADD CONSTRAINT "SetDraftVersion_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SetDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetDraftVersion" ADD CONSTRAINT "SetDraftVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetApproval" ADD CONSTRAINT "SetApproval_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SetDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetApproval" ADD CONSTRAINT "SetApproval_draftVersionId_fkey" FOREIGN KEY ("draftVersionId") REFERENCES "SetDraftVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetApproval" ADD CONSTRAINT "SetApproval_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetSeedJob" ADD CONSTRAINT "SetSeedJob_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SetDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetSeedJob" ADD CONSTRAINT "SetSeedJob_draftVersionId_fkey" FOREIGN KEY ("draftVersionId") REFERENCES "SetDraftVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetSeedJob" ADD CONSTRAINT "SetSeedJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetSeedJob" ADD CONSTRAINT "SetSeedJob_retryOfId_fkey" FOREIGN KEY ("retryOfId") REFERENCES "SetSeedJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetAuditEvent" ADD CONSTRAINT "SetAuditEvent_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SetDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetAuditEvent" ADD CONSTRAINT "SetAuditEvent_draftVersionId_fkey" FOREIGN KEY ("draftVersionId") REFERENCES "SetDraftVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetAuditEvent" ADD CONSTRAINT "SetAuditEvent_ingestionJobId_fkey" FOREIGN KEY ("ingestionJobId") REFERENCES "SetIngestionJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetAuditEvent" ADD CONSTRAINT "SetAuditEvent_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "SetApproval"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetAuditEvent" ADD CONSTRAINT "SetAuditEvent_seedJobId_fkey" FOREIGN KEY ("seedJobId") REFERENCES "SetSeedJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetAuditEvent" ADD CONSTRAINT "SetAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
