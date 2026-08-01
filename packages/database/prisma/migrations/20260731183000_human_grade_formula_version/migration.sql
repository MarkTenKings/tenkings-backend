CREATE TYPE "HumanGradeFormulaVersion" AS ENUM ('LEGACY_30_25_25_20', 'EQUAL_25');

-- Existing rows receive the legacy formula as part of the schema change; no row-level backfill is run.
ALTER TABLE "HumanGradeLabel"
ADD COLUMN "gradingFormulaVersion" "HumanGradeFormulaVersion" NOT NULL DEFAULT 'LEGACY_30_25_25_20';

-- Future rows default to equal weighting. The application also writes EQUAL_25 explicitly.
ALTER TABLE "HumanGradeLabel"
ALTER COLUMN "gradingFormulaVersion" SET DEFAULT 'EQUAL_25';
