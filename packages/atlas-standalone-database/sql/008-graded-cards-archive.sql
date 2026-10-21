-- Additive staff archive. Existing physical cards, approvals, report identities,
-- media and submission evidence stay authoritative; no backfill or data writes.
CREATE INDEX graded_cards_approval_order ON atlas_manual.approval(card_id,approved_at DESC,action_id DESC);

CREATE FUNCTION atlas_manual.graded_cards(session_hash text,browser_hash text,binding jsonb,phones text[],d jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE actor record; q text; requested_category text; from_day date; to_day date; lim integer; snap timestamptz;
 after_at timestamptz; after_card uuid; items jsonb; last_item jsonb; has_more boolean;
BEGIN
 SELECT * INTO actor FROM atlas_manual.authenticate(session_hash,browser_hash,binding,phones);
 IF actor.id IS NULL OR actor.role<>'REVIEWER' THEN RETURN atlas_customer.problem(403,'STAFF_REQUIRED'); END IF;
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>2048
 OR d-ARRAY['q','category','from','to','limit','page']<>'{}'::jsonb
 OR jsonb_typeof(d->'q') IS DISTINCT FROM 'string' OR length(d->>'q')>120 OR d->>'q' ~ '[[:cntrl:]]'
 OR COALESCE(d->>'category','!') NOT IN ('','SPORTS','POKEMON')
 OR jsonb_typeof(d->'from') IS DISTINCT FROM 'string' OR jsonb_typeof(d->'to') IS DISTINCT FROM 'string'
 OR jsonb_typeof(d->'limit') IS DISTINCT FROM 'number' OR NOT COALESCE(d->>'limit' ~ '^([1-9]|[1-4][0-9]|50)$',false)
 THEN RETURN atlas_customer.problem(400,'INVALID_GRADED_CARDS_QUERY'); END IF;
 q:=btrim(d->>'q'); requested_category:=d->>'category'; lim:=(d->>'limit')::integer;
 BEGIN
  IF d->>'from'<>'' THEN
   IF d->>'from' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'invalid date'; END IF;
   from_day:=(d->>'from')::date;
  END IF;
  IF d->>'to'<>'' THEN
   IF d->>'to' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'invalid date'; END IF;
   to_day:=(d->>'to')::date;
  END IF;
  IF from_day>to_day THEN RAISE EXCEPTION 'invalid range'; END IF;
  IF d->'page' IS NOT NULL AND d->'page'<>'null'::jsonb THEN
   IF jsonb_typeof(d->'page')<>'object' OR (d->'page')-ARRAY['v','filter','snapshot','approvedAt','cardId']<>'{}'::jsonb
    OR d#>>'{page,v}' IS DISTINCT FROM '1'
    OR NOT COALESCE(d#>>'{page,filter}' ~ '^[a-f0-9]{64}$',false)
    OR NOT COALESCE(d#>>'{page,snapshot}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$',false)
    OR NOT COALESCE(d#>>'{page,approvedAt}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$',false)
    OR NOT COALESCE(d#>>'{page,cardId}' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false)
    THEN RAISE EXCEPTION 'invalid cursor'; END IF;
   snap:=(d#>>'{page,snapshot}')::timestamptz; after_at:=(d#>>'{page,approvedAt}')::timestamptz; after_card:=(d#>>'{page,cardId}')::uuid;
   IF snap>statement_timestamp() OR after_at>snap THEN RAISE EXCEPTION 'invalid cursor'; END IF;
  ELSE snap:=statement_timestamp(); END IF;
 EXCEPTION WHEN OTHERS THEN RETURN atlas_customer.problem(400,'INVALID_GRADED_CARDS_QUERY'); END;

 -- Latest approval at a fixed high-water time, one physical card per row.
 -- New approvals cannot move existing rows between pages. Current access and
 -- discard state are still checked on every page, regardless of that snapshot.
 WITH approved AS MATERIALIZED (
  SELECT c.id,c.owner_id,c.approvers,a.*,p.version,p.state,p.public_hash,i.public_token,i.report_number,
   a.report::jsonb->'identity' identity,
   CASE WHEN a.report::jsonb->'identity' ? 'playerName' AND NOT a.report::jsonb->'identity' ? 'cardName' THEN 'SPORTS'
    WHEN a.report::jsonb->'identity' ? 'cardName' AND NOT a.report::jsonb->'identity' ? 'playerName' THEN 'POKEMON' END category,
   si.name approver_name
  FROM atlas_manual.card c JOIN atlas_manual_intake.card intake ON intake.id=c.id
  CROSS JOIN LATERAL(SELECT aa.* FROM atlas_manual.approval aa WHERE aa.card_id=c.id AND aa.approved_at<=snap
   ORDER BY aa.approved_at DESC,aa.action_id DESC LIMIT 1)a
  JOIN atlas_manual.publication p USING(card_id,action_id) JOIN atlas_manual.public_report_identity i USING(card_id)
  JOIN atlas_staff."StaffIdentity" si ON si.id=a.actor_id
  WHERE p.mode=binding->>'mode' AND (c.owner_id=actor.id OR actor.id=ANY(c.readers) OR actor.id=ANY(c.editors) OR actor.id=ANY(c.approvers))
   AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x WHERE x.card_id=c.id OR (x.owner_id=intake.owner_id AND x.create_request_id=intake.create_request_id))
 ), facts AS (
  SELECT a.*,review.people reviewers,submitted.value submission
  FROM approved a
  LEFT JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('id',r.id,'name',r.name) ORDER BY r.name,r.id) people
   FROM(SELECT DISTINCT si.id,si.name FROM atlas_manual.action act JOIN atlas_staff."StaffIdentity" si ON si.id=act.actor_id
    WHERE act.card_id=a.card_id AND act.result_revision<=a.source_revision
     AND act.result::jsonb#>>'{receipt,actorKind}'='HUMAN' AND act.request::jsonb#>>'{action,type}'<>'APPROVE_REPORT')r)review ON true
  LEFT JOIN LATERAL(SELECT jsonb_build_object('orderId',o.id,'reference',o.reference,'cardId',oc.card_id,
    'customer',jsonb_build_object('name',o.receipt->'profile'->>'name'),'channel',oc.channel,
    'dealer',CASE WHEN oc.dealer_id IS NULL THEN NULL ELSE jsonb_build_object('id',oc.dealer_id,'locationId',oc.location_id,'name',oc.location_snapshot->>'name') END) value
   FROM atlas_dealer.manual_card_link l JOIN atlas_dealer.order_card oc ON oc.card_id=l.card_id
   JOIN atlas_customer."CommerceOrder" o ON o.id=oc.order_id
   WHERE l.manual_card_id=a.card_id AND atlas_dealer.order_desk_paid(o.id))submitted ON true
  WHERE (requested_category='' OR a.category=requested_category)
   AND (from_day IS NULL OR a.approved_at>=from_day::timestamp AT TIME ZONE 'UTC')
   AND (to_day IS NULL OR a.approved_at<(to_day+1)::timestamp AT TIME ZONE 'UTC')
 ), matched AS (
  SELECT f.* FROM facts f
  WHERE (q='' OR position(lower(q) IN lower(concat_ws(' ',f.report_number,
    f.identity->>'playerName',f.identity->>'cardName',f.identity->>'year',f.identity->>'manufacturer',f.identity->>'productSet',
    f.identity->>'parallel',f.identity->>'insert',f.identity->>'cardNumber',to_char(f.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD'),f.approver_name,
    (SELECT string_agg(r->>'name',' ') FROM jsonb_array_elements(COALESCE(f.reviewers,'[]'::jsonb))r),
    f.submission->>'reference',f.submission#>>'{customer,name}',f.submission->>'channel',
    CASE f.submission->>'channel' WHEN 'MAIL_IN' THEN 'mail mail-in' WHEN 'KIOSK' THEN 'dealer drop-off drop off card shop' END,
    f.submission#>>'{dealer,name}')))>0)
   AND (after_card IS NULL OR (f.approved_at,f.card_id)<(after_at,after_card))
  ORDER BY f.approved_at DESC,f.card_id DESC LIMIT lim+1
 ), projected AS (
  SELECT m.approved_at,m.card_id,jsonb_build_object('cardId',m.card_id,'approvalActionId',m.action_id,
   'identity',jsonb_build_object('category',m.category,'playerName',m.identity->'playerName','cardName',m.identity->'cardName',
    'year',m.identity->'year','manufacturer',m.identity->'manufacturer','productSet',m.identity->'productSet',
    'parallel',m.identity->'parallel','insert',m.identity->'insert','cardNumber',m.identity->'cardNumber'),
   'finalGrade',m.report::jsonb->'finalGrade','approvedAt',to_char(m.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'certificateNumber',m.report_number,'approver',jsonb_build_object('id',m.actor_id,'name',m.approver_name),
   'reviewers',COALESCE(m.reviewers,'[]'::jsonb),'submission',m.submission,
   'report',jsonb_build_object('state',m.state,'version',m.version,'publicToken',m.public_token,'reportHash',m.report_hash),
   'mediaEvidence',jsonb_build_object('publicHash',m.public_hash,'sourceRevision',m.source_revision,'sourceHash',m.source_hash,
    'presentation',(SELECT jsonb_build_object('card_id',pr.card_id,'approval_action_id',pr.approval_action_id,'revision',pr.revision,
      'presentation',pr.presentation,'presentation_hash',pr.presentation_hash) FROM atlas_manual.presentation pr
      WHERE pr.card_id=m.card_id AND pr.approval_action_id=m.action_id ORDER BY pr.revision DESC LIMIT 1),
    'labelItem',(SELECT jsonb_build_object('id',li.id,'card_id',li.card_id,'action_id',li.action_id,'approval_version',li.approval_version,
      'state',li.state,'source_revision',li.source_revision,'source_hash',li.source_hash,'report_hash',li.report_hash,'public_hash',li.public_hash,
      'artwork_hash',li.artwork_hash,'renderer_profile_hash',li.renderer_profile_hash,'material_profile_id',li.material_profile_id)
     FROM atlas_manual_connected.label_item li WHERE li.card_id=m.card_id AND li.action_id=m.action_id AND li.actor_id=actor.id
      AND (m.owner_id=actor.id OR actor.id=ANY(m.approvers)) AND li.state='READY' AND li.artwork_hash IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM atlas_manual.publication newer WHERE newer.card_id=m.card_id AND newer.version>m.version)
     ORDER BY li.created_at DESC,li.id DESC LIMIT 1))) item
  FROM (SELECT * FROM matched ORDER BY approved_at DESC,card_id DESC LIMIT lim)m
 ) SELECT COALESCE(jsonb_agg(item ORDER BY approved_at DESC,card_id DESC),'[]'::jsonb),(SELECT count(*)>lim FROM matched)
 INTO items,has_more FROM projected;
 last_item:=items->(jsonb_array_length(items)-1);
 RETURN jsonb_build_object('schemaVersion',1,'cards',items,'page',CASE WHEN has_more THEN jsonb_build_object(
  'snapshot',to_char(snap AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'approvedAt',last_item->>'approvedAt','cardId',last_item->>'cardId') ELSE NULL END);
END $function$;
REVOKE ALL ON FUNCTION atlas_manual.graded_cards(text,text,jsonb,text[],jsonb) FROM PUBLIC;
