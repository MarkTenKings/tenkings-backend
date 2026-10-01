BEGIN;
SET LOCAL search_path=pg_catalog,atlas_customer;
-- A shop submission uses the verified account phone and contact name. Shipping
-- details remain mandatory for mail-in and retained historical snapshots.
CREATE FUNCTION atlas_customer.valid_contact_profile(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(jsonb_typeof(p)='object' AND p ? 'name'
  AND p-ARRAY['name','email']='{}'::jsonb
  AND jsonb_typeof(p->'name')='string' AND length(p->>'name') BETWEEN 1 AND 120
  AND (p->>'name')=btrim(p->>'name') AND (p->>'name') !~ '[[:cntrl:]]'
  AND (NOT p ? 'email' OR (jsonb_typeof(p->'email')='string'
   AND length(p->>'email')<=254 AND (p->>'email')=btrim(p->>'email')
   AND ((p->>'email')='' OR ((p->>'email') !~ '[[:cntrl:][:space:]]'
    AND (p->>'email') ~ '^[^@]+@[^@]+\.[^@]+$')))),false)
$$;
CREATE FUNCTION atlas_customer.valid_shop_profile(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,atlas_customer AS $$
 SELECT atlas_customer.valid_contact_profile(p) OR atlas_customer.valid_profile(p)
$$;
CREATE FUNCTION atlas_customer.valid_intake_profile(p jsonb,method text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,atlas_customer AS $$
 SELECT COALESCE(CASE method WHEN 'DEALER_DROP_OFF' THEN atlas_customer.valid_shop_profile(p)
  WHEN 'MAIL_IN' THEN atlas_customer.valid_profile(p) AND p ? 'email' ELSE false END,false)
$$;
-- Only the mutable account contact broadens. The historical submission check
-- and valid_profile retain their complete-return-profile meaning.
ALTER TABLE atlas_customer."CustomerAccount" DROP CONSTRAINT "CustomerAccount_profile";
ALTER TABLE atlas_customer."CustomerAccount" ADD CONSTRAINT "CustomerAccount_profile"
 CHECK (profile IS NULL OR atlas_customer.valid_shop_profile(profile));
REVOKE ALL ON FUNCTION atlas_customer.valid_contact_profile(jsonb),atlas_customer.valid_shop_profile(jsonb),atlas_customer.valid_intake_profile(jsonb,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION atlas_customer.intake_call(action text, account_id uuid, d jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE draft atlas_customer."CustomerIntakeDraft"; c atlas_customer."CustomerIntakeCard"; payload jsonb; p jsonb; side_name text; ih text; location jsonb; uid uuid; did uuid; cards integer;
BEGIN
 IF account_id IS NULL OR NOT EXISTS (SELECT 1 FROM atlas_customer."CustomerAccount" WHERE id=account_id AND "revokedAt" IS NULL) THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>65536 THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE'); END IF;
 -- Serialize this customer's cart mutations; no global intake lock.
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-intake:'||account_id::text,0));
 IF action='intake_list' THEN
   RETURN jsonb_build_object('drafts',COALESCE((SELECT jsonb_agg(atlas_customer.intake_draft_projection(q.id) ORDER BY q."createdAt" DESC) FROM (SELECT id,"createdAt" FROM atlas_customer."CustomerIntakeDraft" WHERE "accountId"=account_id AND state<>'ORDERED' ORDER BY "createdAt" DESC LIMIT 20) q),'[]'::jsonb));
 ELSIF action='intake_create' THEN
   IF COALESCE(d->>'intakeMethod','') NOT IN ('MAIL_IN','DEALER_DROP_OFF') OR (d->>'requestId') IS NULL
     OR ((d->>'intakeMethod'='MAIL_IN') IS DISTINCT FROM (d->>'kioskId' IS NULL)) THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE'); END IF;
   ih:=encode(sha256(convert_to((d-ARRAY['sessionHash','browserHash'])::text,'UTF8')),'hex');
   SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE "accountId"=account_id AND "requestId"=(d->>'requestId')::uuid;
   IF draft.id IS NOT NULL THEN
     IF draft."inputHash"<>ih THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
     RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(draft.id));
   END IF;
   IF d->>'intakeMethod'='DEALER_DROP_OFF' THEN
     location:=atlas_customer.intake_location((d->>'kioskId')::uuid);
     IF location IS NULL THEN RETURN atlas_customer.problem(409,'KIOSK_NOT_AVAILABLE'); END IF;
   END IF;
   IF NOT atlas_customer.take_rate('intake-create:'||account_id,20) THEN RETURN atlas_customer.problem(429,'PLEASE_WAIT'); END IF;
   INSERT INTO atlas_customer."CustomerIntakeDraft"("accountId","requestId","inputHash","intakeMethod","kioskId","locationSnapshot") VALUES
    (account_id,(d->>'requestId')::uuid,ih,d->>'intakeMethod',(d->>'kioskId')::uuid,location) RETURNING * INTO draft;
   RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(draft.id));
 END IF;
 did:=(d->>'id')::uuid;
 SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=did AND "accountId"=account_id FOR UPDATE;
 IF draft.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF action='intake_read' THEN RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did)); END IF;
 IF action='intake_upload' THEN
   SELECT u.id INTO uid FROM atlas_customer."CustomerIntakeUpload" u JOIN atlas_customer."CustomerIntakeCard" cc ON cc.id=u."cardId"
    WHERE cc."draftId"=did AND cc.id=(d->>'cardId')::uuid AND u.id=(d->>'uploadId')::uuid;
   IF uid IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
   RETURN jsonb_build_object('upload',atlas_customer.intake_upload_projection(uid));
 END IF;
 IF draft.state='ORDERED' OR NOT atlas_customer.intake_editable(did) THEN RETURN atlas_customer.problem(409,'INTAKE_ALREADY_ORDERED'); END IF;
 IF action='intake_card' THEN
   payload:=d->'card'; ih:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
   IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR (payload-ARRAY['requestId','cardId','pairId','front','back'])<>'{}'::jsonb
     OR NOT payload ?& ARRAY['requestId','cardId','pairId','front','back'] THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE'); END IF;
   SELECT * INTO c FROM atlas_customer."CustomerIntakeCard" WHERE "draftId"=did AND "requestId"=(payload->>'requestId')::uuid;
   IF c.id IS NOT NULL THEN
     IF c."inputHash"<>ih THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
     RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did));
   END IF;
   SELECT count(*) INTO cards FROM atlas_customer."CustomerIntakeCard" WHERE "draftId"=did;
   IF cards>=100 THEN RETURN atlas_customer.problem(409,'INTAKE_CARD_LIMIT'); END IF;
   IF payload->'front'->>'sha256'=payload->'back'->>'sha256' OR payload->'front'->>'uploadId'=payload->'back'->>'uploadId' THEN RETURN atlas_customer.problem(400,'DISTINCT_CARD_SIDES_REQUIRED'); END IF;
   FOREACH side_name IN ARRAY ARRAY['front','back'] LOOP
     p:=payload->side_name;
     IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT p ?& ARRAY['uploadId','sha256','byteCount','fileName'] OR (p-ARRAY['uploadId','sha256','byteCount','fileName'])<>'{}'::jsonb
       OR COALESCE(p->>'sha256','') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p->'byteCount') IS DISTINCT FROM 'number' OR (p->>'byteCount')::numeric<>trunc((p->>'byteCount')::numeric)
       OR (p->>'byteCount')::numeric NOT BETWEEN 1 AND 67108864 OR jsonb_typeof(p->'fileName') IS DISTINCT FROM 'string' OR length(p->>'fileName')>240 OR (p->>'fileName') ~ '[[:cntrl:]]' THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE'); END IF;
   END LOOP;
   INSERT INTO atlas_customer."CustomerIntakeCard"(id,"draftId","requestId","pairId","inputHash") VALUES ((payload->>'cardId')::uuid,did,(payload->>'requestId')::uuid,(payload->>'pairId')::uuid,ih);
   FOREACH side_name IN ARRAY ARRAY['front','back'] LOOP
     p:=payload->side_name; uid:=(p->>'uploadId')::uuid;
     INSERT INTO atlas_customer."CustomerIntakeUpload"(id,"cardId",side,"fileName",plan) VALUES (uid,(payload->>'cardId')::uuid,upper(side_name),p->>'fileName',
      jsonb_build_object('schemaVersion',1,'uploadId',uid,'binding',jsonb_build_object('cardId',payload->>'cardId','pairId',payload->>'pairId','side',upper(side_name),'version',1),
       'object',jsonb_build_object('key','atlas-customer/originals/'||account_id::text||'/'||(payload->>'cardId')||'/'||uid::text,'versionId',NULL),
       'expected',jsonb_build_object('sha256',p->>'sha256','byteCount',(p->>'byteCount')::integer)));
   END LOOP;
 ELSIF action='intake_correct' THEN
   SELECT * INTO c FROM atlas_customer."CustomerIntakeCard" WHERE id=(d->>'cardId')::uuid AND "draftId"=did FOR UPDATE;
   IF c.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
   IF NOT atlas_customer.intake_identity_valid(d->'identity') THEN RETURN atlas_customer.problem(400,'INVALID_CARD_DETAILS'); END IF;
   IF c.revision IS DISTINCT FROM (d->>'expectedRevision')::integer THEN
     IF c.identity=d->'identity' AND c."identitySource"='CUSTOMER_CORRECTION' THEN RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did)); END IF;
     RETURN atlas_customer.problem(409,'INTAKE_REVISION_CHANGED');
   END IF;
   UPDATE atlas_customer."CustomerIntakeCard" SET identity=d->'identity',"identitySource"='CUSTOMER_CORRECTION',revision=revision+1 WHERE id=c.id;
 ELSIF action='intake_review' THEN
   IF draft.revision IS DISTINCT FROM (d->>'expectedRevision')::integer THEN RETURN atlas_customer.problem(409,'INTAKE_REVISION_CHANGED'); END IF;
   IF NOT atlas_customer.valid_intake_profile(d->'profile',draft."intakeMethod") THEN RETURN atlas_customer.problem(400,CASE WHEN draft."intakeMethod"='DEALER_DROP_OFF' THEN 'CONTACT_DETAILS_REQUIRED' ELSE 'RETURN_DETAILS_REQUIRED' END); END IF;
   IF NOT EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeCard" WHERE "draftId"=did) OR EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeCard" cc WHERE cc."draftId"=did AND (cc.identity IS NULL OR EXISTS (SELECT 1 FROM atlas_customer."CustomerIntakeUpload" u WHERE u."cardId"=cc.id AND u.verification IS NULL))) THEN RETURN atlas_customer.problem(409,'INTAKE_REVIEW_NOT_READY'); END IF;
   IF draft.state='REVIEW' AND draft."profileSnapshot"=d->'profile' THEN RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did)); END IF;
   UPDATE atlas_customer."CustomerIntakeDraft" SET state='REVIEW',"profileSnapshot"=d->'profile',revision=revision+1,"updatedAt"=clock_timestamp() WHERE id=did;
   RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did));
 ELSE RETURN atlas_customer.problem(404,'NOT_FOUND');
 END IF;
 UPDATE atlas_customer."CustomerIntakeDraft" SET state='DRAFT',revision=revision+1,"updatedAt"=clock_timestamp() WHERE id=did;
 RETURN jsonb_build_object('draft',atlas_customer.intake_draft_projection(did));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR unique_violation OR not_null_violation THEN RETURN atlas_customer.problem(400,'INVALID_INTAKE');
