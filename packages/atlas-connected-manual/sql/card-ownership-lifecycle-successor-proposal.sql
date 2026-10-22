-- UNREGISTERED successor. Old SQL source files remain byte-identical.
-- Explicit v1/v2 trigger composition below preserves legacy evidence validation.
-- No grants, policy activation, storage deletion, notification or runtime wiring.
CREATE SCHEMA atlas_ownership_lifecycle;
REVOKE ALL ON SCHEMA atlas_ownership_lifecycle FROM PUBLIC;
CREATE TABLE atlas_ownership_lifecycle.transition (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 claim_id uuid NOT NULL REFERENCES atlas_ownership.event(id), revision integer NOT NULL CHECK(revision>0),
 state text NOT NULL CHECK(state IN ('PENDING','WITHDRAWN','VERIFIED','REJECTED')),
 customer_id uuid REFERENCES atlas_customer."CustomerAccount"(id), staff_id uuid REFERENCES atlas_staff."StaffIdentity"(id),
 request_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('submit_claim','withdraw_claim','replace_evidence','review_claim')),
 input jsonb NOT NULL, input_hash text NOT NULL, bundle_id uuid REFERENCES atlas_ownership_proof.bundle(id),
 manifest_hash text CHECK(manifest_hash ~ '^[a-f0-9]{64}$'),
 event_id uuid UNIQUE REFERENCES atlas_ownership.event(id), grant_id uuid REFERENCES atlas_ownership_evidence.reviewer_grant(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK((customer_id IS NULL)<>(staff_id IS NULL)),
 UNIQUE(claim_id,revision), UNIQUE(customer_id,request_id), UNIQUE(staff_id,request_id)
);
CREATE TRIGGER bind_manifest BEFORE INSERT ON atlas_ownership_lifecycle.transition FOR EACH ROW EXECUTE FUNCTION atlas_ownership_proof.bind_manifest();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON atlas_ownership_lifecycle.transition FOR EACH ROW EXECUTE FUNCTION atlas_manual.immutable();
CREATE TABLE atlas_ownership_lifecycle.event_guard (
 event_id uuid PRIMARY KEY, transaction_id bigint NOT NULL, backend_pid integer NOT NULL,
 session_hash text NOT NULL,browser_hash text NOT NULL,binding jsonb NOT NULL,phones text[],
 claim_id uuid, bundle_id uuid NOT NULL REFERENCES atlas_ownership_proof.bundle(id),
 claim_revision integer NOT NULL, receipt_id uuid NOT NULL, expected_input jsonb NOT NULL, request_input jsonb NOT NULL,
 grant_id uuid REFERENCES atlas_ownership_evidence.reviewer_grant(id)
);
CREATE FUNCTION atlas_ownership_lifecycle.state(cid uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE((SELECT jsonb_build_object('revision',t.revision,'state',t.state,'bundleId',t.bundle_id) FROM atlas_ownership_lifecycle.transition t WHERE t.claim_id=cid ORDER BY t.sequence DESC LIMIT 1),
 (SELECT jsonb_build_object('revision',1,'state',CASE e.kind WHEN 'CLAIM_VERIFIED' THEN 'VERIFIED' ELSE 'REJECTED' END,'bundleId',NULL) FROM atlas_ownership.event e WHERE e.subject_id=cid AND e.kind IN ('CLAIM_VERIFIED','CLAIM_REJECTED') ORDER BY e.sequence DESC LIMIT 1),
 jsonb_build_object('revision',1,'state','PENDING','bundleId',NULL))
$$;
CREATE FUNCTION atlas_ownership_lifecycle.input_valid(audience text,act text,d jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE names text[]; k text; f jsonb; total bigint:=0; seen uuid[]:='{}';
BEGIN
 IF audience IS NULL OR audience NOT IN ('CUSTOMER','REVIEWER') THEN RETURN false; END IF;
 names:=CASE WHEN act='read_claim' THEN ARRAY['claimId'] WHEN act='recover_request' THEN ARRAY['requestId']
 WHEN audience='CUSTOMER' AND act='reserve_bundle' THEN ARRAY['requestId','certificateNumber','expectedPublishedBinding','proofKind','files']
 WHEN audience='CUSTOMER' AND act='read_bundle' THEN ARRAY['bundleId']
 WHEN audience='CUSTOMER' AND act='submit_claim' THEN ARRAY['requestId','bundleId','expectedOwnershipRevision']
 WHEN audience='CUSTOMER' AND act='withdraw_claim' THEN ARRAY['requestId','claimId','expectedClaimRevision']
 WHEN audience='CUSTOMER' AND act='replace_evidence' THEN ARRAY['requestId','claimId','expectedClaimRevision','bundleId']
 WHEN audience='REVIEWER' AND act='review_claim' THEN ARRAY['requestId','claimId','expectedClaimRevision','expectedOwnershipRevision','decision','reasonCode','decisionReference'] END;
 IF names IS NULL OR jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>8192 OR NOT d ?& names OR d-names<>'{}'::jsonb THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['requestId','bundleId','claimId'] LOOP IF d ? k AND NOT atlas_ownership_proof.uuid(d->k) THEN RETURN false; END IF; END LOOP;
 FOREACH k IN ARRAY ARRAY['expectedOwnershipRevision','expectedClaimRevision'] LOOP
  IF d ? k AND (jsonb_typeof(d->k) IS DISTINCT FROM 'number' OR NOT COALESCE(d->>k ~ '^(0|[1-9][0-9]{0,9})$',false) OR (d->>k)::numeric>=2147483647) THEN RETURN false; END IF;
 END LOOP;
 IF d ? 'expectedClaimRevision' AND (d->>'expectedClaimRevision')::integer<1 THEN RETURN false; END IF;
 IF act='reserve_bundle' THEN
  IF NOT COALESCE(d->>'certificateNumber' ~ '^ATLAS-[A-F0-9]{12}$' AND d->>'proofKind' ~ '^[A-Z][A-Z0-9_]{0,39}$',false)
  OR jsonb_typeof(d->'files') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'files') NOT BETWEEN 1 AND 6 THEN RETURN false; END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(d->'files') LOOP
   IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR NOT f ?& ARRAY['clientFileId','byteCount','sha256','declaredType'] OR f-ARRAY['clientFileId','byteCount','sha256','declaredType']<>'{}'::jsonb
   OR NOT atlas_ownership_proof.uuid(f->'clientFileId') OR (f->>'clientFileId')::uuid=ANY(seen)
   OR NOT COALESCE(f->>'sha256' ~ '^[a-f0-9]{64}$',false) OR jsonb_typeof(f->'sha256')<>'string'
   OR COALESCE(f->>'declaredType','') NOT IN ('image/jpeg','image/png','image/heic') OR jsonb_typeof(f->'byteCount') IS DISTINCT FROM 'number'
   OR NOT COALESCE(f->>'byteCount' ~ '^[1-9][0-9]{0,7}$',false) THEN RETURN false; END IF;
   IF (f->>'byteCount')::bigint>20971520 THEN RETURN false; END IF;
   total:=total+(f->>'byteCount')::bigint; seen:=array_append(seen,(f->>'clientFileId')::uuid);
  END LOOP;
  RETURN total<=62914560;
 END IF;
 IF act='review_claim' THEN RETURN COALESCE(d->>'decision' IN ('VERIFY','REJECT') AND d->>'reasonCode' ~ '^[A-Z][A-Z0-9_]{0,39}$'
 AND d->>'decisionReference' ~ '^[ -~]{1,200}$' AND btrim(d->>'decisionReference')=d->>'decisionReference',false); END IF;
 RETURN true;
END $$;
CREATE FUNCTION atlas_ownership_lifecycle.receipt(t atlas_ownership_lifecycle.transition) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('receiptId',t.id,'requestId',t.request_id,'action',t.action,'claimId',t.claim_id,'claimRevision',t.revision,'state',t.state,'ownershipEventId',t.event_id,'bundleId',t.bundle_id)
$$;
-- Withdrawal/status must remain possible when a claim's source is unavailable.
-- The original card/identity/intake lock order is retained, including ACL first.
CREATE FUNCTION atlas_ownership_lifecycle.lock_card(cid uuid,sid uuid,mode_name text,allow_unavailable boolean) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM atlas_manual.card c WHERE c.id=cid AND (sid IS NULL OR c.owner_id=sid OR sid=ANY(c.readers) OR sid=ANY(c.editors) OR sid=ANY(c.approvers)) FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM atlas_manual.public_report_identity WHERE card_id=cid FOR UPDATE; IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM atlas_manual_intake.card WHERE id=cid FOR SHARE;
 RETURN FOUND AND (allow_unavailable OR atlas_ownership_workflow.card_binding(cid,mode_name) IS NOT NULL);
END $$;
CREATE FUNCTION atlas_ownership_lifecycle.claim_projection(cid uuid,viewer uuid,reviewer boolean,mode_name text) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE e atlas_ownership.event; s jsonb; b atlas_ownership_proof.bundle; p atlas_ownership_evidence.policy; up atlas_ownership_proof.policy;
 title jsonb; reasons jsonb:='[]'; v jsonb; old atlas_ownership_evidence.manifest;
BEGIN
 SELECT * INTO e FROM atlas_ownership.event WHERE id=cid AND kind='CLAIM_SUBMITTED'; IF e.id IS NULL OR (NOT reviewer AND e.customer_id<>viewer) THEN RETURN NULL; END IF;
 s:=atlas_ownership_lifecycle.state(cid); title:=atlas_ownership.current_title(e.card_id);
 SELECT * INTO p FROM atlas_ownership_evidence.policy WHERE id='active'; SELECT * INTO up FROM atlas_ownership_proof.policy WHERE id='active';
 IF s->>'bundleId' IS NOT NULL THEN
  SELECT * INTO b FROM atlas_ownership_proof.bundle WHERE id=(s->>'bundleId')::uuid;
  IF b.id IS NULL THEN reasons:=reasons||'"EVIDENCE_UNAVAILABLE"'::jsonb;
  ELSIF b.usable_until<=clock_timestamp() OR b.delete_after<=clock_timestamp() THEN reasons:=reasons||'"EVIDENCE_EXPIRED"'::jsonb;
  ELSIF p.enabled IS DISTINCT FROM true OR up.enabled IS DISTINCT FROM true OR p.valid_until<=clock_timestamp() OR up.valid_until<=clock_timestamp() THEN reasons:=reasons||'"POLICY_UNAVAILABLE"'::jsonb;
  ELSIF b.policy_snapshot<>atlas_ownership_proof.policy_snapshot() THEN reasons:=reasons||'"POLICY_CHANGED"'::jsonb;
  ELSIF NOT atlas_ownership_proof.bundle_ready(b,mode_name) THEN reasons:=reasons||'"EVIDENCE_UNAVAILABLE"'::jsonb; END IF;
 ELSE
  SELECT m.* INTO old FROM atlas_ownership_evidence.manifest m JOIN atlas_ownership_evidence.event_link l ON l.manifest_id=m.id WHERE l.event_id=cid;
  IF old.id IS NULL THEN reasons:=reasons||'"EVIDENCE_UNAVAILABLE"'::jsonb;
  ELSIF old.retention_until<=clock_timestamp() THEN reasons:=reasons||'"EVIDENCE_EXPIRED"'::jsonb;
  ELSIF p.enabled IS DISTINCT FROM true OR p.valid_until<=clock_timestamp() THEN reasons:=reasons||'"POLICY_UNAVAILABLE"'::jsonb;
  ELSIF old.policy_revision<>p.revision THEN reasons:=reasons||'"POLICY_CHANGED"'::jsonb;
  ELSIF NOT atlas_ownership_evidence.manifest_valid(old,p) THEN reasons:=reasons||'"EVIDENCE_UNAVAILABLE"'::jsonb; END IF;
 END IF;
 IF atlas_ownership_workflow.card_binding(e.card_id,mode_name) IS NULL THEN reasons:=reasons||'"CARD_UNAVAILABLE"'::jsonb; END IF;
 IF title->>'status'<>'UNKNOWN' AND s->>'state'='PENDING' THEN reasons:=reasons||'"OWNERSHIP_CHANGED"'::jsonb; END IF;
 v:=jsonb_build_object('claimId',e.id,'cardId',e.card_id,'card',atlas_ownership_workflow.card_binding(e.card_id,mode_name),'claimRevision',s->'revision','state',s->'state','bundleId',s->'bundleId','blockedReasons',reasons);
 IF reviewer THEN RETURN v||jsonb_build_object('expectedOwnershipRevision',title->'revision'); END IF;
 RETURN v||jsonb_build_object('currentlyOwnedByYou',COALESCE(title->>'ownerAccountId'=viewer::text,false));
END $$;

CREATE FUNCTION atlas_ownership_lifecycle.customer_gateway(sh text,bh text,binding jsonb,act text,d jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a atlas_customer."CustomerAccount"; fresh atlas_customer."CustomerAccount"; p atlas_ownership_evidence.policy; up atlas_ownership_proof.policy;
 b atlas_ownership_proof.bundle; prior atlas_ownership_lifecycle.transition; saved atlas_ownership_lifecycle.transition;
 claim atlas_ownership.event; cid uuid; ih text; bound jsonb; title jsonb; s jsonb; f jsonb; bid uuid; eid uuid; rid uuid; ein jsonb; now_at timestamptz;
BEGIN
 IF atlas_ownership_lifecycle.input_valid('CUSTOMER',act,d) IS DISTINCT FROM true THEN RETURN atlas_customer.problem(400,'INVALID_OWNERSHIP_LIFECYCLE'); END IF;
 IF NOT atlas_ownership_workflow.binding_valid(binding) THEN RETURN atlas_customer.problem(503,'CUSTOMER_ACCESS_NOT_ENABLED'); END IF;
 SELECT * INTO p FROM atlas_ownership_evidence.policy WHERE id='active' FOR SHARE;
 SELECT * INTO up FROM atlas_ownership_proof.policy WHERE id='active' FOR SHARE;
 SELECT * INTO a FROM atlas_ownership_evidence.customer_actor(sh,bh,binding); IF a.id IS NULL THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-ownership-account:'||a.id::text,0));
 ih:=atlas_ownership_proof.digest(jsonb_build_object('action',act,'input',d));
 IF d ? 'requestId' THEN
  SELECT * INTO prior FROM atlas_ownership_lifecycle.transition WHERE customer_id=a.id AND request_id=(d->>'requestId')::uuid;
  IF prior.id IS NOT NULL THEN
   IF act<>'recover_request' AND prior.input_hash<>ih THEN RETURN atlas_customer.problem(409,'OWNERSHIP_REQUEST_CONFLICT'); END IF;
   SELECT * INTO fresh FROM atlas_ownership_evidence.customer_actor(sh,bh,binding); IF fresh.id IS NULL OR fresh.id<>a.id THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
   RETURN jsonb_build_object('actorId',a.id,'observedAt',clock_timestamp(),'receipt',atlas_ownership_lifecycle.receipt(prior));
  END IF;
  IF act='recover_request' THEN
   SELECT * INTO b FROM atlas_ownership_proof.bundle WHERE customer_id=a.id AND request_id=(d->>'requestId')::uuid;
   SELECT * INTO fresh FROM atlas_ownership_evidence.customer_actor(sh,bh,binding);
   IF fresh.id IS NULL OR fresh.id<>a.id THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
   IF b.id IS NULL THEN RETURN atlas_customer.problem(404,'OWNERSHIP_REQUEST_NOT_FOUND'); END IF;
   RETURN jsonb_build_object('actorId',a.id,'observedAt',clock_timestamp(),'bundle',atlas_ownership_proof.bundle_projection(b.id));
  END IF;
  IF EXISTS(SELECT 1 FROM atlas_ownership.event WHERE customer_id=a.id AND request_id=(d->>'requestId')::uuid)
   OR (act<>'reserve_bundle' AND EXISTS(SELECT 1 FROM atlas_ownership_proof.bundle WHERE customer_id=a.id AND request_id=(d->>'requestId')::uuid))
   THEN RETURN atlas_customer.problem(409,'OWNERSHIP_REQUEST_CONFLICT'); END IF;
 END IF;
 IF act='reserve_bundle' THEN SELECT card_id INTO cid FROM atlas_manual.public_report_identity WHERE report_number=d->>'certificateNumber';
 ELSIF act IN ('read_bundle','submit_claim','replace_evidence') THEN
  SELECT * INTO b FROM atlas_ownership_proof.bundle WHERE id=(d->>'bundleId')::uuid AND customer_id=a.id; cid:=b.card_id;
 END IF;
 IF d ? 'claimId' THEN
  SELECT * INTO claim FROM atlas_ownership.event WHERE id=(d->>'claimId')::uuid AND customer_id=a.id AND kind='CLAIM_SUBMITTED';
  IF claim.id IS NULL OR (cid IS NOT NULL AND cid<>claim.card_id) THEN RETURN atlas_customer.problem(404,'OWNERSHIP_CLAIM_NOT_FOUND'); END IF; cid:=claim.card_id;
 END IF;
 IF cid IS NULL OR NOT atlas_ownership_lifecycle.lock_card(cid,NULL,binding->>'mode',act IN ('read_claim','withdraw_claim','read_bundle')) THEN RETURN atlas_customer.problem(404,'OWNERSHIP_NOT_FOUND'); END IF;
 SELECT * INTO fresh FROM atlas_ownership_evidence.customer_actor(sh,bh,binding); IF fresh.id IS NULL OR fresh.id<>a.id THEN RETURN atlas_customer.problem(401,'SIGN_IN_REQUIRED'); END IF;
 IF act='read_claim' THEN RETURN jsonb_build_object('actorId',a.id,'observedAt',clock_timestamp(),'claim',atlas_ownership_lifecycle.claim_projection(claim.id,a.id,false,binding->>'mode')); END IF;
 IF act='read_bundle' THEN RETURN jsonb_build_object('actorId',a.id,'observedAt',clock_timestamp(),'bundle',atlas_ownership_proof.bundle_projection(b.id)); END IF;
 IF act='withdraw_claim' THEN
  s:=atlas_ownership_lifecycle.state(claim.id);
  IF s->>'state'<>'PENDING' OR (s->>'revision')::integer<>(d->>'expectedClaimRevision')::integer THEN RETURN atlas_customer.problem(409,'OWNERSHIP_CLAIM_CHANGED'); END IF;
  INSERT INTO atlas_ownership_lifecycle.transition(claim_id,revision,state,customer_id,request_id,action,input,input_hash,bundle_id)
  VALUES(claim.id,(s->>'revision')::integer+1,'WITHDRAWN',a.id,(d->>'requestId')::uuid,act,d,ih,(s->>'bundleId')::uuid) RETURNING * INTO saved;
  RETURN jsonb_build_object('actorId',a.id,'observedAt',clock_timestamp(),'receipt',atlas_ownership_lifecycle.receipt(saved));
 END IF;
 IF NOT atlas_ownership_proof.live_policy() THEN RETURN atlas_customer.problem(503,'OWNERSHIP_PROOF_DISABLED'); END IF;
 bound:=atlas_ownership_workflow.card_binding(cid,binding->>'mode');
 IF act='reserve_bundle' THEN
  IF bound IS NULL OR bound IS DISTINCT FROM d->'expectedPublishedBinding' THEN RETURN atlas_customer.problem(409,'OWNERSHIP_CARD_BINDING_CHANGED'); END IF;
  IF NOT d->>'proofKind'=ANY(p.accepted_claim_kinds) OR EXISTS(SELECT 1 FROM jsonb_array_elements(d->'files') AS file_items(value) WHERE NOT file_items.value->>'declaredType'=ANY(up.accepted_formats)) THEN RETURN atlas_customer.problem(400,'OWNERSHIP_PROOF_KIND_NOT_ACCEPTED'); END IF;
  SELECT * INTO b FROM atlas_ownership_proof.bundle WHERE customer_id=a.id AND request_id=(d->>'requestId')::uuid;
  IF b.id IS NOT NULL THEN
   IF b.request_hash<>ih THEN RETURN atlas_customer.problem(409,'OWNERSHIP_REQUEST_CONFLICT'); END IF;
   RETURN jsonb_build_object('actorId',a.id,'observedAt',clock_timestamp(),'bundle',atlas_ownership_proof.bundle_projection(b.id));
  END IF;
  -- Bound abandoned reservations: no unlimited object slots even before cleanup.
  IF (SELECT count(*) FROM atlas_ownership_proof.bundle x WHERE x.customer_id=a.id AND x.expires_at>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM atlas_ownership_proof.consumption y WHERE y.bundle_id=x.id))>=3 THEN RETURN atlas_customer.problem(429,'OWNERSHIP_PROOF_RESERVATION_LIMIT'); END IF;
  now_at:=clock_timestamp();
  INSERT INTO atlas_ownership_proof.bundle(customer_id,card_id,request_id,request_hash,binding,proof_kind,policy_revision,upload_policy_revision,policy_hash,policy_snapshot,expires_at,usable_until,delete_after)
  VALUES(a.id,cid,(d->>'requestId')::uuid,ih,bound,d->>'proofKind',p.revision,up.revision,atlas_ownership_proof.digest(atlas_ownership_proof.policy_snapshot()),atlas_ownership_proof.policy_snapshot(),
   now_at+interval '300 seconds',now_at+make_interval(secs=>p.retention_seconds),now_at+make_interval(secs=>up.delete_after_seconds)) RETURNING * INTO b;
  FOR f IN SELECT value FROM jsonb_array_elements(d->'files') LOOP
   INSERT INTO atlas_ownership_proof.object(bundle_id,client_file_id,byte_count,sha256,declared_type) VALUES(b.id,(f->>'clientFileId')::uuid,(f->>'byteCount')::integer,f->>'sha256',f->>'declaredType');
  END LOOP;
  RETURN jsonb_build_object('actorId',a.id,'observedAt',clock_timestamp(),'bundle',atlas_ownership_proof.bundle_projection(b.id));
 END IF;
 IF NOT atlas_ownership_proof.bundle_ready(b,binding->>'mode') OR EXISTS(SELECT 1 FROM atlas_ownership_proof.consumption WHERE bundle_id=b.id) THEN RETURN atlas_customer.problem(409,'OWNERSHIP_PROOF_UNAVAILABLE'); END IF;
 IF act='replace_evidence' THEN
  s:=atlas_ownership_lifecycle.state(claim.id);
  IF s->>'state'<>'PENDING' OR (s->>'revision')::integer<>(d->>'expectedClaimRevision')::integer THEN RETURN atlas_customer.problem(409,'OWNERSHIP_CLAIM_CHANGED'); END IF;
  INSERT INTO atlas_ownership_lifecycle.transition(claim_id,revision,state,customer_id,request_id,action,input,input_hash,bundle_id)
  VALUES(claim.id,(s->>'revision')::integer+1,'PENDING',a.id,(d->>'requestId')::uuid,act,d,ih,b.id) RETURNING * INTO saved;
 ELSE
  title:=atlas_ownership.current_title(cid);
  IF title->>'status'<>'UNKNOWN' OR (title->>'revision')::integer<>(d->>'expectedOwnershipRevision')::integer THEN RETURN atlas_customer.problem(409,'OWNERSHIP_REVISION_CHANGED'); END IF;
  IF EXISTS(SELECT 1 FROM atlas_ownership.event e WHERE e.card_id=cid AND e.customer_id=a.id AND e.kind='CLAIM_SUBMITTED' AND atlas_ownership_lifecycle.state(e.id)->>'state'='PENDING') THEN RETURN atlas_customer.problem(409,'OWNERSHIP_CLAIM_PENDING'); END IF;
  eid:=gen_random_uuid(); rid:=gen_random_uuid();
  ein:=jsonb_build_object('schema','atlas-ownership-proof-claim-v2','bundleId',b.id,'bundleHash',atlas_ownership_proof.digest(atlas_ownership_proof.manifest(b.id)),
   'expectedOwnershipRevision',(title->>'revision')::integer,'evidence',jsonb_build_object('referenceId',rid,'sha256',ih));
  INSERT INTO atlas_ownership_lifecycle.event_guard VALUES(eid,txid_current(),pg_backend_pid(),sh,bh,binding,NULL,NULL,b.id,1,rid,ein,d,NULL);
  INSERT INTO atlas_ownership.event(id,card_id,customer_id,request_id,action,input,input_hash,kind)
  VALUES(eid,cid,a.id,(d->>'requestId')::uuid,act,ein,ih,'CLAIM_SUBMITTED');
  INSERT INTO atlas_ownership_lifecycle.transition(id,claim_id,revision,state,customer_id,request_id,action,input,input_hash,bundle_id,event_id)
  VALUES(rid,eid,1,'PENDING',a.id,(d->>'requestId')::uuid,act,d,ih,b.id,eid) RETURNING * INTO saved;
 END IF;
 INSERT INTO atlas_ownership_proof.consumption(bundle_id,claim_id,claim_revision) VALUES(b.id,saved.claim_id,saved.revision);
 RETURN jsonb_build_object('actorId',a.id,'observedAt',clock_timestamp(),'receipt',atlas_ownership_lifecycle.receipt(saved));
END $$;

CREATE FUNCTION atlas_ownership_lifecycle.reviewer_gateway(sh text,bh text,binding jsonb,phones text[],act text,d jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g atlas_ownership_evidence.reviewer_grant; fresh atlas_ownership_evidence.reviewer_grant; p atlas_ownership_evidence.policy;
 claim atlas_ownership.event; claimant atlas_customer."CustomerAccount"; b atlas_ownership_proof.bundle;
 prior atlas_ownership_lifecycle.transition; saved atlas_ownership_lifecycle.transition; s jsonb; title jsonb; ih text; rid uuid; eid uuid; ein jsonb;
BEGIN
 IF atlas_ownership_lifecycle.input_valid('REVIEWER',act,d) IS DISTINCT FROM true THEN RETURN atlas_customer.problem(400,'INVALID_OWNERSHIP_LIFECYCLE'); END IF;
 IF NOT atlas_ownership_workflow.binding_valid(binding) THEN RETURN atlas_customer.problem(403,'OWNERSHIP_REVIEW_REQUIRED'); END IF;
 SELECT * INTO p FROM atlas_ownership_evidence.policy WHERE id='active' FOR SHARE;
 PERFORM 1 FROM atlas_ownership_proof.policy WHERE id='active' FOR SHARE;
 SELECT * INTO g FROM atlas_ownership_evidence.reviewer_actor(sh,bh,binding,phones); IF g.id IS NULL THEN RETURN atlas_customer.problem(403,'OWNERSHIP_REVIEW_REQUIRED'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('atlas-ownership-reviewer:'||g.staff_id::text,0));
 ih:=atlas_ownership_proof.digest(jsonb_build_object('action',act,'input',d));
 IF d ? 'requestId' THEN
  SELECT * INTO prior FROM atlas_ownership_lifecycle.transition WHERE staff_id=g.staff_id AND request_id=(d->>'requestId')::uuid;
  IF prior.id IS NOT NULL THEN
   IF act<>'recover_request' AND prior.input_hash<>ih THEN RETURN atlas_customer.problem(409,'OWNERSHIP_REQUEST_CONFLICT'); END IF;
   SELECT * INTO claim FROM atlas_ownership.event WHERE id=prior.claim_id;
  ELSIF act='recover_request' THEN RETURN atlas_customer.problem(404,'OWNERSHIP_REQUEST_NOT_FOUND'); END IF;
 END IF;
 IF claim.id IS NULL THEN SELECT * INTO claim FROM atlas_ownership.event WHERE id=(d->>'claimId')::uuid AND kind='CLAIM_SUBMITTED'; END IF;
 IF claim.id IS NULL OR NOT atlas_ownership_lifecycle.lock_card(claim.card_id,g.staff_id,binding->>'mode',act IN ('read_claim','recover_request')) THEN RETURN atlas_customer.problem(404,'OWNERSHIP_CLAIM_NOT_FOUND'); END IF;
 SELECT * INTO claimant FROM atlas_customer."CustomerAccount" WHERE id=claim.customer_id FOR SHARE;
 IF claimant.id IS NULL OR claimant."revokedAt" IS NOT NULL OR claimant.id=g.customer_account_id THEN RETURN atlas_customer.problem(403,'OWNERSHIP_INDEPENDENT_REVIEW_REQUIRED'); END IF;
 SELECT * INTO fresh FROM atlas_ownership_evidence.reviewer_actor(sh,bh,binding,phones);
 IF fresh.id IS NULL OR fresh.id<>g.id THEN RETURN atlas_customer.problem(403,'OWNERSHIP_REVIEW_REQUIRED'); END IF;
 IF prior.id IS NOT NULL THEN RETURN jsonb_build_object('actorId',g.staff_id,'observedAt',clock_timestamp(),'receipt',atlas_ownership_lifecycle.receipt(prior)); END IF;
 IF act='read_claim' THEN RETURN jsonb_build_object('actorId',g.staff_id,'observedAt',clock_timestamp(),'claim',atlas_ownership_lifecycle.claim_projection(claim.id,g.staff_id,true,binding->>'mode')); END IF;
 IF EXISTS(SELECT 1 FROM atlas_ownership.event WHERE staff_id=g.staff_id AND request_id=(d->>'requestId')::uuid) THEN RETURN atlas_customer.problem(409,'OWNERSHIP_REQUEST_CONFLICT'); END IF;
 s:=atlas_ownership_lifecycle.state(claim.id); title:=atlas_ownership.current_title(claim.card_id);
 IF s->>'state'<>'PENDING' OR (s->>'revision')::integer<>(d->>'expectedClaimRevision')::integer THEN RETURN atlas_customer.problem(409,'OWNERSHIP_CLAIM_CHANGED'); END IF;
 IF (title->>'revision')::integer<>(d->>'expectedOwnershipRevision')::integer OR (d->>'decision'='VERIFY' AND title->>'status'<>'UNKNOWN') THEN RETURN atlas_customer.problem(409,'OWNERSHIP_REVISION_CHANGED'); END IF;
 SELECT * INTO b FROM atlas_ownership_proof.bundle WHERE id=(s->>'bundleId')::uuid AND customer_id=claim.customer_id AND card_id=claim.card_id;
 IF NOT atlas_ownership_proof.live_policy() OR NOT atlas_ownership_proof.bundle_ready(b,binding->>'mode') THEN RETURN atlas_customer.problem(409,'OWNERSHIP_PROOF_UNAVAILABLE'); END IF;
 IF NOT d->>'reasonCode'=ANY(p.accepted_review_kinds) THEN RETURN atlas_customer.problem(400,'OWNERSHIP_REVIEW_REASON_NOT_ACCEPTED'); END IF;
 eid:=gen_random_uuid(); rid:=gen_random_uuid();
 ein:=jsonb_build_object('schema','atlas-ownership-proof-review-v2','bundleId',b.id,'bundleHash',atlas_ownership_proof.digest(atlas_ownership_proof.manifest(b.id)),'claimRevision',s->'revision','grantId',g.id,
 'decision',d->'decision','reasonCode',d->'reasonCode','decisionReference',d->'decisionReference','expectedOwnershipRevision',title->'revision',
 'evidence',jsonb_build_object('referenceId',rid,'sha256',ih));
 INSERT INTO atlas_ownership_lifecycle.event_guard VALUES(eid,txid_current(),pg_backend_pid(),sh,bh,binding,phones,claim.id,b.id,(s->>'revision')::integer,rid,ein,d,g.id);
 INSERT INTO atlas_ownership.event(id,card_id,staff_id,request_id,action,input,input_hash,kind,subject_id,owner_account_id,ownership_revision)
 VALUES(eid,claim.card_id,g.staff_id,(d->>'requestId')::uuid,act,ein,ih,CASE WHEN d->>'decision'='VERIFY' THEN 'CLAIM_VERIFIED' ELSE 'CLAIM_REJECTED' END,claim.id,
 CASE WHEN d->>'decision'='VERIFY' THEN claim.customer_id END,CASE WHEN d->>'decision'='VERIFY' THEN (title->>'revision')::integer+1 END);
 INSERT INTO atlas_ownership_lifecycle.transition(id,claim_id,revision,state,staff_id,request_id,action,input,input_hash,bundle_id,event_id,grant_id)
 VALUES(rid,claim.id,(s->>'revision')::integer+1,CASE WHEN d->>'decision'='VERIFY' THEN 'VERIFIED' ELSE 'REJECTED' END,g.staff_id,(d->>'requestId')::uuid,act,d,ih,b.id,eid,g.id) RETURNING * INTO saved;
 RETURN jsonb_build_object('actorId',g.staff_id,'observedAt',clock_timestamp(),'receipt',atlas_ownership_lifecycle.receipt(saved));
END $$;

-- Private v2 final-insert guard; the public gateway has already serialized the
-- card. Refresh authority after every potentially waiting authorization lock.
CREATE FUNCTION atlas_ownership_lifecycle.enforce_v2(e atlas_ownership.event) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE g atlas_ownership_lifecycle.event_guard; b atlas_ownership_proof.bundle; a atlas_customer."CustomerAccount";
 r atlas_ownership_evidence.reviewer_grant; claim atlas_ownership.event; claimant atlas_customer."CustomerAccount"; s jsonb; title jsonb;
BEGIN
 DELETE FROM atlas_ownership_lifecycle.event_guard WHERE event_id=e.id AND transaction_id=txid_current() AND backend_pid=pg_backend_pid() RETURNING * INTO g;
 SELECT * INTO b FROM atlas_ownership_proof.bundle WHERE id=g.bundle_id;
 IF g.event_id IS NULL OR g.expected_input IS DISTINCT FROM e.input OR e.request_id::text IS DISTINCT FROM g.request_input->>'requestId'
 OR e.input->>'bundleHash' IS DISTINCT FROM atlas_ownership_proof.digest(atlas_ownership_proof.manifest(b.id))
 OR e.input_hash<>atlas_ownership_proof.digest(jsonb_build_object('action',e.action,'input',g.request_input)) OR b.card_id IS DISTINCT FROM e.card_id
 THEN RAISE EXCEPTION 'OWNERSHIP_V2_GATEWAY_REQUIRED' USING ERRCODE='42501'; END IF;
 IF e.kind='CLAIM_SUBMITTED' THEN
  SELECT * INTO a FROM atlas_ownership_evidence.customer_actor(g.session_hash,g.browser_hash,g.binding);
  IF a.id IS NULL OR a.id<>b.customer_id OR a.id IS DISTINCT FROM e.customer_id OR e.staff_id IS NOT NULL OR e.subject_id IS NOT NULL OR e.action<>'submit_claim'
  OR g.claim_id IS NOT NULL OR g.claim_revision<>1 OR EXISTS(SELECT 1 FROM atlas_ownership_proof.consumption WHERE bundle_id=b.id)
  THEN RAISE EXCEPTION 'OWNERSHIP_V2_AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  title:=atlas_ownership.current_title(e.card_id);
  IF title->>'status'<>'UNKNOWN' OR title->>'revision' IS DISTINCT FROM g.request_input->>'expectedOwnershipRevision' THEN RAISE EXCEPTION 'OWNERSHIP_V2_TITLE_CHANGED' USING ERRCODE='42501'; END IF;
 ELSE
  SELECT * INTO claim FROM atlas_ownership.event WHERE id=g.claim_id AND card_id=e.card_id AND kind='CLAIM_SUBMITTED';
  SELECT * INTO claimant FROM atlas_customer."CustomerAccount" WHERE id=claim.customer_id FOR SHARE;
  SELECT * INTO r FROM atlas_ownership_evidence.reviewer_actor(g.session_hash,g.browser_hash,g.binding,g.phones);
  s:=atlas_ownership_lifecycle.state(claim.id); title:=atlas_ownership.current_title(e.card_id);
  IF r.id IS NULL OR r.id IS DISTINCT FROM g.grant_id OR r.staff_id IS DISTINCT FROM e.staff_id OR e.customer_id IS NOT NULL
  OR e.action<>'review_claim' OR e.subject_id IS DISTINCT FROM claim.id OR claim.customer_id IS DISTINCT FROM b.customer_id
  OR claimant.id IS NULL OR claimant."revokedAt" IS NOT NULL OR claimant.id=r.customer_account_id
  OR s->>'state'<>'PENDING' OR (s->>'revision')::integer<>g.claim_revision OR s->>'bundleId' IS DISTINCT FROM b.id::text
  OR e.kind IS DISTINCT FROM (CASE WHEN g.request_input->>'decision'='VERIFY' THEN 'CLAIM_VERIFIED' ELSE 'CLAIM_REJECTED' END)
  OR title->>'revision' IS DISTINCT FROM g.request_input->>'expectedOwnershipRevision'
  OR (e.kind='CLAIM_VERIFIED' AND (title->>'status'<>'UNKNOWN' OR e.owner_account_id IS DISTINCT FROM claimant.id OR e.ownership_revision<>(title->>'revision')::integer+1))
  THEN RAISE EXCEPTION 'OWNERSHIP_V2_REVIEW_REQUIRED' USING ERRCODE='42501'; END IF;
 END IF;
 IF NOT atlas_ownership_proof.live_policy() OR NOT atlas_ownership_proof.bundle_ready(b,g.binding->>'mode')
 THEN RAISE EXCEPTION 'OWNERSHIP_V2_PROOF_UNAVAILABLE' USING ERRCODE='42501'; END IF;
END $$;

-- Fail closed unless the exact qualified v1 guard is installed. A successor is
-- deliberately single-use, not CREATE OR REPLACE against an unknown definition.
DO $guard_pin$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='atlas_ownership_evidence' AND p.proname='enforce_event' AND p.pronargs=0
 AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']
 AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='6f84bf98c46b72d99345ecfe8b15c0173055eacddbcc2353ed6ee87c1cf561eb')
 THEN RAISE EXCEPTION 'OWNERSHIP_V1_GUARD_SOURCE_CHANGED'; END IF;
END $guard_pin$;
CREATE OR REPLACE FUNCTION atlas_ownership_evidence.enforce_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE guard atlas_ownership_evidence.event_guard; m atlas_ownership_evidence.manifest; p atlas_ownership_evidence.policy; a atlas_customer."CustomerAccount"; g atlas_ownership_evidence.reviewer_grant; claim atlas_ownership.event; original atlas_ownership_evidence.manifest;
BEGIN
 IF NEW.kind NOT IN ('CLAIM_SUBMITTED','CLAIM_VERIFIED','CLAIM_REJECTED') THEN RETURN NEW; END IF;
 -- Version 2 uses a private one-transaction guard, never a caller-settable flag.
 IF EXISTS(SELECT 1 FROM atlas_ownership_lifecycle.event_guard WHERE event_id=NEW.id AND transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN
  PERFORM atlas_ownership_lifecycle.enforce_v2(NEW); RETURN NEW;
 END IF;
 -- A v1 decision cannot review a withdrawn or replaced v2-managed claim.
 IF NEW.kind IN ('CLAIM_VERIFIED','CLAIM_REJECTED') AND EXISTS(SELECT 1 FROM atlas_ownership_lifecycle.transition WHERE claim_id=NEW.subject_id) THEN
  RAISE EXCEPTION 'OWNERSHIP_LIFECYCLE_GATEWAY_REQUIRED' USING ERRCODE='42501';
 END IF;
 DELETE FROM atlas_ownership_evidence.event_guard WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()
 AND manifest_id::text=NEW.input#>>'{evidence,referenceId}' RETURNING * INTO guard;
 IF guard.manifest_id IS NULL OR guard.expected_input IS DISTINCT FROM NEW.input THEN RAISE EXCEPTION 'OWNERSHIP_EVIDENCE_GATEWAY_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM atlas_ownership_evidence.manifest WHERE id=guard.manifest_id;
 SELECT * INTO p FROM atlas_ownership_evidence.live_policy();
 IF p.id IS NULL OR NOT atlas_ownership_evidence.manifest_valid(m,p) OR m.card_id<>NEW.card_id OR m.request_id<>NEW.request_id
 OR m.sha256 IS DISTINCT FROM NEW.input#>>'{evidence,sha256}' THEN RAISE EXCEPTION 'OWNERSHIP_EVIDENCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF NEW.kind='CLAIM_SUBMITTED' THEN
  SELECT * INTO a FROM atlas_ownership_evidence.customer_actor(guard.session_hash,guard.browser_hash,guard.binding);
  IF a.id IS NULL OR m.phase<>'CLAIM' OR a.id<>m.customer_id OR a.id IS DISTINCT FROM NEW.customer_id OR NEW.staff_id IS NOT NULL OR NEW.action<>'submit_claim'
   THEN RAISE EXCEPTION 'OWNERSHIP_EVIDENCE_AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 ELSE
  SELECT * INTO g FROM atlas_ownership_evidence.reviewer_actor(guard.session_hash,guard.browser_hash,guard.binding,guard.phones);
  SELECT * INTO claim FROM atlas_ownership.event WHERE id=NEW.subject_id AND card_id=m.card_id AND kind='CLAIM_SUBMITTED';
  SELECT em.* INTO original FROM atlas_ownership_evidence.manifest em JOIN atlas_ownership_evidence.event_link l ON l.manifest_id=em.id WHERE l.event_id=claim.id;
  IF g.id IS NULL OR g.id IS DISTINCT FROM m.grant_id OR m.phase<>'REVIEW' OR m.claim_id IS DISTINCT FROM claim.id OR claim.customer_id IS DISTINCT FROM m.customer_id
   OR g.customer_account_id=m.customer_id OR NEW.staff_id IS DISTINCT FROM g.staff_id OR m.staff_id IS DISTINCT FROM g.staff_id OR NEW.action<>'review_claim'
   OR NOT atlas_ownership_evidence.manifest_valid(original,p) OR original.id::text IS DISTINCT FROM claim.input#>>'{evidence,referenceId}'
   OR original.sha256 IS DISTINCT FROM claim.input#>>'{evidence,sha256}' THEN RAISE EXCEPTION 'OWNERSHIP_EVIDENCE_REVIEW_REQUIRED' USING ERRCODE='42501'; END IF;
 END IF;
 -- Authentication may have waited. Recheck temporal policy/object bounds at
 -- the final insertion point, after all original writer and reviewer waits.
 IF p.valid_until<=clock_timestamp() OR NOT atlas_ownership_evidence.manifest_valid(m,p)
 OR (NEW.kind<>'CLAIM_SUBMITTED' AND NOT atlas_ownership_evidence.manifest_valid(original,p))
 THEN RAISE EXCEPTION 'OWNERSHIP_EVIDENCE_EXPIRED' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION atlas_ownership_evidence.enforce_event() FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA atlas_ownership_lifecycle FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA atlas_ownership_lifecycle FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_ownership_lifecycle FROM PUBLIC;
