-- DropIndex
DROP INDEX "CardAsset_assignedDefinitionId_idx";

-- DropIndex
DROP INDEX "CardAsset_batchId_idx";

-- DropIndex
DROP INDEX "CardAsset_status_idx";

-- DropIndex
DROP INDEX "CardNote_cardId_idx";

-- DropIndex
DROP INDEX "ProcessingJob_cardAssetId_idx";

-- DropIndex
DROP INDEX "ProcessingJob_status_type_idx";

-- AlterTable
ALTER TABLE "CardAsset" ADD COLUMN     "playerStatsSnapshot" JSONB,
ADD COLUMN     "resolvedPlayerName" TEXT,
ADD COLUMN     "resolvedTeamName" TEXT,
ADD COLUMN     "sportsDbMatchConfidence" DOUBLE PRECISION,
ADD COLUMN     "sportsDbPlayerId" TEXT;

-- CreateTable
CREATE TABLE "SportsDbTeam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alternateNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sport" TEXT NOT NULL,
    "league" TEXT,
    "city" TEXT,
    "abbreviation" TEXT,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "SportsDbTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SportsDbPlayer" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "displayName" TEXT,
    "alternateNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sport" TEXT NOT NULL,
    "league" TEXT,
    "nationality" TEXT,
    "position" TEXT,
    "birthDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "teamId" TEXT,
    "headshotUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "SportsDbPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SportsDbPlayerSeason" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "league" TEXT,
    "statsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "SportsDbPlayerSeason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SportsDbTeam_sport_league_idx" ON "SportsDbTeam"("sport", "league");

-- CreateIndex
CREATE INDEX "SportsDbTeam_name_idx" ON "SportsDbTeam"("name");

-- CreateIndex
CREATE INDEX "SportsDbPlayer_sport_league_idx" ON "SportsDbPlayer"("sport", "league");

-- CreateIndex
CREATE INDEX "SportsDbPlayer_fullName_idx" ON "SportsDbPlayer"("fullName");

-- CreateIndex
CREATE INDEX "SportsDbPlayer_teamId_idx" ON "SportsDbPlayer"("teamId");

-- CreateIndex
CREATE INDEX "SportsDbPlayerSeason_season_idx" ON "SportsDbPlayerSeason"("season");

-- CreateIndex
CREATE UNIQUE INDEX "SportsDbPlayerSeason_playerId_season_league_key" ON "SportsDbPlayerSeason"("playerId", "season", "league");

-- CreateIndex
CREATE INDEX "CardAsset_sportsDbPlayerId_idx" ON "CardAsset"("sportsDbPlayerId");

-- AddForeignKey
ALTER TABLE "CardAsset" ADD CONSTRAINT "CardAsset_sportsDbPlayerId_fkey" FOREIGN KEY ("sportsDbPlayerId") REFERENCES "SportsDbPlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SportsDbPlayer" ADD CONSTRAINT "SportsDbPlayer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SportsDbTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SportsDbPlayerSeason" ADD CONSTRAINT "SportsDbPlayerSeason_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "SportsDbPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
