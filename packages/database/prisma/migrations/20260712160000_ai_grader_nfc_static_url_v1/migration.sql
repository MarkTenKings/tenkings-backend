-- AI Grader NFC static_url_v1 durable identity records.
-- REVIEWED MIGRATION: create only. DO NOT APPLY from this PR or from a Vercel
-- build. Apply later through the approved migration runbook after explicit
-- production approval; RUN_DB_MIGRATIONS must remain unset/false meanwhile.

CREATE TYPE "AiGraderNfcChipType" AS ENUM ('NTAG215', 'NTAG424_DNA');
CREATE TYPE "AiGraderNfcSecurityMode" AS ENUM ('static_url_v1', 'ntag424_sun_v1');
CREATE TYPE "AiGraderNfcTagStatus" AS ENUM ('reserved', 'programming', 'verified', 'active', 'revoked', 'error');
CREATE TYPE "AiGraderNfcProgrammingAttemptState" AS ENUM ('initialized', 'writing', 'verified', 'failed', 'expired', 'consumed');

CREATE TABLE "AiGraderNfcTag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "publicTagId" TEXT NOT NULL,
    "chipType" "AiGraderNfcChipType" NOT NULL DEFAULT 'NTAG215',
    "securityMode" "AiGraderNfcSecurityMode" NOT NULL DEFAULT 'static_url_v1',
    "status" "AiGraderNfcTagStatus" NOT NULL DEFAULT 'reserved',
    "uidFingerprintSha256" TEXT,
    "ndefPayloadVersion" INTEGER NOT NULL DEFAULT 1,
    "expectedPayloadSha256" TEXT NOT NULL,
    "readbackPayloadSha256" TEXT,
    "aiGraderReportId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "cardAssetId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "aiGraderLabelId" TEXT NOT NULL,
    "certId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "programmedByUserId" TEXT,
    "verifiedByUserId" TEXT,
    "activatedByUserId" TEXT,
    "revokedByUserId" TEXT,
    "programmedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "errorCode" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiGraderNfcTag_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiGraderNfcTag_public_id_shape" CHECK ("publicTagId" ~ '^[A-Za-z0-9_-]{32}$'),
    CONSTRAINT "AiGraderNfcTag_expected_digest_shape" CHECK ("expectedPayloadSha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "AiGraderNfcTag_readback_digest_shape" CHECK ("readbackPayloadSha256" IS NULL OR "readbackPayloadSha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "AiGraderNfcTag_uid_fingerprint_shape" CHECK ("uidFingerprintSha256" IS NULL OR "uidFingerprintSha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "AiGraderNfcTag_strategy_pair" CHECK (
      ("chipType" = 'NTAG215' AND "securityMode" = 'static_url_v1') OR
      ("chipType" = 'NTAG424_DNA' AND "securityMode" = 'ntag424_sun_v1')
    ),
    CONSTRAINT "AiGraderNfcTag_payload_version" CHECK ("ndefPayloadVersion" > 0 AND "ndefPayloadVersion" <= 1000),
    CONSTRAINT "AiGraderNfcTag_linkage_bounds" CHECK (
      char_length("tenantId") BETWEEN 1 AND 128 AND
      char_length("reportId") BETWEEN 1 AND 256 AND
      char_length("certId") BETWEEN 1 AND 256 AND
      char_length("createdByUserId") BETWEEN 1 AND 128
    ),
    CONSTRAINT "AiGraderNfcTag_verified_evidence" CHECK (
      "status" NOT IN ('verified', 'active') OR
      ("uidFingerprintSha256" IS NOT NULL AND "readbackPayloadSha256" IS NOT NULL AND
       "programmedAt" IS NOT NULL AND "verifiedAt" IS NOT NULL)
    ),
    CONSTRAINT "AiGraderNfcTag_active_evidence" CHECK (
      "status" <> 'active' OR ("activatedAt" IS NOT NULL AND "activatedByUserId" IS NOT NULL)
    ),
    CONSTRAINT "AiGraderNfcTag_active_not_revoked" CHECK (
      "status" <> 'active' OR
      ("revokedAt" IS NULL AND "revokedByUserId" IS NULL AND "revocationReason" IS NULL)
    ),
    CONSTRAINT "AiGraderNfcTag_revocation_required" CHECK (
      "status" <> 'revoked' OR
      ("revokedAt" IS NOT NULL AND "revokedByUserId" IS NOT NULL AND "revocationReason" IS NOT NULL AND
       char_length(btrim("revocationReason")) BETWEEN 3 AND 500)
    ),
    CONSTRAINT "AiGraderNfcTag_error_code_required" CHECK (
      "status" <> 'error' OR
      ("errorCode" IS NOT NULL AND char_length(btrim("errorCode")) BETWEEN 1 AND 80)
    ),
    CONSTRAINT "AiGraderNfcTag_metadata_bound" CHECK ("metadata" IS NULL OR pg_column_size("metadata") <= 4096)
);

