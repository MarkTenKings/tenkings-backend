-- Additive read-only staff desk. No provider effects, photo writes, payment
-- hook changes or inferred physical finishing facts.
BEGIN;
CREATE INDEX "CommerceOrder_desk_paid" ON atlas_customer."CommerceOrder"("paidAt" DESC,id DESC);

CREATE FUNCTION atlas_dealer.order_desk_paid(oid uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommercePayment" p ON p.id=o."paymentId"
 WHERE o.id=oid AND p.state='PAID' AND COALESCE(btrim(p."providerId"),'')<>''
 AND (p."accountId",p."draftId",p."quoteId")=(o."accountId",o."draftId",o."quoteId"))
$$;

-- Persisted paid-line hash binds the exact pair; a later/manual card can never
-- be substituted for the customer's paid submission photographs.
CREATE FUNCTION atlas_dealer.order_desk_pair_hash(cid uuid) RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT atlas_customer.commerce_hash(jsonb_agg(jsonb_build_object('side',u.side,'plan',u.plan,'verification',u.verification) ORDER BY u.side))
 FROM atlas_customer."CustomerIntakeUpload" u WHERE u."cardId"=cid HAVING count(*)=2 AND count(u.verification)=2
$$;
CREATE FUNCTION atlas_dealer.order_desk_photos(cid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_object_agg(s.side,jsonb_build_object('state',CASE WHEN u.id IS NOT NULL AND u.verification IS NOT NULL AND u.prepared IS NOT NULL
 AND atlas_dealer.order_desk_pair_hash(c.card_id)=c.paid_line->>'photoPairHash' THEN 'READY' ELSE 'UNAVAILABLE' END,
 'uploadId',u.id,'provenance','CUSTOMER_SUBMISSION',
 'thumbnailUrl',CASE WHEN u.id IS NOT NULL AND u.verification IS NOT NULL AND u.prepared IS NOT NULL AND atlas_dealer.order_desk_pair_hash(c.card_id)=c.paid_line->>'photoPairHash'
 THEN '/api/staff/manual-connected/order-desk/orders/'||c.order_id||'/cards/'||c.card_id||'/photos/'||s.side||'?size=thumbnail' END,
 'detailUrl',CASE WHEN u.id IS NOT NULL AND u.verification IS NOT NULL AND u.prepared IS NOT NULL AND atlas_dealer.order_desk_pair_hash(c.card_id)=c.paid_line->>'photoPairHash'
 THEN '/api/staff/manual-connected/order-desk/orders/'||c.order_id||'/cards/'||c.card_id||'/photos/'||s.side||'?size=detail' END))
 FROM atlas_dealer.order_card c CROSS JOIN (VALUES('FRONT'),('BACK')) s(side)
 LEFT JOIN atlas_customer."CustomerIntakeUpload" u ON u."cardId"=c.card_id AND u.side=s.side WHERE c.card_id=cid
$$;

CREATE FUNCTION atlas_dealer.order_desk_card_state(cid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 WITH facts AS (
 SELECT c.card_id,c.channel,l.manual_card_id,cu.kind custody,a.action_id,a.approved_at,b.state batch_state,b.stage batch_stage,b.code batch_code,
 EXISTS(SELECT 1 FROM atlas_manual_intake.card i JOIN atlas_manual_intake.discarded_card x ON x.owner_id=i.owner_id AND x.create_request_id=i.create_request_id WHERE i.id=l.manual_card_id) discarded,
 (SELECT e.kind='DELAY_REPORTED' FROM atlas_dealer.custody_event e WHERE e.card_id=c.card_id AND e.kind IN ('DELAY_REPORTED','DELAY_RESOLVED') ORDER BY e.sequence DESC LIMIT 1) delayed
 FROM atlas_dealer.order_card c LEFT JOIN atlas_dealer.manual_card_link l ON l.card_id=c.card_id
 LEFT JOIN atlas_manual.card m ON m.id=l.manual_card_id
 LEFT JOIN LATERAL(SELECT kind FROM atlas_dealer.custody_event WHERE card_id=c.card_id AND kind NOT IN ('DEPOSIT_DECLARED','DELAY_REPORTED','DELAY_RESOLVED') ORDER BY sequence DESC LIMIT 1) cu ON true
 LEFT JOIN LATERAL(SELECT action_id,approved_at FROM atlas_manual.approval WHERE card_id=l.manual_card_id ORDER BY approved_at DESC,action_id DESC LIMIT 1) a ON true
 LEFT JOIN LATERAL(SELECT state,stage,code FROM atlas_manual_connected.batch_grading WHERE card_id=l.manual_card_id AND source_hash=m.content::jsonb#>>'{source,sourceHash}' ORDER BY created_at DESC,key LIMIT 1) b ON true
 WHERE c.card_id=cid), progress AS (
 SELECT *,CASE WHEN custody IN ('CUSTOMER_DELIVERED','CUSTOMER_COLLECTED') THEN 'COMPLETE'
 WHEN custody IN ('RETURN_DISPATCHED','RETURNED_TO_KIOSK','MAIL_DISPATCHED') THEN 'RETURNING'
 WHEN custody IS DISTINCT FROM 'ATLAS_RECEIVED' THEN 'WAITING_FOR_ARRIVAL'
 WHEN action_id IS NOT NULL THEN 'FINISHING'
 WHEN manual_card_id IS NULL THEN 'RECEIVED'
 WHEN batch_state='REVIEW' THEN 'HUMAN_REVIEW' ELSE 'GRADING' END progress_stage FROM facts)
 SELECT jsonb_build_object('stage',CASE WHEN discarded OR (batch_state='NEEDS_ATTENTION' AND progress_stage NOT IN ('FINISHING','RETURNING','COMPLETE')) THEN 'ATTENTION' ELSE progress_stage END,
 'progressStage',progress_stage,'attention',COALESCE(delayed,false) OR discarded OR COALESCE(batch_state='NEEDS_ATTENTION',false),
 'custody',custody,'manualCardId',manual_card_id,'approvedAt',approved_at,'approvalActionId',action_id,
 'grading',jsonb_build_object('state',CASE WHEN action_id IS NOT NULL THEN 'HUMAN_APPROVED' WHEN manual_card_id IS NULL THEN 'NOT_STARTED' WHEN batch_state='REVIEW' THEN 'HUMAN_REVIEW' ELSE 'IN_GRADING' END,
 'batchState',batch_state,'batchStage',batch_stage,'code',batch_code,'discarded',discarded)) FROM progress
$$;

CREATE FUNCTION atlas_dealer.order_desk_group(stages jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage'='WAITING_FOR_ARRIVAL') THEN 'ARRIVAL'
 WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage'='RECEIVED') THEN 'RECEIVED'
 WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage' IN ('GRADING','HUMAN_REVIEW')) THEN 'GRADING_REVIEW'
 WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage' IN ('FINISHING','READY_FOR_RETURN')) THEN 'FINISHING_PACKING'
 WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage'='RETURNING') THEN 'RETURNING'
 WHEN jsonb_array_length(stages)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(stages) e WHERE e->>'progressStage'<>'COMPLETE') THEN 'COMPLETE' ELSE 'ARRIVAL' END
$$;

CREATE FUNCTION atlas_dealer.order_desk_summary(oid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 WITH facts AS (SELECT COALESCE(jsonb_agg(atlas_dealer.order_desk_card_state(card_id) ORDER BY card_id),'[]'::jsonb) states,count(*) n FROM atlas_dealer.order_card WHERE order_id=oid)
 SELECT jsonb_build_object('id',o.id,'reference',o.reference,'paidAt',o."paidAt",'channel',o.receipt->>'channel',
 'customer',jsonb_build_object('name',o.receipt->'profile'->>'name','email',o.receipt->'profile'->>'email','phone',q.snapshot->>'phone'),
 'cardCount',f.n,'stage',CASE WHEN f.n=0 THEN 'ATTENTION' WHEN (SELECT count(DISTINCT e->>'stage') FROM jsonb_array_elements(f.states) e)>1 THEN 'MIXED' ELSE f.states->0->>'stage' END,
 'mixedStages',(SELECT count(DISTINCT e->>'stage') FROM jsonb_array_elements(f.states) e)>1,'group',atlas_dealer.order_desk_group(f.states),
 'attentionCount',(SELECT count(*) FROM jsonb_array_elements(f.states) e WHERE e->>'attention'='true'),
 'stageCounts',COALESCE((SELECT jsonb_object_agg(stage,n) FROM (SELECT e->>'stage' stage,count(*) n FROM jsonb_array_elements(f.states) e GROUP BY e->>'stage') c),'{}'::jsonb),
 'acknowledgment',atlas_dealer.order_inbox_acknowledgment_projection(o.id),
 'gradingPayment',jsonb_build_object('state','PAID','currency',o.receipt->>'currency','totalCents',o.receipt->'totalCents'),
 'shippingPayment',jsonb_build_object('state',CASE WHEN o.receipt->>'channel'='KIOSK' THEN 'NOT_APPLICABLE'
 WHEN o.receipt->'terms'->>'shippingPayment'='SEPARATE_PAYMENT' THEN COALESCE(atlas_customer.commerce_shipping_public_state(o.id)->>'state','UNQUOTED_UNPAID')
 WHEN jsonb_array_length(COALESCE(o.receipt->'shipping','[]'::jsonb))>0 THEN 'INCLUDED_IN_GRADING_PAYMENT' ELSE 'NOT_RECORDED' END))
 FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommerceQuote" q ON q.id=o."quoteId" CROSS JOIN facts f WHERE o.id=oid
$$;

-- Validated printable bytes are required even for the READY display state.
CREATE FUNCTION atlas_dealer.order_desk_label_valid(e atlas_customer."CommerceEffect") RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE bytes bytea;
BEGIN
 IF e.kind NOT IN ('FEDEX_LABEL','SHIPSTATION_LABEL') OR e.state<>'SUCCEEDED'
 OR e.request->>'orderId' IS DISTINCT FROM e."orderId"::text OR COALESCE(e.request->>'leg','') NOT IN ('INBOUND','RETURN')
 OR e.id IS DISTINCT FROM (e."orderId"::text||(CASE WHEN e.kind='SHIPSTATION_LABEL' THEN ':shipstation:' ELSE ':fedex:' END)||(e.request->>'leg')||':v1')
 OR e.result->>'provider' IS DISTINCT FROM (CASE WHEN e.kind='SHIPSTATION_LABEL' THEN 'SHIPSTATION' ELSE 'FEDEX' END)
 OR e.result->>'requestHash' IS DISTINCT FROM atlas_customer.commerce_hash(e.request->'shipment')
 OR e.result->>'mimeType' IS DISTINCT FROM 'application/pdf'
 OR NOT COALESCE(length(e.result->>'labelBase64') BETWEEN 8 AND 5592408 AND e.result->>'labelBase64' ~ '^[A-Za-z0-9+/]+={0,2}$',false) THEN RETURN false; END IF;
 bytes:=decode(e.result->>'labelBase64','base64');
 RETURN octet_length(bytes)<=4194304 AND substring(bytes FROM 1 FOR 5)=convert_to('%PDF-','UTF8') AND encode(sha256(bytes),'hex')=e.result->>'labelSha256';
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION atlas_dealer.order_desk_shipping(oid uuid,leg text) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE((SELECT jsonb_build_object('state',e.state,'artifactState',CASE WHEN atlas_dealer.order_desk_label_valid(e) THEN 'READY' ELSE 'PENDING' END,
 'trackingNumber',CASE WHEN atlas_dealer.order_desk_label_valid(e) THEN e.result->>'trackingNumber' END,
 'carrierName',e.result->>'carrierName','serviceName',e.result->>'serviceName',
 'prepared',e.fulfillment IS NOT NULL,'preparedRequestId',e.fulfillment->>'requestId',
 'canPrepare',leg='RETURN' AND e.kind='SHIPSTATION_LABEL' AND e.state='PENDING' AND e.fulfillment IS NULL AND atlas_customer.commerce_return_ready(oid),
 'labelUrl',CASE WHEN atlas_dealer.order_desk_label_valid(e) THEN CASE WHEN leg='RETURN' THEN '/api/staff/manual-connected/dealer-operations/orders/'||oid||'/return-label'
 ELSE '/api/staff/manual-connected/order-desk/orders/'||oid||'/labels/INBOUND' END END)
 FROM atlas_customer."CommerceEffect" e WHERE e."orderId"=oid AND e.kind IN ('FEDEX_LABEL','SHIPSTATION_LABEL') AND e.request->>'leg'=leg
 AND e.id=oid::text||CASE WHEN e.kind='SHIPSTATION_LABEL' THEN ':shipstation:' ELSE ':fedex:' END||leg||':v1' ORDER BY e."createdAt" DESC,e.id LIMIT 1),
 jsonb_build_object('state','NOT_REQUESTED','artifactState','PENDING','trackingNumber',NULL,'prepared',false,'preparedRequestId',NULL,'canPrepare',false,'labelUrl',NULL))
$$;

CREATE FUNCTION atlas_dealer.order_desk_detail(oid uuid,actor uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT atlas_dealer.order_desk_summary(o.id)||jsonb_build_object(
 'customer',jsonb_build_object('name',o.receipt->'profile'->>'name','email',o.receipt->'profile'->>'email','phone',q.snapshot->>'phone',
 'returnAddress',atlas_customer.commerce_public_fields(o.receipt->'profile',ARRAY['name','address1','address2','city','region','postalCode','country'])),
 'payments',jsonb_build_object('grading',jsonb_build_object('state','PAID','paidAt',o."paidAt",'receipt',atlas_customer.commerce_public_quote(o.receipt)),
 'shipping',jsonb_build_object('state',atlas_dealer.order_desk_summary(o.id)->'shippingPayment'->>'state','paidAt',sr."paidAt",'receipt',CASE WHEN sr.id IS NULL THEN NULL ELSE atlas_customer.commerce_public_quote(sr.receipt) END)),
 'shipping',jsonb_build_object('inbound',atlas_dealer.order_desk_shipping(o.id,'INBOUND'),'return',atlas_dealer.order_desk_shipping(o.id,'RETURN')),
 'returnShipping',atlas_dealer.order_desk_shipping(o.id,'RETURN'),
 'cards',COALESCE((SELECT jsonb_agg(atlas_dealer.card_tracking_with_handoff(c.card_id)||atlas_dealer.order_desk_card_state(c.card_id)||jsonb_build_object(
 'orderId',c.order_id,'locationId',c.location_id,'identitySource',ic."identitySource",'photos',atlas_dealer.order_desk_photos(c.card_id),
 'staffEvidence',jsonb_build_object('manualCardId',l.manual_card_id,'provenance','STAFF_GRADING_CAPTURE'),
 'finishing',jsonb_build_object('label','NOT_RECORDED','assembly','NOT_RECORDED','welding','NOT_RECORDED','packing','NOT_RECORDED',
 'nfc',CASE WHEN EXISTS(SELECT 1 FROM atlas_manual_connected.station_arm arm JOIN atlas_manual_connected.station_receipt r USING(intent_id)
 WHERE arm.card_id=l.manual_card_id AND arm.approval_action_id=(atlas_dealer.order_desk_card_state(c.card_id)->>'approvalActionId')::uuid
 AND r.kind='WRITE' AND r.receipt::jsonb->>'readbackVerified'='true' AND r.receipt::jsonb->>'lockVerified'='true') THEN 'VERIFIED' ELSE 'NOT_RECORDED' END),
 'custodyEvents',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'requestId',e.request_id,'kind',e.kind,'occurredAt',e.occurred_at,'recordedAt',e.recorded_at,'evidence',e.evidence,'actorId',e.actor_id) ORDER BY e.sequence) FROM atlas_dealer.custody_event e WHERE e.card_id=c.card_id),'[]'::jsonb)) ORDER BY c.card_id)
 FROM atlas_dealer.order_card c JOIN atlas_customer."CustomerIntakeCard" ic ON ic.id=c.card_id LEFT JOIN atlas_dealer.manual_card_link l ON l.card_id=c.card_id WHERE c.order_id=o.id),'[]'::jsonb),
 'manualCards',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'revision',m.revision) ORDER BY m.updated_at DESC,m.id) FROM
 (SELECT id,revision,updated_at FROM atlas_manual.card c WHERE (owner_id=actor OR actor=ANY(editors))
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.card i JOIN atlas_manual_intake.discarded_card x ON x.owner_id=i.owner_id AND x.create_request_id=i.create_request_id WHERE i.id=c.id)
 AND NOT EXISTS(SELECT 1 FROM atlas_dealer.manual_card_link WHERE manual_card_id=c.id) ORDER BY updated_at DESC,id LIMIT 100)m),'[]'::jsonb),
 'history',COALESCE((SELECT jsonb_agg(e ORDER BY e->>'occurredAt',e->>'id') FROM (
 SELECT jsonb_build_object('id','payment:'||o.id,'kind','GRADING_PAYMENT_CONFIRMED','occurredAt',o."paidAt",'recordedAt',o."paidAt",'cardId',NULL,'actor',NULL,'note',NULL) e
 UNION ALL SELECT jsonb_build_object('id','shipping:'||sr.id,'kind','SHIPPING_PAYMENT_CONFIRMED','occurredAt',sr."paidAt",'recordedAt',sr."paidAt",'cardId',NULL,'actor',NULL,'note',NULL) WHERE sr.id IS NOT NULL
 UNION ALL SELECT jsonb_build_object('id','ack:'||ak.order_id,'kind','ORDER_ACKNOWLEDGED','occurredAt',ak.acknowledged_at,'recordedAt',ak.acknowledged_at,'cardId',NULL,'actor',atlas_dealer.order_inbox_acknowledgment_projection(o.id)->'acknowledgedBy','note',NULL) FROM atlas_dealer.order_inbox_acknowledgment ak WHERE ak.order_id=o.id
 UNION ALL SELECT jsonb_build_object('id',ce.id,'kind',ce.kind,'occurredAt',ce.occurred_at,'recordedAt',ce.recorded_at,'cardId',ce.card_id,'actor',CASE WHEN si.id IS NULL THEN NULL ELSE jsonb_build_object('id',si.id,'name',si.name) END,'note',ce.evidence->>'note')
 FROM atlas_dealer.custody_event ce JOIN atlas_dealer.order_card c ON c.card_id=ce.card_id LEFT JOIN atlas_staff."StaffIdentity" si ON si.id=ce.actor_id WHERE c.order_id=o.id
 UNION ALL SELECT jsonb_build_object('id','link:'||l.card_id,'kind','GRADING_CARD_LINKED','occurredAt',l.linked_at,'recordedAt',l.linked_at,'cardId',l.card_id,'actor',jsonb_build_object('id',si.id,'name',si.name),'note',l.evidence_ref)
 FROM atlas_dealer.manual_card_link l JOIN atlas_dealer.order_card c ON c.card_id=l.card_id JOIN atlas_staff."StaffIdentity" si ON si.id=l.actor_id WHERE c.order_id=o.id
 UNION ALL SELECT jsonb_build_object('id','approval:'||a.action_id,'kind','REPORT_HUMAN_APPROVED','occurredAt',a.approved_at,'recordedAt',a.approved_at,'cardId',l.card_id,'actor',jsonb_build_object('id',si.id,'name',si.name),'note',NULL)
 FROM atlas_dealer.manual_card_link l JOIN atlas_dealer.order_card c ON c.card_id=l.card_id JOIN atlas_manual.approval a ON a.card_id=l.manual_card_id JOIN atlas_staff."StaffIdentity" si ON si.id=a.actor_id WHERE c.order_id=o.id
 UNION ALL SELECT jsonb_build_object('id','handoff:'||r.id,'kind','DEALER_RECEIVED','occurredAt',r.received_at,'recordedAt',r.received_at,'cardId',NULL,'actor',NULL,'note',NULL)
 FROM atlas_dealer.handoff h JOIN atlas_dealer.handoff_receipt r ON r.handoff_id=h.id WHERE h.order_id=o.id
 ) history),'[]'::jsonb))
 FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommerceQuote" q ON q.id=o."quoteId" LEFT JOIN atlas_customer."CommerceShippingReceipt" sr ON sr."orderId"=o.id WHERE o.id=oid
