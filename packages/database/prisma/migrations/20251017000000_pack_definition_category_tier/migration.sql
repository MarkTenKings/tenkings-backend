-- CreateEnum
CREATE TYPE "CollectibleCategory" AS ENUM ('SPORTS', 'POKEMON', 'COMICS');

-- CreateEnum
CREATE TYPE "PackTier" AS ENUM ('TIER_25', 'TIER_50', 'TIER_100', 'TIER_500');

-- AlterTable
ALTER TABLE "PackDefinition"
  ADD COLUMN "category" "CollectibleCategory" NOT NULL DEFAULT 'SPORTS',
  ADD COLUMN "tier" "PackTier" NOT NULL DEFAULT 'TIER_50';
