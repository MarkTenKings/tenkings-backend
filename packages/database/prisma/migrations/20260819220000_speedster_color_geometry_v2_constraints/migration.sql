-- Preserve immutable v1 rows as historical audit evidence while enforcing
-- the approved current Color Geometry identity for every new row.
BEGIN;

ALTER TABLE "AiGraderV2ColorGeometryEvidence"
    ADD CONSTRAINT "AiGraderV2ColorGeometryEvidence_engineVersion_v2_guard"
    CHECK ("engineVersion" = 'speedster-color-geometry-v2') NOT VALID,
    ADD CONSTRAINT "AiGraderV2ColorGeometryEvidence_policyProvenance_v2_guard"
    CHECK ("policyProvenance" = 'OWNER_APPROVED_VISIBLE_OUTLINE_V2') NOT VALID;

ALTER TABLE "AiGraderV2ColorGeometryEvidence"
    DROP CONSTRAINT "AiGraderV2ColorGeometryEvidence_engineVersion_check",
    DROP CONSTRAINT "AiGraderV2ColorGeometryEvidence_policyProvenance_check";

ALTER TABLE "AiGraderV2ColorGeometryEvidence"
    RENAME CONSTRAINT "AiGraderV2ColorGeometryEvidence_engineVersion_v2_guard"
    TO "AiGraderV2ColorGeometryEvidence_engineVersion_check";

ALTER TABLE "AiGraderV2ColorGeometryEvidence"
    RENAME CONSTRAINT "AiGraderV2ColorGeometryEvidence_policyProvenance_v2_guard"
    TO "AiGraderV2ColorGeometryEvidence_policyProvenance_check";

COMMIT;
