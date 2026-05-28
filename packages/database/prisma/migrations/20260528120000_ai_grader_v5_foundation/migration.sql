-- CreateEnum
CREATE TYPE "GradingMode" AS ENUM ('QUICK', 'STANDARD', 'FORENSIC', 'AUTH_ONLY', 'MACRO_ONLY', 'MACRO_PLUS_CORNERS', 'MACRO_PLUS_EDGES', 'FULL_TWO_SCALE');

-- CreateEnum
CREATE TYPE "CaptureSide" AS ENUM ('FRONT', 'BACK');

-- CreateEnum
CREATE TYPE "GradingElement" AS ENUM ('CENTERING', 'CORNERS', 'EDGES', 'SURFACE', 'COMPOSITE', 'MICRO_CORNERS', 'MICRO_EDGES', 'MICRO_SURFACE', 'CMYK_AUTHENTICATION');

-- CreateEnum
CREATE TYPE "GradingCaptureKind" AS ENUM ('COLOR_CHECKER_FRONT', 'COLOR_CHECKER_BACK', 'FRONT_DIFFUSE', 'BACK_DIFFUSE', 'FRONT_DARKFIELD', 'BACK_DARKFIELD', 'FRONT_LED_0', 'FRONT_LED_1', 'FRONT_LED_2', 'FRONT_LED_3', 'FRONT_LED_4', 'FRONT_LED_5', 'FRONT_LED_6', 'FRONT_LED_7', 'BACK_LED_0', 'BACK_LED_1', 'BACK_LED_2', 'BACK_LED_3', 'BACK_LED_4', 'BACK_LED_5', 'BACK_LED_6', 'BACK_LED_7', 'MICRO_CORNER_SPOT', 'MICRO_EDGE_SPOT', 'MICRO_SURFACE_SPOT', 'MICRO_AUTH_PATCH', 'MICRO_CORNER_TILE', 'MICRO_EDGE_TILE', 'MICRO_SURFACE_TILE', 'EDR_BASE', 'POLARIZED_ALL_ON', 'FLC_LED_0', 'FLC_LED_1', 'FLC_LED_2', 'FLC_LED_3', 'FLC_LED_4', 'FLC_LED_5', 'FLC_LED_6', 'FLC_LED_7');

-- CreateEnum
CREATE TYPE "CaptureSessionStatus" AS ENUM ('CREATED', 'RUNNING', 'PAUSED', 'MICRO_INCOMPLETE_REQUIRES_REVIEW', 'PHYSICAL_GATE_REVIEW', 'REVIEW', 'COMPLETE', 'ABORTED');

-- CreateEnum
CREATE TYPE "GradeRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED', 'REPLAYED');

-- CreateEnum
CREATE TYPE "AuthRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "AuthVerdict" AS ENUM ('REFERENCE_NEEDED', 'AUTHENTIC', 'PROBABLY_AUTHENTIC', 'SUSPICIOUS', 'LIKELY_COUNTERFEIT');

-- CreateEnum
CREATE TYPE "PrintProfileStatus" AS ENUM ('CANDIDATE', 'CURATED_REFERENCE', 'ACTIVE', 'QUARANTINED', 'RETIRED');

