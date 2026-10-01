-- Additive, cold proposal. Apply AFTER weekly-capacity and dealer handoff proposals.
-- No history replay, preference seeding, provider activation or message sends.
BEGIN;
CREATE TABLE atlas_customer."ProgressNotificationControl" (
 id text PRIMARY KEY CHECK(id='active'), enabled boolean NOT NULL DEFAULT false
);
INSERT INTO atlas_customer."ProgressNotificationControl"(id) VALUES('active');
CREATE TABLE atlas_customer."ProgressPreference" (
 "accountId" uuid PRIMARY KEY REFERENCES atlas_customer."CustomerAccount"(id),
 revision integer NOT NULL CHECK(revision>0), email boolean NOT NULL, sms boolean NOT NULL,
 "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE atlas_customer."ProgressPreferenceEvent" (
 "accountId" uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
 revision integer NOT NULL, "requestId" uuid NOT NULL, email boolean NOT NULL, sms boolean NOT NULL,
 "recordedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY("accountId",revision), UNIQUE("accountId","requestId")
);
CREATE TRIGGER "ProgressPreferenceEvent_immutable" BEFORE UPDATE OR DELETE ON atlas_customer."ProgressPreferenceEvent"
 FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();
CREATE TABLE atlas_customer."ProgressNotification" (
 id text PRIMARY KEY CHECK(length(id)<=180), "accountId" uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
 "cardId" uuid NOT NULL REFERENCES atlas_dealer.order_card(card_id),
 "eventKind" text NOT NULL, source jsonb NOT NULL, "occurredAt" timestamptz NOT NULL,
 channel text NOT NULL CHECK(channel IN ('EMAIL','SMS')), "preferenceRevision" integer NOT NULL,
 destination text NOT NULL, request jsonb NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','DISPATCHED','ACCEPTED','UNKNOWN','SUPPRESSED')),
 "claimId" uuid, result jsonb, "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(), "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((state IN ('DISPATCHED','ACCEPTED','UNKNOWN'))=("claimId" IS NOT NULL))
);
CREATE INDEX "ProgressNotification_pending" ON atlas_customer."ProgressNotification"("createdAt",id) WHERE state='PENDING';
CREATE FUNCTION atlas_customer.progress_notification_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','claimId','result','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','claimId','result','updatedAt'])
 OR NOT ((OLD.state='PENDING' AND NEW.state IN ('DISPATCHED','SUPPRESSED'))
  OR (OLD.state='DISPATCHED' AND NEW.state IN ('ACCEPTED','UNKNOWN') AND NEW."claimId"=OLD."claimId")
  OR (OLD.state='UNKNOWN' AND NEW.state='ACCEPTED' AND NEW."claimId"=OLD."claimId")) THEN
  RAISE EXCEPTION 'Progress notification evidence is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ProgressNotification_guard" BEFORE UPDATE OR DELETE ON atlas_customer."ProgressNotification"
 FOR EACH ROW EXECUTE FUNCTION atlas_customer.progress_notification_guard();
