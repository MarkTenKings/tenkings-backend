\set ON_ERROR_STOP on

-- Rollback-only fixture. The guarded loopback/tmpfs harness runs this after
-- deploying the complete migration chain to a brand-new disposable database.
BEGIN;

DO $speedster_layout_v2_catalog$
DECLARE
  enum_labels text;
BEGIN
  IF to_regclass('public."AiGraderV2LegacyMapLayoutAuthority"') IS NULL THEN
    RAISE EXCEPTION 'Layout V2 legacy authority table is missing';
  END IF;

  SELECT string_agg(enum_value.enumlabel, ',' ORDER BY enum_value.enumsortorder)
    INTO enum_labels
    FROM pg_type enum_type
    JOIN pg_namespace enum_namespace ON enum_namespace.oid = enum_type.typnamespace
    JOIN pg_enum enum_value ON enum_value.enumtypid = enum_type.oid
   WHERE enum_namespace.nspname = 'public'
     AND enum_type.typname = 'AiGraderV2PokemonLayoutType';
  IF enum_labels IS DISTINCT FROM 'POKEMON,TRAINER,ENERGY' THEN
    RAISE EXCEPTION 'Layout V2 enum labels are wrong: %', enum_labels;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'AiGraderV2Session_identity_layout_type_check'
       AND conrelid = 'public."AiGraderV2Session"'::regclass
       AND contype = 'c'
       AND convalidated
       AND pg_get_constraintdef(oid) LIKE '%layoutType%POKEMON%TRAINER%ENERGY%'
  ) THEN
    RAISE EXCEPTION 'Validated Layout V2 session identity constraint is missing or incoherent';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_index index_object
      JOIN pg_class index_class ON index_class.oid = index_object.indexrelid
     WHERE index_object.indrelid = 'public."AiGraderV2LegacyMapLayoutAuthority"'::regclass
       AND index_class.relname = 'AiGraderV2LegacyMapLayoutAuthority_sourceSessionId_key'
       AND index_object.indisunique
       AND index_object.indisvalid
  ) THEN
    RAISE EXCEPTION 'Layout V2 unique source authority index is missing or invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'AiGraderV2LegacyMapLayoutAuthority_sourceSessionId_fkey'
       AND conrelid = 'public."AiGraderV2LegacyMapLayoutAuthority"'::regclass
       AND confrelid = 'public."AiGraderV2Session"'::regclass
       AND contype = 'f'
       AND confdeltype = 'r'
       AND confupdtype = 'c'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'Layout V2 source authority foreign key is missing or incoherent';
  END IF;

  IF (
    SELECT count(*)
      FROM pg_trigger
     WHERE tgrelid = 'public."AiGraderV2LegacyMapLayoutAuthority"'::regclass
       AND tgname IN (
         'AiGraderV2LegacyMapLayoutAuthority_reject_update',
         'AiGraderV2LegacyMapLayoutAuthority_reject_delete'
       )
       AND NOT tgisinternal
       AND tgenabled = 'O'
  ) <> 2 THEN
    RAISE EXCEPTION 'Layout V2 authority append-only triggers are incomplete';
  END IF;

  IF (
    SELECT count(*)
      FROM pg_trigger
     WHERE tgrelid = 'public."AiGraderV2CardTypeMapRevision"'::regclass
       AND tgname IN (
         'AiGraderV2CardTypeMapRevision_reject_update',
         'AiGraderV2CardTypeMapRevision_reject_delete'
       )
       AND NOT tgisinternal
       AND tgenabled = 'O'
  ) <> 2 THEN
    RAISE EXCEPTION 'Card Map revision append-only triggers are incomplete';
  END IF;

  IF (
    SELECT count(*)
      FROM "_prisma_migrations"
     WHERE "migration_name" = '20260813200000_speedster_pokemon_layout_key_v2'
       AND "finished_at" IS NOT NULL
       AND "rolled_back_at" IS NULL
       AND "logs" IS NULL
       AND "applied_steps_count" > 0
  ) <> 1 THEN
    RAISE EXCEPTION 'Layout V2 migration ledger marker is not one clean success';
  END IF;
END
$speedster_layout_v2_catalog$;

