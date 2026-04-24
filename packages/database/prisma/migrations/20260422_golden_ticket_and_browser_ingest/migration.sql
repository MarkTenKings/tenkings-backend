-- CreateEnum
CREATE TYPE "KioskIngestMode" AS ENUM ('OBS', 'BROWSER');

-- CreateEnum
CREATE TYPE "GoldenTicketStatus" AS ENUM ('MINTED', 'PLACED', 'SCANNED', 'CLAIMED', 'FULFILLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "GoldenTicketConsentStatus" AS ENUM ('GRANTED', 'DENIED_PROCEEDED_FORM_ONLY');

-- AlterEnum
ALTER TYPE "QrCodeType" ADD VALUE 'GOLDEN_TICKET';

-- AlterEnum
ALTER TYPE "CollectibleCategory" ADD VALUE 'GOLDEN_TICKET_PRIZE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dateOfBirth" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LiveRip" ADD COLUMN     "goldenTicketId" TEXT,
ADD COLUMN     "isGoldenTicket" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ShippingRequest" ADD COLUMN     "goldenTicketId" TEXT,
ADD COLUMN     "isGoldenTicket" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "KioskSession" ADD COLUMN     "goldenTicketId" TEXT,
ADD COLUMN     "ingestMode" "KioskIngestMode" NOT NULL DEFAULT 'OBS',
ADD COLUMN     "isGoldenTicket" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reactionVideoUrl" TEXT,
ADD COLUMN     "userId" TEXT,
ADD COLUMN     "whipUploadUrl" TEXT;

-- CreateTable
CREATE TABLE "GoldenTicket" (
    "id" TEXT NOT NULL,
    "ticketNumber" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "qrCodeId" UUID NOT NULL,
    "prizeItemId" TEXT NOT NULL,
    "revealVideoAssetUrl" TEXT,
    "revealVideoPoster" TEXT,
    "narrationOverride" TEXT,
    "status" "GoldenTicketStatus" NOT NULL DEFAULT 'MINTED',
    "placedInPackId" TEXT,
    "placedAt" TIMESTAMP(3),
    "scannedAt" TIMESTAMP(3),
    "scannedByUserId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "claimedKioskSessionId" UUID,
    "sourceLocationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoldenTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoldenTicketConsent" (
    "id" TEXT NOT NULL,
    "goldenTicketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "GoldenTicketConsentStatus" NOT NULL,
    "consentText" TEXT NOT NULL,
    "consentTextVersion" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoldenTicketConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoldenTicketWinnerProfile" (
    "id" TEXT NOT NULL,
    "goldenTicketId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "displayHandle" TEXT,
    "winnerPhotoUrl" TEXT,
    "winnerPhotoApproved" BOOLEAN NOT NULL DEFAULT false,
    "caption" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoldenTicketWinnerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoldenTicket_ticketNumber_key" ON "GoldenTicket"("ticketNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GoldenTicket_code_key" ON "GoldenTicket"("code");

-- CreateIndex
CREATE UNIQUE INDEX "GoldenTicket_qrCodeId_key" ON "GoldenTicket"("qrCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "GoldenTicket_prizeItemId_key" ON "GoldenTicket"("prizeItemId");

-- CreateIndex
CREATE UNIQUE INDEX "GoldenTicket_claimedKioskSessionId_key" ON "GoldenTicket"("claimedKioskSessionId");

-- CreateIndex
CREATE INDEX "GoldenTicket_status_idx" ON "GoldenTicket"("status");

-- CreateIndex
CREATE INDEX "GoldenTicket_scannedByUserId_idx" ON "GoldenTicket"("scannedByUserId");

-- CreateIndex
CREATE INDEX "GoldenTicket_sourceLocationId_idx" ON "GoldenTicket"("sourceLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "GoldenTicketConsent_goldenTicketId_key" ON "GoldenTicketConsent"("goldenTicketId");

-- CreateIndex
CREATE INDEX "GoldenTicketConsent_userId_idx" ON "GoldenTicketConsent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GoldenTicketWinnerProfile_goldenTicketId_key" ON "GoldenTicketWinnerProfile"("goldenTicketId");

-- CreateIndex
CREATE INDEX "GoldenTicketWinnerProfile_featured_idx" ON "GoldenTicketWinnerProfile"("featured");

-- CreateIndex
CREATE UNIQUE INDEX "LiveRip_goldenTicketId_key" ON "LiveRip"("goldenTicketId");

-- CreateIndex
CREATE INDEX "LiveRip_isGoldenTicket_createdAt_idx" ON "LiveRip"("isGoldenTicket", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingRequest_goldenTicketId_key" ON "ShippingRequest"("goldenTicketId");

-- CreateIndex
CREATE INDEX "ShippingRequest_isGoldenTicket_createdAt_idx" ON "ShippingRequest"("isGoldenTicket", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KioskSession_goldenTicketId_key" ON "KioskSession"("goldenTicketId");

-- CreateIndex
CREATE INDEX "KioskSession_userId_idx" ON "KioskSession"("userId");

-- CreateIndex
CREATE INDEX "KioskSession_ingestMode_status_createdAt_idx" ON "KioskSession"("ingestMode", "status", "createdAt");

-- CreateIndex
CREATE INDEX "KioskSession_isGoldenTicket_status_createdAt_idx" ON "KioskSession"("isGoldenTicket", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "LiveRip" ADD CONSTRAINT "LiveRip_goldenTicketId_fkey" FOREIGN KEY ("goldenTicketId") REFERENCES "GoldenTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingRequest" ADD CONSTRAINT "ShippingRequest_goldenTicketId_fkey" FOREIGN KEY ("goldenTicketId") REFERENCES "GoldenTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskSession" ADD CONSTRAINT "KioskSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskSession" ADD CONSTRAINT "KioskSession_goldenTicketId_fkey" FOREIGN KEY ("goldenTicketId") REFERENCES "GoldenTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldenTicket" ADD CONSTRAINT "GoldenTicket_qrCodeId_fkey" FOREIGN KEY ("qrCodeId") REFERENCES "QrCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldenTicket" ADD CONSTRAINT "GoldenTicket_prizeItemId_fkey" FOREIGN KEY ("prizeItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldenTicket" ADD CONSTRAINT "GoldenTicket_placedInPackId_fkey" FOREIGN KEY ("placedInPackId") REFERENCES "PackInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldenTicket" ADD CONSTRAINT "GoldenTicket_scannedByUserId_fkey" FOREIGN KEY ("scannedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldenTicket" ADD CONSTRAINT "GoldenTicket_claimedKioskSessionId_fkey" FOREIGN KEY ("claimedKioskSessionId") REFERENCES "KioskSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldenTicket" ADD CONSTRAINT "GoldenTicket_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldenTicketConsent" ADD CONSTRAINT "GoldenTicketConsent_goldenTicketId_fkey" FOREIGN KEY ("goldenTicketId") REFERENCES "GoldenTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldenTicketConsent" ADD CONSTRAINT "GoldenTicketConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldenTicketWinnerProfile" ADD CONSTRAINT "GoldenTicketWinnerProfile_goldenTicketId_fkey" FOREIGN KEY ("goldenTicketId") REFERENCES "GoldenTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
