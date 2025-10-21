-- CreateTable
CREATE TABLE "ShippingRequest" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "recipientName" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "processingFeeMinor" INTEGER NOT NULL,
    "shippingFeeMinor" INTEGER NOT NULL,
    "totalFeeMinor" INTEGER NOT NULL,
    "notes" TEXT,
    "trackingNumber" TEXT,
    "carrier" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShippingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShippingRequest_itemId_key" ON "ShippingRequest"("itemId");

-- CreateIndex
CREATE INDEX "ShippingRequest_userId_idx" ON "ShippingRequest"("userId");

-- AddForeignKey
ALTER TABLE "ShippingRequest"
  ADD CONSTRAINT "ShippingRequest_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingRequest"
  ADD CONSTRAINT "ShippingRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