CREATE FUNCTION atlas_customer.progress_preferences(aid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('revision',COALESCE(p.revision,0),'email',COALESCE(p.email,false),'sms',COALESCE(p.sms,false),
 'deliveryEnabled',COALESCE((SELECT enabled FROM atlas_customer."ProgressNotificationControl" WHERE id='active'),false))
 FROM (SELECT aid id) a LEFT JOIN atlas_customer."ProgressPreference" p ON p."accountId"=a.id
$$;
CREATE FUNCTION atlas_customer.progress_preference_call(action text,aid uuid,d jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE p atlas_customer."ProgressPreference"; previous atlas_customer."ProgressPreferenceEvent"; expected integer; rid uuid;
BEGIN
 IF action='progress_preferences' THEN
  IF d<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
  RETURN atlas_customer.progress_preferences(aid);
 END IF;
 IF action<>'progress_preferences_save' OR d-ARRAY['requestId','expectedRevision','email','sms']<>'{}'::jsonb
 OR NOT d ?& ARRAY['requestId','expectedRevision','email','sms'] OR jsonb_typeof(d->'email')<>'boolean' OR jsonb_typeof(d->'sms')<>'boolean'
 OR COALESCE(d->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,8})$' OR COALESCE(d->>'requestId','') !~ '^[a-f0-9-]{36}$' THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 expected:=(d->>'expectedRevision')::integer;rid:=(d->>'requestId')::uuid;
 -- The account lock serializes the absent preference row too.
 PERFORM 1 FROM atlas_customer."CustomerAccount" WHERE id=aid FOR UPDATE;
 SELECT * INTO previous FROM atlas_customer."ProgressPreferenceEvent" WHERE "accountId"=aid AND "requestId"=rid;
 IF previous."accountId" IS NOT NULL THEN
  IF previous.revision<>expected+1 OR previous.email<>(d->>'email')::boolean OR previous.sms<>(d->>'sms')::boolean THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
  RETURN atlas_customer.progress_preferences(aid);
 END IF;
 SELECT * INTO p FROM atlas_customer."ProgressPreference" WHERE "accountId"=aid;
 IF COALESCE(p.revision,0)<>expected THEN RETURN atlas_customer.problem(409,'PREFERENCES_CHANGED'); END IF;
 IF (d->>'email')::boolean AND NOT EXISTS(SELECT 1 FROM atlas_customer."CustomerAccount" WHERE id=aid AND COALESCE(profile->>'email','') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN RETURN atlas_customer.problem(409,'PROFILE_EMAIL_REQUIRED'); END IF;
 INSERT INTO atlas_customer."ProgressPreference"("accountId",revision,email,sms) VALUES(aid,expected+1,(d->>'email')::boolean,(d->>'sms')::boolean)
 ON CONFLICT("accountId") DO UPDATE SET revision=EXCLUDED.revision,email=EXCLUDED.email,sms=EXCLUDED.sms,"updatedAt"=clock_timestamp();
 INSERT INTO atlas_customer."ProgressPreferenceEvent"("accountId",revision,"requestId",email,sms) VALUES(aid,expected+1,rid,(d->>'email')::boolean,(d->>'sms')::boolean);
 RETURN atlas_customer.progress_preferences(aid);
END $$;
CREATE FUNCTION atlas_customer.enqueue_progress(cid uuid,kind text,event_key text,occurred timestamptz,src jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE a atlas_customer."CustomerAccount"; p atlas_customer."ProgressPreference"; reference text; card_title text; channel_name text; dest text;
BEGIN
 SELECT customer.* INTO a FROM atlas_dealer.order_card c JOIN atlas_customer."CommerceOrder" o ON o.id=c.order_id
 JOIN atlas_customer."CustomerAccount" customer ON customer.id=o."accountId" WHERE c.card_id=cid AND customer."revokedAt" IS NULL;
 IF a.id IS NULL THEN RETURN; END IF;
 SELECT o.reference,c.paid_line->'identity'->>'title' INTO reference,card_title FROM atlas_dealer.order_card c JOIN atlas_customer."CommerceOrder" o ON o.id=c.order_id WHERE c.card_id=cid;
 SELECT * INTO p FROM atlas_customer."ProgressPreference" WHERE "accountId"=a.id FOR SHARE;
 IF p."accountId" IS NULL THEN RETURN; END IF;
 FOREACH channel_name IN ARRAY ARRAY['EMAIL','SMS'] LOOP
  IF (channel_name='EMAIL' AND NOT p.email) OR (channel_name='SMS' AND NOT p.sms) THEN CONTINUE; END IF;
  dest:=CASE channel_name WHEN 'EMAIL' THEN a.profile->>'email' ELSE a.phone END;
  IF dest IS NULL THEN CONTINUE; END IF;
  INSERT INTO atlas_customer."ProgressNotification"(id,"accountId","cardId","eventKind",source,"occurredAt",channel,"preferenceRevision",destination,request)
  VALUES(event_key||':'||cid::text||':'||channel_name,a.id,cid,kind,src,occurred,channel_name,p.revision,dest,
   jsonb_build_object('cardId',cid,'reference',reference,'title',COALESCE(card_title,''),'eventKind',kind,'occurredAt',occurred,'to',dest)) ON CONFLICT DO NOTHING;
 END LOOP;
END $$;
CREATE FUNCTION atlas_customer.progress_custody_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.kind<>'DEPOSIT_DECLARED' THEN PERFORM atlas_customer.enqueue_progress(NEW.card_id,NEW.kind,'custody:'||NEW.id,NEW.occurred_at,jsonb_build_object('type','CUSTODY','id',NEW.id)); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER progress_notification AFTER INSERT ON atlas_dealer.custody_event FOR EACH ROW EXECUTE FUNCTION atlas_customer.progress_custody_event();
-- Publication completion is a narrowly granted direct table UPDATE; only this
-- trigger crosses into the customer/dealer schemas as the function owner.
CREATE FUNCTION atlas_customer.progress_publication_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cid uuid;
BEGIN
 IF NEW.state='PUBLISHED' AND OLD.state<>'PUBLISHED' AND NEW.mode='PRODUCTION' THEN
  SELECT card_id INTO cid FROM atlas_dealer.manual_card_link WHERE manual_card_id=NEW.card_id;
  IF cid IS NOT NULL THEN PERFORM atlas_customer.enqueue_progress(cid,'REPORT_PUBLISHED','report:'||NEW.action_id,NEW.published_at,
   jsonb_build_object('type','PUBLICATION','cardId',NEW.card_id,'actionId',NEW.action_id,'version',NEW.version)); END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER progress_notification AFTER UPDATE OF state ON atlas_manual.publication FOR EACH ROW EXECUTE FUNCTION atlas_customer.progress_publication_event();
CREATE FUNCTION atlas_customer.progress_grading_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM atlas_customer.enqueue_progress(NEW.card_id,'GRADING_STARTED','grading:'||NEW.manual_card_id,NEW.linked_at,
  jsonb_build_object('type','GRADING','cardId',NEW.manual_card_id));
 RETURN NEW;
END $$;
CREATE TRIGGER progress_notification AFTER INSERT ON atlas_dealer.manual_card_link FOR EACH ROW EXECUTE FUNCTION atlas_customer.progress_grading_event();
CREATE FUNCTION atlas_customer.progress_handoff_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE cid uuid;
BEGIN
 FOREACH cid IN ARRAY NEW.card_ids LOOP
  PERFORM atlas_customer.enqueue_progress(cid,'DEALER_RECEIVED','handoff:'||NEW.id,NEW.received_at,jsonb_build_object('type','HANDOFF','id',NEW.id));
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER progress_notification AFTER INSERT ON atlas_dealer.handoff_receipt FOR EACH ROW EXECUTE FUNCTION atlas_customer.progress_handoff_event();
CREATE FUNCTION atlas_customer.progress_source_current(e atlas_customer."ProgressNotification") RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT CASE e.source->>'type'
 WHEN 'CUSTODY' THEN EXISTS(SELECT 1 FROM atlas_dealer.custody_event c WHERE c.id::text=e.source->>'id' AND c.card_id=e."cardId" AND c.kind=e."eventKind"
   AND NOT EXISTS(SELECT 1 FROM atlas_dealer.custody_event newer WHERE newer.card_id=c.card_id AND newer.sequence>c.sequence))
 WHEN 'HANDOFF' THEN EXISTS(SELECT 1 FROM atlas_dealer.handoff_receipt r WHERE r.id::text=e.source->>'id' AND e."cardId"=ANY(r.card_ids))
 WHEN 'GRADING' THEN EXISTS(SELECT 1 FROM atlas_dealer.manual_card_link l WHERE l.card_id=e."cardId" AND l.manual_card_id::text=e.source->>'cardId'
  AND NOT EXISTS(SELECT 1 FROM atlas_manual.approval a WHERE a.card_id=l.manual_card_id)
  AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=l.manual_card_id))
 WHEN 'PUBLICATION' THEN EXISTS(SELECT 1 FROM atlas_manual.publication p JOIN atlas_dealer.manual_card_link l ON l.manual_card_id=p.card_id
  WHERE l.card_id=e."cardId" AND p.card_id::text=e.source->>'cardId' AND p.action_id::text=e.source->>'actionId' AND p.state='PUBLISHED' AND p.mode='PRODUCTION'
  AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=p.card_id)
  AND NOT EXISTS(SELECT 1 FROM atlas_manual.publication newer WHERE newer.card_id=p.card_id AND newer.state='PUBLISHED' AND newer.version>p.version))
 ELSE false END
$$;
CREATE FUNCTION atlas_customer.progress_provider_call(action text,d jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE e atlas_customer."ProgressNotification"; p atlas_customer."ProgressPreference"; a atlas_customer."CustomerAccount";
BEGIN
 IF action='pending' THEN
  IF d<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
  UPDATE atlas_customer."ProgressNotification" SET state='UNKNOWN',result=jsonb_build_object('code','PROGRESS_OUTCOME_UNKNOWN'),"updatedAt"=clock_timestamp()
   WHERE state='DISPATCHED' AND "updatedAt"<clock_timestamp()-interval '2 minutes';
  RETURN jsonb_build_object('ids',COALESCE((SELECT jsonb_agg(id) FROM (SELECT id FROM atlas_customer."ProgressNotification" WHERE state='PENDING' ORDER BY "createdAt",id LIMIT 20) pending),'[]'::jsonb));
 END IF;
 IF action NOT IN ('claim','finish') OR COALESCE(d->>'id','')='' OR COALESCE(d->>'claimId','') !~ '^[a-f0-9-]{36}$' THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 SELECT * INTO e FROM atlas_customer."ProgressNotification" WHERE id=d->>'id' FOR UPDATE;
 IF e.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF action='claim' THEN
  IF d-ARRAY['id','claimId']<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
  IF e.state<>'PENDING' THEN RETURN jsonb_build_object('dispatch',false); END IF;
  SELECT * INTO a FROM atlas_customer."CustomerAccount" WHERE id=e."accountId" FOR SHARE;
  SELECT * INTO p FROM atlas_customer."ProgressPreference" WHERE "accountId"=e."accountId" FOR SHARE;
  IF a."revokedAt" IS NOT NULL OR p.revision IS DISTINCT FROM e."preferenceRevision"
   OR NOT (CASE e.channel WHEN 'EMAIL' THEN p.email ELSE p.sms END)
   OR e.destination IS DISTINCT FROM (CASE e.channel WHEN 'EMAIL' THEN a.profile->>'email' ELSE a.phone END)
   OR NOT atlas_customer.progress_source_current(e) THEN
   UPDATE atlas_customer."ProgressNotification" SET state='SUPPRESSED',"updatedAt"=clock_timestamp() WHERE id=e.id;
   RETURN jsonb_build_object('dispatch',false);
  END IF;
  UPDATE atlas_customer."ProgressNotification" SET state='DISPATCHED',"claimId"=(d->>'claimId')::uuid,"updatedAt"=clock_timestamp() WHERE id=e.id;
  RETURN jsonb_build_object('dispatch',true,'effect',jsonb_build_object('id',e.id,'kind',e.channel||'_PROGRESS','request',e.request));
 END IF;
 IF d-ARRAY['id','claimId','state','result']<>'{}'::jsonb OR e."claimId" IS DISTINCT FROM (d->>'claimId')::uuid OR COALESCE(d->>'state','') NOT IN ('ACCEPTED','UNKNOWN')
  OR jsonb_typeof(d->'result') IS DISTINCT FROM 'object' OR octet_length((d->'result')::text)>1024 THEN RETURN atlas_customer.problem(409,'PROGRESS_CLAIM_CONFLICT'); END IF;
 IF e.state='ACCEPTED' THEN
  IF e.result IS DISTINCT FROM d->'result' OR d->>'state'<>'ACCEPTED' THEN RETURN atlas_customer.problem(409,'PROGRESS_RESULT_CONFLICT'); END IF;
  RETURN jsonb_build_object('state',e.state);
 END IF;
 IF e.state='UNKNOWN' AND d->>'state'='UNKNOWN' THEN RETURN jsonb_build_object('state',e.state); END IF;
 IF e.state NOT IN ('DISPATCHED','UNKNOWN') THEN RETURN atlas_customer.problem(409,'PROGRESS_CLAIM_CONFLICT'); END IF;
 IF d->>'state'='ACCEPTED' AND (COALESCE(d->'result'->>'provider','') NOT IN ('SENDGRID','TWILIO') OR length(COALESCE(d->'result'->>'providerId','')) NOT BETWEEN 1 AND 200
 OR COALESCE(d->'result'->>'deliveryStatus','') NOT IN ('ACCEPTED','QUEUED','SENDING','SENT','DELIVERED','UNDELIVERED','FAILED')) THEN RETURN atlas_customer.problem(409,'PROGRESS_RESULT_INVALID'); END IF;
 UPDATE atlas_customer."ProgressNotification" SET state=d->>'state',result=d->'result',"updatedAt"=clock_timestamp() WHERE id=e.id;
 RETURN jsonb_build_object('state',d->>'state');
END $$;
-- Wrap the current gateways so capacity/handoff and all existing authentication
-- remain intact. Only the original public gateway grants move to each wrapper.
ALTER FUNCTION atlas_customer.customer_call(text,jsonb,jsonb) RENAME TO customer_call_before_progress;
CREATE FUNCTION atlas_customer.customer_call(action text,b jsonb,d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
DECLARE ctl atlas_customer."CustomerControl"; a atlas_customer."CustomerAccount";
BEGIN
 IF action NOT IN ('progress_preferences','progress_preferences_save') THEN RETURN atlas_customer.customer_call_before_progress(action,b,d); END IF;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR (b->>'mode',b->>'origin',b->>'deploymentId',b->>'releaseSha',b->>'configHash') IS DISTINCT FROM
 (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>4096 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 SELECT * INTO a FROM atlas_customer.current_account(d->>'sessionHash',d->>'browserHash',ctl.revision);
 IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 RETURN atlas_customer.progress_preference_call(action,a.id,d-ARRAY['sessionHash','browserHash']);
END $$;
ALTER FUNCTION atlas_customer.customer_private_call(text,jsonb,jsonb) RENAME TO customer_private_call_before_progress;
CREATE FUNCTION atlas_customer.customer_private_call(action text,b jsonb,d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
DECLARE svc atlas_customer."CustomerServiceControl"; ctl atlas_customer."CustomerControl";
BEGIN
 IF action<>'progress' THEN RETURN atlas_customer.customer_private_call_before_progress(action,b,d); END IF;
 SELECT * INTO svc FROM atlas_customer."CustomerServiceControl" WHERE id='active' FOR SHARE;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF svc.enabled IS DISTINCT FROM true OR svc.binding IS DISTINCT FROM b OR ctl.enabled IS DISTINCT FROM true
 OR (b->>'mode',b->>'origin',b->>'deploymentId',b->>'releaseSha',b->>'configHash') IS DISTINCT FROM
 (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN RETURN atlas_customer.problem(503,'CUSTOMER_SERVICE_NOT_ENABLED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR d-ARRAY['name','input']<>'{}'::jsonb OR octet_length(d::text)>4096 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 IF d->>'name'<>'finish' AND NOT COALESCE((SELECT enabled FROM atlas_customer."ProgressNotificationControl" WHERE id='active'),false) THEN RETURN atlas_customer.problem(503,'PROGRESS_NOT_ENABLED'); END IF;
 RETURN atlas_customer.progress_provider_call(d->>'name',d->'input');
END $$;
REVOKE ALL ON atlas_customer."ProgressNotificationControl",atlas_customer."ProgressPreference",atlas_customer."ProgressPreferenceEvent",atlas_customer."ProgressNotification" FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_customer.progress_notification_guard(),atlas_customer.progress_preferences(uuid),atlas_customer.progress_preference_call(text,uuid,jsonb),atlas_customer.enqueue_progress(uuid,text,text,timestamptz,jsonb),atlas_customer.progress_custody_event(),atlas_customer.progress_publication_event(),atlas_customer.progress_handoff_event(),atlas_customer.progress_grading_event(),atlas_customer.progress_source_current(atlas_customer."ProgressNotification"),atlas_customer.progress_provider_call(text,jsonb),atlas_customer.customer_call(text,jsonb,jsonb),atlas_customer.customer_private_call(text,jsonb,jsonb) FROM PUBLIC;
DO $$
DECLARE pair text[]; role_name text;
BEGIN
 FOREACH pair SLICE 1 IN ARRAY ARRAY[['customer_call','customer_call_before_progress'],['customer_private_call','customer_private_call_before_progress']] LOOP
  FOR role_name IN SELECT r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl JOIN pg_roles r ON r.oid=acl.grantee
   WHERE n.nspname='atlas_customer' AND p.proname=pair[2] AND acl.privilege_type='EXECUTE' AND acl.grantee<>p.proowner LOOP
   EXECUTE format('GRANT EXECUTE ON FUNCTION atlas_customer.%I(text,jsonb,jsonb) TO %I',pair[1],role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION atlas_customer.%I(text,jsonb,jsonb) FROM %I',pair[2],role_name);
  END LOOP;
  EXECUTE format('REVOKE ALL ON FUNCTION atlas_customer.%I(text,jsonb,jsonb) FROM PUBLIC',pair[2]);
 END LOOP;
END $$;
COMMIT;
