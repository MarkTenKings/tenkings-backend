-- Explicit, bounded geometry capacity. Existing source, geometry, tombstone,
-- receipt and migration histories are preserved. Defaults remain two workers.
BEGIN;
CREATE TABLE atlas_manual_connected.geometry_claim_capacity (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 concurrency integer NOT NULL CHECK(concurrency BETWEEN 1 AND 12)
);
INSERT INTO atlas_manual_connected.geometry_claim_capacity(singleton,concurrency) VALUES(true,2);
REVOKE ALL ON atlas_manual_connected.geometry_claim_capacity FROM PUBLIC;

CREATE FUNCTION atlas_manual_connected.pending_early_geometry(engine text, after_created timestamptz, after_upload uuid, page_size integer)
RETURNS TABLE(card_id uuid,upload_id uuid,side text,plan text,verification text,source text,settings jsonb,created_at timestamptz,cursor_created_at text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
BEGIN
 IF engine IS NULL OR engine !~ '^[a-f0-9]{64}$' OR page_size IS NULL OR page_size<1 OR page_size>32
 OR (after_created IS NULL)<>(after_upload IS NULL) THEN RAISE EXCEPTION 'Invalid geometry discovery'; END IF;
 RETURN QUERY
 SELECT c.id,u.id,u.side,u.plan,u.verification,u.source,
 jsonb_build_object('matColor',COALESCE(d.content::jsonb->>'matColor','BLACK'),'cornerShape',COALESCE(d.content::jsonb->>'cornerShape','ROUNDED_3_18_MM')),i.created_at,
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
 AND j.input::jsonb->'settings'=jsonb_build_object('matColor',COALESCE(d.content::jsonb->>'matColor','BLACK'),'cornerShape',COALESCE(d.content::jsonb->>'cornerShape','ROUNDED_3_18_MM')))
 ORDER BY i.created_at,u.id LIMIT page_size;
END; $$;
REVOKE ALL ON FUNCTION atlas_manual_connected.pending_early_geometry(text,timestamptz,uuid,integer) FROM PUBLIC;

CREATE FUNCTION atlas_manual_connected.claim_early_geometry(engine text, claim uuid, capacity integer)
RETURNS SETOF atlas_manual_connected.early_geometry LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
DECLARE selected_key text; active_count integer; active_capacity integer;
BEGIN
 IF engine IS NULL OR engine !~ '^[a-f0-9]{64}$' OR claim IS NULL OR capacity IS NULL OR capacity<1 OR capacity>12 THEN RAISE EXCEPTION 'Invalid geometry claim'; END IF;
 PERFORM pg_advisory_xact_lock(721930,43);
 -- Discarded work cannot be claimed again. Retire both unstarted jobs and
 -- expired claims left by a dead worker, regardless of the attempt count.
 -- An unexpired claim still represents CPU work; its owner releases it in
 -- finish_early_geometry, or this reaper releases it only after expiry.
 UPDATE atlas_manual_connected.early_geometry j SET state='FAILED',claim_id=NULL,lease_until=NULL,
 result=NULL,error='INTAKE_CARD_DELETED',updated_at=clock_timestamp()
 WHERE (j.state='QUEUED' OR (j.state='RUNNING' AND j.lease_until<=clock_timestamp()))
 AND EXISTS(SELECT 1 FROM atlas_manual_intake.card c
   JOIN atlas_manual_intake.discarded_card x ON x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id
   WHERE c.id=j.card_id);
 UPDATE atlas_manual_connected.early_geometry SET state='FAILED',claim_id=NULL,lease_until=NULL,error='GEOMETRY_INTERRUPTED',updated_at=clock_timestamp()
 WHERE attempts>=3 AND (state='QUEUED' OR (state='RUNNING' AND lease_until<=clock_timestamp()));
 SELECT count(*)::integer INTO active_count FROM atlas_manual_connected.early_geometry
 WHERE state='RUNNING' AND lease_until>clock_timestamp();
 SELECT concurrency INTO active_capacity FROM atlas_manual_connected.geometry_claim_capacity WHERE singleton;
 IF active_capacity IS NULL THEN RAISE EXCEPTION 'Geometry capacity configuration missing'; END IF;
 -- A rolling deployment cannot combine two independently chosen ceilings.
 -- Existing unexpired work pins its limit until every claim drains or expires.
 IF active_count>0 AND active_capacity<>capacity THEN RETURN; END IF;
 IF active_count>=capacity THEN RETURN; END IF;
 IF active_count=0 AND active_capacity<>capacity THEN
   UPDATE atlas_manual_connected.geometry_claim_capacity SET concurrency=capacity WHERE singleton;
 END IF;
 SELECT j.key INTO selected_key FROM atlas_manual_connected.early_geometry j
 JOIN atlas_manual_intake.card c ON c.id=j.card_id AND c.owner_id=j.actor_id
 JOIN atlas_staff."StaffIdentity" a ON a.id=j.actor_id AND a."accessVersion"=j.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 WHERE j.engine_hash=engine AND j.attempts<3 AND (j.state='QUEUED' OR (j.state='RUNNING' AND j.lease_until<=clock_timestamp()))
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id)
 AND j.upload_id=CASE j.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 ORDER BY j.created_at,j.key LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
 IF selected_key IS NULL THEN RETURN; END IF;
 -- Keep job->intake lock order in claim and finish. The candidate predicate
 -- above is an optimization; this lock and separate fresh check are the fence.
 PERFORM c.id FROM atlas_manual_intake.card c
 JOIN atlas_manual_connected.early_geometry j ON j.card_id=c.id
 WHERE j.key=selected_key FOR SHARE OF c;
 IF NOT FOUND THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM atlas_manual_connected.early_geometry j
 JOIN atlas_manual_intake.card c ON c.id=j.card_id AND c.owner_id=j.actor_id
 JOIN atlas_staff."StaffIdentity" a ON a.id=j.actor_id AND a."accessVersion"=j.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 WHERE j.key=selected_key AND j.upload_id=CASE j.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id)) THEN RETURN; END IF;
 RETURN QUERY UPDATE atlas_manual_connected.early_geometry SET state='RUNNING',claim_id=claim,
 lease_until=clock_timestamp()+interval '11 minutes',attempts=attempts+1,error=NULL,updated_at=clock_timestamp()
 WHERE key=selected_key RETURNING *;
END; $$;
REVOKE ALL ON FUNCTION atlas_manual_connected.claim_early_geometry(text,uuid,integer) FROM PUBLIC;

-- Retain the exact legacy interface and its conservative two-worker default.
-- Both generations participate in the same persisted global-capacity fence.
CREATE OR REPLACE FUNCTION atlas_manual_connected.claim_early_geometry(engine text, claim uuid)
RETURNS SETOF atlas_manual_connected.early_geometry LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,atlas_manual_connected AS $$
 SELECT * FROM atlas_manual_connected.claim_early_geometry(engine,claim,2);
$$;
REVOKE ALL ON FUNCTION atlas_manual_connected.claim_early_geometry(text,uuid) FROM PUBLIC;
COMMIT;
