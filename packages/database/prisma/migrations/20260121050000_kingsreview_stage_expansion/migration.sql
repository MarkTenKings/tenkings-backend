-- Expand CardReviewStage enum for KingsReview pipeline

DO $$
BEGIN
  ALTER TYPE "CardReviewStage" ADD VALUE IF NOT EXISTS 'BYTEBOT_RUNNING';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TYPE "CardReviewStage" ADD VALUE IF NOT EXISTS 'INVENTORY_READY_FOR_SALE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