CREATE TABLE "AiGraderNfcProgrammingAttempt" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "cardAssetId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "certId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "idempotencyKeyHash" TEXT NOT NULL,
    "completionIdempotencyKeyHash" TEXT,
    "tokenHash" TEXT NOT NULL,
    "state" "AiGraderNfcProgrammingAttemptState" NOT NULL DEFAULT 'initialized',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "failureCode" TEXT,
    "readbackEvidence" JSONB,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiGraderNfcProgrammingAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiGraderNfcProgrammingAttempt_id_shape" CHECK ("id" ~ '^nfc_attempt_[A-Za-z0-9_-]{24}$'),
    CONSTRAINT "AiGraderNfcProgrammingAttempt_token_hash_shape" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "AiGraderNfcProgrammingAttempt_idempotency_hash_shape" CHECK ("idempotencyKeyHash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "AiGraderNfcProgrammingAttempt_completion_idempotency_hash_shape" CHECK (
      "completionIdempotencyKeyHash" IS NULL OR "completionIdempotencyKeyHash" ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT "AiGraderNfcProgrammingAttempt_expiry_bound" CHECK (
      "expiresAt" > "requestedAt" AND "expiresAt" <= "requestedAt" + INTERVAL '30 minutes'
    ),
    CONSTRAINT "AiGraderNfcProgrammingAttempt_consumed_state" CHECK (
      ("state" = 'consumed' AND "consumedAt" IS NOT NULL) OR
      ("state" <> 'consumed' AND "consumedAt" IS NULL)
    ),
    CONSTRAINT "AiGraderNfcProgrammingAttempt_failure_state" CHECK (
      "failureCode" IS NULL OR
      ("state" IN ('failed', 'expired') AND char_length("failureCode") BETWEEN 1 AND 80)
    ),
    CONSTRAINT "AiGraderNfcProgrammingAttempt_evidence_bound" CHECK (
      "readbackEvidence" IS NULL OR pg_column_size("readbackEvidence") <= 4096
    )
);

CREATE TABLE "AiGraderNfcAuditEvent" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "attemptId" TEXT,
    "tenantId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" "AiGraderNfcTagStatus",
    "toStatus" "AiGraderNfcTagStatus",
    "actorUserId" TEXT NOT NULL,
    "reasonCode" TEXT,
    "safeDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiGraderNfcAuditEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiGraderNfcAuditEvent_action_bound" CHECK (char_length("action") BETWEEN 1 AND 80),
    CONSTRAINT "AiGraderNfcAuditEvent_reason_bound" CHECK ("reasonCode" IS NULL OR char_length("reasonCode") BETWEEN 1 AND 80),
    CONSTRAINT "AiGraderNfcAuditEvent_details_bound" CHECK ("safeDetails" IS NULL OR pg_column_size("safeDetails") <= 4096)
);

CREATE UNIQUE INDEX "AiGraderNfcTag_publicTagId_key" ON "AiGraderNfcTag"("publicTagId");
CREATE INDEX "AiGraderNfcTag_tenantId_reportId_status_idx" ON "AiGraderNfcTag"("tenantId", "reportId", "status");
CREATE INDEX "AiGraderNfcTag_cardAssetId_status_idx" ON "AiGraderNfcTag"("cardAssetId", "status");
CREATE INDEX "AiGraderNfcTag_itemId_status_idx" ON "AiGraderNfcTag"("itemId", "status");
CREATE INDEX "AiGraderNfcTag_uidFingerprintSha256_status_idx" ON "AiGraderNfcTag"("uidFingerprintSha256", "status");
CREATE INDEX "AiGraderNfcTag_aiGraderReportId_idx" ON "AiGraderNfcTag"("aiGraderReportId");
CREATE INDEX "AiGraderNfcTag_aiGraderLabelId_idx" ON "AiGraderNfcTag"("aiGraderLabelId");

