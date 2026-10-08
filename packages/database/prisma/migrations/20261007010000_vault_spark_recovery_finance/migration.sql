-- SOURCE ONLY: additive migration, never applied by the source build.
-- Existing receipts retain ambiguous method evidence; migration cannot prove acquisition.
ALTER TABLE "VaultSparkObservation"
  ADD COLUMN "receiptSequence" BIGSERIAL NOT NULL,
  ADD COLUMN "methodClassification" TEXT NOT NULL DEFAULT 'AMBIGUOUS',
  ADD COLUMN "methodProfileDigest" TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  ADD COLUMN "methodEvidence" JSONB NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX "VaultSparkObservation_receiptSequence_key" ON "VaultSparkObservation"("receiptSequence");
CREATE INDEX "VaultSparkObservation_machineId_receiptSequence_idx" ON "VaultSparkObservation"("machineId", "receiptSequence");
ALTER TABLE "VaultSparkObservation" ADD CONSTRAINT "VaultSparkObservation_method_check" CHECK ("methodClassification" IN ('ACQUIRING','AMBIGUOUS','UNSUPPORTED'));

CREATE TABLE "VaultPaymentAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "machineId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL UNIQUE REFERENCES "VaultSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "action" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'APPROVED' CHECK ("state" IN ('APPROVED','EXECUTING','UNKNOWN','VOIDED','DECLINED')),
  "approvedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "intentObservedAt" TIMESTAMP(3),
  "outcomeObservedAt" TIMESTAMP(3),
  "evidenceReference" TEXT,
  "errorCode" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "VaultPaymentAction_machineId_state_expiresAt_idx" ON "VaultPaymentAction"("machineId","state","expiresAt");
CREATE TABLE "VaultPaymentEvidenceAnomaly" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "machineId" TEXT NOT NULL,
  "noticeId" TEXT NOT NULL,
  "saleId" TEXT REFERENCES "VaultSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "paymentProvider" TEXT NOT NULL,
  "paymentBindingDigest" TEXT NOT NULL,
  "providerSessionReference" TEXT,
  "providerTransactionReference" TEXT,
  "amountCents" INTEGER CHECK ("amountCents" IS NULL OR "amountCents" > 0),
  "currency" TEXT NOT NULL,
  "captureConfirmed" BOOLEAN NOT NULL,
  "code" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "VaultPaymentEvidenceAnomaly_machineId_noticeId_key" ON "VaultPaymentEvidenceAnomaly"("machineId","noticeId");
CREATE INDEX "VaultPaymentEvidenceAnomaly_machineId_resolvedAt_occurredAt_idx" ON "VaultPaymentEvidenceAnomaly"("machineId","resolvedAt","occurredAt");
