BEGIN;
-- The immutable paid CommerceOrder is the inbox event. Reading it never marks
-- it seen; this single team acknowledgment has no fulfillment/payment effects.
CREATE TABLE atlas_dealer.order_inbox_acknowledgment (
 order_id uuid PRIMARY KEY REFERENCES atlas_customer."CommerceOrder"(id),
 request_id uuid NOT NULL UNIQUE,
 actor_id uuid NOT NULL REFERENCES atlas_staff."StaffIdentity"(id),
 acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER order_inbox_acknowledgment_immutable
 BEFORE UPDATE OR DELETE ON atlas_dealer.order_inbox_acknowledgment
 FOR EACH ROW EXECUTE FUNCTION atlas_customer.commerce_immutable();
CREATE TRIGGER order_inbox_acknowledgment_no_truncate
 BEFORE TRUNCATE ON atlas_dealer.order_inbox_acknowledgment
 FOR EACH STATEMENT EXECUTE FUNCTION atlas_customer.commerce_immutable();

CREATE FUNCTION atlas_dealer.order_inbox_acknowledgment_projection(oid uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('requestId',a.request_id,'acknowledgedAt',a.acknowledged_at,
  'acknowledgedBy',jsonb_build_object('id',a.actor_id,'name',i.name))
 FROM atlas_dealer.order_inbox_acknowledgment a
 JOIN atlas_staff."StaffIdentity" i ON i.id=a.actor_id WHERE a.order_id=oid
$$;

CREATE FUNCTION atlas_dealer.staff_order_acknowledge(session_hash text,browser_hash text,binding jsonb,phones text[],d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor record; oid uuid; rid uuid; prior atlas_dealer.order_inbox_acknowledgment; outcome text;
BEGIN
 SELECT * INTO actor FROM atlas_manual.authenticate(session_hash,browser_hash,binding,phones);
 IF actor.id IS NULL OR actor.role<>'REVIEWER' THEN RETURN atlas_customer.problem(403,'STAFF_REQUIRED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>256
  OR d-ARRAY['orderId','requestId']<>'{}'::jsonb
  OR jsonb_typeof(d->'orderId') IS DISTINCT FROM 'string' OR jsonb_typeof(d->'requestId') IS DISTINCT FROM 'string'
  OR (d->>'orderId') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  OR (d->>'requestId') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_ACKNOWLEDGMENT'); END IF;
 oid:=(d->>'orderId')::uuid; rid:=(d->>'requestId')::uuid;
 -- Serializing both identities makes concurrent retries and request reuse
 -- deterministic without expanding the runtime role's table privileges.
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-order-ack-request:'||rid,0));
 SELECT * INTO prior FROM atlas_dealer.order_inbox_acknowledgment WHERE request_id=rid;
 IF prior.order_id IS NOT NULL AND (prior.order_id<>oid OR prior.actor_id<>actor.id)
 THEN RETURN atlas_customer.problem(409,'REQUEST_CONFLICT'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-order-ack:'||oid,0));
 IF NOT EXISTS(SELECT 1 FROM atlas_customer."CommerceOrder" o
  JOIN atlas_customer."CommercePayment" p ON p.id=o."paymentId"
  WHERE o.id=oid AND p.state='PAID' AND COALESCE(btrim(p."providerId"),'')<>''
   AND p."accountId"=o."accountId" AND p."draftId"=o."draftId" AND p."quoteId"=o."quoteId")
 THEN RETURN atlas_customer.problem(404,'ORDER_NOT_FOUND'); END IF;
 SELECT * INTO prior FROM atlas_dealer.order_inbox_acknowledgment WHERE order_id=oid;
 IF prior.order_id IS NULL THEN
  INSERT INTO atlas_dealer.order_inbox_acknowledgment(order_id,request_id,actor_id)
  VALUES(oid,rid,actor.id) RETURNING * INTO prior;
 END IF;
 outcome:=CASE WHEN prior.request_id=rid AND prior.actor_id=actor.id THEN 'ACKNOWLEDGED' ELSE 'ALREADY_ACKNOWLEDGED' END;
 RETURN jsonb_build_object('orderId',oid,'requestId',rid,'outcome',outcome,
  'acknowledgment',atlas_dealer.order_inbox_acknowledgment_projection(oid));
END $$;

REVOKE ALL ON atlas_dealer.order_inbox_acknowledgment FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_dealer.order_inbox_acknowledgment_projection(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION atlas_dealer.staff_order_acknowledge(text,text,jsonb,text[],jsonb) FROM PUBLIC;
COMMIT;