-- Historical layoutless Pokémon identity remains valid and untouched.
INSERT INTO "AiGraderV2Session" (
  "id", "createdByUserId", "cardProfile", "workflowState", "ruleVersion",
  "identity", "capture", "reviewedDefects", "gradeReport", "updatedAt"
) VALUES
  (
    'speedster-layout-v2-legacy-session', 'layout-v2-admin', 'POKEMON', 'CAPTURED', 'speedster-v2',
    '{"category":"POKEMON","year":"2023","productSet":"MEW EN","parallel":"REVERSE HOLO","cardName":"LEGACY","cardNumber":"001/165"}'::jsonb,
    '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, clock_timestamp()
  ),
  (
    'speedster-layout-v2-pokemon-session', 'layout-v2-admin', 'POKEMON', 'CAPTURED', 'speedster-v2',
    '{"category":"POKEMON","layoutType":"POKEMON","year":"2023","productSet":"MEW EN","parallel":"REVERSE HOLO","cardName":"CHARMANDER","cardNumber":"004/165"}'::jsonb,
    '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, clock_timestamp()
  ),
  (
    'speedster-layout-v2-trainer-session', 'layout-v2-admin', 'POKEMON', 'CAPTURED', 'speedster-v2',
    '{"category":"POKEMON","layoutType":"TRAINER","year":"2023","productSet":"MEW EN","parallel":"REVERSE HOLO","cardName":"FIXTURE","cardNumber":"100/165"}'::jsonb,
    '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, clock_timestamp()
  );

DO $speedster_layout_v2_identity_rejections$
DECLARE
  rejected boolean;
BEGIN
  rejected := false;
  BEGIN
    INSERT INTO "AiGraderV2Session" (
      "id", "createdByUserId", "cardProfile", "ruleVersion", "identity",
      "capture", "reviewedDefects", "gradeReport", "updatedAt"
    ) VALUES (
      'speedster-layout-v2-invalid-sports', 'layout-v2-admin', 'SPORTS', 'speedster-v2',
      '{"category":"SPORTS","layoutType":"POKEMON"}'::jsonb,
      '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, clock_timestamp()
    );
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected SPORTS layoutType identity rejection'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO "AiGraderV2Session" (
      "id", "createdByUserId", "cardProfile", "ruleVersion", "identity",
      "capture", "reviewedDefects", "gradeReport", "updatedAt"
    ) VALUES (
      'speedster-layout-v2-invalid-layout', 'layout-v2-admin', 'POKEMON', 'speedster-v2',
      '{"category":"POKEMON","layoutType":"UNKNOWN"}'::jsonb,
      '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, clock_timestamp()
    );
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected unknown Pokémon layoutType rejection'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO "AiGraderV2Session" (
      "id", "createdByUserId", "cardProfile", "ruleVersion", "identity",
      "capture", "reviewedDefects", "gradeReport", "updatedAt"
    ) VALUES (
      'speedster-layout-v2-invalid-layout-type', 'layout-v2-admin', 'POKEMON', 'speedster-v2',
      '{"category":"POKEMON","layoutType":42}'::jsonb,
      '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, clock_timestamp()
    );
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected non-string Pokémon layoutType rejection'; END IF;
END
$speedster_layout_v2_identity_rejections$;

INSERT INTO "AiGraderV2LegacyMapLayoutAuthority" (
  "id", "sourceSessionId", "layoutType", "selectedByAdminId"
) VALUES (
  'speedster-layout-v2-authority', 'speedster-layout-v2-legacy-session', 'POKEMON', 'layout-v2-admin'
);

INSERT INTO "AiGraderV2CardTypeMap" ("id", "matchKeyHash", "cardProfile")
VALUES ('speedster-layout-v2-map', repeat('7', 64), 'POKEMON');

INSERT INTO "AiGraderV2CardTypeMapRevision" (
  "id", "mapId", "version", "matchKeyHash", "matchKey", "displayIdentity",
  "normalizedIdentity", "sourceSessionId", "authorAdminId", "frontMap", "backMap",
  "mapSchemaVersion", "filterPolicyVersion", "revisionHash"
) VALUES (
  'speedster-layout-v2-revision', 'speedster-layout-v2-map', 1, repeat('7', 64),
  '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'speedster-layout-v2-pokemon-session',
  'layout-v2-admin', '{}'::jsonb, '{}'::jsonb, 'speedster-card-type-map-v2',
  'speedster-map-filter-authority-padding-v2', repeat('8', 64)
);

