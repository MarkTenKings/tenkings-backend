-- Separate explicit shipping purchase after the grading fee. No activation or provider effects.
BEGIN;
CREATE TABLE atlas_customer."CommerceShippingQuote" (
 id uuid PRIMARY KEY, "orderId" uuid NOT NULL REFERENCES atlas_customer."CommerceOrder"(id),
 "accountId" uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
 "contentHash" varchar(64) NOT NULL CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'), "expiresAt" timestamptz NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE atlas_customer."CommerceShippingPayment" (
 id uuid PRIMARY KEY, "orderId" uuid NOT NULL REFERENCES atlas_customer."CommerceOrder"(id),
 "accountId" uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
 "quoteId" uuid NOT NULL REFERENCES atlas_customer."CommerceShippingQuote"(id), "requestId" uuid NOT NULL,
 merchant jsonb NOT NULL, "providerId" text UNIQUE,
 state text NOT NULL CHECK(state IN ('DISPATCHED','UNKNOWN','AWAITING_PAYMENT','PROCESSING','PAID','CANCELED')),
 observation jsonb, "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(), "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("accountId","requestId")
);
CREATE UNIQUE INDEX "CommerceShippingPayment_order_active" ON atlas_customer."CommerceShippingPayment"("orderId") WHERE state<>'CANCELED';
CREATE TABLE atlas_customer."CommerceShippingReceipt" (
 id uuid PRIMARY KEY, "orderId" uuid NOT NULL UNIQUE REFERENCES atlas_customer."CommerceOrder"(id),
 "paymentId" uuid NOT NULL UNIQUE REFERENCES atlas_customer."CommerceShippingPayment"(id),
 "quoteId" uuid NOT NULL UNIQUE REFERENCES atlas_customer."CommerceShippingQuote"(id),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'), "paidAt" timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE atlas_customer."CommerceShippingProviderEvent" (
 provider text NOT NULL, merchant text NOT NULL, "eventId" text NOT NULL,
 "bodyHash" varchar(64) NOT NULL CHECK("bodyHash" ~ '^[a-f0-9]{64}$'),
 "paymentId" uuid NOT NULL REFERENCES atlas_customer."CommerceShippingPayment"(id),
 "receivedAt" timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(provider,merchant,"eventId")
);
CREATE FUNCTION atlas_customer.commerce_shipping_payment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','providerId','observation','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','providerId','observation','updatedAt'])
 OR (OLD."providerId" IS NOT NULL AND NEW."providerId" IS DISTINCT FROM OLD."providerId")
 OR (OLD.state IN ('PAID','CANCELED') AND NEW IS DISTINCT FROM OLD)
 THEN RAISE EXCEPTION 'ATLAS shipping payment identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CommerceShippingPayment_guard" BEFORE UPDATE OR DELETE ON atlas_customer."CommerceShippingPayment" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_shipping_payment_guard();
CREATE TRIGGER "CommerceShippingQuote_immutable" BEFORE UPDATE OR DELETE ON atlas_customer."CommerceShippingQuote" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();
CREATE TRIGGER "CommerceShippingReceipt_immutable" BEFORE UPDATE OR DELETE ON atlas_customer."CommerceShippingReceipt" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();
CREATE TRIGGER "CommerceShippingProviderEvent_immutable" BEFORE UPDATE OR DELETE ON atlas_customer."CommerceShippingProviderEvent" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();
CREATE TRIGGER "CommerceShippingQuote_no_truncate" BEFORE TRUNCATE ON atlas_customer."CommerceShippingQuote" FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.commerce_immutable();
REVOKE ALL ON atlas_customer."CommerceShippingQuote" FROM PUBLIC;
CREATE TRIGGER "CommerceShippingPayment_no_truncate" BEFORE TRUNCATE ON atlas_customer."CommerceShippingPayment" FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.commerce_immutable();
REVOKE ALL ON atlas_customer."CommerceShippingPayment" FROM PUBLIC;
CREATE TRIGGER "CommerceShippingReceipt_no_truncate" BEFORE TRUNCATE ON atlas_customer."CommerceShippingReceipt" FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.commerce_immutable();
REVOKE ALL ON atlas_customer."CommerceShippingReceipt" FROM PUBLIC;
CREATE TRIGGER "CommerceShippingProviderEvent_no_truncate" BEFORE TRUNCATE ON atlas_customer."CommerceShippingProviderEvent" FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.commerce_immutable();
REVOKE ALL ON atlas_customer."CommerceShippingProviderEvent" FROM PUBLIC;
ALTER TABLE atlas_customer."CommerceEffect" DROP CONSTRAINT "CommerceEffect_kind_check";
ALTER TABLE atlas_customer."CommerceEffect" ADD CONSTRAINT "CommerceEffect_kind_check" CHECK(kind IN ('EMAIL_RECEIPT','EMAIL_SHIPPING_RECEIPT','EMAIL_LABEL_READY','SMS_RECEIPT','FEDEX_LABEL','SHIPSTATION_LABEL','TAX_TRANSACTION','PACKAGE_LABEL'));
CREATE FUNCTION atlas_customer.commerce_label_ready_email() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE ord atlas_customer."CommerceOrder"; bytes bytea;
BEGIN
 IF NEW.state<>'SUCCEEDED' OR OLD.state='SUCCEEDED' OR NEW.kind NOT IN ('FEDEX_LABEL','SHIPSTATION_LABEL') OR NEW.request->>'leg' IS DISTINCT FROM 'INBOUND' THEN RETURN NEW; END IF;
 -- The outbox is created in the same commit as a confirmed, hash-checked PDF.
 IF NOT COALESCE(NEW.result->>'mimeType'='application/pdf' AND length(NEW.result->>'labelBase64') BETWEEN 8 AND 5592408
  AND NEW.result->>'labelBase64' ~ '^[A-Za-z0-9+/]+={0,2}$',false) THEN RETURN NEW; END IF;
 bytes:=decode(NEW.result->>'labelBase64','base64');
 IF octet_length(bytes)>4194304 OR substring(bytes FROM 1 FOR 5)<>convert_to('%PDF-','UTF8') OR encode(sha256(bytes),'hex') IS DISTINCT FROM NEW.result->>'labelSha256' THEN RETURN NEW; END IF;
 SELECT * INTO ord FROM atlas_customer."CommerceOrder" WHERE id=NEW."orderId";
 IF NOT atlas_customer.commerce_receipt_email_valid(ord.receipt->'profile'->>'email') THEN RETURN NEW; END IF;
 INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES
  (ord.id||':label-ready-email:v1',ord.id,'EMAIL_LABEL_READY',jsonb_build_object('orderId',ord.id,'reference',ord.reference,'to',ord.receipt->'profile'->>'email','labelEffectId',NEW.id,'labelSha256',NEW.result->>'labelSha256')) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER "CommerceEffect_label_ready_email" AFTER UPDATE ON atlas_customer."CommerceEffect" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_label_ready_email();
CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_quote(v jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT atlas_customer.commerce_public_fields(v,ARRAY['id','orderId','purpose','shippingStatus','draftId','draftRevision','channel','currency','subtotalCents','shippingCents','taxCents','totalCents','createdAt','expiresAt'])||jsonb_build_object(
 'inboundPackage',CASE WHEN v ? 'inboundPackage' THEN jsonb_build_object('weight',atlas_customer.commerce_public_fields(v->'inboundPackage'->'weight',ARRAY['unit','value']),'dimensions',atlas_customer.commerce_public_fields(v->'inboundPackage'->'dimensions',ARRAY['unit','length','width','height'])) ELSE NULL END,'cards',atlas_customer.commerce_public_cards(v->'cards'),'location',atlas_customer.commerce_public_location(v->'location'),
 'terms',atlas_customer.commerce_public_fields(v->'terms',ARRAY['days','clockStart','mailChargedLegs','paymentFlow','shippingPayment']),
 'shipping',atlas_customer.commerce_public_rows(v->'shipping',ARRAY['leg','amountCents','currency','expiresAt','provider','carrierName','serviceName']))
$$;
CREATE FUNCTION atlas_customer.commerce_shipping_public_state(oid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN o.receipt->'terms'->>'shippingPayment' IS DISTINCT FROM 'SEPARATE_PAYMENT' THEN NULL ELSE
 jsonb_build_object('state',CASE WHEN p.state='PAID' THEN 'PAID' WHEN p.state='DISPATCHED' THEN 'PROCESSING' ELSE COALESCE(p.state,'UNQUOTED_UNPAID') END,
 'labelReadyEmailEnabled',true,
 'activePayment',CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('attemptId',p.id,'state',p.state,'channel','MAIL_IN','paymentFlow','CUSTOMER_PHONE') ELSE NULL END,
 'receipt',CASE WHEN r.id IS NOT NULL THEN atlas_customer.commerce_public_quote(r.receipt) ELSE NULL END) END
 FROM atlas_customer."CommerceOrder" o LEFT JOIN atlas_customer."CommerceShippingPayment" p ON p."orderId"=o.id AND p.state<>'CANCELED'
 LEFT JOIN atlas_customer."CommerceShippingReceipt" r ON r."orderId"=o.id WHERE o.id=oid
$$;
CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_order(v jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN 'null'::jsonb ELSE
 atlas_customer.commerce_public_fields(v,ARRAY['id','reference','paidAt'])||jsonb_build_object('receipt',atlas_customer.commerce_public_quote(v->'receipt'),
 'shippingPayment',CASE WHEN jsonb_typeof(v->'shippingPayment')='object' THEN atlas_customer.commerce_public_fields(v->'shippingPayment',ARRAY['state','labelReadyEmailEnabled'])||jsonb_build_object('activePayment',atlas_customer.commerce_public_fields(v->'shippingPayment'->'activePayment',ARRAY['attemptId','state','channel','paymentFlow']),'receipt',CASE WHEN jsonb_typeof(v->'shippingPayment'->'receipt')='object' THEN atlas_customer.commerce_public_quote(v->'shippingPayment'->'receipt') ELSE NULL END) ELSE NULL END,
 'effects',COALESCE((SELECT jsonb_agg(atlas_customer.commerce_public_fields(value,ARRAY['id','kind','state','trackingNumber','deliveryStatus','artifactState','carrierName','serviceName']) ORDER BY ord)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v->'effects')='array' THEN v->'effects' ELSE '[]'::jsonb END) WITH ORDINALITY e(value,ord)
 WHERE value->>'kind' IN ('EMAIL_RECEIPT','EMAIL_SHIPPING_RECEIPT','EMAIL_LABEL_READY','SMS_RECEIPT','FEDEX_LABEL','SHIPSTATION_LABEL','PACKAGE_LABEL')),'[]'::jsonb)) END
$$;
CREATE OR REPLACE FUNCTION atlas_customer.commerce_call(action text, account_id uuid, d jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
DECLARE did uuid; draft atlas_customer."CustomerIntakeDraft"; ord atlas_customer."CommerceOrder";
BEGIN
 IF action='commerce_checkout' THEN
  did:=(d->>'draftId')::uuid;
  SELECT * INTO draft FROM atlas_customer."CustomerIntakeDraft" WHERE id=did AND "accountId"=account_id;
  IF draft.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  IF draft.state NOT IN ('REVIEW','ORDERED') THEN RETURN atlas_customer.problem(409,'CARD_REVIEW_REQUIRED'); END IF;
  RETURN atlas_customer.commerce_public_checkout(atlas_customer.commerce_source(did));
 ELSIF action IN ('commerce_order','commerce_label') THEN
  SELECT * INTO ord FROM atlas_customer."CommerceOrder" WHERE id=(d->>'orderId')::uuid AND "accountId"=account_id;
  IF ord.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  IF action='commerce_label' THEN
   RETURN COALESCE((SELECT jsonb_build_object('mimeType',e.result->>'mimeType','labelBase64',e.result->>'labelBase64','labelSha256',e.result->>'labelSha256','printed',false)
    FROM atlas_customer."CommerceEffect" e WHERE e.id=d->>'effectId' AND e."orderId"=ord.id AND e.kind IN ('FEDEX_LABEL','SHIPSTATION_LABEL','PACKAGE_LABEL') AND e.state='SUCCEEDED' AND e.result->>'labelBase64' IS NOT NULL),atlas_customer.problem(409,'LABEL_NOT_READY'));
  END IF;
  RETURN atlas_customer.commerce_public_order(jsonb_build_object('id',ord.id,'reference',ord.reference,'receipt',ord.receipt,'paidAt',ord."paidAt",'shippingPayment',atlas_customer.commerce_shipping_public_state(ord.id),'effects',
   COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'state',e.state,'trackingNumber',e.result->>'trackingNumber','carrierName',e.result->>'carrierName','serviceName',e.result->>'serviceName','deliveryStatus',COALESCE(e.tracking->>'description',e.result->>'deliveryStatus'),'artifactState',e.result->>'state'))
   FROM atlas_customer."CommerceEffect" e WHERE e."orderId"=ord.id),'[]'::jsonb)));
 ELSE RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
