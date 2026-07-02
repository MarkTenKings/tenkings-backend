-- AI Grader production release V0 durable records.
-- This migration is intentionally checked in for review and must be applied only
-- through the approved migration runbook. Codex must not run production
-- migrations or set RUN_DB_MIGRATIONS=true without explicit approval.

CREATE TABLE "AiGraderSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "gradingSessionId" TEXT NOT NULL,
    "reportId" TEXT,
    "operatorUserId" TEXT,
    "operatorId" TEXT,
    "cardAssetId" TEXT,
    "itemId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "source" TEXT NOT NULL DEFAULT 'browser_station',
    "cardIdentity" JSONB,
    "acceptedProfile" JSONB,
    "calibrationProfile" JSONB,
    "captureSummary" JSONB,
    "safetySummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGraderSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiGraderReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "reportStatus" TEXT NOT NULL DEFAULT 'draft',
    "finalGradeStatus" TEXT NOT NULL DEFAULT 'not_computed',
    "visibilityStatus" TEXT NOT NULL DEFAULT 'private',
    "publicationStatus" TEXT NOT NULL DEFAULT 'draft',
    "cardAssetId" TEXT,
    "itemId" TEXT,
    "publicReportUrl" TEXT,
    "qrPayloadUrl" TEXT,
    "reportBundleStorageKey" TEXT,
    "productionReleaseStorageKey" TEXT,
    "labelDataStorageKey" TEXT,
    "assetManifestStorageKey" TEXT,
    "reportHtmlStorageKey" TEXT,
    "finalOverallGrade" DOUBLE PRECISION,
    "elementScores" JSONB,
    "confidence" JSONB,
    "gradeStory" JSONB,
    "whyNot10" JSONB,
    "gradeImpactCandidates" JSONB,
    "gates" JSONB,
    "warnings" JSONB,
    "calibrationProfile" JSONB,
    "repeatabilitySummary" JSONB,
    "lightingProfile" JSONB,
    "visionLabArtifacts" JSONB,
    "valuationSummary" JSONB,
    "checksumSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "unpublishedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "errorCode" TEXT,

    CONSTRAINT "AiGraderReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiGraderEvidenceAsset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT,
    "reportId" TEXT,
    "artifactId" TEXT NOT NULL,
    "artifactClass" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "side" TEXT,
    "storageKey" TEXT NOT NULL,
    "publicUrl" TEXT,
    "checksumSha256" TEXT,
    "mimeType" TEXT,
    "byteSize" INTEGER,
    "widthPx" INTEGER,
    "heightPx" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGraderEvidenceAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiGraderGrade" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "overall" DOUBLE PRECISION,
    "centeringScore" DOUBLE PRECISION,
    "cornersScore" DOUBLE PRECISION,
    "edgesScore" DOUBLE PRECISION,
    "surfaceScore" DOUBLE PRECISION,
    "confidenceScore" DOUBLE PRECISION,
    "confidenceBand" TEXT,
    "gradeImpactReasons" JSONB,
    "whyNot10" JSONB,
    "gates" JSONB,
    "warnings" JSONB,
    "operatorFinalization" JSONB,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGraderGrade_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiGraderLabel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT,
    "reportId" TEXT NOT NULL,
    "certId" TEXT NOT NULL,
    "labelStatus" TEXT NOT NULL DEFAULT 'label_data_ready',
    "certificateStatus" TEXT NOT NULL DEFAULT 'report_id_issued_not_certified',
    "qrPayloadUrl" TEXT NOT NULL,
    "publicReportUrl" TEXT NOT NULL,
    "labelGradeText" TEXT NOT NULL,
    "labelDataStorageKey" TEXT,
    "labelPreviewKey" TEXT,
    "labelPreviewUrl" TEXT,
    "physicalPrintStatus" TEXT NOT NULL DEFAULT 'not_printed',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGraderLabel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiGraderPublication" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publicReportUrl" TEXT,
    "qrPayloadUrl" TEXT,
    "reportBundleStorageKey" TEXT,
    "storageKeyPrefix" TEXT,
    "assetManifest" JSONB,
    "publicationManifest" JSONB,
    "publishedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "unpublishedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGraderPublication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiGraderValuation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT,
    "reportId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_ready_missing_grade',
    "source" TEXT NOT NULL DEFAULT 'ebay_sold',
    "searchQuery" TEXT,
    "valuationMinor" INTEGER,
    "valuationCurrency" TEXT DEFAULT 'USD',
    "compsRefs" JSONB,
    "resultSummary" JSONB,
    "requestedByUserId" TEXT,
    "requestedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGraderValuation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiGraderSession_gradingSessionId_key" ON "AiGraderSession"("gradingSessionId");