DO $speedster_layout_v2_immutability$
DECLARE
  rejected boolean;
  authority_ctid tid;
  authority_xmin xid;
  authority_row text;
  revision_ctid tid;
  revision_xmin xid;
  revision_row text;
BEGIN
  SELECT ctid, xmin, row_to_json(authority)::text
    INTO authority_ctid, authority_xmin, authority_row
    FROM "AiGraderV2LegacyMapLayoutAuthority" authority
   WHERE "id" = 'speedster-layout-v2-authority';
  SELECT ctid, xmin, row_to_json(revision)::text
    INTO revision_ctid, revision_xmin, revision_row
    FROM "AiGraderV2CardTypeMapRevision" revision
   WHERE "id" = 'speedster-layout-v2-revision';

  rejected := false;
  BEGIN
    INSERT INTO "AiGraderV2LegacyMapLayoutAuthority" (
      "id", "sourceSessionId", "layoutType", "selectedByAdminId"
    ) VALUES (
      'speedster-layout-v2-authority-duplicate', 'speedster-layout-v2-legacy-session', 'TRAINER', 'layout-v2-admin'
    );
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected one-time legacy source authority rejection'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO "AiGraderV2LegacyMapLayoutAuthority" (
      "id", "sourceSessionId", "layoutType", "selectedByAdminId"
    ) VALUES (
      'speedster-layout-v2-authority-invalid-fk', 'missing-layout-v2-session', 'ENERGY', 'layout-v2-admin'
    );
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected legacy source authority FK rejection'; END IF;

  rejected := false;
  BEGIN
    UPDATE "AiGraderV2LegacyMapLayoutAuthority" SET "layoutType" = 'TRAINER'
     WHERE "id" = 'speedster-layout-v2-authority';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'AiGraderV2LegacyMapLayoutAuthority is append-only' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected legacy authority UPDATE rejection'; END IF;

  rejected := false;
  BEGIN
    DELETE FROM "AiGraderV2LegacyMapLayoutAuthority"
     WHERE "id" = 'speedster-layout-v2-authority';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'AiGraderV2LegacyMapLayoutAuthority is append-only' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected legacy authority DELETE rejection'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "AiGraderV2LegacyMapLayoutAuthority" authority
     WHERE "id" = 'speedster-layout-v2-authority'
       AND ctid = authority_ctid AND xmin = authority_xmin
       AND row_to_json(authority)::text = authority_row
  ) THEN RAISE EXCEPTION 'Rejected legacy authority mutations changed row identity or content';
  END IF;

  rejected := false;
  BEGIN
    UPDATE "AiGraderV2CardTypeMapRevision" SET "authorAdminId" = 'mutated-admin'
     WHERE "id" = 'speedster-layout-v2-revision';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'AiGraderV2CardTypeMapRevision is append-only' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected Card Map revision UPDATE rejection'; END IF;

  rejected := false;
  BEGIN
    DELETE FROM "AiGraderV2CardTypeMapRevision"
     WHERE "id" = 'speedster-layout-v2-revision';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'AiGraderV2CardTypeMapRevision is append-only' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expected Card Map revision DELETE rejection'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "AiGraderV2CardTypeMapRevision" revision
     WHERE "id" = 'speedster-layout-v2-revision'
       AND ctid = revision_ctid AND xmin = revision_xmin
       AND row_to_json(revision)::text = revision_row
  ) THEN RAISE EXCEPTION 'Rejected Card Map revision mutations changed row identity or content';
  END IF;
END
$speedster_layout_v2_immutability$;

ROLLBACK;

DO $speedster_layout_v2_cleanup$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "AiGraderV2Session" WHERE "id" LIKE 'speedster-layout-v2-%'
  ) OR EXISTS (
    SELECT 1 FROM "AiGraderV2LegacyMapLayoutAuthority" WHERE "id" LIKE 'speedster-layout-v2-%'
  ) OR EXISTS (
    SELECT 1 FROM "AiGraderV2CardTypeMap" WHERE "id" LIKE 'speedster-layout-v2-%'
  ) OR EXISTS (
    SELECT 1 FROM "AiGraderV2CardTypeMapRevision" WHERE "id" LIKE 'speedster-layout-v2-%'
  ) THEN
    RAISE EXCEPTION 'Layout V2 fixture rows survived rollback';
  END IF;
END
$speedster_layout_v2_cleanup$;

\echo SPEEDSTER_LAYOUT_KEY_V2_VALIDATION_PASS
