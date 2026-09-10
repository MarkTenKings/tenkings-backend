BEGIN;

CREATE SCHEMA IF NOT EXISTS atlas_staff;
SET LOCAL search_path TO atlas_staff, pg_catalog;

-- CreateTable
CREATE TABLE "StaffControl" (
    "id" TEXT NOT NULL DEFAULT 'active',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "releaseSha" VARCHAR(40) NOT NULL,
    "configHash" VARCHAR(64) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffIdentity" (
    "id" UUID NOT NULL,
    "phoneHash" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL DEFAULT 'Staff member',
    "role" TEXT NOT NULL DEFAULT 'REVIEWER',
    "accessVersion" INTEGER NOT NULL DEFAULT 1,
    "revokedAt" TIMESTAMP(3),
    "certificationUntil" TIMESTAMP(3),
    "trustedLearningUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffBrowser" (
    "tokenHash" VARCHAR(64) NOT NULL,
    "controlRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffBrowser_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "StaffChallenge" (
    "id" VARCHAR(43) NOT NULL,
    "browserHash" VARCHAR(64) NOT NULL,
    "requestId" VARCHAR(80) NOT NULL,
    "phoneHash" VARCHAR(64) NOT NULL,
    "controlRevision" INTEGER NOT NULL,
    "accountSid" VARCHAR(34) NOT NULL,
    "serviceSid" VARCHAR(34) NOT NULL,
    "verificationSid" VARCHAR(34),
    "state" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sendClaimId" UUID NOT NULL,
    "checkClaimId" UUID,
    "replayHash" VARCHAR(64),
    "replayUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "quarantineUntil" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "StaffChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSession" (
    "tokenHash" VARCHAR(64) NOT NULL,
    "identityId" UUID NOT NULL,
    "browserHash" VARCHAR(64) NOT NULL,
    "challengeId" VARCHAR(43) NOT NULL,
    "controlRevision" INTEGER NOT NULL,
    "accessVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "StaffRateBucket" (
    "key" VARCHAR(100) NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffRateBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "StaffAudit" (
    "id" UUID NOT NULL,
    "event" VARCHAR(60) NOT NULL,
    "subjectId" VARCHAR(100) NOT NULL,
    "actorId" UUID,
    "details" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSpecimen" (
    "id" UUID NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" VARCHAR(128) NOT NULL,
    "sourceOwnerId" VARCHAR(128),
    "title" VARCHAR(200) NOT NULL,
    "subtitle" VARCHAR(300) NOT NULL,
    "evidenceCanonical" TEXT NOT NULL,
    "evidenceHash" VARCHAR(64) NOT NULL,
    "evidenceRevision" INTEGER NOT NULL DEFAULT 1,
    "draftRevision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSpecimen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAssignment" (
    "specimenId" UUID NOT NULL,
    "identityId" UUID NOT NULL,
    "fence" INTEGER NOT NULL DEFAULT 1,
    "canReview" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "StaffAssignment_pkey" PRIMARY KEY ("specimenId","identityId")
);

-- CreateTable
CREATE TABLE "StaffReviewRevision" (
    "specimenId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "evidenceRevision" INTEGER NOT NULL,
    "evidenceHash" VARCHAR(64) NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "canonical" TEXT NOT NULL,
    "savedById" UUID,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffReviewRevision_pkey" PRIMARY KEY ("specimenId","revision")
);

-- CreateTable
CREATE TABLE "StaffOperation" (
    "identityId" UUID NOT NULL,
    "operationId" VARCHAR(80) NOT NULL,
    "specimenId" UUID NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffOperation_pkey" PRIMARY KEY ("identityId","operationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffIdentity_phoneHash_key" ON "StaffIdentity"("phoneHash");

-- CreateIndex
CREATE INDEX "StaffBrowser_expiresAt_idx" ON "StaffBrowser"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "StaffChallenge_sendClaimId_key" ON "StaffChallenge"("sendClaimId");

-- CreateIndex
CREATE INDEX "StaffChallenge_phoneHash_createdAt_idx" ON "StaffChallenge"("phoneHash", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StaffChallenge_browserHash_requestId_key" ON "StaffChallenge"("browserHash", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSession_challengeId_key" ON "StaffSession"("challengeId");

-- CreateIndex
CREATE INDEX "StaffSession_identityId_expiresAt_idx" ON "StaffSession"("identityId", "expiresAt");

-- CreateIndex
CREATE INDEX "StaffRateBucket_expiresAt_idx" ON "StaffRateBucket"("expiresAt");

-- CreateIndex
CREATE INDEX "StaffAudit_subjectId_createdAt_idx" ON "StaffAudit"("subjectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSpecimen_sourceType_sourceId_key" ON "StaffSpecimen"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "StaffAssignment_identityId_expiresAt_idx" ON "StaffAssignment"("identityId", "expiresAt");

-- AddForeignKey
ALTER TABLE "StaffChallenge" ADD CONSTRAINT "StaffChallenge_browserHash_fkey" FOREIGN KEY ("browserHash") REFERENCES "StaffBrowser"("tokenHash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "StaffIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_browserHash_fkey" FOREIGN KEY ("browserHash") REFERENCES "StaffBrowser"("tokenHash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "StaffChallenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_specimenId_fkey" FOREIGN KEY ("specimenId") REFERENCES "StaffSpecimen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "StaffIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffReviewRevision" ADD CONSTRAINT "StaffReviewRevision_specimenId_fkey" FOREIGN KEY ("specimenId") REFERENCES "StaffSpecimen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffOperation" ADD CONSTRAINT "StaffOperation_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "StaffIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffOperation" ADD CONSTRAINT "StaffOperation_specimenId_fkey" FOREIGN KEY ("specimenId") REFERENCES "StaffSpecimen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "StaffControl" ADD CONSTRAINT "StaffControl_shape" CHECK (
  id = 'active' AND revision > 0 AND "configHash" ~ '^[a-f0-9]{64}$' AND "releaseSha" ~ '^[a-f0-9]{40}$'
  AND ((mode = 'PRODUCTION' AND origin = 'https://app.atlasgrading.com')
    OR (mode = 'LOCAL_FIXTURE' AND origin = 'http://127.0.0.1:4318')));
ALTER TABLE "StaffIdentity" ADD CONSTRAINT "StaffIdentity_shape" CHECK (
  "phoneHash" ~ '^[a-f0-9]{64}$' AND role IN ('REVIEWER','OBSERVER') AND "accessVersion" > 0);
ALTER TABLE "StaffBrowser" ADD CONSTRAINT "StaffBrowser_shape" CHECK (
  "tokenHash" ~ '^[a-f0-9]{64}$' AND "controlRevision" > 0 AND "expiresAt" > "createdAt"
  AND "expiresAt" <= "createdAt" + interval '1 hour');
ALTER TABLE "StaffChallenge" ADD CONSTRAINT "StaffChallenge_shape" CHECK ((
  id ~ '^[A-Za-z0-9_-]{43}$' AND "phoneHash" ~ '^[a-f0-9]{64}$' AND "controlRevision" > 0
  AND "accountSid" ~ '^AC[0-9a-fA-F]{32}$' AND "serviceSid" ~ '^VA[0-9a-fA-F]{32}$'
  AND state IN ('SENDING','PENDING','CHECKING','UNKNOWN','SUPERSEDED','CONSUMED')
  AND attempts BETWEEN 0 AND 5 AND "expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '5 minutes'
  AND "quarantineUntil" >= "expiresAt" AND "quarantineUntil" <= "createdAt" + interval '25 hours'
  AND (state NOT IN ('PENDING','CHECKING','CONSUMED') OR "verificationSid" ~ '^VE[0-9a-fA-F]{32}$')
  AND (state <> 'PENDING' OR "checkClaimId" IS NULL)
  AND (state <> 'CHECKING' OR "checkClaimId" IS NOT NULL)
  AND ((state = 'CONSUMED' AND "consumedAt" IS NOT NULL AND "checkClaimId" IS NOT NULL
      AND "replayHash" ~ '^[a-f0-9]{64}$' AND "replayUntil" <= "expiresAt"
      AND "replayUntil" <= "consumedAt" + interval '1 minute')
    OR (state <> 'CONSUMED' AND "consumedAt" IS NULL AND "replayHash" IS NULL AND "replayUntil" IS NULL))
) IS TRUE);
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_shape" CHECK (
  "tokenHash" ~ '^[a-f0-9]{64}$' AND "accessVersion" > 0 AND "controlRevision" > 0
  AND "expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '30 minutes');
ALTER TABLE "StaffRateBucket" ADD CONSTRAINT "StaffRateBucket_shape" CHECK (count > 0);
ALTER TABLE "StaffAudit" ADD CONSTRAINT "StaffAudit_shape" CHECK (
  octet_length(details) <= 16384 AND jsonb_typeof(details::jsonb) = 'object');
ALTER TABLE "StaffSpecimen" ADD CONSTRAINT "StaffSpecimen_shape" CHECK (
  "sourceType" IN ('LOCAL_FIXTURE','SPEEDSTER') AND "evidenceRevision" > 0 AND "draftRevision" > 0
  AND octet_length("evidenceCanonical") <= 131072 AND jsonb_typeof("evidenceCanonical"::jsonb) = 'object'
  AND "evidenceHash" = encode(sha256(convert_to("evidenceCanonical",'UTF8')),'hex'));
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_shape" CHECK (fence > 0);
ALTER TABLE "StaffReviewRevision" ADD CONSTRAINT "StaffReviewRevision_shape" CHECK ((
  revision > 0 AND "evidenceRevision" > 0 AND octet_length(canonical) <= 32768
  AND jsonb_typeof(canonical::jsonb) = 'object'
  AND "contentHash" = encode(sha256(convert_to(canonical,'UTF8')),'hex')
  AND canonical::jsonb->>'evidenceHash' = "evidenceHash"
  AND (canonical::jsonb->>'revision')::int = revision
  AND (canonical::jsonb->>'evidenceRevision')::int = "evidenceRevision"
) IS TRUE);
ALTER TABLE "StaffOperation" ADD CONSTRAINT "StaffOperation_revision_fkey"
  FOREIGN KEY ("specimenId", revision) REFERENCES "StaffReviewRevision"("specimenId", revision) ON DELETE RESTRICT;

CREATE FUNCTION atlas_staff.lock_control() RETURNS SETOF atlas_staff."StaffControl"
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, atlas_staff
  AS 'SELECT * FROM atlas_staff."StaffControl" WHERE id = ''active'' FOR SHARE';
CREATE FUNCTION atlas_staff.lock_assignment(specimen uuid, identity uuid) RETURNS SETOF atlas_staff."StaffAssignment"
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, atlas_staff
  AS 'SELECT * FROM atlas_staff."StaffAssignment" WHERE "specimenId" = specimen AND "identityId" = identity FOR SHARE';
REVOKE ALL ON FUNCTION atlas_staff.lock_control() FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_staff.lock_assignment(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION atlas_staff.staff_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ATLAS staff history is immutable'; END; $$;
CREATE TRIGGER "StaffReviewRevision_immutable" BEFORE UPDATE OR DELETE ON "StaffReviewRevision"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffAudit_immutable" BEFORE UPDATE OR DELETE ON "StaffAudit"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffOperation_immutable" BEFORE UPDATE OR DELETE ON "StaffOperation"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffChallenge_no_delete" BEFORE DELETE ON "StaffChallenge"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();
CREATE TRIGGER "StaffSession_no_delete" BEFORE DELETE ON "StaffSession"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_immutable();

CREATE FUNCTION atlas_staff.staff_control_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'ATLAS control revision must advance once'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "StaffControl_revision" BEFORE UPDATE ON "StaffControl" FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_control_guard();

CREATE FUNCTION atlas_staff.staff_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW."phoneHash",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."phoneHash",OLD."createdAt")
    OR NEW."accessVersion" < OLD."accessVersion" THEN RAISE EXCEPTION 'ATLAS identity binding is immutable'; END IF;
  IF (NEW.role,NEW."revokedAt",NEW."certificationUntil",NEW."trustedLearningUntil")
    IS DISTINCT FROM (OLD.role,OLD."revokedAt",OLD."certificationUntil",OLD."trustedLearningUntil")
    AND NEW."accessVersion" <> OLD."accessVersion" + 1 THEN RAISE EXCEPTION 'ATLAS access changes must revoke existing sessions'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "StaffIdentity_access" BEFORE UPDATE ON "StaffIdentity" FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_identity_guard();

CREATE FUNCTION atlas_staff.staff_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."specimenId", NEW."identityId") IS DISTINCT FROM (OLD."specimenId", OLD."identityId")
    OR NEW.fence <> OLD.fence + 1 THEN RAISE EXCEPTION 'ATLAS assignment changes must advance their fence'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "StaffAssignment_fence" BEFORE UPDATE ON "StaffAssignment"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_assignment_guard();

CREATE FUNCTION atlas_staff.staff_challenge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'SENDING' OR NEW.attempts <> 0 OR NEW."verificationSid" IS NOT NULL OR NEW."checkClaimId" IS NOT NULL THEN
      RAISE EXCEPTION 'ATLAS challenge requires an unused send claim'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['state','verificationSid','attempts','checkClaimId','replayHash','replayUntil','consumedAt'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','verificationSid','attempts','checkClaimId','replayHash','replayUntil','consumedAt'])
    THEN RAISE EXCEPTION 'ATLAS challenge input is immutable'; END IF;
  IF OLD.state IN ('CONSUMED','SUPERSEDED') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'ATLAS terminal challenge is immutable'; END IF;
  IF OLD."verificationSid" IS NOT NULL AND NEW."verificationSid" IS DISTINCT FROM OLD."verificationSid" THEN
    RAISE EXCEPTION 'ATLAS verification SID is write-once'; END IF;
  IF NEW.state = 'SUPERSEDED' THEN
    IF OLD.state IN ('SENDING','CHECKING','UNKNOWN') AND OLD."quarantineUntil" > clock_timestamp() THEN
      RAISE EXCEPTION 'ATLAS unknown verification remains quarantined'; END IF;
    IF NEW.attempts <> OLD.attempts THEN RAISE EXCEPTION 'ATLAS attempt count cannot change during supersession'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'SENDING' AND NEW.state IN ('PENDING','UNKNOWN') AND NEW.attempts = 0 THEN RETURN NEW; END IF;
  IF OLD.state = 'PENDING' AND NEW.state = 'CHECKING' AND NEW.attempts = OLD.attempts + 1
    AND NEW."checkClaimId" IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.state = 'CHECKING' AND NEW.state IN ('PENDING','UNKNOWN','CONSUMED') AND NEW.attempts = OLD.attempts
    AND (NEW.state = 'PENDING' OR NEW."checkClaimId" = OLD."checkClaimId") THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'ATLAS challenge transition is invalid';
END; $$;
CREATE TRIGGER "StaffChallenge_transition" BEFORE INSERT OR UPDATE ON "StaffChallenge"
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_challenge_guard();

CREATE FUNCTION atlas_staff.staff_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'revokedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'revokedAt')
    OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt") THEN
    RAISE EXCEPTION 'ATLAS issued session binding is immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "StaffSession_binding" BEFORE UPDATE ON "StaffSession" FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_session_guard();

CREATE FUNCTION atlas_staff.staff_consumption_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, atlas_staff AS $$
DECLARE c atlas_staff."StaffChallenge"%ROWTYPE; s atlas_staff."StaffSession"%ROWTYPE; i atlas_staff."StaffIdentity"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'StaffSession' THEN SELECT * INTO c FROM atlas_staff."StaffChallenge" WHERE id = NEW."challengeId";
  ELSE SELECT * INTO c FROM atlas_staff."StaffChallenge" WHERE id = NEW.id; END IF;
  SELECT * INTO s FROM atlas_staff."StaffSession" WHERE "challengeId" = c.id;
  IF c.state <> 'CONSUMED' AND s."tokenHash" IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO i FROM atlas_staff."StaffIdentity" WHERE id = s."identityId";
  IF c.state <> 'CONSUMED' OR s."tokenHash" IS NULL OR i.id IS NULL OR c."phoneHash" <> i."phoneHash"
    OR c."browserHash" <> s."browserHash" OR c."controlRevision" <> s."controlRevision"
    OR s."createdAt" <> c."consumedAt" OR c."consumedAt" >= c."expiresAt" THEN
    RAISE EXCEPTION 'ATLAS challenge consumption and bound session must commit together'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER "StaffChallenge_atomic_consumption" AFTER UPDATE ON "StaffChallenge" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_consumption_guard();
CREATE CONSTRAINT TRIGGER "StaffSession_atomic_consumption" AFTER INSERT ON "StaffSession" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_consumption_guard();

CREATE FUNCTION atlas_staff.staff_specimen_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW."sourceType",NEW."sourceId",NEW."sourceOwnerId",NEW."createdAt")
    IS DISTINCT FROM (OLD.id,OLD."sourceType",OLD."sourceId",OLD."sourceOwnerId",OLD."createdAt")
    OR NEW."draftRevision" <> OLD."draftRevision" + 1 THEN RAISE EXCEPTION 'ATLAS review must preserve specimen and advance once'; END IF;
  IF (NEW."evidenceCanonical",NEW."evidenceHash") IS DISTINCT FROM (OLD."evidenceCanonical",OLD."evidenceHash") THEN
    IF NEW."evidenceRevision" <> OLD."evidenceRevision" + 1 THEN RAISE EXCEPTION 'ATLAS evidence revision must advance once'; END IF;
  ELSIF NEW."evidenceRevision" <> OLD."evidenceRevision" THEN RAISE EXCEPTION 'ATLAS evidence revision changed without evidence'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "StaffSpecimen_revision" BEFORE UPDATE ON "StaffSpecimen" FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_specimen_guard();
CREATE FUNCTION atlas_staff.staff_review_commit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, atlas_staff AS $$
DECLARE s atlas_staff."StaffSpecimen"%ROWTYPE; r atlas_staff."StaffReviewRevision"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'StaffSpecimen' THEN SELECT * INTO s FROM atlas_staff."StaffSpecimen" WHERE id = NEW.id;
  ELSE SELECT * INTO s FROM atlas_staff."StaffSpecimen" WHERE id = NEW."specimenId"; END IF;
  IF TG_TABLE_NAME = 'StaffReviewRevision' THEN
    IF NEW.revision > s."draftRevision" THEN RAISE EXCEPTION 'ATLAS revision cannot precede its committed head'; END IF;
  END IF;
  SELECT * INTO r FROM atlas_staff."StaffReviewRevision" WHERE "specimenId" = s.id AND revision = s."draftRevision";
  IF r."specimenId" IS NULL OR r."evidenceRevision" <> s."evidenceRevision" OR r."evidenceHash" <> s."evidenceHash" THEN
    RAISE EXCEPTION 'ATLAS review head must commit its exact immutable revision'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER "StaffSpecimen_atomic_revision" AFTER INSERT OR UPDATE ON "StaffSpecimen" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_review_commit_guard();
CREATE CONSTRAINT TRIGGER "StaffReviewRevision_atomic_revision" AFTER INSERT ON "StaffReviewRevision" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION atlas_staff.staff_review_commit_guard();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['StaffIdentity','StaffControl','StaffBrowser','StaffChallenge','StaffSession','StaffAudit','StaffSpecimen','StaffAssignment','StaffReviewRevision','StaffOperation'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON atlas_staff.%I FOR EACH STATEMENT EXECUTE FUNCTION atlas_staff.staff_immutable()', t || '_no_truncate', t);
  END LOOP;
END; $$;

COMMIT;
