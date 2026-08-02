CREATE TABLE "AiGraderV2CaptureDevice" (
    "id" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "activeSessionId" TEXT,
    "uploadVersion" INTEGER NOT NULL DEFAULT 0,
    "readyVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGraderV2CaptureDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiGraderV2CaptureDevice_createdByUserId_key"
ON "AiGraderV2CaptureDevice"("createdByUserId");
