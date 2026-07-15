/**
 * Runtime NFC schema detection is deliberately separate from Prisma model
 * access. The NFC migration may be absent while Finish and public reports run.
 */

export const AI_GRADER_NFC_SCHEMA_UNAVAILABLE_CODE = "AI_GRADER_NFC_SCHEMA_UNAVAILABLE" as const;

export type AiGraderNfcSchemaReadiness = { ready: boolean };

export const AI_GRADER_NFC_SCHEMA_READY_CACHE_TTL_MS = 15_000;
export const AI_GRADER_NFC_SCHEMA_UNAVAILABLE_CACHE_TTL_MS = 2_000;

type DbClient = {
  $queryRaw?: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
};
type JsonRecord = Record<string, unknown>;
type SchemaReadinessCacheEntry = {
  expiresAt: number;
  result?: AiGraderNfcSchemaReadiness;
  inFlight?: Promise<AiGraderNfcSchemaReadiness>;
};

const schemaReadinessCache = new WeakMap<object, SchemaReadinessCacheEntry>();

const NFC_TABLE_NAMES = [
  "AiGraderNfcTag",
  "AiGraderNfcProgrammingAttempt",
  "AiGraderNfcAuditEvent",
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

/** Narrowly classify only missing NFC tables; never mask other DB failures. */
export function isAiGraderNfcSchemaMissingError(error: unknown) {
  if (!isRecord(error)) return false;
  const code = text(error.code);
  const meta = isRecord(error.meta) ? error.meta : undefined;
  const cause = isRecord(error.cause) ? error.cause : undefined;
  const tableEvidence = [
    text(meta?.table),
    text(meta?.modelName),
    text(cause?.table),
    text(error.table),
  ].join("\n");
  const namesNfcTable = NFC_TABLE_NAMES.some((name) => tableEvidence.includes(name));
  if ((code === "P2021" || code === "42P01") && namesNfcTable) return true;
  const rawMessage = text(meta?.message);
  const quote = String.fromCharCode(34);
  const namesExactRawNfcRelation = NFC_TABLE_NAMES.some((name) =>
    rawMessage.includes(`relation ${quote}${name}${quote} does not exist`) ||
    rawMessage.includes(`relation ${quote}public.${name}${quote} does not exist`));
  return code === "P2010" && text(meta?.code) === "42P01" && namesExactRawNfcRelation;
}

/**
 * Verify all three tables and the columns used by the hosted lifecycle. The
 * SQL is constant. `to_regclass` makes an unapplied migration a normal false
 * result; query failures propagate as unexpected database failures.
 */
export async function readAiGraderNfcSchemaReadiness(
  dbClient: DbClient,
): Promise<AiGraderNfcSchemaReadiness> {
  if (!dbClient || typeof dbClient.$queryRaw !== "function") {
    throw new Error("NFC schema readiness query is unavailable.");
  }
  const presenceRows = await dbClient.$queryRaw`
    SELECT
      to_regclass('public."_prisma_migrations"') IS NOT NULL AS "migrationLedgerReady",
      to_regclass('public."AiGraderNfcTag"') IS NOT NULL AS "tagTableReady",
      to_regclass('public."AiGraderNfcProgrammingAttempt"') IS NOT NULL AS "attemptTableReady",
      to_regclass('public."AiGraderNfcAuditEvent"') IS NOT NULL AS "auditTableReady"
  `;
  const presence = Array.isArray(presenceRows) && isRecord(presenceRows[0]) ? presenceRows[0] : undefined;
  if (!presence ||
      typeof presence.migrationLedgerReady !== "boolean" ||
      typeof presence.tagTableReady !== "boolean" ||
      typeof presence.attemptTableReady !== "boolean" ||
      typeof presence.auditTableReady !== "boolean") {
    throw new Error("NFC schema presence query returned an invalid result.");
  }
  if (!presence.migrationLedgerReady || !presence.tagTableReady || !presence.attemptTableReady || !presence.auditTableReady) {
    return { ready: false };
  }

  const rows = await dbClient.$queryRaw`
    WITH expected_columns("tableName", "columnName") AS (
      VALUES
        ('AiGraderNfcTag', 'id'),
        ('AiGraderNfcTag', 'tenantId'),
        ('AiGraderNfcTag', 'publicTagId'),
        ('AiGraderNfcTag', 'chipType'),
        ('AiGraderNfcTag', 'securityMode'),
        ('AiGraderNfcTag', 'status'),
        ('AiGraderNfcTag', 'uidFingerprintSha256'),
        ('AiGraderNfcTag', 'ndefPayloadVersion'),
        ('AiGraderNfcTag', 'expectedPayloadSha256'),
        ('AiGraderNfcTag', 'readbackPayloadSha256'),
        ('AiGraderNfcTag', 'aiGraderReportId'),
        ('AiGraderNfcTag', 'reportId'),
        ('AiGraderNfcTag', 'cardAssetId'),
        ('AiGraderNfcTag', 'itemId'),
        ('AiGraderNfcTag', 'aiGraderLabelId'),
        ('AiGraderNfcTag', 'certId'),
        ('AiGraderNfcTag', 'createdByUserId'),
        ('AiGraderNfcTag', 'programmedByUserId'),
        ('AiGraderNfcTag', 'verifiedByUserId'),
        ('AiGraderNfcTag', 'activatedByUserId'),
        ('AiGraderNfcTag', 'revokedByUserId'),
        ('AiGraderNfcTag', 'programmedAt'),
        ('AiGraderNfcTag', 'verifiedAt'),
        ('AiGraderNfcTag', 'activatedAt'),
        ('AiGraderNfcTag', 'revokedAt'),
        ('AiGraderNfcTag', 'revocationReason'),
        ('AiGraderNfcTag', 'errorCode'),
        ('AiGraderNfcTag', 'metadata'),
        ('AiGraderNfcTag', 'createdAt'),
        ('AiGraderNfcTag', 'updatedAt'),
        ('AiGraderNfcProgrammingAttempt', 'id'),
        ('AiGraderNfcProgrammingAttempt', 'tagId'),
        ('AiGraderNfcProgrammingAttempt', 'tenantId'),
        ('AiGraderNfcProgrammingAttempt', 'reportId'),
        ('AiGraderNfcProgrammingAttempt', 'cardAssetId'),
        ('AiGraderNfcProgrammingAttempt', 'itemId'),
        ('AiGraderNfcProgrammingAttempt', 'certId'),
        ('AiGraderNfcProgrammingAttempt', 'requestedByUserId'),
        ('AiGraderNfcProgrammingAttempt', 'idempotencyKeyHash'),
        ('AiGraderNfcProgrammingAttempt', 'completionIdempotencyKeyHash'),
        ('AiGraderNfcProgrammingAttempt', 'tokenHash'),
        ('AiGraderNfcProgrammingAttempt', 'attestationChallengeHash'),
        ('AiGraderNfcProgrammingAttempt', 'expectedAttestationAlgorithm'),
        ('AiGraderNfcProgrammingAttempt', 'completedWorkstationKeyId'),
        ('AiGraderNfcProgrammingAttempt', 'state'),
        ('AiGraderNfcProgrammingAttempt', 'requestedAt'),
        ('AiGraderNfcProgrammingAttempt', 'expiresAt'),
        ('AiGraderNfcProgrammingAttempt', 'failureCode'),
        ('AiGraderNfcProgrammingAttempt', 'readbackEvidence'),
        ('AiGraderNfcProgrammingAttempt', 'consumedAt'),
        ('AiGraderNfcProgrammingAttempt', 'createdAt'),
        ('AiGraderNfcProgrammingAttempt', 'updatedAt'),
        ('AiGraderNfcAuditEvent', 'id'),
        ('AiGraderNfcAuditEvent', 'tagId'),
        ('AiGraderNfcAuditEvent', 'attemptId'),
        ('AiGraderNfcAuditEvent', 'tenantId'),
        ('AiGraderNfcAuditEvent', 'reportId'),
        ('AiGraderNfcAuditEvent', 'action'),
        ('AiGraderNfcAuditEvent', 'fromStatus'),
        ('AiGraderNfcAuditEvent', 'toStatus'),
        ('AiGraderNfcAuditEvent', 'actorUserId'),
        ('AiGraderNfcAuditEvent', 'reasonCode'),
        ('AiGraderNfcAuditEvent', 'safeDetails'),
        ('AiGraderNfcAuditEvent', 'createdAt')
    ),
    expected_indexes("indexName", "tableName", "keyColumns", "normalizedPredicate") AS (
      VALUES
        ('AiGraderNfcTag_publicTagId_key', 'AiGraderNfcTag', ARRAY['publicTagId']::text[], NULL::text),
        ('AiGraderNfcProgrammingAttempt_tokenHash_key', 'AiGraderNfcProgrammingAttempt', ARRAY['tokenHash']::text[], NULL::text),
        ('AiGraderNfcAttempt_request_idempotency_key', 'AiGraderNfcProgrammingAttempt', ARRAY['tenantId', 'requestedByUserId', 'idempotencyKeyHash']::text[], NULL::text),
        ('AiGraderNfcTag_one_open_report', 'AiGraderNfcTag', ARRAY['tenantId', 'aiGraderReportId']::text[], 'status=anyarray[''reserved'',''programming'',''verified'',''active'']'),
        ('AiGraderNfcTag_one_open_card', 'AiGraderNfcTag', ARRAY['tenantId', 'cardAssetId']::text[], 'status=anyarray[''reserved'',''programming'',''verified'',''active'']'),
        ('AiGraderNfcTag_one_open_item', 'AiGraderNfcTag', ARRAY['tenantId', 'itemId']::text[], 'status=anyarray[''reserved'',''programming'',''verified'',''active'']'),
        ('AiGraderNfcTag_one_active_uid', 'AiGraderNfcTag', ARRAY['uidFingerprintSha256']::text[], 'status=''active''anduidfingerprintsha256isnotnull'),
        ('AiGraderNfcProgrammingAttempt_one_live_per_tag', 'AiGraderNfcProgrammingAttempt', ARRAY['tagId']::text[], 'state=anyarray[''initialized'',''writing'',''verified'']')
    ),
    actual_indexes AS (
      SELECT
        index_class.relname AS "indexName",
        table_class.relname AS "tableName",
        index_row.indisunique AS "isUnique",
        index_row.indisvalid AS "isValid",
        index_row.indisready AS "isReady",
        index_row.indnatts = index_row.indnkeyatts AS "hasNoIncludedColumns",
        ARRAY(
          SELECT attribute.attname
          FROM unnest(index_row.indkey::smallint[]) WITH ORDINALITY AS key_column(attnum, position)
          JOIN pg_attribute attribute
            ON attribute.attrelid = index_row.indrelid
           AND attribute.attnum = key_column.attnum
          WHERE key_column.position <= index_row.indnkeyatts
          ORDER BY key_column.position
        )::text[] AS "keyColumns",
        lower(regexp_replace(
          regexp_replace(pg_get_expr(index_row.indpred, index_row.indrelid), '::[A-Za-z0-9_."]+(\\[\\])?', '', 'g'),
          '[[:space:]"()]', '', 'g'
        )) AS "normalizedPredicate"
      FROM pg_index index_row
      JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
      JOIN pg_class table_class ON table_class.oid = index_row.indrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
      WHERE table_namespace.nspname = 'public'
    ),
    expected_fks("constraintName", "sourceTable", "sourceColumns", "targetTable", "targetColumns", "deleteType", "updateType") AS (
      VALUES
        ('AiGraderNfcTag_aiGraderReportId_fkey', 'AiGraderNfcTag', ARRAY['aiGraderReportId']::text[], 'AiGraderReport', ARRAY['id']::text[], 'r', 'c'),
        ('AiGraderNfcTag_cardAssetId_fkey', 'AiGraderNfcTag', ARRAY['cardAssetId']::text[], 'CardAsset', ARRAY['id']::text[], 'r', 'c'),
        ('AiGraderNfcTag_itemId_fkey', 'AiGraderNfcTag', ARRAY['itemId']::text[], 'Item', ARRAY['id']::text[], 'r', 'c'),
        ('AiGraderNfcTag_aiGraderLabelId_fkey', 'AiGraderNfcTag', ARRAY['aiGraderLabelId']::text[], 'AiGraderLabel', ARRAY['id']::text[], 'r', 'c'),
        ('AiGraderNfcProgrammingAttempt_tagId_fkey', 'AiGraderNfcProgrammingAttempt', ARRAY['tagId']::text[], 'AiGraderNfcTag', ARRAY['id']::text[], 'r', 'c'),
        ('AiGraderNfcAuditEvent_tagId_fkey', 'AiGraderNfcAuditEvent', ARRAY['tagId']::text[], 'AiGraderNfcTag', ARRAY['id']::text[], 'r', 'c'),
        ('AiGraderNfcAuditEvent_attemptId_fkey', 'AiGraderNfcAuditEvent', ARRAY['attemptId']::text[], 'AiGraderNfcProgrammingAttempt', ARRAY['id']::text[], 'r', 'c')
    ),
    actual_fks AS (
      SELECT
        constraint_row.conname AS "constraintName",
        source_table.relname AS "sourceTable",
        ARRAY(
          SELECT attribute.attname
          FROM unnest(constraint_row.conkey) WITH ORDINALITY AS source_key(attnum, position)
          JOIN pg_attribute attribute
            ON attribute.attrelid = constraint_row.conrelid
           AND attribute.attnum = source_key.attnum
          ORDER BY source_key.position
        )::text[] AS "sourceColumns",
        target_table.relname AS "targetTable",
        ARRAY(
          SELECT attribute.attname
          FROM unnest(constraint_row.confkey) WITH ORDINALITY AS target_key(attnum, position)
          JOIN pg_attribute attribute
            ON attribute.attrelid = constraint_row.confrelid
           AND attribute.attnum = target_key.attnum
          ORDER BY target_key.position
        )::text[] AS "targetColumns",
        constraint_row.confdeltype::text AS "deleteType",
        constraint_row.confupdtype::text AS "updateType",
        constraint_row.convalidated AS "isValidated"
      FROM pg_constraint constraint_row
      JOIN pg_class source_table ON source_table.oid = constraint_row.conrelid
      JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
      JOIN pg_class target_table ON target_table.oid = constraint_row.confrelid
      JOIN pg_namespace target_namespace ON target_namespace.oid = target_table.relnamespace
      WHERE constraint_row.contype = 'f'
        AND source_namespace.nspname = 'public'
        AND target_namespace.nspname = 'public'
    ),
    constraint_definitions AS (
      SELECT
        constraint_row.conname AS "constraintName",
        lower(regexp_replace(
          regexp_replace(pg_get_constraintdef(constraint_row.oid, true), '::[A-Za-z0-9_."]+(\\[\\])?', '', 'g'),
          '[[:space:]"()]', '', 'g'
        )) AS "normalizedDefinition",
        constraint_row.convalidated AS "isValidated"
      FROM pg_constraint constraint_row
      WHERE constraint_row.contype = 'c'
        AND constraint_row.conrelid = to_regclass('public."AiGraderNfcProgrammingAttempt"')
    ),
    expected_constraint_fragments("constraintName", "fragment") AS (
      VALUES
        ('AiGraderNfcProgrammingAttempt_completion_state', 'state=anyarray[''verified'',''consumed'']'),
        ('AiGraderNfcProgrammingAttempt_completion_state', 'state<>allarray[''verified'',''consumed'']'),
        ('AiGraderNfcProgrammingAttempt_completion_state', 'completionidempotencykeyhashisnotnull'),
        ('AiGraderNfcProgrammingAttempt_completion_state', 'completionidempotencykeyhashisnull'),
        ('AiGraderNfcProgrammingAttempt_completion_state', 'completedworkstationkeyidisnotnull'),
        ('AiGraderNfcProgrammingAttempt_completion_state', 'completedworkstationkeyidisnull'),
        ('AiGraderNfcProgrammingAttempt_completion_state', 'readbackevidenceisnotnull'),
        ('AiGraderNfcProgrammingAttempt_completion_state', 'readbackevidenceisnull'),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'readbackevidenceisnullor'),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'jsonb_typeofreadbackevidence=''object'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'readbackevidence?&array[''schemaversion'',''workstationkeyid'',''algorithm'',''statementsha256'',''signature'',''observedat'',''helperprotocolversion'',''readerresultcode'',''cryptographictagauthentication'',''workstationoperationalattestation'']'),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'jsonb_typeofreadbackevidence->''schemaversion''=''string'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'jsonb_typeofreadbackevidence->''workstationkeyid''=''string'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'jsonb_typeofreadbackevidence->''algorithm''=''string'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'jsonb_typeofreadbackevidence->''statementsha256''=''string'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'jsonb_typeofreadbackevidence->''signature''=''string'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'jsonb_typeofreadbackevidence->''observedat''=''string'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'jsonb_typeofreadbackevidence->''helperprotocolversion''=''string'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'jsonb_typeofreadbackevidence->''readerresultcode''=''string'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'jsonb_typeofreadbackevidence->''cryptographictagauthentication''=''boolean'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'jsonb_typeofreadbackevidence->''workstationoperationalattestation''=''boolean'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'readbackevidence->>''schemaversion''=''ai-grader-nfc-helper-attestation-v1'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'readbackevidence->>''workstationkeyid''=completedworkstationkeyid'),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'readbackevidence->>''algorithm''=expectedattestationalgorithm'),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'readbackevidence->>''statementsha256''~''^[a-f0-9]{64}$'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'readbackevidence->>''signature''~''^[a-za-z0-9_-]{86}$'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'readbackevidence->>''observedat''~''^[0-9]{4}-[0-9]{2}-[0-9]{2}t[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}z$'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'readbackevidence->>''helperprotocolversion''=''tenkings-ai-grader-nfc-loopback-v2'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'readbackevidence->>''readerresultcode''=anyarray[''write_verified_pcsc_readback'',''already_programmed_exact'']'),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'readbackevidence->''cryptographictagauthentication''=''false'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'readbackevidence->''workstationoperationalattestation''=''true'''),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', 'readbackevidence=jsonb_build_object'),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', '''cryptographictagauthentication'',false'),
        ('AiGraderNfcProgrammingAttempt_attestation_evidence', '''workstationoperationalattestation'',true')
    ),
    expected_triggers("triggerName", "triggerType", "functionName", "normalizedFunctionBody") AS (
      VALUES
        ('AiGraderNfcAuditEvent_immutable_update', 19, 'reject_ai_grader_nfc_audit_mutation', 'beginraiseexception''aigradernfcauditeventrowsareimmutable''end'),
        ('AiGraderNfcAuditEvent_immutable_delete', 11, 'reject_ai_grader_nfc_audit_mutation', 'beginraiseexception''aigradernfcauditeventrowsareimmutable''end')
    ),
    actual_triggers AS (
      SELECT
        trigger_row.tgname AS "triggerName",
        trigger_row.tgtype::integer AS "triggerType",
        trigger_row.tgenabled::text AS "enabledState",
        trigger_function.proname AS "functionName",
        trigger_function.pronargs = 0 AS "hasNoArguments",
        trigger_function.prorettype = 'trigger'::regtype AS "returnsTrigger",
        lower(regexp_replace(trigger_function.prosrc, '[[:space:];]', '', 'g')) AS "normalizedFunctionBody"
      FROM pg_trigger trigger_row
      JOIN pg_class trigger_table ON trigger_table.oid = trigger_row.tgrelid
      JOIN pg_namespace trigger_table_namespace ON trigger_table_namespace.oid = trigger_table.relnamespace
      JOIN pg_proc trigger_function ON trigger_function.oid = trigger_row.tgfoid
      JOIN pg_namespace trigger_function_namespace ON trigger_function_namespace.oid = trigger_function.pronamespace
      WHERE NOT trigger_row.tgisinternal
        AND trigger_table_namespace.nspname = 'public'
        AND trigger_table.relname = 'AiGraderNfcAuditEvent'
        AND trigger_function_namespace.nspname = 'public'
    )
    SELECT (
      EXISTS (
        SELECT 1
        FROM "_prisma_migrations"
        WHERE migration_name = '20260712160000_ai_grader_nfc_static_url_v1'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
          AND COALESCE(btrim(logs), '') = ''
      ) AND
      NOT EXISTS (
        SELECT 1
        FROM expected_indexes expected
        WHERE NOT EXISTS (
          SELECT 1
          FROM actual_indexes actual
          WHERE actual."indexName" = expected."indexName"
            AND actual."tableName" = expected."tableName"
            AND actual."isUnique"
            AND actual."isValid"
            AND actual."isReady"
            AND actual."hasNoIncludedColumns"
            AND actual."keyColumns" = expected."keyColumns"
            AND actual."normalizedPredicate" IS NOT DISTINCT FROM expected."normalizedPredicate"
        )
      ) AND
      NOT EXISTS (
        SELECT 1
        FROM expected_columns expected
        LEFT JOIN information_schema.columns actual
          ON actual.table_schema = 'public'
         AND actual.table_name = expected."tableName"
         AND actual.column_name = expected."columnName"
        WHERE actual.column_name IS NULL
      ) AND
      NOT EXISTS (
        SELECT 1
        FROM expected_fks expected
        WHERE NOT EXISTS (
          SELECT 1
          FROM actual_fks actual
          WHERE actual."constraintName" = expected."constraintName"
            AND actual."sourceTable" = expected."sourceTable"
            AND actual."sourceColumns" = expected."sourceColumns"
            AND actual."targetTable" = expected."targetTable"
            AND actual."targetColumns" = expected."targetColumns"
            AND actual."deleteType" = expected."deleteType"
            AND actual."updateType" = expected."updateType"
            AND actual."isValidated"
        )
      ) AND
      (
        SELECT count(*)
        FROM constraint_definitions
        WHERE "constraintName" IN (
          'AiGraderNfcProgrammingAttempt_completion_state',
          'AiGraderNfcProgrammingAttempt_attestation_evidence'
        )
          AND "isValidated"
      ) = 2 AND
      NOT EXISTS (
        SELECT 1
        FROM expected_constraint_fragments expected
        WHERE NOT EXISTS (
          SELECT 1
          FROM constraint_definitions actual
          WHERE actual."constraintName" = expected."constraintName"
            AND actual."isValidated"
            AND position(expected."fragment" IN actual."normalizedDefinition") > 0
        )
      ) AND
      NOT EXISTS (
        SELECT 1
        FROM expected_triggers expected
        WHERE NOT EXISTS (
          SELECT 1
          FROM actual_triggers actual
          WHERE actual."triggerName" = expected."triggerName"
            AND actual."triggerType" = expected."triggerType"
            AND actual."enabledState" = 'O'
            AND actual."functionName" = expected."functionName"
            AND actual."hasNoArguments"
            AND actual."returnsTrigger"
            AND actual."normalizedFunctionBody" = expected."normalizedFunctionBody"
        )
      )
    ) AS "ready"
  `;
  const row = Array.isArray(rows) && isRecord(rows[0]) ? rows[0] : undefined;
  if (!row || typeof row.ready !== "boolean") {
    throw new Error("NFC schema readiness query returned an invalid result.");
  }
  return { ready: row.ready };
}

/**
 * Coalesce production probes and briefly cache only successful probe results.
 * The uncached reader above remains the migration-validation authority.
 * Unexpected database errors are never cached or reclassified.
 */
export async function readCachedAiGraderNfcSchemaReadiness(
  dbClient: DbClient,
  options: {
    now?: () => number;
    readyTtlMs?: number;
    unavailableTtlMs?: number;
  } = {},
): Promise<AiGraderNfcSchemaReadiness> {
  if (!dbClient || typeof dbClient !== "object") {
    return readAiGraderNfcSchemaReadiness(dbClient);
  }
  const now = options.now ?? Date.now;
  const observedAt = now();
  const cached = schemaReadinessCache.get(dbClient);
  if (cached?.result && cached.expiresAt > observedAt) return cached.result;
  if (cached?.inFlight) return cached.inFlight;

  let inFlight: Promise<AiGraderNfcSchemaReadiness>;
  inFlight = readAiGraderNfcSchemaReadiness(dbClient).then((result) => {
    const ttl = result.ready
      ? options.readyTtlMs ?? AI_GRADER_NFC_SCHEMA_READY_CACHE_TTL_MS
      : options.unavailableTtlMs ?? AI_GRADER_NFC_SCHEMA_UNAVAILABLE_CACHE_TTL_MS;
    schemaReadinessCache.set(dbClient, {
      result,
      expiresAt: now() + Math.max(0, ttl),
    });
    return result;
  }).catch((error) => {
    if (schemaReadinessCache.get(dbClient)?.inFlight === inFlight) {
      schemaReadinessCache.delete(dbClient);
    }
    throw error;
  });
  schemaReadinessCache.set(dbClient, { expiresAt: 0, inFlight });
  return inFlight;
}