CREATE INDEX "AiGraderSession_tenantId_status_createdAt_idx" ON "AiGraderSession"("tenantId", "status", "createdAt");
CREATE INDEX "AiGraderSession_cardAssetId_idx" ON "AiGraderSession"("cardAssetId");
CREATE INDEX "AiGraderSession_itemId_idx" ON "AiGraderSession"("itemId");
CREATE INDEX "AiGraderSession_operatorUserId_idx" ON "AiGraderSession"("operatorUserId");

CREATE UNIQUE INDEX "AiGraderReport_reportId_key" ON "AiGraderReport"("reportId");
CREATE INDEX "AiGraderReport_tenantId_publicationStatus_createdAt_idx" ON "AiGraderReport"("tenantId", "publicationStatus", "createdAt");
CREATE INDEX "AiGraderReport_cardAssetId_idx" ON "AiGraderReport"("cardAssetId");
CREATE INDEX "AiGraderReport_itemId_idx" ON "AiGraderReport"("itemId");
CREATE INDEX "AiGraderReport_sessionId_idx" ON "AiGraderReport"("sessionId");

CREATE UNIQUE INDEX "AiGraderEvidenceAsset_tenantId_artifactId_key" ON "AiGraderEvidenceAsset"("tenantId", "artifactId");
CREATE UNIQUE INDEX "AiGraderEvidenceAsset_storageKey_key" ON "AiGraderEvidenceAsset"("storageKey");
CREATE INDEX "AiGraderEvidenceAsset_tenantId_artifactClass_kind_idx" ON "AiGraderEvidenceAsset"("tenantId", "artifactClass", "kind");
CREATE INDEX "AiGraderEvidenceAsset_sessionId_idx" ON "AiGraderEvidenceAsset"("sessionId");
CREATE INDEX "AiGraderEvidenceAsset_reportId_idx" ON "AiGraderEvidenceAsset"("reportId");

CREATE UNIQUE INDEX "AiGraderGrade_reportId_key" ON "AiGraderGrade"("reportId");
CREATE INDEX "AiGraderGrade_tenantId_status_idx" ON "AiGraderGrade"("tenantId", "status");
CREATE INDEX "AiGraderGrade_overall_idx" ON "AiGraderGrade"("overall");

CREATE UNIQUE INDEX "AiGraderLabel_certId_key" ON "AiGraderLabel"("certId");
CREATE INDEX "AiGraderLabel_tenantId_labelStatus_idx" ON "AiGraderLabel"("tenantId", "labelStatus");
CREATE INDEX "AiGraderLabel_reportId_idx" ON "AiGraderLabel"("reportId");

CREATE UNIQUE INDEX "AiGraderPublication_reportId_key" ON "AiGraderPublication"("reportId");
CREATE INDEX "AiGraderPublication_tenantId_status_updatedAt_idx" ON "AiGraderPublication"("tenantId", "status", "updatedAt");

CREATE INDEX "AiGraderValuation_tenantId_status_updatedAt_idx" ON "AiGraderValuation"("tenantId", "status", "updatedAt");
CREATE INDEX "AiGraderValuation_reportId_idx" ON "AiGraderValuation"("reportId");

ALTER TABLE "AiGraderReport" ADD CONSTRAINT "AiGraderReport_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiGraderSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiGraderEvidenceAsset" ADD CONSTRAINT "AiGraderEvidenceAsset_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiGraderSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiGraderEvidenceAsset" ADD CONSTRAINT "AiGraderEvidenceAsset_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AiGraderReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiGraderGrade" ADD CONSTRAINT "AiGraderGrade_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AiGraderReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiGraderLabel" ADD CONSTRAINT "AiGraderLabel_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiGraderSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiGraderLabel" ADD CONSTRAINT "AiGraderLabel_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AiGraderReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiGraderPublication" ADD CONSTRAINT "AiGraderPublication_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AiGraderReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiGraderValuation" ADD CONSTRAINT "AiGraderValuation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiGraderSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiGraderValuation" ADD CONSTRAINT "AiGraderValuation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AiGraderReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
