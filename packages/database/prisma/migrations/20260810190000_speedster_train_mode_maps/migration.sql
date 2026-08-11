-- Immutable card-type map revisions with one immediately active revision.
CREATE TABLE "AiGraderV2CardTypeMap" (
    "id" TEXT NOT NULL,
    "matchKeyHash" TEXT NOT NULL,
    "cardProfile" "HumanGradeCardType" NOT NULL,
    "currentRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGraderV2CardTypeMap_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiGraderV2CardTypeMapRevision" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "matchKeyHash" TEXT NOT NULL,
    "matchKey" JSONB NOT NULL,
    "displayIdentity" JSONB NOT NULL,
    "normalizedIdentity" JSONB NOT NULL,
    "sourceSessionId" TEXT NOT NULL,
    "authorAdminId" TEXT NOT NULL,
    "frontMap" JSONB NOT NULL,
    "backMap" JSONB NOT NULL,
    "mapSchemaVersion" TEXT NOT NULL,
    "filterPolicyVersion" TEXT NOT NULL,
    "revisionHash" TEXT NOT NULL,
    "supersedesRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGraderV2CardTypeMapRevision_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AiGraderV2Session"
    ADD COLUMN "mapRevisionId" TEXT,
    ADD COLUMN "mapFilterPolicyVersion" TEXT,
    ADD COLUMN "mapRegistration" JSONB;

CREATE TABLE "AiGraderV2MapFilterDecision" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "originalOrigin" TEXT NOT NULL,
    "proposedDefectType" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "similarity" DOUBLE PRECISION,
    "generatingExemplar" JSONB,
    "sourceViewId" TEXT NOT NULL,
    "supportingViewIds" JSONB NOT NULL,
    "cardIdentity" JSONB NOT NULL,
    "findingSnapshot" JSONB NOT NULL,
    "mapId" TEXT NOT NULL,
    "mapRevisionId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "zoneType" TEXT NOT NULL,
    "zoneOverlap" JSONB NOT NULL,
    "filterPolicyVersion" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleInputs" JSONB NOT NULL,
    "detectorVersion" TEXT NOT NULL,
    "filteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGraderV2MapFilterDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiGraderV2MapFilterRestoreEvent" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "restoredByAdminId" TEXT NOT NULL,
    "sessionLifecycleState" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "calibrationMistake" JSONB NOT NULL,
    "restoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGraderV2MapFilterRestoreEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiGraderV2CardTypeMap_matchKeyHash_key" ON "AiGraderV2CardTypeMap"("matchKeyHash");
CREATE UNIQUE INDEX "AiGraderV2CardTypeMap_currentRevisionId_key" ON "AiGraderV2CardTypeMap"("currentRevisionId");
CREATE INDEX "AiGraderV2CardTypeMap_cardProfile_createdAt_idx" ON "AiGraderV2CardTypeMap"("cardProfile", "createdAt");
CREATE UNIQUE INDEX "AiGraderV2CardTypeMapRevision_revisionHash_key" ON "AiGraderV2CardTypeMapRevision"("revisionHash");
CREATE UNIQUE INDEX "AiGraderV2CardTypeMapRevision_supersedesRevisionId_key" ON "AiGraderV2CardTypeMapRevision"("supersedesRevisionId");
CREATE UNIQUE INDEX "AiGraderV2CardTypeMapRevision_mapId_version_key" ON "AiGraderV2CardTypeMapRevision"("mapId", "version");
CREATE INDEX "AiGraderV2CardTypeMapRevision_matchKeyHash_createdAt_idx" ON "AiGraderV2CardTypeMapRevision"("matchKeyHash", "createdAt");
CREATE INDEX "AiGraderV2CardTypeMapRevision_sourceSessionId_createdAt_idx" ON "AiGraderV2CardTypeMapRevision"("sourceSessionId", "createdAt");
CREATE INDEX "AiGraderV2Session_mapRevisionId_idx" ON "AiGraderV2Session"("mapRevisionId");
CREATE UNIQUE INDEX "AiGraderV2MapFilterDecision_sessionId_findingId_key" ON "AiGraderV2MapFilterDecision"("sessionId", "findingId");
CREATE INDEX "AiGraderV2MapFilterDecision_mapRevisionId_filteredAt_idx" ON "AiGraderV2MapFilterDecision"("mapRevisionId", "filteredAt");
CREATE INDEX "AiGraderV2MapFilterDecision_zoneId_filteredAt_idx" ON "AiGraderV2MapFilterDecision"("zoneId", "filteredAt");
CREATE INDEX "AiGraderV2MapFilterDecision_originalOrigin_proposedDefectType_side_idx" ON "AiGraderV2MapFilterDecision"("originalOrigin", "proposedDefectType", "side");
CREATE UNIQUE INDEX "AiGraderV2MapFilterRestoreEvent_decisionId_key" ON "AiGraderV2MapFilterRestoreEvent"("decisionId");
CREATE INDEX "AiGraderV2MapFilterRestoreEvent_restoredAt_idx" ON "AiGraderV2MapFilterRestoreEvent"("restoredAt");

ALTER TABLE "AiGraderV2CardTypeMapRevision" ADD CONSTRAINT "AiGraderV2CardTypeMapRevision_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "AiGraderV2CardTypeMap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGraderV2CardTypeMapRevision" ADD CONSTRAINT "AiGraderV2CardTypeMapRevision_sourceSessionId_fkey" FOREIGN KEY ("sourceSessionId") REFERENCES "AiGraderV2Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGraderV2CardTypeMapRevision" ADD CONSTRAINT "AiGraderV2CardTypeMapRevision_supersedesRevisionId_fkey" FOREIGN KEY ("supersedesRevisionId") REFERENCES "AiGraderV2CardTypeMapRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGraderV2CardTypeMap" ADD CONSTRAINT "AiGraderV2CardTypeMap_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "AiGraderV2CardTypeMapRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGraderV2Session" ADD CONSTRAINT "AiGraderV2Session_mapRevisionId_fkey" FOREIGN KEY ("mapRevisionId") REFERENCES "AiGraderV2CardTypeMapRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGraderV2MapFilterDecision" ADD CONSTRAINT "AiGraderV2MapFilterDecision_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiGraderV2Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGraderV2MapFilterDecision" ADD CONSTRAINT "AiGraderV2MapFilterDecision_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "AiGraderV2CardTypeMap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGraderV2MapFilterDecision" ADD CONSTRAINT "AiGraderV2MapFilterDecision_mapRevisionId_fkey" FOREIGN KEY ("mapRevisionId") REFERENCES "AiGraderV2CardTypeMapRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiGraderV2MapFilterRestoreEvent" ADD CONSTRAINT "AiGraderV2MapFilterRestoreEvent_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AiGraderV2MapFilterDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
