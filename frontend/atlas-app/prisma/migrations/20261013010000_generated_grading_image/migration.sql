-- Generated grading frames carry an exact upload's coordinate/lineage binding.
-- Repeated work for that upload shares a job; another submission has its own frame.
ALTER TABLE atlas_manual_connected.report_image_job
 DROP CONSTRAINT report_image_job_source_hash_recipe_hash_key;
CREATE UNIQUE INDEX report_image_upload_recipe ON atlas_manual_connected.report_image_job
 (source_hash,recipe_hash,((source_media::jsonb)->'original'->>'uploadId'));
