\set ON_ERROR_STOP on

-- All fixtures are isolated inside one rolled-back transaction. This validator
-- is run only by the repository's loopback/tmpfs disposable PostgreSQL harness.
BEGIN;

DO $catalog$
DECLARE
  missing integer;
BEGIN
  SELECT count(*) INTO missing
    FROM (VALUES
      ('AiGraderV2InstrumentationEvent_append_only', 'AiGraderV2InstrumentationEvent'),
      ('AiGraderV2MapFilterDecision_append_only', 'AiGraderV2MapFilterDecision'),
      ('AiGraderV2MapFilterRestoreEvent_append_only', 'AiGraderV2MapFilterRestoreEvent')
    ) expected(trigger_name, table_name)
    LEFT JOIN pg_trigger trigger_object
      ON trigger_object.tgname = expected.trigger_name
     AND trigger_object.tgrelid = to_regclass('public."' || expected.table_name || '"')
     AND NOT trigger_object.tgisinternal
     AND trigger_object.tgenabled = 'O'
     AND trigger_object.tgtype = 27::smallint
    LEFT JOIN pg_proc trigger_function ON trigger_function.oid = trigger_object.tgfoid
   WHERE trigger_object.oid IS NULL
      OR trigger_function.proname <> 'reject_ai_grader_v2_audit_evidence_mutation';
  IF missing <> 0 THEN
    RAISE EXCEPTION 'Speedster audit append-only triggers are incomplete: %', missing;
  END IF;

  SELECT count(*) INTO missing
    FROM (VALUES
      ('AiGraderV2InstrumentationEvent_no_truncate', 'AiGraderV2InstrumentationEvent'),
      ('AiGraderV2MapFilterDecision_no_truncate', 'AiGraderV2MapFilterDecision'),
      ('AiGraderV2MapFilterRestoreEvent_no_truncate', 'AiGraderV2MapFilterRestoreEvent')
    ) expected(trigger_name, table_name)
    LEFT JOIN pg_trigger trigger_object
      ON trigger_object.tgname = expected.trigger_name
     AND trigger_object.tgrelid = to_regclass('public."' || expected.table_name || '"')
     AND NOT trigger_object.tgisinternal
     AND trigger_object.tgenabled = 'O'
     AND trigger_object.tgtype = 34::smallint
    LEFT JOIN pg_proc trigger_function ON trigger_function.oid = trigger_object.tgfoid
   WHERE trigger_object.oid IS NULL
      OR trigger_function.proname <> 'reject_ai_grader_v2_audit_evidence_mutation';
  IF missing <> 0 THEN
    RAISE EXCEPTION 'Speedster audit no-TRUNCATE triggers are incomplete: %', missing;
  END IF;

  IF (SELECT count(*) FROM "_prisma_migrations"
      WHERE "migration_name" = '20260818153000_speedster_audit_evidence_append_only'
        AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
        AND "logs" IS NULL AND "applied_steps_count" > 0) <> 1 THEN
    RAISE EXCEPTION 'Speedster audit immutability migration ledger entry is not one clean success';
  END IF;
END
$catalog$;

INSERT INTO "AiGraderV2Session" (
  "id", "createdByUserId", "cardProfile", "workflowState", "ruleVersion",
  "identity", "capture", "reviewedDefects", "gradeReport", "updatedAt"
) VALUES (
  'speedster-audit-immutability-session', 'validation-admin', 'POKEMON',
  'CAPTURED', 'speedster-v2', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb,
  clock_timestamp()
);

INSERT INTO "AiGraderV2CardTypeMap" (
  "id", "matchKeyHash", "cardProfile"
) VALUES (
  'speedster-audit-immutability-map', repeat('1', 64), 'POKEMON'
);

INSERT INTO "AiGraderV2CardTypeMapRevision" (
  "id", "mapId", "version", "matchKeyHash", "matchKey", "displayIdentity",
  "normalizedIdentity", "sourceSessionId", "authorAdminId", "frontMap", "backMap",
  "mapSchemaVersion", "filterPolicyVersion", "revisionHash"
) VALUES (
  'speedster-audit-immutability-revision', 'speedster-audit-immutability-map', 1,
  repeat('1', 64), '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
  'speedster-audit-immutability-session', 'validation-admin', '{}'::jsonb, '{}'::jsonb,
  'speedster-card-map-v1', 'speedster-map-filter-v1', repeat('2', 64)
);

INSERT INTO "AiGraderV2InstrumentationEvent" (
  "id", "eventKey", "sessionId", "cycleId", "createdByUserId", "category", "eventType", "details"
) VALUES (
  'speedster-audit-immutability-instrumentation', 'audit-validation-event-key',
  'speedster-audit-immutability-session', 'audit-validation-cycle', 'validation-admin',
  'CAPTURE', 'UPLOAD_VERIFIED', '{"source":"disposable-validator"}'::jsonb
);

INSERT INTO "AiGraderV2MapFilterDecision" (
  "id", "sessionId", "findingId", "side", "originalOrigin", "proposedDefectType",
  "confidence", "sourceViewId", "supportingViewIds", "cardIdentity", "findingSnapshot",
  "mapId", "mapRevisionId", "zoneId", "zoneType", "zoneOverlap", "filterPolicyVersion",
  "ruleId", "ruleInputs", "detectorVersion"
) VALUES (
  'speedster-audit-immutability-decision', 'speedster-audit-immutability-session',
  'audit-validation-finding', 'FRONT', 'DETECTOR', 'SCRATCH', 0.8, 'front-inspection',
  '["front-inspection"]'::jsonb, '{}'::jsonb, '{}'::jsonb,
  'speedster-audit-immutability-map', 'speedster-audit-immutability-revision',
  'zone-1', 'ARTWORK', '{}'::jsonb, 'speedster-map-filter-v1', 'zone-authority',
  '{}'::jsonb, 'detector-validation-v1'
);

