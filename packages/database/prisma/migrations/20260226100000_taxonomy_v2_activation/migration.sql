-- CreateEnum
CREATE TYPE "TaxonomyArtifactType" AS ENUM ('CHECKLIST', 'ODDS', 'COMBINED', 'MANUAL_PATCH');

-- CreateEnum
CREATE TYPE "TaxonomySourceKind" AS ENUM ('OFFICIAL_CHECKLIST', 'OFFICIAL_ODDS', 'TRUSTED_SECONDARY', 'MANUAL_PATCH');

-- CreateEnum
CREATE TYPE "TaxonomyEntityType" AS ENUM ('PROGRAM', 'CARD', 'VARIATION', 'PARALLEL', 'PARALLEL_SCOPE', 'ODDS_ROW');

-- CreateEnum
CREATE TYPE "TaxonomyConflictStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "TaxonomyAmbiguityStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "SetTaxonomySource" (
  "id" TEXT NOT NULL,
  "setId" TEXT NOT NULL,
  "ingestionJobId" TEXT,
  "artifactType" "TaxonomyArtifactType" NOT NULL DEFAULT 'CHECKLIST',
  "sourceKind" "TaxonomySourceKind" NOT NULL,
  "sourceLabel" TEXT,
  "sourceUrl" TEXT,
  "parserVersion" TEXT,
  "sourceTimestamp" TIMESTAMP(3),
  "parserConfidence" DOUBLE PRECISION,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SetTaxonomySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetProgram" (
  "id" TEXT NOT NULL,
  "setId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "codePrefix" TEXT,
  "programClass" TEXT,
  "sourceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SetProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetCard" (
  "id" TEXT NOT NULL,
  "setId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "cardNumber" TEXT NOT NULL,
  "playerName" TEXT,
  "sourceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SetCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetVariation" (
  "id" TEXT NOT NULL,
  "setId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "variationId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "scopeNote" TEXT,
  "sourceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SetVariation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetParallel" (
  "id" TEXT NOT NULL,
  "setId" TEXT NOT NULL,
  "parallelId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "serialDenominator" INTEGER,
  "serialText" TEXT,
  "finishFamily" TEXT,
  "sourceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SetParallel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetParallelScope" (
  "id" TEXT NOT NULL,
  "setId" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "parallelId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "variationId" TEXT,
  "formatKey" TEXT,
  "channelKey" TEXT,
  "sourceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SetParallelScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetOddsByFormat" (
  "id" TEXT NOT NULL,
  "setId" TEXT NOT NULL,
  "oddsKey" TEXT NOT NULL,
  "programId" TEXT,
  "parallelId" TEXT,
  "formatKey" TEXT,
  "channelKey" TEXT,
  "oddsText" TEXT NOT NULL,
  "sourceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SetOddsByFormat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetTaxonomyConflict" (
  "id" TEXT NOT NULL,
  "setId" TEXT NOT NULL,
  "entityType" "TaxonomyEntityType" NOT NULL,
  "entityKey" TEXT NOT NULL,
  "conflictField" TEXT NOT NULL,
  "existingSourceId" TEXT,
  "incomingSourceId" TEXT,
  "existingValueJson" JSONB,
  "incomingValueJson" JSONB,
  "status" "TaxonomyConflictStatus" NOT NULL DEFAULT 'OPEN',
  "resolutionNote" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SetTaxonomyConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetTaxonomyAmbiguityQueue" (
  "id" TEXT NOT NULL,
  "setId" TEXT NOT NULL,
  "entityType" "TaxonomyEntityType" NOT NULL,
  "ambiguityKey" TEXT NOT NULL,
  "payloadJson" JSONB,
  "sourceId" TEXT,
  "status" "TaxonomyAmbiguityStatus" NOT NULL DEFAULT 'PENDING',
  "resolutionNote" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SetTaxonomyAmbiguityQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardVariantTaxonomyMap" (
  "id" TEXT NOT NULL,
  "cardVariantId" TEXT NOT NULL,
  "setId" TEXT NOT NULL,
  "programId" TEXT,
  "cardNumber" TEXT,
  "variationId" TEXT,
  "parallelId" TEXT,
  "canonicalKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CardVariantTaxonomyMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SetTaxonomySource_setId_createdAt_idx" ON "SetTaxonomySource"("setId", "createdAt");

-- CreateIndex
CREATE INDEX "SetTaxonomySource_sourceKind_createdAt_idx" ON "SetTaxonomySource"("sourceKind", "createdAt");

-- CreateIndex
CREATE INDEX "SetTaxonomySource_ingestionJobId_idx" ON "SetTaxonomySource"("ingestionJobId");

-- CreateIndex
CREATE UNIQUE INDEX "SetProgram_setId_programId_key" ON "SetProgram"("setId", "programId");

-- CreateIndex
CREATE INDEX "SetProgram_setId_label_idx" ON "SetProgram"("setId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "SetCard_setId_programId_cardNumber_key" ON "SetCard"("setId", "programId", "cardNumber");

-- CreateIndex
CREATE INDEX "SetCard_setId_cardNumber_idx" ON "SetCard"("setId", "cardNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SetVariation_setId_programId_variationId_key" ON "SetVariation"("setId", "programId", "variationId");

-- CreateIndex
CREATE INDEX "SetVariation_setId_label_idx" ON "SetVariation"("setId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "SetParallel_setId_parallelId_key" ON "SetParallel"("setId", "parallelId");

-- CreateIndex
CREATE INDEX "SetParallel_setId_label_idx" ON "SetParallel"("setId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "SetParallelScope_setId_scopeKey_key" ON "SetParallelScope"("setId", "scopeKey");

-- CreateIndex
CREATE INDEX "SetParallelScope_setId_programId_idx" ON "SetParallelScope"("setId", "programId");

-- CreateIndex
CREATE INDEX "SetParallelScope_setId_parallelId_idx" ON "SetParallelScope"("setId", "parallelId");

-- CreateIndex
CREATE UNIQUE INDEX "SetOddsByFormat_setId_oddsKey_key" ON "SetOddsByFormat"("setId", "oddsKey");

-- CreateIndex
CREATE INDEX "SetOddsByFormat_setId_programId_parallelId_idx" ON "SetOddsByFormat"("setId", "programId", "parallelId");

-- CreateIndex
CREATE INDEX "SetOddsByFormat_setId_formatKey_channelKey_idx" ON "SetOddsByFormat"("setId", "formatKey", "channelKey");

-- CreateIndex
CREATE INDEX "SetTaxonomyConflict_setId_status_createdAt_idx" ON "SetTaxonomyConflict"("setId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SetTaxonomyConflict_setId_entityType_entityKey_idx" ON "SetTaxonomyConflict"("setId", "entityType", "entityKey");

-- CreateIndex
CREATE UNIQUE INDEX "SetTaxonomyAmbiguityQueue_setId_ambiguityKey_key" ON "SetTaxonomyAmbiguityQueue"("setId", "ambiguityKey");

-- CreateIndex
CREATE INDEX "SetTaxonomyAmbiguityQueue_setId_status_createdAt_idx" ON "SetTaxonomyAmbiguityQueue"("setId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CardVariantTaxonomyMap_cardVariantId_key" ON "CardVariantTaxonomyMap"("cardVariantId");

-- CreateIndex
CREATE INDEX "CardVariantTaxonomyMap_setId_canonicalKey_idx" ON "CardVariantTaxonomyMap"("setId", "canonicalKey");

-- AddForeignKey
ALTER TABLE "SetTaxonomySource" ADD CONSTRAINT "SetTaxonomySource_ingestionJobId_fkey" FOREIGN KEY ("ingestionJobId") REFERENCES "SetIngestionJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetProgram" ADD CONSTRAINT "SetProgram_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SetTaxonomySource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetCard" ADD CONSTRAINT "SetCard_setId_programId_fkey" FOREIGN KEY ("setId", "programId") REFERENCES "SetProgram"("setId", "programId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetCard" ADD CONSTRAINT "SetCard_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SetTaxonomySource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetVariation" ADD CONSTRAINT "SetVariation_setId_programId_fkey" FOREIGN KEY ("setId", "programId") REFERENCES "SetProgram"("setId", "programId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetVariation" ADD CONSTRAINT "SetVariation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SetTaxonomySource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetParallel" ADD CONSTRAINT "SetParallel_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SetTaxonomySource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetParallelScope" ADD CONSTRAINT "SetParallelScope_setId_programId_fkey" FOREIGN KEY ("setId", "programId") REFERENCES "SetProgram"("setId", "programId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetParallelScope" ADD CONSTRAINT "SetParallelScope_setId_parallelId_fkey" FOREIGN KEY ("setId", "parallelId") REFERENCES "SetParallel"("setId", "parallelId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetParallelScope" ADD CONSTRAINT "SetParallelScope_setId_programId_variationId_fkey" FOREIGN KEY ("setId", "programId", "variationId") REFERENCES "SetVariation"("setId", "programId", "variationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetParallelScope" ADD CONSTRAINT "SetParallelScope_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SetTaxonomySource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetOddsByFormat" ADD CONSTRAINT "SetOddsByFormat_setId_programId_fkey" FOREIGN KEY ("setId", "programId") REFERENCES "SetProgram"("setId", "programId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetOddsByFormat" ADD CONSTRAINT "SetOddsByFormat_setId_parallelId_fkey" FOREIGN KEY ("setId", "parallelId") REFERENCES "SetParallel"("setId", "parallelId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetOddsByFormat" ADD CONSTRAINT "SetOddsByFormat_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SetTaxonomySource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetTaxonomyConflict" ADD CONSTRAINT "SetTaxonomyConflict_existingSourceId_fkey" FOREIGN KEY ("existingSourceId") REFERENCES "SetTaxonomySource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetTaxonomyConflict" ADD CONSTRAINT "SetTaxonomyConflict_incomingSourceId_fkey" FOREIGN KEY ("incomingSourceId") REFERENCES "SetTaxonomySource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetTaxonomyAmbiguityQueue" ADD CONSTRAINT "SetTaxonomyAmbiguityQueue_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SetTaxonomySource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardVariantTaxonomyMap" ADD CONSTRAINT "CardVariantTaxonomyMap_cardVariantId_fkey" FOREIGN KEY ("cardVariantId") REFERENCES "CardVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
