\set ON_ERROR_STOP on

BEGIN;

-- Parse the reviewed CHECK expressions with the same PostgreSQL server that
-- applied the migration. Comparing canonical pg_get_constraintdef output from
-- these temporary relations avoids depending on formatting while still
-- requiring every token in every definition to match.
CREATE TEMP TABLE _AiGraderNfcExpectedTagChecks (
  publicTagId text,
  expectedPayloadSha256 text,
  readbackPayloadSha256 text,
  uidFingerprintSha256 text,
  chipType text,
  securityMode text,
  ndefPayloadVersion integer,
  tenantId text,
  reportId text,
  certId text,
  createdByUserId text,
  status text,
  programmedAt timestamp(3),
  verifiedAt timestamp(3),
  activatedAt timestamp(3),
  activatedByUserId text,
  revokedAt timestamp(3),
  revokedByUserId text,
  revocationReason text,
  errorCode text,
  metadata jsonb,
  CONSTRAINT AiGraderNfcTag_public_id_shape CHECK (publicTagId ~ '^[A-Za-z0-9_-]{32}$'),
  CONSTRAINT AiGraderNfcTag_expected_digest_shape CHECK (expectedPayloadSha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT AiGraderNfcTag_readback_digest_shape CHECK (readbackPayloadSha256 IS NULL OR readbackPayloadSha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT AiGraderNfcTag_uid_fingerprint_shape CHECK (uidFingerprintSha256 IS NULL OR uidFingerprintSha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT AiGraderNfcTag_strategy_pair CHECK (
    (chipType = 'NTAG215' AND securityMode = 'static_url_v1') OR
    (chipType = 'NTAG424_DNA' AND securityMode = 'ntag424_sun_v1') OR
    (chipType = 'FEIJU_PROPRIETARY_ISODEP' AND securityMode = 'manual_ios_locked_static_url_v1')
  ),
  CONSTRAINT AiGraderNfcTag_payload_version CHECK (ndefPayloadVersion > 0 AND ndefPayloadVersion <= 1000),
  CONSTRAINT AiGraderNfcTag_linkage_bounds CHECK (
    char_length(tenantId) BETWEEN 1 AND 128 AND
    char_length(reportId) BETWEEN 1 AND 256 AND
    char_length(certId) BETWEEN 1 AND 256 AND
    char_length(createdByUserId) BETWEEN 1 AND 128
  ),
  CONSTRAINT AiGraderNfcTag_verified_evidence CHECK (
    status NOT IN ('verified', 'active') OR
    (readbackPayloadSha256 IS NOT NULL AND programmedAt IS NOT NULL AND verifiedAt IS NOT NULL AND
     ((chipType = 'NTAG215' AND uidFingerprintSha256 IS NOT NULL) OR
      (chipType = 'NTAG424_DNA' AND uidFingerprintSha256 IS NOT NULL) OR
      (chipType = 'FEIJU_PROPRIETARY_ISODEP' AND uidFingerprintSha256 IS NULL)))
  ),
  CONSTRAINT AiGraderNfcTag_active_evidence CHECK (
    status <> 'active' OR (activatedAt IS NOT NULL AND activatedByUserId IS NOT NULL)
  ),
  CONSTRAINT AiGraderNfcTag_active_not_revoked CHECK (
    status <> 'active' OR
    (revokedAt IS NULL AND revokedByUserId IS NULL AND revocationReason IS NULL)
  ),
  CONSTRAINT AiGraderNfcTag_revocation_required CHECK (
    status <> 'revoked' OR
    (revokedAt IS NOT NULL AND revokedByUserId IS NOT NULL AND revocationReason IS NOT NULL AND
     char_length(btrim(revocationReason)) BETWEEN 3 AND 500)
  ),
  CONSTRAINT AiGraderNfcTag_error_code_required CHECK (
    status <> 'error' OR
    (errorCode IS NOT NULL AND char_length(btrim(errorCode)) BETWEEN 1 AND 80)
  ),
  CONSTRAINT AiGraderNfcTag_metadata_bound CHECK (metadata IS NULL OR pg_column_size(metadata) <= 4096)
) ON COMMIT DROP;

CREATE TEMP TABLE _AiGraderNfcExpectedAttemptChecks (
  id text,
  tokenHash text,
  attestationChallengeHash text,
  expectedAttestationAlgorithm text,
  completedWorkstationKeyId text,
  idempotencyKeyHash text,
  completionIdempotencyKeyHash text,
  requestedAt timestamp(3),
  expiresAt timestamp(3),
  state text,
  consumedAt timestamp(3),
  failureCode text,
  readbackEvidence jsonb,
  CONSTRAINT AiGraderNfcProgrammingAttempt_id_shape CHECK (id ~ '^nfc_attempt_[A-Za-z0-9_-]{43}$'),
  CONSTRAINT AiGraderNfcProgrammingAttempt_token_hash_shape CHECK (tokenHash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT AiGraderNfcProgrammingAttempt_challenge_hash_shape CHECK (attestationChallengeHash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT AiGraderNfcProgrammingAttempt_attestation_algorithm CHECK (
    expectedAttestationAlgorithm = 'ecdsa-p256-sha256-p1363'
  ),
  CONSTRAINT AiGraderNfcProgrammingAttempt_workstation_key_shape CHECK (
    completedWorkstationKeyId IS NULL OR completedWorkstationKeyId ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT AiGraderNfcProgrammingAttempt_idempotency_hash_shape CHECK (idempotencyKeyHash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT AiGraderNfcProgrammingAttempt_completion_idempotency_hash_shape CHECK (
    completionIdempotencyKeyHash IS NULL OR completionIdempotencyKeyHash ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT AiGraderNfcProgrammingAttempt_expiry_bound CHECK (
    expiresAt > requestedAt AND expiresAt <= requestedAt + INTERVAL '30 minutes'
  ),
  CONSTRAINT AiGraderNfcProgrammingAttempt_consumed_state CHECK (
    (state = 'consumed' AND consumedAt IS NOT NULL) OR
    (state <> 'consumed' AND consumedAt IS NULL)
  ),
  CONSTRAINT AiGraderNfcProgrammingAttempt_failure_state CHECK (
    (state IN ('failed', 'expired') AND failureCode IS NOT NULL AND char_length(failureCode) BETWEEN 1 AND 80) OR
    (state NOT IN ('failed', 'expired') AND failureCode IS NULL)
  ),
  CONSTRAINT AiGraderNfcProgrammingAttempt_completion_state CHECK (
    (state IN ('verified', 'consumed') AND
     completionIdempotencyKeyHash IS NOT NULL AND
     completedWorkstationKeyId IS NOT NULL AND
     readbackEvidence IS NOT NULL) OR
    (state NOT IN ('verified', 'consumed') AND
     completionIdempotencyKeyHash IS NULL AND
     completedWorkstationKeyId IS NULL AND
     readbackEvidence IS NULL)
  ),
  CONSTRAINT AiGraderNfcProgrammingAttempt_attestation_evidence CHECK (
    readbackEvidence IS NULL OR (
      jsonb_typeof(readbackEvidence) = 'object' AND
      readbackEvidence ?& ARRAY[
        'schemaVersion',
        'workstationKeyId',
        'algorithm',
        'statementSha256',
        'signature',
        'observedAt',
        'helperProtocolVersion',
        'readerResultCode',
        'cryptographicTagAuthentication',
        'workstationOperationalAttestation'
      ] AND
      jsonb_typeof(readbackEvidence->'schemaVersion') = 'string' AND
      jsonb_typeof(readbackEvidence->'workstationKeyId') = 'string' AND
      jsonb_typeof(readbackEvidence->'algorithm') = 'string' AND
      jsonb_typeof(readbackEvidence->'statementSha256') = 'string' AND
      jsonb_typeof(readbackEvidence->'signature') = 'string' AND
      jsonb_typeof(readbackEvidence->'observedAt') = 'string' AND
      jsonb_typeof(readbackEvidence->'helperProtocolVersion') = 'string' AND
      jsonb_typeof(readbackEvidence->'readerResultCode') = 'string' AND
      jsonb_typeof(readbackEvidence->'cryptographicTagAuthentication') = 'boolean' AND
      jsonb_typeof(readbackEvidence->'workstationOperationalAttestation') = 'boolean' AND
      readbackEvidence->>'schemaVersion' = 'ai-grader-nfc-helper-attestation-v1' AND
      readbackEvidence->>'workstationKeyId' = completedWorkstationKeyId AND
      readbackEvidence->>'algorithm' = expectedAttestationAlgorithm AND
      readbackEvidence->>'statementSha256' ~ '^[a-f0-9]{64}$' AND
      readbackEvidence->>'signature' ~ '^[A-Za-z0-9_-]{86}$' AND
      readbackEvidence->>'observedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' AND
      readbackEvidence->>'helperProtocolVersion' = 'tenkings-ai-grader-nfc-loopback-v2' AND
      readbackEvidence->>'readerResultCode' IN ('write_verified_pcsc_readback', 'already_programmed_exact') AND
      readbackEvidence->'cryptographicTagAuthentication' = 'false'::jsonb AND
      readbackEvidence->'workstationOperationalAttestation' = 'true'::jsonb AND
      readbackEvidence = jsonb_build_object(
        'schemaVersion', 'ai-grader-nfc-helper-attestation-v1',
        'workstationKeyId', completedWorkstationKeyId,
        'algorithm', expectedAttestationAlgorithm,
        'statementSha256', readbackEvidence->>'statementSha256',
        'signature', readbackEvidence->>'signature',
        'observedAt', readbackEvidence->>'observedAt',
        'helperProtocolVersion', 'tenkings-ai-grader-nfc-loopback-v2',
        'readerResultCode', readbackEvidence->>'readerResultCode',
        'cryptographicTagAuthentication', false,
        'workstationOperationalAttestation', true
      )
    )
  ),
  CONSTRAINT AiGraderNfcProgrammingAttempt_evidence_bound CHECK (
    readbackEvidence IS NULL OR pg_column_size(readbackEvidence) <= 4096
  )
) ON COMMIT DROP;

CREATE TEMP TABLE _AiGraderNfcExpectedAuditChecks (
  action text,
  reasonCode text,
  safeDetails jsonb,
  CONSTRAINT AiGraderNfcAuditEvent_action_bound CHECK (char_length(action) BETWEEN 1 AND 80),
  CONSTRAINT AiGraderNfcAuditEvent_reason_bound CHECK (reasonCode IS NULL OR char_length(reasonCode) BETWEEN 1 AND 80),
  CONSTRAINT AiGraderNfcAuditEvent_details_bound CHECK (safeDetails IS NULL OR pg_column_size(safeDetails) <= 4096)
) ON COMMIT DROP;

CREATE TEMP VIEW _AiGraderNfcActualIndexes AS
SELECT index_object.relname::text AS index_name,
       table_object.relname::text AS table_name,
       index_metadata.indisunique AS is_unique,
       index_metadata.indisprimary AS is_primary,
       index_metadata.indisvalid AS is_valid,
       index_metadata.indisready AS is_ready,
       index_metadata.indislive AS is_live,
       index_metadata.indpred IS NULL AS has_no_predicate,
       index_metadata.indexprs IS NULL AS has_no_expressions,
       index_metadata.indnatts = index_metadata.indnkeyatts AS has_no_included_columns,
       NOT index_metadata.indisexclusion AS is_not_exclusion,
       index_object.relkind = 'i' AS is_index,
       table_object.relkind = 'r' AS is_table,
       access_method.amname::text AS access_method,
       ARRAY(
         SELECT attribute.attname::text
           FROM unnest(index_metadata.indkey::smallint[]) WITH ORDINALITY AS key_column(attnum, position)
           JOIN pg_attribute attribute
             ON attribute.attrelid = index_metadata.indrelid
            AND attribute.attnum = key_column.attnum
          WHERE key_column.position <= index_metadata.indnkeyatts
          ORDER BY key_column.position
       )::text[] AS key_columns,
       lower(regexp_replace(
         regexp_replace(pg_get_expr(index_metadata.indpred, index_metadata.indrelid), '::[A-Za-z0-9_.' || chr(34) || ']+', '', 'g'),
         '[[:space:]' || chr(34) || '()]', '', 'g'
       )) AS normalized_predicate
  FROM pg_index index_metadata
  JOIN pg_class index_object ON index_object.oid = index_metadata.indexrelid
  JOIN pg_namespace index_namespace ON index_namespace.oid = index_object.relnamespace
  JOIN pg_class table_object ON table_object.oid = index_metadata.indrelid
  JOIN pg_namespace table_namespace ON table_namespace.oid = table_object.relnamespace
  JOIN pg_am access_method ON access_method.oid = index_object.relam
 WHERE index_namespace.nspname = 'public'
   AND table_namespace.nspname = 'public';

DO $ai_grader_nfc_catalog$
DECLARE
  actual_labels text[];
  actual_columns text[];
  missing_count integer;
BEGIN
  IF to_regclass('public."AiGraderNfcTag"') IS NULL
     OR to_regclass('public."AiGraderNfcProgrammingAttempt"') IS NULL
     OR to_regclass('public."AiGraderNfcManualIosAttempt"') IS NULL
     OR to_regclass('public."AiGraderNfcAuditEvent"') IS NULL THEN
    RAISE EXCEPTION 'NFC migration tables are incomplete';
  END IF;

  SELECT array_agg(enum_value ORDER BY enum_order)
    INTO actual_labels
    FROM (
      SELECT e.enumlabel::text AS enum_value, e.enumsortorder AS enum_order
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE n.nspname = 'public' AND t.typname = 'AiGraderNfcChipType'
    ) values_in_order;
  IF actual_labels IS DISTINCT FROM ARRAY['NTAG215', 'NTAG424_DNA', 'FEIJU_PROPRIETARY_ISODEP']::text[] THEN
    RAISE EXCEPTION 'AiGraderNfcChipType labels differ: %', actual_labels;
  END IF;

  SELECT array_agg(enum_value ORDER BY enum_order)
    INTO actual_labels
    FROM (
      SELECT e.enumlabel::text AS enum_value, e.enumsortorder AS enum_order
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE n.nspname = 'public' AND t.typname = 'AiGraderNfcSecurityMode'
    ) values_in_order;
  IF actual_labels IS DISTINCT FROM ARRAY['static_url_v1', 'ntag424_sun_v1', 'manual_ios_locked_static_url_v1']::text[] THEN
    RAISE EXCEPTION 'AiGraderNfcSecurityMode labels differ: %', actual_labels;
  END IF;

  SELECT array_agg(enum_value ORDER BY enum_order)
    INTO actual_labels
    FROM (
      SELECT e.enumlabel::text AS enum_value, e.enumsortorder AS enum_order
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE n.nspname = 'public' AND t.typname = 'AiGraderNfcTagStatus'
    ) values_in_order;
  IF actual_labels IS DISTINCT FROM
     ARRAY['reserved', 'programming', 'verified', 'active', 'revoked', 'error']::text[] THEN
    RAISE EXCEPTION 'AiGraderNfcTagStatus labels differ: %', actual_labels;
  END IF;

  SELECT array_agg(enum_value ORDER BY enum_order)
    INTO actual_labels
    FROM (
      SELECT e.enumlabel::text AS enum_value, e.enumsortorder AS enum_order
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE n.nspname = 'public' AND t.typname = 'AiGraderNfcProgrammingAttemptState'
    ) values_in_order;
  IF actual_labels IS DISTINCT FROM
     ARRAY['initialized', 'writing', 'verified', 'failed', 'expired', 'consumed']::text[] THEN
    RAISE EXCEPTION 'AiGraderNfcProgrammingAttemptState labels differ: %', actual_labels;
  END IF;

  SELECT array_agg(enum_value ORDER BY enum_order)
    INTO actual_labels
    FROM (
      SELECT e.enumlabel::text AS enum_value, e.enumsortorder AS enum_order
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE n.nspname = 'public' AND t.typname = 'AiGraderNfcManualIosAttemptState'
    ) values_in_order;
  IF actual_labels IS DISTINCT FROM ARRAY[
    'awaiting_prelock_tap', 'awaiting_lock_confirmation', 'awaiting_postlock_tap',
    'ready_to_complete', 'failed', 'expired', 'consumed'
  ]::text[] THEN
    RAISE EXCEPTION 'AiGraderNfcManualIosAttemptState labels differ: %', actual_labels;
  END IF;
  SELECT array_agg(a.attname::text ORDER BY a.attnum)
    INTO actual_columns
    FROM pg_attribute a
   WHERE a.attrelid = 'public."AiGraderNfcTag"'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF actual_columns IS DISTINCT FROM ARRAY[
    'id', 'tenantId', 'publicTagId', 'chipType', 'securityMode', 'status',
    'uidFingerprintSha256', 'ndefPayloadVersion', 'expectedPayloadSha256',
    'readbackPayloadSha256', 'aiGraderReportId', 'reportId', 'cardAssetId',
    'itemId', 'aiGraderLabelId', 'certId', 'createdByUserId',
    'programmedByUserId', 'verifiedByUserId', 'activatedByUserId',
    'revokedByUserId', 'programmedAt', 'verifiedAt', 'activatedAt',
    'revokedAt', 'revocationReason', 'errorCode', 'metadata', 'createdAt', 'updatedAt'
  ]::text[] THEN
    RAISE EXCEPTION 'AiGraderNfcTag columns differ: %', actual_columns;
  END IF;

  SELECT array_agg(a.attname::text ORDER BY a.attnum)
    INTO actual_columns
    FROM pg_attribute a
   WHERE a.attrelid = 'public."AiGraderNfcProgrammingAttempt"'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF actual_columns IS DISTINCT FROM ARRAY[
    'id', 'tagId', 'tenantId', 'reportId', 'cardAssetId', 'itemId', 'certId',
    'requestedByUserId', 'idempotencyKeyHash', 'completionIdempotencyKeyHash',
    'tokenHash', 'attestationChallengeHash', 'expectedAttestationAlgorithm',
    'completedWorkstationKeyId', 'state', 'requestedAt', 'expiresAt',
    'failureCode', 'readbackEvidence', 'consumedAt', 'createdAt', 'updatedAt'
  ]::text[] THEN
    RAISE EXCEPTION 'AiGraderNfcProgrammingAttempt columns differ: %', actual_columns;
  END IF;

  SELECT array_agg(a.attname::text ORDER BY a.attnum)
    INTO actual_columns
    FROM pg_attribute a
   WHERE a.attrelid = 'public."AiGraderNfcAuditEvent"'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF actual_columns IS DISTINCT FROM ARRAY[
    'id', 'tagId', 'attemptId', 'tenantId', 'reportId', 'action',
    'fromStatus', 'toStatus', 'actorUserId', 'reasonCode', 'safeDetails', 'createdAt'
  ]::text[] THEN
    RAISE EXCEPTION 'AiGraderNfcAuditEvent columns differ: %', actual_columns;
  END IF;

  IF (
    SELECT count(*)
      FROM pg_proc trigger_function
      JOIN pg_namespace function_namespace ON function_namespace.oid = trigger_function.pronamespace
     WHERE function_namespace.nspname = 'public'
       AND trigger_function.proname = 'reject_ai_grader_nfc_audit_mutation'
  ) <> 1 OR EXISTS (
    SELECT 1
      FROM pg_proc trigger_function
      JOIN pg_namespace function_namespace ON function_namespace.oid = trigger_function.pronamespace
      JOIN pg_language function_language ON function_language.oid = trigger_function.prolang
     WHERE function_namespace.nspname = 'public'
       AND trigger_function.proname = 'reject_ai_grader_nfc_audit_mutation'
       AND (
         trigger_function.prokind <> 'f'
         OR pg_get_function_identity_arguments(trigger_function.oid) <> ''
         OR trigger_function.prorettype <> 'pg_catalog.trigger'::regtype
         OR trigger_function.proretset
         OR function_language.lanname <> 'plpgsql'
         OR trigger_function.provolatile <> 'v'
         OR trigger_function.proparallel <> 'u'
         OR trigger_function.proisstrict
         OR trigger_function.prosecdef
         OR trigger_function.proleakproof
         OR trigger_function.proconfig IS NOT NULL
         OR trigger_function.probin IS NOT NULL
         OR btrim(regexp_replace(trigger_function.prosrc, '[[:space:]]+', ' ', 'g')) <>
           'BEGIN RAISE EXCEPTION ''AiGraderNfcAuditEvent rows are immutable''; END;'
       )
  ) THEN
    RAISE EXCEPTION 'NFC immutable audit trigger function is not exact';
  END IF;

  WITH expected(trigger_name, trigger_type) AS (
    VALUES
      ('AiGraderNfcAuditEvent_immutable_update', 19::smallint),
      ('AiGraderNfcAuditEvent_immutable_delete', 11::smallint)
  ),
  actual AS (
    SELECT trigger_object.tgname::text AS trigger_name,
           trigger_object.tgtype AS trigger_type,
           trigger_object.tgenabled AS enabled,
           trigger_object.tgparentid AS parent_id,
           trigger_object.tgconstrrelid AS constraint_relation_id,
           trigger_object.tgconstrindid AS constraint_index_id,
           trigger_object.tgconstraint AS constraint_id,
           trigger_object.tgdeferrable AS is_deferrable,
           trigger_object.tginitdeferred AS is_initially_deferred,
           trigger_object.tgnargs AS argument_count,
           trigger_object.tgattr::text AS attribute_numbers,
           encode(trigger_object.tgargs, 'hex') AS encoded_arguments,
           trigger_object.tgqual IS NULL AS has_no_when_clause,
           trigger_object.tgoldtable IS NULL AS has_no_old_transition_table,
           trigger_object.tgnewtable IS NULL AS has_no_new_transition_table,
           function_namespace.nspname::text AS function_schema,
           trigger_function.proname::text AS function_name,
           pg_get_function_identity_arguments(trigger_function.oid) AS function_arguments
      FROM pg_trigger trigger_object
      JOIN pg_proc trigger_function ON trigger_function.oid = trigger_object.tgfoid
      JOIN pg_namespace function_namespace ON function_namespace.oid = trigger_function.pronamespace
     WHERE trigger_object.tgrelid = to_regclass('public.' || chr(34) || 'AiGraderNfcAuditEvent' || chr(34))
       AND NOT trigger_object.tgisinternal
  )
  SELECT count(*) INTO missing_count
    FROM expected
    FULL JOIN actual USING (trigger_name)
   WHERE expected.trigger_name IS NULL OR actual.trigger_name IS NULL
      OR actual.trigger_type IS DISTINCT FROM expected.trigger_type
      OR actual.enabled <> 'O'
      OR actual.parent_id <> 0 OR actual.constraint_relation_id <> 0
      OR actual.constraint_index_id <> 0 OR actual.constraint_id <> 0
      OR actual.is_deferrable OR actual.is_initially_deferred
      OR actual.argument_count <> 0 OR actual.attribute_numbers <> ''
      OR actual.encoded_arguments <> '' OR NOT actual.has_no_when_clause
      OR NOT actual.has_no_old_transition_table OR NOT actual.has_no_new_transition_table
      OR actual.function_schema <> 'public'
      OR actual.function_name <> 'reject_ai_grader_nfc_audit_mutation'
      OR actual.function_arguments <> '';
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'NFC immutable audit triggers are not exact: % invalid', missing_count;
  END IF;

  SELECT count(*) INTO missing_count
    FROM (VALUES
      ('AiGraderNfcTag', 'publicTagId', 'text', 'NO'),
      ('AiGraderNfcTag', 'chipType', 'AiGraderNfcChipType', 'NO'),
      ('AiGraderNfcTag', 'securityMode', 'AiGraderNfcSecurityMode', 'NO'),
      ('AiGraderNfcTag', 'status', 'AiGraderNfcTagStatus', 'NO'),
      ('AiGraderNfcTag', 'metadata', 'jsonb', 'YES'),
      ('AiGraderNfcTag', 'updatedAt', 'timestamp', 'NO'),
      ('AiGraderNfcProgrammingAttempt', 'state', 'AiGraderNfcProgrammingAttemptState', 'NO'),
      ('AiGraderNfcProgrammingAttempt', 'readbackEvidence', 'jsonb', 'YES'),
      ('AiGraderNfcProgrammingAttempt', 'updatedAt', 'timestamp', 'NO'),
      ('AiGraderNfcAuditEvent', 'fromStatus', 'AiGraderNfcTagStatus', 'YES'),
      ('AiGraderNfcAuditEvent', 'safeDetails', 'jsonb', 'YES')
    ) AS expected(table_name, column_name, type_name, nullable)
    LEFT JOIN information_schema.columns actual
      ON actual.table_schema = 'public'
     AND actual.table_name = expected.table_name
     AND actual.column_name = expected.column_name
     AND (
       (expected.type_name = 'timestamp' AND actual.data_type = 'timestamp without time zone') OR
       (expected.type_name <> 'timestamp' AND actual.udt_name = expected.type_name)
     )
     AND actual.is_nullable = expected.nullable
   WHERE actual.column_name IS NULL;
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'NFC column type/nullability checks failed for % columns', missing_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'AiGraderNfcTag'
       AND column_name = 'status' AND column_default LIKE '%reserved%'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'AiGraderNfcProgrammingAttempt'
       AND column_name = 'state' AND column_default LIKE '%initialized%'
  ) THEN
    RAISE EXCEPTION 'NFC lifecycle defaults are incomplete';
  END IF;

  WITH expected(index_name, table_name, is_unique, is_primary, key_columns) AS (
    VALUES
      ('AiGraderNfcTag_pkey', 'AiGraderNfcTag', true, true, ARRAY['id']::text[]),
      ('AiGraderNfcTag_publicTagId_key', 'AiGraderNfcTag', true, false, ARRAY['publicTagId']::text[]),
      ('AiGraderNfcTag_tenantId_reportId_status_idx', 'AiGraderNfcTag', false, false, ARRAY['tenantId', 'reportId', 'status']::text[]),
      ('AiGraderNfcTag_cardAssetId_status_idx', 'AiGraderNfcTag', false, false, ARRAY['cardAssetId', 'status']::text[]),
      ('AiGraderNfcTag_itemId_status_idx', 'AiGraderNfcTag', false, false, ARRAY['itemId', 'status']::text[]),
      ('AiGraderNfcTag_uidFingerprintSha256_status_idx', 'AiGraderNfcTag', false, false, ARRAY['uidFingerprintSha256', 'status']::text[]),
      ('AiGraderNfcTag_aiGraderReportId_idx', 'AiGraderNfcTag', false, false, ARRAY['aiGraderReportId']::text[]),
      ('AiGraderNfcTag_aiGraderLabelId_idx', 'AiGraderNfcTag', false, false, ARRAY['aiGraderLabelId']::text[]),
      ('AiGraderNfcProgrammingAttempt_pkey', 'AiGraderNfcProgrammingAttempt', true, true, ARRAY['id']::text[]),
      ('AiGraderNfcProgrammingAttempt_tokenHash_key', 'AiGraderNfcProgrammingAttempt', true, false, ARRAY['tokenHash']::text[]),
      ('AiGraderNfcAttempt_request_idempotency_key', 'AiGraderNfcProgrammingAttempt', true, false, ARRAY['tenantId', 'requestedByUserId', 'idempotencyKeyHash']::text[]),
      ('AiGraderNfcProgrammingAttempt_tagId_state_expiresAt_idx', 'AiGraderNfcProgrammingAttempt', false, false, ARRAY['tagId', 'state', 'expiresAt']::text[]),
      ('AiGraderNfcProgrammingAttempt_tenantId_reportId_state_idx', 'AiGraderNfcProgrammingAttempt', false, false, ARRAY['tenantId', 'reportId', 'state']::text[]),
      ('AiGraderNfcAuditEvent_pkey', 'AiGraderNfcAuditEvent', true, true, ARRAY['id']::text[]),
      ('AiGraderNfcAuditEvent_tagId_createdAt_idx', 'AiGraderNfcAuditEvent', false, false, ARRAY['tagId', 'createdAt']::text[]),
      ('AiGraderNfcAuditEvent_attemptId_createdAt_idx', 'AiGraderNfcAuditEvent', false, false, ARRAY['attemptId', 'createdAt']::text[]),
      ('AiGraderNfcAuditEvent_tenantId_reportId_createdAt_idx', 'AiGraderNfcAuditEvent', false, false, ARRAY['tenantId', 'reportId', 'createdAt']::text[])
  ),
  actual AS (
    SELECT index_object.relname::text AS index_name,
           table_object.relname::text AS table_name,
           index_metadata.indisunique AS is_unique,
           index_metadata.indisprimary AS is_primary,
           index_metadata.indisvalid AS is_valid,
           index_metadata.indisready AS is_ready,
           index_metadata.indislive AS is_live,
           index_metadata.indpred IS NULL AS has_no_predicate,
           index_metadata.indexprs IS NULL AS has_no_expressions,
           index_metadata.indnatts = index_metadata.indnkeyatts AS has_no_included_columns,
           NOT index_metadata.indisexclusion AS is_not_exclusion,
           index_object.relkind = 'i' AS is_index,
           table_object.relkind = 'r' AS is_table,
           access_method.amname::text AS access_method,
           ARRAY(
             SELECT attribute.attname::text
               FROM unnest(index_metadata.indkey::smallint[]) WITH ORDINALITY AS key_column(attnum, position)
               JOIN pg_attribute attribute
                 ON attribute.attrelid = index_metadata.indrelid
                AND attribute.attnum = key_column.attnum
              WHERE key_column.position <= index_metadata.indnkeyatts
              ORDER BY key_column.position
           )::text[] AS key_columns
      FROM pg_index index_metadata
      JOIN pg_class index_object ON index_object.oid = index_metadata.indexrelid
      JOIN pg_namespace index_namespace ON index_namespace.oid = index_object.relnamespace
      JOIN pg_class table_object ON table_object.oid = index_metadata.indrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_object.relnamespace
      JOIN pg_am access_method ON access_method.oid = index_object.relam
     WHERE index_namespace.nspname = 'public'
       AND table_namespace.nspname = 'public'
  )
  SELECT count(*) INTO missing_count
    FROM expected
    LEFT JOIN actual
      ON actual.index_name = expected.index_name
     AND actual.table_name = expected.table_name
   WHERE actual.index_name IS NULL
      OR actual.is_unique IS DISTINCT FROM expected.is_unique
      OR actual.is_primary IS DISTINCT FROM expected.is_primary
      OR actual.key_columns IS DISTINCT FROM expected.key_columns
      OR NOT actual.is_valid OR NOT actual.is_ready OR NOT actual.is_live
      OR NOT actual.has_no_predicate OR NOT actual.has_no_expressions
      OR NOT actual.has_no_included_columns OR NOT actual.is_not_exclusion
      OR NOT actual.is_index OR NOT actual.is_table
      OR actual.access_method <> 'btree';
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'NFC ordinary indexes are not exact: % invalid', missing_count;
  END IF;

  WITH expected(index_name, table_name, key_columns, normalized_predicate) AS (
    VALUES
      ('AiGraderNfcTag_one_open_report', 'AiGraderNfcTag', ARRAY['tenantId', 'aiGraderReportId']::text[], 'status=anyarray[''reserved'',''programming'',''verified'',''active'']'),
      ('AiGraderNfcTag_one_open_card', 'AiGraderNfcTag', ARRAY['tenantId', 'cardAssetId']::text[], 'status=anyarray[''reserved'',''programming'',''verified'',''active'']'),
      ('AiGraderNfcTag_one_open_item', 'AiGraderNfcTag', ARRAY['tenantId', 'itemId']::text[], 'status=anyarray[''reserved'',''programming'',''verified'',''active'']'),
      ('AiGraderNfcTag_one_active_uid', 'AiGraderNfcTag', ARRAY['uidFingerprintSha256']::text[], 'status=''active''anduidfingerprintsha256isnotnull'),
      ('AiGraderNfcProgrammingAttempt_one_live_per_tag', 'AiGraderNfcProgrammingAttempt', ARRAY['tagId']::text[], 'state=anyarray[''initialized'',''writing'',''verified'']')
  )
  SELECT count(*) INTO missing_count
    FROM expected
    LEFT JOIN _AiGraderNfcActualIndexes actual
      ON actual.index_name = expected.index_name
     AND actual.table_name = expected.table_name
   WHERE actual.index_name IS NULL
      OR NOT actual.is_unique OR actual.is_primary
      OR actual.key_columns IS DISTINCT FROM expected.key_columns
      OR actual.normalized_predicate IS DISTINCT FROM expected.normalized_predicate
      OR NOT actual.is_valid OR NOT actual.is_ready OR NOT actual.is_live
      OR NOT actual.has_no_expressions OR NOT actual.has_no_included_columns
      OR NOT actual.is_not_exclusion OR NOT actual.is_index OR NOT actual.is_table
      OR actual.access_method <> 'btree';
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'NFC partial unique indexes are not exact: % invalid', missing_count;
  END IF;

  SELECT count(*) INTO missing_count
    FROM (VALUES
      ('AiGraderNfcTag_aiGraderReportId_fkey', 'AiGraderNfcTag', 'aiGraderReportId', 'AiGraderReport', 'id'),
      ('AiGraderNfcTag_cardAssetId_fkey', 'AiGraderNfcTag', 'cardAssetId', 'CardAsset', 'id'),
      ('AiGraderNfcTag_itemId_fkey', 'AiGraderNfcTag', 'itemId', 'Item', 'id'),
      ('AiGraderNfcTag_aiGraderLabelId_fkey', 'AiGraderNfcTag', 'aiGraderLabelId', 'AiGraderLabel', 'id'),
      ('AiGraderNfcProgrammingAttempt_tagId_fkey', 'AiGraderNfcProgrammingAttempt', 'tagId', 'AiGraderNfcTag', 'id'),
      ('AiGraderNfcAuditEvent_tagId_fkey', 'AiGraderNfcAuditEvent', 'tagId', 'AiGraderNfcTag', 'id'),
      ('AiGraderNfcAuditEvent_attemptId_fkey', 'AiGraderNfcAuditEvent', 'attemptId', 'AiGraderNfcProgrammingAttempt', 'id')
    ) expected(constraint_name, child_table, child_column, parent_table, parent_column)
    LEFT JOIN pg_constraint constraint_object
      ON constraint_object.conname = expected.constraint_name AND constraint_object.contype = 'f'
    LEFT JOIN pg_class child ON child.oid = constraint_object.conrelid AND child.relname = expected.child_table
    LEFT JOIN pg_class parent ON parent.oid = constraint_object.confrelid AND parent.relname = expected.parent_table
    LEFT JOIN pg_attribute child_attribute
      ON child_attribute.attrelid = child.oid AND child_attribute.attnum = constraint_object.conkey[1]
    LEFT JOIN pg_attribute parent_attribute
      ON parent_attribute.attrelid = parent.oid AND parent_attribute.attnum = constraint_object.confkey[1]
   WHERE constraint_object.oid IS NULL
      OR child_attribute.attname::text <> expected.child_column
      OR parent_attribute.attname::text <> expected.parent_column
      OR cardinality(constraint_object.conkey) <> 1
      OR cardinality(constraint_object.confkey) <> 1
      OR constraint_object.confdeltype <> 'r'
      OR constraint_object.confupdtype <> 'c';
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'NFC foreign keys are not exact: % invalid', missing_count;
  END IF;

  WITH expected AS (
    SELECT 'AiGraderNfcTag'::text AS table_name,
           lower(constraint_object.conname::text) AS constraint_name,
           lower(regexp_replace(replace(regexp_replace(
             pg_get_constraintdef(constraint_object.oid, true),
             '::[A-Za-z0-9_.' || chr(34) || ']+', '', 'g'
           ), chr(34), ''), '[[:space:]]+', '', 'g')) AS normalized_definition
      FROM pg_constraint constraint_object
     WHERE constraint_object.contype = 'c'
       AND constraint_object.conrelid = 'pg_temp._AiGraderNfcExpectedTagChecks'::regclass
    UNION ALL
    SELECT 'AiGraderNfcProgrammingAttempt'::text,
           lower(constraint_object.conname::text),
           lower(regexp_replace(replace(regexp_replace(
             pg_get_constraintdef(constraint_object.oid, true),
             '::[A-Za-z0-9_.' || chr(34) || ']+', '', 'g'
           ), chr(34), ''), '[[:space:]]+', '', 'g'))
      FROM pg_constraint constraint_object
     WHERE constraint_object.contype = 'c'
       AND constraint_object.conrelid = 'pg_temp._AiGraderNfcExpectedAttemptChecks'::regclass
    UNION ALL
    SELECT 'AiGraderNfcAuditEvent'::text,
           lower(constraint_object.conname::text),
           lower(regexp_replace(replace(regexp_replace(
             pg_get_constraintdef(constraint_object.oid, true),
             '::[A-Za-z0-9_.' || chr(34) || ']+', '', 'g'
           ), chr(34), ''), '[[:space:]]+', '', 'g'))
      FROM pg_constraint constraint_object
     WHERE constraint_object.contype = 'c'
       AND constraint_object.conrelid = 'pg_temp._AiGraderNfcExpectedAuditChecks'::regclass
  ),
  actual AS (
    SELECT table_object.relname::text AS table_name,
           lower(constraint_object.conname::text) AS constraint_name,
           constraint_object.convalidated AS is_validated,
           lower(regexp_replace(replace(regexp_replace(
             pg_get_constraintdef(constraint_object.oid, true),
             '::[A-Za-z0-9_.' || chr(34) || ']+', '', 'g'
           ), chr(34), ''), '[[:space:]]+', '', 'g')) AS normalized_definition
      FROM pg_constraint constraint_object
      JOIN pg_class table_object ON table_object.oid = constraint_object.conrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_object.relnamespace
     WHERE constraint_object.contype = 'c'
       AND table_namespace.nspname = 'public'
       AND table_object.relname IN (
         'AiGraderNfcTag',
         'AiGraderNfcProgrammingAttempt',
         'AiGraderNfcAuditEvent'
       )
  )
  SELECT count(*) INTO missing_count
    FROM expected
    FULL JOIN actual USING (table_name, constraint_name)
   WHERE expected.constraint_name IS NULL
      OR actual.constraint_name IS NULL
      OR NOT actual.is_validated
      OR actual.normalized_definition IS DISTINCT FROM expected.normalized_definition;
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'NFC check constraints are not exact: % invalid', missing_count;
  END IF;

  SELECT count(*) INTO missing_count
    FROM (VALUES
      ('AiGraderNfcAuditEvent_immutable_update', 'BEFORE UPDATE'),
      ('AiGraderNfcAuditEvent_immutable_delete', 'BEFORE DELETE')
    ) expected(trigger_name, trigger_operation)
    LEFT JOIN pg_trigger trigger_object
      ON trigger_object.tgname = expected.trigger_name
     AND trigger_object.tgrelid = 'public."AiGraderNfcAuditEvent"'::regclass
     AND NOT trigger_object.tgisinternal
    LEFT JOIN pg_proc trigger_function ON trigger_function.oid = trigger_object.tgfoid
   WHERE trigger_object.oid IS NULL
      OR trigger_object.tgenabled <> 'O'
      OR trigger_function.proname <> 'reject_ai_grader_nfc_audit_mutation'
      OR position(expected.trigger_operation in pg_get_triggerdef(trigger_object.oid)) = 0;
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'NFC immutable audit triggers are incomplete: % invalid', missing_count;
  END IF;

  IF (
    SELECT count(*)
      FROM "_prisma_migrations"
     WHERE "migration_name" IN (
       '20260712160000_ai_grader_nfc_static_url_v1',
       '20260716190000_ai_grader_nfc_feiju_profile_enums',
       '20260716190500_ai_grader_nfc_feiju_ios_profile'
     )
       AND "finished_at" IS NOT NULL
       AND "rolled_back_at" IS NULL
       AND "logs" IS NULL
       AND "applied_steps_count" > 0
  ) <> 3 THEN
    RAISE EXCEPTION 'NFC Prisma migration ledger markers are not three clean successes';
  END IF;
END
$ai_grader_nfc_catalog$;

DO $ai_grader_nfc_manual_ios_catalog$
DECLARE
  actual_columns text[];
  missing_count integer;
BEGIN
  SELECT array_agg(a.attname::text ORDER BY a.attnum)
    INTO actual_columns
    FROM pg_attribute a
   WHERE a.attrelid = 'public."AiGraderNfcManualIosAttempt"'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF actual_columns IS DISTINCT FROM ARRAY[
    'id', 'tagId', 'tenantId', 'reportId', 'cardAssetId', 'itemId', 'certId',
    'requestedByUserId', 'idempotencyKeyHash', 'completionIdempotencyKeyHash',
    'state', 'profileVersion', 'qualificationProfile', 'expectedPayloadSha256', 'readbackPayloadSha256',
    'preLockTapObservedAt', 'lockStatusConfirmedAt', 'lockStatusConfirmedByUserId',
    'writeProtectionEvidence', 'postLockTapObservedAt',
    'workstationOperationalAttestation', 'cryptographicTagAuthentication',
    'requestedAt', 'expiresAt', 'failureCode', 'consumedAt', 'createdAt', 'updatedAt'
  ]::text[] THEN
    RAISE EXCEPTION 'AiGraderNfcManualIosAttempt columns differ: %', actual_columns;
  END IF;

  SELECT count(*) INTO missing_count
    FROM (VALUES
      ('AiGraderNfcManualIosAttempt_pkey', true, ARRAY['id']::text[]),
      ('AiGraderNfcManualIosAttempt_request_idempotency_key', true, ARRAY['tenantId', 'requestedByUserId', 'idempotencyKeyHash']::text[]),
      ('AiGraderNfcManualIosAttempt_tagId_state_expiresAt_idx', false, ARRAY['tagId', 'state', 'expiresAt']::text[]),
      ('AiGraderNfcManualIosAttempt_tenantId_reportId_state_idx', false, ARRAY['tenantId', 'reportId', 'state']::text[])
    ) expected(index_name, is_unique, key_columns)
    LEFT JOIN _AiGraderNfcActualIndexes actual
      ON actual.index_name = expected.index_name
     AND actual.table_name = 'AiGraderNfcManualIosAttempt'
   WHERE actual.index_name IS NULL
      OR actual.is_unique IS DISTINCT FROM expected.is_unique
      OR actual.key_columns IS DISTINCT FROM expected.key_columns
      OR NOT actual.is_valid OR NOT actual.is_ready OR NOT actual.is_live
      OR NOT actual.has_no_predicate OR NOT actual.has_no_expressions
      OR NOT actual.has_no_included_columns OR NOT actual.is_not_exclusion
      OR NOT actual.is_index OR NOT actual.is_table OR actual.access_method <> 'btree';
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'Manual iOS NFC ordinary indexes are not exact: % invalid', missing_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM _AiGraderNfcActualIndexes
     WHERE index_name = 'AiGraderNfcManualIosAttempt_one_live_per_tag'
       AND table_name = 'AiGraderNfcManualIosAttempt'
       AND is_unique AND is_valid AND is_ready AND is_live
       AND key_columns = ARRAY['tagId']::text[]
       AND normalized_predicate = 'state=anyarray[''awaiting_prelock_tap'',''awaiting_lock_confirmation'',''awaiting_postlock_tap'',''ready_to_complete'']'
  ) THEN
    RAISE EXCEPTION 'Manual iOS NFC live-attempt index is not exact';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint constraint_object
      JOIN pg_class child ON child.oid = constraint_object.conrelid
      JOIN pg_class parent ON parent.oid = constraint_object.confrelid
     WHERE constraint_object.conname = 'AiGraderNfcManualIosAttempt_tagId_fkey'
       AND constraint_object.contype = 'f'
       AND child.relname = 'AiGraderNfcManualIosAttempt'
       AND parent.relname = 'AiGraderNfcTag'
       AND constraint_object.confdeltype = 'r'
       AND constraint_object.confupdtype = 'c'
       AND constraint_object.convalidated
  ) THEN
    RAISE EXCEPTION 'Manual iOS NFC tag foreign key is not exact';
  END IF;

  SELECT count(*) INTO missing_count
    FROM (VALUES
      ('AiGraderNfcManualIosAttempt_id_shape'),
      ('AiGraderNfcManualIosAttempt_hash_shapes'),
      ('AiGraderNfcManualIosAttempt_profile'),
      ('AiGraderNfcManualIosAttempt_expiry_bound'),
      ('AiGraderNfcManualIosAttempt_state_evidence')
    ) expected(constraint_name)
    LEFT JOIN pg_constraint actual
      ON actual.conname = expected.constraint_name
     AND actual.conrelid = 'public."AiGraderNfcManualIosAttempt"'::regclass
     AND actual.contype = 'c'
     AND actual.convalidated
   WHERE actual.oid IS NULL;
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'Manual iOS NFC check constraints are incomplete: % invalid', missing_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'AiGraderNfcManualIosAttempt'
       AND lower(column_name) IN ('uid', 'rawuid', 'ipaddress', 'phoneidentifier', 'appsecret', 'arbitrarycontent')
  ) THEN
    RAISE EXCEPTION 'Manual iOS NFC table contains forbidden identifying or secret columns';
  END IF;
END
$ai_grader_nfc_manual_ios_catalog$;
INSERT INTO "User" ("id", "role", "createdAt")
VALUES ('nfc-validation-user', 'admin', clock_timestamp());

INSERT INTO "CardBatch" (
  "id", "uploadedById", "totalCount", "processedCount", "status", "updatedAt"
) VALUES (
  'nfc-validation-batch', 'nfc-validation-user', 2, 2, 'READY', clock_timestamp()
);

INSERT INTO "CardAsset" (
  "id", "batchId", "storageKey", "fileName", "fileSize", "mimeType",
  "imageUrl", "status", "updatedAt"
) VALUES
  (
    'nfc-validation-card-1', 'nfc-validation-batch', 'validation/card-1',
    'card-1.jpg', 1, 'image/jpeg', 'https://invalid.local/card-1.jpg',
    'READY', clock_timestamp()
  ),
  (
    'nfc-validation-card-2', 'nfc-validation-batch', 'validation/card-2',
    'card-2.jpg', 1, 'image/jpeg', 'https://invalid.local/card-2.jpg',
    'READY', clock_timestamp()
  );

INSERT INTO "Item" (
  "id", "name", "set", "number", "ownerId", "updatedAt"
) VALUES
  (
    'nfc-validation-item-1', 'Disposable NFC validation card 1',
    'Disposable NFC validation set', 'nfc-validation-card-1',
    'nfc-validation-user', clock_timestamp()
  ),
  (
    'nfc-validation-item-2', 'Disposable NFC validation card 2',
    'Disposable NFC validation set', 'nfc-validation-card-2',
    'nfc-validation-user', clock_timestamp()
  );

INSERT INTO "AiGraderSession" (
  "id", "tenantId", "gradingSessionId", "reportId", "cardAssetId",
  "itemId", "status", "updatedAt"
) VALUES
  (
    'nfc-validation-session-1', 'nfc-validation-tenant',
    'nfc-validation-grading-session-1', 'nfc-validation-report-1',
    'nfc-validation-card-1', 'nfc-validation-item-1', 'published',
    clock_timestamp()
  ),
  (
    'nfc-validation-session-2', 'nfc-validation-tenant',
    'nfc-validation-grading-session-2', 'nfc-validation-report-2',
    'nfc-validation-card-2', 'nfc-validation-item-2', 'published',
    clock_timestamp()
  );

INSERT INTO "AiGraderReport" (
  "id", "tenantId", "sessionId", "reportId", "reportStatus",
  "finalGradeStatus", "visibilityStatus", "publicationStatus",
  "cardAssetId", "itemId", "finalOverallGrade", "publishedAt", "updatedAt"
) VALUES
  (
    'nfc-validation-report-row-1', 'nfc-validation-tenant',
    'nfc-validation-session-1', 'nfc-validation-report-1', 'finalized',
    'computed', 'public', 'published', 'nfc-validation-card-1',
    'nfc-validation-item-1', 9.0, clock_timestamp(), clock_timestamp()
  ),
  (
    'nfc-validation-report-row-2', 'nfc-validation-tenant',
    'nfc-validation-session-2', 'nfc-validation-report-2', 'finalized',
    'computed', 'public', 'published', 'nfc-validation-card-2',
    'nfc-validation-item-2', 8.0, clock_timestamp(), clock_timestamp()
  );

INSERT INTO "AiGraderLabel" (
  "id", "tenantId", "sessionId", "reportId", "certId", "qrPayloadUrl",
  "publicReportUrl", "labelGradeText", "payload", "updatedAt"
) VALUES
  (
    'nfc-validation-label-1', 'nfc-validation-tenant',
    'nfc-validation-session-1', 'nfc-validation-report-row-1',
    'NFC-VALIDATION-CERT-1', 'https://invalid.local/qr/1',
    'https://invalid.local/report/1', '9', '{"validation":true}'::jsonb,
    clock_timestamp()
  ),
  (
    'nfc-validation-label-2', 'nfc-validation-tenant',
    'nfc-validation-session-2', 'nfc-validation-report-row-2',
    'NFC-VALIDATION-CERT-2', 'https://invalid.local/qr/2',
    'https://invalid.local/report/2', '8', '{"validation":true}'::jsonb,
    clock_timestamp()
  );

INSERT INTO "AiGraderNfcTag" (
  "id", "tenantId", "publicTagId", "chipType", "securityMode", "status",
  "ndefPayloadVersion", "expectedPayloadSha256", "aiGraderReportId",
  "reportId", "cardAssetId", "itemId", "aiGraderLabelId", "certId",
  "createdByUserId", "metadata", "updatedAt"
) VALUES (
  'nfc-validation-tag-1', 'nfc-validation-tenant',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'NTAG215', 'static_url_v1',
  'reserved', 1, repeat('a', 64), 'nfc-validation-report-row-1',
  'nfc-validation-report-1', 'nfc-validation-card-1',
  'nfc-validation-item-1', 'nfc-validation-label-1',
  'NFC-VALIDATION-CERT-1', 'nfc-validation-operator',
  '{"schemaVersion":"ai-grader-nfc-safe-metadata-v1"}'::jsonb,
  clock_timestamp()
);

DO $ai_grader_nfc_tag_checks$
DECLARE
  failed_constraint text;
BEGIN
  BEGIN
    INSERT INTO "AiGraderNfcTag" (
      "id", "tenantId", "publicTagId", "chipType", "securityMode", "status",
      "ndefPayloadVersion", "expectedPayloadSha256", "aiGraderReportId",
      "reportId", "cardAssetId", "itemId", "aiGraderLabelId", "certId",
      "createdByUserId", "errorCode", "updatedAt"
    ) VALUES (
      'nfc-validation-bad-public-id', 'nfc-validation-tenant', 'short',
      'NTAG215', 'static_url_v1', 'error', 1, repeat('a', 64),
      'nfc-validation-report-row-1', 'nfc-validation-report-1',
      'nfc-validation-card-1', 'nfc-validation-item-1',
      'nfc-validation-label-1', 'NFC-VALIDATION-CERT-1',
      'nfc-validation-operator', 'VALIDATION', clock_timestamp()
    );
    RAISE EXCEPTION 'malformed publicTagId was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'AiGraderNfcTag_public_id_shape' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "AiGraderNfcTag" (
      "id", "tenantId", "publicTagId", "chipType", "securityMode", "status",
      "ndefPayloadVersion", "expectedPayloadSha256", "aiGraderReportId",
      "reportId", "cardAssetId", "itemId", "aiGraderLabelId", "certId",
      "createdByUserId", "errorCode", "updatedAt"
    ) VALUES (
      'nfc-validation-bad-strategy', 'nfc-validation-tenant',
      'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'NTAG424_DNA', 'static_url_v1',
      'error', 1, repeat('a', 64), 'nfc-validation-report-row-1',
      'nfc-validation-report-1', 'nfc-validation-card-1',
      'nfc-validation-item-1', 'nfc-validation-label-1',
      'NFC-VALIDATION-CERT-1', 'nfc-validation-operator', 'VALIDATION',
      clock_timestamp()
    );
    RAISE EXCEPTION 'invalid chip/security strategy pair was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'AiGraderNfcTag_strategy_pair' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "AiGraderNfcTag" (
      "id", "tenantId", "publicTagId", "chipType", "securityMode", "status",
      "ndefPayloadVersion", "expectedPayloadSha256", "aiGraderReportId",
      "reportId", "cardAssetId", "itemId", "aiGraderLabelId", "certId",
      "createdByUserId", "activatedByUserId", "activatedAt", "updatedAt"
    ) VALUES (
      'nfc-validation-active-without-evidence', 'nfc-validation-tenant',
      'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', 'NTAG215', 'static_url_v1',
      'active', 1, repeat('a', 64), 'nfc-validation-report-row-2',
      'nfc-validation-report-2', 'nfc-validation-card-2',
      'nfc-validation-item-2', 'nfc-validation-label-2',
      'NFC-VALIDATION-CERT-2', 'nfc-validation-operator',
      'nfc-validation-operator', clock_timestamp(), clock_timestamp()
    );
    RAISE EXCEPTION 'active tag without verification evidence was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'AiGraderNfcTag_verified_evidence' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "AiGraderNfcTag" (
      "id", "tenantId", "publicTagId", "chipType", "securityMode", "status",
      "ndefPayloadVersion", "expectedPayloadSha256", "aiGraderReportId",
      "reportId", "cardAssetId", "itemId", "aiGraderLabelId", "certId",
      "createdByUserId", "revokedByUserId", "revokedAt", "updatedAt"
    ) VALUES (
      'nfc-validation-revoked-without-reason', 'nfc-validation-tenant',
      'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', 'NTAG215', 'static_url_v1',
      'revoked', 1, repeat('a', 64), 'nfc-validation-report-row-2',
      'nfc-validation-report-2', 'nfc-validation-card-2',
      'nfc-validation-item-2', 'nfc-validation-label-2',
      'NFC-VALIDATION-CERT-2', 'nfc-validation-operator',
      'nfc-validation-operator', clock_timestamp(), clock_timestamp()
    );
    RAISE EXCEPTION 'revoked tag without reason was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'AiGraderNfcTag_revocation_required' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "AiGraderNfcTag" (
      "id", "tenantId", "publicTagId", "chipType", "securityMode", "status",
      "ndefPayloadVersion", "expectedPayloadSha256", "aiGraderReportId",
      "reportId", "cardAssetId", "itemId", "aiGraderLabelId", "certId",
      "createdByUserId", "errorCode", "metadata", "updatedAt"
    ) VALUES (
      'nfc-validation-oversized-metadata', 'nfc-validation-tenant',
      'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE', 'NTAG215', 'static_url_v1',
      'error', 1, repeat('a', 64), 'nfc-validation-report-row-2',
      'nfc-validation-report-2', 'nfc-validation-card-2',
      'nfc-validation-item-2', 'nfc-validation-label-2',
      'NFC-VALIDATION-CERT-2', 'nfc-validation-operator', 'VALIDATION',
      jsonb_build_object('value', repeat('x', 5000)), clock_timestamp()
    );
    RAISE EXCEPTION 'oversized NFC tag metadata was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'AiGraderNfcTag_metadata_bound' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "AiGraderNfcTag" (
      "id", "tenantId", "publicTagId", "chipType", "securityMode", "status",
      "ndefPayloadVersion", "expectedPayloadSha256", "aiGraderReportId",
      "reportId", "cardAssetId", "itemId", "aiGraderLabelId", "certId",
      "createdByUserId", "errorCode", "updatedAt"
    ) VALUES (
      'nfc-validation-bad-report-fk', 'nfc-validation-tenant',
      'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', 'NTAG215', 'static_url_v1',
      'error', 1, repeat('a', 64), 'nfc-validation-report-row-absent',
      'nfc-validation-report-1', 'nfc-validation-card-1',
      'nfc-validation-item-1', 'nfc-validation-label-1',
      'NFC-VALIDATION-CERT-1', 'nfc-validation-operator', 'VALIDATION',
      clock_timestamp()
    );
    RAISE EXCEPTION 'invalid report foreign key was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'AiGraderNfcTag_aiGraderReportId_fkey' THEN RAISE; END IF;
  END;
