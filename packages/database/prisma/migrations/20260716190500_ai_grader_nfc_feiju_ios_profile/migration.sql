-- Additive Shanghai Feiju iPhone-assisted static-link persistence and integrity constraints.
-- Enum values are committed by the immediately preceding migration before use here.

CREATE TYPE "AiGraderNfcManualIosAttemptState" AS ENUM (
    'awaiting_prelock_tap',
    'awaiting_lock_confirmation',
    'awaiting_postlock_tap',
    'ready_to_complete',
    'failed',
    'expired',
    'consumed'
);

ALTER TABLE "AiGraderNfcTag"
    DROP CONSTRAINT "AiGraderNfcTag_strategy_pair",
    DROP CONSTRAINT "AiGraderNfcTag_verified_evidence";

ALTER TABLE "AiGraderNfcTag"
    ADD CONSTRAINT "AiGraderNfcTag_strategy_pair" CHECK (
        ("chipType" = 'NTAG215' AND "securityMode" = 'static_url_v1') OR
        ("chipType" = 'NTAG424_DNA' AND "securityMode" = 'ntag424_sun_v1') OR
        ("chipType" = 'FEIJU_PROPRIETARY_ISODEP' AND "securityMode" = 'manual_ios_locked_static_url_v1')
    ),
    ADD CONSTRAINT "AiGraderNfcTag_verified_evidence" CHECK (
        "status" NOT IN ('verified', 'active') OR (
            "readbackPayloadSha256" IS NOT NULL AND
            "programmedAt" IS NOT NULL AND
            "verifiedAt" IS NOT NULL AND (
                ("chipType" = 'NTAG215' AND "uidFingerprintSha256" IS NOT NULL) OR
                ("chipType" = 'NTAG424_DNA' AND "uidFingerprintSha256" IS NOT NULL) OR
                ("chipType" = 'FEIJU_PROPRIETARY_ISODEP' AND "uidFingerprintSha256" IS NULL)
            )
        )
    );

