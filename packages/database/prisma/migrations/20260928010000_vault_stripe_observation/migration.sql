-- SOURCE ONLY. Apply during a separately approved Vault deployment.
-- Stripe observations are verified by the application before insertion and are
-- independent of the machine's strictly ordered VaultMachineEvent sequence.
CREATE TABLE "VaultStripeObservation" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "readerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "observedStatus" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventCreatedAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VaultStripeObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VaultStripeObservation_stripeEventId_key" ON "VaultStripeObservation"("stripeEventId");
CREATE INDEX "VaultStripeObservation_machineId_saleId_receivedAt_idx" ON "VaultStripeObservation"("machineId", "saleId", "receivedAt");
CREATE INDEX "VaultStripeObservation_paymentIntentId_idx" ON "VaultStripeObservation"("paymentIntentId");
