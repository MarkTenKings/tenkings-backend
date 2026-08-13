\set ON_ERROR_STOP on

-- All fixtures are rolled back. This validator is only executed by the
-- loopback/tmpfs disposable PostgreSQL harness after the full migration chain.
BEGIN;

DO $speedster_registration_lesson_catalog$
DECLARE
  missing_count integer;
BEGIN
  IF to_regclass('public."AiGraderV2MapRegistrationLesson"') IS NULL THEN
    RAISE EXCEPTION 'Registration lesson table is missing';
  END IF;

  SELECT count(*) INTO missing_count
    FROM (VALUES
      ('AiGraderV2MapRegistrationLesson_pkey'),
      ('AiGraderV2MapRegistrationLesson_side_check'),
      ('AiGraderV2MapRegistrationLesson_currentInspectionSha256_check'),
      ('AiGraderV2MapRegistrationLesson_currentPhysicalQuadSha256_check'),
      ('AiGraderV2MapRegistrationLesson_lessonHash_check'),
      ('AiGraderV2MapRegistrationLesson_rescueAttemptId_check'),
      ('AiGraderV2MapRegistrationLesson_algorithmVersion_check'),
      ('AiGraderV2MapRegistrationLesson_policyVersion_check'),
      ('AiGraderV2MapRegistrationLesson_mapRevisionId_fkey'),
      ('AiGraderV2MapRegistrationLesson_evidenceSessionId_fkey')
    ) expected(constraint_name)
    LEFT JOIN pg_constraint actual
      ON actual.conname = expected.constraint_name
     AND actual.conrelid = 'public."AiGraderV2MapRegistrationLesson"'::regclass
   WHERE actual.oid IS NULL OR NOT actual.convalidated;
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'Registration lesson constraints are incomplete: % invalid', missing_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger trigger_object
      JOIN pg_proc trigger_function ON trigger_function.oid = trigger_object.tgfoid
     WHERE trigger_object.tgname = 'AiGraderV2MapRegistrationLesson_append_only'
       AND trigger_object.tgrelid = 'public."AiGraderV2MapRegistrationLesson"'::regclass
       AND NOT trigger_object.tgisinternal
       AND trigger_object.tgenabled = 'O'
       AND trigger_object.tgtype = 27::smallint
       AND trigger_function.proname = 'reject_ai_grader_v2_map_registration_lesson_mutation'
  ) THEN
    RAISE EXCEPTION 'Registration lesson append-only trigger is missing or incoherent';
  END IF;

  IF (
    SELECT count(*)
      FROM "_prisma_migrations"
     WHERE "migration_name" = '20260813120000_speedster_map_registration_lessons'
       AND "finished_at" IS NOT NULL
       AND "rolled_back_at" IS NULL
       AND "logs" IS NULL
       AND "applied_steps_count" > 0
  ) <> 1 THEN
    RAISE EXCEPTION 'Registration lesson migration ledger marker is not one clean success';
  END IF;

  IF EXISTS (SELECT 1 FROM "AiGraderV2MapRegistrationLesson") THEN
    RAISE EXCEPTION 'Registration lesson fixture requires an initially empty disposable table';
  END IF;
END
$speedster_registration_lesson_catalog$;

INSERT INTO "AiGraderV2Session" (
  "id", "createdByUserId", "cardProfile", "workflowState", "ruleVersion",
  "identity", "capture", "reviewedDefects", "gradeReport", "updatedAt"
) VALUES (
  'speedster-registration-validation-session',
  'speedster-registration-validation-admin',
  'POKEMON',
  'CAPTURED',
  'speedster-v2',
  '{"category":"POKEMON","year":"2023","productSet":"MEW EN","parallel":"REVERSE HOLO","cardName":"FIXTURE","cardNumber":"000/165"}'::jsonb,
  '{}'::jsonb,
  '[]'::jsonb,
  '{}'::jsonb,
  clock_timestamp()
);

INSERT INTO "AiGraderV2CardTypeMap" (
  "id", "matchKeyHash", "cardProfile"
) VALUES (
  'speedster-registration-validation-map',
  repeat('1', 64),
  'POKEMON'
);

INSERT INTO "AiGraderV2CardTypeMapRevision" (
  "id", "mapId", "version", "matchKeyHash", "matchKey", "displayIdentity",
  "normalizedIdentity", "sourceSessionId", "authorAdminId", "frontMap", "backMap",
  "mapSchemaVersion", "filterPolicyVersion", "revisionHash"
) VALUES (
  'speedster-registration-validation-revision',
  'speedster-registration-validation-map',
  1,
  repeat('1', 64),
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  'speedster-registration-validation-session',
  'speedster-registration-validation-admin',
  '{}'::jsonb,
  '{}'::jsonb,
  'speedster-card-type-map-v2',
  'speedster-map-filter-authority-padding-v2',
  repeat('2', 64)
);

