-- CreateTable
CREATE TABLE "CardBatch" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "notes" TEXT,
    "uploadedById" TEXT NOT NULL,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardAsset" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "status" "CardAssetStatus" NOT NULL DEFAULT 'UPLOADING',
    "ocrText" TEXT,
    "ocrJson" JSONB,
    "classificationJson" JSONB,
    "valuationMinor" INTEGER,
    "valuationCurrency" TEXT DEFAULT 'USD',
    "valuationSource" TEXT,
    "marketplaceUrl" TEXT,
    "assignedDefinitionId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardNote" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardAsset_batchId_idx" ON "CardAsset"("batchId");

-- CreateIndex
CREATE INDEX "CardAsset_status_idx" ON "CardAsset"("status");

-- CreateIndex
CREATE INDEX "CardAsset_assignedDefinitionId_idx" ON "CardAsset"("assignedDefinitionId");

-- CreateIndex
CREATE INDEX "CardNote_cardId_idx" ON "CardNote"("cardId");

-- AddForeignKey
ALTER TABLE "CardBatch" ADD CONSTRAINT "CardBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAsset" ADD CONSTRAINT "CardAsset_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CardBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAsset" ADD CONSTRAINT "CardAsset_assignedDefinitionId_fkey" FOREIGN KEY ("assignedDefinitionId") REFERENCES "PackDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardNote" ADD CONSTRAINT "CardNote_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CardAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardNote" ADD CONSTRAINT "CardNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
