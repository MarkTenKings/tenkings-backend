-- Owner-authorized workspace retirement. No original, paid receipt, audit,
-- account, configuration or immutable grading history is deleted or rewritten.
BEGIN;
CREATE TABLE atlas_manual_intake.discard_request (
 owner_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 request_id uuid NOT NULL,
 request text NOT NULL CHECK(octet_length(request)<=32768),
 request_hash text NOT NULL CHECK(request_hash=encode(sha256(convert_to(request,'UTF8')),'hex')),
 receipt text NOT NULL,
 receipt_hash text NOT NULL CHECK(receipt_hash=encode(sha256(convert_to(receipt,'UTF8')),'hex')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,request_id)
);
CREATE TABLE atlas_manual_intake.discarded_card (
 owner_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 create_request_id uuid NOT NULL,
 card_id uuid UNIQUE REFERENCES atlas_manual_intake.card(id),
 request_id uuid NOT NULL,
 discarded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,create_request_id),
 FOREIGN KEY(owner_id,request_id) REFERENCES atlas_manual_intake.discard_request(owner_id,request_id)
);
CREATE FUNCTION atlas_manual_intake.discard_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Workspace discard history is immutable'; END; $$;
CREATE TRIGGER discard_request_immutable BEFORE UPDATE OR DELETE ON atlas_manual_intake.discard_request
 FOR EACH ROW EXECUTE FUNCTION atlas_manual_intake.discard_immutable();
CREATE TRIGGER discarded_card_immutable BEFORE UPDATE OR DELETE ON atlas_manual_intake.discarded_card
 FOR EACH ROW EXECUTE FUNCTION atlas_manual_intake.discard_immutable();
-- Same owner lock is used by application create/discard, including local-only
-- create IDs that have no card row to lock yet. Old clients cannot resurrect one.
CREATE TRIGGER discard_request_no_truncate BEFORE TRUNCATE ON atlas_manual_intake.discard_request
 FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual_intake.discard_immutable();
CREATE TRIGGER discarded_card_no_truncate BEFORE TRUNCATE ON atlas_manual_intake.discarded_card
 FOR EACH STATEMENT EXECUTE FUNCTION atlas_manual_intake.discard_immutable();
CREATE FUNCTION atlas_manual_intake.discard_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c atlas_manual_intake.card%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-intake-discard:'||NEW.owner_id::text,0));
 SELECT * INTO c FROM atlas_manual_intake.card WHERE owner_id=NEW.owner_id AND create_request_id=NEW.create_request_id FOR UPDATE;
 IF c.id IS DISTINCT FROM NEW.card_id THEN RAISE EXCEPTION 'Workspace discard card binding mismatch'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER discarded_card_insert BEFORE INSERT ON atlas_manual_intake.discarded_card
 FOR EACH ROW EXECUTE FUNCTION atlas_manual_intake.discard_insert_guard();
CREATE FUNCTION atlas_manual_intake.create_discard_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-intake-discard:'||NEW.owner_id::text,0));
 IF EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card WHERE owner_id=NEW.owner_id AND create_request_id=NEW.create_request_id)
 THEN RAISE EXCEPTION 'Intake card was deleted'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER intake_create_discard_guard BEFORE INSERT ON atlas_manual_intake.card
 FOR EACH ROW EXECUTE FUNCTION atlas_manual_intake.create_discard_guard();