-- An unreplaced report/card/item can own only one live reservation. Revocation
-- is therefore mandatory before a replacement reservation can be inserted.
CREATE UNIQUE INDEX "AiGraderNfcTag_one_open_report"
  ON "AiGraderNfcTag"("tenantId", "aiGraderReportId")
  WHERE "status" IN ('reserved', 'programming', 'verified', 'active');
CREATE UNIQUE INDEX "AiGraderNfcTag_one_open_card"
  ON "AiGraderNfcTag"("tenantId", "cardAssetId")
  WHERE "status" IN ('reserved', 'programming', 'verified', 'active');
CREATE UNIQUE INDEX "AiGraderNfcTag_one_open_item"
  ON "AiGraderNfcTag"("tenantId", "itemId")
  WHERE "status" IN ('reserved', 'programming', 'verified', 'active');
CREATE UNIQUE INDEX "AiGraderNfcTag_one_active_uid"
  ON "AiGraderNfcTag"("uidFingerprintSha256")
  WHERE "status" = 'active' AND "uidFingerprintSha256" IS NOT NULL;

CREATE UNIQUE INDEX "AiGraderNfcProgrammingAttempt_tokenHash_key" ON "AiGraderNfcProgrammingAttempt"("tokenHash");
CREATE UNIQUE INDEX "AiGraderNfcProgrammingAttempt_tenantId_requestedByUserId_idempotencyKeyHash_key"
  ON "AiGraderNfcProgrammingAttempt"("tenantId", "requestedByUserId", "idempotencyKeyHash");
CREATE INDEX "AiGraderNfcProgrammingAttempt_tagId_state_expiresAt_idx" ON "AiGraderNfcProgrammingAttempt"("tagId", "state", "expiresAt");
CREATE INDEX "AiGraderNfcProgrammingAttempt_tenantId_reportId_state_idx" ON "AiGraderNfcProgrammingAttempt"("tenantId", "reportId", "state");
CREATE INDEX "AiGraderNfcAuditEvent_tagId_createdAt_idx" ON "AiGraderNfcAuditEvent"("tagId", "createdAt");
CREATE INDEX "AiGraderNfcAuditEvent_attemptId_createdAt_idx" ON "AiGraderNfcAuditEvent"("attemptId", "createdAt");
CREATE INDEX "AiGraderNfcAuditEvent_tenantId_reportId_createdAt_idx" ON "AiGraderNfcAuditEvent"("tenantId", "reportId", "createdAt");

ALTER TABLE "AiGraderNfcTag" ADD CONSTRAINT "AiGraderNfcTag_aiGraderReportId_fkey"
  FOREIGN KEY ("aiGraderReportId") REFERENCES "AiGraderReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGraderNfcTag" ADD CONSTRAINT "AiGraderNfcTag_cardAssetId_fkey"
  FOREIGN KEY ("cardAssetId") REFERENCES "CardAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGraderNfcTag" ADD CONSTRAINT "AiGraderNfcTag_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGraderNfcTag" ADD CONSTRAINT "AiGraderNfcTag_aiGraderLabelId_fkey"
  FOREIGN KEY ("aiGraderLabelId") REFERENCES "AiGraderLabel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGraderNfcProgrammingAttempt" ADD CONSTRAINT "AiGraderNfcProgrammingAttempt_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "AiGraderNfcTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGraderNfcAuditEvent" ADD CONSTRAINT "AiGraderNfcAuditEvent_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "AiGraderNfcTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGraderNfcAuditEvent" ADD CONSTRAINT "AiGraderNfcAuditEvent_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "AiGraderNfcProgrammingAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Audit rows are append-only. This also protects them from accidental Prisma
-- update/delete calls after deployment.
CREATE FUNCTION "reject_ai_grader_nfc_audit_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AiGraderNfcAuditEvent rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AiGraderNfcAuditEvent_immutable_update"
  BEFORE UPDATE ON "AiGraderNfcAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "reject_ai_grader_nfc_audit_mutation"();
CREATE TRIGGER "AiGraderNfcAuditEvent_immutable_delete"
  BEFORE DELETE ON "AiGraderNfcAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "reject_ai_grader_nfc_audit_mutation"();
