\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  missing_columns text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum enum_value
    JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
    WHERE enum_type.typname = 'CalibrationType'
      AND enum_value.enumlabel = 'MATHEMATICAL_GRADING_V1'
  ) THEN
    RAISE EXCEPTION 'MATHEMATICAL_GRADING_V1 CalibrationType is absent';
  END IF;

  SELECT array_agg(expected.column_name ORDER BY expected.column_name)
  INTO missing_columns
  FROM (VALUES
    ('mathematicalProfileId'),
    ('mathematicalCalibrationVersion'),
    ('mathematicalProfileFinalizedAt'),
    ('mathematicalArtifactId'),
    ('mathematicalArtifactSha256'),
    ('mathematicalThresholdSetId'),
    ('mathematicalThresholdSetHash'),
    ('mathematicalBundleSchemaVersion'),
    ('mathematicalBundleManifestSha256'),
    ('mathematicalSourceCaptureManifestSha256'),
    ('mathematicalMemberLedgerSha256'),
    ('trustStatus'),
    ('trustedAt'),
    ('trustedByOperatorId'),
    ('revokedAt'),
    ('revokedByOperatorId'),
    ('revocationReason'),
    ('supersededByOperatorId')
  ) AS expected(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns actual
    WHERE actual.table_schema = 'public'
      AND actual.table_name = 'CalibrationSnapshot'
      AND actual.column_name = expected.column_name
  );
  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Mathematical CalibrationSnapshot columns are absent: %', missing_columns;
  END IF;

  IF (
    SELECT count(*) FROM pg_constraint
    WHERE conname IN (
      'CalibrationSnapshot_mathematical_identity_check',
      'CalibrationSnapshot_trust_lifecycle_check',
      'CalibrationSnapshot_validity_window_check',
      'CalibrationSnapshot_mathematical_supersession_check',
      'AiGraderReport_calibrationSnapshotId_fkey'
    )
  ) <> 5 THEN
    RAISE EXCEPTION 'Mathematical CalibrationSnapshot constraints are incomplete';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN (
        'CalibrationSnapshot_guard_mathematical_update',
        'CalibrationSnapshot_reject_mathematical_delete'
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'Mathematical CalibrationSnapshot immutable triggers are incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'CalibrationSnapshot'
      AND indexname = 'CalibrationSnapshot_mathematical_identity_key'
      AND indexdef LIKE '%"mathematicalProfileFinalizedAt"%'
      AND indexdef LIKE '%"mathematicalArtifactId"%'
      AND indexdef LIKE '%"mathematicalThresholdSetId"%'
      AND indexdef LIKE '%"mathematicalBundleManifestSha256"%'
      AND indexdef LIKE '%"mathematicalMemberLedgerSha256"%'
  ) THEN
    RAISE EXCEPTION 'Mathematical CalibrationSnapshot exact identity index is incomplete';
  END IF;
END;
$$;

INSERT INTO "Tenant" ("id", "name", "slug", "createdAt", "updatedAt")
VALUES (
  'math-calibration-tenant',
  'Mathematical Calibration Validation',
  'math-calibration-validation',
  '2026-07-18T18:00:00.000Z',
  '2026-07-18T18:00:00.000Z'
);

INSERT INTO "RigLocation" ("id", "tenantId", "name", "createdAt", "updatedAt")
VALUES (
  'math-calibration-location',
  'math-calibration-tenant',
  'Disposable calibration bench',
  '2026-07-18T18:00:00.000Z',
  '2026-07-18T18:00:00.000Z'
);

