-- Isolated visual review reads the current saved grading image without image
-- queue access or provider authority. The machine boundary rechecks deployment
-- authorization around this read; this projection also binds mode and upload.
CREATE FUNCTION atlas_manual_connected.read_grading_photo(p_card uuid,p_upload uuid,p_side text,p_mode text)
RETURNS TABLE(key text,state text,result text,result_hash text,source_hash text,recipe_hash text,bound_original_sha256 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT j.key,j.state,j.result,j.result_hash,j.source_hash,j.recipe_hash,b.original_sha256
 FROM atlas_manual_connected.card_image_binding b
 JOIN atlas_manual_connected.report_image_job j ON j.key=b.job_key
 JOIN atlas_manual_intake.card c ON c.id=b.card_id
 JOIN atlas_manual_intake.upload u ON u.card_id=c.id AND u.id=b.upload_id AND u.side=b.side
 WHERE b.card_id=p_card AND b.upload_id=p_upload AND b.side=p_side AND j.mode=p_mode
 AND b.upload_id=CASE WHEN b.side='FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND b.original_sha256=u.plan::jsonb->'expected'->>'sha256'
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=c.id)
$$;
REVOKE ALL ON FUNCTION atlas_manual_connected.read_grading_photo(uuid,uuid,text,text) FROM PUBLIC;
