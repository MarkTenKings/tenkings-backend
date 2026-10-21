-- Additive, read-only permanent-card provenance. Existing immutable approvals,
-- one-way published reports, custody events and card links remain the journals.
-- No GET backfill, inferred ownership, custody write or historical rewrite.
CREATE FUNCTION atlas_manual.card_provenance(session_hash text,browser_hash text,binding jsonb,phones text[],d jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE actor record; cid uuid; lim integer; snap timestamptz; after_at timestamptz; after_event text;
 card_value jsonb; items jsonb; latest_custody jsonb; has_more boolean; last_item jsonb;
BEGIN
 SELECT * INTO actor FROM atlas_manual.authenticate(session_hash,browser_hash,binding,phones);
 IF actor.id IS NULL OR actor.role<>'REVIEWER' THEN RETURN atlas_customer.problem(403,'STAFF_REQUIRED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>2048
  OR d-ARRAY['cardId','limit','page']<>'{}'::jsonb
  OR jsonb_typeof(d->'cardId') IS DISTINCT FROM 'string'
  OR NOT COALESCE(d->>'cardId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false)
  OR jsonb_typeof(d->'limit') IS DISTINCT FROM 'number' OR NOT COALESCE(d->>'limit' ~ '^([1-9][0-9]?|100)$',false)
 THEN RETURN atlas_customer.problem(400,'INVALID_CARD_PROVENANCE_QUERY'); END IF;
 cid:=(d->>'cardId')::uuid; lim:=(d->>'limit')::integer;
 BEGIN
  IF d->'page' IS NOT NULL AND d->'page'<>'null'::jsonb THEN
   IF jsonb_typeof(d->'page')<>'object' OR (d->'page')-ARRAY['v','cardId','snapshot','recordedAt','eventId']<>'{}'::jsonb
    OR d#>>'{page,v}' IS DISTINCT FROM '1' OR d#>>'{page,cardId}' IS DISTINCT FROM cid::text
    OR NOT COALESCE(d#>>'{page,snapshot}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$',false)
    OR NOT COALESCE(d#>>'{page,recordedAt}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$',false)
    OR NOT COALESCE(d#>>'{page,eventId}' ~ '^(approval|publication|custody):[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false)
   THEN RAISE EXCEPTION 'invalid cursor'; END IF;
   snap:=(d#>>'{page,snapshot}')::timestamptz; after_at:=(d#>>'{page,recordedAt}')::timestamptz; after_event:=d#>>'{page,eventId}';
   IF snap>statement_timestamp() OR after_at>snap THEN RAISE EXCEPTION 'invalid cursor'; END IF;
  ELSE snap:=statement_timestamp(); END IF;
 EXCEPTION WHEN OTHERS THEN RETURN atlas_customer.problem(400,'INVALID_CARD_PROVENANCE_QUERY'); END;

 -- Current card ACL and discard checks apply on every page, including a cursor
 -- issued before access changed. Staff owner_id is solely an access-control fact.
 SELECT jsonb_build_object('cardId',c.id,'certificateNumber',i.report_number,'approvalActionId',a.action_id,
  'approvedAt',to_char(a.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'identity',a.report::jsonb->'identity','finalGrade',a.report::jsonb->'finalGrade','approvedSnapshot',a.report,
  'approver',jsonb_build_object('id',a.actor_id,'name',si.name),'reviewers',COALESCE(review.people,'[]'::jsonb),'submission',submitted.value,
  'presentationEvidence',(SELECT jsonb_build_object('card_id',pr.card_id,'approval_action_id',pr.approval_action_id,'revision',pr.revision,
    'createdAt',to_char(pr.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'presentation',pr.presentation,'presentation_hash',pr.presentation_hash,'market_source',pr.market_source,'market_source_hash',pr.market_source_hash)
    FROM atlas_manual.presentation pr WHERE pr.card_id=c.id AND pr.approval_action_id=a.action_id AND pr.created_at<=snap
    ORDER BY pr.revision DESC LIMIT 1),
  'report',jsonb_build_object('state',CASE WHEN p.state='PUBLISHED' AND p.published_at<=snap THEN 'PUBLISHED' ELSE 'PENDING' END,
    'version',p.version,'publicToken',i.public_token,'reportHash',a.report_hash),
  'mediaEvidence',jsonb_build_object('publicHash',p.public_hash,'sourceRevision',a.source_revision,'sourceHash',a.source_hash))
 INTO card_value
 FROM atlas_manual.card c JOIN atlas_manual_intake.card intake ON intake.id=c.id
 JOIN atlas_manual.public_report_identity i ON i.card_id=c.id
 CROSS JOIN LATERAL(SELECT aa.*,pp.version,pp.state,pp.public_hash,pp.published_at FROM atlas_manual.approval aa
  JOIN atlas_manual.publication pp USING(card_id,action_id)
  WHERE aa.card_id=c.id AND aa.approved_at<=snap AND pp.mode=binding->>'mode'
  ORDER BY aa.approved_at DESC,aa.action_id DESC LIMIT 1)a
 JOIN atlas_manual.publication p ON p.card_id=c.id AND p.action_id=a.action_id
 JOIN atlas_staff."StaffIdentity" si ON si.id=a.actor_id
 LEFT JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',r.name) ORDER BY r.name,r.id) people
  FROM(SELECT DISTINCT reviewer.id,reviewer.name FROM atlas_manual.action act JOIN atlas_staff."StaffIdentity" reviewer ON reviewer.id=act.actor_id
   WHERE act.card_id=c.id AND act.result_revision<=a.source_revision
    AND act.result::jsonb#>>'{receipt,actorKind}'='HUMAN' AND act.request::jsonb#>>'{action,type}'<>'APPROVE_REPORT'
   ORDER BY reviewer.name,reviewer.id LIMIT 100)r)review ON true
 LEFT JOIN LATERAL(SELECT jsonb_build_object('orderId',o.id,'reference',o.reference,'cardId',oc.card_id,
   'customer',jsonb_build_object('name',o.receipt->'profile'->>'name'),'channel',oc.channel,
   'dealer',CASE WHEN oc.dealer_id IS NULL THEN NULL ELSE jsonb_build_object('id',oc.dealer_id,'locationId',oc.location_id,'name',oc.location_snapshot->>'name') END) value
  FROM atlas_dealer.manual_card_link l JOIN atlas_dealer.order_card oc ON oc.card_id=l.card_id
  JOIN atlas_dealer.custody_event received ON received.id=l.received_event_id AND received.card_id=l.card_id AND received.kind='ATLAS_RECEIVED'
  JOIN atlas_customer."CommerceOrder" o ON o.id=oc.order_id
  WHERE l.manual_card_id=c.id AND l.linked_at<=snap AND received.recorded_at<=snap AND o."paidAt"<=snap AND atlas_dealer.order_desk_paid(o.id))submitted ON true
 WHERE c.id=cid AND (c.owner_id=actor.id OR actor.id=ANY(c.readers) OR actor.id=ANY(c.editors) OR actor.id=ANY(c.approvers))
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.card_id=c.id OR (x.owner_id=intake.owner_id AND x.create_request_id=intake.create_request_id));
 IF card_value IS NULL THEN RETURN atlas_customer.problem(404,'CARD_PROVENANCE_NOT_FOUND'); END IF;

 -- Approval and publication are separate events: publishing an approved report
 -- appends a fact instead of changing the payload of its approval event.
 WITH approvals AS MATERIALIZED (
  SELECT a.*,p.version,p.state,p.public_hash,p.manifest_hash,p.published_at
  FROM atlas_manual.approval a JOIN atlas_manual.publication p USING(card_id,action_id)
  WHERE a.card_id=cid AND a.approved_at<=snap AND p.mode=binding->>'mode'
 ), linked AS MATERIALIZED (
  SELECT l.* FROM atlas_dealer.manual_card_link l
  JOIN atlas_dealer.custody_event received ON received.id=l.received_event_id AND received.card_id=l.card_id AND received.kind='ATLAS_RECEIVED'
  WHERE l.manual_card_id=cid AND l.linked_at<=snap
 ), events AS (
  SELECT a.approved_at recorded_at,'approval:'||a.action_id event_id,
   jsonb_build_object('eventId','approval:'||a.action_id,'kind','REPORT_APPROVED','category','GRADING','verification','VERIFIED_RECORD',
    'occurredAt',to_char(a.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'recordedAt',to_char(a.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'source',jsonb_build_object('type','APPROVAL','cardId',cid,'approvalActionId',a.action_id,'sourceRevision',a.source_revision,'sourceHash',a.source_hash,'reportHash',a.report_hash),
    'report',jsonb_build_object('version',a.version,'finalGrade',a.report::jsonb->'finalGrade',
      'approvedAt',to_char(a.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) item
  FROM approvals a
  UNION ALL
  SELECT a.published_at,'publication:'||a.action_id,
   jsonb_build_object('eventId','publication:'||a.action_id,'kind','REPORT_PUBLISHED','category','GRADING','verification','VERIFIED_RECORD',
    'occurredAt',to_char(a.published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'recordedAt',to_char(a.published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'source',jsonb_build_object('type','PUBLICATION','cardId',cid,'approvalActionId',a.action_id,'reportHash',a.report_hash,'publicHash',a.public_hash,'manifestHash',a.manifest_hash),
    'report',jsonb_build_object('version',a.version,'finalGrade',a.report::jsonb->'finalGrade','publicHash',a.public_hash,
      'approvedAt',to_char(a.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))
  FROM approvals a WHERE a.state='PUBLISHED' AND a.published_at<=snap
  UNION ALL
  SELECT e.recorded_at,'custody:'||e.id,
   jsonb_build_object('eventId','custody:'||e.id,'kind',e.kind,'category','CUSTODY',
    'verification',CASE WHEN e.kind='DEPOSIT_DECLARED' THEN 'SUBMITTER_REPORTED' ELSE 'VERIFIED_RECORD' END,
    'occurredAt',to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'recordedAt',to_char(e.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'sequence',e.sequence,
    'source',jsonb_build_object('type','CUSTODY','cardId',cid,'submissionCardId',e.card_id,'eventId',e.id,'inputHash',e.input_hash,
      'receivedEventId',l.received_event_id,'linkedAt',to_char(l.linked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))
  FROM linked l JOIN atlas_dealer.custody_event e ON e.card_id=l.card_id WHERE e.recorded_at<=snap
 ), matched AS MATERIALIZED (
  SELECT * FROM events WHERE after_event IS NULL OR (recorded_at,event_id)<(after_at,after_event)
  ORDER BY recorded_at DESC,event_id DESC LIMIT lim+1
 ) SELECT COALESCE(jsonb_agg(item ORDER BY recorded_at DESC,event_id DESC),'[]'::jsonb),(SELECT count(*)>lim FROM matched)
 INTO items,has_more FROM (SELECT * FROM matched ORDER BY recorded_at DESC,event_id DESC LIMIT lim) page;

 -- The last recorded physical handoff is not a live guarantee of location or
 -- ownership. Labels, tracking preparation, planned dates and delay notes do
 -- not advance physical custody; customer deposit declarations are reports.
 SELECT jsonb_build_object('eventId','custody:'||e.id,'kind',e.kind,'sequence',e.sequence,
  'occurredAt',to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'recordedAt',to_char(e.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) INTO latest_custody
 FROM atlas_dealer.manual_card_link l
 JOIN atlas_dealer.custody_event received ON received.id=l.received_event_id AND received.card_id=l.card_id AND received.kind='ATLAS_RECEIVED'
 JOIN atlas_dealer.custody_event e ON e.card_id=l.card_id
 WHERE l.manual_card_id=cid AND l.linked_at<=snap AND e.recorded_at<=snap AND e.kind NOT IN ('DEPOSIT_DECLARED','DELAY_REPORTED','DELAY_RESOLVED')
 ORDER BY e.sequence DESC LIMIT 1;
 last_item:=items->(jsonb_array_length(items)-1);
 RETURN jsonb_build_object('schemaVersion',1,'card',card_value,'latestCustody',latest_custody,
  'snapshot',to_char(snap AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'events',items,
  'page',CASE WHEN has_more THEN jsonb_build_object('v',1,'cardId',cid,'snapshot',to_char(snap AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'recordedAt',last_item->>'recordedAt','eventId',last_item->>'eventId') ELSE NULL END);
END $function$;
REVOKE ALL ON FUNCTION atlas_manual.card_provenance(text,text,jsonb,text[],jsonb) FROM PUBLIC;
