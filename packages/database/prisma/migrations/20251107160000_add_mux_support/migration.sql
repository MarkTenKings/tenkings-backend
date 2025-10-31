ALTER TABLE "LiveRip"
  ADD COLUMN "muxAssetId" text,
  ADD COLUMN "muxPlaybackId" text;

ALTER TABLE "KioskSession"
  ADD COLUMN "muxStreamId" text,
  ADD COLUMN "muxStreamKey" text,
  ADD COLUMN "muxPlaybackId" text,
  ADD COLUMN "muxAssetId" text,
  ADD COLUMN "muxBroadcastId" text;
