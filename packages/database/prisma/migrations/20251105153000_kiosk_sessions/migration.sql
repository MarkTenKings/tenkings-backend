CREATE TYPE "KioskSessionStatus" AS ENUM ('COUNTDOWN', 'LIVE', 'REVEAL', 'COMPLETE', 'CANCELLED');

CREATE TABLE "KioskSession" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "code" text NOT NULL,
  "controlTokenHash" text NOT NULL,
  "packInstanceId" uuid,
  "locationId" uuid,
  "status" "KioskSessionStatus" NOT NULL DEFAULT 'COUNTDOWN',
  "countdownSeconds" integer NOT NULL DEFAULT 10,
  "liveSeconds" integer NOT NULL DEFAULT 30,
  "countdownStartedAt" timestamptz NOT NULL DEFAULT now(),
  "liveStartedAt" timestamptz,
  "revealItemId" uuid,
  "videoUrl" text,
  "thumbnailUrl" text,
  "qrLinkUrl" text,
  "buybackLinkUrl" text,
  "revealPayload" jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "completedAt" timestamptz,
  CONSTRAINT "KioskSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KioskSession_code_key" ON "KioskSession"("code");

ALTER TABLE "KioskSession"
  ADD CONSTRAINT "KioskSession_packInstanceId_fkey"
  FOREIGN KEY ("packInstanceId") REFERENCES "PackInstance"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KioskSession"
  ADD CONSTRAINT "KioskSession_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KioskSession"
  ADD CONSTRAINT "KioskSession_revealItemId_fkey"
  FOREIGN KEY ("revealItemId") REFERENCES "Item"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LiveRip" ADD COLUMN "kioskSessionId" uuid;

ALTER TABLE "LiveRip"
  ADD CONSTRAINT "LiveRip_kioskSessionId_fkey"
  FOREIGN KEY ("kioskSessionId") REFERENCES "KioskSession"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
