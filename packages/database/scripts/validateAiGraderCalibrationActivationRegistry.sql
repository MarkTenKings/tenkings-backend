\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  missing_columns text[];
BEGIN
  SELECT array_agg(expected.column_name ORDER BY expected.column_name)
  INTO missing_columns
  FROM (VALUES
    ('mathematicalOperatingContextV1'),
    ('mathematicalOperatingContextHash'),
    ('mathematicalRuntimeContextHash'),
    ('mathematicalRigCharacterizationSha256')
  ) AS expected(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns actual
    WHERE actual.table_schema = 'public'
      AND actual.table_name = 'CalibrationSnapshot'
      AND actual.column_name = expected.column_name
  );
  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Calibration activation snapshot context columns are absent: %', missing_columns;
  END IF;

  IF (
    SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'MathematicalCalibrationActivation',
        'MathematicalCalibrationActivationEvent',
        'MathematicalCalibrationActivePointer',
        'MathematicalCalibrationPendingPointer'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'Calibration activation registry tables are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'MathematicalCalibrationActivePointer'
      AND indexname = 'MathematicalCalibrationActivePointer_pkey'
      AND indexdef LIKE '%("rigId")%'
  ) THEN
    RAISE EXCEPTION 'Single ACTIVE calibration per rig guard is absent';
  END IF;

  IF (
    SELECT count(*) FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN (
        'MathematicalCalibrationActivation_reject_update',
        'MathematicalCalibrationActivation_reject_delete',
        'MathematicalCalibrationActivationEvent_reject_update',
        'MathematicalCalibrationActivationEvent_reject_delete',
        'MathematicalCalibrationActivePointer_validate',
        'MathematicalCalibrationPendingPointer_validate',
        'CalibrationSnapshot_guard_activation_context_update',
        'AiGraderSession_guard_calibration_activation_binding',
        'AiGraderReport_guard_calibration_activation_binding',
        'AiGraderReport_validate_calibration_activation_binding'
      )
  ) <> 10 THEN
    RAISE EXCEPTION 'Calibration activation immutability and pointer triggers are incomplete';
  END IF;

  IF (
    SELECT count(*) FROM pg_constraint
    WHERE conname IN (
      'AiGraderSession_calibrationActivationId_fkey',
      'AiGraderReport_calibrationActivationId_fkey'
    )
      AND contype = 'f'
      AND confdeltype = 'r'
  ) <> 2 THEN
    RAISE EXCEPTION 'Historical session/report activation bindings are not delete-restricted';
  END IF;
END;
$$;

INSERT INTO "Tenant" ("id", "name", "slug", "createdAt", "updatedAt")
VALUES (
  'activation-validation-tenant',
  'Activation Validation',
  'activation-validation',
  '2026-07-21T18:00:00.000Z',
  '2026-07-21T18:00:00.000Z'
);

INSERT INTO "RigLocation" ("id", "tenantId", "name", "createdAt", "updatedAt")
VALUES (
  'activation-validation-location',
  'activation-validation-tenant',
  'Disposable activation bench',
  '2026-07-21T18:00:00.000Z',
  '2026-07-21T18:00:00.000Z'
);

INSERT INTO "CaptureRig" (
  "id", "tenantId", "locationId", "label", "rigVersion", "status", "createdAt", "updatedAt"
) VALUES (
  'activation-validation-rig',
  'activation-validation-tenant',
  'activation-validation-location',
  'Disposable activation rig',
  'FIXED_RIG_V1',
  'ACTIVE',
  '2026-07-21T18:00:00.000Z',
  '2026-07-21T18:00:00.000Z'
);