-- CreateEnum
CREATE TYPE "EvidenceClass" AS ENUM ('ORIGINAL', 'DERIVED', 'PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'REVOKED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RigComponentType" AS ENUM ('MACRO_CAMERA', 'LENS', 'LED_DOME', 'LED_CONTROLLER', 'MICROSCOPE', 'XY_STAGE', 'ARM_INTERLOCK', 'HOLDER', 'CALIBRATION_TARGET');

-- CreateEnum
CREATE TYPE "CalibrationType" AS ENUM ('COLOR_CHECKER_CCM', 'MACRO_INTRINSICS', 'MACRO_FLAT_FIELD', 'STAGE_HOME', 'CARD_JIG_TRANSFORM', 'MICROSCOPE_PX_PER_MICRON', 'MICROSCOPE_FOCUS_BASELINE', 'LED_INTENSITY_HEALTH', 'ARM_INTERLOCK_HEALTH');

-- CreateEnum
CREATE TYPE "OperatorOverrideReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuditEventOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED', 'WARNING');

-- CreateEnum
CREATE TYPE "CustodyEventType" AS ENUM ('INTAKE', 'CAPTURE_START', 'CAPTURE_COMPLETE', 'VAULT_IN', 'VAULT_OUT', 'SHIPPED', 'RECEIVED', 'SLAB_SENT', 'SLAB_RETURNED', 'CERTIFICATE_ISSUED', 'CERTIFICATE_REVOKED', 'CUSTODY_BREAK');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RigLocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RigLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "roles" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureRig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "rigVersion" TEXT NOT NULL DEFAULT 'LEAN_V5',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptureRig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RigComponent" (
    "id" TEXT NOT NULL,
    "rigId" TEXT NOT NULL,
    "type" "RigComponentType" NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "driverName" TEXT,
    "metadata" JSONB,
    "mountedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "RigComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelperInstance" (
    "id" TEXT NOT NULL,
    "rigId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "helperVersion" TEXT NOT NULL,
    "config" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelperInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceCapabilityManifest" (
    "id" TEXT NOT NULL,
    "helperInstanceId" TEXT NOT NULL,
    "rigId" TEXT NOT NULL,
    "manifestVersion" TEXT NOT NULL,
    "driverName" TEXT NOT NULL,
    "driverVersion" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "componentSerial" TEXT NOT NULL,
    "supportedCapturePackages" JSONB NOT NULL,
    "coordinateUnits" JSONB NOT NULL,
    "timingCharacteristics" JSONB NOT NULL,
    "healthChecks" JSONB NOT NULL,
    "requiredCalibrationTypes" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceCapabilityManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalibrationSnapshot" (
    "id" TEXT NOT NULL,
    "rigId" TEXT NOT NULL,
    "calibrationType" "CalibrationType" NOT NULL,
    "componentSerials" JSONB NOT NULL,
    "artifactKeys" JSONB NOT NULL,
    "artifactChecksums" JSONB NOT NULL,
    "residuals" JSONB,
    "operatorId" TEXT,
    "validityStartsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validityEndsAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "supersessionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalibrationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rigId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "helperInstanceId" TEXT,
    "gradingMode" "GradingMode" NOT NULL DEFAULT 'STANDARD',
    "status" "CaptureSessionStatus" NOT NULL DEFAULT 'CREATED',
    "currentState" TEXT NOT NULL DEFAULT 'INIT',
    "errorCode" TEXT,
    "rawCardOnly" BOOLEAN NOT NULL DEFAULT true,
    "cardIdentity" JSONB,
    "physicalGateResults" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptureSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureManifest" (
    "id" TEXT NOT NULL,
    "captureSessionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rigId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "helperInstanceId" TEXT NOT NULL,
    "helperVersion" TEXT NOT NULL,
    "driverVersions" JSONB NOT NULL,
    "componentSerials" JSONB NOT NULL,
    "calibrationSnapshotIds" JSONB NOT NULL,
    "frameList" JSONB NOT NULL,
    "operatorPrompts" JSONB NOT NULL,
    "deviceHealth" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradingSuspectRegion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "side" "CaptureSide" NOT NULL,
    "element" "GradingElement" NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "reasonCodes" JSONB NOT NULL,
    "cardMm" JSONB NOT NULL,
    "warpedPx" JSONB NOT NULL,
    "sourcePx" JSONB,
    "heatmapStorageKey" TEXT,
    "macroCaptureIds" JSONB NOT NULL,
    "routedCaptureIds" JSONB,
    "thresholdSetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradingSuspectRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlgorithmVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "semanticVersion" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "internalReference" TEXT,
    "patentReference" TEXT,
    "numericTolerance" JSONB NOT NULL,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlgorithmVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThresholdSetVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "semanticVersion" TEXT NOT NULL,
    "thresholds" JSONB NOT NULL,
    "sourceHash" TEXT,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThresholdSetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuntimeEnvironment" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "containerDigest" TEXT NOT NULL,
    "pythonVersion" TEXT,
    "nodeVersion" TEXT,
    "opencvVersion" TEXT,
    "numpyVersion" TEXT,
    "dependencyLockHash" TEXT NOT NULL,
    "osInfo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuntimeEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardPrintProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cardSet" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "printRun" TEXT,
    "printRunKey" TEXT NOT NULL DEFAULT '',
    "state" "PrintProfileStatus" NOT NULL DEFAULT 'CANDIDATE',
    "referenceFingerprint" JSONB NOT NULL,
    "referenceAuthRunId" TEXT,
    "approvedByOperatorId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardPrintProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeRun" (
    "id" TEXT NOT NULL,
    "captureSessionId" TEXT NOT NULL,
    "captureManifestId" TEXT NOT NULL,
    "algorithmVersionId" TEXT NOT NULL,
    "thresholdSetVersionId" TEXT NOT NULL,
    "runtimeEnvironmentId" TEXT NOT NULL,
    "status" "GradeRunStatus" NOT NULL DEFAULT 'PENDING',
    "mode" "GradingMode" NOT NULL,
    "inputChecksum" TEXT NOT NULL,
    "outputChecksum" TEXT,
    "macroMeasurements" JSONB NOT NULL,
    "microMeasurements" JSONB,
    "fusionActions" JSONB NOT NULL,
    "finalGrades" JSONB,
    "confidence" JSONB,
    "warnings" JSONB,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "GradeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplayRun" (
    "id" TEXT NOT NULL,
    "sourceGradeRunId" TEXT NOT NULL,
    "algorithmVersionId" TEXT NOT NULL,
    "thresholdSetVersionId" TEXT NOT NULL,
    "runtimeEnvironmentId" TEXT NOT NULL,
    "inputChecksum" TEXT NOT NULL,
    "outputChecksum" TEXT NOT NULL,
    "deltas" JSONB NOT NULL,
    "tolerancePassed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplayRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthRun" (
    "id" TEXT NOT NULL,
    "captureSessionId" TEXT,
    "captureManifestId" TEXT,
    "algorithmVersionId" TEXT NOT NULL,
    "runtimeEnvironmentId" TEXT NOT NULL,
    "cardPrintProfileId" TEXT,
    "tenantId" TEXT NOT NULL,
    "cardSet" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "printRun" TEXT,
    "verdict" "AuthVerdict" NOT NULL,
    "distance" DOUBLE PRECISION,
    "status" "AuthRunStatus" NOT NULL DEFAULT 'PENDING',
    "measurements" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "inputChecksum" TEXT,
    "outputChecksum" TEXT,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AuthRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeCertificate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "gradeRunId" TEXT NOT NULL,
    "authRunId" TEXT,
    "publicSlug" TEXT NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'DRAFT',
    "mode" "GradingMode" NOT NULL,
    "finalGrades" JSONB,
    "publicReportKey" TEXT,
    "custodyStatus" TEXT NOT NULL DEFAULT 'IN_TEN_KINGS_CUSTODY',
    "issuedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradeCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceArtifact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "captureSessionId" TEXT,
    "gradeRunId" TEXT,
    "authRunId" TEXT,
    "certificateId" TEXT,
    "evidenceClass" "EvidenceClass" NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER,
    "widthPx" INTEGER,
    "heightPx" INTEGER,
    "retentionUntil" TIMESTAMP(3),
    "publicUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustodyEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "certificateId" TEXT,
    "captureSessionId" TEXT,
    "type" "CustodyEventType" NOT NULL,
    "fromOperatorId" TEXT,
    "toOperatorId" TEXT,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "evidenceArtifactIds" JSONB,
    "notes" TEXT,
    "checksum" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustodyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorOverride" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "captureSessionId" TEXT NOT NULL,
    "gradeRunId" TEXT,
    "certificateId" TEXT,
    "operatorId" TEXT NOT NULL,
    "originalGrades" JSONB NOT NULL,
    "overrideGrades" JSONB NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reasonText" TEXT,
    "evidenceArtifactIds" JSONB,
    "reviewStatus" "OperatorOverrideReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorOperatorId" TEXT,
    "actorUserId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" "AuditEventOutcome" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reasonCode" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "RigLocation_tenantId_idx" ON "RigLocation"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Operator_tenantId_email_key" ON "Operator"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Operator_userId_idx" ON "Operator"("userId");

-- CreateIndex
CREATE INDEX "CaptureRig_tenantId_locationId_idx" ON "CaptureRig"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "RigComponent_rigId_type_serial_key" ON "RigComponent"("rigId", "type", "serial");

-- CreateIndex
CREATE INDEX "RigComponent_serial_idx" ON "RigComponent"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "HelperInstance_machineId_key" ON "HelperInstance"("machineId");

-- CreateIndex
CREATE INDEX "HelperInstance_rigId_idx" ON "HelperInstance"("rigId");

-- CreateIndex
CREATE INDEX "DeviceCapabilityManifest_rigId_deviceType_idx" ON "DeviceCapabilityManifest"("rigId", "deviceType");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCapabilityManifest_helperInstanceId_checksum_key" ON "DeviceCapabilityManifest"("helperInstanceId", "checksum");

-- CreateIndex
CREATE INDEX "CalibrationSnapshot_rigId_calibrationType_validityStartsAt_idx" ON "CalibrationSnapshot"("rigId", "calibrationType", "validityStartsAt");

-- CreateIndex
CREATE INDEX "CaptureSession_tenantId_rigId_status_idx" ON "CaptureSession"("tenantId", "rigId", "status");

-- CreateIndex
CREATE INDEX "CaptureSession_operatorId_createdAt_idx" ON "CaptureSession"("operatorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureManifest_checksum_key" ON "CaptureManifest"("checksum");

-- CreateIndex
CREATE INDEX "CaptureManifest_captureSessionId_idx" ON "CaptureManifest"("captureSessionId");

-- CreateIndex
CREATE INDEX "CaptureManifest_tenantId_rigId_createdAt_idx" ON "CaptureManifest"("tenantId", "rigId", "createdAt");

-- CreateIndex
CREATE INDEX "GradingSuspectRegion_sessionId_side_element_idx" ON "GradingSuspectRegion"("sessionId", "side", "element");

-- CreateIndex
CREATE UNIQUE INDEX "GradingSuspectRegion_sessionId_side_element_rank_key" ON "GradingSuspectRegion"("sessionId", "side", "element", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "AlgorithmVersion_name_semanticVersion_key" ON "AlgorithmVersion"("name", "semanticVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ThresholdSetVersion_name_semanticVersion_key" ON "ThresholdSetVersion"("name", "semanticVersion");

-- CreateIndex
CREATE UNIQUE INDEX "RuntimeEnvironment_containerDigest_dependencyLockHash_key" ON "RuntimeEnvironment"("containerDigest", "dependencyLockHash");

-- CreateIndex
CREATE INDEX "GradeRun_captureSessionId_status_idx" ON "GradeRun"("captureSessionId", "status");

-- CreateIndex
CREATE INDEX "GradeRun_algorithmVersionId_thresholdSetVersionId_idx" ON "GradeRun"("algorithmVersionId", "thresholdSetVersionId");

-- CreateIndex
CREATE INDEX "ReplayRun_sourceGradeRunId_idx" ON "ReplayRun"("sourceGradeRunId");

-- CreateIndex
CREATE INDEX "AuthRun_tenantId_cardSet_cardNumber_idx" ON "AuthRun"("tenantId", "cardSet", "cardNumber");

-- CreateIndex
CREATE INDEX "AuthRun_captureSessionId_idx" ON "AuthRun"("captureSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CardPrintProfile_tenantId_cardSet_cardNumber_printRunKey_version_key" ON "CardPrintProfile"("tenantId", "cardSet", "cardNumber", "printRunKey", "version");

-- CreateIndex
CREATE INDEX "CardPrintProfile_tenantId_cardSet_cardNumber_state_idx" ON "CardPrintProfile"("tenantId", "cardSet", "cardNumber", "state");

-- CreateIndex
CREATE UNIQUE INDEX "GradeCertificate_gradeRunId_key" ON "GradeCertificate"("gradeRunId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeCertificate_publicSlug_key" ON "GradeCertificate"("publicSlug");

-- CreateIndex
CREATE UNIQUE INDEX "GradeCertificate_certificateNumber_key" ON "GradeCertificate"("certificateNumber");

-- CreateIndex
CREATE INDEX "GradeCertificate_tenantId_status_idx" ON "GradeCertificate"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceArtifact_storageKey_key" ON "EvidenceArtifact"("storageKey");

-- CreateIndex
CREATE INDEX "EvidenceArtifact_tenantId_evidenceClass_createdAt_idx" ON "EvidenceArtifact"("tenantId", "evidenceClass", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceArtifact_captureSessionId_idx" ON "EvidenceArtifact"("captureSessionId");

-- CreateIndex
CREATE INDEX "EvidenceArtifact_gradeRunId_idx" ON "EvidenceArtifact"("gradeRunId");

-- CreateIndex
CREATE INDEX "EvidenceArtifact_authRunId_idx" ON "EvidenceArtifact"("authRunId");

-- CreateIndex
CREATE INDEX "EvidenceArtifact_certificateId_idx" ON "EvidenceArtifact"("certificateId");

-- CreateIndex
CREATE INDEX "CustodyEvent_tenantId_certificateId_occurredAt_idx" ON "CustodyEvent"("tenantId", "certificateId", "occurredAt");

-- CreateIndex
CREATE INDEX "CustodyEvent_captureSessionId_idx" ON "CustodyEvent"("captureSessionId");

-- CreateIndex
CREATE INDEX "OperatorOverride_tenantId_captureSessionId_idx" ON "OperatorOverride"("tenantId", "captureSessionId");

-- CreateIndex
CREATE INDEX "OperatorOverride_operatorId_createdAt_idx" ON "OperatorOverride"("operatorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_entityType_entityId_idx" ON "AuditEvent"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorOperatorId_createdAt_idx" ON "AuditEvent"("actorOperatorId", "createdAt");

-- AddForeignKey
ALTER TABLE "RigLocation" ADD CONSTRAINT "RigLocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operator" ADD CONSTRAINT "Operator_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureRig" ADD CONSTRAINT "CaptureRig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureRig" ADD CONSTRAINT "CaptureRig_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "RigLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RigComponent" ADD CONSTRAINT "RigComponent_rigId_fkey" FOREIGN KEY ("rigId") REFERENCES "CaptureRig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelperInstance" ADD CONSTRAINT "HelperInstance_rigId_fkey" FOREIGN KEY ("rigId") REFERENCES "CaptureRig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCapabilityManifest" ADD CONSTRAINT "DeviceCapabilityManifest_helperInstanceId_fkey" FOREIGN KEY ("helperInstanceId") REFERENCES "HelperInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibrationSnapshot" ADD CONSTRAINT "CalibrationSnapshot_rigId_fkey" FOREIGN KEY ("rigId") REFERENCES "CaptureRig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSession" ADD CONSTRAINT "CaptureSession_rigId_fkey" FOREIGN KEY ("rigId") REFERENCES "CaptureRig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSession" ADD CONSTRAINT "CaptureSession_helperInstanceId_fkey" FOREIGN KEY ("helperInstanceId") REFERENCES "HelperInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureManifest" ADD CONSTRAINT "CaptureManifest_captureSessionId_fkey" FOREIGN KEY ("captureSessionId") REFERENCES "CaptureSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingSuspectRegion" ADD CONSTRAINT "GradingSuspectRegion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CaptureSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeRun" ADD CONSTRAINT "GradeRun_captureSessionId_fkey" FOREIGN KEY ("captureSessionId") REFERENCES "CaptureSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeRun" ADD CONSTRAINT "GradeRun_captureManifestId_fkey" FOREIGN KEY ("captureManifestId") REFERENCES "CaptureManifest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeRun" ADD CONSTRAINT "GradeRun_algorithmVersionId_fkey" FOREIGN KEY ("algorithmVersionId") REFERENCES "AlgorithmVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeRun" ADD CONSTRAINT "GradeRun_thresholdSetVersionId_fkey" FOREIGN KEY ("thresholdSetVersionId") REFERENCES "ThresholdSetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeRun" ADD CONSTRAINT "GradeRun_runtimeEnvironmentId_fkey" FOREIGN KEY ("runtimeEnvironmentId") REFERENCES "RuntimeEnvironment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayRun" ADD CONSTRAINT "ReplayRun_sourceGradeRunId_fkey" FOREIGN KEY ("sourceGradeRunId") REFERENCES "GradeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayRun" ADD CONSTRAINT "ReplayRun_algorithmVersionId_fkey" FOREIGN KEY ("algorithmVersionId") REFERENCES "AlgorithmVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayRun" ADD CONSTRAINT "ReplayRun_thresholdSetVersionId_fkey" FOREIGN KEY ("thresholdSetVersionId") REFERENCES "ThresholdSetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayRun" ADD CONSTRAINT "ReplayRun_runtimeEnvironmentId_fkey" FOREIGN KEY ("runtimeEnvironmentId") REFERENCES "RuntimeEnvironment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthRun" ADD CONSTRAINT "AuthRun_captureSessionId_fkey" FOREIGN KEY ("captureSessionId") REFERENCES "CaptureSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthRun" ADD CONSTRAINT "AuthRun_captureManifestId_fkey" FOREIGN KEY ("captureManifestId") REFERENCES "CaptureManifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthRun" ADD CONSTRAINT "AuthRun_algorithmVersionId_fkey" FOREIGN KEY ("algorithmVersionId") REFERENCES "AlgorithmVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthRun" ADD CONSTRAINT "AuthRun_runtimeEnvironmentId_fkey" FOREIGN KEY ("runtimeEnvironmentId") REFERENCES "RuntimeEnvironment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthRun" ADD CONSTRAINT "AuthRun_cardPrintProfileId_fkey" FOREIGN KEY ("cardPrintProfileId") REFERENCES "CardPrintProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeCertificate" ADD CONSTRAINT "GradeCertificate_gradeRunId_fkey" FOREIGN KEY ("gradeRunId") REFERENCES "GradeRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeCertificate" ADD CONSTRAINT "GradeCertificate_authRunId_fkey" FOREIGN KEY ("authRunId") REFERENCES "AuthRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_captureSessionId_fkey" FOREIGN KEY ("captureSessionId") REFERENCES "CaptureSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_gradeRunId_fkey" FOREIGN KEY ("gradeRunId") REFERENCES "GradeRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_authRunId_fkey" FOREIGN KEY ("authRunId") REFERENCES "AuthRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "GradeCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyEvent" ADD CONSTRAINT "CustodyEvent_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "GradeCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyEvent" ADD CONSTRAINT "CustodyEvent_captureSessionId_fkey" FOREIGN KEY ("captureSessionId") REFERENCES "CaptureSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorOverride" ADD CONSTRAINT "OperatorOverride_captureSessionId_fkey" FOREIGN KEY ("captureSessionId") REFERENCES "CaptureSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorOverride" ADD CONSTRAINT "OperatorOverride_gradeRunId_fkey" FOREIGN KEY ("gradeRunId") REFERENCES "GradeRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorOverride" ADD CONSTRAINT "OperatorOverride_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "GradeCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