EXCEPTION WHEN invalid_text_representation THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST');
END $$;
CREATE OR REPLACE FUNCTION atlas_customer.commerce_payment_projection(pid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT to_jsonb(p)||jsonb_build_object('quote',q.snapshot,'order',(SELECT atlas_customer.commerce_call('commerce_order',o."accountId",jsonb_build_object('orderId',o.id)) FROM atlas_customer."CommerceOrder" o WHERE o."paymentId"=p.id))
 FROM atlas_customer."CommercePayment" p JOIN atlas_customer."CommerceQuote" q ON q.id=p."quoteId" WHERE p.id=pid
$$;
CREATE FUNCTION atlas_customer.commerce_shipping_payment_projection(pid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT to_jsonb(p)||jsonb_build_object('quote',q.snapshot,'order',CASE WHEN p.state='PAID' THEN atlas_customer.commerce_call('commerce_order',p."accountId",jsonb_build_object('orderId',p."orderId")) ELSE NULL END)
 FROM atlas_customer."CommerceShippingPayment" p JOIN atlas_customer."CommerceShippingQuote" q ON q.id=p."quoteId" WHERE p.id=pid
$$;
CREATE FUNCTION atlas_customer.commerce_shipping_source(oid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT q.snapshot||jsonb_build_object('revision',q."draftRevision",'cards',(SELECT jsonb_agg((line-'cardId')||jsonb_build_object('id',line->'cardId') ORDER BY ord) FROM jsonb_array_elements(q.snapshot->'cards') WITH ORDINALITY e(line,ord)),
 'shippingPlans',COALESCE((SELECT jsonb_agg(plan) FROM atlas_customer."CommerceControl" c CROSS JOIN LATERAL jsonb_array_elements(c."shippingPlans") plan WHERE c.id='active' AND atlas_customer.commerce_shipping_plan_valid(plan,jsonb_array_length(q.snapshot->'cards'),c.terms->>'mailChargedLegs')),'[]'::jsonb),
 'activePayment',(SELECT atlas_customer.commerce_shipping_payment_projection(id) FROM atlas_customer."CommerceShippingPayment" WHERE "orderId"=o.id AND state<>'CANCELED'),
 'order',atlas_customer.commerce_call('commerce_order',o."accountId",jsonb_build_object('orderId',o.id)))
 FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommerceQuote" q ON q.id=o."quoteId" WHERE o.id=oid
$$;
CREATE FUNCTION atlas_customer.commerce_shipping_call(action text,b jsonb,d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
<<shipping_call>>
DECLARE ctl atlas_customer."CommerceControl"; ord atlas_customer."CommerceOrder"; q atlas_customer."CommerceShippingQuote"; p atlas_customer."CommerceShippingPayment"; paid atlas_customer."CommerceShippingReceipt";
 source jsonb; quote jsonb; evidence jsonb; observation jsonb; checked jsonb; auth jsonb; shipping_plan jsonb; customer_party jsonb; shipment_request jsonb; line jsonb;
 oid uuid; aid uuid; pid uuid; n integer; shipping integer; taxes integer; total integer;
BEGIN
 SELECT * INTO ctl FROM atlas_customer."CommerceControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR ctl.binding IS DISTINCT FROM b THEN RETURN atlas_customer.problem(503,'COMMERCE_NOT_CONFIGURED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>12582912 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 IF action='commerce_provider_event' THEN
  evidence:=d->'event';pid:=(evidence->>'attemptId')::uuid;
  SELECT * INTO p FROM atlas_customer."CommerceShippingPayment" WHERE id=pid;
  IF p.id IS NULL OR p.merchant IS DISTINCT FROM ctl.merchant OR evidence->>'merchantId' IS DISTINCT FROM ctl.merchant->>'accountId'
   OR evidence->'livemode' IS DISTINCT FROM ctl.merchant->'livemode' OR COALESCE(evidence->>'eventId','')='' OR COALESCE(evidence->>'bodyHash','') !~ '^[a-f0-9]{64}$' THEN RETURN atlas_customer.problem(409,'PAYMENT_MERCHANT_MISMATCH'); END IF;
  IF EXISTS(SELECT 1 FROM atlas_customer."CommerceShippingProviderEvent" WHERE provider=ctl.merchant->>'provider' AND merchant=ctl.merchant->>'accountId' AND "eventId"=evidence->>'eventId' AND "bodyHash"<>evidence->>'bodyHash') THEN RETURN atlas_customer.problem(409,'PROVIDER_EVENT_CONFLICT'); END IF;
  INSERT INTO atlas_customer."CommerceShippingProviderEvent"(provider,merchant,"eventId","bodyHash","paymentId") VALUES(ctl.merchant->>'provider',ctl.merchant->>'accountId',evidence->>'eventId',evidence->>'bodyHash',pid) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('recorded',true);
 END IF;
 IF action IN ('commerce_callback_payment','commerce_callback_confirm') THEN SELECT "orderId" INTO oid FROM atlas_customer."CommerceShippingPayment" WHERE id=(d->>'attemptId')::uuid;
 ELSE oid:=(d->>'orderId')::uuid; END IF;
 SELECT * INTO ord FROM atlas_customer."CommerceOrder" WHERE id=oid;
 IF ord.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 aid:=ord."accountId";
 IF action NOT IN ('commerce_callback_payment','commerce_callback_confirm') THEN
  auth:=d->'authority';checked:=atlas_customer.customer_call('intake_read',auth->'binding',(auth-'binding')||jsonb_build_object('id',ord."draftId"));
  IF checked ? 'error' THEN RETURN checked; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-customer-intake:'||aid::text,0));
 SELECT * INTO ord FROM atlas_customer."CommerceOrder" WHERE id=oid FOR UPDATE;
 IF ord.receipt->'terms'->>'shippingPayment' IS DISTINCT FROM 'SEPARATE_PAYMENT' OR ord.receipt->>'channel'<>'MAIL_IN'
  OR NOT EXISTS(SELECT 1 FROM atlas_customer."CommercePayment" WHERE id=ord."paymentId" AND state='PAID') THEN RETURN atlas_customer.problem(409,'SHIPPING_PAYMENT_NOT_AVAILABLE'); END IF;
 source:=atlas_customer.commerce_shipping_source(oid);
 IF action='commerce_shipping_checkout' THEN RETURN source; END IF;
 IF action='commerce_shipping_save_quote' THEN
  quote:=d->'quote';n:=jsonb_array_length(source->'cards');
  IF EXISTS(SELECT 1 FROM atlas_customer."CommerceShippingPayment" WHERE "orderId"=oid AND state<>'CANCELED') THEN RETURN atlas_customer.problem(409,'SHIPPING_PAYMENT_ALREADY_STARTED'); END IF;
  IF NOT COALESCE(jsonb_typeof(quote)='object' AND quote->>'purpose'='SHIPPING' AND quote->>'orderId'=oid::text AND quote->>'channel'='MAIL_IN'
   AND quote->>'shippingStatus'='QUOTED_UNPAID' AND quote->>'draftId'=ord."draftId"::text AND quote->>'accountId'=aid::text
   AND quote->'draftRevision'=source->'draftRevision' AND quote->'profileRevision'=source->'profileRevision'
   AND quote->'profile'=source->'profile' AND quote->>'phone'=source->>'phone' AND quote->'location'='null'::jsonb
   AND quote->'cards'=ord.receipt->'cards' AND quote->'merchant'=ctl.merchant
   AND quote->>'currency'='usd' AND quote->'subtotalCents'='0'::jsonb AND quote->'terms'->>'shippingPayment'='SEPARATE_PAYMENT'
   AND quote->'terms'->>'paymentFlow'='CUSTOMER_PHONE' AND quote->>'contentHash'=atlas_customer.commerce_hash(quote-'contentHash'),false)
   THEN RETURN atlas_customer.problem(409,'SHIPPING_QUOTE_INVALID'); END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['subtotalCents','shippingCents','taxCents','totalCents']) k WHERE jsonb_typeof(quote->k) IS DISTINCT FROM 'number' OR (quote->>k)::numeric<>trunc((quote->>k)::numeric)) THEN RETURN atlas_customer.problem(409,'SHIPPING_QUOTE_INVALID'); END IF;
  shipping:=(quote->>'shippingCents')::integer;taxes:=(quote->>'taxCents')::integer;total:=(quote->>'totalCents')::integer;
  IF shipping<=0 OR taxes<0 OR total<>shipping+taxes OR quote->'tax'->>'providerId' IS NULL OR quote->'tax'->>'currency' IS DISTINCT FROM 'usd'
   OR (quote->'tax'->>'taxCents')::numeric IS DISTINCT FROM taxes::numeric OR (quote->'tax'->>'totalCents')::numeric IS DISTINCT FROM total::numeric
   OR quote->'tax'->>'requestHash' IS DISTINCT FROM atlas_customer.commerce_hash(jsonb_build_object('quoteId',quote->'id','currency','usd','profile',source->'profile','channel','MAIL_IN','location',NULL,'lines','[]'::jsonb,'subtotalCents',0,'shippingCents',shipping))
   OR (quote->>'expiresAt')::timestamptz<=clock_timestamp() OR (quote->>'expiresAt')::timestamptz>clock_timestamp()+interval '16 minutes'
   OR (quote->'tax'->>'expiresAt')::timestamptz<(quote->>'expiresAt')::timestamptz THEN RETURN atlas_customer.problem(409,'SHIPPING_QUOTE_INVALID'); END IF;
   shipping_plan:=quote->'shippingPlan';
   IF NOT atlas_customer.commerce_shipping_plan_valid(shipping_plan,n,ctl.terms->>'mailChargedLegs')
    OR (SELECT count(*) FROM jsonb_array_elements(source->'shippingPlans') configured WHERE configured=shipping_plan)<>1
    OR (shipping_plan->>'version'='atlas-measured-shipping-plan-v1' AND (quote->>'expiresAt')::timestamptz>(shipping_plan->>'validUntil')::timestamptz) THEN RETURN atlas_customer.problem(409,'SHIPPING_PLAN_INVALID'); END IF;
   IF shipping_plan->>'version' IN ('atlas-measured-print-return-plan-v2','atlas-measured-shipstation-plan-v1') AND (
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
    IF shipping_plan->>'version'='atlas-measured-shipstation-plan-v1' THEN
     shipment_request:=jsonb_set(shipment_request,ARRAY['shipment',CASE WHEN line->>'leg'='INBOUND' THEN 'ship_from' ELSE 'ship_to' END],atlas_customer.commerce_shipstation_customer(source->'profile',source->>'phone'));
     IF shipping_plan->>'inboundPackaging'='CUSTOMER_MEASURED' THEN
      IF NOT atlas_customer.commerce_shipstation_package_valid(quote->'inboundPackage') THEN RETURN atlas_customer.problem(409,'MEASURED_PACKAGE_REQUIRED'); END IF;
      IF line->>'leg'='INBOUND' THEN shipment_request:=jsonb_set(shipment_request,'{shipment,packages}',jsonb_build_array(quote->'inboundPackage'||jsonb_build_object('package_code','package'))); END IF;
     ELSIF quote ? 'inboundPackage' THEN RETURN atlas_customer.problem(409,'UNEXPECTED_PACKAGE_MEASUREMENTS'); END IF;
     IF line->>'provider' IS DISTINCT FROM 'SHIPSTATION' OR NOT atlas_customer.commerce_shipstation_rate_valid(line->'rate',shipment_request)
      OR line->'rate'->>'providerId' IS DISTINCT FROM line->>'providerId' OR line->'rate'->'amountCents' IS DISTINCT FROM line->'amountCents'
      OR line->'rate'->>'carrierName' IS DISTINCT FROM line->>'carrierName' OR line->'rate'->>'serviceName' IS DISTINCT FROM line->>'serviceName'
      OR line->'rate'->>'expiresAt' IS DISTINCT FROM line->>'expiresAt' OR (line->>'expiresAt')::timestamptz<(quote->>'expiresAt')::timestamptz
      THEN RETURN atlas_customer.problem(409,'SHIPPING_QUOTE_INVALID'); END IF;
    ELSE
     shipment_request:=CASE WHEN line->>'leg'='INBOUND' THEN jsonb_set(shipment_request,'{requestedShipment,shipper}',customer_party)
      ELSE jsonb_set(shipment_request,'{requestedShipment,recipients}',jsonb_build_array(customer_party)) END;
     IF line ? 'provider' AND line->>'provider'<>'FEDEX' THEN RETURN atlas_customer.problem(409,'SHIPPING_QUOTE_INVALID'); END IF;
    END IF;
    IF line->'request' IS DISTINCT FROM shipment_request THEN RETURN atlas_customer.problem(409,'SHIPPING_PLAN_INVALID'); END IF;
   END LOOP;
   IF ctl.terms->>'mailClockStart' IS DISTINCT FROM 'ATLAS_RECEIPT' OR COALESCE(ctl.terms->>'mailChargedLegs','') NOT IN ('INBOUND_ONLY','BOTH_LEGS')
    OR quote->'terms'->>'clockStart' IS DISTINCT FROM ctl.terms->>'mailClockStart' OR quote->'terms'->>'mailChargedLegs' IS DISTINCT FROM ctl.terms->>'mailChargedLegs'
    OR (quote->'terms'->>'days')::integer IS DISTINCT FROM 14 OR jsonb_array_length(quote->'shipping')<>(CASE WHEN ctl.terms->>'mailChargedLegs'='BOTH_LEGS' THEN 2 ELSE 1 END)
    OR shipping<>(SELECT sum((value->>'amountCents')::numeric) FROM jsonb_array_elements(quote->'shipping'))
    OR quote->'shipping'->0->>'leg' IS DISTINCT FROM 'INBOUND' OR (ctl.terms->>'mailChargedLegs'='BOTH_LEGS' AND quote->'shipping'->1->>'leg' IS DISTINCT FROM 'RETURN')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(quote->'shipping') rate WHERE rate->>'providerId' IS NULL OR rate->>'currency' IS DISTINCT FROM 'usd'
      OR (rate->>'amountCents')::numeric<0 OR (rate->>'amountCents')::numeric<>trunc((rate->>'amountCents')::numeric)
      OR rate->>'requestHash' IS DISTINCT FROM atlas_customer.commerce_hash(rate->'request')) THEN RETURN atlas_customer.problem(409,'MAIL_SHIPPING_TERMS_NOT_CONFIGURED'); END IF;

  INSERT INTO atlas_customer."CommerceShippingQuote"(id,"orderId","accountId","contentHash",snapshot,"expiresAt") VALUES((quote->>'id')::uuid,oid,aid,quote->>'contentHash',quote,(quote->>'expiresAt')::timestamptz) ON CONFLICT DO NOTHING;
  SELECT * INTO q FROM atlas_customer."CommerceShippingQuote" WHERE id=(quote->>'id')::uuid;
  IF q.snapshot IS DISTINCT FROM quote THEN RETURN atlas_customer.problem(409,'QUOTE_CONFLICT'); END IF;
  RETURN q.snapshot;
 END IF;
 IF action='commerce_shipping_reserve_payment' THEN
  SELECT * INTO p FROM atlas_customer."CommerceShippingPayment" WHERE "accountId"=aid AND "requestId"=(d->>'requestId')::uuid;
  IF p.id IS NOT NULL THEN
   IF p."orderId"<>oid OR p."quoteId"<>(d->>'quoteId')::uuid THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
   RETURN jsonb_build_object('attempt',atlas_customer.commerce_shipping_payment_projection(p.id),'dispatch',false);
  END IF;
  SELECT * INTO p FROM atlas_customer."CommerceShippingPayment" WHERE "orderId"=oid AND state<>'CANCELED';
  IF p.id IS NOT NULL THEN RETURN jsonb_build_object('attempt',atlas_customer.commerce_shipping_payment_projection(p.id),'dispatch',false); END IF;
  SELECT * INTO q FROM atlas_customer."CommerceShippingQuote" WHERE id=(d->>'quoteId')::uuid;
  IF q.id IS NULL OR q."orderId"<>oid OR q."accountId"<>aid OR q."expiresAt"<=clock_timestamp() OR q.snapshot->'merchant' IS DISTINCT FROM ctl.merchant OR d->'merchant' IS DISTINCT FROM ctl.merchant THEN RETURN atlas_customer.problem(409,'SHIPPING_QUOTE_EXPIRED'); END IF;
  INSERT INTO atlas_customer."CommerceShippingPayment"(id,"orderId","accountId","quoteId","requestId",merchant,state) VALUES((d->>'attemptId')::uuid,oid,aid,q.id,(d->>'requestId')::uuid,ctl.merchant,'DISPATCHED') RETURNING * INTO p;
  RETURN jsonb_build_object('attempt',atlas_customer.commerce_shipping_payment_projection(p.id),'dispatch',true);
 END IF;
 SELECT * INTO p FROM atlas_customer."CommerceShippingPayment" WHERE id=(d->>'attemptId')::uuid AND "orderId"=oid FOR UPDATE;
 IF p.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF p.merchant IS DISTINCT FROM ctl.merchant THEN RETURN atlas_customer.problem(409,'PAYMENT_MERCHANT_MISMATCH'); END IF;
 SELECT * INTO q FROM atlas_customer."CommerceShippingQuote" WHERE id=p."quoteId";
 IF action IN ('commerce_shipping_payment','commerce_callback_payment') THEN RETURN atlas_customer.commerce_shipping_payment_projection(p.id); END IF;
 IF action='commerce_shipping_record_payment' THEN
  observation:=d->'observation';
  IF COALESCE(observation->>'state','') NOT IN ('UNKNOWN','AWAITING_PAYMENT','PROCESSING','CANCELED') THEN RETURN atlas_customer.problem(400,'INVALID_PAYMENT_STATE'); END IF;
  IF p.state IN ('PAID','CANCELED') THEN RETURN atlas_customer.commerce_shipping_payment_projection(p.id); END IF;
  IF p."providerId" IS NOT NULL AND observation->>'providerId' IS NOT NULL AND p."providerId"<>observation->>'providerId' THEN RETURN atlas_customer.problem(409,'PAYMENT_ID_MISMATCH'); END IF;
  IF observation->>'state'='CANCELED' AND NOT COALESCE(observation->>'source'='PROVIDER_RETRIEVAL' AND observation->>'status'='canceled' AND observation->>'attemptId'=p.id::text AND observation->>'quoteHash'=q."contentHash"
   AND observation->>'provider'='STRIPE' AND observation->>'merchantId'=p.merchant->>'accountId' AND observation->'livemode'=p.merchant->'livemode' AND observation->'amountCents'=q.snapshot->'totalCents' AND observation->>'currency'='usd' AND length(observation->>'providerId')>0,false) THEN RETURN atlas_customer.problem(409,'PAYMENT_NOT_CONFIRMED'); END IF;
  UPDATE atlas_customer."CommerceShippingPayment" SET state=shipping_call.observation->>'state',"providerId"=COALESCE("providerId",shipping_call.observation->>'providerId'),observation=COALESCE(p.observation,'{}'::jsonb)||shipping_call.observation,"updatedAt"=clock_timestamp() WHERE id=p.id;
  RETURN atlas_customer.commerce_shipping_payment_projection(p.id);
 END IF;
 IF action IN ('commerce_shipping_confirm_paid','commerce_callback_confirm') THEN
  evidence:=d->'evidence';
  IF NOT COALESCE(evidence->>'source'='PROVIDER_RETRIEVAL' AND evidence->>'status'='succeeded' AND evidence->>'provider'=p.merchant->>'provider'
   AND evidence->>'merchantId'=p.merchant->>'accountId' AND evidence->'livemode'=p.merchant->'livemode' AND evidence->>'attemptId'=p.id::text
   AND evidence->>'quoteHash'=q."contentHash" AND evidence->'amountCents'=q.snapshot->'totalCents' AND evidence->'receivedCents'=q.snapshot->'totalCents'
   AND evidence->>'currency'='usd' AND length(evidence->>'providerId')>0 AND (p."providerId" IS NULL OR p."providerId"=evidence->>'providerId') AND evidence->'paymentMethodTypes' ? 'card',false)
   THEN RETURN atlas_customer.problem(409,'PAYMENT_BINDING_MISMATCH'); END IF;
  SELECT * INTO paid FROM atlas_customer."CommerceShippingReceipt" WHERE "orderId"=oid;
  IF paid.id IS NOT NULL THEN RETURN jsonb_build_object('order',atlas_customer.commerce_call('commerce_order',aid,jsonb_build_object('orderId',oid))); END IF;
  UPDATE atlas_customer."CommerceShippingPayment" SET state='PAID',"providerId"=evidence->>'providerId',observation=evidence-'clientSecret',"updatedAt"=clock_timestamp() WHERE id=p.id;
  INSERT INTO atlas_customer."CommerceShippingReceipt"(id,"orderId","paymentId","quoteId",receipt) VALUES((d->>'receiptId')::uuid,oid,p.id,q.id,(q.snapshot-ARRAY['merchant','phone'])||jsonb_build_object('shippingStatus','PAID','payment',evidence-'clientSecret')) RETURNING * INTO paid;
  INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES
   (oid||':shipping-email:v1',oid,'EMAIL_SHIPPING_RECEIPT',jsonb_build_object('orderId',oid,'reference',ord.reference,'to',q.snapshot->'profile'->>'email','currency','usd','totalCents',q.snapshot->'totalCents','quoteHash',q."contentHash")),
   (oid||':shipping-tax:v1',oid,'TAX_TRANSACTION',jsonb_build_object('orderId',paid.id,'calculationId',q.snapshot->'tax'->>'providerId'));
  FOR line IN SELECT value FROM jsonb_array_elements(q.snapshot->'shipping') LOOP
   INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES(oid||CASE WHEN line->>'provider'='SHIPSTATION' THEN ':shipstation:' ELSE ':fedex:' END||(line->>'leg')||':v1',oid,
    CASE WHEN line->>'provider'='SHIPSTATION' THEN 'SHIPSTATION_LABEL' ELSE 'FEDEX_LABEL' END,
    jsonb_build_object('orderId',oid,'shipment',line->'request','leg',line->>'leg','rateId',line->>'providerId')||CASE WHEN line->>'provider'='SHIPSTATION' THEN jsonb_build_object('rate',line->'rate') ELSE '{}'::jsonb END);
  END LOOP;
  RETURN jsonb_build_object('order',atlas_customer.commerce_call('commerce_order',aid,jsonb_build_object('orderId',oid)));
 END IF;
 RETURN atlas_customer.problem(404,'NOT_FOUND');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR not_null_violation OR check_violation THEN RETURN atlas_customer.problem(400,'INVALID_COMMERCE_REQUEST');
END $$;
CREATE OR REPLACE FUNCTION atlas_customer.commerce_provider_call(action text,b jsonb,d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
<<provider_call>>
DECLARE ctl atlas_customer."CommerceControl"; draft atlas_customer."CustomerIntakeDraft"; q atlas_customer."CommerceQuote";
 p atlas_customer."CommercePayment"; ord atlas_customer."CommerceOrder"; ef atlas_customer."CommerceEffect";
 auth jsonb; checked jsonb; source jsonb; quote jsonb; observation jsonb; evidence jsonb; line jsonb; card jsonb; effect jsonb;
 shipping_plan jsonb; shipment_request jsonb; customer_party jsonb; dispatch jsonb; stamp timestamptz;
 did uuid; aid uuid; pid uuid; oid uuid; rid text; n integer; unit integer; shipping integer; taxes integer; total integer; idx integer;
BEGIN
 SELECT * INTO ctl FROM atlas_customer."CommerceControl" WHERE id='active';
 IF ctl.id IS NULL OR NOT ctl.enabled OR ctl.binding IS DISTINCT FROM b THEN RETURN atlas_customer.problem(503,'COMMERCE_NOT_CONFIGURED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>12582912 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 IF action LIKE 'commerce_shipping_%' OR (action IN ('commerce_callback_payment','commerce_callback_confirm') AND EXISTS(SELECT 1 FROM atlas_customer."CommerceShippingPayment" WHERE id=(d->>'attemptId')::uuid)) OR (action='commerce_provider_event' AND EXISTS(SELECT 1 FROM atlas_customer."CommerceShippingPayment" WHERE id=(d->'event'->>'attemptId')::uuid)) THEN RETURN atlas_customer.commerce_shipping_call(action,b,d); END IF;
 IF action='commerce_pending_effects' THEN
  UPDATE atlas_customer."CommerceEffect" SET state='UNKNOWN',"updatedAt"=clock_timestamp(),result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('code','EFFECT_RECONCILIATION_REQUIRED')
   WHERE state='DISPATCHED' AND kind<>'SMS_RECEIPT' AND "updatedAt"<clock_timestamp()-interval '5 minutes';
  RETURN jsonb_build_object('effects',COALESCE((SELECT jsonb_agg(id) FROM (SELECT id FROM atlas_customer."CommerceEffect" WHERE state='PENDING' AND kind<>'SMS_RECEIPT' AND (kind<>'SHIPSTATION_LABEL' OR request->>'leg'<>'RETURN' OR fulfillment IS NOT NULL) ORDER BY "createdAt",id LIMIT 20) ready),'[]'::jsonb));
 END IF;
 IF action='commerce_trackable_effects' THEN
  WITH ready AS (SELECT id FROM atlas_customer."CommerceEffect" WHERE kind='SHIPSTATION_LABEL' AND state='SUCCEEDED'
   AND COALESCE(tracking->>'statusCode','')<>'DE' AND (tracking->>'pollAfter' IS NULL OR (tracking->>'pollAfter')::timestamptz<=clock_timestamp())
   ORDER BY "createdAt",id FOR UPDATE SKIP LOCKED LIMIT 5), marked AS (
   UPDATE atlas_customer."CommerceEffect" e SET tracking=COALESCE(e.tracking,'{}'::jsonb)||jsonb_build_object('pollAfter',clock_timestamp()+interval '6 hours')
   FROM ready WHERE e.id=ready.id RETURNING e.id)
  SELECT jsonb_build_object('effects',COALESCE(jsonb_agg(id),'[]'::jsonb)) INTO checked FROM marked;
  RETURN checked;
 END IF;
 IF action='commerce_reconcilable_effects' THEN
  -- Poll a known asynchronous job at most five times with durable backoff.
  -- No shipment create request is repeated, even if this worker crashes.
  WITH ready AS (SELECT id FROM atlas_customer."CommerceEffect" WHERE state='UNKNOWN' AND ((kind='FEDEX_LABEL' AND result->>'jobId' IS NOT NULL) OR (kind='SHIPSTATION_LABEL' AND "dispatchSnapshot" IS NOT NULL)) AND "reconcileCount"<5 AND ("reconcileAfter" IS NULL OR "reconcileAfter"<=clock_timestamp())
   ORDER BY "createdAt",id FOR UPDATE SKIP LOCKED LIMIT 5), marked AS (
   UPDATE atlas_customer."CommerceEffect" e SET "reconcileAfter"=clock_timestamp()+make_interval(secs=>60*power(2,e."reconcileCount")::integer),"reconcileCount"=e."reconcileCount"+1
   FROM ready WHERE e.id=ready.id RETURNING e.id)
  SELECT jsonb_build_object('effects',COALESCE(jsonb_agg(id),'[]'::jsonb)) INTO checked FROM marked;
  RETURN checked;
 END IF;
 IF action IN ('commerce_effect','commerce_claim_effect','commerce_finish_effect','commerce_record_tracking') THEN
  SELECT * INTO ef FROM atlas_customer."CommerceEffect" WHERE id=d->>'effectId' FOR UPDATE;
  IF ef.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  IF action='commerce_effect' THEN RETURN to_jsonb(ef); END IF;
  IF action='commerce_record_tracking' THEN
   IF ef.kind<>'SHIPSTATION_LABEL' OR ef.state<>'SUCCEEDED' OR NOT COALESCE(
    d->'tracking'->>'provider'='SHIPSTATION' AND d->'tracking'->>'providerId'=ef.result->>'providerId'
    AND d->'tracking'->>'trackingNumber'=ef.result->>'trackingNumber'
    AND d->'tracking'->>'statusCode' IN ('UN','AC','IT','DE','EX','AT','NY')
    AND (d->'tracking')-ARRAY['provider','providerId','trackingNumber','statusCode','description','observedAt']='{}'::jsonb,false)
    THEN RETURN atlas_customer.problem(409,'SHIPPING_TRACKING_INVALID'); END IF;
   UPDATE atlas_customer."CommerceEffect" SET tracking=COALESCE(ef.tracking,'{}'::jsonb)||(d->'tracking')||jsonb_build_object('observedAt',clock_timestamp()) WHERE id=ef.id RETURNING * INTO ef;
   RETURN to_jsonb(ef);
  END IF;
  IF action='commerce_claim_effect' THEN
   IF ef.state<>'PENDING' THEN RETURN jsonb_build_object('effect',to_jsonb(ef),'dispatch',false); END IF;
   IF ef.kind='SMS_RECEIPT' THEN RETURN jsonb_build_object('effect',to_jsonb(ef),'dispatch',false,'blockedReason','SMS_NOTIFICATIONS_DISABLED'); END IF;
   IF ef.kind='SHIPSTATION_LABEL' THEN
    IF ef.request->>'leg'='RETURN' AND ef.fulfillment IS NULL THEN RETURN atlas_customer.problem(409,'RETURN_LABEL_NOT_PREPARED'); END IF;
    dispatch:=d->'dispatchSnapshot';
    IF NOT COALESCE(dispatch-ARRAY['shipment','rate','preparedAt','originalRequestHash']='{}'::jsonb
     AND dispatch->>'originalRequestHash'=atlas_customer.commerce_hash(ef.request->'shipment')
     AND dispatch->>'preparedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$',false) THEN RETURN atlas_customer.problem(409,'SHIPPING_DISPATCH_INVALID'); END IF;
    stamp:=(dispatch->>'preparedAt')::timestamptz;
    shipment_request:=jsonb_set(ef.request->'shipment','{shipment,ship_date}',to_jsonb(to_char(stamp AT TIME ZONE (ef.request->'shipment'->>'shipDateTimeZone'),'YYYY-MM-DD')));
    IF dispatch->'shipment' IS DISTINCT FROM shipment_request OR stamp<clock_timestamp()-interval '15 minutes' OR stamp>clock_timestamp()+interval '1 minute'
     OR NOT atlas_customer.commerce_shipstation_rate_valid(dispatch->'rate',shipment_request)
     OR (dispatch->'rate'->>'expiresAt')::timestamptz<=clock_timestamp()
     OR (dispatch->'rate'->>'expiresAt')::timestamptz>stamp+interval '15 minutes'
     THEN RETURN atlas_customer.problem(409,'SHIPPING_DISPATCH_INVALID'); END IF;
   ELSE dispatch:=NULL;
   END IF;
   UPDATE atlas_customer."CommerceEffect" SET "dispatchSnapshot"=dispatch,state='DISPATCHED',"claimId"=(d->>'claimId')::uuid,"updatedAt"=clock_timestamp() WHERE id=ef.id RETURNING * INTO ef;
   RETURN jsonb_build_object('effect',to_jsonb(ef),'dispatch',true);
  END IF;
  IF ef."claimId" IS DISTINCT FROM (d->>'claimId')::uuid OR COALESCE(d->>'state','') NOT IN ('UNKNOWN','SUCCEEDED','FAILED') THEN RETURN atlas_customer.problem(409,'EFFECT_CLAIM_CONFLICT'); END IF;
  IF ef.state='SUCCEEDED' THEN
   IF ef.result IS DISTINCT FROM d->'result' THEN RETURN atlas_customer.problem(409,'EFFECT_RESULT_CONFLICT'); END IF;
   RETURN to_jsonb(ef);
  END IF;
  IF d->>'state'='SUCCEEDED' AND ef.kind='FEDEX_LABEL' AND (COALESCE(d->'result'->>'trackingNumber','')='' OR COALESCE(d->'result'->>'labelBase64','')='') THEN RETURN atlas_customer.problem(409,'FEDEX_LABEL_MISSING'); END IF;
  IF d->>'state'='SUCCEEDED' AND ef.kind='SHIPSTATION_LABEL' AND NOT COALESCE(
   d->'result'->>'provider'='SHIPSTATION' AND d->'result'->>'providerId' ~ '^se(-[a-z0-9]+)+$'
   AND d->'result'->>'requestHash'=atlas_customer.commerce_hash(ef.request->'shipment')
   AND d->'result'->>'dispatchRequestHash'=atlas_customer.commerce_hash(ef."dispatchSnapshot"->'shipment')
   AND d->'result'->>'carrierId'=ef."dispatchSnapshot"->'shipment'->'shipment'->>'carrier_id'
   AND d->'result'->>'serviceCode'=ef."dispatchSnapshot"->'shipment'->'shipment'->>'service_code'
   AND d->'result'->>'purchasedRateId'=ef."dispatchSnapshot"->'rate'->>'providerId'
   AND d->'result'->>'shipmentId'=ef."dispatchSnapshot"->'rate'->>'shipmentId'
   AND d->'result'->>'carrierName'=ef."dispatchSnapshot"->'rate'->>'carrierName'
   AND d->'result'->>'serviceName'=ef."dispatchSnapshot"->'rate'->>'serviceName'
   AND d->'result'->>'currency'='usd'
   AND d->'result'->>'externalShipmentId'='atlas-'||substr(encode(sha256(convert_to(ef.id,'UTF8')),'hex'),1,44)
   AND length(d->'result'->>'trackingNumber') BETWEEN 1 AND 200 AND d->'result'->>'mimeType'='application/pdf'
   AND length(d->'result'->>'labelBase64') BETWEEN 8 AND 5592408
   AND d->'result'->>'labelBase64' ~ '^[A-Za-z0-9+/]+={0,2}$'
   AND octet_length(decode(d->'result'->>'labelBase64','base64'))<=4194304
   AND substring(decode(d->'result'->>'labelBase64','base64') FROM 1 FOR 5)=convert_to('%PDF-','UTF8')
   AND encode(sha256(decode(d->'result'->>'labelBase64','base64')),'hex')=d->'result'->>'labelSha256'
   AND jsonb_typeof(d->'result'->'purchasedAmountCents')='number' AND (d->'result'->>'purchasedAmountCents')::numeric>=0
   AND (d->'result'->>'purchasedAmountCents')::numeric=trunc((d->'result'->>'purchasedAmountCents')::numeric),false)
   THEN RETURN atlas_customer.problem(409,'SHIPSTATION_LABEL_INVALID'); END IF;
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
   IF shipping<>0 OR quote->'shipping'<>'[]'::jsonb OR quote->'shippingPlan' IS DISTINCT FROM 'null'::jsonb OR quote->'terms'->>'clockStart'<>'ATLAS_COLLECTION' OR (quote->'terms'->>'days')::integer IS DISTINCT FROM 7 THEN RETURN atlas_customer.problem(409,'KIOSK_SHIPPING_FORBIDDEN'); END IF;
  ELSIF ctl.terms->>'shippingPayment'='SEPARATE_PAYMENT' THEN
   IF shipping<>0 OR quote->'shipping' IS DISTINCT FROM '[]'::jsonb OR quote->'shippingPlan' IS DISTINCT FROM 'null'::jsonb OR quote ? 'inboundPackage'
    OR quote->'terms'->>'shippingPayment' IS DISTINCT FROM 'SEPARATE_PAYMENT' OR quote->>'shippingStatus' IS DISTINCT FROM 'UNQUOTED_UNPAID'
    OR quote->'terms'->'mailChargedLegs' IS DISTINCT FROM 'null'::jsonb OR quote->'terms'->>'clockStart' IS DISTINCT FROM 'ATLAS_RECEIPT'
    OR ctl.terms->>'mailClockStart' IS DISTINCT FROM 'ATLAS_RECEIPT' OR (quote->'terms'->>'days')::integer IS DISTINCT FROM 14 THEN RETURN atlas_customer.problem(409,'MAIL_SHIPPING_TERMS_NOT_CONFIGURED'); END IF;
  ELSE
   IF quote->'terms' ? 'shippingPayment' OR quote ? 'shippingStatus' THEN RETURN atlas_customer.problem(409,'MAIL_SHIPPING_TERMS_NOT_CONFIGURED'); END IF;
   shipping_plan:=quote->'shippingPlan';
   IF NOT atlas_customer.commerce_shipping_plan_valid(shipping_plan,n,ctl.terms->>'mailChargedLegs')
    OR (SELECT count(*) FROM jsonb_array_elements(source->'shippingPlans') configured WHERE configured=shipping_plan)<>1
    OR (shipping_plan->>'version'='atlas-measured-shipping-plan-v1' AND (quote->>'expiresAt')::timestamptz>(shipping_plan->>'validUntil')::timestamptz) THEN RETURN atlas_customer.problem(409,'SHIPPING_PLAN_INVALID'); END IF;
   IF shipping_plan->>'version' IN ('atlas-measured-print-return-plan-v2','atlas-measured-shipstation-plan-v1') AND (
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
    IF shipping_plan->>'version'='atlas-measured-shipstation-plan-v1' THEN
     shipment_request:=jsonb_set(shipment_request,ARRAY['shipment',CASE WHEN line->>'leg'='INBOUND' THEN 'ship_from' ELSE 'ship_to' END],atlas_customer.commerce_shipstation_customer(source->'profile',source->>'phone'));
     IF shipping_plan->>'inboundPackaging'='CUSTOMER_MEASURED' THEN
      IF NOT atlas_customer.commerce_shipstation_package_valid(quote->'inboundPackage') THEN RETURN atlas_customer.problem(409,'MEASURED_PACKAGE_REQUIRED'); END IF;
      IF line->>'leg'='INBOUND' THEN shipment_request:=jsonb_set(shipment_request,'{shipment,packages}',jsonb_build_array(quote->'inboundPackage'||jsonb_build_object('package_code','package'))); END IF;
     ELSIF quote ? 'inboundPackage' THEN RETURN atlas_customer.problem(409,'UNEXPECTED_PACKAGE_MEASUREMENTS'); END IF;
     IF line->>'provider' IS DISTINCT FROM 'SHIPSTATION' OR NOT atlas_customer.commerce_shipstation_rate_valid(line->'rate',shipment_request)
      OR line->'rate'->>'providerId' IS DISTINCT FROM line->>'providerId' OR line->'rate'->'amountCents' IS DISTINCT FROM line->'amountCents'
      OR line->'rate'->>'carrierName' IS DISTINCT FROM line->>'carrierName' OR line->'rate'->>'serviceName' IS DISTINCT FROM line->>'serviceName'
      OR line->'rate'->>'expiresAt' IS DISTINCT FROM line->>'expiresAt' OR (line->>'expiresAt')::timestamptz<(quote->>'expiresAt')::timestamptz
      THEN RETURN atlas_customer.problem(409,'SHIPPING_QUOTE_INVALID'); END IF;
    ELSE
     shipment_request:=CASE WHEN line->>'leg'='INBOUND' THEN jsonb_set(shipment_request,'{requestedShipment,shipper}',customer_party)
      ELSE jsonb_set(shipment_request,'{requestedShipment,recipients}',jsonb_build_array(customer_party)) END;
     IF line ? 'provider' AND line->>'provider'<>'FEDEX' THEN RETURN atlas_customer.problem(409,'SHIPPING_QUOTE_INVALID'); END IF;
    END IF;
    IF line->'request' IS DISTINCT FROM shipment_request THEN RETURN atlas_customer.problem(409,'SHIPPING_PLAN_INVALID'); END IF;
   END LOOP;
   IF ctl.terms->>'mailClockStart' IS DISTINCT FROM 'ATLAS_RECEIPT' OR COALESCE(ctl.terms->>'mailChargedLegs','') NOT IN ('INBOUND_ONLY','BOTH_LEGS')
    OR quote->'terms'->>'clockStart' IS DISTINCT FROM ctl.terms->>'mailClockStart' OR quote->'terms'->>'mailChargedLegs' IS DISTINCT FROM ctl.terms->>'mailChargedLegs'
    OR (quote->'terms'->>'days')::integer IS DISTINCT FROM 14 OR jsonb_array_length(quote->'shipping')<>(CASE WHEN ctl.terms->>'mailChargedLegs'='BOTH_LEGS' THEN 2 ELSE 1 END)
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
  IF q.snapshot->>'channel'='MAIL_IN' AND (COALESCE(q.snapshot->'terms'->>'shippingPayment','')='SEPARATE_PAYMENT') IS DISTINCT FROM (COALESCE(ctl.terms->>'shippingPayment','')='SEPARATE_PAYMENT') THEN RETURN atlas_customer.problem(409,'PAYMENT_FLOW_CHANGED'); END IF;
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
    (oid||':email:v1',oid,'EMAIL_RECEIPT',jsonb_build_object('orderId',oid,'reference',ord.reference,'to',q.snapshot->'profile'->>'email','currency','usd','totalCents',q.snapshot->'totalCents','quoteHash',q."contentHash",'shippingPayment',q.snapshot->'terms'->>'shippingPayment'));
  END IF;
  INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES
   (oid||':tax:v1',oid,'TAX_TRANSACTION',jsonb_build_object('orderId',oid,'calculationId',q.snapshot->'tax'->>'providerId'));
  FOR line IN SELECT value FROM jsonb_array_elements(q.snapshot->'shipping') LOOP
   IF line->>'provider'='SHIPSTATION' THEN
    INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES (oid||':shipstation:'||(line->>'leg')||':v1',oid,'SHIPSTATION_LABEL',jsonb_build_object('orderId',oid,'shipment',line->'request','leg',line->>'leg','rateId',line->>'providerId','rate',line->'rate'));
   ELSE
   INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES (oid||':fedex:'||(line->>'leg')||':v1',oid,'FEDEX_LABEL',jsonb_build_object('orderId',oid,'shipment',line->'request','leg',line->>'leg','rateId',line->>'providerId'));
   END IF;
  END LOOP;
  IF q.snapshot->>'channel'='KIOSK' AND COALESCE(q.snapshot->'terms'->>'paymentFlow','')<>'CUSTOMER_PHONE' THEN INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES (oid||':package:v1',oid,'PACKAGE_LABEL',jsonb_build_object('orderId',oid,'reference',ord.reference,'cardCount',jsonb_array_length(q.snapshot->'cards'),'locationId',q.snapshot->'location'->>'id')); END IF;
  UPDATE atlas_customer."CustomerIntakeDraft" SET state='ORDERED',"updatedAt"=clock_timestamp() WHERE id=did;
  RETURN jsonb_build_object('order',atlas_customer.commerce_call('commerce_order',aid,jsonb_build_object('orderId',oid)));
 END IF;
 RETURN atlas_customer.problem(404,'NOT_FOUND');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR not_null_violation OR check_violation THEN RETURN atlas_customer.problem(400,'INVALID_COMMERCE_REQUEST');
END $$;
CREATE OR REPLACE FUNCTION atlas_customer.customer_private_call_before_progress(action text,b jsonb,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
DECLARE svc atlas_customer."CustomerServiceControl"; ctl atlas_customer."CustomerControl"; auth jsonb; name text;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>12582912 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 name:=d->>'name';
 IF action='intake' AND name IN ('response','fail') THEN RETURN atlas_customer.intake_worker_call(name,d->'input'); END IF;
 SELECT * INTO svc FROM atlas_customer."CustomerServiceControl" WHERE id='active' FOR SHARE;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF svc.enabled IS DISTINCT FROM true OR svc.binding IS DISTINCT FROM b OR ctl.enabled IS DISTINCT FROM true
  OR jsonb_typeof(b) IS DISTINCT FROM 'object'
  OR (b->>'mode',b->>'origin',b->>'deploymentId',b->>'releaseSha',b->>'configHash')
   IS DISTINCT FROM (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN
  RETURN atlas_customer.problem(503,'CUSTOMER_SERVICE_NOT_ENABLED'); END IF;
 IF action='capacity' THEN
  IF d IS DISTINCT FROM '{"input":{}}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
  RETURN atlas_customer.weekly_capacity_snapshot();
 ELSIF action='directory' THEN RETURN atlas_customer.customer_call('dealer_locations',b,d->'input');
 ELSIF action='customer' THEN
  IF COALESCE(name,'') NOT IN ('intake_upload','commerce_checkout') THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  auth:=d->'authority'; IF auth->'binding' IS DISTINCT FROM b THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  RETURN atlas_customer.customer_call(name,b,(d->'input')||jsonb_build_object('sessionHash',auth->>'sessionHash','browserHash',auth->>'browserHash'));
 ELSIF action='intake' THEN
  IF COALESCE(name,'') NOT IN ('verify','claim','prepared','dispatch','finish') THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  IF name<>'verify' AND NOT svc."identificationEnabled" THEN RETURN atlas_customer.problem(503,'IDENTIFICATION_NOT_CONFIGURED'); END IF;
  IF name='verify' AND d->'input'->'authority'->'binding' IS DISTINCT FROM b THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  RETURN atlas_customer.intake_worker_call(name,d->'input');
 ELSIF action='commerce' THEN
  IF COALESCE(name,'') NOT IN ('commerce_checkout','commerce_save_quote','commerce_reserve_payment','commerce_record_payment','commerce_payment','commerce_confirm_paid',
   'commerce_shipping_checkout','commerce_shipping_save_quote','commerce_shipping_reserve_payment','commerce_shipping_record_payment','commerce_shipping_payment','commerce_shipping_confirm_paid',
   'commerce_order','commerce_record_tracking','commerce_trackable_effects','commerce_reconcilable_effects','commerce_pending_effects','commerce_effect','commerce_claim_effect','commerce_finish_effect','commerce_provider_event','commerce_callback_payment','commerce_callback_confirm') THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
  IF name NOT IN ('commerce_record_tracking','commerce_trackable_effects','commerce_reconcilable_effects','commerce_pending_effects','commerce_effect','commerce_claim_effect','commerce_finish_effect','commerce_provider_event','commerce_callback_payment','commerce_callback_confirm')
   AND d->'input'->'authority'->'binding' IS DISTINCT FROM b THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
  RETURN atlas_customer.commerce_provider_call(name,d->'providerBinding',d->'input');
 END IF;
 RETURN atlas_customer.problem(404,'NOT_FOUND');
EXCEPTION
 WHEN SQLSTATE 'PWC01' THEN RETURN atlas_customer.problem(503,'WEEKLY_CAPACITY_NOT_CONFIGURED');
 WHEN SQLSTATE 'PWC02' THEN RETURN atlas_customer.problem(409,'WEEKLY_CAPACITY_FULL');
 WHEN SQLSTATE 'PWC03' THEN RETURN atlas_customer.problem(409,'WEEKLY_CAPACITY_INVALID_QUOTE');
END $$;
CREATE OR REPLACE FUNCTION atlas_customer.commerce_source(did uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,atlas_customer AS $$
 SELECT jsonb_build_object('draftId',d.id,'revision',d.revision,'accountId',d."accountId",'profile',d."profileSnapshot",'profileRevision',d.revision,'phone',a.phone,'emailVerified',atlas_customer.email_verified(a.id,d."profileSnapshot"->>'email'),
 'channel',CASE WHEN d."intakeMethod"='MAIL_IN' THEN 'MAIL_IN' ELSE 'KIOSK' END,'location',CASE WHEN d."kioskId" IS NOT NULL THEN atlas_customer.intake_location(d."kioskId") ELSE NULL END,
 'terms',(SELECT terms FROM atlas_customer."CommerceControl" WHERE id='active'),
 'activePayment',(SELECT atlas_customer.commerce_payment_projection(p.id) FROM atlas_customer."CommercePayment" p WHERE p."draftId"=d.id AND p.state<>'CANCELED'),
 'shippingPlans',COALESCE((SELECT jsonb_agg(plan) FROM atlas_customer."CommerceControl" ctl CROSS JOIN LATERAL jsonb_array_elements(ctl."shippingPlans") plan
 WHERE ctl.id='active' AND atlas_customer.commerce_shipping_plan_valid(plan,(SELECT count(*)::integer FROM atlas_customer."CustomerIntakeCard" c WHERE c."draftId"=d.id),ctl.terms->>'mailChargedLegs')),'[]'::jsonb),
 'cards',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'revision',c.revision,'identity',c.identity,'photoPairHash',atlas_customer.commerce_hash(
 (SELECT jsonb_agg(jsonb_build_object('side',u.side,'plan',u.plan,'verification',u.verification) ORDER BY u.side) FROM atlas_customer."CustomerIntakeUpload" u WHERE u."cardId"=c.id))) ORDER BY c."createdAt",c.id)
 FROM atlas_customer."CustomerIntakeCard" c WHERE c."draftId"=d.id),'[]'::jsonb))
 FROM atlas_customer."CustomerIntakeDraft" d JOIN atlas_customer."CustomerAccount" a ON a.id=d."accountId" WHERE d.id=did
$$;
CREATE OR REPLACE FUNCTION atlas_customer.commerce_public_checkout(v jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('version','atlas-commerce-checkout-v1','draftId',v->'draftId','revision',v->'revision','channel',v->'channel',
 'cards',atlas_customer.commerce_public_cards(CASE WHEN v->'activePayment'->>'state'='PAID' THEN v->'activePayment'->'order'->'receipt'->'cards' ELSE v->'cards' END),
 'location',atlas_customer.commerce_public_location(CASE WHEN v->'activePayment'->>'state'='PAID' THEN v->'activePayment'->'order'->'receipt'->'location' ELSE v->'location' END),
 'terms',atlas_customer.commerce_public_fields(v->'terms',ARRAY['shippingPayment']),
 'activePayment',atlas_customer.commerce_public_payment(v->'activePayment'),
 'unitCents',CASE WHEN v->>'channel'='KIOSK' THEN 5000 ELSE 4000 END,'turnaroundDays',CASE WHEN v->>'channel'='KIOSK' THEN 7 ELSE 14 END,
 'shippingOptions',atlas_customer.commerce_public_rows(v->'shippingPlans',ARRAY['packingPresetId','shippingServiceCode','label','packaging','carrierLabel','serviceLabel','inboundPackaging']),'blockers','[]'::jsonb)
$$;
REVOKE ALL ON FUNCTION atlas_customer.commerce_shipping_payment_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_customer.commerce_label_ready_email() FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_customer.commerce_shipping_public_state(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_customer.commerce_shipping_payment_projection(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_customer.commerce_shipping_source(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_customer.commerce_shipping_call(text,jsonb,jsonb) FROM PUBLIC;
COMMIT;