INSERT INTO "CalibrationSnapshot" (
  "id", "rigId", "calibrationType", "componentSerials", "artifactKeys",
  "artifactChecksums", "operatorId", "mathematicalProfileId",
  "mathematicalCalibrationVersion", "mathematicalProfileFinalizedAt",
  "mathematicalArtifactId", "mathematicalArtifactSha256",
  "mathematicalThresholdSetId", "mathematicalThresholdSetHash",
  "mathematicalBundleSchemaVersion", "mathematicalBundleManifestSha256",
  "mathematicalSourceCaptureManifestSha256", "mathematicalMemberLedgerSha256",
  "mathematicalOperatingContextV1", "mathematicalOperatingContextHash",
  "mathematicalRuntimeContextHash", "mathematicalRigCharacterizationSha256",
  "trustStatus", "trustedAt", "trustedByOperatorId", "validityStartsAt", "createdAt"
) VALUES (
  'activation-validation-snapshot',
  'activation-validation-rig',
  'MATHEMATICAL_GRADING_V1',
  '{"camera":"validation-camera"}'::jsonb,
  '{"bundleStorageKey":"immutable/content/address"}'::jsonb,
  '{"bundle":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'::jsonb,
  'activation-importer',
  'activation-profile-v1',
  'activation-calibration-v1',
  '2026-07-21T18:00:00.000Z',
  'activation-artifact-v1',
  repeat('a', 64),
  'ten-kings-mathematical-v1',
  repeat('b', 64),
  'ten-kings-mathematical-calibration-bundle-v1',
  repeat('c', 64),
  repeat('d', 64),
  repeat('e', 64),
  '{"schemaVersion":"ten-kings-ai-grader-operating-context-v1"}'::jsonb,
  repeat('1', 64),
  repeat('2', 64),
  repeat('a', 64),
  'TRUSTED',
  '2026-07-21T18:10:00.000Z',
  'activation-truster',
  '2026-07-21T18:00:00.000Z',
  '2026-07-21T18:00:00.000Z'
);

INSERT INTO "MathematicalCalibrationActivation" (
  "id", "rigId", "calibrationSnapshotId", "activationHash",
  "operatingContextV1", "operatingContextHash", "runtimeContextHash",
  "rigCharacterizationSha256", "bundleManifestSha256", "memberLedgerSha256",
  "requestedByUserId", "requestKind", "requestReason",
  "requestIdempotencyKeyHash", "requestHash", "requestedAt", "pendingExpiresAt"
) VALUES (
  'activation-validation-v1',
  'activation-validation-rig',
  'activation-validation-snapshot',
  repeat('3', 64),
  '{"schemaVersion":"ten-kings-ai-grader-operating-context-v1"}'::jsonb,
  repeat('1', 64),
  repeat('2', 64),
  repeat('a', 64),
  repeat('c', 64),
  repeat('e', 64),
  'activation-admin',
  'activate',
  'explicit disposable activation',
  repeat('4', 64),
  repeat('5', 64),
  '2026-07-21T18:15:00.000Z',
  '2026-07-21T18:25:00.000Z'
);

INSERT INTO "MathematicalCalibrationActivationEvent" (
  "id", "activationId", "sequence", "eventType", "eventHash",
  "previousEventHash", "occurredAt"
) VALUES (
  'activation-validation-v1-pending',
  'activation-validation-v1',
  1,
  'PENDING_CREATED',
  repeat('6', 64),
  NULL,
  '2026-07-21T18:15:00.000Z'
);

INSERT INTO "MathematicalCalibrationPendingPointer" (
  "rigId", "activationId", "activationHash", "activationRevision",
  "pendingExpiresAt", "createdAt"
) VALUES (
  'activation-validation-rig',
  'activation-validation-v1',
  repeat('3', 64),
  repeat('6', 64),
  '2026-07-21T18:25:00.000Z',
  '2026-07-21T18:15:00.000Z'
);

