BEGIN;
-- Address proof is scoped to an existing phone-authenticated account. It never
-- creates, merges, authenticates or recovers accounts or customer sessions.
CREATE FUNCTION atlas_customer.canonical_email(value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN length(btrim(value)) BETWEEN 3 AND 254
  AND btrim(value) !~ '[[:cntrl:][:space:]]'
  AND btrim(value) !~ U&'[\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]' AND btrim(value) ~ '^[^@]+@[^@]+\.[^@]+$'
  THEN split_part(btrim(value),'@',1)||'@'||lower(split_part(btrim(value),'@',2)) ELSE NULL END
$$;
-- New review snapshots require email without rewriting legacy saved profiles.
CREATE OR REPLACE FUNCTION atlas_customer.valid_intake_profile(p jsonb,method text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(atlas_customer.canonical_email(p->>'email') IS NOT NULL AND
  CASE method WHEN 'DEALER_DROP_OFF' THEN atlas_customer.valid_shop_profile(p)
  WHEN 'MAIL_IN' THEN atlas_customer.valid_profile(p) ELSE false END,false)
$$;
CREATE TABLE atlas_customer."CustomerVerifiedEmail" (
 "accountId" uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
 email text NOT NULL CHECK (atlas_customer.canonical_email(email) IS NOT NULL AND email=atlas_customer.canonical_email(email)),
 "verifiedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY("accountId",email)
);
CREATE TABLE atlas_customer."CustomerEmailVerification" (
 id uuid PRIMARY KEY, "accountId" uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
 "draftId" uuid NOT NULL REFERENCES atlas_customer."CustomerIntakeDraft"(id), "requestId" uuid NOT NULL,
 "browserHash" text NOT NULL CHECK ("browserHash" ~ '^[a-f0-9]{64}$'),
 email text NOT NULL CHECK (atlas_customer.canonical_email(email) IS NOT NULL AND email=atlas_customer.canonical_email(email)), "deliveryEmail" text NOT NULL,
 "tokenHash" text NOT NULL UNIQUE CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
 "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(), "expiresAt" timestamptz NOT NULL,
 state text NOT NULL CHECK (state IN ('SENDING','SENT','UNKNOWN','SUPERSEDED','VERIFIED')),
 "providerId" text, "consumedAt" timestamptz,
 UNIQUE("accountId","requestId"),
 CHECK (atlas_customer.canonical_email("deliveryEmail")=email),
 CHECK ("expiresAt"="createdAt"+interval '30 minutes'),
 CHECK ((state='VERIFIED')=("consumedAt" IS NOT NULL)),
 CHECK ("providerId" IS NULL OR length("providerId") BETWEEN 1 AND 200)
);
CREATE INDEX "CustomerEmailVerification_account_created" ON atlas_customer."CustomerEmailVerification"("accountId","createdAt" DESC);
CREATE FUNCTION atlas_customer.email_verified(aid uuid,email text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM atlas_customer."CustomerVerifiedEmail" e
  WHERE e."accountId"=$1 AND e.email=atlas_customer.canonical_email($2))
$$;
CREATE FUNCTION atlas_customer.email_verification_status(aid uuid,did uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE draft atlas_customer."CustomerIntakeDraft"; v atlas_customer."CustomerEmailVerification"; verified boolean; required boolean;
BEGIN
 SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=did AND "accountId"=aid;
 IF draft.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 verified:=atlas_customer.email_verified(aid,draft."profileSnapshot"->>'email');
 required:=NOT verified AND NOT EXISTS(SELECT 1 FROM atlas_customer."CommercePayment" WHERE "draftId"=did AND state<>'CANCELED');
 SELECT * INTO v FROM atlas_customer."CustomerEmailVerification" WHERE "accountId"=aid AND "draftId"=did
  AND email=atlas_customer.canonical_email(draft."profileSnapshot"->>'email') ORDER BY "createdAt" DESC,id DESC LIMIT 1;
 RETURN jsonb_build_object('draftId',did,'verified',verified,'required',required,
  'email',atlas_customer.canonical_email(draft."profileSnapshot"->>'email'),'state',CASE WHEN verified THEN 'VERIFIED'
    WHEN v.id IS NULL THEN 'UNSENT' WHEN v."expiresAt"<=clock_timestamp() THEN 'EXPIRED' ELSE v.state END,
  'expiresAt',v."expiresAt",'canResendAt',v."createdAt"+interval '1 minute');
END $$;

CREATE FUNCTION atlas_customer.email_verification_private(action text,b jsonb,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE ctl atlas_customer."CustomerControl"; svc atlas_customer."CustomerServiceControl"; a atlas_customer."CustomerAccount";
 draft atlas_customer."CustomerIntakeDraft"; v atlas_customer."CustomerEmailVerification"; auth jsonb; address text; t timestamptz; result jsonb;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>4096 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 -- Retain the outcome for an already committed claim during a serving fence.
 IF action='finish' THEN
  IF d-ARRAY['claimId','tokenHash','result']<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
  SELECT * INTO v FROM atlas_customer."CustomerEmailVerification" WHERE id=(d->>'claimId')::uuid AND "tokenHash"=d->>'tokenHash' FOR UPDATE;
  IF v.id IS NULL THEN RETURN atlas_customer.problem(409,'EMAIL_VERIFICATION_CONFLICT'); END IF;
  IF v.state='SENDING' THEN
   result:=d->'result';
   IF jsonb_typeof(result)='object' AND result-ARRAY['provider','providerId','deliveryStatus']='{}'::jsonb
    AND result->>'provider'='SENDGRID' AND result->>'deliveryStatus'='ACCEPTED' AND length(result->>'providerId') BETWEEN 1 AND 200 THEN
    UPDATE atlas_customer."CustomerEmailVerification" SET state='SENT',"providerId"=result->>'providerId' WHERE id=v.id;
   ELSE UPDATE atlas_customer."CustomerEmailVerification" SET state='UNKNOWN' WHERE id=v.id; END IF;
  END IF;
  RETURN atlas_customer.email_verification_status(v."accountId",v."draftId");
 END IF;
 IF action<>'claim' OR d-ARRAY['authority','draftId','requestId','claimId','tokenHash']<>'{}'::jsonb
  OR COALESCE(d->>'tokenHash','') !~ '^[a-f0-9]{64}$' THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 SELECT * INTO svc FROM atlas_customer."CustomerServiceControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR svc.enabled IS DISTINCT FROM true OR svc.binding IS DISTINCT FROM b
  OR (b->>'mode',b->>'origin',b->>'deploymentId',b->>'releaseSha',b->>'configHash') IS DISTINCT FROM
  (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN RETURN atlas_customer.problem(503,'CUSTOMER_SERVICE_NOT_ENABLED'); END IF;
 auth:=d->'authority';
 IF auth->'binding' IS DISTINCT FROM b THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 SELECT * INTO a FROM atlas_customer.current_account(auth->>'sessionHash',auth->>'browserHash',ctl.revision);
 IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-intake:'||a.id::text,0));
 SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=(d->>'draftId')::uuid AND "accountId"=a.id FOR UPDATE;
 IF draft.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF draft.state<>'REVIEW' THEN RETURN atlas_customer.problem(409,'INTAKE_REVIEW_NOT_READY'); END IF;
 address:=atlas_customer.canonical_email(draft."profileSnapshot"->>'email');
 IF address IS NULL THEN RETURN atlas_customer.problem(400,'CONTACT_DETAILS_REQUIRED'); END IF;
 result:=atlas_customer.email_verification_status(a.id,draft.id);
 IF NOT (result->>'required')::boolean THEN RETURN jsonb_build_object('dispatch',false,'status',result); END IF;
 SELECT * INTO v FROM atlas_customer."CustomerEmailVerification" WHERE "accountId"=a.id AND "requestId"=(d->>'requestId')::uuid;
 IF v.id IS NOT NULL THEN
  IF v."draftId"<>draft.id OR v.email<>address THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
  RETURN jsonb_build_object('dispatch',false,'status',result);
 END IF;
 IF EXISTS(SELECT 1 FROM atlas_customer."CustomerEmailVerification" WHERE "accountId"=a.id AND "createdAt">clock_timestamp()-interval '1 minute') THEN
  RETURN atlas_customer.problem(429,'EMAIL_VERIFICATION_WAIT'); END IF;
 IF NOT atlas_customer.take_rate('email-send-account:'||a.id::text,4)
  OR NOT atlas_customer.take_rate('email-send-address:'||encode(sha256(convert_to(address,'UTF8')),'hex'),6)
  OR NOT atlas_customer.take_rate('email-send-global',60) THEN RETURN atlas_customer.problem(429,'EMAIL_VERIFICATION_WAIT'); END IF;
 UPDATE atlas_customer."CustomerEmailVerification" SET state='SUPERSEDED' WHERE "accountId"=a.id AND "draftId"=draft.id AND state IN ('SENDING','SENT','UNKNOWN');
 t:=clock_timestamp();
 INSERT INTO atlas_customer."CustomerEmailVerification"(id,"accountId","draftId","requestId","browserHash",email,"deliveryEmail","tokenHash","createdAt","expiresAt",state)
 VALUES((d->>'claimId')::uuid,a.id,draft.id,(d->>'requestId')::uuid,auth->>'browserHash',address,draft."profileSnapshot"->>'email',d->>'tokenHash',t,t+interval '30 minutes','SENDING');
 RETURN jsonb_build_object('dispatch',true,'to',draft."profileSnapshot"->>'email');
END $$;

ALTER FUNCTION atlas_customer.customer_call(text,jsonb,jsonb) RENAME TO customer_call_before_email_verification;
CREATE FUNCTION atlas_customer.customer_call(action text,b jsonb,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
DECLARE ctl atlas_customer."CustomerControl"; a atlas_customer."CustomerAccount"; v atlas_customer."CustomerEmailVerification";
 draft atlas_customer."CustomerIntakeDraft"; same_browser boolean;
BEGIN
 IF action NOT IN ('email_status','email_confirm') THEN RETURN atlas_customer.customer_call_before_email_verification(action,b,d); END IF;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR (b->>'mode',b->>'origin',b->>'deploymentId',b->>'releaseSha',b->>'configHash') IS DISTINCT FROM
  (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>4096 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 SELECT * INTO a FROM atlas_customer.current_account(d->>'sessionHash',d->>'browserHash',ctl.revision);
 IF action='email_status' THEN
  IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  IF d-ARRAY['draftId','sessionHash','browserHash']<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
  RETURN atlas_customer.email_verification_status(a.id,(d->>'draftId')::uuid);
 END IF;
 IF d-ARRAY['tokenHash','mode','clientHash','sessionHash','browserHash']<>'{}'::jsonb OR COALESCE(d->>'tokenHash','') !~ '^[a-f0-9]{64}$'
  OR COALESCE(d->>'clientHash','') !~ '^[a-f0-9]{64}$' OR COALESCE(d->>'mode','') NOT IN ('AUTO','CONFIRM')
  OR NOT EXISTS(SELECT 1 FROM atlas_customer."CustomerBrowser" WHERE "tokenHash"=d->>'browserHash' AND "expiresAt">clock_timestamp() AND "controlRevision"=ctl.revision)
  THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 IF NOT atlas_customer.take_rate('email-confirm-client:'||(d->>'clientHash'),30) THEN RETURN atlas_customer.problem(429,'EMAIL_VERIFICATION_WAIT'); END IF;
 SELECT * INTO v FROM atlas_customer."CustomerEmailVerification" WHERE "tokenHash"=d->>'tokenHash' FOR UPDATE;
 same_browser:=v.id IS NOT NULL AND a.id IS NOT NULL AND a.id=v."accountId" AND d->>'browserHash'=v."browserHash";
 -- A scanner's bearer token alone can never take the automatic path.
 IF d->>'mode'='AUTO' AND NOT COALESCE(same_browser,false) THEN RETURN jsonb_build_object('verified',false,'requiresConfirmation',true); END IF;
 IF v.id IS NULL OR v.state='SUPERSEDED' OR (v.state<>'VERIFIED' AND v."expiresAt"<=clock_timestamp())
  OR NOT EXISTS(SELECT 1 FROM atlas_customer."CustomerAccount" WHERE id=v."accountId" AND "revokedAt" IS NULL) THEN
  RETURN atlas_customer.problem(400,'EMAIL_LINK_INVALID'); END IF;
 SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=v."draftId";
 IF atlas_customer.canonical_email(draft."profileSnapshot"->>'email') IS DISTINCT FROM v.email THEN RETURN atlas_customer.problem(409,'EMAIL_LINK_CHANGED'); END IF;
 IF v.state<>'VERIFIED' THEN
  INSERT INTO atlas_customer."CustomerVerifiedEmail"("accountId",email) VALUES(v."accountId",v.email) ON CONFLICT DO NOTHING;
  UPDATE atlas_customer."CustomerEmailVerification" SET state='VERIFIED',"consumedAt"=clock_timestamp() WHERE id=v.id;
 END IF;
 -- Idempotent consumed-token replay adds no proof and returns no account data.
 RETURN jsonb_build_object('verified',true)||CASE WHEN same_browser THEN jsonb_build_object('resumeDraftId',v."draftId") ELSE '{}'::jsonb END;
END $$;
ALTER FUNCTION atlas_customer.customer_private_call(text,jsonb,jsonb) RENAME TO customer_private_call_before_email_verification;
CREATE FUNCTION atlas_customer.customer_private_call(action text,b jsonb,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
BEGIN
 IF action<>'email' THEN RETURN atlas_customer.customer_private_call_before_email_verification(action,b,d); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR d-ARRAY['name','input']<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 RETURN atlas_customer.email_verification_private(d->>'name',b,d->'input');
END $$;

-- Guards run only for new rows; original unresolved payment recovery does not
-- insert and remains available, regardless of later contact/profile changes.
CREATE FUNCTION atlas_customer.commerce_verified_email_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE email text;
BEGIN
 IF TG_TABLE_NAME='CommerceQuote' THEN email:=NEW.snapshot->'profile'->>'email';
 ELSE SELECT snapshot->'profile'->>'email' INTO email FROM atlas_customer."CommerceQuote" WHERE id=NEW."quoteId"; END IF;
 IF NOT atlas_customer.email_verified(NEW."accountId",email) THEN RAISE EXCEPTION 'ATLAS verified receipt email required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verified_email BEFORE INSERT ON atlas_customer."CommerceQuote" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_verified_email_guard();
CREATE TRIGGER verified_email BEFORE INSERT ON atlas_customer."CommercePayment" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_verified_email_guard();

CREATE OR REPLACE FUNCTION atlas_customer.commerce_source(did uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,atlas_customer AS $$
 SELECT jsonb_build_object('draftId',d.id,'revision',d.revision,'accountId',d."accountId",'profile',d."profileSnapshot",'profileRevision',d.revision,'phone',a.phone,'emailVerified',atlas_customer.email_verified(a.id,d."profileSnapshot"->>'email'),
 'channel',CASE WHEN d."intakeMethod"='MAIL_IN' THEN 'MAIL_IN' ELSE 'KIOSK' END,'location',CASE WHEN d."kioskId" IS NOT NULL THEN atlas_customer.intake_location(d."kioskId") ELSE NULL END,
 'activePayment',(SELECT jsonb_build_object('id',p.id,'state',p.state,'channel',(SELECT snapshot->>'channel' FROM atlas_customer."CommerceQuote" WHERE id=p."quoteId"),'paymentFlow',(SELECT snapshot->'terms'->>'paymentFlow' FROM atlas_customer."CommerceQuote" WHERE id=p."quoteId"),'order',(SELECT jsonb_build_object('id',o.id,'reference',o.reference,'receipt',o.receipt,'paidAt',o."paidAt") FROM atlas_customer."CommerceOrder" o WHERE o."paymentId"=p.id)) FROM atlas_customer."CommercePayment" p WHERE p."draftId"=d.id AND p.state<>'CANCELED'),
 'shippingPlans',COALESCE((SELECT jsonb_agg(plan) FROM atlas_customer."CommerceControl" ctl CROSS JOIN LATERAL jsonb_array_elements(ctl."shippingPlans") plan
 WHERE ctl.id='active' AND atlas_customer.commerce_shipping_plan_valid(plan,(SELECT count(*)::integer FROM atlas_customer."CustomerIntakeCard" c WHERE c."draftId"=d.id),ctl.terms->>'mailChargedLegs')),'[]'::jsonb),
 'cards',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'revision',c.revision,'identity',c.identity,'photoPairHash',atlas_customer.commerce_hash(
 (SELECT jsonb_agg(jsonb_build_object('side',u.side,'plan',u.plan,'verification',u.verification) ORDER BY u.side) FROM atlas_customer."CustomerIntakeUpload" u WHERE u."cardId"=c.id))) ORDER BY c."createdAt",c.id)
 FROM atlas_customer."CustomerIntakeCard" c WHERE c."draftId"=d.id),'[]'::jsonb))
 FROM atlas_customer."CustomerIntakeDraft" d JOIN atlas_customer."CustomerAccount" a ON a.id=d."accountId" WHERE d.id=did
$$;

CREATE OR REPLACE FUNCTION atlas_customer.enqueue_progress(cid uuid,kind text,event_key text,occurred timestamptz,src jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE a atlas_customer."CustomerAccount"; p atlas_customer."ProgressPreference"; reference text; card_title text; channel_name text; dest text;
BEGIN
 SELECT customer.* INTO a FROM atlas_dealer.order_card c JOIN atlas_customer."CommerceOrder" o ON o.id=c.order_id
 JOIN atlas_customer."CustomerAccount" customer ON customer.id=o."accountId" WHERE c.card_id=cid AND customer."revokedAt" IS NULL;
 IF a.id IS NULL THEN RETURN; END IF;
 IF NOT atlas_customer.email_verified(a.id,a.profile->>'email') THEN RETURN; END IF;
 SELECT o.reference,c.paid_line->'identity'->>'title' INTO reference,card_title FROM atlas_dealer.order_card c JOIN atlas_customer."CommerceOrder" o ON o.id=c.order_id WHERE c.card_id=cid;
 SELECT * INTO p FROM atlas_customer."ProgressPreference" WHERE "accountId"=a.id FOR SHARE;
 IF p."accountId" IS NULL THEN RETURN; END IF;
 -- Keep saved SMS preferences as evidence; this release enqueues email only.
 FOREACH channel_name IN ARRAY ARRAY['EMAIL'] LOOP
  IF (channel_name='EMAIL' AND NOT p.email) OR (channel_name='SMS' AND NOT p.sms) THEN CONTINUE; END IF;
  dest:=CASE channel_name WHEN 'EMAIL' THEN a.profile->>'email' ELSE a.phone END;
  IF dest IS NULL THEN CONTINUE; END IF;
  INSERT INTO atlas_customer."ProgressNotification"(id,"accountId","cardId","eventKind",source,"occurredAt",channel,"preferenceRevision",destination,request)
  VALUES(event_key||':'||cid::text||':'||channel_name,a.id,cid,kind,src,occurred,channel_name,p.revision,dest,
   jsonb_build_object('cardId',cid,'reference',reference,'title',COALESCE(card_title,''),'eventKind',kind,'occurredAt',occurred,'to',dest)) ON CONFLICT DO NOTHING;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION atlas_customer.progress_provider_call(action text,d jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE e atlas_customer."ProgressNotification"; p atlas_customer."ProgressPreference"; a atlas_customer."CustomerAccount";
BEGIN
 IF action='pending' THEN
  IF d<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
  UPDATE atlas_customer."ProgressNotification" SET state='UNKNOWN',result=jsonb_build_object('code','PROGRESS_OUTCOME_UNKNOWN'),"updatedAt"=clock_timestamp()
   WHERE state='DISPATCHED' AND channel='EMAIL' AND "updatedAt"<clock_timestamp()-interval '2 minutes';
  RETURN jsonb_build_object('ids',COALESCE((SELECT jsonb_agg(id) FROM (SELECT id FROM atlas_customer."ProgressNotification" WHERE state='PENDING' AND channel='EMAIL' ORDER BY "createdAt",id LIMIT 20) pending),'[]'::jsonb));
 END IF;
 IF action NOT IN ('claim','finish') OR COALESCE(d->>'id','')='' OR COALESCE(d->>'claimId','') !~ '^[a-f0-9-]{36}$' THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 SELECT * INTO e FROM atlas_customer."ProgressNotification" WHERE id=d->>'id' FOR UPDATE;
 IF e.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF action='claim' THEN
  IF d-ARRAY['id','claimId']<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
  IF e.state<>'PENDING' THEN RETURN jsonb_build_object('dispatch',false); END IF;
  IF e.channel='SMS' THEN RETURN jsonb_build_object('dispatch',false,'blockedReason','SMS_NOTIFICATIONS_DISABLED'); END IF;
  SELECT * INTO a FROM atlas_customer."CustomerAccount" WHERE id=e."accountId" FOR SHARE;
  SELECT * INTO p FROM atlas_customer."ProgressPreference" WHERE "accountId"=e."accountId" FOR SHARE;
  IF a."revokedAt" IS NOT NULL OR p.revision IS DISTINCT FROM e."preferenceRevision"
   OR NOT (CASE e.channel WHEN 'EMAIL' THEN p.email ELSE p.sms END)
   OR e.destination IS DISTINCT FROM (CASE e.channel WHEN 'EMAIL' THEN a.profile->>'email' ELSE a.phone END)
   OR NOT atlas_customer.email_verified(a.id,e.destination)
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

REVOKE ALL ON atlas_customer."CustomerVerifiedEmail",atlas_customer."CustomerEmailVerification" FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_customer.canonical_email(text),atlas_customer.email_verified(uuid,text),atlas_customer.email_verification_status(uuid,uuid),
 atlas_customer.email_verification_private(text,jsonb,jsonb),atlas_customer.commerce_verified_email_guard(),
 atlas_customer.customer_call(text,jsonb,jsonb),atlas_customer.customer_private_call(text,jsonb,jsonb) FROM PUBLIC;
DO $$
DECLARE pair text[]; role_name text;
BEGIN
 FOREACH pair SLICE 1 IN ARRAY ARRAY[['customer_call','customer_call_before_email_verification'],['customer_private_call','customer_private_call_before_email_verification']] LOOP
  FOR role_name IN SELECT r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl JOIN pg_roles r ON r.oid=acl.grantee
   WHERE n.nspname='atlas_customer' AND p.proname=pair[2] AND acl.privilege_type='EXECUTE' AND acl.grantee<>p.proowner LOOP
   EXECUTE format('GRANT EXECUTE ON FUNCTION atlas_customer.%I(text,jsonb,jsonb) TO %I',pair[1],role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION atlas_customer.%I(text,jsonb,jsonb) FROM %I',pair[2],role_name);
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION atlas_customer.customer_call_before_email_verification(text,jsonb,jsonb),atlas_customer.customer_private_call_before_email_verification(text,jsonb,jsonb) FROM PUBLIC;
COMMIT;
