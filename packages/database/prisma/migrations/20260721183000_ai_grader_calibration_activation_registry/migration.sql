-- Mathematical Calibration Activation V1 is additive and deliberately does
-- not alter or remove any preserved CalibrationSnapshot artifact identity.
ALTER TABLE "CalibrationSnapshot"
  ADD COLUMN "mathematicalOperatingContextV1" JSONB,
  ADD COLUMN "mathematicalOperatingContextHash" TEXT,
  ADD COLUMN "mathematicalRuntimeContextHash" TEXT,
  ADD COLUMN "mathematicalRigCharacterizationSha256" TEXT;

ALTER TABLE "CalibrationSnapshot"
  ADD CONSTRAINT "CalibrationSnapshot_activation_context_check" CHECK (
    (
      "calibrationType"::text <> 'MATHEMATICAL_GRADING_V1'
      AND "mathematicalOperatingContextV1" IS NULL
      AND "mathematicalOperatingContextHash" IS NULL
      AND "mathematicalRuntimeContextHash" IS NULL
      AND "mathematicalRigCharacterizationSha256" IS NULL
    )
    OR (
      "calibrationType"::text = 'MATHEMATICAL_GRADING_V1'
      AND jsonb_typeof("mathematicalOperatingContextV1") = 'object'
      AND "mathematicalOperatingContextV1"->>'schemaVersion' = 'ten-kings-ai-grader-operating-context-v1'
      AND "mathematicalOperatingContextHash" ~ '^[0-9a-f]{64}$'
      AND "mathematicalRuntimeContextHash" ~ '^[0-9a-f]{64}$'
      AND "mathematicalRigCharacterizationSha256" ~ '^[0-9a-f]{64}$'
    )
  ) NOT VALID;

CREATE FUNCTION guard_mathematical_calibration_snapshot_activation_context_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."calibrationType"::text = 'MATHEMATICAL_GRADING_V1'
    AND ROW(
      NEW."mathematicalOperatingContextV1",
      NEW."mathematicalOperatingContextHash",
      NEW."mathematicalRuntimeContextHash",
      NEW."mathematicalRigCharacterizationSha256"
    ) IS DISTINCT FROM ROW(
      OLD."mathematicalOperatingContextV1",
      OLD."mathematicalOperatingContextHash",
      OLD."mathematicalRuntimeContextHash",
      OLD."mathematicalRigCharacterizationSha256"
    ) THEN
    RAISE EXCEPTION 'Mathematical CalibrationSnapshot operating context and hashes are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CalibrationSnapshot_guard_activation_context_update"
  BEFORE UPDATE ON "CalibrationSnapshot"
  FOR EACH ROW
  EXECUTE FUNCTION guard_mathematical_calibration_snapshot_activation_context_update();

CREATE TYPE "MathematicalCalibrationActivationEventType" AS ENUM (
  'PENDING_CREATED',
  'LOCAL_VERIFIED',
  'ACTIVATED',
  'FAILED',
  'EXPIRED',
  'SUPERSEDED',
  'REVOKED'
);

