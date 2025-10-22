CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE "Location" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "address" text NOT NULL,
  "mapsUrl" text,
  "mediaUrl" text,
  "recentRips" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");
