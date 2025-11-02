  -- Add new status enum for pack labels
  CREATE TYPE "PackLabelStatus" AS ENUM ('RESERVED', 'PRINTED', 'BOUND');

  -- Extend pack instances with source batch reference
ALTER TABLE "PackInstance"
  ADD COLUMN "sourceBatchId" TEXT;

  ALTER TABLE "PackInstance"
    ADD CONSTRAINT "PackInstance_sourceBatchId_fkey"
    FOREIGN KEY ("sourceBatchId") REFERENCES "CardBatch"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

  -- Create pack label table
CREATE TABLE "PackLabel" (
  "id" TEXT NOT NULL DEFAULT uuid_generate_v4(),
  "pairId" TEXT NOT NULL,
  "cardQrCodeId" uuid NOT NULL,
  "packQrCodeId" uuid NOT NULL,
  "itemId" TEXT,
  "packInstanceId" TEXT,
  "locationId" uuid,
  "batchId" TEXT,
    "status" "PackLabelStatus" NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedAt" TIMESTAMP(3),
    CONSTRAINT "PackLabel_pkey" PRIMARY KEY ("id")
  );

  CREATE UNIQUE INDEX "PackLabel_pairId_key" ON "PackLabel"("pairId");
  CREATE UNIQUE INDEX "PackLabel_cardQrCodeId_key" ON "PackLabel"("cardQrCodeId");
  CREATE UNIQUE INDEX "PackLabel_packQrCodeId_key" ON "PackLabel"("packQrCodeId");
  CREATE UNIQUE INDEX "PackLabel_packInstanceId_key" ON "PackLabel"("packInstanceId") WHERE "packInstanceId"
  IS NOT NULL;
  CREATE INDEX "PackLabel_locationId_idx" ON "PackLabel"("locationId");
  CREATE INDEX "PackLabel_batchId_idx" ON "PackLabel"("batchId");
  CREATE INDEX "PackLabel_status_idx" ON "PackLabel"("status");

  ALTER TABLE "PackLabel"
    ADD CONSTRAINT "PackLabel_cardQrCodeId_fkey"
    FOREIGN KEY ("cardQrCodeId") REFERENCES "QrCode"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

  ALTER TABLE "PackLabel"
    ADD CONSTRAINT "PackLabel_packQrCodeId_fkey"
    FOREIGN KEY ("packQrCodeId") REFERENCES "QrCode"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

  ALTER TABLE "PackLabel"
    ADD CONSTRAINT "PackLabel_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "Item"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

  ALTER TABLE "PackLabel"
    ADD CONSTRAINT "PackLabel_packInstanceId_fkey"
    FOREIGN KEY ("packInstanceId") REFERENCES "PackInstance"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

  ALTER TABLE "PackLabel"
    ADD CONSTRAINT "PackLabel_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

  ALTER TABLE "PackLabel"
    ADD CONSTRAINT "PackLabel_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "CardBatch"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
