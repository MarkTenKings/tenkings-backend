-- Additive, append-only proposal-versus-human evidence. Existing sessions and
-- completed cards are not rewritten or backfilled.
BEGIN;

CREATE TABLE "AiGraderV2ColorGeometryEvidence" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "matColor" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "policyProvenance" TEXT NOT NULL,
    "sourceImageStorageKey" TEXT NOT NULL,
    "sourceImageSha256" TEXT NOT NULL,
    "proposal" JSONB,
    "confirmedQuad" JSONB NOT NULL,
    "diagnostics" JSONB NOT NULL,
    "proposalChanged" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGraderV2ColorGeometryEvidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiGraderV2ColorGeometryEvidence_side_check" CHECK ("side" IN ('FRONT', 'BACK')),
    CONSTRAINT "AiGraderV2ColorGeometryEvidence_mode_check" CHECK ("mode" IN ('PHYSICAL_OUTER', 'PRINTED_FRAME')),
    CONSTRAINT "AiGraderV2ColorGeometryEvidence_matColor_check" CHECK ("matColor" IN ('BLACK', 'WHITE', 'MAGENTA')),
    CONSTRAINT "AiGraderV2ColorGeometryEvidence_outcome_check" CHECK ("outcome" IN ('ACCEPTED', 'INSUFFICIENT_EVIDENCE', 'NOT_APPLICABLE', 'ABSTAIN')),
    CONSTRAINT "AiGraderV2ColorGeometryEvidence_engineVersion_check" CHECK ("engineVersion" = 'speedster-color-geometry-v1'),
    CONSTRAINT "AiGraderV2ColorGeometryEvidence_policyProvenance_check" CHECK ("policyProvenance" = 'OWNER_APPROVED_OFFLINE_ESTIMATE_V1_NOT_LIVE_CALIBRATED'),
    CONSTRAINT "AiGraderV2ColorGeometryEvidence_sourceImageSha256_check" CHECK ("sourceImageSha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "AiGraderV2ColorGeometryEvidence_proposal_consistency_check" CHECK (
      ("outcome" = 'ACCEPTED' AND "proposal" IS NOT NULL AND "proposalChanged" IS NOT NULL)
      OR ("outcome" <> 'ACCEPTED' AND "proposal" IS NULL AND "proposalChanged" IS NULL)
    )
);

CREATE UNIQUE INDEX "AiGraderV2ColorGeometryEvidence_sessionId_side_mode_key"
    ON "AiGraderV2ColorGeometryEvidence"("sessionId", "side", "mode");
CREATE INDEX "AiGraderV2ColorGeometryEvidence_createdByUserId_createdAt_idx"
    ON "AiGraderV2ColorGeometryEvidence"("createdByUserId", "createdAt");
CREATE INDEX "AiGraderV2ColorGeometryEvidence_side_matColor_outcome_createdAt_idx"
    ON "AiGraderV2ColorGeometryEvidence"("side", "matColor", "outcome", "createdAt");

ALTER TABLE "AiGraderV2ColorGeometryEvidence"
    ADD CONSTRAINT "AiGraderV2ColorGeometryEvidence_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "AiGraderV2Session"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_ai_grader_v2_color_geometry_evidence_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'AiGraderV2ColorGeometryEvidence rows are immutable';
END;
$$;

CREATE TRIGGER "AiGraderV2ColorGeometryEvidence_append_only"
BEFORE UPDATE OR DELETE ON "AiGraderV2ColorGeometryEvidence"
FOR EACH ROW
EXECUTE FUNCTION "reject_ai_grader_v2_color_geometry_evidence_mutation"();

COMMIT;
