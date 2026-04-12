-- Stocker Operations Phase A

ALTER TABLE "User"
ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';

CREATE TABLE "stocker_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stocker_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_routes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "locationIds" TEXT[],
    "totalDistanceM" INTEGER,
    "totalDurationS" INTEGER,
    "encodedPolyline" TEXT,
    "legsData" JSONB,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_routes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stocker_shifts" (
    "id" TEXT NOT NULL,
    "stockerId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "assignedDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "clockInAt" TIMESTAMP(3),
    "clockOutAt" TIMESTAMP(3),
    "totalDriveTimeMin" INTEGER,
    "totalOnSiteTimeMin" INTEGER,
    "totalIdleTimeMin" INTEGER,
    "totalDistanceM" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stocker_shifts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stocker_stops" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "stopOrder" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "departedPreviousAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "taskStartedAt" TIMESTAMP(3),
    "taskCompletedAt" TIMESTAMP(3),
    "departedAt" TIMESTAMP(3),
    "driveTimeMin" INTEGER,
    "driveDistanceM" INTEGER,
    "onSiteTimeMin" INTEGER,
    "skipReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stocker_stops_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stocker_positions" (
    "id" TEXT NOT NULL,
    "stockerId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "shiftId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "currentLocationName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stocker_positions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "position_logs" (
    "id" TEXT NOT NULL,
    "stockerId" TEXT NOT NULL,
    "shiftId" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stocker_profiles_userId_key" ON "stocker_profiles"("userId");
CREATE INDEX "stocker_profiles_isActive_idx" ON "stocker_profiles"("isActive");
CREATE INDEX "stock_routes_isTemplate_idx" ON "stock_routes"("isTemplate");
CREATE INDEX "stocker_shifts_stockerId_assignedDate_idx" ON "stocker_shifts"("stockerId", "assignedDate");
CREATE INDEX "stocker_shifts_status_idx" ON "stocker_shifts"("status");
CREATE INDEX "stocker_shifts_assignedDate_idx" ON "stocker_shifts"("assignedDate");
CREATE INDEX "stocker_stops_shiftId_stopOrder_idx" ON "stocker_stops"("shiftId", "stopOrder");
CREATE INDEX "stocker_stops_status_idx" ON "stocker_stops"("status");
CREATE UNIQUE INDEX "stocker_positions_stockerId_key" ON "stocker_positions"("stockerId");
CREATE INDEX "position_logs_stockerId_timestamp_idx" ON "position_logs"("stockerId", "timestamp");
CREATE INDEX "position_logs_shiftId_timestamp_idx" ON "position_logs"("shiftId", "timestamp");

ALTER TABLE "stocker_profiles" ADD CONSTRAINT "stocker_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stocker_shifts" ADD CONSTRAINT "stocker_shifts_stockerId_fkey"
    FOREIGN KEY ("stockerId") REFERENCES "stocker_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stocker_shifts" ADD CONSTRAINT "stocker_shifts_routeId_fkey"
    FOREIGN KEY ("routeId") REFERENCES "stock_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stocker_stops" ADD CONSTRAINT "stocker_stops_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "stocker_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stocker_stops" ADD CONSTRAINT "stocker_stops_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stocker_positions" ADD CONSTRAINT "stocker_positions_stockerId_fkey"
    FOREIGN KEY ("stockerId") REFERENCES "stocker_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
