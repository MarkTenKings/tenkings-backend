-- Preserve existing insert/idempotency behavior while making historical
-- Speedster audit evidence immutable at the database boundary.
BEGIN;

CREATE FUNCTION "reject_ai_grader_v2_audit_evidence_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "AiGraderV2InstrumentationEvent_append_only"
BEFORE UPDATE OR DELETE ON "AiGraderV2InstrumentationEvent"
FOR EACH ROW
EXECUTE FUNCTION "reject_ai_grader_v2_audit_evidence_mutation"();

CREATE TRIGGER "AiGraderV2InstrumentationEvent_no_truncate"
BEFORE TRUNCATE ON "AiGraderV2InstrumentationEvent"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_ai_grader_v2_audit_evidence_mutation"();

CREATE TRIGGER "AiGraderV2MapFilterDecision_append_only"
BEFORE UPDATE OR DELETE ON "AiGraderV2MapFilterDecision"
FOR EACH ROW
EXECUTE FUNCTION "reject_ai_grader_v2_audit_evidence_mutation"();

CREATE TRIGGER "AiGraderV2MapFilterDecision_no_truncate"
BEFORE TRUNCATE ON "AiGraderV2MapFilterDecision"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_ai_grader_v2_audit_evidence_mutation"();

CREATE TRIGGER "AiGraderV2MapFilterRestoreEvent_append_only"
BEFORE UPDATE OR DELETE ON "AiGraderV2MapFilterRestoreEvent"
FOR EACH ROW
EXECUTE FUNCTION "reject_ai_grader_v2_audit_evidence_mutation"();

CREATE TRIGGER "AiGraderV2MapFilterRestoreEvent_no_truncate"
BEFORE TRUNCATE ON "AiGraderV2MapFilterRestoreEvent"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_ai_grader_v2_audit_evidence_mutation"();

COMMIT;
