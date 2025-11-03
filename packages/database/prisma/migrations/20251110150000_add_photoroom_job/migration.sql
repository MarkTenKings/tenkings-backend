DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'PHOTOROOM'
      AND enumtypid = 'ProcessingJobType'::regtype
  ) THEN
    ALTER TYPE "ProcessingJobType" ADD VALUE 'PHOTOROOM';
  END IF;
END $$;