END
$ai_grader_nfc_tag_checks$;

DO $ai_grader_nfc_open_uniqueness$
DECLARE
  failed_constraint text;
BEGIN
  BEGIN
    INSERT INTO "AiGraderNfcTag" (
      "id", "tenantId", "publicTagId", "status", "expectedPayloadSha256",
      "aiGraderReportId", "reportId", "cardAssetId", "itemId",
      "aiGraderLabelId", "certId", "createdByUserId", "updatedAt"
    ) VALUES (
      'nfc-validation-duplicate-report', 'nfc-validation-tenant',
      'GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG', 'reserved', repeat('a', 64),
      'nfc-validation-report-row-1', 'nfc-validation-report-1',
      'nfc-validation-card-2', 'nfc-validation-item-2',
      'nfc-validation-label-1', 'NFC-VALIDATION-CERT-1',
      'nfc-validation-operator', clock_timestamp()
    );
    RAISE EXCEPTION 'duplicate open report was accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'AiGraderNfcTag_one_open_report' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "AiGraderNfcTag" (
      "id", "tenantId", "publicTagId", "status", "expectedPayloadSha256",
      "aiGraderReportId", "reportId", "cardAssetId", "itemId",
      "aiGraderLabelId", "certId", "createdByUserId", "updatedAt"
    ) VALUES (
      'nfc-validation-duplicate-card', 'nfc-validation-tenant',
      'HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH', 'reserved', repeat('a', 64),
      'nfc-validation-report-row-2', 'nfc-validation-report-2',
      'nfc-validation-card-1', 'nfc-validation-item-2',
      'nfc-validation-label-2', 'NFC-VALIDATION-CERT-2',
      'nfc-validation-operator', clock_timestamp()
    );
    RAISE EXCEPTION 'duplicate open card was accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'AiGraderNfcTag_one_open_card' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "AiGraderNfcTag" (
      "id", "tenantId", "publicTagId", "status", "expectedPayloadSha256",
      "aiGraderReportId", "reportId", "cardAssetId", "itemId",
      "aiGraderLabelId", "certId", "createdByUserId", "updatedAt"
    ) VALUES (
      'nfc-validation-duplicate-item', 'nfc-validation-tenant',
      'IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII', 'reserved', repeat('a', 64),
      'nfc-validation-report-row-2', 'nfc-validation-report-2',
      'nfc-validation-card-2', 'nfc-validation-item-1',
      'nfc-validation-label-2', 'NFC-VALIDATION-CERT-2',
      'nfc-validation-operator', clock_timestamp()
    );
    RAISE EXCEPTION 'duplicate open item was accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'AiGraderNfcTag_one_open_item' THEN RAISE; END IF;
  END;
