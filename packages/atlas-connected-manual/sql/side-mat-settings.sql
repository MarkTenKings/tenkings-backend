-- Explicit per-photo mat settings. Historical details inherit matColor;
-- absent/null side overrides do not rewrite existing details or geometry jobs.
-- Preserve the existing ownership, selected-upload, discard and source fences.
BEGIN;
CREATE FUNCTION atlas_manual_connected.geometry_side_settings(details jsonb, selected_side text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN selected_side IN ('FRONT','BACK') THEN jsonb_build_object(
   'matColor',COALESCE(details->>(CASE selected_side WHEN 'FRONT' THEN 'frontMatColor' ELSE 'backMatColor' END),details->>'matColor','BLACK'),
   'cornerShape',COALESCE(details->>'cornerShape','ROUNDED_3_18_MM')) ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION atlas_manual_connected.geometry_side_settings(jsonb,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION atlas_manual_connected.pending_early_geometry(engine text, after_created timestamptz, after_upload uuid)
RETURNS TABLE(card_id uuid,upload_id uuid,side text,plan text,verification text,source text,settings jsonb,created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
 SELECT c.id,u.id,u.side,u.plan,u.verification,u.source,
 atlas_manual_connected.geometry_side_settings(d.content::jsonb,u.side),i.created_at
 FROM atlas_manual_connected.early_geometry_intent i
 JOIN atlas_manual_intake.card c ON c.id=i.card_id AND c.owner_id=i.actor_id
 JOIN atlas_manual_intake.upload u ON u.id=i.upload_id AND u.card_id=c.id AND u.source IS NOT NULL
 JOIN atlas_staff."StaffIdentity" a ON a.id=i.actor_id AND a."accessVersion"=i.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 LEFT JOIN atlas_manual_connected.details d ON d.card_id=c.id
 WHERE NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id)
 AND u.id=CASE u.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND (after_created IS NULL OR (i.created_at,u.id)>(after_created,after_upload))
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_connected.early_geometry j WHERE j.upload_id=u.id AND j.engine_hash=engine
 AND j.input::jsonb->'settings'=atlas_manual_connected.geometry_side_settings(d.content::jsonb,u.side))
 ORDER BY i.created_at,u.id LIMIT 2;
$$;
REVOKE ALL ON FUNCTION atlas_manual_connected.pending_early_geometry(text,timestamptz,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION atlas_manual_connected.pending_early_geometry(engine text, after_created timestamptz, after_upload uuid, page_size integer)
RETURNS TABLE(card_id uuid,upload_id uuid,side text,plan text,verification text,source text,settings jsonb,created_at timestamptz,cursor_created_at text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
BEGIN
 IF engine IS NULL OR engine !~ '^[a-f0-9]{64}$' OR page_size IS NULL OR page_size<1 OR page_size>32
 OR (after_created IS NULL)<>(after_upload IS NULL) THEN RAISE EXCEPTION 'Invalid geometry discovery'; END IF;
 RETURN QUERY
 SELECT c.id,u.id,u.side,u.plan,u.verification,u.source,
 atlas_manual_connected.geometry_side_settings(d.content::jsonb,u.side),i.created_at,
 to_char(i.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 FROM atlas_manual_connected.early_geometry_intent i
 JOIN atlas_manual_intake.card c ON c.id=i.card_id AND c.owner_id=i.actor_id
 JOIN atlas_manual_intake.upload u ON u.id=i.upload_id AND u.card_id=c.id AND u.source IS NOT NULL
 JOIN atlas_staff."StaffIdentity" a ON a.id=i.actor_id AND a."accessVersion"=i.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 LEFT JOIN atlas_manual_connected.details d ON d.card_id=c.id
 WHERE NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id)
 AND u.id=CASE u.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND (after_created IS NULL OR (i.created_at,u.id)>(after_created,after_upload))
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_connected.early_geometry j WHERE j.upload_id=u.id AND j.engine_hash=engine
 AND j.input::jsonb->'settings'=atlas_manual_connected.geometry_side_settings(d.content::jsonb,u.side))
 ORDER BY i.created_at,u.id LIMIT page_size;
END; $$;
REVOKE ALL ON FUNCTION atlas_manual_connected.pending_early_geometry(text,timestamptz,uuid,integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION atlas_manual_connected.queue_early_geometry(payload text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
DECLARE v jsonb; i atlas_manual_connected.early_geometry_intent%ROWTYPE; u atlas_manual_intake.upload%ROWTYPE; d jsonb;
BEGIN
 IF octet_length(payload)>32768 THEN RAISE EXCEPTION 'Invalid geometry payload'; END IF;
 v=payload::jsonb;
 -- Discard locks this same intake row FOR UPDATE. Read the tombstone only
 -- after this lock statement returns, using a fresh READ COMMITTED snapshot.
 PERFORM c.id FROM atlas_manual_intake.card c WHERE c.id=(v->>'cardId')::uuid FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT x.* INTO i FROM atlas_manual_connected.early_geometry_intent x
 JOIN atlas_manual_intake.card c ON c.id=x.card_id AND c.owner_id=x.actor_id
 JOIN atlas_staff."StaffIdentity" a ON a.id=x.actor_id AND a."accessVersion"=x.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 WHERE x.upload_id=(v->>'uploadId')::uuid AND c.id=(v->>'cardId')::uuid
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id)
 AND x.upload_id=CASE v->>'side' WHEN 'FRONT' THEN c.front_upload_id WHEN 'BACK' THEN c.back_upload_id END;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO u FROM atlas_manual_intake.upload WHERE id=i.upload_id AND card_id=i.card_id;
 SELECT content::jsonb INTO d FROM atlas_manual_connected.details WHERE card_id=i.card_id;
 IF v->>'policy' IS DISTINCT FROM 'atlas-early-photo-geometry-v1' OR v->>'side' IS DISTINCT FROM u.side OR v->'plan' IS DISTINCT FROM u.plan::jsonb
 OR v->'verification' IS DISTINCT FROM u.verification::jsonb OR v->'photoSource' IS DISTINCT FROM u.source::jsonb
 OR v->'settings' IS DISTINCT FROM atlas_manual_connected.geometry_side_settings(d,u.side)
 THEN RETURN false; END IF;
 INSERT INTO atlas_manual_connected.early_geometry(key,card_id,upload_id,side,actor_id,access_version,engine_hash,input)
 VALUES(encode(sha256(convert_to(payload,'UTF8')),'hex'),i.card_id,i.upload_id,u.side,i.actor_id,i.access_version,
 v->>'engineHash',payload) ON CONFLICT DO NOTHING;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION atlas_manual_connected.queue_early_geometry(text) FROM PUBLIC;
COMMIT;