INSERT INTO "AiGraderV2MapRegistrationLesson" (
  "id", "tenantId", "operatorAdminId", "mapRevisionId", "side",
  "evidenceSessionId", "currentInspectionKey", "currentInspectionSha256",
  "currentPhysicalQuadSha256", "originalExpectedAnchors", "automaticDiagnostics",
  "humanCorrectedAnchors", "validatedRegistration", "algorithmVersion",
  "policyVersion", "rescueAttemptId", "lessonHash"
) VALUES (
  'speedster-registration-validation-lesson',
  'ten-kings',
  'speedster-registration-validation-admin',
  'speedster-registration-validation-revision',
  'FRONT',
  'speedster-registration-validation-session',
  'ai-grader-v2/disposable/registration-lessons/inspection.webp',
  repeat('a', 64),
  repeat('b', 64),
  '[]'::jsonb,
  '{}'::jsonb,
  '[]'::jsonb,
  '{}'::jsonb,
  'opencv-redundant-ransac-registration-v2',
  'speedster-map-registration-acceptance-v2',
  'rescue-validation-attempt',
  repeat('c', 64)
);

DO $speedster_registration_lesson_behavior$
DECLARE
  rejected boolean;
BEGIN
  IF (SELECT count(*) FROM "AiGraderV2MapRegistrationLesson"
       WHERE "id" = 'speedster-registration-validation-lesson') <> 1 THEN
    RAISE EXCEPTION 'Valid registration lesson insert did not persist inside the fixture transaction';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "AiGraderV2MapRegistrationLesson" (
      "id", "tenantId", "operatorAdminId", "mapRevisionId", "side",
      "evidenceSessionId", "currentInspectionKey", "currentInspectionSha256",
      "currentPhysicalQuadSha256", "originalExpectedAnchors", "automaticDiagnostics",
      "humanCorrectedAnchors", "validatedRegistration", "algorithmVersion",
      "policyVersion", "rescueAttemptId", "lessonHash"
    ) VALUES (
      'speedster-registration-invalid-fk', 'ten-kings', 'admin',
      'missing-speedster-map-revision', 'BACK',
      'speedster-registration-validation-session', 'invalid/fk.webp', repeat('d', 64),
      repeat('e', 64), '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb,
      'opencv-redundant-ransac-registration-v2',
      'speedster-map-registration-acceptance-v2', 'invalid-fk-attempt', repeat('f', 64)
    );
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected registration lesson foreign-key rejection'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO "AiGraderV2MapRegistrationLesson" (
      "id", "tenantId", "operatorAdminId", "mapRevisionId", "side",
      "evidenceSessionId", "currentInspectionKey", "currentInspectionSha256",
      "currentPhysicalQuadSha256", "originalExpectedAnchors", "automaticDiagnostics",
      "humanCorrectedAnchors", "validatedRegistration", "algorithmVersion",
      "policyVersion", "rescueAttemptId", "lessonHash"
    ) VALUES (
      'speedster-registration-invalid-check', 'ten-kings', 'admin',
      'speedster-registration-validation-revision', 'LEFT',
      'speedster-registration-validation-session', 'invalid/check.webp', repeat('d', 64),
      repeat('e', 64), '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb,
      'opencv-redundant-ransac-registration-v2',
      'speedster-map-registration-acceptance-v2', 'invalid-check-attempt', repeat('f', 64)
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected registration lesson CHECK rejection'; END IF;

  rejected := false;
  BEGIN
    UPDATE "AiGraderV2MapRegistrationLesson"
       SET "operatorAdminId" = 'mutated-admin'
     WHERE "id" = 'speedster-registration-validation-lesson';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'AiGraderV2MapRegistrationLesson rows are immutable' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected registration lesson UPDATE rejection'; END IF;

  rejected := false;
  BEGIN
    DELETE FROM "AiGraderV2MapRegistrationLesson"
     WHERE "id" = 'speedster-registration-validation-lesson';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'AiGraderV2MapRegistrationLesson rows are immutable' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected registration lesson DELETE rejection'; END IF;
END
$speedster_registration_lesson_behavior$;

ROLLBACK;

DO $speedster_registration_lesson_cleanup$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "AiGraderV2MapRegistrationLesson"
  ) OR EXISTS (
    SELECT 1 FROM "AiGraderV2CardTypeMapRevision"
     WHERE "id" LIKE 'speedster-registration-validation-%'
  ) OR EXISTS (
    SELECT 1 FROM "AiGraderV2CardTypeMap"
     WHERE "id" LIKE 'speedster-registration-validation-%'
  ) OR EXISTS (
    SELECT 1 FROM "AiGraderV2Session"
     WHERE "id" LIKE 'speedster-registration-validation-%'
  ) THEN
    RAISE EXCEPTION 'Registration lesson fixture rows survived rollback';
  END IF;
END
$speedster_registration_lesson_cleanup$;

\echo SPEEDSTER_MAP_REGISTRATION_LESSON_VALIDATION_PASS