END
$ai_grader_nfc_open_uniqueness$;

DO $ai_grader_nfc_attempt_checks$
DECLARE
  failed_constraint text;
BEGIN
  BEGIN
    INSERT INTO "AiGraderNfcProgrammingAttempt" (
      "id", "tagId", "tenantId", "reportId", "cardAssetId", "itemId",
      "certId", "requestedByUserId", "idempotencyKeyHash", "tokenHash",
      "attestationChallengeHash", "expectedAttestationAlgorithm", "state",
      "requestedAt", "expiresAt", "updatedAt"
    ) VALUES (
      'nfc_attempt_' || repeat('B', 43), 'nfc-validation-tag-1',
      'nfc-validation-tenant', 'nfc-validation-report-1',
      'nfc-validation-card-1', 'nfc-validation-item-1',
      'NFC-VALIDATION-CERT-1', 'nfc-validation-operator',
      repeat('1', 64), repeat('2', 64), repeat('3', 64),
      'ecdsa-p256-sha256-p1363', 'initialized',
      clock_timestamp(), clock_timestamp() + interval '31 minutes',
      clock_timestamp()
    );
    RAISE EXCEPTION 'attempt expiry beyond thirty minutes was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'AiGraderNfcProgrammingAttempt_expiry_bound' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "AiGraderNfcProgrammingAttempt" (
      "id", "tagId", "tenantId", "reportId", "cardAssetId", "itemId",
      "certId", "requestedByUserId", "idempotencyKeyHash",
      "completionIdempotencyKeyHash", "tokenHash",
      "attestationChallengeHash", "expectedAttestationAlgorithm",
      "completedWorkstationKeyId", "state", "requestedAt", "expiresAt",
      "readbackEvidence", "consumedAt", "updatedAt"
    ) VALUES (
      'nfc_attempt_' || repeat('C', 43), 'nfc-validation-tag-1',
      'nfc-validation-tenant', 'nfc-validation-report-1',
      'nfc-validation-card-1', 'nfc-validation-item-1',
      'NFC-VALIDATION-CERT-1', 'nfc-validation-operator',
      repeat('4', 64), repeat('5', 64), repeat('6', 64), repeat('7', 64),
      'ecdsa-p256-sha256-p1363', repeat('8', 64), 'consumed',
      clock_timestamp(), clock_timestamp() + interval '5 minutes',
      '{}'::jsonb, clock_timestamp(), clock_timestamp()
    );
    RAISE EXCEPTION 'malformed readback evidence was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'AiGraderNfcProgrammingAttempt_attestation_evidence' THEN RAISE; END IF;
  END;