$$;

CREATE FUNCTION atlas_dealer.order_desk_call(action text,session_hash text,browser_hash text,binding jsonb,phones text[],d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor record; oid uuid; cid uuid; row record; cursor_row record; item jsonb; items jsonb:='[]'; n integer:=0; lim integer; last_id uuid; q text; stage text; view_name text; counts jsonb; source jsonb;
 all_count integer:=0;new_count integer:=0;counter_key text;
 groups jsonb:='{"ARRIVAL":0,"RECEIVED":0,"GRADING_REVIEW":0,"FINISHING_PACKING":0,"RETURNING":0,"COMPLETE":0}';
 stages jsonb:='{"WAITING_FOR_ARRIVAL":0,"RECEIVED":0,"GRADING":0,"HUMAN_REVIEW":0,"FINISHING":0,"READY_FOR_RETURN":0,"RETURNING":0,"COMPLETE":0,"ATTENTION":0}';
BEGIN
 SELECT * INTO actor FROM atlas_manual.authenticate(session_hash,browser_hash,binding,phones);
 IF actor.id IS NULL OR actor.role<>'REVIEWER' THEN RETURN atlas_customer.problem(403,'STAFF_REQUIRED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>2048 THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_DESK_REQUEST'); END IF;
 IF action='list' THEN
  IF d-ARRAY['q','stage','view','cursor','limit']<>'{}'::jsonb OR jsonb_typeof(d->'q') IS DISTINCT FROM 'string' OR length(d->>'q')>120 OR d->>'q' ~ '[[:cntrl:]]'
  OR COALESCE(d->>'stage','') NOT IN ('','WAITING_FOR_ARRIVAL','RECEIVED','GRADING','HUMAN_REVIEW','FINISHING','READY_FOR_RETURN','RETURNING','COMPLETE','ATTENTION','ARRIVAL','GRADING_REVIEW','FINISHING_PACKING')
  OR COALESCE(d->>'view','') NOT IN ('all','new') OR jsonb_typeof(d->'limit') IS DISTINCT FROM 'number' OR NOT COALESCE(d->>'limit' ~ '^([1-9]|[1-4][0-9]|50)$',false)
  THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_DESK_REQUEST'); END IF;
  q:=btrim(d->>'q');stage:=d->>'stage';view_name:=d->>'view';lim:=(d->>'limit')::integer;
  IF d->>'cursor' IS NOT NULL THEN
   IF NOT COALESCE(d->>'cursor' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false) THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_DESK_REQUEST'); END IF;
   SELECT id,"paidAt" INTO cursor_row FROM atlas_customer."CommerceOrder" WHERE id=(d->>'cursor')::uuid AND atlas_dealer.order_desk_paid(id);
   IF cursor_row.id IS NULL THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_CURSOR'); END IF;
  ELSE SELECT NULL::uuid id,NULL::timestamptz "paidAt" INTO cursor_row; END IF;
  -- Search is literal, including percent/underscore characters; no caller SQL.
  FOR row IN SELECT o.id,o."paidAt" FROM atlas_customer."CommerceOrder" o JOIN atlas_customer."CommerceQuote" cq ON cq.id=o."quoteId"
   WHERE atlas_dealer.order_desk_paid(o.id) AND (q='' OR position(lower(q) IN lower(concat_ws(' ',o.reference,o.receipt->'profile'->>'name',o.receipt->'profile'->>'email',cq.snapshot->>'phone')))>0
   OR EXISTS(SELECT 1 FROM atlas_dealer.order_card c WHERE c.order_id=o.id AND position(lower(q) IN lower(concat_ws(' ',c.paid_line->'identity'->>'title',c.paid_line->'identity'->>'playerName',c.paid_line->'identity'->>'setName',c.paid_line->'identity'->>'cardNumber')))>0))
   ORDER BY o."paidAt" DESC,o.id DESC LOOP
   item:=atlas_dealer.order_desk_summary(row.id);all_count:=all_count+1;
   IF item->'acknowledgment'='null'::jsonb THEN new_count:=new_count+1; END IF;
   IF view_name='new' AND item->'acknowledgment'<>'null'::jsonb THEN CONTINUE; END IF;
   counter_key:=item->>'group';groups:=jsonb_set(groups,ARRAY[counter_key],to_jsonb((groups->>counter_key)::integer+1));
   FOR counter_key IN SELECT jsonb_object_keys(item->'stageCounts') LOOP
    stages:=jsonb_set(stages,ARRAY[counter_key],to_jsonb(COALESCE((stages->>counter_key)::integer,0)+1));
   END LOOP;
   IF stage<>'' AND NOT (CASE WHEN stage IN ('ARRIVAL','RECEIVED','GRADING_REVIEW','FINISHING_PACKING','RETURNING','COMPLETE') THEN item->>'group'=stage ELSE item->'stageCounts' ? stage END) THEN CONTINUE; END IF;
   IF cursor_row.id IS NOT NULL AND (row."paidAt",row.id)>=(cursor_row."paidAt",cursor_row.id) THEN CONTINUE; END IF;
   n:=n+1;IF n<=lim THEN
    item:=item||jsonb_build_object('photoCards',COALESCE((SELECT jsonb_agg(jsonb_build_object('cardId',c.card_id,'title',c.paid_line->'identity'->>'title','photos',atlas_dealer.order_desk_photos(c.card_id)) ORDER BY c.card_id)
     FROM (SELECT * FROM atlas_dealer.order_card WHERE order_id=row.id ORDER BY card_id LIMIT 3)c),'[]'::jsonb));
    items:=items||jsonb_build_array(item);last_id:=row.id;
   END IF;
  END LOOP;
  counts:=jsonb_build_object('all',all_count,'new',new_count,'groups',groups,'stages',stages);
  RETURN jsonb_build_object('schemaVersion',1,'orders',items,'counts',counts,'nextCursor',CASE WHEN n>lim THEN last_id ELSE NULL END);
 END IF;
 IF action NOT IN ('detail','photo_source','label') THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF NOT COALESCE(d->>'orderId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false) THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_DESK_REQUEST'); END IF;
 oid:=(d->>'orderId')::uuid;
 IF NOT atlas_dealer.order_desk_paid(oid) THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF action='detail' THEN
  IF d-ARRAY['orderId']<>'{}'::jsonb THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_DESK_REQUEST'); END IF;
  RETURN jsonb_build_object('schemaVersion',1,'order',atlas_dealer.order_desk_detail(oid,actor.id));
 ELSIF action='label' THEN
  IF d-ARRAY['orderId','leg']<>'{}'::jsonb OR COALESCE(d->>'leg','') NOT IN ('INBOUND','RETURN') THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_DESK_REQUEST'); END IF;
  RETURN COALESCE((SELECT jsonb_build_object('orderId',oid,'leg',d->>'leg','mimeType','application/pdf','labelBase64',e.result->>'labelBase64','labelSha256',e.result->>'labelSha256')
   FROM atlas_customer."CommerceEffect" e WHERE e."orderId"=oid AND e.request->>'leg'=d->>'leg' AND atlas_dealer.order_desk_label_valid(e) ORDER BY e."createdAt" DESC,e.id LIMIT 1),atlas_customer.problem(409,'LABEL_NOT_READY'));
 END IF;
 IF d-ARRAY['orderId','cardId','side']<>'{}'::jsonb OR NOT COALESCE(d->>'cardId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false)
 OR COALESCE(d->>'side','') NOT IN ('FRONT','BACK') THEN RETURN atlas_customer.problem(400,'INVALID_ORDER_DESK_REQUEST'); END IF;
 cid:=(d->>'cardId')::uuid;
 SELECT jsonb_build_object('orderId',oid,'uploadId',u.id,'paidPhotoPairHash',c.paid_line->>'photoPairHash','photoPairHash',atlas_dealer.order_desk_pair_hash(cid),'upload',atlas_customer.intake_upload_projection(u.id)) INTO source
 FROM atlas_dealer.order_card c JOIN atlas_customer."CommerceOrder" o ON o.id=c.order_id
 JOIN atlas_customer."CustomerIntakeCard" ic ON ic.id=c.card_id AND ic."draftId"=o."draftId"
 JOIN atlas_customer."CustomerIntakeDraft" draft ON draft.id=ic."draftId" AND draft."accountId"=o."accountId"
 JOIN atlas_customer."CustomerIntakeUpload" u ON u."cardId"=ic.id AND u.side=d->>'side'
 WHERE c.order_id=oid AND c.card_id=cid;
 IF source IS NULL THEN RETURN atlas_customer.problem(404,'NOT_FOUND'); END IF;
 IF source->>'photoPairHash' IS NULL OR source->>'photoPairHash' IS DISTINCT FROM source->>'paidPhotoPairHash' THEN RETURN atlas_customer.problem(409,'ORDER_PHOTO_BINDING_CHANGED'); END IF;
 RETURN source;
END $$;

REVOKE ALL ON FUNCTION atlas_dealer.order_desk_paid(uuid),atlas_dealer.order_desk_pair_hash(uuid),atlas_dealer.order_desk_photos(uuid),atlas_dealer.order_desk_card_state(uuid),atlas_dealer.order_desk_group(jsonb),atlas_dealer.order_desk_summary(uuid),atlas_dealer.order_desk_label_valid(atlas_customer."CommerceEffect"),atlas_dealer.order_desk_shipping(uuid,text),atlas_dealer.order_desk_detail(uuid,uuid),atlas_dealer.order_desk_call(text,text,text,jsonb,text[],jsonb) FROM PUBLIC;
COMMIT;
