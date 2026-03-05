-- Phase 2 foundation: promote Card_Type (programId) to first-class variant/reference identity.

ALTER TABLE "CardVariant"
  ADD COLUMN IF NOT EXISTS "programId" TEXT;

ALTER TABLE "CardVariantReferenceImage"
  ADD COLUMN IF NOT EXISTS "programId" TEXT;

-- Backfill CardVariant.programId from taxonomy map when available.
UPDATE "CardVariant" v
SET "programId" = src.program_id
FROM (
  SELECT
    m."cardVariantId" AS card_variant_id,
    MIN(NULLIF(BTRIM(m."programId"), '')) AS program_id
  FROM "CardVariantTaxonomyMap" m
  WHERE COALESCE(BTRIM(m."programId"), '') <> ''
  GROUP BY m."cardVariantId"
) src
WHERE v."id" = src.card_variant_id
  AND src.program_id IS NOT NULL
  AND COALESCE(BTRIM(v."programId"), '') = '';

-- If a card number maps to exactly one program in taxonomy, use it.
WITH card_program AS (
  SELECT
    c."setId",
    c."cardNumber",
    MIN(c."programId") AS program_id,
    COUNT(DISTINCT c."programId") AS program_count
  FROM "SetCard" c
  WHERE COALESCE(BTRIM(c."programId"), '') <> ''
  GROUP BY c."setId", c."cardNumber"
)
UPDATE "CardVariant" v
SET "programId" = cp.program_id
FROM card_program cp
WHERE v."setId" = cp."setId"
  AND v."cardNumber" = cp."cardNumber"
  AND cp.program_count = 1
  AND COALESCE(BTRIM(v."programId"), '') = '';

-- Otherwise, if a parallel maps to exactly one program scope, use that.
WITH scope_program AS (
  SELECT
    s."setId",
    s."parallelId",
    MIN(s."programId") AS program_id,
    COUNT(DISTINCT s."programId") AS program_count
  FROM "SetParallelScope" s
  WHERE COALESCE(BTRIM(s."programId"), '') <> ''
  GROUP BY s."setId", s."parallelId"
)
UPDATE "CardVariant" v
SET "programId" = sp.program_id
FROM scope_program sp
WHERE v."setId" = sp."setId"
  AND v."parallelId" = sp."parallelId"
  AND sp.program_count = 1
  AND COALESCE(BTRIM(v."programId"), '') = '';

-- Final fallback.
UPDATE "CardVariant"
SET "programId" = 'base'
WHERE COALESCE(BTRIM("programId"), '') = '';

-- Build target programs per existing variant (intersection preferred; then card programs; then scope programs).
CREATE TEMP TABLE _variant_program_targets ON COMMIT DROP AS
WITH variant_candidates AS (
  SELECT
    v."id" AS variant_id,
    v."setId",
    v."cardNumber",
    v."parallelId",
    COALESCE(NULLIF(BTRIM(v."programId"), ''), 'base') AS existing_program_id,
    card.program_ids AS card_program_ids,
    scope.program_ids AS scope_program_ids,
    cross_scope.program_ids AS cross_program_ids
  FROM "CardVariant" v
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT c."programId") AS program_ids
    FROM "SetCard" c
    WHERE c."setId" = v."setId"
      AND c."cardNumber" = v."cardNumber"
      AND COALESCE(BTRIM(c."programId"), '') <> ''
  ) card ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT s."programId") AS program_ids
    FROM "SetParallelScope" s
    WHERE s."setId" = v."setId"
      AND s."parallelId" = v."parallelId"
      AND COALESCE(BTRIM(s."programId"), '') <> ''
  ) scope ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT x.program_id) AS program_ids
    FROM (
      SELECT c."programId" AS program_id
      FROM "SetCard" c
      WHERE c."setId" = v."setId"
        AND c."cardNumber" = v."cardNumber"
        AND COALESCE(BTRIM(c."programId"), '') <> ''
      INTERSECT
      SELECT s."programId" AS program_id
      FROM "SetParallelScope" s
      WHERE s."setId" = v."setId"
        AND s."parallelId" = v."parallelId"
        AND COALESCE(BTRIM(s."programId"), '') <> ''
    ) x
  ) cross_scope ON TRUE
)
SELECT
  vc.variant_id,
  vc."setId",
  vc."cardNumber",
  vc."parallelId",
  UNNEST(
    CASE
      WHEN vc.cross_program_ids IS NOT NULL AND CARDINALITY(vc.cross_program_ids) > 0 THEN vc.cross_program_ids
      WHEN vc.card_program_ids IS NOT NULL AND CARDINALITY(vc.card_program_ids) > 0 THEN vc.card_program_ids
      WHEN vc.scope_program_ids IS NOT NULL AND CARDINALITY(vc.scope_program_ids) > 0 THEN vc.scope_program_ids
      ELSE ARRAY[vc.existing_program_id]
    END
  ) AS program_id
