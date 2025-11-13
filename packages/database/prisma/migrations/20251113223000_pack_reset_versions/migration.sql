-- Add pack reset support and snapshot fields
ALTER TABLE "KioskSession"
  ADD COLUMN "packResetVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "packQrCodeSerial" TEXT;

ALTER TABLE "QrCode"
  ADD COLUMN "resetVersion" INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS "KioskSession_packQrCodeId_key";
