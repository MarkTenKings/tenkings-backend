-- New preparation-only authority. No Vault prerequisites and no historical data rewrite.
BEGIN;

-- CreateTable
CREATE TABLE "AiGraderV2PreparationHead" (
    "sessionId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "sideRevision" INTEGER NOT NULL,
    "activeAttemptId" TEXT NOT NULL,
    "adoptedManifestId" TEXT,

    CONSTRAINT "AiGraderV2PreparationHead_pkey" PRIMARY KEY ("sessionId","side")
);

-- CreateTable
CREATE TABLE "AiGraderV2PreparationAttempt" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "sideRevision" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestSha256" TEXT NOT NULL,
    "expectedSideRevision" INTEGER NOT NULL,
    "expectedAttemptId" TEXT,
    "input" JSONB NOT NULL,
    "inputCanonical" TEXT NOT NULL,
    "dispatchClaimId" TEXT,
    "dispatchClaimedAt" TIMESTAMP(3),
    "terminalOutcome" TEXT,
    "terminalDetails" JSONB,
    "terminalAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGraderV2PreparationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiGraderV2PreparationManifest" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "sideRevision" INTEGER NOT NULL,
    "attemptId" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "bodyCanonical" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGraderV2PreparationManifest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiGraderV2PreparationAttempt_dispatchClaimId_key" ON "AiGraderV2PreparationAttempt"("dispatchClaimId");

-- CreateIndex
CREATE UNIQUE INDEX "AiGraderV2PreparationAttempt_sessionId_side_sideRevision_key" ON "AiGraderV2PreparationAttempt"("sessionId", "side", "sideRevision");

