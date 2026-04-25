-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "LiveRipStatus" AS ENUM ('PENDING', 'LIVE', 'COMPLETE', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "LiveRip"
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "status" "LiveRipStatus" NOT NULL DEFAULT 'COMPLETE',
  ADD COLUMN IF NOT EXISTS "muxStreamId" TEXT,
  ADD COLUMN IF NOT EXISTS "muxStreamKey" TEXT,
  ADD COLUMN IF NOT EXISTS "whipUploadUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "endedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiveRipConsent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "liveRipId" uuid,
  "dob" TIMESTAMP(3) NOT NULL,
  "consentTextVersion" TEXT NOT NULL,
  "consentTextSnapshot" TEXT NOT NULL,
  "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LiveRipConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiveRip_status_isGoldenTicket_createdAt_idx" ON "LiveRip"("status", "isGoldenTicket", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiveRip_userId_idx" ON "LiveRip"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiveRip_muxStreamId_idx" ON "LiveRip"("muxStreamId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiveRipConsent_userId_idx" ON "LiveRipConsent"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiveRipConsent_liveRipId_idx" ON "LiveRipConsent"("liveRipId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "LiveRip"
    ADD CONSTRAINT "LiveRip_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "LiveRipConsent"
    ADD CONSTRAINT "LiveRipConsent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "LiveRipConsent"
    ADD CONSTRAINT "LiveRipConsent_liveRipId_fkey"
    FOREIGN KEY ("liveRipId") REFERENCES "LiveRip"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