INSERT INTO "MathematicalCalibrationActivationEvent" (
  "id", "activationId", "sequence", "eventType", "eventHash",
  "previousEventHash", "workstationReceipt", "workstationReceiptSha256", "occurredAt"
) VALUES
(
  'activation-validation-v1-local',
  'activation-validation-v1',
  2,
  'LOCAL_VERIFIED',
  repeat('7', 64),
  repeat('6', 64),
  '{}'::jsonb,
  repeat('a', 64),
  '2026-07-21T18:16:00.000Z'
),
(
  'activation-validation-v1-active',
  'activation-validation-v1',
  3,
  'ACTIVATED',
  repeat('8', 64),
  repeat('7', 64),
  '{}'::jsonb,
  repeat('a', 64),
  '2026-07-21T18:17:00.000Z'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO "MathematicalCalibrationActivePointer" (
      "rigId", "activationId", "activationHash", "activationRevision",
      "operatingContextHash", "workstationReceiptSha256", "activatedAt", "createdAt"
    ) VALUES (
      'activation-validation-rig',
      'activation-validation-v1',
      repeat('3', 64),
      repeat('8', 64),
      repeat('1', 64),
      repeat('a', 64),
      '2026-07-21T18:17:00.000Z',
      '2026-07-21T18:17:00.000Z'
    );
    RAISE EXCEPTION 'Expected simultaneous pending/active authority rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%simultaneous active and pending%' THEN RAISE; END IF;
  END;
END;
$$;

DELETE FROM "MathematicalCalibrationPendingPointer"
WHERE "rigId" = 'activation-validation-rig';

INSERT INTO "MathematicalCalibrationActivePointer" (
  "rigId", "activationId", "activationHash", "activationRevision",
  "operatingContextHash", "workstationReceiptSha256", "activatedAt", "createdAt"
) VALUES (
  'activation-validation-rig',
  'activation-validation-v1',
  repeat('3', 64),
  repeat('8', 64),
  repeat('1', 64),
  repeat('a', 64),
  '2026-07-21T18:17:00.000Z',
  '2026-07-21T18:17:00.000Z'
);

INSERT INTO "AiGraderSession" (
  "id", "tenantId", "gradingSessionId", "calibrationActivationId", "createdAt", "updatedAt"
) VALUES (
  'activation-validation-session',
  'activation-validation-tenant',
  'activation-validation-grading-session',
  'activation-validation-v1',
  '2026-07-21T18:18:00.000Z',
  '2026-07-21T18:18:00.000Z'
);

INSERT INTO "AiGraderReport" (
  "id", "tenantId", "sessionId", "reportId", "calibrationSnapshotId",
  "calibrationActivationId", "createdAt", "updatedAt"
) VALUES (
  'activation-validation-report',
  'activation-validation-tenant',
  'activation-validation-session',
  'activation-validation-report-id',
  'activation-validation-snapshot',
  'activation-validation-v1',
  '2026-07-21T18:18:00.000Z',
  '2026-07-21T18:18:00.000Z'
);

DO $$
BEGIN
  BEGIN
    UPDATE "MathematicalCalibrationActivation"
    SET "requestReason" = 'mutated'
    WHERE "id" = 'activation-validation-v1';
    RAISE EXCEPTION 'Expected activation update rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM "MathematicalCalibrationActivation"
    WHERE "id" = 'activation-validation-v1';
    RAISE EXCEPTION 'Expected activation delete rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM "MathematicalCalibrationActivationEvent"
    WHERE "id" = 'activation-validation-v1-pending';
    RAISE EXCEPTION 'Expected activation event delete rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE "MathematicalCalibrationActivationEvent"
    SET "eventHash" = repeat('9', 64)
    WHERE "id" = 'activation-validation-v1-pending';
    RAISE EXCEPTION 'Expected activation event update rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE "CalibrationSnapshot"
    SET "mathematicalOperatingContextHash" = repeat('9', 64)
    WHERE "id" = 'activation-validation-snapshot';
    RAISE EXCEPTION 'Expected immutable operating context rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%operating context and hashes are immutable%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE "AiGraderSession"
    SET "calibrationActivationId" = NULL
    WHERE "id" = 'activation-validation-session';
    RAISE EXCEPTION 'Expected session activation binding update rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%activation binding is immutable%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE "AiGraderReport"
    SET "calibrationActivationId" = NULL
    WHERE "id" = 'activation-validation-report';
    RAISE EXCEPTION 'Expected report activation binding update rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%activation binding is immutable%' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "MathematicalCalibrationPendingPointer" (
      "rigId", "activationId", "activationHash", "activationRevision",
      "pendingExpiresAt", "createdAt"
    ) VALUES (
      'activation-validation-rig',
      'activation-validation-v1',
      repeat('3', 64),
      repeat('6', 64),
      '2026-07-21T18:25:00.000Z',
      '2026-07-21T18:15:00.000Z'
    );
    RAISE EXCEPTION 'Expected pending pointer while active rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%simultaneous active and pending%' THEN RAISE; END IF;
  END;
END;
$$;

DELETE FROM "MathematicalCalibrationActivePointer"
WHERE "rigId" = 'activation-validation-rig';

INSERT INTO "MathematicalCalibrationActivation" (
  "id", "rigId", "calibrationSnapshotId", "activationHash",
  "operatingContextV1", "operatingContextHash", "runtimeContextHash",
  "rigCharacterizationSha256", "bundleManifestSha256", "memberLedgerSha256",
  "requestedByUserId", "requestKind", "requestReason",
  "requestIdempotencyKeyHash", "requestHash", "requestedAt", "pendingExpiresAt",
  "priorActivationId"
) VALUES (
  'activation-validation-v2',
  'activation-validation-rig',
  'activation-validation-snapshot',
  repeat('b', 64),
  '{"schemaVersion":"ten-kings-ai-grader-operating-context-v1"}'::jsonb,
  repeat('1', 64),
  repeat('2', 64),
  repeat('a', 64),
  repeat('c', 64),
  repeat('e', 64),
  'activation-admin',
  'reactivate',
  'explicit historical reactivation',
  repeat('d', 64),
  repeat('e', 64),
  '2026-07-21T18:20:00.000Z',
  '2026-07-21T18:30:00.000Z',
  'activation-validation-v1'
);

INSERT INTO "MathematicalCalibrationActivationEvent" (
  "id", "activationId", "sequence", "eventType", "eventHash",
  "previousEventHash", "occurredAt"
) VALUES (
  'activation-validation-v2-pending',
  'activation-validation-v2',
  1,
  'PENDING_CREATED',
  repeat('f', 64),
  NULL,
  '2026-07-21T18:20:00.000Z'
);

INSERT INTO "MathematicalCalibrationPendingPointer" (
  "rigId", "activationId", "activationHash", "activationRevision",
  "pendingExpiresAt", "createdAt"
) VALUES (
  'activation-validation-rig',
  'activation-validation-v2',
  repeat('b', 64),
  repeat('f', 64),
  '2026-07-21T18:30:00.000Z',
  '2026-07-21T18:20:00.000Z'
);

DO $$
BEGIN
  IF (
    SELECT count(*) FROM "MathematicalCalibrationActivation"
    WHERE "calibrationSnapshotId" = 'activation-validation-snapshot'
  ) <> 2 THEN
    RAISE EXCEPTION 'Historical reactivation did not preserve both immutable activation roots';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "MathematicalCalibrationActivation"
    WHERE "id" = 'activation-validation-v2'
      AND "priorActivationId" = 'activation-validation-v1'
      AND "requestKind" = 'reactivate'
  ) THEN
    RAISE EXCEPTION 'Historical reactivation linkage is absent';
  END IF;
