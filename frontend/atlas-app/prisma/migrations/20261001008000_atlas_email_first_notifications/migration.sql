-- Email-first launch: new receipt and progress delivery uses email only.
-- Preserve old attempts, immutable quotes, SMS preferences and historical jobs.
-- No provider activation, opt-in seed, history replay or message sends.
BEGIN;
CREATE FUNCTION atlas_customer.commerce_receipt_email_valid(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(length(value) BETWEEN 3 AND 254 AND value !~ '[[:cntrl:][:space:]]'
  AND value ~ '^[^@]+@[^@]+\.[^@]+$',false)
$$;
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
   WHERE state='DISPATCHED' AND kind<>'SMS_RECEIPT' AND "updatedAt"<clock_timestamp()-interval '5 minutes';
  RETURN jsonb_build_object('effects',COALESCE((SELECT jsonb_agg(id) FROM (SELECT id FROM atlas_customer."CommerceEffect" WHERE state='PENDING' AND kind<>'SMS_RECEIPT' ORDER BY "createdAt",id LIMIT 20) ready),'[]'::jsonb));
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
   IF ef.kind='SMS_RECEIPT' THEN RETURN jsonb_build_object('effect',to_jsonb(ef),'dispatch',false,'blockedReason','SMS_NOTIFICATIONS_DISABLED'); END IF;
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
  IF NOT atlas_customer.commerce_receipt_email_valid(source->'profile'->>'email') THEN RETURN atlas_customer.problem(409,'PROFILE_EMAIL_REQUIRED'); END IF;
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
  -- Existing attempts were returned above: new email requirements cannot rewrite them.
  IF NOT atlas_customer.commerce_receipt_email_valid(q.snapshot->'profile'->>'email') THEN RETURN atlas_customer.problem(409,'PROFILE_EMAIL_REQUIRED'); END IF;
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

CREATE OR REPLACE FUNCTION atlas_customer.progress_preferences(aid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('revision',COALESCE(p.revision,0),'email',COALESCE(p.email,false),'sms',COALESCE(p.sms,false),
 'deliveryChannels',jsonb_build_array('EMAIL'),'deliveryEnabled',COALESCE((SELECT enabled FROM atlas_customer."ProgressNotificationControl" WHERE id='active'),false))
 FROM (SELECT aid id) a LEFT JOIN atlas_customer."ProgressPreference" p ON p."accountId"=a.id
$$;

CREATE OR REPLACE FUNCTION atlas_customer.enqueue_progress(cid uuid,kind text,event_key text,occurred timestamptz,src jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE a atlas_customer."CustomerAccount"; p atlas_customer."ProgressPreference"; reference text; card_title text; channel_name text; dest text;
BEGIN
 SELECT customer.* INTO a FROM atlas_dealer.order_card c JOIN atlas_customer."CommerceOrder" o ON o.id=c.order_id
 JOIN atlas_customer."CustomerAccount" customer ON customer.id=o."accountId" WHERE c.card_id=cid AND customer."revokedAt" IS NULL;
 IF a.id IS NULL THEN RETURN; END IF;
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
REVOKE ALL ON FUNCTION atlas_customer.commerce_receipt_email_valid(text) FROM PUBLIC;
-- CREATE OR REPLACE preserves prior owners and grants. No new serving-role grants.
COMMIT;
