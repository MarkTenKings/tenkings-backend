-- Add Live Rip customer assignment and single-use claim metadata.
ALTER TABLE "LiveRip"
  ADD COLUMN "claimName" TEXT,
  ADD COLUMN "claimPhone" TEXT,
  ADD COLUMN "claimTokenHash" TEXT,
  ADD COLUMN "claimExpiresAt" TIMESTAMP(3),
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "assignedByUserId" TEXT,
  ADD COLUMN "smsSentAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "LiveRip_claimTokenHash_key"
  ON "LiveRip"("claimTokenHash");

CREATE INDEX "LiveRip_claimPhone_idx"
  ON "LiveRip"("claimPhone");

CREATE INDEX "LiveRip_assignedByUserId_idx"
  ON "LiveRip"("assignedByUserId");

ALTER TABLE "LiveRip"
  ADD CONSTRAINT "LiveRip_assignedByUserId_fkey"
  FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
