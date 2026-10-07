-- Additive financial review authority. No captured amount or inventory is changed.
ALTER TABLE "VaultPaymentAction" ALTER COLUMN "saleId" DROP NOT NULL;
ALTER TABLE "VaultPaymentAction" ADD COLUMN "originalSaleId" TEXT;
UPDATE "VaultPaymentAction" SET "originalSaleId"="saleId";
ALTER TABLE "VaultPaymentAction" ALTER COLUMN "originalSaleId" SET NOT NULL;
ALTER TABLE "VaultPaymentAction" ADD COLUMN "retiredAt" TIMESTAMP(3), ADD COLUMN "retirementProof" JSONB,
  ADD COLUMN "externalReviewedAt" TIMESTAMP(3), ADD COLUMN "externalReview" JSONB;
ALTER TABLE "VaultPaymentAction" DROP CONSTRAINT "VaultPaymentAction_state_check";
ALTER TABLE "VaultPaymentAction" ADD CONSTRAINT "VaultPaymentAction_state_check" CHECK ("state" IN ('APPROVED','EXECUTING','UNKNOWN','VOIDED','DECLINED','RETIRED_UNSTARTED'));
ALTER TABLE "VaultPaymentAction" ADD CONSTRAINT "VaultPaymentAction_retirement_check" CHECK
  (("saleId" IS NOT NULL AND "state" <> 'RETIRED_UNSTARTED') OR ("saleId" IS NULL AND "state"='RETIRED_UNSTARTED' AND "retiredAt" IS NOT NULL AND "retirementProof" IS NOT NULL));
CREATE TABLE "VaultFinancialRecoverySnapshot" (
  "id" TEXT PRIMARY KEY, "machineId" TEXT NOT NULL, "generation" INTEGER NOT NULL CHECK ("generation">0),
  "stateDigest" TEXT NOT NULL, "snapshot" JSONB NOT NULL, "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "VaultFinancialRecoverySnapshot_machineId_generation_key" ON "VaultFinancialRecoverySnapshot"("machineId","generation");
CREATE TABLE "VaultFinancialRecoveryDecision" (
  "id" TEXT PRIMARY KEY, "machineId" TEXT NOT NULL, "snapshotId" TEXT NOT NULL REFERENCES "VaultFinancialRecoverySnapshot"("id") ON DELETE RESTRICT,
  "decision" JSONB NOT NULL, "state" TEXT NOT NULL DEFAULT 'APPROVED' CHECK ("state" IN ('APPROVED','APPLIED','SUPERSEDED')),
  "approvedAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "appliedAt" TIMESTAMP(3)
);
CREATE INDEX "VaultFinancialRecoveryDecision_machineId_state_expiresAt_idx" ON "VaultFinancialRecoveryDecision"("machineId","state","expiresAt");
CREATE FUNCTION vault_financial_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Vault financial snapshots are immutable'; END $$;
CREATE TRIGGER vault_financial_snapshot_immutable BEFORE UPDATE OR DELETE ON "VaultFinancialRecoverySnapshot" FOR EACH ROW EXECUTE FUNCTION vault_financial_snapshot_immutable();
CREATE FUNCTION vault_financial_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Vault financial decisions are retained'; END IF;
  IF OLD."state" IN ('APPLIED','SUPERSEDED') OR NEW."id"<>OLD."id" OR NEW."machineId"<>OLD."machineId" OR NEW."snapshotId"<>OLD."snapshotId" OR NEW."decision"<>OLD."decision" OR NEW."approvedAt"<>OLD."approvedAt" OR NEW."expiresAt"<>OLD."expiresAt" THEN RAISE EXCEPTION 'Vault financial decision authority is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vault_financial_decision_guard BEFORE UPDATE OR DELETE ON "VaultFinancialRecoveryDecision" FOR EACH ROW EXECUTE FUNCTION vault_financial_decision_guard();

-- Original approval authority and every terminal/review outcome are retained.
ALTER TABLE "VaultPaymentAction" ADD CONSTRAINT "VaultPaymentAction_review_check" CHECK
  (("externalReviewedAt" IS NULL AND "externalReview" IS NULL) OR ("externalReviewedAt" IS NOT NULL AND "externalReview" IS NOT NULL AND "state"='UNKNOWN'));
CREATE FUNCTION vault_payment_action_authority_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Vault payment actions are retained'; END IF;
  IF NEW."id"<>OLD."id" OR NEW."machineId"<>OLD."machineId" OR NEW."originalSaleId"<>OLD."originalSaleId" OR NEW."action"<>OLD."action" OR NEW."approvedAt"<>OLD."approvedAt" OR NEW."expiresAt"<>OLD."expiresAt" THEN RAISE EXCEPTION 'Vault payment action authority is immutable'; END IF;
  IF OLD."state" IN ('VOIDED','DECLINED','RETIRED_UNSTARTED') OR OLD."externalReviewedAt" IS NOT NULL THEN RAISE EXCEPTION 'Vault payment action outcome is immutable'; END IF;
  IF NEW."saleId" IS DISTINCT FROM OLD."saleId" AND NOT (OLD."state"='APPROVED' AND NEW."state"='RETIRED_UNSTARTED' AND NEW."saleId" IS NULL AND OLD."intentObservedAt" IS NULL AND OLD."outcomeObservedAt" IS NULL) THEN RAISE EXCEPTION 'Only proven unstarted retirement releases payment action ownership'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vault_payment_action_authority_guard BEFORE UPDATE OR DELETE ON "VaultPaymentAction" FOR EACH ROW EXECUTE FUNCTION vault_payment_action_authority_guard();
