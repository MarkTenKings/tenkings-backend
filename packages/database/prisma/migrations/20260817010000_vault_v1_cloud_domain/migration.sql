-- SOURCE ONLY: additive Vault V1 migration. Do not apply without explicit authorization.
-- CreateEnum
CREATE TYPE "VaultMode" AS ENUM ('PRODUCTION', 'CERTIFICATION');

-- CreateEnum
CREATE TYPE "VaultRole" AS ENUM ('RESTOCKER', 'TECHNICIAN', 'ADMIN');

-- CreateEnum
CREATE TYPE "VaultMachineStatus" AS ENUM ('PROVISIONING', 'ENROLLED', 'ACTIVE', 'SERVICE', 'DISABLED', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "VaultCredentialStatus" AS ENUM ('PENDING', 'ACTIVE', 'ROTATED', 'REVOKED');

-- CreateEnum
CREATE TYPE "VaultEnrollmentStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'CONSUMED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "VaultProductCategory" AS ENUM ('SPORTS', 'POKEMON');

-- CreateEnum
CREATE TYPE "VaultDoorState" AS ENUM ('EMPTY', 'AVAILABLE', 'RESERVED', 'COMMITTED_SOLD', 'SERVICE_HOLD', 'DISABLED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "VaultConfigStatus" AS ENUM ('DRAFT', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "VaultSaleState" AS ENUM ('CART_ACTIVE', 'CHECKOUT_REVALIDATING', 'RESERVED', 'PAYMENT_REQUESTED', 'PAYMENT_AUTHORIZED', 'FULFILLMENT_COMMITTED', 'OPEN_COMMAND_PENDING', 'OPEN_COMMAND_TERMINAL', 'VEND_RESULT_PENDING', 'SETTLEMENT_PENDING', 'SETTLED', 'COMPLETED', 'PAYMENT_DECLINED', 'PAYMENT_CANCELLED', 'PAYMENT_UNKNOWN', 'RECONCILIATION_REQUIRED', 'SUPPORT_REQUIRED');

-- CreateEnum
CREATE TYPE "VaultPaymentState" AS ENUM ('NOT_REQUESTED', 'REQUESTED', 'AUTHORIZED', 'DECLINED', 'CANCELLED', 'UNKNOWN', 'VEND_RESULT_PENDING', 'SETTLEMENT_PENDING', 'SETTLED', 'RECONCILIATION_REQUIRED');

-- CreateEnum
CREATE TYPE "VaultSettlementState" AS ENUM ('NOT_STARTED', 'PENDING', 'SETTLED', 'VOIDED', 'REFUNDED', 'UNKNOWN', 'RECONCILIATION_REQUIRED');

-- CreateEnum
CREATE TYPE "VaultFulfillmentState" AS ENUM ('NOT_COMMITTED', 'COMMITTED', 'COMMANDS_PENDING', 'COMMANDS_TERMINAL', 'RETRIEVAL_ACTIVE', 'CUSTOMER_DONE', 'SUPPORT_REQUIRED');

-- CreateEnum
CREATE TYPE "VaultCommandState" AS ENUM ('NOT_COMMITTED', 'COMMAND_INTENT_RECORDED', 'ACCEPTED', 'SENT_UNKNOWN', 'REJECTED', 'TIMEOUT', 'OUTPUT_RELEASED');

-- CreateEnum
CREATE TYPE "VaultRestockSessionState" AS ENUM ('ACTIVE', 'REVIEW_REQUIRED', 'FINALIZED', 'CANCELLED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "VaultRestockItemState" AS ENUM ('UNREVIEWED', 'FILLED', 'LEFT_EMPTY', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "VaultStaffGrantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "VaultHealthState" AS ENUM ('READY', 'DEGRADED_CLOUD', 'DEGRADED_SYNC', 'BLOCKED_CONFIG', 'BLOCKED_TAX', 'BLOCKED_NAYAX', 'BLOCKED_CONTROLLER', 'BLOCKED_STORAGE', 'BLOCKED_CLOCK', 'SERVICE_LOCKED', 'RECOVERY_REQUIRED');

-- CreateEnum
CREATE TYPE "VaultCertificationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'REVIEW_REQUIRED', 'PASSED', 'FAILED', 'CRITICAL_STOP', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "VaultCertificationEvidenceClass" AS ENUM ('AUTOMATED', 'OFFICIAL_SDK', 'BENCH', 'FULL_MACHINE', 'FIELD');

-- CreateEnum
CREATE TYPE "VaultCertificationOutcome" AS ENUM ('PASS', 'FAIL', 'CRITICAL');

-- CreateEnum
CREATE TYPE "VaultSupportCaseType" AS ENUM ('PAYMENT_UNKNOWN', 'PAYMENT_RECONCILIATION', 'DOOR_COMMAND', 'RETRIEVAL', 'RESTOCK', 'CERTIFICATION', 'MACHINE_HEALTH', 'OTHER');

-- CreateEnum
CREATE TYPE "VaultSupportCaseStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "VaultAuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- CreateTable
CREATE TABLE "VaultMachine" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "locationLabel" TEXT,
    "status" "VaultMachineStatus" NOT NULL DEFAULT 'PROVISIONING',
    "timezone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "taxRateBasisPoints" INTEGER NOT NULL,
    "taxCalculationVersion" TEXT NOT NULL DEFAULT 'half-up-subtotal-bps-v1',
    "supportPageUrl" TEXT,
    "supportEmail" TEXT,
    "supportTextNumber" TEXT,
    "supportPhoneNumber" TEXT,
    "supportHours" TEXT,
    "serviceStartedAt" TIMESTAMP(3),
    "serviceEndedAt" TIMESTAMP(3),
    "currentCredentialVersion" INTEGER NOT NULL DEFAULT 0,
    "lastEventSequence" BIGINT NOT NULL DEFAULT 0,
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastCloudObservedAt" TIMESTAMP(3),
    "health" "VaultHealthState" NOT NULL DEFAULT 'BLOCKED_CONFIG',
    "readinessReasons" JSONB,
    "appVersion" TEXT,
    "localSchemaVersion" INTEGER,
    "activeConfigVersion" INTEGER,
    "activeConfigDigest" TEXT,
    "availableDoorCount" INTEGER NOT NULL DEFAULT 0,
    "outboxPendingCount" INTEGER NOT NULL DEFAULT 0,
    "serviceLocked" BOOLEAN NOT NULL DEFAULT false,
    "activeConfigId" TEXT,
    "pendingConfigId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultMachine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultProduct" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "category" "VaultProductCategory" NOT NULL,
    "taxClass" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByAdminId" TEXT NOT NULL,
    "deactivatedByAdminId" TEXT,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultDoor" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "doorId" TEXT NOT NULL,
    "controllerChannel" INTEGER NOT NULL,
    "state" "VaultDoorState" NOT NULL DEFAULT 'EMPTY',
    "stateVersion" INTEGER NOT NULL DEFAULT 1,
    "activeProductId" TEXT,
    "plannedProductId" TEXT,
    "owningSaleId" TEXT,
    "owningRestockId" TEXT,
    "lastEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultDoor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultConfigVersion" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "VaultConfigStatus" NOT NULL DEFAULT 'DRAFT',
    "canonicalPayload" JSONB NOT NULL,
    "digest" TEXT NOT NULL,
    "signingKeyId" TEXT,
    "signingAlgorithm" TEXT,
    "detachedSignature" TEXT,
    "minimumAppVersion" TEXT NOT NULL,
    "createdByAdminId" TEXT NOT NULL,
    "validatedByAdminId" TEXT,
    "publishedByAdminId" TEXT,
    "validationSummary" JSONB,
    "impactSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultSale" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "localTransactionId" TEXT NOT NULL,
    "supportReference" TEXT NOT NULL,
    "mode" "VaultMode" NOT NULL,
    "state" "VaultSaleState" NOT NULL,
    "stateVersion" INTEGER NOT NULL DEFAULT 1,
    "paymentState" "VaultPaymentState" NOT NULL,
    "settlementState" "VaultSettlementState" NOT NULL DEFAULT 'NOT_STARTED',
    "fulfillmentState" "VaultFulfillmentState" NOT NULL DEFAULT 'NOT_COMMITTED',
    "configVersionId" TEXT NOT NULL,
    "configVersionNumber" INTEGER NOT NULL,
    "configDigest" TEXT NOT NULL,
    "machineTimezone" TEXT NOT NULL,
    "taxCity" TEXT NOT NULL,
    "taxState" TEXT NOT NULL,
    "taxRateBasisPoints" INTEGER NOT NULL,
    "taxCalculationVersion" TEXT NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "itemCount" INTEGER NOT NULL,
    "providerName" TEXT,
    "providerSessionId" TEXT,
    "providerTransactionId" TEXT,
    "providerCallbackSequence" INTEGER,
    "providerEvidence" JSONB,
    "authorizationObservedAt" TIMESTAMP(3),
    "vendResultObservedAt" TIMESTAMP(3),
    "settlementObservedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "reconciliationRequiredAt" TIMESTAMP(3),
    "reconciliationResolvedAt" TIMESTAMP(3),
    "groupRetryConsumedAt" TIMESTAMP(3),
    "customerDoneAt" TIMESTAMP(3),
    "recoveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultSaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "doorRecordId" TEXT NOT NULL,
    "doorId" TEXT NOT NULL,
    "productIdSnapshot" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "photoUrlSnapshot" TEXT NOT NULL,
    "descriptionSnapshot" TEXT NOT NULL,
    "categorySnapshot" "VaultProductCategory" NOT NULL,
    "priceCentsSnapshot" INTEGER NOT NULL,
    "taxClassSnapshot" TEXT NOT NULL,
    "controllerChannelSnapshot" INTEGER NOT NULL,
    "mappingVersionSnapshot" TEXT NOT NULL,
    "taxRateBasisPoints" INTEGER NOT NULL,
    "taxCentsSnapshot" INTEGER NOT NULL,
    "allocationState" "VaultDoorState" NOT NULL,
    "fulfillmentState" "VaultFulfillmentState" NOT NULL,
    "initialCommandId" TEXT,
    "initialCommandState" "VaultCommandState" NOT NULL DEFAULT 'NOT_COMMITTED',
    "retryCommandId" TEXT,
    "retryCommandState" "VaultCommandState" NOT NULL DEFAULT 'NOT_COMMITTED',
    "retryUsedAt" TIMESTAMP(3),
    "supportReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultSaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultMachineEvent" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "mode" "VaultMode" NOT NULL,
    "correlationId" TEXT,
    "causationId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "quarantinedAt" TIMESTAMP(3),
    "quarantineCode" TEXT,

    CONSTRAINT "VaultMachineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultRestockSession" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "localSessionId" TEXT NOT NULL,
    "state" "VaultRestockSessionState" NOT NULL DEFAULT 'ACTIVE',
    "actorUserId" TEXT,
    "actorRole" "VaultRole",
    "actorGrantVersion" INTEGER,
    "configVersionId" TEXT NOT NULL,
    "expectedDoorCount" INTEGER NOT NULL,
    "filledCount" INTEGER NOT NULL DEFAULT 0,
    "leftEmptyCount" INTEGER NOT NULL DEFAULT 0,
    "exceptionCount" INTEGER NOT NULL DEFAULT 0,
    "shortageSummary" JSONB,
    "physicalCloseConfirmedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultRestockSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultRestockItem" (
    "id" TEXT NOT NULL,
    "restockSessionId" TEXT NOT NULL,
    "doorRecordId" TEXT NOT NULL,
    "doorId" TEXT NOT NULL,
    "plannedProductId" TEXT,
    "state" "VaultRestockItemState" NOT NULL DEFAULT 'UNREVIEWED',
    "commandId" TEXT,
    "commandState" "VaultCommandState" NOT NULL DEFAULT 'NOT_COMMITTED',
    "evidence" JSONB,
    "reviewedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultRestockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultStaffMachineAccess" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "VaultRole" NOT NULL,
    "status" "VaultStaffGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "grantVersion" INTEGER NOT NULL,
    "verifierVersion" INTEGER NOT NULL,
    "verifierHash" TEXT NOT NULL,
    "verifierAlgorithm" TEXT NOT NULL,
    "verifierParameters" JSONB NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByAdminId" TEXT,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultStaffMachineAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultEnrollmentToken" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "VaultEnrollmentStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "createdByAdminId" TEXT NOT NULL,
    "approvedByAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultEnrollmentToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultMachineCredential" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "credentialHash" TEXT NOT NULL,
    "status" "VaultCredentialStatus" NOT NULL DEFAULT 'PENDING',
    "createdByAdminId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByAdminId" TEXT,
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultMachineCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultCertificationSession" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "localSessionId" TEXT,
    "status" "VaultCertificationStatus" NOT NULL DEFAULT 'DRAFT',
    "configVersionId" TEXT NOT NULL,
    "appBuild" TEXT,
    "sourceCommit" TEXT NOT NULL,
    "localSchemaVersion" INTEGER,
    "contractVersion" INTEGER NOT NULL,
    "nayaxAdapterVersion" TEXT,
    "nayaxSdkVersion" TEXT,
    "nayaxFlowConfig" JSONB,
    "controllerIdentity" JSONB,
    "hardwareIdentity" JSONB,
    "evidenceSummary" JSONB,
    "unresolvedDeviations" JSONB,
    "startedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedByRole" "VaultRole",
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "invalidationReason" TEXT,
    "retainUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultCertificationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultCertificationEvidence" (
    "id" TEXT NOT NULL,
    "certificationId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "doorId" TEXT,
    "evidenceClass" "VaultCertificationEvidenceClass",
    "outcome" "VaultCertificationOutcome" NOT NULL,
    "expectedDoorIds" JSONB NOT NULL,
    "observedDoorIds" JSONB NOT NULL,
    "notes" TEXT NOT NULL,
    "artifactDigest" TEXT,
    "artifactStorageKey" TEXT,
    "metadata" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "retainUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultCertificationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultCertificate" (
    "id" TEXT NOT NULL,
    "certificationId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "certificatePayload" JSONB NOT NULL,
    "digest" TEXT NOT NULL,
    "signingKeyId" TEXT NOT NULL,
    "signingAlgorithm" TEXT NOT NULL,
    "detachedSignature" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "approvedByRole" "VaultRole" NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "invalidatedAt" TIMESTAMP(3),
    "invalidationReason" TEXT,
    "retainUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultSupportCase" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "saleId" TEXT,
    "shortReference" TEXT NOT NULL,
    "type" "VaultSupportCaseType" NOT NULL,
    "status" "VaultSupportCaseStatus" NOT NULL DEFAULT 'OPEN',
    "affectedDoorIds" JSONB NOT NULL,
    "customerSafeSummary" TEXT,
    "internalSummary" TEXT,
    "reconciliationSnapshot" JSONB,
    "financialResolution" JSONB,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAdminId" TEXT,
    "resolvedByAdminId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "resolutionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultSupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultAdminAuditEvent" (
    "id" TEXT NOT NULL,
    "machineId" TEXT,
    "actorAdminId" TEXT,
    "actorRole" "VaultRole",
    "action" TEXT NOT NULL,
    "outcome" "VaultAuditOutcome" NOT NULL,
    "reason" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "payloadDigest" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultAdminAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VaultMachine_slug_key" ON "VaultMachine"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "VaultMachine_serialNumber_key" ON "VaultMachine"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "VaultMachine_activeConfigId_key" ON "VaultMachine"("activeConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultMachine_pendingConfigId_key" ON "VaultMachine"("pendingConfigId");

-- CreateIndex
CREATE INDEX "VaultMachine_status_health_idx" ON "VaultMachine"("status", "health");

-- CreateIndex
CREATE INDEX "VaultMachine_lastHeartbeatAt_idx" ON "VaultMachine"("lastHeartbeatAt");

-- CreateIndex
CREATE UNIQUE INDEX "VaultProduct_slug_key" ON "VaultProduct"("slug");

-- CreateIndex
CREATE INDEX "VaultProduct_active_category_priceCents_idx" ON "VaultProduct"("active", "category", "priceCents");

-- CreateIndex
CREATE INDEX "VaultDoor_machineId_state_activeProductId_idx" ON "VaultDoor"("machineId", "state", "activeProductId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultDoor_machineId_doorId_key" ON "VaultDoor"("machineId", "doorId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultDoor_machineId_controllerChannel_key" ON "VaultDoor"("machineId", "controllerChannel");

-- CreateIndex
CREATE INDEX "VaultConfigVersion_machineId_status_createdAt_idx" ON "VaultConfigVersion"("machineId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VaultConfigVersion_machineId_version_key" ON "VaultConfigVersion"("machineId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "VaultConfigVersion_machineId_digest_key" ON "VaultConfigVersion"("machineId", "digest");

-- CreateIndex
CREATE INDEX "VaultSale_machineId_mode_createdAt_idx" ON "VaultSale"("machineId", "mode", "createdAt");

-- CreateIndex
CREATE INDEX "VaultSale_paymentState_settlementState_createdAt_idx" ON "VaultSale"("paymentState", "settlementState", "createdAt");

-- CreateIndex
CREATE INDEX "VaultSale_state_createdAt_idx" ON "VaultSale"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VaultSale_machineId_localTransactionId_key" ON "VaultSale"("machineId", "localTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultSale_machineId_supportReference_key" ON "VaultSale"("machineId", "supportReference");

-- CreateIndex
CREATE UNIQUE INDEX "VaultSale_machineId_providerSessionId_key" ON "VaultSale"("machineId", "providerSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultSale_machineId_providerTransactionId_key" ON "VaultSale"("machineId", "providerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultSaleItem_initialCommandId_key" ON "VaultSaleItem"("initialCommandId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultSaleItem_retryCommandId_key" ON "VaultSaleItem"("retryCommandId");

-- CreateIndex
CREATE INDEX "VaultSaleItem_doorRecordId_createdAt_idx" ON "VaultSaleItem"("doorRecordId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VaultSaleItem_saleId_lineId_key" ON "VaultSaleItem"("saleId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultSaleItem_saleId_doorId_key" ON "VaultSaleItem"("saleId", "doorId");

-- CreateIndex
CREATE INDEX "VaultMachineEvent_machineId_receivedAt_idx" ON "VaultMachineEvent"("machineId", "receivedAt");

-- CreateIndex
CREATE INDEX "VaultMachineEvent_type_occurredAt_idx" ON "VaultMachineEvent"("type", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "VaultMachineEvent_machineId_eventId_key" ON "VaultMachineEvent"("machineId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultMachineEvent_machineId_sequence_key" ON "VaultMachineEvent"("machineId", "sequence");

-- CreateIndex
CREATE INDEX "VaultRestockSession_machineId_state_startedAt_idx" ON "VaultRestockSession"("machineId", "state", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VaultRestockSession_machineId_localSessionId_key" ON "VaultRestockSession"("machineId", "localSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultRestockItem_commandId_key" ON "VaultRestockItem"("commandId");

-- CreateIndex
CREATE INDEX "VaultRestockItem_doorRecordId_state_idx" ON "VaultRestockItem"("doorRecordId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "VaultRestockItem_restockSessionId_doorId_key" ON "VaultRestockItem"("restockSessionId", "doorId");

-- CreateIndex
CREATE INDEX "VaultStaffMachineAccess_machineId_status_grantVersion_idx" ON "VaultStaffMachineAccess"("machineId", "status", "grantVersion");

-- CreateIndex
CREATE INDEX "VaultStaffMachineAccess_userId_status_idx" ON "VaultStaffMachineAccess"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VaultStaffMachineAccess_machineId_userId_grantVersion_key" ON "VaultStaffMachineAccess"("machineId", "userId", "grantVersion");

-- CreateIndex
CREATE UNIQUE INDEX "VaultStaffMachineAccess_machineId_grantVersion_key" ON "VaultStaffMachineAccess"("machineId", "grantVersion");

-- CreateIndex
CREATE INDEX "VaultStaffMachineAccess_machineId_grantId_grantVersion_idx" ON "VaultStaffMachineAccess"("machineId", "grantId", "grantVersion");

-- CreateIndex
CREATE UNIQUE INDEX "VaultEnrollmentToken_tokenHash_key" ON "VaultEnrollmentToken"("tokenHash");

-- CreateIndex
CREATE INDEX "VaultEnrollmentToken_machineId_status_expiresAt_idx" ON "VaultEnrollmentToken"("machineId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "VaultMachineCredential_credentialHash_key" ON "VaultMachineCredential"("credentialHash");

-- CreateIndex
CREATE INDEX "VaultMachineCredential_machineId_status_idx" ON "VaultMachineCredential"("machineId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VaultMachineCredential_machineId_version_key" ON "VaultMachineCredential"("machineId", "version");

-- CreateIndex
CREATE INDEX "VaultCertificationSession_machineId_status_createdAt_idx" ON "VaultCertificationSession"("machineId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "VaultCertificationSession_retainUntil_idx" ON "VaultCertificationSession"("retainUntil");

-- CreateIndex
CREATE UNIQUE INDEX "VaultCertificationSession_machineId_localSessionId_key" ON "VaultCertificationSession"("machineId", "localSessionId");

-- CreateIndex
CREATE INDEX "VaultCertificationEvidence_certificationId_outcome_observed_idx" ON "VaultCertificationEvidence"("certificationId", "outcome", "observedAt");

-- CreateIndex
CREATE INDEX "VaultCertificationEvidence_retainUntil_idx" ON "VaultCertificationEvidence"("retainUntil");

-- CreateIndex
CREATE UNIQUE INDEX "VaultCertificationEvidence_certificationId_evidenceId_key" ON "VaultCertificationEvidence"("certificationId", "evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultCertificate_certificationId_key" ON "VaultCertificate"("certificationId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultCertificate_digest_key" ON "VaultCertificate"("digest");

-- CreateIndex
CREATE INDEX "VaultCertificate_retainUntil_idx" ON "VaultCertificate"("retainUntil");

-- CreateIndex
CREATE INDEX "VaultSupportCase_status_type_openedAt_idx" ON "VaultSupportCase"("status", "type", "openedAt");

-- CreateIndex
CREATE INDEX "VaultSupportCase_saleId_idx" ON "VaultSupportCase"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultSupportCase_machineId_shortReference_key" ON "VaultSupportCase"("machineId", "shortReference");

-- CreateIndex
CREATE INDEX "VaultAdminAuditEvent_machineId_createdAt_idx" ON "VaultAdminAuditEvent"("machineId", "createdAt");

-- CreateIndex
CREATE INDEX "VaultAdminAuditEvent_actorAdminId_createdAt_idx" ON "VaultAdminAuditEvent"("actorAdminId", "createdAt");

-- CreateIndex
CREATE INDEX "VaultAdminAuditEvent_action_outcome_createdAt_idx" ON "VaultAdminAuditEvent"("action", "outcome", "createdAt");

-- AddForeignKey
ALTER TABLE "VaultMachine" ADD CONSTRAINT "VaultMachine_activeConfigId_fkey" FOREIGN KEY ("activeConfigId") REFERENCES "VaultConfigVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultMachine" ADD CONSTRAINT "VaultMachine_pendingConfigId_fkey" FOREIGN KEY ("pendingConfigId") REFERENCES "VaultConfigVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultDoor" ADD CONSTRAINT "VaultDoor_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "VaultMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultDoor" ADD CONSTRAINT "VaultDoor_activeProductId_fkey" FOREIGN KEY ("activeProductId") REFERENCES "VaultProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultDoor" ADD CONSTRAINT "VaultDoor_plannedProductId_fkey" FOREIGN KEY ("plannedProductId") REFERENCES "VaultProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultDoor" ADD CONSTRAINT "VaultDoor_owningSaleId_fkey" FOREIGN KEY ("owningSaleId") REFERENCES "VaultSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultDoor" ADD CONSTRAINT "VaultDoor_owningRestockId_fkey" FOREIGN KEY ("owningRestockId") REFERENCES "VaultRestockSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultConfigVersion" ADD CONSTRAINT "VaultConfigVersion_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "VaultMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultSale" ADD CONSTRAINT "VaultSale_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "VaultMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultSale" ADD CONSTRAINT "VaultSale_configVersionId_fkey" FOREIGN KEY ("configVersionId") REFERENCES "VaultConfigVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultSaleItem" ADD CONSTRAINT "VaultSaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "VaultSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultSaleItem" ADD CONSTRAINT "VaultSaleItem_doorRecordId_fkey" FOREIGN KEY ("doorRecordId") REFERENCES "VaultDoor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultMachineEvent" ADD CONSTRAINT "VaultMachineEvent_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "VaultMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultRestockSession" ADD CONSTRAINT "VaultRestockSession_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "VaultMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultRestockSession" ADD CONSTRAINT "VaultRestockSession_configVersionId_fkey" FOREIGN KEY ("configVersionId") REFERENCES "VaultConfigVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultRestockItem" ADD CONSTRAINT "VaultRestockItem_restockSessionId_fkey" FOREIGN KEY ("restockSessionId") REFERENCES "VaultRestockSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultRestockItem" ADD CONSTRAINT "VaultRestockItem_doorRecordId_fkey" FOREIGN KEY ("doorRecordId") REFERENCES "VaultDoor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultStaffMachineAccess" ADD CONSTRAINT "VaultStaffMachineAccess_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "VaultMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultEnrollmentToken" ADD CONSTRAINT "VaultEnrollmentToken_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "VaultMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultMachineCredential" ADD CONSTRAINT "VaultMachineCredential_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "VaultMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultCertificationSession" ADD CONSTRAINT "VaultCertificationSession_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "VaultMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultCertificationSession" ADD CONSTRAINT "VaultCertificationSession_configVersionId_fkey" FOREIGN KEY ("configVersionId") REFERENCES "VaultConfigVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultCertificationEvidence" ADD CONSTRAINT "VaultCertificationEvidence_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "VaultCertificationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultCertificate" ADD CONSTRAINT "VaultCertificate_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "VaultCertificationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultSupportCase" ADD CONSTRAINT "VaultSupportCase_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "VaultMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultSupportCase" ADD CONSTRAINT "VaultSupportCase_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "VaultSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultAdminAuditEvent" ADD CONSTRAINT "VaultAdminAuditEvent_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "VaultMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Fail-closed domain invariants. These checks are additive because this is a
-- source-only initial migration and no Vault tables are deployed yet.
ALTER TABLE "VaultMachine" ADD CONSTRAINT "VaultMachine_tax_rate_check" CHECK ("taxRateBasisPoints" BETWEEN 0 AND 10000);
ALTER TABLE "VaultMachine" ADD CONSTRAINT "VaultMachine_credential_version_check" CHECK ("currentCredentialVersion" >= 0);
ALTER TABLE "VaultMachine" ADD CONSTRAINT "VaultMachine_event_sequence_check" CHECK ("lastEventSequence" >= 0);
ALTER TABLE "VaultMachine" ADD CONSTRAINT "VaultMachine_door_counts_check" CHECK ("availableDoorCount" BETWEEN 0 AND 150 AND "outboxPendingCount" >= 0);
ALTER TABLE "VaultMachine" ADD CONSTRAINT "VaultMachine_active_config_snapshot_check" CHECK (("activeConfigVersion" IS NULL) = ("activeConfigDigest" IS NULL));
ALTER TABLE "VaultMachine" ADD CONSTRAINT "VaultMachine_active_config_digest_check" CHECK ("activeConfigDigest" IS NULL OR "activeConfigDigest" ~ '^[a-f0-9]{64}$');

ALTER TABLE "VaultProduct" ADD CONSTRAINT "VaultProduct_price_check" CHECK ("priceCents" IN (2500, 5000, 10000, 25000));

ALTER TABLE "VaultDoor" ADD CONSTRAINT "VaultDoor_id_check" CHECK ("doorId" ~ '^(X|K|I|N|G|S)-(0[1-9]|1[0-9]|2[0-5])$');
ALTER TABLE "VaultDoor" ADD CONSTRAINT "VaultDoor_channel_check" CHECK ("controllerChannel" BETWEEN 1 AND 150);
ALTER TABLE "VaultDoor" ADD CONSTRAINT "VaultDoor_version_check" CHECK ("stateVersion" > 0);
ALTER TABLE "VaultDoor" ADD CONSTRAINT "VaultDoor_single_owner_check" CHECK (NOT ("owningSaleId" IS NOT NULL AND "owningRestockId" IS NOT NULL));

ALTER TABLE "VaultConfigVersion" ADD CONSTRAINT "VaultConfigVersion_version_check" CHECK ("version" > 0 AND "schemaVersion" > 0);
ALTER TABLE "VaultConfigVersion" ADD CONSTRAINT "VaultConfigVersion_digest_check" CHECK ("digest" ~ '^[a-f0-9]{64}$');
ALTER TABLE "VaultConfigVersion" ADD CONSTRAINT "VaultConfigVersion_signature_check" CHECK ("status" NOT IN ('PUBLISHED','SUPERSEDED') OR ("signingKeyId" IS NOT NULL AND "signingAlgorithm" = 'Ed25519' AND "detachedSignature" IS NOT NULL AND "publishedAt" IS NOT NULL));

ALTER TABLE "VaultSale" ADD CONSTRAINT "VaultSale_money_check" CHECK ("subtotalCents" >= 0 AND "taxCents" >= 0 AND "totalCents" = "subtotalCents" + "taxCents");
ALTER TABLE "VaultSale" ADD CONSTRAINT "VaultSale_tax_check" CHECK ("taxRateBasisPoints" BETWEEN 0 AND 10000);
ALTER TABLE "VaultSale" ADD CONSTRAINT "VaultSale_count_check" CHECK ("itemCount" BETWEEN 1 AND 150 AND "stateVersion" > 0 AND "configVersionNumber" > 0);
ALTER TABLE "VaultSale" ADD CONSTRAINT "VaultSale_digest_check" CHECK ("configDigest" ~ '^[a-f0-9]{64}$');
ALTER TABLE "VaultSale" ADD CONSTRAINT "VaultSale_currency_check" CHECK ("currency" = 'USD');
ALTER TABLE "VaultSale" ADD CONSTRAINT "VaultSale_provider_evidence_check" CHECK ("providerEvidence" IS NULL OR jsonb_typeof("providerEvidence") = 'object');

ALTER TABLE "VaultSaleItem" ADD CONSTRAINT "VaultSaleItem_door_check" CHECK ("doorId" ~ '^(X|K|I|N|G|S)-(0[1-9]|1[0-9]|2[0-5])$');
ALTER TABLE "VaultSaleItem" ADD CONSTRAINT "VaultSaleItem_money_check" CHECK ("priceCentsSnapshot" >= 0 AND "taxCentsSnapshot" >= 0 AND "taxRateBasisPoints" BETWEEN 0 AND 10000);
ALTER TABLE "VaultSaleItem" ADD CONSTRAINT "VaultSaleItem_mapping_check" CHECK ("controllerChannelSnapshot" BETWEEN 1 AND 150 AND "mappingVersionSnapshot" ~ '^[1-9][0-9]*$');

ALTER TABLE "VaultMachineEvent" ADD CONSTRAINT "VaultMachineEvent_sequence_check" CHECK ("sequence" > 0 AND "schemaVersion" > 0);
ALTER TABLE "VaultMachineEvent" ADD CONSTRAINT "VaultMachineEvent_digest_check" CHECK ("payloadDigest" ~ '^[a-f0-9]{64}$');
ALTER TABLE "VaultMachineEvent" ADD CONSTRAINT "VaultMachineEvent_payload_check" CHECK (jsonb_typeof("payload") = 'object' AND octet_length("payload"::text) <= 1048576);

ALTER TABLE "VaultRestockSession" ADD CONSTRAINT "VaultRestockSession_counts_check" CHECK ("expectedDoorCount" BETWEEN 1 AND 150 AND "filledCount" >= 0 AND "leftEmptyCount" >= 0 AND "exceptionCount" >= 0 AND "filledCount" + "leftEmptyCount" + "exceptionCount" <= "expectedDoorCount");
ALTER TABLE "VaultRestockSession" ADD CONSTRAINT "VaultRestockSession_actor_tuple_check" CHECK (("actorUserId" IS NULL AND "actorRole" IS NULL AND "actorGrantVersion" IS NULL) OR ("actorUserId" IS NOT NULL AND "actorRole" IS NOT NULL AND "actorGrantVersion" > 0));
ALTER TABLE "VaultRestockItem" ADD CONSTRAINT "VaultRestockItem_door_check" CHECK ("doorId" ~ '^(X|K|I|N|G|S)-(0[1-9]|1[0-9]|2[0-5])$');

ALTER TABLE "VaultStaffMachineAccess" ADD CONSTRAINT "VaultStaffMachineAccess_versions_check" CHECK ("grantVersion" > 0 AND "verifierVersion" > 0);
ALTER TABLE "VaultStaffMachineAccess" ADD CONSTRAINT "VaultStaffMachineAccess_verifier_check" CHECK ("verifierAlgorithm" = 'scrypt' AND "verifierHash" LIKE 'scrypt$v=1$N=16384,r=8,p=1,l=64$%');
ALTER TABLE "VaultStaffMachineAccess" ADD CONSTRAINT "VaultStaffMachineAccess_dates_check" CHECK ("validFrom" < "expiresAt" AND (("status" = 'REVOKED') = ("revokedAt" IS NOT NULL)));

ALTER TABLE "VaultEnrollmentToken" ADD CONSTRAINT "VaultEnrollmentToken_hash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "VaultEnrollmentToken" ADD CONSTRAINT "VaultEnrollmentToken_lifecycle_check" CHECK (("status" <> 'APPROVED' OR "approvedAt" IS NOT NULL) AND ("status" <> 'CONSUMED' OR "consumedAt" IS NOT NULL) AND ("status" <> 'REVOKED' OR "revokedAt" IS NOT NULL));
ALTER TABLE "VaultMachineCredential" ADD CONSTRAINT "VaultMachineCredential_version_check" CHECK ("version" > 0);
ALTER TABLE "VaultMachineCredential" ADD CONSTRAINT "VaultMachineCredential_hash_check" CHECK ("credentialHash" ~ '^[a-f0-9]{64}$');

ALTER TABLE "VaultCertificationSession" ADD CONSTRAINT "VaultCertificationSession_versions_check" CHECK (("localSchemaVersion" IS NULL OR "localSchemaVersion" >= 0) AND "contractVersion" > 0);
ALTER TABLE "VaultCertificationEvidence" ADD CONSTRAINT "VaultCertificationEvidence_door_check" CHECK ("doorId" IS NULL OR "doorId" ~ '^(X|K|I|N|G|S)-(0[1-9]|1[0-9]|2[0-5])$');
ALTER TABLE "VaultCertificationEvidence" ADD CONSTRAINT "VaultCertificationEvidence_digest_check" CHECK ("artifactDigest" IS NULL OR "artifactDigest" ~ '^[a-f0-9]{64}$');
ALTER TABLE "VaultCertificationEvidence" ADD CONSTRAINT "VaultCertificationEvidence_arrays_check" CHECK (jsonb_typeof("expectedDoorIds") = 'array' AND jsonb_typeof("observedDoorIds") = 'array');
ALTER TABLE "VaultCertificate" ADD CONSTRAINT "VaultCertificate_digest_check" CHECK ("digest" ~ '^[a-f0-9]{64}$' AND "schemaVersion" > 0 AND "signingAlgorithm" = 'Ed25519');
ALTER TABLE "VaultSupportCase" ADD CONSTRAINT "VaultSupportCase_doors_check" CHECK (jsonb_typeof("affectedDoorIds") = 'array');

-- Enforce append-only ledgers below the application boundary. Any correction is
-- represented by a new machine event or a new admin audit event.
CREATE FUNCTION "vault_v1_reject_ledger_mutation"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Vault V1 ledger rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "VaultMachineEvent_append_only"
BEFORE UPDATE OR DELETE ON "VaultMachineEvent"
FOR EACH ROW EXECUTE FUNCTION "vault_v1_reject_ledger_mutation"();

CREATE TRIGGER "VaultAdminAuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "VaultAdminAuditEvent"
FOR EACH ROW EXECUTE FUNCTION "vault_v1_reject_ledger_mutation"();

CREATE TRIGGER "VaultStaffMachineAccess_append_only"
BEFORE UPDATE OR DELETE ON "VaultStaffMachineAccess"
FOR EACH ROW EXECUTE FUNCTION "vault_v1_reject_ledger_mutation"();
