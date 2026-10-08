-- SOURCE ONLY. Additive stage isolation; all historical receipt identities remain intact.
ALTER TABLE "VaultSparkObservation"
  ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'SANDBOX',
  ADD COLUMN "paymentBindingDigest" TEXT;
ALTER TABLE "VaultSparkObservation" ADD CONSTRAINT "VaultSparkObservation_stage_binding_check" CHECK (
  ("stage" = 'SANDBOX' AND "id" NOT LIKE 'spark-production:%' AND "paymentBindingDigest" IS NULL)
  OR ("stage" = 'PRODUCTION' AND "id" ~ '^spark-production:[a-f0-9]{64}$' AND "paymentBindingDigest" ~ '^[a-f0-9]{64}$' AND "paymentBindingDigest" IS NOT NULL)
);
CREATE INDEX "VaultSparkObservation_machineId_stage_session_received_idx" ON "VaultSparkObservation"("machineId", "stage", "sparkTransactionId", "receivedAt");
CREATE INDEX "VaultSparkObservation_machineId_stage_receiptSequence_idx" ON "VaultSparkObservation"("machineId", "stage", "receiptSequence");
