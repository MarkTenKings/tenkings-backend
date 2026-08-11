CREATE TABLE "AiGraderV2InstrumentationEvent" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "findingId" TEXT,
  "origin" TEXT,
  "similarity" DOUBLE PRECISION,
  "generatingExemplar" JSONB,
  "operatorAction" TEXT,
  "clientStartedAt" TIMESTAMP(3),
  "clientEndedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiGraderV2InstrumentationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiGraderV2InstrumentationEvent_origin_check"
    CHECK ("origin" IS NULL OR "origin" IN ('DETECTOR', 'MEMORY', 'SMART_MARK')),
  CONSTRAINT "AiGraderV2InstrumentationEvent_operatorAction_check"
    CHECK ("operatorAction" IS NULL OR "operatorAction" IN ('KEPT', 'REMOVED', 'EDITED', 'RETYPED', 'FILTER_REMOVED', 'FILTER_RESTORED')),
  CONSTRAINT "AiGraderV2InstrumentationEvent_similarity_check"
    CHECK ("similarity" IS NULL OR ("similarity" >= 0 AND "similarity" <= 1)),
  CONSTRAINT "AiGraderV2InstrumentationEvent_durationMs_check"
    CHECK ("durationMs" IS NULL OR "durationMs" >= 0),
  CONSTRAINT "AiGraderV2InstrumentationEvent_client_range_check"
    CHECK (
      "clientStartedAt" IS NULL OR
      "clientEndedAt" IS NULL OR
      "clientEndedAt" >= "clientStartedAt"
    )
);

CREATE UNIQUE INDEX "AiGraderV2InstrumentationEvent_eventKey_key"
ON "AiGraderV2InstrumentationEvent"("eventKey");

CREATE INDEX "AiGraderV2InstrumentationEvent_sessionId_createdAt_idx"
ON "AiGraderV2InstrumentationEvent"("sessionId", "createdAt");

CREATE INDEX "AiGraderV2InstrumentationEvent_cycleId_createdAt_idx"
ON "AiGraderV2InstrumentationEvent"("cycleId", "createdAt");

CREATE INDEX "AiGraderV2InstrumentationEvent_sessionId_findingId_createdAt_idx"
ON "AiGraderV2InstrumentationEvent"("sessionId", "findingId", "createdAt");

CREATE INDEX "AiGraderV2InstrumentationEvent_origin_operatorAction_idx"
ON "AiGraderV2InstrumentationEvent"("origin", "operatorAction");

ALTER TABLE "AiGraderV2InstrumentationEvent"
ADD CONSTRAINT "AiGraderV2InstrumentationEvent_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "AiGraderV2Session"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
