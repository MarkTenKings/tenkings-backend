CREATE TYPE "AiGraderDesignReferenceStatus" AS ENUM ('draft', 'approved', 'retired');

CREATE TABLE "AiGraderDesignReference" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "setId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "cardNumber" TEXT NOT NULL,
  "variantId" TEXT,
  "variantKey" TEXT NOT NULL DEFAULT '',
  "parallelId" TEXT,
  "parallelKey" TEXT NOT NULL DEFAULT '',
  "side" TEXT NOT NULL,
  "profile" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "AiGraderDesignReferenceStatus" NOT NULL DEFAULT 'draft',
  "artifactStorageKey" TEXT NOT NULL,
  "artifactSha256" TEXT NOT NULL,
  "artifactMimeType" TEXT NOT NULL,
  "artifactWidthPx" INTEGER NOT NULL,
  "artifactHeightPx" INTEGER NOT NULL,
  "intendedDesignBoundary" JSONB NOT NULL,
  "provenance" JSONB NOT NULL,
  "transformAcceptanceMetadata" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "retiredByUserId" TEXT,
  "retiredAt" TIMESTAMP(3),
  "retirementReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiGraderDesignReference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiGraderDesignReference_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AiGraderDesignReference_identity_values_check" CHECK (
    length(btrim("tenantId")) BETWEEN 1 AND 256
    AND "tenantId" = btrim("tenantId")
    AND length(btrim("setId")) BETWEEN 1 AND 256
    AND "setId" = btrim("setId")
    AND length(btrim("programId")) BETWEEN 1 AND 256
    AND "programId" = btrim("programId")
    AND length(btrim("cardNumber")) BETWEEN 1 AND 128
    AND "cardNumber" = btrim("cardNumber")
    AND ("variantId" IS NULL OR (length(btrim("variantId")) BETWEEN 1 AND 256 AND "variantId" = btrim("variantId")))
    AND ("parallelId" IS NULL OR (length(btrim("parallelId")) BETWEEN 1 AND 256 AND "parallelId" = btrim("parallelId")))
    AND "variantKey" = COALESCE("variantId", '')
    AND "parallelKey" = COALESCE("parallelId", '')
  ),
  CONSTRAINT "AiGraderDesignReference_side_profile_check" CHECK (
    "side" IN ('front', 'back')
    AND "profile" = 'registered_design_template_v1'
    AND "version" >= 1
  ),
  CONSTRAINT "AiGraderDesignReference_artifact_check" CHECK (
    length("artifactStorageKey") BETWEEN 1 AND 1024
    AND "artifactStorageKey" = btrim("artifactStorageKey")
    AND left("artifactStorageKey", 1) <> '/'
    AND position(chr(92) IN "artifactStorageKey") = 0
    AND position('://' IN "artifactStorageKey") = 0
    AND position('?' IN "artifactStorageKey") = 0
    AND position('#' IN "artifactStorageKey") = 0
    AND "artifactStorageKey" !~ '(^|/)\.\.?(/|$)'
    AND "artifactSha256" ~ '^[0-9a-f]{64}$'
    AND "artifactMimeType" ~ '^image/[a-z0-9.+-]+$'
    AND "artifactWidthPx" BETWEEN 1 AND 100000
    AND "artifactHeightPx" BETWEEN 1 AND 100000
  ),
  CONSTRAINT "AiGraderDesignReference_json_metadata_check" CHECK (
    jsonb_typeof("intendedDesignBoundary") = 'object'
    AND "intendedDesignBoundary" <> '{}'::jsonb
    AND "intendedDesignBoundary" ? 'schemaVersion'
    AND "intendedDesignBoundary"->>'schemaVersion' = 'ai-grader-intended-design-boundary-v1'
    AND "intendedDesignBoundary" ? 'coordinateFrame'
    AND "intendedDesignBoundary"->>'coordinateFrame' = 'design_reference_pixels'
    AND jsonb_typeof("provenance") = 'object'
    AND "provenance" <> '{}'::jsonb
    AND "provenance" ? 'schemaVersion'
    AND "provenance"->>'schemaVersion' = 'ai-grader-design-reference-provenance-v1'
    AND "provenance" ? 'sourceKind'
    AND length(btrim("provenance"->>'sourceKind')) BETWEEN 1 AND 128
    AND "provenance"->>'sourceKind' = btrim("provenance"->>'sourceKind')
    AND lower("provenance"->>'sourceKind') !~ '(ebay|internet|marketplace|search[_-]?result|listing|scraped|unknown)'
    AND lower("provenance"::text) !~ '(ebay|marketplace|search[_-]?result|scraped)'
    AND "provenance" @> '{"approvedForPrecisionReference": true}'::jsonb
    AND jsonb_typeof("transformAcceptanceMetadata") = 'object'
    AND "transformAcceptanceMetadata" <> '{}'::jsonb
    AND "transformAcceptanceMetadata" ? 'schemaVersion'
    AND "transformAcceptanceMetadata"->>'schemaVersion' = 'ai-grader-design-reference-transform-acceptance-v1'
    AND "transformAcceptanceMetadata" ? 'registrationAlgorithmVersion'
    AND length(btrim("transformAcceptanceMetadata"->>'registrationAlgorithmVersion')) BETWEEN 1 AND 256
    AND "transformAcceptanceMetadata"->>'registrationAlgorithmVersion' = btrim("transformAcceptanceMetadata"->>'registrationAlgorithmVersion')
    AND "transformAcceptanceMetadata" ? 'maxResidualPx'
    AND jsonb_typeof("transformAcceptanceMetadata"->'maxResidualPx') = 'number'
    AND ("transformAcceptanceMetadata"->>'maxResidualPx')::numeric >= 0
    AND "transformAcceptanceMetadata" ? 'minInlierFraction'
    AND jsonb_typeof("transformAcceptanceMetadata"->'minInlierFraction') = 'number'
    AND ("transformAcceptanceMetadata"->>'minInlierFraction')::numeric BETWEEN 0 AND 1
  ),
  CONSTRAINT "AiGraderDesignReference_actor_values_check" CHECK (
    length(btrim("createdByUserId")) BETWEEN 1 AND 256
    AND "createdByUserId" = btrim("createdByUserId")
    AND ("approvedByUserId" IS NULL OR length(btrim("approvedByUserId")) BETWEEN 1 AND 256)
    AND ("approvedByUserId" IS NULL OR "approvedByUserId" = btrim("approvedByUserId"))
    AND ("retiredByUserId" IS NULL OR length(btrim("retiredByUserId")) BETWEEN 1 AND 256)
    AND ("retiredByUserId" IS NULL OR "retiredByUserId" = btrim("retiredByUserId"))
    AND ("retirementReason" IS NULL OR length(btrim("retirementReason")) BETWEEN 1 AND 1024)
    AND ("retirementReason" IS NULL OR "retirementReason" = btrim("retirementReason"))
  ),
  CONSTRAINT "AiGraderDesignReference_lifecycle_check" CHECK (
    (
      "status" = 'draft'
      AND "approvedByUserId" IS NULL
      AND "approvedAt" IS NULL
      AND "retiredByUserId" IS NULL
      AND "retiredAt" IS NULL
      AND "retirementReason" IS NULL
    )
    OR (
      "status" = 'approved'
      AND "approvedByUserId" IS NOT NULL
      AND "approvedAt" IS NOT NULL
      AND "retiredByUserId" IS NULL
      AND "retiredAt" IS NULL
      AND "retirementReason" IS NULL
    )
    OR (
      "status" = 'retired'
      AND (("approvedByUserId" IS NULL AND "approvedAt" IS NULL) OR ("approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL))
      AND "retiredByUserId" IS NOT NULL
      AND "retiredAt" IS NOT NULL
      AND "retirementReason" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "AiGraderDesignReference_artifactStorageKey_key"
  ON "AiGraderDesignReference"("artifactStorageKey");

CREATE UNIQUE INDEX "AiGraderDesignReference_identity_version_key"
  ON "AiGraderDesignReference"(
    "tenantId", "setId", "programId", "cardNumber", "variantKey", "parallelKey", "side", "profile", "version"
  );

CREATE UNIQUE INDEX "AiGraderDesignReference_one_approved_side"
  ON "AiGraderDesignReference"(
    "tenantId", "setId", "programId", "cardNumber", "variantKey", "parallelKey", "side"
  )
  WHERE "status" = 'approved';

CREATE INDEX "AiGraderDesignReference_identity_status_idx"
  ON "AiGraderDesignReference"(
    "tenantId", "setId", "programId", "cardNumber", "variantKey", "parallelKey", "side", "profile", "status"
  );

CREATE INDEX "AiGraderDesignReference_tenant_status_idx"
  ON "AiGraderDesignReference"("tenantId", "status", "updatedAt");

CREATE INDEX "AiGraderDesignReference_artifactSha256_idx"
  ON "AiGraderDesignReference"("artifactSha256");

CREATE FUNCTION guard_ai_grader_design_reference_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW."id",
    NEW."tenantId",
    NEW."setId",
    NEW."programId",
    NEW."cardNumber",
    NEW."variantId",
    NEW."variantKey",
    NEW."parallelId",
    NEW."parallelKey",
    NEW."side",
    NEW."profile",
    NEW."version",
    NEW."artifactStorageKey",
    NEW."artifactSha256",
    NEW."artifactMimeType",
    NEW."artifactWidthPx",
    NEW."artifactHeightPx",
    NEW."intendedDesignBoundary",
    NEW."provenance",
    NEW."transformAcceptanceMetadata",
    NEW."createdByUserId",
    NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."tenantId",
    OLD."setId",
    OLD."programId",
    OLD."cardNumber",
    OLD."variantId",
    OLD."variantKey",
    OLD."parallelId",
    OLD."parallelKey",
    OLD."side",
    OLD."profile",
    OLD."version",
    OLD."artifactStorageKey",
    OLD."artifactSha256",
    OLD."artifactMimeType",
    OLD."artifactWidthPx",
    OLD."artifactHeightPx",
    OLD."intendedDesignBoundary",
    OLD."provenance",
    OLD."transformAcceptanceMetadata",
    OLD."createdByUserId",
    OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'AiGraderDesignReference identity, artifact, boundary, provenance, and acceptance metadata are immutable';
  END IF;

  IF NOT (
    NEW."status" = OLD."status"
    OR (OLD."status" = 'draft' AND NEW."status" IN ('approved', 'retired'))
    OR (OLD."status" = 'approved' AND NEW."status" = 'retired')
  ) THEN
    RAISE EXCEPTION 'AiGraderDesignReference lifecycle transition is not allowed';
  END IF;

  IF ROW(NEW."approvedByUserId", NEW."approvedAt") IS DISTINCT FROM ROW(OLD."approvedByUserId", OLD."approvedAt")
    AND NOT (OLD."status" = 'draft' AND NEW."status" = 'approved') THEN
    RAISE EXCEPTION 'AiGraderDesignReference approval evidence is immutable outside draft approval';
  END IF;

  IF ROW(NEW."retiredByUserId", NEW."retiredAt", NEW."retirementReason")
    IS DISTINCT FROM ROW(OLD."retiredByUserId", OLD."retiredAt", OLD."retirementReason")
    AND NOT (OLD."status" IN ('draft', 'approved') AND NEW."status" = 'retired') THEN
    RAISE EXCEPTION 'AiGraderDesignReference retirement evidence is immutable outside retirement';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "AiGraderDesignReference_guard_update"
  BEFORE UPDATE ON "AiGraderDesignReference"
  FOR EACH ROW
  EXECUTE FUNCTION guard_ai_grader_design_reference_update();

CREATE FUNCTION reject_ai_grader_design_reference_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AiGraderDesignReference rows are retained; retire a reference instead of deleting it';
END;
$$;

CREATE TRIGGER "AiGraderDesignReference_reject_delete"
  BEFORE DELETE ON "AiGraderDesignReference"
  FOR EACH ROW
  EXECUTE FUNCTION reject_ai_grader_design_reference_delete();

-- Mathematical Grading V1 calibration snapshots are trusted, immutable physical
-- calibration identities. The added CalibrationType value is compared through
-- text in this migration so PostgreSQL never uses a freshly ALTERed enum value
-- before the migration transaction commits.
ALTER TYPE "CalibrationType" ADD VALUE IF NOT EXISTS 'MATHEMATICAL_GRADING_V1';

CREATE TYPE "CalibrationSnapshotTrustStatus" AS ENUM ('DRAFT', 'TRUSTED', 'REVOKED');

ALTER TABLE "CalibrationSnapshot"
  ADD COLUMN "mathematicalProfileId" TEXT,
  ADD COLUMN "mathematicalCalibrationVersion" TEXT,
  ADD COLUMN "mathematicalProfileFinalizedAt" TIMESTAMP(3),
  ADD COLUMN "mathematicalArtifactId" TEXT,
  ADD COLUMN "mathematicalArtifactSha256" TEXT,
  ADD COLUMN "mathematicalThresholdSetId" TEXT,
  ADD COLUMN "mathematicalThresholdSetHash" TEXT,
  ADD COLUMN "mathematicalBundleSchemaVersion" TEXT,
  ADD COLUMN "mathematicalBundleManifestSha256" TEXT,
  ADD COLUMN "mathematicalSourceCaptureManifestSha256" TEXT,
  ADD COLUMN "mathematicalMemberLedgerSha256" TEXT,
  ADD COLUMN "trustStatus" "CalibrationSnapshotTrustStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "trustedAt" TIMESTAMP(3),
  ADD COLUMN "trustedByOperatorId" TEXT,
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revokedByOperatorId" TEXT,
  ADD COLUMN "revocationReason" TEXT,
  ADD COLUMN "supersededByOperatorId" TEXT;

ALTER TABLE "CalibrationSnapshot"
  ADD CONSTRAINT "CalibrationSnapshot_mathematical_identity_check" CHECK (
    (
      "calibrationType"::text <> 'MATHEMATICAL_GRADING_V1'
      AND "mathematicalProfileId" IS NULL
      AND "mathematicalCalibrationVersion" IS NULL
      AND "mathematicalProfileFinalizedAt" IS NULL
      AND "mathematicalArtifactId" IS NULL
      AND "mathematicalArtifactSha256" IS NULL
      AND "mathematicalThresholdSetId" IS NULL
      AND "mathematicalThresholdSetHash" IS NULL
      AND "mathematicalBundleSchemaVersion" IS NULL
      AND "mathematicalBundleManifestSha256" IS NULL
      AND "mathematicalSourceCaptureManifestSha256" IS NULL
      AND "mathematicalMemberLedgerSha256" IS NULL
    )
    OR
    (
      "calibrationType"::text = 'MATHEMATICAL_GRADING_V1'
      AND "mathematicalProfileId" IS NOT NULL
      AND length(btrim("mathematicalProfileId")) BETWEEN 1 AND 256
      AND "mathematicalProfileId" = btrim("mathematicalProfileId")
      AND "mathematicalCalibrationVersion" IS NOT NULL
      AND length(btrim("mathematicalCalibrationVersion")) BETWEEN 1 AND 256
      AND "mathematicalCalibrationVersion" = btrim("mathematicalCalibrationVersion")
      AND "mathematicalProfileFinalizedAt" IS NOT NULL
      AND "mathematicalArtifactId" IS NOT NULL
      AND length(btrim("mathematicalArtifactId")) BETWEEN 1 AND 256
      AND "mathematicalArtifactId" = btrim("mathematicalArtifactId")
      AND "mathematicalArtifactSha256" IS NOT NULL
      AND "mathematicalArtifactSha256" ~ '^[0-9a-f]{64}$'
      AND "mathematicalThresholdSetId" IS NOT NULL
      AND length(btrim("mathematicalThresholdSetId")) BETWEEN 1 AND 256
      AND "mathematicalThresholdSetId" = btrim("mathematicalThresholdSetId")
      AND "mathematicalThresholdSetHash" IS NOT NULL
      AND "mathematicalThresholdSetHash" ~ '^[0-9a-f]{64}$'
      AND "mathematicalBundleSchemaVersion" = 'ten-kings-mathematical-calibration-bundle-v1'
      AND "mathematicalBundleManifestSha256" IS NOT NULL
      AND "mathematicalBundleManifestSha256" ~ '^[0-9a-f]{64}$'
      AND "mathematicalSourceCaptureManifestSha256" IS NOT NULL
      AND "mathematicalSourceCaptureManifestSha256" ~ '^[0-9a-f]{64}$'
      AND "mathematicalMemberLedgerSha256" IS NOT NULL
      AND "mathematicalMemberLedgerSha256" ~ '^[0-9a-f]{64}$'
      AND "validityStartsAt" >= "mathematicalProfileFinalizedAt"
    )
  ),
  ADD CONSTRAINT "CalibrationSnapshot_trust_lifecycle_check" CHECK (
    (
      "trustStatus"::text = 'DRAFT'
      AND "trustedAt" IS NULL
      AND "trustedByOperatorId" IS NULL
      AND "revokedAt" IS NULL
      AND "revokedByOperatorId" IS NULL
      AND "revocationReason" IS NULL
    )
    OR
    (
      "trustStatus"::text = 'TRUSTED'
      AND "trustedAt" IS NOT NULL
      AND "trustedAt" >= "validityStartsAt"
      AND "trustedByOperatorId" IS NOT NULL
      AND length(btrim("trustedByOperatorId")) BETWEEN 1 AND 256
      AND "trustedByOperatorId" = btrim("trustedByOperatorId")
      AND "revokedAt" IS NULL
      AND "revokedByOperatorId" IS NULL
      AND "revocationReason" IS NULL
      AND ("validityEndsAt" IS NULL OR "validityEndsAt" > "trustedAt")
    )
    OR
    (
      "trustStatus"::text = 'REVOKED'
      AND "trustedAt" IS NOT NULL
      AND "trustedAt" >= "validityStartsAt"
      AND "trustedByOperatorId" IS NOT NULL
      AND length(btrim("trustedByOperatorId")) BETWEEN 1 AND 256
      AND "trustedByOperatorId" = btrim("trustedByOperatorId")
      AND "revokedAt" IS NOT NULL
      AND "revokedAt" >= "trustedAt"
      AND "revokedByOperatorId" IS NOT NULL
      AND length(btrim("revokedByOperatorId")) BETWEEN 1 AND 256
      AND "revokedByOperatorId" = btrim("revokedByOperatorId")
      AND "revocationReason" IS NOT NULL
      AND length(btrim("revocationReason")) BETWEEN 1 AND 1024
      AND "revocationReason" = btrim("revocationReason")
      AND ("validityEndsAt" IS NULL OR "validityEndsAt" > "trustedAt")
    )
  ),
  ADD CONSTRAINT "CalibrationSnapshot_validity_window_check" CHECK (
    "validityEndsAt" IS NULL OR "validityEndsAt" > "validityStartsAt"
  ),
  ADD CONSTRAINT "CalibrationSnapshot_mathematical_supersession_check" CHECK (
    "calibrationType"::text <> 'MATHEMATICAL_GRADING_V1'
    OR (
      (
        "supersededById" IS NULL
        AND "supersededByOperatorId" IS NULL
        AND "supersessionReason" IS NULL
      )
      OR (
        "trustStatus"::text = 'TRUSTED'
        AND "supersededById" IS NOT NULL
        AND "supersededByOperatorId" IS NOT NULL
        AND length(btrim("supersededByOperatorId")) BETWEEN 1 AND 256
        AND "supersededByOperatorId" = btrim("supersededByOperatorId")
        AND "supersessionReason" IS NOT NULL
        AND length(btrim("supersessionReason")) BETWEEN 1 AND 1024
        AND "supersessionReason" = btrim("supersessionReason")
        AND "validityEndsAt" IS NOT NULL
      )
    )
  );

CREATE UNIQUE INDEX "CalibrationSnapshot_mathematical_identity_key"
  ON "CalibrationSnapshot"(
    "rigId",
    "calibrationType",
    "mathematicalProfileId",
    "mathematicalCalibrationVersion",
    "mathematicalProfileFinalizedAt",
    "mathematicalArtifactId",
    "mathematicalArtifactSha256",
    "mathematicalThresholdSetId",
    "mathematicalThresholdSetHash",
    "mathematicalBundleSchemaVersion",
    "mathematicalBundleManifestSha256",
    "mathematicalSourceCaptureManifestSha256",
    "mathematicalMemberLedgerSha256"
  );

CREATE INDEX "CalibrationSnapshot_mathematical_readiness_idx"
  ON "CalibrationSnapshot"(
    "rigId",
    "calibrationType",
    "trustStatus",
    "validityStartsAt",
    "validityEndsAt"
  );

CREATE FUNCTION guard_mathematical_calibration_snapshot_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."calibrationType"::text <> 'MATHEMATICAL_GRADING_V1' THEN
    RETURN NEW;
  END IF;

  IF ROW(
    NEW."id",
    NEW."rigId",
    NEW."calibrationType",
    NEW."componentSerials",
    NEW."artifactKeys",
    NEW."artifactChecksums",
    NEW."residuals",
    NEW."operatorId",
    NEW."mathematicalProfileId",
    NEW."mathematicalCalibrationVersion",
    NEW."mathematicalProfileFinalizedAt",
    NEW."mathematicalArtifactId",
    NEW."mathematicalArtifactSha256",
    NEW."mathematicalThresholdSetId",
    NEW."mathematicalThresholdSetHash",
    NEW."mathematicalBundleSchemaVersion",
    NEW."mathematicalBundleManifestSha256",
    NEW."mathematicalSourceCaptureManifestSha256",
    NEW."mathematicalMemberLedgerSha256",
    NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."rigId",
    OLD."calibrationType",
    OLD."componentSerials",
    OLD."artifactKeys",
    OLD."artifactChecksums",
    OLD."residuals",
    OLD."operatorId",
    OLD."mathematicalProfileId",
    OLD."mathematicalCalibrationVersion",
    OLD."mathematicalProfileFinalizedAt",
    OLD."mathematicalArtifactId",
    OLD."mathematicalArtifactSha256",
    OLD."mathematicalThresholdSetId",
    OLD."mathematicalThresholdSetHash",
    OLD."mathematicalBundleSchemaVersion",
    OLD."mathematicalBundleManifestSha256",
    OLD."mathematicalSourceCaptureManifestSha256",
    OLD."mathematicalMemberLedgerSha256",
    OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'Mathematical CalibrationSnapshot physical identity and hashes are immutable';
  END IF;

  IF NOT (
    NEW."trustStatus" = OLD."trustStatus"
    OR (OLD."trustStatus"::text = 'DRAFT' AND NEW."trustStatus"::text = 'TRUSTED')
    OR (OLD."trustStatus"::text = 'TRUSTED' AND NEW."trustStatus"::text = 'REVOKED')
  ) THEN
    RAISE EXCEPTION 'Mathematical CalibrationSnapshot trust transition is not allowed';
  END IF;

  IF OLD."trustStatus"::text IN ('TRUSTED', 'REVOKED')
    AND ROW(NEW."trustedAt", NEW."trustedByOperatorId")
      IS DISTINCT FROM ROW(OLD."trustedAt", OLD."trustedByOperatorId") THEN
    RAISE EXCEPTION 'Mathematical CalibrationSnapshot trust evidence is immutable';
  END IF;

  IF OLD."trustStatus"::text = 'REVOKED'
    AND ROW(NEW."revokedAt", NEW."revokedByOperatorId", NEW."revocationReason")
      IS DISTINCT FROM ROW(OLD."revokedAt", OLD."revokedByOperatorId", OLD."revocationReason") THEN
    RAISE EXCEPTION 'Mathematical CalibrationSnapshot revocation evidence is immutable';
  END IF;

  IF OLD."trustStatus"::text IN ('TRUSTED', 'REVOKED')
    AND NEW."validityStartsAt" IS DISTINCT FROM OLD."validityStartsAt" THEN
    RAISE EXCEPTION 'Mathematical CalibrationSnapshot validity start is immutable after trust';
  END IF;

  IF OLD."validityEndsAt" IS NOT NULL
    AND NEW."validityEndsAt" IS DISTINCT FROM OLD."validityEndsAt" THEN
    RAISE EXCEPTION 'Mathematical CalibrationSnapshot closed validity window is immutable';
  END IF;

  IF OLD."supersededById" IS NOT NULL
    AND ROW(NEW."supersededById", NEW."supersededByOperatorId", NEW."supersessionReason")
      IS DISTINCT FROM ROW(OLD."supersededById", OLD."supersededByOperatorId", OLD."supersessionReason") THEN
    RAISE EXCEPTION 'Mathematical CalibrationSnapshot supersession evidence is immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "CalibrationSnapshot_guard_mathematical_update"
  BEFORE UPDATE ON "CalibrationSnapshot"
  FOR EACH ROW
  EXECUTE FUNCTION guard_mathematical_calibration_snapshot_update();

CREATE FUNCTION reject_mathematical_calibration_snapshot_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."calibrationType"::text = 'MATHEMATICAL_GRADING_V1' THEN
    RAISE EXCEPTION 'Mathematical CalibrationSnapshot rows are retained; revoke or supersede instead of deleting';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "CalibrationSnapshot_reject_mathematical_delete"
  BEFORE DELETE ON "CalibrationSnapshot"
  FOR EACH ROW
  EXECUTE FUNCTION reject_mathematical_calibration_snapshot_delete();

ALTER TABLE "AiGraderReport"
  ADD COLUMN "calibrationSnapshotId" TEXT;

ALTER TABLE "AiGraderReport"
  ADD CONSTRAINT "AiGraderReport_calibrationSnapshotId_fkey"
  FOREIGN KEY ("calibrationSnapshotId") REFERENCES "CalibrationSnapshot"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "AiGraderReport_calibrationSnapshotId_idx"
  ON "AiGraderReport"("calibrationSnapshotId");
