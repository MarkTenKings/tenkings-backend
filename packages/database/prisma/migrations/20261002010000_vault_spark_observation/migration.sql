-- SOURCE ONLY. Requires separately authorized Vault migration/deployment.
-- Spark inbox does not write sale state or authorize a controller command.
CREATE TABLE "VaultSparkObservation" (
    "id" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sparkTransactionId" TEXT NOT NULL,
    "nayaxTransactionId" TEXT,
    "nayaxMachineId" TEXT NOT NULL,
    "terminalId" TEXT,
    "hwSerial" TEXT NOT NULL,
    "siteId" INTEGER,
    "amountCents" INTEGER,
    "currency" TEXT,
    "currencySource" TEXT,
    "verdict" TEXT,
    "errorCode" INTEGER,
    "machineAuTime" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VaultSparkObservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VaultSparkObservation_kind_check" CHECK ("kind" IN ('TRANSACTION', 'DECLINE', 'TIMEOUT')),
    CONSTRAINT "VaultSparkObservation_amount_check" CHECK ("amountCents" IS NULL OR "amountCents" > 0)
);
CREATE INDEX "VaultSparkObservation_machineId_sparkTransactionId_receivedAt_idx" ON "VaultSparkObservation"("machineId", "sparkTransactionId", "receivedAt");
CREATE INDEX "VaultSparkObservation_nayaxTransactionId_idx" ON "VaultSparkObservation"("nayaxTransactionId");
