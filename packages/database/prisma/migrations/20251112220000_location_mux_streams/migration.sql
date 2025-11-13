-- Add reusable Mux stream info per location
ALTER TABLE "Location"
  ADD COLUMN "muxStreamId" text,
  ADD COLUMN "muxStreamKey" text,
  ADD COLUMN "muxPlaybackId" text;