FROM variant_candidates vc;

-- Keep one canonical program on each original row.
UPDATE "CardVariant" v
SET "programId" = pick.program_id
FROM (
  SELECT variant_id, MIN(program_id) AS program_id
  FROM _variant_program_targets
  GROUP BY variant_id
) pick
WHERE v."id" = pick.variant_id;

-- Duplicate variants for additional program targets.
INSERT INTO "CardVariant" (
  "id",
  "setId",
  "programId",
  "cardNumber",
  "parallelId",
  "parallelFamily",
  "keywords",
  "oddsInfo",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT(v."id", '::', REPLACE(t.program_id, '::', '-')) AS id,
  v."setId",
  t.program_id,
  v."cardNumber",
  v."parallelId",
  v."parallelFamily",
  v."keywords",
  v."oddsInfo",
  v."createdAt",
  NOW()
FROM "CardVariant" v
JOIN _variant_program_targets t
  ON t.variant_id = v."id"
LEFT JOIN "CardVariant" existing
  ON existing."setId" = v."setId"
 AND existing."programId" = t.program_id
 AND existing."cardNumber" = v."cardNumber"
 AND existing."parallelId" = v."parallelId"
WHERE t.program_id <> v."programId"
  AND existing."id" IS NULL;

-- Normalize map rows to current variant identity.
UPDATE "CardVariantTaxonomyMap" m
SET
  "setId" = v."setId",
  "programId" = v."programId",
  "cardNumber" = v."cardNumber",
  "variationId" = NULL,
  "parallelId" = v."parallelId",
  "canonicalKey" = CONCAT(
    LOWER(BTRIM(v."setId")),
    '::',
    LOWER(BTRIM(v."programId")),
    '::',
    LOWER(COALESCE(NULLIF(BTRIM(v."cardNumber"), ''), 'null')),
    '::none::',
    COALESCE(
      NULLIF(
        LOWER(
          REGEXP_REPLACE(
            REGEXP_REPLACE(BTRIM(v."parallelId"), '[^a-zA-Z0-9]+', '-', 'g'),
            '(^-+|-+$)',
            '',
            'g'
          )
        ),
        ''
      ),
      'parallel'
    )
  ),
  "updatedAt" = NOW()
FROM "CardVariant" v
WHERE m."cardVariantId" = v."id";

-- Create missing taxonomy map rows for duplicated variants.
INSERT INTO "CardVariantTaxonomyMap" (
  "id",
  "cardVariantId",
  "setId",
  "programId",
  "cardNumber",
  "variationId",
  "parallelId",
  "canonicalKey",
  "createdAt",
  "updatedAt"
)
SELECT
  MD5(CONCAT(v."id", '::taxonomy-map')),
  v."id",
  v."setId",
  v."programId",
  v."cardNumber",
  NULL,
  v."parallelId",
  CONCAT(
    LOWER(BTRIM(v."setId")),
    '::',
    LOWER(BTRIM(v."programId")),
    '::',
    LOWER(COALESCE(NULLIF(BTRIM(v."cardNumber"), ''), 'null')),
    '::none::',
    COALESCE(
      NULLIF(
        LOWER(
          REGEXP_REPLACE(
            REGEXP_REPLACE(BTRIM(v."parallelId"), '[^a-zA-Z0-9]+', '-', 'g'),
            '(^-+|-+$)',
            '',
            'g'
          )
        ),
        ''
      ),
      'parallel'
    )
  ),
  NOW(),
  NOW()
FROM "CardVariant" v
LEFT JOIN "CardVariantTaxonomyMap" m
  ON m."cardVariantId" = v."id"
WHERE m."cardVariantId" IS NULL;

-- Backfill CardVariantReferenceImage.programId from exact variant identity where unambiguous.
WITH variant_program AS (
  SELECT
    v."setId",
    v."cardNumber",
    v."parallelId",
    MIN(v."programId") AS program_id,
    COUNT(DISTINCT v."programId") AS program_count
  FROM "CardVariant" v
  GROUP BY v."setId", v."cardNumber", v."parallelId"
)
UPDATE "CardVariantReferenceImage" r
SET "programId" = vp.program_id
FROM variant_program vp
WHERE r."setId" = vp."setId"
  AND r."parallelId" = vp."parallelId"
  AND COALESCE(r."cardNumber", 'ALL') = vp."cardNumber"
  AND vp.program_count = 1
  AND COALESCE(BTRIM(r."programId"), '') = '';

-- If still unknown, use unique card program.
WITH card_program AS (
  SELECT
    c."setId",
    c."cardNumber",
    MIN(c."programId") AS program_id,
    COUNT(DISTINCT c."programId") AS program_count
  FROM "SetCard" c
  WHERE COALESCE(BTRIM(c."programId"), '') <> ''
  GROUP BY c."setId", c."cardNumber"
)
UPDATE "CardVariantReferenceImage" r
SET "programId" = cp.program_id
FROM card_program cp
WHERE r."setId" = cp."setId"
  AND COALESCE(r."cardNumber", '') = cp."cardNumber"
  AND cp.program_count = 1
  AND COALESCE(BTRIM(r."programId"), '') = '';

-- Fallback for remaining reference rows.
UPDATE "CardVariantReferenceImage"
SET "programId" = 'base'
WHERE COALESCE(BTRIM("programId"), '') = '';

-- Duplicate reference rows across additional target programs when available.
CREATE TEMP TABLE _reference_program_targets ON COMMIT DROP AS
SELECT
  r."id" AS reference_id,
  ARRAY_AGG(DISTINCT v."programId") AS program_ids
FROM "CardVariantReferenceImage" r
JOIN "CardVariant" v
  ON v."setId" = r."setId"
 AND v."parallelId" = r."parallelId"
 AND (
   (COALESCE(r."cardNumber", 'ALL') <> 'ALL' AND v."cardNumber" = r."cardNumber")
   OR (COALESCE(r."cardNumber", 'ALL') = 'ALL' AND v."cardNumber" = 'ALL')
 )
GROUP BY r."id";

INSERT INTO "CardVariantReferenceImage" (
  "id",
  "setId",
  "programId",
  "cardNumber",
  "parallelId",
  "refType",
  "pairKey",
  "sourceListingId",
  "playerSeed",
  "storageKey",
  "qaStatus",
  "ownedStatus",
  "promotedAt",
  "sourceUrl",
  "listingTitle",
  "rawImageUrl",
  "cropUrls",
  "cropEmbeddings",
  "qualityScore",
  "qualityGateScore",
  "qualityGateStatus",
  "qualityGateReasonsJson",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT(r."id", '::', REPLACE(pid.program_id, '::', '-')) AS id,
  r."setId",
  pid.program_id,
  r."cardNumber",
  r."parallelId",
  r."refType",
  r."pairKey",
  r."sourceListingId",
  r."playerSeed",
  r."storageKey",
  r."qaStatus",
  r."ownedStatus",
  r."promotedAt",
  r."sourceUrl",
  r."listingTitle",
  r."rawImageUrl",
  r."cropUrls",
  r."cropEmbeddings",
  r."qualityScore",
  r."qualityGateScore",
  r."qualityGateStatus",
  r."qualityGateReasonsJson",
  r."createdAt",
  NOW()
FROM "CardVariantReferenceImage" r
JOIN _reference_program_targets rpt
  ON rpt.reference_id = r."id"
JOIN LATERAL UNNEST(rpt.program_ids) AS pid(program_id)
  ON TRUE
LEFT JOIN "CardVariantReferenceImage" existing
  ON existing."setId" = r."setId"
 AND existing."programId" = pid.program_id
 AND existing."parallelId" = r."parallelId"
 AND COALESCE(existing."cardNumber", 'ALL') = COALESCE(r."cardNumber", 'ALL')
 AND COALESCE(existing."sourceListingId", '') = COALESCE(r."sourceListingId", '')
WHERE pid.program_id <> r."programId"
  AND existing."id" IS NULL;

ALTER TABLE "CardVariant"
  ALTER COLUMN "programId" SET DEFAULT 'base',
  ALTER COLUMN "programId" SET NOT NULL;

ALTER TABLE "CardVariantReferenceImage"
  ALTER COLUMN "programId" SET DEFAULT 'base',
  ALTER COLUMN "programId" SET NOT NULL;

DROP INDEX IF EXISTS "CardVariant_setId_cardNumber_parallelId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "CardVariant_setId_programId_cardNumber_parallelId_key"
  ON "CardVariant" ("setId", "programId", "cardNumber", "parallelId");

CREATE INDEX IF NOT EXISTS "CardVariant_setId_programId_cardNumber_idx"
  ON "CardVariant" ("setId", "programId", "cardNumber");

CREATE INDEX IF NOT EXISTS "CardVariantReferenceImage_setId_programId_parallelId_idx"
  ON "CardVariantReferenceImage" ("setId", "programId", "parallelId");

CREATE INDEX IF NOT EXISTS "CVRI_set_prog_card_parallel_idx"
  ON "CardVariantReferenceImage" ("setId", "programId", "cardNumber", "parallelId");

CREATE INDEX IF NOT EXISTS "CVRI_set_prog_parallel_ref_idx"
  ON "CardVariantReferenceImage" ("setId", "programId", "parallelId", "refType");

CREATE INDEX IF NOT EXISTS "CVRI_set_prog_card_parallel_ref_idx"
  ON "CardVariantReferenceImage" ("setId", "programId", "cardNumber", "parallelId", "refType");

CREATE INDEX IF NOT EXISTS "CVRI_set_prog_parallel_qgate_idx"
  ON "CardVariantReferenceImage" ("setId", "programId", "parallelId", "qualityGateStatus");
