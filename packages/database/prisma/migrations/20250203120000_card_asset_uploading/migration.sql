-- Create the CardAssetStatus enum if it does not exist yet (fresh databases)
DO $$
BEGIN
  CREATE TYPE "CardAssetStatus" AS ENUM (
    'UPLOADING',
    'UPLOADED',
    'OCR_PENDING',
    'OCR_COMPLETE',
    'CLASSIFY_PENDING',
    'CLASSIFIED',
    'VALUATION_PENDING',
    'READY',
    'ASSIGNED',
    'ERROR'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Add the new status to existing databases
DO $$
BEGIN
  ALTER TYPE "CardAssetStatus" ADD VALUE 'UPLOADING';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Ensure new uploads default to the pending status until the asset is processed
ALTER TABLE IF EXISTS "CardAsset"
  ALTER COLUMN "status" SET DEFAULT 'UPLOADING';
