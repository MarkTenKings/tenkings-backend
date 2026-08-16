\set ON_ERROR_STOP on

-- Fixtures remain inside one rolled-back transaction. This file is executed
-- only by the repository's loopback/tmpfs disposable PostgreSQL harness.
BEGIN;

DO $catalog$
DECLARE
  missing integer;
BEGIN
  IF to_regclass('public."AiGraderV2ColorGeometryEvidence"') IS NULL THEN
    RAISE EXCEPTION 'Color Geometry evidence table is missing';
  END IF;
  SELECT count(*) INTO missing
    FROM (VALUES
      ('AiGraderV2ColorGeometryEvidence_pkey'),
      ('AiGraderV2ColorGeometryEvidence_side_check'),
      ('AiGraderV2ColorGeometryEvidence_mode_check'),
      ('AiGraderV2ColorGeometryEvidence_matColor_check'),
      ('AiGraderV2ColorGeometryEvidence_outcome_check'),
      ('AiGraderV2ColorGeometryEvidence_engineVersion_check'),
      ('AiGraderV2ColorGeometryEvidence_policyProvenance_check'),
      ('AiGraderV2ColorGeometryEvidence_sourceImageSha256_check'),
      ('AiGraderV2ColorGeometryEvidence_proposal_consistency_check'),
      ('AiGraderV2ColorGeometryEvidence_sessionId_fkey')
    ) expected(name)
    LEFT JOIN pg_constraint actual
      ON actual.conname = expected.name
     AND actual.conrelid = 'public."AiGraderV2ColorGeometryEvidence"'::regclass
   WHERE actual.oid IS NULL OR NOT actual.convalidated;
  IF missing <> 0 THEN RAISE EXCEPTION 'Color Geometry constraints missing: %', missing; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger trigger_object
    JOIN pg_proc trigger_function ON trigger_function.oid = trigger_object.tgfoid
    WHERE trigger_object.tgname = 'AiGraderV2ColorGeometryEvidence_append_only'
      AND trigger_object.tgrelid = 'public."AiGraderV2ColorGeometryEvidence"'::regclass
      AND NOT trigger_object.tgisinternal
      AND trigger_object.tgenabled = 'O'
      AND trigger_object.tgtype = 27::smallint
      AND trigger_function.proname = 'reject_ai_grader_v2_color_geometry_evidence_mutation'
  ) THEN RAISE EXCEPTION 'Color Geometry append-only trigger is missing'; END IF;

  IF (SELECT count(*) FROM "_prisma_migrations"
      WHERE "migration_name" = '20260816100000_speedster_color_geometry_evidence'
        AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
        AND "logs" IS NULL AND "applied_steps_count" > 0) <> 1 THEN
    RAISE EXCEPTION 'Color Geometry migration ledger entry is not one clean success';
  END IF;
END
$catalog$;

INSERT INTO "AiGraderV2Session" (
  "id", "createdByUserId", "cardProfile", "workflowState", "ruleVersion",
  "identity", "capture", "reviewedDefects", "gradeReport", "updatedAt"
) VALUES (
  'speedster-color-geometry-validation-session', 'validation-admin', 'POKEMON',
  'CAPTURED', 'speedster-v2', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb,
  clock_timestamp()
);

