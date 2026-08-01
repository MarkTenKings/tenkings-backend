CREATE TYPE "HumanGradeFormulaVersion" AS ENUM ('LEGACY_30_25_25_20', 'EQUAL_25');

-- Existing rows receive the legacy formula as part of the schema change; no row-level backfill is run.
ALTER TABLE "HumanGradeLabel"
ADD COLUMN "gradingFormulaVersion" "HumanGradeFormulaVersion" NOT NULL DEFAULT 'LEGACY_30_25_25_20';

-- Keep the compatibility default legacy-safe for the deployment window and any rollback.
-- The version-aware Human Grade API explicitly writes EQUAL_25 for every new label.
