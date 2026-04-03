ALTER TABLE "Location"
ADD COLUMN "locationType" TEXT,
ADD COLUMN "locationStatus" TEXT DEFAULT 'active',
ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION,
ADD COLUMN "venueCenterLat" DOUBLE PRECISION,
ADD COLUMN "venueCenterLng" DOUBLE PRECISION,
ADD COLUMN "geofenceRadiusM" INTEGER DEFAULT 500,
ADD COLUMN "city" TEXT,
ADD COLUMN "state" TEXT,
ADD COLUMN "zip" TEXT,
ADD COLUMN "hours" TEXT,
ADD COLUMN "hasIndoorMap" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "walkingDirections" JSONB,
ADD COLUMN "walkingTimeMin" INTEGER,
ADD COLUMN "landmarks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "machinePhotoUrl" TEXT,
ADD COLUMN "venueMapData" JSONB,
ADD COLUMN "checkpoints" JSONB;

CREATE TABLE "NavigationSession" (
    "id" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "entryMethod" TEXT NOT NULL,
    "qrCodeId" TEXT,
    "userLat" DOUBLE PRECISION,
    "userLng" DOUBLE PRECISION,
    "isAtVenue" BOOLEAN NOT NULL DEFAULT false,
    "distanceToMachineM" DOUBLE PRECISION,
    "journeyStartedAt" TIMESTAMP(3),
    "journeyCompletedAt" TIMESTAMP(3),
    "checkpointsReached" INTEGER NOT NULL DEFAULT 0,
    "tkdEarned" INTEGER NOT NULL DEFAULT 0,
    "userAgent" TEXT,
    "referrer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NavigationSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LocationVisit" (
    "id" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "userId" TEXT,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    "navigationSessionId" TEXT,

    CONSTRAINT "LocationVisit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Location_state_idx" ON "Location"("state");
CREATE INDEX "Location_locationType_idx" ON "Location"("locationType");
CREATE INDEX "Location_locationStatus_idx" ON "Location"("locationStatus");
CREATE INDEX "NavigationSession_locationId_idx" ON "NavigationSession"("locationId");
CREATE INDEX "NavigationSession_createdAt_idx" ON "NavigationSession"("createdAt");
CREATE INDEX "NavigationSession_entryMethod_idx" ON "NavigationSession"("entryMethod");
CREATE INDEX "LocationVisit_locationId_idx" ON "LocationVisit"("locationId");
CREATE INDEX "LocationVisit_visitedAt_idx" ON "LocationVisit"("visitedAt");

ALTER TABLE "NavigationSession"
ADD CONSTRAINT "NavigationSession_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LocationVisit"
ADD CONSTRAINT "LocationVisit_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
