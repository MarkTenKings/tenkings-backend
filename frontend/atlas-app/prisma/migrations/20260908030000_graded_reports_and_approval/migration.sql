BEGIN;
SET LOCAL search_path TO atlas_staff, pg_catalog;

-- AlterTable
ALTER TABLE "StaffSpecimen" ADD COLUMN     "analysisRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StaffReviewRevision" ADD COLUMN     "analysisRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StaffAnalysisRevision" (
    "specimenId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "evidenceHash" VARCHAR(64) NOT NULL,
    "sourceCanonical" TEXT NOT NULL,
    "sourceHash" VARCHAR(64) NOT NULL,
    "reportCanonical" TEXT NOT NULL,
    "reportHash" VARCHAR(64) NOT NULL,
    "admissionCanonical" TEXT NOT NULL,
    "admissionHash" VARCHAR(64) NOT NULL,
    "sourceRevision" VARCHAR(80) NOT NULL,
    "mode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAnalysisRevision_pkey" PRIMARY KEY ("specimenId","revision")
);

-- CreateTable
CREATE TABLE "StaffGradingOperation" (
    "id" UUID NOT NULL,
    "specimenId" UUID NOT NULL,
    "operationId" VARCHAR(80) NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorId" VARCHAR(100) NOT NULL,
    "sessionHash" VARCHAR(64),
    "assignmentFence" INTEGER,
    "controlRevision" INTEGER NOT NULL,
    "evidenceHash" VARCHAR(64) NOT NULL,
    "expectedAnalysisRevision" INTEGER NOT NULL,
    "expectedReviewRevision" INTEGER NOT NULL,
    "requestCanonical" TEXT NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "state" TEXT NOT NULL,
    "dispatchClaimId" UUID NOT NULL,
    "leaseFence" INTEGER NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "resultAnalysisRevision" INTEGER,
    "failureCode" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "StaffGradingOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffReportApproval" (
    "id" UUID NOT NULL,
    "specimenId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "analysisRevision" INTEGER NOT NULL,
    "reviewRevision" INTEGER NOT NULL,
    "evidenceHash" VARCHAR(64) NOT NULL,
    "analysisHash" VARCHAR(64) NOT NULL,
    "reviewHash" VARCHAR(64) NOT NULL,
    "publicCanonical" TEXT NOT NULL,
    "publicHash" VARCHAR(64) NOT NULL,
    "actorId" UUID NOT NULL,
    "sessionHash" VARCHAR(64) NOT NULL,
    "accessVersion" INTEGER NOT NULL,
    "assignmentFence" INTEGER NOT NULL,
    "controlRevision" INTEGER NOT NULL,
    "operationId" VARCHAR(80) NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffReportApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffPublicReport" (
    "specimenId" UUID NOT NULL,
    "publicToken" VARCHAR(40) NOT NULL,
    "reportNumber" VARCHAR(24) NOT NULL,
    "currentApprovalId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPublicReport_pkey" PRIMARY KEY ("specimenId")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffGradingOperation_dispatchClaimId_key" ON "StaffGradingOperation"("dispatchClaimId");

-- CreateIndex
CREATE INDEX "StaffGradingOperation_specimenId_state_idx" ON "StaffGradingOperation"("specimenId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "StaffGradingOperation_specimenId_operationId_key" ON "StaffGradingOperation"("specimenId", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffReportApproval_specimenId_version_key" ON "StaffReportApproval"("specimenId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "StaffReportApproval_actorId_operationId_key" ON "StaffReportApproval"("actorId", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffPublicReport_publicToken_key" ON "StaffPublicReport"("publicToken");

-- CreateIndex
CREATE UNIQUE INDEX "StaffPublicReport_reportNumber_key" ON "StaffPublicReport"("reportNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StaffPublicReport_currentApprovalId_key" ON "StaffPublicReport"("currentApprovalId");

-- AddForeignKey
ALTER TABLE "StaffAnalysisRevision" ADD CONSTRAINT "StaffAnalysisRevision_specimenId_fkey" FOREIGN KEY ("specimenId") REFERENCES "StaffSpecimen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffGradingOperation" ADD CONSTRAINT "StaffGradingOperation_specimenId_fkey" FOREIGN KEY ("specimenId") REFERENCES "StaffSpecimen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffReportApproval" ADD CONSTRAINT "StaffReportApproval_specimenId_fkey" FOREIGN KEY ("specimenId") REFERENCES "StaffSpecimen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffReportApproval" ADD CONSTRAINT "StaffReportApproval_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "StaffIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPublicReport" ADD CONSTRAINT "StaffPublicReport_specimenId_fkey" FOREIGN KEY ("specimenId") REFERENCES "StaffSpecimen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "StaffControl" ADD COLUMN "gradingPolicyHash" VARCHAR(64);
ALTER TABLE "StaffControl" ADD CONSTRAINT "StaffControl_grading_policy" CHECK ("gradingPolicyHash" IS NULL OR "gradingPolicyHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "StaffAnalysisRevision" ADD COLUMN "operationId" UUID;
CREATE UNIQUE INDEX "StaffAnalysisRevision_operationId_key" ON "StaffAnalysisRevision"("operationId");
ALTER TABLE "StaffAnalysisRevision" ADD CONSTRAINT "StaffAnalysisRevision_operation_fkey"
  FOREIGN KEY ("operationId") REFERENCES "StaffGradingOperation"(id) ON DELETE RESTRICT;

ALTER TABLE "StaffSpecimen" ADD CONSTRAINT "StaffSpecimen_analysis_revision" CHECK ("analysisRevision" >= 0);
ALTER TABLE "StaffReviewRevision" ADD CONSTRAINT "StaffReviewRevision_analysis_revision" CHECK ("analysisRevision" >= 0);
ALTER TABLE "StaffAnalysisRevision" ADD CONSTRAINT "StaffAnalysisRevision_shape" CHECK ((
  revision > 0 AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND mode IN ('LOCAL_FIXTURE','PRODUCTION')
  AND (mode='LOCAL_FIXTURE' OR "operationId" IS NOT NULL)
  AND octet_length("sourceCanonical") <= 33554432 AND jsonb_typeof("sourceCanonical"::jsonb) = 'object'
  AND octet_length("reportCanonical") <= 33554432 AND "reportCanonical"::jsonb->>'version' = 'atlas-graded-report-v1'
  AND octet_length("admissionCanonical") <= 131072 AND jsonb_typeof("admissionCanonical"::jsonb) = 'object'
  AND "sourceHash" = encode(sha256(convert_to("sourceCanonical",'UTF8')),'hex')
  AND "reportHash" = encode(sha256(convert_to("reportCanonical",'UTF8')),'hex')
  AND "admissionHash" = encode(sha256(convert_to("admissionCanonical",'UTF8')),'hex')
) IS TRUE);
ALTER TABLE "StaffGradingOperation" ADD CONSTRAINT "StaffGradingOperation_shape" CHECK ((
  "actorKind" IN ('HUMAN','ASTRA') AND "controlRevision">0 AND "expectedAnalysisRevision">=0 AND "expectedReviewRevision">0
  AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "leaseFence">0 AND "leaseExpiresAt">"createdAt"
  AND "leaseExpiresAt" <= "createdAt" + interval '5 minutes'
  AND state IN ('RESERVED','DISPATCHED','SUCCEEDED','FAILED','UNKNOWN')
  AND octet_length("requestCanonical") <= 1048576 AND jsonb_typeof("requestCanonical"::jsonb)='object'
  AND "inputHash" = encode(sha256(convert_to("requestCanonical",'UTF8')),'hex')
  AND (("actorKind"='HUMAN' AND "sessionHash" ~ '^[a-f0-9]{64}$' AND "assignmentFence">0)
    OR ("actorKind"='ASTRA' AND "sessionHash" IS NULL AND "assignmentFence" IS NULL))
  AND ((state='RESERVED' AND "dispatchedAt" IS NULL AND "finishedAt" IS NULL AND "resultAnalysisRevision" IS NULL AND "failureCode" IS NULL)
    OR (state IN ('DISPATCHED','UNKNOWN') AND "dispatchedAt" IS NOT NULL AND "finishedAt" IS NULL AND "resultAnalysisRevision" IS NULL)
    OR (state='SUCCEEDED' AND "dispatchedAt" IS NOT NULL AND "finishedAt" IS NOT NULL AND "resultAnalysisRevision"="expectedAnalysisRevision"+1 AND "failureCode" IS NULL)
    OR (state='FAILED' AND "finishedAt" IS NOT NULL AND "resultAnalysisRevision" IS NULL AND "failureCode" IS NOT NULL))
) IS TRUE);
ALTER TABLE "StaffReportApproval" ADD CONSTRAINT "StaffReportApproval_shape" CHECK ((
  version>0 AND "analysisRevision">0 AND "reviewRevision">0 AND "accessVersion">0 AND "assignmentFence">0 AND "controlRevision">0
  AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "analysisHash" ~ '^[a-f0-9]{64}$' AND "reviewHash" ~ '^[a-f0-9]{64}$'
  AND "sessionHash" ~ '^[a-f0-9]{64}$' AND "inputHash" ~ '^[a-f0-9]{64}$'
  AND octet_length("publicCanonical") <= 4194304 AND "publicCanonical"::jsonb->>'version'='atlas-public-report-v1'
  AND ("publicCanonical"::jsonb->>'approvalVersion')::int=version
  AND "publicCanonical"::jsonb->>'evidenceHash'="evidenceHash"
  AND "publicCanonical"::jsonb->>'analysisHash'="analysisHash"
  AND "publicHash"=encode(sha256(convert_to("publicCanonical",'UTF8')),'hex')
) IS TRUE);
ALTER TABLE "StaffPublicReport" ADD CONSTRAINT "StaffPublicReport_shape" CHECK (
  "publicToken" ~ '^ar_[A-Za-z0-9_-]{24}$' AND "reportNumber" ~ '^ATLAS-[A-F0-9]{12}$');
ALTER TABLE "StaffReportApproval" ADD CONSTRAINT "StaffReportApproval_analysis_fkey"
  FOREIGN KEY ("specimenId","analysisRevision") REFERENCES "StaffAnalysisRevision"("specimenId",revision) ON DELETE RESTRICT;
ALTER TABLE "StaffReportApproval" ADD CONSTRAINT "StaffReportApproval_review_fkey"
  FOREIGN KEY ("specimenId","reviewRevision") REFERENCES "StaffReviewRevision"("specimenId",revision) ON DELETE RESTRICT;
ALTER TABLE "StaffPublicReport" ADD CONSTRAINT "StaffPublicReport_approval_fkey"
  FOREIGN KEY ("currentApprovalId") REFERENCES "StaffReportApproval"(id) ON DELETE RESTRICT;

CREATE TRIGGER "StaffAnalysisRevision_immutable" BEFORE UPDATE OR DELETE ON "StaffAnalysisRevision"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffReportApproval_immutable" BEFORE UPDATE OR DELETE ON "StaffReportApproval"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffPublicReport_no_delete" BEFORE DELETE ON "StaffPublicReport"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffGradingOperation_no_delete" BEFORE DELETE ON "StaffGradingOperation"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['StaffAnalysisRevision','StaffReportApproval','StaffPublicReport','StaffGradingOperation'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON atlas_staff.%I FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable()', t || '_no_truncate', t);
  END LOOP;
END; $$;

CREATE FUNCTION atlas_staff.staff_analysis_head_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,atlas_staff AS $$
DECLARE s atlas_staff."StaffSpecimen"%ROWTYPE; a atlas_staff."StaffAnalysisRevision"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='StaffSpecimen' THEN SELECT * INTO s FROM atlas_staff."StaffSpecimen" WHERE id=NEW.id;
  ELSE SELECT * INTO s FROM atlas_staff."StaffSpecimen" WHERE id=NEW."specimenId";
    IF NEW.revision>s."analysisRevision" THEN RAISE EXCEPTION 'ATLAS analysis cannot precede its committed head'; END IF;
  END IF;
  IF s."analysisRevision"=0 THEN RETURN NULL; END IF;
  SELECT * INTO a FROM atlas_staff."StaffAnalysisRevision" WHERE "specimenId"=s.id AND revision=s."analysisRevision";
  IF a."specimenId" IS NULL OR a."evidenceHash"<>s."evidenceHash"
    OR (a.mode='PRODUCTION' AND s."sourceType"<>'SPEEDSTER')
    OR (a.mode='LOCAL_FIXTURE' AND s."sourceType"<>'LOCAL_FIXTURE') THEN
    RAISE EXCEPTION 'ATLAS analysis head must commit exact evidence and mode'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER "StaffSpecimen_analysis_commit" AFTER INSERT OR UPDATE ON "StaffSpecimen" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_analysis_head_guard();
CREATE CONSTRAINT TRIGGER "StaffAnalysisRevision_head_commit" AFTER INSERT ON "StaffAnalysisRevision" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_analysis_head_guard();
CREATE FUNCTION atlas_staff.staff_analysis_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."analysisRevision"<>OLD."analysisRevision" AND NEW."analysisRevision"<>OLD."analysisRevision"+1 THEN
    RAISE EXCEPTION 'ATLAS analysis revision must advance once'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "StaffSpecimen_analysis_revision_guard" BEFORE UPDATE ON "StaffSpecimen"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_analysis_revision_guard();

CREATE OR REPLACE FUNCTION atlas_staff.staff_review_commit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, atlas_staff AS $$
DECLARE s atlas_staff."StaffSpecimen"%ROWTYPE; r atlas_staff."StaffReviewRevision"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'StaffSpecimen' THEN SELECT * INTO s FROM atlas_staff."StaffSpecimen" WHERE id = NEW.id;
  ELSE SELECT * INTO s FROM atlas_staff."StaffSpecimen" WHERE id = NEW."specimenId"; END IF;
  IF TG_TABLE_NAME = 'StaffReviewRevision' THEN
    IF NEW.revision > s."draftRevision" THEN RAISE EXCEPTION 'ATLAS revision cannot precede its committed head'; END IF;
  END IF;
  SELECT * INTO r FROM atlas_staff."StaffReviewRevision" WHERE "specimenId" = s.id AND revision = s."draftRevision";
  IF r."specimenId" IS NULL OR r."evidenceRevision" <> s."evidenceRevision" OR r."evidenceHash" <> s."evidenceHash"
    OR r."analysisRevision"<>s."analysisRevision" THEN
    RAISE EXCEPTION 'ATLAS review head must commit its exact immutable revision'; END IF;
  RETURN NULL;
END; $$;

CREATE FUNCTION atlas_staff.staff_grading_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'RESERVED' THEN RAISE EXCEPTION 'ATLAS grading operation requires a reservation'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['state','dispatchedAt','finishedAt','resultAnalysisRevision','failureCode'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','dispatchedAt','finishedAt','resultAnalysisRevision','failureCode']) THEN
    RAISE EXCEPTION 'ATLAS grading operation binding is immutable'; END IF;
  IF OLD.state IN ('SUCCEEDED','FAILED') THEN RAISE EXCEPTION 'ATLAS terminal grading operation is immutable'; END IF;
  IF OLD."dispatchedAt" IS NOT NULL AND NEW."dispatchedAt" IS DISTINCT FROM OLD."dispatchedAt" THEN
    RAISE EXCEPTION 'ATLAS grading dispatch is write-once'; END IF;
  IF (OLD.state='RESERVED' AND NEW.state IN ('DISPATCHED','FAILED'))
    OR (OLD.state='DISPATCHED' AND NEW.state IN ('UNKNOWN','SUCCEEDED','FAILED'))
    OR (OLD.state='UNKNOWN' AND NEW.state IN ('SUCCEEDED','FAILED')) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'ATLAS grading operation transition is invalid';
END; $$;
CREATE TRIGGER "StaffGradingOperation_transition" BEFORE INSERT OR UPDATE ON "StaffGradingOperation"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_grading_operation_guard();

CREATE FUNCTION atlas_staff.staff_report_approval_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,atlas_staff AS $$
DECLARE s atlas_staff."StaffSpecimen"%ROWTYPE; a atlas_staff."StaffAnalysisRevision"%ROWTYPE; r atlas_staff."StaffReviewRevision"%ROWTYPE;
  i atlas_staff."StaffIdentity"%ROWTYPE; sess atlas_staff."StaffSession"%ROWTYPE; assignment atlas_staff."StaffAssignment"%ROWTYPE;
  control atlas_staff."StaffControl"%ROWTYPE; browser atlas_staff."StaffBrowser"%ROWTYPE; now_at timestamp:=clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  SELECT * INTO control FROM atlas_staff.lock_control();
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id=NEW."actorId" FOR SHARE;
  SELECT * INTO sess FROM atlas_staff."StaffSession" WHERE "tokenHash"=NEW."sessionHash" FOR SHARE;
  SELECT * INTO browser FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=sess."browserHash";
  SELECT * INTO assignment FROM atlas_staff.lock_assignment(NEW."specimenId", NEW."actorId");
  SELECT * INTO s FROM atlas_staff."StaffSpecimen" WHERE id=NEW."specimenId" FOR UPDATE;
  SELECT * INTO a FROM atlas_staff."StaffAnalysisRevision" WHERE "specimenId"=s.id AND revision=s."analysisRevision";
  SELECT * INTO r FROM atlas_staff."StaffReviewRevision" WHERE "specimenId"=s.id AND revision=s."draftRevision";
  IF (control.enabled AND control.revision=NEW."controlRevision" AND control.mode=a.mode
    AND i.id=NEW."actorId" AND i.role='REVIEWER' AND i."revokedAt" IS NULL AND i."certificationUntil">now_at AND i."accessVersion"=NEW."accessVersion"
    AND sess."identityId"=i.id AND sess."revokedAt" IS NULL AND sess."expiresAt">now_at AND sess."accessVersion"=i."accessVersion"
    AND sess."controlRevision"=control.revision AND sess."createdAt">now_at-interval '15 minutes'
    AND browser."expiresAt">now_at AND browser."controlRevision"=control.revision
    AND assignment."canReview" AND assignment."revokedAt" IS NULL AND assignment."expiresAt">now_at AND assignment.fence=NEW."assignmentFence"
    AND a.revision=NEW."analysisRevision" AND a."sourceHash"=NEW."analysisHash" AND a."evidenceHash"=NEW."evidenceHash"
    AND control."gradingPolicyHash"=a."admissionCanonical"::jsonb->>'policyHash'
    AND a."admissionCanonical"::jsonb->>'purpose'='atlas-analysis-admission-v1'
    AND NEW."publicCanonical"::jsonb->>'mode'=a.mode
    AND r.revision=NEW."reviewRevision" AND r."contentHash"=NEW."reviewHash" AND r."analysisRevision"=a.revision
    AND r.canonical::jsonb->>'disposition'='READY_FOR_HUMAN'
    AND NEW."approvedAt">now_at-interval '5 seconds' AND NEW."approvedAt"<=now_at
  ) IS NOT TRUE THEN RAISE EXCEPTION 'ATLAS approval requires a fresh trained human and exact current review'; END IF;
  IF EXISTS (SELECT 1 FROM atlas_staff."StaffGradingOperation" WHERE "specimenId"=s.id AND state IN ('RESERVED','DISPATCHED','UNKNOWN')) THEN
    RAISE EXCEPTION 'ATLAS grading work must be resolved before approval'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "StaffReportApproval_authority" BEFORE INSERT ON "StaffReportApproval"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_report_approval_guard();

CREATE FUNCTION atlas_staff.staff_public_report_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,atlas_staff AS $$
DECLARE p atlas_staff."StaffPublicReport"%ROWTYPE; a atlas_staff."StaffReportApproval"%ROWTYPE; prior atlas_staff."StaffReportApproval"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='StaffPublicReport' THEN
    p:=NEW;
    IF TG_OP='UPDATE' THEN
      IF (NEW."specimenId",NEW."publicToken",NEW."reportNumber",NEW."createdAt")
        IS DISTINCT FROM (OLD."specimenId",OLD."publicToken",OLD."reportNumber",OLD."createdAt") THEN
        RAISE EXCEPTION 'ATLAS public report identity is permanent'; END IF;
      SELECT * INTO prior FROM atlas_staff."StaffReportApproval" WHERE id=OLD."currentApprovalId";
    END IF;
  ELSE SELECT * INTO p FROM atlas_staff."StaffPublicReport" WHERE "specimenId"=NEW."specimenId"; END IF;
  SELECT * INTO a FROM atlas_staff."StaffReportApproval" WHERE id=p."currentApprovalId";
  IF a.id IS NULL OR a."specimenId"<>p."specimenId" OR a."publicCanonical"::jsonb->>'publicToken' IS DISTINCT FROM p."publicToken"
    OR a."publicCanonical"::jsonb->>'reportNumber' IS DISTINCT FROM p."reportNumber" THEN
    RAISE EXCEPTION 'ATLAS publication must commit its exact approved projection'; END IF;
  IF TG_TABLE_NAME='StaffPublicReport' THEN
    IF (TG_OP='INSERT' AND a.version<>1) OR (TG_OP='UPDATE' AND a.version<>prior.version+1) THEN
      RAISE EXCEPTION 'ATLAS publication version must advance once'; END IF;
  ELSIF p."currentApprovalId"<>NEW.id THEN RAISE EXCEPTION 'ATLAS approval and publication must commit together'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER "StaffPublicReport_atomic_approval" AFTER INSERT OR UPDATE ON "StaffPublicReport" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_public_report_binding();
CREATE CONSTRAINT TRIGGER "StaffReportApproval_atomic_publication" AFTER INSERT ON "StaffReportApproval" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_public_report_binding();

CREATE FUNCTION atlas_staff.staff_grading_result_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,atlas_staff AS $$
DECLARE op atlas_staff."StaffGradingOperation"%ROWTYPE; a atlas_staff."StaffAnalysisRevision"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='StaffAnalysisRevision' THEN
    IF NEW."operationId" IS NULL AND NEW.mode='LOCAL_FIXTURE' THEN RETURN NULL; END IF;
    SELECT * INTO op FROM atlas_staff."StaffGradingOperation" WHERE id=NEW."operationId";
  ELSE SELECT * INTO op FROM atlas_staff."StaffGradingOperation" WHERE id=NEW.id; END IF;
  SELECT * INTO a FROM atlas_staff."StaffAnalysisRevision" WHERE "operationId"=op.id;
  IF op.state<>'SUCCEEDED' AND a."specimenId" IS NULL THEN RETURN NULL; END IF;
  IF op.id IS NULL OR a."specimenId" IS NULL OR op.state<>'SUCCEEDED' OR a."specimenId"<>op."specimenId"
    OR a.revision<>op."expectedAnalysisRevision"+1 OR a.revision<>op."resultAnalysisRevision" OR a."evidenceHash"<>op."evidenceHash" THEN
    RAISE EXCEPTION 'ATLAS analysis must commit with its exact successful grading operation'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER "StaffAnalysisRevision_operation_commit" AFTER INSERT ON "StaffAnalysisRevision" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_grading_result_guard();
CREATE CONSTRAINT TRIGGER "StaffGradingOperation_result_commit" AFTER UPDATE ON "StaffGradingOperation" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_grading_result_guard();

COMMIT;

-- Prisma timestamp fields contain UTC wall-clock values. Avoid session-time-zone
-- reinterpretation when enforcing quarantine or materializing database defaults.
ALTER FUNCTION atlas_staff.staff_challenge_guard() SET timezone = 'UTC';
ALTER TABLE atlas_staff."StaffControl" ALTER COLUMN "updatedAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE atlas_staff."StaffIdentity" ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE atlas_staff."StaffIdentity" ALTER COLUMN "lastLoginAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE atlas_staff."StaffBrowser" ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE atlas_staff."StaffChallenge" ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE atlas_staff."StaffSession" ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE atlas_staff."StaffAudit" ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE atlas_staff."StaffSpecimen" ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE atlas_staff."StaffReviewRevision" ALTER COLUMN "savedAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE atlas_staff."StaffOperation" ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE atlas_staff."StaffAnalysisRevision" ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE atlas_staff."StaffGradingOperation" ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE atlas_staff."StaffReportApproval" ALTER COLUMN "approvedAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE atlas_staff."StaffPublicReport" ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
