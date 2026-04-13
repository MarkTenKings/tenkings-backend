-- Add machine-specific coordinates for stocker machine proximity workflows.
ALTER TABLE "Location" ADD COLUMN "machineLat" DOUBLE PRECISION;
ALTER TABLE "Location" ADD COLUMN "machineLng" DOUBLE PRECISION;
ALTER TABLE "Location" ADD COLUMN "machineGeofenceM" INTEGER DEFAULT 20;
