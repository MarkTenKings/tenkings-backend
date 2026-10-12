BEGIN;
-- Human confirmation no longer requires prose or an automatic grading request.
-- Retain every historical confirmation and its optional notes/analysis linkage.
ALTER TABLE atlas_manual_connected.variant_confirmation
  DROP CONSTRAINT variant_confirmation_check1,
  ALTER COLUMN analysis_action_id DROP NOT NULL;
COMMIT;