INSERT INTO "AiGraderV2MapFilterRestoreEvent" (
  "id", "decisionId", "restoredByAdminId", "sessionLifecycleState", "outcome", "calibrationMistake"
) VALUES (
  'speedster-audit-immutability-restore', 'speedster-audit-immutability-decision',
  'validation-admin', 'CAPTURED', 'RESTORED', '{}'::jsonb
);

DO $behavior$
DECLARE
  rejected boolean;
  table_name text;
BEGIN
  INSERT INTO "AiGraderV2InstrumentationEvent" (
    "id", "eventKey", "sessionId", "cycleId", "createdByUserId", "category", "eventType"
  ) VALUES (
    'speedster-audit-immutability-instrumentation-duplicate', 'audit-validation-event-key',
    'speedster-audit-immutability-session', 'audit-validation-cycle', 'validation-admin',
    'CAPTURE', 'UPLOAD_VERIFIED'
  ) ON CONFLICT ("eventKey") DO NOTHING;
  IF (SELECT count(*) FROM "AiGraderV2InstrumentationEvent"
      WHERE "eventKey" = 'audit-validation-event-key') <> 1 THEN
    RAISE EXCEPTION 'Instrumentation idempotent insert behavior changed';
  END IF;

  INSERT INTO "AiGraderV2MapFilterDecision" (
    "id", "sessionId", "findingId", "side", "originalOrigin", "proposedDefectType",
    "confidence", "sourceViewId", "supportingViewIds", "cardIdentity", "findingSnapshot",
    "mapId", "mapRevisionId", "zoneId", "zoneType", "zoneOverlap", "filterPolicyVersion",
    "ruleId", "ruleInputs", "detectorVersion"
  ) SELECT
    'speedster-audit-immutability-decision-duplicate', "sessionId", "findingId", "side",
    "originalOrigin", "proposedDefectType", "confidence", "sourceViewId", "supportingViewIds",
    "cardIdentity", "findingSnapshot", "mapId", "mapRevisionId", "zoneId", "zoneType",
    "zoneOverlap", "filterPolicyVersion", "ruleId", "ruleInputs", "detectorVersion"
  FROM "AiGraderV2MapFilterDecision"
  WHERE "id" = 'speedster-audit-immutability-decision'
  ON CONFLICT ("sessionId", "findingId") DO NOTHING;
  IF (SELECT count(*) FROM "AiGraderV2MapFilterDecision"
      WHERE "sessionId" = 'speedster-audit-immutability-session'
        AND "findingId" = 'audit-validation-finding') <> 1 THEN
    RAISE EXCEPTION 'Map Filter decision idempotent insert behavior changed';
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'AiGraderV2InstrumentationEvent',
    'AiGraderV2MapFilterDecision',
    'AiGraderV2MapFilterRestoreEvent'
  ] LOOP
    rejected := false;
    BEGIN
      EXECUTE format('UPDATE %I SET "id" = "id"', table_name);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> (table_name || ' rows are immutable') THEN RAISE; END IF;
      rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION '% UPDATE was accepted', table_name; END IF;

    rejected := false;
    BEGIN
      EXECUTE format('DELETE FROM %I', table_name);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> (table_name || ' rows are immutable') THEN RAISE; END IF;
      rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION '% DELETE was accepted', table_name; END IF;

    rejected := false;
    BEGIN
      -- CASCADE is required even when the referencing table is empty. It also
      -- exercises the statement trigger when a privileged caller attempts to
      -- truncate a referenced audit ledger instead of stopping at the FK.
      EXECUTE format('TRUNCATE TABLE %I CASCADE', table_name);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT IN (
        table_name || ' rows are immutable',
        'AiGraderV2MapFilterRestoreEvent rows are immutable'
      ) THEN RAISE; END IF;
      rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION '% TRUNCATE was accepted', table_name; END IF;
  END LOOP;

  IF (SELECT count(*) FROM "AiGraderV2InstrumentationEvent"
      WHERE "id" = 'speedster-audit-immutability-instrumentation') <> 1
     OR (SELECT count(*) FROM "AiGraderV2MapFilterDecision"
         WHERE "id" = 'speedster-audit-immutability-decision') <> 1
     OR (SELECT count(*) FROM "AiGraderV2MapFilterRestoreEvent"
         WHERE "id" = 'speedster-audit-immutability-restore') <> 1 THEN
    RAISE EXCEPTION 'Speedster audit evidence changed after rejected mutations';
  END IF;
END
$behavior$;

ROLLBACK;

DO $cleanup$
BEGIN
  IF EXISTS (SELECT 1 FROM "AiGraderV2InstrumentationEvent" WHERE "id" LIKE 'speedster-audit-immutability-%')
     OR EXISTS (SELECT 1 FROM "AiGraderV2MapFilterDecision" WHERE "id" LIKE 'speedster-audit-immutability-%')
     OR EXISTS (SELECT 1 FROM "AiGraderV2MapFilterRestoreEvent" WHERE "id" LIKE 'speedster-audit-immutability-%')
     OR EXISTS (SELECT 1 FROM "AiGraderV2Session" WHERE "id" = 'speedster-audit-immutability-session') THEN
    RAISE EXCEPTION 'Speedster audit immutability fixtures survived rollback';
  END IF;
END
$cleanup$;

\echo SPEEDSTER_AUDIT_EVIDENCE_IMMUTABILITY_VALIDATION_PASS