INSERT INTO "AiGraderV2ColorGeometryEvidence" (
  "id", "sessionId", "createdByUserId", "side", "mode", "matColor", "outcome",
  "engineVersion", "policyProvenance", "sourceImageStorageKey", "sourceImageSha256",
  "proposal", "confirmedQuad", "diagnostics", "proposalChanged"
) VALUES
  ('color-front-physical', 'speedster-color-geometry-validation-session', 'validation-admin',
   'FRONT', 'PHYSICAL_OUTER', 'BLACK', 'ACCEPTED', 'speedster-color-geometry-v1',
   'OWNER_APPROVED_OFFLINE_ESTIMATE_V1_NOT_LIVE_CALIBRATED', 'front-original.jpg', repeat('a', 64),
   '[[0,0],[1,0],[1,1],[0,1]]'::jsonb, '[[0,0],[1,0],[1,1],[0,1]]'::jsonb, '{}'::jsonb, false),
  ('color-front-printed', 'speedster-color-geometry-validation-session', 'validation-admin',
   'FRONT', 'PRINTED_FRAME', 'WHITE', 'INSUFFICIENT_EVIDENCE', 'speedster-color-geometry-v1',
   'OWNER_APPROVED_OFFLINE_ESTIMATE_V1_NOT_LIVE_CALIBRATED', 'front-original.jpg', repeat('a', 64),
   NULL, '[[0,0],[1,0],[1,1],[0,1]]'::jsonb, '{}'::jsonb, NULL),
  ('color-back-physical', 'speedster-color-geometry-validation-session', 'validation-admin',
   'BACK', 'PHYSICAL_OUTER', 'MAGENTA', 'NOT_APPLICABLE', 'speedster-color-geometry-v1',
   'OWNER_APPROVED_OFFLINE_ESTIMATE_V1_NOT_LIVE_CALIBRATED', 'back-original.jpg', repeat('b', 64),
   NULL, '[[0,0],[1,0],[1,1],[0,1]]'::jsonb, '{}'::jsonb, NULL),
  ('color-back-printed', 'speedster-color-geometry-validation-session', 'validation-admin',
   'BACK', 'PRINTED_FRAME', 'BLACK', 'ABSTAIN', 'speedster-color-geometry-v1',
   'OWNER_APPROVED_OFFLINE_ESTIMATE_V1_NOT_LIVE_CALIBRATED', 'back-original.jpg', repeat('b', 64),
   NULL, '[[0,0],[1,0],[1,1],[0,1]]'::jsonb, '{}'::jsonb, NULL);

DO $behavior$
DECLARE rejected boolean;
BEGIN
  IF (SELECT count(*) FROM "AiGraderV2ColorGeometryEvidence"
      WHERE "sessionId" = 'speedster-color-geometry-validation-session') <> 4 THEN
    RAISE EXCEPTION 'All four Color Geometry outcomes were not retained';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "AiGraderV2ColorGeometryEvidence" (
      "id", "sessionId", "createdByUserId", "side", "mode", "matColor", "outcome",
      "engineVersion", "policyProvenance", "sourceImageStorageKey", "sourceImageSha256",
      "proposal", "confirmedQuad", "diagnostics", "proposalChanged"
    ) SELECT 'color-duplicate', "sessionId", "createdByUserId", "side", "mode", "matColor",
      "outcome", "engineVersion", "policyProvenance", "sourceImageStorageKey", "sourceImageSha256",
      "proposal", "confirmedQuad", "diagnostics", "proposalChanged"
      FROM "AiGraderV2ColorGeometryEvidence" WHERE "id" = 'color-front-physical';
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Duplicate side/mode was accepted'; END IF;

  rejected := false;
  BEGIN
    UPDATE "AiGraderV2ColorGeometryEvidence" SET "createdByUserId" = 'mutated'
      WHERE "id" = 'color-front-physical';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'AiGraderV2ColorGeometryEvidence rows are immutable' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Color Geometry UPDATE was accepted'; END IF;

  rejected := false;
  BEGIN
    DELETE FROM "AiGraderV2ColorGeometryEvidence" WHERE "id" = 'color-front-physical';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'AiGraderV2ColorGeometryEvidence rows are immutable' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Color Geometry DELETE was accepted'; END IF;

  rejected := false;
  BEGIN
    DELETE FROM "AiGraderV2Session" WHERE "id" = 'speedster-color-geometry-validation-session';
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Evidence parent session delete was accepted'; END IF;
END
$behavior$;

ROLLBACK;

DO $cleanup$
BEGIN
  IF EXISTS (SELECT 1 FROM "AiGraderV2ColorGeometryEvidence" WHERE "id" LIKE 'color-%')
     OR EXISTS (SELECT 1 FROM "AiGraderV2Session"
                WHERE "id" = 'speedster-color-geometry-validation-session') THEN
    RAISE EXCEPTION 'Color Geometry validation fixtures survived rollback';
  END IF;
END
$cleanup$;

\echo SPEEDSTER_COLOR_GEOMETRY_EVIDENCE_VALIDATION_PASS