CREATE TABLE "MathematicalCalibrationActivation" (
  "id" TEXT NOT NULL,
  "rigId" TEXT NOT NULL,
  "calibrationSnapshotId" TEXT NOT NULL,
  "activationHash" TEXT NOT NULL,
  "operatingContextV1" JSONB NOT NULL,
  "operatingContextHash" TEXT NOT NULL,
  "runtimeContextHash" TEXT NOT NULL,
  "rigCharacterizationSha256" TEXT NOT NULL,
  "bundleManifestSha256" TEXT NOT NULL,
  "memberLedgerSha256" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "requestKind" TEXT NOT NULL,
  "requestReason" TEXT NOT NULL,
  "requestIdempotencyKeyHash" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL,
  "pendingExpiresAt" TIMESTAMP(3) NOT NULL,
  "priorActivationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MathematicalCalibrationActivation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MathematicalCalibrationActivation_values_check" CHECK (
    length(btrim("rigId")) BETWEEN 1 AND 256
    AND "rigId" = btrim("rigId")
    AND length(btrim("calibrationSnapshotId")) BETWEEN 1 AND 256
    AND "calibrationSnapshotId" = btrim("calibrationSnapshotId")
    AND "activationHash" ~ '^[0-9a-f]{64}$'
    AND "operatingContextHash" ~ '^[0-9a-f]{64}$'
    AND "runtimeContextHash" ~ '^[0-9a-f]{64}$'
    AND "rigCharacterizationSha256" ~ '^[0-9a-f]{64}$'
    AND "bundleManifestSha256" ~ '^[0-9a-f]{64}$'
    AND "memberLedgerSha256" ~ '^[0-9a-f]{64}$'
    AND "requestIdempotencyKeyHash" ~ '^[0-9a-f]{64}$'
    AND "requestHash" ~ '^[0-9a-f]{64}$'
    AND "requestKind" IN ('activate', 'reactivate')
    AND length(btrim("requestedByUserId")) BETWEEN 1 AND 256
    AND "requestedByUserId" = btrim("requestedByUserId")
    AND length(btrim("requestReason")) BETWEEN 1 AND 1024
    AND "requestReason" = btrim("requestReason")
    AND "pendingExpiresAt" > "requestedAt"
    AND jsonb_typeof("operatingContextV1") = 'object'
    AND "operatingContextV1"->>'schemaVersion' = 'ten-kings-ai-grader-operating-context-v1'
    AND (("requestKind" = 'activate' AND "priorActivationId" IS NULL)
      OR ("requestKind" = 'reactivate' AND "priorActivationId" IS NOT NULL))
  ),
  CONSTRAINT "MathematicalCalibrationActivation_rig_fkey"
    FOREIGN KEY ("rigId") REFERENCES "CaptureRig"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MathematicalCalibrationActivation_snapshot_fkey"
    FOREIGN KEY ("calibrationSnapshotId") REFERENCES "CalibrationSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MathematicalCalibrationActivation_prior_fkey"
    FOREIGN KEY ("priorActivationId") REFERENCES "MathematicalCalibrationActivation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MathematicalCalibrationActivation_activationHash_key"
  ON "MathematicalCalibrationActivation"("activationHash");
CREATE UNIQUE INDEX "MathematicalCalibrationActivation_rig_idempotency_key"
  ON "MathematicalCalibrationActivation"("rigId", "requestIdempotencyKeyHash");
CREATE INDEX "MathematicalCalibrationActivation_rig_requested_idx"
  ON "MathematicalCalibrationActivation"("rigId", "requestedAt");
CREATE INDEX "MathematicalCalibrationActivation_snapshot_idx"
  ON "MathematicalCalibrationActivation"("calibrationSnapshotId");

CREATE TABLE "MathematicalCalibrationActivationEvent" (
  "id" TEXT NOT NULL,
  "activationId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "eventType" "MathematicalCalibrationActivationEventType" NOT NULL,
  "eventHash" TEXT NOT NULL,
  "previousEventHash" TEXT,
  "workstationReceipt" JSONB,
  "workstationReceiptSha256" TEXT,
  "actorUserId" TEXT,
  "safeDetails" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MathematicalCalibrationActivationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MathematicalCalibrationActivationEvent_values_check" CHECK (
    "sequence" >= 1
    AND "eventHash" ~ '^[0-9a-f]{64}$'
    AND ("previousEventHash" IS NULL OR "previousEventHash" ~ '^[0-9a-f]{64}$')
    AND ("workstationReceiptSha256" IS NULL OR "workstationReceiptSha256" ~ '^[0-9a-f]{64}$')
    AND (("workstationReceipt" IS NULL AND "workstationReceiptSha256" IS NULL)
      OR (jsonb_typeof("workstationReceipt") = 'object' AND "workstationReceiptSha256" IS NOT NULL))
    AND ("actorUserId" IS NULL OR (length(btrim("actorUserId")) BETWEEN 1 AND 256 AND "actorUserId" = btrim("actorUserId")))
  ),
  CONSTRAINT "MathematicalCalibrationActivationEvent_activation_fkey"
    FOREIGN KEY ("activationId") REFERENCES "MathematicalCalibrationActivation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MathematicalCalibrationActivationEvent_eventHash_key"
  ON "MathematicalCalibrationActivationEvent"("eventHash");
CREATE UNIQUE INDEX "MathematicalCalibrationActivationEvent_sequence_key"
  ON "MathematicalCalibrationActivationEvent"("activationId", "sequence");
CREATE INDEX "MathematicalCalibrationActivationEvent_activation_idx"
  ON "MathematicalCalibrationActivationEvent"("activationId", "occurredAt");

CREATE TABLE "MathematicalCalibrationActivePointer" (
  "rigId" TEXT NOT NULL,
  "activationId" TEXT NOT NULL,
  "activationHash" TEXT NOT NULL,
  "activationRevision" TEXT NOT NULL,
  "operatingContextHash" TEXT NOT NULL,
  "workstationReceiptSha256" TEXT NOT NULL,
  "activatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MathematicalCalibrationActivePointer_pkey" PRIMARY KEY ("rigId"),
  CONSTRAINT "MathematicalCalibrationActivePointer_values_check" CHECK (
    "activationHash" ~ '^[0-9a-f]{64}$'
    AND "activationRevision" ~ '^[0-9a-f]{64}$'
    AND "operatingContextHash" ~ '^[0-9a-f]{64}$'
    AND "workstationReceiptSha256" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "MathematicalCalibrationActivePointer_rig_fkey"
    FOREIGN KEY ("rigId") REFERENCES "CaptureRig"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MathematicalCalibrationActivePointer_activation_fkey"
    FOREIGN KEY ("activationId") REFERENCES "MathematicalCalibrationActivation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MathematicalCalibrationActivePointer_activationId_key"
  ON "MathematicalCalibrationActivePointer"("activationId");

CREATE TABLE "MathematicalCalibrationPendingPointer" (
  "rigId" TEXT NOT NULL,
  "activationId" TEXT NOT NULL,
  "activationHash" TEXT NOT NULL,
  "activationRevision" TEXT NOT NULL,
  "pendingExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MathematicalCalibrationPendingPointer_pkey" PRIMARY KEY ("rigId"),
  CONSTRAINT "MathematicalCalibrationPendingPointer_values_check" CHECK (
    "activationHash" ~ '^[0-9a-f]{64}$'
    AND "activationRevision" ~ '^[0-9a-f]{64}$'
    AND "pendingExpiresAt" > "createdAt"
  ),
  CONSTRAINT "MathematicalCalibrationPendingPointer_rig_fkey"
    FOREIGN KEY ("rigId") REFERENCES "CaptureRig"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MathematicalCalibrationPendingPointer_activation_fkey"
    FOREIGN KEY ("activationId") REFERENCES "MathematicalCalibrationActivation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MathematicalCalibrationPendingPointer_activationId_key"
  ON "MathematicalCalibrationPendingPointer"("activationId");

CREATE FUNCTION reject_mathematical_calibration_activation_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Mathematical calibration activation and event rows are append-only';
END;
$$;

CREATE TRIGGER "MathematicalCalibrationActivation_reject_update"
  BEFORE UPDATE ON "MathematicalCalibrationActivation"
  FOR EACH ROW EXECUTE FUNCTION reject_mathematical_calibration_activation_mutation();
CREATE TRIGGER "MathematicalCalibrationActivation_reject_delete"
  BEFORE DELETE ON "MathematicalCalibrationActivation"
  FOR EACH ROW EXECUTE FUNCTION reject_mathematical_calibration_activation_mutation();
CREATE TRIGGER "MathematicalCalibrationActivationEvent_reject_update"
  BEFORE UPDATE ON "MathematicalCalibrationActivationEvent"
  FOR EACH ROW EXECUTE FUNCTION reject_mathematical_calibration_activation_mutation();
CREATE TRIGGER "MathematicalCalibrationActivationEvent_reject_delete"
  BEFORE DELETE ON "MathematicalCalibrationActivationEvent"
  FOR EACH ROW EXECUTE FUNCTION reject_mathematical_calibration_activation_mutation();

CREATE FUNCTION validate_mathematical_calibration_active_pointer()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "MathematicalCalibrationPendingPointer" p WHERE p."rigId" = NEW."rigId"
  ) THEN
    RAISE EXCEPTION 'A rig cannot have simultaneous active and pending calibration authority';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "MathematicalCalibrationActivation" a
    JOIN "CalibrationSnapshot" s ON s."id" = a."calibrationSnapshotId"
    JOIN "MathematicalCalibrationActivationEvent" e
      ON e."activationId" = a."id" AND e."eventHash" = NEW."activationRevision"
    WHERE a."id" = NEW."activationId"
      AND a."rigId" = NEW."rigId"
      AND a."activationHash" = NEW."activationHash"
      AND a."operatingContextHash" = NEW."operatingContextHash"
      AND e."eventType" = 'ACTIVATED'
      AND e."workstationReceiptSha256" = NEW."workstationReceiptSha256"
      AND s."trustStatus" = 'TRUSTED'
      AND s."revokedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Active calibration pointer does not match one exact activated trusted snapshot and receipt';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "MathematicalCalibrationActivePointer_validate"
  BEFORE INSERT OR UPDATE ON "MathematicalCalibrationActivePointer"
  FOR EACH ROW EXECUTE FUNCTION validate_mathematical_calibration_active_pointer();

CREATE FUNCTION validate_mathematical_calibration_pending_pointer()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "MathematicalCalibrationActivePointer" p WHERE p."rigId" = NEW."rigId"
  ) THEN
    RAISE EXCEPTION 'A rig cannot have simultaneous active and pending calibration authority';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "MathematicalCalibrationActivation" a
    JOIN "CalibrationSnapshot" s ON s."id" = a."calibrationSnapshotId"
    JOIN "MathematicalCalibrationActivationEvent" e
      ON e."activationId" = a."id" AND e."eventHash" = NEW."activationRevision"
    WHERE a."id" = NEW."activationId"
      AND a."rigId" = NEW."rigId"
      AND a."activationHash" = NEW."activationHash"
      AND a."pendingExpiresAt" = NEW."pendingExpiresAt"
      AND e."eventType" = 'PENDING_CREATED'
      AND s."trustStatus" = 'TRUSTED'
      AND s."revokedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Pending calibration pointer does not match one exact trusted activation request';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "MathematicalCalibrationPendingPointer_validate"
  BEFORE INSERT OR UPDATE ON "MathematicalCalibrationPendingPointer"
  FOR EACH ROW EXECUTE FUNCTION validate_mathematical_calibration_pending_pointer();

ALTER TABLE "AiGraderSession"
  ADD COLUMN "calibrationActivationId" TEXT;
ALTER TABLE "AiGraderSession"
  ADD CONSTRAINT "AiGraderSession_calibrationActivationId_fkey"
  FOREIGN KEY ("calibrationActivationId") REFERENCES "MathematicalCalibrationActivation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AiGraderSession_calibrationActivationId_idx"
  ON "AiGraderSession"("calibrationActivationId");

ALTER TABLE "AiGraderReport"
  ADD COLUMN "calibrationActivationId" TEXT;
ALTER TABLE "AiGraderReport"
  ADD CONSTRAINT "AiGraderReport_calibrationActivationId_fkey"
  FOREIGN KEY ("calibrationActivationId") REFERENCES "MathematicalCalibrationActivation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AiGraderReport_calibrationActivationId_idx"
  ON "AiGraderReport"("calibrationActivationId");

CREATE FUNCTION guard_ai_grader_historical_calibration_activation_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."calibrationActivationId" IS NOT NULL
    AND NEW."calibrationActivationId" IS DISTINCT FROM OLD."calibrationActivationId" THEN
    RAISE EXCEPTION 'Historical calibration activation binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AiGraderSession_guard_calibration_activation_binding"
  BEFORE UPDATE ON "AiGraderSession"
  FOR EACH ROW EXECUTE FUNCTION guard_ai_grader_historical_calibration_activation_binding();
CREATE TRIGGER "AiGraderReport_guard_calibration_activation_binding"
  BEFORE UPDATE ON "AiGraderReport"
  FOR EACH ROW EXECUTE FUNCTION guard_ai_grader_historical_calibration_activation_binding();

CREATE FUNCTION validate_ai_grader_report_calibration_activation_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."calibrationActivationId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "MathematicalCalibrationActivation" a
      WHERE a."id" = NEW."calibrationActivationId"
        AND a."calibrationSnapshotId" = NEW."calibrationSnapshotId"
    ) THEN
    RAISE EXCEPTION 'Report calibration activation does not match its immutable snapshot';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AiGraderReport_validate_calibration_activation_binding"
  BEFORE INSERT OR UPDATE OF "calibrationActivationId", "calibrationSnapshotId" ON "AiGraderReport"
  FOR EACH ROW EXECUTE FUNCTION validate_ai_grader_report_calibration_activation_binding();