CREATE TABLE "AiGraderNfcManualIosAttempt" (
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
    "state" "AiGraderNfcManualIosAttemptState" NOT NULL DEFAULT 'awaiting_prelock_tap',
    "profileVersion" TEXT NOT NULL,
    "qualificationProfile" TEXT NOT NULL,
    "expectedPayloadSha256" TEXT NOT NULL,
    "readbackPayloadSha256" TEXT,
    "preLockTapObservedAt" TIMESTAMP(3),
    "lockStatusConfirmedAt" TIMESTAMP(3),
    "lockStatusConfirmedByUserId" TEXT,
    "writeProtectionEvidence" TEXT,
    "postLockTapObservedAt" TIMESTAMP(3),
    "workstationOperationalAttestation" BOOLEAN NOT NULL DEFAULT false,
    "cryptographicTagAuthentication" BOOLEAN NOT NULL DEFAULT false,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "failureCode" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGraderNfcManualIosAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiGraderNfcManualIosAttempt_id_shape" CHECK ("id" ~ '^nfc_ios_attempt_[A-Za-z0-9_-]{43}$'),
    CONSTRAINT "AiGraderNfcManualIosAttempt_hash_shapes" CHECK (
        "idempotencyKeyHash" ~ '^[a-f0-9]{64}$' AND
        ("completionIdempotencyKeyHash" IS NULL OR "completionIdempotencyKeyHash" ~ '^[a-f0-9]{64}$') AND
        "expectedPayloadSha256" ~ '^[a-f0-9]{64}$' AND
        ("readbackPayloadSha256" IS NULL OR "readbackPayloadSha256" ~ '^[a-f0-9]{64}$')
    ),
    CONSTRAINT "AiGraderNfcManualIosAttempt_profile" CHECK (
        "profileVersion" = 'feiju_iso_dep_ios_static_v1' AND
        "qualificationProfile" = 'feiju_iso_dep_ios_static_v1' AND
        "workstationOperationalAttestation" = false AND
        "cryptographicTagAuthentication" = false
    ),
    CONSTRAINT "AiGraderNfcManualIosAttempt_expiry_bound" CHECK (
        "expiresAt" > "requestedAt" AND "expiresAt" <= "requestedAt" + INTERVAL '30 minutes'
    ),
    CONSTRAINT "AiGraderNfcManualIosAttempt_state_evidence" CHECK (
        (
            "state" = 'awaiting_prelock_tap' AND
            "preLockTapObservedAt" IS NULL AND "lockStatusConfirmedAt" IS NULL AND
            "lockStatusConfirmedByUserId" IS NULL AND "writeProtectionEvidence" IS NULL AND
            "postLockTapObservedAt" IS NULL AND "completionIdempotencyKeyHash" IS NULL AND
            "readbackPayloadSha256" IS NULL AND "consumedAt" IS NULL AND "failureCode" IS NULL
        ) OR (
            "state" = 'awaiting_lock_confirmation' AND
            "preLockTapObservedAt" IS NOT NULL AND "lockStatusConfirmedAt" IS NULL AND
            "lockStatusConfirmedByUserId" IS NULL AND "writeProtectionEvidence" IS NULL AND
            "postLockTapObservedAt" IS NULL AND "completionIdempotencyKeyHash" IS NULL AND
            "readbackPayloadSha256" IS NULL AND "consumedAt" IS NULL AND "failureCode" IS NULL
        ) OR (
            "state" = 'awaiting_postlock_tap' AND
            "preLockTapObservedAt" IS NOT NULL AND "lockStatusConfirmedAt" IS NOT NULL AND
            "lockStatusConfirmedByUserId" IS NOT NULL AND
            "writeProtectionEvidence" = 'ios_read_only_status_observed' AND
            "postLockTapObservedAt" IS NULL AND "completionIdempotencyKeyHash" IS NULL AND
            "readbackPayloadSha256" IS NULL AND "consumedAt" IS NULL AND "failureCode" IS NULL
        ) OR (
            "state" = 'ready_to_complete' AND
            "preLockTapObservedAt" IS NOT NULL AND "lockStatusConfirmedAt" IS NOT NULL AND
            "lockStatusConfirmedByUserId" IS NOT NULL AND
            "writeProtectionEvidence" = 'ios_read_only_status_observed' AND
            "postLockTapObservedAt" IS NOT NULL AND "completionIdempotencyKeyHash" IS NULL AND
            "readbackPayloadSha256" IS NULL AND "consumedAt" IS NULL AND "failureCode" IS NULL
        ) OR (
            "state" = 'consumed' AND
            "preLockTapObservedAt" IS NOT NULL AND "lockStatusConfirmedAt" IS NOT NULL AND
            "lockStatusConfirmedByUserId" IS NOT NULL AND
            "writeProtectionEvidence" = 'ios_read_only_status_observed' AND
            "postLockTapObservedAt" IS NOT NULL AND "completionIdempotencyKeyHash" IS NOT NULL AND
            "readbackPayloadSha256" = "expectedPayloadSha256" AND
            "consumedAt" IS NOT NULL AND "failureCode" IS NULL
        ) OR (
            "state" IN ('failed', 'expired') AND "failureCode" IS NOT NULL AND
            char_length("failureCode") BETWEEN 1 AND 80 AND
            "completionIdempotencyKeyHash" IS NULL AND "readbackPayloadSha256" IS NULL AND
            "consumedAt" IS NULL
        )
    )
);

CREATE UNIQUE INDEX "AiGraderNfcManualIosAttempt_request_idempotency_key"
    ON "AiGraderNfcManualIosAttempt"("tenantId", "requestedByUserId", "idempotencyKeyHash");
CREATE INDEX "AiGraderNfcManualIosAttempt_tagId_state_expiresAt_idx"
    ON "AiGraderNfcManualIosAttempt"("tagId", "state", "expiresAt");
CREATE INDEX "AiGraderNfcManualIosAttempt_tenantId_reportId_state_idx"
    ON "AiGraderNfcManualIosAttempt"("tenantId", "reportId", "state");
CREATE UNIQUE INDEX "AiGraderNfcManualIosAttempt_one_live_per_tag"
    ON "AiGraderNfcManualIosAttempt"("tagId")
    WHERE "state" IN ('awaiting_prelock_tap', 'awaiting_lock_confirmation', 'awaiting_postlock_tap', 'ready_to_complete');

ALTER TABLE "AiGraderNfcManualIosAttempt"
    ADD CONSTRAINT "AiGraderNfcManualIosAttempt_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "AiGraderNfcTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;