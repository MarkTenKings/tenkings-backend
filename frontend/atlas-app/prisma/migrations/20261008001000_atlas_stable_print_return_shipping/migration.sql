-- Stable measured packaging for provider-native prepaid print-return labels.
-- No provider activation, table changes, historical quote/effect rewrites,
-- custody events, payment retries, or notification replays.
-- FedEx Ship REST RequestedShipment_1.shipDatestamp defaults a past date to
-- current date; only the explicit v2 native print-return policy relies on it.
BEGIN;
-- Templates never contain a shipment date. Each new quote freezes the local
-- rate date; payment and label effects retain those exact request bytes.
CREATE FUNCTION atlas_customer.commerce_shipping_request(plan jsonb,leg text,quoted_at timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN plan->>'version'='atlas-measured-print-return-plan-v2'
  THEN jsonb_set(plan->'legs'->leg,'{requestedShipment,shipDatestamp}',
   to_jsonb(to_char(quoted_at AT TIME ZONE (plan->'legs'->leg->>'shipDateTimeZone'),'YYYY-MM-DD')))
  ELSE plan->'legs'->leg END
$$;
REVOKE ALL ON FUNCTION atlas_customer.commerce_shipping_request(jsonb,text,timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION atlas_customer.commerce_shipping_plan_valid(plan jsonb,n integer,charged_legs text) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE leg text; dimension text; request jsonb; shipment jsonb; package jsonb; party jsonb; stamp date; zone text; starts timestamptz; ends timestamptz; stable boolean:=plan->>'version'='atlas-measured-print-return-plan-v2';
BEGIN
 IF NOT COALESCE(plan->>'version' IN ('atlas-measured-shipping-plan-v1','atlas-measured-print-return-plan-v2') AND jsonb_typeof(plan->'cardCount')='number'
  AND (plan->>'cardCount')::numeric=n AND n BETWEEN 1 AND 100
  AND plan->>'packingPresetId' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'
  AND plan->>'shippingServiceCode' ~ '^[A-Z][A-Z0-9_]{0,79}$'
  AND length(btrim(plan->>'measurementReference')) BETWEEN 1 AND 240 AND plan->>'measurementReference' !~ '[[:cntrl:]]'
  AND plan->>'validFrom' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
  AND (CASE WHEN stable THEN NOT plan ? 'validUntil' ELSE plan->>'validUntil' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' END)
  AND charged_legs IN ('INBOUND_ONLY','BOTH_LEGS'),false) THEN RETURN false; END IF;
 starts:=(plan->>'validFrom')::timestamptz;
 IF to_char(starts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>plan->>'validFrom' OR starts>statement_timestamp() THEN RETURN false; END IF;
 IF NOT stable THEN
  ends:=(plan->>'validUntil')::timestamptz;
  IF to_char(ends AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>plan->>'validUntil'
   OR ends<=statement_timestamp() OR ends<=starts OR ends-starts>interval '24 hours' THEN RETURN false; END IF;
 END IF;
 FOREACH leg IN ARRAY (CASE WHEN charged_legs='BOTH_LEGS' THEN ARRAY['INBOUND','RETURN'] ELSE ARRAY['INBOUND'] END) LOOP
  request:=plan->'legs'->leg; shipment:=request->'requestedShipment'; zone:=request->>'shipDateTimeZone';
  IF stable THEN
   IF NOT COALESCE(request->>'labelDatePolicy'='FEDEX_PRINT_RETURN_CREATION_DATE_V1' AND NOT shipment ? 'shipDatestamp'
    AND shipment->'shipmentSpecialServices'->'specialServiceTypes'='["RETURN_SHIPMENT"]'::jsonb
    AND shipment->'shipmentSpecialServices'->'returnShipmentDetail'->>'returnType'='PRINT_RETURN_LABEL',false) THEN RETURN false; END IF;
   shipment:=atlas_customer.commerce_shipping_request(plan,leg,statement_timestamp())->'requestedShipment';
  ELSIF request ? 'labelDatePolicy' THEN RETURN false;
  END IF;
  IF NOT COALESCE(zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+$' AND EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone)
   AND shipment->>'shipDatestamp' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   AND shipment->>'serviceType'=plan->>'shippingServiceCode' AND length(shipment->>'pickupType')>0 AND length(shipment->>'packagingType')>0
   AND shipment->'totalPackageCount'='1'::jsonb AND (leg='RETURN' OR jsonb_array_length(shipment->'recipients')=1)
   AND jsonb_array_length(shipment->'requestedPackageLineItems')=1
   AND shipment->'shippingChargesPayment'->>'paymentType' IN ('SENDER','RECIPIENT','THIRD_PARTY'),false) THEN RETURN false; END IF;
  stamp:=(shipment->>'shipDatestamp')::date;
  IF to_char(stamp,'YYYY-MM-DD')<>shipment->>'shipDatestamp' OR stamp<(statement_timestamp() AT TIME ZONE zone)::date THEN RETURN false; END IF;
  party:=CASE WHEN leg='INBOUND' THEN shipment->'recipients'->0 ELSE shipment->'shipper' END;
   IF NOT COALESCE(party->'address'->>'countryCode'='US' AND jsonb_array_length(party->'address'->'streetLines')>0
    AND length(party->'address'->>'city')>0 AND length(party->'address'->>'stateOrProvinceCode')>0 AND length(party->'address'->>'postalCode')>0
    AND length(party->'contact'->>'personName')>0 AND length(party->'contact'->>'phoneNumber')>0,false) THEN RETURN false; END IF;
  package:=shipment->'requestedPackageLineItems'->0;
  IF NOT COALESCE(package->'weight'->>'units' IN ('LB','KG') AND jsonb_typeof(package->'weight'->'value')='number' AND (package->'weight'->>'value')::numeric>0
   AND package->'dimensions'->>'units' IN ('IN','CM'),false) THEN RETURN false; END IF;
  FOREACH dimension IN ARRAY ARRAY['length','width','height'] LOOP
   IF NOT COALESCE(jsonb_typeof(package->'dimensions'->dimension)='number' AND (package->'dimensions'->>dimension)::numeric>0
    AND (package->'dimensions'->>dimension)::numeric=trunc((package->'dimensions'->>dimension)::numeric),false) THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION atlas_customer.commerce_shipping_plan_valid(jsonb,integer,text) FROM PUBLIC;

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
    OR (shipping_plan->>'version'='atlas-measured-shipping-plan-v1' AND (quote->>'expiresAt')::timestamptz>(shipping_plan->>'validUntil')::timestamptz) THEN RETURN atlas_customer.problem(409,'SHIPPING_PLAN_INVALID'); END IF;
   IF shipping_plan->>'version'='atlas-measured-print-return-plan-v2' AND (
    NOT COALESCE(quote->>'createdAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$',false)
    OR to_char((quote->>'createdAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>quote->>'createdAt'
    OR (quote->>'createdAt')::timestamptz<clock_timestamp()-interval '15 minutes'
    OR (quote->>'createdAt')::timestamptz>clock_timestamp()+interval '1 minute'
    OR (quote->>'expiresAt')::timestamptz>(quote->>'createdAt')::timestamptz+interval '15 minutes'
   ) THEN RETURN atlas_customer.problem(409,'SHIPPING_PLAN_INVALID'); END IF;
   customer_party:=jsonb_build_object('contact',jsonb_build_object('personName',source->'profile'->>'name','phoneNumber',source->>'phone'),
    'address',jsonb_build_object('streetLines',CASE WHEN COALESCE(source->'profile'->>'address2','')<>'' THEN jsonb_build_array(source->'profile'->>'address1',source->'profile'->>'address2') ELSE jsonb_build_array(source->'profile'->>'address1') END,
    'city',source->'profile'->>'city','stateOrProvinceCode',source->'profile'->>'region','postalCode',source->'profile'->>'postalCode','countryCode',source->'profile'->>'country'));
   FOR line IN SELECT value FROM jsonb_array_elements(quote->'shipping') LOOP
    shipment_request:=atlas_customer.commerce_shipping_request(shipping_plan,line->>'leg',(quote->>'createdAt')::timestamptz);
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
REVOKE ALL ON FUNCTION atlas_customer.commerce_provider_call(text,jsonb,jsonb) FROM PUBLIC;

-- Existing staff authority can read only the saved return PDF; no label dispatch.
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
 IF action='return_label' THEN
  IF (d-ARRAY['orderId'])<>'{}'::jsonb OR NOT COALESCE(d->>'orderId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false)
   THEN RETURN atlas_customer.problem(400,'INVALID_DEALER_OPERATION'); END IF;
  RETURN COALESCE((SELECT jsonb_build_object('orderId',o.id,'leg','RETURN','mimeType',e.result->>'mimeType',
    'labelBase64',e.result->>'labelBase64','labelSha256',e.result->>'labelSha256')
   FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommercePayment" p ON p.id=o."paymentId" AND p.state='PAID'
   JOIN atlas_customer."CommerceEffect" e ON e."orderId"=o.id AND e.id=o.id::text||':fedex:RETURN:v1'
   WHERE o.id=(d->>'orderId')::uuid AND o.receipt->>'channel'='MAIL_IN' AND e.kind='FEDEX_LABEL'
    AND e.request->>'leg'='RETURN' AND e.request->>'orderId'=o.id::text AND e.state='SUCCEEDED'
    AND e.result->>'provider'='FEDEX' AND e.result->>'requestHash'=atlas_customer.commerce_hash(e.request->'shipment') AND e.result->>'mimeType'='application/pdf'
    AND length(e.result->>'labelBase64') BETWEEN 8 AND 5592408 AND e.result->>'labelSha256' ~ '^[a-f0-9]{64}$'),
   atlas_customer.problem(409,'LABEL_NOT_READY'));
 END IF;
 IF action='read' THEN
  RETURN jsonb_build_object('locations',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.name,l.id) FROM (SELECT * FROM atlas_dealer.location ORDER BY name,id LIMIT 1000) l),'[]'::jsonb),
   'memberships',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'accountId',account_id,'locationId',location_id,'version',version,'revokedAt',revoked_at) ORDER BY location_id,account_id) FROM atlas_dealer.membership),'[]'::jsonb),
   'orders',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'reference',o.reference,'paidAt',o."paidAt",'returnShipping',
    (SELECT jsonb_build_object('state',e.state) FROM atlas_customer."CommerceEffect" e
     WHERE e."orderId"=o.id AND e.id=o.id::text||':fedex:RETURN:v1' AND e.kind='FEDEX_LABEL' AND e.request->>'leg'='RETURN'
      AND o.receipt->>'channel'='MAIL_IN' AND EXISTS(SELECT 1 FROM atlas_customer."CommercePayment" p WHERE p.id=o."paymentId" AND p.state='PAID')), 'cards',
    (SELECT jsonb_agg(atlas_dealer.card_tracking(c.card_id)||jsonb_build_object('orderId',c.order_id,'locationId',c.location_id,'manualCardId',l.manual_card_id,'custodyEvents',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'requestId',e.request_id,'kind',e.kind,'occurredAt',e.occurred_at,'evidence',e.evidence,'actorId',e.actor_id) ORDER BY e.sequence) FROM atlas_dealer.custody_event e WHERE e.card_id=c.card_id),'[]'::jsonb)) ORDER BY c.card_id)
     FROM atlas_dealer.order_card c LEFT JOIN atlas_dealer.manual_card_link l ON l.card_id=c.card_id WHERE c.order_id=o.id)) ORDER BY o."paidAt" DESC)
    FROM(SELECT id,reference,"paidAt",receipt,"paymentId" FROM atlas_customer."CommerceOrder" ORDER BY "paidAt" DESC,id LIMIT 100)o),'[]'::jsonb),
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
