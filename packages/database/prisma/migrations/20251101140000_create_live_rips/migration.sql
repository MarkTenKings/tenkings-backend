CREATE TABLE "LiveRip" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "videoUrl" text NOT NULL,
  "thumbnailUrl" text,
  "locationId" uuid,
  "featured" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "LiveRip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveRip_slug_key" ON "LiveRip"("slug");

ALTER TABLE "LiveRip"
  ADD CONSTRAINT "LiveRip_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
