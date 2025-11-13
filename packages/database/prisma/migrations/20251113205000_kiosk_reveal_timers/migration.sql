-- Add reveal timer tracking to kiosk sessions
ALTER TABLE "KioskSession"
  ADD COLUMN "revealSeconds" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "revealStartedAt" TIMESTAMP(3);
