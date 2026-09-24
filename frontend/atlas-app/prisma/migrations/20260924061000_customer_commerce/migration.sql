BEGIN;
-- Integration proposal only. Root folds this into a reviewed additive migration.
-- Never execute from a web runtime. No grants to the customer role on tables.
CREATE TABLE atlas_customer."CommerceControl" (
  id text PRIMARY KEY DEFAULT 'active' CHECK (id='active'),
  enabled boolean NOT NULL DEFAULT false,
  binding jsonb NOT NULL CHECK (jsonb_typeof(binding)='object'),
  merchant jsonb NOT NULL CHECK (jsonb_typeof(merchant)='object'),
  terms jsonb NOT NULL DEFAULT '{"mailClockStart":"UNCONFIGURED","mailChargedLegs":"UNCONFIGURED"}',
  "shippingPlans" jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof("shippingPlans")='array'),
  "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE atlas_customer."CommerceQuote" (
  id uuid PRIMARY KEY,
  "accountId" uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
  "draftId" uuid NOT NULL,
  "draftRevision" integer NOT NULL CHECK ("draftRevision">0),
  "contentHash" varchar(64) NOT NULL CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE atlas_customer."CommercePayment" (
  id uuid PRIMARY KEY,
  "accountId" uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
  "draftId" uuid NOT NULL,
  "quoteId" uuid NOT NULL REFERENCES atlas_customer."CommerceQuote"(id),
  "requestId" uuid NOT NULL,
  merchant jsonb NOT NULL,
  "readerId" text,
  "providerId" text UNIQUE,
  state text NOT NULL CHECK (state IN ('DISPATCHED','UNKNOWN','AWAITING_PAYMENT','PROCESSING','PAID','CANCELED')),
  observation jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE ("accountId","requestId")
);
CREATE UNIQUE INDEX "CommercePayment_draft_active" ON atlas_customer."CommercePayment"("draftId") WHERE state <> 'CANCELED';
CREATE UNIQUE INDEX "CommercePayment_reader_active" ON atlas_customer."CommercePayment"("readerId") WHERE "readerId" IS NOT NULL AND state IN ('DISPATCHED','UNKNOWN','AWAITING_PAYMENT','PROCESSING');
CREATE TABLE atlas_customer."CommerceOrder" (
  id uuid PRIMARY KEY,
  "accountId" uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
  "draftId" uuid NOT NULL UNIQUE,
  "quoteId" uuid NOT NULL UNIQUE REFERENCES atlas_customer."CommerceQuote"(id),
  "paymentId" uuid NOT NULL UNIQUE REFERENCES atlas_customer."CommercePayment"(id),
  reference varchar(24) NOT NULL UNIQUE,
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object'),
  "paidAt" timestamptz NOT NULL
);
CREATE TABLE atlas_customer."CommerceEffect" (
  id text PRIMARY KEY,
  "orderId" uuid NOT NULL REFERENCES atlas_customer."CommerceOrder"(id),
  kind text NOT NULL CHECK (kind IN ('EMAIL_RECEIPT','SMS_RECEIPT','FEDEX_LABEL','TAX_TRANSACTION','PACKAGE_LABEL')),
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','DISPATCHED','UNKNOWN','SUCCEEDED','FAILED')),
  request jsonb NOT NULL,
  "claimId" uuid,
  result jsonb,
  "reconcileAfter" timestamptz,
  "reconcileCount" integer NOT NULL DEFAULT 0 CHECK ("reconcileCount" BETWEEN 0 AND 5),
  "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (state='PENDING' OR "claimId" IS NOT NULL)
);
CREATE TABLE atlas_customer."CommerceProviderEvent" (
  provider text NOT NULL,
  merchant text NOT NULL,
  "eventId" text NOT NULL,
  "bodyHash" varchar(64) NOT NULL CHECK ("bodyHash" ~ '^[a-f0-9]{64}$'),
  "paymentId" uuid REFERENCES atlas_customer."CommercePayment"(id),
  "receivedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (provider,merchant,"eventId")
);
-- Gateway source checks, append-only guards for quote/order/event and immutable
-- payment request/merchant binding are required before migration publication.
-- A provider callback/worker gets its own narrow capability, never blanket SQL.
REVOKE ALL ON ALL TABLES IN SCHEMA atlas_customer FROM PUBLIC;

