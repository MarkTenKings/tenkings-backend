-- Human grading is intentionally isolated from all AI Grader tables.
CREATE TYPE "HumanGradeCardType" AS ENUM ('SPORTS', 'POKEMON');
CREATE TYPE "HumanGradeLabelSheetStatus" AS ENUM ('OPEN', 'READY');

CREATE TABLE "HumanGradeLabelSheet" (
    "id" TEXT NOT NULL,
    "sheetNumber" SERIAL NOT NULL,
    "status" "HumanGradeLabelSheetStatus" NOT NULL DEFAULT 'OPEN',
    "readyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HumanGradeLabelSheet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HumanGradeLabel" (
    "id" TEXT NOT NULL,
    "certificateSequence" SERIAL NOT NULL,
    "certificateNumber" TEXT,
    "sheetId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "cardType" "HumanGradeCardType" NOT NULL,
    "playerName" TEXT,
    "cardName" TEXT,
    "year" TEXT NOT NULL,
    "manufacturer" TEXT,
    "productSet" TEXT NOT NULL,
    "parallel" TEXT,
    "insert" TEXT,
    "cardNumber" TEXT,
    "grade" DECIMAL(3,1) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HumanGradeLabel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HumanGradeLabelSheet_sheetNumber_key" ON "HumanGradeLabelSheet"("sheetNumber");
CREATE INDEX "HumanGradeLabelSheet_status_sheetNumber_idx" ON "HumanGradeLabelSheet"("status", "sheetNumber");
CREATE UNIQUE INDEX "HumanGradeLabel_certificateSequence_key" ON "HumanGradeLabel"("certificateSequence");
CREATE UNIQUE INDEX "HumanGradeLabel_certificateNumber_key" ON "HumanGradeLabel"("certificateNumber");
CREATE UNIQUE INDEX "HumanGradeLabel_sheetId_slot_key" ON "HumanGradeLabel"("sheetId", "slot");
CREATE INDEX "HumanGradeLabel_sheetId_slot_idx" ON "HumanGradeLabel"("sheetId", "slot");
CREATE INDEX "HumanGradeLabel_createdAt_idx" ON "HumanGradeLabel"("createdAt");

ALTER TABLE "HumanGradeLabel"
ADD CONSTRAINT "HumanGradeLabel_sheetId_fkey"
FOREIGN KEY ("sheetId") REFERENCES "HumanGradeLabelSheet"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
