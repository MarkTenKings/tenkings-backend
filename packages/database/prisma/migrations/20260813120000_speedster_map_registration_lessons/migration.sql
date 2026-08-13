-- PostgreSQL DDL is transactional, but Prisma does not add a transaction to
-- every provider migration. Keep this complete additive unit all-or-nothing:
-- table, indexes, foreign keys, function, and trigger commit together.
BEGIN;

CREATE TABLE "AiGraderV2MapRegistrationLesson" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operatorAdminId" TEXT NOT NULL,
    "mapRevisionId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "evidenceSessionId" TEXT NOT NULL,
    "currentInspectionKey" TEXT NOT NULL,
    "currentInspectionSha256" TEXT NOT NULL,
    "currentPhysicalQuadSha256" TEXT NOT NULL,
    "originalExpectedAnchors" JSONB NOT NULL,
    "automaticDiagnostics" JSONB NOT NULL,
    "humanCorrectedAnchors" JSONB NOT NULL,
    "validatedRegistration" JSONB NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "rescueAttemptId" TEXT NOT NULL,
    "lessonHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGraderV2MapRegistrationLesson_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiGraderV2MapRegistrationLesson_side_check" CHECK ("side" IN ('FRONT', 'BACK')),
    CONSTRAINT "AiGraderV2MapRegistrationLesson_currentInspectionSha256_check" CHECK ("currentInspectionSha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "AiGraderV2MapRegistrationLesson_currentPhysicalQuadSha256_check" CHECK ("currentPhysicalQuadSha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "AiGraderV2MapRegistrationLesson_lessonHash_check" CHECK ("lessonHash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "AiGraderV2MapRegistrationLesson_rescueAttemptId_check" CHECK ("rescueAttemptId" ~ '^[A-Za-z0-9_-]{8,100}$'),
    CONSTRAINT "AiGraderV2MapRegistrationLesson_algorithmVersion_check" CHECK ("algorithmVersion" = 'opencv-redundant-ransac-registration-v2'),
    CONSTRAINT "AiGraderV2MapRegistrationLesson_policyVersion_check" CHECK ("policyVersion" = 'speedster-map-registration-acceptance-v2')
);

CREATE UNIQUE INDEX "AiGraderV2MapRegistrationLesson_rescueAttemptId_key"
    ON "AiGraderV2MapRegistrationLesson"("rescueAttemptId");
CREATE UNIQUE INDEX "AiGraderV2MapRegistrationLesson_lessonHash_key"
    ON "AiGraderV2MapRegistrationLesson"("lessonHash");
CREATE INDEX "AiGraderV2MapRegistrationLesson_tenantId_mapRevisionId_side_createdAt_idx"
    ON "AiGraderV2MapRegistrationLesson"("tenantId", "mapRevisionId", "side", "createdAt");
CREATE INDEX "AiGraderV2MapRegistrationLesson_evidenceSessionId_createdAt_idx"
    ON "AiGraderV2MapRegistrationLesson"("evidenceSessionId", "createdAt");

ALTER TABLE "AiGraderV2MapRegistrationLesson"
    ADD CONSTRAINT "AiGraderV2MapRegistrationLesson_mapRevisionId_fkey"
    FOREIGN KEY ("mapRevisionId") REFERENCES "AiGraderV2CardTypeMapRevision"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGraderV2MapRegistrationLesson"
    ADD CONSTRAINT "AiGraderV2MapRegistrationLesson_evidenceSessionId_fkey"
    FOREIGN KEY ("evidenceSessionId") REFERENCES "AiGraderV2Session"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_ai_grader_v2_map_registration_lesson_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'AiGraderV2MapRegistrationLesson rows are immutable';
END;
$$;

CREATE TRIGGER "AiGraderV2MapRegistrationLesson_append_only"
BEFORE UPDATE OR DELETE ON "AiGraderV2MapRegistrationLesson"
FOR EACH ROW
EXECUTE FUNCTION "reject_ai_grader_v2_map_registration_lesson_mutation"();

COMMIT;