CREATE FUNCTION atlas_customer.commerce_canonical(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,atlas_customer AS $$
 SELECT CASE jsonb_typeof(v)
 WHEN 'object' THEN '{'||COALESCE((SELECT string_agg(to_jsonb(key)::text||':'||atlas_customer.commerce_canonical(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(v)),'')||'}'
 WHEN 'array' THEN '['||COALESCE((SELECT string_agg(atlas_customer.commerce_canonical(value),',' ORDER BY ord) FROM jsonb_array_elements(v) WITH ORDINALITY e(value,ord)),'')||']'
 ELSE v::text END
$$;
CREATE FUNCTION atlas_customer.commerce_hash(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,atlas_customer AS $$
 SELECT encode(sha256(convert_to(atlas_customer.commerce_canonical(v),'UTF8')),'hex')
$$;
CREATE OR REPLACE FUNCTION atlas_customer.intake_editable(did uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,atlas_customer AS $$
 SELECT NOT EXISTS (SELECT 1 FROM atlas_customer."CommercePayment" WHERE "draftId"=did AND state<>'CANCELED')
 AND NOT EXISTS (SELECT 1 FROM atlas_customer."CommerceOrder" WHERE "draftId"=did)
$$;
CREATE FUNCTION atlas_customer.commerce_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'ATLAS commerce evidence is immutable'; END $$;
CREATE TRIGGER "CommerceQuote_immutable" BEFORE UPDATE OR DELETE ON atlas_customer."CommerceQuote" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();
CREATE TRIGGER "CommerceOrder_immutable" BEFORE UPDATE OR DELETE ON atlas_customer."CommerceOrder" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();
CREATE TRIGGER "CommerceProviderEvent_immutable" BEFORE UPDATE OR DELETE ON atlas_customer."CommerceProviderEvent" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();
CREATE FUNCTION atlas_customer.commerce_payment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW."accountId"<>OLD."accountId" OR NEW."draftId"<>OLD."draftId" OR NEW."quoteId"<>OLD."quoteId"
 OR NEW."requestId"<>OLD."requestId" OR NEW.merchant<>OLD.merchant OR NEW."readerId" IS DISTINCT FROM OLD."readerId" OR NEW."createdAt"<>OLD."createdAt"
 OR (OLD."providerId" IS NOT NULL AND NEW."providerId" IS DISTINCT FROM OLD."providerId") OR (OLD.state IN ('PAID','CANCELED') AND NEW.state<>OLD.state)
 THEN RAISE EXCEPTION 'ATLAS payment identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CommercePayment_guard" BEFORE UPDATE OR DELETE ON atlas_customer."CommercePayment" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_payment_guard();
CREATE FUNCTION atlas_customer.commerce_effect_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW."orderId"<>OLD."orderId" OR NEW.kind<>OLD.kind OR NEW.request<>OLD.request OR NEW."createdAt"<>OLD."createdAt"
 OR (OLD.state='SUCCEEDED' AND NEW IS DISTINCT FROM OLD) OR (OLD."claimId" IS NOT NULL AND NEW."claimId" IS DISTINCT FROM OLD."claimId")
 THEN RAISE EXCEPTION 'ATLAS effect identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CommerceEffect_guard" BEFORE UPDATE OR DELETE ON atlas_customer."CommerceEffect" FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_effect_guard();

-- Explicit customer DTO allowlists. Stored quote/payment/receipt evidence is
-- unchanged; new provider fields do not become customer-visible by default.
CREATE FUNCTION atlas_customer.commerce_public_fields(v jsonb, keys text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(CASE WHEN jsonb_typeof(v)='object' THEN v ELSE '{}'::jsonb END)
 WHERE key=ANY(keys) AND jsonb_typeof(value) IN ('string','number','boolean','null')
$$;
CREATE FUNCTION atlas_customer.commerce_public_rows(v jsonb, keys text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(jsonb_agg(atlas_customer.commerce_public_fields(value,keys) ORDER BY ord),'[]'::jsonb)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v)='array' THEN v ELSE '[]'::jsonb END) WITH ORDINALITY e(value,ord)
$$;
CREATE FUNCTION atlas_customer.commerce_public_location(v jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN 'null'::jsonb ELSE
 atlas_customer.commerce_public_fields(v,ARRAY['id','name','revision'])||jsonb_build_object(
 'address',atlas_customer.commerce_public_fields(v->'address',ARRAY['line1','city','region','postalCode','country']),
 'schedule',atlas_customer.commerce_public_fields(v->'schedule',ARRAY['timeZone','nextCollectionAt','projectedReturnAt','cutoffAt'])||jsonb_build_object(
 'pickups',atlas_customer.commerce_public_rows(v->'schedule'->'pickups',ARRAY['weekday','time','cutoff']),
 'returns',atlas_customer.commerce_public_rows(v->'schedule'->'returns',ARRAY['weekday','time']),
 'exceptions',atlas_customer.commerce_public_rows(v->'schedule'->'exceptions',ARRAY['date','kind','cancelled','time','cutoff','reason']))) END
$$;
CREATE FUNCTION atlas_customer.commerce_public_cards(v jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(jsonb_agg(atlas_customer.commerce_public_fields(value,ARRAY['id','cardId','revision','unitCents'])||jsonb_build_object(
 'identity',atlas_customer.commerce_public_fields(value->'identity',ARRAY['category','title','playerName','year','manufacturer','setName','cardNumber','parallel','insert'])) ORDER BY ord),'[]'::jsonb)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v)='array' THEN v ELSE '[]'::jsonb END) WITH ORDINALITY e(value,ord)
$$;
CREATE FUNCTION atlas_customer.commerce_public_quote(v jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT atlas_customer.commerce_public_fields(v,ARRAY['id','draftId','draftRevision','channel','currency','subtotalCents','shippingCents','taxCents','totalCents','createdAt','expiresAt'])||jsonb_build_object(
 'cards',atlas_customer.commerce_public_cards(v->'cards'),'location',atlas_customer.commerce_public_location(v->'location'),
 'terms',atlas_customer.commerce_public_fields(v->'terms',ARRAY['days','clockStart','mailChargedLegs']),
 'shipping',atlas_customer.commerce_public_rows(v->'shipping',ARRAY['leg','amountCents','currency','expiresAt']))
$$;
CREATE FUNCTION atlas_customer.commerce_public_order(v jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN 'null'::jsonb ELSE
 atlas_customer.commerce_public_fields(v,ARRAY['id','reference','paidAt'])||jsonb_build_object('receipt',atlas_customer.commerce_public_quote(v->'receipt'),
 'effects',COALESCE((SELECT jsonb_agg(atlas_customer.commerce_public_fields(value,ARRAY['id','kind','state','trackingNumber','deliveryStatus','artifactState']) ORDER BY ord)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v->'effects')='array' THEN v->'effects' ELSE '[]'::jsonb END) WITH ORDINALITY e(value,ord)
 WHERE value->>'kind' IN ('EMAIL_RECEIPT','SMS_RECEIPT','FEDEX_LABEL','PACKAGE_LABEL')),'[]'::jsonb)) END
$$;
CREATE FUNCTION atlas_customer.commerce_public_payment(v jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(v) IS DISTINCT FROM 'object' THEN 'null'::jsonb ELSE
 atlas_customer.commerce_public_fields(v,ARRAY['state','channel'])||jsonb_build_object('attemptId',COALESCE(v->'id',v->'attemptId'))
 ||CASE WHEN v->>'state'='PAID' THEN jsonb_build_object('order',atlas_customer.commerce_public_order(v->'order')) ELSE '{}'::jsonb END END
$$;
CREATE FUNCTION atlas_customer.commerce_public_checkout(v jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('version','atlas-commerce-checkout-v1','draftId',v->'draftId','revision',v->'revision','channel',v->'channel',
 'cards',atlas_customer.commerce_public_cards(CASE WHEN v->'activePayment'->>'state'='PAID' THEN v->'activePayment'->'order'->'receipt'->'cards' ELSE v->'cards' END),
 'location',atlas_customer.commerce_public_location(CASE WHEN v->'activePayment'->>'state'='PAID' THEN v->'activePayment'->'order'->'receipt'->'location' ELSE v->'location' END),
 'activePayment',atlas_customer.commerce_public_payment(v->'activePayment'),
 'unitCents',CASE WHEN v->>'channel'='KIOSK' THEN 5000 ELSE 4000 END,'turnaroundDays',CASE WHEN v->>'channel'='KIOSK' THEN 7 ELSE 14 END,
 'shippingOptions',atlas_customer.commerce_public_rows(v->'shippingPlans',ARRAY['packingPresetId','shippingServiceCode','label','packaging']),'blockers','[]'::jsonb)
$$;
REVOKE ALL ON FUNCTION atlas_customer.commerce_public_fields(jsonb,text[]),atlas_customer.commerce_public_rows(jsonb,text[]),atlas_customer.commerce_public_location(jsonb),atlas_customer.commerce_public_cards(jsonb),atlas_customer.commerce_public_quote(jsonb),atlas_customer.commerce_public_order(jsonb),atlas_customer.commerce_public_payment(jsonb),atlas_customer.commerce_public_checkout(jsonb) FROM PUBLIC;

-- A control supplies actual measured package facts for one exact card count.
-- Its quote-admission window is at most 24 hours; shipment dates remain exact
-- sourced values in the origin timezone, never silently moved to today's date.
CREATE FUNCTION atlas_customer.commerce_shipping_plan_valid(plan jsonb,n integer,charged_legs text) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE leg text; dimension text; request jsonb; shipment jsonb; package jsonb; party jsonb; stamp date; zone text; starts timestamptz; ends timestamptz;
BEGIN
 IF NOT COALESCE(plan->>'version'='atlas-measured-shipping-plan-v1' AND jsonb_typeof(plan->'cardCount')='number'
  AND (plan->>'cardCount')::numeric=n AND n BETWEEN 1 AND 100
  AND plan->>'packingPresetId' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'
  AND plan->>'shippingServiceCode' ~ '^[A-Z][A-Z0-9_]{0,79}$'
  AND length(btrim(plan->>'measurementReference')) BETWEEN 1 AND 240 AND plan->>'measurementReference' !~ '[[:cntrl:]]'
  AND plan->>'validFrom' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
  AND plan->>'validUntil' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
  AND charged_legs IN ('INBOUND_ONLY','BOTH_LEGS'),false) THEN RETURN false; END IF;
 starts:=(plan->>'validFrom')::timestamptz; ends:=(plan->>'validUntil')::timestamptz;
 IF to_char(starts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>plan->>'validFrom' OR to_char(ends AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>plan->>'validUntil'
  OR starts>statement_timestamp() OR ends<=statement_timestamp() OR ends<=starts OR ends-starts>interval '24 hours' THEN RETURN false; END IF;
 FOREACH leg IN ARRAY (CASE WHEN charged_legs='BOTH_LEGS' THEN ARRAY['INBOUND','RETURN'] ELSE ARRAY['INBOUND'] END) LOOP
  request:=plan->'legs'->leg; shipment:=request->'requestedShipment'; zone:=request->>'shipDateTimeZone';
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

CREATE FUNCTION atlas_customer.commerce_source(did uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,atlas_customer AS $$
 SELECT jsonb_build_object('draftId',d.id,'revision',d.revision,'accountId',d."accountId",'profile',d."profileSnapshot",'profileRevision',d.revision,'phone',a.phone,
 'channel',CASE WHEN d."intakeMethod"='MAIL_IN' THEN 'MAIL_IN' ELSE 'KIOSK' END,'location',CASE WHEN d."kioskId" IS NOT NULL THEN atlas_customer.intake_location(d."kioskId") ELSE NULL END,
 'activePayment',(SELECT jsonb_build_object('id',p.id,'state',p.state,'order',(SELECT jsonb_build_object('id',o.id,'reference',o.reference,'receipt',o.receipt,'paidAt',o."paidAt") FROM atlas_customer."CommerceOrder" o WHERE o."paymentId"=p.id)) FROM atlas_customer."CommercePayment" p WHERE p."draftId"=d.id AND p.state<>'CANCELED'),
 'shippingPlans',COALESCE((SELECT jsonb_agg(plan) FROM atlas_customer."CommerceControl" ctl CROSS JOIN LATERAL jsonb_array_elements(ctl."shippingPlans") plan
 WHERE ctl.id='active' AND atlas_customer.commerce_shipping_plan_valid(plan,(SELECT count(*)::integer FROM atlas_customer."CustomerIntakeCard" c WHERE c."draftId"=d.id),ctl.terms->>'mailChargedLegs')),'[]'::jsonb),
 'cards',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'revision',c.revision,'identity',c.identity,'photoPairHash',atlas_customer.commerce_hash(
 (SELECT jsonb_agg(jsonb_build_object('side',u.side,'plan',u.plan,'verification',u.verification) ORDER BY u.side) FROM atlas_customer."CustomerIntakeUpload" u WHERE u."cardId"=c.id))) ORDER BY c."createdAt",c.id)
 FROM atlas_customer."CustomerIntakeCard" c WHERE c."draftId"=d.id),'[]'::jsonb))
 FROM atlas_customer."CustomerIntakeDraft" d JOIN atlas_customer."CustomerAccount" a ON a.id=d."accountId" WHERE d.id=did
$$;
CREATE FUNCTION atlas_customer.commerce_payment_projection(pid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,atlas_customer AS $$
 SELECT to_jsonb(p)||jsonb_build_object('quote',q.snapshot,'order',(SELECT jsonb_build_object('id',o.id,'reference',o.reference,'receipt',o.receipt,'paidAt',o."paidAt") FROM atlas_customer."CommerceOrder" o WHERE o."paymentId"=p.id))
 FROM atlas_customer."CommercePayment" p JOIN atlas_customer."CommerceQuote" q ON q.id=p."quoteId" WHERE p.id=pid
$$;
-- Called only by the existing customer_call after its session checks. These are
-- read projections, never provider or payment-result authority.
CREATE FUNCTION atlas_customer.commerce_call(action text, account_id uuid, d jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,atlas_customer AS $$
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
    FROM atlas_customer."CommerceEffect" e WHERE e.id=d->>'effectId' AND e."orderId"=ord.id AND e.kind IN ('FEDEX_LABEL','PACKAGE_LABEL') AND e.state='SUCCEEDED' AND e.result->>'labelBase64' IS NOT NULL),atlas_customer.problem(409,'LABEL_NOT_READY'));
  END IF;
  RETURN atlas_customer.commerce_public_order(jsonb_build_object('id',ord.id,'reference',ord.reference,'receipt',ord.receipt,'paidAt',ord."paidAt",'effects',
   COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'state',e.state,'trackingNumber',e.result->>'trackingNumber','deliveryStatus',e.result->>'deliveryStatus','artifactState',e.result->>'state'))
   FROM atlas_customer."CommerceEffect" e WHERE e."orderId"=ord.id),'[]'::jsonb)));
 ELSE RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
EXCEPTION WHEN invalid_text_representation THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST');
END $$;

-- Separate private role only. Binding is installed out of band with an enabled
-- control. Customer commands additionally reauthenticate their real original
-- session/browser against the unchanged customer gateway, even on private hop.
CREATE FUNCTION atlas_customer.commerce_provider_call(action text,b jsonb,d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
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
  IF draft."kioskId" IS NOT NULL AND (source->'location'='null'::jsonb OR source->'location'->>'terminalId' IS NULL OR source->'location'->'schedule'->>'nextCollectionAt' IS NULL) THEN RETURN atlas_customer.problem(409,'KIOSK_NOT_AVAILABLE'); END IF;
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
   IF COALESCE(ctl.terms->>'mailClockStart','') NOT IN ('ATLAS_RECEIPT','CARRIER_ACCEPTANCE') OR COALESCE(ctl.terms->>'mailChargedLegs','') NOT IN ('INBOUND_ONLY','BOTH_LEGS')
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
   rid:=q.snapshot->'location'->>'terminalId';
   PERFORM pg_advisory_xact_lock(hashtextextended('atlas-commerce-reader:'||rid,0));
   IF rid IS NULL OR EXISTS (SELECT 1 FROM atlas_customer."CommercePayment" WHERE "readerId"=rid AND state IN ('DISPATCHED','UNKNOWN','AWAITING_PAYMENT','PROCESSING')) THEN RETURN atlas_customer.problem(409,'TERMINAL_BUSY'); END IF;
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
   OR NOT COALESCE(evidence->'paymentMethodTypes' ? CASE WHEN q.snapshot->>'channel'='KIOSK' THEN 'card_present' ELSE 'card' END,false) THEN RETURN atlas_customer.problem(409,'PAYMENT_BINDING_MISMATCH'); END IF;
  SELECT * INTO ord FROM atlas_customer."CommerceOrder" WHERE "paymentId"=p.id;
  IF ord.id IS NOT NULL THEN RETURN jsonb_build_object('order',atlas_customer.commerce_call('commerce_order',aid,jsonb_build_object('orderId',ord.id))); END IF;
  oid:=(d->>'receiptId')::uuid;
  UPDATE atlas_customer."CommercePayment" SET state='PAID',"providerId"=evidence->>'providerId',observation=evidence- 'clientSecret',"updatedAt"=clock_timestamp() WHERE id=p.id;
  INSERT INTO atlas_customer."CommerceOrder"(id,"accountId","draftId","quoteId","paymentId",reference,receipt,"paidAt") VALUES
   (oid,aid,did,q.id,p.id,'ATLAS-'||upper(substr(replace(oid::text,'-',''),1,18)),
    (q.snapshot-ARRAY['merchant','phone'])||jsonb_build_object('payment',evidence- 'clientSecret'),clock_timestamp()) RETURNING * INTO ord;
  -- Build effects in SQL from the paid snapshot; browser/private caller cannot
  -- alter destinations, totals, shipping request or effect multiplicity.
  INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES
   (oid||':email:v1',oid,'EMAIL_RECEIPT',jsonb_build_object('orderId',oid,'reference',ord.reference,'to',q.snapshot->'profile'->>'email','currency','usd','totalCents',q.snapshot->'totalCents','quoteHash',q."contentHash")),
   (oid||':sms:v1',oid,'SMS_RECEIPT',jsonb_build_object('orderId',oid,'reference',ord.reference,'to',q.snapshot->>'phone','currency','usd','totalCents',q.snapshot->'totalCents','quoteHash',q."contentHash")),
   (oid||':tax:v1',oid,'TAX_TRANSACTION',jsonb_build_object('orderId',oid,'calculationId',q.snapshot->'tax'->>'providerId'));
  FOR line IN SELECT value FROM jsonb_array_elements(q.snapshot->'shipping') LOOP
   INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES (oid||':fedex:'||(line->>'leg')||':v1',oid,'FEDEX_LABEL',jsonb_build_object('orderId',oid,'shipment',line->'request','leg',line->>'leg','rateId',line->>'providerId'));
  END LOOP;
  IF q.snapshot->>'channel'='KIOSK' THEN INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,request) VALUES (oid||':package:v1',oid,'PACKAGE_LABEL',jsonb_build_object('orderId',oid,'reference',ord.reference,'cardCount',jsonb_array_length(q.snapshot->'cards'),'locationId',q.snapshot->'location'->>'id')); END IF;
  UPDATE atlas_customer."CustomerIntakeDraft" SET state='ORDERED',"updatedAt"=clock_timestamp() WHERE id=did;
  RETURN jsonb_build_object('order',atlas_customer.commerce_call('commerce_order',aid,jsonb_build_object('orderId',oid)));
 END IF;
 RETURN atlas_customer.problem(404,'NOT_FOUND');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR not_null_violation OR check_violation THEN RETURN atlas_customer.problem(400,'INVALID_COMMERCE_REQUEST');
END $$;
REVOKE ALL ON FUNCTION atlas_customer.commerce_canonical(jsonb),atlas_customer.commerce_hash(jsonb),atlas_customer.intake_editable(uuid),atlas_customer.commerce_immutable(),atlas_customer.commerce_payment_guard(),atlas_customer.commerce_effect_guard(),atlas_customer.commerce_source(uuid),atlas_customer.commerce_payment_projection(uuid),atlas_customer.commerce_call(text,uuid,jsonb),atlas_customer.commerce_provider_call(text,jsonb,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION atlas_customer.customer_call(action text,binding jsonb,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
DECLARE ctl atlas_customer."CustomerControl"; account atlas_customer."CustomerAccount";
BEGIN
 IF action NOT IN ('intake_list','intake_create','intake_read','intake_card','intake_correct','intake_review','intake_upload','commerce_checkout','commerce_order','commerce_label') THEN
  RETURN atlas_customer.customer_call_v1(action,binding,d);
 END IF;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR jsonb_typeof(binding) IS DISTINCT FROM 'object' OR
  (binding->>'mode',binding->>'origin',binding->>'deploymentId',binding->>'releaseSha',binding->>'configHash')
  IS DISTINCT FROM (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN
  RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>65536 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 SELECT * INTO account FROM atlas_customer.current_account(d->>'sessionHash',d->>'browserHash',ctl.revision);
 IF account.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF action IN ('commerce_checkout','commerce_order','commerce_label') THEN
  RETURN atlas_customer.commerce_call(action,account.id,d-ARRAY['sessionHash','browserHash']); END IF;
 RETURN atlas_customer.intake_call(action,account.id,d-ARRAY['sessionHash','browserHash']);
END $$;
REVOKE ALL ON FUNCTION atlas_customer.customer_call(text,jsonb,jsonb) FROM PUBLIC;

COMMIT;
