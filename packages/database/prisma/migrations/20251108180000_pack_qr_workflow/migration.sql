CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE "PackFulfillmentStatus" AS ENUM ('ONLINE', 'READY_FOR_PACKING', 'PACKED', 'LOADED');
CREATE TYPE "QrCodeType" AS ENUM ('CARD', 'PACK');
CREATE TYPE "QrCodeState" AS ENUM ('AVAILABLE', 'RESERVED', 'BOUND', 'RETIRED');
CREATE TYPE "KioskClaimStatus" AS ENUM ('UNCLAIMED', 'CLAIMED', 'SOLD_BACK');

ALTER TABLE "Item"
  ADD COLUMN "cardQrCodeId" uuid;

ALTER TABLE "PackInstance"
  ADD COLUMN "fulfillmentStatus" "PackFulfillmentStatus" NOT NULL DEFAULT 'ONLINE',
  ADD COLUMN "locationId" uuid,
  ADD COLUMN "packedAt" timestamptz,
  ADD COLUMN "packedById" text,
  ADD COLUMN "loadedAt" timestamptz,
  ADD COLUMN "loadedById" text,
  ADD COLUMN "packQrCodeId" uuid;

ALTER TABLE "KioskSession"
  ADD COLUMN "packQrCodeId" uuid,
  ADD COLUMN "claimedById" text,
  ADD COLUMN "claimStatus" "KioskClaimStatus" NOT NULL DEFAULT 'UNCLAIMED';

CREATE TABLE "QrCode" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "code" text NOT NULL,
  "serial" text,
  "type" "QrCodeType" NOT NULL,
  "state" "QrCodeState" NOT NULL DEFAULT 'AVAILABLE',
  "payloadUrl" text,
  "metadata" jsonb,
  "locationId" uuid,
  "createdById" text,
  "boundById" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "boundAt" timestamptz,
  "retiredAt" timestamptz,
  CONSTRAINT "QrCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QrCode_code_key" ON "QrCode"("code");
CREATE UNIQUE INDEX "QrCode_serial_key" ON "QrCode"("serial");
CREATE UNIQUE INDEX "Item_cardQrCodeId_key" ON "Item"("cardQrCodeId");
CREATE UNIQUE INDEX "PackInstance_packQrCodeId_key" ON "PackInstance"("packQrCodeId");
CREATE UNIQUE INDEX "KioskSession_packQrCodeId_key" ON "KioskSession"("packQrCodeId");

ALTER TABLE "Item"
  ADD CONSTRAINT "Item_cardQrCodeId_fkey" FOREIGN KEY ("cardQrCodeId") REFERENCES "QrCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PackInstance"
  ADD CONSTRAINT "PackInstance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PackInstance_packedById_fkey" FOREIGN KEY ("packedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PackInstance_loadedById_fkey" FOREIGN KEY ("loadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PackInstance_packQrCodeId_fkey" FOREIGN KEY ("packQrCodeId") REFERENCES "QrCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KioskSession"
  ADD CONSTRAINT "KioskSession_packQrCodeId_fkey" FOREIGN KEY ("packQrCodeId") REFERENCES "QrCode"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "KioskSession_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QrCode"
  ADD CONSTRAINT "QrCode_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "QrCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "QrCode_boundById_fkey" FOREIGN KEY ("boundById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