END;
$$;

INSERT INTO "MathematicalCalibrationActivationEvent" (
  "id", "activationId", "sequence", "eventType", "eventHash",
  "previousEventHash", "safeDetails", "occurredAt"
) VALUES (
  'activation-validation-v2-failed',
  'activation-validation-v2',
  2,
  'FAILED',
  repeat('9', 64),
  repeat('f', 64),
  '{"failureCode":"LIVE_OPERATING_CONTEXT_MISMATCH"}'::jsonb,
  '2026-07-21T18:21:00.000Z'
);

DELETE FROM "MathematicalCalibrationPendingPointer"
WHERE "rigId" = 'activation-validation-rig';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "MathematicalCalibrationActivePointer"
    WHERE "rigId" = 'activation-validation-rig'
  ) THEN
    RAISE EXCEPTION 'Failed activation restored a prior active pointer';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "AiGraderSession"
    WHERE "id" = 'activation-validation-session'
      AND "calibrationActivationId" = 'activation-validation-v1'
  ) THEN
    RAISE EXCEPTION 'Historical session lost its original activation binding';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "AiGraderReport"
    WHERE "id" = 'activation-validation-report'
      AND "calibrationSnapshotId" = 'activation-validation-snapshot'
      AND "calibrationActivationId" = 'activation-validation-v1'
  ) THEN
    RAISE EXCEPTION 'Historical report lost its original snapshot/activation binding';
  END IF;
END;
$$;

ROLLBACK;

\echo AI_GRADER_CALIBRATION_ACTIVATION_REGISTRY_VALIDATION_PASS