-- CreateIndex
CREATE UNIQUE INDEX "AiGraderV2PreparationAttempt_sessionId_side_idempotencyKey_key" ON "AiGraderV2PreparationAttempt"("sessionId", "side", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiGraderV2PreparationAttempt_sessionId_side_sideRevision_id_key" ON "AiGraderV2PreparationAttempt"("sessionId", "side", "sideRevision", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AiGraderV2PreparationManifest_attemptId_key" ON "AiGraderV2PreparationManifest"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "PreparationManifest_scopedAttempt_key" ON "AiGraderV2PreparationManifest"("sessionId", "side", "sideRevision", "attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "PreparationManifest_scopedIdentity_key" ON "AiGraderV2PreparationManifest"("sessionId", "side", "sideRevision", "attemptId", "id");

-- AddForeignKey
ALTER TABLE "AiGraderV2PreparationHead" ADD CONSTRAINT "AiGraderV2PreparationHead_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiGraderV2Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGraderV2PreparationHead" ADD CONSTRAINT "PreparationHead_activeAttempt_fkey" FOREIGN KEY ("sessionId", "side", "sideRevision", "activeAttemptId") REFERENCES "AiGraderV2PreparationAttempt"("sessionId", "side", "sideRevision", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGraderV2PreparationHead" ADD CONSTRAINT "PreparationHead_adoptedManifest_fkey" FOREIGN KEY ("sessionId", "side", "sideRevision", "activeAttemptId", "adoptedManifestId") REFERENCES "AiGraderV2PreparationManifest"("sessionId", "side", "sideRevision", "attemptId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGraderV2PreparationAttempt" ADD CONSTRAINT "AiGraderV2PreparationAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiGraderV2Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGraderV2PreparationManifest" ADD CONSTRAINT "AiGraderV2PreparationManifest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiGraderV2Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGraderV2PreparationManifest" ADD CONSTRAINT "AiGraderV2PreparationManifest_sessionId_side_sideRevision__fkey" FOREIGN KEY ("sessionId", "side", "sideRevision", "attemptId") REFERENCES "AiGraderV2PreparationAttempt"("sessionId", "side", "sideRevision", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiGraderV2PreparationHead" ADD CONSTRAINT "PreparationHead_shape_check"
  CHECK ("side" IN ('FRONT', 'BACK') AND "sideRevision" > 0);
ALTER TABLE "AiGraderV2PreparationAttempt" ADD CONSTRAINT "PreparationAttempt_shape_check"
  CHECK ((
    "side" IN ('FRONT', 'BACK') AND "sideRevision" > 0
    AND "expectedSideRevision" = "sideRevision" - 1
    AND (("expectedSideRevision" = 0 AND "expectedAttemptId" IS NULL)
      OR ("expectedSideRevision" > 0 AND "expectedAttemptId" IS NOT NULL))
    AND "id" ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    AND "idempotencyKey" ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    AND "requestSha256" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("input") = 'object'
    AND "inputCanonical"::jsonb = "input"
    AND "input"->>'version' = 'speedster-prepared-evidence-v1'
    AND (("dispatchClaimId" IS NULL AND "dispatchClaimedAt" IS NULL)
      OR ("dispatchClaimId" ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' AND "dispatchClaimedAt" IS NOT NULL))
    AND (("terminalOutcome" IS NULL AND "terminalAt" IS NULL AND "terminalDetails" IS NULL)
      OR ("terminalOutcome" IN ('ADOPTED', 'FAILED') AND "terminalAt" IS NOT NULL
        AND jsonb_typeof("terminalDetails") = 'object' AND "dispatchClaimId" IS NOT NULL))
  ) IS TRUE);
ALTER TABLE "AiGraderV2PreparationManifest" ADD CONSTRAINT "PreparationManifest_shape_check"
  CHECK (("side" IN ('FRONT', 'BACK') AND "sideRevision" > 0
    AND "id" ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    AND "manifestSha256" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("body") = 'object'
    AND "bodyCanonical"::jsonb = "body"
    AND "body"->>'version' = 'speedster-prepared-evidence-v1') IS TRUE);

-- Immutability is enforced in the database as well as in transaction adapters.
-- Only dispatch/terminal fields can transition once. No preparation row is deleted.
CREATE FUNCTION "speedsterPreparationAttemptGuard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owned_session "AiGraderV2Session"%ROWTYPE;
  current_head "AiGraderV2PreparationHead"%ROWTYPE;
  adopted "AiGraderV2PreparationManifest"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Preparation history cannot be deleted'; END IF;
  SELECT * INTO owned_session FROM "AiGraderV2Session" WHERE "id" = NEW."sessionId" FOR UPDATE;
  IF NOT FOUND OR owned_session."createdByUserId" IS DISTINCT FROM NEW."createdByUserId"
    OR owned_session."workflowState" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Preparation mutation requires the same owned DRAFT';
  END IF;
  SELECT * INTO current_head FROM "AiGraderV2PreparationHead"
    WHERE "sessionId" = NEW."sessionId" AND "side" = NEW."side";
  IF TG_OP = 'INSERT' THEN
    IF NEW."dispatchClaimId" IS NOT NULL OR NEW."terminalOutcome" IS NOT NULL
      OR NEW."expectedSideRevision" <> COALESCE(current_head."sideRevision", 0)
      OR NEW."expectedAttemptId" IS DISTINCT FROM current_head."activeAttemptId" THEN
      RAISE EXCEPTION 'Preparation begin does not match its previous head';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['dispatchClaimId','dispatchClaimedAt','terminalOutcome','terminalDetails','terminalAt'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['dispatchClaimId','dispatchClaimedAt','terminalOutcome','terminalDetails','terminalAt']) THEN
    RAISE EXCEPTION 'Preparation attempt input is immutable';
  END IF;
  IF OLD."dispatchClaimId" IS NOT NULL AND
    (NEW."dispatchClaimId", NEW."dispatchClaimedAt") IS DISTINCT FROM (OLD."dispatchClaimId", OLD."dispatchClaimedAt") THEN
    RAISE EXCEPTION 'Preparation dispatch claim is write-once';
  END IF;
  IF OLD."dispatchClaimId" IS NULL AND NEW."dispatchClaimId" IS NOT NULL
    AND current_head."activeAttemptId" IS DISTINCT FROM NEW."id" THEN
    RAISE EXCEPTION 'Superseded preparation cannot claim dispatch';
  END IF;
  IF OLD."terminalOutcome" IS NOT NULL AND
    (NEW."terminalOutcome", NEW."terminalDetails", NEW."terminalAt") IS DISTINCT FROM (OLD."terminalOutcome", OLD."terminalDetails", OLD."terminalAt") THEN
    RAISE EXCEPTION 'Preparation terminal result is write-once';
  END IF;
  IF OLD."terminalOutcome" IS NULL AND NEW."terminalOutcome" IS NOT NULL THEN
    IF OLD."dispatchClaimId" IS NULL THEN RAISE EXCEPTION 'Preparation has no prior dispatch claim'; END IF;
    IF NEW."terminalOutcome" = 'ADOPTED' THEN
      SELECT * INTO adopted FROM "AiGraderV2PreparationManifest" WHERE "attemptId" = NEW."id";
      IF NOT FOUND OR current_head."activeAttemptId" IS DISTINCT FROM NEW."id"
        OR NEW."terminalDetails" IS DISTINCT FROM jsonb_build_object('manifestId', adopted."id", 'manifestSha256', adopted."manifestSha256") THEN
        RAISE EXCEPTION 'Preparation adoption lacks its exact manifest';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "speedsterPreparationManifestGuard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owned_session "AiGraderV2Session"%ROWTYPE;
  attempt "AiGraderV2PreparationAttempt"%ROWTYPE;
  current_head "AiGraderV2PreparationHead"%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Adopted preparation manifest is immutable'; END IF;
  SELECT * INTO owned_session FROM "AiGraderV2Session" WHERE "id" = NEW."sessionId" FOR UPDATE;
  IF NOT FOUND OR owned_session."createdByUserId" IS DISTINCT FROM NEW."createdByUserId" OR owned_session."workflowState" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Preparation adoption requires the same owned DRAFT';
  END IF;
  SELECT * INTO attempt FROM "AiGraderV2PreparationAttempt" WHERE "id" = NEW."attemptId";
  SELECT * INTO current_head FROM "AiGraderV2PreparationHead" WHERE "sessionId" = NEW."sessionId" AND "side" = NEW."side";
  IF attempt."createdByUserId" IS DISTINCT FROM NEW."createdByUserId" OR attempt."dispatchClaimId" IS NULL
    OR attempt."terminalOutcome" IS NOT NULL OR current_head."activeAttemptId" IS DISTINCT FROM NEW."attemptId"
    OR NEW."body"->>'sessionId' IS DISTINCT FROM NEW."sessionId"
    OR NEW."body"->>'createdByUserId' IS DISTINCT FROM NEW."createdByUserId"
    OR NEW."body"->>'side' IS DISTINCT FROM NEW."side"
    OR NEW."body"->>'attemptId' IS DISTINCT FROM NEW."attemptId"
    OR NEW."body"->'sideRevision' IS DISTINCT FROM to_jsonb(NEW."sideRevision")
    OR NEW."body"->'input' IS DISTINCT FROM attempt."input" THEN
    RAISE EXCEPTION 'Preparation manifest does not match its current dispatched attempt';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "speedsterPreparationHeadGuard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  state TEXT;
  attempt "AiGraderV2PreparationAttempt"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Preparation head history cannot be deleted'; END IF;
  SELECT "workflowState" INTO state FROM "AiGraderV2Session" WHERE "id" = NEW."sessionId" FOR UPDATE;
  IF state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Preparation head requires DRAFT'; END IF;
  SELECT * INTO attempt FROM "AiGraderV2PreparationAttempt" WHERE "id" = NEW."activeAttemptId";
  IF TG_OP = 'INSERT' THEN
    IF NEW."sideRevision" <> 1 OR NEW."adoptedManifestId" IS NOT NULL THEN RAISE EXCEPTION 'Invalid initial preparation head'; END IF;
  ELSE
    IF (NEW."sessionId", NEW."side") IS DISTINCT FROM (OLD."sessionId", OLD."side") THEN
      RAISE EXCEPTION 'Preparation head scope is immutable';
    END IF;
    IF NEW."sideRevision" = OLD."sideRevision" THEN
      IF NEW."activeAttemptId" <> OLD."activeAttemptId"
        OR (OLD."adoptedManifestId" IS NOT NULL AND NEW."adoptedManifestId" IS DISTINCT FROM OLD."adoptedManifestId") THEN
        RAISE EXCEPTION 'Preparation head adoption is write-once';
      END IF;
    ELSIF NEW."sideRevision" <> OLD."sideRevision" + 1 OR NEW."adoptedManifestId" IS NOT NULL
      OR attempt."expectedAttemptId" IS DISTINCT FROM OLD."activeAttemptId" THEN
      RAISE EXCEPTION 'Preparation head revision must advance exactly once';
    END IF;
  END IF;
  IF NEW."adoptedManifestId" IS NOT NULL AND attempt."terminalOutcome" IS DISTINCT FROM 'ADOPTED' THEN
    RAISE EXCEPTION 'Preparation head lacks terminal adoption';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PreparationAttempt_immutable_guard" BEFORE INSERT OR UPDATE OR DELETE
  ON "AiGraderV2PreparationAttempt" FOR EACH ROW EXECUTE FUNCTION "speedsterPreparationAttemptGuard"();
CREATE TRIGGER "PreparationManifest_immutable_guard" BEFORE INSERT OR UPDATE OR DELETE
  ON "AiGraderV2PreparationManifest" FOR EACH ROW EXECUTE FUNCTION "speedsterPreparationManifestGuard"();
CREATE TRIGGER "PreparationHead_transition_guard" BEFORE INSERT OR UPDATE OR DELETE
  ON "AiGraderV2PreparationHead" FOR EACH ROW EXECUTE FUNCTION "speedsterPreparationHeadGuard"();

CREATE FUNCTION "speedsterPreparationAdoptionCommitGuard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  attempt "AiGraderV2PreparationAttempt"%ROWTYPE;
  manifest "AiGraderV2PreparationManifest"%ROWTYPE;
  current_head "AiGraderV2PreparationHead"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'AiGraderV2PreparationManifest' THEN
    SELECT * INTO attempt FROM "AiGraderV2PreparationAttempt" WHERE "id" = NEW."attemptId";
  ELSE
    SELECT * INTO attempt FROM "AiGraderV2PreparationAttempt" WHERE "id" = NEW."id";
    IF attempt."terminalOutcome" IS DISTINCT FROM 'ADOPTED' THEN RETURN NULL; END IF;
  END IF;
  SELECT * INTO manifest FROM "AiGraderV2PreparationManifest" WHERE "attemptId" = attempt."id";
  SELECT * INTO current_head FROM "AiGraderV2PreparationHead" WHERE "sessionId" = attempt."sessionId" AND "side" = attempt."side";
  IF manifest."id" IS NULL OR attempt."terminalOutcome" IS DISTINCT FROM 'ADOPTED'
    OR attempt."terminalDetails" IS DISTINCT FROM jsonb_build_object('manifestId', manifest."id", 'manifestSha256', manifest."manifestSha256")
    OR (current_head."activeAttemptId" = attempt."id" AND current_head."adoptedManifestId" IS DISTINCT FROM manifest."id") THEN
    RAISE EXCEPTION 'Preparation adoption must commit its manifest, terminal result and head atomically';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "PreparationManifest_atomic_adoption" AFTER INSERT
  ON "AiGraderV2PreparationManifest" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "speedsterPreparationAdoptionCommitGuard"();
CREATE CONSTRAINT TRIGGER "PreparationAttempt_atomic_adoption" AFTER UPDATE
  ON "AiGraderV2PreparationAttempt" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "speedsterPreparationAdoptionCommitGuard"();

CREATE FUNCTION "speedsterPreparationRejectTruncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Preparation evidence cannot be truncated';
END;
$$;
CREATE TRIGGER "PreparationHead_no_truncate" BEFORE TRUNCATE ON "AiGraderV2PreparationHead"
  FOR EACH STATEMENT EXECUTE FUNCTION "speedsterPreparationRejectTruncate"();
CREATE TRIGGER "PreparationAttempt_no_truncate" BEFORE TRUNCATE ON "AiGraderV2PreparationAttempt"
  FOR EACH STATEMENT EXECUTE FUNCTION "speedsterPreparationRejectTruncate"();
CREATE TRIGGER "PreparationManifest_no_truncate" BEFORE TRUNCATE ON "AiGraderV2PreparationManifest"
  FOR EACH STATEMENT EXECUTE FUNCTION "speedsterPreparationRejectTruncate"();

COMMIT;
