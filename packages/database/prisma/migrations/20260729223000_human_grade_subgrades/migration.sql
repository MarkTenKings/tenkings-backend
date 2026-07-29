-- Human Grade-only subgrades. Existing Human Grade labels retain their exact
-- final grade by initializing each component to that same value.
ALTER TABLE "HumanGradeLabel"
ADD COLUMN "centeringGrade" DECIMAL(3,1),
ADD COLUMN "cornersGrade" DECIMAL(3,1),
ADD COLUMN "edgesGrade" DECIMAL(3,1),
ADD COLUMN "surfaceGrade" DECIMAL(3,1);

UPDATE "HumanGradeLabel"
SET
  "centeringGrade" = "grade",
  "cornersGrade" = "grade",
  "edgesGrade" = "grade",
  "surfaceGrade" = "grade";

ALTER TABLE "HumanGradeLabel"
ALTER COLUMN "centeringGrade" SET NOT NULL,
ALTER COLUMN "cornersGrade" SET NOT NULL,
ALTER COLUMN "edgesGrade" SET NOT NULL,
ALTER COLUMN "surfaceGrade" SET NOT NULL;
