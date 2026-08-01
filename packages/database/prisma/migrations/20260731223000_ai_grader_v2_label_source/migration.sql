CREATE TYPE "HumanGradeLabelSource" AS ENUM ('HUMAN', 'SPEEDSTER');

-- Existing rows retain Human Grade behavior through the metadata-only HUMAN default.
ALTER TABLE "HumanGradeLabel"
ADD COLUMN "source" "HumanGradeLabelSource" NOT NULL DEFAULT 'HUMAN',
ADD COLUMN "sourceSessionId" TEXT;

CREATE UNIQUE INDEX "HumanGradeLabel_sourceSessionId_key"
ON "HumanGradeLabel"("sourceSessionId");
