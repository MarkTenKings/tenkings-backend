-- AlterTable
ALTER TABLE "GoldenTicketWinnerProfile"
ALTER COLUMN "publishedAt" DROP NOT NULL;

-- Backfill Golden Ticket source location from the pack placement source of truth.
UPDATE "GoldenTicket" AS gt
SET "sourceLocationId" = pi."locationId"
FROM "PackInstance" AS pi
WHERE gt."placedInPackId" = pi."id"
  AND gt."sourceLocationId" IS NULL
  AND pi."locationId" IS NOT NULL;
