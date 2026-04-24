-- CreateEnum
CREATE TYPE "LiveRipStatus" AS ENUM ('PENDING', 'LIVE', 'COMPLETE', 'CANCELLED');

-- AlterTable
ALTER TABLE "LiveRip"
  ADD COLUMN "userId" TEXT,
  ADD COLUMN "status" "LiveRipStatus" NOT NULL DEFAULT 'COMPLETE',
  ADD COLUMN "muxStreamId" TEXT,
  ADD COLUMN "muxStreamKey" TEXT,
  ADD COLUMN "whipUploadUrl" TEXT,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "endedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LiveRipConsent" (
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
CREATE INDEX "LiveRip_status_isGoldenTicket_createdAt_idx" ON "LiveRip"("status", "isGoldenTicket", "createdAt");

-- CreateIndex
CREATE INDEX "LiveRip_userId_idx" ON "LiveRip"("userId");

-- CreateIndex
CREATE INDEX "LiveRip_muxStreamId_idx" ON "LiveRip"("muxStreamId");

-- CreateIndex
CREATE INDEX "LiveRipConsent_userId_idx" ON "LiveRipConsent"("userId");

-- CreateIndex
CREATE INDEX "LiveRipConsent_liveRipId_idx" ON "LiveRipConsent"("liveRipId");

-- AddForeignKey
ALTER TABLE "LiveRip"
  ADD CONSTRAINT "LiveRip_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveRipConsent"
  ADD CONSTRAINT "LiveRipConsent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveRipConsent"
  ADD CONSTRAINT "LiveRipConsent_liveRipId_fkey"
  FOREIGN KEY ("liveRipId") REFERENCES "LiveRip"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
