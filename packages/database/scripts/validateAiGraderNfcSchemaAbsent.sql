\set ON_ERROR_STOP on

DO $ai_grader_nfc_schema_absent$
DECLARE
  object_count integer;
BEGIN
  SELECT count(*)
    INTO object_count
    FROM (
      SELECT to_regclass('public."AiGraderNfcTag"')::text AS object_name
      UNION ALL SELECT to_regclass('public."AiGraderNfcProgrammingAttempt"')::text
      UNION ALL SELECT to_regclass('public."AiGraderNfcManualIosAttempt"')::text
      UNION ALL SELECT to_regclass('public."AiGraderNfcAuditEvent"')::text
      UNION ALL SELECT to_regtype('public."AiGraderNfcChipType"')::text
      UNION ALL SELECT to_regtype('public."AiGraderNfcSecurityMode"')::text
      UNION ALL SELECT to_regtype('public."AiGraderNfcTagStatus"')::text
      UNION ALL SELECT to_regtype('public."AiGraderNfcProgrammingAttemptState"')::text
      UNION ALL SELECT to_regtype('public."AiGraderNfcManualIosAttemptState"')::text
    ) objects
   WHERE object_name IS NOT NULL;

  IF object_count <> 0 THEN
    RAISE EXCEPTION 'NFC schema absence precondition failed: found % NFC objects', object_count;
  END IF;
END
$ai_grader_nfc_schema_absent$;

\echo AI_GRADER_NFC_SCHEMA_ABSENT_VALIDATION_PASS
