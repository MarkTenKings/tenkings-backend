-- Owner-approved shop handoff correction. Additive and offline until release qualification.
-- QR issue/read are references only. Only a current scoped dealer session may confirm receipt.
BEGIN;
CREATE TABLE atlas_dealer.handoff (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL UNIQUE REFERENCES atlas_customer."CommerceOrder"(id),
 account_id uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
 location_id uuid NOT NULL REFERENCES atlas_dealer.location(id),
 card_ids uuid[] NOT NULL CHECK(cardinality(card_ids) BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE atlas_dealer.handoff_receipt (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 handoff_id uuid NOT NULL UNIQUE REFERENCES atlas_dealer.handoff(id),
 request_id uuid NOT NULL UNIQUE, input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 membership_id uuid NOT NULL REFERENCES atlas_dealer.membership(id),
 membership_version integer NOT NULL, dealer_account_id uuid NOT NULL REFERENCES atlas_customer."CustomerAccount"(id),
 location_id uuid NOT NULL REFERENCES atlas_dealer.location(id),
 card_ids uuid[] NOT NULL CHECK(cardinality(card_ids) BETWEEN 1 AND 100),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_dealer.handoff FOR EACH ROW EXECUTE FUNCTION atlas_dealer.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_dealer.handoff FOR EACH STATEMENT EXECUTE FUNCTION atlas_dealer.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_dealer.handoff_receipt FOR EACH ROW EXECUTE FUNCTION atlas_dealer.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON atlas_dealer.handoff_receipt FOR EACH STATEMENT EXECUTE FUNCTION atlas_dealer.immutable();

-- Provider Terminal/printer identifiers remain preserved for existing historical quotes.
-- A newly configured shop uses the customer's phone and does not require hardware IDs.
ALTER TABLE atlas_dealer.location ALTER COLUMN terminal_id DROP NOT NULL;
ALTER TABLE atlas_dealer.location ALTER COLUMN terminal_location_id DROP NOT NULL;
ALTER TABLE atlas_dealer.location ALTER COLUMN package_printer_id DROP NOT NULL;
CREATE OR REPLACE FUNCTION atlas_dealer.location_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Location history is retained'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.dealer_id<>OLD.dealer_id OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'Location revision conflict'; END IF;
 IF NOT NEW.address ?& ARRAY['line1','city','region','postalCode','country'] OR NEW.address-ARRAY['line1','city','region','postalCode','country']<>'{}'::jsonb
 OR EXISTS(SELECT 1 FROM jsonb_each(NEW.address) e WHERE jsonb_typeof(e.value)<>'string' OR length(NEW.address->>e.key) NOT BETWEEN 1 AND 180 OR NEW.address->>e.key ~ '[[:cntrl:]]')
 OR NEW.terminal_id IS NOT NULL AND length(NEW.terminal_id) NOT BETWEEN 1 AND 160
 OR NEW.terminal_location_id IS NOT NULL AND length(NEW.terminal_location_id) NOT BETWEEN 1 AND 160
 OR NEW.package_printer_id IS NOT NULL AND length(NEW.package_printer_id) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Incomplete shop configuration'; END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;

CREATE FUNCTION atlas_dealer.handoff_projection(hid uuid,include_cards boolean DEFAULT false) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',h.id,'orderId',h.order_id,'reference',o.reference,
  'location',jsonb_build_object('id',h.location_id,'name',l.name),'cardCount',cardinality(h.card_ids),
  'status',CASE WHEN r.id IS NULL THEN 'AWAITING_SHOP_RECEIPT' ELSE 'RECEIVED' END,
  'receipt',CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,'receivedAt',r.received_at,'cardCount',cardinality(r.card_ids)) END)
  ||CASE WHEN include_cards THEN jsonb_build_object('cards',(SELECT jsonb_agg(jsonb_build_object('cardId',c.card_id,'identity',c.paid_line->'identity') ORDER BY c.card_id)
    FROM atlas_dealer.order_card c WHERE c.order_id=h.order_id AND c.card_id=ANY(h.card_ids))) ELSE '{}'::jsonb END
 FROM atlas_dealer.handoff h JOIN atlas_customer."CommerceOrder" o ON o.id=h.order_id
 JOIN atlas_dealer.location l ON l.id=h.location_id LEFT JOIN atlas_dealer.handoff_receipt r ON r.handoff_id=h.id WHERE h.id=hid
$$;
CREATE FUNCTION atlas_dealer.issue_handoff(aid uuid,d jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o atlas_customer."CommerceOrder"; p atlas_customer."CommercePayment"; h atlas_dealer.handoff; ids uuid[]; lid uuid; locations integer; channels text[];
BEGIN
 SELECT * INTO o FROM atlas_customer."CommerceOrder" WHERE id=(d->>'orderId')::uuid AND "accountId"=aid FOR UPDATE;
 IF o.id IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 SELECT * INTO p FROM atlas_customer."CommercePayment" WHERE id=o."paymentId" FOR SHARE;
 IF p.state IS DISTINCT FROM 'PAID' OR p."providerId" IS NULL OR p."accountId"<>aid THEN RETURN atlas_customer.problem(409,'CONFIRMED_PAYMENT_REQUIRED'); END IF;
 SELECT * INTO h FROM atlas_dealer.handoff WHERE order_id=o.id;
 IF h.id IS NOT NULL THEN RETURN jsonb_build_object('handoff',atlas_dealer.handoff_projection(h.id)); END IF;
 SELECT array_agg(c.card_id ORDER BY c.card_id),count(DISTINCT c.location_id),array_agg(DISTINCT c.channel) INTO ids,locations,channels
 FROM atlas_dealer.order_card c WHERE c.order_id=o.id;
 SELECT c.location_id INTO lid FROM atlas_dealer.order_card c WHERE c.order_id=o.id LIMIT 1;
 IF cardinality(ids) NOT BETWEEN 1 AND 100 OR cardinality(ids) IS NULL OR locations<>1 OR channels IS DISTINCT FROM ARRAY['KIOSK']::text[] THEN RETURN atlas_customer.problem(409,'SHOP_HANDOFF_NOT_AVAILABLE'); END IF;
 IF EXISTS(SELECT 1 FROM atlas_dealer.custody_event WHERE card_id=ANY(ids) AND kind NOT IN ('DEPOSIT_DECLARED','DELAY_REPORTED','DELAY_RESOLVED')) THEN RETURN atlas_customer.problem(409,'HANDOFF_ALREADY_ADVANCED'); END IF;
 INSERT INTO atlas_dealer.handoff(order_id,account_id,location_id,card_ids) VALUES(o.id,aid,lid,ids) RETURNING * INTO h;
 RETURN jsonb_build_object('handoff',atlas_dealer.handoff_projection(h.id));
END $$;
CREATE FUNCTION atlas_dealer.handoff_dealer_call(action text,control_revision integer,d jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s atlas_dealer.session; m atlas_dealer.membership; h atlas_dealer.handoff; r atlas_dealer.handoff_receipt; ids uuid[]; exact_ids uuid[]; ih text; lock_id uuid; now_time timestamptz;
BEGIN
 -- This duplicates no authentication system: it applies the existing dealer session contract.
 SELECT * INTO s FROM atlas_dealer.session WHERE token_hash=d->>'dealerSessionHash' AND browser_hash=d->>'browserHash'
 AND revoked_at IS NULL AND expires_at>clock_timestamp() AND session.control_revision=handoff_dealer_call.control_revision FOR SHARE;
 SELECT * INTO m FROM atlas_dealer.membership WHERE id=s.membership_id AND version=s.membership_version AND revoked_at IS NULL FOR SHARE;
 IF m.id IS NULL THEN RETURN atlas_customer.problem(401,'DEALER_SIGN_IN_REQUIRED'); END IF;
 PERFORM 1 FROM atlas_customer."CustomerAccount" WHERE id=m.account_id AND "accessVersion"=s.account_version AND "revokedAt" IS NULL FOR SHARE;
 IF NOT FOUND THEN RETURN atlas_customer.problem(401,'DEALER_SIGN_IN_REQUIRED'); END IF;
 PERFORM 1 FROM atlas_dealer.location WHERE id=m.location_id AND enabled AND authorized_until>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RETURN atlas_customer.problem(403,'DEALER_LOCATION_UNAVAILABLE'); END IF;
 SELECT * INTO h FROM atlas_dealer.handoff WHERE id=(d->>'handoffId')::uuid AND location_id=m.location_id;
 IF h.id IS NULL THEN RETURN atlas_customer.problem(404,'HANDOFF_NOT_FOUND'); END IF;
 -- Serialize different scans and request IDs against the actual immutable paid order.
 SELECT id INTO lock_id FROM atlas_customer."CommerceOrder" WHERE id=h.order_id AND "accountId"=h.account_id FOR UPDATE;
 IF lock_id IS NULL OR NOT EXISTS(SELECT 1 FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommercePayment" p ON p.id=o."paymentId"
 WHERE o.id=h.order_id AND p.state='PAID' AND p."providerId" IS NOT NULL AND p."accountId"=h.account_id) THEN RETURN atlas_customer.problem(409,'CONFIRMED_PAYMENT_REQUIRED'); END IF;
 IF action='dealer_handoff_read' THEN RETURN jsonb_build_object('handoff',atlas_dealer.handoff_projection(h.id,true)); END IF;
 IF action<>'dealer_handoff_confirm' THEN RETURN atlas_customer.problem(400,'INVALID_DEALER_OPERATION'); END IF;
 IF jsonb_typeof(d->'cardIds') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'cardIds') NOT BETWEEN 1 AND 100
 OR COALESCE(d->>'confirmedCount','')!~'^[1-9][0-9]{0,2}$' OR (d->>'requestId') IS NULL THEN RETURN atlas_customer.problem(400,'ALL_CARDS_CONFIRMATION_REQUIRED'); END IF;
 SELECT array_agg(v::uuid ORDER BY v::uuid) INTO ids FROM jsonb_array_elements_text(d->'cardIds') v;
 SELECT array_agg(c.card_id ORDER BY c.card_id) INTO exact_ids FROM atlas_dealer.order_card c WHERE c.order_id=h.order_id AND c.location_id=h.location_id AND c.channel='KIOSK';
 IF ids IS DISTINCT FROM h.card_ids OR ids IS DISTINCT FROM exact_ids OR (d->>'confirmedCount')::integer<>cardinality(h.card_ids) THEN RETURN atlas_customer.problem(409,'HANDOFF_CARD_COUNT_MISMATCH'); END IF;
 ih:=atlas_customer.commerce_hash(jsonb_build_object('handoffId',h.id,'cardIds',ids,'confirmedCount',cardinality(ids)));
 SELECT * INTO r FROM atlas_dealer.handoff_receipt WHERE request_id=(d->>'requestId')::uuid;
 IF r.id IS NOT NULL AND (r.handoff_id<>h.id OR r.input_hash<>ih OR r.dealer_account_id<>m.account_id) THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
 SELECT * INTO r FROM atlas_dealer.handoff_receipt WHERE handoff_id=h.id;
 IF r.id IS NOT NULL THEN RETURN jsonb_build_object('handoff',atlas_dealer.handoff_projection(h.id,true)); END IF;
 -- Lock exact cards before checking progress against the existing staff custody writer.
 PERFORM 1 FROM atlas_dealer.order_card WHERE card_id=ANY(ids) ORDER BY card_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM atlas_dealer.custody_event WHERE card_id=ANY(ids) AND kind NOT IN ('DEPOSIT_DECLARED','DELAY_REPORTED','DELAY_RESOLVED')) THEN RETURN atlas_customer.problem(409,'HANDOFF_ALREADY_ADVANCED'); END IF;
 now_time:=clock_timestamp();
 INSERT INTO atlas_dealer.handoff_receipt(handoff_id,request_id,input_hash,membership_id,membership_version,dealer_account_id,location_id,card_ids,received_at)
 VALUES(h.id,(d->>'requestId')::uuid,ih,m.id,m.version,m.account_id,m.location_id,ids,now_time) RETURNING * INTO r;
 RETURN jsonb_build_object('handoff',atlas_dealer.handoff_projection(h.id,true));
EXCEPTION WHEN invalid_text_representation THEN RETURN atlas_customer.problem(400,'INVALID_HANDOFF');
 WHEN unique_violation THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT');
END $$;

CREATE FUNCTION atlas_dealer.card_tracking_with_handoff(cid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT atlas_dealer.card_tracking(cid) || CASE WHEN r.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('dealerReceivedAt',r.received_at,
 'events',(SELECT jsonb_agg(e ORDER BY (e->>'occurredAt')::timestamptz,e->>'id') FROM jsonb_array_elements(
   COALESCE(atlas_dealer.card_tracking(cid)->'events','[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',r.id,'kind','DEALER_RECEIVED','occurredAt',r.received_at,'recordedAt',r.received_at))) e)) END
 FROM atlas_dealer.order_card c LEFT JOIN atlas_dealer.handoff h ON h.order_id=c.order_id
 LEFT JOIN atlas_dealer.handoff_receipt r ON r.handoff_id=h.id AND cid=ANY(r.card_ids) WHERE c.card_id=cid
$$;
CREATE OR REPLACE FUNCTION atlas_dealer.customer_tracking(account_id uuid,oid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('orderId',o.id,'reference',o.reference,'cards',COALESCE((SELECT jsonb_agg(atlas_dealer.card_tracking_with_handoff(c.card_id) ORDER BY c.card_id)
 FROM atlas_dealer.order_card c WHERE c.order_id=o.id),'[]'::jsonb),'handoff',(SELECT atlas_dealer.handoff_projection(h.id) FROM atlas_dealer.handoff h WHERE h.order_id=o.id))
 FROM atlas_customer."CommerceOrder" o WHERE o.id=oid AND o."accountId"=account_id
$$;
-- Retain historical declarations; new handoffs require actual staff confirmation.
CREATE OR REPLACE FUNCTION atlas_dealer.declare_deposit(account_id uuid,d jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE prior atlas_dealer.custody_event;
BEGIN
 SELECT e.* INTO prior FROM atlas_dealer.custody_event e JOIN atlas_dealer.order_card c ON c.card_id=e.card_id JOIN atlas_customer."CommerceOrder" o ON o.id=c.order_id
 WHERE o."accountId"=account_id AND o.id=(d->>'orderId')::uuid AND c.card_id=(d->>'cardId')::uuid AND e.request_id=(d->>'requestId')::uuid AND e.customer_id=account_id;
 IF prior.id IS NOT NULL THEN
  IF prior.input_hash<>atlas_customer.commerce_hash(d-ARRAY['sessionHash','browserHash']) THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
  RETURN jsonb_build_object('eventId',prior.id);
 END IF;
 RETURN atlas_customer.problem(409,'STAFF_HANDOFF_REQUIRED');
END $$;
REVOKE ALL ON atlas_dealer.handoff,atlas_dealer.handoff_receipt FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_dealer.handoff_projection(uuid,boolean),atlas_dealer.issue_handoff(uuid,jsonb),atlas_dealer.handoff_dealer_call(text,integer,jsonb),atlas_dealer.card_tracking_with_handoff(uuid) FROM PUBLIC;

-- Enrich only the already-scoped existing dealer projection; no customer identity is exposed.
CREATE FUNCTION atlas_dealer.with_shop_receipts(p jsonb) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN NOT p ? 'location' THEN p ELSE p||jsonb_build_object('orders',COALESCE((
 SELECT jsonb_agg(o.value||jsonb_build_object('cards',(SELECT jsonb_agg(c.value||CASE WHEN r.id IS NULL THEN '{}'::jsonb ELSE
 jsonb_build_object('dealerReceivedAt',r.received_at)||CASE WHEN c.value->>'custody' IS NULL OR c.value->>'custody'='DEPOSIT_DECLARED'
 THEN jsonb_build_object('custody','DEALER_RECEIVED','occurredAt',r.received_at) ELSE '{}'::jsonb END END ORDER BY c.n)
 FROM jsonb_array_elements(o.value->'cards') WITH ORDINALITY c(value,n)
 LEFT JOIN atlas_dealer.order_card oc ON oc.card_id=(c.value->>'cardId')::uuid AND oc.location_id=(p->'location'->>'id')::uuid
 LEFT JOIN atlas_dealer.handoff h ON h.order_id=oc.order_id LEFT JOIN atlas_dealer.handoff_receipt r ON r.handoff_id=h.id AND oc.card_id=ANY(r.card_ids))) ORDER BY o.n)
 FROM jsonb_array_elements(p->'orders') WITH ORDINALITY o(value,n)),'[]'::jsonb)) END
$$;
REVOKE ALL ON FUNCTION atlas_dealer.with_shop_receipts(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION atlas_customer.customer_call(action text,binding jsonb,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,atlas_customer AS $$
DECLARE ctl atlas_customer."CustomerControl"; account atlas_customer."CustomerAccount";
BEGIN
 IF action NOT IN ('intake_list','intake_create','intake_read','intake_card','intake_correct','intake_review','intake_upload','commerce_checkout','commerce_order','commerce_label','dealer_locations','dealer_orders','dealer_memberships','dealer_enter','dealer_read','dealer_logout','dealer_tracking','dealer_deposit','dealer_handoff_issue','dealer_handoff_read','dealer_handoff_confirm') THEN
  RETURN atlas_customer.customer_call_v1(action,binding,d);
 END IF;
 SELECT * INTO ctl FROM atlas_customer."CustomerControl" WHERE id='active' FOR SHARE;
 IF ctl.enabled IS DISTINCT FROM true OR jsonb_typeof(binding) IS DISTINCT FROM 'object' OR
  (binding->>'mode',binding->>'origin',binding->>'deploymentId',binding->>'releaseSha',binding->>'configHash')
  IS DISTINCT FROM (ctl.mode,ctl.origin,ctl."deploymentId",ctl."releaseSha",ctl."configHash") THEN
  RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>65536 THEN RETURN atlas_customer.problem(400,'INVALID_REQUEST'); END IF;
 IF action IN ('dealer_handoff_read','dealer_handoff_confirm') THEN
  RETURN atlas_dealer.handoff_dealer_call(action,ctl.revision,d-'sessionHash'); END IF;
 IF action IN ('dealer_locations','dealer_read','dealer_logout') THEN
  RETURN atlas_dealer.with_shop_receipts(atlas_dealer.customer_call(action,NULL,ctl.revision,d- 'sessionHash')); END IF;
 SELECT * INTO account FROM atlas_customer.current_account(d->>'sessionHash',d->>'browserHash',ctl.revision);
 IF account.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF action='dealer_handoff_issue' THEN RETURN atlas_dealer.issue_handoff(account.id,d-ARRAY['sessionHash','browserHash']); END IF;
 IF action IN ('dealer_orders','dealer_memberships','dealer_enter','dealer_tracking','dealer_deposit') THEN
  RETURN atlas_dealer.with_shop_receipts(atlas_dealer.customer_call(action,account.id,ctl.revision,d- 'sessionHash')); END IF;
 IF action IN ('commerce_checkout','commerce_order','commerce_label') THEN
  RETURN atlas_customer.commerce_call(action,account.id,d-ARRAY['sessionHash','browserHash']); END IF;
 RETURN atlas_customer.intake_call(action,account.id,d-ARRAY['sessionHash','browserHash']);
END $$;
REVOKE ALL ON FUNCTION atlas_customer.customer_call(text,jsonb,jsonb) FROM PUBLIC;

COMMIT;