END
$ai_grader_nfc_attempt_checks$;

DO $ai_grader_nfc_database_lifecycle$
DECLARE
  lifecycle_time timestamp := timestamp '2026-07-13 12:00:00';
  evidence jsonb;
  failed_constraint text;
  failed_message text;
BEGIN
  evidence := jsonb_build_object(
    'schemaVersion', 'ai-grader-nfc-helper-attestation-v1',
    'workstationKeyId', repeat('8', 64),
    'algorithm', 'ecdsa-p256-sha256-p1363',
    'statementSha256', repeat('9', 64),
    'signature', repeat('A', 86),
    'observedAt', '2026-07-13T12:00:05.000Z',
    'helperProtocolVersion', 'tenkings-ai-grader-nfc-loopback-v2',
    'readerResultCode', 'write_verified_pcsc_readback',
    'cryptographicTagAuthentication', false,
    'workstationOperationalAttestation', true
  );

  INSERT INTO "AiGraderNfcAuditEvent" (
    "id", "tagId", "tenantId", "reportId", "action", "toStatus",
    "actorUserId", "safeDetails", "createdAt"
  ) VALUES (
    'nfc-validation-audit-reserve', 'nfc-validation-tag-1',
    'nfc-validation-tenant', 'nfc-validation-report-1', 'reserve',
    'reserved', 'nfc-validation-operator',
    '{"validation":true}'::jsonb, lifecycle_time
  );

  UPDATE "AiGraderNfcTag"
     SET "status" = 'programming',
         "updatedAt" = lifecycle_time
   WHERE "id" = 'nfc-validation-tag-1';

  INSERT INTO "AiGraderNfcProgrammingAttempt" (
    "id", "tagId", "tenantId", "reportId", "cardAssetId", "itemId",
    "certId", "requestedByUserId", "idempotencyKeyHash", "tokenHash",
    "attestationChallengeHash", "expectedAttestationAlgorithm", "state",
    "requestedAt", "expiresAt", "createdAt", "updatedAt"
  ) VALUES (
    'nfc_attempt_' || repeat('A', 43), 'nfc-validation-tag-1',
    'nfc-validation-tenant', 'nfc-validation-report-1',
    'nfc-validation-card-1', 'nfc-validation-item-1',
    'NFC-VALIDATION-CERT-1', 'nfc-validation-operator',
    repeat('a', 64), repeat('b', 64), repeat('c', 64),
    'ecdsa-p256-sha256-p1363', 'initialized',
    lifecycle_time, lifecycle_time + interval '5 minutes',
    lifecycle_time, lifecycle_time
  );

  UPDATE "AiGraderNfcProgrammingAttempt"
     SET "state" = 'writing', "updatedAt" = lifecycle_time + interval '1 second'
   WHERE "id" = 'nfc_attempt_' || repeat('A', 43);

  BEGIN
    INSERT INTO "AiGraderNfcProgrammingAttempt" (
      "id", "tagId", "tenantId", "reportId", "cardAssetId", "itemId",
      "certId", "requestedByUserId", "idempotencyKeyHash", "tokenHash",
      "attestationChallengeHash", "expectedAttestationAlgorithm", "state",
      "requestedAt", "expiresAt", "updatedAt"
    ) VALUES (
      'nfc_attempt_' || repeat('D', 43), 'nfc-validation-tag-1',
      'nfc-validation-tenant', 'nfc-validation-report-1',
      'nfc-validation-card-1', 'nfc-validation-item-1',
      'NFC-VALIDATION-CERT-1', 'nfc-validation-operator',
      repeat('d', 64), repeat('e', 64), repeat('f', 64),
      'ecdsa-p256-sha256-p1363', 'initialized',
      lifecycle_time, lifecycle_time + interval '5 minutes', lifecycle_time
    );
    RAISE EXCEPTION 'second live attempt for one tag was accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'AiGraderNfcProgrammingAttempt_one_live_per_tag' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "AiGraderNfcProgrammingAttempt" (
      "id", "tagId", "tenantId", "reportId", "cardAssetId", "itemId",
      "certId", "requestedByUserId", "idempotencyKeyHash", "tokenHash",
      "attestationChallengeHash", "expectedAttestationAlgorithm", "state",
      "requestedAt", "expiresAt", "failureCode", "updatedAt"
    ) VALUES (
      'nfc_attempt_' || repeat('E', 43), 'nfc-validation-tag-1',
      'nfc-validation-tenant', 'nfc-validation-report-1',
      'nfc-validation-card-1', 'nfc-validation-item-1',
      'NFC-VALIDATION-CERT-1', 'nfc-validation-operator',
      repeat('a', 64), repeat('d', 64), repeat('e', 64),
      'ecdsa-p256-sha256-p1363', 'failed',
      lifecycle_time, lifecycle_time + interval '5 minutes',
      'VALIDATION_FAILURE', lifecycle_time
    );
    RAISE EXCEPTION 'duplicate attempt idempotency key was accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <>
       'AiGraderNfcAttempt_request_idempotency_key' THEN
      RAISE;
    END IF;
  END;

  UPDATE "AiGraderNfcTag"
     SET "status" = 'verified',
         "uidFingerprintSha256" = repeat('e', 64),
         "readbackPayloadSha256" = repeat('a', 64),
         "programmedByUserId" = 'nfc-validation-operator',
         "verifiedByUserId" = 'nfc-validation-operator',
         "programmedAt" = lifecycle_time + interval '2 seconds',
         "verifiedAt" = lifecycle_time + interval '2 seconds',
         "updatedAt" = lifecycle_time + interval '2 seconds'
   WHERE "id" = 'nfc-validation-tag-1';

  UPDATE "AiGraderNfcProgrammingAttempt"
     SET "state" = 'verified',
         "completionIdempotencyKeyHash" = repeat('f', 64),
         "completedWorkstationKeyId" = repeat('8', 64),
         "readbackEvidence" = evidence,
         "updatedAt" = lifecycle_time + interval '2 seconds'
   WHERE "id" = 'nfc_attempt_' || repeat('A', 43);

  INSERT INTO "AiGraderNfcAuditEvent" (
    "id", "tagId", "attemptId", "tenantId", "reportId", "action",
    "fromStatus", "toStatus", "actorUserId", "safeDetails", "createdAt"
  ) VALUES (
    'nfc-validation-audit-verified', 'nfc-validation-tag-1',
    'nfc_attempt_' || repeat('A', 43), 'nfc-validation-tenant',
    'nfc-validation-report-1', 'local_pcsc_readback_verified',
    'programming', 'verified', 'nfc-validation-operator',
    evidence, lifecycle_time + interval '2 seconds'
  );

  UPDATE "AiGraderNfcTag"
     SET "status" = 'active',
         "activatedByUserId" = 'nfc-validation-operator',
         "activatedAt" = lifecycle_time + interval '3 seconds',
         "updatedAt" = lifecycle_time + interval '3 seconds'
   WHERE "id" = 'nfc-validation-tag-1';

  UPDATE "AiGraderNfcProgrammingAttempt"
     SET "state" = 'consumed',
         "consumedAt" = lifecycle_time + interval '3 seconds',
         "updatedAt" = lifecycle_time + interval '3 seconds'
   WHERE "id" = 'nfc_attempt_' || repeat('A', 43);

  INSERT INTO "AiGraderNfcAuditEvent" (
    "id", "tagId", "attemptId", "tenantId", "reportId", "action",
    "fromStatus", "toStatus", "actorUserId", "safeDetails", "createdAt"
  ) VALUES (
    'nfc-validation-audit-active', 'nfc-validation-tag-1',
    'nfc_attempt_' || repeat('A', 43), 'nfc-validation-tenant',
    'nfc-validation-report-1', 'activate_registered_link',
    'verified', 'active', 'nfc-validation-operator',
    '{"registrationKind":"registered_link","cryptographicTagAuthentication":false}'::jsonb,
    lifecycle_time + interval '3 seconds'
  );

  IF NOT EXISTS (
    SELECT 1
      FROM "AiGraderNfcTag"
     WHERE "id" = 'nfc-validation-tag-1'
       AND "status" = 'active'
       AND "uidFingerprintSha256" = repeat('e', 64)
       AND "activatedAt" IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1
      FROM "AiGraderNfcProgrammingAttempt"
     WHERE "id" = 'nfc_attempt_' || repeat('A', 43)
       AND "state" = 'consumed'
       AND "readbackEvidence" = evidence
       AND "consumedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'valid verified/active NFC lifecycle did not persist';
  END IF;

  BEGIN
    INSERT INTO "AiGraderNfcTag" (
      "id", "tenantId", "publicTagId", "status", "uidFingerprintSha256",
      "expectedPayloadSha256", "readbackPayloadSha256", "aiGraderReportId",
      "reportId", "cardAssetId", "itemId", "aiGraderLabelId", "certId",
      "createdByUserId", "programmedByUserId", "verifiedByUserId",
      "activatedByUserId", "programmedAt", "verifiedAt", "activatedAt", "updatedAt"
    ) VALUES (
      'nfc-validation-duplicate-active-uid', 'nfc-validation-tenant',
      'JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ', 'active', repeat('e', 64),
      repeat('a', 64), repeat('a', 64), 'nfc-validation-report-row-2',
      'nfc-validation-report-2', 'nfc-validation-card-2',
      'nfc-validation-item-2', 'nfc-validation-label-2',
      'NFC-VALIDATION-CERT-2', 'nfc-validation-operator',
      'nfc-validation-operator', 'nfc-validation-operator',
      'nfc-validation-operator', lifecycle_time, lifecycle_time,
      lifecycle_time, lifecycle_time
    );
    RAISE EXCEPTION 'duplicate active UID fingerprint was accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'AiGraderNfcTag_one_active_uid' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO "AiGraderNfcAuditEvent" (
      "id", "tagId", "tenantId", "reportId", "action", "actorUserId",
      "safeDetails", "createdAt"
    ) VALUES (
      'nfc-validation-audit-oversized', 'nfc-validation-tag-1',
      'nfc-validation-tenant', 'nfc-validation-report-1',
      'validation_oversized_details', 'nfc-validation-operator',
      jsonb_build_object('value', repeat('x', 5000)), lifecycle_time
    );
    RAISE EXCEPTION 'oversized NFC audit details were accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint <> 'AiGraderNfcAuditEvent_details_bound' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE "AiGraderNfcAuditEvent"
       SET "action" = 'mutated'
     WHERE "id" = 'nfc-validation-audit-active';
    RAISE EXCEPTION 'immutable NFC audit update was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS failed_message = MESSAGE_TEXT;
    IF failed_message <> 'AiGraderNfcAuditEvent rows are immutable' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM "AiGraderNfcAuditEvent"
     WHERE "id" = 'nfc-validation-audit-active';
    RAISE EXCEPTION 'immutable NFC audit delete was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS failed_message = MESSAGE_TEXT;
    IF failed_message <> 'AiGraderNfcAuditEvent rows are immutable' THEN RAISE; END IF;
  END;

  UPDATE "AiGraderNfcTag"
     SET "status" = 'revoked',
         "revokedByUserId" = 'nfc-validation-operator',
         "revokedAt" = lifecycle_time + interval '4 seconds',
         "revocationReason" = 'Disposable database lifecycle replacement',
         "updatedAt" = lifecycle_time + interval '4 seconds'
   WHERE "id" = 'nfc-validation-tag-1';

  INSERT INTO "AiGraderNfcAuditEvent" (
    "id", "tagId", "tenantId", "reportId", "action", "fromStatus",
    "toStatus", "actorUserId", "reasonCode", "createdAt"
  ) VALUES (
    'nfc-validation-audit-revoked', 'nfc-validation-tag-1',
    'nfc-validation-tenant', 'nfc-validation-report-1', 'revoke',
    'active', 'revoked', 'nfc-validation-operator',
    'AI_GRADER_NFC_REPLACED', lifecycle_time + interval '4 seconds'
  );

  INSERT INTO "AiGraderNfcTag" (
    "id", "tenantId", "publicTagId", "status", "expectedPayloadSha256",
    "aiGraderReportId", "reportId", "cardAssetId", "itemId",
    "aiGraderLabelId", "certId", "createdByUserId", "updatedAt"
  ) VALUES (
    'nfc-validation-replacement-tag', 'nfc-validation-tenant',
    'KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK', 'reserved', repeat('b', 64),
    'nfc-validation-report-row-1', 'nfc-validation-report-1',
    'nfc-validation-card-1', 'nfc-validation-item-1',
    'nfc-validation-label-1', 'NFC-VALIDATION-CERT-1',
    'nfc-validation-operator', lifecycle_time + interval '5 seconds'
  );

  IF (SELECT "status" FROM "AiGraderNfcTag" WHERE "id" = 'nfc-validation-tag-1') <> 'revoked'
     OR (SELECT "status" FROM "AiGraderNfcTag" WHERE "id" = 'nfc-validation-replacement-tag') <> 'reserved'
     OR (SELECT count(*) FROM "AiGraderNfcAuditEvent" WHERE "id" = 'nfc-validation-audit-active') <> 1 THEN
    RAISE EXCEPTION 'revoke-before-replacement or immutable audit lifecycle failed';
  END IF;
END
$ai_grader_nfc_database_lifecycle$;

ROLLBACK;

\echo AI_GRADER_NFC_MIGRATION_VALIDATION_PASS