REVOKE ALL ON atlas_manual_intake.discard_request,atlas_manual_intake.discarded_card FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_manual_intake.discard_immutable(),atlas_manual_intake.discard_insert_guard(),atlas_manual_intake.create_discard_guard() FROM PUBLIC;
CREATE OR REPLACE FUNCTION atlas_manual_connected.pending_early_geometry(engine text, after_created timestamptz, after_upload uuid)
RETURNS TABLE(card_id uuid,upload_id uuid,side text,plan text,verification text,source text,settings jsonb,created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
 SELECT c.id,u.id,u.side,u.plan,u.verification,u.source,
 jsonb_build_object('matColor',COALESCE(d.content::jsonb->>'matColor','BLACK'),'cornerShape',COALESCE(d.content::jsonb->>'cornerShape','ROUNDED_3_18_MM')),i.created_at
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
 ORDER BY i.created_at,u.id LIMIT 2;
$$;
REVOKE ALL ON FUNCTION atlas_manual_connected.pending_early_geometry(text,timestamptz,uuid) FROM PUBLIC;

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
CREATE OR REPLACE FUNCTION atlas_manual_connected.claim_early_geometry(engine text, claim uuid)
RETURNS SETOF atlas_manual_connected.early_geometry LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
DECLARE selected_key text;
BEGIN
 IF engine !~ '^[a-f0-9]{64}$' OR claim IS NULL THEN RAISE EXCEPTION 'Invalid geometry claim'; END IF;
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
 IF (SELECT count(*) FROM atlas_manual_connected.early_geometry WHERE state='RUNNING' AND lease_until>clock_timestamp())>=2 THEN RETURN; END IF;
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
REVOKE ALL ON FUNCTION atlas_manual_connected.claim_early_geometry(text,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION atlas_manual_connected.finish_early_geometry(job_key text, claim uuid, outcome text, evidence text, failure text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual_connected AS $$
DECLARE changed integer; selected atlas_manual_connected.early_geometry%ROWTYPE;
BEGIN
 IF outcome NOT IN ('READY','NEEDS_REVIEW','FAILED','QUEUED') OR ((outcome IN ('READY','NEEDS_REVIEW'))<>(evidence IS NOT NULL))
 THEN RAISE EXCEPTION 'Invalid geometry outcome'; END IF;
 SELECT * INTO selected FROM atlas_manual_connected.early_geometry j WHERE j.key=job_key FOR UPDATE;
 IF NOT FOUND OR selected.state<>'RUNNING' OR selected.claim_id IS DISTINCT FROM claim THEN RETURN false; END IF;
 PERFORM c.id FROM atlas_manual_intake.card c WHERE c.id=selected.card_id FOR SHARE;
 -- Never attach a result to a discarded card. Release only this worker's
 -- matching claim, even if its lease expired while waiting; no successor's
 -- claim can be released because the locked row/claim identity must match.
 IF EXISTS(SELECT 1 FROM atlas_manual_intake.card c
 JOIN atlas_manual_intake.discarded_card x ON x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id
 WHERE c.id=selected.card_id) THEN
   UPDATE atlas_manual_connected.early_geometry j SET state='FAILED',result=NULL,error='INTAKE_CARD_DELETED',
     claim_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
   WHERE j.key=job_key AND j.state='RUNNING' AND j.claim_id=claim;
   RETURN false;
 END IF;
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

-- Defense in depth: issued publications are normally ineligible for discard.
CREATE OR REPLACE FUNCTION atlas_manual.read_publication(token text, requested_version integer, deployment text, release text, configuration text)
RETURNS TABLE(card_id uuid, action_id uuid, version integer, mode text, public_hash text, manifest text, manifest_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_manual,atlas_staff AS $$
DECLARE control atlas_staff."PublicReaderControl"%ROWTYPE;
BEGIN
  SELECT * INTO control FROM atlas_staff."PublicReaderControl" WHERE id='active' FOR SHARE;
  IF (control.enabled AND control."deploymentId"=deployment AND control."releaseSha"=release AND control."configHash"=configuration) IS NOT TRUE
    THEN RAISE EXCEPTION 'Public reader binding unavailable'; END IF;
  IF token IS NULL OR token !~ '^ar_[A-Za-z0-9_-]{24}$' OR requested_version<1 THEN RETURN; END IF;
  RETURN QUERY SELECT p.card_id,p.action_id,p.version,p.mode,p.public_hash,p.manifest,p.manifest_hash
    FROM atlas_manual.publication p JOIN atlas_manual.public_report_identity i USING(card_id)
    WHERE i.public_token=token AND p.state='PUBLISHED' AND p.mode=control.mode
      AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.card c
        JOIN atlas_manual_intake.discarded_card x ON x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id
        WHERE c.id=p.card_id)
      AND (p.version=requested_version OR (requested_version IS NULL AND p.version=(SELECT MAX(p2.version) FROM atlas_manual.publication p2 WHERE p2.card_id=p.card_id AND p2.state='PUBLISHED')));
END; $$;
REVOKE ALL ON FUNCTION atlas_manual.read_publication(text,integer,text,text,text) FROM PUBLIC;

CREATE FUNCTION atlas_dealer.manual_link_discard_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM i.id FROM atlas_manual_intake.card i WHERE i.id=NEW.manual_card_id FOR SHARE;
 IF EXISTS(SELECT 1 FROM atlas_manual_intake.card i JOIN atlas_manual_intake.discarded_card x
   ON x.owner_id=i.owner_id AND x.create_request_id=i.create_request_id WHERE i.id=NEW.manual_card_id)
   THEN RAISE EXCEPTION 'INTAKE_CARD_DELETED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER manual_link_discard_guard BEFORE INSERT ON atlas_dealer.manual_card_link
 FOR EACH ROW EXECUTE FUNCTION atlas_dealer.manual_link_discard_guard();
REVOKE ALL ON FUNCTION atlas_dealer.manual_link_discard_guard() FROM PUBLIC;

-- Preserve the installed function contract, SECURITY DEFINER, fixed search_path,
-- owner and existing EXECUTE grants. Body differs only in active candidate read
-- and fenced bind admission with a structured 410 before the defensive trigger.
CREATE OR REPLACE FUNCTION atlas_dealer.staff_call(action text,session_hash text,browser_hash text,binding jsonb,phones text[],d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor record; oc atlas_dealer.order_card; prior atlas_dealer.custody_event; latest atlas_dealer.custody_event; ev atlas_dealer.custody_event;
 ctl atlas_staff."StaffControl"; staff_session atlas_staff."StaffSession"; grant_count integer; authority_time timestamptz;
 loc atlas_dealer.location; ih text; k text; at_time timestamptz; lid uuid; m atlas_dealer.manual_card_link; saved uuid;
BEGIN
 SELECT * INTO actor FROM atlas_manual.authenticate(session_hash,browser_hash,binding,phones);
 IF actor.id IS NULL OR actor.role<>'REVIEWER' THEN RETURN atlas_customer.problem(403,'STAFF_REQUIRED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>16384 THEN RETURN atlas_customer.problem(400,'INVALID_DEALER_OPERATION'); END IF;
 IF action IN ('location_configure','membership_configure') THEN
  SELECT * INTO ctl FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE;
  SELECT * INTO staff_session FROM atlas_staff."StaffSession" WHERE "tokenHash"=session_hash AND "browserHash"=browser_hash FOR SHARE;
  authority_time:=clock_timestamp();
  IF staff_session."createdAt" AT TIME ZONE 'UTC'>authority_time OR (staff_session."createdAt" AT TIME ZONE 'UTC')+interval '5 minutes'<=authority_time THEN RETURN atlas_customer.problem(403,'FRESH_HUMAN_OPERATIONS_REQUIRED'); END IF;
  SELECT count(*) INTO grant_count FROM (SELECT g.id FROM atlas_staff."StaffOperationsGrant" g WHERE g."identityId"=actor.id
   AND g."accessVersion"=actor.access_version AND g."controlRevision"=ctl.revision AND g."revokedAt" IS NULL
   AND (g.mode,g.origin,g."deploymentId",g."releaseSha",g."configHash")=(ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash")
   AND g."createdAt" AT TIME ZONE 'UTC'<=authority_time AND g."expiresAt" AT TIME ZONE 'UTC'>authority_time FOR SHARE) grants;
  IF grant_count<>1 THEN RETURN atlas_customer.problem(403,'FRESH_HUMAN_OPERATIONS_REQUIRED'); END IF;
 END IF;
 IF action='read' THEN
  RETURN jsonb_build_object('locations',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.name,l.id) FROM (SELECT * FROM atlas_dealer.location ORDER BY name,id LIMIT 1000) l),'[]'::jsonb),
   'memberships',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'accountId',account_id,'locationId',location_id,'version',version,'revokedAt',revoked_at) ORDER BY location_id,account_id) FROM atlas_dealer.membership),'[]'::jsonb),
   'orders',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'reference',o.reference,'paidAt',o."paidAt",'cards',
    (SELECT jsonb_agg(atlas_dealer.card_tracking(c.card_id)||jsonb_build_object('orderId',c.order_id,'locationId',c.location_id,'manualCardId',l.manual_card_id,'custodyEvents',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'requestId',e.request_id,'kind',e.kind,'occurredAt',e.occurred_at,'evidence',e.evidence,'actorId',e.actor_id) ORDER BY e.sequence) FROM atlas_dealer.custody_event e WHERE e.card_id=c.card_id),'[]'::jsonb)) ORDER BY c.card_id)
     FROM atlas_dealer.order_card c LEFT JOIN atlas_dealer.manual_card_link l ON l.card_id=c.card_id WHERE c.order_id=o.id)) ORDER BY o."paidAt" DESC)
    FROM(SELECT id,reference,"paidAt" FROM atlas_customer."CommerceOrder" ORDER BY "paidAt" DESC,id LIMIT 100)o),'[]'::jsonb),
   'manualCards',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',candidate.id,'revision',candidate.revision) ORDER BY candidate.updated_at DESC)
    FROM(SELECT id,revision,updated_at FROM atlas_manual.card c WHERE (owner_id=actor.id OR actor.id=ANY(editors))
      AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.card i JOIN atlas_manual_intake.discarded_card x ON x.owner_id=i.owner_id AND x.create_request_id=i.create_request_id WHERE i.id=c.id)
      AND NOT EXISTS(SELECT 1 FROM atlas_dealer.manual_card_link WHERE manual_card_id=c.id) ORDER BY updated_at DESC LIMIT 100)candidate),'[]'::jsonb));
 ELSIF action='location_configure' THEN
  lid:=(d->>'id')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('atlas-location:'||lid,0));
  SELECT * INTO loc FROM atlas_dealer.location WHERE id=lid FOR UPDATE;
  IF loc.id IS NOT NULL AND loc.revision IS DISTINCT FROM (d->>'expectedRevision')::integer THEN RETURN atlas_customer.problem(409,'LOCATION_REVISION_CHANGED'); END IF;
  IF NOT atlas_dealer.valid_schedule(d->'schedule') THEN RETURN atlas_customer.problem(400,'INVALID_SCHEDULE'); END IF;
  IF loc.id IS NULL THEN
   INSERT INTO atlas_dealer.location(id,dealer_id,name,address,latitude,longitude,schedule,terminal_id,terminal_location_id,package_printer_id,entry_token,authorized_until,configured_by,enabled)
   VALUES(lid,(d->>'dealerId')::uuid,d->>'name',d->'address',(d->'position'->>'lat')::numeric,(d->'position'->>'lng')::numeric,d->'schedule',d->>'terminalId',d->>'terminalLocationId',d->>'packagePrinterId',d->>'entryToken',(d->>'authorizedUntil')::timestamptz,actor.id,(d->>'enabled')::boolean);
  ELSE
   IF loc.dealer_id<>(d->>'dealerId')::uuid THEN RETURN atlas_customer.problem(409,'DEALER_BINDING_IMMUTABLE'); END IF;
   UPDATE atlas_dealer.location SET revision=revision+1,name=d->>'name',address=d->'address',latitude=(d->'position'->>'lat')::numeric,longitude=(d->'position'->>'lng')::numeric,
    schedule=d->'schedule',terminal_id=d->>'terminalId',terminal_location_id=d->>'terminalLocationId',package_printer_id=d->>'packagePrinterId',entry_token=d->>'entryToken',authorized_until=(d->>'authorizedUntil')::timestamptz,configured_by=actor.id,enabled=(d->>'enabled')::boolean WHERE id=lid;
  END IF;
  RETURN jsonb_build_object('location',atlas_customer.intake_location(lid));
 ELSIF action='membership_configure' THEN
  INSERT INTO atlas_dealer.membership(account_id,location_id,granted_by,revoked_at)
   VALUES((d->>'accountId')::uuid,(d->>'locationId')::uuid,actor.id,CASE WHEN (d->>'enabled')::boolean THEN NULL ELSE clock_timestamp() END)
   ON CONFLICT(account_id,location_id) DO UPDATE SET version=atlas_dealer.membership.version+1,granted_by=actor.id,revoked_at=EXCLUDED.revoked_at RETURNING id INTO saved;
  RETURN jsonb_build_object('membershipId',saved);
 END IF;
 SELECT * INTO oc FROM atlas_dealer.order_card WHERE card_id=(d->>'cardId')::uuid FOR UPDATE;
 IF oc.card_id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF action='bind_manual' THEN
  SELECT * INTO m FROM atlas_dealer.manual_card_link WHERE card_id=oc.card_id;
  IF m.card_id IS NOT NULL THEN
   IF m.manual_card_id IS DISTINCT FROM (d->>'manualCardId')::uuid THEN RETURN atlas_customer.problem(409,'MANUAL_CARD_ALREADY_BOUND'); END IF;
   RETURN jsonb_build_object('cardId',m.card_id,'manualCardId',m.manual_card_id);
  END IF;
  SELECT * INTO ev FROM atlas_dealer.custody_event WHERE card_id=oc.card_id AND kind='ATLAS_RECEIVED';
  IF ev.id IS NULL OR length(COALESCE(d->>'evidenceRef','')) NOT BETWEEN 1 AND 300
    OR NOT EXISTS(SELECT 1 FROM atlas_manual.card WHERE id=(d->>'manualCardId')::uuid AND (owner_id=actor.id OR actor.id=ANY(editors))) THEN RETURN atlas_customer.problem(409,'PHYSICAL_RECEIPT_AND_CARD_ACCESS_REQUIRED'); END IF;
  -- Lock only a real intake identity; legacy non-intake manual cards remain valid.
  -- Separate statement/check observes a discard that committed while waiting.
  PERFORM i.id FROM atlas_manual_intake.card i WHERE i.id=(d->>'manualCardId')::uuid FOR SHARE;
  IF EXISTS(SELECT 1 FROM atlas_manual_intake.card i JOIN atlas_manual_intake.discarded_card x
    ON x.owner_id=i.owner_id AND x.create_request_id=i.create_request_id WHERE i.id=(d->>'manualCardId')::uuid)
    THEN RETURN atlas_customer.problem(410,'INTAKE_CARD_DELETED'); END IF;
  INSERT INTO atlas_dealer.manual_card_link(card_id,manual_card_id,received_event_id,actor_id,evidence_ref)
   VALUES(oc.card_id,(d->>'manualCardId')::uuid,ev.id,actor.id,d->>'evidenceRef');
  RETURN jsonb_build_object('cardId',oc.card_id,'manualCardId',d->>'manualCardId');
 ELSIF action<>'custody_record' THEN RETURN atlas_customer.problem(400,'INVALID_DEALER_OPERATION'); END IF;
 ih:=atlas_customer.commerce_hash(d); k:=d->>'kind';
 SELECT * INTO prior FROM atlas_dealer.custody_event WHERE card_id=oc.card_id AND request_id=(d->>'requestId')::uuid;
 IF prior.id IS NOT NULL THEN
  IF prior.input_hash IS DISTINCT FROM ih OR prior.actor_id IS DISTINCT FROM actor.id THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
  RETURN jsonb_build_object('eventId',prior.id);
 END IF;
 at_time:=(d->>'occurredAt')::timestamptz;
 IF at_time IS NULL OR at_time>clock_timestamp() OR at_time<(SELECT "paidAt" FROM atlas_customer."CommerceOrder" WHERE id=oc.order_id)
  OR jsonb_typeof(d->'evidence') IS DISTINCT FROM 'object' OR length(COALESCE(d->'evidence'->>'reference','')) NOT BETWEEN 1 AND 300
  OR (d->'evidence')-ARRAY['reference','note','expectedReturnAt']<>'{}'::jsonb OR length(COALESCE(d->'evidence'->>'note',''))>500 THEN RETURN atlas_customer.problem(400,'ACTUAL_CUSTODY_EVIDENCE_REQUIRED'); END IF;
 SELECT * INTO latest FROM atlas_dealer.custody_event WHERE card_id=oc.card_id AND kind NOT IN ('DEPOSIT_DECLARED','DELAY_REPORTED','DELAY_RESOLVED') ORDER BY sequence DESC LIMIT 1;
 IF latest.id IS NOT NULL AND at_time<latest.occurred_at THEN RETURN atlas_customer.problem(409,'CUSTODY_EVENT_ORDER'); END IF;
 IF ((k='COLLECTED' AND oc.channel='KIOSK' AND latest.id IS NULL)
  OR (k='ATLAS_RECEIVED' AND (oc.channel='MAIL_IN' AND latest.id IS NULL OR latest.kind='COLLECTED'))
  OR (k IN ('RETURN_DISPATCHED','MAIL_DISPATCHED') AND latest.kind='ATLAS_RECEIVED' AND (k='RETURN_DISPATCHED')=(oc.channel='KIOSK')
   AND EXISTS(SELECT 1 FROM atlas_dealer.manual_card_link l JOIN atlas_manual.approval a ON a.card_id=l.manual_card_id WHERE l.card_id=oc.card_id))
  OR (k='RETURNED_TO_KIOSK' AND latest.kind='RETURN_DISPATCHED') OR (k='CUSTOMER_COLLECTED' AND latest.kind='RETURNED_TO_KIOSK')
  OR (k='CUSTOMER_DELIVERED' AND latest.kind='MAIL_DISPATCHED') OR k IN ('DELAY_REPORTED','DELAY_RESOLVED')) IS NOT TRUE THEN RETURN atlas_customer.problem(409,'CUSTODY_TRANSITION_INVALID'); END IF;
 INSERT INTO atlas_dealer.custody_event(card_id,sequence,request_id,input_hash,kind,actor_id,occurred_at,evidence)
 VALUES(oc.card_id,(SELECT COALESCE(max(sequence),0)+1 FROM atlas_dealer.custody_event WHERE card_id=oc.card_id),(d->>'requestId')::uuid,ih,k,actor.id,at_time,d->'evidence') RETURNING * INTO ev;
 RETURN jsonb_build_object('eventId',ev.id);
END $$;
REVOKE ALL ON FUNCTION atlas_dealer.staff_call(text,text,text,jsonb,text[],jsonb) FROM PUBLIC;

COMMIT;