INSERT INTO "CaptureRig" (
  "id", "tenantId", "locationId", "label", "rigVersion", "status", "createdAt", "updatedAt"
) VALUES (
  'math-calibration-rig',
  'math-calibration-tenant',
  'math-calibration-location',
  'Disposable Mathematical V1 rig',
  'FIXED_RIG_V1',
  'ACTIVE',
  '2026-07-18T18:00:00.000Z',
  '2026-07-18T18:00:00.000Z'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO "CalibrationSnapshot" (
      "id", "rigId", "calibrationType", "componentSerials",
      "artifactKeys", "artifactChecksums", "validityStartsAt", "createdAt"
    ) VALUES (
      'math-calibration-missing-identity',
      'math-calibration-rig',
      'MATHEMATICAL_GRADING_V1',
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      '2026-07-18T18:05:00.000Z',
      '2026-07-18T18:05:00.000Z'
    );
    RAISE EXCEPTION 'Expected incomplete Mathematical V1 identity rejection';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO "CalibrationSnapshot" (
  "id", "rigId", "calibrationType", "componentSerials", "artifactKeys",
  "artifactChecksums", "residuals", "operatorId",
  "mathematicalProfileId", "mathematicalCalibrationVersion",
  "mathematicalProfileFinalizedAt", "mathematicalArtifactId",
  "mathematicalArtifactSha256", "mathematicalThresholdSetId",
  "mathematicalThresholdSetHash", "mathematicalBundleSchemaVersion",
  "mathematicalBundleManifestSha256", "mathematicalSourceCaptureManifestSha256",
  "mathematicalMemberLedgerSha256", "mathematicalOperatingContextV1",
  "mathematicalOperatingContextHash", "mathematicalRuntimeContextHash",
  "mathematicalRigCharacterizationSha256", "validityStartsAt", "createdAt"
) VALUES (
  'math-calibration-snapshot',
  'math-calibration-rig',
  'MATHEMATICAL_GRADING_V1',
  '{"camera":"validation-camera"}'::jsonb,
  '{"profile":"validation/calibration-profile.json"}'::jsonb,
  '{"profile":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb,
  '{"u95Mm":0.02}'::jsonb,
  'validation-operator',
  'mathematical-profile-v1',
  'mathematical-calibration-2026-07-18',
  '2026-07-18T18:00:00.000Z',
  'mathematical-calibration-artifact-v1',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'ten-kings-mathematical-v1',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'ten-kings-mathematical-calibration-bundle-v1',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  '{"schemaVersion":"ten-kings-ai-grader-operating-context-v1"}'::jsonb,
  '1111111111111111111111111111111111111111111111111111111111111111',
  '2222222222222222222222222222222222222222222222222222222222222222',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '2026-07-18T18:05:00.000Z',
  '2026-07-18T18:05:00.000Z'
);

DO $$
BEGIN
  BEGIN
    UPDATE "CalibrationSnapshot"
    SET "trustStatus" = 'TRUSTED',
        "trustedAt" = '2026-07-18T18:30:00.000Z'
    WHERE "id" = 'math-calibration-snapshot';
    RAISE EXCEPTION 'Expected incomplete Mathematical V1 trust evidence rejection';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

UPDATE "CalibrationSnapshot"
SET "trustStatus" = 'TRUSTED',
    "trustedAt" = '2026-07-18T18:30:00.000Z',
    "trustedByOperatorId" = 'validation-operator'
WHERE "id" = 'math-calibration-snapshot';

DO $$
DECLARE
  matching_count integer;
BEGIN
  SELECT count(*) INTO matching_count
  FROM "CalibrationSnapshot" snapshot
  JOIN "CaptureRig" rig ON rig."id" = snapshot."rigId"
  WHERE snapshot."rigId" = 'math-calibration-rig'
    AND snapshot."calibrationType" = 'MATHEMATICAL_GRADING_V1'
    AND snapshot."mathematicalProfileId" = 'mathematical-profile-v1'
    AND snapshot."mathematicalCalibrationVersion" = 'mathematical-calibration-2026-07-18'
    AND snapshot."mathematicalProfileFinalizedAt" = '2026-07-18T18:00:00.000Z'
    AND snapshot."mathematicalArtifactId" = 'mathematical-calibration-artifact-v1'
    AND snapshot."mathematicalArtifactSha256" = repeat('a', 64)
    AND snapshot."mathematicalThresholdSetId" = 'ten-kings-mathematical-v1'
    AND snapshot."mathematicalThresholdSetHash" = repeat('b', 64)
    AND snapshot."mathematicalBundleSchemaVersion" = 'ten-kings-mathematical-calibration-bundle-v1'
    AND snapshot."mathematicalBundleManifestSha256" = repeat('c', 64)
    AND snapshot."mathematicalSourceCaptureManifestSha256" = repeat('d', 64)
    AND snapshot."mathematicalMemberLedgerSha256" = repeat('e', 64)
    AND snapshot."trustStatus" = 'TRUSTED'
    AND snapshot."trustedAt" <= '2026-07-18T19:00:00.000Z'
    AND snapshot."validityStartsAt" <= '2026-07-18T19:00:00.000Z'
    AND (
      snapshot."validityEndsAt" IS NULL
      OR snapshot."validityEndsAt" > '2026-07-18T19:00:00.000Z'
    )
    AND snapshot."supersededById" IS NULL
    AND rig."tenantId" = 'math-calibration-tenant'
    AND rig."status" = 'ACTIVE';
  IF matching_count <> 1 THEN
    RAISE EXCEPTION 'Exact trusted Mathematical V1 snapshot query returned % rows', matching_count;
  END IF;

  SELECT count(*) INTO matching_count
  FROM "CalibrationSnapshot"
  WHERE "id" = 'math-calibration-snapshot'
    AND "mathematicalBundleManifestSha256" = repeat('f', 64);
  IF matching_count <> 0 THEN
    RAISE EXCEPTION 'A mismatched complete bundle manifest hash was accepted';
  END IF;

  BEGIN
    UPDATE "CalibrationSnapshot"
    SET "mathematicalArtifactSha256" = repeat('d', 64)
    WHERE "id" = 'math-calibration-snapshot';
    RAISE EXCEPTION 'Expected mathematical physical identity mutation rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%physical identity and hashes are immutable%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    UPDATE "CalibrationSnapshot"
    SET "trustStatus" = 'DRAFT',
        "trustedAt" = NULL,
        "trustedByOperatorId" = NULL
    WHERE "id" = 'math-calibration-snapshot';
    RAISE EXCEPTION 'Expected reverse trust transition rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%trust transition is not allowed%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    DELETE FROM "CalibrationSnapshot"
    WHERE "id" = 'math-calibration-snapshot';
    RAISE EXCEPTION 'Expected mathematical snapshot delete rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%rows are retained%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

UPDATE "CalibrationSnapshot"
SET "validityEndsAt" = '2026-07-18T18:59:59.000Z'
WHERE "id" = 'math-calibration-snapshot';

DO $$
DECLARE
  matching_count integer;
BEGIN
  SELECT count(*) INTO matching_count
  FROM "CalibrationSnapshot" snapshot
  JOIN "CaptureRig" rig ON rig."id" = snapshot."rigId"
  WHERE snapshot."id" = 'math-calibration-snapshot'
    AND snapshot."trustStatus" = 'TRUSTED'
    AND snapshot."validityStartsAt" <= '2026-07-18T19:00:00.000Z'
    AND (
      snapshot."validityEndsAt" IS NULL
      OR snapshot."validityEndsAt" > '2026-07-18T19:00:00.000Z'
    )
    AND rig."tenantId" = 'math-calibration-tenant'
    AND rig."status" = 'ACTIVE';
  IF matching_count <> 0 THEN
    RAISE EXCEPTION 'Expired Mathematical V1 snapshot remained publish-ready';
  END IF;

  BEGIN
    UPDATE "CalibrationSnapshot"
    SET "validityEndsAt" = NULL
    WHERE "id" = 'math-calibration-snapshot';
    RAISE EXCEPTION 'Expected closed validity window mutation rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%closed validity window is immutable%' THEN
        RAISE;
      END IF;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_object
    WHERE constraint_object.conname = 'AiGraderReport_calibrationSnapshotId_fkey'
      AND constraint_object.contype = 'f'
      AND constraint_object.confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'AiGraderReport exact snapshot linkage is not delete-restricted';
  END IF;
END;
$$;

UPDATE "CalibrationSnapshot"
SET "trustStatus" = 'REVOKED',
    "revokedAt" = '2026-07-18T19:00:00.000Z',
    "revokedByOperatorId" = 'validation-operator',
    "revocationReason" = 'Disposable lifecycle proof complete'
WHERE "id" = 'math-calibration-snapshot';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "CalibrationSnapshot"
    WHERE "id" = 'math-calibration-snapshot'
      AND "trustStatus" = 'TRUSTED'
  ) THEN
    RAISE EXCEPTION 'Revoked Mathematical V1 snapshot remained trusted';
  END IF;
END;
$$;

ROLLBACK;

\echo AI_GRADER_MATHEMATICAL_CALIBRATION_SNAPSHOT_VALIDATION_PASS