END $$;

-- The existing session, browser, control binding and grants remain the only
-- authority. Compact contact saves retain an existing mailing address.
ALTER FUNCTION atlas_customer.customer_call(text,jsonb,jsonb) RENAME TO customer_call_before_shop_profile;
CREATE FUNCTION atlas_customer.customer_call(action text,b jsonb,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
DECLARE ctl atlas_customer."CustomerControl"; a atlas_customer."CustomerAccount"; p jsonb; saved jsonb;
BEGIN
 IF action<>'profile' THEN RETURN atlas_customer.customer_call_before_shop_profile(action,b,d); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-access-v1',0));
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR jsonb_typeof(b) IS DISTINCT FROM 'object' OR
  (b->>'mode',b->>'origin',b->>'deploymentId',b->>'releaseSha',b->>'configHash') IS DISTINCT FROM
  (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>65536
  OR d-ARRAY['profile','sessionHash','browserHash']<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 SELECT * INTO a FROM atlas_customer.current_account(d->>'sessionHash',d->>'browserHash',ctl.revision);
 IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 p:=d->'profile';
 IF atlas_customer.valid_contact_profile(p) THEN
  SELECT profile INTO saved FROM atlas_customer."CustomerAccount" WHERE id=a.id FOR UPDATE;
  saved:=COALESCE(saved,'{}'::jsonb)||p;
  -- Explicitly clearing email removes it. An omitted email preserves it.
  IF p ? 'email' AND p->>'email'='' THEN saved:=saved-'email'; END IF;
 ELSIF atlas_customer.valid_profile(p) THEN saved:=p;
 ELSE RETURN atlas_customer.problem(400,'CONTACT_DETAILS_REQUIRED'); END IF;
 UPDATE atlas_customer."CustomerAccount" SET profile=saved WHERE id=a.id RETURNING * INTO a;
 RETURN jsonb_build_object('customer',atlas_customer.account_projection(a));
END $$;
REVOKE ALL ON FUNCTION atlas_customer.customer_call(text,jsonb,jsonb) FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
 FOR role_name IN SELECT r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl JOIN pg_roles r ON r.oid=acl.grantee
 WHERE n.nspname='atlas_customer' AND p.proname='customer_call_before_shop_profile' AND acl.privilege_type='EXECUTE' AND acl.grantee<>p.proowner LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION atlas_customer.customer_call(text,jsonb,jsonb) TO %I',role_name);
  EXECUTE format('REVOKE ALL ON FUNCTION atlas_customer.customer_call_before_shop_profile(text,jsonb,jsonb) FROM %I',role_name);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION atlas_customer.customer_call_before_shop_profile(text,jsonb,jsonb) FROM PUBLIC;

-- Exact current phone/legacy payment gateway; only new phone-shop receipts may
-- omit email. SMS uses the verified account phone and tax uses the shop registry.
CREATE OR REPLACE FUNCTION atlas_customer.commerce_provider_call(action text,b jsonb,d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
<<provider_call>>
DECLARE ctl atlas_customer."CommerceControl"; draft atlas_customer."CustomerIntakeDraft"; q atlas_customer."CommerceQuote";
 p atlas_customer."CommercePayment"; ord atlas_customer."CommerceOrder"; ef atlas_customer."CommerceEffect";
 auth jsonb; checked jsonb; source jsonb; quote jsonb; observation jsonb; evidence jsonb; line jsonb; card jsonb; effect jsonb;
 shipping_plan jsonb; shipment_request jsonb; customer_party jsonb;
 did uuid; aid uuid; pid uuid; oid uuid; rid text; n integer; unit integer; shipping integer; taxes integer; total integer; idx integer;
BEGIN
 SELECT * INTO ctl FROM atlas_customer."CommerceControl" WHERE id='active';
 IF ctl.id IS NULL OR NOT ctl.enabled OR ctl.binding IS DISTINCT FROM b THEN RETURN atlas_customer.problem(503,'COMMERCE_NOT_CONFIGURED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>12582912 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 IF action='commerce_pending_effects' THEN
  UPDATE atlas_customer."CommerceEffect" SET state='UNKNOWN',"updatedAt"=clock_timestamp(),result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('code','EFFECT_RECONCILIATION_REQUIRED')
   WHERE state='DISPATCHED' AND "updatedAt"<clock_timestamp()-interval '5 minutes';
  RETURN jsonb_build_object('effects',COALESCE((SELECT jsonb_agg(id) FROM (SELECT id FROM atlas_customer."CommerceEffect" WHERE state='PENDING' ORDER BY "createdAt",id LIMIT 20) ready),'[]'::jsonb));
 END IF;
 IF action='commerce_reconcilable_effects' THEN
  -- Poll a known asynchronous job at most five times with durable backoff.
  -- No shipment create request is repeated, even if this worker crashes.
  WITH ready AS (SELECT id FROM atlas_customer."CommerceEffect" WHERE kind='FEDEX_LABEL' AND state='UNKNOWN'
   AND result->>'jobId' IS NOT NULL AND "reconcileCount"<5 AND ("reconcileAfter" IS NULL OR "reconcileAfter"<=clock_timestamp())
   ORDER BY "createdAt",id FOR UPDATE SKIP LOCKED LIMIT 5), marked AS (
   UPDATE atlas_customer."CommerceEffect" e SET "reconcileAfter"=clock_timestamp()+make_interval(secs=>60*power(2,e."reconcileCount")::integer),"reconcileCount"=e."reconcileCount"+1
   FROM ready WHERE e.id=ready.id RETURNING e.id)
  SELECT jsonb_build_object('effects',COALESCE(jsonb_agg(id),'[]'::jsonb)) INTO checked FROM marked;
  RETURN checked;
 END IF;
 IF action IN ('commerce_effect','commerce_claim_effect','commerce_finish_effect') THEN
  SELECT * INTO ef FROM atlas_customer."CommerceEffect" WHERE id=d->>'effectId' FOR UPDATE;
  IF ef.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  IF action='commerce_effect' THEN RETURN to_jsonb(ef); END IF;
  IF action='commerce_claim_effect' THEN
   IF ef.state<>'PENDING' THEN RETURN jsonb_build_object('effect',to_jsonb(ef),'dispatch',false); END IF;
   UPDATE atlas_customer."CommerceEffect" SET state='DISPATCHED',"claimId"=(d->>'claimId')::uuid,"updatedAt"=clock_timestamp() WHERE id=ef.id RETURNING * INTO ef;
   RETURN jsonb_build_object('effect',to_jsonb(ef),'dispatch',true);
  END IF;
  IF ef."claimId" IS DISTINCT FROM (d->>'claimId')::uuid OR COALESCE(d->>'state','') NOT IN ('UNKNOWN','SUCCEEDED','FAILED') THEN RETURN atlas_customer.problem(409,'EFFECT_CLAIM_CONFLICT'); END IF;
  IF ef.state='SUCCEEDED' THEN
   IF ef.result IS DISTINCT FROM d->'result' THEN RETURN atlas_customer.problem(409,'EFFECT_RESULT_CONFLICT'); END IF;
   RETURN to_jsonb(ef);
  END IF;
  IF d->>'state'='SUCCEEDED' AND ef.kind='FEDEX_LABEL' AND (COALESCE(d->'result'->>'trackingNumber','')='' OR COALESCE(d->'result'->>'labelBase64','')='') THEN RETURN atlas_customer.problem(409,'FEDEX_LABEL_MISSING'); END IF;
  UPDATE atlas_customer."CommerceEffect" SET state=d->>'state',result=d->'result',"updatedAt"=clock_timestamp() WHERE id=ef.id RETURNING * INTO ef;
  RETURN to_jsonb(ef);
 END IF;
 IF action='commerce_provider_event' THEN
  evidence:=d->'event'; pid:=(evidence->>'attemptId')::uuid;
  IF evidence->>'merchantId' IS DISTINCT FROM ctl.merchant->>'accountId' OR evidence->'livemode' IS DISTINCT FROM ctl.merchant->'livemode'
   OR COALESCE(evidence->>'eventId','')='' OR COALESCE(evidence->>'bodyHash','') !~ '^[a-f0-9]{64}$' THEN RETURN atlas_customer.problem(409,'PAYMENT_MERCHANT_MISMATCH'); END IF;
  IF EXISTS (SELECT 1 FROM atlas_customer."CommerceProviderEvent" WHERE provider=ctl.merchant->>'provider' AND merchant=ctl.merchant->>'accountId' AND "eventId"=evidence->>'eventId' AND "bodyHash"<>evidence->>'bodyHash') THEN RETURN atlas_customer.problem(409,'PROVIDER_EVENT_CONFLICT'); END IF;
  INSERT INTO atlas_customer."CommerceProviderEvent"(provider,merchant,"eventId","bodyHash","paymentId") VALUES (ctl.merchant->>'provider',ctl.merchant->>'accountId',evidence->>'eventId',evidence->>'bodyHash',pid) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('recorded',true);
 END IF;
 IF action IN ('commerce_checkout','commerce_save_quote') THEN did:=COALESCE(d->>'draftId',d->'quote'->>'draftId')::uuid;
 ELSIF action='commerce_reserve_payment' THEN SELECT "draftId" INTO did FROM atlas_customer."CommerceQuote" WHERE id=(d->>'quoteId')::uuid;
 ELSIF action IN ('commerce_record_payment','commerce_payment','commerce_confirm_paid','commerce_callback_payment','commerce_callback_confirm') THEN SELECT "draftId" INTO did FROM atlas_customer."CommercePayment" WHERE id=(d->>'attemptId')::uuid;
 ELSIF action='commerce_order' THEN SELECT "draftId" INTO did FROM atlas_customer."CommerceOrder" WHERE id=(d->>'orderId')::uuid;
 ELSE RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF did IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF action NOT IN ('commerce_callback_payment','commerce_callback_confirm') THEN
  auth:=d->'authority';
  checked:=atlas_customer.customer_call('intake_read',auth->'binding',(auth- 'binding')||jsonb_build_object('id',did));
  IF checked ? 'error' THEN RETURN checked; END IF;
 END IF;
 -- Same per-account lock order as intake mutations, then draft row.
 SELECT "accountId" INTO aid FROM atlas_customer."CustomerIntakeDraft" WHERE id=did;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-intake:'||aid::text,0));
 SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=did FOR UPDATE;
 source:=atlas_customer.commerce_source(did);
 IF action='commerce_checkout' THEN
  IF draft.state NOT IN ('REVIEW','ORDERED') THEN RETURN atlas_customer.problem(409,'CARD_REVIEW_REQUIRED'); END IF;
  RETURN source;
 END IF;
 IF action='commerce_order' THEN RETURN atlas_customer.commerce_call(action,aid,d); END IF;
 IF action='commerce_save_quote' THEN
  quote:=d->'quote'; n:=jsonb_array_length(source->'cards'); unit:=CASE WHEN draft."intakeMethod"='MAIL_IN' THEN 4000 ELSE 5000 END;
  IF jsonb_typeof(quote) IS DISTINCT FROM 'object' OR NOT quote ?& ARRAY['id','draftId','draftRevision','profileRevision','accountId','profile','phone','channel','location','cards','currency','subtotalCents','shippingCents','taxCents','totalCents','tax','shipping','merchant','terms','expiresAt','createdAt','contentHash']
   OR EXISTS (SELECT 1 FROM unnest(ARRAY['draftRevision','profileRevision','subtotalCents','shippingCents','taxCents','totalCents']) k WHERE jsonb_typeof(quote->k) IS DISTINCT FROM 'number' OR (quote->>k)::numeric<>trunc((quote->>k)::numeric))
   OR draft.state<>'REVIEW' OR draft.revision IS DISTINCT FROM (d->>'expectedRevision')::integer OR (quote->>'draftRevision')::integer<>draft.revision
   OR quote->'profile' IS DISTINCT FROM draft."profileSnapshot" OR quote->>'accountId' IS DISTINCT FROM aid::text OR quote->>'phone' IS DISTINCT FROM source->>'phone'
   OR quote->>'channel' IS DISTINCT FROM source->>'channel' OR quote->'location' IS DISTINCT FROM source->'location' OR quote->'merchant' IS DISTINCT FROM ctl.merchant
   OR (quote->>'profileRevision')::integer<>draft.revision OR quote->>'currency'<>'usd' OR n NOT BETWEEN 1 AND 100 OR jsonb_array_length(quote->'cards')<>n
   THEN RETURN atlas_customer.problem(409,'CHECKOUT_CHANGED'); END IF;
  IF draft."kioskId" IS NOT NULL AND (source->'location'='null'::jsonb OR source->'location'->'schedule'->>'nextCollectionAt' IS NULL) THEN RETURN atlas_customer.problem(409,'KIOSK_NOT_AVAILABLE'); END IF;
  idx:=0;
  FOR card IN SELECT value FROM jsonb_array_elements(source->'cards') LOOP
   line:=quote->'cards'->idx;
   IF line->>'cardId' IS DISTINCT FROM card->>'id' OR line->'revision' IS DISTINCT FROM card->'revision' OR line->'photoPairHash' IS DISTINCT FROM card->'photoPairHash'
    OR line->'identity' IS DISTINCT FROM card->'identity' OR card->'identity'='null'::jsonb OR (line->>'unitCents')::numeric IS DISTINCT FROM unit::numeric
    OR (line->>'commissionCents')::numeric IS DISTINCT FROM (CASE WHEN unit=5000 THEN 500 ELSE 0 END)::numeric
    OR (SELECT count(*) FROM atlas_customer."CustomerIntakeUpload" WHERE "cardId"=(card->>'id')::uuid AND verification IS NOT NULL)<>2 THEN RETURN atlas_customer.problem(409,'CHECKOUT_CHANGED'); END IF;
   idx:=idx+1;
  END LOOP;
  shipping:=(quote->>'shippingCents')::integer; taxes:=(quote->>'taxCents')::integer; total:=(quote->>'totalCents')::integer;
  IF (quote->>'subtotalCents')::integer<>n*unit OR shipping<0 OR taxes<0 OR total<>n*unit+shipping+taxes
   OR quote->'tax'->>'providerId' IS NULL OR quote->'tax'->>'currency' IS DISTINCT FROM 'usd' OR (quote->'tax'->>'taxCents')::numeric IS DISTINCT FROM taxes::numeric OR (quote->'tax'->>'totalCents')::numeric IS DISTINCT FROM total::numeric
   OR quote->>'contentHash' IS DISTINCT FROM atlas_customer.commerce_hash(quote-'contentHash')
   OR (quote->>'expiresAt')::timestamptz<=clock_timestamp() OR (quote->>'expiresAt')::timestamptz>clock_timestamp()+interval '16 minutes'
   THEN RETURN atlas_customer.problem(409,'QUOTE_INVALID'); END IF;
  IF quote->'terms'->>'paymentFlow' IS DISTINCT FROM 'CUSTOMER_PHONE' THEN RETURN atlas_customer.problem(409,'PAYMENT_FLOW_CHANGED'); END IF;
  IF unit=5000 THEN
   IF shipping<>0 OR quote->'shipping'<>'[]'::jsonb OR quote->'shippingPlan' IS DISTINCT FROM 'null'::jsonb OR quote->'terms'->>'clockStart'<>'ATLAS_COLLECTION' OR (quote->'terms'->>'days')::integer<>7 THEN RETURN atlas_customer.problem(409,'KIOSK_SHIPPING_FORBIDDEN'); END IF;
  ELSE
   shipping_plan:=quote->'shippingPlan';
   IF NOT atlas_customer.commerce_shipping_plan_valid(shipping_plan,n,ctl.terms->>'mailChargedLegs')
    OR (SELECT count(*) FROM jsonb_array_elements(source->'shippingPlans') configured WHERE configured=shipping_plan)<>1
    OR (quote->>'expiresAt')::timestamptz>(shipping_plan->>'validUntil')::timestamptz THEN RETURN atlas_customer.problem(409,'SHIPPING_PLAN_INVALID'); END IF;
   customer_party:=jsonb_build_object('contact',jsonb_build_object('personName',source->'profile'->>'name','phoneNumber',source->>'phone'),
    'address',jsonb_build_object('streetLines',CASE WHEN COALESCE(source->'profile'->>'address2','')<>'' THEN jsonb_build_array(source->'profile'->>'address1',source->'profile'->>'address2') ELSE jsonb_build_array(source->'profile'->>'address1') END,
    'city',source->'profile'->>'city','stateOrProvinceCode',source->'profile'->>'region','postalCode',source->'profile'->>'postalCode','countryCode',source->'profile'->>'country'));
   FOR line IN SELECT value FROM jsonb_array_elements(quote->'shipping') LOOP
    shipment_request:=shipping_plan->'legs'->(line->>'leg');
    shipment_request:=CASE WHEN line->>'leg'='INBOUND' THEN jsonb_set(shipment_request,'{requestedShipment,shipper}',customer_party)
     ELSE jsonb_set(shipment_request,'{requestedShipment,recipients}',jsonb_build_array(customer_party)) END;
    IF line->'request' IS DISTINCT FROM shipment_request THEN RETURN atlas_customer.problem(409,'SHIPPING_PLAN_INVALID'); END IF;
   END LOOP;
   IF ctl.terms->>'mailClockStart' IS DISTINCT FROM 'ATLAS_RECEIPT' OR COALESCE(ctl.terms->>'mailChargedLegs','') NOT IN ('INBOUND_ONLY','BOTH_LEGS')
    OR quote->'terms'->>'clockStart' IS DISTINCT FROM ctl.terms->>'mailClockStart' OR quote->'terms'->>'mailChargedLegs' IS DISTINCT FROM ctl.terms->>'mailChargedLegs'
    OR (quote->'terms'->>'days')::integer<>14 OR jsonb_array_length(quote->'shipping')<>(CASE WHEN ctl.terms->>'mailChargedLegs'='BOTH_LEGS' THEN 2 ELSE 1 END)
    OR shipping<>(SELECT sum((value->>'amountCents')::numeric) FROM jsonb_array_elements(quote->'shipping'))
    OR quote->'shipping'->0->>'leg' IS DISTINCT FROM 'INBOUND' OR (ctl.terms->>'mailChargedLegs'='BOTH_LEGS' AND quote->'shipping'->1->>'leg' IS DISTINCT FROM 'RETURN')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(quote->'shipping') rate WHERE rate->>'providerId' IS NULL OR rate->>'currency' IS DISTINCT FROM 'usd'
      OR (rate->>'amountCents')::numeric<0 OR (rate->>'amountCents')::numeric<>trunc((rate->>'amountCents')::numeric)
      OR rate->>'requestHash' IS DISTINCT FROM atlas_customer.commerce_hash(rate->'request')) THEN RETURN atlas_customer.problem(409,'MAIL_SHIPPING_TERMS_NOT_CONFIGURED'); END IF;
  END IF;
  INSERT INTO atlas_customer."CommerceQuote"(id,"accountId","draftId","draftRevision","contentHash",snapshot,"expiresAt") VALUES
   ((quote->>'id')::uuid,aid,did,draft.revision,quote->>'contentHash',quote,(quote->>'expiresAt')::timestamptz) ON CONFLICT DO NOTHING;
  SELECT * INTO q FROM atlas_customer."CommerceQuote" WHERE id=(quote->>'id')::uuid;
  IF q.snapshot IS DISTINCT FROM quote THEN RETURN atlas_customer.problem(409,'QUOTE_CONFLICT'); END IF;
  RETURN q.snapshot;
 END IF;
 IF action='commerce_reserve_payment' THEN
  SELECT * INTO p FROM atlas_customer."CommercePayment" WHERE "accountId"=aid AND "requestId"=(d->>'requestId')::uuid;
  IF p.id IS NOT NULL THEN
   IF p."quoteId"<>(d->>'quoteId')::uuid THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
   RETURN jsonb_build_object('attempt',atlas_customer.commerce_payment_projection(p.id),'dispatch',false);
  END IF;
  SELECT * INTO p FROM atlas_customer."CommercePayment" WHERE "draftId"=did AND state<>'CANCELED';
  IF p.id IS NOT NULL THEN RETURN jsonb_build_object('attempt',atlas_customer.commerce_payment_projection(p.id),'dispatch',false); END IF;
  SELECT * INTO q FROM atlas_customer."CommerceQuote" WHERE id=(d->>'quoteId')::uuid;
  IF q."accountId"<>aid OR q."expiresAt"<=clock_timestamp() OR q."draftRevision"<>draft.revision OR draft.state<>'REVIEW'
   OR q.snapshot->'profile' IS DISTINCT FROM draft."profileSnapshot" OR q.snapshot->'merchant' IS DISTINCT FROM ctl.merchant OR d->'merchant' IS DISTINCT FROM ctl.merchant
   THEN RETURN atlas_customer.problem(409,'CHECKOUT_CHANGED'); END IF;
  -- Every current card/photo binding must still match the immutable quote.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(source->'cards') c WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(q.snapshot->'cards') l WHERE l->>'cardId'=c->>'id' AND l->'revision'=c->'revision' AND l->'photoPairHash'=c->'photoPairHash' AND l->'identity'=c->'identity'))
   OR jsonb_array_length(source->'cards')<>jsonb_array_length(q.snapshot->'cards') THEN RETURN atlas_customer.problem(409,'CHECKOUT_CHANGED'); END IF;
  IF draft."kioskId" IS NOT NULL THEN
   IF atlas_customer.intake_location(draft."kioskId") IS DISTINCT FROM q.snapshot->'location' THEN RETURN atlas_customer.problem(409,'KIOSK_NOT_AVAILABLE'); END IF;
   IF q.snapshot->'terms'->>'paymentFlow' IS DISTINCT FROM 'CUSTOMER_PHONE' THEN RETURN atlas_customer.problem(409,'PAYMENT_FLOW_CHANGED'); END IF;
   -- New shop purchases use the customer's phone. Existing unresolved terminal
   -- attempts were returned above unchanged; no reader is reserved here.
  END IF;
  INSERT INTO atlas_customer."CommercePayment"(id,"accountId","draftId","quoteId","requestId",merchant,"readerId",state) VALUES
   ((d->>'attemptId')::uuid,aid,did,q.id,(d->>'requestId')::uuid,ctl.merchant,rid,'DISPATCHED') RETURNING * INTO p;
  RETURN jsonb_build_object('attempt',atlas_customer.commerce_payment_projection(p.id),'dispatch',true);
 END IF;
 SELECT * INTO p FROM atlas_customer."CommercePayment" WHERE id=(d->>'attemptId')::uuid FOR UPDATE;
 IF p.id IS NULL OR p.merchant IS DISTINCT FROM ctl.merchant THEN RETURN atlas_customer.problem(409,'PAYMENT_MERCHANT_MISMATCH'); END IF;
 SELECT * INTO q FROM atlas_customer."CommerceQuote" WHERE id=p."quoteId";
 IF action IN ('commerce_payment','commerce_callback_payment') THEN RETURN atlas_customer.commerce_payment_projection(p.id); END IF;
 IF action='commerce_record_payment' THEN
  observation:=d->'observation';
  IF COALESCE(observation->>'state','') NOT IN ('UNKNOWN','AWAITING_PAYMENT','PROCESSING','CANCELED') THEN RETURN atlas_customer.problem(400,'INVALID_PAYMENT_STATE'); END IF;
  IF p.state='PAID' THEN RETURN atlas_customer.commerce_payment_projection(p.id); END IF;
  IF p."providerId" IS NOT NULL AND observation->>'providerId' IS NOT NULL AND p."providerId"<>observation->>'providerId' THEN RETURN atlas_customer.problem(409,'PAYMENT_ID_MISMATCH'); END IF;
  IF observation->>'state'='CANCELED' AND (observation->>'source' IS DISTINCT FROM 'PROVIDER_RETRIEVAL' OR observation->>'status' IS DISTINCT FROM 'canceled' OR observation->>'attemptId' IS DISTINCT FROM p.id::text OR observation->>'quoteHash' IS DISTINCT FROM q."contentHash"
   OR observation->>'merchantId' IS DISTINCT FROM p.merchant->>'accountId' OR observation->'livemode' IS DISTINCT FROM p.merchant->'livemode' OR observation->'amountCents' IS DISTINCT FROM q.snapshot->'totalCents') THEN RETURN atlas_customer.problem(409,'PAYMENT_NOT_CONFIRMED'); END IF;
  UPDATE atlas_customer."CommercePayment" SET state=provider_call.observation->>'state',"providerId"=COALESCE("providerId",provider_call.observation->>'providerId'),observation=COALESCE(p.observation,'{}'::jsonb)||provider_call.observation,"updatedAt"=clock_timestamp() WHERE id=p.id;
  RETURN atlas_customer.commerce_payment_projection(p.id);
 END IF;
 IF action IN ('commerce_confirm_paid','commerce_callback_confirm') THEN
  evidence:=d->'evidence';
  IF evidence->>'source' IS DISTINCT FROM 'PROVIDER_RETRIEVAL' OR evidence->>'status' IS DISTINCT FROM 'succeeded'
   OR evidence->>'provider' IS DISTINCT FROM p.merchant->>'provider' OR evidence->>'merchantId' IS DISTINCT FROM p.merchant->>'accountId' OR evidence->'livemode' IS DISTINCT FROM p.merchant->'livemode'
   OR evidence->>'attemptId' IS DISTINCT FROM p.id::text OR evidence->>'quoteHash' IS DISTINCT FROM q."contentHash"
   OR evidence->'amountCents' IS DISTINCT FROM q.snapshot->'totalCents' OR evidence->'receivedCents' IS DISTINCT FROM q.snapshot->'totalCents' OR evidence->>'currency' IS DISTINCT FROM q.snapshot->>'currency'
   OR COALESCE(evidence->>'providerId','')='' OR (p."providerId" IS NOT NULL AND p."providerId"<>evidence->>'providerId')
   OR NOT COALESCE(evidence->'paymentMethodTypes' ? CASE WHEN q.snapshot->>'channel'='KIOSK' AND COALESCE(q.snapshot->'terms'->>'paymentFlow','')<>'CUSTOMER_PHONE' THEN 'card_present' ELSE 'card' END,false) THEN RETURN atlas_customer.problem(409,'PAYMENT_BINDING_MISMATCH'); END IF;
  SELECT * INTO ord FROM atlas_customer."CommerceOrder" WHERE "paymentId"=p.id;
  IF ord.id IS NOT NULL THEN RETURN jsonb_build_object('order',atlas_customer.commerce_call('commerce_order',aid,jsonb_build_object('orderId',ord.id))); END IF;
  oid:=(d->>'receiptId')::uuid;
  UPDATE atlas_customer."CommercePayment" SET state='PAID',"providerId"=evidence->>'providerId',observation=evidence- 'clientSecret',"updatedAt"=clock_timestamp() WHERE id=p.id;
  INSERT INTO atlas_customer."CommerceOrder"(id,"accountId","draftId","quoteId","paymentId",reference,receipt,"paidAt") VALUES
   (oid,aid,did,q.id,p.id,'ATLAS-'||upper(substr(replace(oid::text,'-',''),1,18)),
    (q.snapshot-ARRAY['merchant','phone'])||jsonb_build_object('payment',evidence- 'clientSecret'),clock_timestamp()) RETURNING * INTO ord;
  -- Build effects in SQL from the paid snapshot; browser/private caller cannot
  -- alter destinations, totals, shipping request or effect multiplicity.
  IF q.snapshot->>'channel'<>'KIOSK' OR COALESCE(q.snapshot->'terms'->>'paymentFlow','')<>'CUSTOMER_PHONE'
   OR COALESCE(btrim(q.snapshot->'profile'->>'email'),'')<>'' THEN
   INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES
    (oid||':email:v1',oid,'EMAIL_RECEIPT',jsonb_build_object('orderId',oid,'reference',ord.reference,'to',q.snapshot->'profile'->>'email','currency','usd','totalCents',q.snapshot->'totalCents','quoteHash',q."contentHash"));
  END IF;
  INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES
   (oid||':sms:v1',oid,'SMS_RECEIPT',jsonb_build_object('orderId',oid,'reference',ord.reference,'to',q.snapshot->>'phone','currency','usd','totalCents',q.snapshot->'totalCents','quoteHash',q."contentHash")),
   (oid||':tax:v1',oid,'TAX_TRANSACTION',jsonb_build_object('orderId',oid,'calculationId',q.snapshot->'tax'->>'providerId'));
  FOR line IN SELECT value FROM jsonb_array_elements(q.snapshot->'shipping') LOOP
   INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES (oid||':fedex:'||(line->>'leg')||':v1',oid,'FEDEX_LABEL',jsonb_build_object('orderId',oid,'shipment',line->'request','leg',line->>'leg','rateId',line->>'providerId'));
  END LOOP;
  IF q.snapshot->>'channel'='KIOSK' AND COALESCE(q.snapshot->'terms'->>'paymentFlow','')<>'CUSTOMER_PHONE' THEN INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES (oid||':package:v1',oid,'PACKAGE_LABEL',jsonb_build_object('orderId',oid,'reference',ord.reference,'cardCount',jsonb_array_length(q.snapshot->'cards'),'locationId',q.snapshot->'location'->>'id')); END IF;
  UPDATE atlas_customer."CustomerIntakeDraft" SET state='ORDERED',"updatedAt"=clock_timestamp() WHERE id=did;
  RETURN jsonb_build_object('order',atlas_customer.commerce_call('commerce_order',aid,jsonb_build_object('orderId',oid)));
 END IF;
 RETURN atlas_customer.problem(404,'NOT_FOUND');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR not_null_violation OR check_violation THEN RETURN atlas_customer.problem(400,'INVALID_COMMERCE_REQUEST');
END $$;
REVOKE ALL ON FUNCTION atlas_customer.commerce_provider_call(text,jsonb,jsonb) FROM PUBLIC;
COMMIT;
