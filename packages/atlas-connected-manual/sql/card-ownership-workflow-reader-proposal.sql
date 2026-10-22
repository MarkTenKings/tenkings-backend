-- UNREGISTERED LOCAL READER PROPOSAL. Requires unchanged ownership/evidence SQL.
-- No business writes, grants, roles, HTTP routes or operational policy changes.
-- Authentication uses share locks; this is not SET TRANSACTION READ ONLY.
CREATE SCHEMA atlas_ownership_workflow;
REVOKE ALL ON SCHEMA atlas_ownership_workflow FROM PUBLIC;

CREATE FUNCTION atlas_ownership_workflow.input_valid(audience text,act text,d jsonb) RETURNS boolean
 LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE names text[]; k text;
BEGIN
 IF audience NOT IN ('CUSTOMER','REVIEWER') OR act IS NULL THEN RETURN false; END IF;
 names:=CASE WHEN act='resolve_certificate' AND audience='CUSTOMER' THEN ARRAY['certificateNumber']
 WHEN act='read_claim' THEN ARRAY['claimId'] WHEN act='recover_request' THEN ARRAY['requestId']
 WHEN (act='list_claims' AND audience='CUSTOMER') OR (act='list_queue' AND audience='REVIEWER') THEN ARRAY['afterClaimId','limit'] END;
 IF names IS NULL OR jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>1024 OR NOT d ?& names OR d-names<>'{}'::jsonb THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['claimId','requestId'] LOOP
  IF d ? k AND (jsonb_typeof(d->k) IS DISTINCT FROM 'string' OR NOT COALESCE(d->>k ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',false)) THEN RETURN false; END IF;
 END LOOP;
 IF act='resolve_certificate' THEN RETURN jsonb_typeof(d->'certificateNumber')='string' AND d->>'certificateNumber' ~ '^ATLAS-[A-F0-9]{12}$'; END IF;
 IF d ? 'limit' THEN RETURN jsonb_typeof(d->'limit')='number' AND d->>'limit' ~ '^([1-9]|[1-4][0-9]|50)$'
  AND (d->'afterClaimId'='null'::jsonb OR (jsonb_typeof(d->'afterClaimId')='string' AND d->>'afterClaimId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')); END IF;
 RETURN true;
END $$;
CREATE FUNCTION atlas_ownership_workflow.binding_valid(b jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(b) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 RETURN b ?& ARRAY['mode','origin','deploymentId','releaseSha','configHash']
 AND b-ARRAY['mode','origin','deploymentId','releaseSha','configHash']='{}'::jsonb
 AND NOT EXISTS(SELECT 1 FROM jsonb_each(b) e WHERE jsonb_typeof(e.value)<>'string');
END;
$$;

-- Only immutable approved/publication bindings. No mutable intake identity,
-- private label URL, media URL, contact information or inferred title.
CREATE FUNCTION atlas_ownership_workflow.card_binding(cid uuid,mode_name text) RETURNS jsonb
 LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('cardId',i.card_id,'certificateNumber',i.report_number,
 'approvalActionId',p.action_id,'approvalReportHash',a.report_hash,
 'report',jsonb_build_object('publicToken',i.public_token,'version',p.version,'publicHash',p.public_hash))
 FROM atlas_manual.public_report_identity i JOIN atlas_manual_intake.card c ON c.id=i.card_id
 CROSS JOIN LATERAL(SELECT p.card_id,p.action_id,p.version,p.public_hash
  FROM atlas_manual.publication p
  WHERE p.card_id=i.card_id AND p.state='PUBLISHED' AND p.mode=mode_name
  ORDER BY p.version DESC LIMIT 1)p
 JOIN atlas_manual.approval a ON (a.card_id,a.action_id)=(p.card_id,p.action_id)
 WHERE i.card_id=cid AND a.report_hash=encode(sha256(convert_to(a.report,'UTF8')),'hex')
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card x
  WHERE x.card_id=cid OR (x.owner_id=c.owner_id AND x.create_request_id=c.create_request_id))
$$;
CREATE FUNCTION atlas_ownership_workflow.claim_projection(claim_id uuid,viewer uuid,is_reviewer boolean,mode_name text,at_time timestamptz) RETURNS jsonb
 LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE e atlas_ownership.event; decided atlas_ownership.event; m atlas_ownership_evidence.manifest;
 p atlas_ownership_evidence.policy; bound jsonb; title jsonb; decision text; available text;
 ready boolean; result jsonb; review_evidence uuid;
BEGIN
 SELECT * INTO e FROM atlas_ownership.event WHERE id=claim_id AND kind='CLAIM_SUBMITTED';
 IF e.id IS NULL OR (NOT is_reviewer AND e.customer_id<>viewer) THEN RETURN NULL; END IF;
 SELECT * INTO decided FROM atlas_ownership.event WHERE subject_id=e.id AND kind IN ('CLAIM_VERIFIED','CLAIM_REJECTED') ORDER BY sequence DESC LIMIT 1;
 SELECT em.* INTO m FROM atlas_ownership_evidence.manifest em JOIN atlas_ownership_evidence.event_link l ON l.manifest_id=em.id WHERE l.event_id=e.id;
 IF m.id IS NOT NULL AND (m.phase<>'CLAIM' OR m.customer_id<>e.customer_id OR m.card_id<>e.card_id
  OR m.id::text IS DISTINCT FROM e.input#>>'{evidence,referenceId}' OR m.sha256 IS DISTINCT FROM e.input#>>'{evidence,sha256}') THEN m:=NULL; END IF;
 SELECT * INTO p FROM atlas_ownership_evidence.policy WHERE id='active';
 decision:=CASE decided.kind WHEN 'CLAIM_VERIFIED' THEN 'VERIFIED' WHEN 'CLAIM_REJECTED' THEN 'REJECTED' ELSE 'PENDING' END;
 available:=CASE WHEN m.id IS NULL THEN 'UNAVAILABLE' WHEN m.retention_until<=at_time THEN 'EXPIRED'
  WHEN p.enabled IS DISTINCT FROM true OR p.valid_until IS NULL OR p.valid_until<=at_time THEN 'POLICY_UNAVAILABLE'
  WHEN m.policy_revision IS DISTINCT FROM p.revision THEN 'POLICY_CHANGED'
  WHEN NOT atlas_ownership_evidence.manifest_valid(m,p) THEN 'UNAVAILABLE' ELSE 'AVAILABLE' END;
 bound:=atlas_ownership_workflow.card_binding(e.card_id,mode_name); title:=atlas_ownership.current_title(e.card_id);
 ready:=bound IS NOT NULL AND available='AVAILABLE';
 result:=jsonb_build_object('claimId',e.id,'cardId',e.card_id,'requestId',e.request_id,'submittedAt',e.created_at,
  'card',bound,'decision',jsonb_build_object('state',decision,'decidedAt',decided.created_at),
  'evidence',jsonb_build_object('referenceId',m.id,'availability',available,'usableUntil',m.retention_until,'proofKind',m.proof_kind),
  'reviewStatus',CASE WHEN decision<>'PENDING' THEN 'DECIDED' WHEN ready THEN 'PENDING' ELSE 'BLOCKED' END,
  'actions',jsonb_build_object('downloadEvidence',ready));
 IF is_reviewer THEN
  SELECT l.manifest_id INTO review_evidence FROM atlas_ownership_evidence.event_link l WHERE l.event_id=decided.id;
  result:=result||jsonb_build_object('expectedOwnershipRevision',(title->>'revision')::integer,
   'decision',(result->'decision')||jsonb_build_object('evidenceReferenceId',review_evidence),
   'actions',(result->'actions')||jsonb_build_object('verify',ready AND decision='PENDING' AND title->>'status'='UNKNOWN','reject',ready AND decision='PENDING'));
 ELSE
  result:=result||jsonb_build_object('currentlyOwnedByYou',COALESCE(title->>'ownerAccountId'=viewer::text,false));
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION atlas_ownership_workflow.customer_read(sh text,bh text,binding jsonb,act text,d jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a atlas_customer."CustomerAccount"; fresh atlas_customer."CustomerAccount"; p atlas_ownership_evidence.policy;
 claim_row atlas_ownership.event; cid uuid; ids uuid[]; x uuid; next_id uuid; result jsonb; value jsonb; at_time timestamptz; can_submit boolean; lim integer;
BEGIN
 IF act IS NULL OR act NOT IN ('resolve_certificate','list_claims','read_claim','recover_request') THEN RETURN atlas_customer.problem(403,'OWNERSHIP_WORKFLOW_READ_ONLY'); END IF;
 IF atlas_ownership_workflow.input_valid('CUSTOMER',act,d) IS DISTINCT FROM true THEN RETURN atlas_customer.problem(400,'INVALID_OWNERSHIP_WORKFLOW_REQUEST'); END IF;
 IF NOT atlas_ownership_workflow.binding_valid(binding) THEN RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 -- Disabled/expired evidence policy must not erase a customer's claim receipt.
 SELECT * INTO p FROM atlas_ownership_evidence.policy WHERE id='active' FOR SHARE;
 SELECT * INTO a FROM atlas_ownership_evidence.customer_actor(sh,bh,binding);
 IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF act='resolve_certificate' THEN
  SELECT card_id INTO cid FROM atlas_manual.public_report_identity WHERE report_number=d->>'certificateNumber';
  IF cid IS NULL OR NOT atlas_ownership_evidence.lock_card(cid,NULL,binding->>'mode',false) THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
 ELSE
  IF act='list_claims' THEN
   lim:=(d->>'limit')::integer;
   SELECT array_agg(q.id ORDER BY q.id) INTO ids FROM (SELECT e.id FROM atlas_ownership.event e
    WHERE e.customer_id=a.id AND e.kind='CLAIM_SUBMITTED' AND (d->>'afterClaimId' IS NULL OR e.id>(d->>'afterClaimId')::uuid) ORDER BY e.id LIMIT lim+1)q;
   IF cardinality(ids)>lim THEN ids:=ids[1:lim]; next_id:=ids[lim]; END IF;
  ELSE
   SELECT * INTO claim_row FROM atlas_ownership.event WHERE customer_id=a.id AND kind='CLAIM_SUBMITTED'
    AND CASE WHEN act='read_claim' THEN id=(d->>'claimId')::uuid ELSE request_id=(d->>'requestId')::uuid END;
   IF claim_row.id IS NULL THEN RETURN atlas_customer.problem(404,'OWNERSHIP_CLAIM_NOT_FOUND'); END IF;
   ids:=ARRAY[claim_row.id];
  END IF;
  -- Common card-lock order protects discard/source admission while preserving
  -- the customer's historical receipt even when the card is unavailable.
  FOR cid IN SELECT DISTINCT card_id FROM atlas_ownership.event WHERE id=ANY(COALESCE(ids,'{}'::uuid[])) ORDER BY card_id LOOP
   PERFORM atlas_ownership_evidence.lock_card(cid,NULL,binding->>'mode',false);
  END LOOP;
 END IF;
 SELECT * INTO fresh FROM atlas_ownership_evidence.customer_actor(sh,bh,binding);
 IF fresh.id IS NULL OR fresh.id<>a.id THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 at_time:=clock_timestamp();
 IF act='resolve_certificate' THEN
  -- One snapshot derives approved bindings and eligibility. A false value
  -- exposes no competing claimant, current owner or other owner's revision.
  SELECT atlas_ownership_workflow.card_binding(cid,binding->>'mode'),
   p.enabled AND p.valid_until>at_time AND atlas_ownership.current_title(cid)->>'status'='UNKNOWN'
   AND NOT EXISTS(SELECT 1 FROM atlas_ownership.event c WHERE c.card_id=cid AND c.customer_id=a.id AND c.kind='CLAIM_SUBMITTED'
    AND NOT EXISTS(SELECT 1 FROM atlas_ownership.event r WHERE r.subject_id=c.id AND r.kind IN ('CLAIM_VERIFIED','CLAIM_REJECTED')))
  INTO value,can_submit;
  IF value IS NULL THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
  can_submit:=COALESCE(can_submit,false);
  result:=jsonb_build_object('card',value,'canSubmit',can_submit,'expectedOwnershipRevision',CASE WHEN can_submit THEN 0 ELSE NULL END);
 ELSIF act='list_claims' THEN
  SELECT jsonb_build_object('claims',COALESCE(jsonb_agg(atlas_ownership_workflow.claim_projection(q.id,a.id,false,binding->>'mode',at_time) ORDER BY q.id),'[]'::jsonb),'nextClaimId',next_id)
   INTO result FROM unnest(COALESCE(ids,'{}'::uuid[])) q(id);
 ELSE
  SELECT jsonb_build_object('claim',atlas_ownership_workflow.claim_projection(claim_row.id,a.id,false,binding->>'mode',at_time)) INTO result;
  IF act='recover_request' THEN
   SELECT atlas_ownership_evidence.receipt(m,claim_row.id) INTO value FROM atlas_ownership_evidence.manifest m JOIN atlas_ownership_evidence.event_link l ON l.manifest_id=m.id WHERE l.event_id=claim_row.id;
   IF value IS NULL THEN RETURN atlas_customer.problem(503,'OWNERSHIP_WORKFLOW_UNAVAILABLE'); END IF;
   result:=result||jsonb_build_object('receipt',value);
  END IF;
 END IF;
 SELECT * INTO fresh FROM atlas_ownership_evidence.customer_actor(sh,bh,binding);
 IF fresh.id IS NULL OR fresh.id<>a.id THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 RETURN result||jsonb_build_object('actorId',a.id,'observedAt',at_time);
END $$;

CREATE FUNCTION atlas_ownership_workflow.reviewer_read(sh text,bh text,binding jsonb,phones text[],act text,d jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g atlas_ownership_evidence.reviewer_grant; fresh atlas_ownership_evidence.reviewer_grant;
 claim_row atlas_ownership.event; recovery atlas_ownership.event; claimant atlas_customer."CustomerAccount";
 ids uuid[]; allowed uuid[]:='{}'; cid uuid; next_id uuid; lim integer; result jsonb; value jsonb; at_time timestamptz;
BEGIN
 IF act IS NULL OR act NOT IN ('list_queue','read_claim','recover_request') THEN RETURN atlas_customer.problem(403,'OWNERSHIP_WORKFLOW_READ_ONLY'); END IF;
 IF atlas_ownership_workflow.input_valid('REVIEWER',act,d) IS DISTINCT FROM true THEN RETURN atlas_customer.problem(400,'INVALID_OWNERSHIP_WORKFLOW_REQUEST'); END IF;
 IF NOT atlas_ownership_workflow.binding_valid(binding) THEN RETURN atlas_customer.problem(403,'OWNERSHIP_REVIEW_REQUIRED'); END IF;
 SELECT * INTO g FROM atlas_ownership_evidence.reviewer_actor(sh,bh,binding,phones);
 IF g.id IS NULL THEN RETURN atlas_customer.problem(403,'OWNERSHIP_REVIEW_REQUIRED'); END IF;
 IF act='list_queue' THEN
  lim:=(d->>'limit')::integer;
  SELECT array_agg(q.id ORDER BY q.id) INTO ids FROM (SELECT e.id FROM atlas_ownership.event e
   JOIN atlas_manual.card c ON c.id=e.card_id JOIN atlas_customer."CustomerAccount" a ON a.id=e.customer_id
   WHERE e.kind='CLAIM_SUBMITTED' AND e.customer_id<>g.customer_account_id AND a."revokedAt" IS NULL
   AND (c.owner_id=g.staff_id OR g.staff_id=ANY(c.readers) OR g.staff_id=ANY(c.editors) OR g.staff_id=ANY(c.approvers))
   AND NOT EXISTS(SELECT 1 FROM atlas_ownership.event r WHERE r.subject_id=e.id AND r.kind IN ('CLAIM_VERIFIED','CLAIM_REJECTED'))
   AND (d->>'afterClaimId' IS NULL OR e.id>(d->>'afterClaimId')::uuid) ORDER BY e.id LIMIT lim+1)q;
  IF cardinality(ids)>lim THEN ids:=ids[1:lim]; next_id:=ids[lim]; END IF;
 ELSE
  IF act='recover_request' THEN
   SELECT * INTO recovery FROM atlas_ownership.event WHERE staff_id=g.staff_id AND request_id=(d->>'requestId')::uuid AND kind IN ('CLAIM_VERIFIED','CLAIM_REJECTED');
   IF recovery.id IS NULL THEN RETURN atlas_customer.problem(404,'OWNERSHIP_CLAIM_NOT_FOUND'); END IF;
   cid:=recovery.subject_id;
  ELSE cid:=(d->>'claimId')::uuid; END IF;
  SELECT * INTO claim_row FROM atlas_ownership.event WHERE id=cid AND kind='CLAIM_SUBMITTED' AND customer_id<>g.customer_account_id;
  IF claim_row.id IS NULL THEN RETURN atlas_customer.problem(404,'OWNERSHIP_CLAIM_NOT_FOUND'); END IF;
  ids:=ARRAY[claim_row.id];
 END IF;
 -- Lock cards in a deterministic order, then claimant accounts. Every private
 -- row requires fresh ACL/discard admission; queue filtering is not authority.
 FOR claim_row IN SELECT * FROM atlas_ownership.event WHERE id=ANY(COALESCE(ids,'{}'::uuid[])) ORDER BY card_id,id LOOP
  IF atlas_ownership_evidence.lock_card(claim_row.card_id,g.staff_id,binding->>'mode',false) THEN
   SELECT * INTO claimant FROM atlas_customer."CustomerAccount" WHERE id=claim_row.customer_id FOR SHARE;
   IF claimant.id IS NOT NULL AND claimant."revokedAt" IS NULL AND claimant.id<>g.customer_account_id THEN allowed:=array_append(allowed,claim_row.id); END IF;
  END IF;
 END LOOP;
 -- The final claimant lock can wait beyond reviewer/session/policy expiry.
 SELECT * INTO fresh FROM atlas_ownership_evidence.reviewer_actor(sh,bh,binding,phones);
 IF fresh.id IS NULL OR fresh.id<>g.id THEN RETURN atlas_customer.problem(403,'OWNERSHIP_REVIEW_REQUIRED'); END IF;
 at_time:=clock_timestamp();
 IF act='list_queue' THEN
  SELECT jsonb_build_object('claims',COALESCE(jsonb_agg(atlas_ownership_workflow.claim_projection(e.id,g.staff_id,true,binding->>'mode',at_time) ORDER BY e.id),'[]'::jsonb),'nextClaimId',next_id)
   INTO result FROM atlas_ownership.event e WHERE e.id=ANY(allowed)
   AND NOT EXISTS(SELECT 1 FROM atlas_ownership.event r WHERE r.subject_id=e.id AND r.kind IN ('CLAIM_VERIFIED','CLAIM_REJECTED'));
 ELSE
  IF cardinality(allowed)<>1 THEN RETURN atlas_customer.problem(404,'OWNERSHIP_CLAIM_NOT_FOUND'); END IF;
  SELECT jsonb_build_object('claim',atlas_ownership_workflow.claim_projection(allowed[1],g.staff_id,true,binding->>'mode',at_time)) INTO result;
  IF act='recover_request' THEN
   SELECT atlas_ownership_evidence.receipt(m,recovery.id) INTO value FROM atlas_ownership_evidence.manifest m JOIN atlas_ownership_evidence.event_link l ON l.manifest_id=m.id WHERE l.event_id=recovery.id;
   IF value IS NULL THEN RETURN atlas_customer.problem(503,'OWNERSHIP_WORKFLOW_UNAVAILABLE'); END IF;
   result:=result||jsonb_build_object('receipt',value);
  END IF;
 END IF;
 SELECT * INTO fresh FROM atlas_ownership_evidence.reviewer_actor(sh,bh,binding,phones);
 IF fresh.id IS NULL OR fresh.id<>g.id THEN RETURN atlas_customer.problem(403,'OWNERSHIP_REVIEW_REQUIRED'); END IF;
 RETURN result||jsonb_build_object('actorId',g.staff_id,'observedAt',at_time);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_ownership_workflow FROM PUBLIC;
