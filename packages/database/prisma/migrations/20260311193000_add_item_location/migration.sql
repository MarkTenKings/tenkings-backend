ALTER TABLE "Item"
ADD COLUMN "locationId" UUID;

CREATE INDEX "Item_locationId_idx" ON "Item"("locationId");

ALTER TABLE "Item"
ADD CONSTRAINT "Item_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
