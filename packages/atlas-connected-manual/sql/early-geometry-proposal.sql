-- INACTIVE additive migration proposal 43; final numbering/ACL wiring is lead-owned.
BEGIN;
CREATE TABLE atlas_manual_connected.early_geometry_intent (
 upload_id uuid PRIMARY KEY REFERENCES atlas_manual_intake.upload(id),
 card_id uuid NOT NULL REFERENCES atlas_manual_intake.card(id),
 actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 access_version integer NOT NULL CHECK(access_version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON atlas_manual_connected.early_geometry_intent FROM PUBLIC;
CREATE TABLE atlas_manual_connected.early_geometry (
 key text PRIMARY KEY CHECK(key ~ '^[a-f0-9]{64}$'),
 card_id uuid NOT NULL REFERENCES atlas_manual_intake.card(id),
 upload_id uuid NOT NULL REFERENCES atlas_manual_intake.upload(id),
 side text NOT NULL CHECK(side IN ('FRONT','BACK')),
 actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 access_version integer NOT NULL CHECK(access_version>0),
 engine_hash text NOT NULL CHECK(engine_hash ~ '^[a-f0-9]{64}$'),
 input text NOT NULL CHECK(octet_length(input)<=32768 AND key=encode(sha256(convert_to(input,'UTF8')),'hex')),
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','READY','NEEDS_REVIEW','FAILED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 claim_id uuid, lease_until timestamptz,
 result text CHECK(result IS NULL OR (octet_length(result)<=32768 AND jsonb_typeof(result::jsonb)='object')),
 error text CHECK(error IS NULL OR error ~ '^[A-Z][A-Z0-9_]{0,100}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((state='RUNNING' AND claim_id IS NOT NULL AND lease_until IS NOT NULL) OR (state<>'RUNNING' AND claim_id IS NULL AND lease_until IS NULL)),
 CHECK((state IN ('READY','NEEDS_REVIEW'))=(result IS NOT NULL))
);
CREATE INDEX early_geometry_pending ON atlas_manual_connected.early_geometry(engine_hash,created_at,key) WHERE state IN ('QUEUED','RUNNING');
REVOKE ALL ON atlas_manual_connected.early_geometry FROM PUBLIC;

-- Source intents are inserted atomically with source verification. Discovery
-- can recover even if the serving process dies before its post-commit wakeup.
CREATE FUNCTION atlas_manual_connected.pending_early_geometry(engine text, after_created timestamptz, after_upload uuid)
RETURNS TABLE(card_id uuid,upload_id uuid,side text,plan text,verification text,source text,settings jsonb,created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
 SELECT c.id,u.id,u.side,u.plan,u.verification,u.source,
 jsonb_build_object('matColor',COALESCE(d.content::jsonb->>'matColor','BLACK'),'cornerShape',COALESCE(d.content::jsonb->>'cornerShape','ROUNDED_3_18_MM')),i.created_at
 FROM atlas_manual_connected.early_geometry_intent i
 JOIN atlas_manual_intake.card c ON c.id=i.card_id AND c.owner_id=i.actor_id
 JOIN atlas_manual_intake.upload u ON u.id=i.upload_id AND u.card_id=c.id AND u.source IS NOT NULL
 JOIN atlas_staff."StaffIdentity" a ON a.id=i.actor_id AND a."accessVersion"=i.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 LEFT JOIN atlas_manual_connected.details d ON d.card_id=c.id
 WHERE u.id=CASE u.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND (after_created IS NULL OR (i.created_at,u.id)>(after_created,after_upload))
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_connected.early_geometry j WHERE j.upload_id=u.id AND j.engine_hash=engine
 AND j.input::jsonb->'settings'=jsonb_build_object('matColor',COALESCE(d.content::jsonb->>'matColor','BLACK'),'cornerShape',COALESCE(d.content::jsonb->>'cornerShape','ROUNDED_3_18_MM')))
 ORDER BY i.created_at,u.id LIMIT 2;
$$;
REVOKE ALL ON FUNCTION atlas_manual_connected.pending_early_geometry(text,timestamptz,uuid) FROM PUBLIC;

CREATE FUNCTION atlas_manual_connected.queue_early_geometry(payload text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
DECLARE v jsonb; i atlas_manual_connected.early_geometry_intent%ROWTYPE; u atlas_manual_intake.upload%ROWTYPE; d jsonb;
BEGIN
 IF octet_length(payload)>32768 THEN RAISE EXCEPTION 'Invalid geometry payload'; END IF;
 v=payload::jsonb;
 SELECT x.* INTO i FROM atlas_manual_connected.early_geometry_intent x
 JOIN atlas_manual_intake.card c ON c.id=x.card_id AND c.owner_id=x.actor_id
 JOIN atlas_staff."StaffIdentity" a ON a.id=x.actor_id AND a."accessVersion"=x.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 WHERE x.upload_id=(v->>'uploadId')::uuid AND c.id=(v->>'cardId')::uuid
 AND x.upload_id=CASE v->>'side' WHEN 'FRONT' THEN c.front_upload_id WHEN 'BACK' THEN c.back_upload_id END;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO u FROM atlas_manual_intake.upload WHERE id=i.upload_id AND card_id=i.card_id;
 SELECT content::jsonb INTO d FROM atlas_manual_connected.details WHERE card_id=i.card_id;
 IF v->>'policy' IS DISTINCT FROM 'atlas-early-photo-geometry-v1' OR v->>'side' IS DISTINCT FROM u.side OR v->'plan' IS DISTINCT FROM u.plan::jsonb
 OR v->'verification' IS DISTINCT FROM u.verification::jsonb OR v->'photoSource' IS DISTINCT FROM u.source::jsonb
 OR v->'settings' IS DISTINCT FROM jsonb_build_object('matColor',COALESCE(d->>'matColor','BLACK'),'cornerShape',COALESCE(d->>'cornerShape','ROUNDED_3_18_MM'))
 THEN RETURN false; END IF;
 INSERT INTO atlas_manual_connected.early_geometry(key,card_id,upload_id,side,actor_id,access_version,engine_hash,input)
 VALUES(encode(sha256(convert_to(payload,'UTF8')),'hex'),i.card_id,i.upload_id,u.side,i.actor_id,i.access_version,
 v->>'engineHash',payload) ON CONFLICT DO NOTHING;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION atlas_manual_connected.queue_early_geometry(text) FROM PUBLIC;

-- Accepted CPU work only. No manual-card/draft/approval writes and no external
-- dispatch. A revoked/replaced owner or selected photo cannot obtain a claim.
-- A database-wide claim lock caps native background work across host processes.
CREATE FUNCTION atlas_manual_connected.claim_early_geometry(engine text, claim uuid)
RETURNS SETOF atlas_manual_connected.early_geometry LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
DECLARE selected_key text;
BEGIN
 IF engine !~ '^[a-f0-9]{64}$' OR claim IS NULL THEN RAISE EXCEPTION 'Invalid geometry claim'; END IF;
 PERFORM pg_advisory_xact_lock(721930,43);
 UPDATE atlas_manual_connected.early_geometry SET state='FAILED',claim_id=NULL,lease_until=NULL,error='GEOMETRY_INTERRUPTED',updated_at=clock_timestamp()
 WHERE attempts>=3 AND (state='QUEUED' OR (state='RUNNING' AND lease_until<=clock_timestamp()));
 IF (SELECT count(*) FROM atlas_manual_connected.early_geometry WHERE state='RUNNING' AND lease_until>clock_timestamp())>=2 THEN RETURN; END IF;
 SELECT j.key INTO selected_key FROM atlas_manual_connected.early_geometry j
 JOIN atlas_manual_intake.card c ON c.id=j.card_id AND c.owner_id=j.actor_id
 JOIN atlas_staff."StaffIdentity" a ON a.id=j.actor_id AND a."accessVersion"=j.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 WHERE j.engine_hash=engine AND j.attempts<3 AND (j.state='QUEUED' OR (j.state='RUNNING' AND j.lease_until<=clock_timestamp()))
 AND j.upload_id=CASE j.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 ORDER BY j.created_at,j.key LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
 IF selected_key IS NULL THEN RETURN; END IF;
 RETURN QUERY UPDATE atlas_manual_connected.early_geometry SET state='RUNNING',claim_id=claim,
 lease_until=clock_timestamp()+interval '11 minutes',attempts=attempts+1,error=NULL,updated_at=clock_timestamp()
 WHERE key=selected_key RETURNING *;
END; $$;
REVOKE ALL ON FUNCTION atlas_manual_connected.claim_early_geometry(text,uuid) FROM PUBLIC;

CREATE FUNCTION atlas_manual_connected.finish_early_geometry(job_key text, claim uuid, outcome text, evidence text, failure text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
DECLARE changed integer;
BEGIN
 IF outcome NOT IN ('READY','NEEDS_REVIEW','FAILED','QUEUED') OR ((outcome IN ('READY','NEEDS_REVIEW'))<>(evidence IS NOT NULL))
 THEN RAISE EXCEPTION 'Invalid geometry outcome'; END IF;
 -- The old worker has stopped consuming its CPU slot. Release its own lease
 -- even when selection/authorization changed, without publishing its result.
 UPDATE atlas_manual_connected.early_geometry j SET state='FAILED',result=NULL,error='GEOMETRY_WORK_SUPERSEDED',
 claim_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
 WHERE j.key=job_key AND j.state='RUNNING' AND j.claim_id=claim AND j.lease_until>clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.card c JOIN atlas_staff."StaffIdentity" a ON a.id=c.owner_id
 WHERE c.id=j.card_id AND c.owner_id=j.actor_id AND a."accessVersion"=j.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 AND j.upload_id=CASE j.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END);
 GET DIAGNOSTICS changed=ROW_COUNT; IF changed=1 THEN RETURN false; END IF;
 UPDATE atlas_manual_connected.early_geometry j SET state=outcome,result=evidence,error=failure,
 claim_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
 WHERE j.key=job_key AND j.state='RUNNING' AND j.claim_id=claim AND j.lease_until>clock_timestamp()
 AND EXISTS(SELECT 1 FROM atlas_manual_intake.card c JOIN atlas_staff."StaffIdentity" a ON a.id=c.owner_id
 WHERE c.id=j.card_id AND c.owner_id=j.actor_id AND a."accessVersion"=j.access_version AND a."revokedAt" IS NULL AND a.role='REVIEWER'
 AND j.upload_id=CASE j.side WHEN 'FRONT' THEN c.front_upload_id ELSE c.back_upload_id END);
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed=1;
END; $$;
REVOKE ALL ON FUNCTION atlas_manual_connected.finish_early_geometry(text,uuid,text,text,text) FROM PUBLIC;
COMMIT;
